import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { renderMarkdown } from '@/lib/markdown'
import { cx, statusClass, copy } from '@/lib/utils'
import { generate, targets } from '@/lib/codegen'
import { toast } from '@/components/ui'

export default function DocsView({ collectionId, data: given }: { collectionId?: string; data?: any }) {
  const q = useQuery({ queryKey: ['docs', collectionId], queryFn: () => api.get(`/collections/${collectionId}/docs`), enabled: !!collectionId && !given })
  const data = given ?? q.data
  const [lang, setLang] = useState(() => localStorage.getItem('quiver.codegen') || 'curl')
  const items = useMemo(() => { if (!data) return []; const out: any[] = []; const walk = (f: any, depth: number, path: string[]) => { for (const r of f.requests ?? []) out.push({ kind: 'request', r, depth, path }); for (const sub of f.folders ?? []) { out.push({ kind: 'folder', f: sub, depth, path }); walk(sub, depth + 1, [...path, sub.name]) } }; walk(data, 0, []); return out }, [data])
  if (!data) return null
  const vars: Record<string, string> = {}; for (const v of data.variables ?? []) vars[v.key] = v.value
  return (
    <div className="flex h-full min-h-0">
      <nav className="w-56 border-r divider overflow-auto p-2 shrink-0 text-xs hidden md:block">
        <div className="font-semibold mb-2 truncate">{data.name}</div>
        {items.map((it, i) => it.kind === 'folder' ? <div key={i} className="font-medium mt-2 truncate" style={{ paddingLeft: it.depth * 8 }}>{it.f.name}</div> : <a key={i} href={`#req-${it.r.id}`} className="block truncate py-0.5 muted hover:text-[var(--fg)]" style={{ paddingLeft: it.depth * 8 }}><span className={cx('method !w-auto mr-1', 'm-' + it.r.method)}>{it.r.method}</span>{it.r.name}</a>)}
      </nav>
      <div className="flex-1 overflow-auto p-6 max-w-4xl">
        <h1 className="text-xl font-semibold mb-1">{data.name}</h1>
        {data.description && <div className="prose-sm text-xs muted mb-4" dangerouslySetInnerHTML={{ __html: renderMarkdown(data.description) }} />}
        {data.variables?.length ? <div className="text-xs mb-6"><div className="font-medium mb-1">Variables</div><table className="text-xs"><tbody>{data.variables.map((v: any) => <tr key={v.key}><td className="mono pr-4 py-0.5">{'{{' + v.key + '}}'}</td><td className="mono muted">{v.value}</td></tr>)}</tbody></table></div> : null}
        <div className="flex items-center gap-2 mb-4 text-xs"><span className="faint">Code samples:</span><select className="input w-44 h-6" value={lang} onChange={(e) => { setLang(e.target.value); localStorage.setItem('quiver.codegen', e.target.value) }}>{targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></div>
        {items.map((it, i) => it.kind === 'folder' ? <div key={i} className="mt-8 mb-3 border-b divider pb-1"><h2 className="text-base font-semibold">{it.path.concat(it.f.name).join(' / ')}</h2>{it.f.description && <div className="prose-sm text-xs muted" dangerouslySetInnerHTML={{ __html: renderMarkdown(it.f.description) }} />}</div> : <RequestDoc key={it.r.id} r={it.r} lang={lang} vars={vars} />)}
      </div>
    </div>
  )
}

function RequestDoc({ r, lang, vars }: { r: any; lang: string; vars: Record<string, string> }) {
  const url = r.url.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (m: string, k: string) => vars[k] ?? m)
  let code = ''
  try { code = generate(lang, { method: r.method, url, headers: (r.headers ?? []).filter((h: any) => h.enabled !== false && h.key), body: r.body ?? { mode: 'none' }, auth: r.auth?.type === 'basic' || r.auth?.type === 'bearer' ? r.auth : { type: 'none' } }) } catch { code = '' }
  const params = (r.params ?? []).filter((p: any) => p.key)
  const headers = (r.headers ?? []).filter((h: any) => h.key)
  const bodyText = r.body?.mode === 'none' ? '' : r.body?.raw ?? (r.body?.graphql ? r.body.graphql.query : r.body?.urlencoded || r.body?.formdata ? JSON.stringify((r.body.urlencoded ?? r.body.formdata).map((k: any) => ({ [k.key]: k.value }))) : '')
  return (
    <section id={`req-${r.id}`} className="mb-8 scroll-mt-4">
      <h3 className="text-sm font-semibold flex items-center gap-2"><span className={cx('method !w-auto', 'm-' + r.method)}>{r.method}</span>{r.name}</h3>
      <div className="mono text-xs p-2 rounded mt-1 break-all" style={{ background: 'var(--bg2)' }}>{r.url}</div>
      {r.description && <div className="prose-sm text-xs mt-2" dangerouslySetInnerHTML={{ __html: renderMarkdown(r.description) }} />}
      {r.auth?.type && r.auth.type !== 'inherit' && r.auth.type !== 'none' && <div className="text-xs mt-2 faint">Auth: {r.auth.type}</div>}
      {params.length > 0 && <Table title="Query parameters" rows={params} />}
      {headers.length > 0 && <Table title="Headers" rows={headers} />}
      {bodyText && <div className="mt-3"><div className="text-xs font-medium mb-1">Body <span className="faint">({r.body.mode})</span></div><pre className="mono text-xs p-2 rounded overflow-auto whitespace-pre-wrap" style={{ background: 'var(--bg2)' }}>{bodyText}</pre></div>}
      {code && <div className="mt-3 group"><div className="text-xs font-medium mb-1 flex items-center">Example request <button className="link ml-auto opacity-0 group-hover:opacity-100 text-[11px]" onClick={async () => { await copy(code); toast('Copied') }}>copy</button></div><pre className="mono text-xs p-2 rounded overflow-auto" style={{ background: 'var(--bg2)' }}>{code}</pre></div>}
      {r.examples?.map((e: any) => <div key={e.id} className="mt-3"><div className="text-xs font-medium mb-1 flex items-center gap-2">Example response: {e.name} <span className={cx('mono', statusClass(e.status))}>{e.status} {e.statusText}</span></div>{e.headers?.length ? <div className="text-[11px] faint mono mb-1">{e.headers.filter((h: any) => h.key).map((h: any) => `${h.key}: ${h.value}`).join(' · ')}</div> : null}<pre className="mono text-xs p-2 rounded overflow-auto max-h-80 whitespace-pre-wrap" style={{ background: 'var(--bg2)' }}>{tryPretty(e.body)}</pre></div>)}
    </section>
  )
}
function Table({ title, rows }: { title: string; rows: any[] }) {
  return <div className="mt-3"><div className="text-xs font-medium mb-1">{title}</div><table className="text-xs w-full"><thead><tr className="faint text-[10px] uppercase text-left"><th className="py-0.5">Name</th><th>Value</th><th>Description</th></tr></thead><tbody>{rows.map((p, i) => <tr key={i} className="border-t divider"><td className="mono py-1 pr-3">{p.key}{p.enabled === false && <span className="faint"> (optional)</span>}</td><td className="mono pr-3 break-all">{p.value}</td><td className="muted">{p.description}</td></tr>)}</tbody></table></div>
}
function tryPretty(s: string) { try { return JSON.stringify(JSON.parse(s), null, 2) } catch { return s } }
