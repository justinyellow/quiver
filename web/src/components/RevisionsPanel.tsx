import { useQuery, useQueryClient } from '@tanstack/react-query'
import { X, RotateCcw } from 'lucide-react'
import { api } from '@/lib/api'
import { fmtDate } from '@/lib/utils'
import { toast } from '@/components/ui'

export default function RevisionsPanel({ type, id, onClose, onRestored }: { type: string; id: string; onClose: () => void; onRestored?: () => void }) {
  const qc = useQueryClient()
  const revs = useQuery({ queryKey: ['revisions', type, id], queryFn: () => api.get(`/revisions/${type}/${id}`) })
  const restore = async (rev: any) => { if (!confirm('Restore this version? The current state is saved as a new revision first.')) return; await api.post(`/revisions/${type}/${id}/restore/${rev.id}`); qc.invalidateQueries({ queryKey: ['revisions', type, id] }); onRestored?.(); toast('Restored') }
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="h-8 flex items-center px-3 border-b divider text-xs font-semibold">Version history<button className="btn btn-ghost btn-sm ml-auto" onClick={onClose}><X size={12} /></button></div>
      <div className="flex-1 overflow-auto">
        {(revs.data ?? []).map((r: any) => (
          <div key={r.id} className="px-3 py-2 border-b divider text-xs group">
            <div className="flex items-center gap-2"><span className="font-medium">{r.user_name ?? 'unknown'}</span><span className="faint ml-auto">{fmtDate(r.created_at)}</span></div>
            {r.message && <div className="muted mt-0.5">{r.message}</div>}
            <div className="mono faint mt-1 truncate">{r.data.method ? `${r.data.method} ${r.data.url}` : r.data.name}</div>
            <button className="btn btn-sm mt-1 opacity-0 group-hover:opacity-100" onClick={() => restore(r)}><RotateCcw size={11} /> Restore this version</button>
          </div>
        ))}
        {!revs.data?.length && <div className="p-4 text-xs faint">No previous versions. A snapshot is taken every time this is saved.</div>}
      </div>
    </div>
  )
}
