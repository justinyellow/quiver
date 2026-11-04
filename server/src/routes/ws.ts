import type { FastifyInstance } from 'fastify'
import WebSocket from 'ws'
import { requireWorkspace } from '../lib/auth.js'
import { resolveAndCheck } from '../engine/ssrf.js'
import { guardFor } from './execute.js'

// Browser <-> Quiver <-> target WebSocket proxy, so the UI can speak to WS APIs with custom headers.
// Protocol: client sends JSON {type:'connect', url, headers?, protocols?} then {type:'send', data} / {type:'close'}.
export async function wsRoutes(app: FastifyInstance) {
  app.get('/workspaces/:wsId/ws-proxy', { websocket: true }, async (socket, req) => {
    const { wsId } = req.params as any
    try { await requireWorkspace(req, wsId) } catch { socket.close(4401, 'unauthorized'); return }
    let target: WebSocket | null = null
    const send = (o: any) => { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(o)) }
    socket.on('message', async (raw: any) => {
      let msg: any
      try { msg = JSON.parse(raw.toString()) } catch { return send({ type: 'error', message: 'invalid message' }) }
      if (msg.type === 'connect') {
        if (target) { target.close(); target = null }
        try {
          const u = new URL(msg.url)
          if (!['ws:', 'wss:'].includes(u.protocol)) throw new Error('URL must be ws:// or wss://')
          const { guard } = await guardFor()
          await resolveAndCheck(u.hostname, guard)
          const t0 = Date.now()
          target = new WebSocket(msg.url, msg.protocols || [], { headers: msg.headers || {}, rejectUnauthorized: msg.verifyTls !== false, handshakeTimeout: 15000 })
          target.on('open', () => send({ type: 'open', ms: Date.now() - t0, protocol: target?.protocol }))
          target.on('message', (data: any, isBinary: boolean) => send({ type: 'message', data: isBinary ? data.toString('base64') : data.toString(), binary: isBinary, ts: Date.now() }))
          target.on('close', (code: number, reason: Buffer) => send({ type: 'close', code, reason: reason.toString() }))
          target.on('error', (e: Error) => send({ type: 'error', message: e.message }))
          target.on('unexpected-response', (_r: any, res: any) => send({ type: 'error', message: `Unexpected response ${res.statusCode}` }))
        } catch (e: any) { send({ type: 'error', message: e.message }) }
      } else if (msg.type === 'send') {
        if (!target || target.readyState !== WebSocket.OPEN) return send({ type: 'error', message: 'not connected' })
        target.send(msg.binary ? Buffer.from(msg.data, 'base64') : msg.data)
        send({ type: 'sent', data: msg.data, ts: Date.now() })
      } else if (msg.type === 'close') {
        target?.close(1000)
        target = null
      } else if (msg.type === 'ping') send({ type: 'pong' })
    })
    socket.on('close', () => { target?.close(); target = null })
  })
}
