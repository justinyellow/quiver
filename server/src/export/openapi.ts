import type { AuthConfig, KV, RequestBody } from '../engine/types.js'
import type { ExportCollection, ExportFolder, ExportRequest } from './types.js'

type AnyObj = Record<string, any>

export function schemaFromExample(value: any): AnyObj {
  if (value === null || value === undefined) return { nullable: true }
  if (Array.isArray(value)) {
    return { type: 'array', items: value.length ? schemaFromExample(value[0]) : {} }
  }
  switch (typeof value) {
    case 'string': {
      const s: AnyObj = { type: 'string' }
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) s.format = 'date-time'
      else if (/^\d{4}-\d{2}-\d{2}$/.test(value)) s.format = 'date'
      else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) s.format = 'uuid'
      else if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) s.format = 'email'
      else if (/^https?:\/\//.test(value)) s.format = 'uri'
      return s
    }
    case 'number': return Number.isInteger(value) ? { type: 'integer' } : { type: 'number' }
    case 'boolean': return { type: 'boolean' }
    case 'object': {
      const properties: AnyObj = {}
      for (const [k, v] of Object.entries(value)) properties[k] = schemaFromExample(v)
      return { type: 'object', properties }
    }
    default: return {}
  }
}

interface Flat { req: ExportRequest; tags: string[] }

function flatten(col: ExportCollection): Flat[] {
  const out: Flat[] = []
  const walk = (f: ExportFolder, tags: string[]) => {
    for (const r of f.requests ?? []) out.push({ req: r, tags: tags.length ? [tags[tags.length - 1]!] : [] })
    for (const sub of f.folders ?? []) walk(sub, [...tags, sub.name])
  }
  for (const r of col.requests ?? []) out.push({ req: r, tags: [] })
  for (const f of col.folders ?? []) walk(f, [f.name])
  return out
}

function commonPrefix(urls: string[]): string {
  if (!urls.length) return ''
  const parsed = urls.map(u => {
    const m = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]+)(\/[^?#]*)?/i.exec(u)
    return m ? { origin: m[1]!, path: m[2] ?? '' } : null
  })
  if (parsed.some(p => !p)) return ''
  const origin = parsed[0]!.origin
  if (parsed.some(p => p!.origin !== origin)) return ''
  if (urls.length === 1) return origin
  let segs = parsed[0]!.path.split('/').filter(Boolean)
  for (const p of parsed) {
    const s = p!.path.split('/').filter(Boolean)
    let k = 0
    while (k < segs.length && k < s.length && segs[k] === s[k] && !segs[k]!.startsWith(':')) k++
    segs = segs.slice(0, k)
  }
  return origin + (segs.length ? '/' + segs.join('/') : '')
}

function contentTypeOf(body: RequestBody, headers: KV[]): string {
  const h = headers.find(x => x.key.toLowerCase() === 'content-type' && x.enabled !== false)?.value
  if (h) return h.split(';')[0]!.trim()
  switch (body.mode) {
    case 'json': return 'application/json'
    case 'xml': return 'application/xml'
    case 'html': return 'text/html'
    case 'text': return 'text/plain'
    case 'javascript': return 'application/javascript'
    case 'urlencoded': return 'application/x-www-form-urlencoded'
    case 'formdata': return 'multipart/form-data'
    case 'graphql': return 'application/json'
    case 'binary': return body.binary?.contentType || 'application/octet-stream'
    default: return 'text/plain'
  }
}

function parseJson(text: string | undefined): { ok: boolean; value?: any } {
  if (!text) return { ok: false }
  try { return { ok: true, value: JSON.parse(text) } } catch { return { ok: false } }
}

function requestBody(r: ExportRequest): AnyObj | undefined {
  const b = r.body
  if (!b || b.mode === 'none') return undefined
  const ct = contentTypeOf(b, r.headers ?? [])
  if (b.mode === 'urlencoded' || b.mode === 'formdata') {
    const list = (b.mode === 'urlencoded' ? b.urlencoded : b.formdata) ?? []
    const properties: AnyObj = {}
    for (const kv of list) {
      properties[kv.key] = kv.type === 'file' ? { type: 'string', format: 'binary' } : { type: 'string', ...(kv.value ? { example: kv.value } : {}) }
    }
    return { content: { [ct]: { schema: { type: 'object', properties } } } }
  }
  if (b.mode === 'graphql') {
    const example = { query: b.graphql?.query ?? '', variables: parseJson(b.graphql?.variables).value ?? {} }
    return { content: { 'application/json': { schema: schemaFromExample(example), example } } }
  }
  if (b.mode === 'binary') return { content: { [ct]: { schema: { type: 'string', format: 'binary' } } } }
  const raw = b.raw ?? ''
  if (ct.includes('json') || b.mode === 'json') {
    const p = parseJson(raw)
    if (p.ok) return { content: { [ct]: { schema: schemaFromExample(p.value), example: p.value } } }
  }
  return { content: { [ct]: { schema: { type: 'string' }, example: raw } } }
}

function responses(r: ExportRequest): AnyObj {
  const out: AnyObj = {}
  for (const e of r.examples ?? []) {
    const code = String(e.status || 200)
    const ct = (e.headers ?? []).find(h => h.key.toLowerCase() === 'content-type')?.value.split(';')[0]!.trim() || (parseJson(e.body).ok ? 'application/json' : 'text/plain')
    const res: AnyObj = out[code] ?? { description: e.statusText || e.name || `Response ${code}` }
    if (e.body) {
      res.content = res.content ?? {}
      if (!res.content[ct]) {
        const p = ct.includes('json') ? parseJson(e.body) : { ok: false }
        res.content[ct] = p.ok ? { schema: schemaFromExample(p.value), example: p.value } : { schema: { type: 'string' }, example: e.body }
      }
    }
    const hdrs = (e.headers ?? []).filter(h => !['content-type', 'content-length'].includes(h.key.toLowerCase()))
    if (hdrs.length) {
      res.headers = res.headers ?? {}
      for (const h of hdrs) if (!res.headers[h.key]) res.headers[h.key] = { schema: { type: 'string' }, ...(h.value ? { example: h.value } : {}) }
    }
    out[code] = res
  }
  if (!Object.keys(out).length) out['200'] = { description: 'Successful response' }
  return out
}

function securityScheme(auth: AuthConfig | undefined): { name: string; scheme: AnyObj } | undefined {
  if (!auth) return undefined
  switch (auth.type) {
    case 'basic': return { name: 'basicAuth', scheme: { type: 'http', scheme: 'basic' } }
    case 'digest': return { name: 'digestAuth', scheme: { type: 'http', scheme: 'digest' } }
    case 'bearer': return { name: 'bearerAuth', scheme: { type: 'http', scheme: 'bearer' } }
    case 'apikey': return { name: 'apiKeyAuth', scheme: { type: 'apiKey', in: auth.apikey?.in ?? 'header', name: auth.apikey?.key || 'X-API-Key' } }
    case 'oauth2': {
      const o = auth.oauth2
      const flowKey = o?.grantType === 'authorization_code' ? 'authorizationCode' : o?.grantType === 'password' ? 'password' : o?.grantType === 'implicit' ? 'implicit' : 'clientCredentials'
      const flow: AnyObj = { scopes: {} }
      if (o?.scope) for (const s of o.scope.split(/[\s,]+/).filter(Boolean)) flow.scopes[s] = ''
      if (o?.accessTokenUrl && flowKey !== 'implicit') flow.tokenUrl = o.accessTokenUrl
      if (o?.authUrl && (flowKey === 'authorizationCode' || flowKey === 'implicit')) flow.authorizationUrl = o.authUrl
      if (flowKey === 'authorizationCode' && !flow.authorizationUrl) flow.authorizationUrl = ''
      if (flowKey !== 'implicit' && !flow.tokenUrl) flow.tokenUrl = ''
      return { name: 'oauth2', scheme: { type: 'oauth2', flows: { [flowKey]: flow } } }
    }
    default: return undefined
  }
}

export function exportOpenApi(col: ExportCollection): any {
  const flat = flatten(col)
  const baseVar = (col.variables ?? []).find(v => v.key === 'baseUrl')?.value
  const rawUrls = flat.map(f => f.req.url)
  let base = baseVar && rawUrls.some(u => u.includes('{{baseUrl}}')) ? baseVar.replace(/\/+$/, '') : ''
  const resolved = rawUrls.map(u => base ? u.replace(/\{\{\s*baseUrl\s*\}\}/g, base) : u)
  if (!base) base = commonPrefix(resolved.filter(u => !u.includes('{{')))
  const doc: AnyObj = {
    openapi: '3.0.3',
    info: { title: col.name, version: '1.0.0', ...(col.description ? { description: col.description } : {}) },
    servers: base ? [{ url: base }] : [],
    paths: {},
  }
  const tagNames = new Set<string>()
  const colSec = securityScheme(col.auth)
  const schemes: AnyObj = {}
  if (colSec) {
    schemes[colSec.name] = colSec.scheme
    doc.security = [{ [colSec.name]: [] }]
  }

  flat.forEach(({ req, tags }, i) => {
    let url = resolved[i]!
    if (base && url.startsWith(base)) url = url.slice(base.length)
    else url = url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]+/i, '')
    url = url.split('?')[0]!.split('#')[0]!
    if (!url.startsWith('/')) url = '/' + url
    const pathParams: string[] = []
    const path = url.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, p) => { pathParams.push(p); return `{${p}}` }).replace(/\{\{([^}]+)\}\}/g, (_, p) => { pathParams.push(p); return `{${p}}` })
    const method = req.method.toLowerCase()
    const op: AnyObj = {}
    if (req.name) op.summary = req.name
    if (req.description) op.description = req.description
    if (req.id) op.operationId = req.id.replace(/[^A-Za-z0-9_]/g, '_')
    if (tags.length) { op.tags = tags; tags.forEach(t => tagNames.add(t)) }
    const parameters: AnyObj[] = []
    for (const p of pathParams) parameters.push({ name: p, in: 'path', required: true, schema: { type: 'string' } })
    for (const q of req.params ?? []) {
      if (!q.key) continue
      parameters.push({ name: q.key, in: 'query', required: q.enabled !== false, schema: { type: 'string', ...(q.value ? { example: q.value } : {}) }, ...(q.description ? { description: q.description } : {}) })
    }
    for (const h of req.headers ?? []) {
      if (!h.key || ['content-type', 'authorization', 'accept'].includes(h.key.toLowerCase())) continue
      parameters.push({ name: h.key, in: 'header', required: h.enabled !== false, schema: { type: 'string', ...(h.value ? { example: h.value } : {}) }, ...(h.description ? { description: h.description } : {}) })
    }
    if (parameters.length) op.parameters = parameters
    const rb = requestBody(req)
    if (rb && !['get', 'head', 'delete'].includes(method)) op.requestBody = rb
    op.responses = responses(req)
    const reqSec = securityScheme(req.auth)
    if (req.auth?.type === 'none') op.security = []
    else if (reqSec) {
      schemes[reqSec.name] = schemes[reqSec.name] ?? reqSec.scheme
      op.security = [{ [reqSec.name]: [] }]
    }
    doc.paths[path] = doc.paths[path] ?? {}
    doc.paths[path][method] = op
  })

  if (tagNames.size) doc.tags = [...tagNames].map(name => ({ name }))
  if (Object.keys(schemes).length) doc.components = { securitySchemes: schemes }
  return doc
}
