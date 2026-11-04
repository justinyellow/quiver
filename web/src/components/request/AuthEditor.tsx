import { useState } from 'react'
import { api } from '@/lib/api'
import { useStore } from '@/store'
import type { AuthConfig } from '@/lib/types'
import { Field, toast, Toggle } from '@/components/ui'

const TYPES: { v: AuthConfig['type']; l: string }[] = [{ v: 'inherit', l: 'Inherit from parent' }, { v: 'none', l: 'No auth' }, { v: 'basic', l: 'Basic auth' }, { v: 'bearer', l: 'Bearer token' }, { v: 'apikey', l: 'API key' }, { v: 'digest', l: 'Digest auth' }, { v: 'oauth2', l: 'OAuth 2.0' }, { v: 'awsv4', l: 'AWS Signature v4' }]

export default function AuthEditor({ auth, onChange, readOnly, allowInherit = true }: { auth: AuthConfig; onChange: (a: AuthConfig) => void; readOnly?: boolean; allowInherit?: boolean }) {
  const set = (k: string, patch: any) => onChange({ ...auth, [k]: { ...(auth as any)[k], ...patch } })
  const sub = (auth as any)[auth.type] ?? {}
  const In = ({ k, label, type = 'text', hint, section = auth.type }: { k: string; label: string; type?: string; hint?: string; section?: string }) => <Field label={label} hint={hint}><input className="input mono" type={type} value={((auth as any)[section] ?? {})[k] ?? ''} readOnly={readOnly} onChange={(e) => set(section, { [k]: e.target.value })} placeholder={`{{${k}}}`} /></Field>
  return (
    <div className="p-3 max-w-xl overflow-auto h-full">
      <Field label="Type"><select className="input" value={auth.type} disabled={readOnly} onChange={(e) => onChange({ type: e.target.value as any, ...(auth as any) })}>{TYPES.filter((t) => allowInherit || t.v !== 'inherit').map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}</select></Field>
      <div className="text-[11px] faint mb-3">Values support <span className="mono">{'{{variables}}'}</span>. Store secrets in environment variables of type <b>secret</b> (encrypted at rest).</div>
      {auth.type === 'inherit' && <div className="text-xs muted">Uses the auth configured on the parent folder or collection.</div>}
      {auth.type === 'basic' && <><In k="username" label="Username" /><In k="password" label="Password" type="password" /></>}
      {auth.type === 'bearer' && <><In k="token" label="Token" /><In k="prefix" label="Header prefix" hint="Defaults to Bearer" /></>}
      {auth.type === 'apikey' && <><In k="key" label="Key" /><In k="value" label="Value" /><Field label="Add to"><select className="input" value={sub.in ?? 'header'} disabled={readOnly} onChange={(e) => set('apikey', { in: e.target.value })}><option value="header">Header</option><option value="query">Query params</option></select></Field></>}
      {auth.type === 'digest' && <><In k="username" label="Username" /><In k="password" label="Password" type="password" /><div className="text-[11px] faint">MD5 and SHA-256 challenges, qop=auth/auth-int. The 401 challenge round-trip happens automatically.</div></>}
      {auth.type === 'awsv4' && <><In k="accessKey" label="Access key" /><In k="secretKey" label="Secret key" type="password" /><In k="region" label="Region" hint="e.g. us-east-1" /><In k="service" label="Service" hint="e.g. execute-api, s3, lambda" /><In k="sessionToken" label="Session token (optional)" /></>}
      {auth.type === 'oauth2' && <OAuth2 auth={auth} set={(p) => set('oauth2', p)} readOnly={readOnly} />}
    </div>
  )
}

function OAuth2({ auth, set, readOnly }: { auth: AuthConfig; set: (p: any) => void; readOnly?: boolean }) {
  const o = auth.oauth2 ?? {}
  const wsId = useStore((s) => s.workspaceId)
  const envId = useStore((s) => s.environmentId)
  const [busy, setBusy] = useState(false)
  const grant = o.grantType ?? 'authorization_code'
  const In = ({ k, label, type = 'text', hint }: { k: string; label: string; type?: string; hint?: string }) => <Field label={label} hint={hint}><input className="input mono" type={type} value={o[k] ?? ''} readOnly={readOnly} onChange={(e) => set({ [k]: e.target.value })} /></Field>
  const resolve = async (vals: Record<string, string>) => {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(vals)) { if (!v) { out[k] = v; continue } const r = await api.post(`/workspaces/${wsId}/resolve`, { request: { name: 'x', method: 'GET', url: v, params: [], headers: [], body: { mode: 'none' }, auth: { type: 'none' } }, environmentId: envId }); out[k] = r.url.replace(/^http:\/\//, (m: string) => (v.startsWith('http') ? m : '')) }
    return out
  }
  const getToken = async () => {
    setBusy(true)
    try {
      const r = await resolve({ authUrl: o.authUrl ?? '', accessTokenUrl: o.accessTokenUrl ?? '', clientId: o.clientId ?? '', clientSecret: o.clientSecret ?? '', scope: o.scope ?? '', username: o.username ?? '', password: o.password ?? '', audience: o.audience ?? '' })
      if (grant === 'authorization_code' || grant === 'implicit') {
        const { url, state } = await api.post(`/workspaces/${wsId}/oauth2/authorize`, { authUrl: r.authUrl, accessTokenUrl: r.accessTokenUrl || undefined, clientId: r.clientId, clientSecret: r.clientSecret || undefined, scope: r.scope || undefined, audience: r.audience || undefined, usePkce: o.usePkce !== false, clientAuth: o.clientAuth ?? 'header', grantType: grant })
        const w = window.open(url, 'quiver-oauth', 'width=600,height=700')
        for (let i = 0; i < 300; i++) {
          await new Promise((res) => setTimeout(res, 1000))
          const res = await api.get(`/oauth2/result/${state}`).catch(() => null)
          if (res && !res.pending) {
            if (res.error) { toast(res.error, 'err'); break }
            set({ accessToken: res.accessToken, refreshToken: res.refreshToken ?? o.refreshToken, expiresAt: res.expiresIn ? Date.now() + res.expiresIn * 1000 : undefined })
            toast('Token obtained'); break
          }
          if (w && w.closed && i > 2) { const last = await api.get(`/oauth2/result/${state}`).catch(() => null); if (!last || last.pending) toast('Authorization window closed', 'err'); else if (!last.error) { set({ accessToken: last.accessToken, refreshToken: last.refreshToken, expiresAt: last.expiresIn ? Date.now() + last.expiresIn * 1000 : undefined }); toast('Token obtained') } break }
        }
      } else {
        const params: Record<string, string> = { grant_type: grant }
        if (grant === 'password') { params.username = r.username; params.password = r.password }
        if (r.scope) params.scope = r.scope
        if (r.audience) params.audience = r.audience
        const res = await api.post(`/workspaces/${wsId}/oauth2/token`, { accessTokenUrl: r.accessTokenUrl, clientId: r.clientId, clientSecret: r.clientSecret, clientAuth: o.clientAuth ?? 'header', params })
        set({ accessToken: res.accessToken, refreshToken: res.refreshToken, expiresAt: res.expiresIn ? Date.now() + res.expiresIn * 1000 : undefined })
        toast('Token obtained')
      }
    } catch (e: any) { toast(e.message, 'err') } finally { setBusy(false) }
  }
  const refresh = async () => {
    setBusy(true)
    try {
      const r = await resolve({ accessTokenUrl: o.accessTokenUrl ?? '', clientId: o.clientId ?? '', clientSecret: o.clientSecret ?? '', refreshToken: o.refreshToken ?? '' })
      const res = await api.post(`/workspaces/${wsId}/oauth2/token`, { accessTokenUrl: r.accessTokenUrl, clientId: r.clientId, clientSecret: r.clientSecret, clientAuth: o.clientAuth ?? 'header', params: { grant_type: 'refresh_token', refresh_token: r.refreshToken } })
      set({ accessToken: res.accessToken, refreshToken: res.refreshToken ?? o.refreshToken, expiresAt: res.expiresIn ? Date.now() + res.expiresIn * 1000 : undefined }); toast('Token refreshed')
    } catch (e: any) { toast(e.message, 'err') } finally { setBusy(false) }
  }
  return (
    <div>
      <Field label="Grant type"><select className="input" value={grant} disabled={readOnly} onChange={(e) => set({ grantType: e.target.value })}><option value="authorization_code">Authorization code (+ PKCE)</option><option value="client_credentials">Client credentials</option><option value="password">Password credentials</option><option value="implicit">Implicit</option></select></Field>
      <div className="grid grid-cols-2 gap-x-3">
        {(grant === 'authorization_code' || grant === 'implicit') && <In k="authUrl" label="Auth URL" />}
        {grant !== 'implicit' && <In k="accessTokenUrl" label="Access token URL" />}
        <In k="clientId" label="Client ID" /><In k="clientSecret" label="Client secret" type="password" />
        {grant === 'password' && <><In k="username" label="Username" /><In k="password" label="Password" type="password" /></>}
        <In k="scope" label="Scope" /><In k="audience" label="Audience (optional)" />
      </div>
      <div className="grid grid-cols-2 gap-x-3">
        <Field label="Client authentication"><select className="input" value={o.clientAuth ?? 'header'} disabled={readOnly} onChange={(e) => set({ clientAuth: e.target.value })}><option value="header">Basic auth header</option><option value="body">In request body</option></select></Field>
        <Field label="Add token to"><select className="input" value={o.addTo ?? 'header'} disabled={readOnly} onChange={(e) => set({ addTo: e.target.value })}><option value="header">Authorization header</option><option value="query">Query param access_token</option></select></Field>
        <In k="tokenPrefix" label="Header prefix" hint="Defaults to Bearer" />
      </div>
      <div className="flex gap-4 mb-3">{grant === 'authorization_code' && <Toggle checked={o.usePkce !== false} onChange={(v) => set({ usePkce: v })} label="Use PKCE" />}<Toggle checked={o.autoRefresh !== false} onChange={(v) => set({ autoRefresh: v })} label="Auto-refresh / auto-fetch when expired" /></div>
      <div className="border-t divider pt-3 mt-2">
        <Field label="Current access token"><textarea className="input mono" rows={3} value={o.accessToken ?? ''} readOnly={readOnly} onChange={(e) => set({ accessToken: e.target.value })} placeholder="Paste a token or use the button below" /></Field>
        <div className="text-[11px] faint mb-2">{o.expiresAt ? (Date.now() > o.expiresAt ? 'Token expired' : `Expires ${new Date(o.expiresAt).toLocaleString()}`) : 'No expiry known'}{o.refreshToken ? ' · refresh token stored' : ''}</div>
        <div className="flex gap-2"><button className="btn btn-primary" disabled={busy || readOnly} onClick={getToken}>Get new access token</button>{o.refreshToken && <button className="btn" disabled={busy || readOnly} onClick={refresh}>Refresh</button>}{o.accessToken && <button className="btn" disabled={readOnly} onClick={() => set({ accessToken: '', refreshToken: '', expiresAt: undefined })}>Clear</button>}</div>
        <div className="text-[11px] faint mt-2">Callback URL for your provider: <span className="mono">{location.origin}/api/oauth2/callback</span></div>
      </div>
    </div>
  )
}
