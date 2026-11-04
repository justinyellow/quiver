import type { AuthConfig, KV, RequestBody, Variable } from '../engine/types.js'
import type { ImportResult, ImportedCollection, ImportedFolder, ImportedRequest } from './types.js'
import { parseQuery } from './postman.js'

export interface BruBlock { name: string; body: string }

export function parseBru(content: string): BruBlock[] {
  const blocks: BruBlock[] = []
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    const m = /^([A-Za-z0-9_:-]+)\s*\{\s*$/.exec(line)
    if (!m) { i++; continue }
    const name = m[1]!
    const body: string[] = []
    let depth = 1
    i++
    while (i < lines.length) {
      const l = lines[i]!
      if (/^\}\s*$/.test(l) && depth === 1) { break }
      for (const ch of l) { if (ch === '{') depth++; else if (ch === '}') depth-- }
      body.push(l)
      i++
    }
    i++
    blocks.push({ name, body: body.join('\n') })
  }
  return blocks
}

function dict(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const i = line.indexOf(':')
    if (i < 0) { out[line] = ''; continue }
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

function kvs(body: string, opts: { file?: boolean } = {}): KV[] {
  const out: KV[] = []
  for (const raw of body.split('\n')) {
    let line = raw.trim()
    if (!line) continue
    let enabled = true
    if (line.startsWith('~')) { enabled = false; line = line.slice(1) }
    const i = line.indexOf(':')
    const key = (i < 0 ? line : line.slice(0, i)).trim()
    let value = i < 0 ? '' : line.slice(i + 1).trim()
    if (opts.file && value.startsWith('@file(') && value.endsWith(')')) {
      out.push({ key, value: '', enabled, type: 'file', src: value.slice(6, -1) })
      continue
    }
    value = value.replace(/^@contentType\([^)]*\)\s*/, '')
    out.push({ key, value, enabled })
  }
  return out
}

function dedent(body: string): string {
  const lines = body.split('\n')
  const indents = lines.filter(l => l.trim()).map(l => /^\s*/.exec(l)![0].length)
  const min = indents.length ? Math.min(...indents) : 0
  return lines.map(l => l.slice(min)).join('\n').replace(/^\n+|\n+$/g, '')
}

function authFromBlocks(blocks: BruBlock[], mode: string | undefined): AuthConfig | undefined {
  const m = (mode ?? '').toLowerCase()
  if (m === 'none') return { type: 'none' }
  if (m === 'inherit') return { type: 'inherit' }
  const find = (n: string) => blocks.find(b => b.name === n)
  const want = m || blocks.find(b => b.name.startsWith('auth:'))?.name.slice(5)
  switch (want) {
    case 'bearer': { const d = dict(find('auth:bearer')?.body ?? ''); return { type: 'bearer', bearer: { token: d.token ?? '' } } }
    case 'basic': { const d = dict(find('auth:basic')?.body ?? ''); return { type: 'basic', basic: { username: d.username ?? '', password: d.password ?? '' } } }
    case 'apikey': { const d = dict(find('auth:apikey')?.body ?? ''); return { type: 'apikey', apikey: { key: d.key ?? '', value: d.value ?? '', in: d.placement === 'queryparams' ? 'query' : 'header' } } }
    case 'digest': { const d = dict(find('auth:digest')?.body ?? ''); return { type: 'digest', digest: { username: d.username ?? '', password: d.password ?? '' } } }
    case 'awsv4': { const d = dict(find('auth:awsv4')?.body ?? ''); return { type: 'awsv4', awsv4: { accessKey: d.accessKeyId ?? '', secretKey: d.secretAccessKey ?? '', region: d.region ?? '', service: d.service ?? '', sessionToken: d.sessionToken || undefined } } }
    case 'oauth2': {
      const d = dict(find('auth:oauth2')?.body ?? '')
      const gt = d.grant_type ?? ''
      const grantType: NonNullable<AuthConfig['oauth2']>['grantType'] =
        gt === 'password' ? 'password' : gt === 'implicit' ? 'implicit' : gt === 'authorization_code' ? 'authorization_code' : 'client_credentials'
      return { type: 'oauth2', oauth2: { grantType, accessTokenUrl: d.access_token_url || undefined, authUrl: d.authorization_url || undefined, clientId: d.client_id || undefined, clientSecret: d.client_secret || undefined, scope: d.scope || undefined, username: d.username || undefined, password: d.password || undefined, usePkce: d.pkce === 'true' ? true : undefined } }
    }
    default: return undefined
  }
}

function bodyFromBlocks(blocks: BruBlock[], mode: string | undefined): RequestBody {
  const find = (n: string) => blocks.find(b => b.name === n)
  const m = (mode ?? '').toLowerCase()
  const want = m && m !== 'none' ? m : blocks.find(b => b.name.startsWith('body:'))?.name.slice(5)
  if (!want) return { mode: 'none' }
  switch (want) {
    case 'json': return { mode: 'json', raw: dedent(find('body:json')?.body ?? ''), language: 'json' }
    case 'text': return { mode: 'text', raw: dedent(find('body:text')?.body ?? ''), language: 'text' }
    case 'xml': return { mode: 'xml', raw: dedent(find('body:xml')?.body ?? ''), language: 'xml' }
    case 'sparql': return { mode: 'raw', raw: dedent(find('body:sparql')?.body ?? '') }
    case 'formurlencoded':
    case 'form-urlencoded': return { mode: 'urlencoded', urlencoded: kvs(find('body:form-urlencoded')?.body ?? '') }
    case 'multipartform':
    case 'multipart-form': return { mode: 'formdata', formdata: kvs(find('body:multipart-form')?.body ?? '', { file: true }) }
    case 'graphql': {
      const q = dedent(find('body:graphql')?.body ?? '')
      const v = find('body:graphql:vars')?.body
      return { mode: 'graphql', graphql: { query: q, variables: v ? dedent(v) : undefined } }
    }
    case 'file': {
      const d = dict(find('body:file')?.body ?? '')
      return { mode: 'binary', binary: { name: d.file ?? '', data: '' } }
    }
    default: {
      const b = find(`body:${want}`) ?? find('body')
      return b ? { mode: 'raw', raw: dedent(b.body) } : { mode: 'none' }
    }
  }
}

const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head', 'trace', 'connect']

function parseRequest(content: string, fallbackName: string): { req: ImportedRequest; seq: number } | null {
  const blocks = parseBru(content)
  const meta = dict(blocks.find(b => b.name === 'meta')?.body ?? '')
  if (meta.type && meta.type !== 'http' && meta.type !== 'graphql') return null
  const methodBlock = blocks.find(b => HTTP_METHODS.includes(b.name))
  if (!methodBlock) return null
  const m = dict(methodBlock.body)
  const fullUrl = m.url ?? ''
  const qi = fullUrl.indexOf('?')
  const url = qi >= 0 ? fullUrl.slice(0, qi) : fullUrl
  let params = kvs(blocks.find(b => b.name === 'params:query')?.body ?? '')
  if (!params.length && qi >= 0) params = parseQuery(fullUrl.slice(qi + 1))
  const req: ImportedRequest = {
    name: meta.name || fallbackName,
    method: methodBlock.name.toUpperCase(),
    url,
    params,
    headers: kvs(blocks.find(b => b.name === 'headers')?.body ?? ''),
    body: bodyFromBlocks(blocks, m.body),
    auth: authFromBlocks(blocks, m.auth) ?? { type: 'inherit' },
  }
  const docs = blocks.find(b => b.name === 'docs')
  if (docs) req.description = dedent(docs.body)
  const pre: string[] = []
  const vars = blocks.find(b => b.name === 'vars:pre-request')
  if (vars) {
    for (const kv of kvs(vars.body)) if (kv.enabled) pre.push(`pm.variables.set(${JSON.stringify(kv.key)}, ${JSON.stringify(kv.value)});`)
  }
  const preScript = blocks.find(b => b.name === 'script:pre-request')
  if (preScript) pre.push(dedent(preScript.body))
  if (pre.length) req.preRequestScript = pre.join('\n')
  const post: string[] = []
  const postScript = blocks.find(b => b.name === 'script:post-response')
  if (postScript) post.push(dedent(postScript.body))
  const tests = blocks.find(b => b.name === 'tests')
  if (tests) post.push(dedent(tests.body))
  if (post.length) req.testScript = post.join('\n')
  const seq = Number(meta.seq)
  return { req, seq: isNaN(seq) ? Number.MAX_SAFE_INTEGER : seq }
}

function parseEnvironment(content: string, name: string): { name: string; variables: Variable[] } {
  const blocks = parseBru(content)
  const variables: Variable[] = []
  for (const b of blocks) {
    if (b.name === 'vars') for (const kv of kvs(b.body)) variables.push({ key: kv.key, value: kv.value, enabled: kv.enabled })
    if (b.name === 'vars:secret') {
      for (const raw of b.body.split('\n')) {
        let line = raw.trim()
        if (!line) continue
        let enabled = true
        if (line.startsWith('~')) { enabled = false; line = line.slice(1) }
        const i = line.indexOf(':')
        variables.push({ key: (i < 0 ? line : line.slice(0, i)).trim(), value: i < 0 ? '' : line.slice(i + 1).trim(), enabled, type: 'secret' })
      }
    }
  }
  return { name, variables }
}

function applyCollectionLevel(target: ImportedCollection | ImportedFolder, content: string): void {
  const blocks = parseBru(content)
  const meta = dict(blocks.find(b => b.name === 'meta')?.body ?? '')
  if (meta.name) target.name = meta.name
  const authMode = dict(blocks.find(b => b.name === 'auth')?.body ?? '').mode
  const auth = authFromBlocks(blocks, authMode)
  if (auth) target.auth = auth
  const pre = blocks.find(b => b.name === 'script:pre-request')
  if (pre) target.preRequestScript = dedent(pre.body)
  const post: string[] = []
  const postScript = blocks.find(b => b.name === 'script:post-response')
  if (postScript) post.push(dedent(postScript.body))
  const tests = blocks.find(b => b.name === 'tests')
  if (tests) post.push(dedent(tests.body))
  if (post.length) target.testScript = post.join('\n')
  const docs = blocks.find(b => b.name === 'docs')
  if (docs) target.description = dedent(docs.body)
  if ('variables' in target) {
    const vars = blocks.find(b => b.name === 'vars:pre-request') ?? blocks.find(b => b.name === 'vars')
    if (vars) for (const kv of kvs(vars.body)) target.variables.push({ key: kv.key, value: kv.value, enabled: kv.enabled })
  }
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '')
}

export function importBruno(files: { path: string; content: string }[]): ImportResult {
  const col: ImportedCollection = { name: 'Bruno collection', variables: [], folders: [], requests: [] }
  const environments: { name: string; variables: Variable[] }[] = []
  const normalized = files.map(f => ({ path: normalizePath(f.path), content: f.content }))

  const allDirs = normalized.map(f => f.path.split('/').slice(0, -1))
  let rootDepth = 0
  const brunoJson = normalized.find(f => f.path.endsWith('bruno.json'))
  const collectionBru = normalized.find(f => f.path.endsWith('collection.bru') && !f.path.includes('/environments/'))
  if (brunoJson) rootDepth = brunoJson.path.split('/').length - 1
  else if (collectionBru) rootDepth = collectionBru.path.split('/').length - 1
  else if (allDirs.length) {
    let common = allDirs[0]!
    for (const d of allDirs) {
      let k = 0
      while (k < common.length && k < d.length && common[k] === d[k]) k++
      common = common.slice(0, k)
    }
    rootDepth = common.length
  }

  if (brunoJson) {
    try {
      const j = JSON.parse(brunoJson.content)
      if (j?.name) col.name = String(j.name)
    } catch { /* ignore */ }
  }
  if (collectionBru) applyCollectionLevel(col, collectionBru.content)

  const folderCache = new Map<string, ImportedFolder>()
  const folderFor = (segments: string[]): ImportedFolder | ImportedCollection => {
    if (!segments.length) return col
    const key = segments.join('/')
    let f = folderCache.get(key)
    if (f) return f
    const parent = folderFor(segments.slice(0, -1))
    f = { name: segments[segments.length - 1]!, folders: [], requests: [] }
    folderCache.set(key, f)
    parent.folders.push(f)
    return f
  }

  const pending: { target: ImportedCollection | ImportedFolder; req: ImportedRequest; seq: number; idx: number }[] = []
  let idx = 0
  for (const f of normalized) {
    const parts = f.path.split('/').slice(rootDepth)
    const fileName = parts[parts.length - 1] ?? ''
    const dirs = parts.slice(0, -1)
    if (!fileName.endsWith('.bru')) continue
    if (dirs[0] === 'environments') {
      environments.push(parseEnvironment(f.content, fileName.replace(/\.bru$/, '')))
      continue
    }
    if (fileName === 'collection.bru' && dirs.length === 0) continue
    if (fileName === 'folder.bru') {
      if (dirs.length) applyCollectionLevel(folderFor(dirs) as ImportedFolder, f.content)
      continue
    }
    const parsed = parseRequest(f.content, fileName.replace(/\.bru$/, ''))
    if (!parsed) continue
    pending.push({ target: folderFor(dirs), req: parsed.req, seq: parsed.seq, idx: idx++ })
  }
  pending.sort((a, b) => a.seq - b.seq || a.idx - b.idx)
  for (const p of pending) p.target.requests.push(p.req)

  return { format: 'bruno', collections: [col], environments }
}
