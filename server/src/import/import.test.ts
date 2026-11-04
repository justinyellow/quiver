import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectAndImport, importFiles } from './index.js'
import { importPostman } from './postman.js'
import { importOpenApi, exampleFromSchema } from './openapi.js'
import { importCurl } from './curl.js'
import { importHar } from './har.js'
import { importInsomnia } from './insomnia.js'
import { importBruno } from './bruno.js'
import { postmanFixture } from './fixtures.test.js'

test('postman v2.1 collection', () => {
  const r = importPostman(postmanFixture)
  assert.equal(r.format, 'postman')
  assert.equal(r.collections.length, 1)
  const col = r.collections[0]!
  assert.equal(col.name, 'Demo API')
  assert.equal(col.description, 'A demo')
  assert.equal(col.auth?.type, 'bearer')
  assert.equal(col.auth?.bearer?.token, '{{token}}')
  assert.equal(col.preRequestScript, 'console.log("col pre")')
  assert.deepEqual(col.variables.map(v => v.key), ['baseUrl'])
  assert.equal(col.folders.length, 1)
  assert.equal(col.requests.length, 1)
  const users = col.folders[0]!
  assert.equal(users.requests.length, 3)
  const list = users.requests[0]!
  assert.equal(list.url, '{{baseUrl}}/users')
  assert.deepEqual(list.params.map(p => [p.key, p.enabled]), [['page', true], ['limit', false]])
  assert.ok(list.testScript?.includes('pm.test'))
  assert.equal(list.settings?.followRedirects, false)
  assert.equal(list.settings?.verifyTls, false)
  assert.equal(list.examples?.length, 1)
  assert.equal(list.examples![0]!.status, 200)
  assert.equal(list.examples![0]!.body, '[{"id":1}]')
  const create = users.requests[1]!
  assert.equal(create.body.mode, 'json')
  assert.equal(create.auth.type, 'basic')
  assert.equal(create.auth.basic?.username, 'u')
  assert.equal(users.requests[2]!.url, '{{baseUrl}}/users/:id')
  const upload = col.requests[0]!
  assert.equal(upload.body.mode, 'formdata')
  assert.equal(upload.body.formdata![0]!.type, 'file')
  assert.equal(upload.body.formdata![0]!.src, '/tmp/a.png')
})

test('postman v2.0 object-form auth and string request', () => {
  const r = importPostman({
    info: { name: 'v2', schema: 'https://schema.getpostman.com/json/collection/v2.0.0/collection.json' },
    auth: { type: 'apikey', apikey: { key: 'X-Key', value: 'abc', in: 'query' } },
    item: [{ name: 'Ping', request: 'https://x.test/ping' }],
  })
  assert.equal(r.collections[0]!.auth?.apikey?.in, 'query')
  assert.equal(r.collections[0]!.requests[0]!.method, 'GET')
  assert.equal(r.collections[0]!.requests[0]!.url, 'https://x.test/ping')
})

test('postman environment and export-all dump', () => {
  const env = { name: 'Dev', values: [{ key: 'token', value: 's3cret', enabled: true, type: 'secret' }, { key: 'host', value: 'dev.test', enabled: false }] }
  const r = importPostman(env)
  assert.equal(r.environments.length, 1)
  assert.equal(r.environments[0]!.variables[0]!.type, 'secret')
  assert.equal(r.environments[0]!.variables[1]!.enabled, false)
  const dump = importPostman({ collections: [postmanFixture], environments: [env] })
  assert.equal(dump.collections.length, 1)
  assert.equal(dump.environments.length, 1)
  const detected = detectAndImport(JSON.stringify(env))
  assert.equal(detected.format, 'postman')
  assert.equal(detected.environments[0]!.name, 'Dev')
})

test('openapi 3 petstore', () => {
  const doc = {
    openapi: '3.0.0',
    info: { title: 'Petstore', description: 'Pets', version: '1.0' },
    servers: [{ url: 'https://{env}.petstore.io/v{ver}', variables: { env: { default: 'api' }, ver: { default: '1' } } }],
    security: [{ bearer: [] }],
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
      schemas: {
        Pet: { allOf: [{ $ref: '#/components/schemas/Base' }, { type: 'object', properties: { name: { type: 'string', example: 'Rex' }, tags: { type: 'array', items: { type: 'string' } }, status: { type: 'string', enum: ['available', 'sold'] } } }] },
        Base: { type: 'object', properties: { id: { type: 'integer', format: 'int64' }, created: { type: 'string', format: 'date-time' } } },
      },
    },
    paths: {
      '/pets': {
        get: {
          tags: ['pets'], summary: 'List pets', operationId: 'listPets',
          parameters: [{ name: 'limit', in: 'query', required: false, schema: { type: 'integer', default: 20 } }, { name: 'X-Trace', in: 'header', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Pet' } } } } } },
        },
        post: {
          tags: ['pets'], operationId: 'createPet',
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } } },
          responses: { '201': { description: 'created' } },
        },
      },
      '/pets/{petId}': {
        parameters: [{ name: 'petId', in: 'path', required: true, schema: { type: 'string' } }],
        delete: { tags: ['pets'], responses: { '204': { description: 'gone' } } },
      },
      '/upload': {
        post: { tags: ['files'], requestBody: { content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, label: { type: 'string' } } } } } }, responses: {} },
      },
    },
  }
  const r = importOpenApi(doc)
  assert.equal(r.format, 'openapi')
  const col = r.collections[0]!
  assert.equal(col.name, 'Petstore')
  assert.equal(col.description, 'Pets')
  assert.equal(col.variables.find(v => v.key === 'baseUrl')?.value, 'https://api.petstore.io/v1')
  assert.equal(col.auth?.type, 'bearer')
  assert.equal(col.auth?.bearer?.token, '{{bearerToken}}')
  assert.deepEqual(col.folders.map(f => f.name), ['pets', 'files'])
  const pets = col.folders[0]!
  assert.equal(pets.requests.length, 3)
  const list = pets.requests[0]!
  assert.equal(list.name, 'List pets')
  assert.equal(list.url, '{{baseUrl}}/pets')
  assert.deepEqual(list.params, [{ key: 'limit', value: '20', enabled: false }])
  assert.equal(list.headers[0]!.key, 'X-Trace')
  assert.equal(list.headers[0]!.enabled, true)
  assert.equal(list.examples?.length, 1)
  const exBody = JSON.parse(list.examples![0]!.body)
  assert.equal(exBody[0].name, 'Rex')
  assert.equal(exBody[0].status, 'available')
  assert.equal(exBody[0].created, '2024-01-01T00:00:00Z')
  const create = pets.requests[1]!
  assert.equal(create.name, 'createPet')
  assert.equal(create.body.mode, 'json')
  assert.equal(JSON.parse(create.body.raw!).name, 'Rex')
  assert.equal(pets.requests[2]!.url, '{{baseUrl}}/pets/:petId')
  assert.equal(pets.requests[2]!.name, 'DELETE /pets/{petId}')
  const upload = col.folders[1]!.requests[0]!
  assert.equal(upload.body.mode, 'formdata')
  assert.equal(upload.body.formdata![0]!.type, 'file')
})

test('swagger 2', () => {
  const doc = {
    swagger: '2.0',
    info: { title: 'Legacy', version: '1' },
    host: 'legacy.test', basePath: '/api', schemes: ['https'],
    securityDefinitions: { key: { type: 'apiKey', name: 'api_key', in: 'header' } },
    definitions: { Thing: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } } } },
    paths: {
      '/things': {
        post: {
          consumes: ['application/json'], produces: ['application/json'],
          parameters: [{ in: 'body', name: 'body', schema: { $ref: '#/definitions/Thing' } }, { in: 'query', name: 'dry', type: 'boolean', required: true }],
          responses: { '200': { description: 'ok', schema: { $ref: '#/definitions/Thing' } } },
        },
      },
      '/form': { post: { consumes: ['application/x-www-form-urlencoded'], parameters: [{ in: 'formData', name: 'a', type: 'string', default: 'x' }], responses: {} } },
    },
  }
  const r = importOpenApi(doc)
  assert.equal(r.format, 'swagger2')
  const col = r.collections[0]!
  assert.equal(col.variables[0]!.value, 'https://legacy.test/api')
  assert.equal(col.auth?.type, 'apikey')
  assert.equal(col.auth?.apikey?.key, 'api_key')
  assert.deepEqual(col.folders.map(f => f.name), ['things', 'form'])
  const post = col.folders[0]!.requests[0]!
  assert.equal(post.body.mode, 'json')
  assert.deepEqual(JSON.parse(post.body.raw!), { id: 0, name: 'name' })
  assert.equal(post.params[0]!.enabled, true)
  assert.equal(post.examples![0]!.status, 200)
  const form = col.folders[1]!.requests[0]!
  assert.equal(form.body.mode, 'urlencoded')
  assert.equal(form.body.urlencoded![0]!.value, 'x')
})

test('exampleFromSchema handles oneOf, enum, cycles', () => {
  const schemas: any = { Node: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, child: { $ref: '#/components/schemas/Node' } } } }
  const resolver = (ref: string) => schemas[ref.split('/').pop()!]
  const ex = exampleFromSchema({ $ref: '#/components/schemas/Node' }, resolver)
  assert.equal(ex.id, '123e4567-e89b-12d3-a456-426614174000')
  assert.equal(ex.child, null)
  assert.equal(exampleFromSchema({ oneOf: [{ type: 'integer', minimum: 5 }, { type: 'string' }] }), 5)
  assert.equal(exampleFromSchema({ type: 'string', enum: ['a', 'b'] }), 'a')
})

test('curl multi-line and multiple commands', () => {
  const text = `curl -X POST 'https://api.example.com/v1/items?draft=true' \\
  -H "Content-Type: application/json" \\
  -H 'Authorization: Bearer tok123' \\
  -u admin:secret \\
  -k -L \\
  --data-raw '{"name":"Widget","qty":2}'

curl https://api.example.com/v1/items/1 -b "session=abc" -A "quiver/1.0" --compressed

curl -G https://api.example.com/search -d q=hello -d page=2

curl -F file=@/tmp/pic.png -F note=hi https://api.example.com/upload`
  const r = importCurl(text)
  assert.equal(r.format, 'curl')
  const col = r.collections[0]!
  assert.equal(col.name, 'Imported cURL')
  assert.equal(col.requests.length, 4)
  const post = col.requests[0]!
  assert.equal(post.method, 'POST')
  assert.equal(post.url, 'https://api.example.com/v1/items')
  assert.deepEqual(post.params, [{ key: 'draft', value: 'true', enabled: true }])
  assert.equal(post.body.mode, 'json')
  assert.equal(post.body.raw, '{"name":"Widget","qty":2}')
  assert.equal(post.auth.type, 'basic')
  assert.equal(post.auth.basic?.password, 'secret')
  assert.equal(post.settings?.verifyTls, false)
  assert.equal(post.settings?.followRedirects, true)
  assert.ok(post.headers.some(h => h.key === 'Content-Type'))
  const get = col.requests[1]!
  assert.equal(get.method, 'GET')
  assert.deepEqual(get.headers.map(h => [h.key, h.value]), [['Cookie', 'session=abc'], ['User-Agent', 'quiver/1.0']])
  const search = col.requests[2]!
  assert.equal(search.method, 'GET')
  assert.equal(search.body.mode, 'none')
  assert.deepEqual(search.params.map(p => [p.key, p.value]), [['q', 'hello'], ['page', '2']])
  const upload = col.requests[3]!
  assert.equal(upload.method, 'POST')
  assert.equal(upload.body.mode, 'formdata')
  assert.equal(upload.body.formdata![0]!.type, 'file')
  assert.equal(upload.body.formdata![0]!.src, '/tmp/pic.png')
  assert.equal(upload.body.formdata![1]!.value, 'hi')
  const detected = detectAndImport(text)
  assert.equal(detected.format, 'curl')
  const implicitPost = importCurl("curl https://x.test/a -d 'a=1&b=2'").collections[0]!.requests[0]!
  assert.equal(implicitPost.method, 'POST')
  assert.equal(implicitPost.body.mode, 'urlencoded')
})

test('har', () => {
  const har = {
    log: {
      version: '1.2', creator: { name: 'Chrome' },
      entries: [
        {
          request: {
            method: 'POST', url: 'https://api.example.com/login?next=%2Fhome',
            headers: [{ name: ':authority', value: 'api.example.com' }, { name: 'cookie', value: 'a=b' }, { name: 'content-type', value: 'application/json' }, { name: 'Content-Length', value: '20' }],
            queryString: [{ name: 'next', value: '/home' }],
            postData: { mimeType: 'application/json', text: '{"user":"a"}' },
          },
          response: { status: 200, statusText: 'OK', headers: [{ name: 'content-type', value: 'application/json' }], content: { mimeType: 'application/json', text: Buffer.from('{"ok":true}').toString('base64'), encoding: 'base64' } },
        },
        {
          request: { method: 'GET', url: 'https://cdn.example.com/a.js', headers: [], queryString: [] },
          response: { status: 304, statusText: 'Not Modified', headers: [], content: {} },
        },
      ],
    },
  }
  const r = importHar(har)
  assert.equal(r.format, 'har')
  const col = r.collections[0]!
  assert.deepEqual(col.folders.map(f => f.name), ['api.example.com', 'cdn.example.com'])
  const login = col.folders[0]!.requests[0]!
  assert.equal(login.url, 'https://api.example.com/login')
  assert.deepEqual(login.params, [{ key: 'next', value: '/home', enabled: true }])
  assert.deepEqual(login.headers.map(h => h.key), ['content-type'])
  assert.equal(login.body.mode, 'json')
  assert.equal(login.examples![0]!.body, '{"ok":true}')
  assert.equal(login.examples![0]!.status, 200)
  assert.equal(detectAndImport(JSON.stringify(har)).format, 'har')
})

test('insomnia v4', () => {
  const json = {
    _type: 'export', __export_format: 4,
    resources: [
      { _id: 'wrk_1', _type: 'workspace', name: 'My API', description: 'desc' },
      { _id: 'env_base', _type: 'environment', parentId: 'wrk_1', name: 'Base Environment', data: { host: 'https://x.test' } },
      { _id: 'env_dev', _type: 'environment', parentId: 'env_base', name: 'Dev', data: { token: 't', nested: { key: 'v' } } },
      { _id: 'fld_1', _type: 'request_group', parentId: 'wrk_1', name: 'Auth', metaSortKey: 1 },
      { _id: 'req_1', _type: 'request', parentId: 'fld_1', name: 'Login', method: 'POST', url: '{{ _.host }}/login', body: { mimeType: 'application/json', text: '{"t":"{{ _.token }}"}' }, headers: [{ name: 'X-A', value: '1' }], parameters: [{ name: 'q', value: '1', disabled: true }], authentication: { type: 'bearer', token: '{{ _.token }}' }, metaSortKey: 2 },
      { _id: 'req_2', _type: 'request', parentId: 'wrk_1', name: 'Form', method: 'POST', url: '{{ _.host }}/form', body: { mimeType: 'application/x-www-form-urlencoded', params: [{ name: 'a', value: 'b' }] }, authentication: { type: 'basic', username: 'u', password: 'p' }, metaSortKey: 1 },
    ],
  }
  const r = importInsomnia(json)
  assert.equal(r.format, 'insomnia')
  const col = r.collections[0]!
  assert.equal(col.name, 'My API')
  assert.deepEqual(col.variables, [{ key: 'host', value: 'https://x.test', enabled: true }])
  assert.equal(col.folders[0]!.name, 'Auth')
  const login = col.folders[0]!.requests[0]!
  assert.equal(login.url, '{{host}}/login')
  assert.equal(login.body.mode, 'json')
  assert.equal(login.body.raw, '{"t":"{{token}}"}')
  assert.equal(login.auth.bearer?.token, '{{token}}')
  assert.equal(login.params[0]!.enabled, false)
  assert.equal(col.requests[0]!.body.mode, 'urlencoded')
  assert.equal(col.requests[0]!.auth.type, 'basic')
  assert.equal(r.environments.length, 1)
  assert.deepEqual(r.environments[0]!.variables.map(v => v.key), ['token', 'nested.key'])
  assert.equal(detectAndImport(JSON.stringify(json)).format, 'insomnia')
})

test('bruno', () => {
  const files = [
    { path: 'my-api/bruno.json', content: '{"version":"1","name":"My Bruno API","type":"collection"}' },
    { path: 'my-api/collection.bru', content: `auth {
  mode: bearer
}

auth:bearer {
  token: {{token}}
}

script:pre-request {
  console.log("col")
}
` },
    { path: 'my-api/environments/Local.bru', content: `vars {
  host: http://localhost:3000
  ~off: 1
}

vars:secret {
  token: abc
}
` },
    { path: 'my-api/Users/Get User.bru', content: `meta {
  name: Get User
  type: http
  seq: 2
}

get {
  url: {{host}}/users/:id?verbose=true
  body: none
  auth: inherit
}

params:query {
  verbose: true
  ~debug: 1
}

headers {
  Accept: application/json
}

tests {
  test("ok", function() {
    expect(res.status).to.equal(200);
  });
}

docs {
  Fetch a user
}
` },
    { path: 'my-api/Users/Create User.bru', content: `meta {
  name: Create User
  type: http
  seq: 1
}

post {
  url: {{host}}/users
  body: json
  auth: basic
}

auth:basic {
  username: u
  password: p
}

body:json {
  {
    "name": "Ann",
    "tags": ["a"]
  }
}

vars:pre-request {
  reqId: 123
}

script:post-response {
  bru.setVar("userId", res.body.id);
}

unknown:block {
  whatever: 1
}
` },
    { path: 'my-api/Upload.bru', content: `meta {
  name: Upload
  seq: 1
}

post {
  url: {{host}}/upload
  body: multipartForm
}

body:multipart-form {
  file: @file(pic.png)
  note: hi
}
` },
  ]
  const r = importBruno(files)
  assert.equal(r.format, 'bruno')
  const col = r.collections[0]!
  assert.equal(col.name, 'My Bruno API')
  assert.equal(col.auth?.type, 'bearer')
  assert.equal(col.auth?.bearer?.token, '{{token}}')
  assert.equal(col.preRequestScript, 'console.log("col")')
  assert.equal(col.folders.length, 1)
  assert.equal(col.folders[0]!.name, 'Users')
  assert.deepEqual(col.folders[0]!.requests.map(x => x.name), ['Create User', 'Get User'])
  const get = col.folders[0]!.requests[1]!
  assert.equal(get.method, 'GET')
  assert.equal(get.url, '{{host}}/users/:id')
  assert.deepEqual(get.params, [{ key: 'verbose', value: 'true', enabled: true }, { key: 'debug', value: '1', enabled: false }])
  assert.equal(get.headers[0]!.key, 'Accept')
  assert.ok(get.testScript?.includes('expect(res.status)'))
  assert.equal(get.description, 'Fetch a user')
  assert.equal(get.auth.type, 'inherit')
  const create = col.folders[0]!.requests[0]!
  assert.equal(create.body.mode, 'json')
  assert.deepEqual(JSON.parse(create.body.raw!), { name: 'Ann', tags: ['a'] })
  assert.equal(create.auth.type, 'basic')
  assert.ok(create.preRequestScript?.includes('reqId'))
  assert.ok(create.testScript?.includes('bru.setVar'))
  const upload = col.requests[0]!
  assert.equal(upload.body.mode, 'formdata')
  assert.deepEqual(upload.body.formdata![0], { key: 'file', value: '', enabled: true, type: 'file', src: 'pic.png' })
  assert.equal(r.environments.length, 1)
  assert.equal(r.environments[0]!.name, 'Local')
  const vars = r.environments[0]!.variables
  assert.deepEqual(vars.find(v => v.key === 'host'), { key: 'host', value: 'http://localhost:3000', enabled: true })
  assert.equal(vars.find(v => v.key === 'off')?.enabled, false)
  assert.equal(vars.find(v => v.key === 'token')?.type, 'secret')
  const viaFiles = importFiles(files.map(f => ({ name: f.path, content: f.content })))
  assert.equal(viaFiles.format, 'bruno')
  assert.equal(viaFiles.collections.length, 1)
})

test('detectAndImport: openapi yaml, quiver, unknown', () => {
  const yaml = `openapi: 3.1.0
info:
  title: Yaml API
  version: "1"
servers:
  - url: https://y.test
paths:
  /ping:
    get:
      responses:
        "200":
          description: pong
          content:
            application/json:
              example:
                pong: true
`
  const r = detectAndImport(yaml, 'api.yaml')
  assert.equal(r.format, 'openapi')
  assert.equal(r.collections[0]!.name, 'Yaml API')
  const ping = r.collections[0]!.folders[0]!.requests[0]!
  assert.equal(ping.url, '{{baseUrl}}/ping')
  assert.equal(JSON.parse(ping.examples![0]!.body).pong, true)

  const q = detectAndImport(JSON.stringify({ quiver: 1, collections: [{ id: 'c1', name: 'Q', description: '', auth: { type: 'none' }, variables: [], preRequestScript: '', testScript: '', folders: [], requests: [{ id: 'r1', name: 'R', description: '', method: 'GET', url: 'https://q.test', params: [], headers: [], body: { mode: 'none' }, auth: { type: 'inherit' }, preRequestScript: '', testScript: '', settings: {}, examples: [] }] }], environments: [{ id: 'e1', name: 'E', variables: [{ key: 'a', value: 'b' }] }] }))
  assert.equal(q.format, 'quiver')
  assert.equal(q.collections[0]!.requests[0]!.url, 'https://q.test')
  assert.equal(q.environments[0]!.name, 'E')

  assert.throws(() => detectAndImport('hello world'), /Unrecognised import format/)
  assert.throws(() => detectAndImport('{"foo":1}'), /Unrecognised import format/)
})
