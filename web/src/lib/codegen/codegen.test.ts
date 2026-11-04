import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generate, targets, type CodegenInput } from './index'

const URL_ = 'https://api.example.com/v1/items?limit=10&q=a%20b'

const getInput: CodegenInput = {
  method: 'GET',
  url: URL_,
  headers: [{ key: 'Accept', value: 'application/json' }],
  body: { mode: 'none' },
  auth: { type: 'none' },
}

const jsonInput: CodegenInput = {
  method: 'POST',
  url: URL_,
  headers: [{ key: 'X-Trace', value: 'abc"123' }],
  body: { mode: 'json', raw: '{\n  "name": "it\'s",\n  "tags": ["a", "b"],\n  "ok": true,\n  "nested": { "n": null }\n}' },
  auth: { type: 'bearer', bearer: { token: 'tok123' } },
}

const formInput: CodegenInput = {
  method: 'POST',
  url: URL_,
  headers: [],
  body: {
    mode: 'formdata',
    formdata: [
      { key: 'title', value: 'hello world' },
      { key: 'upload', value: '', type: 'file', src: 'photo.png' },
      { key: 'skipped', value: 'x', enabled: false },
    ],
  },
  auth: { type: 'none' },
}

const basicInput: CodegenInput = {
  method: 'PUT',
  url: URL_,
  headers: [],
  body: { mode: 'urlencoded', urlencoded: [{ key: 'a', value: '1' }, { key: 'b c', value: 'd&e' }] },
  auth: { type: 'basic', basic: { username: 'user', password: 'p@ss' } },
}

const cases: [string, CodegenInput][] = [
  ['GET', getInput],
  ['POST json', jsonInput],
  ['POST form-data', formInput],
  ['basic auth', basicInput],
]

for (const t of targets) {
  for (const [name, input] of cases) {
    test(`${t.id} / ${name} produces output`, () => {
      const out = generate(t.id, input)
      assert.equal(typeof out, 'string')
      assert.ok(out.trim().length > 0)
    })
  }
}

test('curl contains url and body', () => {
  const out = generate('curl', jsonInput)
  assert.ok(out.includes(URL_))
  assert.ok(out.includes('"name": "it'))
  assert.ok(out.includes('--data-raw'))
  assert.ok(out.includes("'Authorization: Bearer tok123'"))
  assert.ok(out.includes("'Content-Type: application/json'"))
})

test('curl form-data and basic auth', () => {
  const form = generate('curl', formInput)
  assert.ok(form.includes("-F 'title=hello world'"))
  assert.ok(form.includes("-F 'upload=@photo.png'"))
  assert.ok(!form.includes('skipped'))
  const basic = generate('curl', basicInput)
  assert.ok(basic.includes("--user 'user:p@ss'"))
  assert.ok(basic.includes("--data-urlencode 'b c=d&e'"))
})

test('fetch emits object literal for valid json', () => {
  const out = generate('js-fetch', jsonInput)
  assert.ok(out.includes('JSON.stringify({'))
  assert.ok(out.includes('name: "it\'s"'))
})

test('python requests uses idiomatic auth and json', () => {
  const out = generate('python-requests', basicInput)
  assert.ok(out.includes('auth=("user", "p@ss")'))
  const json = generate('python-requests', jsonInput)
  assert.ok(json.includes('"n": None'))
  assert.ok(json.includes('"ok": True'))
})

test('http message has host, path and content-length', () => {
  const out = generate('http', jsonInput)
  assert.ok(out.startsWith('POST /v1/items?limit=10&q=a%20b HTTP/1.1\r\nHost: api.example.com\r\n'))
  assert.ok(/Content-Length: \d+/.test(out))
  const basic = generate('http', basicInput)
  assert.ok(basic.includes('Authorization: Basic dXNlcjpwQHNz'))
})

test('unknown target throws', () => {
  assert.throws(() => generate('nope', getInput))
})
