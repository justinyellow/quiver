import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Save, Trash2, Eye, EyeOff, Copy, Download } from 'lucide-react'
import { api } from '@/lib/api'
import { useStore, useWorkspace, canEdit } from '@/store'
import type { Tab, Variable } from '@/lib/types'
import { toast, Confirm } from '@/components/ui'
import { cx, download } from '@/lib/utils'
import HelpButton from '@/components/HelpButton'

export default function EnvironmentEditor({ tab }: { tab: Tab }) {
  const { workspaceId, updateTab, closeTab, setEnvironment } = useStore()
  const ws = useWorkspace(); const user = useStore((s) => s.user); const editable = canEdit(ws, user)
  const qc = useQueryClient()
  const isNew = tab.entityId === 'new'
  const env = useQuery({ queryKey: ['environment', tab.entityId], queryFn: () => api.get(`/environments/${tab.entityId}`), enabled: !isNew })
  const [name, setName] = useState('New environment')
  const [vars, setVars] = useState<Variable[]>([])
  const [revealed, setRevealed] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [del, setDel] = useState(false)
  useEffect(() => { if (env.data && !dirty) { setName(env.data.name); setVars(env.data.variables) } }, [env.data]) // eslint-disable-line
  const reveal = async () => { const d = await api.get(`/environments/${tab.entityId}?reveal=true`); setVars((v) => v.map((x) => ({ ...x, value: d.variables.find((y: any) => y.key === x.key)?.value ?? x.value, masked: false }))); setRevealed(true) }
  const save = async () => {
    try {
      if (isNew) { const r = await api.post(`/workspaces/${workspaceId}/environments`, { name, variables: vars }); updateTab(tab.id, { entityId: r.id, title: name }); setEnvironment(r.id) }
      else { await api.patch(`/environments/${tab.entityId}`, { name, variables: vars }); updateTab(tab.id, { title: env.data?.is_global ? 'Globals' : name }) }
      setDirty(false); qc.invalidateQueries({ queryKey: ['environments'] }); qc.invalidateQueries({ queryKey: ['environment', tab.entityId] }); toast('Saved')
    } catch (e: any) { toast(e.message, 'err') }
  }
  useEffect(() => { updateTab(tab.id, { dirty }) }, [dirty]) // eslint-disable-line
  useEffect(() => { const h = (e: KeyboardEvent) => { if (useStore.getState().activeTab === tab.id && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save() } }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h) }) // eslint-disable-line
  const rows = [...vars, { key: '', value: '', type: 'default', enabled: true, __new: true } as any]
  const update = (i: number, p: Partial<Variable>) => { setDirty(true); setVars((v) => { const n = [...v]; if (i >= n.length) n.push({ key: '', value: '', type: 'default', enabled: true, ...p }); else n[i] = { ...n[i], ...p, masked: p.value !== undefined ? false : n[i].masked }; return n }) }
  const isGlobal = env.data?.is_global
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 h-10 border-b divider shrink-0">
        <input className="input-ghost font-medium max-w-xs" value={isGlobal ? 'Globals' : name} readOnly={!editable || isGlobal} onChange={(e) => { setName(e.target.value); setDirty(true) }} />
        <div className="flex-1" />
        {!isNew && vars.some((v) => v.type === 'secret') && editable && <button className="btn" onClick={() => revealed ? setRevealed(false) : reveal()} title="Reveal secret values (audited)">{revealed ? <EyeOff size={12} /> : <Eye size={12} />} {revealed ? 'Hide' : 'Reveal'} secrets</button>}
        {!isNew && <button className="btn" onClick={() => download(`${name}.postman_environment.json`, JSON.stringify({ name, values: vars.map((v) => ({ key: v.key, value: v.type === 'secret' ? '' : v.value, enabled: v.enabled !== false, type: v.type ?? 'default' })), _postman_variable_scope: 'environment' }, null, 2))} title="Export (secrets blanked)"><Download size={12} /></button>}
        {!isNew && !isGlobal && editable && <button className="btn" onClick={async () => { const r = await api.post(`/environments/${tab.entityId}/duplicate`); qc.invalidateQueries({ queryKey: ['environments'] }); toast(`Duplicated as ${r.name}`) }}><Copy size={12} /></button>}
        {!isNew && !isGlobal && editable && <button className="btn btn-danger" onClick={() => setDel(true)}><Trash2 size={12} /></button>}
        <HelpButton topic="variables" /><HelpButton topic="secrets" label="Secrets" />
        {editable && <button className={cx('btn', dirty && 'btn-primary')} onClick={save} disabled={!dirty && !isNew}><Save size={12} /> Save</button>}
      </div>
      <div className="px-3 py-2 text-[11px] faint border-b divider">Variables of type <b>secret</b> are encrypted at rest, masked in the UI, never exported with values, and never shown in docs or run logs. Use <span className="mono">{'{{name}}'}</span> anywhere in requests.</div>
      <div className="flex-1 overflow-auto">
        <table className="kv-table w-full text-xs">
          <thead><tr className="faint text-[10px] uppercase"><th className="w-7"></th><th className="text-left px-2 h-6 font-medium">Variable</th><th className="text-left px-2 font-medium w-28">Type</th><th className="text-left px-2 font-medium">Value</th><th className="w-10"></th></tr></thead>
          <tbody>{rows.map((r, i) => {
            const isNewRow = (r as any).__new
            return <tr key={i} className={cx(isNewRow && 'opacity-60 focus-within:opacity-100', r.enabled === false && 'opacity-50')}>
              <td className="text-center">{!isNewRow && <input type="checkbox" checked={r.enabled !== false} disabled={!editable} onChange={(e) => update(i, { enabled: e.target.checked })} />}</td>
              <td><input className="mono" value={r.key} placeholder="name" readOnly={!editable} onChange={(e) => update(i, { key: e.target.value })} /></td>
              <td><select className="bg-transparent h-7 px-1 outline-none text-xs" value={r.type ?? 'default'} disabled={!editable} onChange={(e) => update(i, { type: e.target.value as any })}><option value="default">default</option><option value="secret">secret</option></select></td>
              <td><input className="mono" type={r.type === 'secret' && !revealed && !isNewRow && r.masked !== false ? 'password' : 'text'} value={r.value} placeholder="value" readOnly={!editable} onChange={(e) => update(i, { value: e.target.value })} /></td>
              <td className="text-right pr-1">{!isNewRow && editable && <button className="btn btn-ghost btn-sm !px-1" onClick={() => { setDirty(true); setVars((v) => v.filter((_, j) => j !== i)) }}><Trash2 size={11} /></button>}</td>
            </tr>
          })}</tbody>
        </table>
      </div>
      <Confirm open={del} onClose={() => setDel(false)} danger title={`Delete environment "${name}"?`} onConfirm={async () => { await api.del(`/environments/${tab.entityId}`); qc.invalidateQueries({ queryKey: ['environments'] }); closeTab(tab.id) }} />
    </div>
  )
}
