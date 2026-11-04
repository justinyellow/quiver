import type pg from 'pg'

export async function createPersonalWorkspace(c: pg.PoolClient, userId: string) {
  const ws = (await c.query(`INSERT INTO workspaces (name, type, created_by) VALUES ('My Workspace', 'personal', $1) RETURNING id`, [userId])).rows[0]
  await c.query(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'admin')`, [ws.id, userId])
  await c.query(`INSERT INTO environments (workspace_id, name, is_global) VALUES ($1, 'Globals', true)`, [ws.id])
  return ws.id
}

export async function createTeamWorkspace(c: pg.PoolClient, name: string, userId: string) {
  const ws = (await c.query(`INSERT INTO workspaces (name, type, created_by) VALUES ($1, 'team', $2) RETURNING id`, [name, userId])).rows[0]
  await c.query(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'admin')`, [ws.id, userId])
  await c.query(`INSERT INTO environments (workspace_id, name, is_global) VALUES ($1, 'Globals', true)`, [ws.id])
  return ws.id
}
