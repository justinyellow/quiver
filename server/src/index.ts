import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import websocket from '@fastify/websocket'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { config } from './config.js'
import { migrate } from './db/migrate.js'
import { pool, q } from './db/index.js'
import { authPlugin } from './lib/auth.js'
import { HttpError } from './lib/errors.js'
import { authRoutes } from './routes/auth.js'
import { workspaceRoutes } from './routes/workspaces.js'
import { collectionRoutes } from './routes/collections.js'
import { environmentRoutes } from './routes/environments.js'
import { executeRoutes } from './routes/execute.js'
import { runRoutes } from './routes/runs.js'
import { monitorRoutes, startScheduler } from './routes/monitors.js'
import { mockRoutes, mockServer } from './routes/mocks.js'
import { docsRoutes } from './routes/docs.js'
import { wsRoutes } from './routes/ws.js'
import { getSetting } from './lib/settings.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export async function buildServer() {
  const app = Fastify({
    logger: { level: config.logLevel, transport: config.isProd ? undefined : { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } },
    trustProxy: config.trustProxy,
    bodyLimit: 60 * 1024 * 1024,
  })

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        frameSrc: ["'self'", 'blob:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: null,
      },
    },
    crossOriginEmbedderPolicy: false,
  })
  await app.register(cookie, { secret: config.sessionSecret })
  await app.register(rateLimit, { global: true, max: 600, timeWindow: '1 minute', allowList: (req) => !!req.user })
  await app.register(websocket)
  await app.register(authPlugin)

  // accept any content-type for the mock server + raw bodies
  app.addContentTypeParser('*', { parseAs: 'string' }, (_req, body, done) => done(null, body))
  app.addContentTypeParser(/^text\//, { parseAs: 'string' }, (_req, body, done) => done(null, body))
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => done(null, body))

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message, details: err.details })
    if (err.validation) return reply.code(400).send({ error: err.message })
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message })
    req.log.error(err)
    return reply.code(500).send({ error: config.isProd ? 'Internal server error' : err.message })
  })

  app.get('/api/health', async () => { await q('SELECT 1'); return { ok: true, version: '0.1.0' } })
  app.get('/api/config', async () => ({ instanceName: (await getSetting<string>('instanceName')) || 'Quiver', baseUrl: config.baseUrl, oidcEnabled: !!config.oidc.issuer, oidcLabel: process.env.OIDC_LABEL || 'SSO' }))

  await app.register(async (api) => {
    await api.register(authRoutes)
    await api.register(workspaceRoutes)
    await api.register(collectionRoutes)
    await api.register(environmentRoutes)
    await api.register(executeRoutes)
    await api.register(runRoutes)
    await api.register(monitorRoutes)
    await api.register(mockRoutes)
    await api.register(wsRoutes)
  }, { prefix: '/api' })
  await app.register(docsRoutes)
  await app.register(mockServer)

  // Serve built web app in production
  const webDist = path.resolve(__dirname, '../../web/dist')
  if (fs.existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false, maxAge: '1h', index: false })
    app.get('/*', async (req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/mock/') || req.url.startsWith('/p/')) return reply.code(404).send({ error: 'Not found' })
      return reply.sendFile('index.html', webDist, { maxAge: 0 })
    })
  }
  return app
}

async function main() {
  await migrate()
  const app = await buildServer()
  startScheduler(app.log)
  // history retention
  setInterval(async () => { const days = (await getSetting<number>('historyRetentionDays')) ?? 30; await q(`DELETE FROM history WHERE created_at < now() - ($1 || ' days')::interval`, [String(days)]).catch(() => {}); await q(`DELETE FROM sessions WHERE expires_at < now()`).catch(() => {}); await q(`DELETE FROM mock_logs WHERE created_at < now() - interval '7 days'`).catch(() => {}) }, 3600_000).unref()
  await app.listen({ port: config.port, host: config.host })
  const shutdown = async () => { await app.close(); await pool.end(); process.exit(0) }
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().catch((e) => { console.error(e); process.exit(1) })
