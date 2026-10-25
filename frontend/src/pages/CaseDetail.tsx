import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import { AppointmentBadge, ErrorNotice, StatusBadge } from '../components'
import { formatAppointmentDate, formatAppointmentTime } from '../dates'
import type { CaseHistoryEntry, CaseNote, CaseRecord, CaseStatus } from '../types'

const statuses: CaseStatus[] = ['Received', 'In Progress', 'Resolved', 'Closed']

export function CaseDetail() {
  const { id } = useParams()
  const location = useLocation()
  const { user, token } = useAuth()
  const [item, setItem] = useState<CaseRecord | null>(null)
  const [history, setHistory] = useState<CaseHistoryEntry[]>([])
  const [notes, setNotes] = useState<CaseNote[]>([])
  const [noteBody, setNoteBody] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!token) return
    Promise.all([api.case(Number(id), token), api.history(Number(id), token), api.notes(Number(id), token)])
      .then(([caseItem, caseHistory, caseNotes]) => {
        setItem(caseItem)
        setHistory(Array.isArray(caseHistory) ? caseHistory : [])
        setNotes(Array.isArray(caseNotes) ? caseNotes : [])
      })
      .catch((e) => setError(e.message))
  }, [id, token])

  async function advance(status: CaseStatus) {
    setBusy(true); setError('')
    try {
      const updated = await api.updateStatus(Number(id), status, token!)
      setItem(updated)
      setHistory(await api.history(Number(id), token!))
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to update status.') }
    finally { setBusy(false) }
  }

  async function addNote(event: FormEvent) {
    event.preventDefault()
    if (noteBody.trim().length < 2) return
    setBusy(true); setError('')
    try {
      const note = await api.addNote(Number(id), noteBody.trim(), token!)
      setNotes((current) => [...current, note])
      setNoteBody('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to add note.')
    } finally { setBusy(false) }
  }

  if (error && !item) return <section className="form-page"><ErrorNotice message={error} /><Link to={user?.role === 'staff' ? '/staff' : '/'}>Return to dashboard</Link></section>
  if (!item) return <div className="center-message">Loading case…</div>
  const currentIndex = statuses.indexOf(item.status)
  const isAppointment = item.type === 'request' && !!item.appointment_date

  return (
    <section className="form-page">
      <Link className="back-link" to={user?.role === 'staff' ? isAppointment ? '/staff/appointments' : '/staff' : '/'}>← {isAppointment && user?.role === 'staff' ? 'Back to appointments' : 'Back to dashboard'}</Link>
      {location.state?.created && <div className="notice success">{isAppointment ? 'Your appointment is confirmed. No staff approval is needed.' : 'Your case was submitted successfully.'}</div>}
      {error && <ErrorNotice message={error} />}
      <article className="section-card detail-card">
        <div className="detail-heading"><div><p className="eyebrow">{item.reference_number}</p><h1>{item.subject}</h1><p>{item.category} · {item.type}</p></div>{isAppointment ? <AppointmentBadge status={item.appointment_status} /> : <StatusBadge status={item.status} />}</div>
        {isAppointment ? <div className="notice success"><strong>Automatically scheduled</strong><p>{item.appointment_status === 'Past' ? 'This appointment date has passed. Contact the barangay office for questions about your service or document.' : 'Your appointment is confirmed. Please visit the barangay office at your scheduled time.'}</p></div> : <div className="progress" aria-label="Case progress">{statuses.map((status, index) => <div key={status} className={index <= currentIndex ? 'done' : ''}><span>{index + 1}</span><small>{status}</small></div>)}</div>}
        <div className="detail-grid">
          <div><small>Submitted by</small><strong>{item.resident.name}</strong><span>{item.resident.email}</span></div>
          <div><small>Date submitted</small><strong>{new Date(item.created_at).toLocaleString()}</strong></div>
          {item.type === 'request' && <div><small>Confirmed appointment date</small><strong>{item.appointment_date ? <time dateTime={item.appointment_date}>{formatAppointmentDate(item.appointment_date)}</time> : 'Not provided'}</strong></div>}
          {isAppointment && <div><small>Appointment time (Philippine time)</small><strong>{item.appointment_time ? formatAppointmentTime(item.appointment_time) : 'Existing booking · no time assigned'}</strong></div>}
        </div>
        <div className="description"><small>{item.type === 'request' ? 'Additional details' : 'Description'}</small><p>{item.description || 'No additional details provided.'}</p></div>
        {!isAppointment && <section className="timeline" aria-label="Case status timeline">
          <div className="section-heading"><div><p className="kicker">Audit trail</p><h2>Status history</h2></div></div>
          {history.length ? <div className="timeline-list">{history.map((entry) => <div className="timeline-item" key={entry.id}><span className="timeline-dot" /><div><strong>{entry.from_status ? `${entry.from_status} → ${entry.to_status}` : `Case received`}</strong><p>{entry.actor.name} · {new Date(entry.created_at).toLocaleString()}</p></div></div>)}</div> : <p className="muted">No status history is available for this case yet.</p>}
        </section>}
        <section className="notes" aria-label="Case notes">
          <div className="section-heading"><div><p className="kicker">Communication</p><h2>Updates and notes</h2></div></div>
          {notes.length ? <div className="note-list">{notes.map((note) => <div className="note" key={note.id}><div><strong>{note.author.name}</strong><small>{note.author.role} · {new Date(note.created_at).toLocaleString()}</small></div><p>{note.body}</p></div>)}</div> : <p className="muted">No additional notes have been posted.</p>}
          {user?.role === 'staff' && <form className="note-form" onSubmit={addNote}><label htmlFor="case-note">Add a staff note<textarea id="case-note" rows={3} maxLength={2000} value={noteBody} onChange={(event) => setNoteBody(event.target.value)} placeholder="Share an update for the resident and other staff." /></label><button className="button secondary" disabled={busy || noteBody.trim().length < 2}>{busy ? 'Saving…' : 'Post note'}</button></form>}
        </section>
        {user?.role === 'staff' && !isAppointment && currentIndex < statuses.length - 1 && (
          <div className="staff-action"><div><strong>Update this case</strong><p>Move the case forward when work progresses.</p></div><button className="button primary" disabled={busy} onClick={() => advance(statuses[currentIndex + 1])}>{busy ? 'Updating…' : `Mark as ${statuses[currentIndex + 1]}`}</button></div>
        )}
      </article>
    </section>
  )
}
