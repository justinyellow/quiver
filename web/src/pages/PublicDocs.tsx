import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import DocsView from '@/components/DocsView'
import { Logo } from './Login'
import { useStore } from '@/store'
import { Moon, Sun } from 'lucide-react'

export default function PublicDocs() {
  const { slug } = useParams()
  const [data, setData] = useState<any>(null)
  const [err, setErr] = useState('')
  const { theme, toggleTheme } = useStore()
  useEffect(() => { fetch(`/p/docs/${slug}`).then(async (r) => { if (!r.ok) throw new Error('Documentation not found or not public'); setData(await r.json()) }).catch((e) => setErr(e.message)) }, [slug])
  return (
    <div className="h-full flex flex-col">
      <header className="h-10 flex items-center gap-2 px-3 border-b divider shrink-0" style={{ background: 'var(--bg2)' }}><Logo size={22} /><span className="font-semibold">{data?.name ?? 'Documentation'}</span><div className="flex-1" /><button className="btn btn-ghost" onClick={toggleTheme}>{theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}</button></header>
      <div className="flex-1 min-h-0">{err ? <div className="p-8 text-sm muted">{err}</div> : data ? <DocsView data={data} /> : null}</div>
    </div>
  )
}
