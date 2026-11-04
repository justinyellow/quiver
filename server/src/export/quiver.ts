import YAML from 'yaml'
import type { ExportCollection, ExportEnvironment, ExportFolder, ExportRequest } from './types.js'

export interface QuiverExport {
  quiver: 1
  exportedAt: string
  collections: ExportCollection[]
  environments: ExportEnvironment[]
}

export function exportQuiver(cols: ExportCollection[], envs: ExportEnvironment[]): QuiverExport {
  return { quiver: 1, exportedAt: new Date().toISOString(), collections: cols, environments: envs }
}

export function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[{}]/g, '')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120)
  return cleaned || 'untitled'
}

function prune(obj: any): any {
  if (Array.isArray(obj)) return obj.map(prune)
  if (obj && typeof obj === 'object') {
    const out: Record<string, any> = {}
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined || v === null) continue
      if (typeof v === 'string' && v === '' && k !== 'value') continue
      const pv = prune(v)
      if (Array.isArray(pv) && pv.length === 0) continue
      if (typeof pv === 'object' && !Array.isArray(pv) && Object.keys(pv).length === 0) continue
      out[k] = pv
    }
    return out
  }
  return obj
}

function toYaml(obj: any): string {
  return YAML.stringify(prune(obj), { lineWidth: 0, defaultStringType: 'PLAIN', defaultKeyType: 'PLAIN' })
}

function requestDoc(r: ExportRequest): any {
  const auth = r.auth && r.auth.type !== 'inherit' ? r.auth : undefined
  return {
    name: r.name,
    description: r.description || undefined,
    method: r.method,
    url: r.url,
    params: r.params,
    headers: r.headers,
    body: r.body && r.body.mode !== 'none' ? r.body : undefined,
    auth,
    scripts: { preRequest: r.preRequestScript || undefined, test: r.testScript || undefined },
    settings: r.settings,
    examples: r.examples?.map(e => ({ name: e.name, request: e.request, status: e.status, statusText: e.statusText, headers: e.headers, body: e.body })),
  }
}

function folderDoc(f: ExportFolder): any {
  const auth = f.auth && f.auth.type !== 'inherit' ? f.auth : undefined
  return {
    name: f.name,
    description: f.description || undefined,
    auth,
    scripts: { preRequest: f.preRequestScript || undefined, test: f.testScript || undefined },
  }
}

export function exportPlainText(col: ExportCollection): { path: string; content: string }[] {
  const files: { path: string; content: string }[] = []
  const used = new Set<string>()
  const unique = (dir: string, base: string, ext: string): string => {
    let candidate = `${dir}${base}${ext}`
    let n = 2
    while (used.has(candidate.toLowerCase())) candidate = `${dir}${base}-${n++}${ext}`
    used.add(candidate.toLowerCase())
    return candidate
  }
  files.push({
    path: 'collection.yaml',
    content: toYaml({
      name: col.name,
      description: col.description || undefined,
      auth: col.auth,
      variables: col.variables,
      scripts: { preRequest: col.preRequestScript || undefined, test: col.testScript || undefined },
    }),
  })
  used.add('collection.yaml')

  const walkRequests = (dir: string, requests: ExportRequest[]) => {
    for (const r of requests) {
      files.push({ path: unique(dir, safeFileName(r.name), '.yaml'), content: toYaml(requestDoc(r)) })
    }
  }
  const walkFolders = (dir: string, folders: ExportFolder[]) => {
    for (const f of folders) {
      const folderDir = `${unique(dir, safeFileName(f.name), '')}/`
      const meta = folderDoc(f)
      if (meta.description || meta.auth || meta.scripts.preRequest || meta.scripts.test) {
        files.push({ path: `${folderDir}folder.yaml`, content: toYaml(meta) })
        used.add(`${folderDir}folder.yaml`.toLowerCase())
      }
      walkRequests(folderDir, f.requests ?? [])
      walkFolders(folderDir, f.folders ?? [])
    }
  }
  walkRequests('', col.requests ?? [])
  walkFolders('', col.folders ?? [])
  return files
}
