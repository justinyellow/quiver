import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { one, q } from '../db/index.js'
import { parse } from '../lib/validate.js'
import { notFound } from '../lib/errors.js'
import { requireCollection, requireWorkspace } from '../lib/auth.js'
import { audit } from '../lib/audit.js'
import { randomToken, sha256 } from '../lib/crypto.js'
import { loadTree } from '../lib/loaders.js'
import { interpolate } from '../engine/variables.js'
import { emptyScopes } from '../engine/variables.js'

const mockBody = z.object({ name: z.string().min(1).max(200), collectionId: z.string().uuid(), enabled: z.boolean().optional(), delayMs: z.number().int().min(0).max(60000).optional(), requireKey: z.boolean().optional() })

export async function mockRoutes(app: FastifyInstance) {
  app.get('/workspaces/:wsId/mocks', async (req) => {
    const { wsId } = req.params as any
    await requireWorkspace(req, wsId)
    return q(`SELECT m.id, m.name, m.slug, m.enabled, m.delay_ms, m.collection_id, m.created_at, (m.key_hash IS NOT NULL) as require_key, c.name as collection_name, (SELECT count(*) FROM mock_logs WHERE mock_id=m.id)::int as call_count FROM mocks m JOIN collections c ON c.id=m.collection_id WHERE m.workspace_id=$1 ORDER BY m.name`, [wsId])
  })
  app.post('/workspaces/:wsId/mocks', async (req) => {
    const { wsId } = req.params as any
    await requireWorkspace(req, wsId, 'editor')
    const body = parse(mockBody, req.body)
    await requireCollection(req, body.collectionId)
    const slug = randomToken(9).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || randomToken(8)
    const key = body.requireKey ? 'mk_' + randomToken(24) : null
    const row = await one<any>(`INSERT INTO mocks (workspace_id, collection_id, name, slug, enabled, delay_ms, key_hash) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, name, slug, enabled, delay_ms, collection_id`, [wsId, body.collectionId, body.name, slug, body.enabled ?? true, body.delayMs ?? 0, key ? sha256(key) : null])
    audit(req, 'mock.create', { workspaceId: wsId, entityType: 'mock', entityId: row.id, meta: { name: body.name } })
    return { ...row, key }
  })
  app.patch('/mocks/:id', async (req) => {
    const m = await one<any>('SELECT * FROM mocks WHERE id=$1', [(req.params as any).id])
    if (!m) throw notFound()
    await requireWorkspace(req, m.workspace_id, 'editor')
    const body = parse(mockBody.partial().extend({ rotateKey: z.boolean().optional() }), req.body)
    let key: string | null | undefined
    let keyHash: string | null | undefined
    if (body.requireKey === false) { keyHash = null }
    else if (body.rotateKey || (body.requireKey && !m.key_hash)) { key = 'mk_' + randomToken(24); keyHash = sha256(key) }
    await q(`UPDATE mocks SET name=COALESCE($1,name), collection_id=COALESCE($2,collection_id), enabled=COALESCE($3,enabled), delay_ms=COALESCE($4,delay_ms), key_hash=CASE WHEN $5::boolean THEN $6 ELSE key_hash END WHERE id=$7`, [body.name ?? null, body.collectionId ?? null, body.enabled ?? null, body.delayMs ?? null, keyHash !== undefined, keyHash ?? null, m.id])
    audit(req, 'mock.update', { workspaceId: m.workspace_id, entityType: 'mock', entityId: m.id })
    const row = await one<any>('SELECT id, name, slug, enabled, delay_ms, collection_id, (key_hash IS NOT NULL) as require_key FROM mocks WHERE id=$1', [m.id])
    return { ...row, key }
  })
  app.delete('/mocks/:id', async (req) => {
    const m = await one<any>('SELECT * FROM mocks WHERE id=$1', [(req.params as any).id])
    if (!m) throw notFound()
    await requireWorkspace(req, m.workspace_id, 'editor')
    await q('DELETE FROM mocks WHERE id=$1', [m.id])
    audit(req, 'mock.delete', { workspaceId: m.workspace_id, entityType: 'mock', entityId: m.id, meta: { name: m.name } })
    return { ok: true }
  })
  app.get('/mocks/:id/logs', async (req) => {
    const m = await one<any>('SELECT * FROM mocks WHERE id=$1', [(req.params as any).id])
    if (!m) throw notFound()
    await requireWorkspace(req, m.workspace_id)
    return q('SELECT * FROM mock_logs WHERE mock_id=$1 ORDER BY created_at DESC LIMIT 200', [m.id])
  })
}

// ---- public mock server: ANY /mock/:slug/*
interface MockRoute { method: string; pathPattern: RegExp; segments: number; example: any; request: any; params: string[] }

const cache = new Map<string, { at: number; routes: MockRoute[] }>()
export function invalidateMockCache() { cache.clear() }

async function routesFor(collectionId: string): Promise<MockRoute[]> {
  const c = cache.get(collectionId)
  if (c && Date.now() - c.at < 10_000) return c.routes
  const tree = await loadTree(collectionId, true)
  const routes: MockRoute[] = []
  const walk = (folders: any[], requests: any[]) => {
    for (const r of requests) {
      for (const e of r.examples ?? []) {
        const url = (e.request?.url || r.url || '') as string
        const path = extractPath(url)
        const { re, params } = pathToRegex(path)
        routes.push({ method: (e.request?.method || r.method || 'GET').toUpperCase(), pathPattern: re, segments: path.split('/').filter(Boolean).length, example: e, request: r, params })
      }
    }
    for (const f of folders) walk(f.folders, f.requests)
  }
  walk(tree.folders, tree.requests)
  cache.set(collectionId, { at: Date.now(), routes })
  return routes
}

function extractPath(url: string): string {
  // strip protocol+host (which may be {{baseUrl}}) and query
  let u = url.trim().replace(/^\{\{[^}]+\}\}/, 'http://x').replace(/\{\{[^}]+\}\}/g, ':var')
  u = u.replace(/^[a-z]+:\/\/[^/]+/i, '')
  u = u.split('?')[0].split('#')[0]
  if (!u.startsWith('/')) u = '/' + u
  return u.replace(/\/+$/, '') || '/'
}
function pathToRegex(path: string): { re: RegExp; params: string[] } {
  const params: string[] = []
  const src = path.split('/').map((seg) => {
    if (!seg) return ''
    if (seg.startsWith(':')) { params.push(seg.slice(1)); return '([^/]+)' }
    if (seg.startsWith('{') && seg.endsWith('}')) { params.push(seg.slice(1, -1)); return '([^/]+)' }
    if (seg === '*') return '.*'
    return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }).join('/')
  return { re: new RegExp('^' + (src || '/') + '/?$', 'i'), params }
}

export async function mockServer(app: FastifyInstance) {
  app.all('/mock/:slug', handler)
  app.all('/mock/:slug/*', handler)
  async function handler(req: any, reply: any) {
    const slug = req.params.slug
    const m = await one<any>('SELECT * FROM mocks WHERE slug=$1', [slug])
    if (!m || !m.enabled) return reply.code(404).send({ error: 'Mock server not found' })
    if (m.key_hash) {
      const key = req.headers['x-mock-key'] || req.headers['x-api-key'] || (req.query as any)?.key
      if (!key || sha256(String(key)) !== m.key_hash) return reply.code(401).send({ error: 'Missing or invalid x-mock-key' })
    }
    const path = '/' + (req.params['*'] ?? '')
    const routes = await routesFor(m.collection_id)
    const method = req.method.toUpperCase()
    const wantName = req.headers['x-mock-response-name']
    const wantCode = req.headers['x-mock-response-code']
    let candidates = routes.filter((r) => r.method === method && r.pathPattern.test(path))
    if (!candidates.length) candidates = routes.filter((r) => r.pathPattern.test(path))
    if (wantName) candidates = candidates.filter((r) => r.example.name === wantName).concat(candidates)
    if (wantCode) candidates = candidates.filter((r) => String(r.example.status) === String(wantCode)).concat(candidates)
    // prefer exact (fewest wildcards) matches
    candidates.sort((a, b) => a.params.length - b.params.length)
    const hit = candidates[0]
    if (!hit) {
      q('INSERT INTO mock_logs (mock_id, method, path, status) VALUES ($1,$2,$3,404)', [m.id, method, path]).catch(() => {})
      return reply.code(404).send({ error: `No example matches ${method} ${path}`, hint: 'Add a saved example to the request in this collection.' })
    }
    if (m.delay_ms) await new Promise((r) => setTimeout(r, m.delay_ms))
    const ex = hit.example
    const match = path.match(hit.pathPattern)
    const scopes = emptyScopes()
    hit.params.forEach((p, i) => { scopes.local[p] = match?.[i + 1] ?? '' })
    for (const [k, v] of Object.entries(req.query ?? {})) scopes.local['query.' + k] = String(v)
    scopes.local['$body'] = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? '')
    q('INSERT INTO mock_logs (mock_id, method, path, matched_example_id, status) VALUES ($1,$2,$3,$4,$5)', [m.id, method, path, ex.id, ex.status]).catch(() => {})
    reply.code(ex.status || 200)
    let hasCt = false
    for (const h of ex.headers ?? []) { if (h.enabled === false || !h.key) continue; if (/^(content-length|transfer-encoding|connection)$/i.test(h.key)) continue; if (/^content-type$/i.test(h.key)) hasCt = true; reply.header(h.key, interpolate(String(h.value ?? ''), scopes)) }
    if (!hasCt) reply.header('content-type', looksJson(ex.body) ? 'application/json' : 'text/plain')
    reply.header('x-mock-matched', ex.name)
    return reply.send(interpolate(ex.body ?? '', scopes))
  }
}
function looksJson(s: string) { const t = (s ?? '').trim(); return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']')) }
