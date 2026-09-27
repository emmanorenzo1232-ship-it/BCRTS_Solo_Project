import { Link, Navigate, Outlet } from 'react-router-dom'
import { useAuth } from './auth'
import type { CaseRecord, CaseStatus, Role } from './types'

export function ProtectedRoute({ role }: { role?: Role }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="center-message">Restoring your session…</div>
  if (!user) return <Navigate to="/login" replace />
  if (role && user.role !== role) return <Navigate to={user.role === 'staff' ? '/staff' : '/'} replace />
  return <Outlet />
}

export function Layout() {
  const { user, logout } = useAuth()
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" to={user?.role === 'staff' ? '/staff' : '/'}>
          <span className="seal">B</span>
          <span><strong>BCRTS</strong><small>Barangay Service Portal</small></span>
        </Link>
        <div className="account">
          <span><strong>{user?.name}</strong><small>{user?.role}</small></span>
          <button className="button ghost compact" onClick={logout}>Log out</button>
        </div>
      </header>
      <main className="main"><Outlet /></main>
    </div>
  )
}

export function StatusBadge({ status }: { status: CaseStatus }) {
  return <span className={`badge status-${status.toLowerCase().replace(' ', '-')}`}>{status}</span>
}

export function CaseCard({ item }: { item: CaseRecord }) {
  return (
    <Link className="case-card" to={`/cases/${item.id}`}>
      <div>
        <small className="eyebrow">{item.reference_number}</small>
        <h3>{item.subject}</h3>
        <p>{item.category} · {item.type}</p>
      </div>
      <div className="case-meta">
        <StatusBadge status={item.status} />
        <time>{new Date(item.created_at).toLocaleDateString()}</time>
      </div>
    </Link>
  )
}

export function ErrorNotice({ message }: { message: string }) {
  return <div className="notice error" role="alert">{message}</div>
}
