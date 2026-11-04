import { useState } from 'react'
import { Trash2, FileUp } from 'lucide-react'
import type { KV } from '@/lib/types'
import { cx } from '@/lib/utils'

export default function KVEditor({ items, onChange, readOnly, allowFile, placeholderKey = 'Key', placeholderValue = 'Value', showDescription = true, bulk = true }: { items: KV[]; onChange: (v: KV[]) => void; readOnly?: boolean; allowFile?: boolean; placeholderKey?: string; placeholderValue?: string; showDescription?: boolean; bulk?: boolean }) {
  const [bulkMode, setBulkMode] = useState(false)
  const rows = [...items, { key: '', value: '', enabled: true, __new: true } as any]
  const update = (i: number, patch: Partial<KV>) => {
    const next = [...items]
    if (i >= items.length) next.push({ key: '', value: '', enabled: true, ...patch })
    else next[i] = { ...next[i], ...patch }
    onChange(next)
  }
  const remove = (i: number) => onChange(items.filter((_, j) => j !== i))
  if (bulkMode) {
    const text = items.map((k) => `${k.enabled === false ? '//' : ''}${k.key}:${k.value}`).join('\n')
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-2 h-7 border-b divider text-[11px] faint"><span>One per line: <span className="mono">key:value</span>, prefix <span className="mono">//</span> to disable</span><button className="link" onClick={() => setBulkMode(false)}>Key-value edit</button></div>
        <textarea className="flex-1 w-full mono text-xs p-2 outline-none bg-transparent resize-none" defaultValue={text} readOnly={readOnly} onBlur={(e) => {
          const parsed = e.target.value.split('\n').filter((l) => l.trim()).map((l) => { const dis = l.startsWith('//'); const s = dis ? l.slice(2) : l; const i = s.indexOf(':'); return { key: (i < 0 ? s : s.slice(0, i)).trim(), value: i < 0 ? '' : s.slice(i + 1).trim(), enabled: !dis } })
          onChange(parsed)
        }} />
      </div>
    )
  }
  return (
    <div className="overflow-auto h-full">
      <table className="kv-table w-full border-collapse text-xs">
        <thead><tr className="faint text-[10px] uppercase"><th className="w-7"></th><th className="text-left font-medium px-2 h-6">{placeholderKey}</th><th className="text-left font-medium px-2">{placeholderValue}</th>{showDescription && <th className="text-left font-medium px-2 w-1/4">Description</th>}<th className="w-14 text-right pr-2">{bulk && !readOnly && <button className="link font-normal normal-case" onClick={() => setBulkMode(true)}>Bulk</button>}</th></tr></thead>
        <tbody>
          {rows.map((r, i) => {
            const isNew = (r as any).__new
            return (
              <tr key={i} className={cx(isNew && 'opacity-60 focus-within:opacity-100', r.enabled === false && 'opacity-50')}>
                <td className="text-center">{!isNew && <input type="checkbox" checked={r.enabled !== false} disabled={readOnly} onChange={(e) => update(i, { enabled: e.target.checked })} />}</td>
                <td><input value={r.key} placeholder={placeholderKey} readOnly={readOnly} onChange={(e) => update(i, { key: e.target.value })} className="mono" /></td>
                <td>
                  {r.type === 'file' ? (
                    <div className="flex items-center gap-1 px-2 h-7"><span className="truncate text-[11px]">{r.src || 'No file'}</span><label className="btn btn-sm cursor-pointer ml-auto"><FileUp size={11} /><input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => update(i, { value: String(rd.result).split(',')[1] ?? '', src: f.name, description: f.type || 'application/octet-stream' }); rd.readAsDataURL(f) }} /></label></div>
                  ) : <input value={r.value} placeholder={placeholderValue} readOnly={readOnly} onChange={(e) => update(i, { value: e.target.value })} className="mono" />}
                </td>
                {showDescription && <td><input value={r.type === 'file' ? '' : r.description ?? ''} placeholder="Description" readOnly={readOnly || r.type === 'file'} onChange={(e) => update(i, { description: e.target.value })} /></td>}
                <td className="text-right pr-1 whitespace-nowrap">
                  {allowFile && !readOnly && <select className="bg-transparent text-[10px] outline-none" value={r.type ?? 'text'} onChange={(e) => update(i, { type: e.target.value as any, value: '', src: undefined })}><option value="text">Text</option><option value="file">File</option></select>}
                  {!isNew && !readOnly && <button className="btn btn-ghost btn-sm !px-1 opacity-60 hover:opacity-100" onClick={() => remove(i)}><Trash2 size={11} /></button>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
