import { HelpCircle } from 'lucide-react'
import { openHelp, topic as getTopic } from '@/lib/help'
import { cx } from '@/lib/utils'

export default function HelpButton({ topic, label, className }: { topic: string; label?: string; className?: string }) {
  const t = getTopic(topic)
  return (
    <button className={cx('btn btn-ghost btn-sm muted', className)} title={`Help: ${t?.title ?? 'Guide'}`} onClick={(e) => { e.stopPropagation(); openHelp(topic) }}>
      <HelpCircle size={13} />{label}
    </button>
  )
}
