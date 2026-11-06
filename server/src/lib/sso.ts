import type { FastifyReply, FastifyRequest } from 'fastify'
import * as client from 'openid-client'
import { config } from '../config.js'
import { one, q, tx } from '../db/index.js'
import { HttpError } from './errors.js'
import { createPersonalWorkspace } from './workspace.js'
import { evaluateClaims, loadProviders, ssoDefaultWorkspace, type ProviderKind, type SsoProvider } from './sso-config.js'

export const providers: SsoProvider[] = loadProviders()
export const getProvider = (id: string) => providers.find((p) => p.id === id)
export const publicProviders = () => providers.map((p) => ({ id: p.id, label: p.label }))

const discovered = new Map<string, Promise<client.Configuration>>()
function configFor(p: SsoProvider): Promise<client.Configuration> {
  let c = discovered.get(p.id)
  if (!c) {
    const insecure = p.issuer.startsWith('http://')
    if (insecure && config.isProd) throw new HttpError(500, `${p.label}: issuer must use https`)
    // Public clients (no secret, e.g. Cognito user clients) authenticate with PKCE only.
    const auth = p.clientSecret ? client.ClientSecretBasic(p.clientSecret) : client.None()
    c = client.discovery(new URL(p.issuer), p.clientId, undefined, auth, insecure ? { execute: [client.allowInsecureRequests] } : undefined)
    c.catch(() => discovered.delete(p.id))
    discovered.set(p.id, c)
  }
  return c
}

const redirectUri = (id: ProviderKind) => `${config.baseUrl.replace(/\/$/, '')}/api/auth/sso/${id}/callback`
const STATE_COOKIE = 'quiver_sso'

export async function ssoStart(p: SsoProvider, reply: FastifyReply): Promise<string> {
  const c = await configFor(p)
  const verifier = client.randomPKCECodeVerifier()
  const state = client.randomState()
  const nonce = client.randomNonce()
  reply.setCookie(STATE_COOKIE, JSON.stringify({ p: p.id, verifier, state, nonce }), { path: '/api/auth/sso', httpOnly: true, sameSite: 'lax', secure: config.baseUrl.startsWith('https'), maxAge: 600, signed: true })
  return client.buildAuthorizationUrl(c, {
    redirect_uri: redirectUri(p.id), scope: p.scopes, state, nonce,
    code_challenge: await client.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256',
    ...p.authParams,
  }).href
}

export class SsoDenied extends Error {}

/** Completes the code flow, applies the sign-in policy, and returns the Quiver user id. */
export async function ssoCallback(p: SsoProvider, req: FastifyRequest, reply: FastifyReply): Promise<string> {
  const raw = req.cookies[STATE_COOKIE]
  const un = raw ? req.unsignCookie(raw) : null
  reply.clearCookie(STATE_COOKIE, { path: '/api/auth/sso' })
  if (!un?.valid || !un.value) throw new SsoDenied('Sign-in session expired. Please try again.')
  const st = JSON.parse(un.value)
  if (st.p !== p.id) throw new SsoDenied('Sign-in started with a different provider. Please try again.')
  const qs = req.query as any
  if (qs?.error) throw new SsoDenied(String(qs.error_description || qs.error))
  const c = await configFor(p)
  const current = new URL(req.url, config.baseUrl)
  const tokens = await client.authorizationCodeGrant(c, current, { pkceCodeVerifier: st.verifier, expectedState: st.state, expectedNonce: st.nonce, idTokenExpected: true })
  let claims: Record<string, any> = { ...(tokens.claims() ?? {}) }
  if (!claims.email && tokens.access_token) {
    try { claims = { ...(await client.fetchUserInfo(c, tokens.access_token, String(claims.sub))), ...claims } } catch { /* id_token claims are enough when userinfo is unavailable */ }
  }
  const sub = String(claims.sub ?? '')
  if (!sub) throw new SsoDenied(`${p.label} did not return a subject identifier.`)
  const d = evaluateClaims(p, claims)
  if (!d.ok) throw new SsoDenied(d.reason)

  // 1) known identity  2) existing account with the same (verified/trusted) email  3) provision
  let user = await one<any>('SELECT u.* FROM user_identities i JOIN users u ON u.id = i.user_id WHERE i.provider=$1 AND i.subject=$2', [p.id, sub])
  if (!user) {
    user = await one<any>('SELECT * FROM users WHERE lower(email)=$1', [d.email])
    if (!user) {
      if (!d.mayProvision) throw new SsoDenied(p.autoProvision ? 'No Quiver account exists for this address. Ask an admin for an invite.' : 'Automatic sign-up is disabled. Ask an admin for an invite.')
      user = await tx(async (cl) => {
        const count = Number((await cl.query('SELECT count(*) FROM users')).rows[0].count)
        const role = count === 0 || d.isAdmin ? 'admin' : 'user'
        const u = (await cl.query(`INSERT INTO users (email, name, role) VALUES ($1,$2,$3) RETURNING *`, [d.email, d.name, role])).rows[0]
        await createPersonalWorkspace(cl, u.id)
        const dw = ssoDefaultWorkspace()
        if (dw.name) {
          let ws = (await cl.query(`SELECT id FROM workspaces WHERE type='team' AND name=$1 ORDER BY created_at LIMIT 1`, [dw.name])).rows[0]
          if (!ws) {
            ws = (await cl.query(`INSERT INTO workspaces (name, type, created_by) VALUES ($1,'team',$2) RETURNING id`, [dw.name, u.id])).rows[0]
            await cl.query(`INSERT INTO environments (workspace_id, name, is_global) VALUES ($1,'Globals',true)`, [ws.id])
          }
          await cl.query(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [ws.id, u.id, dw.role])
        }
        return u
      })
    }
    await q(`INSERT INTO user_identities (provider, subject, user_id, email) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [p.id, sub, user.id, d.email])
  }
  if (user.disabled) throw new SsoDenied('This account is disabled.')
  await q(`UPDATE user_identities SET last_login_at=now(), email=$3, groups=$4 WHERE provider=$1 AND subject=$2`, [p.id, sub, d.email, JSON.stringify(d.groups)])

  // Keep the instance role in sync with IdP groups when admin groups are configured (never demote the last admin).
  if (d.isAdmin !== null) {
    const want = d.isAdmin ? 'admin' : 'user'
    if (want !== user.role) {
      const admins = Number((await one<any>(`SELECT count(*) FROM users WHERE role='admin' AND NOT disabled`))!.count)
      if (want === 'admin' || admins > 1) await q('UPDATE users SET role=$1 WHERE id=$2', [want, user.id])
    }
  }
  await q('UPDATE users SET last_login_at=now() WHERE id=$1', [user.id])
  return user.id
}
