import type { FastifyRequest } from 'fastify'
import { q } from '../db/index.js'

export function audit(req: FastifyRequest | null, action: string, opts: { workspaceId?: string | null; entityType?: string; entityId?: string; meta?: any } = {}) {
  q(
    `INSERT INTO audit_log (workspace_id, user_id, action, entity_type, entity_id, meta, ip) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [opts.workspaceId ?? null, req?.user?.id ?? null, action, opts.entityType ?? null, opts.entityId ?? null, JSON.stringify(opts.meta ?? {}), req?.ip ?? null],
  ).catch(() => {})
}
