import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import { AppointmentBadge, ErrorNotice } from '../components'
import { formatAppointmentDate, formatAppointmentTime, todayInBarangay } from '../dates'
import type { AppointmentDay, AppointmentSchedule, CaseRecord } from '../types'

const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function monthRange(month: string) {
  const [year, number] = month.split('-').map(Number)
  return { start: `${month}-01`, end: new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10) }
}

export function StaffAppointments() {
  const { token } = useAuth()
  const [today, setToday] = useState(todayInBarangay)
  const [month, setMonth] = useState(() => today.slice(0, 7))
  const [selectedDate, setSelectedDate] = useState(today)
  const [days, setDays] = useState<AppointmentDay[]>([])
  const [bookings, setBookings] = useState<CaseRecord[]>([])
  const [schedule, setSchedule] = useState<AppointmentSchedule | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [view, setView] = useState('day')
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [settingsError, setSettingsError] = useState('')
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    // Refresh counts and date groups while the page remains open overnight.
    const timer = window.setInterval(() => { setToday(todayInBarangay()); setRefresh((value) => value + 1) }, 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let active = true
    api.appointmentSettings(token!).then((value) => { if (active) setSchedule(value) })
      .catch((reason) => { if (active) setSettingsError(reason.message) })
    return () => { active = false }
  }, [token])

  useEffect(() => {
    let active = true
    const { start, end } = monthRange(month)
    setLoading(true)
    setError('')
    Promise.all([api.appointmentAvailability(start, end, token!), api.appointments(start, end, token!)])
      .then(([availability, appointments]) => { if (active) { setDays(availability); setBookings(appointments) } })
      .catch((reason) => { if (active) setError(reason.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [month, refresh, token])

  function changeMonth(value: string) {
    if (!/^\d{4}-\d{2}$/.test(value)) return
    setMonth(value)
    setSelectedDate(value === today.slice(0, 7) ? today : `${value}-01`)
    setView('day')
  }

  async function saveSchedule(event: FormEvent) {
    event.preventDefault()
    if (!schedule) return
    setSaving(true); setSettingsError(''); setSaved(false)
    try {
      setSchedule(await api.saveAppointmentSettings(schedule, token!))
      setRefresh((value) => value + 1)
      setSaved(true)
    } catch (reason) { setSettingsError(reason instanceof Error ? reason.message : 'Unable to save schedule.') }
    finally { setSaving(false) }
  }

  const selected = days.find((day) => day.date === selectedDate)
  const visible = bookings.filter((item) => {
    const date = item.appointment_date!
    const matchesDate = view === 'day' ? date === selectedDate : view === 'Today' ? date === today : view === 'Upcoming' ? date > today : date < today
    const term = search.trim().toLowerCase()
    return matchesDate && (!term || [item.reference_number, item.resident.name, item.resident.email, item.category, item.subject].some((value) => value.toLowerCase().includes(term)))
  })
  const firstWeekday = (new Date(`${month}-01T00:00:00Z`).getUTCDay() + 6) % 7

  return <>
    <section className="hero-row"><div><p className="kicker">Staff workspace</p><h1>Service appointments</h1><p>Bookings are confirmed automatically. View the daily schedule without approving each request.</p></div>
      <button className="button ghost" onClick={() => setShowSettings(!showSettings)} aria-expanded={showSettings}>Booking settings</button>
    </section>
    {showSettings && <section className="section-card booking-settings">
      <p className="kicker">Automatic scheduling</p><h2>Booking settings</h2>
      <p className="muted">All dates and office hours use Philippine time (UTC+8). Changes apply to new bookings; existing appointments keep their dates and times.</p>
      {settingsError && <ErrorNotice message={settingsError} />}
      {saved && <div role="status" className="notice success">Booking settings saved.</div>}
      {schedule ? <form onSubmit={saveSchedule}>
        <div className="settings-grid">
          <label>Schedule starts<input type="date" required value={schedule.start_date} onChange={(e) => setSchedule({ ...schedule, start_date: e.target.value })} /></label>
          <label>Appointment days<select value={schedule.interval_days} onChange={(e) => setSchedule({ ...schedule, interval_days: Number(e.target.value) })}>
            {Array.from({ length: 30 }, (_, i) => i + 1).map((interval) => <option key={interval} value={interval}>{interval === 1 ? 'Every day' : interval === 2 ? 'Every other day' : `Every ${interval} days`}</option>)}
          </select></label>
          <label>Opening time<input type="time" required value={schedule.opening_time.slice(0, 5)} onChange={(e) => setSchedule({ ...schedule, opening_time: e.target.value })} /></label>
          <label>Closing time<input type="time" required value={schedule.closing_time.slice(0, 5)} onChange={(e) => setSchedule({ ...schedule, closing_time: e.target.value })} /></label>
          <label>Slot duration<select value={schedule.slot_minutes} onChange={(e) => setSchedule({ ...schedule, slot_minutes: Number(e.target.value) as 15 | 30 | 60 })}>{[15, 30, 60].map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}</select></label>
          <label>Appointments per slot<input type="number" required min={1} max={100} value={schedule.slot_capacity} onChange={(e) => setSchedule({ ...schedule, slot_capacity: Number(e.target.value) })} /></label>
          <label>Daily booking limit<input type="number" required min={1} max={1000} value={schedule.daily_limit} onChange={(e) => setSchedule({ ...schedule, daily_limit: Number(e.target.value) })} /></label>
        </div>
        <fieldset className="weekday-settings"><legend>Allowed weekdays</legend><div className="weekday-options">{weekdays.map((day, index) => <label key={day}><input type="checkbox" checked={schedule.weekdays.includes(index)} onChange={(e) => setSchedule({ ...schedule, weekdays: e.target.checked ? [...schedule.weekdays, index] : schedule.weekdays.filter((value) => value !== index) })} />{day}</label>)}</div></fieldset>
        <p className="muted">For every other day, the schedule starts on the chosen start date, repeats every two days, and skips unchecked weekdays. The booking window is 90 days.</p>
        <button className="button primary" disabled={saving || !schedule.weekdays.length}>{saving ? 'Saving…' : 'Save booking settings'}</button>
      </form> : <p className="muted">Loading settings…</p>}
    </section>}
    <section className="summary-grid" aria-label="Appointment totals">
      <div className="stat"><strong>{loading ? '—' : bookings.length}</strong><span>Appointments this month</span></div>
      <div className="stat"><strong>{loading ? '—' : selected?.booked ?? 0}</strong><span>On selected date</span></div>
      <div className="stat"><strong>{loading ? '—' : selected?.remaining ?? 0}</strong><span>Places remaining on selected date</span></div>
    </section>
    <section className="section-card appointment-calendar">
      <div className="section-heading"><div><p className="kicker">Daily overview</p><h2>Appointment calendar</h2></div><div className="queue-controls">
        <label>Month<input type="month" required value={month} onChange={(e) => changeMonth(e.target.value)} /></label>
        <button className="button secondary compact" onClick={() => { changeMonth(today.slice(0, 7)); setSelectedDate(today); setView('day') }}>Today</button>
        <button className="button ghost compact" disabled={loading} onClick={() => setRefresh((value) => value + 1)}>Refresh</button>
      </div></div>
      {error && <ErrorNotice message={error} />}
      <p className="muted">Choose a date to see its residents and services. Counts refresh every minute. Past dates do not mean services were completed.</p>
      {loading ? <p role="status" className="muted">Loading appointments…</p> : !error && <div className="calendar-grid" aria-label="Appointment dates">
        {weekdays.map((day) => <div className="calendar-weekday" key={day}><abbr title={day}>{day.slice(0, 3)}</abbr></div>)}
        {Array.from({ length: firstWeekday }, (_, index) => <div key={`blank-${index}`} />)}
        {days.map((day) => <button key={day.date} type="button" className={`calendar-day ${selectedDate === day.date ? 'selected' : ''} ${day.date === today ? 'is-today' : ''}`} aria-pressed={selectedDate === day.date} aria-label={`${formatAppointmentDate(day.date)}: ${day.booked} appointments`} onClick={() => { setSelectedDate(day.date); setView('day') }}>
          <strong>{Number(day.date.slice(-2))}</strong><span>{day.booked} <span className="calendar-count-label">booked</span></span>
          <small>{day.date < today ? 'Past' : day.remaining ? `${day.remaining} open` : !day.scheduled ? 'Closed' : 'Unavailable'}</small>
        </button>)}
      </div>}
    </section>
    <section className="section-card appointment-list">
      <div className="section-heading"><div><p className="kicker">Resident bookings</p><h2>{view === 'day' ? formatAppointmentDate(selectedDate) : `${view} appointments`}</h2></div><div className="queue-controls">
        <label>View<select value={view} onChange={(e) => { setView(e.target.value); if (e.target.value === 'Today') { setMonth(today.slice(0, 7)); setSelectedDate(today) } }}><option value="day">Selected day</option><option>Today</option><option>Upcoming</option><option>Past</option></select></label>
        <label>Search<input placeholder="Resident, reference, or service" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
      </div></div>
      {view !== 'day' && <p className="muted">Showing {view.toLowerCase()} appointments in the selected month.</p>}
      {!loading && !error && (visible.length ? <div className="table-wrap"><table>
        <thead><tr><th>Reference</th><th>Resident</th><th>Service</th><th>Date and time (PHT)</th><th>Schedule</th></tr></thead>
        <tbody>{visible.map((item) => <tr key={item.id}>
          <td><Link to={`/cases/${item.id}`}>{item.reference_number}</Link></td>
          <td><strong>{item.resident.name}</strong><small>{item.resident.email}</small></td>
          <td><strong>{item.category}</strong><small>{item.subject}</small></td>
          <td>{formatAppointmentDate(item.appointment_date!)}<small>{item.appointment_time ? formatAppointmentTime(item.appointment_time) : 'Existing booking · no time assigned'}</small></td>
          <td><AppointmentBadge status={item.appointment_status} /></td>
        </tr>)}</tbody>
      </table></div> : <div className="empty"><h3>No appointments found</h3><p>Bookings will appear here automatically when residents request a service.</p></div>)}
    </section>
  </>
}
