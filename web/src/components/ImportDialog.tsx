import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Upload } from 'lucide-react'
import { api } from '@/lib/api'
import { useStore } from '@/store'
import { Modal, toast, Spinner } from '@/components/ui'
import { openHelp } from '@/lib/help'

export default function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const wsId = useStore((s) => s.workspaceId)
  const qc = useQueryClient()
  const [mode, setMode] = useState<'paste' | 'url'>('paste')
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [files, setFiles] = useState<{ name: string; content: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<any>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const pick = async (list: FileList | null) => {
    if (!list) return
    const arr: { name: string; content: string }[] = []
    for (const f of Array.from(list)) arr.push({ name: (f as any).webkitRelativePath || f.name, content: await f.text() })
    setFiles(arr)
    if (arr.length === 1) { setText(arr[0].content); api.post('/import/preview', { content: arr[0].content, filename: arr[0].name }).then(setPreview).catch((e) => setPreview({ error: e.message })) }
    else setPreview({ files: arr.length })
  }
  const run = async () => {
    setBusy(true)
    try {
      const body = files.length > 1 ? { files } : mode === 'url' ? { url } : { content: text, filename: files[0]?.name }
      const r = await api.post(`/workspaces/${wsId}/import`, body)
      toast(`Imported ${r.collectionIds.length} collection(s), ${r.environmentIds.length} environment(s) (${r.format})`)
      qc.invalidateQueries({ queryKey: ['tree'] }); qc.invalidateQueries({ queryKey: ['environments'] })
      setText(''); setFiles([]); setPreview(null); onClose()
    } catch (e: any) { toast(e.message, 'err') } finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title="Import" width="max-w-2xl" footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || (mode === 'paste' ? !text.trim() && files.length < 2 : !url.trim())} onClick={run}>{busy ? <Spinner /> : 'Import'}</button></>}>
      <div className="text-xs muted mb-3">Postman collections / environments / exports, OpenAPI 3 & Swagger 2 (JSON/YAML), cURL commands, HAR files, Insomnia exports, Bruno folders and Quiver exports are detected automatically. <button className="link" onClick={() => { onClose(); openHelp('import-export') }}>Learn more</button></div>
      <div className="flex gap-2 mb-3"><button className={`btn ${mode === 'paste' ? 'btn-primary' : ''}`} onClick={() => setMode('paste')}>File / paste</button><button className={`btn ${mode === 'url' ? 'btn-primary' : ''}`} onClick={() => setMode('url')}>From URL</button></div>
      {mode === 'paste' ? (
        <>
          <div className="border divider rounded p-4 text-center text-xs mb-2 cursor-pointer hover:bg-[var(--bg3)]" onClick={() => fileRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files) }}>
            <Upload size={16} className="mx-auto mb-1 faint" />Drop files here or click to choose (select a whole Bruno folder with multiple files)
            <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => pick(e.target.files)} />
          </div>
          <textarea className="input mono w-full" rows={8} placeholder={'Paste JSON / YAML / cURL here…\n\ncurl -X POST https://api.example.com/items -H "Authorization: Bearer x" -d \'{"a":1}\''} value={text} onChange={(e) => { setText(e.target.value); setFiles([]); setPreview(null) }} onBlur={() => { if (text.trim()) api.post('/import/preview', { content: text }).then(setPreview).catch((e) => setPreview({ error: e.message })) }} />
        </>
      ) : <input className="input" placeholder="https://example.com/openapi.yaml" value={url} onChange={(e) => setUrl(e.target.value)} />}
      {preview && <div className="mt-2 text-xs">{preview.error ? <span style={{ color: 'var(--err)' }}>{preview.error}</span> : preview.files ? <span className="muted">{preview.files} files selected</span> : <span className="muted">Detected <b>{preview.format}</b>: {preview.collections.map((c: any) => `${c.name} (${c.requests} requests)`).join(', ')}{preview.environments.length ? `; environments: ${preview.environments.map((e: any) => e.name).join(', ')}` : ''}</span>}</div>}
    </Modal>
  )
}
