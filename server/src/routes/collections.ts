import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { one, q, tx } from '../db/index.js'
import { parse } from '../lib/validate.js'
import { badRequest, notFound } from '../lib/errors.js'
import { requireCollection, requireUser, requireWorkspace } from '../lib/auth.js'
import { audit } from '../lib/audit.js'
import { loadTree } from '../lib/loaders.js'
import { detectAndImport, importFiles } from '../import/index.js'
import type { ImportedCollection, ImportedFolder, ImportedRequest } from '../import/types.js'
import { exportPostmanCollection, exportOpenApi, exportPlainText, exportQuiver } from '../export/index.js'
import { randomToken } from '../lib/crypto.js'

const kv = z.object({ key: z.string(), value: z.string().default(''), enabled: z.boolean().optional(), description: z.string().optional(), type: z.enum(['text', 'file']).optional(), src: z.string().optional() })
const auth = z.object({ type: z.string() }).passthrough()
const variable = z.object({ key: z.string(), value: z.string().default(''), type: z.enum(['default', 'secret']).optional(), enabled: z.boolean().optional() })

const collectionBody = z.object({ name: z.string().min(1).max(200), description: z.string().max(100000).optional(), auth: auth.optional(), variables: z.array(variable).optional(), preRequestScript: z.string().max(200000).optional(), testScript: z.string().max(200000).optional() })
const folderBody = z.object({ name: z.string().min(1).max(200), description: z.string().max(100000).optional(), parentId: z.string().uuid().nullable().optional(), auth: auth.optional(), preRequestScript: z.string().max(200000).optional(), testScript: z.string().max(200000).optional() })
const requestBody = z.object({
  name: z.string().min(1).max(300), description: z.string().max(100000).optional(), folderId: z.string().uuid().nullable().optional(),
  method: z.string().min(1).max(20).optional(), url: z.string().max(10000).optional(), params: z.array(kv).optional(), headers: z.array(kv).optional(),
  body: z.object({ mode: z.string() }).passthrough().optional(), auth: auth.optional(), preRequestScript: z.string().max(200000).optional(), testScript: z.string().max(200000).optional(), settings: z.record(z.any()).optional(),
})
const exampleBody = z.object({ name: z.string().min(1).max(300), request: z.record(z.any()).optional(), status: z.number().int().min(100).max(599).optional(), statusText: z.string().max(100).optional(), headers: z.array(kv).optional(), body: z.string().max(5_000_000).optional() })

function snapshot(entityType: string, entityId: string, data: any, userId: string | undefined, message?: string) {
  q('INSERT INTO revisions (entity_type, entity_id, data, user_id, message) VALUES ($1,$2,$3,$4,$5)', [entityType, entityId, JSON.stringify(data), userId ?? null, message ?? null]).catch(() => {})
  // keep last 100 per entity
  q('DELETE FROM revisions WHERE entity_type=$1 AND entity_id=$2 AND id NOT IN (SELECT id FROM revisions WHERE entity_type=$1 AND entity_id=$2 ORDER BY created_at DESC LIMIT 100)', [entityType, entityId]).catch(() => {})
}

export async function insertImported(c: any, workspaceId: string, col: ImportedCollection, userId: string | undefined, forkedFrom?: string) {
  const row = (await c.query(`INSERT INTO collections (workspace_id, name, description, auth, variables, pre_request_script, test_script, created_by, updated_by, forked_from, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,(SELECT COALESCE(max(sort_order),0)+1 FROM collections WHERE workspace_id=$1)) RETURNING id`, [workspaceId, col.name, col.description ?? '', JSON.stringify(col.auth ?? { type: 'none' }), JSON.stringify(col.variables ?? []), col.preRequestScript ?? '', col.testScript ?? '', userId ?? null, forkedFrom ?? null])).rows[0]
  const insertReq = async (r: ImportedRequest, folderId: string | null, order: number) => {
    const rr = (await c.query(`INSERT INTO requests (collection_id, folder_id, name, description, method, url, params, headers, body, auth, pre_request_script, test_script, settings, sort_order, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`, [row.id, folderId, r.name, r.description ?? '', r.method, r.url, JSON.stringify(r.params ?? []), JSON.stringify(r.headers ?? []), JSON.stringify(r.body ?? { mode: 'none' }), JSON.stringify(r.auth ?? { type: 'inherit' }), r.preRequestScript ?? '', r.testScript ?? '', JSON.stringify(r.settings ?? {}), order, userId ?? null])).rows[0]
    let eo = 0
    for (const e of r.examples ?? []) await c.query(`INSERT INTO examples (request_id, name, request, status, status_text, headers, body, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [rr.id, e.name, JSON.stringify(e.request ?? {}), e.status ?? 200, e.statusText ?? 'OK', JSON.stringify(e.headers ?? []), e.body ?? '', eo++])
  }
  const insertFolder = async (f: ImportedFolder, parentId: string | null, order: number) => {
    const fr = (await c.query(`INSERT INTO folders (collection_id, parent_id, name, description, auth, pre_request_script, test_script, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [row.id, parentId, f.name, f.description ?? '', JSON.stringify(f.auth ?? { type: 'inherit' }), f.preRequestScript ?? '', f.testScript ?? '', order])).rows[0]
    let o = 0
    for (const sub of f.folders ?? []) await insertFolder(sub, fr.id, o++)
    for (const r of f.requests ?? []) await insertReq(r, fr.id, o++)
  }
  let o = 0
  for (const f of col.folders ?? []) await insertFolder(f, null, o++)
  for (const r of col.requests ?? []) await insertReq(r, null, o++)
  return row.id as string
}

export async function collectionRoutes(app: FastifyInstance) {
  // ---- list / create
  app.get('/workspaces/:wsId/collections', async (req) => {
    const { wsId } = req.params as any
    await requireWorkspace(req, wsId)
    return q(`SELECT c.id, c.name, c.description, c.updated_at, c.created_at, c.doc_public, c.doc_slug, c.forked_from, c.sort_order, (SELECT count(*) FROM requests WHERE collection_id=c.id)::int as request_count FROM collections c WHERE workspace_id=$1 ORDER BY sort_order, name`, [wsId])
  })
  app.post('/workspaces/:wsId/collections', async (req) => {
    const { wsId } = req.params as any
    const u = await requireWorkspace(req, wsId, 'editor')
    const body = parse(collectionBody, req.body)
    const row = await one(`INSERT INTO collections (workspace_id, name, description, auth, variables, pre_request_script, test_script, created_by, updated_by, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,(SELECT COALESCE(max(sort_order),0)+1 FROM collections WHERE workspace_id=$1)) RETURNING *`, [wsId, body.name, body.description ?? '', JSON.stringify(body.auth ?? { type: 'none' }), JSON.stringify(body.variables ?? []), body.preRequestScript ?? '', body.testScript ?? '', u.id])
    audit(req, 'collection.create', { workspaceId: wsId, entityType: 'collection', entityId: row!.id, meta: { name: body.name } })
    return row
  })

  // ---- workspace-wide tree (sidebar): all collections with folders+requests (light)
  app.get('/workspaces/:wsId/tree', async (req) => {
    const { wsId } = req.params as any
    await requireWorkspace(req, wsId)
    const cols = await q<any>('SELECT id, name, description, sort_order, doc_public, forked_from, updated_at FROM collections WHERE workspace_id=$1 ORDER BY sort_order, name', [wsId])
    const folders = await q<any>('SELECT f.id, f.collection_id, f.parent_id, f.name, f.sort_order FROM folders f JOIN collections c ON c.id=f.collection_id WHERE c.workspace_id=$1 ORDER BY f.sort_order, f.created_at', [wsId])
    const requests = await q<any>('SELECT r.id, r.collection_id, r.folder_id, r.name, r.method, r.url, r.sort_order, r.updated_at FROM requests r JOIN collections c ON c.id=r.collection_id WHERE c.workspace_id=$1 ORDER BY r.sort_order, r.created_at', [wsId])
    const examples = await q<any>('SELECT e.id, e.request_id, e.name, e.status FROM examples e JOIN requests r ON r.id=e.request_id JOIN collections c ON c.id=r.collection_id WHERE c.workspace_id=$1 ORDER BY e.sort_order', [wsId])
    return { collections: cols, folders, requests, examples }
  })

  // ---- single collection
  app.get('/collections/:id', async (req) => {
    const { id } = req.params as any
    await requireCollection(req, id)
    const row = await one<any>('SELECT * FROM collections WHERE id=$1', [id])
    if (!row) throw notFound()
    return row
  })
  app.get('/collections/:id/full', async (req) => {
    const { id } = req.params as any
    await requireCollection(req, id)
    return loadTree(id, true)
  })
  app.patch('/collections/:id', async (req) => {
    const { id } = req.params as any
    const { user, workspaceId } = await requireCollection(req, id, 'editor')
    const body = parse(collectionBody.partial().extend({ docPublic: z.boolean().optional(), sortOrder: z.number().int().optional() }), req.body)
    const before = await one<any>('SELECT * FROM collections WHERE id=$1', [id])
    if (!before) throw notFound()
    snapshot('collection', id, { name: before.name, description: before.description, auth: before.auth, variables: before.variables, pre_request_script: before.pre_request_script, test_script: before.test_script }, user.id)
    const sets: string[] = []; const vals: any[] = []
    const set = (col: string, v: any) => { vals.push(v); sets.push(`${col}=$${vals.length}`) }
    if (body.name !== undefined) set('name', body.name)
    if (body.description !== undefined) set('description', body.description)
    if (body.auth !== undefined) set('auth', JSON.stringify(body.auth))
    if (body.variables !== undefined) set('variables', JSON.stringify(body.variables))
    if (body.preRequestScript !== undefined) set('pre_request_script', body.preRequestScript)
    if (body.testScript !== undefined) set('test_script', body.testScript)
    if (body.sortOrder !== undefined) set('sort_order', body.sortOrder)
    if (body.docPublic !== undefined) { set('doc_public', body.docPublic); if (body.docPublic && !before.doc_slug) set('doc_slug', randomToken(12)) }
    set('updated_by', user.id); vals.push(id)
    await q(`UPDATE collections SET ${sets.join(', ')}, updated_at=now() WHERE id=$${vals.length}`, vals)
    audit(req, 'collection.update', { workspaceId, entityType: 'collection', entityId: id })
    return one('SELECT * FROM collections WHERE id=$1', [id])
  })
  app.delete('/collections/:id', async (req) => {
    const { id } = req.params as any
    const { workspaceId } = await requireCollection(req, id, 'editor')
    const col = await one<any>('SELECT name FROM collections WHERE id=$1', [id])
    await q('DELETE FROM collections WHERE id=$1', [id])
    audit(req, 'collection.delete', { workspaceId, entityType: 'collection', entityId: id, meta: { name: col?.name } })
    return { ok: true }
  })
  // duplicate / fork (optionally into another workspace)
  app.post('/collections/:id/duplicate', async (req) => {
    const { id } = req.params as any
    const { user, workspaceId } = await requireCollection(req, id)
    const body = parse(z.object({ targetWorkspaceId: z.string().uuid().optional(), name: z.string().optional(), fork: z.boolean().optional() }), req.body ?? {})
    const target = body.targetWorkspaceId ?? workspaceId
    await requireWorkspace(req, target, 'editor')
    const tree = await loadTree(id, true)
    const imported = treeToImported(tree)
    imported.name = body.name ?? (body.fork ? `${tree.name} (fork)` : `${tree.name} (copy)`)
    const newId = await tx((c) => insertImported(c, target, imported, user.id, body.fork ? id : undefined))
    audit(req, body.fork ? 'collection.fork' : 'collection.duplicate', { workspaceId: target, entityType: 'collection', entityId: newId, meta: { from: id } })
    return { id: newId }
  })
  // diff a fork against its source (or any two collections) — returns per-request changes
  app.get('/collections/:id/diff/:otherId', async (req) => {
    const { id, otherId } = req.params as any
    await requireCollection(req, id); await requireCollection(req, otherId)
    const a = await loadTree(id, false), b = await loadTree(otherId, false)
    const flat = (t: any) => { const m = new Map<string, any>(); const walk = (fs: any[], rs: any[], p: string) => { for (const r of rs) m.set(p + '/' + r.name, r); for (const f of fs) walk(f.folders, f.requests, p + '/' + f.name) }; walk(t.folders, t.requests, ''); return m }
    const fa = flat(a), fb = flat(b)
    const changes: any[] = []
    const fields = ['method', 'url', 'params', 'headers', 'body', 'auth', 'preRequestScript', 'testScript', 'description', 'settings']
    for (const [p, r] of fa) { const o = fb.get(p); if (!o) changes.push({ path: p, type: 'added', request: r }); else { const diffs = fields.filter((f) => JSON.stringify(r[f]) !== JSON.stringify(o[f])); if (diffs.length) changes.push({ path: p, type: 'modified', fields: diffs, request: r, other: o }) } }
    for (const [p, r] of fb) if (!fa.has(p)) changes.push({ path: p, type: 'removed', other: r })
    return { changes, a: { id: a.id, name: a.name }, b: { id: b.id, name: b.name } }
  })
  // merge: copy request contents from source collection into target by path (fork -> parent "pull request" equivalent)
  app.post('/collections/:id/merge-from/:sourceId', async (req) => {
    const { id, sourceId } = req.params as any
    const { user, workspaceId } = await requireCollection(req, id, 'editor'); await requireCollection(req, sourceId)
    const body = parse(z.object({ paths: z.array(z.string()).optional() }), req.body ?? {})
    const src = await loadTree(sourceId, true)
    const dst = await loadTree(id, true)
    const flat = (t: any) => { const m = new Map<string, { r: any; folder: any }>(); const walk = (fs: any[], rs: any[], p: string, folder: any) => { for (const r of rs) m.set(p + '/' + r.name, { r, folder }); for (const f of fs) walk(f.folders, f.requests, p + '/' + f.name, f) }; walk(t.folders, t.requests, '', null); return m }
    const fs = flat(src), fd = flat(dst)
    let updated = 0, added = 0
    await tx(async (c) => {
      for (const [p, { r }] of fs) {
        if (body.paths && !body.paths.includes(p)) continue
        const d = fd.get(p)
        if (d) {
          await c.query(`UPDATE requests SET method=$1, url=$2, params=$3, headers=$4, body=$5, auth=$6, pre_request_script=$7, test_script=$8, settings=$9, description=$10, updated_at=now(), updated_by=$11 WHERE id=$12`, [r.method, r.url, JSON.stringify(r.params), JSON.stringify(r.headers), JSON.stringify(r.body), JSON.stringify(r.auth), r.preRequestScript, r.testScript, JSON.stringify(r.settings), r.description, user.id, d.r.id])
          updated++
        } else {
          // ensure folder path exists in dst
          const parts = p.split('/').slice(1, -1)
          let parentId: string | null = null
          for (const name of parts) {
            const f: any = await c.query('SELECT id FROM folders WHERE collection_id=$1 AND name=$2 AND parent_id IS NOT DISTINCT FROM $3', [id, name, parentId])
            parentId = f.rows[0]?.id ?? (await c.query('INSERT INTO folders (collection_id, parent_id, name) VALUES ($1,$2,$3) RETURNING id', [id, parentId, name])).rows[0].id
          }
          await c.query(`INSERT INTO requests (collection_id, folder_id, name, description, method, url, params, headers, body, auth, pre_request_script, test_script, settings, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [id, parentId, r.name, r.description, r.method, r.url, JSON.stringify(r.params), JSON.stringify(r.headers), JSON.stringify(r.body), JSON.stringify(r.auth), r.preRequestScript, r.testScript, JSON.stringify(r.settings), user.id])
          added++
        }
      }
    })
    audit(req, 'collection.merge', { workspaceId, entityType: 'collection', entityId: id, meta: { from: sourceId, updated, added } })
    return { updated, added }
  })

  // ---- folders
  app.post('/collections/:id/folders', async (req) => {
    const { id } = req.params as any
    const { workspaceId } = await requireCollection(req, id, 'editor')
    const body = parse(folderBody, req.body)
    const row = await one(`INSERT INTO folders (collection_id, parent_id, name, description, auth, pre_request_script, test_script, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,(SELECT COALESCE(max(sort_order),0)+1 FROM folders WHERE collection_id=$1 AND parent_id IS NOT DISTINCT FROM $2)) RETURNING *`, [id, body.parentId ?? null, body.name, body.description ?? '', JSON.stringify(body.auth ?? { type: 'inherit' }), body.preRequestScript ?? '', body.testScript ?? ''])
    await q('UPDATE collections SET updated_at=now() WHERE id=$1', [id])
    audit(req, 'folder.create', { workspaceId, entityType: 'folder', entityId: row!.id, meta: { name: body.name } })
    return row
  })
  app.get('/folders/:id', async (req) => {
    const { id } = req.params as any
    const f = await one<any>('SELECT * FROM folders WHERE id=$1', [id])
    if (!f) throw notFound()
    await requireCollection(req, f.collection_id)
    return f
  })
  app.patch('/folders/:id', async (req) => {
    const { id } = req.params as any
    const f = await one<any>('SELECT * FROM folders WHERE id=$1', [id])
    if (!f) throw notFound()
    const { user, workspaceId } = await requireCollection(req, f.collection_id, 'editor')
    const body = parse(folderBody.partial().extend({ sortOrder: z.number().int().optional() }), req.body)
    snapshot('folder', id, { name: f.name, description: f.description, auth: f.auth, pre_request_script: f.pre_request_script, test_script: f.test_script }, user.id)
    if (body.parentId === id) throw badRequest('Folder cannot be its own parent')
    await q(`UPDATE folders SET name=COALESCE($1,name), description=COALESCE($2,description), parent_id=CASE WHEN $3::boolean THEN $4::uuid ELSE parent_id END, auth=COALESCE($5,auth), pre_request_script=COALESCE($6,pre_request_script), test_script=COALESCE($7,test_script), sort_order=COALESCE($8,sort_order), updated_at=now() WHERE id=$9`,
      [body.name ?? null, body.description ?? null, body.parentId !== undefined, body.parentId ?? null, body.auth ? JSON.stringify(body.auth) : null, body.preRequestScript ?? null, body.testScript ?? null, body.sortOrder ?? null, id])
    await q('UPDATE collections SET updated_at=now() WHERE id=$1', [f.collection_id])
    audit(req, 'folder.update', { workspaceId, entityType: 'folder', entityId: id })
    return one('SELECT * FROM folders WHERE id=$1', [id])
  })
  app.delete('/folders/:id', async (req) => {
    const { id } = req.params as any
    const f = await one<any>('SELECT * FROM folders WHERE id=$1', [id])
    if (!f) throw notFound()
    const { workspaceId } = await requireCollection(req, f.collection_id, 'editor')
    await q('DELETE FROM folders WHERE id=$1', [id])
    audit(req, 'folder.delete', { workspaceId, entityType: 'folder', entityId: id, meta: { name: f.name } })
    return { ok: true }
  })

  // ---- requests
  app.post('/collections/:id/requests', async (req) => {
    const { id } = req.params as any
    const { user, workspaceId } = await requireCollection(req, id, 'editor')
    const body = parse(requestBody, req.body)
    const row = await one(`INSERT INTO requests (collection_id, folder_id, name, description, method, url, params, headers, body, auth, pre_request_script, test_script, settings, updated_by, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,(SELECT COALESCE(max(sort_order),0)+1 FROM requests WHERE collection_id=$1 AND folder_id IS NOT DISTINCT FROM $2)) RETURNING *`,
      [id, body.folderId ?? null, body.name, body.description ?? '', (body.method ?? 'GET').toUpperCase(), body.url ?? '', JSON.stringify(body.params ?? []), JSON.stringify(body.headers ?? []), JSON.stringify(body.body ?? { mode: 'none' }), JSON.stringify(body.auth ?? { type: 'inherit' }), body.preRequestScript ?? '', body.testScript ?? '', JSON.stringify(body.settings ?? {}), user.id])
    await q('UPDATE collections SET updated_at=now() WHERE id=$1', [id])
    audit(req, 'request.create', { workspaceId, entityType: 'request', entityId: row!.id, meta: { name: body.name } })
    return row
  })
  app.get('/requests/:id', async (req) => {
    const { id } = req.params as any
    const r = await one<any>('SELECT * FROM requests WHERE id=$1', [id])
    if (!r) throw notFound()
    await requireCollection(req, r.collection_id)
    const examples = await q('SELECT * FROM examples WHERE request_id=$1 ORDER BY sort_order, created_at', [id])
    return { ...r, examples }
  })
  app.patch('/requests/:id', async (req) => {
    const { id } = req.params as any
    const r = await one<any>('SELECT * FROM requests WHERE id=$1', [id])
    if (!r) throw notFound()
    const { user, workspaceId } = await requireCollection(req, r.collection_id, 'editor')
    const body = parse(requestBody.partial().extend({ sortOrder: z.number().int().optional(), collectionId: z.string().uuid().optional(), message: z.string().max(500).optional() }), req.body)
    snapshot('request', id, { name: r.name, description: r.description, method: r.method, url: r.url, params: r.params, headers: r.headers, body: r.body, auth: r.auth, pre_request_script: r.pre_request_script, test_script: r.test_script, settings: r.settings }, user.id, body.message)
    if (body.collectionId && body.collectionId !== r.collection_id) await requireCollection(req, body.collectionId, 'editor')
    await q(`UPDATE requests SET name=COALESCE($1,name), description=COALESCE($2,description), folder_id=CASE WHEN $3::boolean THEN $4::uuid ELSE folder_id END, method=COALESCE($5,method), url=COALESCE($6,url), params=COALESCE($7,params), headers=COALESCE($8,headers), body=COALESCE($9,body), auth=COALESCE($10,auth), pre_request_script=COALESCE($11,pre_request_script), test_script=COALESCE($12,test_script), settings=COALESCE($13,settings), sort_order=COALESCE($14,sort_order), collection_id=COALESCE($15,collection_id), updated_at=now(), updated_by=$16 WHERE id=$17`,
      [body.name ?? null, body.description ?? null, body.folderId !== undefined, body.folderId ?? null, body.method?.toUpperCase() ?? null, body.url ?? null, body.params ? JSON.stringify(body.params) : null, body.headers ? JSON.stringify(body.headers) : null, body.body ? JSON.stringify(body.body) : null, body.auth ? JSON.stringify(body.auth) : null, body.preRequestScript ?? null, body.testScript ?? null, body.settings ? JSON.stringify(body.settings) : null, body.sortOrder ?? null, body.collectionId ?? null, user.id, id])
    await q('UPDATE collections SET updated_at=now() WHERE id=$1', [r.collection_id])
    audit(req, 'request.update', { workspaceId, entityType: 'request', entityId: id, meta: { name: body.name ?? r.name } })
    return one('SELECT * FROM requests WHERE id=$1', [id])
  })
  app.delete('/requests/:id', async (req) => {
    const { id } = req.params as any
    const r = await one<any>('SELECT * FROM requests WHERE id=$1', [id])
    if (!r) throw notFound()
    const { workspaceId } = await requireCollection(req, r.collection_id, 'editor')
    await q('DELETE FROM requests WHERE id=$1', [id])
    audit(req, 'request.delete', { workspaceId, entityType: 'request', entityId: id, meta: { name: r.name } })
    return { ok: true }
  })
  app.post('/requests/:id/duplicate', async (req) => {
    const { id } = req.params as any
    const r = await one<any>('SELECT * FROM requests WHERE id=$1', [id])
    if (!r) throw notFound()
    const { user } = await requireCollection(req, r.collection_id, 'editor')
    const row = await one(`INSERT INTO requests (collection_id, folder_id, name, description, method, url, params, headers, body, auth, pre_request_script, test_script, settings, updated_by, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`, [r.collection_id, r.folder_id, r.name + ' (copy)', r.description, r.method, r.url, JSON.stringify(r.params), JSON.stringify(r.headers), JSON.stringify(r.body), JSON.stringify(r.auth), r.pre_request_script, r.test_script, JSON.stringify(r.settings), user.id, r.sort_order + 1])
    return row
  })
  // bulk reorder / move
  app.post('/collections/:id/reorder', async (req) => {
    const { id } = req.params as any
    await requireCollection(req, id, 'editor')
    const body = parse(z.object({ items: z.array(z.object({ type: z.enum(['folder', 'request']), id: z.string().uuid(), parentId: z.string().uuid().nullable(), sortOrder: z.number().int() })) }), req.body)
    await tx(async (c) => {
      for (const it of body.items) {
        if (it.type === 'folder') await c.query('UPDATE folders SET parent_id=$1, sort_order=$2 WHERE id=$3 AND collection_id=$4', [it.parentId, it.sortOrder, it.id, id])
        else await c.query('UPDATE requests SET folder_id=$1, sort_order=$2 WHERE id=$3 AND collection_id=$4', [it.parentId, it.sortOrder, it.id, id])
      }
    })
    return { ok: true }
  })
  app.post('/collections/:id/sort', async (req) => {
    const { id } = req.params as any
    await requireCollection(req, id, 'editor')
    const body = parse(z.object({ folderId: z.string().uuid().nullable().optional(), by: z.enum(['name', 'method']).default('name'), recursive: z.boolean().optional() }), req.body ?? {})
    const sortIn = async (folderId: string | null) => {
      const rs = await q<any>('SELECT id, name, method FROM requests WHERE collection_id=$1 AND folder_id IS NOT DISTINCT FROM $2', [id, folderId])
      rs.sort((a, b) => (body.by === 'method' ? a.method.localeCompare(b.method) || a.name.localeCompare(b.name) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })))
      const fs = await q<any>('SELECT id, name FROM folders WHERE collection_id=$1 AND parent_id IS NOT DISTINCT FROM $2', [id, folderId])
      fs.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
      let i = 0
      for (const f of fs) await q('UPDATE folders SET sort_order=$1 WHERE id=$2', [i++, f.id])
      for (const r of rs) await q('UPDATE requests SET sort_order=$1 WHERE id=$2', [i++, r.id])
      if (body.recursive) for (const f of fs) await sortIn(f.id)
    }
    await sortIn(body.folderId ?? null)
    return { ok: true }
  })

  // ---- examples
  app.post('/requests/:id/examples', async (req) => {
    const { id } = req.params as any
    const r = await one<any>('SELECT collection_id FROM requests WHERE id=$1', [id])
    if (!r) throw notFound()
    await requireCollection(req, r.collection_id, 'editor')
    const body = parse(exampleBody, req.body)
    return one(`INSERT INTO examples (request_id, name, request, status, status_text, headers, body, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,(SELECT COALESCE(max(sort_order),0)+1 FROM examples WHERE request_id=$1)) RETURNING *`, [id, body.name, JSON.stringify(body.request ?? {}), body.status ?? 200, body.statusText ?? 'OK', JSON.stringify(body.headers ?? []), body.body ?? ''])
  })
  app.patch('/examples/:id', async (req) => {
    const { id } = req.params as any
    const e = await one<any>('SELECT e.*, r.collection_id FROM examples e JOIN requests r ON r.id=e.request_id WHERE e.id=$1', [id])
    if (!e) throw notFound()
    await requireCollection(req, e.collection_id, 'editor')
    const body = parse(exampleBody.partial(), req.body)
    await q(`UPDATE examples SET name=COALESCE($1,name), request=COALESCE($2,request), status=COALESCE($3,status), status_text=COALESCE($4,status_text), headers=COALESCE($5,headers), body=COALESCE($6,body) WHERE id=$7`, [body.name ?? null, body.request ? JSON.stringify(body.request) : null, body.status ?? null, body.statusText ?? null, body.headers ? JSON.stringify(body.headers) : null, body.body ?? null, id])
    return one('SELECT * FROM examples WHERE id=$1', [id])
  })
  app.delete('/examples/:id', async (req) => {
    const { id } = req.params as any
    const e = await one<any>('SELECT e.*, r.collection_id FROM examples e JOIN requests r ON r.id=e.request_id WHERE e.id=$1', [id])
    if (!e) throw notFound()
    await requireCollection(req, e.collection_id, 'editor')
    await q('DELETE FROM examples WHERE id=$1', [id])
    return { ok: true }
  })

  // ---- revisions (version history)
  app.get('/revisions/:type/:id', async (req) => {
    const { type, id } = req.params as any
    const colId = await entityCollection(type, id)
    await requireCollection(req, colId)
    return q(`SELECT r.id, r.message, r.created_at, r.data, u.name as user_name, u.email as user_email FROM revisions r LEFT JOIN users u ON u.id=r.user_id WHERE r.entity_type=$1 AND r.entity_id=$2 ORDER BY r.created_at DESC LIMIT 100`, [type, id])
  })
  app.post('/revisions/:type/:id/restore/:revId', async (req) => {
    const { type, id, revId } = req.params as any
    const colId = await entityCollection(type, id)
    const { user, workspaceId } = await requireCollection(req, colId, 'editor')
    const rev = await one<any>('SELECT data FROM revisions WHERE id=$1 AND entity_type=$2 AND entity_id=$3', [revId, type, id])
    if (!rev) throw notFound()
    const d = rev.data
    if (type === 'request') {
      const cur = await one<any>('SELECT * FROM requests WHERE id=$1', [id])
      snapshot('request', id, { name: cur.name, description: cur.description, method: cur.method, url: cur.url, params: cur.params, headers: cur.headers, body: cur.body, auth: cur.auth, pre_request_script: cur.pre_request_script, test_script: cur.test_script, settings: cur.settings }, user.id, 'before restore')
      await q(`UPDATE requests SET name=$1, description=$2, method=$3, url=$4, params=$5, headers=$6, body=$7, auth=$8, pre_request_script=$9, test_script=$10, settings=$11, updated_at=now(), updated_by=$12 WHERE id=$13`, [d.name, d.description ?? '', d.method, d.url, JSON.stringify(d.params ?? []), JSON.stringify(d.headers ?? []), JSON.stringify(d.body ?? { mode: 'none' }), JSON.stringify(d.auth ?? { type: 'inherit' }), d.pre_request_script ?? '', d.test_script ?? '', JSON.stringify(d.settings ?? {}), user.id, id])
    } else if (type === 'collection') {
      await q(`UPDATE collections SET name=$1, description=$2, auth=$3, variables=$4, pre_request_script=$5, test_script=$6, updated_at=now(), updated_by=$7 WHERE id=$8`, [d.name, d.description ?? '', JSON.stringify(d.auth ?? { type: 'none' }), JSON.stringify(d.variables ?? []), d.pre_request_script ?? '', d.test_script ?? '', user.id, id])
    } else if (type === 'folder') {
      await q(`UPDATE folders SET name=$1, description=$2, auth=$3, pre_request_script=$4, test_script=$5, updated_at=now() WHERE id=$6`, [d.name, d.description ?? '', JSON.stringify(d.auth ?? { type: 'inherit' }), d.pre_request_script ?? '', d.test_script ?? '', id])
    }
    audit(req, 'revision.restore', { workspaceId, entityType: type, entityId: id, meta: { revisionId: revId } })
    return { ok: true }
  })

  // ---- comments
  app.get('/comments/:type/:id', async (req) => {
    const { type, id } = req.params as any
    const colId = await entityCollection(type, id)
    await requireCollection(req, colId)
    return q(`SELECT c.*, u.name as user_name, u.email as user_email FROM comments c LEFT JOIN users u ON u.id=c.user_id WHERE c.entity_type=$1 AND c.entity_id=$2 ORDER BY c.created_at`, [type, id])
  })
  app.post('/comments/:type/:id', async (req) => {
    const { type, id } = req.params as any
    const colId = await entityCollection(type, id)
    const { user, workspaceId } = await requireCollection(req, colId, 'viewer')
    const body = parse(z.object({ body: z.string().min(1).max(10000) }), req.body)
    const row = await one(`INSERT INTO comments (workspace_id, entity_type, entity_id, user_id, body) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [workspaceId, type, id, user.id, body.body])
    audit(req, 'comment.create', { workspaceId, entityType: type, entityId: id })
    return row
  })
  app.patch('/comments/:id', async (req) => {
    const { id } = req.params as any
    const c = await one<any>('SELECT * FROM comments WHERE id=$1', [id])
    if (!c) throw notFound()
    const u = await requireWorkspace(req, c.workspace_id, 'viewer')
    const body = parse(z.object({ body: z.string().min(1).max(10000).optional(), resolved: z.boolean().optional() }), req.body)
    if (body.body !== undefined && c.user_id !== u.id && u.role !== 'admin') throw badRequest('Only the author can edit a comment')
    await q('UPDATE comments SET body=COALESCE($1,body), resolved=COALESCE($2,resolved) WHERE id=$3', [body.body ?? null, body.resolved ?? null, id])
    return one('SELECT * FROM comments WHERE id=$1', [id])
  })
  app.delete('/comments/:id', async (req) => {
    const { id } = req.params as any
    const c = await one<any>('SELECT * FROM comments WHERE id=$1', [id])
    if (!c) throw notFound()
    const u = await requireWorkspace(req, c.workspace_id, 'viewer')
    if (c.user_id !== u.id && u.role !== 'admin') await requireWorkspace(req, c.workspace_id, 'admin')
    await q('DELETE FROM comments WHERE id=$1', [id])
    return { ok: true }
  })

  // ---- search
  app.get('/workspaces/:wsId/search', async (req) => {
    const { wsId } = req.params as any
    await requireWorkspace(req, wsId)
    const qs = String((req.query as any).q ?? '').trim()
    if (!qs) return { requests: [], collections: [], folders: [], environments: [] }
    const like = `%${qs.replace(/[%_]/g, (m) => '\\' + m)}%`
    const [requests, collections, folders, environments] = await Promise.all([
      q(`SELECT r.id, r.name, r.method, r.url, r.collection_id, c.name as collection_name FROM requests r JOIN collections c ON c.id=r.collection_id WHERE c.workspace_id=$1 AND (r.name ILIKE $2 OR r.url ILIKE $2 OR r.description ILIKE $2 OR r.test_script ILIKE $2 OR r.pre_request_script ILIKE $2 OR r.headers::text ILIKE $2 OR r.body::text ILIKE $2) ORDER BY r.name LIMIT 50`, [wsId, like]),
      q(`SELECT id, name FROM collections WHERE workspace_id=$1 AND (name ILIKE $2 OR description ILIKE $2) LIMIT 20`, [wsId, like]),
      q(`SELECT f.id, f.name, f.collection_id FROM folders f JOIN collections c ON c.id=f.collection_id WHERE c.workspace_id=$1 AND f.name ILIKE $2 LIMIT 20`, [wsId, like]),
      q(`SELECT id, name FROM environments WHERE workspace_id=$1 AND (name ILIKE $2 OR variables::text ILIKE $2) LIMIT 20`, [wsId, like]),
    ])
    return { requests, collections, folders, environments }
  })

  // ---- import
  app.post('/workspaces/:wsId/import', async (req) => {
    const { wsId } = req.params as any
    const u = await requireWorkspace(req, wsId, 'editor')
    const body = parse(z.object({ content: z.string().max(50_000_000).optional(), url: z.string().url().optional(), files: z.array(z.object({ name: z.string(), content: z.string() })).optional(), filename: z.string().optional() }), req.body)
    let result
    if (body.files?.length) result = importFiles(body.files)
    else if (body.content) result = detectAndImport(body.content, body.filename)
    else if (body.url) {
      const { sendHttp } = await import('../engine/http.js')
      const res = await sendHttp({ method: 'GET', url: body.url, headers: { accept: 'application/json, application/yaml, text/yaml, */*' }, settings: { followRedirects: true, maxRedirects: 5, verifyTls: true, timeoutMs: 30000 } }, {})
      if (res.status >= 400) throw badRequest(`Fetching URL failed with status ${res.status}`)
      result = detectAndImport(res.body, body.url)
      // OpenAPI servers may be relative ("/api/v3"); resolve against the spec URL
      const origin = new URL(body.url).origin
      for (const col of result.collections) for (const v of col.variables ?? []) if (v.key === 'baseUrl' && v.value.startsWith('/')) v.value = origin + v.value
    } else throw badRequest('Provide content, url or files')
    const ids: string[] = []
    const envIds: string[] = []
    await tx(async (c) => {
      for (const col of result.collections) ids.push(await insertImported(c, wsId, col, u.id))
      for (const env of result.environments) {
        const { encryptVars } = await import('../lib/loaders.js')
        const r = await c.query('INSERT INTO environments (workspace_id, name, variables) VALUES ($1,$2,$3) RETURNING id', [wsId, env.name, JSON.stringify(encryptVars(env.variables))])
        envIds.push(r.rows[0].id)
      }
    })
    audit(req, 'import', { workspaceId: wsId, meta: { format: result.format, collections: ids.length, environments: envIds.length } })
    return { format: result.format, collectionIds: ids, environmentIds: envIds }
  })
  // preview import without saving
  app.post('/import/parse-curl', async (req) => {
    requireUser(req)
    const body = parse(z.object({ content: z.string().max(1_000_000) }), req.body)
    const { importCurl } = await import('../import/curl.js')
    const r = importCurl(body.content)
    const first = (f: any): any => f.requests?.[0] ?? (f.folders ?? []).map(first).find(Boolean)
    const reqDef = r.collections.map(first).find(Boolean)
    if (!reqDef) throw badRequest('No request found in the cURL command')
    return reqDef
  })
  app.post('/import/preview', async (req) => {
    requireUser(req)
    const body = parse(z.object({ content: z.string().max(50_000_000), filename: z.string().optional() }), req.body)
    const r = detectAndImport(body.content, body.filename)
    const count = (c: ImportedCollection) => { let n = 0; const walk = (f: ImportedFolder | ImportedCollection) => { n += f.requests.length; f.folders.forEach(walk) }; walk(c); return n }
    return { format: r.format, collections: r.collections.map((c) => ({ name: c.name, requests: count(c) })), environments: r.environments.map((e) => ({ name: e.name, variables: e.variables.length })) }
  })

  // ---- export
  app.get('/collections/:id/export', async (req, reply) => {
    const { id } = req.params as any
    const { workspaceId } = await requireCollection(req, id)
    const format = String((req.query as any).format ?? 'postman')
    const tree = await loadTree(id, true)
    const safe = tree.name.replace(/[^\w.-]+/g, '_')
    audit(req, 'collection.export', { workspaceId, entityType: 'collection', entityId: id, meta: { format } })
    if (format === 'openapi') { reply.header('content-disposition', `attachment; filename="${safe}.openapi.json"`); return exportOpenApi(tree) }
    if (format === 'quiver') { reply.header('content-disposition', `attachment; filename="${safe}.quiver.json"`); return exportQuiver([tree], []) }
    if (format === 'files') { return { files: exportPlainText(tree) } }
    reply.header('content-disposition', `attachment; filename="${safe}.postman_collection.json"`)
    return exportPostmanCollection(tree)
  })
  app.get('/workspaces/:wsId/export', async (req, reply) => {
    const { wsId } = req.params as any
    await requireWorkspace(req, wsId)
    const cols = await q<any>('SELECT id FROM collections WHERE workspace_id=$1 ORDER BY sort_order', [wsId])
    const trees = []
    for (const c of cols) trees.push(await loadTree(c.id, true))
    const { decryptVars } = await import('../lib/loaders.js')
    const includeSecrets = (req.query as any).secrets === 'true'
    const envs = (await q<any>('SELECT id, name, variables, is_global FROM environments WHERE workspace_id=$1', [wsId])).map((e) => ({ id: e.id, name: e.is_global ? 'Globals' : e.name, variables: (includeSecrets ? decryptVars(e.variables) : e.variables).map((v: any) => (v.type === 'secret' && !includeSecrets ? { ...v, value: '' } : v)) }))
    audit(req, 'workspace.export', { workspaceId: wsId, meta: { includeSecrets } })
    reply.header('content-disposition', `attachment; filename="workspace-export.quiver.json"`)
    return exportQuiver(trees, envs)
  })

  // ---- docs (authenticated JSON; public variant in docs route)
  app.get('/collections/:id/docs', async (req) => {
    const { id } = req.params as any
    await requireCollection(req, id)
    return loadTree(id, true)
  })
}

async function entityCollection(type: string, id: string): Promise<string> {
  if (type === 'collection') return id
  if (type === 'folder') { const f = await one<any>('SELECT collection_id FROM folders WHERE id=$1', [id]); if (!f) throw notFound(); return f.collection_id }
  if (type === 'request') { const r = await one<any>('SELECT collection_id FROM requests WHERE id=$1', [id]); if (!r) throw notFound(); return r.collection_id }
  throw badRequest('Unknown entity type')
}

export function treeToImported(t: any): ImportedCollection {
  const req = (r: any): ImportedRequest => ({ name: r.name, description: r.description, method: r.method, url: r.url, params: r.params, headers: r.headers, body: r.body, auth: r.auth, preRequestScript: r.preRequestScript, testScript: r.testScript, settings: r.settings, examples: (r.examples ?? []).map((e: any) => ({ name: e.name, request: e.request, status: e.status, statusText: e.statusText, headers: e.headers, body: e.body })) })
  const folder = (f: any): ImportedFolder => ({ name: f.name, description: f.description, auth: f.auth, preRequestScript: f.preRequestScript, testScript: f.testScript, folders: f.folders.map(folder), requests: f.requests.map(req) })
  return { name: t.name, description: t.description, auth: t.auth, variables: t.variables, preRequestScript: t.preRequestScript, testScript: t.testScript, folders: t.folders.map(folder), requests: t.requests.map(req) }
}
