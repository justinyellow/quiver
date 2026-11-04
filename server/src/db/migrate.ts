import { pool } from './index.js'
import { migrations } from './schema.js'

export async function migrate() {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (id INT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())`)
  const applied = new Set((await pool.query('SELECT id FROM schema_migrations')).rows.map((r) => r.id))
  for (const [i, sql] of migrations.entries()) {
    const id = i + 1
    if (applied.has(id)) continue
    const c = await pool.connect()
    try {
      await c.query('BEGIN')
      await c.query(sql)
      await c.query('INSERT INTO schema_migrations (id) VALUES ($1)', [id])
      await c.query('COMMIT')
    } catch (e) {
      await c.query('ROLLBACK')
      throw e
    } finally {
      c.release()
    }
  }
}
