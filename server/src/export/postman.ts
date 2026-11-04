import type { AuthConfig, KV, RequestBody, RequestSettings } from '../engine/types.js'
import type { ExportCollection, ExportEnvironment, ExportExample, ExportFolder, ExportRequest } from './types.js'

export const POSTMAN_SCHEMA = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'

function kvArray(list: KV[] | undefined, opts: { file?: boolean } = {}): any[] {
  return (list ?? []).map(kv => {
    const o: any = { key: kv.key, value: kv.value }
    if (kv.enabled === false) o.disabled = true
    if (kv.description) o.description = kv.description
    if (opts.file && kv.type === 'file') {
      o.type = 'file'
      o.src = kv.src ?? ''
      delete o.value
    } else if (opts.file) {
      o.type = 'text'
    }
    return o
  })
}

function params(obj: Record<string, string | undefined>): any[] {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([key, value]) => ({ key, value, type: 'string' }))
}

export function postmanAuth(auth: AuthConfig | undefined): any {
  if (!auth) return undefined
  switch (auth.type) {
    case 'none': return { type: 'noauth' }
    case 'inherit': return undefined
    case 'basic': return { type: 'basic', basic: params({ username: auth.basic?.username, password: auth.basic?.password }) }
    case 'bearer': return { type: 'bearer', bearer: params({ token: auth.bearer?.token }) }
    case 'apikey': return { type: 'apikey', apikey: params({ key: auth.apikey?.key, value: auth.apikey?.value, in: auth.apikey?.in ?? 'header' }) }
    case 'digest': return { type: 'digest', digest: params({ username: auth.digest?.username, password: auth.digest?.password }) }
    case 'oauth2': {
      const o = auth.oauth2
      const grant = o?.grantType === 'password' ? 'password_credentials' : o?.grantType ?? 'authorization_code'
      return {
        type: 'oauth2',
        oauth2: params({
          grant_type: grant,
          accessTokenUrl: o?.accessTokenUrl,
          authUrl: o?.authUrl,
          clientId: o?.clientId,
          clientSecret: o?.clientSecret,
          scope: o?.scope,
          username: o?.username,
          password: o?.password,
          audience: o?.audience,
          client_authentication: o?.clientAuth,
          headerPrefix: o?.tokenPrefix,
          addTokenTo: o?.addTo === 'query' ? 'queryParams' : o?.addTo,
          accessToken: o?.accessToken,
          refreshToken: o?.refreshToken,
        }),
      }
    }
    case 'awsv4': return { type: 'awsv4', awsv4: params({ accessKey: auth.awsv4?.accessKey, secretKey: auth.awsv4?.secretKey, region: auth.awsv4?.region, service: auth.awsv4?.service, sessionToken: auth.awsv4?.sessionToken }) }
    default: return undefined
  }
}

export function postmanUrl(url: string, query: KV[] | undefined): any {
  const out: any = { raw: url }
  const qs = (query ?? []).filter(q => q.key).map(q => `${q.key}=${q.value}`).join('&')
  if (qs) out.raw = `${url}${url.includes('?') ? '&' : '?'}${qs}`
  let rest = url
  const hashIdx = rest.indexOf('#')
  if (hashIdx >= 0) { out.hash = rest.slice(hashIdx + 1); rest = rest.slice(0, hashIdx) }
  const qIdx = rest.indexOf('?')
  if (qIdx >= 0) rest = rest.slice(0, qIdx)
  const m = /^([a-z][a-z0-9+.-]*):\/\//i.exec(rest)
  if (m) { out.protocol = m[1]; rest = rest.slice(m[0].length) }
  const slash = rest.indexOf('/')
  const hostPort = slash < 0 ? rest : rest.slice(0, slash)
  const path = slash < 0 ? '' : rest.slice(slash + 1)
  const portMatch = /^(.*):(\d+)$/.exec(hostPort)
  const host = portMatch ? portMatch[1]! : hostPort
  if (portMatch) out.port = portMatch[2]
  if (host) out.host = host.split('.')
  if (path) out.path = path.split('/')
  if (query && query.length) out.query = (query).map(q => ({ key: q.key, value: q.value, ...(q.enabled === false ? { disabled: true } : {}), ...(q.description ? { description: q.description } : {}) }))
  const vars = [...rest.matchAll(/(?:^|\/):([A-Za-z_][A-Za-z0-9_]*)/g)].map(x => x[1]!)
  if (vars.length) out.variable = vars.map(key => ({ key, value: '' }))
  return out
}

export function postmanBody(body: RequestBody | undefined): any {
  if (!body || body.mode === 'none') return undefined
  switch (body.mode) {
    case 'json': case 'xml': case 'text': case 'html': case 'javascript':
      return { mode: 'raw', raw: body.raw ?? '', options: { raw: { language: body.language ?? body.mode } } }
    case 'raw': return { mode: 'raw', raw: body.raw ?? '', ...(body.language ? { options: { raw: { language: body.language } } } : {}) }
    case 'urlencoded': return { mode: 'urlencoded', urlencoded: kvArray(body.urlencoded) }
    case 'formdata': return { mode: 'formdata', formdata: kvArray(body.formdata, { file: true }) }
    case 'graphql': return { mode: 'graphql', graphql: { query: body.graphql?.query ?? '', variables: body.graphql?.variables ?? '' } }
    case 'binary': return { mode: 'file', file: { src: body.binary?.name ?? '' } }
    default: return undefined
  }
}

function events(pre: string | undefined, test: string | undefined): any[] | undefined {
  const out: any[] = []
  if (pre && pre.trim()) out.push({ listen: 'prerequest', script: { type: 'text/javascript', exec: pre.split('\n') } })
  if (test && test.trim()) out.push({ listen: 'test', script: { type: 'text/javascript', exec: test.split('\n') } })
  return out.length ? out : undefined
}

function protocolProfile(s: RequestSettings | undefined): any {
  if (!s) return undefined
  const out: any = {}
  if (s.followRedirects !== undefined) out.followRedirects = s.followRedirects
  if (s.verifyTls !== undefined) out.strictSSL = s.verifyTls
  if (s.encodeUrl !== undefined) out.disableUrlEncoding = !s.encodeUrl
  if (s.maxRedirects !== undefined) out.maxRedirects = s.maxRedirects
  if (s.sendCookies !== undefined) out.disableCookies = !s.sendCookies
  return Object.keys(out).length ? out : undefined
}

function requestObject(method: string, url: string, headers: KV[] | undefined, body: RequestBody | undefined, auth?: AuthConfig, description?: string, query?: KV[]): any {
  const r: any = {
    method,
    header: kvArray(headers),
    url: postmanUrl(url, query),
  }
  const b = postmanBody(body)
  if (b) r.body = b
  const a = postmanAuth(auth)
  if (a) r.auth = a
  if (description) r.description = description
  return r
}

function exampleItem(e: ExportExample): any {
  return {
    name: e.name,
    originalRequest: requestObject(e.request.method, e.request.url, e.request.headers, e.request.body, undefined, undefined, e.request.params),
    status: e.statusText,
    code: e.status,
    _postman_previewlanguage: (e.headers ?? []).some(h => h.key.toLowerCase() === 'content-type' && h.value.includes('json')) ? 'json' : 'text',
    header: kvArray(e.headers),
    cookie: [],
    body: e.body,
  }
}

function requestItem(r: ExportRequest): any {
  const item: any = {
    name: r.name,
    request: requestObject(r.method, r.url, r.headers, r.body, r.auth, r.description || undefined, r.params),
    response: (r.examples ?? []).map(exampleItem),
  }
  if (r.id) item.id = r.id
  const ev = events(r.preRequestScript, r.testScript)
  if (ev) item.event = ev
  const ppb = protocolProfile(r.settings)
  if (ppb) item.protocolProfileBehavior = ppb
  return item
}

function folderItem(f: ExportFolder): any {
  const item: any = { name: f.name, item: [...(f.folders ?? []).map(folderItem), ...(f.requests ?? []).map(requestItem)] }
  if (f.id) item.id = f.id
  if (f.description) item.description = f.description
  const a = postmanAuth(f.auth)
  if (a) item.auth = a
  const ev = events(f.preRequestScript, f.testScript)
  if (ev) item.event = ev
  return item
}

export function exportPostmanCollection(col: ExportCollection): any {
  const out: any = {
    info: {
      _postman_id: col.id,
      name: col.name,
      schema: POSTMAN_SCHEMA,
    },
    item: [...(col.folders ?? []).map(folderItem), ...(col.requests ?? []).map(requestItem)],
  }
  if (col.description) out.info.description = col.description
  const a = postmanAuth(col.auth)
  if (a) out.auth = a
  const ev = events(col.preRequestScript, col.testScript)
  if (ev) out.event = ev
  if (col.variables?.length) {
    out.variable = col.variables.map(v => ({
      key: v.key,
      value: v.value,
      type: v.type === 'secret' ? 'secret' : 'string',
      ...(v.enabled === false ? { disabled: true } : {}),
    }))
  }
  return out
}

export function exportPostmanEnvironment(env: ExportEnvironment): any {
  return {
    id: env.id,
    name: env.name,
    values: (env.variables ?? []).map(v => ({
      key: v.key,
      value: v.value,
      type: v.type === 'secret' ? 'secret' : 'default',
      enabled: v.enabled !== false,
    })),
    _postman_variable_scope: 'environment',
    _postman_exported_at: new Date().toISOString(),
    _postman_exported_using: 'Quiver',
  }
}
