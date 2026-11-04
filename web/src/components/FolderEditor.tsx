import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Save, Play } from 'lucide-react'
import { api } from '@/lib/api'
import { useStore, useWorkspace, canEdit } from '@/store'
import type { Tab } from '@/lib/types'
import { Tabs, toast } from '@/components/ui'
import { cx } from '@/lib/utils'
import CodeEditor from '@/components/CodeEditor'
import AuthEditor from '@/components/request/AuthEditor'
import HelpButton from '@/components/HelpButton'

export default function FolderEditor({ tab }: { tab: Tab }) {
  const { updateTab, openTab } = useStore()
  const ws = useWorkspace(); const user = useStore((s) => s.user); const editable = canEdit(ws, user)
  const qc = useQueryClient()
  const f = useQuery({ queryKey: ['folder', tab.entityId], queryFn: () => api.get(`/folders/${tab.entityId}`) })
  const [draft, setDraft] = useState<any>(null)
  const [section, setSection] = useState('overview')
  const [which, setWhich] = useState<'pre' | 'test'>('pre')
  useEffect(() => { if (f.data && !draft) setDraft({ name: f.data.name, description: f.data.description, auth: f.data.auth, preRequestScript: f.data.pre_request_script, testScript: f.data.test_script }) }, [f.data]) // eslint-disable-line
  const dirty = !!draft && !!f.data && JSON.stringify(draft) !== JSON.stringify({ name: f.data.name, description: f.data.description, auth: f.data.auth, preRequestScript: f.data.pre_request_script, testScript: f.data.test_script })
  useEffect(() => { updateTab(tab.id, { dirty, title: draft?.name ?? tab.title }) }, [dirty, draft?.name]) // eslint-disable-line
  const save = async () => { await api.patch(`/folders/${tab.entityId}`, draft); qc.invalidateQueries({ queryKey: ['folder', tab.entityId] }); qc.invalidateQueries({ queryKey: ['tree'] }); toast('Saved') }
  if (!draft || !f.data) return null
  const set = (p: any) => setDraft((d: any) => ({ ...d, ...p }))
  const key = which === 'pre' ? 'preRequestScript' : 'testScript'
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 h-10 border-b divider shrink-0"><span className="faint text-[11px]">Folder</span><input className="input-ghost font-medium max-w-xs" value={draft.name} readOnly={!editable} onChange={(e) => set({ name: e.target.value })} /><div className="flex-1" /><button className="btn" onClick={() => openTab({ type: 'runner', entityId: f.data.collection_id, title: `Run: ${draft.name}`, meta: { folderId: tab.entityId } })}><Play size={12} /> Run folder</button><HelpButton topic={section === 'auth' ? 'auth' : section === 'scripts' ? 'scripts' : 'collections'} />{editable && <button className={cx('btn', dirty && 'btn-primary')} disabled={!dirty} onClick={save}><Save size={12} /> Save</button>}</div>
      <Tabs active={section} onChange={setSection} tabs={[{ id: 'overview', label: 'Overview' }, { id: 'auth', label: 'Auth' }, { id: 'scripts', label: 'Scripts' }]} />
      <div className="flex-1 min-h-0">
        {section === 'overview' && <CodeEditor value={draft.description ?? ''} onChange={(v) => set({ description: v })} readOnly={!editable} wrap placeholder="Folder description (Markdown)" />}
        {section === 'auth' && <AuthEditor auth={draft.auth} onChange={(auth) => set({ auth })} readOnly={!editable} />}
        {section === 'scripts' && <div className="flex h-full"><div className="w-40 border-r divider p-1 shrink-0"><div className={cx('row', which === 'pre' && 'active')} onClick={() => setWhich('pre')}>Pre-request</div><div className={cx('row', which === 'test' && 'active')} onClick={() => setWhich('test')}>Post-response</div></div><div className="flex-1 min-w-0"><CodeEditor value={draft[key] ?? ''} onChange={(v) => set({ [key]: v })} lang="javascript" readOnly={!editable} /></div></div>}
      </div>
    </div>
  )
}
