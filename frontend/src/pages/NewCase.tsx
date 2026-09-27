import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import { ErrorNotice } from '../components'
import type { CaseType } from '../types'

export function NewCase() {
  const { token } = useAuth()
  const navigate = useNavigate()
  const [categories, setCategories] = useState<string[]>([])
  const [type, setType] = useState<CaseType>('complaint')
  const [category, setCategory] = useState('')
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { api.categories().then(setCategories).catch((e) => setError(e.message)) }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (!category) return setError('Please select a category.')
    setBusy(true)
    try {
      const created = await api.createCase({ type, category, subject, description }, token!)
      navigate(`/cases/${created.id}`, { state: { created: true } })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to submit your case.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="form-page">
      <Link className="back-link" to="/">← Back to dashboard</Link>
      <div className="section-card narrow">
        <p className="kicker">New submission</p><h1>Tell us how we can help</h1><p className="muted">Provide clear details so barangay staff can respond effectively.</p>
        {error && <ErrorNotice message={error} />}
        <form className="case-form" onSubmit={submit}>
          <fieldset><legend>What would you like to submit?</legend><div className="choice-row">
            {(['complaint', 'request'] as CaseType[]).map((value) => <label className={`choice ${type === value ? 'selected' : ''}`} key={value}><input type="radio" name="type" checked={type === value} onChange={() => setType(value)} /><strong>{value === 'complaint' ? 'Report a concern' : 'Request a service'}</strong><small>{value === 'complaint' ? 'Infrastructure, noise, sanitation, or other issues' : 'Clearance, residency certificate, or barangay service'}</small></label>)}
          </div></fieldset>
          <label>Category<select required value={category} onChange={(e) => setCategory(e.target.value)}><option value="">Select a category</option>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Subject<input required minLength={3} maxLength={150} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Brief summary of your concern" /></label>
          <label>Description<textarea required minLength={10} maxLength={5000} rows={7} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Include the location, relevant dates, and other useful details." /></label>
          <div className="form-actions"><Link className="button ghost" to="/">Cancel</Link><button className="button primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit case'}</button></div>
        </form>
      </div>
    </section>
  )
}
