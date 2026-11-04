import { test } from 'node:test'
import assert from 'node:assert/strict'
import YAML from 'yaml'
import { exportPostmanCollection, exportPostmanEnvironment } from './postman.js'
import { exportOpenApi, schemaFromExample } from './openapi.js'
import { exportQuiver, exportPlainText } from './quiver.js'
import type { ExportCollection, ExportFolder, ExportRequest } from './types.js'
import { importPostman } from '../import/postman.js'
import { importOpenApi } from '../import/openapi.js'
import { detectAndImport } from '../import/index.js'
import type { ImportedCollection, ImportedFolder, ImportedRequest } from '../import/types.js'
import { postmanFixture } from '../import/fixtures.test.js'

let seq = 0
function toExportRequest(r: ImportedRequest): ExportRequest {
  return {
    id: `req_${++seq}`,
    name: r.name,
    description: r.description ?? '',
    method: r.method,
    url: r.url,
    params: r.params,
    headers: r.headers,
    body: r.body,
    auth: r.auth,
    preRequestScript: r.preRequestScript ?? '',
    testScript: r.testScript ?? '',
    settings: r.settings ?? {},
    examples: (r.examples ?? []).map(e => ({ id: `ex_${++seq}`, name: e.name, request: e.request, status: e.status, statusText: e.statusText, headers: e.headers, body: e.body })),
  }
}
function toExportFolder(f: ImportedFolder): ExportFolder {
  return { id: `fld_${++seq}`, name: f.name, description: f.description ?? '', auth: f.auth ?? { type: 'inherit' }, preRequestScript: f.preRequestScript ?? '', testScript: f.testScript ?? '', folders: f.folders.map(toExportFolder), requests: f.requests.map(toExportRequest) }
}
export function toExportCollection(c: ImportedCollection): ExportCollection {
  return { id: `col_${++seq}`, name: c.name, description: c.description ?? '', auth: c.auth ?? { type: 'none' }, variables: c.variables, preRequestScript: c.preRequestScript ?? '', testScript: c.testScript ?? '', folders: c.folders.map(toExportFolder), requests: c.requests.map(toExportRequest) }
}

function flat(c: ImportedCollection): ImportedRequest[] {
  const out: ImportedRequest[] = []
  const walk = (f: { folders: ImportedFolder[]; requests: ImportedRequest[] }) => { out.push(...f.requests); f.folders.forEach(walk) }
  walk(c)
  return out
}

test('postman round-trip', () => {
  const imported = importPostman(postmanFixture).collections[0]!
  const exported = exportPostmanCollection(toExportCollection(imported))
  assert.equal(exported.info.schema, 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json')
  assert.equal(exported.info.name, 'Demo API')
  assert.ok(exported.info._postman_id)
  assert.equal(exported.auth.type, 'bearer')
  assert.ok(Array.isArray(exported.auth.bearer))
  assert.equal(exported.item[0].name, 'Users')
  const list = exported.item[0].item[0]
  assert.equal(list.request.url.raw, '{{baseUrl}}/users?page=1&limit=10')
  assert.deepEqual(list.request.url.host, ['{{baseUrl}}'])
  assert.deepEqual(list.request.url.path, ['users'])
  assert.equal(list.request.url.query[1].disabled, true)
  assert.equal(list.event[0].listen, 'test')
  assert.equal(list.protocolProfileBehavior.strictSSL, false)
  assert.equal(list.response[0].code, 200)
  const getUser = exported.item[0].item[2]
  assert.deepEqual(getUser.request.url.variable, [{ key: 'id', value: '' }])
  const create = exported.item[0].item[1]
  assert.equal(create.request.body.mode, 'raw')
  assert.equal(create.request.body.options.raw.language, 'json')
  assert.equal(create.request.auth.type, 'basic')
  const upload = exported.item[1]
  assert.equal(upload.request.body.formdata[0].type, 'file')
  assert.equal(upload.request.body.formdata[0].src, '/tmp/a.png')

  const again = importPostman(JSON.parse(JSON.stringify(exported))).collections[0]!
  const a = flat(imported)
  const b = flat(again)
  assert.equal(a.length, b.length)
  assert.deepEqual(b.map(r => r.url), a.map(r => r.url))
  assert.deepEqual(b.map(r => r.method), a.map(r => r.method))
  assert.deepEqual(b.map(r => r.testScript), a.map(r => r.testScript))
  assert.deepEqual(b.map(r => r.params), a.map(r => r.params))
  assert.deepEqual(b.map(r => r.body), a.map(r => r.body))
  assert.deepEqual(b.map(r => r.auth), a.map(r => r.auth))
  assert.deepEqual(again.preRequestScript, imported.preRequestScript)
  assert.deepEqual(again.variables, imported.variables)
  assert.deepEqual(again.auth, imported.auth)
  const exA = a.find(r => r.name === 'List users')!
  const exB = b.find(r => r.name === 'List users')!
  assert.equal(exB.examples![0]!.body, exA.examples![0]!.body)
  assert.equal(exB.examples![0]!.status, 200)
})

test('postman environment export', () => {
  const env = exportPostmanEnvironment({ id: 'e1', name: 'Dev', variables: [{ key: 'a', value: '1' }, { key: 'secret', value: 'xyz', type: 'secret', enabled: false }] })
  assert.equal(env._postman_variable_scope, 'environment')
  assert.deepEqual(env.values, [{ key: 'a', value: '1', type: 'default', enabled: true }, { key: 'secret', value: 'xyz', type: 'secret', enabled: false }])
  const back = importPostman(env)
  assert.equal(back.environments[0]!.variables[1]!.type, 'secret')
})

test('openapi export', () => {
  const imported = importPostman(postmanFixture).collections[0]!
  const col = toExportCollection(imported)
  const doc = exportOpenApi(col)
  assert.equal(doc.openapi, '3.0.3')
  assert.equal(doc.info.title, 'Demo API')
  assert.deepEqual(doc.servers, [{ url: 'https://api.example.com' }])
  assert.ok(doc.paths['/users'].get)
  assert.ok(doc.paths['/users'].post)
  assert.ok(doc.paths['/users/{id}'].get)
  assert.equal(doc.paths['/users/{id}'].get.parameters[0].in, 'path')
  assert.equal(doc.paths['/users/{id}'].get.parameters[0].name, 'id')
  assert.deepEqual(doc.paths['/users'].get.tags, ['Users'])
  assert.deepEqual(doc.tags, [{ name: 'Users' }])
  const q = doc.paths['/users'].get.parameters.find((p: any) => p.in === 'query' && p.name === 'limit')
  assert.equal(q.required, false)
  assert.equal(doc.paths['/users'].get.responses['200'].content['application/json'].schema.type, 'array')
  assert.deepEqual(doc.paths['/users'].get.responses['200'].content['application/json'].example, [{ id: 1 }])
  assert.deepEqual(doc.paths['/users'].post.requestBody.content['application/json'].schema, { type: 'object', properties: { name: { type: 'string' } } })
  assert.equal(doc.paths['/users'].post.security[0].basicAuth.length, 0)
  assert.equal(doc.components.securitySchemes.bearerAuth.scheme, 'bearer')
  assert.equal(doc.components.securitySchemes.basicAuth.scheme, 'basic')
  assert.equal(doc.paths['/upload'].post.requestBody.content['multipart/form-data'].schema.properties.file.format, 'binary')
  const reimported = importOpenApi(doc).collections[0]!
  assert.equal(flat(reimported).length, 4)
})

test('schemaFromExample', () => {
  assert.deepEqual(schemaFromExample({ a: 1, b: 1.5, c: 'x', d: true, e: null, f: [{ g: '2024-01-01' }] }), {
    type: 'object',
    properties: {
      a: { type: 'integer' }, b: { type: 'number' }, c: { type: 'string' }, d: { type: 'boolean' }, e: { nullable: true },
      f: { type: 'array', items: { type: 'object', properties: { g: { type: 'string', format: 'date' } } } },
    },
  })
})

test('quiver export and plain text', () => {
  const imported = importPostman(postmanFixture).collections[0]!
  const col = toExportCollection(imported)
  col.folders[0]!.requests.push({ ...col.folders[0]!.requests[0]!, id: 'dup', name: 'List users' })
  const q = exportQuiver([col], [{ id: 'e', name: 'Env', variables: [{ key: 'k', value: 'v' }] }])
  assert.equal(q.quiver, 1)
  assert.ok(q.exportedAt)
  const back = detectAndImport(JSON.stringify(q))
  assert.equal(back.format, 'quiver')
  assert.equal(flat(back.collections[0]!).length, 5)
  assert.equal(back.environments[0]!.variables[0]!.value, 'v')

  const files = exportPlainText(col)
  const paths = files.map(f => f.path)
  assert.ok(paths.includes('collection.yaml'))
  assert.ok(paths.includes('Users/List users.yaml'))
  assert.ok(paths.includes('Users/List users-2.yaml'))
  assert.ok(paths.includes('Users/Create user.yaml'))
  assert.ok(paths.includes('Users/Get user.yaml'))
  assert.ok(paths.includes('Upload.yaml'))
  const colYaml = YAML.parse(files.find(f => f.path === 'collection.yaml')!.content)
  assert.equal(colYaml.name, 'Demo API')
  assert.equal(colYaml.auth.type, 'bearer')
  assert.equal(colYaml.variables[0].key, 'baseUrl')
  assert.equal(colYaml.scripts.preRequest, 'console.log("col pre")')
  const reqYaml = YAML.parse(files.find(f => f.path === 'Users/Create user.yaml')!.content)
  assert.equal(reqYaml.method, 'POST')
  assert.equal(reqYaml.url, '{{baseUrl}}/users')
  assert.equal(reqYaml.body.mode, 'json')
  assert.equal(reqYaml.auth.type, 'basic')
  const listYaml = YAML.parse(files.find(f => f.path === 'Users/List users.yaml')!.content)
  assert.equal(listYaml.settings.verifyTls, false)
  assert.equal(listYaml.examples[0].status, 200)
  assert.ok(listYaml.scripts.test.includes('pm.test'))
})
