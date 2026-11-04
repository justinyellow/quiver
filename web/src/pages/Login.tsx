import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { api } from '@/lib/api'
import { useStore } from '@/store'
import { Field } from '@/components/ui'

export default function Login({ mode }: { mode: 'login' | 'register' }) {
  const [status, setStatus] = useState<any>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [totp, setTotp] = useState('')
  const [mfa, setMfa] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [sp] = useSearchParams()
  const invite = sp.get('invite') || ''
  const nav = useNavigate()
  const setUser = useStore((s) => s.setUser)
  useEffect(() => { api.get('/auth/status').then(setStatus); if (sp.get('email')) setEmail(sp.get('email')!) }, [sp])
  const isRegister = mode === 'register' || status?.needsSetup
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true)
    try {
      if (isRegister) await api.post('/auth/register', { email, password, name: name || undefined, invite: invite || undefined })
      else {
        const r = await api.post('/auth/login', { email, password, totp: totp || undefined })
        if (r.mfaRequired) { setMfa(true); setBusy(false); return }
      }
      const me = await api.get('/auth/me')
      setUser(me.user, me.workspaces)
      nav('/')
    } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="h-full flex items-center justify-center" style={{ background: 'var(--bg2)' }}>
      <form onSubmit={submit} className="w-[360px] panel border rounded-lg p-6 shadow-sm" style={{ background: 'var(--bg)' }}>
        <div className="flex items-center gap-2 mb-5"><Logo /><div><div className="font-semibold text-base">Quiver</div><div className="text-[11px] faint">Self-hosted API platform</div></div></div>
        {status?.needsSetup && <div className="text-xs mb-4 p-2 rounded" style={{ background: 'var(--sel)' }}>Welcome! Create the first account — it becomes the instance admin.</div>}
        {invite && <div className="text-xs mb-4 p-2 rounded" style={{ background: 'var(--sel)' }}>You've been invited. Create your account to join.</div>}
        {isRegister && <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>}
        <Field label="Email"><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus={!isRegister} readOnly={!!invite} /></Field>
        <Field label="Password" hint={isRegister ? 'At least 10 characters' : undefined}><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={isRegister ? 10 : 1} /></Field>
        {mfa && <Field label="Two-factor code"><input className="input mono" value={totp} onChange={(e) => setTotp(e.target.value)} autoFocus inputMode="numeric" /></Field>}
        {err && <div className="text-xs mb-3" style={{ color: 'var(--err)' }}>{err}</div>}
        <button className="btn btn-primary w-full justify-center h-8" disabled={busy}>{isRegister ? 'Create account' : 'Sign in'}</button>
        {status?.oidcEnabled && !isRegister && <a className="btn w-full justify-center h-8 mt-2" href="/api/auth/oidc/start">Continue with {status.oidcLabel}</a>}
        <div className="text-[11px] faint mt-4 text-center">
          {isRegister && !status?.needsSetup ? <Link className="link" to="/login">Already have an account? Sign in</Link> : status?.allowSignup ? <Link className="link" to="/register">Create an account</Link> : !status?.needsSetup ? 'Accounts are invite-only. Ask your admin.' : null}
        </div>
      </form>
    </div>
  )
}

export function Logo({ size = 28 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 100 100"><rect width="100" height="100" rx="20" fill="#6366f1" /><path d="M25 70 L70 25 M55 25 L70 25 L70 40" stroke="white" strokeWidth="10" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
