import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Save, Play, Download, GitFork, Globe, Copy, History, MessageSquare, Server, Activity } from 'lucide-react'
import { api } from '@/lib/api'
import { useStore, useWorkspace, canEdit } from '@/store'
import type { Tab, Variable } from '@/lib/types'
import { Tabs, toast, Toggle, Field } from '@/components/ui'
import { cx, copy } from '@/lib/utils'
import CodeEditor from '@/components/CodeEditor'
import AuthEditor from '@/components/request/AuthEditor'
import RevisionsPanel from '@/components/RevisionsPanel'
import CommentsPanel from '@/components/CommentsPanel'
import DocsView from '@/components/DocsView'
import HelpButton from '@/components/HelpButton'

export default function CollectionEditor({ tab }: { tab: Tab }) {
  const { updateTab, openTab, workspaceId } = useStore()
  const ws = useWorkspace(); const user = useStore((s) => s.user); const editable = canEdit(ws, user)
  const qc = useQueryClient()
  const col = useQuery({ queryKey: ['collection', tab.entityId], queryFn: () => api.get(`/collections/${tab.entityId}`) })
  const [section, setSection] = useState('overview')
  const [draft, setDraft] = useState<any>(null)
  const [side, setSide] = useState<'none' | 'history' | 'comments'>('none')
  useEffect(() => { if (col.data && !draft) setDraft({ name: col.data.name, description: col.data.description, auth: col.data.auth, variables: col.data.variables, preRequestScript: col.data.pre_request_script, testScript: col.data.test_script }) }, [col.data]) // eslint-disable-line
  const dirty = !!draft && !!col.data && JSON.stringify(draft) !== JSON.stringify({ name: col.data.name, description: col.data.description, auth: col.data.auth, variables: col.data.variables, preRequestScript: col.data.pre_request_script, testScript: col.data.test_script })
  useEffect(() => { updateTab(tab.id, { dirty, title: draft?.name ?? tab.title }) }, [dirty, draft?.name]) // eslint-disable-line
  const save = async () => { try { await api.patch(`/collections/${tab.entityId}`, draft); qc.invalidateQueries({ queryKey: ['collection', tab.entityId] }); qc.invalidateQueries({ queryKey: ['tree'] }); toast('Saved') } catch (e: any) { toast(e.message, 'err') } }
  useEffect(() => { const h = (e: KeyboardEvent) => { if (useStore.getState().activeTab === tab.id && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save() } }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h) }) // eslint-disable-line
  const set = (p: any) => setDraft((d: any) => ({ ...d, ...p }))
  const exportAs = async (format: string) => { const r = await fetch(`/api/collections/${tab.entityId}/export?format=${format}`); const blob = await r.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = r.headers.get('content-disposition')?.match(/filename="(.+)"/)?.[1] || 'export.json'; a.click() }
  if (!draft || !col.data) return null
  const docUrl = col.data.doc_slug ? `${location.origin}/docs/${col.data.doc_slug}` : null
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 h-10 border-b divider shrink-0">
        <input className="input-ghost font-medium max-w-xs" value={draft.name} readOnly={!editable} onChange={(e) => set({ name: e.target.value })} />
        {col.data.forked_from && <span className="badge" style={{ background: 'var(--sel)' }}><GitFork size={9} /> fork</span>}
        <div className="flex-1" />
        <button className="btn" onClick={() => openTab({ type: 'runner', entityId: tab.entityId, title: `Run: ${draft.name}` })}><Play size={12} /> Run</button>
        <button className="btn" onClick={() => openTab({ type: 'mock', entityId: 'new', title: 'New mock server', meta: { collectionId: tab.entityId } })} title="Create mock server"><Server size={12} /></button>
        <button className="btn" onClick={() => openTab({ type: 'monitor', entityId: 'new', title: 'New monitor', meta: { collectionId: tab.entityId } })} title="Create monitor"><Activity size={12} /></button>
        <button className={cx('btn btn-ghost', side === 'comments' && 'bg-[var(--bg3)]')} onClick={() => setSide(side === 'comments' ? 'none' : 'comments')}><MessageSquare size={13} /></button>
        <button className={cx('btn btn-ghost', side === 'history' && 'bg-[var(--bg3)]')} onClick={() => setSide(side === 'history' ? 'none' : 'history')}><History size={13} /></button>
        <HelpButton topic={({ overview: 'collections', auth: 'auth', scripts: 'scripts', variables: 'variables', docs: 'docs', share: 'import-export', fork: 'collaboration' } as Record<string, string>)[section] ?? 'collections'} />
        {editable && <button className={cx('btn', dirty && 'btn-primary')} disabled={!dirty} onClick={save}><Save size={12} /> Save</button>}
      </div>
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0 flex flex-col">
          <Tabs active={section} onChange={setSection} tabs={[{ id: 'overview', label: 'Overview' }, { id: 'auth', label: 'Auth' }, { id: 'scripts', label: 'Scripts' }, { id: 'variables', label: 'Variables', count: draft.variables?.length }, { id: 'docs', label: 'Documentation' }, { id: 'share', label: 'Export & publish' }, ...(col.data.forked_from ? [{ id: 'fork', label: 'Fork changes' }] : [])]} />
          <div className="flex-1 min-h-0 overflow-hidden">
            {section === 'overview' && <div className="h-full flex flex-col"><div className="text-[11px] faint px-3 h-6 flex items-center border-b divider">Description (Markdown) — shown at the top of the generated documentation</div><div className="flex-1 min-h-0"><CodeEditor value={draft.description ?? ''} onChange={(v) => set({ description: v })} readOnly={!editable} wrap placeholder="# My API\n\nDescribe what this collection covers…" /></div></div>}
            {section === 'auth' && <AuthEditor auth={draft.auth} onChange={(auth) => set({ auth })} readOnly={!editable} allowInherit={false} />}
            {section === 'scripts' && <CollectionScripts draft={draft} set={set} readOnly={!editable} />}
            {section === 'variables' && <VariablesTable vars={draft.variables ?? []} onChange={(variables) => set({ variables })} readOnly={!editable} />}
            {section === 'docs' && <DocsView collectionId={tab.entityId!} />}
            {section === 'share' && (
              <div className="p-4 space-y-5 max-w-2xl text-xs">
                <div>
                  <div className="font-semibold mb-2">Export</div>
                  <div className="flex gap-2 flex-wrap"><button className="btn" onClick={() => exportAs('postman')}><Download size={12} /> Postman v2.1</button><button className="btn" onClick={() => exportAs('openapi')}><Download size={12} /> OpenAPI 3.0</button><button className="btn" onClick={() => exportAs('quiver')}><Download size={12} /> Quiver JSON</button><button className="btn" onClick={async () => { const r = await api.get(`/collections/${tab.entityId}/export?format=files`); const { downloadZip } = await import('@/lib/zip'); downloadZip(`${draft.name}.zip`, r.files) }}><Download size={12} /> Plain-text folder (git-friendly YAML)</button></div>
                  <div className="faint mt-2">The plain-text export writes one YAML file per request, suitable for committing to a repo and reviewing in pull requests. Re-import it as a Quiver export at any time.</div>
                </div>
                <div>
                  <div className="font-semibold mb-2">Public documentation</div>
                  <Toggle checked={!!col.data.doc_public} onChange={async (v) => { if (!editable) return; await api.patch(`/collections/${tab.entityId}`, { docPublic: v }); qc.invalidateQueries({ queryKey: ['collection', tab.entityId] }) }} label="Publish documentation at a public link (no login required)" />
                  {col.data.doc_public && docUrl && <div className="mt-2 flex items-center gap-2"><input className="input mono flex-1" readOnly value={docUrl} /><button className="btn" onClick={async () => { await copy(docUrl); toast('Copied') }}><Copy size={12} /></button><a className="btn" href={docUrl} target="_blank" rel="noreferrer"><Globe size={12} /> Open</a></div>}
                  <div className="faint mt-2">Public docs never include scripts, auth values or secret variables. Headers that look like credentials are masked.</div>
                </div>
                <div>
                  <div className="font-semibold mb-2">Fork / copy</div>
                  <div className="flex gap-2"><button className="btn" disabled={!editable} onClick={async () => { await api.post(`/collections/${tab.entityId}/duplicate`, { fork: true }); qc.invalidateQueries({ queryKey: ['tree'] }); toast('Forked') }}><GitFork size={12} /> Fork in this workspace</button><button className="btn" disabled={!editable} onClick={async () => { await api.post(`/collections/${tab.entityId}/duplicate`, {}); qc.invalidateQueries({ queryKey: ['tree'] }); toast('Duplicated') }}><Copy size={12} /> Duplicate</button></div>
                  <div className="faint mt-2">A fork remembers its source. Compare and merge changes back from the fork's "Fork changes" tab.</div>
                </div>
              </div>
            )}
            {section === 'fork' && <ForkDiff id={tab.entityId!} sourceId={col.data.forked_from} editable={editable} />}
          </div>
        </div>
        {side !== 'none' && <div className="w-80 border-l divider shrink-0 flex flex-col min-h-0">{side === 'history' ? <RevisionsPanel type="collection" id={tab.entityId!} onRestored={() => { qc.invalidateQueries({ queryKey: ['collection', tab.entityId] }); setDraft(null) }} onClose={() => setSide('none')} /> : <CommentsPanel type="collection" id={tab.entityId!} onClose={() => setSide('none')} />}</div>}
      </div>
      {workspaceId && null}
    </div>
  )
}

function CollectionScripts({ draft, set, readOnly }: any) {
  const [which, setWhich] = useState<'pre' | 'test'>('pre')
  const key = which === 'pre' ? 'preRequestScript' : 'testScript'
  return (
    <div className="flex h-full">
      <div className="w-40 border-r divider shrink-0 p-1"><div className={cx('row', which === 'pre' && 'active')} onClick={() => setWhich('pre')}>Pre-request</div><div className={cx('row', which === 'test' && 'active')} onClick={() => setWhich('test')}>Post-response</div><div className="text-[11px] faint p-2">Runs before/after every request in this collection, before the request's own scripts.</div></div>
      <div className="flex-1 min-w-0"><CodeEditor value={draft[key] ?? ''} onChange={(v) => set({ [key]: v })} lang="javascript" readOnly={readOnly} placeholder={which === 'pre' ? '// e.g. add a default header to every request\npm.request.headers.upsert({ key: "X-Client", value: "quiver" });' : '// e.g. assert every response is fast\npm.test("fast", () => pm.expect(pm.response.responseTime).to.be.below(2000));'} /></div>
    </div>
  )
}

export function VariablesTable({ vars, onChange, readOnly }: { vars: Variable[]; onChange: (v: Variable[]) => void; readOnly?: boolean }) {
  const rows = [...vars, { key: '', value: '', enabled: true, __new: true } as any]
  const update = (i: number, p: Partial<Variable>) => { const n = [...vars]; if (i >= n.length) n.push({ key: '', value: '', enabled: true, ...p }); else n[i] = { ...n[i], ...p }; onChange(n) }
  return (
    <div className="h-full flex flex-col">
      <div className="text-[11px] faint px-3 h-6 flex items-center border-b divider">Collection variables apply to every request in the collection. Environment variables with the same name take precedence.</div>
      <div className="flex-1 overflow-auto"><table className="kv-table w-full text-xs"><thead><tr className="faint text-[10px] uppercase"><th className="w-7"></th><th className="text-left px-2 h-6 font-medium">Variable</th><th className="text-left px-2 font-medium">Value</th><th className="w-10"></th></tr></thead><tbody>
        {rows.map((r, i) => <tr key={i} className={cx((r as any).__new && 'opacity-60 focus-within:opacity-100')}><td className="text-center">{!(r as any).__new && <input type="checkbox" checked={r.enabled !== false} disabled={readOnly} onChange={(e) => update(i, { enabled: e.target.checked })} />}</td><td><input className="mono" value={r.key} placeholder="name" readOnly={readOnly} onChange={(e) => update(i, { key: e.target.value })} /></td><td><input className="mono" value={r.value} placeholder="value" readOnly={readOnly} onChange={(e) => update(i, { value: e.target.value })} /></td><td className="text-right pr-1">{!(r as any).__new && !readOnly && <button className="btn btn-ghost btn-sm !px-1" onClick={() => onChange(vars.filter((_, j) => j !== i))}>×</button>}</td></tr>)}
      </tbody></table></div>
    </div>
  )
}

function ForkDiff({ id, sourceId, editable }: { id: string; sourceId: string; editable: boolean }) {
  const qc = useQueryClient()
  const diff = useQuery({ queryKey: ['diff', id, sourceId], queryFn: () => api.get(`/collections/${id}/diff/${sourceId}`) })
  const [sel, setSel] = useState<string[]>([])
  if (!diff.data) return null
  const d = diff.data
  return (
    <div className="p-4 text-xs overflow-auto h-full">
      <div className="mb-3 muted">Comparing this fork with its source <b>{d.b.name}</b>. {d.changes.length} change(s).</div>
      {d.changes.map((c: any) => (
        <label key={c.path} className="flex items-start gap-2 py-1.5 border-b divider cursor-pointer">
          <input type="checkbox" checked={sel.includes(c.path)} onChange={(e) => setSel(e.target.checked ? [...sel, c.path] : sel.filter((p) => p !== c.path))} disabled={c.type === 'removed'} />
          <span className={cx('badge', c.type === 'added' ? 'bg-[var(--ok)]' : c.type === 'removed' ? 'bg-[var(--err)]' : 'bg-[var(--info)]')} style={{ color: '#fff' }}>{c.type}</span>
          <span className="mono flex-1">{c.path}</span>
          {c.fields && <span className="faint">{c.fields.join(', ')}</span>}
        </label>
      ))}
      {!d.changes.length && <div className="faint">No differences.</div>}
      {editable && d.changes.length > 0 && <div className="mt-3 flex gap-2"><button className="btn btn-primary" disabled={!sel.length} onClick={async () => { const r = await api.post(`/collections/${sourceId}/merge-from/${id}`, { paths: sel }); toast(`Merged into source: ${r.updated} updated, ${r.added} added`); qc.invalidateQueries({ queryKey: ['diff', id, sourceId] }); qc.invalidateQueries({ queryKey: ['tree'] }); setSel([]) }}>Merge selected into {d.b.name}</button><button className="btn" onClick={async () => { const r = await api.post(`/collections/${id}/merge-from/${sourceId}`, {}); toast(`Pulled from source: ${r.updated} updated, ${r.added} added`); qc.invalidateQueries({ queryKey: ['diff', id, sourceId] }); qc.invalidateQueries({ queryKey: ['tree'] }) }}>Pull all changes from source</button></div>}
    </div>
  )
}
void Field
