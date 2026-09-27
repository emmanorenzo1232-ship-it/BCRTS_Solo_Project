import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import { ErrorNotice, StatusBadge } from '../components'
import type { CaseRecord, CaseStatus } from '../types'

const statuses: CaseStatus[] = ['Received', 'In Progress', 'Resolved', 'Closed']

export function CaseDetail() {
  const { id } = useParams()
  const location = useLocation()
  const { user, token } = useAuth()
  const [item, setItem] = useState<CaseRecord | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { api.case(Number(id), token!).then(setItem).catch((e) => setError(e.message)) }, [id, token])

  async function advance(status: CaseStatus) {
    setBusy(true); setError('')
    try { setItem(await api.updateStatus(Number(id), status, token!)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to update status.') }
    finally { setBusy(false) }
  }

  if (error && !item) return <section className="form-page"><ErrorNotice message={error} /><Link to={user?.role === 'staff' ? '/staff' : '/'}>Return to dashboard</Link></section>
  if (!item) return <div className="center-message">Loading case…</div>
  const currentIndex = statuses.indexOf(item.status)

  return (
    <section className="form-page">
      <Link className="back-link" to={user?.role === 'staff' ? '/staff' : '/'}>← Back to dashboard</Link>
      {location.state?.created && <div className="notice success">Your case was submitted successfully.</div>}
      {error && <ErrorNotice message={error} />}
      <article className="section-card detail-card">
        <div className="detail-heading"><div><p className="eyebrow">{item.reference_number}</p><h1>{item.subject}</h1><p>{item.category} · {item.type}</p></div><StatusBadge status={item.status} /></div>
        <div className="progress" aria-label="Case progress">{statuses.map((status, index) => <div key={status} className={index <= currentIndex ? 'done' : ''}><span>{index + 1}</span><small>{status}</small></div>)}</div>
        <div className="detail-grid">
          <div><small>Submitted by</small><strong>{item.resident.name}</strong><span>{item.resident.email}</span></div>
          <div><small>Date submitted</small><strong>{new Date(item.created_at).toLocaleString()}</strong></div>
        </div>
        <div className="description"><small>Description</small><p>{item.description}</p></div>
        {user?.role === 'staff' && currentIndex < statuses.length - 1 && (
          <div className="staff-action"><div><strong>Update this case</strong><p>Move the case forward when work progresses.</p></div><button className="button primary" disabled={busy} onClick={() => advance(statuses[currentIndex + 1])}>{busy ? 'Updating…' : `Mark as ${statuses[currentIndex + 1]}`}</button></div>
        )}
      </article>
    </section>
  )
}
