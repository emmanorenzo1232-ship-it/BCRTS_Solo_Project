import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth'
import { ErrorNotice } from '../components'

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { user, login, register } = useAuth()
  const location = useLocation()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to={user.role === 'staff' ? '/staff' : '/'} replace />

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (mode === 'register') await register(name, email, password)
      else await login(email, password)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to continue.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="welcome-panel">
        <div className="brand light"><span className="seal">B</span><strong>BCRTS</strong></div>
        <div>
          <p className="kicker">Your barangay, within reach</p>
          <h1>Community concerns deserve clear answers.</h1>
          <p>Submit requests, report local issues, and follow every update from one secure place.</p>
        </div>
        <p className="help-line">Need assistance? Visit your barangay office during regular hours.</p>
      </section>
      <section className="auth-panel">
        <form className="auth-card" onSubmit={submit}>
          <p className="kicker">Resident and staff access</p>
          <h2>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
          <p className="muted">{mode === 'login' ? 'Sign in to view and manage cases.' : 'Register as a resident to get started.'}</p>
          {location.state?.message && <div className="notice success">{location.state.message}</div>}
          {error && <ErrorNotice message={error} />}
          {mode === 'register' && (
            <label>Full name<input required minLength={2} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
          )}
          <label>Email address<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
          <label>Password<input required minLength={8} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
          <button className="button primary full" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
          <p className="switch-copy">
            {mode === 'login' ? 'New resident? ' : 'Already registered? '}
            <Link to={mode === 'login' ? '/register' : '/login'}>{mode === 'login' ? 'Create an account' : 'Sign in'}</Link>
          </p>
        </form>
      </section>
    </main>
  )
}
