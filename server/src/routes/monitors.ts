import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { CronExpressionParser } from 'cron-parser'
import { one, q } from '../db/index.js'
import { parse } from '../lib/validate.js'
import { badRequest, notFound } from '../lib/errors.js'
import { requireCollection, requireWorkspace } from '../lib/auth.js'
import { audit } from '../lib/audit.js'
import { startRun } from './runs.js'
import { sendMail } from '../lib/mail.js'
import { sendHttp } from '../engine/http.js'
import { config } from '../config.js'

const monitorBody = z.object({
  name: z.string().min(1).max(200),
  collectionId: z.string().uuid(),
  environmentId: z.string().uuid().nullable().optional(),
  schedule: z.string().min(9).max(100),
  enabled: z.boolean().optional(),
  notify: z.object({ webhookUrl: z.string().url().optional().or(z.literal('')), emails: z.array(z.string().email()).optional(), onFailureOnly: z.boolean().optional(), onRecovery: z.boolean().optional() }).optional(),
  folderId: z.string().uuid().nullable().optional(),
})

function nextRun(schedule: string, from = new Date()): Date {
  try { return CronExpressionParser.parse(schedule, { currentDate: from }).next().toDate() } catch { throw badRequest('Invalid cron expression') }
}

export async function monitorRoutes(app: FastifyInstance) {
  app.get('/workspaces/:wsId/monitors', async (req) => {
    const { wsId } = req.params as any
    await requireWorkspace(req, wsId)
    return q(`SELECT m.*, c.name as collection_name, e.name as environment_name FROM monitors m JOIN collections c ON c.id=m.collection_id LEFT JOIN environments e ON e.id=m.environment_id WHERE m.workspace_id=$1 ORDER BY m.name`, [wsId])
  })
  app.post('/workspaces/:wsId/monitors', async (req) => {
    const { wsId } = req.params as any
    await requireWorkspace(req, wsId, 'editor')
    const body = parse(monitorBody, req.body)
    await requireCollection(req, body.collectionId)
    const next = nextRun(body.schedule)
    const row = await one<any>(`INSERT INTO monitors (workspace_id, collection_id, environment_id, name, schedule, enabled, notify, next_run_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [wsId, body.collectionId, body.environmentId ?? null, body.name, body.schedule, body.enabled ?? true, JSON.stringify({ ...(body.notify ?? {}), folderId: body.folderId ?? null }), next])
    audit(req, 'monitor.create', { workspaceId: wsId, entityType: 'monitor', entityId: row.id, meta: { name: body.name } })
    return row
  })
  app.patch('/monitors/:id', async (req) => {
    const m = await one<any>('SELECT * FROM monitors WHERE id=$1', [(req.params as any).id])
    if (!m) throw notFound()
    await requireWorkspace(req, m.workspace_id, 'editor')
    const body = parse(monitorBody.partial(), req.body)
    const schedule = body.schedule ?? m.schedule
    const next = nextRun(schedule)
    await q(`UPDATE monitors SET name=COALESCE($1,name), collection_id=COALESCE($2,collection_id), environment_id=CASE WHEN $3::boolean THEN $4::uuid ELSE environment_id END, schedule=$5, enabled=COALESCE($6,enabled), notify=COALESCE($7,notify), next_run_at=$8 WHERE id=$9`,
      [body.name ?? null, body.collectionId ?? null, body.environmentId !== undefined, body.environmentId ?? null, schedule, body.enabled ?? null, body.notify ? JSON.stringify({ ...body.notify, folderId: body.folderId ?? m.notify?.folderId ?? null }) : null, next, m.id])
    audit(req, 'monitor.update', { workspaceId: m.workspace_id, entityType: 'monitor', entityId: m.id })
    return one('SELECT * FROM monitors WHERE id=$1', [m.id])
  })
  app.delete('/monitors/:id', async (req) => {
    const m = await one<any>('SELECT * FROM monitors WHERE id=$1', [(req.params as any).id])
    if (!m) throw notFound()
    await requireWorkspace(req, m.workspace_id, 'editor')
    await q('DELETE FROM monitors WHERE id=$1', [m.id])
    audit(req, 'monitor.delete', { workspaceId: m.workspace_id, entityType: 'monitor', entityId: m.id, meta: { name: m.name } })
    return { ok: true }
  })
  app.post('/monitors/:id/run', async (req) => {
    const m = await one<any>('SELECT * FROM monitors WHERE id=$1', [(req.params as any).id])
    if (!m) throw notFound()
    await requireWorkspace(req, m.workspace_id)
    const { id } = await executeMonitor(m)
    return { runId: id }
  })
  app.get('/monitors/:id/runs', async (req) => {
    const m = await one<any>('SELECT * FROM monitors WHERE id=$1', [(req.params as any).id])
    if (!m) throw notFound()
    await requireWorkspace(req, m.workspace_id)
    return q('SELECT id, status, summary, started_at, finished_at FROM runs WHERE monitor_id=$1 ORDER BY started_at DESC LIMIT 200', [m.id])
  })
}

export async function executeMonitor(m: any) {
  const prevStatus = m.last_status
  const { id, done } = await startRun(null, m.workspace_id, null, { collectionId: m.collection_id, environmentId: m.environment_id, folderId: m.notify?.folderId ?? undefined, includeBodies: false, persistVariables: false }, { monitorId: m.id, source: 'monitor' })
  await q('UPDATE monitors SET last_run_id=$1, last_run_at=now(), next_run_at=$2 WHERE id=$3', [id, nextRun(m.schedule), m.id])
  done.then(async (r) => {
    await q('UPDATE monitors SET last_status=$1 WHERE id=$2', [r.status, m.id])
    const n = m.notify ?? {}
    const failed = r.status !== 'passed'
    const recovered = !failed && prevStatus && prevStatus !== 'passed'
    const should = failed ? true : recovered ? n.onRecovery !== false : n.onFailureOnly === false
    if (!should) return
    const link = `${config.baseUrl.replace(/\/$/, '')}/runs/${id}`
    const subject = `[Quiver] Monitor "${m.name}" ${failed ? r.status.toUpperCase() : recovered ? 'recovered' : 'passed'}`
    const text = `${subject}\n\nCollection run: ${link}\nRequests: ${r.summary.total}, passed: ${r.summary.passed}, failed: ${r.summary.failed}, errors: ${r.summary.errors}\nTests: ${r.summary.testsPassed}/${r.summary.testsTotal} passed\n\n` + r.results.filter((x) => x.error || x.tests.some((t) => !t.passed)).map((x) => `- ${x.requestName} (${x.status ?? 'ERR'}) ${x.error ?? ''}\n` + x.tests.filter((t) => !t.passed).map((t) => `    ✗ ${t.name}: ${t.error}`).join('\n')).join('\n')
    if (n.webhookUrl) {
      sendHttp({ method: 'POST', url: n.webhookUrl, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ monitor: { id: m.id, name: m.name }, run: { id, status: r.status, link }, summary: r.summary, text, failures: r.results.filter((x) => x.error || x.tests.some((t) => !t.passed)).map((x) => ({ name: x.requestName, status: x.status, error: x.error, failedTests: x.tests.filter((t) => !t.passed) })) })), settings: { followRedirects: true, maxRedirects: 3, verifyTls: true, timeoutMs: 15000 } }).catch(() => {})
    }
    for (const email of n.emails ?? []) sendMail(email, subject, text).catch(() => {})
  }).catch(() => {})
  return { id }
}

let timer: NodeJS.Timeout | null = null
export function startScheduler(log: { info: (s: string) => void; error: (s: string) => void }) {
  const tick = async () => {
    try {
      const due = await q<any>(`SELECT * FROM monitors WHERE enabled=true AND (next_run_at IS NULL OR next_run_at <= now()) ORDER BY next_run_at LIMIT 20`)
      for (const m of due) {
        // claim atomically so multiple instances don't double-run
        const claimed = await one(`UPDATE monitors SET next_run_at=$2 WHERE id=$1 AND (next_run_at IS NULL OR next_run_at <= now()) RETURNING id`, [m.id, nextRun(m.schedule)])
        if (!claimed) continue
        executeMonitor(m).catch((e) => log.error(`monitor ${m.name} failed: ${e.message}`))
      }
    } catch (e: any) { log.error('scheduler tick failed: ' + e.message) }
  }
  timer = setInterval(tick, 30_000)
  timer.unref()
  setTimeout(tick, 5000).unref()
  log.info('monitor scheduler started')
}
