import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import { ErrorNotice, StatusBadge } from '../components'
import type { CaseRecord, CaseStatus, CaseType } from '../types'

export function StaffDashboard() {
  const { token } = useAuth()
  const [cases, setCases] = useState<CaseRecord[]>([])
  const [status, setStatus] = useState<CaseStatus | 'all'>('all')
  const [type, setType] = useState<CaseType | 'all'>('all')
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const exportInProgress = useRef(false)
  useEffect(() => { api.cases(token!).then((items) => setCases(items.filter((item) => !(item.type === 'request' && item.appointment_date)))).catch((e) => setError(e.message)).finally(() => setLoading(false)) }, [token])
  const visible = useMemo(() => {
    const term = search.trim().toLocaleLowerCase()
    return cases.filter((item) => {
      const matchesSearch = !term || [
        item.reference_number,
        item.resident.name,
        item.resident.email,
        item.subject,
        item.category,
        item.description,
        item.appointment_date ?? '',
      ].some((value) => value.toLocaleLowerCase().includes(term))
      return matchesSearch && (status === 'all' || item.status === status) && (type === 'all' || item.type === type)
    })
  }, [cases, search, status, type])

  async function exportCases() {
    if (exportInProgress.current || !visible.length) return
    exportInProgress.current = true
    setExporting(true)
    setExportError('')
    const generatedAt = new Date()
    try {
      const { downloadCasesReport } = await import('../caseReport')
      await downloadCasesReport(visible, { search, status, type }, generatedAt)
    } catch {
      setExportError('Unable to generate the Excel report. Please try downloading again.')
    } finally {
      exportInProgress.current = false
      setExporting(false)
    }
  }

  return (
    <>
      <section className="hero-row"><div><p className="kicker">Staff workspace</p><h1>Case queue</h1><p>Review incoming concerns and keep residents informed.</p></div></section>
      <section className="summary-grid"><div className="stat"><strong>{cases.length}</strong><span>All cases</span></div><div className="stat"><strong>{cases.filter((c) => c.status === 'Received').length}</strong><span>Awaiting review</span></div><div className="stat"><strong>{cases.filter((c) => c.status === 'In Progress').length}</strong><span>In progress</span></div></section>
      <section className="section-card">
        <div className="section-heading"><div><p className="kicker">Operations</p><h2>Resident submissions</h2></div><div className="queue-controls"><label className="search-control">Search<input aria-label="Search cases" placeholder="Reference, resident, or concern" value={search} onChange={(e) => setSearch(e.target.value)} /></label><label>Status<select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value as CaseStatus | 'all')}><option value="all">All statuses</option><option>Received</option><option>In Progress</option><option>Resolved</option><option>Closed</option></select></label><label>Type<select aria-label="Filter by type" value={type} onChange={(e) => setType(e.target.value as CaseType | 'all')}><option value="all">All types</option><option value="complaint">Complaints</option><option value="request">Requests</option></select></label><button className="button secondary compact" type="button" onClick={exportCases} disabled={!visible.length || exporting} aria-busy={exporting}>{exporting ? 'Generating…' : 'Download Excel (.xlsx)'}</button></div></div>
        {error && <ErrorNotice message={error} />}
        {exportError && <ErrorNotice message={exportError} />}
        {loading ? <p className="muted">Loading queue…</p> : visible.length ? <div className="table-wrap"><table>
          <thead><tr><th>Reference</th><th>Resident</th><th>Case</th><th>Submitted</th><th>Status</th></tr></thead>
          <tbody>{visible.map((item) => <tr key={item.id}>
            <td><Link to={`/cases/${item.id}`}>{item.reference_number}</Link></td>
            <td><strong>{item.resident.name}</strong><small>{item.resident.email}</small></td>
            <td><strong>{item.subject}</strong><small>{item.category} · {item.type}</small></td>
            <td>{new Date(item.created_at).toLocaleDateString()}</td>
            <td><StatusBadge status={item.status} /></td>
          </tr>)}</tbody>
        </table></div> : <div className="empty"><span>✓</span><h3>No matching cases</h3><p>Try changing the queue filters.</p></div>}
      </section>
    </>
  )
}
