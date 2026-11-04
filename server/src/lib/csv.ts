export function parseCsv(text: string): Record<string, any>[] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++ } else inQ = false }
      else cur += ch
    } else if (ch === '"') inQ = true
    else if (ch === ',') { row.push(cur); cur = '' }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = '' }
    else cur += ch
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row) }
  const [header, ...data] = rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ''))
  if (!header) return []
  return data.map((r) => { const o: Record<string, any> = {}; header.forEach((h, i) => { o[h.trim()] = coerce(r[i] ?? '') }); return o })
}
function coerce(v: string): any {
  if (v === 'true') return true
  if (v === 'false') return false
  if (v !== '' && !isNaN(Number(v)) && /^-?\d+(\.\d+)?$/.test(v)) return Number(v)
  return v
}
