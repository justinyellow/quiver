import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Trash2, Download } from 'lucide-react'
import { api } from '@/lib/api'
import { useStore, useWorkspace } from '@/store'
import type { Tab } from '@/lib/types'
import { Field, Tabs, Toggle, toast, Modal } from '@/components/ui'
import { copy, fmtDate, cx } from '@/lib/utils'
import HelpButton from '@/components/HelpButton'

export default function SettingsPage({ tab }: { tab: Tab }) {
  if (tab.entityId === 'account') return <Account />
  if (tab.entityId === 'admin') return <Admin />
  return <WorkspaceSettings />
}

function WorkspaceSettings() {
  const { workspaceId, user, setUser, setWorkspace } = useStore()
  const ws = useWorkspace()
  const qc = useQueryClient()
  const data = useQuery({ queryKey: ['workspace', workspaceId], queryFn: () => api.get(`/workspaces/${workspaceId}`) })
  const audit = useQuery({ queryKey: ['audit', workspaceId], queryFn: () => api.get(`/workspaces/${workspaceId}/audit?limit=200`), enabled: data.data?.role === 'admin' || user?.role === 'admin' })
  const [section, setSection] = useState('members')
  const [email, setEmail] = useState(''); const [role, setRole] = useState('editor')
  const [name, setName] = useState('')
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  useEffect(() => { if (data.data) setName(data.data.name) }, [data.data])
  const isAdmin = data.data?.role === 'admin' || user?.role === 'admin'
  const refresh = () => qc.invalidateQueries({ queryKey: ['workspace', workspaceId] })
  const invite = async () => { try { const r = await api.post(`/workspaces/${workspaceId}/invites`, { email, role }); if (r.added) toast('Member added'); else { setInviteLink(r.link); toast(r.mailed ? 'Invite emailed' : 'Invite created — share the link') } setEmail(''); refresh() } catch (e: any) { toast(e.message, 'err') } }
  if (!data.data) return null
  return (
    <div className="flex flex-col h-full text-xs">
      <div className="h-10 flex items-center px-4 border-b divider font-medium">Workspace settings · {data.data.name}<div className="flex-1" /><HelpButton topic="collaboration" /></div>
      <Tabs active={section} onChange={setSection} tabs={[{ id: 'members', label: 'Members', count: data.data.members.length }, { id: 'general', label: 'General' }, ...(isAdmin ? [{ id: 'audit', label: 'Audit log' }] : [])]} />
      <div className="flex-1 overflow-auto p-4 max-w-3xl">
        {section === 'members' && <>
          {isAdmin && <div className="flex gap-2 mb-4 items-end"><Field label="Invite by email"><input className="input w-72" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colleague@company.com" /></Field><Field label="Role"><select className="input w-28" value={role} onChange={(e) => setRole(e.target.value)}><option value="viewer">Viewer</option><option value="editor">Editor</option><option value="admin">Admin</option></select></Field><button className="btn btn-primary mb-3" disabled={!email} onClick={invite}>Invite</button></div>}
          {inviteLink && <div className="mb-4 p-2 rounded border divider" style={{ background: 'var(--sel)' }}>Invite link (valid 7 days): <div className="flex gap-1 mt-1"><input className="input mono" readOnly value={inviteLink} /><button className="btn" onClick={async () => { await copy(inviteLink); toast('Copied') }}><Copy size={12} /></button></div></div>}
          <table className="w-full"><thead><tr className="faint text-[10px] uppercase text-left"><th className="py-1">Name</th><th>Email</th><th>Role</th><th></th></tr></thead><tbody>{data.data.members.map((m: any) => <tr key={m.id} className="border-t divider"><td className="py-1.5">{m.name}</td><td className="muted">{m.email}</td><td>{isAdmin && m.id !== user?.id ? <select className="input w-24 h-6" value={m.role} onChange={async (e) => { await api.patch(`/workspaces/${workspaceId}/members/${m.id}`, { role: e.target.value }); refresh() }}><option value="viewer">viewer</option><option value="editor">editor</option><option value="admin">admin</option></select> : m.role}</td><td className="text-right">{(isAdmin || m.id === user?.id) && <button className="btn btn-ghost btn-sm" title={m.id === user?.id ? 'Leave workspace' : 'Remove'} onClick={async () => { if (!confirm(m.id === user?.id ? 'Leave this workspace?' : `Remove ${m.name}?`)) return; await api.del(`/workspaces/${workspaceId}/members/${m.id}`); if (m.id === user?.id) { const me = await api.get('/auth/me'); setUser(me.user, me.workspaces); setWorkspace(me.workspaces[0].id) } else refresh() }}><Trash2 size={11} /></button>}</td></tr>)}</tbody></table>
          <div className="faint mt-3">Viewers can send requests and read everything; editors can change collections, environments, mocks and monitors; admins manage members.</div>
        </>}
        {section === 'general' && <>
          <Field label="Workspace name"><input className="input w-72" value={name} readOnly={!isAdmin || data.data.type === 'personal'} onChange={(e) => setName(e.target.value)} /></Field>
          {isAdmin && data.data.type !== 'personal' && <button className="btn btn-primary" onClick={async () => { await api.patch(`/workspaces/${workspaceId}`, { name }); const me = await api.get('/auth/me'); setUser(me.user, me.workspaces); refresh(); toast('Saved') }}>Save</button>}
          <div className="mt-6 font-medium mb-1">Export whole workspace</div>
          <div className="flex gap-2"><a className="btn" href={`/api/workspaces/${workspaceId}/export`} download><Download size={12} /> Export (secrets blanked)</a>{isAdmin && <a className="btn" href={`/api/workspaces/${workspaceId}/export?secrets=true`} download><Download size={12} /> Export incl. secrets</a>}</div>
          <div className="faint mt-1">Quiver JSON with all collections and environments. Re-import via the Import dialog.</div>
          {isAdmin && data.data.type !== 'personal' && <div className="mt-8 border-t divider pt-4"><div className="font-medium mb-1" style={{ color: 'var(--err)' }}>Danger zone</div><button className="btn btn-danger" onClick={async () => { if (prompt(`Type the workspace name "${data.data.name}" to delete it with everything inside:`) !== data.data.name) return; await api.del(`/workspaces/${workspaceId}`); const me = await api.get('/auth/me'); setUser(me.user, me.workspaces); setWorkspace(me.workspaces[0].id) }}>Delete workspace</button></div>}
        </>}
        {section === 'audit' && <AuditTable rows={audit.data ?? []} />}
      </div>
    </div>
  )
}

function AuditTable({ rows }: { rows: any[] }) {
  return <table className="w-full"><thead><tr className="faint text-[10px] uppercase text-left"><th className="py-1">When</th><th>Who</th><th>Action</th><th>Entity</th><th>Details</th><th>IP</th></tr></thead><tbody>{rows.map((a) => <tr key={a.id} className="border-t divider align-top"><td className="py-1 faint whitespace-nowrap">{fmtDate(a.created_at)}</td><td>{a.user_name ?? a.user_email ?? '—'}</td><td className="mono">{a.action}</td><td className="faint">{a.entity_type}{a.workspace_name ? ` · ${a.workspace_name}` : ''}</td><td className="mono faint truncate max-w-xs">{Object.keys(a.meta ?? {}).length ? JSON.stringify(a.meta) : ''}</td><td className="faint">{a.ip}</td></tr>)}</tbody></table>
}

function Account() {
  const { user, setUser, workspaces } = useStore()
  const qc = useQueryClient()
  const tokens = useQuery({ queryKey: ['tokens'], queryFn: () => api.get('/auth/tokens') })
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api.get('/auth/sessions') })
  const [name, setName] = useState(user?.name ?? '')
  const [pw, setPw] = useState({ current: '', next: '' })
  const [tokName, setTokName] = useState(''); const [tokDays, setTokDays] = useState('')
  const [newTok, setNewTok] = useState<string | null>(null)
  const [totp, setTotp] = useState<{ secret: string; otpauth: string } | null>(null); const [code, setCode] = useState('')
  return (
    <div className="overflow-auto h-full p-4 text-xs max-w-2xl space-y-8">
      <div className="flex justify-end gap-1 -mb-6"><HelpButton topic="security" label="Security help" /><HelpButton topic="ci" label="API tokens & CI" /></div>
      <section><div className="font-semibold text-sm mb-2">Profile</div><Field label="Name"><input className="input w-72" value={name} onChange={(e) => setName(e.target.value)} /></Field><button className="btn btn-primary" onClick={async () => { await api.patch('/auth/profile', { name }); setUser({ ...user!, name }, workspaces); toast('Saved') }}>Save</button><div className="faint mt-2">{user?.email} · {user?.role}</div></section>
      <section><div className="font-semibold text-sm mb-2">Password</div><div className="flex gap-2 items-end"><Field label="Current"><input className="input" type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field><Field label="New (10+ chars)"><input className="input" type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field><button className="btn mb-3" disabled={pw.next.length < 10} onClick={async () => { try { await api.post('/auth/password', pw); setPw({ current: '', next: '' }); toast('Password changed; other sessions signed out') } catch (e: any) { toast(e.message, 'err') } }}>Change</button></div></section>
      <section><div className="font-semibold text-sm mb-2">Two-factor authentication (TOTP)</div>
        {user?.totp_enabled ? <div className="flex items-center gap-3"><span className="text-[var(--ok)]">Enabled</span><button className="btn" onClick={async () => { const p = prompt('Enter your password to disable 2FA'); if (!p) return; try { await api.post('/auth/totp/disable', { password: p }); setUser({ ...user, totp_enabled: false }, workspaces); toast('2FA disabled') } catch (e: any) { toast(e.message, 'err') } }}>Disable</button></div>
          : totp ? <div><div className="mb-2">Add this secret to your authenticator app (Google Authenticator, 1Password, Authy…):</div><div className="mono p-2 rounded border divider inline-block mb-2 select-all">{totp.secret}</div><div className="faint mb-2 break-all">or URI: {totp.otpauth}</div><div className="flex gap-2 items-end"><Field label="Code from app"><input className="input mono w-32" value={code} onChange={(e) => setCode(e.target.value)} /></Field><button className="btn btn-primary mb-3" onClick={async () => { try { await api.post('/auth/totp/enable', { code }); setUser({ ...user!, totp_enabled: true }, workspaces); setTotp(null); toast('2FA enabled') } catch (e: any) { toast(e.message, 'err') } }}>Verify & enable</button></div></div>
          : <button className="btn" onClick={async () => setTotp(await api.post('/auth/totp/setup'))}>Set up 2FA</button>}
      </section>
      <section><div className="font-semibold text-sm mb-2">API tokens</div><div className="faint mb-2">Use with the REST API or CI: <span className="mono">Authorization: Bearer qv_…</span>. Tokens inherit your permissions.</div>
        <div className="flex gap-2 items-end"><Field label="Name"><input className="input w-56" value={tokName} onChange={(e) => setTokName(e.target.value)} placeholder="CI pipeline" /></Field><Field label="Expires in days (optional)"><input className="input w-32" type="number" value={tokDays} onChange={(e) => setTokDays(e.target.value)} /></Field><button className="btn btn-primary mb-3" disabled={!tokName} onClick={async () => { const r = await api.post('/auth/tokens', { name: tokName, expiresInDays: tokDays ? Number(tokDays) : undefined }); setNewTok(r.token); setTokName(''); qc.invalidateQueries({ queryKey: ['tokens'] }) }}>Create</button></div>
        {newTok && <div className="p-2 rounded border divider mb-2" style={{ background: 'var(--sel)' }}>Copy your token now — it will not be shown again.<div className="flex gap-1 mt-1"><input className="input mono" readOnly value={newTok} /><button className="btn" onClick={async () => { await copy(newTok); toast('Copied') }}><Copy size={12} /></button></div></div>}
        <table className="w-full"><tbody>{(tokens.data ?? []).map((t: any) => <tr key={t.id} className="border-t divider"><td className="py-1">{t.name}</td><td className="mono faint">{t.token_prefix}…</td><td className="faint">created {fmtDate(t.created_at)}</td><td className="faint">{t.last_used_at ? `used ${fmtDate(t.last_used_at)}` : 'never used'}</td><td className="faint">{t.expires_at ? `expires ${fmtDate(t.expires_at)}` : ''}</td><td className="text-right"><button className="btn btn-ghost btn-sm" onClick={async () => { await api.del(`/auth/tokens/${t.id}`); qc.invalidateQueries({ queryKey: ['tokens'] }) }}><Trash2 size={11} /></button></td></tr>)}</tbody></table>
      </section>
      <section><div className="font-semibold text-sm mb-2">Sessions</div><table className="w-full"><tbody>{(sessions.data ?? []).map((s: any) => <tr key={s.id} className="border-t divider"><td className="py-1">{s.current ? <b>This session</b> : 'Session'}</td><td className="faint">{s.ip}</td><td className="faint truncate max-w-xs">{s.user_agent}</td><td className="faint">{fmtDate(s.created_at)}</td><td className="text-right">{!s.current && <button className="btn btn-ghost btn-sm" onClick={async () => { await api.del(`/auth/sessions/${s.id}`); qc.invalidateQueries({ queryKey: ['sessions'] }) }}>Revoke</button>}</td></tr>)}</tbody></table></section>
    </div>
  )
}

function Admin() {
  const qc = useQueryClient()
  const [section, setSection] = useState('users')
  const users = useQuery({ queryKey: ['admin-users'], queryFn: () => api.get('/admin/users') })
  const invites = useQuery({ queryKey: ['admin-invites'], queryFn: () => api.get('/admin/invites') })
  const settings = useQuery({ queryKey: ['admin-settings'], queryFn: () => api.get('/admin/settings') })
  const stats = useQuery({ queryKey: ['admin-stats'], queryFn: () => api.get('/admin/stats') })
  const audit = useQuery({ queryKey: ['admin-audit'], queryFn: () => api.get('/admin/audit?limit=300'), enabled: section === 'audit' })
  const [email, setEmail] = useState(''); const [role, setRole] = useState('user'); const [link, setLink] = useState<string | null>(null)
  const [form, setForm] = useState<any>(null)
  useEffect(() => { if (settings.data && !form) setForm({ allowSignup: settings.data.settings.allowSignup ?? settings.data.env.allowSignup, historyRetentionDays: settings.data.settings.historyRetentionDays ?? 30, blockedHosts: (settings.data.settings.blockedHosts ?? []).join(', '), allowPrivateTargets: settings.data.settings.allowPrivateTargets ?? settings.data.env.allowPrivateTargets, allowLoopbackTargets: settings.data.settings.allowLoopbackTargets ?? settings.data.env.allowLoopbackTargets, proxyUrl: settings.data.settings.proxyUrl ?? '', instanceName: settings.data.settings.instanceName ?? '' }) }, [settings.data]) // eslint-disable-line
  const me = useStore((s) => s.user)
  return (
    <div className="flex flex-col h-full text-xs">
      <div className="h-10 flex items-center gap-4 px-4 border-b divider font-medium"><HelpButton topic="admin" className="-ml-2" />Instance administration {stats.data && <span className="faint font-normal">{stats.data.users} users · {stats.data.workspaces} workspaces · {stats.data.collections} collections · {stats.data.requests} requests · {stats.data.runs} runs · {stats.data.monitors} monitors · {stats.data.mocks} mocks</span>}</div>
      <Tabs active={section} onChange={setSection} tabs={[{ id: 'users', label: 'Users' }, { id: 'settings', label: 'Settings' }, { id: 'audit', label: 'Audit log' }]} />
      <div className="flex-1 overflow-auto p-4">
        {section === 'users' && <div className="max-w-4xl">
          <div className="flex gap-2 items-end mb-3"><Field label="Invite user"><input className="input w-72" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" /></Field><Field label="Role"><select className="input w-28" value={role} onChange={(e) => setRole(e.target.value)}><option value="user">user</option><option value="admin">admin</option></select></Field><button className="btn btn-primary mb-3" disabled={!email} onClick={async () => { const r = await api.post('/admin/invites', { email, role }); setLink(r.link); setEmail(''); qc.invalidateQueries({ queryKey: ['admin-invites'] }); toast(r.mailed ? 'Invite emailed' : 'Invite created — share the link') }}>Invite</button></div>
          {link && <div className="mb-4 p-2 rounded border divider" style={{ background: 'var(--sel)' }}>Invite link: <div className="flex gap-1 mt-1"><input className="input mono" readOnly value={link} /><button className="btn" onClick={async () => { await copy(link); toast('Copied') }}><Copy size={12} /></button></div></div>}
          <table className="w-full"><thead><tr className="faint text-[10px] uppercase text-left"><th className="py-1">Name</th><th>Email</th><th>Role</th><th>2FA</th><th>SSO</th><th>Last login</th><th></th></tr></thead><tbody>{(users.data ?? []).map((u: any) => <tr key={u.id} className={cx('border-t divider', u.disabled && 'opacity-50')}><td className="py-1.5">{u.name}</td><td className="muted">{u.email}</td><td><select className="input w-24 h-6" value={u.role} disabled={u.id === me?.id} onChange={async (e) => { await api.patch(`/admin/users/${u.id}`, { role: e.target.value }); qc.invalidateQueries({ queryKey: ['admin-users'] }) }}><option value="user">user</option><option value="admin">admin</option></select></td><td>{u.totp_enabled ? '✓' : ''}</td><td>{u.sso ? '✓' : ''}</td><td className="faint">{u.last_login_at ? fmtDate(u.last_login_at) : 'never'}</td><td className="text-right whitespace-nowrap">{u.id !== me?.id && <><button className="btn btn-ghost btn-sm" onClick={async () => { await api.patch(`/admin/users/${u.id}`, { disabled: !u.disabled }); qc.invalidateQueries({ queryKey: ['admin-users'] }) }}>{u.disabled ? 'Enable' : 'Disable'}</button><button className="btn btn-ghost btn-sm" onClick={async () => { const r = await api.post(`/admin/users/${u.id}/reset-password`); setLink(r.link); toast(r.mailed ? 'Reset link emailed' : 'Reset link created — share it') }}>Reset pw</button><button className="btn btn-ghost btn-sm text-[var(--err)]" onClick={async () => { if (confirm(`Delete ${u.email}? Their personal workspace is deleted too.`)) { await api.del(`/admin/users/${u.id}`); qc.invalidateQueries({ queryKey: ['admin-users'] }) } }}><Trash2 size={11} /></button></>}</td></tr>)}</tbody></table>
          {invites.data?.filter((i: any) => !i.accepted_at).length > 0 && <div className="mt-6"><div className="font-medium mb-1">Pending invites</div><table className="w-full">{invites.data.filter((i: any) => !i.accepted_at).map((i: any) => <tr key={i.id} className="border-t divider"><td className="py-1">{i.email}</td><td className="faint">{i.role}{i.workspace_name ? ` → ${i.workspace_name} (${i.workspace_role})` : ''}</td><td className="faint">expires {fmtDate(i.expires_at)}</td><td className="text-right"><button className="btn btn-ghost btn-sm" onClick={async () => { await api.del(`/admin/invites/${i.id}`); qc.invalidateQueries({ queryKey: ['admin-invites'] }) }}>Revoke</button></td></tr>)}</table></div>}
        </div>}
        {section === 'settings' && form && <div className="max-w-xl">
          <Field label="Instance name"><input className="input" value={form.instanceName} onChange={(e) => setForm({ ...form, instanceName: e.target.value })} placeholder="Quiver" /></Field>
          <div className="space-y-2 mb-4"><Toggle checked={form.allowSignup} onChange={(v) => setForm({ ...form, allowSignup: v })} label="Allow self-signup (otherwise invite-only)" /><Toggle checked={form.allowPrivateTargets} onChange={(v) => setForm({ ...form, allowPrivateTargets: v })} label="Allow requests to private networks (10/8, 172.16/12, 192.168/16)" /><Toggle checked={form.allowLoopbackTargets} onChange={(v) => setForm({ ...form, allowLoopbackTargets: v })} label="Allow requests to localhost / loopback (from the server's perspective)" /></div>
          <Field label="Blocked hosts (comma-separated, *.example.com allowed)"><input className="input mono" value={form.blockedHosts} onChange={(e) => setForm({ ...form, blockedHosts: e.target.value })} /></Field>
          <Field label="Outbound HTTP proxy URL (optional)"><input className="input mono" value={form.proxyUrl} onChange={(e) => setForm({ ...form, proxyUrl: e.target.value })} placeholder="http://proxy.internal:3128" /></Field>
          <Field label="History retention (days)"><input className="input w-32" type="number" value={form.historyRetentionDays} onChange={(e) => setForm({ ...form, historyRetentionDays: Number(e.target.value) })} /></Field>
          <button className="btn btn-primary" onClick={async () => { await api.patch('/admin/settings', { ...form, blockedHosts: form.blockedHosts.split(',').map((s: string) => s.trim()).filter(Boolean) }); qc.invalidateQueries({ queryKey: ['admin-settings'] }); toast('Saved') }}>Save</button>
          <div className="mt-6 faint space-y-1"><div>Link-local and cloud metadata addresses (169.254.0.0/16) are always blocked.</div><div>Server env: OIDC {settings.data?.env.oidcEnabled ? 'configured' : 'not configured'} · SMTP {settings.data?.env.smtpEnabled ? 'configured' : 'not configured'} · base URL {settings.data?.env.baseUrl} · max response {Math.round(settings.data?.env.maxResponseBytes / 1048576)} MB · script timeout {settings.data?.env.scriptTimeoutMs} ms</div></div>
        </div>}
        {section === 'audit' && <AuditTable rows={audit.data ?? []} />}
      </div>
    </div>
  )
}
void Modal
