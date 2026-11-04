import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useStore } from '@/store'
import { cx } from '@/lib/utils'
import { Modal } from '@/components/ui'
import { TOPICS, openHelp } from '@/lib/help'

export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const wsId = useStore((s) => s.workspaceId)
  const openTab = useStore((s) => s.openTab)
  const [q, setQ] = useState('')
  const [res, setRes] = useState<any>(null)
  const [idx, setIdx] = useState(0)
  useEffect(() => { if (!open) { setQ(''); setRes(null); setIdx(0) } }, [open])
  useEffect(() => {
    if (!q.trim() || !wsId) { setRes(null); return }
    const t = setTimeout(() => api.get(`/workspaces/${wsId}/search?q=${encodeURIComponent(q)}`).then(setRes), 150)
    return () => clearTimeout(t)
  }, [q, wsId])
  const actions = [
    { label: 'New request', run: () => openTab({ type: 'request', title: 'Untitled Request', draft: null, dirty: false }) },
    { label: 'New WebSocket connection', run: () => openTab({ type: 'ws', title: 'WebSocket', id: 'ws-' + Date.now() }) },
    { label: 'Import collection / spec / cURL', run: () => window.dispatchEvent(new CustomEvent('quiver:import')) },
    { label: 'Workspace settings', run: () => openTab({ type: 'settings', entityId: 'workspace', title: 'Workspace settings' }) },
    { label: 'Account & API tokens', run: () => openTab({ type: 'settings', entityId: 'account', title: 'Account' }) },
    { label: 'Toggle theme', run: () => useStore.getState().toggleTheme() },
    { label: 'Help: Getting started guide', run: () => openHelp('guide') },
    { label: 'Help: All features', run: () => openHelp('features') },
    ...TOPICS.map((t) => ({ label: `Help: ${t.title}`, run: () => openHelp(t.id) })),
  ].filter((a) => (q.trim() ? a.label.toLowerCase().includes(q.toLowerCase()) : !a.label.startsWith('Help: ') || a.label === 'Help: Getting started guide'))
  const items: { label: React.ReactNode; run: () => void }[] = [
    ...(res?.requests ?? []).map((r: any) => ({ label: <span className="flex items-center gap-2"><span className={cx('method', 'm-' + r.method)}>{r.method}</span><span className="flex-1 truncate">{r.name}</span><span className="faint text-[10px] truncate max-w-[200px]">{r.collection_name}</span></span>, run: () => openTab({ type: 'request', entityId: r.id, title: r.name, meta: { method: r.method } }) })),
    ...(res?.collections ?? []).map((c: any) => ({ label: <span className="flex items-center gap-2"><span className="badge" style={{ background: 'var(--bg3)' }}>COL</span>{c.name}</span>, run: () => openTab({ type: 'collection', entityId: c.id, title: c.name }) })),
    ...(res?.folders ?? []).map((f: any) => ({ label: <span className="flex items-center gap-2"><span className="badge" style={{ background: 'var(--bg3)' }}>DIR</span>{f.name}</span>, run: () => openTab({ type: 'folder', entityId: f.id, title: f.name }) })),
    ...(res?.environments ?? []).map((e: any) => ({ label: <span className="flex items-center gap-2"><span className="badge" style={{ background: 'var(--bg3)' }}>ENV</span>{e.name}</span>, run: () => openTab({ type: 'environment', entityId: e.id, title: e.name }) })),
    ...actions.map((a) => ({ label: <span className="flex items-center gap-2"><span className="badge" style={{ background: 'var(--sel)' }}>CMD</span>{a.label}</span>, run: a.run })),
  ]
  const go = (i: number) => { items[i]?.run(); onClose() }
  return (
    <Modal open={open} onClose={onClose} width="max-w-xl">
      <input className="input h-9 text-sm" placeholder="Search requests, collections, environments… or type a command" value={q} onChange={(e) => { setQ(e.target.value); setIdx(0) }} autoFocus onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(items.length - 1, i + 1)) } if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)) } if (e.key === 'Enter') go(idx) }} />
      <div className="mt-2 max-h-[50vh] overflow-auto">
        {items.map((it, i) => <div key={i} className={cx('row', i === idx && 'active')} onMouseEnter={() => setIdx(i)} onClick={() => go(i)}>{it.label}</div>)}
        {!items.length && <div className="text-xs faint p-3 text-center">No results</div>}
      </div>
    </Modal>
  )
}
