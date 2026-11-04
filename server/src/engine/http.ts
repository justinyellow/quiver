import crypto from 'node:crypto'
import { Agent, request as undiciRequest, ProxyAgent, type Dispatcher } from 'undici'
import { config } from '../config.js'
import type { Cookie, KV, RequestDef, ResolvedRequest, ResponseInfo, ScopeSet, AuthConfig } from './types.js'
import { interpolate, lookupVar } from './variables.js'
import { applyAuth, digestHeader, signAwsV4 } from './auth.js'
import { resolveAndCheck, type GuardOptions } from './ssrf.js'
import { cookieHeader, parseSetCookie } from './cookies.js'

export interface SendOptions {
  cookies?: Cookie[]
  guard?: GuardOptions
  onChunk?: (chunk: Buffer) => void
  proxyUrl?: string
  clientCerts?: { host: string; cert: string; key: string; passphrase?: string }[]
  maxBytes?: number
  signal?: AbortSignal
}

const enabled = (kv: KV[] | undefined) => (kv ?? []).filter((k) => k.enabled !== false && k.key)

export function resolveAuth(chain: (AuthConfig | undefined)[]): AuthConfig {
  // chain: [request, folder..., collection]; first non-inherit wins
  for (const a of chain) if (a && a.type !== 'inherit') return a
  return { type: 'none' }
}

/** Build the concrete HTTP request from a request definition + variable scopes. */
export async function buildRequest(def: RequestDef, scopes: ScopeSet, authChain: (AuthConfig | undefined)[], fetchToken: (p: any) => Promise<any>): Promise<{ req: ResolvedRequest; updatedAuth?: AuthConfig; auth: AuthConfig }> {
  const settings = {
    followRedirects: def.settings?.followRedirects ?? true,
    maxRedirects: def.settings?.maxRedirects ?? 10,
    verifyTls: def.settings?.verifyTls ?? true,
    timeoutMs: def.settings?.timeoutMs ?? config.requestTimeoutMs,
    ...def.settings,
  }
  let rawUrl = interpolate(def.url.trim(), scopes)
  if (!rawUrl) throw new Error('URL is empty')
  if (rawUrl.startsWith('/')) throw new Error(`URL "${rawUrl}" has no host. Check your base URL variable.`)
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(rawUrl)) rawUrl = 'http://' + rawUrl
  rawUrl = substitutePathVars(rawUrl, scopes)
  let url: URL
  try { url = new URL(rawUrl) } catch { throw new Error(`Invalid URL: ${rawUrl}`) }
  for (const p of enabled(def.params)) url.searchParams.append(interpolate(p.key, scopes), interpolate(p.value ?? '', scopes))

  const headers: Record<string, string> = {}
  for (const h of enabled(def.headers)) headers[interpolate(h.key, scopes)] = interpolate(h.value ?? '', scopes)

  let body: Buffer | undefined
  let bodyPreview: string | undefined
  const m = def.method.toUpperCase()
  const b = def.body ?? { mode: 'none' }
  const hasHeader = (n: string) => Object.keys(headers).some((k) => k.toLowerCase() === n)
  if (b.mode !== 'none') {
    switch (b.mode) {
      case 'raw': case 'json': case 'xml': case 'text': case 'html': case 'javascript': {
        const text = interpolate(b.raw ?? '', scopes)
        body = Buffer.from(text, 'utf8')
        bodyPreview = text
        const lang = b.mode === 'raw' ? b.language ?? 'text' : b.mode
        const ct = { json: 'application/json', xml: 'application/xml', html: 'text/html', javascript: 'application/javascript', text: 'text/plain' }[lang] ?? 'text/plain'
        if (!hasHeader('content-type')) headers['Content-Type'] = ct
        break
      }
      case 'graphql': {
        const payload: any = { query: interpolate(b.graphql?.query ?? '', scopes) }
        const vars = interpolate(b.graphql?.variables ?? '', scopes).trim()
        if (vars) { try { payload.variables = JSON.parse(vars) } catch { throw new Error('GraphQL variables must be valid JSON') } }
        if (b.graphql?.operationName) payload.operationName = b.graphql.operationName
        const text = JSON.stringify(payload)
        body = Buffer.from(text)
        bodyPreview = text
        if (!hasHeader('content-type')) headers['Content-Type'] = 'application/json'
        break
      }
      case 'urlencoded': {
        const sp = new URLSearchParams()
        for (const kv of enabled(b.urlencoded)) sp.append(interpolate(kv.key, scopes), interpolate(kv.value ?? '', scopes))
        const text = sp.toString()
        body = Buffer.from(text)
        bodyPreview = text
        if (!hasHeader('content-type')) headers['Content-Type'] = 'application/x-www-form-urlencoded'
        break
      }
      case 'formdata': {
        const boundary = '----QuiverBoundary' + crypto.randomBytes(8).toString('hex')
        const chunks: Buffer[] = []
        for (const kv of enabled(b.formdata)) {
          const name = interpolate(kv.key, scopes)
          if (kv.type === 'file') {
            const data = Buffer.from(kv.value ?? '', 'base64')
            const fname = kv.src || 'file'
            chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${fname}"\r\nContent-Type: ${kv.description || 'application/octet-stream'}\r\n\r\n`), data, Buffer.from('\r\n'))
          } else {
            chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${interpolate(kv.value ?? '', scopes)}\r\n`))
          }
        }
        chunks.push(Buffer.from(`--${boundary}--\r\n`))
        body = Buffer.concat(chunks)
        bodyPreview = `[multipart/form-data, ${enabled(b.formdata).length} parts, ${body.length} bytes]`
        headers['Content-Type'] = `multipart/form-data; boundary=${boundary}`
        break
      }
      case 'binary': {
        body = Buffer.from(b.binary?.data ?? '', 'base64')
        bodyPreview = `[binary ${b.binary?.name ?? ''} ${body.length} bytes]`
        if (!hasHeader('content-type')) headers['Content-Type'] = b.binary?.contentType || 'application/octet-stream'
        break
      }
    }
  }
  if (body && (m === 'GET' || m === 'HEAD') && !def.settings) {
    // keep body: some APIs (Elasticsearch) accept GET bodies; undici allows it
  }

  const auth = resolveAuth(authChain)
  const applied = await applyAuth(auth, scopes, fetchToken)
  for (const [k, v] of Object.entries(applied.headers)) headers[k] = v
  for (const [k, v] of Object.entries(applied.query)) url.searchParams.set(k, v)
  if (auth.type === 'awsv4' && auth.awsv4) {
    const a = auth.awsv4
    const signed = signAwsV4({ accessKey: interpolate(a.accessKey, scopes), secretKey: interpolate(a.secretKey, scopes), sessionToken: a.sessionToken ? interpolate(a.sessionToken, scopes) : undefined, region: interpolate(a.region, scopes) || 'us-east-1', service: interpolate(a.service, scopes) || 'execute-api' }, m, url, headers, body)
    Object.assign(headers, signed)
  }
  const req: ResolvedRequest = { method: m, url: url.toString(), headers, body, bodyPreview, settings }
  if (applied.digest) (req as any).__digest = applied.digest
  return { req, updatedAuth: applied.updatedAuth, auth }
}

/** Replace `/:name` path segments with variable values (Postman-style path variables). */
export function substitutePathVars(url: string, scopes: ScopeSet): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/[^/?#]*)([^?#]*)/i, (_m, origin: string, path: string) => origin + path.replace(/\/:([A-Za-z_][\w-]*)/g, (m: string, name: string) => {
    const v = lookupVar(name, scopes)
    return v === undefined ? m : '/' + encodeURIComponent(v)
  }))
}

export function unresolvedPathVars(url: string, scopes: ScopeSet): string[] {
  const path = url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, '').split(/[?#]/)[0]
  return [...path.matchAll(/\/:([A-Za-z_][\w-]*)/g)].map((m) => m[1]).filter((n) => lookupVar(n, scopes) === undefined)
}

function isTextual(ct: string) {
  return /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded|graphql|yaml|x-yaml|ld\+json|problem\+json|hal\+json|soap\+xml|xhtml\+xml))|\+json|\+xml|charset=/i.test(ct)
}

export async function sendHttp(req: ResolvedRequest, opts: SendOptions = {}): Promise<ResponseInfo> {
  const maxBytes = opts.maxBytes ?? config.maxResponseBytes
  const redirects: { url: string; status: number }[] = []
  let current = new URL(req.url)
  let method = req.method
  let body = req.body
  let headers = { ...req.headers }
  const jar: Cookie[] = [...(opts.cookies ?? [])]
  const newCookies: Cookie[] = []
  let digestTried = false
  const started = performance.now()
  const timings: ResponseInfo['timings'] = {}

  for (let hop = 0; hop <= req.settings.maxRedirects; hop++) {
    const t0 = performance.now()
    const addrs = await resolveAndCheck(current.hostname, opts.guard)
    timings.dns = (timings.dns ?? 0) + (performance.now() - t0)
    const sendHeaders: Record<string, string> = { 'user-agent': 'Quiver/0.1', accept: '*/*', 'accept-encoding': 'gzip, deflate, br', ...lowerKeys(headers) }
    const ck = cookieHeader(jar, current)
    if (ck && req.settings.sendCookies !== false) sendHeaders['cookie'] = sendHeaders['cookie'] ? sendHeaders['cookie'] + '; ' + ck : ck
    if (body && !sendHeaders['content-length']) sendHeaders['content-length'] = String(body.length)

    const cert = opts.clientCerts?.find((c) => c.host === current.hostname || (c.host.startsWith('*.') && current.hostname.endsWith(c.host.slice(1))))
    const connect: any = {
      rejectUnauthorized: req.settings.verifyTls,
      timeout: req.settings.timeoutMs,
      // Pin to the verified address to defeat DNS rebinding.
      lookup: (_h: string, _o: any, cb: (err: any, addr: any) => void) => cb(null, addrs.map((a) => ({ address: a.address, family: a.family }))),
      servername: current.hostname,
    }
    if (cert) { connect.cert = cert.cert; connect.key = cert.key; if (cert.passphrase) connect.passphrase = cert.passphrase }
    const dispatcher: Dispatcher = opts.proxyUrl
      ? new ProxyAgent({ uri: opts.proxyUrl, connect, requestTls: connect })
      : new Agent({ connect, headersTimeout: req.settings.timeoutMs, bodyTimeout: req.settings.timeoutMs })

    let res
    try {
      res = await undiciRequest(current, { method: method as any, headers: sendHeaders, body, dispatcher, signal: opts.signal } as any)
    } catch (e: any) {
      await dispatcher.close().catch(() => {})
      throw new Error(describeNetError(e, current))
    }
    const tFirst = performance.now()
    if (hop === 0) timings.firstByte = tFirst - started

    const resHeaders: [string, string][] = []
    for (const [k, v] of Object.entries(res.headers)) {
      if (Array.isArray(v)) for (const x of v) resHeaders.push([k, x])
      else if (v !== undefined) resHeaders.push([k, String(v)])
    }
    for (const [k, v] of resHeaders) if (k === 'set-cookie') { const c = parseSetCookie(v, current); if (c) { newCookies.push(c); jar.push(c) } }

    // Digest challenge
    const digest = (req as any).__digest
    if (res.statusCode === 401 && digest && !digestTried) {
      const challenge = resHeaders.find(([k]) => k === 'www-authenticate' && /^digest/i.test(resHeaders.find(([kk]) => kk === k)?.[1] ?? ''))?.[1]
      await res.body.dump().catch(() => {})
      await dispatcher.close().catch(() => {})
      if (challenge) {
        digestTried = true
        headers['Authorization'] = digestHeader(challenge, method, current.pathname + current.search, digest.username, digest.password, body)
        hop--
        continue
      }
    }

    if (req.settings.followRedirects && [301, 302, 303, 307, 308].includes(res.statusCode)) {
      const loc = resHeaders.find(([k]) => k === 'location')?.[1]
      if (loc && hop < req.settings.maxRedirects) {
        await res.body.dump().catch(() => {})
        await dispatcher.close().catch(() => {})
        redirects.push({ url: current.toString(), status: res.statusCode })
        const next = new URL(loc, current)
        if (res.statusCode === 303 || ((res.statusCode === 301 || res.statusCode === 302) && method === 'POST')) { method = 'GET'; body = undefined; delete headers['Content-Type']; delete headers['content-type'] }
        if (next.origin !== current.origin) { for (const k of Object.keys(headers)) if (k.toLowerCase() === 'authorization') delete headers[k] }
        current = next
        continue
      }
    }

    // Read body with size cap
    const chunks: Buffer[] = []
    let size = 0
    let truncated = false
    try {
      for await (const chunk of res.body) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        if (size + buf.length > maxBytes) { chunks.push(buf.subarray(0, maxBytes - size)); size = maxBytes; truncated = true; res.body.destroy(); break }
        chunks.push(buf)
        size += buf.length
        opts.onChunk?.(buf)
      }
    } catch (e: any) {
      if (!truncated) { await dispatcher.close().catch(() => {}); throw new Error(describeNetError(e, current)) }
    }
    await dispatcher.close().catch(() => {})
    const tEnd = performance.now()
    timings.download = tEnd - tFirst
    const raw = Buffer.concat(chunks)
    const ct = resHeaders.find(([k]) => k === 'content-type')?.[1] ?? ''
    const textual = isTextual(ct) || (ct === '' && looksText(raw))
    const headerSize = resHeaders.reduce((a, [k, v]) => a + k.length + v.length + 4, 0)
    return {
      status: res.statusCode,
      statusText: STATUS_TEXT[res.statusCode] ?? '',
      headers: resHeaders,
      body: textual ? raw.toString('utf8') : raw.toString('base64'),
      isBase64: !textual,
      contentType: ct,
      size: raw.length + headerSize,
      timeMs: Math.round((tEnd - started) * 100) / 100,
      timings,
      redirects,
      cookies: newCookies,
      truncated,
      httpVersion: '1.1',
    }
  }
  throw new Error(`Too many redirects (> ${req.settings.maxRedirects})`)
}

function lowerKeys(h: Record<string, string>) { const o: Record<string, string> = {}; for (const [k, v] of Object.entries(h)) o[k.toLowerCase()] = v; return o }
function looksText(buf: Buffer) { const s = buf.subarray(0, 512); for (const b of s) if (b === 0) return false; return true }
function describeNetError(e: any, url: URL): string {
  const code = e?.cause?.code || e?.code || ''
  if (e?.name === 'AbortError') return 'Request cancelled'
  if (code === 'ECONNREFUSED') return `Connection refused: ${url.host}`
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return `Could not resolve host: ${url.hostname}`
  if (code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT' || code === 'ETIMEDOUT') return `Request timed out: ${url.host}`
  if (code === 'ECONNRESET') return `Connection reset by peer: ${url.host}`
  if (code === 'CERT_HAS_EXPIRED' || code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || code === 'SELF_SIGNED_CERT_IN_CHAIN' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || code === 'ERR_TLS_CERT_ALTNAME_INVALID') return `TLS certificate error (${code}). Disable "Verify TLS" in request settings to ignore.`
  return `${e?.cause?.message || e?.message || 'Request failed'}${code ? ` (${code})` : ''}`
}

export async function fetchOAuthToken(p: { url: string; clientId: string; clientSecret: string; clientAuth: 'header' | 'body'; params: Record<string, string> }, guard?: GuardOptions) {
  if (!p.url) throw new Error('OAuth2: access token URL is required')
  const sp = new URLSearchParams(p.params)
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }
  if (p.clientAuth === 'body') { sp.set('client_id', p.clientId); if (p.clientSecret) sp.set('client_secret', p.clientSecret) }
  else headers['Authorization'] = 'Basic ' + Buffer.from(`${p.clientId}:${p.clientSecret}`).toString('base64')
  const res = await sendHttp({ method: 'POST', url: p.url, headers, body: Buffer.from(sp.toString()), settings: { followRedirects: true, maxRedirects: 5, verifyTls: true, timeoutMs: 30000 } }, { guard })
  try { return JSON.parse(res.body) } catch { return { error: 'invalid_response', status: res.status, body: res.body.slice(0, 500) } }
}

export const STATUS_TEXT: Record<number, string> = {
  100: 'Continue', 101: 'Switching Protocols', 200: 'OK', 201: 'Created', 202: 'Accepted', 203: 'Non-Authoritative Information', 204: 'No Content', 205: 'Reset Content', 206: 'Partial Content',
  300: 'Multiple Choices', 301: 'Moved Permanently', 302: 'Found', 303: 'See Other', 304: 'Not Modified', 307: 'Temporary Redirect', 308: 'Permanent Redirect',
  400: 'Bad Request', 401: 'Unauthorized', 402: 'Payment Required', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 406: 'Not Acceptable', 407: 'Proxy Authentication Required', 408: 'Request Timeout', 409: 'Conflict', 410: 'Gone', 411: 'Length Required', 412: 'Precondition Failed', 413: 'Payload Too Large', 414: 'URI Too Long', 415: 'Unsupported Media Type', 416: 'Range Not Satisfiable', 417: 'Expectation Failed', 418: "I'm a teapot", 422: 'Unprocessable Entity', 423: 'Locked', 424: 'Failed Dependency', 425: 'Too Early', 426: 'Upgrade Required', 428: 'Precondition Required', 429: 'Too Many Requests', 431: 'Request Header Fields Too Large', 451: 'Unavailable For Legal Reasons',
  500: 'Internal Server Error', 501: 'Not Implemented', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout', 505: 'HTTP Version Not Supported', 507: 'Insufficient Storage', 511: 'Network Authentication Required',
}
