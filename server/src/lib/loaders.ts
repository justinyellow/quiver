import { one, q } from '../db/index.js'
import { decrypt, encrypt, isEncrypted } from './crypto.js'
import type { AuthConfig, RequestDef, ScopeSet, Variable } from '../engine/types.js'
import type { TreeCollection, TreeFolder } from '../engine/runner.js'
import type { ExportCollection, ExportFolder, ExportRequest } from '../export/types.js'
import { emptyScopes, varsToMap } from '../engine/variables.js'
import { notFound } from './errors.js'

export function rowToRequestDef(r: any): RequestDef {
  return { id: r.id, name: r.name, description: r.description, method: r.method, url: r.url, params: r.params ?? [], headers: r.headers ?? [], body: r.body ?? { mode: 'none' }, auth: r.auth ?? { type: 'inherit' }, preRequestScript: r.pre_request_script ?? '', testScript: r.test_script ?? '', settings: r.settings ?? {} }
}

/** Load a full collection tree (folders + requests, ordered). */
export async function loadTree(collectionId: string, withExamples = false): Promise<ExportCollection & TreeCollection> {
  const col = await one<any>('SELECT * FROM collections WHERE id=$1', [collectionId])
  if (!col) throw notFound('Collection not found')
  const folders = await q<any>('SELECT * FROM folders WHERE collection_id=$1 ORDER BY sort_order, created_at', [collectionId])
  const requests = await q<any>('SELECT * FROM requests WHERE collection_id=$1 ORDER BY sort_order, created_at', [collectionId])
  const examples = withExamples ? await q<any>('SELECT e.* FROM examples e JOIN requests r ON r.id=e.request_id WHERE r.collection_id=$1 ORDER BY e.sort_order, e.created_at', [collectionId]) : []
  const exByReq = new Map<string, any[]>()
  for (const e of examples) (exByReq.get(e.request_id) ?? exByReq.set(e.request_id, []).get(e.request_id)!).push(e)
  const toReq = (r: any): ExportRequest & RequestDef => ({ ...rowToRequestDef(r), id: r.id, description: r.description ?? '', preRequestScript: r.pre_request_script ?? '', testScript: r.test_script ?? '', settings: r.settings ?? {}, examples: (exByReq.get(r.id) ?? []).map((e) => ({ id: e.id, name: e.name, request: e.request ?? {}, status: e.status, statusText: e.status_text, headers: e.headers ?? [], body: e.body ?? '' })) })
  const build = (parentId: string | null): (ExportFolder & TreeFolder)[] =>
    folders.filter((f) => (f.parent_id ?? null) === parentId).map((f) => ({ id: f.id, name: f.name, description: f.description ?? '', auth: f.auth ?? { type: 'inherit' }, preRequestScript: f.pre_request_script ?? '', testScript: f.test_script ?? '', folders: build(f.id), requests: requests.filter((r) => r.folder_id === f.id).map(toReq) }))
  return {
    id: col.id, name: col.name, description: col.description ?? '', auth: col.auth ?? { type: 'none' }, variables: col.variables ?? [],
    preRequestScript: col.pre_request_script ?? '', testScript: col.test_script ?? '',
    folders: build(null), requests: requests.filter((r) => !r.folder_id).map(toReq),
  } as any
}

/** Ancestor folder chain (outermost first) for a request's folder. */
export async function folderChain(folderId: string | null): Promise<{ id: string; name: string; auth?: AuthConfig; preRequestScript?: string; testScript?: string }[]> {
  const chain: any[] = []
  let cur = folderId
  let guard = 0
  while (cur && guard++ < 50) {
    const f = await one<any>('SELECT id, name, parent_id, auth, pre_request_script, test_script FROM folders WHERE id=$1', [cur])
    if (!f) break
    chain.unshift({ id: f.id, name: f.name, auth: f.auth, preRequestScript: f.pre_request_script, testScript: f.test_script })
    cur = f.parent_id
  }
  return chain
}

export function decryptVars(vars: Variable[]): Variable[] {
  return (vars ?? []).map((v) => ({ ...v, value: isEncrypted(v.value) ? decrypt(v.value) : v.value }))
}
export function encryptVars(vars: Variable[]): Variable[] {
  return (vars ?? []).map((v) => (v.type === 'secret' && v.value && !isEncrypted(v.value) ? { ...v, value: encrypt(v.value) } : v))
}
export function maskVars(vars: Variable[]): Variable[] {
  return (vars ?? []).map((v) => (v.type === 'secret' ? { ...v, value: v.value ? '••••••••' : '', masked: true } as any : v))
}

/** Build variable scopes for execution: globals + collection + environment (+ overlays). Secrets decrypted. */
export async function buildScopes(workspaceId: string, collectionId: string | null, environmentId: string | null, overlayIds: string[] = []): Promise<{ scopes: ScopeSet; environmentName?: string; globalsId?: string }> {
  const scopes = emptyScopes()
  const g = await one<any>('SELECT id, variables FROM environments WHERE workspace_id=$1 AND is_global=true', [workspaceId])
  if (g) scopes.globals = varsToMap(decryptVars(g.variables))
  if (collectionId) {
    const c = await one<any>('SELECT variables FROM collections WHERE id=$1', [collectionId])
    if (c) scopes.collection = varsToMap(decryptVars(c.variables))
  }
  let environmentName: string | undefined
  for (const id of [environmentId, ...overlayIds]) {
    if (!id) continue
    const e = await one<any>('SELECT name, variables FROM environments WHERE id=$1 AND workspace_id=$2', [id, workspaceId])
    if (!e) continue
    environmentName ??= e.name
    Object.assign(scopes.environment, varsToMap(decryptVars(e.variables)))
  }
  return { scopes, environmentName, globalsId: g?.id }
}

/** Persist variable mutations from scripts back to DB (keeps secret flags; new vars default type). */
export async function persistVarMutations(workspaceId: string, collectionId: string | null, environmentId: string | null, m: { globals: Record<string, string | null>; collection: Record<string, string | null>; environment: Record<string, string | null> }) {
  const apply = (vars: Variable[], mut: Record<string, string | null>): Variable[] => {
    let out = decryptVars(vars ?? [])
    for (const [k, v] of Object.entries(mut)) {
      if (v === null) { out = out.filter((x) => x.key !== k); continue }
      const i = out.findIndex((x) => x.key === k)
      if (i >= 0) out[i] = { ...out[i], value: v, enabled: true }
      else out.push({ key: k, value: v, type: 'default', enabled: true })
    }
    return encryptVars(out)
  }
  if (Object.keys(m.globals).length) {
    const g = await one<any>('SELECT id, variables FROM environments WHERE workspace_id=$1 AND is_global=true', [workspaceId])
    if (g) await q('UPDATE environments SET variables=$1, updated_at=now() WHERE id=$2', [JSON.stringify(apply(g.variables, m.globals)), g.id])
  }
  if (Object.keys(m.collection).length && collectionId) {
    const c = await one<any>('SELECT variables FROM collections WHERE id=$1', [collectionId])
    if (c) await q('UPDATE collections SET variables=$1, updated_at=now() WHERE id=$2', [JSON.stringify(apply(c.variables, m.collection)), collectionId])
  }
  if (Object.keys(m.environment).length && environmentId) {
    const e = await one<any>('SELECT variables FROM environments WHERE id=$1', [environmentId])
    if (e) await q('UPDATE environments SET variables=$1, updated_at=now() WHERE id=$2', [JSON.stringify(apply(e.variables, m.environment)), environmentId])
  }
}

export async function persistUpdatedAuth(u: { holder: 'request' | 'folder' | 'collection'; id?: string; auth: AuthConfig }) {
  if (!u.id) return
  const table = u.holder === 'request' ? 'requests' : u.holder === 'folder' ? 'folders' : 'collections'
  await q(`UPDATE ${table} SET auth=$1 WHERE id=$2`, [JSON.stringify(u.auth), u.id])
}

export async function loadCookieJar(workspaceId: string, userId: string) {
  const row = await one<any>('SELECT cookies FROM cookie_jars WHERE workspace_id=$1 AND user_id=$2', [workspaceId, userId])
  return (row?.cookies ?? []) as any[]
}
export async function saveCookieJar(workspaceId: string, userId: string, cookies: any[]) {
  await q(`INSERT INTO cookie_jars (workspace_id, user_id, cookies, updated_at) VALUES ($1,$2,$3,now()) ON CONFLICT (workspace_id, user_id) DO UPDATE SET cookies=EXCLUDED.cookies, updated_at=now()`, [workspaceId, userId, JSON.stringify(cookies)])
}
