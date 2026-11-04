import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, LayoutGrid, CheckCircle2, Circle, ArrowRight, Search } from 'lucide-react'
import { useStore } from '@/store'
import type { Tab } from '@/lib/types'
import { CATEGORIES, GUIDE, TOPICS, helpContent, topic as getTopic } from '@/lib/help'
import { renderMarkdown } from '@/lib/markdown'
import { cx } from '@/lib/utils'

export default function HelpView({ tab }: { tab: Tab }) {
  const updateTab = useStore((s) => s.updateTab)
  const current: string = tab.meta?.topic ?? 'guide'
  const go = (t: string) => updateTab(tab.id, { meta: { topic: t } })
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return TOPICS
    return TOPICS.filter((t) => (t.title + ' ' + t.summary + ' ' + helpContent(t.id)).toLowerCase().includes(s))
  }, [q])
  const contentRef = useRef<HTMLDivElement>(null)
  useEffect(() => { contentRef.current?.scrollTo(0, 0) }, [current])
  return (
    <div className="flex h-full min-h-0">
      <nav className="w-60 border-r divider shrink-0 flex flex-col min-h-0" style={{ background: 'var(--bg2)' }}>
        <div className="p-2 border-b divider"><div className="relative"><Search size={12} className="absolute left-2 top-2 faint" /><input className="input pl-7" placeholder="Search help" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
        <div className="flex-1 overflow-auto p-1 text-xs">
          {!q && <>
            <div className={cx('row', current === 'guide' && 'active')} onClick={() => go('guide')}><BookOpen size={13} className="text-[var(--accent)]" /> Getting started guide</div>
            <div className={cx('row', current === 'features' && 'active')} onClick={() => go('features')}><LayoutGrid size={13} className="text-[var(--accent)]" /> All features</div>
          </>}
          {CATEGORIES.map((c) => {
            const items = filtered.filter((t) => t.category === c)
            if (!items.length) return null
            return <div key={c}><div className="text-[10px] uppercase faint px-2 pt-3 pb-1">{c}</div>{items.map((t) => <div key={t.id} className={cx('row', current === t.id && 'active')} onClick={() => go(t.id)}><t.icon size={13} className="faint shrink-0" /><span className="truncate">{t.title}</span></div>)}</div>
          })}
          {q && !filtered.length && <div className="p-3 faint">No help pages match “{q}”.</div>}
        </div>
      </nav>
      <div ref={contentRef} className="flex-1 overflow-auto">
        {current === 'guide' ? <Guide go={go} /> : current === 'features' ? <Features go={go} /> : <TopicPage id={current} go={go} />}
      </div>
    </div>
  )
}

function useGuideProgress() {
  const [done, setDone] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('quiver.guide') || '[]') } catch { return [] } })
  const toggle = (id: string) => setDone((d) => { const n = d.includes(id) ? d.filter((x) => x !== id) : [...d, id]; try { localStorage.setItem('quiver.guide', JSON.stringify(n)) } catch {} return n })
  return { done, toggle }
}

function Guide({ go }: { go: (t: string) => void }) {
  const { done, toggle } = useGuideProgress()
  const pct = Math.round((done.length / GUIDE.length) * 100)
  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-xl font-semibold mb-1">Getting started</h1>
      <p className="text-xs muted mb-4">Eleven steps take your team from importing an API to running it in CI. Tick each step when you finish it. Your progress is stored in this browser.</p>
      <div className="flex items-center gap-3 mb-6"><div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg3)' }}><div className="h-full transition-all" style={{ width: pct + '%', background: 'var(--accent)' }} /></div><span className="text-[11px] muted">{done.length}/{GUIDE.length} done</span></div>
      <ol className="space-y-3">
        {GUIDE.map((step, i) => {
          const isDone = done.includes(step.id)
          return (
            <li key={step.id} className={cx('panel border rounded-lg p-4 flex gap-3', isDone && 'opacity-60')}>
              <button className="shrink-0 mt-0.5" onClick={() => toggle(step.id)} title={isDone ? 'Mark as not done' : 'Mark as done'}>{isDone ? <CheckCircle2 size={18} className="text-[var(--ok)]" /> : <Circle size={18} className="faint" />}</button>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{i + 1}. {step.title}</div>
                <div className="help-prose text-xs muted mt-1" dangerouslySetInnerHTML={{ __html: renderMarkdown(step.body) }} />
                <div className="flex gap-2 mt-3">
                  {step.action && <button className="btn btn-primary btn-sm" onClick={step.action.run}>{step.action.label}</button>}
                  <button className="btn btn-sm" onClick={() => go(step.topic)}>Read: {getTopic(step.topic)?.title} <ArrowRight size={11} /></button>
                </div>
              </div>
            </li>
          )
        })}
      </ol>
      <div className="text-xs muted mt-6">Want the full list? See <button className="link" onClick={() => go('features')}>all features</button>. Press <code className="mono">F1</code> on any screen to open its help page.</div>
    </div>
  )
}

function Features({ go }: { go: (t: string) => void }) {
  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="text-xl font-semibold mb-1">Features</h1>
      <p className="text-xs muted mb-6">Everything Quiver can do. Click a card for a how-to, or use the button to jump straight in.</p>
      {CATEGORIES.map((c) => (
        <section key={c} className="mb-8">
          <h2 className="text-xs uppercase tracking-wide faint mb-2">{c}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {TOPICS.filter((t) => t.category === c).map((t) => (
              <div key={t.id} className="panel border rounded-lg p-3 flex flex-col cursor-pointer hover:border-[var(--accent)] transition-colors" onClick={() => go(t.id)}>
                <div className="flex items-center gap-2 mb-1"><span className="w-7 h-7 rounded flex items-center justify-center" style={{ background: 'var(--sel)' }}><t.icon size={14} className="text-[var(--accent)]" /></span><span className="text-sm font-medium">{t.title}</span></div>
                <div className="text-xs muted flex-1">{t.summary}</div>
                <div className="flex gap-2 mt-3">
                  <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); go(t.id) }}>How to use</button>
                  {t.action && <button className="btn btn-sm btn-primary" onClick={(e) => { e.stopPropagation(); t.action!.run() }}>{t.action.label}</button>}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function TopicPage({ id, go }: { id: string; go: (t: string) => void }) {
  const t = getTopic(id)
  const html = useMemo(() => renderMarkdown(helpContent(id)), [id])
  if (!t) return <div className="p-6 text-xs muted">Help page not found. <button className="link" onClick={() => go('features')}>Browse all features</button></div>
  const onClick = (e: React.MouseEvent) => { const a = (e.target as HTMLElement).closest('a[data-topic]'); if (a) { e.preventDefault(); go(a.getAttribute('data-topic')!) } }
  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="flex items-center gap-2 text-[11px] faint mb-3"><button className="link" onClick={() => go('features')}>Features</button><span>/</span><span>{t.category}</span></div>
      {t.action && <div className="float-right"><button className="btn btn-primary" onClick={t.action.run}>{t.action.label}</button></div>}
      <article className="help-prose text-[13px]" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
      {t.related?.length ? <div className="mt-8 pt-4 border-t divider"><div className="text-[11px] uppercase faint mb-2">Related</div><div className="flex flex-wrap gap-2">{t.related.map((r) => { const rt = getTopic(r); return rt ? <button key={r} className="btn btn-sm" onClick={() => go(r)}><rt.icon size={12} /> {rt.title}</button> : null })}</div></div> : null}
    </div>
  )
}
