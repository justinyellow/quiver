export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ')
export const fmtBytes = (n?: number) => n === undefined || n === null ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`
export const fmtMs = (n?: number) => n === undefined || n === null ? '' : n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(2)} s`
export const fmtDate = (s?: string | number) => s ? new Date(s).toLocaleString() : ''
export const timeAgo = (s?: string | number) => { if (!s) return ''; const d = (Date.now() - new Date(s).getTime()) / 1000; if (d < 60) return 'just now'; if (d < 3600) return `${Math.floor(d / 60)}m ago`; if (d < 86400) return `${Math.floor(d / 3600)}h ago`; return `${Math.floor(d / 86400)}d ago` }
export const uid = () => Math.random().toString(36).slice(2, 10)
export const tryJson = (s: string) => { try { return JSON.parse(s) } catch { return undefined } }
export const prettyJson = (s: string) => { try { return JSON.stringify(JSON.parse(s), null, 2) } catch { return s } }
export function download(name: string, content: string, type = 'application/json') {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
export async function copy(text: string) { try { await navigator.clipboard.writeText(text); return true } catch { return false } }
export function parseQuery(url: string): { key: string; value: string }[] {
  const i = url.indexOf('?'); if (i < 0) return []
  return url.slice(i + 1).split('#')[0].split('&').filter(Boolean).map((p) => { const j = p.indexOf('='); return { key: safeDecode(j < 0 ? p : p.slice(0, j)), value: j < 0 ? '' : safeDecode(p.slice(j + 1)) } })
}
const safeDecode = (s: string) => { try { return decodeURIComponent(s.replace(/\+/g, ' ')) } catch { return s } }
export function statusClass(s?: number) { return s ? `status-${Math.floor(s / 100)}` : '' }
export function interpolateHint(s: string, vars: Record<string, string | undefined>) { return s.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (m, k) => (k.startsWith('$') ? m : vars[k] !== undefined ? vars[k]! : m)) }
