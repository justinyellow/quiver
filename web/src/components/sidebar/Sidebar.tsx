import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderTree, Globe, History, Server, Activity, Play, Plus, Upload, MoreHorizontal, ChevronRight, ChevronDown, Folder, FolderOpen, FileText, Trash2, Copy, Edit3, Download, SortAsc, GitFork, Cookie, Radio } from 'lucide-react'
import { api } from '@/lib/api'
import { useStore, useWorkspace, canEdit } from '@/store'
import { cx, timeAgo, statusClass, fmtMs } from '@/lib/utils'
import { Dropdown, Modal, Field, Confirm, toast } from '@/components/ui'
import ImportDialog from '@/components/ImportDialog'
import HelpButton from '@/components/HelpButton'
import type { TreeData } from '@/lib/types'

const SECTIONS = [
  { id: 'collections', icon: FolderTree, label: 'Collections' },
  { id: 'environments', icon: Globe, label: 'Environments' },
  { id: 'history', icon: History, label: 'History' },
  { id: 'mocks', icon: Server, label: 'Mock servers' },
  { id: 'monitors', icon: Activity, label: 'Monitors' },
  { id: 'runs', icon: Play, label: 'Runs' },
]

export default function Sidebar() {
  const { sidebarTab, setSidebarTab } = useStore()
  return (
    <div className="flex h-full min-h-0">
      <div className="w-11 border-r divider flex flex-col items-center py-1 gap-0.5 shrink-0">
        {SECTIONS.map((s) => <button key={s.id} title={s.label} className={cx('w-9 h-9 rounded flex items-center justify-center', sidebarTab === s.id ? 'bg-[var(--sel)] text-[var(--accent)]' : 'muted hover:bg-[var(--bg3)]')} onClick={() => setSidebarTab(s.id)}><s.icon size={16} /></button>)}
      </div>
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {sidebarTab === 'collections' && <Collections />}
        {sidebarTab === 'environments' && <Environments />}
        {sidebarTab === 'history' && <HistoryList />}
        {sidebarTab === 'mocks' && <Mocks />}
        {sidebarTab === 'monitors' && <Monitors />}
        {sidebarTab === 'runs' && <Runs />}
      </div>
    </div>
  )
}

const SECTION_HELP: Record<string, string> = { Collections: 'collections', Environments: 'variables', History: 'history-cookies', 'Mock servers': 'mocks', Monitors: 'monitors', Runs: 'runner' }
function Header({ title, children }: { title: string; children?: React.ReactNode }) {
  return <div className="h-9 flex items-center px-3 gap-1 border-b divider shrink-0"><div className="text-xs font-semibold flex-1">{title}</div>{children}{SECTION_HELP[title] && <HelpButton topic={SECTION_HELP[title]} />}</div>
}

// ---------------- Collections tree ----------------
export function useTree() {
  const wsId = useStore((s) => s.workspaceId)
  return useQuery<TreeData>({ queryKey: ['tree', wsId], queryFn: () => api.get(`/workspaces/${wsId}/tree`), enabled: !!wsId })
}

function Collections() {
  const wsId = useStore((s) => s.workspaceId)!
  const ws = useWorkspace(); const user = useStore((s) => s.user)
  const editable = canEdit(ws, user)
  const tree = useTree()
  const qc = useQueryClient()
  const openTab = useStore((s) => s.openTab)
  const [filter, setFilter] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [newCol, setNewCol] = useState(false)
  const [colName, setColName] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem('quiver.expanded') || '{}') } catch { return {} } })
  useEffect(() => { localStorage.setItem('quiver.expanded', JSON.stringify(expanded)) }, [expanded])
  useEffect(() => { const h = () => setImportOpen(true); window.addEventListener('quiver:import', h); return () => window.removeEventListener('quiver:import', h) }, [])
  const toggle = (id: string) => setExpanded((e) => ({ ...e, [id]: !e[id] }))
  const refresh = () => qc.invalidateQueries({ queryKey: ['tree', wsId] })
  const create = async () => { const c = await api.post(`/workspaces/${wsId}/collections`, { name: colName }); setNewCol(false); setColName(''); refresh(); openTab({ type: 'collection', entityId: c.id, title: c.name }) }
  const data = tree.data
  const f = filter.toLowerCase()
  const matches = (name: string, url?: string) => !f || name.toLowerCase().includes(f) || (url ?? '').toLowerCase().includes(f)

  return (
    <>
      <Header title="Collections">
        {editable && <button className="btn btn-ghost btn-sm" title="New collection" onClick={() => setNewCol(true)}><Plus size={14} /></button>}
        {editable && <button className="btn btn-ghost btn-sm" title="Import" onClick={() => setImportOpen(true)}><Upload size={14} /></button>}
      </Header>
      <div className="px-2 py-1.5 border-b divider"><input className="input h-6" placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
      <div className="flex-1 overflow-auto py-1">
        {data?.collections.length === 0 && <div className="p-4 text-xs faint text-center">No collections yet.<br />Create one or import from Postman, OpenAPI, cURL, HAR, Insomnia or Bruno.</div>}
        {data?.collections.map((c) => <CollectionNode key={c.id} col={c} data={data} expanded={expanded} toggle={toggle} editable={editable} refresh={refresh} matches={matches} filter={!!f} />)}
      </div>
      <Modal open={newCol} onClose={() => setNewCol(false)} title="New collection" footer={<><button className="btn" onClick={() => setNewCol(false)}>Cancel</button><button className="btn btn-primary" disabled={!colName.trim()} onClick={create}>Create</button></>}>
        <Field label="Name"><input className="input" value={colName} onChange={(e) => setColName(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && colName.trim() && create()} /></Field>
      </Modal>
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </>
  )
}

function CollectionNode({ col, data, expanded, toggle, editable, refresh, matches, filter }: any) {
  const openTab = useStore((s) => s.openTab)
  const closeTab = useStore((s) => s.closeTab); const tabs = useStore((s) => s.tabs)
  const wsId = useStore((s) => s.workspaceId)!
  const [del, setDel] = useState(false)
  const [rename, setRename] = useState<string | null>(null)
  const [newFolder, setNewFolder] = useState<{ parentId: string | null } | null>(null)
  const [name, setName] = useState('')
  const open = filter || expanded[col.id]
  const childFolders = data.folders.filter((f: any) => f.collection_id === col.id && !f.parent_id)
  const childReqs = data.requests.filter((r: any) => r.collection_id === col.id && !r.folder_id)
  const hasMatch = (fid: string | null): boolean => data.requests.some((r: any) => r.collection_id === col.id && (fid === null ? true : inFolder(r.folder_id, fid)) && matches(r.name, r.url))
  const inFolder = (folderId: string | null, target: string): boolean => { let cur = folderId; let g = 0; while (cur && g++ < 50) { if (cur === target) return true; cur = data.folders.find((f: any) => f.id === cur)?.parent_id ?? null } return false }
  if (filter && !matches(col.name) && !hasMatch(null)) return null
  const addRequest = async (folderId: string | null) => { const r = await api.post(`/collections/${col.id}/requests`, { name: 'New Request', folderId, method: 'GET', url: '' }); refresh(); openTab({ type: 'request', entityId: r.id, title: r.name, meta: { method: 'GET' } }) }
  const createFolder = async () => { await api.post(`/collections/${col.id}/folders`, { name, parentId: newFolder?.parentId ?? null }); setNewFolder(null); setName(''); refresh() }
  const doRename = async () => { await api.patch(`/collections/${col.id}`, { name }); setRename(null); refresh(); const t = tabs.find((x) => x.type === 'collection' && x.entityId === col.id); if (t) useStore.getState().updateTab(t.id, { title: name }) }
  const remove = async () => { await api.del(`/collections/${col.id}`); refresh(); tabs.filter((t) => (t.type === 'collection' && t.entityId === col.id) || (t.type === 'request' && data.requests.some((r: any) => r.id === t.entityId && r.collection_id === col.id))).forEach((t) => closeTab(t.id)); toast('Collection deleted') }
  const exportCol = async (format: string) => { const r = await fetch(`/api/collections/${col.id}/export?format=${format}`); const blob = await r.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (r.headers.get('content-disposition')?.match(/filename="(.+)"/)?.[1]) || 'export.json'; a.click() }
  const menu = (folderId: string | null, folder?: any) => [
    ...(editable ? [
      { label: <span className="flex items-center gap-2"><Plus size={12} /> Add request</span>, onClick: () => addRequest(folderId) },
      { label: <span className="flex items-center gap-2"><Folder size={12} /> Add folder</span>, onClick: () => { setName(''); setNewFolder({ parentId: folderId }) } },
      'sep' as const,
    ] : []),
    ...(folder ? [
      { label: <span className="flex items-center gap-2"><Edit3 size={12} /> Edit folder</span>, onClick: () => openTab({ type: 'folder', entityId: folder.id, title: folder.name }) },
      ...(editable ? [{ label: <span className="flex items-center gap-2"><Trash2 size={12} /> Delete folder</span>, danger: true, onClick: async () => { if (confirm(`Delete folder "${folder.name}" and its contents?`)) { await api.del(`/folders/${folder.id}`); refresh() } } }] : []),
    ] : [
      { label: <span className="flex items-center gap-2"><Play size={12} /> Run collection</span>, onClick: () => openTab({ type: 'runner', entityId: col.id, title: `Run: ${col.name}` }) },
      { label: <span className="flex items-center gap-2"><Edit3 size={12} /> Edit / docs / settings</span>, onClick: () => openTab({ type: 'collection', entityId: col.id, title: col.name }) },
      ...(editable ? [
        { label: <span className="flex items-center gap-2"><Edit3 size={12} /> Rename</span>, onClick: () => { setName(col.name); setRename(col.name) } },
        { label: <span className="flex items-center gap-2"><SortAsc size={12} /> Sort A→Z (recursive)</span>, onClick: async () => { await api.post(`/collections/${col.id}/sort`, { by: 'name', recursive: true }); refresh() } },
        { label: <span className="flex items-center gap-2"><Copy size={12} /> Duplicate</span>, onClick: async () => { await api.post(`/collections/${col.id}/duplicate`, {}); refresh() } },
        { label: <span className="flex items-center gap-2"><GitFork size={12} /> Fork</span>, onClick: async () => { await api.post(`/collections/${col.id}/duplicate`, { fork: true }); refresh() } },
      ] : []),
      'sep' as const,
      { label: <span className="flex items-center gap-2"><Download size={12} /> Export (Postman v2.1)</span>, onClick: () => exportCol('postman') },
      { label: <span className="flex items-center gap-2"><Download size={12} /> Export (OpenAPI 3)</span>, onClick: () => exportCol('openapi') },
      'sep' as const,
      ...(editable ? [{ label: <span className="flex items-center gap-2"><Trash2 size={12} /> Delete</span>, danger: true, onClick: () => setDel(true) }] : []),
    ]),
  ]
  return (
    <div>
      <div className="row group pl-1" onClick={() => toggle(col.id)} onDoubleClick={() => openTab({ type: 'collection', entityId: col.id, title: col.name })}>
        {open ? <ChevronDown size={12} className="faint shrink-0" /> : <ChevronRight size={12} className="faint shrink-0" />}
        <span className="truncate flex-1 font-medium">{col.name}</span>
        {col.forked_from && <GitFork size={10} className="faint" />}
        <span onClick={(e) => e.stopPropagation()}><Dropdown align="right" trigger={<button className="opacity-0 group-hover:opacity-100 btn btn-ghost btn-sm !h-5 !px-1"><MoreHorizontal size={12} /></button>} items={menu(null)} /></span>
      </div>
      {open && (
        <div>
          {childFolders.map((f: any) => <FolderNode key={f.id} folder={f} col={col} data={data} depth={1} expanded={expanded} toggle={toggle} menu={menu} matches={matches} filter={filter} editable={editable} refresh={refresh} />)}
          {childReqs.filter((r: any) => matches(r.name, r.url)).map((r: any) => <RequestNode key={r.id} req={r} depth={1} data={data} editable={editable} refresh={refresh} />)}
          {!childFolders.length && !childReqs.length && <div className="text-[11px] faint pl-7 py-1">Empty collection</div>}
        </div>
      )}
      <Confirm open={del} onClose={() => setDel(false)} onConfirm={remove} title={`Delete "${col.name}"?`} message="All folders, requests and examples will be deleted. Mocks and monitors using it will be removed." danger />
      <Modal open={!!newFolder} onClose={() => setNewFolder(null)} title="New folder" footer={<><button className="btn" onClick={() => setNewFolder(null)}>Cancel</button><button className="btn btn-primary" disabled={!name.trim()} onClick={createFolder}>Create</button></>}><Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && name.trim() && createFolder()} /></Field></Modal>
      <Modal open={rename !== null} onClose={() => setRename(null)} title="Rename collection" footer={<><button className="btn" onClick={() => setRename(null)}>Cancel</button><button className="btn btn-primary" disabled={!name.trim()} onClick={doRename}>Rename</button></>}><Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && name.trim() && doRename()} /></Field></Modal>
    </div>
  )
}

function FolderNode({ folder, col, data, depth, expanded, toggle, menu, matches, filter, editable, refresh }: any) {
  const openTab = useStore((s) => s.openTab)
  const open = filter || expanded[folder.id]
  const sub = data.folders.filter((f: any) => f.parent_id === folder.id)
  const reqs = data.requests.filter((r: any) => r.folder_id === folder.id)
  const visibleReqs = reqs.filter((r: any) => matches(r.name, r.url))
  const anyMatch = (fid: string): boolean => data.requests.filter((r: any) => r.folder_id === fid).some((r: any) => matches(r.name, r.url)) || data.folders.filter((f: any) => f.parent_id === fid).some((f: any) => anyMatch(f.id))
  if (filter && !matches(folder.name) && !anyMatch(folder.id)) return null
  return (
    <div>
      <div className="row group" style={{ paddingLeft: 4 + depth * 12 }} onClick={() => toggle(folder.id)} onDoubleClick={(e) => { e.stopPropagation(); openTab({ type: 'folder', entityId: folder.id, title: folder.name }) }} onDragOver={(e) => { e.preventDefault() }} onDrop={async (e) => { e.preventDefault(); const id = e.dataTransfer.getData('request'); if (id && editable) { await api.patch(`/requests/${id}`, { folderId: folder.id, collectionId: col.id }); refresh() } }}>
        {open ? <FolderOpen size={13} className="shrink-0" style={{ color: 'var(--warn)' }} /> : <Folder size={13} className="shrink-0" style={{ color: 'var(--warn)' }} />}
        <span className="truncate flex-1">{folder.name}</span>
        <span onClick={(e) => e.stopPropagation()}><Dropdown align="right" trigger={<button className="opacity-0 group-hover:opacity-100 btn btn-ghost btn-sm !h-5 !px-1"><MoreHorizontal size={12} /></button>} items={menu(folder.id, folder)} /></span>
      </div>
      {open && <div>
        {sub.map((f: any) => <FolderNode key={f.id} folder={f} col={col} data={data} depth={depth + 1} expanded={expanded} toggle={toggle} menu={menu} matches={matches} filter={filter} editable={editable} refresh={refresh} />)}
        {visibleReqs.map((r: any) => <RequestNode key={r.id} req={r} depth={depth + 1} data={data} editable={editable} refresh={refresh} />)}
      </div>}
    </div>
  )
}

function RequestNode({ req, depth, data, editable, refresh }: any) {
  const openTab = useStore((s) => s.openTab); const tabs = useStore((s) => s.tabs); const activeTab = useStore((s) => s.activeTab); const closeTab = useStore((s) => s.closeTab)
  const active = tabs.find((t) => t.id === activeTab)
  const isActive = active?.type === 'request' && active.entityId === req.id
  const examples = data.examples.filter((e: any) => e.request_id === req.id)
  const [showEx, setShowEx] = useState(false)
  return (
    <div>
      <div className={cx('row group', isActive && 'active')} style={{ paddingLeft: 4 + depth * 12 }} draggable={editable} onDragStart={(e) => e.dataTransfer.setData('request', req.id)} onClick={() => openTab({ type: 'request', entityId: req.id, title: req.name, meta: { method: req.method } })}>
        {examples.length ? <button className="faint -ml-1" onClick={(e) => { e.stopPropagation(); setShowEx((s) => !s) }}>{showEx ? <ChevronDown size={10} /> : <ChevronRight size={10} />}</button> : null}
        <span className={cx('method', 'm-' + req.method)}>{req.method === 'DELETE' ? 'DEL' : req.method === 'OPTIONS' ? 'OPT' : req.method}</span>
        <span className="truncate flex-1">{req.name}</span>
        {editable && <span onClick={(e) => e.stopPropagation()}><Dropdown align="right" trigger={<button className="opacity-0 group-hover:opacity-100 btn btn-ghost btn-sm !h-5 !px-1"><MoreHorizontal size={12} /></button>} items={[
          { label: <span className="flex items-center gap-2"><Copy size={12} /> Duplicate</span>, onClick: async () => { await api.post(`/requests/${req.id}/duplicate`); refresh() } },
          { label: <span className="flex items-center gap-2"><Trash2 size={12} /> Delete</span>, danger: true, onClick: async () => { if (confirm(`Delete request "${req.name}"?`)) { await api.del(`/requests/${req.id}`); refresh(); tabs.filter((t) => t.type === 'request' && t.entityId === req.id).forEach((t) => closeTab(t.id)) } } },
        ]} /></span>}
      </div>
      {showEx && examples.map((e: any) => <div key={e.id} className="row" style={{ paddingLeft: 4 + (depth + 1) * 12 }} onClick={() => openTab({ type: 'example', entityId: e.id, title: e.name, meta: { requestId: req.id } })}><FileText size={11} className="faint" /><span className="truncate flex-1 muted">{e.name}</span><span className={cx('text-[10px]', statusClass(e.status))}>{e.status}</span></div>)}
    </div>
  )
}

// ---------------- Environments ----------------
function Environments() {
  const wsId = useStore((s) => s.workspaceId)!
  const ws = useWorkspace(); const user = useStore((s) => s.user); const editable = canEdit(ws, user)
  const openTab = useStore((s) => s.openTab)
  const { environmentId, setEnvironment } = useStore()
  const envs = useQuery({ queryKey: ['environments', wsId], queryFn: () => api.get(`/workspaces/${wsId}/environments`) })
  const globals = (envs.data ?? []).find((e: any) => e.is_global)
  return (
    <>
      <Header title="Environments">{editable && <button className="btn btn-ghost btn-sm" onClick={() => openTab({ type: 'environment', entityId: 'new', title: 'New environment' })}><Plus size={14} /></button>}</Header>
      <div className="flex-1 overflow-auto py-1">
        {globals && <div className="row" onClick={() => openTab({ type: 'environment', entityId: globals.id, title: 'Globals' })}><Globe size={12} className="faint" /><span className="flex-1">Globals</span><span className="faint text-[10px]">{globals.variables.length}</span></div>}
        <div className="row" onClick={() => openTab({ type: 'cookies', title: 'Cookies', id: 'cookies' })}><Cookie size={12} className="faint" /><span className="flex-1">Cookie jar</span></div>
        <div className="border-t divider my-1" />
        {(envs.data ?? []).filter((e: any) => !e.is_global).map((e: any) => (
          <div key={e.id} className={cx('row group', environmentId === e.id && 'active')} onClick={() => openTab({ type: 'environment', entityId: e.id, title: e.name })}>
            <span className={cx('w-2 h-2 rounded-full shrink-0', environmentId === e.id ? 'bg-[var(--ok)]' : 'bg-[var(--border)]')} onClick={(ev) => { ev.stopPropagation(); setEnvironment(environmentId === e.id ? null : e.id) }} title="Set active" />
            <span className="flex-1 truncate">{e.name}</span><span className="faint text-[10px]">{e.variables.length}</span>
          </div>
        ))}
        {(envs.data ?? []).length <= 1 && <div className="p-4 text-xs faint text-center">No environments. Store base URLs, tokens and secrets per environment.</div>}
      </div>
    </>
  )
}

// ---------------- History ----------------
function HistoryList() {
  const wsId = useStore((s) => s.workspaceId)!
  const openTab = useStore((s) => s.openTab)
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const h = useQuery({ queryKey: ['history', wsId, q], queryFn: () => api.get(`/workspaces/${wsId}/history?limit=200${q ? '&q=' + encodeURIComponent(q) : ''}`), refetchInterval: 10000 })
  const groups: Record<string, any[]> = {}
  for (const it of h.data ?? []) { const d = new Date(it.created_at); const key = d.toDateString() === new Date().toDateString() ? 'Today' : d.toLocaleDateString(); (groups[key] ??= []).push(it) }
  return (
    <>
      <Header title="History"><button className="btn btn-ghost btn-sm" title="Clear history" onClick={async () => { if (confirm('Clear your history in this workspace?')) { await api.del(`/workspaces/${wsId}/history`); qc.invalidateQueries({ queryKey: ['history'] }) } }}><Trash2 size={13} /></button></Header>
      <div className="px-2 py-1.5 border-b divider"><input className="input h-6" placeholder="Filter by URL" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="flex-1 overflow-auto py-1">
        {Object.entries(groups).map(([day, items]) => <div key={day}><div className="text-[10px] faint uppercase px-3 pt-2 pb-1">{day}</div>{items.map((it) => (
          <div key={it.id} className="row" onClick={() => openTab({ type: 'history', entityId: it.id, title: it.url.replace(/^https?:\/\//, '').slice(0, 40), meta: { method: it.method } })} title={it.url}>
            <span className={cx('method', 'm-' + it.method)}>{it.method}</span><span className="truncate flex-1 text-[11px]">{it.url.replace(/^https?:\/\//, '')}</span><span className={cx('text-[10px]', statusClass(it.status))}>{it.status ?? 'ERR'}</span>
          </div>))}</div>)}
        {!h.data?.length && <div className="p-4 text-xs faint text-center">Requests you send appear here.</div>}
      </div>
    </>
  )
}

// ---------------- Mocks ----------------
function Mocks() {
  const wsId = useStore((s) => s.workspaceId)!
  const ws = useWorkspace(); const user = useStore((s) => s.user); const editable = canEdit(ws, user)
  const openTab = useStore((s) => s.openTab)
  const m = useQuery({ queryKey: ['mocks', wsId], queryFn: () => api.get(`/workspaces/${wsId}/mocks`) })
  return (
    <>
      <Header title="Mock servers">{editable && <button className="btn btn-ghost btn-sm" onClick={() => openTab({ type: 'mock', entityId: 'new', title: 'New mock server' })}><Plus size={14} /></button>}</Header>
      <div className="flex-1 overflow-auto py-1">
        {(m.data ?? []).map((x: any) => <div key={x.id} className="row" onClick={() => openTab({ type: 'mock', entityId: x.id, title: x.name })}><Server size={12} className={x.enabled ? 'text-[var(--ok)]' : 'faint'} /><span className="flex-1 truncate">{x.name}</span><span className="faint text-[10px]">{x.call_count} calls</span></div>)}
        {!m.data?.length && <div className="p-4 text-xs faint text-center">Mock servers serve the saved examples of a collection at a stable URL.</div>}
      </div>
    </>
  )
}

// ---------------- Monitors ----------------
function Monitors() {
  const wsId = useStore((s) => s.workspaceId)!
  const ws = useWorkspace(); const user = useStore((s) => s.user); const editable = canEdit(ws, user)
  const openTab = useStore((s) => s.openTab)
  const m = useQuery({ queryKey: ['monitors', wsId], queryFn: () => api.get(`/workspaces/${wsId}/monitors`), refetchInterval: 30000 })
  return (
    <>
      <Header title="Monitors">{editable && <button className="btn btn-ghost btn-sm" onClick={() => openTab({ type: 'monitor', entityId: 'new', title: 'New monitor' })}><Plus size={14} /></button>}</Header>
      <div className="flex-1 overflow-auto py-1">
        {(m.data ?? []).map((x: any) => <div key={x.id} className="row" onClick={() => openTab({ type: 'monitor', entityId: x.id, title: x.name })}><Radio size={12} className={!x.enabled ? 'faint' : x.last_status === 'passed' ? 'text-[var(--ok)]' : x.last_status ? 'text-[var(--err)]' : 'faint'} /><span className="flex-1 truncate">{x.name}</span><span className="faint text-[10px]">{x.last_run_at ? timeAgo(x.last_run_at) : 'never'}</span></div>)}
        {!m.data?.length && <div className="p-4 text-xs faint text-center">Monitors run a collection on a schedule and alert on failures.</div>}
      </div>
    </>
  )
}

// ---------------- Runs ----------------
function Runs() {
  const wsId = useStore((s) => s.workspaceId)!
  const openTab = useStore((s) => s.openTab)
  const r = useQuery({ queryKey: ['runs', wsId], queryFn: () => api.get(`/workspaces/${wsId}/runs?limit=100`), refetchInterval: 10000 })
  return (
    <>
      <Header title="Runs" />
      <div className="flex-1 overflow-auto py-1">
        {(r.data ?? []).map((x: any) => <div key={x.id} className="row" onClick={() => openTab({ type: x.source === 'perf' ? 'perf' : 'run', entityId: x.id, title: `${x.source === 'perf' ? 'Perf' : 'Run'}: ${x.collection_name}` })}>
          <span className={cx('w-2 h-2 rounded-full shrink-0', x.status === 'passed' ? 'bg-[var(--ok)]' : x.status === 'running' ? 'bg-[var(--info)]' : x.status === 'cancelled' ? 'bg-[var(--fg3)]' : 'bg-[var(--err)]')} />
          <span className="flex-1 truncate">{x.collection_name}</span><span className="faint text-[10px]">{x.source}</span><span className="faint text-[10px]">{timeAgo(x.started_at)}</span>
        </div>)}
        {!r.data?.length && <div className="p-4 text-xs faint text-center">Collection runs, monitor runs and performance tests appear here.</div>}
      </div>
    </>
  )
}
void fmtMs
