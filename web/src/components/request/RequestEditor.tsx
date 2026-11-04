import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Save, Send, Code2, MoreHorizontal, History, MessageSquare, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import { useStore, useWorkspace, canEdit } from '@/store'
import { cx, parseQuery, uid } from '@/lib/utils'
import { METHODS, emptyRequest, type ExecResult, type KV, type RequestDef, type Tab } from '@/lib/types'
import { Tabs, Modal, Field, toast, Dropdown, useResizable, Toggle } from '@/components/ui'
import CodeEditor from '@/components/CodeEditor'
import KVEditor from './KVEditor'
import AuthEditor from './AuthEditor'
import BodyEditor from './BodyEditor'
import ResponsePanel from './ResponsePanel'
import CodeSnippet from './CodeSnippet'
import { useTree } from '@/components/sidebar/Sidebar'
import RevisionsPanel from '@/components/RevisionsPanel'
import CommentsPanel from '@/components/CommentsPanel'
import HelpButton from '@/components/HelpButton'

const SNIPPETS = {
  pre: [
    ['Set a variable', `pm.environment.set("token", "value");`],
    ['Timestamp header', `pm.request.headers.add({ key: "X-Timestamp", value: String(Date.now()) });`],
    ['HMAC signature', `const CryptoJS = require("crypto-js");\nconst sig = CryptoJS.HmacSHA256(pm.request.url.toString(), pm.environment.get("secret")).toString(CryptoJS.enc.Hex);\npm.request.headers.add({ key: "X-Signature", value: sig });`],
    ['Fetch a token first', `pm.sendRequest({ url: pm.environment.get("baseUrl") + "/auth", method: "POST", header: { "content-type": "application/json" }, body: { mode: "raw", raw: JSON.stringify({ user: "u", pass: "p" }) } }, (err, res) => {\n  if (!err) pm.environment.set("token", res.json().token);\n});`],
  ],
  test: [
    ['Status is 200', `pm.test("Status is 200", () => pm.response.to.have.status(200));`],
    ['Response time < 500ms', `pm.test("Fast", () => pm.expect(pm.response.responseTime).to.be.below(500));`],
    ['JSON body check', `pm.test("Body has id", () => {\n  const json = pm.response.json();\n  pm.expect(json).to.have.property("id");\n});`],
    ['JSON schema', `pm.test("Schema", () => pm.response.to.have.jsonSchema({\n  type: "object", required: ["id"], properties: { id: { type: "string" } }\n}));`],
    ['Save value for next request', `pm.environment.set("id", pm.response.json().id);`],
    ['Chain: run next request', `pm.execution.setNextRequest("Get item");`],
  ],
}

export default function RequestEditor({ tab }: { tab: Tab }) {
  const { workspaceId, environmentId, overlayEnvIds, updateTab } = useStore()
  const ws = useWorkspace(); const user = useStore((s) => s.user); const editable = canEdit(ws, user)
  const qc = useQueryClient()
  const tree = useTree()
  const saved = useQuery({ queryKey: ['request', tab.entityId], queryFn: () => api.get(`/requests/${tab.entityId}`), enabled: !!tab.entityId })
  const savedDef: RequestDef | null = useMemo(() => saved.data ? { id: saved.data.id, name: saved.data.name, description: saved.data.description, method: saved.data.method, url: saved.data.url, params: saved.data.params, headers: saved.data.headers, body: saved.data.body, auth: saved.data.auth, preRequestScript: saved.data.pre_request_script, testScript: saved.data.test_script, settings: saved.data.settings } : null, [saved.data])
  const [draft, setDraft] = useState<RequestDef>(() => tab.draft ?? savedDef ?? emptyRequest())
  const [section, setSection] = useState('params')
  const [result, setResult] = useState<ExecResult | null>(null)
  const [sending, setSending] = useState(false)
  const [snippet, setSnippet] = useState(false)
  const [prompt, setPrompt] = useState<{ vars: string[]; values: Record<string, string> } | null>(null)
  const [side, setSide] = useState<'none' | 'history' | 'comments'>('none')
  const [saveAs, setSaveAs] = useState(false)
  const [autosave, setAutosave] = useState(() => localStorage.getItem('quiver.autosave') === '1')
  const abortRef = useRef<AbortController | null>(null)
  const resize = useResizable(Math.round(window.innerHeight * 0.45), 'y', 120, 2000)
  const [layout, setLayout] = useState<'v' | 'h'>(() => (localStorage.getItem('quiver.layout') as any) || 'v')
  const hresize = useResizable(Math.round(window.innerWidth * 0.5), 'x', 300, 3000)

  useEffect(() => { if (savedDef && !tab.draft) setDraft(savedDef) }, [savedDef]) // eslint-disable-line
  const dirty = useMemo(() => !!savedDef && JSON.stringify(draft) !== JSON.stringify(savedDef), [draft, savedDef])
  useEffect(() => { updateTab(tab.id, { draft: dirty || !tab.entityId ? draft : undefined, dirty, title: draft.name, meta: { ...tab.meta, method: draft.method } }) }, [draft, dirty]) // eslint-disable-line
  const set = (p: Partial<RequestDef>) => setDraft((d) => ({ ...d, ...p }))

  const collectionId = saved.data?.collection_id ?? tab.meta?.collectionId
  const folderId = saved.data?.folder_id ?? tab.meta?.folderId
  const varNames = useVarNames(collectionId)

  // URL <-> params sync
  const onUrl = (url: string) => {
    const qs = parseQuery(url)
    const base = url.split('?')[0]
    const existing = draft.params.filter((p) => p.enabled !== false)
    const disabled = draft.params.filter((p) => p.enabled === false)
    const next: KV[] = qs.map((q, i) => ({ key: q.key, value: q.value, enabled: true, description: existing[i]?.description }))
    set({ url: next.length || existing.length ? base + (next.length ? '?' + next.map((p) => `${p.key}${p.value ? '=' + p.value : ''}`).join('&') : '') : url, params: [...next, ...disabled] })
  }
  const onParams = (params: KV[]) => {
    const base = draft.url.split('?')[0]
    const on = params.filter((p) => p.enabled !== false && p.key)
    set({ params, url: base + (on.length ? '?' + on.map((p) => `${p.key}${p.value ? '=' + p.value : ''}`).join('&') : '') })
  }

  const save = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!editable) return
    if (!tab.entityId) { setSaveAs(true); return }
    try {
      const r = await api.patch(`/requests/${tab.entityId}`, { name: draft.name, description: draft.description, method: draft.method, url: draft.url, params: draft.params, headers: draft.headers, body: draft.body, auth: draft.auth, preRequestScript: draft.preRequestScript, testScript: draft.testScript, settings: draft.settings })
      qc.setQueryData(['request', tab.entityId], (old: any) => ({ ...old, ...r }))
      qc.invalidateQueries({ queryKey: ['tree'] })
      if (!opts.silent) toast('Saved')
    } catch (e: any) { toast(e.message, 'err') }
  }, [draft, editable, tab.entityId, qc])
  useEffect(() => { if (!autosave || !dirty || !tab.entityId) return; const t = setTimeout(() => save({ silent: true }), 1500); return () => clearTimeout(t) }, [draft, autosave, dirty]) // eslint-disable-line

  const send = useCallback(async (localVariables?: Record<string, string>) => {
    if (sending) { abortRef.current?.abort(); return }
    setSending(true); setResult(null)
    const ctrl = new AbortController(); abortRef.current = ctrl
    const payload = { request: { ...draft, id: tab.entityId }, collectionId: collectionId ?? null, folderId: folderId ?? null, environmentId, overlayEnvironmentIds: overlayEnvIds, localVariables }
    try {
      if (!localVariables) {
        const r = await api.post(`/workspaces/${workspaceId}/resolve`, payload)
        if (r.unresolved.length) { setPrompt({ vars: r.unresolved, values: Object.fromEntries(r.unresolved.map((v: string) => [v, ''])) }); setSending(false); return }
      }
      if (draft.settings?.stream) {
        let partial = ''
        const base: ExecResult = { request: { method: draft.method, url: draft.url, headers: {} }, tests: [], console: [], scriptErrors: [], varMutations: {}, response: { status: 0, statusText: 'streaming…', headers: [], body: '', isBase64: false, contentType: 'text/event-stream', size: 0, timeMs: 0 } }
        setResult(base)
        await api.sse(`/workspaces/${workspaceId}/execute/stream`, payload, (ev, data) => {
          if (ev === 'chunk') { partial += data.text; setResult((r) => r ? { ...r, response: { ...r.response!, body: partial, size: partial.length } } : r) }
          else if (ev === 'done') setResult(data)
          else if (ev === 'error') setResult({ ...base, error: data.message })
        }, ctrl.signal)
      } else {
        const res = await fetch(`/api/workspaces/${workspaceId}/execute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: ctrl.signal })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Request failed')
        setResult(data)
        if (data.varMutations && Object.values(data.varMutations).some((m: any) => Object.keys(m).length)) { qc.invalidateQueries({ queryKey: ['environments'] }) }
      }
      qc.invalidateQueries({ queryKey: ['history'] })
    } catch (e: any) {
      if (e.name === 'AbortError') setResult({ request: { method: draft.method, url: draft.url, headers: {} }, error: 'Request cancelled', tests: [], console: [], scriptErrors: [], varMutations: {} })
      else setResult({ request: { method: draft.method, url: draft.url, headers: {} }, error: e.message, tests: [], console: [], scriptErrors: [], varMutations: {} })
    } finally { setSending(false); abortRef.current = null }
  }, [draft, sending, workspaceId, environmentId, overlayEnvIds, collectionId, folderId, tab.entityId, qc])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (useStore.getState().activeTab !== tab.id) return
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); send() }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save() }
    }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [send, save, tab.id])

  useEffect(() => {
    const h = async (e: any) => {
      if (useStore.getState().activeTab !== tab.id) return
      try {
        const r = await api.post('/import/parse-curl', { content: e.detail })
        setDraft((d) => ({ ...d, method: r.method ?? d.method, url: r.url ?? d.url, params: r.params ?? [], headers: r.headers ?? [], body: r.body ?? { mode: 'none' }, auth: r.auth && r.auth.type !== 'inherit' && r.auth.type !== 'none' ? r.auth : d.auth, settings: { ...d.settings, ...(r.settings ?? {}) } }))
        toast('Filled request from cURL')
      } catch (err: any) { toast(err.message, 'err') }
    }
    window.addEventListener('quiver:paste-curl', h)
    return () => window.removeEventListener('quiver:paste-curl', h)
  }, [tab.id])

  const saveAsExample = async () => {
    if (!tab.entityId || !result?.response) return
    const name = window.prompt('Example name', `${result.response.status} ${result.response.statusText}`.trim()); if (!name) return
    await api.post(`/requests/${tab.entityId}/examples`, { name, request: { method: result.request.method, url: draft.url, headers: Object.entries(result.request.headers).map(([key, value]) => ({ key, value })), body: draft.body }, status: result.response.status, statusText: result.response.statusText, headers: result.response.headers.filter(([k]) => !/^(content-encoding|transfer-encoding|content-length|connection)$/i.test(k)).map(([key, value]) => ({ key, value })), body: result.response.isBase64 ? '' : result.response.body })
    qc.invalidateQueries({ queryKey: ['tree'] }); qc.invalidateQueries({ queryKey: ['request', tab.entityId] }); toast('Example saved')
  }

  const counts = { params: draft.params.filter((p) => p.enabled !== false && p.key).length, headers: draft.headers.filter((p) => p.enabled !== false && p.key).length, body: draft.body.mode !== 'none' ? 1 : 0, scripts: (draft.preRequestScript?.trim() ? 1 : 0) + (draft.testScript?.trim() ? 1 : 0) }
  const breadcrumb = useMemo(() => {
    if (!tree.data || !collectionId) return null
    const col = tree.data.collections.find((c) => c.id === collectionId)
    const parts: string[] = []
    let f = folderId ? tree.data.folders.find((x) => x.id === folderId) : null
    let g = 0
    while (f && g++ < 20) { parts.unshift(f.name); f = f.parent_id ? tree.data.folders.find((x) => x.id === f.parent_id) : null }
    return [col?.name, ...parts].filter(Boolean).join(' / ')
  }, [tree.data, collectionId, folderId])

  const editorPane = (
    <div className="flex flex-col min-h-0 h-full">
      <Tabs active={section} onChange={setSection} right={<HelpButton topic={({ auth: 'auth', scripts: 'scripts', docs: 'docs', settings: draft.settings?.stream ? 'streaming' : 'requests' } as Record<string, string>)[section] ?? 'requests'} />} tabs={[{ id: 'params', label: 'Params', count: counts.params }, { id: 'auth', label: 'Auth' }, { id: 'headers', label: 'Headers', count: counts.headers }, { id: 'body', label: 'Body', count: counts.body }, { id: 'scripts', label: 'Scripts', count: counts.scripts }, { id: 'settings', label: 'Settings' }, { id: 'docs', label: 'Docs' }]} />
      <div className="flex-1 min-h-0 overflow-hidden">
        {section === 'params' && <div className="h-full flex flex-col"><div className="flex-1 min-h-0"><KVEditor items={draft.params} onChange={onParams} readOnly={!editable} placeholderKey="Key" /></div><div className="border-t divider px-3 py-1 text-[11px] faint">Path variables: write <span className="mono">/users/:userId</span> and define a variable named <span className="mono">userId</span>. Quiver asks for missing values when you send.</div></div>}
        {section === 'auth' && <AuthEditor auth={draft.auth} onChange={(auth) => set({ auth })} readOnly={!editable} />}
        {section === 'headers' && <KVEditor items={draft.headers} onChange={(headers) => set({ headers })} readOnly={!editable} placeholderKey="Header" />}
        {section === 'body' && <BodyEditor body={draft.body} onChange={(body) => set({ body })} readOnly={!editable} variables={varNames} />}
        {section === 'scripts' && <ScriptsEditor draft={draft} set={set} readOnly={!editable} variables={varNames} />}
        {section === 'settings' && <SettingsEditor draft={draft} set={set} readOnly={!editable} />}
        {section === 'docs' && <div className="h-full flex flex-col"><div className="text-[11px] faint px-3 h-6 flex items-center border-b divider">Markdown description — shown in generated docs</div><div className="flex-1 min-h-0"><CodeEditor value={draft.description ?? ''} onChange={(v) => set({ description: v })} readOnly={!editable} wrap placeholder="Describe this request…" /></div></div>}
      </div>
    </div>
  )
  const responsePane = <ResponsePanel result={result} sending={sending} onSaveExample={tab.entityId && editable ? saveAsExample : undefined} request={draft} />

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-3 h-9 border-b divider shrink-0">
        <div className="text-[11px] faint truncate">{breadcrumb ?? 'Unsaved request'}</div>
        <input className="input-ghost font-medium max-w-[280px]" value={draft.name} onChange={(e) => set({ name: e.target.value })} readOnly={!editable} />
        <div className="flex-1" />
        {editable && <Toggle checked={autosave} onChange={(v) => { setAutosave(v); localStorage.setItem('quiver.autosave', v ? '1' : '0') }} label={<span className="faint">Autosave</span>} />}
        <button className="btn btn-ghost" onClick={() => setSnippet(true)} title="Generate code"><Code2 size={13} /> Code</button>
        {tab.entityId && <>
          <button className={cx('btn btn-ghost', side === 'comments' && 'bg-[var(--bg3)]')} onClick={() => setSide(side === 'comments' ? 'none' : 'comments')} title="Comments"><MessageSquare size={13} /></button>
          <button className={cx('btn btn-ghost', side === 'history' && 'bg-[var(--bg3)]')} onClick={() => setSide(side === 'history' ? 'none' : 'history')} title="Version history"><History size={13} /></button>
        </>}
        {editable && <button className={cx('btn', dirty && 'btn-primary')} onClick={() => save()} disabled={!dirty && !!tab.entityId}><Save size={13} /> Save</button>}
        <Dropdown align="right" trigger={<button className="btn btn-ghost"><MoreHorizontal size={14} /></button>} items={[
          { label: 'Save as…', onClick: () => setSaveAs(true), disabled: !editable },
          { label: layout === 'v' ? 'Side-by-side layout' : 'Stacked layout', onClick: () => { const l = layout === 'v' ? 'h' : 'v'; setLayout(l); localStorage.setItem('quiver.layout', l) } },
          { label: 'Copy as cURL', onClick: () => setSnippet(true) },
          'sep',
          { label: 'Reset changes', onClick: () => savedDef && setDraft(savedDef), disabled: !dirty },
        ]} />
      </div>
      <div className="flex items-center gap-2 px-3 py-2 border-b divider shrink-0">
        <select className={cx('input !w-28 shrink-0 font-bold', 'm-' + draft.method)} value={draft.method} disabled={!editable} onChange={(e) => set({ method: e.target.value })}>{METHODS.map((m) => <option key={m} value={m}>{m}</option>)}{!METHODS.includes(draft.method) && <option value={draft.method}>{draft.method}</option>}</select>
        <UrlInput value={draft.url} onChange={onUrl} onEnter={() => send()} readOnly={!editable} variables={varNames} />
        <button className={cx('btn btn-primary h-7 px-4', sending && '!bg-[var(--err)] !border-[var(--err)]')} onClick={() => send()}>{sending ? <><Loader2 size={13} className="spin" /> Cancel</> : <><Send size={13} /> Send</>}</button>
      </div>
      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          {layout === 'v' ? (
            <>
              <div style={{ height: resize.size }} className="shrink-0 min-h-0 flex flex-col">{editorPane}</div>
              <div className="resizer-h shrink-0 border-t divider" onMouseDown={resize.onMouseDown} />
              <div className="flex-1 min-h-0 flex flex-col">{responsePane}</div>
            </>
          ) : (
            <div className="flex flex-1 min-h-0">
              <div style={{ width: hresize.size }} className="shrink-0 min-w-0 flex flex-col">{editorPane}</div>
              <div className="resizer-v shrink-0 border-l divider" onMouseDown={hresize.onMouseDown} />
              <div className="flex-1 min-w-0 flex flex-col">{responsePane}</div>
            </div>
          )}
        </div>
        {side !== 'none' && tab.entityId && <div className="w-80 border-l divider shrink-0 flex flex-col min-h-0">{side === 'history' ? <RevisionsPanel type="request" id={tab.entityId} onRestored={() => { qc.invalidateQueries({ queryKey: ['request', tab.entityId] }); updateTab(tab.id, { draft: undefined }) }} onClose={() => setSide('none')} /> : <CommentsPanel type="request" id={tab.entityId} onClose={() => setSide('none')} />}</div>}
      </div>
      <CodeSnippet open={snippet} onClose={() => setSnippet(false)} draft={draft} result={result} />
      <Modal open={!!prompt} onClose={() => setPrompt(null)} title="Unresolved variables" footer={<><button className="btn" onClick={() => { const p = prompt; setPrompt(null); send(p?.values ?? {}) }}>Send anyway</button><button className="btn btn-primary" onClick={() => { const p = prompt; setPrompt(null); send(p?.values) }}>Use values & send</button></>}>
        <div className="text-xs muted mb-3">These variables have no value in the selected environment, collection or globals. Enter values for this send only, or pick an environment first.</div>
        {prompt?.vars.map((v) => <Field key={v} label={v}><input className="input mono" value={prompt.values[v]} onChange={(e) => setPrompt({ ...prompt, values: { ...prompt.values, [v]: e.target.value } })} autoFocus={v === prompt.vars[0]} /></Field>)}
      </Modal>
      <SaveAsDialog open={saveAs} onClose={() => setSaveAs(false)} draft={draft} onSaved={(r) => { updateTab(tab.id, { entityId: r.id, draft: undefined, dirty: false, meta: { ...tab.meta, collectionId: r.collection_id, folderId: r.folder_id } }); qc.setQueryData(['request', r.id], r); qc.invalidateQueries({ queryKey: ['tree'] }) }} />
    </div>
  )
}

export function useVarNames(collectionId?: string | null) {
  const { workspaceId, environmentId } = useStore()
  const envs = useQuery({ queryKey: ['environments', workspaceId], queryFn: () => api.get(`/workspaces/${workspaceId}/environments`), enabled: !!workspaceId })
  const col = useQuery({ queryKey: ['collection', collectionId], queryFn: () => api.get(`/collections/${collectionId}`), enabled: !!collectionId })
  return useMemo(() => {
    const names = new Set<string>()
    for (const e of envs.data ?? []) if (e.is_global || e.id === environmentId) for (const v of e.variables) names.add(v.key)
    for (const v of col.data?.variables ?? []) names.add(v.key)
    return [...names]
  }, [envs.data, col.data, environmentId])
}

function UrlInput({ value, onChange, onEnter, readOnly, variables }: { value: string; onChange: (v: string) => void; onEnter: () => void; readOnly?: boolean; variables: string[] }) {
  const [focus, setFocus] = useState(false)
  const [sugg, setSugg] = useState<string[]>([])
  const ref = useRef<HTMLInputElement>(null)
  const update = (v: string) => {
    onChange(v)
    const m = v.slice(0, ref.current?.selectionStart ?? v.length).match(/\{\{([\w$.-]*)$/)
    setSugg(m ? variables.filter((x) => x.toLowerCase().startsWith(m[1].toLowerCase())).slice(0, 8) : [])
  }
  const apply = (name: string) => { const pos = ref.current?.selectionStart ?? value.length; const before = value.slice(0, pos).replace(/\{\{[\w$.-]*$/, '{{' + name + '}}'); onChange(before + value.slice(pos)); setSugg([]) }
  const highlighted = useMemo(() => value.split(/(\{\{[^}]*\}\})/g).map((part, i) => part.startsWith('{{') ? <span key={i} style={{ color: variables.includes(part.slice(2, -2).trim()) || part.startsWith('{{$') ? 'var(--ok)' : 'var(--err)' }}>{part}</span> : <span key={i}>{part}</span>), [value, variables])
  return (
    <div className="relative flex-1">
      {!focus && <div className="absolute inset-0 h-7 px-2 flex items-center text-xs mono whitespace-pre overflow-hidden pointer-events-none rounded border divider" style={{ background: 'var(--bg)' }}>{value ? highlighted : <span className="faint font-sans">Enter URL or paste a cURL command</span>}</div>}
      <input ref={ref} className={cx('input mono', !focus && 'opacity-0')} value={value} readOnly={readOnly} onFocus={() => setFocus(true)} onBlur={() => { setFocus(false); setTimeout(() => setSugg([]), 150) }} onChange={(e) => update(e.target.value)} onPaste={(e) => { const t = e.clipboardData.getData('text'); if (/^\s*curl\s/.test(t)) { e.preventDefault(); window.dispatchEvent(new CustomEvent('quiver:paste-curl', { detail: t })) } }} onKeyDown={(e) => { if (e.key === 'Enter') { if (sugg.length) apply(sugg[0]); else onEnter() } if (e.key === 'Escape') setSugg([]) }} spellCheck={false} />
      {sugg.length > 0 && <div className="absolute z-30 top-8 left-0 panel border rounded shadow-lg py-1 min-w-[200px]" style={{ background: 'var(--bg)' }}>{sugg.map((s) => <div key={s} className="row mono" onMouseDown={(e) => { e.preventDefault(); apply(s) }}>{s}</div>)}</div>}
    </div>
  )
}

function ScriptsEditor({ draft, set, readOnly, variables }: { draft: RequestDef; set: (p: Partial<RequestDef>) => void; readOnly?: boolean; variables: string[] }) {
  const [which, setWhich] = useState<'pre' | 'test'>('test')
  const value = which === 'pre' ? draft.preRequestScript ?? '' : draft.testScript ?? ''
  const key = which === 'pre' ? 'preRequestScript' : 'testScript'
  return (
    <div className="flex h-full">
      <div className="w-40 border-r divider shrink-0 flex flex-col">
        <div className={cx('row m-1', which === 'pre' && 'active')} onClick={() => setWhich('pre')}>Pre-request {draft.preRequestScript?.trim() && <span className="w-1.5 h-1.5 rounded-full ml-auto" style={{ background: 'var(--ok)' }} />}</div>
        <div className={cx('row m-1', which === 'test' && 'active')} onClick={() => setWhich('test')}>Post-response {draft.testScript?.trim() && <span className="w-1.5 h-1.5 rounded-full ml-auto" style={{ background: 'var(--ok)' }} />}</div>
        <div className="text-[10px] faint uppercase px-2 mt-3 mb-1">Snippets</div>
        <div className="overflow-auto">{SNIPPETS[which].map(([l, c]) => <div key={l} className="px-2 py-1 text-[11px] link cursor-pointer hover:bg-[var(--bg3)]" onClick={() => !readOnly && set({ [key]: (value ? value + '\n\n' : '') + c })}>{l}</div>)}</div>
      </div>
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="text-[11px] faint px-3 h-6 flex items-center border-b divider">JavaScript · <span className="mono ml-1">pm.*</span> API (Postman-compatible) · require: crypto-js, uuid, lodash, moment, chai, ajv, xml2js</div>
        <div className="flex-1 min-h-0"><CodeEditor value={value} onChange={(v) => set({ [key]: v })} lang="javascript" readOnly={readOnly} variables={variables} placeholder={which === 'pre' ? '// runs before the request is sent' : '// runs after the response arrives\npm.test("Status is 200", () => pm.response.to.have.status(200));'} /></div>
      </div>
    </div>
  )
}

function SettingsEditor({ draft, set, readOnly }: { draft: RequestDef; set: (p: Partial<RequestDef>) => void; readOnly?: boolean }) {
  const s = draft.settings ?? {}
  const up = (p: any) => set({ settings: { ...s, ...p } })
  return (
    <div className="p-4 max-w-lg space-y-4 text-xs">
      <Toggle checked={s.followRedirects !== false} onChange={(v) => !readOnly && up({ followRedirects: v })} label={<span>Follow redirects <span className="faint">(max <input className="input inline-block w-14 h-5 ml-1" type="number" value={s.maxRedirects ?? 10} onChange={(e) => up({ maxRedirects: Number(e.target.value) })} />)</span></span>} />
      <Toggle checked={s.verifyTls !== false} onChange={(v) => !readOnly && up({ verifyTls: v })} label="Verify TLS certificates" />
      <Toggle checked={s.sendCookies !== false} onChange={(v) => !readOnly && up({ sendCookies: v })} label="Send cookies from the workspace cookie jar" />
      <Toggle checked={!!s.stream} onChange={(v) => !readOnly && up({ stream: v })} label="Stream response (Server-Sent Events / chunked responses, shows chunks as they arrive)" />
      <Field label="Timeout (ms)" hint="0 or empty uses the server default"><input className="input w-32" type="number" value={s.timeoutMs ?? ''} readOnly={readOnly} onChange={(e) => up({ timeoutMs: e.target.value ? Number(e.target.value) : undefined })} /></Field>
    </div>
  )
}

function SaveAsDialog({ open, onClose, draft, onSaved }: { open: boolean; onClose: () => void; draft: RequestDef; onSaved: (r: any) => void }) {
  const tree = useTree()
  const wsId = useStore((s) => s.workspaceId)
  const qc = useQueryClient()
  const [name, setName] = useState(draft.name)
  const [target, setTarget] = useState<{ collectionId: string; folderId: string | null } | null>(null)
  const [newCol, setNewCol] = useState('')
  useEffect(() => { if (open) setName(draft.name) }, [open, draft.name])
  const save = async () => {
    let t = target
    if (!t && newCol.trim()) { const c = await api.post(`/workspaces/${wsId}/collections`, { name: newCol }); t = { collectionId: c.id, folderId: null } }
    if (!t) return
    const r = await api.post(`/collections/${t.collectionId}/requests`, { ...draft, name, folderId: t.folderId })
    qc.invalidateQueries({ queryKey: ['tree'] }); onSaved(r); onClose(); toast('Saved')
  }
  const nodes: { id: string; label: string; collectionId: string; folderId: string | null; depth: number }[] = []
  for (const c of tree.data?.collections ?? []) {
    nodes.push({ id: c.id, label: c.name, collectionId: c.id, folderId: null, depth: 0 })
    const walk = (parent: string | null, depth: number) => { for (const f of (tree.data?.folders ?? []).filter((x) => x.collection_id === c.id && (x.parent_id ?? null) === parent)) { nodes.push({ id: f.id, label: f.name, collectionId: c.id, folderId: f.id, depth }); walk(f.id, depth + 1) } }
    walk(null, 1)
  }
  return (
    <Modal open={open} onClose={onClose} title="Save request" footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!name.trim() || (!target && !newCol.trim())} onClick={save}>Save</button></>}>
      <Field label="Request name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
      <div className="text-[11px] font-medium muted mb-1">Save to</div>
      <div className="border divider rounded max-h-60 overflow-auto mb-2">
        {nodes.map((n) => <div key={n.id} className={cx('row rounded-none', target?.folderId === n.folderId && target?.collectionId === n.collectionId && 'active')} style={{ paddingLeft: 8 + n.depth * 14 }} onClick={() => { setTarget({ collectionId: n.collectionId, folderId: n.folderId }); setNewCol('') }}>{n.depth === 0 ? '📁' : '📂'} {n.label}</div>)}
        {!nodes.length && <div className="p-3 text-xs faint">No collections yet</div>}
      </div>
      <Field label="Or create a new collection"><input className="input" value={newCol} onChange={(e) => { setNewCol(e.target.value); if (e.target.value) setTarget(null) }} placeholder="Collection name" /></Field>
    </Modal>
  )
}
void uid
