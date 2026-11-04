import type { AuthConfig, KV, RequestBody } from './types'

export type { AuthConfig, KV, RequestBody } from './types'

export interface CodegenInput {
  method: string
  url: string
  headers: { key: string; value: string }[]
  body: RequestBody
  auth: AuthConfig
}

export interface CodegenTarget {
  id: string
  label: string
  language: string
}

export const targets: CodegenTarget[] = [
  { id: 'curl', label: 'cURL', language: 'shell' },
  { id: 'curl-windows', label: 'cURL (Windows cmd)', language: 'shell' },
  { id: 'wget', label: 'wget', language: 'shell' },
  { id: 'httpie', label: 'HTTPie', language: 'shell' },
  { id: 'http', label: 'HTTP', language: 'http' },
  { id: 'js-fetch', label: 'JavaScript - fetch', language: 'javascript' },
  { id: 'js-axios', label: 'JavaScript - axios', language: 'javascript' },
  { id: 'node-fetch', label: 'Node.js - fetch', language: 'javascript' },
  { id: 'node-https', label: 'Node.js - https', language: 'javascript' },
  { id: 'python-requests', label: 'Python - requests', language: 'python' },
  { id: 'python-http.client', label: 'Python - http.client', language: 'python' },
  { id: 'go-native', label: 'Go - net/http', language: 'go' },
  { id: 'java-okhttp', label: 'Java - OkHttp', language: 'java' },
  { id: 'java-httpclient', label: 'Java - HttpClient', language: 'java' },
  { id: 'csharp-httpclient', label: 'C# - HttpClient', language: 'csharp' },
  { id: 'csharp-restsharp', label: 'C# - RestSharp', language: 'csharp' },
  { id: 'php-curl', label: 'PHP - cURL', language: 'php' },
  { id: 'php-guzzle', label: 'PHP - Guzzle', language: 'php' },
  { id: 'ruby-net-http', label: 'Ruby - Net::HTTP', language: 'ruby' },
  { id: 'rust-reqwest', label: 'Rust - reqwest', language: 'rust' },
  { id: 'swift-urlsession', label: 'Swift - URLSession', language: 'swift' },
  { id: 'kotlin-okhttp', label: 'Kotlin - OkHttp', language: 'kotlin' },
  { id: 'powershell', label: 'PowerShell', language: 'powershell' },
  { id: 'dart-http', label: 'Dart - http', language: 'dart' },
]

// ---------- normalized request ----------

interface Header { key: string; value: string }

type Body =
  | { kind: 'none' }
  | { kind: 'text'; text: string; json?: unknown }
  | { kind: 'urlencoded'; fields: KV[] }
  | { kind: 'multipart'; fields: KV[] }
  | { kind: 'binary'; name: string }

interface Req {
  method: string
  url: string
  headers: Header[]
  basic?: { username: string; password: string }
  body: Body
  contentType: string
  hasBody: boolean
  parts: { protocol: string; host: string; hostname: string; port: string; path: string; secure: boolean }
}

const RAW_TYPES: Record<string, string> = {
  json: 'application/json',
  xml: 'application/xml',
  text: 'text/plain',
  html: 'text/html',
  javascript: 'application/javascript',
}

function tryJson(text: string): unknown {
  try {
    const v = JSON.parse(text)
    return v && typeof v === 'object' ? v : undefined
  } catch {
    return undefined
  }
}

function enabled(list?: KV[]): KV[] {
  return (list ?? []).filter((kv) => kv.enabled !== false && kv.key !== '')
}

function parseUrl(url: string): Req['parts'] {
  try {
    const u = new URL(url)
    const secure = u.protocol === 'https:'
    return {
      protocol: u.protocol.replace(':', ''),
      host: u.host,
      hostname: u.hostname,
      port: u.port || (secure ? '443' : '80'),
      path: (u.pathname || '/') + u.search,
      secure,
    }
  } catch {
    const m = /^(?:([a-z]+):\/\/)?([^/?#]*)(.*)$/i.exec(url) ?? []
    const secure = (m[1] ?? 'https') !== 'http'
    const host = m[2] ?? ''
    const [hostname, port] = host.split(':')
    return { protocol: m[1] ?? 'https', host, hostname, port: port ?? (secure ? '443' : '80'), path: m[3] || '/', secure }
  }
}

function prepare(input: CodegenInput): Req {
  const headers: Header[] = input.headers.filter((h) => h.key.trim() !== '').map((h) => ({ key: h.key.trim(), value: h.value }))
  const has = (name: string) => headers.some((h) => h.key.toLowerCase() === name.toLowerCase())
  const remove = (name: string) => {
    for (let i = headers.length - 1; i >= 0; i--) if (headers[i].key.toLowerCase() === name.toLowerCase()) headers.splice(i, 1)
  }
  const setDefault = (key: string, value: string) => {
    if (!has(key)) headers.push({ key, value })
  }

  let basic: Req['basic']
  const auth = input.auth
  if (auth?.type === 'basic' && auth.basic && !has('authorization')) {
    basic = { username: auth.basic.username ?? '', password: auth.basic.password ?? '' }
  } else if (auth?.type === 'bearer' && auth.bearer?.token && !has('authorization')) {
    headers.push({ key: 'Authorization', value: `${auth.bearer.prefix || 'Bearer'} ${auth.bearer.token}` })
  }

  const b = input.body ?? { mode: 'none' }
  let body: Body = { kind: 'none' }
  switch (b.mode) {
    case 'raw':
    case 'json':
    case 'xml':
    case 'text':
    case 'html':
    case 'javascript': {
      const text = b.raw ?? ''
      if (text !== '') {
        const lang = b.mode === 'raw' ? b.language ?? 'text' : b.mode
        setDefault('Content-Type', RAW_TYPES[lang] ?? 'text/plain')
        const ct = headers.find((h) => h.key.toLowerCase() === 'content-type')?.value ?? ''
        body = { kind: 'text', text, json: /json/i.test(ct) ? tryJson(text) : undefined }
      }
      break
    }
    case 'urlencoded':
      body = { kind: 'urlencoded', fields: enabled(b.urlencoded) }
      setDefault('Content-Type', 'application/x-www-form-urlencoded')
      break
    case 'formdata':
      body = { kind: 'multipart', fields: enabled(b.formdata) }
      remove('content-type')
      break
    case 'graphql': {
      const g = b.graphql ?? { query: '' }
      const payload: Record<string, unknown> = { query: g.query ?? '' }
      if (g.variables && g.variables.trim()) payload.variables = tryJson(g.variables) ?? g.variables
      if (g.operationName) payload.operationName = g.operationName
      setDefault('Content-Type', 'application/json')
      body = { kind: 'text', text: JSON.stringify(payload, null, 2), json: payload }
      break
    }
    case 'binary': {
      const name = b.binary?.name || 'file'
      setDefault('Content-Type', b.binary?.contentType || 'application/octet-stream')
      body = { kind: 'binary', name }
      break
    }
  }

  const method = (input.method || 'GET').toUpperCase()
  const contentType = headers.find((h) => h.key.toLowerCase() === 'content-type')?.value ?? ''
  return { method, url: input.url, headers, basic, body, contentType, hasBody: body.kind !== 'none', parts: parseUrl(input.url) }
}

// ---------- string helpers ----------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function base64(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (b === undefined ? '=' : B64[(n >> 6) & 63]) + (c === undefined ? '=' : B64[n & 63])
  }
  return out
}

function basicHeader(req: Req): Header[] {
  if (!req.basic) return req.headers
  return [...req.headers, { key: 'Authorization', value: `Basic ${base64(`${req.basic.username}:${req.basic.password}`)}` }]
}

const dq = (s: string) => JSON.stringify(s)
const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
const indent = (text: string, pad: string) => text.split('\n').map((l) => (l === '' ? l : pad + l)).join('\n')
const multiline = (s: string) => s.includes('\n')
const isIdent = (k: string) => /^[A-Za-z_$][\w$]*$/.test(k)
const filePath = (kv: KV) => kv.src || kv.value || 'file'
const boundary = '----QuiverFormBoundary7MA4YWxkTrZu0gW'

function literal(
  v: unknown,
  o: { open: string; close: string; key: (k: string) => string; sep: string; str: (s: string) => string; null: string; bool: (b: boolean) => string },
  ind = '',
): string {
  const inner = ind + '  '
  if (Array.isArray(v)) {
    if (!v.length) return '[]'
    return `[\n${v.map((x) => inner + literal(x, o, inner)).join(',\n')}\n${ind}]`
  }
  if (v && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>)
    if (!entries.length) return o.open + o.close
    return `${o.open}\n${entries.map(([k, x]) => `${inner}${o.key(k)}${o.sep}${literal(x, o, inner)}`).join(',\n')}\n${ind}${o.close}`
  }
  if (v === null || v === undefined) return o.null
  if (typeof v === 'boolean') return o.bool(v)
  if (typeof v === 'string') return o.str(v)
  return String(v)
}

const jsLiteral = (v: unknown, ind = '') =>
  literal(v, { open: '{', close: '}', key: (k) => (isIdent(k) ? k : dq(k)), sep: ': ', str: dq, null: 'null', bool: String }, ind)
const pyLiteral = (v: unknown, ind = '') =>
  literal(v, { open: '{', close: '}', key: dq, sep: ': ', str: dq, null: 'None', bool: (b) => (b ? 'True' : 'False') }, ind)
const rubyLiteral = (v: unknown, ind = '') =>
  literal(v, { open: '{', close: '}', key: rubyStr, sep: ' => ', str: rubyStr, null: 'nil', bool: String }, ind)
const phpLiteral = (v: unknown, ind = '') =>
  literal(v, { open: '[', close: ']', key: phpStr, sep: ' => ', str: phpStr, null: 'null', bool: String }, ind)
const dartLiteral = (v: unknown, ind = '') =>
  literal(v, { open: '{', close: '}', key: dartStr, sep: ': ', str: dartStr, null: 'null', bool: String }, ind)

function rubyStr(s: string): string {
  return dq(s).replace(/#\{/g, '\\#{')
}
function phpStr(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}
function dartStr(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\$/g, '\\$').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}'`
}
function kotlinStr(s: string): string {
  return dq(s).replace(/\$/g, '\\$')
}
function rustStr(s: string): string {
  return dq(s).replace(/\\u([0-9a-fA-F]{4})/g, '\\u{$1}')
}
function psStr(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}
function goStr(s: string): string {
  return s.includes('`') ? dq(s) : '`' + s + '`'
}

function jsText(text: string, json: unknown, ind: string): string {
  if (json !== undefined) return `JSON.stringify(${jsLiteral(json, ind)})`
  if (multiline(text)) return '`' + text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${') + '`'
  return dq(text)
}

function pyText(text: string, json: unknown, ind: string): string {
  if (json !== undefined) return `json.dumps(${pyLiteral(json, ind)})`
  if (multiline(text)) return `"""${text.replace(/\\/g, '\\\\').replace(/"""/g, '\\"""')}"""`
  return dq(text)
}

function javaText(text: string, ind: string): string {
  if (multiline(text)) return `"""\n${indent(text.replace(/\\/g, '\\\\').replace(/"""/g, '\\"""'), ind)}\n${ind}"""`
  return dq(text)
}

function kotlinText(text: string, ind: string): string {
  if (multiline(text) && !text.includes('"""')) return `"""\n${indent(text.replace(/\$/g, "\${'$'}"), ind)}\n${ind}""".trimIndent()`
  return kotlinStr(text)
}

function csharpText(text: string): string {
  if (multiline(text)) return `@"${text.replace(/"/g, '""')}"`
  return dq(text)
}

function swiftText(text: string, ind: string): string {
  if (multiline(text)) return `"""\n${indent(text.replace(/\\/g, '\\\\').replace(/"""/g, '\\"""'), ind)}\n${ind}"""`
  return dq(text)
}

function rustText(text: string): string {
  if (!multiline(text) && !text.includes('"')) return rustStr(text)
  let hashes = '#'
  while (text.includes('"' + hashes)) hashes += '#'
  return `r${hashes}"${text}"${hashes}`
}

function phpText(text: string): string {
  if (multiline(text)) return `<<<'BODY'\n${text}\nBODY`
  return phpStr(text)
}

function rubyText(text: string): string {
  if (multiline(text)) return `<<~'BODY'\n${indent(text, '  ')}\nBODY`
  return rubyStr(text)
}

function dartText(text: string, json: unknown, ind: string): string {
  if (json !== undefined) return `jsonEncode(${dartLiteral(json, ind)})`
  if (multiline(text) && !text.includes("'''")) return `r'''\n${text}'''`
  return dartStr(text)
}

function psText(text: string): string {
  if (multiline(text) || text.includes("'")) return `@'\n${text}\n'@`
  return psStr(text)
}

function formEncode(fields: KV[]): string {
  return fields.map((f) => `${encodeURIComponent(f.key)}=${encodeURIComponent(f.value)}`).join('&')
}

function rawMultipart(fields: KV[], filePart: (kv: KV) => string): string {
  const parts = fields.map((f) => {
    if (f.type === 'file') {
      return `--${boundary}\r\nContent-Disposition: form-data; name="${f.key}"; filename="${filePath(f)}"\r\nContent-Type: application/octet-stream\r\n\r\n${filePart(f)}\r\n`
    }
    return `--${boundary}\r\nContent-Disposition: form-data; name="${f.key}"\r\n\r\n${f.value}\r\n`
  })
  return parts.join('') + `--${boundary}--\r\n`
}

// ---------- shell targets ----------

function genCurl(req: Req): string {
  const lines: string[] = []
  const head = req.method === 'GET' && !req.hasBody ? `curl ${sq(req.url)}` : `curl -X ${req.method} ${sq(req.url)}`
  lines.push(head)
  for (const h of req.headers) lines.push(`-H ${sq(`${h.key}: ${h.value}`)}`)
  if (req.basic) lines.push(`--user ${sq(`${req.basic.username}:${req.basic.password}`)}`)
  const b = req.body
  if (b.kind === 'text') lines.push(`--data-raw ${sq(b.text)}`)
  else if (b.kind === 'urlencoded') for (const f of b.fields) lines.push(`--data-urlencode ${sq(`${f.key}=${f.value}`)}`)
  else if (b.kind === 'multipart') for (const f of b.fields) lines.push(`-F ${sq(f.type === 'file' ? `${f.key}=@${filePath(f)}` : `${f.key}=${f.value}`)}`)
  else if (b.kind === 'binary') lines.push(`--data-binary ${sq('@' + b.name)}`)
  return lines.join(' \\\n  ')
}

function cmdQuote(s: string): string {
  const flat = s.replace(/\r?\n/g, ' ')
  return `"${flat.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%')}"`
}

function genCurlWindows(req: Req): string {
  const lines: string[] = []
  const head = req.method === 'GET' && !req.hasBody ? `curl ${cmdQuote(req.url)}` : `curl -X ${req.method} ${cmdQuote(req.url)}`
  lines.push(head)
  for (const h of req.headers) lines.push(`-H ${cmdQuote(`${h.key}: ${h.value}`)}`)
  if (req.basic) lines.push(`--user ${cmdQuote(`${req.basic.username}:${req.basic.password}`)}`)
  const b = req.body
  if (b.kind === 'text') lines.push(`--data-raw ${cmdQuote(b.json !== undefined ? JSON.stringify(b.json) : b.text)}`)
  else if (b.kind === 'urlencoded') for (const f of b.fields) lines.push(`--data-urlencode ${cmdQuote(`${f.key}=${f.value}`)}`)
  else if (b.kind === 'multipart') for (const f of b.fields) lines.push(`-F ${cmdQuote(f.type === 'file' ? `${f.key}=@${filePath(f)}` : `${f.key}=${f.value}`)}`)
  else if (b.kind === 'binary') lines.push(`--data-binary ${cmdQuote('@' + b.name)}`)
  return lines.join(' ^\n  ')
}

function genWget(req: Req): string {
  const lines = ['wget --quiet', `--method=${req.method}`]
  const headers = [...req.headers]
  const b = req.body
  if (b.kind === 'multipart') headers.push({ key: 'Content-Type', value: `multipart/form-data; boundary=${boundary}` })
  for (const h of headers) lines.push(`--header=${sq(`${h.key}: ${h.value}`)}`)
  if (req.basic) lines.push(`--user=${sq(req.basic.username)}`, `--password=${sq(req.basic.password)}`)
  if (b.kind === 'text') lines.push(`--body-data=${sq(b.text)}`)
  else if (b.kind === 'urlencoded') lines.push(`--body-data=${sq(formEncode(b.fields))}`)
  else if (b.kind === 'multipart') lines.push(`--body-data=${sq(rawMultipart(b.fields, (f) => `<contents of ${filePath(f)}>`))}`)
  else if (b.kind === 'binary') lines.push(`--body-file=${sq(b.name)}`)
  lines.push('--output-document -', sq(req.url))
  const out = lines.join(' \\\n  ')
  return b.kind === 'multipart' ? `# wget cannot stream multipart files; replace the file placeholders with real content\n${out}` : out
}

function genHttpie(req: Req): string {
  const b = req.body
  const lines: string[] = []
  const prefix = b.kind === 'urlencoded' || b.kind === 'multipart' ? 'http --form' : 'http'
  lines.push(`${prefix} ${req.method} ${sq(req.url)}`)
  for (const h of req.headers) lines.push(sq(`${h.key}:${h.value}`))
  if (req.basic) lines.push(`--auth ${sq(`${req.basic.username}:${req.basic.password}`)}`)
  if (b.kind === 'text') lines.push(`--raw ${sq(b.text)}`)
  else if (b.kind === 'urlencoded') for (const f of b.fields) lines.push(sq(`${f.key}=${f.value}`))
  else if (b.kind === 'multipart') for (const f of b.fields) lines.push(sq(f.type === 'file' ? `${f.key}@${filePath(f)}` : `${f.key}=${f.value}`))
  let out = lines.join(' \\\n  ')
  if (b.kind === 'binary') out += ` \\\n  < ${sq(b.name)}`
  return out
}

function genHttp(req: Req): string {
  const headers = basicHeader(req)
  const b = req.body
  let payload = ''
  if (b.kind === 'text') payload = b.text
  else if (b.kind === 'urlencoded') payload = formEncode(b.fields)
  else if (b.kind === 'multipart') payload = rawMultipart(b.fields, (f) => `<binary contents of ${filePath(f)}>`)
  else if (b.kind === 'binary') payload = `<binary contents of ${b.name}>`
  const lines = [`${req.method} ${req.parts.path} HTTP/1.1`, `Host: ${req.parts.host}`]
  for (const h of headers) {
    if (h.key.toLowerCase() === 'host') continue
    lines.push(`${h.key}: ${h.value}`)
  }
  if (b.kind === 'multipart') lines.push(`Content-Type: multipart/form-data; boundary=${boundary}`)
  if (b.kind === 'text' || b.kind === 'urlencoded') lines.push(`Content-Length: ${new TextEncoder().encode(payload).length}`)
  let out = lines.join('\r\n') + '\r\n\r\n'
  if (payload) out += payload
  return out
}

// ---------- JavaScript ----------

function jsHeaders(headers: Header[], ind: string): string {
  if (!headers.length) return '{}'
  return `{\n${headers.map((h) => `${ind}  ${dq(h.key)}: ${dq(h.value)}`).join(',\n')}\n${ind}}`
}

function jsBody(req: Req, node: boolean): { setup: string; expr: string } {
  const b = req.body
  if (b.kind === 'text') return { setup: '', expr: jsText(b.text, b.json, '  ') }
  if (b.kind === 'urlencoded') {
    return { setup: '', expr: `new URLSearchParams(${jsLiteral(Object.fromEntries(b.fields.map((f) => [f.key, f.value])), '  ')})` }
  }
  if (b.kind === 'multipart') {
    const lines = ['const formData = new FormData();']
    for (const f of b.fields) {
      if (f.type === 'file') {
        lines.push(
          node
            ? `formData.append(${dq(f.key)}, await fs.openAsBlob(${dq(filePath(f))}), ${dq(filePath(f))});`
            : `formData.append(${dq(f.key)}, fileInput.files[0], ${dq(filePath(f))}); // file: ${filePath(f)}`,
        )
      } else lines.push(`formData.append(${dq(f.key)}, ${dq(f.value)});`)
    }
    return { setup: lines.join('\n') + '\n\n', expr: 'formData' }
  }
  if (b.kind === 'binary') {
    return node
      ? { setup: '', expr: `fs.readFileSync(${dq(b.name)})` }
      : { setup: `const file = fileInput.files[0]; // ${b.name}\n\n`, expr: 'file' }
  }
  return { setup: '', expr: '' }
}

function genFetch(req: Req, node: boolean): string {
  const headers = basicHeader(req)
  const body = jsBody(req, node)
  const needsFs = node && (req.body.kind === 'multipart' && req.body.fields.some((f) => f.type === 'file') || req.body.kind === 'binary')
  const opts = [`  method: ${dq(req.method)}`]
  if (headers.length) opts.push(`  headers: ${jsHeaders(headers, '  ')}`)
  if (body.expr) opts.push(`  body: ${body.expr}`)
  const pre = needsFs ? `import fs from "node:fs";\n\n` : ''
  return `${pre}${body.setup}const response = await fetch(${dq(req.url)}, {\n${opts.join(',\n')},\n});\n\nconsole.log(response.status);\nconsole.log(await response.text());\n`
}

function genAxios(req: Req): string {
  const body = jsBody(req, false)
  const opts = [`  method: ${dq(req.method.toLowerCase())}`, `  url: ${dq(req.url)}`]
  if (req.headers.length) opts.push(`  headers: ${jsHeaders(req.headers, '  ')}`)
  if (req.basic) opts.push(`  auth: {\n    username: ${dq(req.basic.username)},\n    password: ${dq(req.basic.password)},\n  }`)
  if (req.body.kind === 'text') opts.push(`  data: ${req.body.json !== undefined ? jsLiteral(req.body.json, '  ') : jsText(req.body.text, undefined, '  ')}`)
  else if (body.expr) opts.push(`  data: ${body.expr}`)
  return `import axios from "axios";\n\n${body.setup}const response = await axios({\n${opts.join(',\n')},\n});\n\nconsole.log(response.status);\nconsole.log(response.data);\n`
}

function genNodeHttps(req: Req): string {
  const mod = req.parts.secure ? 'https' : 'http'
  const b = req.body
  const headers = [...req.headers]
  const lines: string[] = [`const ${mod} = require("node:${mod}");`]
  const needsFs = (b.kind === 'multipart' && b.fields.some((f) => f.type === 'file')) || b.kind === 'binary'
  if (needsFs) lines.push('const fs = require("node:fs");')
  lines.push('')
  let bodyExpr = ''
  if (b.kind === 'text') lines.push(`const payload = ${jsText(b.text, b.json, '')};`, ''), (bodyExpr = 'payload')
  else if (b.kind === 'urlencoded') {
    lines.push(`const payload = new URLSearchParams(${jsLiteral(Object.fromEntries(b.fields.map((f) => [f.key, f.value])), '')}).toString();`, '')
    bodyExpr = 'payload'
  } else if (b.kind === 'multipart') {
    headers.push({ key: 'Content-Type', value: `multipart/form-data; boundary=${boundary}` })
    lines.push(`const boundary = ${dq(boundary)};`, 'const parts = [];')
    for (const f of b.fields) {
      if (f.type === 'file') {
        lines.push(
          `parts.push(Buffer.from(\`--\${boundary}\\r\\nContent-Disposition: form-data; name="${f.key}"; filename="${filePath(f)}"\\r\\nContent-Type: application/octet-stream\\r\\n\\r\\n\`));`,
          `parts.push(fs.readFileSync(${dq(filePath(f))}), Buffer.from("\\r\\n"));`,
        )
      } else {
        lines.push(`parts.push(Buffer.from(\`--\${boundary}\\r\\nContent-Disposition: form-data; name="${f.key}"\\r\\n\\r\\n${f.value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')}\\r\\n\`));`)
      }
    }
    lines.push('parts.push(Buffer.from(`--${boundary}--\\r\\n`));', 'const payload = Buffer.concat(parts);', '')
    bodyExpr = 'payload'
  } else if (b.kind === 'binary') {
    lines.push(`const payload = fs.readFileSync(${dq(b.name)});`, '')
    bodyExpr = 'payload'
  }
  const opts = [
    `  method: ${dq(req.method)}`,
    `  hostname: ${dq(req.parts.hostname)}`,
    `  port: ${req.parts.port}`,
    `  path: ${dq(req.parts.path)}`,
  ]
  if (req.basic) opts.push(`  auth: ${dq(`${req.basic.username}:${req.basic.password}`)}`)
  const hdr = headers.map((h) => `    ${dq(h.key)}: ${dq(h.value)}`)
  if (bodyExpr) hdr.push(`    "Content-Length": Buffer.byteLength(${bodyExpr})`)
  if (hdr.length) opts.push(`  headers: {\n${hdr.join(',\n')},\n  }`)
  lines.push(`const options = {\n${opts.join(',\n')},\n};`, '')
  lines.push(
    `const req = ${mod}.request(options, (res) => {`,
    '  const chunks = [];',
    '  res.on("data", (chunk) => chunks.push(chunk));',
    '  res.on("end", () => {',
    '    console.log(res.statusCode);',
    '    console.log(Buffer.concat(chunks).toString());',
    '  });',
    '});',
    '',
    'req.on("error", (err) => console.error(err));',
  )
  if (bodyExpr) lines.push(`req.write(${bodyExpr});`)
  lines.push('req.end();')
  return lines.join('\n') + '\n'
}

// ---------- Python ----------

const PY_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']

function pyDict(headers: Header[]): string {
  if (!headers.length) return '{}'
  return `{\n${headers.map((h) => `  ${dq(h.key)}: ${dq(h.value)}`).join(',\n')}\n}`
}

function genPythonRequests(req: Req): string {
  const b = req.body
  const lines = ['import requests', '', `url = ${dq(req.url)}`]
  const args = ['url']
  if (req.headers.length) {
    lines.push(`headers = ${pyDict(req.headers)}`)
    args.push('headers=headers')
  }
  if (b.kind === 'text') {
    if (b.json !== undefined) {
      lines.push(`payload = ${pyLiteral(b.json)}`)
      args.push('json=payload')
    } else {
      lines.push(`payload = ${pyText(b.text, undefined, '')}`)
      args.push('data=payload')
    }
  } else if (b.kind === 'urlencoded') {
    lines.push(`payload = ${pyLiteral(Object.fromEntries(b.fields.map((f) => [f.key, f.value])))}`)
    args.push('data=payload')
  } else if (b.kind === 'multipart') {
    const text = b.fields.filter((f) => f.type !== 'file')
    const files = b.fields.filter((f) => f.type === 'file')
    if (text.length) {
      lines.push(`payload = ${pyLiteral(Object.fromEntries(text.map((f) => [f.key, f.value])))}`)
      args.push('data=payload')
    }
    if (files.length) {
      lines.push(`files = {\n${files.map((f) => `  ${dq(f.key)}: (${dq(filePath(f))}, open(${dq(filePath(f))}, "rb"))`).join(',\n')}\n}`)
      args.push('files=files')
    } else args.push('files={}')
  } else if (b.kind === 'binary') {
    lines.push(`payload = open(${dq(b.name)}, "rb")`)
    args.push('data=payload')
  }
  if (req.basic) args.push(`auth=(${dq(req.basic.username)}, ${dq(req.basic.password)})`)
  const m = req.method.toLowerCase()
  const call = PY_METHODS.includes(m) ? `requests.${m}(${args.join(', ')})` : `requests.request(${dq(req.method)}, ${args.join(', ')})`
  lines.push('', `response = ${call}`, '', 'print(response.status_code)', 'print(response.text)')
  return lines.join('\n') + '\n'
}

function genPythonHttpClient(req: Req): string {
  const b = req.body
  const headers = basicHeader(req)
  const lines = ['import http.client']
  if (b.kind === 'text' && b.json !== undefined) lines.push('import json')
  if (b.kind === 'urlencoded') lines.push('import urllib.parse')
  lines.push('', `conn = http.client.${req.parts.secure ? 'HTTPSConnection' : 'HTTPConnection'}(${dq(req.parts.hostname)}, ${req.parts.port})`)
  let payload = 'None'
  const extra: Header[] = []
  if (b.kind === 'text') {
    lines.push(`payload = ${pyText(b.text, b.json, '')}`)
    payload = 'payload'
  } else if (b.kind === 'urlencoded') {
    lines.push(`payload = urllib.parse.urlencode(${pyLiteral(Object.fromEntries(b.fields.map((f) => [f.key, f.value])))})`)
    payload = 'payload'
  } else if (b.kind === 'multipart') {
    extra.push({ key: 'Content-Type', value: `multipart/form-data; boundary=${boundary}` })
    lines.push(`boundary = ${dq(boundary)}`, 'payload = b""')
    for (const f of b.fields) {
      if (f.type === 'file') {
        lines.push(
          `payload += f"--{boundary}\\r\\nContent-Disposition: form-data; name=\\"${f.key}\\"; filename=\\"${filePath(f)}\\"\\r\\nContent-Type: application/octet-stream\\r\\n\\r\\n".encode()`,
          `payload += open(${dq(filePath(f))}, "rb").read() + b"\\r\\n"`,
        )
      } else {
        lines.push(`payload += f"--{boundary}\\r\\nContent-Disposition: form-data; name=\\"${f.key}\\"\\r\\n\\r\\n${f.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\{/g, '{{').replace(/\}/g, '}}').replace(/\n/g, '\\n')}\\r\\n".encode()`)
      }
    }
    lines.push('payload += f"--{boundary}--\\r\\n".encode()')
    payload = 'payload'
  } else if (b.kind === 'binary') {
    lines.push(`payload = open(${dq(b.name)}, "rb").read()`)
    payload = 'payload'
  }
  lines.push(`headers = ${pyDict([...headers, ...extra])}`)
  lines.push('', `conn.request(${dq(req.method)}, ${dq(req.parts.path)}, ${payload}, headers)`, 'res = conn.getresponse()', 'data = res.read()', '', 'print(res.status)', 'print(data.decode("utf-8"))')
  return lines.join('\n') + '\n'
}

// ---------- Go ----------

function genGo(req: Req): string {
  const b = req.body
  const imports = new Set(['fmt', 'io', 'net/http'])
  const body: string[] = []
  let payload = 'nil'
  const headers = [...req.headers]
  if (b.kind === 'text') {
    imports.add('strings')
    body.push(`\tpayload := strings.NewReader(${goStr(b.text)})`)
    payload = 'payload'
  } else if (b.kind === 'urlencoded') {
    imports.add('strings').add('net/url')
    body.push('\tform := url.Values{}')
    for (const f of b.fields) body.push(`\tform.Set(${dq(f.key)}, ${dq(f.value)})`)
    body.push('\tpayload := strings.NewReader(form.Encode())')
    payload = 'payload'
  } else if (b.kind === 'multipart') {
    imports.add('bytes').add('mime/multipart')
    body.push('\tpayload := &bytes.Buffer{}', '\twriter := multipart.NewWriter(payload)')
    let n = 0
    for (const f of b.fields) {
      if (f.type === 'file') {
        imports.add('os').add('path/filepath')
        const v = `file${++n}`
        body.push(
          `\t${v}, err := os.Open(${dq(filePath(f))})`,
          '\tif err != nil {',
          '\t\tpanic(err)',
          '\t}',
          `\tdefer ${v}.Close()`,
          `\tpart${n}, err := writer.CreateFormFile(${dq(f.key)}, filepath.Base(${dq(filePath(f))}))`,
          '\tif err != nil {',
          '\t\tpanic(err)',
          '\t}',
          `\tif _, err := io.Copy(part${n}, ${v}); err != nil {`,
          '\t\tpanic(err)',
          '\t}',
        )
      } else body.push(`\t_ = writer.WriteField(${dq(f.key)}, ${dq(f.value)})`)
    }
    body.push('\tif err := writer.Close(); err != nil {', '\t\tpanic(err)', '\t}')
    payload = 'payload'
  } else if (b.kind === 'binary') {
    imports.add('os')
    body.push(`\tpayload, err := os.Open(${dq(b.name)})`, '\tif err != nil {', '\t\tpanic(err)', '\t}', '\tdefer payload.Close()')
    payload = 'payload'
  }
  const lines = ['package main', '', 'import (', ...[...imports].sort().map((i) => `\t"${i}"`), ')', '', 'func main() {']
  lines.push(...body)
  lines.push(`\treq, err := http.NewRequest(${dq(req.method)}, ${dq(req.url)}, ${payload})`, '\tif err != nil {', '\t\tpanic(err)', '\t}')
  for (const h of headers) lines.push(`\treq.Header.Set(${dq(h.key)}, ${dq(h.value)})`)
  if (b.kind === 'multipart') lines.push('\treq.Header.Set("Content-Type", writer.FormDataContentType())')
  if (req.basic) lines.push(`\treq.SetBasicAuth(${dq(req.basic.username)}, ${dq(req.basic.password)})`)
  lines.push(
    '',
    '\tres, err := http.DefaultClient.Do(req)',
    '\tif err != nil {',
    '\t\tpanic(err)',
    '\t}',
    '\tdefer res.Body.Close()',
    '',
    '\trespBody, err := io.ReadAll(res.Body)',
    '\tif err != nil {',
    '\t\tpanic(err)',
    '\t}',
    '\tfmt.Println(res.StatusCode)',
    '\tfmt.Println(string(respBody))',
    '}',
  )
  return lines.join('\n') + '\n'
}

// ---------- Java ----------

function genJavaOkHttp(req: Req): string {
  const b = req.body
  const headers = [...req.headers]
  const imports = new Set(['okhttp3.*', 'java.io.IOException'])
  const lines: string[] = []
  let bodyExpr = 'null'
  if (b.kind === 'text') {
    lines.push(`    MediaType mediaType = MediaType.parse(${dq(req.contentType)});`, `    RequestBody body = RequestBody.create(${javaText(b.text, '      ')}, mediaType);`)
    bodyExpr = 'body'
  } else if (b.kind === 'urlencoded') {
    lines.push('    RequestBody body = new FormBody.Builder()')
    for (const f of b.fields) lines.push(`      .add(${dq(f.key)}, ${dq(f.value)})`)
    lines.push('      .build();')
    bodyExpr = 'body'
  } else if (b.kind === 'multipart') {
    imports.add('java.io.File')
    lines.push('    RequestBody body = new MultipartBody.Builder()', '      .setType(MultipartBody.FORM)')
    for (const f of b.fields) {
      if (f.type === 'file') {
        lines.push(`      .addFormDataPart(${dq(f.key)}, ${dq(filePath(f))},`, `        RequestBody.create(new File(${dq(filePath(f))}), MediaType.parse("application/octet-stream")))`)
      } else lines.push(`      .addFormDataPart(${dq(f.key)}, ${dq(f.value)})`)
    }
    lines.push('      .build();')
    bodyExpr = 'body'
  } else if (b.kind === 'binary') {
    imports.add('java.io.File')
    lines.push(`    RequestBody body = RequestBody.create(new File(${dq(b.name)}), MediaType.parse(${dq(req.contentType)}));`)
    bodyExpr = 'body'
  }
  lines.push('    Request request = new Request.Builder()', `      .url(${dq(req.url)})`, `      .method(${dq(req.method)}, ${bodyExpr})`)
  for (const h of headers) lines.push(`      .addHeader(${dq(h.key)}, ${dq(h.value)})`)
  if (req.basic) lines.push(`      .addHeader("Authorization", Credentials.basic(${dq(req.basic.username)}, ${dq(req.basic.password)}))`)
  lines.push('      .build();')
  const head = [...[...imports].sort().map((i) => `import ${i};`), '', 'public class Main {', '  public static void main(String[] args) throws IOException {', '    OkHttpClient client = new OkHttpClient();', '']
  const tail = ['', '    try (Response response = client.newCall(request).execute()) {', '      System.out.println(response.code());', '      System.out.println(response.body().string());', '    }', '  }', '}']
  return [...head, ...lines, ...tail].join('\n') + '\n'
}

function genJavaHttpClient(req: Req): string {
  const b = req.body
  const headers = basicHeader(req)
  const imports = new Set(['java.net.URI', 'java.net.http.HttpClient', 'java.net.http.HttpRequest', 'java.net.http.HttpResponse', 'java.io.IOException'])
  const lines: string[] = []
  let publisher = 'HttpRequest.BodyPublishers.noBody()'
  const extra: Header[] = []
  if (b.kind === 'text') {
    publisher = `HttpRequest.BodyPublishers.ofString(${javaText(b.text, '        ')})`
  } else if (b.kind === 'urlencoded') {
    publisher = `HttpRequest.BodyPublishers.ofString(${dq(formEncode(b.fields))})`
  } else if (b.kind === 'multipart') {
    imports.add('java.nio.file.Files').add('java.nio.file.Path')
    extra.push({ key: 'Content-Type', value: `multipart/form-data; boundary=${boundary}` })
    lines.push(`    String boundary = ${dq(boundary)};`, '    StringBuilder body = new StringBuilder();')
    for (const f of b.fields) {
      if (f.type === 'file') {
        lines.push(
          `    body.append("--").append(boundary).append("\\r\\n")`,
          `      .append("Content-Disposition: form-data; name=\\"${f.key}\\"; filename=\\"${filePath(f)}\\"\\r\\n")`,
          `      .append("Content-Type: application/octet-stream\\r\\n\\r\\n")`,
          `      .append(Files.readString(Path.of(${dq(filePath(f))}))).append("\\r\\n");`,
        )
      } else {
        lines.push(
          `    body.append("--").append(boundary).append("\\r\\n")`,
          `      .append("Content-Disposition: form-data; name=\\"${f.key}\\"\\r\\n\\r\\n")`,
          `      .append(${dq(f.value)}).append("\\r\\n");`,
        )
      }
    }
    lines.push('    body.append("--").append(boundary).append("--\\r\\n");', '')
    publisher = 'HttpRequest.BodyPublishers.ofString(body.toString())'
  } else if (b.kind === 'binary') {
    imports.add('java.nio.file.Path')
    publisher = `HttpRequest.BodyPublishers.ofFile(Path.of(${dq(b.name)}))`
  }
  lines.push('    HttpRequest request = HttpRequest.newBuilder()', `      .uri(URI.create(${dq(req.url)}))`)
  for (const h of [...headers, ...extra]) lines.push(`      .header(${dq(h.key)}, ${dq(h.value)})`)
  lines.push(`      .method(${dq(req.method)}, ${publisher})`, '      .build();')
  const head = [...[...imports].sort().map((i) => `import ${i};`), '', 'public class Main {', '  public static void main(String[] args) throws IOException, InterruptedException {', '    HttpClient client = HttpClient.newHttpClient();', '']
  const tail = ['', '    HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());', '    System.out.println(response.statusCode());', '    System.out.println(response.body());', '  }', '}']
  return [...head, ...lines, ...tail].join('\n') + '\n'
}

// ---------- C# ----------

const CS_METHODS: Record<string, string> = { GET: 'Get', POST: 'Post', PUT: 'Put', DELETE: 'Delete', HEAD: 'Head', OPTIONS: 'Options', PATCH: 'Patch', TRACE: 'Trace' }
const csMethod = (m: string) => (CS_METHODS[m] ? `HttpMethod.${CS_METHODS[m]}` : `new HttpMethod(${dq(m)})`)

function genCsharpHttpClient(req: Req): string {
  const b = req.body
  const lines = ['using System.Net.Http.Headers;', 'using System.Text;', '', 'using var client = new HttpClient();', `var request = new HttpRequestMessage(${csMethod(req.method)}, ${dq(req.url)});`]
  const contentHeaders = req.headers.filter((h) => /^content-/i.test(h.key) && h.key.toLowerCase() !== 'content-type')
  const plain = req.headers.filter((h) => !/^content-/i.test(h.key))
  for (const h of plain) lines.push(`request.Headers.TryAddWithoutValidation(${dq(h.key)}, ${dq(h.value)});`)
  if (req.basic) {
    lines.push(`request.Headers.Authorization = new AuthenticationHeaderValue("Basic",\n  Convert.ToBase64String(Encoding.ASCII.GetBytes(${dq(`${req.basic.username}:${req.basic.password}`)})));`)
  }
  if (b.kind === 'text') {
    lines.push(`request.Content = new StringContent(${csharpText(b.text)}, Encoding.UTF8, ${dq(req.contentType.split(';')[0].trim())});`)
  } else if (b.kind === 'urlencoded') {
    lines.push('request.Content = new FormUrlEncodedContent(new Dictionary<string, string>', '{', ...b.fields.map((f) => `  { ${dq(f.key)}, ${dq(f.value)} },`), '});')
  } else if (b.kind === 'multipart') {
    lines.push('var content = new MultipartFormDataContent();')
    for (const f of b.fields) {
      if (f.type === 'file') lines.push(`content.Add(new ByteArrayContent(File.ReadAllBytes(${dq(filePath(f))})), ${dq(f.key)}, ${dq(filePath(f))});`)
      else lines.push(`content.Add(new StringContent(${dq(f.value)}), ${dq(f.key)});`)
    }
    lines.push('request.Content = content;')
  } else if (b.kind === 'binary') {
    lines.push(`request.Content = new ByteArrayContent(File.ReadAllBytes(${dq(b.name)}));`, `request.Content.Headers.ContentType = new MediaTypeHeaderValue(${dq(req.contentType.split(';')[0].trim())});`)
  }
  if (b.kind !== 'none') for (const h of contentHeaders) lines.push(`request.Content.Headers.TryAddWithoutValidation(${dq(h.key)}, ${dq(h.value)});`)
  lines.push('', 'var response = await client.SendAsync(request);', 'Console.WriteLine((int)response.StatusCode);', 'Console.WriteLine(await response.Content.ReadAsStringAsync());')
  return lines.join('\n') + '\n'
}

function genCsharpRestSharp(req: Req): string {
  const b = req.body
  const lines = ['using RestSharp;']
  if (req.basic) lines.push('using RestSharp.Authenticators;')
  lines.push('')
  if (req.basic) {
    lines.push(`var options = new RestClientOptions(${dq(req.url)})`, '{', `  Authenticator = new HttpBasicAuthenticator(${dq(req.basic.username)}, ${dq(req.basic.password)}),`, '};', 'var client = new RestClient(options);')
  } else lines.push(`var client = new RestClient(${dq(req.url)});`)
  const m = CS_METHODS[req.method] ? `Method.${CS_METHODS[req.method]}` : 'Method.Post'
  lines.push(`var request = new RestRequest("", ${m});`)
  for (const h of req.headers) lines.push(`request.AddHeader(${dq(h.key)}, ${dq(h.value)});`)
  if (b.kind === 'text') lines.push(`request.AddStringBody(${csharpText(b.text)}, ${dq(req.contentType.split(';')[0].trim())});`)
  else if (b.kind === 'urlencoded') for (const f of b.fields) lines.push(`request.AddParameter(${dq(f.key)}, ${dq(f.value)});`)
  else if (b.kind === 'multipart') {
    lines.push('request.AlwaysMultipartFormData = true;')
    for (const f of b.fields) {
      if (f.type === 'file') lines.push(`request.AddFile(${dq(f.key)}, ${dq(filePath(f))});`)
      else lines.push(`request.AddParameter(${dq(f.key)}, ${dq(f.value)});`)
    }
  } else if (b.kind === 'binary') lines.push(`request.AddParameter(${dq(req.contentType.split(';')[0].trim())}, File.ReadAllBytes(${dq(b.name)}), ParameterType.RequestBody);`)
  lines.push('', 'var response = await client.ExecuteAsync(request);', 'Console.WriteLine((int)response.StatusCode);', 'Console.WriteLine(response.Content);')
  return lines.join('\n') + '\n'
}

// ---------- PHP ----------

function genPhpCurl(req: Req): string {
  const b = req.body
  const opts = [`  CURLOPT_URL => ${phpStr(req.url)},`, '  CURLOPT_RETURNTRANSFER => true,', `  CURLOPT_CUSTOMREQUEST => ${phpStr(req.method)},`]
  if (b.kind === 'text') opts.push(`  CURLOPT_POSTFIELDS => ${phpText(b.text)},`)
  else if (b.kind === 'urlencoded') opts.push(`  CURLOPT_POSTFIELDS => http_build_query(${phpLiteral(Object.fromEntries(b.fields.map((f) => [f.key, f.value])), '  ')}),`)
  else if (b.kind === 'multipart') {
    opts.push('  CURLOPT_POSTFIELDS => [', ...b.fields.map((f) => `    ${phpStr(f.key)} => ${f.type === 'file' ? `new CURLFile(${phpStr(filePath(f))})` : phpStr(f.value)},`), '  ],')
  } else if (b.kind === 'binary') opts.push(`  CURLOPT_POSTFIELDS => file_get_contents(${phpStr(b.name)}),`)
  if (req.headers.length) opts.push('  CURLOPT_HTTPHEADER => [', ...req.headers.map((h) => `    ${phpStr(`${h.key}: ${h.value}`)},`), '  ],')
  if (req.basic) opts.push(`  CURLOPT_USERPWD => ${phpStr(`${req.basic.username}:${req.basic.password}`)},`)
  return ['<?php', '', '$curl = curl_init();', '', 'curl_setopt_array($curl, [', ...opts, ']);', '', '$response = curl_exec($curl);', '$error = curl_error($curl);', 'curl_close($curl);', '', 'if ($error) {', '  echo "cURL Error: " . $error;', '} else {', '  echo $response;', '}'].join('\n') + '\n'
}

function genPhpGuzzle(req: Req): string {
  const b = req.body
  const opts: string[] = []
  if (req.headers.length) opts.push(`  'headers' => [\n${req.headers.map((h) => `    ${phpStr(h.key)} => ${phpStr(h.value)},`).join('\n')}\n  ],`)
  if (req.basic) opts.push(`  'auth' => [${phpStr(req.basic.username)}, ${phpStr(req.basic.password)}],`)
  if (b.kind === 'text') opts.push(b.json !== undefined ? `  'json' => ${phpLiteral(b.json, '  ')},` : `  'body' => ${phpText(b.text)},`)
  else if (b.kind === 'urlencoded') opts.push(`  'form_params' => ${phpLiteral(Object.fromEntries(b.fields.map((f) => [f.key, f.value])), '  ')},`)
  else if (b.kind === 'multipart') {
    opts.push('  \'multipart\' => [')
    for (const f of b.fields) {
      opts.push('    [', `      'name' => ${phpStr(f.key)},`, f.type === 'file' ? `      'contents' => fopen(${phpStr(filePath(f))}, 'r'),` : `      'contents' => ${phpStr(f.value)},`, '    ],')
    }
    opts.push('  ],')
  } else if (b.kind === 'binary') opts.push(`  'body' => fopen(${phpStr(b.name)}, 'r'),`)
  return ['<?php', '', "require 'vendor/autoload.php';", '', 'use GuzzleHttp\\Client;', '', '$client = new Client();', `$response = $client->request(${phpStr(req.method)}, ${phpStr(req.url)}, [`, ...opts, ']);', '', 'echo $response->getStatusCode() . "\\n";', 'echo $response->getBody();'].join('\n') + '\n'
}

// ---------- Ruby ----------

const RUBY_METHODS: Record<string, string> = { GET: 'Get', POST: 'Post', PUT: 'Put', PATCH: 'Patch', DELETE: 'Delete', HEAD: 'Head', OPTIONS: 'Options' }

function genRuby(req: Req): string {
  const b = req.body
  const lines = ['require "uri"', 'require "net/http"']
  if (b.kind === 'text' && b.json !== undefined) lines.push('require "json"')
  lines.push('', `url = URI(${rubyStr(req.url)})`, '', 'http = Net::HTTP.new(url.host, url.port)')
  if (req.parts.secure) lines.push('http.use_ssl = true')
  lines.push('')
  const cls = RUBY_METHODS[req.method]
  lines.push(cls ? `request = Net::HTTP::${cls}.new(url)` : `request = Net::HTTPGenericRequest.new(${rubyStr(req.method)}, true, true, url)`)
  for (const h of req.headers) lines.push(`request[${rubyStr(h.key)}] = ${rubyStr(h.value)}`)
  if (req.basic) lines.push(`request.basic_auth(${rubyStr(req.basic.username)}, ${rubyStr(req.basic.password)})`)
  if (b.kind === 'text') lines.push(`request.body = ${b.json !== undefined ? `JSON.generate(${rubyLiteral(b.json)})` : rubyText(b.text)}`)
  else if (b.kind === 'urlencoded') lines.push(`request.set_form_data(${rubyLiteral(Object.fromEntries(b.fields.map((f) => [f.key, f.value])))})`)
  else if (b.kind === 'multipart') {
    lines.push('request.set_form([', ...b.fields.map((f) => `  [${rubyStr(f.key)}, ${f.type === 'file' ? `File.open(${rubyStr(filePath(f))})` : rubyStr(f.value)}],`), '], "multipart/form-data")')
  } else if (b.kind === 'binary') lines.push(`request.body = File.binread(${rubyStr(b.name)})`)
  lines.push('', 'response = http.request(request)', 'puts response.code', 'puts response.body')
  return lines.join('\n') + '\n'
}

// ---------- Rust ----------

const RUST_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head']

function genRust(req: Req): string {
  const b = req.body
  const m = req.method.toLowerCase()
  const lines: string[] = []
  const pre: string[] = []
  let useJson = false
  if (b.kind === 'multipart') {
    pre.push('    let form = reqwest::multipart::Form::new()')
    for (const f of b.fields) {
      pre.push(f.type === 'file' ? `        .file(${rustStr(f.key)}, ${rustStr(filePath(f))})\n        .await?` : `        .text(${rustStr(f.key)}, ${rustStr(f.value)})`)
    }
    pre[pre.length - 1] += ';'
    pre.push('')
  }
  lines.push('    let response = client')
  lines.push(RUST_METHODS.includes(m) ? `        .${m}(${rustStr(req.url)})` : `        .request(reqwest::Method::from_bytes(b${dq(req.method)})?, ${rustStr(req.url)})`)
  for (const h of req.headers) lines.push(`        .header(${rustStr(h.key)}, ${rustStr(h.value)})`)
  if (req.basic) lines.push(`        .basic_auth(${rustStr(req.basic.username)}, Some(${rustStr(req.basic.password)}))`)
  if (b.kind === 'text') {
    if (b.json !== undefined) {
      useJson = true
      lines.push(`        .json(&json!(${indent(JSON.stringify(b.json, null, 4), '        ').trimStart()}))`)
    } else lines.push(`        .body(${rustText(b.text)})`)
  } else if (b.kind === 'urlencoded') {
    lines.push('        .form(&[', ...b.fields.map((f) => `            (${rustStr(f.key)}, ${rustStr(f.value)}),`), '        ])')
  } else if (b.kind === 'multipart') lines.push('        .multipart(form)')
  else if (b.kind === 'binary') lines.push(`        .body(std::fs::read(${rustStr(b.name)})?)`)
  lines.push('        .send()', '        .await?;')
  const head = ['use reqwest::Client;']
  if (useJson) head.push('use serde_json::json;')
  head.push('', '#[tokio::main]', 'async fn main() -> Result<(), Box<dyn std::error::Error>> {', '    let client = Client::new();', '')
  const tail = ['', '    println!("{}", response.status());', '    println!("{}", response.text().await?);', '    Ok(())', '}']
  return [...head, ...pre, ...lines, ...tail].join('\n') + '\n'
}

// ---------- Swift ----------

function genSwift(req: Req): string {
  const b = req.body
  const headers = basicHeader(req)
  const lines = ['import Foundation', '', `var request = URLRequest(url: URL(string: ${dq(req.url)})!)`, `request.httpMethod = ${dq(req.method)}`]
  for (const h of headers) lines.push(`request.setValue(${dq(h.value)}, forHTTPHeaderField: ${dq(h.key)})`)
  if (b.kind === 'text') lines.push(`request.httpBody = ${swiftText(b.text, '')}.data(using: .utf8)`)
  else if (b.kind === 'urlencoded') lines.push(`request.httpBody = ${dq(formEncode(b.fields))}.data(using: .utf8)`)
  else if (b.kind === 'multipart') {
    lines.push(`let boundary = ${dq(boundary)}`, 'request.setValue("multipart/form-data; boundary=\\(boundary)", forHTTPHeaderField: "Content-Type")', 'var body = Data()')
    for (const f of b.fields) {
      lines.push('body.append("--\\(boundary)\\r\\n".data(using: .utf8)!)')
      if (f.type === 'file') {
        lines.push(
          `body.append("Content-Disposition: form-data; name=\\"${f.key}\\"; filename=\\"${filePath(f)}\\"\\r\\n".data(using: .utf8)!)`,
          'body.append("Content-Type: application/octet-stream\\r\\n\\r\\n".data(using: .utf8)!)',
          `body.append(try! Data(contentsOf: URL(fileURLWithPath: ${dq(filePath(f))})))`,
        )
      } else {
        lines.push(`body.append("Content-Disposition: form-data; name=\\"${f.key}\\"\\r\\n\\r\\n".data(using: .utf8)!)`, `body.append(${dq(f.value)}.data(using: .utf8)!)`)
      }
      lines.push('body.append("\\r\\n".data(using: .utf8)!)')
    }
    lines.push('body.append("--\\(boundary)--\\r\\n".data(using: .utf8)!)', 'request.httpBody = body')
  } else if (b.kind === 'binary') lines.push(`request.httpBody = try! Data(contentsOf: URL(fileURLWithPath: ${dq(b.name)}))`)
  lines.push(
    '',
    'let task = URLSession.shared.dataTask(with: request) { data, response, error in',
    '  guard let data = data, error == nil else {',
    '    print(error ?? "Unknown error")',
    '    return',
    '  }',
    '  if let httpResponse = response as? HTTPURLResponse {',
    '    print(httpResponse.statusCode)',
    '  }',
    '  print(String(data: data, encoding: .utf8) ?? "")',
    '}',
    'task.resume()',
  )
  return lines.join('\n') + '\n'
}

// ---------- Kotlin ----------

function genKotlin(req: Req): string {
  const b = req.body
  const imports = new Set(['okhttp3.OkHttpClient', 'okhttp3.Request'])
  const lines: string[] = []
  let bodyExpr = 'null'
  if (b.kind === 'text') {
    imports.add('okhttp3.MediaType.Companion.toMediaType').add('okhttp3.RequestBody.Companion.toRequestBody')
    lines.push(`val mediaType = ${kotlinStr(req.contentType)}.toMediaType()`, `val body = ${kotlinText(b.text, '  ')}.toRequestBody(mediaType)`)
    bodyExpr = 'body'
  } else if (b.kind === 'urlencoded') {
    imports.add('okhttp3.FormBody')
    lines.push('val body = FormBody.Builder()', ...b.fields.map((f) => `  .add(${kotlinStr(f.key)}, ${kotlinStr(f.value)})`), '  .build()')
    bodyExpr = 'body'
  } else if (b.kind === 'multipart') {
    imports.add('okhttp3.MultipartBody')
    lines.push('val body = MultipartBody.Builder()', '  .setType(MultipartBody.FORM)')
    for (const f of b.fields) {
      if (f.type === 'file') {
        imports.add('java.io.File').add('okhttp3.MediaType.Companion.toMediaType').add('okhttp3.RequestBody.Companion.asRequestBody')
        lines.push(`  .addFormDataPart(${kotlinStr(f.key)}, ${kotlinStr(filePath(f))},`, `    File(${kotlinStr(filePath(f))}).asRequestBody("application/octet-stream".toMediaType()))`)
      } else lines.push(`  .addFormDataPart(${kotlinStr(f.key)}, ${kotlinStr(f.value)})`)
    }
    lines.push('  .build()')
    bodyExpr = 'body'
  } else if (b.kind === 'binary') {
    imports.add('java.io.File').add('okhttp3.MediaType.Companion.toMediaType').add('okhttp3.RequestBody.Companion.asRequestBody')
    lines.push(`val body = File(${kotlinStr(b.name)}).asRequestBody(${kotlinStr(req.contentType)}.toMediaType())`)
    bodyExpr = 'body'
  }
  if (req.basic) imports.add('okhttp3.Credentials')
  lines.push('val request = Request.Builder()', `  .url(${kotlinStr(req.url)})`, `  .method(${kotlinStr(req.method)}, ${bodyExpr})`)
  for (const h of req.headers) lines.push(`  .addHeader(${kotlinStr(h.key)}, ${kotlinStr(h.value)})`)
  if (req.basic) lines.push(`  .addHeader("Authorization", Credentials.basic(${kotlinStr(req.basic.username)}, ${kotlinStr(req.basic.password)}))`)
  lines.push('  .build()')
  const head = [...[...imports].sort().map((i) => `import ${i}`), '', 'val client = OkHttpClient()', '']
  const tail = ['', 'client.newCall(request).execute().use { response ->', '  println(response.code)', '  println(response.body?.string())', '}']
  return [...head, ...lines, ...tail].join('\n') + '\n'
}

// ---------- PowerShell ----------

const PS_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE', 'MERGE']

function genPowershell(req: Req): string {
  const b = req.body
  const lines: string[] = []
  const args = [`-Uri ${psStr(req.url)}`]
  const m = req.method
  args.push(PS_METHODS.includes(m) ? `-Method ${m[0] + m.slice(1).toLowerCase()}` : `-CustomMethod ${psStr(m)}`)
  const headers = req.headers.filter((h) => h.key.toLowerCase() !== 'content-type')
  if (headers.length) {
    lines.push('$headers = @{', ...headers.map((h) => `  ${psStr(h.key)} = ${psStr(h.value)}`), '}', '')
    args.push('-Headers $headers')
  }
  if (req.basic) {
    lines.push(`$password = ConvertTo-SecureString ${psStr(req.basic.password)} -AsPlainText -Force`, `$credential = New-Object System.Management.Automation.PSCredential(${psStr(req.basic.username)}, $password)`, '')
    args.push('-Authentication Basic', '-Credential $credential')
  }
  if (b.kind === 'text') {
    lines.push(`$body = ${psText(b.text)}`, '')
    args.push('-Body $body', `-ContentType ${psStr(req.contentType)}`)
  } else if (b.kind === 'urlencoded') {
    lines.push('$body = @{', ...b.fields.map((f) => `  ${psStr(f.key)} = ${psStr(f.value)}`), '}', '')
    args.push('-Body $body', `-ContentType ${psStr(req.contentType)}`)
  } else if (b.kind === 'multipart') {
    lines.push('$form = @{', ...b.fields.map((f) => `  ${psStr(f.key)} = ${f.type === 'file' ? `Get-Item -Path ${psStr(filePath(f))}` : psStr(f.value)}`), '}', '')
    args.push('-Form $form')
  } else if (b.kind === 'binary') {
    args.push(`-InFile ${psStr(b.name)}`, `-ContentType ${psStr(req.contentType)}`)
  }
  lines.push(`$response = Invoke-RestMethod ${args.join(' `\n  ')}`, '', '$response | ConvertTo-Json -Depth 10')
  return lines.join('\n') + '\n'
}

// ---------- Dart ----------

const DART_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head']

function genDart(req: Req): string {
  const b = req.body
  const headers = basicHeader(req)
  const lines = ["import 'package:http/http.dart' as http;"]
  if (b.kind === 'text' && b.json !== undefined) lines.push("import 'dart:convert';")
  if (b.kind === 'binary') lines.push("import 'dart:io';")
  lines.push('', 'void main() async {', `  final url = Uri.parse(${dartStr(req.url)});`)
  if (headers.length) lines.push('  final headers = {', ...headers.map((h) => `    ${dartStr(h.key)}: ${dartStr(h.value)},`), '  };')
  const m = req.method.toLowerCase()
  const hdrArg = headers.length ? ', headers: headers' : ''
  if (b.kind === 'multipart') {
    lines.push(`  final request = http.MultipartRequest(${dartStr(req.method)}, url);`)
    if (headers.length) lines.push('  request.headers.addAll(headers);')
    for (const f of b.fields) {
      if (f.type === 'file') lines.push(`  request.files.add(await http.MultipartFile.fromPath(${dartStr(f.key)}, ${dartStr(filePath(f))}));`)
      else lines.push(`  request.fields[${dartStr(f.key)}] = ${dartStr(f.value)};`)
    }
    lines.push('', '  final streamed = await request.send();', '  final response = await http.Response.fromStream(streamed);')
  } else {
    let bodyArg = ''
    if (b.kind === 'text') {
      lines.push(`  final body = ${dartText(b.text, b.json, '  ')};`)
      bodyArg = ', body: body'
    } else if (b.kind === 'urlencoded') {
      lines.push('  final body = {', ...b.fields.map((f) => `    ${dartStr(f.key)}: ${dartStr(f.value)},`), '  };')
      bodyArg = ', body: body'
    } else if (b.kind === 'binary') {
      lines.push(`  final body = File(${dartStr(b.name)}).readAsBytesSync();`)
      bodyArg = ', body: body'
    }
    if (DART_METHODS.includes(m)) {
      lines.push('', m === 'get' || m === 'head' ? `  final response = await http.${m}(url${hdrArg});` : `  final response = await http.${m}(url${hdrArg}${bodyArg});`)
    } else {
      lines.push(`  final request = http.Request(${dartStr(req.method)}, url);`)
      if (headers.length) lines.push('  request.headers.addAll(headers);')
      if (b.kind === 'text') lines.push('  request.body = body;')
      else if (b.kind === 'urlencoded') lines.push('  request.bodyFields = body;')
      else if (b.kind === 'binary') lines.push('  request.bodyBytes = body;')
      lines.push('', '  final streamed = await request.send();', '  final response = await http.Response.fromStream(streamed);')
    }
  }
  lines.push('  print(response.statusCode);', '  print(response.body);', '}')
  return lines.join('\n') + '\n'
}

// ---------- registry ----------

const generators: Record<string, (req: Req) => string> = {
  curl: genCurl,
  'curl-windows': genCurlWindows,
  wget: genWget,
  httpie: genHttpie,
  http: genHttp,
  'js-fetch': (r) => genFetch(r, false),
  'js-axios': genAxios,
  'node-fetch': (r) => genFetch(r, true),
  'node-https': genNodeHttps,
  'python-requests': genPythonRequests,
  'python-http.client': genPythonHttpClient,
  'go-native': genGo,
  'java-okhttp': genJavaOkHttp,
  'java-httpclient': genJavaHttpClient,
  'csharp-httpclient': genCsharpHttpClient,
  'csharp-restsharp': genCsharpRestSharp,
  'php-curl': genPhpCurl,
  'php-guzzle': genPhpGuzzle,
  'ruby-net-http': genRuby,
  'rust-reqwest': genRust,
  'swift-urlsession': genSwift,
  'kotlin-okhttp': genKotlin,
  powershell: genPowershell,
  'dart-http': genDart,
}

export function generate(targetId: string, input: CodegenInput): string {
  const gen = generators[targetId]
  if (!gen) throw new Error(`Unknown codegen target: ${targetId}`)
  return gen(prepare(input))
}
