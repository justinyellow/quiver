import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cx, fmtMs, statusClass } from '@/lib/utils'
import { Empty, Spinner } from '@/components/ui'

export default function RunResults({ items, status, summary, total }: { items: any[]; status: string; summary: any; total?: number }) {
  const [open, setOpen] = useState<number | null>(null)
  const [filter, setFilter] = useState<'all' | 'failed'>('all')
  if (status === 'idle' && !items.length) return <Empty title="Collection runner">Select requests, iterations and data, then press Run. Results stream in live.</Empty>
  const shown = items.map((it, i) => ({ it, i })).filter(({ it }) => filter === 'all' || it.error || it.tests.some((t: any) => !t.passed))
  const s = summary ?? { total: items.length, passed: items.filter((i) => !i.error && !i.tests.some((t: any) => !t.passed)).length, failed: items.filter((i) => !i.error && i.tests.some((t: any) => !t.passed)).length, errors: items.filter((i) => i.error).length, testsPassed: items.reduce((a, i) => a + i.tests.filter((t: any) => t.passed).length, 0), testsTotal: items.reduce((a, i) => a + i.tests.length, 0), avgTimeMs: items.length ? Math.round(items.reduce((a, i) => a + (i.timeMs ?? 0), 0) / items.length) : 0 }
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-4 px-3 h-10 border-b divider text-xs shrink-0">
        {status === 'running' ? <span className="flex items-center gap-1 text-[var(--info)]"><Spinner /> Running {items.length}{total ? `/${total}` : ''}</span> : <span className={cx('font-semibold uppercase', status === 'passed' ? 'text-[var(--ok)]' : status === 'cancelled' ? 'muted' : 'text-[var(--err)]')}>{status}</span>}
        <span><b className="text-[var(--ok)]">{s.passed}</b> passed</span><span><b className={s.failed ? 'text-[var(--err)]' : ''}>{s.failed}</b> failed</span><span><b className={s.errors ? 'text-[var(--err)]' : ''}>{s.errors}</b> errors</span>
        <span className="muted">tests {s.testsPassed}/{s.testsTotal}</span><span className="muted">avg {fmtMs(s.avgTimeMs)}</span>{s.durationMs !== undefined && <span className="muted">total {fmtMs(s.durationMs)}</span>}
        <div className="flex-1" />
        <button className={cx('btn btn-sm', filter === 'all' && 'bg-[var(--bg3)]')} onClick={() => setFilter('all')}>All</button><button className={cx('btn btn-sm', filter === 'failed' && 'bg-[var(--bg3)]')} onClick={() => setFilter('failed')}>Failed only</button>
      </div>
      <div className="flex-1 overflow-auto">
        {shown.map(({ it, i }) => {
          const failed = it.error || it.tests.some((t: any) => !t.passed) || it.scriptErrors?.length
          return (
            <div key={i} className="border-b divider text-xs">
              <div className="flex items-center gap-2 px-3 h-8 cursor-pointer hover:bg-[var(--bg2)]" onClick={() => setOpen(open === i ? null : i)}>
                {open === i ? <ChevronDown size={12} className="faint" /> : <ChevronRight size={12} className="faint" />}
                <span className={cx('w-2 h-2 rounded-full shrink-0', it.skipped ? 'bg-[var(--fg3)]' : failed ? 'bg-[var(--err)]' : 'bg-[var(--ok)]')} />
                {it.iteration > 0 || true ? <span className="faint w-8">#{it.iteration + 1}</span> : null}
                <span className={cx('method', 'm-' + it.method)}>{it.method}</span>
                <span className="font-medium truncate">{it.requestName}</span>
                <span className="mono faint truncate flex-1">{it.url}</span>
                {it.error ? <span className="text-[var(--err)] truncate max-w-xs">{it.error}</span> : <span className={cx('mono', statusClass(it.status))}>{it.status}</span>}
                <span className="muted w-16 text-right">{fmtMs(it.timeMs)}</span>
                <span className="muted w-12 text-right">{it.tests.filter((t: any) => t.passed).length}/{it.tests.length}</span>
              </div>
              {open === i && <div className="px-9 pb-3 space-y-2">
                {it.scriptErrors?.map((e: string, j: number) => <div key={j} className="mono text-[var(--err)]">{e}</div>)}
                {it.tests.map((t: any, j: number) => <div key={j} className="flex items-start gap-2"><span className={cx('badge', t.passed ? 'bg-[var(--ok)]' : 'bg-[var(--err)]')} style={{ color: '#fff' }}>{t.passed ? 'PASS' : 'FAIL'}</span><span>{t.name}{t.error && <span className="mono faint block">{t.error}</span>}</span></div>)}
                {it.console?.length > 0 && <div className="mono faint">{it.console.map((c: any, j: number) => <div key={j}>{c.args.map((a: any) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}</div>)}</div>}
                {it.responseBody !== undefined && <details><summary className="cursor-pointer muted">Response body</summary><pre className="mono whitespace-pre-wrap max-h-60 overflow-auto p-2 rounded mt-1" style={{ background: 'var(--bg2)' }}>{it.responseBody}</pre></details>}
              </div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
