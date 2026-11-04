import type { AuthConfig, KV, RequestBody, RequestSettings } from '../engine/types.js'
import type { ImportResult, ImportedRequest } from './types.js'
import { parseQuery } from './postman.js'

export function tokenize(text: string): string[] {
  const tokens: string[] = []
  let cur = ''
  let has = false
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text[i]!
    if (c === '\\') {
      const next = text[i + 1]
      if (next === '\n') { i += 2; continue }
      if (next === '\r' && text[i + 2] === '\n') { i += 3; continue }
      if (next !== undefined) { cur += next; has = true; i += 2; continue }
      i++
      continue
    }
    if (c === "'") {
      has = true
      i++
      while (i < n && text[i] !== "'") { cur += text[i]; i++ }
      i++
      continue
    }
    if (c === '$' && text[i + 1] === "'") {
      has = true
      i += 2
      while (i < n && text[i] !== "'") {
        if (text[i] === '\\' && i + 1 < n) {
          const e = text[i + 1]!
          cur += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e
          i += 2
        } else { cur += text[i]; i++ }
      }
      i++
      continue
    }
    if (c === '"') {
      has = true
      i++
      while (i < n && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < n) {
          const e = text[i + 1]!
          if (e === '\n') { i += 2; continue }
          if (e === '"' || e === '\\' || e === '$' || e === '`') { cur += e; i += 2; continue }
          cur += '\\'
          i++
          continue
        }
        cur += text[i]
        i++
      }
      i++
      continue
    }
    if (/\s/.test(c)) {
      if (has) { tokens.push(cur); cur = ''; has = false }
      i++
      continue
    }
    cur += c
    has = true
    i++
  }
  if (has) tokens.push(cur)
  return tokens
}

function splitCommands(text: string): string[][] {
  const tokens = tokenize(text.replace(/\r\n/g, '\n'))
  const commands: string[][] = []
  let cur: string[] = []
  for (const t of tokens) {
    if ((t === 'curl' || t.endsWith('/curl')) && cur.length === 0) { cur.push(t); continue }
    if ((t === 'curl' || t.endsWith('/curl')) && cur.length) { commands.push(cur); cur = [t]; continue }
    if (t === ';' || t === '&&' || t === '||') { if (cur.length) commands.push(cur); cur = []; continue }
    cur.push(t)
  }
  if (cur.length) commands.push(cur)
  return commands.filter(c => c.length && (c[0] === 'curl' || c[0]!.endsWith('/curl')))
}

const LONG_WITH_VALUE = new Set(['request', 'header', 'data', 'data-raw', 'data-binary', 'data-urlencode', 'data-urlencoded', 'data-ascii', 'form', 'form-string', 'user', 'url', 'cookie', 'user-agent', 'referer', 'max-time', 'connect-timeout', 'proxy', 'output', 'cacert', 'cert', 'key', 'max-redirs', 'upload-file', 'oauth2-bearer', 'json'])
const SHORT_WITH_VALUE = new Set(['X', 'H', 'd', 'F', 'u', 'b', 'A', 'e', 'm', 'x', 'o', 'E', 'T'])

function parseCommand(args: string[]): ImportedRequest | null {
  let method = ''
  let url = ''
  const headers: KV[] = []
  const data: string[] = []
  let binaryData = false
  const forms: KV[] = []
  let user: string | undefined
  const settings: RequestSettings = {}
  let getMode = false
  let bearer: string | undefined
  let isJson = false

  const addHeader = (h: string) => {
    const i = h.indexOf(':')
    if (i < 0) { headers.push({ key: h.replace(/;$/, ''), value: '', enabled: true }); return }
    headers.push({ key: h.slice(0, i).trim(), value: h.slice(i + 1).trim(), enabled: true })
  }

  for (let i = 1; i < args.length; i++) {
    const a = args[i]!
    let val: string | undefined
    if (a.startsWith('--')) {
      let name = a.slice(2)
      const eq = name.indexOf('=')
      if (eq >= 0) { val = name.slice(eq + 1); name = name.slice(0, eq) }
      if (LONG_WITH_VALUE.has(name) && val === undefined) val = args[++i]
      switch (name) {
        case 'request': method = (val ?? '').toUpperCase(); break
        case 'header': if (val !== undefined) addHeader(val); break
        case 'data': case 'data-raw': case 'data-ascii': if (val !== undefined) data.push(val.startsWith('@') && name !== 'data-raw' ? '' : val); break
        case 'data-binary': if (val !== undefined) { data.push(val); binaryData = true } break
        case 'data-urlencode': case 'data-urlencoded': if (val !== undefined) data.push(encodeDataUrlencode(val)); break
        case 'json': if (val !== undefined) { data.push(val); isJson = true } break
        case 'form': case 'form-string': if (val !== undefined) forms.push(formKv(val, name === 'form')); break
        case 'user': user = val; break
        case 'url': if (val !== undefined) url = val; break
        case 'cookie': if (val !== undefined) headers.push({ key: 'Cookie', value: val, enabled: true }); break
        case 'user-agent': if (val !== undefined) headers.push({ key: 'User-Agent', value: val, enabled: true }); break
        case 'referer': if (val !== undefined) headers.push({ key: 'Referer', value: val, enabled: true }); break
        case 'insecure': settings.verifyTls = false; break
        case 'location': settings.followRedirects = true; break
        case 'get': getMode = true; break
        case 'head': method = 'HEAD'; break
        case 'max-time': if (val !== undefined && !isNaN(Number(val))) settings.timeoutMs = Number(val) * 1000; break
        case 'max-redirs': if (val !== undefined && !isNaN(Number(val))) settings.maxRedirects = Number(val); break
        case 'oauth2-bearer': bearer = val; break
        case 'compressed': case 'silent': case 'verbose': case 'include': case 'show-error': case 'fail': case 'globoff': case 'no-buffer': case 'http1.1': case 'http2': case 'ssl': case 'tlsv1.2': case 'tlsv1.3': break
        default: break
      }
      continue
    }
    if (a.startsWith('-') && a.length > 1) {
      const flag = a[1]!
      if (SHORT_WITH_VALUE.has(flag)) {
        val = a.length > 2 ? a.slice(2) : args[++i]
      } else if (a.length > 2) {
        for (const f of a.slice(1)) {
          if (f === 'k') settings.verifyTls = false
          else if (f === 'L') settings.followRedirects = true
          else if (f === 'G') getMode = true
          else if (f === 'I') method = 'HEAD'
        }
        continue
      }
      switch (flag) {
        case 'X': method = (val ?? '').toUpperCase(); break
        case 'H': if (val !== undefined) addHeader(val); break
        case 'd': if (val !== undefined) data.push(val.startsWith('@') ? '' : val); break
        case 'F': if (val !== undefined) forms.push(formKv(val, true)); break
        case 'u': user = val; break
        case 'b': if (val !== undefined) headers.push({ key: 'Cookie', value: val, enabled: true }); break
        case 'A': if (val !== undefined) headers.push({ key: 'User-Agent', value: val, enabled: true }); break
        case 'e': if (val !== undefined) headers.push({ key: 'Referer', value: val, enabled: true }); break
        case 'm': if (val !== undefined && !isNaN(Number(val))) settings.timeoutMs = Number(val) * 1000; break
        case 'k': settings.verifyTls = false; break
        case 'L': settings.followRedirects = true; break
        case 'G': getMode = true; break
        case 'I': method = 'HEAD'; break
        default: break
      }
      continue
    }
    if (!url) url = a
  }

  if (!url) return null
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !url.startsWith('{{')) url = `http://${url}`

  let params: KV[] = []
  const qi = url.indexOf('?')
  if (qi >= 0) {
    params = parseQuery(url.slice(qi + 1))
    url = url.slice(0, qi)
  }

  const joined = data.join('&')
  let body: RequestBody = { mode: 'none' }
  if (getMode && data.length) {
    params.push(...parseQuery(joined))
  } else if (forms.length) {
    body = { mode: 'formdata', formdata: forms }
  } else if (data.length) {
    const ct = headers.find(h => h.key.toLowerCase() === 'content-type')?.value.toLowerCase() ?? ''
    if (isJson && !ct) headers.push({ key: 'Content-Type', value: 'application/json', enabled: true })
    const looksJson = (() => { try { JSON.parse(joined); return true } catch { return false } })()
    if (isJson || ct.includes('json') || (!ct && looksJson && /^[\[{]/.test(joined.trim()))) body = { mode: 'json', raw: joined, language: 'json' }
    else if (ct.includes('xml')) body = { mode: 'xml', raw: joined, language: 'xml' }
    else if (ct.includes('x-www-form-urlencoded') || (!ct && !binaryData && /^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(joined))) body = { mode: 'urlencoded', urlencoded: parseQuery(joined) }
    else body = { mode: ct.includes('text/') ? 'text' : 'raw', raw: joined, ...(ct.includes('text/') ? { language: 'text' as const } : {}) }
  }

  if (!method) method = getMode || (!data.length && !forms.length) ? 'GET' : 'POST'

  let auth: AuthConfig = { type: 'inherit' }
  if (user !== undefined) {
    const i = user.indexOf(':')
    auth = { type: 'basic', basic: { username: i < 0 ? user : user.slice(0, i), password: i < 0 ? '' : user.slice(i + 1) } }
  } else if (bearer !== undefined) {
    auth = { type: 'bearer', bearer: { token: bearer } }
  } else {
    const ah = headers.find(h => h.key.toLowerCase() === 'authorization')
    if (ah && /^bearer\s+/i.test(ah.value)) {
      auth = { type: 'bearer', bearer: { token: ah.value.replace(/^bearer\s+/i, '') } }
      headers.splice(headers.indexOf(ah), 1)
    }
  }

  const req: ImportedRequest = {
    name: `${method} ${url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split('?')[0]}`,
    method,
    url,
    params,
    headers,
    body,
    auth,
  }
  if (Object.keys(settings).length) req.settings = settings
  return req
}

function encodeDataUrlencode(v: string): string {
  const eq = v.indexOf('=')
  if (eq < 0) return v.startsWith('@') ? '' : encodeURIComponent(v)
  const name = v.slice(0, eq)
  const content = v.slice(eq + 1)
  if (!name) return encodeURIComponent(content)
  return `${name}=${encodeURIComponent(content.startsWith('@') ? '' : content)}`
}

function formKv(v: string, allowFile: boolean): KV {
  const eq = v.indexOf('=')
  const key = eq < 0 ? v : v.slice(0, eq)
  let value = eq < 0 ? '' : v.slice(eq + 1)
  if (allowFile && (value.startsWith('@') || value.startsWith('<'))) {
    const src = value.slice(1).split(';')[0]!
    return { key, value: '', enabled: true, type: 'file', src }
  }
  value = value.split(';type=')[0]!
  return { key, value, enabled: true }
}

export function importCurl(text: string): ImportResult {
  const commands = splitCommands(text.trim())
  const requests: ImportedRequest[] = []
  for (const c of commands) {
    const r = parseCommand(c)
    if (r) requests.push(r)
  }
  if (!requests.length) throw new Error('No cURL commands found')
  return {
    format: 'curl',
    collections: [{ name: 'Imported cURL', variables: [], folders: [], requests }],
    environments: [],
  }
}
