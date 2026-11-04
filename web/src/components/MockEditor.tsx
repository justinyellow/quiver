import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Save, Trash2, Copy, RefreshCw } from 'lucide-react'
import { api } from '@/lib/api'
import { useStore, useWorkspace, canEdit } from '@/store'
import type { Tab } from '@/lib/types'
import { Field, Toggle, toast } from '@/components/ui'
import { useTree } from '@/components/sidebar/Sidebar'
import HelpButton from '@/components/HelpButton'
import { cx, copy, fmtDate, statusClass } from '@/lib/utils'

export default function MockEditor({ tab }: { tab: Tab }) {
  const { workspaceId, updateTab, closeTab } = useStore()
  const ws = useWorkspace(); const user = useStore((s) => s.user); const editable = canEdit(ws, user)
  const qc = useQueryClient()
  const tree = useTree()
  const isNew = tab.entityId === 'new'
  const mocks = useQuery({ queryKey: ['mocks', workspaceId], queryFn: () => api.get(`/workspaces/${workspaceId}/mocks`) })
  const mock = mocks.data?.find((m: any) => m.id === tab.entityId)
  const logs = useQuery({ queryKey: ['mock-logs', tab.entityId], queryFn: () => api.get(`/mocks/${tab.entityId}/logs`), enabled: !isNew, refetchInterval: 5000 })
  const [form, setForm] = useState<any>({ name: '', collectionId: tab.meta?.collectionId ?? '', enabled: true, delayMs: 0, requireKey: false })
  const [key, setKey] = useState<string | null>(null)
  useEffect(() => { if (mock) setForm({ name: mock.name, collectionId: mock.collection_id, enabled: mock.enabled, delayMs: mock.delay_ms, requireKey: mock.require_key }) }, [mock])
  const save = async () => {
    try {
      if (isNew) { const r = await api.post(`/workspaces/${workspaceId}/mocks`, form); updateTab(tab.id, { entityId: r.id, title: r.name }); if (r.key) setKey(r.key) }
      else { const r = await api.patch(`/mocks/${tab.entityId}`, form); if (r.key) setKey(r.key) }
      qc.invalidateQueries({ queryKey: ['mocks'] }); toast('Saved')
    } catch (e: any) { toast(e.message, 'err') }
  }
  const url = mock ? `${location.origin}/mock/${mock.slug}` : null
  const examples = tree.data?.examples.filter((e) => tree.data!.requests.find((r) => r.id === e.request_id)?.collection_id === form.collectionId) ?? []
  return (
    <div className="flex h-full min-h-0 text-xs">
      <div className="w-96 border-r divider p-4 overflow-auto shrink-0">
        <div className="flex justify-end -mt-2 mb-1"><HelpButton topic="mocks" label="How mock servers work" /></div><Field label="Name"><input className="input" value={form.name} readOnly={!editable} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Collection" hint="Saved examples in this collection become mock responses."><select className="input" value={form.collectionId} disabled={!editable} onChange={(e) => setForm({ ...form, collectionId: e.target.value })}><option value="">Select…</option>{tree.data?.collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Response delay (ms)"><input className="input w-32" type="number" min={0} value={form.delayMs} readOnly={!editable} onChange={(e) => setForm({ ...form, delayMs: Number(e.target.value) })} /></Field>
        <div className="space-y-2 mb-4"><Toggle checked={form.enabled} onChange={(v) => editable && setForm({ ...form, enabled: v })} label="Enabled" /><Toggle checked={form.requireKey} onChange={(v) => editable && setForm({ ...form, requireKey: v })} label="Require x-mock-key header (private mock)" /></div>
        {editable && <div className="flex gap-2"><button className="btn btn-primary" disabled={!form.name || !form.collectionId} onClick={save}><Save size={12} /> Save</button>{!isNew && form.requireKey && <button className="btn" onClick={async () => { const r = await api.patch(`/mocks/${tab.entityId}`, { rotateKey: true }); setKey(r.key); toast('Key rotated') }}><RefreshCw size={12} /> Rotate key</button>}{!isNew && <button className="btn btn-danger ml-auto" onClick={async () => { if (confirm('Delete mock server?')) { await api.del(`/mocks/${tab.entityId}`); qc.invalidateQueries({ queryKey: ['mocks'] }); closeTab(tab.id) } }}><Trash2 size={12} /></button>}</div>}
        {key && <div className="mt-3 p-2 rounded border divider" style={{ background: 'var(--sel)' }}><div className="font-medium mb-1">Mock key (shown once)</div><div className="flex gap-1"><input className="input mono" readOnly value={key} /><button className="btn" onClick={async () => { await copy(key); toast('Copied') }}><Copy size={12} /></button></div></div>}
        {url && <div className="mt-4"><div className="font-medium mb-1">Mock URL</div><div className="flex gap-1"><input className="input mono" readOnly value={url} /><button className="btn" onClick={async () => { await copy(url); toast('Copied') }}><Copy size={12} /></button></div><div className="faint mt-2">Point your app's base URL at this. Paths are matched against the request URLs in the collection (host and <span className="mono">{'{{baseUrl}}'}</span> ignored). Select a specific example with <span className="mono">x-mock-response-name</span> or <span className="mono">x-mock-response-code</span> headers.</div></div>}
        <div className="mt-4"><div className="font-medium mb-1">Routes ({examples.length} examples)</div>{examples.length ? examples.map((e) => { const r = tree.data!.requests.find((x) => x.id === e.request_id)!; return <div key={e.id} className="flex items-center gap-2 py-0.5"><span className={cx('method', 'm-' + r.method)}>{r.method}</span><span className="mono truncate flex-1">{r.url.replace(/^.*?\/\/[^/]+/, '').replace(/^\{\{[^}]+\}\}/, '')}</span><span className={statusClass(e.status)}>{e.status}</span></div> }) : <div className="faint">No examples yet. Send a request and click "Example" in the response panel, or add examples when importing an OpenAPI spec.</div>}</div>
      </div>
      <div className="flex-1 min-w-0 overflow-auto">
        <div className="h-9 flex items-center px-3 border-b divider font-medium">Request log</div>
        <table className="w-full"><tbody>{(logs.data ?? []).map((l: any) => <tr key={l.id} className="border-b divider"><td className="px-3 py-1 faint whitespace-nowrap">{fmtDate(l.created_at)}</td><td className={cx('method', 'm-' + l.method)}>{l.method}</td><td className="mono break-all">{l.path}</td><td className={cx('px-3 text-right', statusClass(l.status))}>{l.status}</td></tr>)}</tbody></table>
        {!logs.data?.length && <div className="p-4 faint">No calls yet.</div>}
      </div>
    </div>
  )
}
