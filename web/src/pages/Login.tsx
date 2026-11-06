import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { api } from '@/lib/api'
import { useStore } from '@/store'
import { Field } from '@/components/ui'
import { KeyRound } from 'lucide-react'

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
  const ssoError = sp.get('sso_error')
  const showPassword = status?.needsSetup || status?.passwordLogin !== false
  const providers: { id: string; label: string }[] = status?.providers ?? []
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
        {ssoError && <div className="text-xs mb-4 p-2 rounded" style={{ background: 'color-mix(in srgb, var(--err) 12%, transparent)', color: 'var(--err)' }}>{ssoError}</div>}
        {!isRegister && providers.length > 0 && <div className="space-y-2 mb-4">{providers.map((p) => <a key={p.id} className="btn w-full justify-center h-9 text-sm" href={`/api/auth/sso/${p.id}/start`}>{p.id === 'google' ? <GoogleIcon /> : <KeyRound size={14} />} Continue with {p.label}</a>)}</div>}
        {!isRegister && providers.length > 0 && showPassword && <div className="flex items-center gap-2 text-[11px] faint mb-3"><div className="flex-1 border-t divider" />or with email<div className="flex-1 border-t divider" /></div>}
        {showPassword && <>
        {isRegister && <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>}
        <Field label="Email"><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus={!isRegister} readOnly={!!invite} /></Field>
        <Field label="Password" hint={isRegister ? 'At least 10 characters' : undefined}><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={isRegister ? 10 : 1} /></Field>
        {mfa && <Field label="Two-factor code"><input className="input mono" value={totp} onChange={(e) => setTotp(e.target.value)} autoFocus inputMode="numeric" /></Field>}
        {err && <div className="text-xs mb-3" style={{ color: 'var(--err)' }}>{err}</div>}
        <button className="btn btn-primary w-full justify-center h-8" disabled={busy}>{isRegister ? 'Create account' : 'Sign in'}</button>
        </>}
        <div className="text-[11px] faint mt-4 text-center">
          {isRegister && !status?.needsSetup ? <Link className="link" to="/login">Already have an account? Sign in</Link> : status?.allowSignup && showPassword ? <Link className="link" to="/register">Create an account</Link> : !status?.needsSetup && !providers.length ? 'Accounts are invite-only. Ask your admin.' : null}
        </div>
      </form>
    </div>
  )
}

export function Logo({ size = 28 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 100 100"><rect width="100" height="100" rx="20" fill="#6366f1" /><path d="M25 70 L70 25 M55 25 L70 25 L70 40" stroke="white" strokeWidth="10" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

function GoogleIcon() {
  return <svg width="14" height="14" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.6 13.2l7.8 6.1C12.3 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/><path fill="#FBBC05" d="M10.4 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.3.8-4.7l-7.8-6.1C.9 16.6 0 20.2 0 24s.9 7.4 2.6 10.8l7.8-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.7-4.1-13.6-9.8l-7.8 6.1C6.6 42.6 14.6 48 24 48z"/></svg>
}
