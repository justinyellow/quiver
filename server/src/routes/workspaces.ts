import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { one, q, tx } from '../db/index.js'
import { parse } from '../lib/validate.js'
import { badRequest, forbidden, notFound } from '../lib/errors.js'
import { requireAdmin, requireUser, requireWorkspace } from '../lib/auth.js'
import { audit } from '../lib/audit.js'
import { createTeamWorkspace } from '../lib/workspace.js'
import { randomToken, sha256 } from '../lib/crypto.js'
import { allSettings, setSetting } from '../lib/settings.js'
import { config } from '../config.js'
import { sendMail } from '../lib/mail.js'

const roleSchema = z.enum(['admin', 'editor', 'viewer'])

export async function workspaceRoutes(app: FastifyInstance) {
  app.get('/workspaces', async (req) => {
    const u = requireUser(req)
    if (u.role === 'admin') return q(`SELECT w.*, COALESCE(m.role,'admin') as role, (SELECT count(*) FROM workspace_members WHERE workspace_id=w.id)::int as member_count FROM workspaces w LEFT JOIN workspace_members m ON m.workspace_id=w.id AND m.user_id=$1 WHERE w.type='team' OR m.user_id=$1 ORDER BY w.type DESC, w.name`, [u.id])
    return q(`SELECT w.*, m.role, (SELECT count(*) FROM workspace_members WHERE workspace_id=w.id)::int as member_count FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id WHERE m.user_id=$1 ORDER BY w.type DESC, w.name`, [u.id])
  })

  app.post('/workspaces', async (req) => {
    const u = requireUser(req)
    const body = parse(z.object({ name: z.string().min(1).max(100) }), req.body)
    const id = await tx((c) => createTeamWorkspace(c, body.name, u.id))
    audit(req, 'workspace.create', { workspaceId: id, entityType: 'workspace', entityId: id })
    return one('SELECT * FROM workspaces WHERE id=$1', [id])
  })

  app.get('/workspaces/:id', async (req) => {
    const { id } = req.params as any
    const u = await requireWorkspace(req, id)
    const ws = await one('SELECT * FROM workspaces WHERE id=$1', [id])
    if (!ws) throw notFound()
    const members = await q(`SELECT u.id, u.email, u.name, m.role, m.created_at FROM workspace_members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 ORDER BY u.name`, [id])
    const me = members.find((m) => m.id === u.id)
    return { ...ws, members, role: me?.role ?? (u.role === 'admin' ? 'admin' : 'viewer') }
  })

  app.patch('/workspaces/:id', async (req) => {
    const { id } = req.params as any
    await requireWorkspace(req, id, 'admin')
    const body = parse(z.object({ name: z.string().min(1).max(100) }), req.body)
    await q('UPDATE workspaces SET name=$1 WHERE id=$2', [body.name, id])
    audit(req, 'workspace.update', { workspaceId: id, entityType: 'workspace', entityId: id })
    return { ok: true }
  })

  app.delete('/workspaces/:id', async (req) => {
    const { id } = req.params as any
    await requireWorkspace(req, id, 'admin')
    const ws = await one<any>('SELECT type FROM workspaces WHERE id=$1', [id])
    if (ws?.type === 'personal') throw badRequest('Personal workspaces cannot be deleted')
    await q('DELETE FROM workspaces WHERE id=$1', [id])
    audit(req, 'workspace.delete', { workspaceId: id, entityType: 'workspace', entityId: id })
    return { ok: true }
  })

  // ---- members
  app.post('/workspaces/:id/members', async (req) => {
    const { id } = req.params as any
    await requireWorkspace(req, id, 'admin')
    const body = parse(z.object({ email: z.string().email(), role: roleSchema }), req.body)
    const user = await one<any>('SELECT id FROM users WHERE lower(email)=lower($1)', [body.email])
    if (!user) throw notFound('No user with that email. Invite them first.')
    await q(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT (workspace_id, user_id) DO UPDATE SET role=EXCLUDED.role`, [id, user.id, body.role])
    audit(req, 'workspace.member_add', { workspaceId: id, entityType: 'user', entityId: user.id, meta: { role: body.role } })
    return { ok: true }
  })
  app.patch('/workspaces/:id/members/:userId', async (req) => {
    const { id, userId } = req.params as any
    await requireWorkspace(req, id, 'admin')
    const body = parse(z.object({ role: roleSchema }), req.body)
    await q('UPDATE workspace_members SET role=$1 WHERE workspace_id=$2 AND user_id=$3', [body.role, id, userId])
    audit(req, 'workspace.member_role', { workspaceId: id, entityType: 'user', entityId: userId, meta: { role: body.role } })
    return { ok: true }
  })
  app.delete('/workspaces/:id/members/:userId', async (req) => {
    const { id, userId } = req.params as any
    const u = await requireWorkspace(req, id, userId === req.user?.id ? 'viewer' : 'admin')
    const admins = await q('SELECT user_id FROM workspace_members WHERE workspace_id=$1 AND role=$2', [id, 'admin'])
    if (admins.length === 1 && admins[0].user_id === userId && u.role !== 'admin') throw badRequest('Cannot remove the last workspace admin')
    await q('DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2', [id, userId])
    audit(req, 'workspace.member_remove', { workspaceId: id, entityType: 'user', entityId: userId })
    return { ok: true }
  })

  // ---- invites (workspace admins can invite to their workspace; instance admins anywhere)
  app.post('/workspaces/:id/invites', async (req) => {
    const { id } = req.params as any
    const u = await requireWorkspace(req, id, 'admin')
    const body = parse(z.object({ email: z.string().email(), role: roleSchema.default('editor') }), req.body)
    const existing = await one<any>('SELECT id FROM users WHERE lower(email)=lower($1)', [body.email])
    if (existing) {
      await q(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT (workspace_id, user_id) DO UPDATE SET role=EXCLUDED.role`, [id, existing.id, body.role])
      return { added: true }
    }
    const token = randomToken(24)
    await q(`INSERT INTO invites (email, token_hash, role, workspace_id, workspace_role, created_by, expires_at) VALUES ($1,$2,'user',$3,$4,$5, now() + interval '7 days')`, [body.email.toLowerCase(), sha256(token), id, body.role, u.id])
    const link = `${config.baseUrl.replace(/\/$/, '')}/register?invite=${token}&email=${encodeURIComponent(body.email.toLowerCase())}`
    const mailed = await sendMail(body.email, 'You have been invited to Quiver', `${u.name} invited you to join a Quiver workspace.\n\nCreate your account: ${link}\n\nThis link expires in 7 days.`)
    audit(req, 'workspace.invite', { workspaceId: id, meta: { email: body.email, role: body.role } })
    return { invited: true, link, mailed }
  })

  // ---- audit log (workspace admins)
  app.get('/workspaces/:id/audit', async (req) => {
    const { id } = req.params as any
    await requireWorkspace(req, id, 'admin')
    const { limit = '100', before } = req.query as any
    return q(`SELECT a.*, u.email as user_email, u.name as user_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id WHERE a.workspace_id=$1 ${before ? 'AND a.id < $3' : ''} ORDER BY a.id DESC LIMIT $2`, before ? [id, Math.min(Number(limit), 500), before] : [id, Math.min(Number(limit), 500)])
  })

  // ---- instance admin
  app.get('/admin/users', async (req) => {
    requireAdmin(req)
    return q(`SELECT id, email, name, role, totp_enabled, disabled, oidc_subject IS NOT NULL as sso, created_at, last_login_at FROM users ORDER BY created_at`)
  })
  app.patch('/admin/users/:id', async (req) => {
    const admin = requireAdmin(req)
    const { id } = req.params as any
    const body = parse(z.object({ role: z.enum(['admin', 'user']).optional(), disabled: z.boolean().optional(), name: z.string().min(1).max(100).optional() }), req.body)
    if (id === admin.id && (body.role === 'user' || body.disabled)) throw badRequest('You cannot demote or disable yourself')
    if (body.role !== undefined) await q('UPDATE users SET role=$1 WHERE id=$2', [body.role, id])
    if (body.disabled !== undefined) { await q('UPDATE users SET disabled=$1 WHERE id=$2', [body.disabled, id]); if (body.disabled) await q('DELETE FROM sessions WHERE user_id=$1', [id]) }
    if (body.name !== undefined) await q('UPDATE users SET name=$1 WHERE id=$2', [body.name, id])
    audit(req, 'admin.user_update', { entityType: 'user', entityId: id, meta: body })
    return { ok: true }
  })
  app.delete('/admin/users/:id', async (req) => {
    const admin = requireAdmin(req)
    const { id } = req.params as any
    if (id === admin.id) throw badRequest('You cannot delete yourself')
    await q('DELETE FROM users WHERE id=$1', [id])
    audit(req, 'admin.user_delete', { entityType: 'user', entityId: id })
    return { ok: true }
  })
  app.post('/admin/users/:id/reset-password', async (req) => {
    requireAdmin(req)
    const { id } = req.params as any
    const token = randomToken(24)
    const u = await one<any>('SELECT email FROM users WHERE id=$1', [id])
    if (!u) throw notFound()
    await q(`INSERT INTO invites (email, token_hash, role, expires_at) VALUES ($1,$2,'reset', now() + interval '1 day')`, [u.email, sha256(token)])
    const link = `${config.baseUrl.replace(/\/$/, '')}/reset?token=${token}`
    const mailed = await sendMail(u.email, 'Quiver password reset', `Reset your password: ${link}\n\nThis link expires in 24 hours.`)
    audit(req, 'admin.password_reset_issued', { entityType: 'user', entityId: id })
    return { link, mailed }
  })
  app.post('/admin/invites', async (req) => {
    const admin = requireAdmin(req)
    const body = parse(z.object({ email: z.string().email(), role: z.enum(['admin', 'user']).default('user') }), req.body)
    const token = randomToken(24)
    await q(`INSERT INTO invites (email, token_hash, role, created_by, expires_at) VALUES ($1,$2,$3,$4, now() + interval '7 days')`, [body.email.toLowerCase(), sha256(token), body.role, admin.id])
    const link = `${config.baseUrl.replace(/\/$/, '')}/register?invite=${token}&email=${encodeURIComponent(body.email.toLowerCase())}`
    const mailed = await sendMail(body.email, 'You have been invited to Quiver', `Create your Quiver account: ${link}\n\nThis link expires in 7 days.`)
    audit(req, 'admin.invite', { meta: { email: body.email, role: body.role } })
    return { link, mailed }
  })
  app.get('/admin/invites', async (req) => {
    requireAdmin(req)
    return q(`SELECT i.id, i.email, i.role, i.workspace_id, i.workspace_role, i.created_at, i.expires_at, i.accepted_at, w.name as workspace_name FROM invites i LEFT JOIN workspaces w ON w.id=i.workspace_id WHERE i.role <> 'reset' ORDER BY i.created_at DESC LIMIT 200`)
  })
  app.delete('/admin/invites/:id', async (req) => {
    requireAdmin(req)
    await q('DELETE FROM invites WHERE id=$1', [(req.params as any).id])
    return { ok: true }
  })
  app.get('/admin/settings', async (req) => {
    requireAdmin(req)
    const s = await allSettings()
    return { settings: s, env: { allowSignup: config.allowSignup, allowPrivateTargets: config.allowPrivateTargets, allowLoopbackTargets: config.allowLoopbackTargets || !config.isProd, blockedHosts: config.blockedHosts, oidcEnabled: !!config.oidc.issuer, smtpEnabled: !!config.smtp.url, baseUrl: config.baseUrl, maxResponseBytes: config.maxResponseBytes, scriptTimeoutMs: config.scriptTimeoutMs } }
  })
  app.patch('/admin/settings', async (req) => {
    requireAdmin(req)
    const body = parse(z.object({
      allowSignup: z.boolean().optional(),
      historyRetentionDays: z.number().int().min(1).max(3650).optional(),
      blockedHosts: z.array(z.string()).optional(),
      allowPrivateTargets: z.boolean().optional(),
      allowLoopbackTargets: z.boolean().optional(),
      proxyUrl: z.string().max(500).optional(),
      instanceName: z.string().max(100).optional(),
    }), req.body)
    for (const [k, v] of Object.entries(body)) if (v !== undefined) await setSetting(k, v)
    audit(req, 'admin.settings_update', { meta: body })
    return { ok: true }
  })
  app.get('/admin/audit', async (req) => {
    requireAdmin(req)
    const { limit = '200', before } = req.query as any
    return q(`SELECT a.*, u.email as user_email, u.name as user_name, w.name as workspace_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id LEFT JOIN workspaces w ON w.id=a.workspace_id ${before ? 'WHERE a.id < $2' : ''} ORDER BY a.id DESC LIMIT $1`, before ? [Math.min(Number(limit), 1000), before] : [Math.min(Number(limit), 1000)])
  })
  app.get('/admin/stats', async (req) => {
    requireAdmin(req)
    const r = await one<any>(`SELECT (SELECT count(*) FROM users)::int as users, (SELECT count(*) FROM workspaces)::int as workspaces, (SELECT count(*) FROM collections)::int as collections, (SELECT count(*) FROM requests)::int as requests, (SELECT count(*) FROM runs)::int as runs, (SELECT count(*) FROM history)::int as history, (SELECT count(*) FROM monitors WHERE enabled)::int as monitors, (SELECT count(*) FROM mocks WHERE enabled)::int as mocks`)
    return r
  })
  void forbidden
}
