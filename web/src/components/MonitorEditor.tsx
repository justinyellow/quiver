import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Save, Trash2, Play } from 'lucide-react'
import { api } from '@/lib/api'
import { useStore, useWorkspace, canEdit } from '@/store'
import type { Tab } from '@/lib/types'
import { Field, Toggle, toast } from '@/components/ui'
import { useTree } from '@/components/sidebar/Sidebar'
import HelpButton from '@/components/HelpButton'
import { cx, fmtDate, fmtMs, timeAgo } from '@/lib/utils'

const PRESETS = [['Every 5 minutes', '*/5 * * * *'], ['Every 15 minutes', '*/15 * * * *'], ['Hourly', '0 * * * *'], ['Daily at 08:00', '0 8 * * *'], ['Weekdays at 08:00', '0 8 * * 1-5'], ['Weekly (Mon 08:00)', '0 8 * * 1']]

export default function MonitorEditor({ tab }: { tab: Tab }) {
  const { workspaceId, updateTab, closeTab, openTab } = useStore()
  const ws = useWorkspace(); const user = useStore((s) => s.user); const editable = canEdit(ws, user)
  const qc = useQueryClient()
  const tree = useTree()
  const envs = useQuery({ queryKey: ['environments', workspaceId], queryFn: () => api.get(`/workspaces/${workspaceId}/environments`) })
  const isNew = tab.entityId === 'new'
  const mons = useQuery({ queryKey: ['monitors', workspaceId], queryFn: () => api.get(`/workspaces/${workspaceId}/monitors`) })
  const mon = mons.data?.find((m: any) => m.id === tab.entityId)
  const runs = useQuery({ queryKey: ['monitor-runs', tab.entityId], queryFn: () => api.get(`/monitors/${tab.entityId}/runs`), enabled: !isNew, refetchInterval: 15000 })
  const [form, setForm] = useState<any>({ name: '', collectionId: tab.meta?.collectionId ?? '', environmentId: null, schedule: '*/15 * * * *', enabled: true, notify: { webhookUrl: '', emails: [], onFailureOnly: true, onRecovery: true } })
  const [emails, setEmails] = useState('')
  useEffect(() => { if (mon) { setForm({ name: mon.name, collectionId: mon.collection_id, environmentId: mon.environment_id, schedule: mon.schedule, enabled: mon.enabled, notify: { onFailureOnly: true, onRecovery: true, ...mon.notify } }); setEmails((mon.notify?.emails ?? []).join(', ')) } }, [mon])
  const save = async () => {
    const body = { ...form, notify: { ...form.notify, emails: emails.split(',').map((s) => s.trim()).filter(Boolean), webhookUrl: form.notify.webhookUrl || undefined } }
    try {
      if (isNew) { const r = await api.post(`/workspaces/${workspaceId}/monitors`, body); updateTab(tab.id, { entityId: r.id, title: r.name }) }
      else await api.patch(`/monitors/${tab.entityId}`, body)
      qc.invalidateQueries({ queryKey: ['monitors'] }); toast('Saved')
    } catch (e: any) { toast(e.message + (e.details ? ': ' + JSON.stringify(e.details.fieldErrors) : ''), 'err') }
  }
  const stats = runs.data?.length ? { total: runs.data.length, passed: runs.data.filter((r: any) => r.status === 'passed').length } : null
  return (
    <div className="flex h-full min-h-0 text-xs">
      <div className="w-96 border-r divider p-4 overflow-auto shrink-0">
        <div className="flex justify-end -mt-2 mb-1"><HelpButton topic="monitors" label="How monitors work" /></div><Field label="Name"><input className="input" value={form.name} readOnly={!editable} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Collection"><select className="input" value={form.collectionId} disabled={!editable} onChange={(e) => setForm({ ...form, collectionId: e.target.value })}><option value="">Select…</option>{tree.data?.collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Environment"><select className="input" value={form.environmentId ?? ''} disabled={!editable} onChange={(e) => setForm({ ...form, environmentId: e.target.value || null })}><option value="">None</option>{(envs.data ?? []).filter((e: any) => !e.is_global).map((e: any) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></Field>
        <Field label="Schedule (cron, server time)"><div className="flex gap-1"><input className="input mono" value={form.schedule} readOnly={!editable} onChange={(e) => setForm({ ...form, schedule: e.target.value })} /><select className="input w-40" value="" disabled={!editable} onChange={(e) => e.target.value && setForm({ ...form, schedule: e.target.value })}><option value="">Presets…</option>{PRESETS.map(([l, v]) => <option key={v} value={v}>{l}</option>)}</select></div></Field>
        <Field label="Webhook URL (POST JSON on alert)" hint="Works with Slack/Discord/Teams incoming webhooks and generic endpoints."><input className="input mono" value={form.notify.webhookUrl ?? ''} readOnly={!editable} onChange={(e) => setForm({ ...form, notify: { ...form.notify, webhookUrl: e.target.value } })} placeholder="https://hooks.slack.com/…" /></Field>
        <Field label="Email recipients (comma-separated)" hint="Requires SMTP_URL to be configured on the server."><input className="input" value={emails} readOnly={!editable} onChange={(e) => setEmails(e.target.value)} /></Field>
        <div className="space-y-2 mb-4"><Toggle checked={form.enabled} onChange={(v) => editable && setForm({ ...form, enabled: v })} label="Enabled" /><Toggle checked={form.notify.onFailureOnly !== false} onChange={(v) => editable && setForm({ ...form, notify: { ...form.notify, onFailureOnly: v } })} label="Notify on failures only (otherwise every run)" /><Toggle checked={form.notify.onRecovery !== false} onChange={(v) => editable && setForm({ ...form, notify: { ...form.notify, onRecovery: v } })} label="Notify on recovery" /></div>
        {editable && <div className="flex gap-2"><button className="btn btn-primary" disabled={!form.name || !form.collectionId} onClick={save}><Save size={12} /> Save</button>{!isNew && <button className="btn" onClick={async () => { const r = await api.post(`/monitors/${tab.entityId}/run`); toast('Run started'); setTimeout(() => qc.invalidateQueries({ queryKey: ['monitor-runs', tab.entityId] }), 1500); openTab({ type: 'run', entityId: r.runId, title: `Run: ${form.name}` }) }}><Play size={12} /> Run now</button>}{!isNew && <button className="btn btn-danger ml-auto" onClick={async () => { if (confirm('Delete monitor?')) { await api.del(`/monitors/${tab.entityId}`); qc.invalidateQueries({ queryKey: ['monitors'] }); closeTab(tab.id) } }}><Trash2 size={12} /></button>}</div>}
        {mon && <div className="mt-4 faint">Last run: {mon.last_run_at ? `${timeAgo(mon.last_run_at)} (${mon.last_status})` : 'never'} · Next: {mon.next_run_at ? fmtDate(mon.next_run_at) : '—'}</div>}
      </div>
      <div className="flex-1 min-w-0 overflow-auto">
        <div className="h-9 flex items-center gap-3 px-3 border-b divider font-medium">Run history {stats && <span className="faint font-normal">{stats.passed}/{stats.total} passed ({Math.round((stats.passed / stats.total) * 100)}% uptime)</span>}</div>
        {runs.data?.length > 0 && <div className="flex gap-px p-3 flex-wrap">{[...runs.data].reverse().map((r: any) => <div key={r.id} title={`${fmtDate(r.started_at)}: ${r.status}`} className={cx('w-2 h-6 rounded-sm cursor-pointer', r.status === 'passed' ? 'bg-[var(--ok)]' : r.status === 'running' ? 'bg-[var(--info)]' : 'bg-[var(--err)]')} onClick={() => openTab({ type: 'run', entityId: r.id, title: `Run: ${form.name}` })} />)}</div>}
        <table className="w-full"><tbody>{(runs.data ?? []).map((r: any) => <tr key={r.id} className="border-b divider cursor-pointer hover:bg-[var(--bg2)]" onClick={() => openTab({ type: 'run', entityId: r.id, title: `Run: ${form.name}` })}><td className="px-3 py-1.5"><span className={cx('badge', r.status === 'passed' ? 'bg-[var(--ok)]' : r.status === 'running' ? 'bg-[var(--info)]' : 'bg-[var(--err)]')} style={{ color: '#fff' }}>{r.status}</span></td><td className="faint">{fmtDate(r.started_at)}</td><td>{r.summary?.total !== undefined ? `${r.summary.passed}/${r.summary.total} requests, ${r.summary.testsPassed}/${r.summary.testsTotal} tests` : ''}</td><td className="muted text-right px-3">{r.summary?.durationMs !== undefined ? fmtMs(r.summary.durationMs) : ''}</td></tr>)}</tbody></table>
        {!runs.data?.length && <div className="p-4 faint">No runs yet.</div>}
      </div>
    </div>
  )
}
