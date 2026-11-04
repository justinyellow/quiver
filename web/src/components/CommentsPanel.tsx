import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { X, Check } from 'lucide-react'
import { api } from '@/lib/api'
import { timeAgo, cx } from '@/lib/utils'
import { useStore } from '@/store'

export default function CommentsPanel({ type, id, onClose }: { type: string; id: string; onClose: () => void }) {
  const qc = useQueryClient()
  const user = useStore((s) => s.user)
  const [text, setText] = useState('')
  const comments = useQuery({ queryKey: ['comments', type, id], queryFn: () => api.get(`/comments/${type}/${id}`), refetchInterval: 15000 })
  const add = async () => { if (!text.trim()) return; await api.post(`/comments/${type}/${id}`, { body: text }); setText(''); qc.invalidateQueries({ queryKey: ['comments', type, id] }) }
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="h-8 flex items-center px-3 border-b divider text-xs font-semibold">Comments<button className="btn btn-ghost btn-sm ml-auto" onClick={onClose}><X size={12} /></button></div>
      <div className="flex-1 overflow-auto">
        {(comments.data ?? []).map((c: any) => (
          <div key={c.id} className={cx('px-3 py-2 border-b divider text-xs', c.resolved && 'opacity-50')}>
            <div className="flex items-center gap-2"><span className="font-medium">{c.user_name ?? 'unknown'}</span><span className="faint">{timeAgo(c.created_at)}</span><button className="btn btn-ghost btn-sm ml-auto !px-1" title={c.resolved ? 'Reopen' : 'Resolve'} onClick={async () => { await api.patch(`/comments/${c.id}`, { resolved: !c.resolved }); qc.invalidateQueries({ queryKey: ['comments', type, id] }) }}><Check size={11} /></button>{(c.user_id === user?.id || user?.role === 'admin') && <button className="btn btn-ghost btn-sm !px-1" onClick={async () => { await api.del(`/comments/${c.id}`); qc.invalidateQueries({ queryKey: ['comments', type, id] }) }}><X size={11} /></button>}</div>
            <div className="mt-1 whitespace-pre-wrap">{c.body}</div>
          </div>
        ))}
        {!comments.data?.length && <div className="p-4 text-xs faint">No comments yet.</div>}
      </div>
      <div className="p-2 border-t divider"><textarea className="input" rows={3} placeholder="Write a comment… (Ctrl+Enter to post)" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') add() }} /><button className="btn btn-primary mt-1" onClick={add} disabled={!text.trim()}>Post</button></div>
    </div>
  )
}
