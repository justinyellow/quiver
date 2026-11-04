import type { KV, RequestBody } from '../engine/types.js'
import type { ImportResult, ImportedCollection, ImportedFolder, ImportedRequest } from './types.js'
import { parseQuery } from './postman.js'

const SKIP_HEADERS = new Set([
  'cookie', 'content-length', 'host', 'accept-encoding', 'connection', 'keep-alive', 'transfer-encoding',
  'upgrade-insecure-requests', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'sec-fetch-user',
  'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'origin', 'referer', 'pragma', 'cache-control',
  'te', 'dnt', 'priority', 'if-none-match', 'if-modified-since',
])

function str(v: any): string {
  if (v == null) return ''
  return typeof v === 'string' ? v : String(v)
}

function filterHeaders(list: any, skip: boolean): KV[] {
  if (!Array.isArray(list)) return []
  const out: KV[] = []
  for (const h of list) {
    if (!h || typeof h !== 'object' || h.name == null) continue
    const name = str(h.name)
    if (name.startsWith(':')) continue
    if (skip && SKIP_HEADERS.has(name.toLowerCase())) continue
    out.push({ key: name, value: str(h.value), enabled: true })
  }
  return out
}

function bodyOf(post: any): RequestBody {
  if (!post || typeof post !== 'object') return { mode: 'none' }
  const mime = str(post.mimeType).toLowerCase()
  if (Array.isArray(post.params) && post.params.length) {
    const kvs: KV[] = post.params.map((p: any) => ({
      key: str(p.name),
      value: p.fileName ? '' : str(p.value),
      enabled: true,
      ...(p.fileName ? { type: 'file' as const, src: str(p.fileName) } : {}),
    }))
    return mime.includes('multipart') ? { mode: 'formdata', formdata: kvs } : { mode: 'urlencoded', urlencoded: kvs }
  }
  const text = str(post.text)
  if (!text && !mime) return { mode: 'none' }
  if (mime.includes('json')) return { mode: 'json', raw: text, language: 'json' }
  if (mime.includes('x-www-form-urlencoded')) return { mode: 'urlencoded', urlencoded: parseQuery(text) }
  if (mime.includes('xml')) return { mode: 'xml', raw: text, language: 'xml' }
  if (mime.includes('html')) return { mode: 'html', raw: text, language: 'html' }
  if (mime.startsWith('text/')) return { mode: 'text', raw: text, language: 'text' }
  if (mime.includes('graphql')) return { mode: 'graphql', graphql: { query: text } }
  if (!mime) {
    const t = text.trim()
    if (t.startsWith('{') || t.startsWith('[')) {
      try { JSON.parse(t); return { mode: 'json', raw: text, language: 'json' } } catch { /* fall through */ }
    }
  }
  return text ? { mode: 'raw', raw: text } : { mode: 'none' }
}

function hostOf(url: string): string {
  try { return new URL(url).host } catch { return 'unknown' }
}

export function importHar(json: any): ImportResult {
  const entries: any[] = Array.isArray(json?.log?.entries) ? json.log.entries : Array.isArray(json?.entries) ? json.entries : []
  if (!json?.log && !Array.isArray(json?.entries)) throw new Error('Invalid HAR: missing log.entries')
  const col: ImportedCollection = { name: str(json.log?.creator?.name ? `HAR (${json.log.creator.name})` : 'Imported HAR'), variables: [], folders: [], requests: [] }
  const folders = new Map<string, ImportedFolder>()
  for (const entry of entries) {
    const r = entry?.request
    if (!r || typeof r !== 'object' || !r.url) continue
    const fullUrl = str(r.url)
    const qi = fullUrl.indexOf('?')
    const url = qi >= 0 ? fullUrl.slice(0, qi) : fullUrl
    let params: KV[] = Array.isArray(r.queryString) && r.queryString.length
      ? r.queryString.map((q: any) => ({ key: str(q.name), value: str(q.value), enabled: true }))
      : qi >= 0 ? parseQuery(fullUrl.slice(qi + 1)) : []
    const method = str(r.method || 'GET').toUpperCase()
    const headers = filterHeaders(r.headers, true)
    const body = bodyOf(r.postData)
    const path = (() => { try { return new URL(url).pathname } catch { return url } })()
    const req: ImportedRequest = {
      name: `${method} ${path}`,
      method,
      url,
      params,
      headers,
      body,
      auth: { type: 'inherit' },
    }
    const res = entry.response
    if (res && typeof res === 'object' && typeof res.status === 'number' && res.status > 0) {
      let text = str(res.content?.text)
      if (res.content?.encoding === 'base64' && text) {
        try { text = Buffer.from(text, 'base64').toString('utf8') } catch { /* keep raw */ }
      }
      req.examples = [{
        name: `${res.status} ${str(res.statusText)}`.trim(),
        request: { method, url, headers, body: body.mode === 'none' ? undefined : body },
        status: res.status,
        statusText: str(res.statusText),
        headers: filterHeaders(res.headers, false).filter(h => !['content-length', 'transfer-encoding', 'connection', 'set-cookie'].includes(h.key.toLowerCase())),
        body: text,
      }]
    }
    const host = hostOf(url)
    let folder = folders.get(host)
    if (!folder) {
      folder = { name: host, folders: [], requests: [] }
      folders.set(host, folder)
      col.folders.push(folder)
    }
    folder.requests.push(req)
  }
  return { format: 'har', collections: [col], environments: [] }
}
