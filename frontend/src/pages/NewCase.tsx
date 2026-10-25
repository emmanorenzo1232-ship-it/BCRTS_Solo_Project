import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import { ErrorNotice } from '../components'
import { addDays, formatAppointmentDate, formatAppointmentTime, todayInBarangay } from '../dates'
import type { AppointmentDay, CaseType } from '../types'

export function NewCase() {
  const { token } = useAuth()
  const navigate = useNavigate()
  const [categories, setCategories] = useState<string[]>([])
  const [type, setType] = useState<CaseType>('complaint')
  const [category, setCategory] = useState('')
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [appointmentDate, setAppointmentDate] = useState('')
  const [appointmentTime, setAppointmentTime] = useState('')
  const [availability, setAvailability] = useState<AppointmentDay[]>([])
  const [availabilityLoading, setAvailabilityLoading] = useState(false)
  const [availabilityError, setAvailabilityError] = useState('')
  const [availabilityRefresh, setAvailabilityRefresh] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    api.categories(type)
      .then((items) => { if (active) setCategories(items) })
      .catch((e) => { if (active) setError(e.message) })
    return () => { active = false }
  }, [type])

  useEffect(() => {
    if (type !== 'request') return
    let active = true
    const today = todayInBarangay()
    setAvailabilityLoading(true); setAvailabilityError('')
    api.appointmentAvailability(today, addDays(today, 90), token!)
      .then((days) => { if (active) setAvailability(days) })
      .catch((reason) => { if (active) { setAvailability([]); setAvailabilityError(reason.message) } })
      .finally(() => { if (active) setAvailabilityLoading(false) })
    return () => { active = false }
  }, [type, token, availabilityRefresh])

  const selectedDay = availability.find((day) => day.date === appointmentDate)
  const availableSlots = selectedDay?.slots.filter((slot) => slot.remaining > 0) ?? []

  function chooseDate(value: string) {
    setAppointmentDate(value)
    setAppointmentTime(availability.find((day) => day.date === value)?.slots.find((slot) => slot.remaining > 0)?.time ?? '')
  }

  function changeType(value: CaseType) {
    setType(value)
    setCategory('')
    setCategories([])
    setAppointmentDate('')
    setAppointmentTime('')
    setError('')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (!category || !categories.includes(category)) return setError('Please select a category.')
    if (type === 'request') {
      if (!appointmentDate) return setError('Please select an appointment date.')
      if (appointmentDate < todayInBarangay()) return setError('Appointment date must be today or a future date.')
      if (availabilityLoading || availabilityError) return setError('Please load appointment availability before booking.')
      if (!selectedDay?.remaining) return setError('This date has no available appointments. Choose an available date.')
      if (!availableSlots.some((slot) => slot.time === appointmentTime)) return setError('Please select an available appointment time.')
    }
    setBusy(true)
    try {
      const created = await api.createCase({
        type, category, subject, description,
        ...(type === 'request' ? { appointment_date: appointmentDate, appointment_time: appointmentTime } : {}),
      }, token!)
      navigate(`/cases/${created.id}`, { state: { created: true } })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to submit your case.')
      if (type === 'request') { setAppointmentTime(''); setAvailabilityRefresh((value) => value + 1) }
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
            {(['complaint', 'request'] as CaseType[]).map((value) => <label className={`choice ${type === value ? 'selected' : ''}`} key={value}><input type="radio" name="type" checked={type === value} onChange={() => changeType(value)} /><strong>{value === 'complaint' ? 'Report a concern' : 'Request a service'}</strong><small>{value === 'complaint' ? 'Infrastructure, noise, sanitation, or other issues' : 'Clearance, residency certificate, or barangay service'}</small></label>)}
          </div></fieldset>
          <label>Category<select required disabled={!categories.length} value={category} onChange={(e) => setCategory(e.target.value)}><option value="">Select a category</option>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Subject<input required minLength={3} maxLength={150} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={type === 'complaint' ? 'Brief summary of your concern' : 'Brief summary of your service request'} /></label>
          {type === 'request' && <div className="appointment-field">
            <label htmlFor="appointment-date">Appointment date</label>
            <input id="appointment-date" type="date" required min={todayInBarangay()} max={addDays(todayInBarangay(), 90)} value={appointmentDate} onChange={(e) => chooseDate(e.target.value)} aria-describedby="appointment-help" />
            <small id="appointment-help" className="muted">Choose an available date and time in Philippine time (UTC+8). Your appointment is confirmed automatically when you submit.</small>
            {availabilityLoading ? <p role="status" className="muted">Loading available appointments…</p> : availabilityError ? <><ErrorNotice message={availabilityError} /><button type="button" className="button ghost compact" onClick={() => setAvailabilityRefresh((value) => value + 1)}>Retry availability</button></> : <>
              <div className="available-dates" aria-label="Next available dates">{availability.filter((day) => day.remaining > 0).slice(0, 5).map((day) => <button type="button" className={`button compact ${appointmentDate === day.date ? 'primary' : 'ghost'}`} key={day.date} onClick={() => chooseDate(day.date)}>{formatAppointmentDate(day.date)} · {day.remaining} open</button>)}</div>
              {!availability.some((day) => day.remaining > 0) && <p className="muted">No appointments are available in the next 90 days. Please contact the barangay office.</p>}
              {appointmentDate && !selectedDay?.remaining && <p role="status" className="muted">This date is closed, full, or has no remaining time slots. Choose another available date.</p>}
              {selectedDay && selectedDay.remaining > 0 && <>
                <label htmlFor="appointment-time">Appointment time (Philippine time)</label>
                <select id="appointment-time" required value={appointmentTime} onChange={(e) => setAppointmentTime(e.target.value)}><option value="">Choose a time slot</option>{availableSlots.map((slot) => <option key={slot.time} value={slot.time}>{formatAppointmentTime(slot.time)} · {slot.remaining} places left</option>)}</select>
                <small className="muted">{selectedDay.remaining} places remaining on this date.</small>
              </>}
            </>}
          </div>}
          <label>{type === 'request' ? 'Additional details (optional)' : 'Description'}<textarea required={type === 'complaint'} minLength={type === 'complaint' ? 10 : undefined} maxLength={5000} rows={type === 'request' ? 3 : 7} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={type === 'request' ? 'Add the purpose of your request or any special requirements.' : 'Include the location, relevant dates, and other useful details.'} /></label>
          <div className="form-actions"><Link className="button ghost" to="/">Cancel</Link><button className="button primary" disabled={busy || (type === 'request' && availabilityLoading)}>{busy ? 'Submitting…' : 'Submit case'}</button></div>
        </form>
      </div>
    </section>
  )
}
