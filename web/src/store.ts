import { create } from 'zustand'
import type { Tab, User, Workspace } from './lib/types'
import { uid } from './lib/utils'

interface State {
  user: User | null
  workspaces: Workspace[]
  workspaceId: string | null
  environmentId: string | null
  overlayEnvIds: string[]
  theme: 'light' | 'dark'
  tabs: Tab[]
  activeTab: string | null
  sidebarTab: string
  sidebarWidth: number
  setUser: (u: User | null, w?: Workspace[]) => void
  setWorkspace: (id: string) => void
  setEnvironment: (id: string | null) => void
  setOverlays: (ids: string[]) => void
  toggleTheme: () => void
  openTab: (t: Omit<Tab, 'id'> & { id?: string }) => string
  closeTab: (id: string) => void
  closeOthers: (id: string) => void
  updateTab: (id: string, patch: Partial<Tab>) => void
  setActive: (id: string) => void
  setSidebarTab: (t: string) => void
  setSidebarWidth: (w: number) => void
}

const persisted = (() => { try { return JSON.parse(localStorage.getItem('quiver.ui') || '{}') } catch { return {} } })()
const theme: 'light' | 'dark' = persisted.theme || (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
document.documentElement.classList.toggle('dark', theme === 'dark')

export const useStore = create<State>((set, get) => ({
  user: null,
  workspaces: [],
  workspaceId: persisted.workspaceId ?? null,
  environmentId: persisted.environmentId ?? null,
  overlayEnvIds: persisted.overlayEnvIds ?? [],
  theme,
  tabs: persisted.tabs ?? [],
  activeTab: persisted.activeTab ?? null,
  sidebarTab: persisted.sidebarTab ?? 'collections',
  sidebarWidth: persisted.sidebarWidth ?? 280,
  setUser: (user, workspaces) => set({ user, workspaces: workspaces ?? get().workspaces }),
  setWorkspace: (id) => { if (id !== get().workspaceId) set({ workspaceId: id, tabs: [], activeTab: null, environmentId: null, overlayEnvIds: [] }) },
  setEnvironment: (id) => set({ environmentId: id }),
  setOverlays: (ids) => set({ overlayEnvIds: ids }),
  toggleTheme: () => { const t = get().theme === 'dark' ? 'light' : 'dark'; document.documentElement.classList.toggle('dark', t === 'dark'); set({ theme: t }) },
  openTab: (t) => {
    const tabs = get().tabs
    const existing = t.entityId ? tabs.find((x) => x.type === t.type && x.entityId === t.entityId) : t.id ? tabs.find((x) => x.id === t.id) : undefined
    if (existing) { set({ activeTab: existing.id }); return existing.id }
    const id = t.id ?? uid()
    set({ tabs: [...tabs, { ...t, id }], activeTab: id })
    return id
  },
  closeTab: (id) => {
    const tabs = get().tabs
    const idx = tabs.findIndex((t) => t.id === id)
    const next = tabs.filter((t) => t.id !== id)
    let active = get().activeTab
    if (active === id) active = next[Math.min(idx, next.length - 1)]?.id ?? null
    set({ tabs: next, activeTab: active })
  },
  closeOthers: (id) => set({ tabs: get().tabs.filter((t) => t.id === id), activeTab: id }),
  updateTab: (id, patch) => set({ tabs: get().tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) }),
  setActive: (id) => set({ activeTab: id }),
  setSidebarTab: (t) => set({ sidebarTab: t }),
  setSidebarWidth: (w) => set({ sidebarWidth: Math.max(200, Math.min(600, w)) }),
}))

useStore.subscribe((s) => {
  const { theme, workspaceId, environmentId, overlayEnvIds, tabs, activeTab, sidebarTab, sidebarWidth } = s
  // drafts can be large (binary bodies); cap persisted size
  const slim = tabs.map((t) => ({ ...t, draft: t.draft && JSON.stringify(t.draft).length < 200_000 ? t.draft : undefined, dirty: t.draft && JSON.stringify(t.draft).length < 200_000 ? t.dirty : false }))
  try { localStorage.setItem('quiver.ui', JSON.stringify({ theme, workspaceId, environmentId, overlayEnvIds, tabs: slim, activeTab, sidebarTab, sidebarWidth })) } catch {}
})

export const useWorkspace = () => useStore((s) => s.workspaces.find((w) => w.id === s.workspaceId) ?? null)
export const canEdit = (ws: Workspace | null, user: User | null) => !!ws && (user?.role === 'admin' || ws.role === 'admin' || ws.role === 'editor')
