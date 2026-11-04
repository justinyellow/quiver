import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { one, q } from '../db/index.js'
import { parse } from '../lib/validate.js'
import { badRequest, notFound } from '../lib/errors.js'
import { requireWorkspace } from '../lib/auth.js'
import { audit } from '../lib/audit.js'
import { decryptVars, encryptVars, loadCookieJar, maskVars, saveCookieJar } from '../lib/loaders.js'

const variable = z.object({ key: z.string().max(500), value: z.string().max(100000).default(''), type: z.enum(['default', 'secret']).optional(), enabled: z.boolean().optional(), masked: z.boolean().optional() })

async function envWorkspace(id: string) {
  const e = await one<any>('SELECT * FROM environments WHERE id=$1', [id])
  if (!e) throw notFound('Environment not found')
  return e
}

export async function environmentRoutes(app: FastifyInstance) {
  app.get('/workspaces/:wsId/environments', async (req) => {
    const { wsId } = req.params as any
    await requireWorkspace(req, wsId)
    const rows = await q<any>('SELECT * FROM environments WHERE workspace_id=$1 ORDER BY is_global DESC, name', [wsId])
    return rows.map((e) => ({ ...e, variables: maskVars(e.variables) }))
  })
  app.post('/workspaces/:wsId/environments', async (req) => {
    const { wsId } = req.params as any
    await requireWorkspace(req, wsId, 'editor')
    const body = parse(z.object({ name: z.string().min(1).max(100), variables: z.array(variable).optional() }), req.body)
    const row = await one<any>('INSERT INTO environments (workspace_id, name, variables) VALUES ($1,$2,$3) RETURNING *', [wsId, body.name, JSON.stringify(encryptVars(body.variables ?? []))])
    audit(req, 'environment.create', { workspaceId: wsId, entityType: 'environment', entityId: row.id, meta: { name: body.name } })
    return { ...row, variables: maskVars(row.variables) }
  })
  app.get('/environments/:id', async (req) => {
    const e = await envWorkspace((req.params as any).id)
    await requireWorkspace(req, e.workspace_id)
    const reveal = (req.query as any).reveal === 'true'
    if (reveal) { await requireWorkspace(req, e.workspace_id, 'editor'); audit(req, 'environment.reveal_secrets', { workspaceId: e.workspace_id, entityType: 'environment', entityId: e.id }) }
    return { ...e, variables: reveal ? decryptVars(e.variables) : maskVars(e.variables) }
  })
  app.patch('/environments/:id', async (req) => {
    const e = await envWorkspace((req.params as any).id)
    await requireWorkspace(req, e.workspace_id, 'editor')
    const body = parse(z.object({ name: z.string().min(1).max(100).optional(), variables: z.array(variable).optional() }), req.body)
    let vars = e.variables
    if (body.variables) {
      // Keep existing encrypted value when the client sends back a masked placeholder.
      const existing = decryptVars(e.variables)
      vars = encryptVars(body.variables.map((v) => {
        if (v.type === 'secret' && (v.masked || v.value === '••••••••')) { const prev = existing.find((x) => x.key === v.key); return { key: v.key, value: prev?.value ?? '', type: 'secret', enabled: v.enabled } }
        const { masked, ...rest } = v
        return rest
      }))
    }
    if (e.is_global && body.name) body.name = undefined
    await q('UPDATE environments SET name=COALESCE($1,name), variables=$2, updated_at=now() WHERE id=$3', [body.name ?? null, JSON.stringify(vars), e.id])
    q('INSERT INTO revisions (entity_type, entity_id, data, user_id) VALUES ($1,$2,$3,$4)', ['environment', e.id, JSON.stringify({ name: e.name, variables: e.variables }), req.user!.id]).catch(() => {})
    audit(req, 'environment.update', { workspaceId: e.workspace_id, entityType: 'environment', entityId: e.id })
    const row = await one<any>('SELECT * FROM environments WHERE id=$1', [e.id])
    return { ...row, variables: maskVars(row.variables) }
  })
  app.delete('/environments/:id', async (req) => {
    const e = await envWorkspace((req.params as any).id)
    await requireWorkspace(req, e.workspace_id, 'editor')
    if (e.is_global) throw badRequest('Globals cannot be deleted')
    await q('DELETE FROM environments WHERE id=$1', [e.id])
    audit(req, 'environment.delete', { workspaceId: e.workspace_id, entityType: 'environment', entityId: e.id, meta: { name: e.name } })
    return { ok: true }
  })
  app.post('/environments/:id/duplicate', async (req) => {
    const e = await envWorkspace((req.params as any).id)
    await requireWorkspace(req, e.workspace_id, 'editor')
    const row = await one<any>('INSERT INTO environments (workspace_id, name, variables) VALUES ($1,$2,$3) RETURNING *', [e.workspace_id, e.name + ' (copy)', JSON.stringify(e.variables)])
    return { ...row, variables: maskVars(row.variables) }
  })

  // ---- cookie jar (per user per workspace)
  app.get('/workspaces/:wsId/cookies', async (req) => {
    const { wsId } = req.params as any
    const u = await requireWorkspace(req, wsId)
    return loadCookieJar(wsId, u.id)
  })
  app.put('/workspaces/:wsId/cookies', async (req) => {
    const { wsId } = req.params as any
    const u = await requireWorkspace(req, wsId)
    const body = parse(z.array(z.object({ name: z.string(), value: z.string(), domain: z.string(), path: z.string().default('/'), expires: z.number().nullable().optional(), secure: z.boolean().optional(), httpOnly: z.boolean().optional(), sameSite: z.string().optional() })), req.body)
    await saveCookieJar(wsId, u.id, body)
    return { ok: true }
  })
  app.delete('/workspaces/:wsId/cookies', async (req) => {
    const { wsId } = req.params as any
    const u = await requireWorkspace(req, wsId)
    await saveCookieJar(wsId, u.id, [])
    return { ok: true }
  })
}
