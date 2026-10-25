import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { formatAppointmentDate, todayInBarangay } from '../dates'
import type { AuthSession, CaseRecord } from '../types'

const resident: AuthSession = {
  access_token: 'resident-token', token_type: 'bearer',
  user: { id: 1, name: 'Juan Resident', email: 'juan@example.com', role: 'resident', created_at: '2026-09-27T00:00:00Z' },
}
const staff: AuthSession = {
  access_token: 'staff-token', token_type: 'bearer',
  user: { id: 2, name: 'Barangay Staff', email: 'staff@example.com', role: 'staff', created_at: '2026-09-27T00:00:00Z' },
}
const cases: CaseRecord[] = [
  { id: 1, reference_number: 'BCRTS-2026-ABC123', resident_id: 1, type: 'complaint', category: 'Drainage', subject: 'Blocked canal', description: 'The canal is blocked near our home.', appointment_date: null, appointment_time: null, appointment_status: null, status: 'Received', created_at: '2026-09-27T00:00:00Z', updated_at: '2026-09-27T00:00:00Z', resident: resident.user },
  { id: 2, reference_number: 'BCRTS-2026-DEF456', resident_id: 1, type: 'request', category: 'Barangay clearance', subject: 'Clearance request', description: 'Requesting a clearance for employment.', appointment_date: '2026-09-30', appointment_time: '09:00:00', appointment_status: 'Past', status: 'Resolved', created_at: '2026-09-26T00:00:00Z', updated_at: '2026-09-27T00:00:00Z', resident: resident.user },
]

function response(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

function availableDays() {
  return [{ date: todayInBarangay(), scheduled: true, booked: 0, remaining: 2, slots: [{ time: '09:00:00', remaining: 2 }] }]
}

describe('BCRTS frontend', () => {
  beforeEach(() => { vi.restoreAllMocks(); window.history.pushState({}, '', '/') })

  it('protects resident routes', () => {
    vi.stubGlobal('fetch', vi.fn())
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument()
  })

  it('validates the resident submission form', async () => {
    window.localStorage.setItem('bcrts_session', JSON.stringify(resident))
    vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('/auth/me') ? response(resident.user) : url.includes('/categories') ? response(['Drainage']) : response([])))
    window.history.pushState({}, '', '/new')
    render(<App />)
    await screen.findByText('Tell us how we can help')
    fireEvent.submit(screen.getByRole('button', { name: 'Submit case' }).closest('form')!)
    expect(await screen.findByRole('alert')).toHaveTextContent('Please select a category')
  })

  it('switches categories, clears selections, and submits the selected service', async () => {
    const appointmentDate = todayInBarangay()
    window.localStorage.setItem('bcrts_session', JSON.stringify(resident))
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes('/auth/me')) return response(resident.user)
      if (url.includes('/categories?type=complaint')) return response(['Drainage', 'Other'])
      if (url.includes('/categories?type=request')) return response(['Certificate of indigency', 'Other'])
      if (url.includes('/appointments/availability')) return response(availableDays())
      if (init?.method === 'POST') return response({ ...cases[1], category: 'Certificate of indigency', appointment_date: appointmentDate, description: '' }, 201)
      if (url.endsWith('/history') || url.endsWith('/notes')) return response([])
      return response({ ...cases[1], category: 'Certificate of indigency', appointment_date: appointmentDate, description: '' })
    })
    vi.stubGlobal('fetch', fetchMock)
    window.history.pushState({}, '', '/new')
    render(<App />)

    await screen.findByRole('option', { name: 'Drainage' })
    expect(screen.queryByLabelText('Appointment date')).not.toBeInTheDocument()
    const category = screen.getByRole('combobox', { name: 'Category' })
    await userEvent.selectOptions(category, 'Drainage')
    await userEvent.type(screen.getByLabelText('Subject'), 'Document request')
    await userEvent.type(screen.getByLabelText('Description'), 'Needed for my application.')
    await userEvent.click(screen.getByRole('radio', { name: /Request a service/ }))
    await screen.findByRole('option', { name: 'Certificate of indigency' })
    expect(category).toHaveValue('')
    expect(screen.queryByRole('option', { name: 'Drainage' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Subject')).toHaveValue('Document request')
    expect(screen.getByLabelText('Additional details (optional)')).toHaveValue('Needed for my application.')
    expect(screen.getByLabelText('Additional details (optional)')).not.toBeRequired()
    expect(screen.getByLabelText('Appointment date')).toHaveAttribute('type', 'date')
    expect(screen.getByLabelText('Appointment date')).toHaveAttribute('min', appointmentDate)
    fireEvent.change(screen.getByLabelText('Appointment date'), { target: { value: appointmentDate } })

    await userEvent.selectOptions(category, 'Certificate of indigency')
    await userEvent.click(screen.getByRole('radio', { name: /Report a concern/ }))
    await screen.findByRole('option', { name: 'Drainage' })
    expect(category).toHaveValue('')
    expect(screen.queryByRole('option', { name: 'Certificate of indigency' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Appointment date')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Description')).toBeRequired()
    await userEvent.click(screen.getByRole('radio', { name: /Request a service/ }))
    await screen.findByRole('option', { name: 'Certificate of indigency' })
    await userEvent.selectOptions(category, 'Certificate of indigency')
    expect(screen.getByLabelText('Appointment date')).toHaveValue('')
    fireEvent.change(screen.getByLabelText('Appointment date'), { target: { value: appointmentDate } })
    await userEvent.clear(screen.getByLabelText('Additional details (optional)'))
    await userEvent.click(screen.getByRole('button', { name: 'Submit case' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/cases$/),
      expect.objectContaining({ method: 'POST', body: JSON.stringify({
        type: 'request', category: 'Certificate of indigency',
        subject: 'Document request', description: '', appointment_date: appointmentDate, appointment_time: '09:00:00',
      }) }),
    ))
    expect(await screen.findByRole('heading', { name: 'Clearance request' })).toBeInTheDocument()
    expect(screen.getByText('Confirmed appointment date')).toBeInTheDocument()
    expect(screen.getByText('Your appointment is confirmed. No staff approval is needed.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Case progress')).not.toBeInTheDocument()
    expect(screen.getByText(formatAppointmentDate(appointmentDate))).toBeInTheDocument()
    expect(screen.getByText('No additional details provided.')).toBeInTheDocument()
  })

  it('requires a current or future appointment date for service requests', async () => {
    window.localStorage.setItem('bcrts_session', JSON.stringify(resident))
    const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
      if (url.includes('/auth/me')) return response(resident.user)
      if (url.includes('/categories')) return response(['Other'])
      if (url.includes('/appointments/availability')) return response(availableDays())
      return response([])
    })
    vi.stubGlobal('fetch', fetchMock)
    window.history.pushState({}, '', '/new')
    render(<App />)
    await screen.findByRole('option', { name: 'Other' })
    await userEvent.click(screen.getByRole('radio', { name: /Request a service/ }))
    await screen.findByRole('option', { name: 'Other' })
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'Other')
    await userEvent.type(screen.getByLabelText('Subject'), 'Service appointment')
    const dateInput = screen.getByLabelText('Appointment date')
    expect(dateInput).toBeRequired()
    const form = screen.getByRole('button', { name: 'Submit case' }).closest('form')!
    fireEvent.submit(form)
    expect(await screen.findByRole('alert')).toHaveTextContent('Please select an appointment date.')

    const yesterday = new Date(`${todayInBarangay()}T00:00:00Z`)
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    fireEvent.change(dateInput, { target: { value: yesterday.toISOString().slice(0, 10) } })
    fireEvent.submit(form)
    expect(await screen.findByRole('alert')).toHaveTextContent('Appointment date must be today or a future date.')
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })

  it('renders resident cases', async () => {
    window.localStorage.setItem('bcrts_session', JSON.stringify(resident))
    vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('/auth/me') ? response(resident.user) : response(cases)))
    render(<App />)
    expect(await screen.findByText('Blocked canal')).toBeInTheDocument()
    expect(screen.getByText('Clearance request')).toBeInTheDocument()
    expect(screen.getByText(formatAppointmentDate(cases[1].appointment_date!))).toBeInTheDocument()
  })

  it('keeps scheduled services on the appointments page and filters the concern queue', async () => {
    window.localStorage.setItem('bcrts_session', JSON.stringify(staff))
    vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('/auth/me') ? response(staff.user) : response(cases)))
    window.history.pushState({}, '', '/staff')
    render(<App />)
    await screen.findByText('Blocked canal')
    expect(screen.queryByText('Clearance request')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Service appointments' })).toHaveAttribute('href', '/staff/appointments')
    await userEvent.selectOptions(screen.getByLabelText('Filter by type'), 'request')
    expect(screen.queryByText('Blocked canal')).not.toBeInTheDocument()
    expect(screen.getByText('No matching cases')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Filter by type'), 'complaint')
    expect(screen.getByText('Blocked canal')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Filter by status'), 'Resolved')
    expect(screen.getByText('No matching cases')).toBeInTheDocument()
  })

  it('searches the staff queue and disables export when there are no matches', async () => {
    window.localStorage.setItem('bcrts_session', JSON.stringify(staff))
    vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('/auth/me') ? response(staff.user) : response(cases)))
    window.history.pushState({}, '', '/staff')
    render(<App />)
    await screen.findByText('Blocked canal')

    await userEvent.type(screen.getByRole('textbox', { name: 'Search cases' }), 'drainage')
    expect(screen.getByText('Blocked canal')).toBeInTheDocument()
    expect(screen.queryByText('Clearance request')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download Excel (.xlsx)' })).toBeEnabled()

    await userEvent.clear(screen.getByRole('textbox', { name: 'Search cases' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Search cases' }), 'no matching case')
    expect(screen.getByText('No matching cases')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download Excel (.xlsx)' })).toBeDisabled()
  })

  it('updates a case to the next status', async () => {
    window.localStorage.setItem('bcrts_session', JSON.stringify(staff))
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (url.includes('/auth/me')) return response(staff.user)
      if (init?.method === 'PATCH') return response({ ...cases[0], status: 'In Progress' })
      return response(cases[0])
    }))
    window.history.pushState({}, '', '/cases/1')
    render(<App />)
    const button = await screen.findByRole('button', { name: 'Mark as In Progress' })
    await userEvent.click(button)
    await waitFor(() => expect(screen.getAllByText('In Progress').length).toBeGreaterThan(0))
  })
})
