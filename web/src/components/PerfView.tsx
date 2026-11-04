import { useQuery } from '@tanstack/react-query'
import { Square } from 'lucide-react'
import { api } from '@/lib/api'
import type { Tab } from '@/lib/types'
import { cx, fmtDate, fmtMs } from '@/lib/utils'
import { Spinner } from '@/components/ui'
import HelpButton from '@/components/HelpButton'

export default function PerfView({ tab }: { tab: Tab }) {
  const run = useQuery({ queryKey: ['run', tab.entityId], queryFn: () => api.get(`/runs/${tab.entityId}/perf-live`), refetchInterval: (q) => (q.state.data?.status === 'running' ? 2000 : false) })
  if (!run.data) return null
  const r = run.data; const s = r.summary ?? {}
  const cfg = r.config ?? {}
  const maxRps = Math.max(1, ...((s.timeline ?? []).map((t: any) => t.rps)))
  return (
    <div className="flex flex-col h-full overflow-auto text-xs">
      <div className="flex items-center gap-3 px-3 h-10 border-b divider shrink-0">
        <span className="font-medium">Performance test</span><span className="faint">{fmtDate(r.started_at)}</span>
        {r.status === 'running' ? <span className="flex items-center gap-1 text-[var(--info)]"><Spinner /> running ({cfg.virtualUsers} VUs, {cfg.durationSec}s)</span> : <span className={cx('font-semibold uppercase', r.status === 'passed' ? 'text-[var(--ok)]' : 'text-[var(--err)]')}>{r.status}</span>}
        <div className="flex-1" /><HelpButton topic="perf" />{r.status === 'running' && <button className="btn btn-danger" onClick={() => api.post(`/runs/${r.id}/cancel`)}><Square size={12} /> Stop</button>}
      </div>
      {r.status === 'running' && !s.total ? <div className="p-8 text-center muted">Generating load… results appear when the test finishes.</div> : s.error ? <div className="p-4 text-[var(--err)]">{s.error}</div> : (
        <div className="p-4 space-y-5">
          <div className="grid grid-cols-4 md:grid-cols-8 gap-3">
            {[['Requests', s.total], ['Req/s', s.rps], ['Errors', `${s.errors} (${s.errorRate}%)`], ['Avg', fmtMs(s.avg)], ['p50', fmtMs(s.p50)], ['p90', fmtMs(s.p90)], ['p95', fmtMs(s.p95)], ['p99', fmtMs(s.p99)]].map(([l, v]) => <div key={l as string} className="panel border rounded p-2"><div className="faint text-[10px] uppercase">{l}</div><div className="text-base font-semibold mono">{v as any}</div></div>)}
          </div>
          {s.timeline?.length > 0 && <div><div className="font-medium mb-1">Throughput per second <span className="faint">(red = errors)</span></div><div className="flex items-end gap-px h-24 border-b divider">{s.timeline.map((t: any) => <div key={t.sec} className="flex-1 flex flex-col justify-end" title={`t=${t.sec}s: ${t.rps} req/s, ${t.errors} errors, avg ${t.avg}ms`}><div style={{ height: `${(t.errors / maxRps) * 100}%`, background: 'var(--err)' }} /><div style={{ height: `${((t.rps - t.errors) / maxRps) * 100}%`, background: 'var(--accent)' }} /></div>)}</div></div>}
          <table className="w-full"><thead><tr className="faint text-[10px] uppercase text-left"><th className="py-1">Request</th><th>Count</th><th>Errors</th><th>Req/s</th><th>Avg</th><th>Min</th><th>p50</th><th>p90</th><th>p95</th><th>p99</th><th>Max</th></tr></thead><tbody>{(s.perRequest ?? []).map((p: any) => <tr key={p.name} className="border-t divider mono"><td className="py-1 font-sans font-medium">{p.name}</td><td>{p.count}</td><td className={p.errors ? 'text-[var(--err)]' : ''}>{p.errors}</td><td>{p.rps}</td><td>{p.avg}</td><td>{p.min}</td><td>{p.p50}</td><td>{p.p90}</td><td>{p.p95}</td><td>{p.p99}</td><td>{p.max}</td></tr>)}</tbody></table>
        </div>
      )}
    </div>
  )
}
