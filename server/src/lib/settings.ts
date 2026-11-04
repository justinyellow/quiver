import { one, q } from '../db/index.js'

const cache = new Map<string, { v: any; t: number }>()

export async function getSetting<T = any>(key: string): Promise<T | undefined> {
  const c = cache.get(key)
  if (c && Date.now() - c.t < 5000) return c.v
  const row = await one<{ value: any }>('SELECT value FROM settings WHERE key=$1', [key])
  cache.set(key, { v: row?.value, t: Date.now() })
  return row?.value
}

export async function setSetting(key: string, value: any) {
  await q(`INSERT INTO settings (key, value, updated_at) VALUES ($1,$2,now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`, [key, JSON.stringify(value)])
  cache.delete(key)
}

export async function allSettings(): Promise<Record<string, any>> {
  const rows = await q<{ key: string; value: any }>('SELECT key, value FROM settings')
  const out: Record<string, any> = {}
  for (const r of rows) out[r.key] = r.value
  return out
}
