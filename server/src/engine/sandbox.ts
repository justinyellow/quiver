import crypto from 'node:crypto'
import { newQuickJSAsyncWASMModule, shouldInterruptAfterDeadline, type QuickJSAsyncContext, type QuickJSAsyncWASMModule, type QuickJSHandle } from 'quickjs-emscripten'
import { config } from '../config.js'
import { PRELUDE } from './prelude.js'
import { dynamicVar } from './variables.js'
import { xmlToJson } from './xml.js'
import type { ScopeSet, ScriptOutcome, ResponseInfo, Cookie } from './types.js'

let modP: Promise<QuickJSAsyncWASMModule> | null = null
function getModule() { return (modP ??= newQuickJSAsyncWASMModule()) }

export interface ScriptContext {
  scopes: ScopeSet
  environmentName?: string
  request: { method: string; url: string; headers: { key: string; value: string }[]; body?: any; auth?: any }
  response?: ResponseInfo
  cookies?: Cookie[]
  info: { eventName: 'prerequest' | 'test'; iteration: number; iterationCount: number; requestName: string; requestId?: string; location?: string[] }
}

export interface SandboxHost {
  sendRequest: (payload: any) => Promise<{ response?: ResponseInfo; error?: string }>
  vaultGet?: (key: string) => string | undefined
}

export async function runScript(code: string, ctx: ScriptContext, host: SandboxHost, opts: { timeoutMs?: number } = {}): Promise<ScriptOutcome> {
  const empty: ScriptOutcome = { tests: [], console: [], vars: { globals: {}, collection: {}, environment: {}, local: {} } }
  if (!code || !code.trim()) return empty
  const mod = await getModule()
  const runtime = mod.newRuntime()
  runtime.setMemoryLimit(config.scriptMemoryMb * 1024 * 1024)
  runtime.setMaxStackSize(1024 * 1024)
  const deadline = Date.now() + (opts.timeoutMs ?? config.scriptTimeoutMs)
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(deadline))
  const vm = runtime.newContext()
  try {
    // __ctx
    const ctxJson = JSON.stringify(ctx)
    const ctxHandle = vm.unwrapResult(vm.evalCode(`(${ctxJson})`))
    vm.setProp(vm.global, '__ctx', ctxHandle)
    ctxHandle.dispose()

    const hostObj = vm.newObject()
    const fn = (name: string, f: (...args: any[]) => any) => {
      const h = vm.newFunction(name, (...args: QuickJSHandle[]) => {
        const vals = args.map((a) => vm.dump(a))
        const r = f(...vals)
        return toHandle(vm, r)
      })
      vm.setProp(hostObj, name, h)
      h.dispose()
    }
    const afn = (name: string, f: (...args: any[]) => Promise<any>) => {
      const h = vm.newAsyncifiedFunction(name, async (...args: QuickJSHandle[]) => {
        const vals = args.map((a) => vm.dump(a))
        const r = await f(...vals)
        return toHandle(vm, r)
      })
      vm.setProp(hostObj, name, h)
      h.dispose()
    }
    fn('now', () => Date.now())
    fn('dynamicVar', (k: string) => dynamicVar(k))
    fn('uuid', () => crypto.randomUUID())
    fn('randomHex', (n: number) => crypto.randomBytes(Math.min(Number(n) || 16, 1024)).toString('hex'))
    fn('hash', (algo: string, data: string) => crypto.createHash(algo).update(data, 'utf8').digest('hex'))
    fn('hmac', (algo: string, data: string, key: string) => crypto.createHmac(algo, key).update(data, 'utf8').digest('hex'))
    fn('aes', (mode: string, data: string, key: string) => aesCompat(mode, data, key))
    fn('base64encode', (s: string) => Buffer.from(String(s), 'utf8').toString('base64'))
    fn('base64decode', (s: string) => Buffer.from(String(s), 'base64').toString('utf8'))
    fn('hexToBase64', (s: string) => Buffer.from(String(s), 'hex').toString('base64'))
    fn('base64ToHex', (s: string) => Buffer.from(String(s), 'base64').toString('hex'))
    fn('hexToUtf8', (s: string) => Buffer.from(String(s), 'hex').toString('utf8'))
    fn('utf8ToHex', (s: string) => Buffer.from(String(s), 'utf8').toString('hex'))
    fn('xml2json', (s: string) => JSON.stringify(xmlToJson(String(s))))
    fn('vaultGet', (k: string) => host.vaultGet?.(k) ?? undefined)
    afn('sleep', async (ms: number) => { await new Promise((r) => setTimeout(r, Math.min(Number(ms) || 0, 10000))); return true })
    afn('sendRequest', async (payloadJson: string) => {
      try {
        const payload = JSON.parse(payloadJson)
        const r = await host.sendRequest(payload)
        return JSON.stringify(r)
      } catch (e: any) {
        return JSON.stringify({ error: e?.message || String(e) })
      }
    })
    vm.setProp(vm.global, '__host', hostObj)
    hostObj.dispose()

    const pre = vm.evalCode(PRELUDE, 'prelude.js')
    if (pre.error) { const err = vm.dump(pre.error); pre.error.dispose(); throw new Error('Sandbox prelude failed: ' + JSON.stringify(err)) }
    pre.value.dispose()

    const wrapped = `(async () => {\n${code}\n})()`
    const res = await vm.evalCodeAsync(wrapped, 'script.js')
    let error: string | undefined
    if (res.error) {
      error = formatError(vm.dump(res.error))
      res.error.dispose()
    } else {
      // Resolve the async wrapper's promise
      const state = vm.getPromiseState(res.value)
      if (state.type === 'pending') {
        const settled = await vm.resolvePromise(res.value)
        if (settled.error) { error = formatError(vm.dump(settled.error)); settled.error.dispose() } else settled.value.dispose()
      } else if (state.type === 'rejected') {
        error = formatError(vm.dump(state.error)); state.error.dispose()
      } else if (state.type === 'fulfilled') {
        state.value.dispose()
      }
      res.value.dispose()
    }
    const fin = vm.evalCode('__finalize(); JSON.stringify(__out())')
    if (fin.error) { const e = vm.dump(fin.error); fin.error.dispose(); throw new Error('Sandbox output failed: ' + JSON.stringify(e)) }
    const outJson = vm.getString(fin.value)
    fin.value.dispose()
    const out = JSON.parse(outJson) as ScriptOutcome
    if (error) out.error = error
    return out
  } finally {
    vm.dispose()
    runtime.dispose()
  }
}

function toHandle(vm: QuickJSAsyncContext, r: any): QuickJSHandle {
  if (r === undefined) return vm.undefined
  if (r === null) return vm.null
  if (typeof r === 'string') return vm.newString(r)
  if (typeof r === 'number') return vm.newNumber(r)
  if (typeof r === 'boolean') return r ? vm.true : vm.false
  return vm.unwrapResult(vm.evalCode(`(${JSON.stringify(r)})`))
}

function formatError(e: any): string {
  if (e && typeof e === 'object') {
    const msg = e.message || String(e)
    if (/interrupted/i.test(msg)) return 'Script timed out (exceeded ' + config.scriptTimeoutMs + 'ms)'
    const name = e.name && e.name !== 'Error' ? e.name + ': ' : ''
    const line = typeof e.stack === 'string' ? (e.stack.match(/script\.js:(\d+)/)?.[1]) : undefined
    return name + msg + (line ? ` (line ${Number(line) - 1})` : '')
  }
  return String(e)
}

// CryptoJS.AES compatible (OpenSSL EVP_BytesToKey, "Salted__" format) for passphrase mode
function aesCompat(mode: string, data: string, pass: string): string {
  if (mode === 'enc') {
    const salt = crypto.randomBytes(8)
    const { key, iv } = evpKdf(pass, salt)
    const c = crypto.createCipheriv('aes-256-cbc', key, iv)
    const ct = Buffer.concat([c.update(data, 'utf8'), c.final()])
    return Buffer.concat([Buffer.from('Salted__'), salt, ct]).toString('base64')
  }
  const buf = Buffer.from(data, 'base64')
  const salt = buf.subarray(8, 16)
  const { key, iv } = evpKdf(pass, salt)
  const d = crypto.createDecipheriv('aes-256-cbc', key, iv)
  return Buffer.concat([d.update(buf.subarray(16)), d.final()]).toString('utf8')
}
function evpKdf(pass: string, salt: Buffer) {
  let prev = Buffer.alloc(0)
  const out: Buffer[] = []
  let total = 0
  while (total < 48) {
    prev = crypto.createHash('md5').update(Buffer.concat([prev, Buffer.from(pass, 'utf8'), salt])).digest()
    out.push(prev)
    total += prev.length
  }
  const all = Buffer.concat(out)
  return { key: all.subarray(0, 32), iv: all.subarray(32, 48) }
}
