import { FileUp } from 'lucide-react'
import type { RequestBody } from '@/lib/types'
import CodeEditor from '@/components/CodeEditor'
import KVEditor from './KVEditor'
import { prettyJson } from '@/lib/utils'

const MODES: { v: RequestBody['mode']; l: string }[] = [{ v: 'none', l: 'none' }, { v: 'json', l: 'JSON' }, { v: 'formdata', l: 'form-data' }, { v: 'urlencoded', l: 'x-www-form-urlencoded' }, { v: 'raw', l: 'raw' }, { v: 'graphql', l: 'GraphQL' }, { v: 'binary', l: 'binary' }]

export default function BodyEditor({ body, onChange, readOnly, variables }: { body: RequestBody; onChange: (b: RequestBody) => void; readOnly?: boolean; variables?: string[] }) {
  const set = (p: Partial<RequestBody>) => onChange({ ...body, ...p })
  const lang = body.mode === 'json' ? 'json' : body.mode === 'raw' ? (body.language === 'json' ? 'json' : body.language === 'xml' ? 'xml' : body.language === 'html' ? 'html' : body.language === 'javascript' ? 'javascript' : 'text') : 'text'
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-3 h-8 border-b divider text-xs shrink-0">
        {MODES.map((m) => <label key={m.v} className="flex items-center gap-1 cursor-pointer"><input type="radio" name="bodymode" disabled={readOnly} checked={body.mode === m.v} onChange={() => set({ mode: m.v })} />{m.l}</label>)}
        {body.mode === 'raw' && <select className="input w-auto h-6 ml-2" value={body.language ?? 'text'} disabled={readOnly} onChange={(e) => set({ language: e.target.value as any })}><option value="text">Text</option><option value="json">JSON</option><option value="xml">XML</option><option value="html">HTML</option><option value="javascript">JavaScript</option></select>}
        {(body.mode === 'json' || (body.mode === 'raw' && body.language === 'json')) && !readOnly && <button className="link ml-auto" onClick={() => set({ raw: prettyJson(body.raw ?? '') })}>Beautify</button>}
      </div>
      <div className="flex-1 min-h-0">
        {body.mode === 'none' && <div className="p-4 text-xs faint">This request does not have a body.</div>}
        {(body.mode === 'json' || body.mode === 'raw' || body.mode === 'xml' || body.mode === 'text' || body.mode === 'html' || body.mode === 'javascript') && <CodeEditor value={body.raw ?? ''} onChange={(v) => set({ raw: v })} lang={lang} readOnly={readOnly} variables={variables} placeholder={body.mode === 'json' ? '{\n  "key": "value"\n}' : ''} />}
        {body.mode === 'formdata' && <KVEditor items={body.formdata ?? []} onChange={(v) => set({ formdata: v })} readOnly={readOnly} allowFile />}
        {body.mode === 'urlencoded' && <KVEditor items={body.urlencoded ?? []} onChange={(v) => set({ urlencoded: v })} readOnly={readOnly} />}
        {body.mode === 'graphql' && (
          <div className="flex h-full">
            <div className="flex-1 flex flex-col border-r divider"><div className="text-[10px] faint uppercase px-2 h-5 flex items-center">Query</div><div className="flex-1 min-h-0"><CodeEditor value={body.graphql?.query ?? ''} onChange={(v) => set({ graphql: { ...body.graphql, query: v } })} lang="javascript" readOnly={readOnly} placeholder="query { ... }" /></div></div>
            <div className="w-2/5 flex flex-col"><div className="text-[10px] faint uppercase px-2 h-5 flex items-center">Variables (JSON)</div><div className="flex-1 min-h-0"><CodeEditor value={body.graphql?.variables ?? ''} onChange={(v) => set({ graphql: { query: body.graphql?.query ?? '', ...body.graphql, variables: v } })} lang="json" readOnly={readOnly} placeholder="{}" /></div></div>
          </div>
        )}
        {body.mode === 'binary' && (
          <div className="p-4 text-xs flex items-center gap-3">
            <label className="btn cursor-pointer"><FileUp size={12} /> Select file<input type="file" className="hidden" disabled={readOnly} onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => set({ binary: { name: f.name, contentType: f.type, data: String(rd.result).split(',')[1] ?? '' } }); rd.readAsDataURL(f) }} /></label>
            {body.binary?.name ? <span className="muted">{body.binary.name} · {body.binary.contentType || 'application/octet-stream'} · {Math.round((body.binary.data.length * 3) / 4 / 1024)} KB</span> : <span className="faint">No file selected (max ~40 MB)</span>}
          </div>
        )}
      </div>
    </div>
  )
}
