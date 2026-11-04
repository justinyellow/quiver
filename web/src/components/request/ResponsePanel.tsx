import { useMemo, useState } from 'react'
import { Copy, Download, Save, WrapText, Search } from 'lucide-react'
import type { ExecResult, RequestDef } from '@/lib/types'
import { cx, fmtBytes, fmtMs, prettyJson, statusClass, copy, download } from '@/lib/utils'
import { Tabs, Empty, Spinner, toast } from '@/components/ui'
import CodeEditor from '@/components/CodeEditor'
import HelpButton from '@/components/HelpButton'

export default function ResponsePanel({ result, sending, onSaveExample, request }: { result: ExecResult | null; sending: boolean; onSaveExample?: () => void; request?: RequestDef }) {
  const [tab, setTab] = useState('body')
  const [view, setView] = useState<'pretty' | 'raw' | 'preview'>('pretty')
  const [wrap, setWrap] = useState(true)
  const [filter, setFilter] = useState('')
  const res = result?.response
  const ct = res?.contentType ?? ''
  const lang = /json/.test(ct) ? 'json' : /xml/.test(ct) ? 'xml' : /html/.test(ct) ? 'html' : /javascript/.test(ct) ? 'javascript' : 'text'
  const pretty = useMemo(() => { if (!res || res.isBase64) return ''; if (lang === 'json') return prettyJson(res.body); return res.body }, [res, lang])
  const filtered = useMemo(() => {
    if (!filter.trim() || lang !== 'json' || !res) return pretty
    try { const j = JSON.parse(res.body); const v = jsonPath(j, filter.trim()); return JSON.stringify(v, null, 2) } catch { return pretty }
  }, [filter, pretty, lang, res])
  const tests = result?.tests ?? []
  const passed = tests.filter((t) => t.passed).length
  const failedTests = tests.length - passed
  const isImage = /^image\//.test(ct)
  const isPdf = /pdf/.test(ct)
  if (sending && !result) return <div className="h-full flex flex-col items-center justify-center gap-2 text-xs muted"><Spinner size={20} /> Sending request…</div>
  if (!result) return <Empty title="Response">Send a request to see the response here. <kbd>Ctrl</kbd>+<kbd>Enter</kbd> sends.<div className="mt-3"><HelpButton topic="requests" label="How to send and read requests" /></div></Empty>
  return (
    <div className="flex flex-col h-full min-h-0">
      <Tabs active={tab} onChange={setTab} tabs={[{ id: 'body', label: 'Body' }, { id: 'headers', label: 'Headers', count: res?.headers.length }, { id: 'cookies', label: 'Cookies', count: res?.cookies?.length }, { id: 'tests', label: <span className={cx(failedTests > 0 && 'text-[var(--err)]', !failedTests && tests.length > 0 && 'text-[var(--ok)]')}>Tests {tests.length ? `${passed}/${tests.length}` : ''}</span> }, { id: 'console', label: 'Console', count: (result.console?.length ?? 0) + (result.scriptErrors?.length ?? 0) }, { id: 'timeline', label: 'Timeline' }]}
        right={res ? <div className="flex items-center gap-3 text-[11px] pr-2 shrink-0">
          <span className={cx('font-semibold', statusClass(res.status))}>{res.status || ''} {res.statusText}</span>
          <span className="muted" title="Total time incl. scripts">{fmtMs(res.timeMs)}</span>
          <span className="muted">{fmtBytes(res.size)}</span>
          {res.truncated && <span className="badge" style={{ background: 'var(--warn)', color: '#fff' }}>truncated</span>}
          {onSaveExample && <button className="btn btn-sm" onClick={onSaveExample} title="Save as example"><Save size={11} /> Example</button>}
        </div> : result.error ? <span className="text-[11px] pr-2" style={{ color: 'var(--err)' }}>Error</span> : null} />
      <div className="flex-1 min-h-0 overflow-hidden">
        {result.error && tab === 'body' && <div className="p-4 text-xs"><div className="font-semibold mb-1" style={{ color: 'var(--err)' }}>Could not send request</div><div className="mono whitespace-pre-wrap">{result.error}</div>{result.scriptErrors?.length ? <div className="mt-2 faint">{result.scriptErrors.join('\n')}</div> : null}</div>}
        {res && tab === 'body' && (
          <div className="flex flex-col h-full">
            <div className="flex items-center gap-1 px-2 h-7 border-b divider shrink-0 text-[11px]">
              {(['pretty', 'raw', 'preview'] as const).map((v) => <button key={v} className={cx('btn btn-ghost btn-sm capitalize', view === v && 'bg-[var(--bg3)]')} onClick={() => setView(v)}>{v}</button>)}
              <span className="faint ml-2">{ct.split(';')[0]}</span>
              {lang === 'json' && view === 'pretty' && <div className="flex items-center gap-1 ml-3"><Search size={11} className="faint" /><input className="input h-5 w-56 mono" placeholder="Filter: data.items[0].name" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>}
              <div className="flex-1" />
              <button className={cx('btn btn-ghost btn-sm', wrap && 'bg-[var(--bg3)]')} onClick={() => setWrap(!wrap)} title="Wrap lines"><WrapText size={12} /></button>
              <button className="btn btn-ghost btn-sm" onClick={async () => { await copy(view === 'raw' ? res.body : filtered); toast('Copied') }} title="Copy"><Copy size={12} /></button>
              <button className="btn btn-ghost btn-sm" onClick={() => { if (res.isBase64) { const a = document.createElement('a'); a.href = `data:${ct};base64,${res.body}`; a.download = 'response'; a.click() } else download('response.' + (lang === 'text' ? 'txt' : lang), res.body, ct || 'text/plain') }} title="Download"><Download size={12} /></button>
            </div>
            <div className="flex-1 min-h-0">
              {view === 'preview' ? (
                isImage ? <img className="max-w-full p-2" src={`data:${ct};base64,${res.isBase64 ? res.body : btoa(res.body)}`} alt="" /> : isPdf ? <iframe title="pdf" className="w-full h-full" src={`data:${ct};base64,${res.body}`} /> : <iframe title="preview" className="w-full h-full bg-white" sandbox="" srcDoc={res.isBase64 ? '' : res.body} />
              ) : res.isBase64 ? (
                isImage ? <img className="max-w-full p-2" src={`data:${ct};base64,${res.body}`} alt="" /> : <div className="p-4 text-xs muted">Binary response ({fmtBytes(res.size)}). Use Download to save it.</div>
              ) : <CodeEditor value={view === 'raw' ? res.body : filtered} lang={view === 'raw' ? 'text' : lang} readOnly wrap={wrap} />}
            </div>
          </div>
        )}
        {tab === 'headers' && <div className="overflow-auto h-full"><table className="w-full text-xs"><tbody>{res?.headers.map(([k, v], i) => <tr key={i} className="border-b divider"><td className="px-3 py-1 font-medium mono whitespace-nowrap align-top w-1/3">{k}</td><td className="px-3 py-1 mono break-all">{v}</td></tr>)}</tbody></table>{res?.redirects?.length ? <div className="p-3 text-[11px] faint">Redirects: {res.redirects.map((r) => `${r.status} ${r.url}`).join(' → ')}</div> : null}</div>}
        {tab === 'cookies' && <div className="overflow-auto h-full">{res?.cookies?.length ? <table className="w-full text-xs"><thead><tr className="faint text-[10px] uppercase"><th className="text-left px-3 py-1">Name</th><th className="text-left px-3">Value</th><th className="text-left px-3">Domain</th><th className="text-left px-3">Path</th><th className="text-left px-3">Expires</th><th className="text-left px-3">Flags</th></tr></thead><tbody>{res.cookies.map((c: any, i: number) => <tr key={i} className="border-b divider"><td className="px-3 py-1 mono">{c.name}</td><td className="px-3 mono break-all">{c.value}</td><td className="px-3">{c.domain}</td><td className="px-3">{c.path}</td><td className="px-3">{c.expires ? new Date(c.expires).toLocaleString() : 'session'}</td><td className="px-3 faint">{[c.secure && 'Secure', c.httpOnly && 'HttpOnly', c.sameSite].filter(Boolean).join(', ')}</td></tr>)}</tbody></table> : <div className="p-4 text-xs faint">No cookies were set by this response. Cookies are stored in your workspace cookie jar and sent automatically to matching domains.</div>}</div>}
        {tab === 'tests' && <div className="overflow-auto h-full p-2">
          {result.scriptErrors?.map((e, i) => <div key={i} className="text-xs p-2 mb-1 rounded mono" style={{ background: 'color-mix(in srgb, var(--err) 12%, transparent)', color: 'var(--err)' }}>{e}</div>)}
          {tests.map((t, i) => <div key={i} className="flex items-start gap-2 text-xs px-2 py-1.5 border-b divider"><span className={cx('badge shrink-0 mt-0.5', t.passed ? 'bg-[var(--ok)]' : 'bg-[var(--err)]')} style={{ color: '#fff' }}>{t.passed ? 'PASS' : 'FAIL'}</span><div><div>{t.name}</div>{t.error && <div className="mono faint mt-0.5">{t.error}</div>}</div></div>)}
          {!tests.length && !result.scriptErrors?.length && <div className="p-4 text-xs faint">No tests ran. Add assertions under Scripts → Post-response.</div>}
        </div>}
        {tab === 'console' && <div className="overflow-auto h-full p-2 mono text-[11px]">
          {result.scriptErrors?.map((e, i) => <div key={'e' + i} className="px-2 py-0.5" style={{ color: 'var(--err)' }}>{e}</div>)}
          {result.console?.map((c, i) => <div key={i} className={cx('px-2 py-0.5 border-b divider whitespace-pre-wrap', c.level === 'error' && 'text-[var(--err)]', c.level === 'warn' && 'text-[var(--warn)]')}><span className="faint mr-2">{new Date(c.ts).toLocaleTimeString()}</span>{c.args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a, null, 2))).join(' ')}</div>)}
          {!result.console?.length && !result.scriptErrors?.length && <div className="p-4 faint font-sans text-xs">console.log output from scripts appears here.</div>}
        </div>}
        {tab === 'timeline' && <div className="overflow-auto h-full p-3 text-xs space-y-3">
          <div><div className="font-semibold mb-1">Request</div><div className="mono p-2 rounded whitespace-pre-wrap break-all" style={{ background: 'var(--bg2)' }}>{result.request.method} {result.request.url}{'\n'}{Object.entries(result.request.headers).map(([k, v]) => `${k}: ${v}`).join('\n')}{result.request.body ? '\n\n' + result.request.body.slice(0, 5000) : ''}</div></div>
          {res && <div><div className="font-semibold mb-1">Timings</div><div className="grid grid-cols-2 gap-1 max-w-xs">{Object.entries(res.timings ?? {}).map(([k, v]) => <div key={k} className="flex justify-between"><span className="muted">{k}</span><span className="mono">{fmtMs(v as number)}</span></div>)}<div className="flex justify-between border-t divider pt-1"><span className="muted">total</span><span className="mono">{fmtMs(res.timeMs)}</span></div></div></div>}
          {request && res && <div className="faint">Response size {fmtBytes(res.size)} · {res.headers.length} headers</div>}
        </div>}
      </div>
    </div>
  )
}

function jsonPath(obj: any, path: string): any {
  const parts = path.replace(/^\$\.?/, '').replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)
  let cur = obj
  for (const p of parts) {
    if (p === '*' && Array.isArray(cur)) continue
    if (Array.isArray(cur) && isNaN(Number(p))) { cur = cur.map((x) => x?.[p]); continue }
    cur = cur?.[p]
    if (cur === undefined) return undefined
  }
  return cur
}
