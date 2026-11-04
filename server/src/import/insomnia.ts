import type { AuthConfig, KV, RequestBody, RequestSettings, Variable } from '../engine/types.js'
import type { ImportResult, ImportedCollection, ImportedFolder, ImportedRequest } from './types.js'

type AnyObj = Record<string, any>

function str(v: any): string {
  if (v == null) return ''
  return typeof v === 'string' ? v : String(v)
}

export function convertTemplate(s: string): string {
  return s.replace(/\{\{\s*_\.([A-Za-z0-9_.-]+)\s*\}\}/g, '{{$1}}').replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, '{{$1}}')
}

function kvs(list: any, opts: { file?: boolean } = {}): KV[] {
  if (!Array.isArray(list)) return []
  const out: KV[] = []
  for (const p of list) {
    if (!p || typeof p !== 'object' || p.name == null) continue
    const kv: KV = { key: convertTemplate(str(p.name)), value: convertTemplate(str(p.value)), enabled: !p.disabled }
    if (p.description) kv.description = str(p.description)
    if (opts.file && p.type === 'file') {
      kv.type = 'file'
      kv.value = ''
      if (p.fileName) kv.src = str(p.fileName)
    }
    out.push(kv)
  }
  return out
}

function bodyOf(b: any): RequestBody {
  if (!b || typeof b !== 'object' || !Object.keys(b).length) return { mode: 'none' }
  const mime = str(b.mimeType).toLowerCase()
  if (mime.includes('x-www-form-urlencoded')) return { mode: 'urlencoded', urlencoded: kvs(b.params) }
  if (mime.includes('multipart')) return { mode: 'formdata', formdata: kvs(b.params, { file: true }) }
  if (mime.includes('graphql')) {
    let query = ''
    let variables: string | undefined
    try {
      const parsed = JSON.parse(str(b.text))
      query = str(parsed.query)
      variables = parsed.variables == null ? undefined : typeof parsed.variables === 'string' ? parsed.variables : JSON.stringify(parsed.variables, null, 2)
    } catch { query = str(b.text) }
    return { mode: 'graphql', graphql: { query: convertTemplate(query), variables: variables ? convertTemplate(variables) : undefined } }
  }
  if (mime.includes('octet-stream') || b.fileName) return { mode: 'binary', binary: { name: str(b.fileName), contentType: mime || undefined, data: '' } }
  const text = convertTemplate(str(b.text))
  if (mime.includes('json')) return { mode: 'json', raw: text, language: 'json' }
  if (mime.includes('xml')) return { mode: 'xml', raw: text, language: 'xml' }
  if (mime.includes('html')) return { mode: 'html', raw: text, language: 'html' }
  if (mime.startsWith('text/')) return { mode: 'text', raw: text, language: 'text' }
  return text ? { mode: 'raw', raw: text } : { mode: 'none' }
}

function authOf(a: any): AuthConfig | undefined {
  if (!a || typeof a !== 'object' || !a.type) return undefined
  if (a.disabled) return { type: 'none' }
  const t = str(a.type).toLowerCase()
  const c = (v: any) => convertTemplate(str(v))
  switch (t) {
    case 'none': return { type: 'none' }
    case 'basic': return { type: 'basic', basic: { username: c(a.username), password: c(a.password) } }
    case 'bearer': return { type: 'bearer', bearer: { token: c(a.token), prefix: a.prefix ? c(a.prefix) : undefined } }
    case 'apikey': return { type: 'apikey', apikey: { key: c(a.key), value: c(a.value), in: a.addTo === 'queryParams' ? 'query' : 'header' } }
    case 'digest': return { type: 'digest', digest: { username: c(a.username), password: c(a.password) } }
    case 'oauth2': {
      const gt = str(a.grantType)
      const grantType: NonNullable<AuthConfig['oauth2']>['grantType'] =
        gt === 'client_credentials' ? 'client_credentials' : gt === 'password' ? 'password' : gt === 'implicit' ? 'implicit' : 'authorization_code'
      return {
        type: 'oauth2',
        oauth2: {
          grantType,
          accessTokenUrl: a.accessTokenUrl ? c(a.accessTokenUrl) : undefined,
          authUrl: a.authorizationUrl ? c(a.authorizationUrl) : undefined,
          clientId: a.clientId ? c(a.clientId) : undefined,
          clientSecret: a.clientSecret ? c(a.clientSecret) : undefined,
          scope: a.scope ? c(a.scope) : undefined,
          username: a.username ? c(a.username) : undefined,
          password: a.password ? c(a.password) : undefined,
          audience: a.audience ? c(a.audience) : undefined,
          clientAuth: a.credentialsInBody ? 'body' : undefined,
          usePkce: a.usePkce ? true : undefined,
        },
      }
    }
    case 'awsv4':
    case 'iam': return { type: 'awsv4', awsv4: { accessKey: c(a.accessKeyId), secretKey: c(a.secretAccessKey), region: c(a.region), service: c(a.service), sessionToken: a.sessionToken ? c(a.sessionToken) : undefined } }
    default: return undefined
  }
}

function flatten(obj: any, prefix: string, out: Variable[]): void {
  if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) {
    out.push({ key: prefix, value: typeof obj === 'string' ? convertTemplate(obj) : JSON.stringify(obj), enabled: true })
    return
  }
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v != null && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out)
    else out.push({ key, value: typeof v === 'string' ? convertTemplate(v) : v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v), enabled: true })
  }
}

function toRequest(r: AnyObj): ImportedRequest {
  const fullUrl = convertTemplate(str(r.url))
  const qi = fullUrl.indexOf('?')
  const params = kvs(r.parameters)
  const req: ImportedRequest = {
    name: str(r.name || fullUrl || 'Request'),
    method: str(r.method || 'GET').toUpperCase(),
    url: qi >= 0 && params.length ? fullUrl.slice(0, qi) : fullUrl,
    params,
    headers: kvs(r.headers),
    body: bodyOf(r.body),
    auth: authOf(r.authentication) ?? { type: 'inherit' },
  }
  if (r.description) req.description = str(r.description)
  const settings: RequestSettings = {}
  if (r.settingFollowRedirects === 'off') settings.followRedirects = false
  if (r.settingFollowRedirects === 'on') settings.followRedirects = true
  if (r.settingSendCookies === false) settings.sendCookies = false
  if (r.settingEncodeUrl === false) settings.encodeUrl = false
  if (Object.keys(settings).length) req.settings = settings
  return req
}

export function importInsomnia(json: any): ImportResult {
  const resources: AnyObj[] = Array.isArray(json?.resources) ? json.resources : Array.isArray(json) ? json : []
  if (!resources.length) throw new Error('Invalid Insomnia export: no resources')
  const byId = new Map<string, AnyObj>()
  for (const r of resources) if (r && typeof r === 'object' && r._id) byId.set(str(r._id), r)

  const workspaces = resources.filter(r => r._type === 'workspace')
  const groups = resources.filter(r => r._type === 'request_group')
  const requests = resources.filter(r => r._type === 'request')
  const envs = resources.filter(r => r._type === 'environment')

  const sortKey = (r: AnyObj) => typeof r.metaSortKey === 'number' ? r.metaSortKey : 0
  groups.sort((a, b) => sortKey(a) - sortKey(b))
  requests.sort((a, b) => sortKey(a) - sortKey(b))

  const result: ImportResult = { format: 'insomnia', collections: [], environments: [] }
  const colByWs = new Map<string, ImportedCollection>()
  const folderByGroup = new Map<string, ImportedFolder>()

  const rootOf = (r: AnyObj): string => {
    let cur: AnyObj | undefined = r
    let guard = 0
    while (cur && guard++ < 100) {
      if (cur._type === 'workspace') return str(cur._id)
      const parent: AnyObj | undefined = cur.parentId ? byId.get(str(cur.parentId)) : undefined
      if (!parent) return str(cur.parentId || '')
      cur = parent
    }
    return ''
  }

  const collectionFor = (wsId: string): ImportedCollection => {
    let col = colByWs.get(wsId)
    if (!col) {
      const ws = byId.get(wsId)
      col = { name: str(ws?.name || json?.name || 'Imported Insomnia'), variables: [], folders: [], requests: [] }
      if (ws?.description) col.description = str(ws.description)
      colByWs.set(wsId, col)
      result.collections.push(col)
    }
    return col
  }
  for (const ws of workspaces) collectionFor(str(ws._id))

  const folderFor = (g: AnyObj): ImportedFolder => {
    const id = str(g._id)
    let f = folderByGroup.get(id)
    if (f) return f
    f = { name: str(g.name || 'Folder'), folders: [], requests: [] }
    if (g.description) f.description = str(g.description)
    const auth = authOf(g.authentication)
    if (auth) f.auth = auth
    folderByGroup.set(id, f)
    const parent = g.parentId ? byId.get(str(g.parentId)) : undefined
    if (parent && parent._type === 'request_group') folderFor(parent).folders.push(f)
    else collectionFor(rootOf(g)).folders.push(f)
    return f
  }
  for (const g of groups) folderFor(g)

  for (const r of requests) {
    const req = toRequest(r)
    const parent = r.parentId ? byId.get(str(r.parentId)) : undefined
    if (parent && parent._type === 'request_group') folderFor(parent).requests.push(req)
    else collectionFor(rootOf(r)).requests.push(req)
  }

  for (const e of envs) {
    const vars: Variable[] = []
    flatten(e.data ?? {}, '', vars)
    const parent = e.parentId ? byId.get(str(e.parentId)) : undefined
    if (parent && parent._type === 'workspace') {
      const col = collectionFor(str(parent._id))
      col.variables.push(...vars)
      continue
    }
    if (!vars.length) continue
    result.environments.push({ name: str(e.name || 'Environment'), variables: vars })
  }

  return result
}
