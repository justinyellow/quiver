import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { api } from '@/lib/api'
import type { Tab } from '@/lib/types'
import RunResults from '@/components/RunResults'
import { fmtDate } from '@/lib/utils'
import HelpButton from '@/components/HelpButton'

export default function RunView({ tab }: { tab: Tab }) {
  const run = useQuery({ queryKey: ['run', tab.entityId], queryFn: () => api.get(`/runs/${tab.entityId}`), refetchInterval: (q) => (q.state.data?.status === 'running' ? 2000 : false) })
  if (!run.data) return null
  const r = run.data
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-3 h-10 border-b divider text-xs shrink-0"><span className="font-medium">{r.collection_name}</span><span className="faint">{r.source} · {fmtDate(r.started_at)}{r.user_name ? ` · ${r.user_name}` : ''}</span><div className="flex-1" /><HelpButton topic={r.source === 'monitor' ? 'monitors' : 'runner'} /><a className="btn" href={`/api/runs/${r.id}/junit`} target="_blank" rel="noreferrer"><Download size={12} /> JUnit</a></div>
      <div className="flex-1 min-h-0"><RunResults items={r.results ?? []} status={r.status} summary={r.summary} /></div>
    </div>
  )
}
