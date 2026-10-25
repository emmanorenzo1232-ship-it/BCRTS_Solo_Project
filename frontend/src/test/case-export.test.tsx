import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { downloadCasesReport } from '../caseReport'
import type { AuthSession, CaseRecord } from '../types'

vi.mock('../caseReport', () => ({ downloadCasesReport: vi.fn() }))

const staff: AuthSession = {
  access_token: 'staff-token', token_type: 'bearer',
  user: { id: 2, name: 'Barangay Staff', email: 'staff@example.com', role: 'staff', created_at: '2026-09-27T00:00:00Z' },
}
const first: CaseRecord = {
  id: 1, reference_number: 'BCRTS-2026-ABC123', resident_id: 1, type: 'complaint', category: 'Drainage',
  subject: 'Blocked canal', description: 'Baradong kanal', status: 'Received',
  appointment_date: null, appointment_time: null, appointment_status: null,
  created_at: '2026-10-25T16:05:00Z', updated_at: '2026-10-25T16:05:00Z',
  resident: { id: 1, name: 'José Peña', email: 'jose@example.com' },
}
const cases: CaseRecord[] = [first,
  { ...first, id: 2, subject: 'Broken streetlight', category: 'Streetlighting', status: 'Closed' },
  { ...first, id: 3, subject: 'Scheduled service', type: 'request', appointment_date: '2026-10-26' },
  { ...first, id: 4, reference_number: 'BCRTS-2026-DEF456' },
]

describe('staff Excel download', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    window.localStorage.setItem('bcrts_session', JSON.stringify(staff))
    window.history.pushState({}, '', '/staff')
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(new Response(
      JSON.stringify(url.includes('/auth/me') ? staff.user : cases), { headers: { 'Content-Type': 'application/json' } },
    ))))
    vi.mocked(downloadCasesReport).mockResolvedValue(undefined)
  })

  it('exports only matching queue cases in order with the selected filters', async () => {
    // Avoid duplicate subject text when waiting for the queue to finish loading.
    render(<App />)
    await screen.findByText('Broken streetlight')
    await userEvent.type(screen.getByRole('textbox', { name: 'Search cases' }), 'drainage')
    await userEvent.selectOptions(screen.getByLabelText('Filter by status'), 'Received')
    await userEvent.selectOptions(screen.getByLabelText('Filter by type'), 'complaint')
    await userEvent.click(screen.getByRole('button', { name: 'Download Excel (.xlsx)' }))
    await waitFor(() => expect(downloadCasesReport).toHaveBeenCalledExactlyOnceWith(
      [cases[0], cases[3]], { search: 'drainage', status: 'Received', type: 'complaint' }, expect.any(Date),
    ))
    expect(screen.queryByText('Scheduled service')).not.toBeInTheDocument()
  })

  it('disables an empty export', async () => {
    render(<App />)
    await screen.findByText('Broken streetlight')
    await userEvent.type(screen.getByRole('textbox', { name: 'Search cases' }), 'no matching concern')
    const button = screen.getByRole('button', { name: 'Download Excel (.xlsx)' })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(downloadCasesReport).not.toHaveBeenCalled()
  })

  it('shows progress and blocks repeated clicks until generation finishes', async () => {
    let finish!: () => void
    vi.mocked(downloadCasesReport).mockReturnValue(new Promise<void>((resolve) => { finish = resolve }))
    render(<App />)
    await screen.findByText('Broken streetlight')
    fireEvent.click(screen.getByRole('button', { name: 'Download Excel (.xlsx)' }))
    const busy = await screen.findByRole('button', { name: 'Generating…' })
    expect(busy).toBeDisabled()
    expect(busy).toHaveAttribute('aria-busy', 'true')
    fireEvent.click(busy)
    await waitFor(() => expect(downloadCasesReport).toHaveBeenCalledOnce())
    await act(async () => { finish() })
    expect(screen.getByRole('button', { name: 'Download Excel (.xlsx)' })).toBeEnabled()
  })

  it('shows a recoverable error and allows a successful retry', async () => {
    vi.mocked(downloadCasesReport).mockRejectedValueOnce(new Error('Failed to write workbook'))
    render(<App />)
    await screen.findByText('Broken streetlight')
    await userEvent.click(screen.getByRole('button', { name: 'Download Excel (.xlsx)' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to generate the Excel report. Please try downloading again.')
    const button = screen.getByRole('button', { name: 'Download Excel (.xlsx)' })
    expect(button).toBeEnabled()
    await userEvent.click(button)
    await waitFor(() => expect(downloadCasesReport).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(button).toBeEnabled()
  })
})
