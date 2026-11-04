import type { AuthConfig, KV, RequestBody, Variable } from '../engine/types.js'
import type { ImportResult, ImportedCollection, ImportedExample, ImportedFolder, ImportedRequest } from './types.js'

type AnyObj = Record<string, any>
export type SchemaResolver = (ref: string) => any

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']

function str(v: any): string {
  if (v == null) return ''
  return typeof v === 'string' ? v : String(v)
}

export function makeResolver(doc: AnyObj): SchemaResolver {
  return (ref: string) => {
    if (typeof ref !== 'string' || !ref.startsWith('#/')) return undefined
    let cur: any = doc
    for (const seg of ref.slice(2).split('/')) {
      if (cur == null) return undefined
      cur = cur[seg.replace(/~1/g, '/').replace(/~0/g, '~')]
    }
    return cur
  }
}

function deref(schema: any, resolver: SchemaResolver, seen: Set<string>): any {
  let s = schema
  let guard = 0
  while (s && typeof s === 'object' && typeof s.$ref === 'string' && guard++ < 20) {
    if (seen.has(s.$ref)) return { __cycle: true }
    const next = resolver(s.$ref)
    if (next === undefined) return {}
    s = next
  }
  return s
}

function formatExample(format: string, name?: string): string {
  switch (format) {
    case 'date': return '2024-01-01'
    case 'date-time': return '2024-01-01T00:00:00Z'
    case 'email': return 'user@example.com'
    case 'uuid': return '123e4567-e89b-12d3-a456-426614174000'
    case 'uri':
    case 'url': return 'https://example.com'
    case 'hostname': return 'example.com'
    case 'ipv4': return '127.0.0.1'
    case 'ipv6': return '::1'
    case 'password': return 'password'
    case 'byte': return 'Zm9v'
    case 'binary': return 'binary'
    default: return name ? `${name}` : 'string'
  }
}

export function exampleFromSchema(schema: any, resolver: SchemaResolver = () => undefined, name?: string, seen: Set<string> = new Set(), depth = 0): any {
  if (schema == null || typeof schema !== 'object') return null
  if (depth > 12) return null
  const refs = new Set(seen)
  if (typeof schema.$ref === 'string') {
    if (seen.has(schema.$ref)) return null
    refs.add(schema.$ref)
  }
  const s = deref(schema, resolver, seen)
  if (!s || typeof s !== 'object' || s.__cycle) return null
  if (s.example !== undefined) return s.example
  if (Array.isArray(s.examples) && s.examples.length) return s.examples[0]
  if (s.examples && typeof s.examples === 'object' && !Array.isArray(s.examples)) {
    const first = Object.values(s.examples)[0] as any
    if (first && typeof first === 'object' && 'value' in first) return first.value
  }
  if (s.default !== undefined) return s.default
  if (s.const !== undefined) return s.const
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0]
  if (Array.isArray(s.allOf) && s.allOf.length) {
    const merged: AnyObj = {}
    let nonObject: any
    for (const part of s.allOf) {
      const ex = exampleFromSchema(part, resolver, name, refs, depth + 1)
      if (ex && typeof ex === 'object' && !Array.isArray(ex)) Object.assign(merged, ex)
      else if (ex != null) nonObject = ex
    }
    if (Object.keys(merged).length) {
      if (s.properties) Object.assign(merged, exampleFromSchema({ type: 'object', properties: s.properties }, resolver, name, refs, depth + 1))
      return merged
    }
    return nonObject ?? null
  }
  const union = Array.isArray(s.oneOf) && s.oneOf.length ? s.oneOf : Array.isArray(s.anyOf) && s.anyOf.length ? s.anyOf : null
  if (union) return exampleFromSchema(union[0], resolver, name, refs, depth + 1)

  let type: string | undefined = Array.isArray(s.type) ? s.type.find((t: string) => t !== 'null') : s.type
  if (!type) {
    if (s.properties || s.additionalProperties) type = 'object'
    else if (s.items) type = 'array'
  }
  switch (type) {
    case 'object': {
      const out: AnyObj = {}
      const props: AnyObj = s.properties ?? {}
      for (const [k, v] of Object.entries(props)) {
        out[k] = exampleFromSchema(v, resolver, k, refs, depth + 1)
      }
      if (!Object.keys(props).length && s.additionalProperties && typeof s.additionalProperties === 'object') {
        out.key = exampleFromSchema(s.additionalProperties, resolver, 'key', refs, depth + 1)
      }
      return out
    }
    case 'array': {
      const item = s.items ? exampleFromSchema(s.items, resolver, name, refs, depth + 1) : null
      return item == null ? [] : [item]
    }
    case 'string': return formatExample(str(s.format), name)
    case 'integer': return typeof s.minimum === 'number' ? s.minimum : 0
    case 'number': return typeof s.minimum === 'number' ? s.minimum : 0
    case 'boolean': return true
    case 'null': return null
    default: return null
  }
}

function substituteServerVars(url: string, vars: AnyObj | undefined): string {
  if (!vars) return url
  return url.replace(/\{([^}]+)\}/g, (m, k) => {
    const v = vars[k]
    if (!v) return m
    if (v.default !== undefined) return str(v.default)
    if (Array.isArray(v.enum) && v.enum.length) return str(v.enum[0])
    return m
  })
}

function baseUrlOf(doc: AnyObj): string {
  if (Array.isArray(doc.servers) && doc.servers.length) {
    const s = doc.servers[0]
    return substituteServerVars(str(s?.url), s?.variables).replace(/\/+$/, '')
  }
  if (doc.swagger) {
    const scheme = Array.isArray(doc.schemes) && doc.schemes.length ? doc.schemes[0] : 'https'
    const host = str(doc.host || 'localhost')
    const base = str(doc.basePath || '').replace(/\/+$/, '')
    return `${scheme}://${host}${base}`
  }
  return ''
}

function securityAuth(doc: AnyObj, resolver: SchemaResolver): AuthConfig | undefined {
  const schemes: AnyObj = doc.components?.securitySchemes ?? doc.securityDefinitions ?? {}
  const names = Object.keys(schemes)
  if (!names.length) return undefined
  let chosen: string | undefined
  if (Array.isArray(doc.security)) {
    for (const req of doc.security) {
      const k = req && typeof req === 'object' ? Object.keys(req)[0] : undefined
      if (k && schemes[k]) { chosen = k; break }
    }
  }
  const scheme = deref(schemes[chosen ?? names[0]!], resolver, new Set())
  if (!scheme || typeof scheme !== 'object') return undefined
  const type = str(scheme.type).toLowerCase()
  if (type === 'http') {
    const sch = str(scheme.scheme).toLowerCase()
    if (sch === 'basic') return { type: 'basic', basic: { username: '{{username}}', password: '{{password}}' } }
    return { type: 'bearer', bearer: { token: '{{bearerToken}}' } }
  }
  if (type === 'basic') return { type: 'basic', basic: { username: '{{username}}', password: '{{password}}' } }
  if (type === 'apikey') {
    return { type: 'apikey', apikey: { key: str(scheme.name || 'X-API-Key'), value: '{{apiKey}}', in: scheme.in === 'query' ? 'query' : 'header' } }
  }
  if (type === 'oauth2') {
    const flows: AnyObj = scheme.flows ?? {}
    const flowName = ['clientCredentials', 'authorizationCode', 'password', 'implicit'].find(f => flows[f]) ?? ''
    const flow: AnyObj = flows[flowName] ?? {}
    const grantType: NonNullable<AuthConfig['oauth2']>['grantType'] =
      flowName === 'authorizationCode' ? 'authorization_code' : flowName === 'password' ? 'password' : flowName === 'implicit' ? 'implicit' : 'client_credentials'
    const scopes = Object.keys(flow.scopes ?? scheme.scopes ?? {})
    return {
      type: 'oauth2',
      oauth2: {
        grantType,
        accessTokenUrl: flow.tokenUrl ?? scheme.tokenUrl ?? undefined,
        authUrl: flow.authorizationUrl ?? scheme.authorizationUrl ?? undefined,
        clientId: '{{clientId}}',
        clientSecret: '{{clientSecret}}',
        scope: scopes.length ? scopes.join(' ') : undefined,
      },
    }
  }
  if (type === 'openidconnect') return { type: 'bearer', bearer: { token: '{{bearerToken}}' } }
  return undefined
}

function jsonText(v: any): string {
  return typeof v === 'string' ? v : JSON.stringify(v ?? null, null, 2)
}

function mediaExample(media: AnyObj | undefined, resolver: SchemaResolver): any {
  if (!media) return undefined
  if (media.example !== undefined) return media.example
  if (media.examples && typeof media.examples === 'object') {
    const first = Object.values(media.examples)[0] as any
    if (first !== undefined) {
      const ex = deref(first, resolver, new Set())
      if (ex && typeof ex === 'object' && 'value' in ex) return ex.value
      if (ex !== undefined) return ex
    }
  }
  if (media.schema) return exampleFromSchema(media.schema, resolver)
  return undefined
}

function formKvs(schema: any, resolver: SchemaResolver): KV[] {
  const s = deref(schema, resolver, new Set())
  const out: KV[] = []
  if (!s || typeof s !== 'object') return out
  for (const [k, v] of Object.entries<any>(s.properties ?? {})) {
    const pv = deref(v, resolver, new Set())
    const ex = exampleFromSchema(pv, resolver, k)
    const isFile = pv?.format === 'binary' || pv?.type === 'file'
    out.push({ key: k, value: isFile ? '' : typeof ex === 'object' && ex !== null ? JSON.stringify(ex) : str(ex), enabled: true, ...(isFile ? { type: 'file' as const } : {}) })
  }
  return out
}

function pickContent(content: AnyObj | undefined): { type: string; media: AnyObj } | undefined {
  if (!content || typeof content !== 'object') return undefined
  const keys = Object.keys(content)
  if (!keys.length) return undefined
  const pref = keys.find(k => k.includes('json')) ?? keys.find(k => k.includes('x-www-form-urlencoded')) ?? keys.find(k => k.includes('multipart')) ?? keys[0]!
  return { type: pref, media: content[pref] ?? {} }
}

function bodyFromContent(content: AnyObj | undefined, resolver: SchemaResolver): RequestBody {
  const picked = pickContent(content)
  if (!picked) return { mode: 'none' }
  const { type, media } = picked
  if (type.includes('x-www-form-urlencoded')) return { mode: 'urlencoded', urlencoded: formKvs(media.schema, resolver) }
  if (type.includes('multipart')) return { mode: 'formdata', formdata: formKvs(media.schema, resolver) }
  const ex = mediaExample(media, resolver)
  if (type.includes('json')) return { mode: 'json', raw: ex === undefined ? '{}' : jsonText(ex), language: 'json' }
  if (type.includes('xml')) return { mode: 'xml', raw: typeof ex === 'string' ? ex : '', language: 'xml' }
  if (type.includes('octet-stream') || type.startsWith('image/')) return { mode: 'binary', binary: { name: '', contentType: type, data: '' } }
  return { mode: 'text', raw: ex === undefined ? '' : jsonText(ex), language: 'text' }
}

function swagger2Body(params: AnyObj[], consumes: string[], resolver: SchemaResolver): RequestBody {
  const bodyParam = params.find(p => p.in === 'body')
  if (bodyParam) {
    const ct = consumes.find(c => c.includes('json')) ?? consumes[0] ?? 'application/json'
    const ex = bodyParam.schema ? exampleFromSchema(bodyParam.schema, resolver) : undefined
    if (ct.includes('xml')) return { mode: 'xml', raw: typeof ex === 'string' ? ex : '', language: 'xml' }
    return { mode: 'json', raw: ex === undefined ? '{}' : jsonText(ex), language: 'json' }
  }
  const formParams = params.filter(p => p.in === 'formData')
  if (formParams.length) {
    const kvs: KV[] = formParams.map(p => ({
      key: str(p.name),
      value: p.type === 'file' ? '' : str(p.default ?? p['x-example'] ?? exampleFromSchema(p, resolver, p.name) ?? ''),
      enabled: true,
      ...(p.type === 'file' ? { type: 'file' as const } : {}),
    }))
    const multipart = consumes.some(c => c.includes('multipart')) || formParams.some(p => p.type === 'file')
    return multipart ? { mode: 'formdata', formdata: kvs } : { mode: 'urlencoded', urlencoded: kvs }
  }
  return { mode: 'none' }
}

function paramValue(p: AnyObj, resolver: SchemaResolver): string {
  if (p.example !== undefined) return jsonText(p.example)
  if (p.examples && typeof p.examples === 'object') {
    const first = Object.values(p.examples)[0] as any
    if (first && typeof first === 'object' && 'value' in first) return jsonText(first.value)
  }
  if (p.schema) {
    const ex = exampleFromSchema(p.schema, resolver, p.name)
    return ex == null ? '' : typeof ex === 'object' ? JSON.stringify(ex) : str(ex)
  }
  if (p.default !== undefined) return str(p.default)
  if (Array.isArray(p.enum) && p.enum.length) return str(p.enum[0])
  return ''
}

function responsesToExamples(responses: AnyObj | undefined, produces: string[], req: ImportedRequest, resolver: SchemaResolver): ImportedExample[] {
  const out: ImportedExample[] = []
  if (!responses || typeof responses !== 'object') return out
  for (const [code, rawRes] of Object.entries<any>(responses)) {
    const res = deref(rawRes, resolver, new Set())
    if (!res || typeof res !== 'object') continue
    let body: any
    let contentType = ''
    if (res.content) {
      const picked = pickContent(res.content)
      if (!picked) continue
      contentType = picked.type
      body = mediaExample(picked.media, resolver)
    } else if (res.schema || res.examples) {
      contentType = produces.find(p => p.includes('json')) ?? produces[0] ?? 'application/json'
      if (res.examples && typeof res.examples === 'object') body = res.examples[contentType] ?? Object.values(res.examples)[0]
      if (body === undefined && res.schema) body = exampleFromSchema(res.schema, resolver)
    } else continue
    if (body === undefined) continue
    const status = /^\d{3}$/.test(code) ? Number(code) : 200
    const headers: KV[] = []
    if (contentType) headers.push({ key: 'Content-Type', value: contentType, enabled: true })
    for (const [hk, hv] of Object.entries<any>(res.headers ?? {})) {
      headers.push({ key: hk, value: paramValue({ ...hv, name: hk }, resolver), enabled: true })
    }
    out.push({
      name: str(res.description || code),
      request: { method: req.method, url: req.url, headers: req.headers, body: req.body.mode === 'none' ? undefined : req.body },
      status,
      statusText: str(res.description || ''),
      headers,
      body: contentType.includes('json') ? jsonText(body) : typeof body === 'string' ? body : JSON.stringify(body, null, 2),
    })
  }
  return out
}

function ensureFolder(col: ImportedCollection, name: string): ImportedFolder {
  let f = col.folders.find(x => x.name === name)
  if (!f) {
    f = { name, folders: [], requests: [] }
    col.folders.push(f)
  }
  return f
}

export function importOpenApi(doc: any): ImportResult {
  if (!doc || typeof doc !== 'object') throw new Error('Invalid OpenAPI document')
  const isSwagger2 = !!doc.swagger && !doc.openapi
  const resolver = makeResolver(doc)
  const info: AnyObj = doc.info ?? {}
  const col: ImportedCollection = {
    name: str(info.title || 'Imported API'),
    variables: [],
    folders: [],
    requests: [],
  }
  if (info.description) col.description = str(info.description)
  const baseUrl = baseUrlOf(doc)
  col.variables.push({ key: 'baseUrl', value: baseUrl, enabled: true })
  const auth = securityAuth(doc, resolver)
  if (auth) col.auth = auth

  const globalConsumes: string[] = Array.isArray(doc.consumes) ? doc.consumes : []
  const globalProduces: string[] = Array.isArray(doc.produces) ? doc.produces : []
  const paths: AnyObj = doc.paths ?? {}
  const anyTags = Object.values<any>(paths).some(pi => pi && typeof pi === 'object' && METHODS.some(m => Array.isArray(pi[m]?.tags) && pi[m].tags.length))

  for (const [path, rawItem] of Object.entries<any>(paths)) {
    const pathItem = deref(rawItem, resolver, new Set())
    if (!pathItem || typeof pathItem !== 'object') continue
    const pathParams: AnyObj[] = Array.isArray(pathItem.parameters) ? pathItem.parameters.map((p: any) => deref(p, resolver, new Set())) : []
    for (const method of METHODS) {
      const op: AnyObj = pathItem[method]
      if (!op || typeof op !== 'object') continue
      const opParams: AnyObj[] = Array.isArray(op.parameters) ? op.parameters.map((p: any) => deref(p, resolver, new Set())) : []
      const merged = new Map<string, AnyObj>()
      for (const p of [...pathParams, ...opParams]) if (p && p.name) merged.set(`${p.in}:${p.name}`, p)
      const params: KV[] = []
      const headers: KV[] = []
      const url = `{{baseUrl}}${path.replace(/\{([^}]+)\}/g, ':$1')}`
      for (const p of merged.values()) {
        if (p.in === 'query') params.push({ key: str(p.name), value: paramValue(p, resolver), enabled: !!p.required, ...(p.description ? { description: str(p.description) } : {}) })
        else if (p.in === 'header') headers.push({ key: str(p.name), value: paramValue(p, resolver), enabled: !!p.required, ...(p.description ? { description: str(p.description) } : {}) })
      }
      const consumes: string[] = Array.isArray(op.consumes) ? op.consumes : globalConsumes
      const produces: string[] = Array.isArray(op.produces) ? op.produces : globalProduces
      let body: RequestBody
      if (isSwagger2) body = swagger2Body([...merged.values()], consumes, resolver)
      else {
        const rb = deref(op.requestBody, resolver, new Set())
        body = bodyFromContent(rb?.content, resolver)
      }
      if (body.mode === 'json' && !headers.some(h => h.key.toLowerCase() === 'content-type')) headers.push({ key: 'Content-Type', value: 'application/json', enabled: true })
      const req: ImportedRequest = {
        name: str(op.summary || op.operationId || `${method.toUpperCase()} ${path}`),
        method: method.toUpperCase(),
        url,
        params,
        headers,
        body,
        auth: { type: 'inherit' },
      }
      if (op.description) req.description = str(op.description)
      const examples = responsesToExamples(op.responses, produces, req, resolver)
      if (examples.length) req.examples = examples
      let folderName: string
      if (anyTags) folderName = Array.isArray(op.tags) && op.tags.length ? str(op.tags[0]) : 'default'
      else folderName = path.split('/').filter(Boolean)[0]?.replace(/[{}]/g, '') || 'root'
      ensureFolder(col, folderName).requests.push(req)
    }
  }
  return { format: isSwagger2 ? 'swagger2' : 'openapi', collections: [col], environments: [] }
}
