#!/usr/bin/env node
// Minimal CI runner: runs a collection on a Quiver server and exits non-zero on failure.
// Usage: QUIVER_URL=https://quiver.example.com QUIVER_TOKEN=qv_... npx tsx src/cli.ts run --workspace <id> --collection <id> [--environment <id>] [--iterations N] [--data file.csv] [--junit out.xml] [--folder <id>]
import fs from 'node:fs'

const args = process.argv.slice(2)
const cmd = args[0]
const opt = (name: string) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined }
const base = (process.env.QUIVER_URL || opt('url') || 'http://localhost:4000').replace(/\/$/, '')
const token = process.env.QUIVER_TOKEN || opt('token')

async function api(method: string, path: string, body?: any) {
  const res = await fetch(base + '/api' + path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) throw new Error(`${res.status} ${data?.error || text}`)
  return data
}

async function main() {
  if (cmd !== 'run') { console.log('Usage: quiver run --workspace <id> --collection <id> [--environment <id>] [--iterations N] [--data file] [--junit out.xml] [--folder <id>]'); process.exit(2) }
  if (!token) { console.error('QUIVER_TOKEN (or --token) is required'); process.exit(2) }
  const ws = opt('workspace'), col = opt('collection')
  if (!ws || !col) { console.error('--workspace and --collection are required'); process.exit(2) }
  const dataFile = opt('data')
  const body: any = { collectionId: col, environmentId: opt('environment') ?? null, iterations: opt('iterations') ? Number(opt('iterations')) : undefined, dataText: dataFile ? fs.readFileSync(dataFile, 'utf8') : undefined, folderId: opt('folder'), source: 'api', includeBodies: false }
  console.log(`Running collection ${col} on ${base} …`)
  const r = await api('POST', `/workspaces/${ws}/runs?wait=true`, body)
  for (const it of r.results) {
    const failed = it.error || it.tests.some((t: any) => !t.passed)
    console.log(`${failed ? '✗' : '✓'} ${it.method} ${it.requestName} ${it.status ?? ''} ${it.timeMs ? Math.round(it.timeMs) + 'ms' : ''} ${it.error ?? ''}`)
    for (const t of it.tests) if (!t.passed) console.log(`    ✗ ${t.name}: ${t.error}`)
  }
  const s = r.summary
  console.log(`\n${r.status.toUpperCase()}: ${s.passed}/${s.total} requests passed, ${s.testsPassed}/${s.testsTotal} tests passed, ${s.errors} errors, ${s.durationMs}ms`)
  const junit = opt('junit')
  if (junit) { const res = await fetch(base + `/api/runs/${r.id}/junit`, { headers: { authorization: `Bearer ${token}` } }); fs.writeFileSync(junit, await res.text()); console.log(`JUnit report written to ${junit}`) }
  process.exit(r.status === 'passed' ? 0 : 1)
}
main().catch((e) => { console.error(e.message); process.exit(1) })
