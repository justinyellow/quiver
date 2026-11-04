import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { one, q } from '../db/index.js'
import { parse } from '../lib/validate.js'
import { badRequest, notFound } from '../lib/errors.js'
import { requireWorkspace } from '../lib/auth.js'
import { audit } from '../lib/audit.js'
import { buildScopes, folderChain, loadCookieJar, persistUpdatedAuth, persistVarMutations, saveCookieJar } from '../lib/loaders.js'
import { executeRequest } from '../engine/executor.js'
import type { RequestDef } from '../engine/types.js'
import { getSetting } from '../lib/settings.js'
import { interpolate, unresolvedVars } from '../engine/variables.js'
import { fetchOAuthToken, unresolvedPathVars } from '../engine/http.js'
import { randomToken } from '../lib/crypto.js'
import { config } from '../config.js'

const kv = z.object({ key: z.string(), value: z.string().default(''), enabled: z.boolean().optional(), description: z.string().optional(), type: z.enum(['text', 'file']).optional(), src: z.string().optional() })
const requestDef = z.object({
  id: z.string().uuid().optional(), name: z.string().default('Untitled'), method: z.string().min(1), url: z.string(), params: z.array(kv).default([]), headers: z.array(kv).default([]),
  body: z.object({ mode: z.string() }).passthrough().default({ mode: 'none' }), auth: z.object({ type: z.string() }).passthrough().default({ type: 'inherit' }),
  preRequestScript: z.string().optional(), testScript: z.string().optional(), settings: z.record(z.any()).optional(), description: z.string().optional(),
})
const execBody = z.object({
  request: requestDef,
  collectionId: z.string().uuid().nullable().optional(),
  folderId: z.string().uuid().nullable().optional(),
  environmentId: z.string().uuid().nullable().optional(),
  overlayEnvironmentIds: z.array(z.string().uuid()).optional(),
  persistVariables: z.boolean().default(true),
  saveHistory: z.boolean().default(true),
  localVariables: z.record(z.string()).optional(), // e.g. prompted values for unresolved vars
})

export async function guardFor() {
  const [allowPrivate, allowLoopback, blockedHosts, proxyUrl] = await Promise.all([getSetting<boolean>('allowPrivateTargets'), getSetting<boolean>('allowLoopbackTargets'), getSetting<string[]>('blockedHosts'), getSetting<string>('proxyUrl')])
  return { guard: { allowPrivate: allowPrivate ?? undefined, allowLoopback: allowLoopback ?? undefined, blockedHosts: blockedHosts ?? [] }, send: { proxyUrl: proxyUrl || undefined } }
}

export async function runSingle(req: FastifyRequest, wsId: string, body: z.infer<typeof execBody>, onChunk?: (c: Buffer) => void) {
  const u = await requireWorkspace(req, wsId)
  const def = body.request as RequestDef
  let collection: any = null
  if (body.collectionId) {
    collection = await one<any>('SELECT id, workspace_id, name, auth, pre_request_script, test_script FROM collections WHERE id=$1', [body.collectionId])
    if (!collection || collection.workspace_id !== wsId) throw badRequest('Collection does not belong to this workspace')
  }
  const { scopes, environmentName } = await buildScopes(wsId, body.collectionId ?? null, body.environmentId ?? null, body.overlayEnvironmentIds)
  if (body.localVariables) Object.assign(scopes.local, body.localVariables)
  const folders = body.folderId ? await folderChain(body.folderId) : []
  const cookies = await loadCookieJar(wsId, u.id)
  const { guard, send } = await guardFor()
  const started = Date.now()
  const result = await executeRequest(def, {
    scopes, environmentName, cookies, guard, send, onChunk,
    collection: collection ? { id: collection.id, name: collection.name, auth: collection.auth, preRequestScript: collection.pre_request_script, testScript: collection.test_script } : undefined,
    folders,
  })
  await saveCookieJar(wsId, u.id, result.cookies)
  if (body.persistVariables) await persistVarMutations(wsId, body.collectionId ?? null, body.environmentId ?? null, result.varMutations)
  if (result.updatedAuth) await persistUpdatedAuth(result.updatedAuth)
  if (body.saveHistory) {
    const resp = result.response ? { status: result.response.status, statusText: result.response.statusText, headers: result.response.headers, body: result.response.isBase64 ? '' : result.response.body.slice(0, 256 * 1024), isBase64: result.response.isBase64, contentType: result.response.contentType, size: result.response.size, timeMs: result.response.timeMs, truncated: result.response.truncated || result.response.body.length > 256 * 1024 } : null
    q(`INSERT INTO history (workspace_id, user_id, request_id, method, url, status, duration_ms, size_bytes, request, response) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [wsId, u.id, def.id ?? null, result.request.method, result.request.url.slice(0, 4000), result.response?.status ?? null, result.response?.timeMs ? Math.round(result.response.timeMs) : null, result.response?.size ?? null, JSON.stringify({ ...def, resolved: result.request, error: result.error, tests: result.tests }), resp ? JSON.stringify(resp) : null]).catch(() => {})
  }
  return { ...result, cookies: undefined, jarCookies: result.cookies.length, totalMs: Date.now() - started }
}

export async function executeRoutes(app: FastifyInstance) {
  app.post('/workspaces/:wsId/execute', async (req) => {
    const { wsId } = req.params as any
    const body = parse(execBody, req.body)
    return runSingle(req, wsId, body)
  })

  // Streaming variant (SSE): emits `chunk` events as the response body arrives (SSE / long-poll APIs), then `done`.
  app.post('/workspaces/:wsId/execute/stream', async (req, reply) => {
    const { wsId } = req.params as any
    const body = parse(execBody, req.body)
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' })
    const send = (event: string, data: any) => { reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) }
    try {
      const result = await runSingle(req, wsId, body, (c) => send('chunk', { text: c.toString('utf8') }))
      send('done', result)
    } catch (e: any) {
      send('error', { message: e?.message || String(e) })
    }
    reply.raw.end()
    return reply
  })

  // Preview resolved request (variables substituted, auth applied headers) and list unresolved variables
  app.post('/workspaces/:wsId/resolve', async (req) => {
    const { wsId } = req.params as any
    const body = parse(execBody.pick({ request: true, collectionId: true, environmentId: true, overlayEnvironmentIds: true }), req.body)
    await requireWorkspace(req, wsId)
    const { scopes } = await buildScopes(wsId, body.collectionId ?? null, body.environmentId ?? null, body.overlayEnvironmentIds)
    const r = body.request
    const texts = [r.url, ...r.headers.map((h) => h.key + h.value), ...r.params.map((p) => p.key + p.value), JSON.stringify(r.body), JSON.stringify(r.auth)]
    const unresolved = Array.from(new Set([...texts.flatMap((t) => unresolvedVars(t, scopes)), ...unresolvedPathVars(interpolate(r.url, scopes), scopes)]))
    return { url: interpolate(r.url, scopes), unresolved, variables: Object.keys({ ...scopes.globals, ...scopes.collection, ...scopes.environment }) }
  })

  // ---- history
  app.get('/workspaces/:wsId/history', async (req) => {
    const { wsId } = req.params as any
    const u = await requireWorkspace(req, wsId)
    const { limit = '100', before, q: search } = req.query as any
    const params: any[] = [wsId, u.id, Math.min(Number(limit) || 100, 500)]
    let where = 'workspace_id=$1 AND user_id=$2'
    if (before) { params.push(before); where += ` AND created_at < $${params.length}` }
    if (search) { params.push(`%${search}%`); where += ` AND (url ILIKE $${params.length} OR method ILIKE $${params.length})` }
    return q(`SELECT id, request_id, method, url, status, duration_ms, size_bytes, created_at FROM history WHERE ${where} ORDER BY created_at DESC LIMIT $3`, params)
  })
  app.get('/history/:id', async (req) => {
    const h = await one<any>('SELECT * FROM history WHERE id=$1', [(req.params as any).id])
    if (!h) throw notFound()
    const u = await requireWorkspace(req, h.workspace_id)
    if (h.user_id !== u.id && u.role !== 'admin') throw notFound()
    return h
  })
  app.delete('/workspaces/:wsId/history', async (req) => {
    const { wsId } = req.params as any
    const u = await requireWorkspace(req, wsId)
    await q('DELETE FROM history WHERE workspace_id=$1 AND user_id=$2', [wsId, u.id])
    return { ok: true }
  })
  app.delete('/history/:id', async (req) => {
    const h = await one<any>('SELECT * FROM history WHERE id=$1', [(req.params as any).id])
    if (!h) throw notFound()
    const u = await requireWorkspace(req, h.workspace_id)
    if (h.user_id !== u.id) throw notFound()
    await q('DELETE FROM history WHERE id=$1', [h.id])
    return { ok: true }
  })

  // ---- OAuth2 authorization code flow (browser redirect based)
  // 1. POST /oauth2/authorize -> returns URL to open; 2. provider redirects to /api/oauth2/callback; 3. client polls GET /oauth2/result/:state
  const pending = new Map<string, { createdAt: number; wsId: string; userId: string; cfg: any; verifier?: string; result?: any }>()
  setInterval(() => { const now = Date.now(); for (const [k, v] of pending) if (now - v.createdAt > 10 * 60 * 1000) pending.delete(k) }, 60000).unref()
  app.post('/workspaces/:wsId/oauth2/authorize', async (req) => {
    const { wsId } = req.params as any
    const u = await requireWorkspace(req, wsId)
    const body = parse(z.object({ authUrl: z.string().url(), accessTokenUrl: z.string().url().optional(), clientId: z.string(), clientSecret: z.string().optional(), scope: z.string().optional(), audience: z.string().optional(), usePkce: z.boolean().default(true), clientAuth: z.enum(['header', 'body']).default('header'), grantType: z.enum(['authorization_code', 'implicit']).default('authorization_code'), extraParams: z.record(z.string()).optional() }), req.body)
    const state = randomToken(16)
    const redirectUri = config.baseUrl.replace(/\/$/, '') + '/api/oauth2/callback'
    const url = new URL(body.authUrl)
    url.searchParams.set('response_type', body.grantType === 'implicit' ? 'token' : 'code')
    url.searchParams.set('client_id', body.clientId)
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('state', state)
    if (body.scope) url.searchParams.set('scope', body.scope)
    if (body.audience) url.searchParams.set('audience', body.audience)
    for (const [k, v] of Object.entries(body.extraParams ?? {})) url.searchParams.set(k, v)
    let verifier: string | undefined
    if (body.usePkce && body.grantType === 'authorization_code') {
      verifier = randomToken(48)
      const { createHash } = await import('node:crypto')
      url.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'))
      url.searchParams.set('code_challenge_method', 'S256')
    }
    pending.set(state, { createdAt: Date.now(), wsId, userId: u.id, cfg: { ...body, redirectUri }, verifier })
    return { url: url.toString(), state, redirectUri }
  })
  app.get('/oauth2/callback', async (req, reply) => {
    const qs = req.query as any
    const state = qs.state
    const p = state ? pending.get(state) : undefined
    const page = (msg: string, ok: boolean) => `<!doctype html><html><body style="font-family:system-ui;padding:40px;text-align:center"><h2>${ok ? 'Authorization complete' : 'Authorization failed'}</h2><p>${msg}</p><script>setTimeout(()=>window.close(),1500)</script></body></html>`
    reply.type('text/html')
    if (!p) return page('Unknown or expired state. Close this window and try again.', false)
    if (qs.error) { p.result = { error: qs.error_description || qs.error }; return page(String(qs.error_description || qs.error), false) }
    if (p.cfg.grantType === 'implicit') {
      // token is in the fragment; a tiny script posts it back
      return `<!doctype html><html><body><script>const h=new URLSearchParams(location.hash.slice(1));fetch('/api/oauth2/implicit?state=${state}',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.fromEntries(h))}).then(()=>{document.body.innerHTML='<p style="font-family:system-ui;padding:40px">Authorization complete. You can close this window.</p>';setTimeout(()=>window.close(),1500)})</script></body></html>`
    }
    if (!qs.code) return page('Missing code', false)
    try {
      const params: Record<string, string> = { grant_type: 'authorization_code', code: qs.code, redirect_uri: p.cfg.redirectUri }
      if (p.verifier) params.code_verifier = p.verifier
      const { guard } = await guardFor()
      const tok = await fetchOAuthToken({ url: p.cfg.accessTokenUrl, clientId: p.cfg.clientId, clientSecret: p.cfg.clientSecret ?? '', clientAuth: p.cfg.clientAuth, params }, guard)
      if (!tok.access_token) { p.result = { error: 'Token exchange failed: ' + JSON.stringify(tok).slice(0, 300) }; return page(p.result.error, false) }
      p.result = { accessToken: tok.access_token, refreshToken: tok.refresh_token, expiresIn: tok.expires_in, tokenType: tok.token_type, scope: tok.scope, idToken: tok.id_token, raw: tok }
      return page('You can close this window and return to Quiver.', true)
    } catch (e: any) { p.result = { error: e.message }; return page(e.message, false) }
  })
  app.post('/oauth2/implicit', async (req) => {
    const state = (req.query as any).state
    const p = state ? pending.get(state) : undefined
    if (!p) throw notFound()
    const b: any = req.body ?? {}
    p.result = b.access_token ? { accessToken: b.access_token, expiresIn: b.expires_in, tokenType: b.token_type, scope: b.scope, raw: b } : { error: b.error_description || b.error || 'No token in response' }
    return { ok: true }
  })
  app.get('/oauth2/result/:state', async (req) => {
    const { state } = req.params as any
    const p = pending.get(state)
    if (!p) throw notFound()
    if (p.userId !== req.user?.id) throw notFound()
    if (!p.result) return { pending: true }
    pending.delete(state)
    audit(req, 'oauth2.token_obtained', { workspaceId: p.wsId, meta: { ok: !p.result.error } })
    return { pending: false, ...p.result }
  })
  // Client credentials / password / refresh: get a token now (used by "Get New Access Token" button)
  app.post('/workspaces/:wsId/oauth2/token', async (req) => {
    const { wsId } = req.params as any
    await requireWorkspace(req, wsId)
    const body = parse(z.object({ accessTokenUrl: z.string().url(), clientId: z.string().default(''), clientSecret: z.string().default(''), clientAuth: z.enum(['header', 'body']).default('header'), params: z.record(z.string()) }), req.body)
    const { guard } = await guardFor()
    const tok = await fetchOAuthToken({ url: body.accessTokenUrl, clientId: body.clientId, clientSecret: body.clientSecret, clientAuth: body.clientAuth, params: body.params }, guard)
    if (!tok.access_token) throw badRequest('Token request failed', tok)
    return { accessToken: tok.access_token, refreshToken: tok.refresh_token, expiresIn: tok.expires_in, tokenType: tok.token_type, scope: tok.scope, raw: tok }
  })
}
