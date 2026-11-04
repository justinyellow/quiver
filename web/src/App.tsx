import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { api } from '@/lib/api'
import { useStore } from '@/store'
import Login from '@/pages/Login'
import AppShell from '@/pages/AppShell'
import PublicDocs from '@/pages/PublicDocs'
import { Spinner, Toaster } from '@/components/ui'

export default function App() {
  const [ready, setReady] = useState(false)
  const user = useStore((s) => s.user)
  const setUser = useStore((s) => s.setUser)
  const loc = useLocation()
  useEffect(() => {
    api.get('/auth/me').then((d) => { setUser(d.user, d.workspaces) }).catch(() => setUser(null, [])).finally(() => setReady(true))
  }, [setUser])
  if (!ready) return <div className="h-full flex items-center justify-center"><Spinner size={24} /></div>
  return (
    <>
      <Routes>
        <Route path="/docs/:slug" element={<PublicDocs />} />
        <Route path="/login" element={user ? <Navigate to="/" /> : <Login mode="login" />} />
        <Route path="/register" element={user ? <Navigate to="/" /> : <Login mode="register" />} />
        <Route path="/*" element={user ? <AppShell /> : <Navigate to="/login" state={{ from: loc.pathname }} />} />
      </Routes>
      <Toaster />
    </>
  )
}
