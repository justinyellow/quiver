import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticator } from 'otplib'
import { one, q, tx } from '../db/index.js'
import { config } from '../config.js'
import { parse } from '../lib/validate.js'
import { badRequest, forbidden, notFound, unauthorized } from '../lib/errors.js'
import { clearSessionCookie, createSession, hashPassword, requireUser, setSessionCookie, verifyPassword, SESSION_COOKIE, DEV_NO_AUTO_COOKIE } from '../lib/auth.js'
import { decrypt, encrypt, randomToken, sha256 } from '../lib/crypto.js'
import { audit } from '../lib/audit.js'
import { getSetting } from '../lib/settings.js'
import { createPersonalWorkspace } from '../lib/workspace.js'
import { getProvider, publicProviders, ssoCallback, ssoStart, SsoDenied } from '../lib/sso.js'
import { passwordLoginEnabled } from '../lib/sso-config.js'

const credentials = z.object({ email: z.string().email().max(200), password: z.string().min(10).max(200), name: z.string().min(1).max(100).optional() })

export async function authRoutes(app: FastifyInstance) {
  app.get('/auth/status', async () => {
    const count = await one<{ c: string }>('SELECT count(*)::text as c FROM users')
    const allowSignup = (await getSetting<boolean>('allowSignup')) ?? config.allowSignup
    return { needsSetup: count!.c === '0', allowSignup, providers: publicProviders(), passwordLogin: passwordLoginEnabled() }
  })

  // First-run setup creates the initial admin; afterwards signup is gated by settings.
  app.post('/auth/register', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parse(credentials.extend({ invite: z.string().optional() }), req.body)
    const count = Number((await one<{ c: string }>('SELECT count(*)::text as c FROM users'))!.c)
    const allowSignup = (await getSetting<boolean>('allowSignup')) ?? config.allowSignup
    let invite: any = null
    if (body.invite) {
      invite = await one(`SELECT * FROM invites WHERE token_hash=$1 AND accepted_at IS NULL AND expires_at > now()`, [sha256(body.invite)])
      if (!invite) throw badRequest('Invite is invalid or expired')
      if (invite.email.toLowerCase() !== body.email.toLowerCase()) throw badRequest('Invite was issued for a different email address')
    }
    if (count > 0 && !passwordLoginEnabled()) throw forbidden('Password accounts are disabled. Use single sign-on.')
    if (count > 0 && !allowSignup && !invite) throw forbidden('Self-signup is disabled. Ask an admin for an invite.')
    const existing = await one('SELECT id FROM users WHERE lower(email)=lower($1)', [body.email])
    if (existing) throw badRequest('An account with this email already exists')
    const role = count === 0 ? 'admin' : invite?.role ?? 'user'
    const user = await tx(async (c) => {
      const u = (await c.query(`INSERT INTO users (email, name, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id, email, name, role`, [body.email.toLowerCase(), body.name || body.email.split('@')[0], await hashPassword(body.password), role])).rows[0]
      await createPersonalWorkspace(c, u.id)
      if (invite) {
        await c.query(`UPDATE invites SET accepted_at=now() WHERE id=$1`, [invite.id])
        if (invite.workspace_id) await c.query(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [invite.workspace_id, u.id, invite.workspace_role || 'editor'])
      }
      return u
    })
    const s = await createSession(user.id, req)
    setSessionCookie(reply, s.token, s.expires)
    reply.clearCookie(DEV_NO_AUTO_COOKIE, { path: '/' })
    audit(req, 'user.register', { entityType: 'user', entityId: user.id, meta: { role } })
    return { user }
  })

  app.post('/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!passwordLoginEnabled()) throw forbidden('Password sign-in is disabled. Use single sign-on.')
    const body = parse(z.object({ email: z.string().email(), password: z.string().min(1), totp: z.string().optional() }), req.body)
    const u = await one<any>('SELECT * FROM users WHERE lower(email)=lower($1)', [body.email])
    const ok = u?.password_hash ? await verifyPassword(u.password_hash, body.password) : false
    if (!u || !ok) { audit(req, 'user.login_failed', { meta: { email: body.email } }); throw unauthorized('Invalid email or password') }
    if (u.disabled) throw forbidden('Account disabled')
    if (u.totp_enabled) {
      if (!body.totp) {
        return reply.code(200).send({ mfaRequired: true })
      }
      if (!authenticator.check(body.totp, decrypt(u.totp_secret))) throw unauthorized('Invalid two-factor code')
    }
    const s = await createSession(u.id, req)
    setSessionCookie(reply, s.token, s.expires)
    reply.clearCookie(DEV_NO_AUTO_COOKIE, { path: '/' })
    await q('UPDATE users SET last_login_at=now() WHERE id=$1', [u.id])
    audit(req, 'user.login', { entityType: 'user', entityId: u.id })
    return { user: { id: u.id, email: u.email, name: u.name, role: u.role, totp_enabled: u.totp_enabled } }
  })

  app.post('/auth/logout', async (req, reply) => {
    if (req.sessionId) await q('DELETE FROM sessions WHERE id=$1', [req.sessionId])
    clearSessionCookie(reply)
    if (config.devAutoLogin) reply.setCookie(DEV_NO_AUTO_COOKIE, '1', { path: '/', httpOnly: true, sameSite: 'lax' })
    return { ok: true }
  })

  app.get('/auth/me', async (req) => {
    const u = requireUser(req)
    const workspaces = await q(`SELECT w.id, w.name, w.type, m.role FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id WHERE m.user_id=$1 ORDER BY w.type DESC, w.name`, [u.id])
    const all = u.role === 'admin' ? await q(`SELECT w.id, w.name, w.type, 'admin' as role FROM workspaces w WHERE w.type='team' AND w.id NOT IN (SELECT workspace_id FROM workspace_members WHERE user_id=$1) ORDER BY w.name`, [u.id]) : []
    return { user: u, workspaces: [...workspaces, ...all], authVia: req.authVia }
  })

  app.post('/auth/password', async (req) => {
    const u = requireUser(req)
    const body = parse(z.object({ current: z.string(), next: z.string().min(10).max(200) }), req.body)
    const row = await one<any>('SELECT password_hash FROM users WHERE id=$1', [u.id])
    if (row?.password_hash && !(await verifyPassword(row.password_hash, body.current))) throw unauthorized('Current password is incorrect')
    await q('UPDATE users SET password_hash=$1 WHERE id=$2', [await hashPassword(body.next), u.id])
    await q('DELETE FROM sessions WHERE user_id=$1 AND id<>$2', [u.id, req.sessionId])
    audit(req, 'user.password_changed', { entityType: 'user', entityId: u.id })
    return { ok: true }
  })

  app.patch('/auth/profile', async (req) => {
    const u = requireUser(req)
    const body = parse(z.object({ name: z.string().min(1).max(100) }), req.body)
    await q('UPDATE users SET name=$1 WHERE id=$2', [body.name, u.id])
    return { ok: true }
  })

  // ---- TOTP two-factor
  app.post('/auth/totp/setup', async (req) => {
    const u = requireUser(req)
    const secret = authenticator.generateSecret()
    await q('UPDATE users SET totp_secret=$1, totp_enabled=false WHERE id=$2', [encrypt(secret), u.id])
    const otpauth = authenticator.keyuri(u.email, 'Quiver', secret)
    return { secret, otpauth }
  })
  app.post('/auth/totp/enable', async (req) => {
    const u = requireUser(req)
    const body = parse(z.object({ code: z.string() }), req.body)
    const row = await one<any>('SELECT totp_secret FROM users WHERE id=$1', [u.id])
    if (!row?.totp_secret) throw badRequest('Run setup first')
    if (!authenticator.check(body.code, decrypt(row.totp_secret))) throw badRequest('Invalid code')
    await q('UPDATE users SET totp_enabled=true WHERE id=$1', [u.id])
    audit(req, 'user.totp_enabled', { entityType: 'user', entityId: u.id })
    return { ok: true }
  })
  app.post('/auth/totp/disable', async (req) => {
    const u = requireUser(req)
    const body = parse(z.object({ password: z.string() }), req.body)
    const row = await one<any>('SELECT password_hash FROM users WHERE id=$1', [u.id])
    if (row?.password_hash && !(await verifyPassword(row.password_hash, body.password))) throw unauthorized('Password is incorrect')
    await q('UPDATE users SET totp_enabled=false, totp_secret=NULL WHERE id=$1', [u.id])
    audit(req, 'user.totp_disabled', { entityType: 'user', entityId: u.id })
    return { ok: true }
  })

  // ---- sessions
  app.get('/auth/sessions', async (req) => {
    const u = requireUser(req)
    return q('SELECT id, created_at, expires_at, ip, user_agent, (id=$2) as current FROM sessions WHERE user_id=$1 AND expires_at > now() ORDER BY created_at DESC', [u.id, req.sessionId])
  })
  app.delete('/auth/sessions/:id', async (req) => {
    const u = requireUser(req)
    await q('DELETE FROM sessions WHERE id=$1 AND user_id=$2', [(req.params as any).id, u.id])
    return { ok: true }
  })

  // ---- API tokens (for CLI / CI)
  app.get('/auth/tokens', async (req) => {
    const u = requireUser(req)
    return q('SELECT id, name, token_prefix, created_at, expires_at, last_used_at FROM api_tokens WHERE user_id=$1 ORDER BY created_at DESC', [u.id])
  })
  app.post('/auth/tokens', async (req) => {
    const u = requireUser(req)
    if (req.authVia === 'token') throw forbidden('Tokens cannot mint tokens')
    const body = parse(z.object({ name: z.string().min(1).max(100), expiresInDays: z.number().int().min(1).max(3650).optional() }), req.body)
    const token = 'qv_' + randomToken(32)
    const expires = body.expiresInDays ? new Date(Date.now() + body.expiresInDays * 86400000) : null
    const row = await one(`INSERT INTO api_tokens (user_id, name, token_prefix, token_hash, expires_at) VALUES ($1,$2,$3,$4,$5) RETURNING id, name, token_prefix, created_at, expires_at`, [u.id, body.name, token.slice(0, 10), sha256(token), expires])
    audit(req, 'token.create', { entityType: 'api_token', entityId: row!.id })
    return { ...row, token }
  })
  app.delete('/auth/tokens/:id', async (req) => {
    const u = requireUser(req)
    await q('DELETE FROM api_tokens WHERE id=$1 AND user_id=$2', [(req.params as any).id, u.id])
    audit(req, 'token.delete', { entityType: 'api_token', entityId: (req.params as any).id })
    return { ok: true }
  })

  // ---- invites
  app.post('/auth/invites/accept-info', async (req) => {
    const body = parse(z.object({ invite: z.string() }), req.body)
    const inv = await one<any>(`SELECT email, role, expires_at FROM invites WHERE token_hash=$1 AND accepted_at IS NULL AND expires_at > now()`, [sha256(body.invite)])
    if (!inv) throw notFound('Invite is invalid or expired')
    return inv
  })

  // ---- single sign-on (Google / Cognito / OIDC)
  app.get('/auth/sso/:provider/start', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const p = getProvider((req.params as any).provider)
    if (!p) throw notFound('Sign-in provider not configured')
    try { return reply.redirect(await ssoStart(p, reply)) }
    catch (e: any) { req.log.error(e); return reply.redirect('/login?sso_error=' + encodeURIComponent(`${p.label} is unreachable: ${e.message}`)) }
  })
  app.get('/auth/sso/:provider/callback', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const p = getProvider((req.params as any).provider)
    if (!p) throw notFound('Sign-in provider not configured')
    try {
      const userId = await ssoCallback(p, req, reply)
      const s = await createSession(userId, req)
      setSessionCookie(reply, s.token, s.expires)
      reply.clearCookie(DEV_NO_AUTO_COOKIE, { path: '/' })
      req.user = { id: userId } as any
      audit(req, 'user.login', { entityType: 'user', entityId: userId, meta: { via: p.id } })
      return reply.redirect('/')
    } catch (e: any) {
      const msg = e instanceof SsoDenied ? e.message : `Sign-in with ${p.label} failed.`
      if (!(e instanceof SsoDenied)) req.log.error(e)
      audit(req, 'user.login_failed', { meta: { via: p.id, reason: e.message } })
      return reply.redirect('/login?sso_error=' + encodeURIComponent(msg))
    }
  })
  app.get('/auth/identities', async (req) => {
    const u = requireUser(req)
    return q('SELECT provider, email, created_at, last_login_at FROM user_identities WHERE user_id=$1 ORDER BY created_at', [u.id])
  })
  void SESSION_COOKIE
}
