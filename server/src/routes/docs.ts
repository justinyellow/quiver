import type { FastifyInstance } from 'fastify'
import { one } from '../db/index.js'
import { notFound } from '../lib/errors.js'
import { loadTree } from '../lib/loaders.js'

// Public (unauthenticated) documentation JSON for collections that were explicitly published.
export async function docsRoutes(app: FastifyInstance) {
  app.get('/p/docs/:slug', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    const c = await one<any>('SELECT id, doc_public FROM collections WHERE doc_slug=$1', [(req.params as any).slug])
    if (!c || !c.doc_public) throw notFound()
    const tree = await loadTree(c.id, true)
    // never expose secrets/scripts publicly
    const strip = (r: any) => ({ id: r.id, name: r.name, description: r.description, method: r.method, url: r.url, params: r.params, headers: (r.headers ?? []).map((h: any) => (/authorization|cookie|api-key|x-api-key|token/i.test(h.key) ? { ...h, value: '••••' } : h)), body: r.body, auth: { type: r.auth?.type ?? 'inherit' }, examples: r.examples })
    const walkF = (f: any): any => ({ id: f.id, name: f.name, description: f.description, folders: f.folders.map(walkF), requests: f.requests.map(strip) })
    return { id: tree.id, name: tree.name, description: tree.description, variables: (tree.variables ?? []).filter((v: any) => v.type !== 'secret').map((v: any) => ({ key: v.key, value: v.value })), folders: tree.folders.map(walkF), requests: tree.requests.map(strip), public: true }
  })
}
