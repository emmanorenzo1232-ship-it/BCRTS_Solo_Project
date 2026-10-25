import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import { ErrorNotice } from '../components'

export function AuthPage({ mode }: { mode: 'login' | 'register' | 'forgot' | 'reset' }) {
  const { user, login, register, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [resetToken] = useState(() => mode === 'reset'
    ? new URLSearchParams(location.hash.slice(1)).get('token') ?? '' : '')
  const recovery = mode === 'forgot' || mode === 'reset'
  const missingToken = mode === 'reset' && !resetToken

  useEffect(() => {
    // Keep the reset secret in component memory while removing it from the URL.
    if (mode === 'reset' && location.hash) {
      window.history.replaceState(window.history.state, '', location.pathname)
    }
  }, [mode, location.hash, location.pathname])

  if (user && !recovery) return <Navigate to={user.role === 'staff' ? '/staff' : '/'} replace />

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setMessage('')
    if (mode === 'reset' && password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setBusy(true)
    try {
      if (mode === 'forgot') {
        const result = await api.forgotPassword(email)
        setMessage(result.message)
      } else if (mode === 'reset') {
        const result = await api.resetPassword(resetToken, password)
        logout()
        navigate('/login', { replace: true, state: { message: result.message } })
      } else if (mode === 'register') await register(name, email, password)
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
          <p className="kicker">{recovery ? 'Account recovery' : 'Resident and staff access'}</p>
          <h2>{mode === 'forgot' ? 'Forgot your password?' : mode === 'reset' ? 'Set a new password' : mode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
          <p className="muted">{mode === 'forgot' ? 'Enter your account email to request a password reset link.' : mode === 'reset' ? 'Choose a password with 8 to 128 characters.' : mode === 'login' ? 'Sign in to view and manage cases.' : 'Register as a resident to get started.'}</p>
          {location.state?.message && <div className="notice success" role="status">{location.state.message}</div>}
          {message && <div className="notice success" role="status">{message}</div>}
          {error && <ErrorNotice message={error} />}
          {missingToken && <ErrorNotice message="This reset link is missing its token. Request a new link to continue." />}
          {mode === 'register' && (
            <label>Full name<input required minLength={2} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
          )}
          {mode !== 'reset' && <label>Email address<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" disabled={busy} /></label>}
          {mode !== 'forgot' && <label>{mode === 'reset' ? 'New password' : 'Password'}<input required minLength={8} maxLength={mode === 'login' ? undefined : 128} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} disabled={busy || missingToken} /></label>}
          {mode === 'reset' && <label>Confirm new password<input required minLength={8} maxLength={128} type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" disabled={busy || missingToken} /></label>}
          {mode === 'login' && <p className="forgot-password-link"><Link to="/forgot-password">Forgot password?</Link></p>}
          <button className="button primary full" disabled={busy || missingToken}>{busy ? 'Please wait…' : mode === 'forgot' ? 'Send reset link' : mode === 'reset' ? 'Reset password' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
          {mode === 'reset' && <p className="switch-copy"><Link to="/forgot-password">Request a new reset link</Link></p>}
          <p className="switch-copy">
            {recovery ? '' : mode === 'login' ? 'New resident? ' : 'Already registered? '}
            <Link to={mode === 'login' ? '/register' : '/login'}>{recovery ? 'Back to sign in' : mode === 'login' ? 'Create an account' : 'Sign in'}</Link>
          </p>
        </form>
      </section>
    </main>
  )
}
