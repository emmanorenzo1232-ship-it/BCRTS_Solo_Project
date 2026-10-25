import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import type { AppointmentDay, AppointmentSchedule, AuthSession, CaseRecord } from '../types'

const today = '2026-10-25'
const session: AuthSession = {
  access_token: 'staff-token', token_type: 'bearer',
  user: { id: 1, name: 'Barangay Staff', email: 'staff@example.com', role: 'staff', created_at: `${today}T00:00:00Z` },
}
const schedule: AppointmentSchedule = {
  start_date: today, interval_days: 1, weekdays: [0, 1, 2, 3, 4, 5, 6],
  opening_time: '09:00:00', closing_time: '17:00:00', slot_minutes: 30, slot_capacity: 2, daily_limit: 30,
}
const days: AppointmentDay[] = ['2026-10-24', today, '2026-10-26'].map((date) => ({
  date, scheduled: true, booked: 1, remaining: date < today ? 0 : 29, slots: [{ time: '09:00:00', remaining: 1 }],
}))
const bookings: CaseRecord[] = days.map((day, index) => ({
  id: index + 1, reference_number: `BOOKING-${index + 1}`, resident_id: 2,
  type: 'request', category: 'Barangay clearance', subject: `Service ${index + 1}`, description: '',
  appointment_date: day.date, appointment_time: '09:00:00',
  appointment_status: day.date < today ? 'Past' : day.date === today ? 'Today' : 'Upcoming',
  status: 'Received', created_at: `${today}T00:00:00Z`, updated_at: `${today}T00:00:00Z`,
  resident: { id: 2, name: `Resident ${index + 1}`, email: `resident${index + 1}@example.com` },
}))

function response(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

function mockStaff() {
  const mock = vi.fn((url: string, init?: RequestInit) => {
    if (url.includes('/auth/me')) return response(session.user)
    if (url.includes('/appointments/settings')) return response(init?.method === 'PUT' ? JSON.parse(init.body as string) : schedule)
    if (url.includes('/appointments/availability')) return response(days)
    if (url.includes('/appointments?')) return response(bookings)
    if (url.endsWith('/history') || url.endsWith('/notes')) return response([])
    if (url.endsWith('/cases/2')) return response(bookings[1])
    return response([])
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

describe('automatic appointments', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(`${today}T02:00:00Z`))
    window.localStorage.setItem('bcrts_session', JSON.stringify(session))
    window.history.pushState({}, '', '/staff/appointments')
  })

  it('shows daily totals and lets staff inspect appointments by calendar date', async () => {
    mockStaff()
    render(<App />)
    expect(await screen.findByText('Resident 2')).toBeInTheDocument()
    expect(screen.queryByText('Resident 3')).not.toBeInTheDocument()
    const totals = screen.getByLabelText('Appointment totals')
    expect(within(totals).getByText('3')).toBeInTheDocument()
    expect(within(totals).getByText('29')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /October 26, 2026: 1 appointments/ }))
    expect(screen.getByText('Resident 3')).toBeInTheDocument()
    expect(screen.queryByText('Resident 2')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'BOOKING-3' })).toHaveAttribute('href', '/cases/3')
  })

  it('groups dates into upcoming and past and searches residents', async () => {
    mockStaff()
    render(<App />)
    await screen.findByText('Resident 2')
    await userEvent.selectOptions(screen.getByLabelText('View'), 'Upcoming')
    expect(screen.getByText('Resident 3')).toBeInTheDocument()
    expect(screen.queryByText('Resident 1')).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Search'), 'unknown resident')
    expect(screen.getByText('No appointments found')).toBeInTheDocument()
    await userEvent.clear(screen.getByLabelText('Search'))
    await userEvent.selectOptions(screen.getByLabelText('View'), 'Past')
    expect(screen.getByText('Resident 1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Mark as/ })).not.toBeInTheDocument()
  })

  it('saves an every-other-day schedule and capacity settings', async () => {
    const fetchMock = mockStaff()
    render(<App />)
    await screen.findByText('Resident 2')
    await userEvent.click(screen.getByRole('button', { name: 'Booking settings' }))
    await userEvent.selectOptions(screen.getByLabelText('Appointment days'), '2')
    fireEvent.change(screen.getByLabelText('Daily booking limit'), { target: { value: '15' } })
    await userEvent.click(screen.getByLabelText('Sunday'))
    await userEvent.click(screen.getByRole('button', { name: 'Save booking settings' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Booking settings saved.')
    const savedCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!
    expect(JSON.parse(savedCall[1]!.body as string)).toMatchObject({ interval_days: 2, daily_limit: 15, weekdays: [0, 1, 2, 3, 4, 5] })
  })

  it('shows confirmed schedule details without manual case progression', async () => {
    mockStaff()
    window.history.pushState({}, '', '/cases/2')
    render(<App />)
    expect(await screen.findByText('Automatically scheduled')).toBeInTheDocument()
    expect(screen.getByText('Confirmed appointment date')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '← Back to appointments' })).toHaveAttribute('href', '/staff/appointments')
    expect(screen.queryByLabelText('Case progress')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Mark as/ })).not.toBeInTheDocument()
  })

  it('keeps resident accounts out of the staff schedule', async () => {
    const resident = { ...session, user: { ...session.user, role: 'resident' } }
    window.localStorage.setItem('bcrts_session', JSON.stringify(resident))
    vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('/auth/me') ? response(resident.user) : response([])))
    render(<App />)
    expect(await screen.findByText('Good day, Barangay.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Service appointments' })).not.toBeInTheDocument()
  })

  it('blocks unavailable dates and refreshes availability after a booking conflict', async () => {
    const resident = { ...session, user: { ...session.user, role: 'resident' } }
    window.localStorage.setItem('bcrts_session', JSON.stringify(resident))
    window.history.pushState({}, '', '/new')
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes('/auth/me')) return response(resident.user)
      if (url.includes('/categories')) return response(['Other'])
      if (url.includes('/appointments/availability')) return response([
        { ...days[1], remaining: 0, slots: [] }, days[2],
      ])
      if (init?.method === 'POST') return response({ error: { message: 'This time slot is no longer available. Choose another slot.' } }, 409)
      return response([])
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    await screen.findByRole('option', { name: 'Other' })
    await userEvent.click(screen.getByRole('radio', { name: /Request a service/ }))
    await screen.findByRole('button', { name: /October 26, 2026/ })
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'Other')
    await userEvent.type(screen.getByLabelText('Subject'), 'Clearance appointment')
    const form = screen.getByRole('button', { name: 'Submit case' }).closest('form')!
    fireEvent.change(screen.getByLabelText('Appointment date'), { target: { value: today } })
    fireEvent.submit(form)
    expect(await screen.findByRole('alert')).toHaveTextContent('This date has no available appointments.')
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: /October 26, 2026/ }))
    expect(screen.getByLabelText('Appointment time (Philippine time)')).toHaveValue('09:00:00')
    await userEvent.click(screen.getByRole('button', { name: 'Submit case' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This time slot is no longer available.')
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url.includes('/appointments/availability')).length).toBe(2))
    expect(screen.getByLabelText('Appointment time (Philippine time)')).toHaveValue('')
  })
})
