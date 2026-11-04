import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runScript } from './sandbox.js'
import { emptyScopes } from './variables.js'

const base = () => ({
  scopes: { ...emptyScopes(), environment: { base: 'https://x' } },
  request: { method: 'GET', url: 'https://x/a', headers: [{ key: 'A', value: '1' }] },
  info: { eventName: 'test' as const, iteration: 0, iterationCount: 1, requestName: 'r' },
})

test('pm.test + expect + env set', async () => {
  const out = await runScript(`
    pm.test('ok', () => { pm.expect(1).to.equal(1); pm.expect({a:1}).to.eql({a:1}); pm.expect([1,2]).to.include(2); pm.expect('abc').to.have.lengthOf(3) })
    pm.test('fail', () => { pm.expect(1).to.equal(2) })
    pm.environment.set('tok', 'abc'); pm.variables.set('x', 'y')
    console.log('hi', {a:1})
    const CryptoJS = require('crypto-js'); pm.environment.set('h', CryptoJS.HmacSHA256('m','k').toString(CryptoJS.enc.Base64))
  `, base(), { sendRequest: async () => ({ error: 'x' }) })
  assert.equal(out.error, undefined)
  assert.equal(out.tests.length, 2)
  assert.equal(out.tests[0].passed, true)
  assert.equal(out.tests[1].passed, false)
  assert.equal(out.vars.environment.tok, 'abc')
  assert.equal(out.vars.local.x, 'y')
  assert.equal(out.console[0].args[0], 'hi')
  assert.equal(out.vars.environment.h, 'tgCQ4wUil661oICInOL8S8qVfnVvrrTffTGADKHncew=')
})

test('response assertions', async () => {
  const ctx: any = base()
  ctx.response = { status: 200, statusText: 'OK', headers: [['content-type', 'application/json']], body: '{"a":{"b":[1,2]}}', isBase64: false, contentType: 'application/json', size: 10, timeMs: 5 }
  const out = await runScript(`
    pm.test('s', () => { pm.response.to.have.status(200); pm.response.to.be.ok; pm.response.to.have.header('content-type'); pm.response.to.have.jsonBody('a.b[1]', 2); pm.expect(pm.response.json().a.b).to.have.lengthOf(2) })
    pm.test('schema', () => pm.response.to.have.jsonSchema({ type: 'object', required: ['a'], properties: { a: { type: 'object' } } }))
    pm.test('neg', () => pm.response.to.have.status(500))
  `, ctx, { sendRequest: async () => ({ error: 'x' }) })
  assert.deepEqual(out.tests.map((t) => t.passed), [true, true, false])
})

test('timeout', async () => {
  const out = await runScript(`while(true){}`, base(), { sendRequest: async () => ({ error: 'x' }) }, { timeoutMs: 200 })
  assert.match(out.error ?? '', /timed out/)
})

test('sendRequest async', async () => {
  const out = await runScript(`
    pm.sendRequest('https://example.com', (err, res) => { pm.environment.set('code', String(res.code)); pm.environment.set('b', res.json().ok) })
  `, base(), { sendRequest: async () => ({ response: { status: 201, statusText: 'Created', headers: [], body: '{"ok":true}', isBase64: false, contentType: 'application/json', size: 1, timeMs: 1 } }) })
  assert.equal(out.error, undefined)
  assert.equal(out.vars.environment.code, '201')
  assert.equal(out.vars.environment.b, 'true')
})

test('pre-request modifies request', async () => {
  const ctx: any = base(); ctx.info.eventName = 'prerequest'
  const out = await runScript(`pm.request.headers.add({key:'X-T', value:'1'}); pm.request.url.query.add({key:'q', value:'z'})`, ctx, { sendRequest: async () => ({ error: 'x' }) })
  assert.equal(out.request?.headers['X-T'], '1')
  assert.equal(out.request?.url, 'https://x/a?q=z')
})

test('path variables substituted from scopes', async () => {
  const { substitutePathVars, unresolvedPathVars } = await import('./http.js')
  const s = { ...emptyScopes(), environment: { petId: '42' } }
  assert.equal(substitutePathVars('https://h:8080/pet/:petId/tags/:tag?x=:petId', s), 'https://h:8080/pet/42/tags/:tag?x=:petId')
  assert.deepEqual(unresolvedPathVars('https://h/pet/:petId/tags/:tag', s), ['tag'])
})
