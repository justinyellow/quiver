import crypto from 'node:crypto'
import type { AuthConfig, ScopeSet } from './types.js'
import { interpolate } from './variables.js'

export interface AuthApplyResult {
  headers: Record<string, string>
  query: Record<string, string>
  // digest / oauth2 may need follow-up handling
  digest?: { username: string; password: string }
  updatedAuth?: AuthConfig // e.g. refreshed oauth2 tokens to persist
}

function ip(v: string | undefined, s: ScopeSet) { return interpolate(v ?? '', s) }

export async function applyAuth(auth: AuthConfig | undefined, scopes: ScopeSet, fetchToken: (p: any) => Promise<any>): Promise<AuthApplyResult> {
  const out: AuthApplyResult = { headers: {}, query: {} }
  if (!auth || auth.type === 'none' || auth.type === 'inherit') return out
  switch (auth.type) {
    case 'basic': {
      const u = ip(auth.basic?.username, scopes), p = ip(auth.basic?.password, scopes)
      out.headers['Authorization'] = 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64')
      return out
    }
    case 'bearer': {
      const prefix = ip(auth.bearer?.prefix, scopes) || 'Bearer'
      out.headers['Authorization'] = `${prefix} ${ip(auth.bearer?.token, scopes)}`
      return out
    }
    case 'apikey': {
      const k = ip(auth.apikey?.key, scopes), v = ip(auth.apikey?.value, scopes)
      if (!k) return out
      if (auth.apikey?.in === 'query') out.query[k] = v
      else out.headers[k] = v
      return out
    }
    case 'digest': {
      out.digest = { username: ip(auth.digest?.username, scopes), password: ip(auth.digest?.password, scopes) }
      return out
    }
    case 'awsv4': {
      // signed later in http.ts once full URL/body known
      return out
    }
    case 'oauth2': {
      const o = auth.oauth2
      if (!o) return out
      let token = ip(o.accessToken, scopes)
      const expired = o.expiresAt ? Date.now() > o.expiresAt - 30_000 : false
      const canAutoFetch = o.grantType === 'client_credentials' || o.grantType === 'password'
      if ((!token || expired) && (canAutoFetch || (o.refreshToken && o.autoRefresh !== false))) {
        const params: Record<string, string> = {}
        if (o.refreshToken && expired) {
          params.grant_type = 'refresh_token'
          params.refresh_token = ip(o.refreshToken, scopes)
        } else if (o.grantType === 'client_credentials') {
          params.grant_type = 'client_credentials'
        } else if (o.grantType === 'password') {
          params.grant_type = 'password'
          params.username = ip(o.username, scopes)
          params.password = ip(o.password, scopes)
        }
        if (o.scope) params.scope = ip(o.scope, scopes)
        if (o.audience) params.audience = ip(o.audience, scopes)
        const res = await fetchToken({
          url: ip(o.accessTokenUrl, scopes),
          clientId: ip(o.clientId, scopes),
          clientSecret: ip(o.clientSecret, scopes),
          clientAuth: o.clientAuth ?? 'header',
          params,
        })
        if (res?.access_token) {
          token = res.access_token
          out.updatedAuth = {
            ...auth,
            oauth2: {
              ...o,
              accessToken: res.access_token,
              refreshToken: res.refresh_token ?? o.refreshToken,
              expiresAt: res.expires_in ? Date.now() + Number(res.expires_in) * 1000 : undefined,
            },
          }
        } else {
          throw new Error(`OAuth2 token request failed: ${JSON.stringify(res).slice(0, 300)}`)
        }
      }
      if (!token) return out
      const prefix = ip(o.tokenPrefix, scopes) || 'Bearer'
      if (o.addTo === 'query') out.query['access_token'] = token
      else out.headers['Authorization'] = `${prefix} ${token}`
      return out
    }
  }
  return out
}

// ---- Digest auth (RFC 7616, MD5 / SHA-256, qop=auth) ----
export function digestHeader(challenge: string, method: string, uri: string, user: string, pass: string, body?: Buffer): string {
  const fields: Record<string, string> = {}
  for (const m of challenge.replace(/^Digest\s+/i, '').matchAll(/(\w+)=("([^"]*)"|([^,]*))/g)) fields[m[1]] = m[3] ?? m[4]
  const algo = (fields.algorithm || 'MD5').toUpperCase()
  const h = (s: string) => crypto.createHash(algo.startsWith('SHA-256') ? 'sha256' : 'md5').update(s).digest('hex')
  const realm = fields.realm || ''
  const nonce = fields.nonce || ''
  const opaque = fields.opaque
  const qops = (fields.qop || '').split(',').map((s) => s.trim())
  const qop = qops.includes('auth') ? 'auth' : qops.includes('auth-int') ? 'auth-int' : ''
  const nc = '00000001'
  const cnonce = crypto.randomBytes(8).toString('hex')
  let ha1 = h(`${user}:${realm}:${pass}`)
  if (algo.endsWith('-SESS')) ha1 = h(`${ha1}:${nonce}:${cnonce}`)
  const ha2 = qop === 'auth-int' ? h(`${method}:${uri}:${h((body ?? Buffer.alloc(0)).toString())}`) : h(`${method}:${uri}`)
  const response = qop ? h(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : h(`${ha1}:${nonce}:${ha2}`)
  const parts = [`username="${user}"`, `realm="${realm}"`, `nonce="${nonce}"`, `uri="${uri}"`, `response="${response}"`]
  if (algo !== 'MD5') parts.push(`algorithm=${fields.algorithm}`)
  if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`)
  if (opaque) parts.push(`opaque="${opaque}"`)
  return 'Digest ' + parts.join(', ')
}

// ---- AWS Signature V4 ----
export function signAwsV4(opts: { accessKey: string; secretKey: string; sessionToken?: string; region: string; service: string }, method: string, url: URL, headers: Record<string, string>, body: Buffer | undefined): Record<string, string> {
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)
  const payloadHash = crypto.createHash('sha256').update(body ?? Buffer.alloc(0)).digest('hex')
  const h: Record<string, string> = { ...headers, host: url.host, 'x-amz-date': amzDate, 'x-amz-content-sha256': payloadHash }
  if (opts.sessionToken) h['x-amz-security-token'] = opts.sessionToken
  const lower: Record<string, string> = {}
  for (const [k, v] of Object.entries(h)) lower[k.toLowerCase()] = String(v).trim().replace(/\s+/g, ' ')
  const signedHeaders = Object.keys(lower).sort().join(';')
  const canonicalHeaders = Object.keys(lower).sort().map((k) => `${k}:${lower[k]}\n`).join('')
  const qs = [...url.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
  const canonical = [method.toUpperCase(), url.pathname || '/', qs, canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const scope = `${dateStamp}/${opts.region}/${opts.service}/aws4_request`
  const sts = ['AWS4-HMAC-SHA256', amzDate, scope, crypto.createHash('sha256').update(canonical).digest('hex')].join('\n')
  const hmac = (key: Buffer | string, data: string) => crypto.createHmac('sha256', key).update(data).digest()
  const kDate = hmac('AWS4' + opts.secretKey, dateStamp)
  const kRegion = hmac(kDate, opts.region)
  const kService = hmac(kRegion, opts.service)
  const kSigning = hmac(kService, 'aws4_request')
  const signature = crypto.createHmac('sha256', kSigning).update(sts).digest('hex')
  return {
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
    ...(opts.sessionToken ? { 'x-amz-security-token': opts.sessionToken } : {}),
    Authorization: `AWS4-HMAC-SHA256 Credential=${opts.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  }
}
