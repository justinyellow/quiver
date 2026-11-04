import { EventEmitter } from 'node:events'
import type { Cookie, RequestDef, ScopeSet, TestResult, AuthConfig } from './types.js'
import { executeRequest, type ExecContext, type ScriptHolder } from './executor.js'
import type { GuardOptions } from './ssrf.js'

export interface TreeFolder { id: string; name: string; auth?: AuthConfig; preRequestScript?: string; testScript?: string; folders: TreeFolder[]; requests: RequestDef[] }
export interface TreeCollection { id: string; name: string; auth?: AuthConfig; variables?: Record<string, string>; preRequestScript?: string; testScript?: string; folders: TreeFolder[]; requests: RequestDef[] }

export interface RunConfig {
  iterations?: number
  delayMs?: number
  data?: Record<string, any>[]
  stopOnFailure?: boolean
  stopOnError?: boolean
  requestIds?: string[] // subset / order
  folderId?: string
  timeoutMs?: number
  persistVariables?: boolean
}

export interface RunItemResult {
  requestId?: string
  requestName: string
  path: string[]
  iteration: number
  method: string
  url: string
  status?: number
  statusText?: string
  timeMs?: number
  size?: number
  error?: string
  tests: TestResult[]
  console: { level: string; args: any[]; ts: number }[]
  scriptErrors: string[]
  skipped?: boolean
  responseBody?: string
  responseHeaders?: [string, string][]
  requestHeaders?: Record<string, string>
  requestBody?: string
  startedAt: number
}

export interface RunSummary {
  total: number
  passed: number
  failed: number
  errors: number
  skipped: number
  testsTotal: number
  testsPassed: number
  testsFailed: number
  durationMs: number
  iterations: number
  avgTimeMs: number
}

export interface FlatItem { def: RequestDef; folders: ScriptHolder[]; path: string[] }

export function flatten(col: TreeCollection, cfg: RunConfig = {}): FlatItem[] {
  const out: FlatItem[] = []
  const walk = (folders: TreeFolder[], requests: RequestDef[], chain: ScriptHolder[], path: string[], active: boolean) => {
    for (const r of requests) if (active) out.push({ def: r, folders: chain, path: [...path, r.name] })
    for (const f of folders) {
      const isTarget = active || f.id === cfg.folderId
      walk(f.folders, f.requests, [...chain, { id: f.id, name: f.name, auth: f.auth, preRequestScript: f.preRequestScript, testScript: f.testScript }], [...path, f.name], isTarget)
    }
  }
  walk(col.folders, col.requests, [], [col.name], !cfg.folderId)
  if (cfg.requestIds?.length) {
    const set = new Set(cfg.requestIds)
    const filtered = out.filter((i) => i.def.id && set.has(i.def.id))
    // preserve the order given in requestIds
    const idx = new Map(cfg.requestIds.map((id, i) => [id, i]))
    filtered.sort((a, b) => (idx.get(a.def.id!) ?? 0) - (idx.get(b.def.id!) ?? 0))
    return filtered
  }
  return out
}

export class CollectionRun extends EventEmitter {
  results: RunItemResult[] = []
  cancelled = false
  private abort = new AbortController()
  constructor(public col: TreeCollection, public scopes: ScopeSet, public cfg: RunConfig, public opts: { environmentName?: string; cookies?: Cookie[]; guard?: GuardOptions; send?: ExecContext['send']; includeBodies?: boolean } = {}) { super() }

  cancel() { this.cancelled = true; this.abort.abort() }

  async run(): Promise<{ results: RunItemResult[]; summary: RunSummary; scopes: ScopeSet; cookies: Cookie[]; updatedAuths: NonNullable<Awaited<ReturnType<typeof executeRequest>>['updatedAuth']>[] }> {
    const started = Date.now()
    const items = flatten(this.col, this.cfg)
    const data = this.cfg.data?.length ? this.cfg.data : undefined
    const iterations = data ? data.length : Math.max(1, this.cfg.iterations ?? 1)
    let cookies = this.opts.cookies ?? []
    const updatedAuths: any[] = []
    const colHolder: ScriptHolder = { id: this.col.id, name: this.col.name, auth: this.col.auth, preRequestScript: this.col.preRequestScript, testScript: this.col.testScript }
    const byName = new Map(items.map((i) => [i.def.name, i]))
    const byId = new Map(items.map((i) => [i.def.id, i]))
    this.emit('start', { total: items.length * iterations, iterations, requests: items.length })

    outer: for (let it = 0; it < iterations; it++) {
      this.scopes.data = data ? data[it] : {}
      this.scopes.local = {}
      let idx = 0
      let guardCounter = 0
      while (idx < items.length) {
        if (this.cancelled) break outer
        const item = items[idx]
        const startedAt = Date.now()
        this.emit('item:start', { iteration: it, index: idx, name: item.def.name, path: item.path })
        const res = await executeRequest(item.def, { scopes: this.scopes, environmentName: this.opts.environmentName, collection: colHolder, folders: item.folders, cookies, iteration: it, iterationCount: iterations, guard: this.opts.guard, send: this.opts.send, signal: this.abort.signal })
        cookies = res.cookies
        if (res.updatedAuth) updatedAuths.push(res.updatedAuth)
        const r: RunItemResult = {
          requestId: item.def.id, requestName: item.def.name, path: item.path, iteration: it,
          method: res.request.method, url: res.request.url, status: res.response?.status, statusText: res.response?.statusText,
          timeMs: res.response?.timeMs, size: res.response?.size, error: res.error, tests: res.tests, console: res.console, scriptErrors: res.scriptErrors, skipped: res.skipped,
          requestHeaders: res.request.headers, requestBody: res.request.body,
          responseHeaders: res.response?.headers,
          responseBody: this.opts.includeBodies !== false && res.response ? (res.response.isBase64 ? '[binary]' : res.response.body.slice(0, 64 * 1024)) : undefined,
          startedAt,
        }
        this.results.push(r)
        this.emit('item', r)
        const failed = r.tests.some((t) => !t.passed)
        if (res.error && this.cfg.stopOnError) break outer
        if ((failed || res.scriptErrors.length) && this.cfg.stopOnFailure) break outer
        // setNextRequest
        if (res.nextRequest === null) { break }
        if (res.nextRequest) {
          const target = byName.get(res.nextRequest) ?? byId.get(res.nextRequest)
          if (target && ++guardCounter < 1000) { idx = items.indexOf(target); continue }
        }
        idx++
        if (this.cfg.delayMs && idx < items.length) await new Promise((r) => setTimeout(r, this.cfg.delayMs))
      }
      if (this.cfg.delayMs && it < iterations - 1) await new Promise((r) => setTimeout(r, this.cfg.delayMs))
    }
    const summary = summarize(this.results, Date.now() - started, iterations)
    this.emit('done', summary)
    return { results: this.results, summary, scopes: this.scopes, cookies, updatedAuths }
  }
}

export function summarize(results: RunItemResult[], durationMs: number, iterations: number): RunSummary {
  const s: RunSummary = { total: results.length, passed: 0, failed: 0, errors: 0, skipped: 0, testsTotal: 0, testsPassed: 0, testsFailed: 0, durationMs, iterations, avgTimeMs: 0 }
  let t = 0, n = 0
  for (const r of results) {
    if (r.skipped) { s.skipped++; continue }
    if (r.error) { s.errors++; continue }
    const failed = r.tests.some((x) => !x.passed) || r.scriptErrors.length > 0
    if (failed) s.failed++; else s.passed++
    s.testsTotal += r.tests.length
    s.testsPassed += r.tests.filter((x) => x.passed).length
    s.testsFailed += r.tests.filter((x) => !x.passed).length
    if (r.timeMs !== undefined) { t += r.timeMs; n++ }
  }
  s.avgTimeMs = n ? Math.round(t / n) : 0
  return s
}
