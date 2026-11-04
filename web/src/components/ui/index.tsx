import React, { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { cx } from '@/lib/utils'

export function Modal({ open, onClose, title, children, width = 'max-w-lg', footer }: { open: boolean; onClose: () => void; title?: React.ReactNode; children: React.ReactNode; width?: string; footer?: React.ReactNode }) {
  useEffect(() => { if (!open) return; const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h) }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/40" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={cx('panel border rounded-lg shadow-xl w-full flex flex-col max-h-[80vh]', width)} style={{ background: 'var(--bg)' }}>
        {title && <div className="flex items-center justify-between px-4 h-10 border-b divider"><div className="font-semibold text-sm">{title}</div><button className="btn btn-ghost btn-sm" onClick={onClose}><X size={14} /></button></div>}
        <div className="p-4 overflow-auto flex-1">{children}</div>
        {footer && <div className="px-4 py-3 border-t divider flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  )
}

export function Confirm({ open, onClose, onConfirm, title, message, danger }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; message?: string; danger?: boolean }) {
  return (
    <Modal open={open} onClose={onClose} title={title} width="max-w-sm" footer={<><button className="btn" onClick={onClose}>Cancel</button><button className={cx('btn', danger ? 'btn-danger' : 'btn-primary')} onClick={() => { onConfirm(); onClose() }}>Confirm</button></>}>
      <div className="text-xs muted">{message}</div>
    </Modal>
  )
}

export function Dropdown({ trigger, items, align = 'left' }: { trigger: React.ReactNode; items: ({ label: React.ReactNode; onClick?: () => void; danger?: boolean; disabled?: boolean } | 'sep')[]; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (!open) return; const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }; window.addEventListener('mousedown', h); return () => window.removeEventListener('mousedown', h) }, [open])
  return (
    <div className="relative inline-block" ref={ref}>
      <div onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}>{trigger}</div>
      {open && (
        <div className={cx('absolute z-40 mt-1 min-w-[160px] panel border rounded shadow-lg py-1', align === 'right' ? 'right-0' : 'left-0')} style={{ background: 'var(--bg)' }}>
          {items.map((it, i) => it === 'sep' ? <div key={i} className="border-t divider my-1" /> : (
            <button key={i} disabled={it.disabled} className={cx('w-full text-left px-3 h-7 text-xs hover:bg-[var(--bg3)] disabled:opacity-50', it.danger && 'text-[var(--err)]')} onClick={(e) => { e.stopPropagation(); setOpen(false); it.onClick?.() }}>{it.label}</button>
          ))}
        </div>
      )}
    </div>
  )
}

export function Tabs({ tabs, active, onChange, right }: { tabs: { id: string; label: React.ReactNode; count?: number }[]; active: string; onChange: (id: string) => void; right?: React.ReactNode }) {
  return (
    <div className="flex items-center border-b divider shrink-0 px-1">
      {tabs.map((t) => <div key={t.id} className={cx('tab', active === t.id && 'active')} onClick={() => onChange(t.id)}>{t.label}{t.count ? <span className="badge" style={{ background: 'var(--bg3)', color: 'var(--fg2)' }}>{t.count}</span> : null}</div>)}
      <div className="flex-1" />
      {right}
    </div>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: React.ReactNode }) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer text-xs select-none">
      <span className={cx('w-7 h-4 rounded-full relative transition-colors', checked ? 'bg-[var(--accent)]' : 'bg-[var(--bg3)] border divider')} onClick={() => onChange(!checked)}>
        <span className={cx('absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all', checked ? 'left-3.5' : 'left-0.5')} />
      </span>
      {label}
    </label>
  )
}

export function Spinner({ size = 14 }: { size?: number }) {
  return <svg className="spin" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><circle cx="12" cy="12" r="9" opacity="0.25" /><path d="M21 12a9 9 0 0 0-9-9" /></svg>
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return <div className="flex flex-col items-center justify-center h-full gap-2 p-8 text-center"><div className="text-sm font-medium muted">{title}</div><div className="text-xs faint max-w-sm">{children}</div></div>
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <label className="block mb-3"><div className="text-[11px] font-medium muted mb-1">{label}</div>{children}{hint && <div className="text-[11px] faint mt-1">{hint}</div>}</label>
}

let toastFn: ((m: string, kind?: 'ok' | 'err') => void) | null = null
export function toast(m: string, kind: 'ok' | 'err' = 'ok') { toastFn?.(m, kind) }
export function Toaster() {
  const [items, setItems] = useState<{ id: number; m: string; kind: string }[]>([])
  useEffect(() => { toastFn = (m, kind = 'ok') => { const id = Date.now() + Math.random(); setItems((x) => [...x, { id, m, kind }]); setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 3500) }; return () => { toastFn = null } }, [])
  return <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2">{items.map((i) => <div key={i.id} className="px-3 py-2 rounded shadow-lg text-xs text-white" style={{ background: i.kind === 'err' ? 'var(--err)' : 'var(--fg)', color: i.kind === 'err' ? '#fff' : 'var(--bg)' }}>{i.m}</div>)}</div>
}

export function useResizable(initial: number, dir: 'x' | 'y', min = 150, max = 2000) {
  const [size, setSize] = useState(initial)
  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    const start = dir === 'x' ? e.clientX : e.clientY
    const startSize = size
    const move = (ev: MouseEvent) => setSize(Math.max(min, Math.min(max, startSize + ((dir === 'x' ? ev.clientX : ev.clientY) - start))))
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  }
  return { size, setSize, onMouseDown }
}
