import YAML from 'yaml'
import type { ExportCollection, ExportEnvironment, ExportFolder, ExportRequest } from '../export/types.js'
import type { ImportResult, ImportedCollection, ImportedFolder, ImportedRequest } from './types.js'
import { importPostman, isPostmanCollection, isPostmanEnvironment } from './postman.js'
import { importOpenApi } from './openapi.js'
import { importCurl } from './curl.js'
import { importHar } from './har.js'
import { importInsomnia } from './insomnia.js'
import { importBruno } from './bruno.js'

export * from './types.js'
export { importPostman, importPostmanCollection, importPostmanEnvironment } from './postman.js'
export { importOpenApi, exampleFromSchema, makeResolver } from './openapi.js'
export { importCurl } from './curl.js'
export { importHar } from './har.js'
export { importInsomnia } from './insomnia.js'
export { importBruno, parseBru } from './bruno.js'

export interface QuiverExportFile {
  quiver: 1
  exportedAt?: string
  collections: ExportCollection[]
  environments?: ExportEnvironment[]
}

function requestFromExport(r: ExportRequest): ImportedRequest {
  const req: ImportedRequest = {
    name: r.name,
    method: r.method,
    url: r.url,
    params: r.params ?? [],
    headers: r.headers ?? [],
    body: r.body ?? { mode: 'none' },
    auth: r.auth ?? { type: 'inherit' },
  }
  if (r.description) req.description = r.description
  if (r.preRequestScript) req.preRequestScript = r.preRequestScript
  if (r.testScript) req.testScript = r.testScript
  if (r.settings && Object.keys(r.settings).length) req.settings = r.settings
  if (Array.isArray(r.examples) && r.examples.length) {
    req.examples = r.examples.map(e => ({
      name: e.name,
      request: { method: e.request.method, url: e.request.url, headers: e.request.headers ?? [], body: e.request.body },
      status: e.status,
      statusText: e.statusText ?? '',
      headers: e.headers ?? [],
      body: e.body ?? '',
    }))
  }
  return req
}

function folderFromExport(f: ExportFolder): ImportedFolder {
  const folder: ImportedFolder = {
    name: f.name,
    folders: (f.folders ?? []).map(folderFromExport),
    requests: (f.requests ?? []).map(requestFromExport),
  }
  if (f.description) folder.description = f.description
  if (f.auth && f.auth.type !== 'inherit') folder.auth = f.auth
  if (f.preRequestScript) folder.preRequestScript = f.preRequestScript
  if (f.testScript) folder.testScript = f.testScript
  return folder
}

export function collectionFromExport(c: ExportCollection): ImportedCollection {
  const col: ImportedCollection = {
    name: c.name,
    variables: c.variables ?? [],
    folders: (c.folders ?? []).map(folderFromExport),
    requests: (c.requests ?? []).map(requestFromExport),
  }
  if (c.description) col.description = c.description
  if (c.auth) col.auth = c.auth
  if (c.preRequestScript) col.preRequestScript = c.preRequestScript
  if (c.testScript) col.testScript = c.testScript
  return col
}

export function importQuiver(json: QuiverExportFile): ImportResult {
  return {
    format: 'quiver',
    collections: (json.collections ?? []).map(collectionFromExport),
    environments: (json.environments ?? []).map(e => ({ name: e.name, variables: e.variables ?? [] })),
  }
}

function parseStructured(text: string): any {
  try { return JSON.parse(text) } catch { /* not JSON */ }
  try {
    const doc = YAML.parse(text)
    if (doc && typeof doc === 'object') return doc
  } catch { /* not YAML */ }
  return undefined
}

export function importObject(obj: any): ImportResult {
  if (!obj || typeof obj !== 'object') throw new Error('Unrecognised import format')
  if (obj.quiver && obj.version !== undefined && Array.isArray(obj.collections)) return importQuiver(obj)
  if (obj.quiver === 1 && Array.isArray(obj.collections)) return importQuiver(obj)
  if (obj.openapi || obj.swagger) return importOpenApi(obj)
  if (obj.log && Array.isArray(obj.log.entries)) return importHar(obj)
  if (obj._type === 'export' || Array.isArray(obj.resources)) return importInsomnia(obj)
  if (isPostmanCollection(obj)) return importPostman(obj)
  if (obj.collection && isPostmanCollection(obj.collection)) return importPostman(obj)
  if (Array.isArray(obj.collections) && obj.collections.some((c: any) => isPostmanCollection(c?.collection ?? c))) return importPostman(obj)
  if (Array.isArray(obj.collections) && Array.isArray(obj.environments)) return importPostman(obj)
  if (isPostmanEnvironment(obj)) return importPostman(obj)
  throw new Error('Unrecognised import format')
}

export function detectAndImport(input: string | Buffer, filename?: string): ImportResult {
  const text = (Buffer.isBuffer(input) ? input.toString('utf8') : input).replace(/^﻿/, '').trim()
  if (!text) throw new Error('Empty import')
  if (filename && filename.endsWith('.bru')) return importBruno([{ path: filename, content: text }])
  if (/^\s*(\$\s*)?curl\b/i.test(text) || /^\s*[\w./-]*curl\s/.test(text)) return importCurl(text)
  const obj = parseStructured(text)
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) return importObject(obj)
  if (Array.isArray(obj) && obj.length && obj.every((r: any) => r && typeof r === 'object' && r._type)) return importInsomnia({ resources: obj })
  throw new Error('Unrecognised import format')
}

function mergeInto(target: ImportResult, r: ImportResult): void {
  target.collections.push(...r.collections)
  target.environments.push(...r.environments)
}

export function importFiles(files: { name: string; content: string }[]): ImportResult {
  const bru = files.filter(f => f.name.endsWith('.bru') || f.name.endsWith('bruno.json'))
  const rest = files.filter(f => !bru.includes(f))
  const result: ImportResult = { format: 'quiver', collections: [], environments: [] }
  const formats = new Set<ImportResult['format']>()
  if (bru.length) {
    const r = importBruno(bru.map(f => ({ path: f.name, content: f.content })))
    formats.add(r.format)
    mergeInto(result, r)
  }
  const errors: string[] = []
  for (const f of rest) {
    try {
      const r = detectAndImport(f.content, f.name)
      formats.add(r.format)
      mergeInto(result, r)
    } catch (e: any) {
      errors.push(`${f.name}: ${e?.message ?? e}`)
    }
  }
  if (!result.collections.length && !result.environments.length) {
    throw new Error(errors.length ? errors.join('; ') : 'Unrecognised import format')
  }
  if (formats.size === 1) result.format = [...formats][0]!
  return result
}
