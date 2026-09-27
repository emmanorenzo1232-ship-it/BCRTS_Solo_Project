import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import { CaseCard, ErrorNotice } from '../components'
import type { CaseRecord } from '../types'

export function ResidentDashboard() {
  const { user, token } = useAuth()
  const [cases, setCases] = useState<CaseRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api.cases(token!).then(setCases).catch((e) => setError(e.message)).finally(() => setLoading(false))
  }, [token])

  return (
    <>
      <section className="hero-row">
        <div><p className="kicker">Resident dashboard</p><h1>Good day, {user?.name.split(' ')[0]}.</h1><p>Track concerns and barangay service requests from here.</p></div>
        <Link className="button primary" to="/new">+ Submit a case</Link>
      </section>
      <section className="summary-grid">
        <div className="stat"><strong>{cases.length}</strong><span>Total submitted</span></div>
        <div className="stat"><strong>{cases.filter((c) => ['Received', 'In Progress'].includes(c.status)).length}</strong><span>Active cases</span></div>
        <div className="stat"><strong>{cases.filter((c) => ['Resolved', 'Closed'].includes(c.status)).length}</strong><span>Completed</span></div>
      </section>
      <section className="section-card">
        <div className="section-heading"><div><p className="kicker">Your records</p><h2>Recent cases</h2></div></div>
        {error && <ErrorNotice message={error} />}
        {loading ? <p className="muted">Loading your cases…</p> : cases.length ? (
          <div className="case-list">{cases.map((item) => <CaseCard key={item.id} item={item} />)}</div>
        ) : (
          <div className="empty"><span>◎</span><h3>No cases yet</h3><p>Your submitted complaints and requests will appear here.</p><Link className="button secondary" to="/new">Submit your first case</Link></div>
        )}
      </section>
    </>
  )
}
