import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
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
  { id: 1, reference_number: 'BCRTS-2026-ABC123', resident_id: 1, type: 'complaint', category: 'Drainage', subject: 'Blocked canal', description: 'The canal is blocked near our home.', status: 'Received', created_at: '2026-09-27T00:00:00Z', updated_at: '2026-09-27T00:00:00Z', resident: resident.user },
  { id: 2, reference_number: 'BCRTS-2026-DEF456', resident_id: 1, type: 'request', category: 'Barangay clearance', subject: 'Clearance request', description: 'Requesting a clearance for employment.', status: 'Resolved', created_at: '2026-09-26T00:00:00Z', updated_at: '2026-09-27T00:00:00Z', resident: resident.user },
]

function response(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
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

  it('renders resident cases', async () => {
    window.localStorage.setItem('bcrts_session', JSON.stringify(resident))
    vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('/auth/me') ? response(resident.user) : response(cases)))
    render(<App />)
    expect(await screen.findByText('Blocked canal')).toBeInTheDocument()
    expect(screen.getByText('Clearance request')).toBeInTheDocument()
  })

  it('filters the staff queue by type and status', async () => {
    window.localStorage.setItem('bcrts_session', JSON.stringify(staff))
    vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('/auth/me') ? response(staff.user) : response(cases)))
    window.history.pushState({}, '', '/staff')
    render(<App />)
    await screen.findByText('Blocked canal')
    await userEvent.selectOptions(screen.getByLabelText('Filter by type'), 'request')
    expect(screen.queryByText('Blocked canal')).not.toBeInTheDocument()
    expect(screen.getByText('Clearance request')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Filter by status'), 'Received')
    expect(screen.getByText('No matching cases')).toBeInTheDocument()
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
