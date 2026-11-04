import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import { useStore } from '@/store'
import HelpButton from '@/components/HelpButton'

export default function CookiesView() {
  const wsId = useStore((s) => s.workspaceId)
  const qc = useQueryClient()
  const c = useQuery({ queryKey: ['cookies', wsId], queryFn: () => api.get(`/workspaces/${wsId}/cookies`) })
  const save = async (list: any[]) => { await api.put(`/workspaces/${wsId}/cookies`, list); qc.invalidateQueries({ queryKey: ['cookies', wsId] }) }
  const list: any[] = c.data ?? []
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center px-3 h-10 border-b divider text-xs"><span className="font-medium">Cookie jar</span><span className="faint ml-2">Cookies set by responses are stored per user per workspace and sent automatically to matching domains.</span><div className="flex-1" /><HelpButton topic="history-cookies" /><button className="btn btn-danger" disabled={!list.length} onClick={() => save([])}><Trash2 size={12} /> Clear all</button></div>
      <div className="flex-1 overflow-auto"><table className="w-full text-xs"><thead><tr className="faint text-[10px] uppercase text-left"><th className="px-3 py-1">Domain</th><th>Name</th><th>Value</th><th>Path</th><th>Expires</th><th></th></tr></thead><tbody>{list.map((k, i) => <tr key={i} className="border-t divider"><td className="px-3 py-1">{k.domain}</td><td className="mono">{k.name}</td><td className="mono break-all max-w-md">{k.value}</td><td>{k.path}</td><td className="faint">{k.expires ? new Date(k.expires).toLocaleString() : 'session'}</td><td><button className="btn btn-ghost btn-sm" onClick={() => save(list.filter((_, j) => j !== i))}><Trash2 size={11} /></button></td></tr>)}</tbody></table>{!list.length && <div className="p-4 text-xs faint">Jar is empty.</div>}</div>
    </div>
  )
}
