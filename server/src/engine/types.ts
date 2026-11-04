export interface KV {
  key: string
  value: string
  enabled?: boolean
  description?: string
  type?: 'text' | 'file'
  src?: string // file name for form-data files (base64 content stored in value)
}

export type BodyMode = 'none' | 'raw' | 'json' | 'xml' | 'text' | 'html' | 'javascript' | 'formdata' | 'urlencoded' | 'graphql' | 'binary'

export interface RequestBody {
  mode: BodyMode
  raw?: string
  language?: 'json' | 'xml' | 'text' | 'html' | 'javascript'
  formdata?: KV[]
  urlencoded?: KV[]
  graphql?: { query: string; variables?: string; operationName?: string }
  binary?: { name: string; contentType?: string; data: string } // base64
}

export interface AuthConfig {
  type: 'none' | 'inherit' | 'basic' | 'bearer' | 'apikey' | 'digest' | 'oauth2' | 'awsv4'
  basic?: { username: string; password: string }
  bearer?: { token: string; prefix?: string }
  apikey?: { key: string; value: string; in: 'header' | 'query' }
  digest?: { username: string; password: string }
  oauth2?: {
    grantType: 'client_credentials' | 'password' | 'authorization_code' | 'implicit'
    accessTokenUrl?: string
    authUrl?: string
    clientId?: string
    clientSecret?: string
    scope?: string
    username?: string
    password?: string
    audience?: string
    clientAuth?: 'header' | 'body'
    tokenPrefix?: string
    addTo?: 'header' | 'query'
    // runtime: cached/obtained token (stored in collection/request auth after UI flow or auto fetch)
    accessToken?: string
    refreshToken?: string
    expiresAt?: number
    usePkce?: boolean
    autoRefresh?: boolean
  }
  awsv4?: { accessKey: string; secretKey: string; region: string; service: string; sessionToken?: string }
}

export interface RequestSettings {
  followRedirects?: boolean
  maxRedirects?: number
  verifyTls?: boolean
  timeoutMs?: number
  encodeUrl?: boolean
  sendCookies?: boolean
  stream?: boolean // SSE / streaming response
}

export interface RequestDef {
  id?: string
  name: string
  method: string
  url: string
  params: KV[]
  headers: KV[]
  body: RequestBody
  auth: AuthConfig
  preRequestScript?: string
  testScript?: string
  settings?: RequestSettings
  description?: string
}

export interface ResolvedRequest {
  method: string
  url: string
  headers: Record<string, string>
  body?: Buffer
  bodyPreview?: string
  bodyMultipart?: { boundary: string }
  settings: Required<Pick<RequestSettings, 'followRedirects' | 'maxRedirects' | 'verifyTls' | 'timeoutMs'>> & RequestSettings
}

export interface ResponseInfo {
  status: number
  statusText: string
  headers: [string, string][]
  body: string        // text, or base64 when isBase64
  isBase64: boolean
  contentType: string
  size: number
  timeMs: number
  timings?: { dns?: number; connect?: number; tls?: number; firstByte?: number; download?: number }
  redirects?: { url: string; status: number }[]
  cookies?: Cookie[]
  truncated?: boolean
  remoteAddress?: string
  httpVersion?: string
}

export interface Cookie {
  name: string
  value: string
  domain: string
  path: string
  expires?: number | null
  secure?: boolean
  httpOnly?: boolean
  sameSite?: string
}

export interface Variable {
  key: string
  value: string
  type?: 'default' | 'secret'
  enabled?: boolean
}

export interface ScopeSet {
  globals: Record<string, string>
  collection: Record<string, string>
  environment: Record<string, string>
  local: Record<string, string>
  data: Record<string, any>
  // overlays: additional environments layered on top (last wins)
}

export interface TestResult {
  name: string
  passed: boolean
  error?: string
}

export interface ConsoleEntry {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug'
  args: any[]
  ts: number
}

export interface ScriptOutcome {
  tests: TestResult[]
  console: ConsoleEntry[]
  error?: string
  nextRequest?: string | null
  vars: { globals: Record<string, string | null>; collection: Record<string, string | null>; environment: Record<string, string | null>; local: Record<string, string | null> }
  request?: { method: string; url: string; headers: Record<string, string>; body?: any }
  skip?: boolean
}
