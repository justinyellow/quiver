import { useEffect, useRef, useState } from 'react'
import { Plug, PlugZap, Send, Trash2 } from 'lucide-react'
import { useStore } from '@/store'
import type { Tab } from '@/lib/types'
import { cx, prettyJson } from '@/lib/utils'
import KVEditor from '@/components/request/KVEditor'
import CodeEditor from '@/components/CodeEditor'
import { Tabs } from '@/components/ui'
import HelpButton from '@/components/HelpButton'

export default function WsClient({ tab }: { tab: Tab }) {
  const wsId = useStore((s) => s.workspaceId)
  const updateTab = useStore((s) => s.updateTab)
  const [url, setUrl] = useState(tab.draft?.url ?? 'wss://echo.websocket.org')
  const [headers, setHeaders] = useState<any[]>(tab.draft?.headers ?? [])
  const [msg, setMsg] = useState('{"hello": "world"}')
  const [log, setLog] = useState<{ dir: 'in' | 'out' | 'sys'; data: string; ts: number }[]>([])
  const [state, setState] = useState<'closed' | 'connecting' | 'open'>('closed')
  const [section, setSection] = useState('message')
  const sock = useRef<WebSocket | null>(null)
  const add = (dir: 'in' | 'out' | 'sys', data: string) => setLog((l) => [...l.slice(-500), { dir, data, ts: Date.now() }])
  useEffect(() => { updateTab(tab.id, { draft: { url, headers }, title: url.replace(/^wss?:\/\//, '').slice(0, 30) || 'WebSocket' }) }, [url, headers]) // eslint-disable-line
  const connect = () => {
    if (sock.current) { sock.current.close(); sock.current = null; setState('closed'); return }
    setState('connecting')
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const s = new WebSocket(`${proto}://${location.host}/api/workspaces/${wsId}/ws-proxy`)
    sock.current = s
    s.onopen = () => { const h: Record<string, string> = {}; for (const x of headers) if (x.enabled !== false && x.key) h[x.key] = x.value; s.send(JSON.stringify({ type: 'connect', url, headers: h })); add('sys', `Connecting to ${url}…`) }
    s.onmessage = (e) => {
      const m = JSON.parse(e.data)
      if (m.type === 'open') { setState('open'); add('sys', `Connected in ${m.ms} ms${m.protocol ? ` (protocol ${m.protocol})` : ''}`) }
      else if (m.type === 'message') add('in', m.binary ? `[binary ${m.data.length} b64 bytes]` : m.data)
      else if (m.type === 'sent') add('out', m.data)
      else if (m.type === 'close') { add('sys', `Closed (${m.code}${m.reason ? ' ' + m.reason : ''})`); setState('closed'); sock.current = null }
      else if (m.type === 'error') { add('sys', `Error: ${m.message}`); setState('closed') }
    }
    s.onclose = () => { setState('closed'); sock.current = null }
    s.onerror = () => add('sys', 'Proxy connection error')
  }
  const send = () => { if (sock.current && state === 'open') sock.current.send(JSON.stringify({ type: 'send', data: msg })) }
  useEffect(() => () => { sock.current?.close() }, [])
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b divider shrink-0">
        <span className="badge" style={{ background: 'var(--sel)' }}>WS</span>
        <input className="input mono flex-1" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="wss://example.com/socket" onKeyDown={(e) => e.key === 'Enter' && connect()} />
        <button className={cx('btn', state === 'open' ? 'btn-danger' : 'btn-primary')} onClick={connect}>{state === 'open' ? <><Plug size={12} /> Disconnect</> : state === 'connecting' ? 'Connecting…' : <><PlugZap size={12} /> Connect</>}</button>
        <HelpButton topic="websocket" />
      </div>
      <div className="flex flex-1 min-h-0">
        <div className="w-1/2 flex flex-col border-r divider min-w-0">
          <Tabs active={section} onChange={setSection} tabs={[{ id: 'message', label: 'Message' }, { id: 'headers', label: 'Headers', count: headers.filter((h) => h.key).length }]} />
          {section === 'message' ? <><div className="flex-1 min-h-0"><CodeEditor value={msg} onChange={setMsg} lang={/^\s*[{[]/.test(msg) ? 'json' : 'text'} /></div><div className="flex items-center gap-2 p-2 border-t divider"><span className="faint text-[11px]">Ctrl+Enter to send</span><div className="flex-1" /><button className="btn btn-primary" disabled={state !== 'open'} onClick={send}><Send size={12} /> Send</button></div></> : <div className="flex-1 min-h-0"><KVEditor items={headers} onChange={setHeaders} showDescription={false} placeholderKey="Header" /></div>}
        </div>
        <div className="flex-1 flex flex-col min-w-0">
          <div className="h-8 flex items-center px-3 border-b divider text-xs font-medium">Messages <span className="faint ml-2">{log.length}</span><button className="btn btn-ghost btn-sm ml-auto" onClick={() => setLog([])}><Trash2 size={11} /></button></div>
          <div className="flex-1 overflow-auto mono text-[11px]">{log.map((l, i) => <div key={i} className={cx('px-3 py-1 border-b divider whitespace-pre-wrap break-all', l.dir === 'sys' && 'faint italic')}><span className={cx('inline-block w-5', l.dir === 'in' ? 'text-[var(--ok)]' : l.dir === 'out' ? 'text-[var(--info)]' : '')}>{l.dir === 'in' ? '↓' : l.dir === 'out' ? '↑' : '•'}</span><span className="faint mr-2">{new Date(l.ts).toLocaleTimeString()}</span>{l.dir === 'in' && /^\s*[{[]/.test(l.data) ? prettyJson(l.data) : l.data}</div>)}</div>
        </div>
      </div>
      <KeyHandler onSend={send} tabId={tab.id} />
    </div>
  )
}
function KeyHandler({ onSend, tabId }: { onSend: () => void; tabId: string }) {
  useEffect(() => { const h = (e: KeyboardEvent) => { if (useStore.getState().activeTab === tabId && (e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); onSend() } }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h) }, [onSend, tabId])
  return null
}
