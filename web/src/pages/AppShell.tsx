import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Routes, Route, useNavigate } from 'react-router-dom'
import { ChevronDown, Moon, Sun, Plus, Search, Settings, LogOut, User as UserIcon, Shield, Layers, Globe, X, HelpCircle, BookOpen, LayoutGrid } from 'lucide-react'
import { openHelp, topicForActiveTab } from '@/lib/help'
import { api } from '@/lib/api'
import { useStore, useWorkspace } from '@/store'
import { cx } from '@/lib/utils'
import { Dropdown, Modal, Field, useResizable } from '@/components/ui'
import Sidebar from '@/components/sidebar/Sidebar'
import TabContent from '@/components/TabContent'
import CommandPalette from '@/components/CommandPalette'
import { Logo } from './Login'
import type { Tab } from '@/lib/types'

export default function AppShell() {
  const { user, workspaces, workspaceId, setWorkspace, setUser, theme, toggleTheme, tabs, activeTab, setActive, closeTab, environmentId, setEnvironment, overlayEnvIds, setOverlays, sidebarWidth, setSidebarWidth } = useStore()
  const ws = useWorkspace()
  const nav = useNavigate()
  const [newWs, setNewWs] = useState(false)
  const [wsName, setWsName] = useState('')
  const [palette, setPalette] = useState(false)
  const [envOpen, setEnvOpen] = useState(false)
  const openTab = useStore((s) => s.openTab)

  useEffect(() => { if (!workspaceId || !workspaces.find((w) => w.id === workspaceId)) { if (workspaces[0]) setWorkspace(workspaces[0].id) } }, [workspaceId, workspaces, setWorkspace])
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p) }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n' && !e.shiftKey) { e.preventDefault(); openTab({ type: 'request', title: 'Untitled Request', draft: null, dirty: false }) }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'w') { e.preventDefault(); if (activeTab) closeTab(activeTab) }
      if (e.key === 'F1') { e.preventDefault(); openHelp(topicForActiveTab()) }
    }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [openTab, activeTab, closeTab])

  const envs = useQuery({ queryKey: ['environments', workspaceId], queryFn: () => api.get(`/workspaces/${workspaceId}/environments`), enabled: !!workspaceId })
  const envList = useMemo(() => (envs.data ?? []).filter((e: any) => !e.is_global), [envs.data])
  const activeEnv = envList.find((e: any) => e.id === environmentId)
  const resize = useResizable(sidebarWidth, 'x', 200, 600)
  useEffect(() => { setSidebarWidth(resize.size) }, [resize.size, setSidebarWidth])

  const logout = async () => { await api.post('/auth/logout'); setUser(null, []); nav('/login') }
  const createWs = async () => { const w = await api.post('/workspaces', { name: wsName }); const me = await api.get('/auth/me'); setUser(me.user, me.workspaces); setWorkspace(w.id); setNewWs(false); setWsName('') }

  if (!workspaceId) return null
  return (
    <div className="h-full flex flex-col">
      <header className="h-10 flex items-center gap-2 px-2 border-b divider shrink-0" style={{ background: 'var(--bg2)' }}>
        <Logo size={22} />
        <Dropdown trigger={<button className="btn btn-ghost font-semibold">{ws?.name ?? 'Workspace'} <ChevronDown size={12} /></button>} items={[
          ...workspaces.map((w) => ({ label: <span className="flex items-center gap-2">{w.type === 'personal' ? <UserIcon size={12} /> : <Layers size={12} />}{w.name}<span className="faint ml-auto text-[10px]">{w.role}</span></span>, onClick: () => setWorkspace(w.id) })),
          'sep',
          { label: <span className="flex items-center gap-2"><Plus size={12} /> New team workspace</span>, onClick: () => setNewWs(true) },
          { label: <span className="flex items-center gap-2"><Settings size={12} /> Workspace settings</span>, onClick: () => openTab({ type: 'settings', entityId: 'workspace', title: 'Workspace settings' }) },
        ]} />
        <button className="btn btn-ghost muted gap-2 ml-2" onClick={() => setPalette(true)}><Search size={13} /> Search <kbd>Ctrl K</kbd></button>
        <div className="flex-1" />
        <div className="relative">
          <button className="btn" onClick={() => setEnvOpen((o) => !o)}><Globe size={12} /> {activeEnv ? activeEnv.name : 'No environment'}{overlayEnvIds.length ? <span className="badge" style={{ background: 'var(--sel)' }}>+{overlayEnvIds.length}</span> : null} <ChevronDown size={12} /></button>
          {envOpen && (
            <div className="absolute right-0 mt-1 w-72 panel border rounded shadow-lg z-40 p-2" style={{ background: 'var(--bg)' }} onMouseLeave={() => setEnvOpen(false)}>
              <div className="text-[11px] faint px-1 mb-1">Active environment</div>
              <div className={cx('row', !environmentId && 'active')} onClick={() => { setEnvironment(null); setEnvOpen(false) }}>No environment</div>
              {envList.map((e: any) => <div key={e.id} className={cx('row', environmentId === e.id && 'active')} onClick={() => { setEnvironment(e.id); setOverlays(overlayEnvIds.filter((x) => x !== e.id)); setEnvOpen(false) }}><span className="flex-1 truncate">{e.name}</span><span className="faint text-[10px]">{e.variables.length} vars</span></div>)}
              {envList.length > 1 && <>
                <div className="text-[11px] faint px-1 mt-2 mb-1">Layer on top (later wins)</div>
                {envList.filter((e: any) => e.id !== environmentId).map((e: any) => <label key={e.id} className="row"><input type="checkbox" checked={overlayEnvIds.includes(e.id)} onChange={(ev) => setOverlays(ev.target.checked ? [...overlayEnvIds, e.id] : overlayEnvIds.filter((x) => x !== e.id))} /> <span className="flex-1 truncate">{e.name}</span></label>)}
              </>}
              <div className="border-t divider mt-2 pt-2 flex gap-1">
                <button className="btn btn-sm flex-1" onClick={() => { openTab({ type: 'environment', entityId: 'new', title: 'New environment' }); setEnvOpen(false) }}><Plus size={11} /> New</button>
                {activeEnv && <button className="btn btn-sm flex-1" onClick={() => { openTab({ type: 'environment', entityId: activeEnv.id, title: activeEnv.name }); setEnvOpen(false) }}>Edit</button>}
                <button className="btn btn-sm flex-1" onClick={() => { const g = (envs.data ?? []).find((e: any) => e.is_global); if (g) openTab({ type: 'environment', entityId: g.id, title: 'Globals' }); setEnvOpen(false) }}>Globals</button>
              </div>
            </div>
          )}
        </div>
        <Dropdown align="right" trigger={<button className="btn btn-ghost" title="Help (F1)"><HelpCircle size={14} /></button>} items={[
          { label: <span className="flex items-center gap-2"><BookOpen size={12} /> Getting started guide</span>, onClick: () => openHelp('guide') },
          { label: <span className="flex items-center gap-2"><LayoutGrid size={12} /> All features</span>, onClick: () => openHelp('features') },
          { label: <span className="flex items-center gap-2"><HelpCircle size={12} /> Help for this screen <span className="faint ml-auto">F1</span></span>, onClick: () => openHelp(topicForActiveTab()) },
          'sep',
          { label: <span className="flex items-center gap-2"><Settings size={12} /> Keyboard shortcuts</span>, onClick: () => openHelp('shortcuts') },
        ]} />
        <button className="btn btn-ghost" onClick={toggleTheme} title="Toggle theme">{theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}</button>
        <Dropdown align="right" trigger={<button className="btn btn-ghost"><span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white" style={{ background: 'var(--accent)' }}>{user?.name?.[0]?.toUpperCase()}</span><ChevronDown size={12} /></button>} items={[
          { label: <span className="muted">{user?.email}</span>, disabled: true },
          'sep',
          { label: <span className="flex items-center gap-2"><UserIcon size={12} /> Account & API tokens</span>, onClick: () => openTab({ type: 'settings', entityId: 'account', title: 'Account' }) },
          ...(user?.role === 'admin' ? [{ label: <span className="flex items-center gap-2"><Shield size={12} /> Instance admin</span>, onClick: () => openTab({ type: 'settings', entityId: 'admin', title: 'Admin' }) }] : []),
          'sep',
          { label: <span className="flex items-center gap-2"><LogOut size={12} /> Sign out</span>, onClick: logout },
        ]} />
      </header>
      <div className="flex-1 flex min-h-0">
        <aside className="shrink-0 border-r divider flex flex-col min-h-0" style={{ width: resize.size, background: 'var(--bg2)' }}><Sidebar /></aside>
        <div className="resizer-v shrink-0" onMouseDown={resize.onMouseDown} />
        <main className="flex-1 flex flex-col min-w-0 min-h-0">
          <TabBar tabs={tabs} active={activeTab} onSelect={setActive} onClose={closeTab} />
          <div className="flex-1 min-h-0 relative">
            {tabs.length === 0 ? <Welcome /> : tabs.map((t) => <div key={t.id} className={cx('absolute inset-0 flex flex-col', t.id !== activeTab && 'hidden')}>{t.id === activeTab || t.type === 'ws' || t.type === 'runner' ? <TabContent tab={t} /> : null}</div>)}
          </div>
        </main>
      </div>
      <Modal open={newWs} onClose={() => setNewWs(false)} title="New team workspace" footer={<><button className="btn" onClick={() => setNewWs(false)}>Cancel</button><button className="btn btn-primary" disabled={!wsName.trim()} onClick={createWs}>Create</button></>}>
        <Field label="Name"><input className="input" value={wsName} onChange={(e) => setWsName(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && wsName.trim() && createWs()} /></Field>
        <div className="text-xs faint">Team workspaces are shared. Invite members from workspace settings.</div>
      </Modal>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
      <Routes><Route path="*" element={null} /></Routes>
    </div>
  )
}

function TabBar({ tabs, active, onSelect, onClose }: { tabs: Tab[]; active: string | null; onSelect: (id: string) => void; onClose: (id: string) => void }) {
  const openTab = useStore((s) => s.openTab)
  const closeOthers = useStore((s) => s.closeOthers)
  if (!tabs.length) return null
  return (
    <div className="h-9 flex items-end border-b divider shrink-0 overflow-x-auto" style={{ background: 'var(--bg2)' }}>
      {tabs.map((t) => (
        <div key={t.id} className={cx('group flex items-center gap-1.5 h-9 px-3 text-xs border-r divider cursor-pointer select-none max-w-[220px] shrink-0', t.id === active ? 'bg-[var(--bg)] border-t-2 border-t-[var(--accent)]' : 'hover:bg-[var(--bg3)] muted')} onClick={() => onSelect(t.id)} onAuxClick={(e) => { if (e.button === 1) onClose(t.id) }} onContextMenu={(e) => { e.preventDefault(); closeOthers(t.id) }} title={t.title}>
          {t.meta?.method && <span className={cx('method !w-auto', 'm-' + t.meta.method)}>{t.meta.method}</span>}
          <span className="truncate">{t.title}</span>
          {t.dirty && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--warn)' }} />}
          <button className="opacity-0 group-hover:opacity-100 hover:bg-[var(--bg3)] rounded p-0.5 shrink-0" onClick={(e) => { e.stopPropagation(); onClose(t.id) }}><X size={12} /></button>
        </div>
      ))}
      <button className="h-9 px-2 muted hover:text-[var(--fg)]" onClick={() => openTab({ type: 'request', title: 'Untitled Request', draft: null, dirty: false })} title="New request (Ctrl+N)"><Plus size={14} /></button>
    </div>
  )
}

function Welcome() {
  const openTab = useStore((s) => s.openTab)
  const setSidebarTab = useStore((s) => s.setSidebarTab)
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 text-center p-8">
      <Logo size={48} />
      <div className="text-lg font-semibold">Quiver</div>
      <div className="text-xs muted max-w-md">Build, test, mock, monitor and document APIs — all on your own infrastructure.</div>
      <div className="flex gap-2 mt-2 flex-wrap justify-center">
        <button className="btn btn-primary" onClick={() => openTab({ type: 'request', title: 'Untitled Request', draft: null, dirty: false })}>New request</button>
        <button className="btn" onClick={() => { setSidebarTab('collections'); window.dispatchEvent(new CustomEvent('quiver:import')) }}>Import</button>
        <button className="btn" onClick={() => openTab({ type: 'ws', title: 'WebSocket', id: 'ws-' + Date.now() })}>WebSocket</button>
      </div>
      <div className="flex gap-2 flex-wrap justify-center">
        <button className="btn btn-ghost link" onClick={() => openHelp('guide')}><BookOpen size={13} /> Getting started guide</button>
        <button className="btn btn-ghost link" onClick={() => openHelp('features')}><LayoutGrid size={13} /> Explore features</button>
      </div>
      <div className="text-[11px] faint mt-4 flex gap-4"><span><kbd>Ctrl K</kbd> search</span><span><kbd>Ctrl N</kbd> new request</span><span><kbd>Ctrl Enter</kbd> send</span><span><kbd>Ctrl S</kbd> save</span><span><kbd>F1</kbd> help</span></div>
    </div>
  )
}
