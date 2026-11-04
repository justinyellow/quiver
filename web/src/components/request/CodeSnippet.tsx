import { useMemo, useState } from 'react'
import { Copy } from 'lucide-react'
import { Modal, toast } from '@/components/ui'
import CodeEditor from '@/components/CodeEditor'
import { generate, targets } from '@/lib/codegen'
import type { ExecResult, RequestDef } from '@/lib/types'
import { copy } from '@/lib/utils'
import HelpButton from '@/components/HelpButton'

export default function CodeSnippet({ open, onClose, draft, result }: { open: boolean; onClose: () => void; draft: RequestDef; result: ExecResult | null }) {
  const [target, setTarget] = useState(() => localStorage.getItem('quiver.codegen') || 'curl')
  const resolved = !!result?.request?.url && !result.request.url.includes('{{')
  const code = useMemo(() => {
    try {
      const headers = resolved ? Object.entries(result!.request.headers).filter(([k]) => !/^(user-agent|accept-encoding|content-length)$/i.test(k)).map(([key, value]) => ({ key, value })) : draft.headers.filter((h) => h.enabled !== false && h.key)
      const url = resolved ? result!.request.url : draft.url
      return generate(target, { method: draft.method, url, headers, body: draft.body as any, auth: resolved ? { type: 'none' } : (draft.auth as any) })
    } catch (e: any) { return '// ' + e.message }
  }, [target, draft, result, resolved])
  const t = targets.find((x) => x.id === target)
  return (
    <Modal open={open} onClose={onClose} title="Generate code" width="max-w-3xl">
      <div className="flex items-center gap-2 mb-2">
        <select className="input w-56" value={target} onChange={(e) => { setTarget(e.target.value); localStorage.setItem('quiver.codegen', e.target.value) }}>{targets.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
        <span className="text-[11px] faint">{resolved ? 'Using resolved values from the last send' : 'Variables unresolved — send once to fill in real values'}</span>
        <div className="flex-1" />
        <HelpButton topic="codegen" />
        <button className="btn" onClick={async () => { await copy(code); toast('Copied') }}><Copy size={12} /> Copy</button>
      </div>
      <div className="h-[55vh] border divider rounded overflow-hidden"><CodeEditor value={code} lang={t?.language === 'javascript' ? 'javascript' : t?.language === 'json' ? 'json' : 'text'} readOnly wrap /></div>
    </Modal>
  )
}
