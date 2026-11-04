import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import '@fastify/cookie'
import argon2 from 'argon2'
import { one, q } from '../db/index.js'
import { config } from '../config.js'
import { randomToken, sha256 } from './crypto.js'
import { forbidden, unauthorized } from './errors.js'

export interface AuthUser {
  id: string
  email: string
  name: string
  role: 'admin' | 'user'
  totp_enabled: boolean
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null
    sessionId: string | null
    authVia: 'session' | 'token' | null
  }
}

export const SESSION_COOKIE = 'quiver_session'

export async function hashPassword(pw: string) {
  return argon2.hash(pw, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 })
}
export async function verifyPassword(hash: string, pw: string) {
  try { return await argon2.verify(hash, pw) } catch { return false }
}

export async function createSession(userId: string, req: FastifyRequest, mfaPending = false) {
  const token = randomToken(32)
  const expires = new Date(Date.now() + config.sessionTtlHours * 3600 * 1000)
  const row = await one<{ id: string }>(
    `INSERT INTO sessions (user_id, token_hash, expires_at, ip, user_agent, mfa_pending) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [userId, sha256(token), expires, req.ip, (req.headers['user-agent'] || '').slice(0, 300), mfaPending],
  )
  return { token, id: row!.id, expires }
}

export function setSessionCookie(reply: FastifyReply, token: string, expires: Date) {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd || config.baseUrl.startsWith('https'),
    expires,
    signed: true,
  })
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: '/' })
}

async function loadUserFromSession(req: FastifyRequest): Promise<void> {
  const raw = req.cookies[SESSION_COOKIE]
  if (!raw) return
  const unsigned = req.unsignCookie(raw)
  if (!unsigned.valid || !unsigned.value) return
  const row = await one<any>(
    `SELECT s.id as session_id, s.mfa_pending, u.id, u.email, u.name, u.role, u.totp_enabled, u.disabled
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256(unsigned.value)],
  )
  if (!row || row.disabled || row.mfa_pending) return
  req.user = { id: row.id, email: row.email, name: row.name, role: row.role, totp_enabled: row.totp_enabled }
  req.sessionId = row.session_id
  req.authVia = 'session'
}

async function loadUserFromToken(req: FastifyRequest): Promise<void> {
  const h = req.headers.authorization
  if (!h || !h.startsWith('Bearer ')) return
  const token = h.slice(7).trim()
  if (!token.startsWith('qv_')) return
  const row = await one<any>(
    `SELECT t.id as token_id, u.id, u.email, u.name, u.role, u.totp_enabled, u.disabled
     FROM api_tokens t JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = $1 AND (t.expires_at IS NULL OR t.expires_at > now())`,
    [sha256(token)],
  )
  if (!row || row.disabled) return
  req.user = { id: row.id, email: row.email, name: row.name, role: row.role, totp_enabled: row.totp_enabled }
  req.authVia = 'token'
  q(`UPDATE api_tokens SET last_used_at = now() WHERE id = $1`, [row.token_id]).catch(() => {})
}

export const DEV_NO_AUTO_COOKIE = 'quiver_dev_noauto'
const LOOPBACK_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i

/**
 * Dev-only: when the app is opened on localhost and nobody is signed in, sign in as the
 * DEV_AUTO_LOGIN_EMAIL user (or the first admin). Requires a loopback client IP *and* a
 * localhost Host header, so a reverse proxy on the same machine cannot trigger it.
 * Signing out sets a cookie that pauses auto sign-in until the next manual login.
 */
async function devAutoLogin(req: FastifyRequest, reply: FastifyReply) {
  if (!config.devAutoLogin || config.isProd) return
  if (req.url.split('?')[0] !== '/api/auth/me') return
  if (!LOOPBACK_IPS.has(req.socket.remoteAddress ?? '')) return
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '')
  if (!LOCAL_HOSTS.test(host)) return
  if (req.cookies[DEV_NO_AUTO_COOKIE]) return
  const u = config.devAutoLoginEmail
    ? await one<any>('SELECT * FROM users WHERE lower(email)=lower($1) AND NOT disabled', [config.devAutoLoginEmail])
    : await one<any>("SELECT * FROM users WHERE role='admin' AND NOT disabled ORDER BY created_at LIMIT 1")
  if (!u) return
  const s = await createSession(u.id, req)
  setSessionCookie(reply, s.token, s.expires)
  req.user = { id: u.id, email: u.email, name: u.name, role: u.role, totp_enabled: u.totp_enabled }
  req.sessionId = s.id
  req.authVia = 'session'
  req.log.warn(`dev auto-login as ${u.email} (disable with DEV_AUTO_LOGIN=false)`)
}

export const authPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest('user', null)
  app.decorateRequest('sessionId', null)
  app.decorateRequest('authVia', null)
  app.addHook('onRequest', async (req, reply) => {
    req.user = null
    req.sessionId = null
    req.authVia = null
    await loadUserFromToken(req)
    if (!req.user) await loadUserFromSession(req)
    if (!req.user) await devAutoLogin(req, reply)
  })
  // CSRF: cookie-authenticated state-changing requests must come from our own origin.
  app.addHook('onRequest', async (req) => {
    if (req.authVia !== 'session') return
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return
    const origin = req.headers.origin || (req.headers.referer ? new URL(req.headers.referer).origin : '')
    const allowed = new Set([config.baseUrl.replace(/\/$/, ''), 'http://localhost:5173', 'http://localhost:4000'])
    if (!origin || !allowed.has(origin)) throw forbidden('Cross-origin request blocked')
  })
})

export function requireUser(req: FastifyRequest): AuthUser {
  if (!req.user) throw unauthorized()
  return req.user
}

export function requireAdmin(req: FastifyRequest): AuthUser {
  const u = requireUser(req)
  if (u.role !== 'admin') throw forbidden('Admin only')
  return u
}

export type WsRole = 'admin' | 'editor' | 'viewer'
const rank: Record<WsRole, number> = { viewer: 1, editor: 2, admin: 3 }

export async function workspaceRole(userId: string, workspaceId: string): Promise<WsRole | null> {
  const row = await one<{ role: WsRole }>(`SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2`, [workspaceId, userId])
  return row?.role ?? null
}

export async function requireWorkspace(req: FastifyRequest, workspaceId: string, min: WsRole = 'viewer') {
  const u = requireUser(req)
  if (u.role === 'admin') return u
  const role = await workspaceRole(u.id, workspaceId)
  if (!role || rank[role] < rank[min]) throw forbidden('Insufficient workspace permissions')
  return u
}

export async function collectionWorkspace(collectionId: string): Promise<string> {
  const row = await one<{ workspace_id: string }>(`SELECT workspace_id FROM collections WHERE id=$1`, [collectionId])
  if (!row) throw new (await import('./errors.js')).HttpError(404, 'Collection not found')
  return row.workspace_id
}

export async function requireCollection(req: FastifyRequest, collectionId: string, min: WsRole = 'viewer') {
  const ws = await collectionWorkspace(collectionId)
  const u = await requireWorkspace(req, ws, min)
  return { user: u, workspaceId: ws }
}
