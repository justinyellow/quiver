import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Play, Square, Download, FileUp } from 'lucide-react'
import { api } from '@/lib/api'
import { useStore } from '@/store'
import type { Tab } from '@/lib/types'
import { Field, Toggle, toast } from '@/components/ui'
import { useTree } from '@/components/sidebar/Sidebar'
import RunResults from '@/components/RunResults'
import { cx } from '@/lib/utils'
import HelpButton from '@/components/HelpButton'

export default function Runner({ tab }: { tab: Tab }) {
  const { workspaceId, environmentId, overlayEnvIds, openTab } = useStore()
  const tree = useTree()
  const envs = useQuery({ queryKey: ['environments', workspaceId], queryFn: () => api.get(`/workspaces/${workspaceId}/environments`) })
  const colId = tab.entityId!
  const [envId, setEnvId] = useState<string | null>(environmentId)
  const [iterations, setIterations] = useState(1)
  const [delayMs, setDelay] = useState(0)
  const [dataText, setDataText] = useState('')
  const [dataName, setDataName] = useState('')
  const [stopOnFailure, setStop] = useState(false)
  const [persist, setPersist] = useState(false)
  const [selected, setSelected] = useState<string[] | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [items, setItems] = useState<any[]>([])
  const [status, setStatus] = useState<string>('idle')
  const [summary, setSummary] = useState<any>(null)
  const [mode, setMode] = useState<'functional' | 'perf'>('functional')
  const [vus, setVus] = useState(10); const [duration, setDuration] = useState(30); const [ramp, setRamp] = useState(0)

  const ordered = useMemo(() => {
    if (!tree.data) return []
    const out: { id: string; name: string; method: string; path: string }[] = []
    const walk = (folderId: string | null, path: string) => {
      for (const r of tree.data!.requests.filter((r) => r.collection_id === colId && (r.folder_id ?? null) === folderId)) out.push({ id: r.id, name: r.name, method: r.method, path })
      for (const f of tree.data!.folders.filter((f) => f.collection_id === colId && (f.parent_id ?? null) === folderId)) walk(f.id, path ? path + ' / ' + f.name : f.name)
    }
    if (tab.meta?.folderId) walk(tab.meta.folderId, '') ; else walk(null, '')
    return out
  }, [tree.data, colId, tab.meta?.folderId])
  const sel = selected ?? ordered.map((r) => r.id)
  const selectedIds = selected ? ordered.filter((r) => selected.includes(r.id)).map((r) => r.id) : undefined

  const start = async () => {
    setItems([]); setSummary(null); setStatus('running')
    try {
      if (mode === 'perf') {
        const r = await api.post(`/workspaces/${workspaceId}/perf`, { collectionId: colId, environmentId: envId, virtualUsers: vus, durationSec: duration, rampUpSec: ramp, requestIds: selectedIds, folderId: tab.meta?.folderId })
        openTab({ type: 'perf', entityId: r.id, title: 'Perf: ' + tab.title.replace(/^Run: /, '') }); setStatus('idle'); return
      }
      const r = await api.post(`/workspaces/${workspaceId}/runs`, { collectionId: colId, environmentId: envId, overlayEnvironmentIds: overlayEnvIds, iterations, delayMs, dataText: dataText || undefined, stopOnFailure, persistVariables: persist, requestIds: selectedIds, folderId: tab.meta?.folderId })
      setRunId(r.id)
    } catch (e: any) { toast(e.message, 'err'); setStatus('idle') }
  }
  useEffect(() => {
    if (!runId) return
    const es = new EventSource(`/api/runs/${runId}/events`)
    es.addEventListener('item', (e: any) => setItems((it) => [...it, JSON.parse(e.data)]))
    es.addEventListener('done', (e: any) => { const d = JSON.parse(e.data); setStatus(d.status); setSummary(d.summary); if (d.results) setItems(d.results); es.close() })
    es.onerror = () => { es.close(); api.get(`/runs/${runId}`).then((d) => { setStatus(d.status); setSummary(d.summary); setItems(d.results) }) }
    return () => es.close()
  }, [runId])
  const cancel = async () => { if (runId) await api.post(`/runs/${runId}/cancel`) }
  const running = status === 'running'
  const envList = (envs.data ?? []).filter((e: any) => !e.is_global)

  return (
    <div className="flex h-full min-h-0">
      <div className="w-80 border-r divider shrink-0 overflow-auto p-3 text-xs">
        <div className="flex gap-1 mb-3 items-center"><button className={cx('btn flex-1', mode === 'functional' && 'btn-primary')} onClick={() => setMode('functional')}>Functional</button><button className={cx('btn flex-1', mode === 'perf' && 'btn-primary')} onClick={() => setMode('perf')}>Performance</button><HelpButton topic={mode === 'perf' ? 'perf' : 'runner'} /></div>
        <Field label="Environment"><select className="input" value={envId ?? ''} onChange={(e) => setEnvId(e.target.value || null)}><option value="">No environment</option>{envList.map((e: any) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></Field>
        {mode === 'functional' ? <>
          <div className="grid grid-cols-2 gap-2"><Field label="Iterations"><input className="input" type="number" min={1} value={iterations} onChange={(e) => setIterations(Number(e.target.value))} disabled={!!dataText} /></Field><Field label="Delay (ms)"><input className="input" type="number" min={0} value={delayMs} onChange={(e) => setDelay(Number(e.target.value))} /></Field></div>
          <Field label="Data file (CSV or JSON array)" hint="One iteration per row; columns become variables."><div className="flex gap-1"><label className="btn cursor-pointer flex-1 justify-center"><FileUp size={12} /> {dataName || 'Choose file'}<input type="file" accept=".csv,.json" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; setDataText(await f.text()); setDataName(f.name) }} /></label>{dataText && <button className="btn" onClick={() => { setDataText(''); setDataName('') }}>×</button>}</div></Field>
          <div className="space-y-2 mb-3"><Toggle checked={stopOnFailure} onChange={setStop} label="Stop on first test failure" /><Toggle checked={persist} onChange={setPersist} label="Persist variable changes to environment" /></div>
        </> : <>
          <div className="grid grid-cols-3 gap-2"><Field label="Virtual users"><input className="input" type="number" min={1} max={200} value={vus} onChange={(e) => setVus(Number(e.target.value))} /></Field><Field label="Duration (s)"><input className="input" type="number" min={1} max={3600} value={duration} onChange={(e) => setDuration(Number(e.target.value))} /></Field><Field label="Ramp-up (s)"><input className="input" type="number" min={0} value={ramp} onChange={(e) => setRamp(Number(e.target.value))} /></Field></div>
          <div className="faint mb-3">Each virtual user loops through the selected requests until the duration elapses. Results show throughput, error rate and latency percentiles per request. Load is generated from this server.</div>
        </>}
        <div className="flex items-center mb-1"><span className="font-medium">Requests ({sel.length}/{ordered.length})</span><button className="link ml-auto" onClick={() => setSelected(selected ? null : [])}>{selected ? 'Select all' : 'Deselect all'}</button></div>
        <div className="border divider rounded max-h-72 overflow-auto mb-3">{ordered.map((r) => <label key={r.id} className="flex items-center gap-2 px-2 h-7 border-b divider cursor-pointer"><input type="checkbox" checked={sel.includes(r.id)} onChange={(e) => setSelected(e.target.checked ? [...sel, r.id] : sel.filter((x) => x !== r.id))} /><span className={cx('method', 'm-' + r.method)}>{r.method}</span><span className="truncate flex-1">{r.name}</span>{r.path && <span className="faint truncate max-w-[80px]">{r.path}</span>}</label>)}</div>
        {running && mode === 'functional' ? <button className="btn btn-danger w-full justify-center" onClick={cancel}><Square size={12} /> Cancel</button> : <button className="btn btn-primary w-full justify-center" disabled={!sel.length || running} onClick={start}><Play size={12} /> {mode === 'perf' ? 'Start load test' : 'Run'}</button>}
        {runId && !running && <a className="btn w-full justify-center mt-2" href={`/api/runs/${runId}/junit`} target="_blank" rel="noreferrer"><Download size={12} /> JUnit XML report</a>}
        <div className="faint mt-3">CI tip: trigger runs with an API token: <span className="mono">POST /api/workspaces/{'{id}'}/runs?wait=true</span></div>
      </div>
      <div className="flex-1 min-w-0 flex flex-col"><RunResults items={items} status={status} summary={summary} total={ordered.length * iterations} /></div>
    </div>
  )
}
