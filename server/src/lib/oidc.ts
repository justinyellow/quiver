import type { FastifyReply, FastifyRequest } from 'fastify'
import * as client from 'openid-client'
import { config } from '../config.js'
import { one, tx } from '../db/index.js'
import { badRequest, forbidden } from './errors.js'
import { createPersonalWorkspace } from './workspace.js'

let cfgP: Promise<client.Configuration> | null = null
function getConfig() {
  return (cfgP ??= client.discovery(new URL(config.oidc.issuer), config.oidc.clientId, config.oidc.clientSecret))
}
const redirectUri = () => config.baseUrl.replace(/\/$/, '') + '/api/auth/oidc/callback'

export async function oidcStart(reply: FastifyReply): Promise<string> {
  const c = await getConfig()
  const verifier = client.randomPKCECodeVerifier()
  const challenge = await client.calculatePKCECodeChallenge(verifier)
  const state = client.randomState()
  reply.setCookie('quiver_oidc', JSON.stringify({ verifier, state }), { path: '/api/auth/oidc', httpOnly: true, sameSite: 'lax', secure: config.baseUrl.startsWith('https'), maxAge: 600, signed: true })
  const url = client.buildAuthorizationUrl(c, { redirect_uri: redirectUri(), scope: 'openid email profile', code_challenge: challenge, code_challenge_method: 'S256', state })
  return url.href
}

export async function oidcCallback(req: FastifyRequest, reply: FastifyReply): Promise<string> {
  const c = await getConfig()
  const raw = req.cookies['quiver_oidc']
  const un = raw ? req.unsignCookie(raw) : null
  if (!un?.valid || !un.value) throw badRequest('OIDC state cookie missing')
  const { verifier, state } = JSON.parse(un.value)
  reply.clearCookie('quiver_oidc', { path: '/api/auth/oidc' })
  const current = new URL(req.url, config.baseUrl)
  const tokens = await client.authorizationCodeGrant(c, current, { pkceCodeVerifier: verifier, expectedState: state })
  const claims = tokens.claims()
  if (!claims?.sub) throw badRequest('OIDC response missing subject')
  const email = String(claims.email ?? '').toLowerCase()
  const name = String(claims.name ?? claims.preferred_username ?? email ?? claims.sub)
  let user = await one<any>('SELECT * FROM users WHERE oidc_subject=$1', [claims.sub])
  if (!user && email) {
    user = await one<any>('SELECT * FROM users WHERE lower(email)=$1', [email])
    if (user) await one('UPDATE users SET oidc_subject=$1 WHERE id=$2', [claims.sub, user.id])
  }
  if (!user) {
    if (!config.oidc.autoProvision) throw forbidden('No account for this identity. Ask an admin to invite you.')
    if (!email) throw badRequest('OIDC identity has no email claim')
    user = await tx(async (cl) => {
      const u = (await cl.query(`INSERT INTO users (email, name, role, oidc_subject) VALUES ($1,$2,'user',$3) RETURNING *`, [email, name, claims.sub])).rows[0]
      await createPersonalWorkspace(cl, u.id)
      return u
    })
  }
  if (user.disabled) throw forbidden('Account disabled')
  await one('UPDATE users SET last_login_at=now() WHERE id=$1', [user.id])
  return user.id
}
