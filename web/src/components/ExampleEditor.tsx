import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Save, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import { useStore, useWorkspace, canEdit } from '@/store'
import type { Tab } from '@/lib/types'
import { Tabs, toast, Field } from '@/components/ui'
import { cx } from '@/lib/utils'
import CodeEditor from '@/components/CodeEditor'
import KVEditor from '@/components/request/KVEditor'
import HelpButton from '@/components/HelpButton'

export default function ExampleEditor({ tab }: { tab: Tab }) {
  const { updateTab, closeTab } = useStore()
  const ws = useWorkspace(); const user = useStore((s) => s.user); const editable = canEdit(ws, user)
  const qc = useQueryClient()
  const req = useQuery({ queryKey: ['request', tab.meta?.requestId], queryFn: () => api.get(`/requests/${tab.meta.requestId}`), enabled: !!tab.meta?.requestId })
  const ex = req.data?.examples?.find((e: any) => e.id === tab.entityId)
  const [draft, setDraft] = useState<any>(null)
  const [section, setSection] = useState('body')
  useEffect(() => { if (ex && !draft) setDraft({ name: ex.name, status: ex.status, statusText: ex.status_text, headers: ex.headers, body: ex.body, request: ex.request }) }, [ex]) // eslint-disable-line
  const dirty = !!draft && !!ex && JSON.stringify(draft) !== JSON.stringify({ name: ex.name, status: ex.status, statusText: ex.status_text, headers: ex.headers, body: ex.body, request: ex.request })
  useEffect(() => { updateTab(tab.id, { dirty, title: draft?.name ?? tab.title }) }, [dirty, draft?.name]) // eslint-disable-line
  const save = async () => { await api.patch(`/examples/${tab.entityId}`, draft); qc.invalidateQueries({ queryKey: ['request', tab.meta?.requestId] }); qc.invalidateQueries({ queryKey: ['tree'] }); toast('Saved') }
  if (!draft) return null
  const set = (p: any) => setDraft((d: any) => ({ ...d, ...p }))
  const lang = /json/.test(draft.headers?.find((h: any) => /content-type/i.test(h.key))?.value ?? '') || /^\s*[{[]/.test(draft.body) ? 'json' : 'text'
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 h-10 border-b divider shrink-0"><span className="faint text-[11px]">Example of {req.data?.name}</span><input className="input-ghost font-medium max-w-xs" value={draft.name} readOnly={!editable} onChange={(e) => set({ name: e.target.value })} /><div className="flex-1" /><HelpButton topic="mocks" />{editable && <button className="btn btn-danger" onClick={async () => { if (confirm('Delete example?')) { await api.del(`/examples/${tab.entityId}`); qc.invalidateQueries({ queryKey: ['request', tab.meta?.requestId] }); qc.invalidateQueries({ queryKey: ['tree'] }); closeTab(tab.id) } }}><Trash2 size={12} /></button>}{editable && <button className={cx('btn', dirty && 'btn-primary')} disabled={!dirty} onClick={save}><Save size={12} /> Save</button>}</div>
      <div className="flex items-center gap-3 px-3 py-2 border-b divider text-xs"><span className="muted">Request:</span><span className={cx('method !w-auto', 'm-' + draft.request?.method)}>{draft.request?.method}</span><span className="mono truncate">{draft.request?.url}</span><div className="flex-1" /><Field label="Status"><input className="input w-20 mono" type="number" value={draft.status} readOnly={!editable} onChange={(e) => set({ status: Number(e.target.value) })} /></Field><Field label="Status text"><input className="input w-32" value={draft.statusText} readOnly={!editable} onChange={(e) => set({ statusText: e.target.value })} /></Field></div>
      <Tabs active={section} onChange={setSection} tabs={[{ id: 'body', label: 'Response body' }, { id: 'headers', label: 'Response headers', count: draft.headers?.length }]} />
      <div className="flex-1 min-h-0">
        {section === 'body' && <CodeEditor value={draft.body ?? ''} onChange={(v) => set({ body: v })} lang={lang} readOnly={!editable} />}
        {section === 'headers' && <KVEditor items={draft.headers ?? []} onChange={(headers) => set({ headers })} readOnly={!editable} showDescription={false} />}
      </div>
      <div className="px-3 py-1.5 border-t divider text-[11px] faint">Mock servers serve this example for <span className="mono">{draft.request?.method} {draft.request?.url?.replace(/^.*?\/\/[^/]+/, '').replace(/^\{\{[^}]+\}\}/, '')}</span>. Path params like <span className="mono">:id</span> and <span className="mono">{'{{query.name}}'}</span> in the body are substituted from the incoming request. Select a specific example with the <span className="mono">x-mock-response-name</span> header.</div>
    </div>
  )
}
