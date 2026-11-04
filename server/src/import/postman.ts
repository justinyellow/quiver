import type { AuthConfig, KV, RequestBody, RequestSettings, Variable } from '../engine/types.js'
import type { ImportResult, ImportedCollection, ImportedExample, ImportedFolder, ImportedRequest } from './types.js'

type AnyObj = Record<string, any>

function str(v: any): string {
  if (v == null) return ''
  return typeof v === 'string' ? v : String(v)
}

function descriptionOf(d: any): string | undefined {
  if (d == null) return undefined
  if (typeof d === 'string') return d
  if (typeof d === 'object' && typeof d.content === 'string') return d.content
  return undefined
}

function scriptOf(events: any, type: string): string | undefined {
  if (!Array.isArray(events)) return undefined
  const ev = events.find((e: AnyObj) => e?.listen === type)
  const exec = ev?.script?.exec
  if (exec == null) return undefined
  const text = Array.isArray(exec) ? exec.join('\n') : str(exec)
  return text.trim() ? text : undefined
}

function authParams(a: AnyObj, type: string): Record<string, string> {
  const raw = a[type]
  const out: Record<string, string> = {}
  if (Array.isArray(raw)) {
    for (const p of raw) if (p && p.key != null) out[p.key] = str(p.value)
  } else if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) out[k] = str(v)
  }
  return out
}

export function postmanAuth(a: any): AuthConfig | undefined {
  if (!a || typeof a !== 'object') return undefined
  const type = str(a.type).toLowerCase()
  switch (type) {
    case 'noauth': return { type: 'none' }
    case 'basic': {
      const p = authParams(a, 'basic')
      return { type: 'basic', basic: { username: p.username ?? '', password: p.password ?? '' } }
    }
    case 'bearer': {
      const p = authParams(a, 'bearer')
      return { type: 'bearer', bearer: { token: p.token ?? '' } }
    }
    case 'apikey': {
      const p = authParams(a, 'apikey')
      return { type: 'apikey', apikey: { key: p.key ?? '', value: p.value ?? '', in: p.in === 'query' ? 'query' : 'header' } }
    }
    case 'digest': {
      const p = authParams(a, 'digest')
      return { type: 'digest', digest: { username: p.username ?? '', password: p.password ?? '' } }
    }
    case 'oauth2': {
      const p = authParams(a, 'oauth2')
      const gt = p.grant_type ?? ''
      const grantType: NonNullable<AuthConfig['oauth2']>['grantType'] =
        gt === 'password_credentials' || gt === 'password' ? 'password'
          : gt === 'implicit' ? 'implicit'
            : gt === 'client_credentials' ? 'client_credentials'
              : 'authorization_code'
      return {
        type: 'oauth2',
        oauth2: {
          grantType,
          accessTokenUrl: p.accessTokenUrl || undefined,
          authUrl: p.authUrl || undefined,
          clientId: p.clientId || undefined,
          clientSecret: p.clientSecret || undefined,
          scope: p.scope || undefined,
          username: p.username || undefined,
          password: p.password || undefined,
          audience: p.audience || undefined,
          clientAuth: p.client_authentication === 'body' ? 'body' : p.client_authentication === 'header' ? 'header' : undefined,
          tokenPrefix: p.headerPrefix || undefined,
          addTo: p.addTokenTo === 'queryParams' ? 'query' : p.addTokenTo === 'header' ? 'header' : undefined,
          accessToken: p.accessToken || undefined,
          refreshToken: p.refreshToken || undefined,
        },
      }
    }
    case 'awsv4': {
      const p = authParams(a, 'awsv4')
      return { type: 'awsv4', awsv4: { accessKey: p.accessKey ?? '', secretKey: p.secretKey ?? '', region: p.region ?? '', service: p.service ?? '', sessionToken: p.sessionToken || undefined } }
    }
    default: return undefined
  }
}

function kvList(list: any, opts: { file?: boolean } = {}): KV[] {
  if (!Array.isArray(list)) return []
  const out: KV[] = []
  for (const h of list) {
    if (!h || typeof h !== 'object' || h.key == null) continue
    const kv: KV = { key: str(h.key), value: str(h.value), enabled: !h.disabled }
    const desc = descriptionOf(h.description)
    if (desc) kv.description = desc
    if (opts.file && h.type === 'file') {
      kv.type = 'file'
      kv.value = ''
      const src = Array.isArray(h.src) ? h.src[0] : h.src
      if (src) kv.src = str(src)
    }
    out.push(kv)
  }
  return out
}

export function parseQuery(q: string): KV[] {
  const out: KV[] = []
  for (const part of q.split('&')) {
    if (!part) continue
    const i = part.indexOf('=')
    const k = i < 0 ? part : part.slice(0, i)
    const v = i < 0 ? '' : part.slice(i + 1)
    const dec = (x: string) => { try { return decodeURIComponent(x.replace(/\+/g, ' ')) } catch { return x } }
    out.push({ key: dec(k), value: dec(v), enabled: true })
  }
  return out
}

function urlOf(u: any): { url: string; params: KV[] } {
  if (u == null) return { url: '', params: [] }
  if (typeof u === 'string') return { url: u, params: [] }
  let params = kvList(u.query)
  if (typeof u.raw === 'string' && u.raw) {
    const qi = u.raw.indexOf('?')
    if (qi < 0) return { url: u.raw, params }
    if (!params.length) params = parseQuery(u.raw.slice(qi + 1))
    return { url: u.raw.slice(0, qi), params }
  }
  let url = ''
  if (u.protocol) url += `${u.protocol}://`
  const host = Array.isArray(u.host) ? u.host.join('.') : str(u.host)
  url += host
  if (u.port) url += `:${u.port}`
  const path = Array.isArray(u.path) ? u.path.map((p: any) => (typeof p === 'string' ? p : str(p?.value))).join('/') : str(u.path)
  if (path) url += (path.startsWith('/') ? '' : '/') + path
  if (u.hash) url += `#${u.hash}`
  return { url, params }
}

function bodyOf(b: any): RequestBody {
  if (!b || typeof b !== 'object') return { mode: 'none' }
  const mode = str(b.mode)
  switch (mode) {
    case 'raw': {
      const lang = str(b.options?.raw?.language).toLowerCase()
      const raw = str(b.raw)
      if (lang === 'json') return { mode: 'json', raw, language: 'json' }
      if (lang === 'xml') return { mode: 'xml', raw, language: 'xml' }
      if (lang === 'html') return { mode: 'html', raw, language: 'html' }
      if (lang === 'javascript') return { mode: 'javascript', raw, language: 'javascript' }
      if (lang === 'text') return { mode: 'text', raw, language: 'text' }
      const trimmed = raw.trim()
      if (trimmed && (trimmed.startsWith('{') || trimmed.startsWith('['))) {
        try { JSON.parse(trimmed); return { mode: 'json', raw, language: 'json' } } catch { /* not json */ }
      }
      return { mode: 'raw', raw }
    }
    case 'urlencoded': return { mode: 'urlencoded', urlencoded: kvList(b.urlencoded) }
    case 'formdata': return { mode: 'formdata', formdata: kvList(b.formdata, { file: true }) }
    case 'graphql': {
      const g = b.graphql ?? {}
      const vars = g.variables == null ? undefined : typeof g.variables === 'string' ? g.variables : JSON.stringify(g.variables, null, 2)
      return { mode: 'graphql', graphql: { query: str(g.query), variables: vars, operationName: g.operationName || undefined } }
    }
    case 'file': {
      const src = b.file?.src
      return { mode: 'binary', binary: { name: str(Array.isArray(src) ? src[0] : src), data: '' } }
    }
    default: return { mode: 'none' }
  }
}

function settingsOf(p: any): RequestSettings | undefined {
  if (!p || typeof p !== 'object') return undefined
  const s: RequestSettings = {}
  if (typeof p.followRedirects === 'boolean') s.followRedirects = p.followRedirects
  if (typeof p.strictSSL === 'boolean') s.verifyTls = p.strictSSL
  if (typeof p.disableUrlEncoding === 'boolean') s.encodeUrl = !p.disableUrlEncoding
  if (typeof p.maxRedirects === 'number') s.maxRedirects = p.maxRedirects
  if (typeof p.disableCookies === 'boolean') s.sendCookies = !p.disableCookies
  return Object.keys(s).length ? s : undefined
}

function requestParts(r: any): { method: string; url: string; params: KV[]; headers: KV[]; body: RequestBody; auth?: AuthConfig; description?: string } {
  if (typeof r === 'string') return { method: 'GET', url: r, params: [], headers: [], body: { mode: 'none' } }
  const { url, params } = urlOf(r?.url)
  const headers = typeof r?.header === 'string'
    ? r.header.split('\n').map((l: string) => l.trim()).filter(Boolean).map((l: string) => {
      const i = l.indexOf(':')
      return i < 0 ? { key: l, value: '', enabled: true } : { key: l.slice(0, i).trim(), value: l.slice(i + 1).trim(), enabled: true }
    })
    : kvList(r?.header)
  return {
    method: str(r?.method || 'GET').toUpperCase(),
    url,
    params,
    headers,
    body: bodyOf(r?.body),
    auth: postmanAuth(r?.auth),
    description: descriptionOf(r?.description),
  }
}

function examplesOf(responses: any): ImportedExample[] {
  if (!Array.isArray(responses)) return []
  const out: ImportedExample[] = []
  for (const res of responses) {
    if (!res || typeof res !== 'object') continue
    const orig = requestParts(res.originalRequest ?? {})
    const headers = Array.isArray(res.header) ? kvList(res.header) : []
    out.push({
      name: str(res.name || 'Example'),
      request: { method: orig.method, url: orig.url, headers: orig.headers, body: orig.body.mode === 'none' ? undefined : orig.body },
      status: Number(res.code) || 200,
      statusText: str(res.status),
      headers,
      body: str(res.body),
    })
  }
  return out
}

function importItem(item: any): ImportedRequest | ImportedFolder | null {
  if (!item || typeof item !== 'object') return null
  if (Array.isArray(item.item)) {
    const folder: ImportedFolder = { name: str(item.name || 'Folder'), folders: [], requests: [] }
    const desc = descriptionOf(item.description)
    if (desc) folder.description = desc
    const auth = postmanAuth(item.auth)
    if (auth) folder.auth = auth
    const pre = scriptOf(item.event, 'prerequest')
    const test = scriptOf(item.event, 'test')
    if (pre) folder.preRequestScript = pre
    if (test) folder.testScript = test
    for (const child of item.item) {
      const c = importItem(child)
      if (!c) continue
      if ('folders' in c) folder.folders.push(c)
      else folder.requests.push(c)
    }
    return folder
  }
  if (item.request == null) return null
  const parts = requestParts(item.request)
  const req: ImportedRequest = {
    name: str(item.name || parts.url || 'Request'),
    method: parts.method,
    url: parts.url,
    params: parts.params,
    headers: parts.headers,
    body: parts.body,
    auth: parts.auth ?? { type: 'inherit' },
  }
  const desc = parts.description ?? descriptionOf(item.description)
  if (desc) req.description = desc
  const pre = scriptOf(item.event, 'prerequest')
  const test = scriptOf(item.event, 'test')
  if (pre) req.preRequestScript = pre
  if (test) req.testScript = test
  const settings = settingsOf(item.protocolProfileBehavior)
  if (settings) req.settings = settings
  const examples = examplesOf(item.response)
  if (examples.length) req.examples = examples
  return req
}

function variablesOf(list: any): Variable[] {
  if (!Array.isArray(list)) return []
  const out: Variable[] = []
  for (const v of list) {
    if (!v || typeof v !== 'object' || v.key == null) continue
    const variable: Variable = { key: str(v.key), value: str(v.value), enabled: v.enabled !== false && v.disabled !== true }
    if (v.type === 'secret') variable.type = 'secret'
    out.push(variable)
  }
  return out
}

export function importPostmanCollection(json: any): ImportedCollection {
  const info = json?.info ?? {}
  const col: ImportedCollection = {
    name: str(info.name || json?.name || 'Imported collection'),
    variables: variablesOf(json?.variable),
    folders: [],
    requests: [],
  }
  const desc = descriptionOf(info.description)
  if (desc) col.description = desc
  const auth = postmanAuth(json?.auth)
  if (auth) col.auth = auth
  const pre = scriptOf(json?.event, 'prerequest')
  const test = scriptOf(json?.event, 'test')
  if (pre) col.preRequestScript = pre
  if (test) col.testScript = test
  for (const child of Array.isArray(json?.item) ? json.item : []) {
    const c = importItem(child)
    if (!c) continue
    if ('folders' in c) col.folders.push(c)
    else col.requests.push(c)
  }
  return col
}

export function importPostmanEnvironment(json: any): { name: string; variables: Variable[] } {
  return { name: str(json?.name || 'Imported environment'), variables: variablesOf(json?.values) }
}

export function isPostmanCollection(json: any): boolean {
  if (!json || typeof json !== 'object') return false
  const schema = str(json.info?.schema)
  if (schema.includes('getpostman')) return true
  return !!json.info && Array.isArray(json.item)
}

export function isPostmanEnvironment(json: any): boolean {
  return !!json && typeof json === 'object' && Array.isArray(json.values) && typeof json.name === 'string' && !json.item
}

export function importPostman(json: any): ImportResult {
  const result: ImportResult = { format: 'postman', collections: [], environments: [] }
  if (!json || typeof json !== 'object') throw new Error('Invalid Postman JSON')
  if (Array.isArray(json.collections) || Array.isArray(json.environments)) {
    for (const c of json.collections ?? []) {
      const col = c?.collection ?? c
      if (isPostmanCollection(col)) result.collections.push(importPostmanCollection(col))
    }
    for (const e of json.environments ?? []) {
      const env = e?.environment ?? e
      if (isPostmanEnvironment(env)) result.environments.push(importPostmanEnvironment(env))
    }
    for (const g of Array.isArray(json.globals) ? json.globals : json.globals ? [json.globals] : []) {
      if (isPostmanEnvironment(g)) result.environments.push(importPostmanEnvironment(g))
    }
    return result
  }
  if (json.collection && isPostmanCollection(json.collection)) {
    result.collections.push(importPostmanCollection(json.collection))
    return result
  }
  if (isPostmanCollection(json)) {
    result.collections.push(importPostmanCollection(json))
    return result
  }
  if (isPostmanEnvironment(json)) {
    result.environments.push(importPostmanEnvironment(json))
    return result
  }
  throw new Error('Unrecognised Postman JSON')
}
