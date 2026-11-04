import type { AuthConfig, ConsoleEntry, Cookie, RequestDef, ResolvedRequest, ResponseInfo, ScopeSet, ScriptOutcome, TestResult } from './types.js'
import { buildRequest, fetchOAuthToken, sendHttp, type SendOptions } from './http.js'
import { runScript, type ScriptContext } from './sandbox.js'
import { mergeCookies } from './cookies.js'
import type { GuardOptions } from './ssrf.js'

export interface ScriptHolder { id?: string; name?: string; auth?: AuthConfig; preRequestScript?: string; testScript?: string }

export interface ExecContext {
  scopes: ScopeSet
  environmentName?: string
  collection?: ScriptHolder
  folders?: ScriptHolder[] // outermost first
  cookies?: Cookie[]
  iteration?: number
  iterationCount?: number
  send?: SendOptions
  guard?: GuardOptions
  onChunk?: (chunk: Buffer) => void
  signal?: AbortSignal
}

export interface ExecResult {
  request: { method: string; url: string; headers: Record<string, string>; body?: string }
  response?: ResponseInfo
  error?: string
  tests: TestResult[]
  console: ConsoleEntry[]
  scriptErrors: string[]
  varMutations: ScriptOutcome['vars']
  updatedAuth?: { holder: 'request' | 'folder' | 'collection'; id?: string; auth: AuthConfig }
  cookies: Cookie[]
  nextRequest?: string | null
  skipped?: boolean
  timeMs?: number
}

function mergeVars(into: ScriptOutcome['vars'], from: ScriptOutcome['vars']) {
  for (const k of ['globals', 'collection', 'environment', 'local'] as const) Object.assign(into[k], from[k])
}
function applyVars(scopes: ScopeSet, vars: ScriptOutcome['vars']) {
  for (const k of ['globals', 'collection', 'environment', 'local'] as const) {
    for (const [name, v] of Object.entries(vars[k])) { if (v === null) delete scopes[k][name]; else scopes[k][name] = v }
  }
}

export async function executeRequest(def: RequestDef, ctx: ExecContext): Promise<ExecResult> {
  const result: ExecResult = { request: { method: def.method, url: def.url, headers: {} }, tests: [], console: [], scriptErrors: [], varMutations: { globals: {}, collection: {}, environment: {}, local: {} }, cookies: ctx.cookies ?? [] }
  const scopes = ctx.scopes
  const holders: { kind: 'collection' | 'folder' | 'request'; h: ScriptHolder }[] = []
  if (ctx.collection) holders.push({ kind: 'collection', h: ctx.collection })
  for (const f of ctx.folders ?? []) holders.push({ kind: 'folder', h: f })
  holders.push({ kind: 'request', h: { id: def.id, name: def.name, auth: def.auth, preRequestScript: def.preRequestScript, testScript: def.testScript } })
  const info = (eventName: 'prerequest' | 'test') => ({ eventName, iteration: ctx.iteration ?? 0, iterationCount: ctx.iterationCount ?? 1, requestName: def.name, requestId: def.id, location: [...(ctx.collection ? [ctx.collection.name ?? ''] : []), ...(ctx.folders ?? []).map((f) => f.name ?? ''), def.name] })
  const sandboxHost = {
    sendRequest: async (payload: any) => {
      try {
        const sub: RequestDef = { name: 'pm.sendRequest', method: payload.method || 'GET', url: payload.url, params: [], headers: Object.entries(payload.headers ?? {}).map(([key, value]) => ({ key, value: String(value) })), body: payload.body ?? { mode: 'none' }, auth: { type: 'none' } }
        const { req } = await buildRequest(sub, scopes, [], () => Promise.resolve(null))
        const response = await sendHttp(req, { ...ctx.send, guard: ctx.guard, cookies: result.cookies, signal: ctx.signal })
        result.cookies = mergeCookies(result.cookies, response.cookies ?? [])
        return { response }
      } catch (e: any) { return { error: e?.message || String(e) } }
    },
  }

  // Working copy of the request that scripts may mutate
  const working: RequestDef = JSON.parse(JSON.stringify(def))

  // ---- pre-request scripts: collection -> folders -> request
  let skip = false
  for (const { h } of holders) {
    if (!h.preRequestScript?.trim()) continue
    const sctx: ScriptContext = { scopes, environmentName: ctx.environmentName, request: { method: working.method, url: working.url, headers: working.headers.filter((x) => x.enabled !== false).map((x) => ({ key: x.key, value: x.value })), body: working.body, auth: working.auth }, cookies: result.cookies, info: info('prerequest') }
    const out = await runScript(h.preRequestScript, sctx, sandboxHost)
    result.console.push(...out.console)
    result.tests.push(...out.tests)
    mergeVars(result.varMutations, out.vars)
    applyVars(scopes, out.vars)
    if (out.error) { result.scriptErrors.push(`Pre-request script (${h.name ?? 'request'}): ${out.error}`) }
    if (out.request) {
      working.method = out.request.method || working.method
      working.url = out.request.url
      working.headers = Object.entries(out.request.headers).map(([key, value]) => ({ key, value, enabled: true }))
      if (out.request.body !== undefined && out.request.body !== null) working.body = out.request.body
    }
    if (out.skip) skip = true
    if (out.nextRequest !== undefined) result.nextRequest = out.nextRequest
  }
  if (skip) { result.skipped = true; return result }
  if (result.scriptErrors.length && result.scriptErrors.some((e) => e.startsWith('Pre-request'))) {
    result.error = result.scriptErrors[0]
    return result
  }

  // ---- build & send
  const authChain: (AuthConfig | undefined)[] = [working.auth, ...[...(ctx.folders ?? [])].reverse().map((f) => f.auth), ctx.collection?.auth]
  let built: Awaited<ReturnType<typeof buildRequest>>
  try {
    built = await buildRequest(working, scopes, authChain, (p) => fetchOAuthToken(p, ctx.guard))
  } catch (e: any) {
    result.error = e?.message || String(e)
    return result
  }
  const { req, updatedAuth, auth } = built
  result.request = { method: req.method, url: req.url, headers: redactHeaders(req.headers), body: req.bodyPreview }
  if (updatedAuth) {
    // find which holder owns the resolved auth
    const owner = holders.slice().reverse().find((x) => x.h.auth && x.h.auth.type !== 'inherit' && x.h.auth === auth) ?? holders.slice().reverse().find((x) => x.h.auth?.type === 'oauth2')
    if (owner) result.updatedAuth = { holder: owner.kind, id: owner.h.id, auth: updatedAuth }
  }
  let response: ResponseInfo
  try {
    response = await sendHttp(req, { ...ctx.send, guard: ctx.guard, cookies: req.settings.sendCookies === false ? [] : result.cookies, onChunk: ctx.onChunk, signal: ctx.signal })
  } catch (e: any) {
    result.error = e?.message || String(e)
    return result
  }
  result.response = response
  result.timeMs = response.timeMs
  result.cookies = mergeCookies(result.cookies, response.cookies ?? [])

  // ---- test scripts: collection -> folders -> request
  for (const { h } of holders) {
    if (!h.testScript?.trim()) continue
    const sctx: ScriptContext = { scopes, environmentName: ctx.environmentName, request: { method: req.method, url: req.url, headers: Object.entries(req.headers).map(([key, value]) => ({ key, value })), body: working.body, auth: working.auth }, response, cookies: result.cookies, info: info('test') }
    const out = await runScript(h.testScript, sctx, sandboxHost)
    result.console.push(...out.console)
    result.tests.push(...out.tests)
    mergeVars(result.varMutations, out.vars)
    applyVars(scopes, out.vars)
    if (out.error) result.scriptErrors.push(`Test script (${h.name ?? 'request'}): ${out.error}`)
    if (out.nextRequest !== undefined) result.nextRequest = out.nextRequest
  }
  return result
}

function redactHeaders(h: Record<string, string>) {
  // Keep headers intact in the UI preview; secrets are the user's own. (Masking happens in history/docs.)
  return { ...h }
}
