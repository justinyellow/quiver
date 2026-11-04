import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { one, q } from '../db/index.js'
import { parse } from '../lib/validate.js'
import { badRequest, notFound } from '../lib/errors.js'
import { requireCollection, requireWorkspace } from '../lib/auth.js'
import { audit } from '../lib/audit.js'
import { buildScopes, loadCookieJar, loadTree, persistUpdatedAuth, persistVarMutations } from '../lib/loaders.js'
import { CollectionRun, flatten, summarize, type RunConfig, type RunItemResult } from '../engine/runner.js'
import { guardFor } from './execute.js'
import { parseCsv } from '../lib/csv.js'

export const activeRuns = new Map<string, CollectionRun>()

const runBody = z.object({
  collectionId: z.string().uuid(),
  environmentId: z.string().uuid().nullable().optional(),
  overlayEnvironmentIds: z.array(z.string().uuid()).optional(),
  iterations: z.number().int().min(1).max(10000).optional(),
  delayMs: z.number().int().min(0).max(600000).optional(),
  data: z.array(z.record(z.any())).max(100000).optional(),
  dataText: z.string().max(50_000_000).optional(), // CSV or JSON text
  stopOnFailure: z.boolean().optional(),
  stopOnError: z.boolean().optional(),
  requestIds: z.array(z.string().uuid()).optional(),
  folderId: z.string().uuid().optional(),
  persistVariables: z.boolean().optional(),
  includeBodies: z.boolean().optional(),
  source: z.enum(['manual', 'api']).optional(),
})

export function parseData(text: string): Record<string, any>[] {
  const t = text.trim()
  if (!t) return []
  if (t.startsWith('[') || t.startsWith('{')) {
    const j = JSON.parse(t)
    return Array.isArray(j) ? j : [j]
  }
  return parseCsv(t)
}

export async function startRun(req: FastifyRequest | null, wsId: string, userId: string | null, body: z.infer<typeof runBody>, extra: { monitorId?: string; source?: string } = {}) {
  const tree = await loadTree(body.collectionId, false)
  const { scopes, environmentName } = await buildScopes(wsId, body.collectionId, body.environmentId ?? null, body.overlayEnvironmentIds)
  const data = body.data ?? (body.dataText ? parseData(body.dataText) : undefined)
  const cfg: RunConfig = { iterations: body.iterations, delayMs: body.delayMs, data, stopOnFailure: body.stopOnFailure, stopOnError: body.stopOnError, requestIds: body.requestIds, folderId: body.folderId, persistVariables: body.persistVariables ?? false }
  const { guard, send } = await guardFor()
  const cookies = userId ? await loadCookieJar(wsId, userId) : []
  const run = new CollectionRun(tree, scopes, cfg, { environmentName, cookies, guard, send, includeBodies: body.includeBodies ?? true })
  const total = flatten(tree, cfg).length * (data?.length || body.iterations || 1)
  const row = await one<any>(`INSERT INTO runs (workspace_id, collection_id, collection_name, environment_id, user_id, monitor_id, source, status, config) VALUES ($1,$2,$3,$4,$5,$6,$7,'running',$8) RETURNING id, started_at`,
    [wsId, body.collectionId, tree.name, body.environmentId ?? null, userId, extra.monitorId ?? null, extra.source ?? body.source ?? 'manual', JSON.stringify({ iterations: body.iterations, delayMs: body.delayMs, dataRows: data?.length, stopOnFailure: body.stopOnFailure, requestIds: body.requestIds, folderId: body.folderId, total })])
  activeRuns.set(row.id, run)
  if (req) audit(req, 'run.start', { workspaceId: wsId, entityType: 'run', entityId: row.id, meta: { collection: tree.name } })
  let lastFlush = Date.now()
  run.on('item', () => { if (Date.now() - lastFlush > 2000) { lastFlush = Date.now(); q('UPDATE runs SET results=$1, summary=$2 WHERE id=$3', [JSON.stringify(run.results), JSON.stringify(summarize(run.results, Date.now() - new Date(row.started_at).getTime(), 1)), row.id]).catch(() => {}) } })
  const done = run.run().then(async (r) => {
    const status = run.cancelled ? 'cancelled' : r.summary.errors > 0 ? 'error' : r.summary.failed > 0 ? 'failed' : 'passed'
    await q('UPDATE runs SET status=$1, summary=$2, results=$3, finished_at=now() WHERE id=$4', [status, JSON.stringify(r.summary), JSON.stringify(r.results), row.id])
    if (cfg.persistVariables) {
      const muts = { globals: {}, collection: {}, environment: {} } as any
      // final scopes contain mutated values; persist whole env/globals/collection values that changed
      await persistVarMutations(wsId, body.collectionId, body.environmentId ?? null, { globals: diffScope(scopes.globals, r.scopes.globals), collection: diffScope(scopes.collection, r.scopes.collection), environment: diffScope(scopes.environment, r.scopes.environment) })
      void muts
    }
    for (const ua of r.updatedAuths) await persistUpdatedAuth(ua)
    activeRuns.delete(row.id)
    return { status, summary: r.summary, results: r.results }
  }).catch(async (e) => {
    await q('UPDATE runs SET status=$1, summary=$2, finished_at=now() WHERE id=$3', ['error', JSON.stringify({ error: e?.message || String(e) }), row.id])
    activeRuns.delete(row.id)
    throw e
  })
  return { id: row.id as string, run, done, total }
}
function diffScope(before: Record<string, string>, after: Record<string, string>) {
  // `before` is the same object mutated in place, so we cannot diff; persist everything in `after` (safe: values already reflect latest)
  void before
  const out: Record<string, string | null> = {}
  for (const [k, v] of Object.entries(after)) out[k] = v
  return out
}

export async function runRoutes(app: FastifyInstance) {
  app.post('/workspaces/:wsId/runs', async (req) => {
    const { wsId } = req.params as any
    const u = await requireWorkspace(req, wsId)
    const body = parse(runBody, req.body)
    await requireCollection(req, body.collectionId)
    const wait = (req.query as any).wait === 'true'
    const { id, done, total } = await startRun(req, wsId, u.id, body)
    if (wait) { const r = await done; return { id, ...r } }
    return { id, total }
  })
  app.get('/workspaces/:wsId/runs', async (req) => {
    const { wsId } = req.params as any
    await requireWorkspace(req, wsId)
    const { limit = '50', collectionId, monitorId, source } = req.query as any
    const params: any[] = [wsId, Math.min(Number(limit) || 50, 500)]
    let where = 'r.workspace_id=$1'
    if (collectionId) { params.push(collectionId); where += ` AND r.collection_id=$${params.length}` }
    if (monitorId) { params.push(monitorId); where += ` AND r.monitor_id=$${params.length}` }
    if (source) { params.push(source); where += ` AND r.source=$${params.length}` }
    return q(`SELECT r.id, r.collection_id, r.collection_name, r.environment_id, r.user_id, r.monitor_id, r.source, r.status, r.config, r.summary, r.started_at, r.finished_at, u.name as user_name FROM runs r LEFT JOIN users u ON u.id=r.user_id WHERE ${where} ORDER BY r.started_at DESC LIMIT $2`, params)
  })
  app.get('/runs/:id', async (req) => {
    const r = await one<any>('SELECT * FROM runs WHERE id=$1', [(req.params as any).id])
    if (!r) throw notFound()
    await requireWorkspace(req, r.workspace_id)
    const live = activeRuns.get(r.id)
    if (live) return { ...r, results: live.results, summary: summarize(live.results, Date.now() - new Date(r.started_at).getTime(), 1) }
    return r
  })
  app.delete('/runs/:id', async (req) => {
    const r = await one<any>('SELECT * FROM runs WHERE id=$1', [(req.params as any).id])
    if (!r) throw notFound()
    await requireWorkspace(req, r.workspace_id, 'editor')
    activeRuns.get(r.id)?.cancel()
    await q('DELETE FROM runs WHERE id=$1', [r.id])
    return { ok: true }
  })
  app.post('/runs/:id/cancel', async (req) => {
    const r = await one<any>('SELECT * FROM runs WHERE id=$1', [(req.params as any).id])
    if (!r) throw notFound()
    await requireWorkspace(req, r.workspace_id)
    const live = activeRuns.get(r.id)
    if (!live) throw badRequest('Run is not active')
    live.cancel()
    return { ok: true }
  })
  // Live progress via SSE
  app.get('/runs/:id/events', async (req, reply) => {
    const r = await one<any>('SELECT * FROM runs WHERE id=$1', [(req.params as any).id])
    if (!r) throw notFound()
    await requireWorkspace(req, r.workspace_id)
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' })
    const send = (event: string, data: any) => reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    const live = activeRuns.get(r.id)
    if (!live) { send('done', { status: r.status, summary: r.summary, results: r.results }); reply.raw.end(); return reply }
    for (const item of live.results) send('item', item)
    const onItem = (item: RunItemResult) => send('item', item)
    const onStart = (d: any) => send('item:start', d)
    const onDone = async () => { const row = await one<any>('SELECT status, summary FROM runs WHERE id=$1', [r.id]); send('done', { status: row?.status ?? 'passed', summary: row?.summary }); cleanup(); reply.raw.end() }
    const cleanup = () => { live.off('item', onItem); live.off('item:start', onStart); live.off('done', onDone) }
    live.on('item', onItem); live.on('item:start', onStart); live.once('done', () => setTimeout(onDone, 200))
    req.raw.on('close', cleanup)
    return reply
  })
  // JUnit XML report for CI
  app.get('/runs/:id/junit', async (req, reply) => {
    const r = await one<any>('SELECT * FROM runs WHERE id=$1', [(req.params as any).id])
    if (!r) throw notFound()
    await requireWorkspace(req, r.workspace_id)
    const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    const results: RunItemResult[] = r.results ?? []
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="${esc(r.collection_name)}" tests="${r.summary?.testsTotal ?? 0}" failures="${r.summary?.testsFailed ?? 0}" errors="${r.summary?.errors ?? 0}" time="${((r.summary?.durationMs ?? 0) / 1000).toFixed(3)}">\n`
    for (const it of results) {
      xml += `  <testsuite name="${esc(it.path.join(' / '))}" tests="${it.tests.length}" failures="${it.tests.filter((t) => !t.passed).length}" errors="${it.error ? 1 : 0}" time="${((it.timeMs ?? 0) / 1000).toFixed(3)}">\n`
      if (it.error) xml += `    <testcase name="request"><error message="${esc(it.error)}"/></testcase>\n`
      for (const t of it.tests) xml += `    <testcase name="${esc(t.name)}" classname="${esc(it.requestName)}">${t.passed ? '' : `<failure message="${esc(t.error)}"/>`}</testcase>\n`
      xml += `  </testsuite>\n`
    }
    xml += `</testsuites>\n`
    reply.type('application/xml')
    return xml
  })

  // ---- performance test: N virtual users for D seconds (or iterations)
  app.post('/workspaces/:wsId/perf', async (req) => {
    const { wsId } = req.params as any
    const u = await requireWorkspace(req, wsId)
    const body = parse(z.object({ collectionId: z.string().uuid(), environmentId: z.string().uuid().nullable().optional(), virtualUsers: z.number().int().min(1).max(200).default(10), durationSec: z.number().int().min(1).max(3600).default(30), rampUpSec: z.number().int().min(0).max(600).default(0), requestIds: z.array(z.string().uuid()).optional(), folderId: z.string().uuid().optional() }), req.body)
    await requireCollection(req, body.collectionId)
    const tree = await loadTree(body.collectionId, false)
    const { guard, send } = await guardFor()
    const row = await one<any>(`INSERT INTO runs (workspace_id, collection_id, collection_name, environment_id, user_id, source, status, config) VALUES ($1,$2,$3,$4,$5,'perf','running',$6) RETURNING id, started_at`, [wsId, body.collectionId, tree.name, body.environmentId ?? null, u.id, JSON.stringify(body)])
    audit(req, 'perf.start', { workspaceId: wsId, entityType: 'run', entityId: row.id })
    const deadline = Date.now() + body.durationSec * 1000
    const samples: { name: string; t: number; ok: boolean; status?: number; ts: number }[] = []
    const vuRuns: CollectionRun[] = []
    const controller = { cancelled: false }
    const master = new CollectionRun(tree, (await buildScopes(wsId, body.collectionId, body.environmentId ?? null)).scopes, {}, {})
    activeRuns.set(row.id, master)
    master.cancel = () => { controller.cancelled = true; vuRuns.forEach((r) => r.cancel()) }
    const runVu = async (i: number) => {
      if (body.rampUpSec) await new Promise((r) => setTimeout(r, (body.rampUpSec * 1000 * i) / body.virtualUsers))
      while (Date.now() < deadline && !controller.cancelled) {
        const { scopes, environmentName } = await buildScopes(wsId, body.collectionId, body.environmentId ?? null)
        const run = new CollectionRun(tree, scopes, { requestIds: body.requestIds, folderId: body.folderId }, { environmentName, guard, send, includeBodies: false })
        vuRuns.push(run)
        run.on('item', (it: RunItemResult) => { samples.push({ name: it.requestName, t: it.timeMs ?? 0, ok: !it.error && !it.tests.some((x) => !x.passed) && (it.status ?? 500) < 400, status: it.status, ts: Date.now() }) })
        await run.run()
        vuRuns.splice(vuRuns.indexOf(run), 1)
      }
    }
    const started = Date.now()
    ;(async () => {
      await Promise.all(Array.from({ length: body.virtualUsers }, (_, i) => runVu(i)))
      const elapsed = (Date.now() - started) / 1000
      const byName = new Map<string, number[]>()
      const errByName = new Map<string, number>()
      for (const s of samples) { (byName.get(s.name) ?? byName.set(s.name, []).get(s.name)!).push(s.t); if (!s.ok) errByName.set(s.name, (errByName.get(s.name) ?? 0) + 1) }
      const pct = (arr: number[], p: number) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]) }
      const all = samples.map((s) => s.t)
      const perRequest = [...byName.entries()].map(([name, arr]) => ({ name, count: arr.length, errors: errByName.get(name) ?? 0, avg: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length), min: Math.round(Math.min(...arr)), max: Math.round(Math.max(...arr)), p50: pct(arr, 50), p90: pct(arr, 90), p95: pct(arr, 95), p99: pct(arr, 99), rps: +(arr.length / elapsed).toFixed(2) }))
      // timeline buckets (1s)
      const buckets = new Map<number, { count: number; errors: number; sum: number }>()
      for (const s of samples) { const b = Math.floor((s.ts - started) / 1000); const cur = buckets.get(b) ?? { count: 0, errors: 0, sum: 0 }; cur.count++; cur.sum += s.t; if (!s.ok) cur.errors++; buckets.set(b, cur) }
      const timeline = [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([sec, v]) => ({ sec, rps: v.count, errors: v.errors, avg: Math.round(v.sum / v.count) }))
      const summary = { total: samples.length, errors: samples.filter((s) => !s.ok).length, errorRate: samples.length ? +(samples.filter((s) => !s.ok).length / samples.length * 100).toFixed(2) : 0, durationMs: Math.round(elapsed * 1000), rps: +(samples.length / elapsed).toFixed(2), avg: all.length ? Math.round(all.reduce((a, b) => a + b, 0) / all.length) : 0, p50: pct(all, 50), p90: pct(all, 90), p95: pct(all, 95), p99: pct(all, 99), max: all.length ? Math.round(Math.max(...all)) : 0, virtualUsers: body.virtualUsers, perRequest, timeline }
      await q('UPDATE runs SET status=$1, summary=$2, finished_at=now() WHERE id=$3', [controller.cancelled ? 'cancelled' : summary.errorRate > 0 ? 'failed' : 'passed', JSON.stringify(summary), row.id])
      activeRuns.delete(row.id)
    })().catch(async (e) => { await q('UPDATE runs SET status=$1, summary=$2, finished_at=now() WHERE id=$3', ['error', JSON.stringify({ error: e.message }), row.id]); activeRuns.delete(row.id) })
    return { id: row.id }
  })
  app.get('/runs/:id/perf-live', async (req) => {
    const r = await one<any>('SELECT id, status, summary, started_at, workspace_id FROM runs WHERE id=$1', [(req.params as any).id])
    if (!r) throw notFound()
    await requireWorkspace(req, r.workspace_id)
    return r
  })
}
