import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useStore } from '@/store'
import type { Tab } from '@/lib/types'
import ResponsePanel from '@/components/request/ResponsePanel'
import { cx, fmtDate } from '@/lib/utils'
import { Copy } from 'lucide-react'

export default function HistoryView({ tab }: { tab: Tab }) {
  const openTab = useStore((s) => s.openTab)
  const h = useQuery({ queryKey: ['history-item', tab.entityId], queryFn: () => api.get(`/history/${tab.entityId}`) })
  if (!h.data) return null
  const d = h.data
  const result = { request: { method: d.method, url: d.url, headers: d.request?.resolved?.headers ?? {}, body: d.request?.resolved?.body }, response: d.response ?? undefined, error: d.request?.error, tests: d.request?.tests ?? [], console: [], scriptErrors: [], varMutations: {} }
  const { resolved, error, tests, ...def } = d.request ?? {}
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 h-10 border-b divider shrink-0 text-xs"><span className={cx('method !w-auto', 'm-' + d.method)}>{d.method}</span><span className="mono truncate flex-1">{d.url}</span><span className="faint">{fmtDate(d.created_at)}</span><button className="btn" onClick={() => openTab({ type: 'request', title: def.name || 'From history', draft: { ...def, id: undefined, name: def.name || 'From history' }, dirty: true, meta: { method: d.method } })}><Copy size={12} /> Open as new request</button></div>
      <div className="flex-1 min-h-0"><ResponsePanel result={result as any} sending={false} /></div>
    </div>
  )
}
