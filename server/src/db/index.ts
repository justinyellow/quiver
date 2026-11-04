import pg from 'pg'
import { config } from '../config.js'

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 })

export type Queryable = pg.Pool | pg.PoolClient

export async function q<T = any>(text: string, params: any[] = [], client: Queryable = pool): Promise<T[]> {
  const res = await client.query(text, params)
  return res.rows as T[]
}

export async function one<T = any>(text: string, params: any[] = [], client: Queryable = pool): Promise<T | undefined> {
  const rows = await q<T>(text, params, client)
  return rows[0]
}

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const r = await fn(client)
    await client.query('COMMIT')
    return r
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}
