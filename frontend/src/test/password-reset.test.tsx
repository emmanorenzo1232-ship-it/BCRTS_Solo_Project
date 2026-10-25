import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'

function response(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  }))
}

describe('Password recovery', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    window.history.pushState({}, '', '/login')
  })

  it('opens recovery from login and requests a link', async () => {
    const fetch = vi.fn(() => response({ message: 'If an account exists for that email, a password reset link has been sent.' }, 202))
    vi.stubGlobal('fetch', fetch)
    render(<App />)
    await userEvent.click(screen.getByRole('link', { name: 'Forgot password?' }))
    expect(screen.getByRole('heading', { name: 'Forgot your password?' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Email address'), 'juan@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(await screen.findByRole('status')).toHaveTextContent('If an account exists')
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/auth/forgot-password'), expect.objectContaining({
      method: 'POST', body: JSON.stringify({ email: 'juan@example.com' }),
    }))
    await userEvent.click(screen.getByRole('link', { name: 'Back to sign in' }))
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument()
  })

  it('validates confirmation and resets the password using the link token', async () => {
    window.history.pushState({}, '', '/reset-password#token=reset-secret')
    const fetch = vi.fn(() => response({ message: 'Your password has been reset. Sign in with your new password.' }))
    vi.stubGlobal('fetch', fetch)
    render(<App />)
    expect(window.location.hash).toBe('')
    await userEvent.type(screen.getByLabelText('New password'), 'new-password')
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'wrong-password')
    await userEvent.click(screen.getByRole('button', { name: 'Reset password' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Passwords do not match')
    expect(fetch).not.toHaveBeenCalled()

    await userEvent.clear(screen.getByLabelText('Confirm new password'))
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'new-password')
    await userEvent.click(screen.getByRole('button', { name: 'Reset password' }))
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Your password has been reset')
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/auth/reset-password'), expect.objectContaining({
      method: 'POST', body: JSON.stringify({ token: 'reset-secret', password: 'new-password' }),
    }))
    expect(screen.getByLabelText('Password')).toHaveValue('')
  })

  it('requires a reset token and offers a new link', async () => {
    window.history.pushState({}, '', '/reset-password')
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    render(<App />)
    expect(screen.getByRole('alert')).toHaveTextContent('missing its token')
    expect(screen.getByRole('button', { name: 'Reset password' })).toBeDisabled()
    await userEvent.click(screen.getByRole('link', { name: 'Request a new reset link' }))
    expect(screen.getByRole('heading', { name: 'Forgot your password?' })).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('shows expired-link errors and allows requesting a replacement', async () => {
    window.history.pushState({}, '', '/reset-password#token=expired-token')
    vi.stubGlobal('fetch', vi.fn(() => response({ error: { message: 'This reset link is invalid or has expired. Request a new link.' } }, 400)))
    render(<App />)
    await userEvent.type(screen.getByLabelText('New password'), 'new-password')
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'new-password')
    await userEvent.click(screen.getByRole('button', { name: 'Reset password' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid or has expired')
    expect(screen.getByRole('button', { name: 'Reset password' })).toBeEnabled()
    await userEvent.click(screen.getByRole('link', { name: 'Request a new reset link' }))
    expect(screen.getByRole('heading', { name: 'Forgot your password?' })).toBeInTheDocument()
  })

  it('prevents duplicate recovery submissions and shows request errors', async () => {
    window.history.pushState({}, '', '/forgot-password')
    let finish!: (value: Response) => void
    const fetch = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve }))
    vi.stubGlobal('fetch', fetch)
    render(<App />)
    await userEvent.type(screen.getByLabelText('Email address'), 'juan@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(screen.getByRole('button', { name: 'Please wait…' })).toBeDisabled()
    finish(new Response(JSON.stringify({ error: { message: 'Too many reset requests. Try again in 15 minutes.' } }), { status: 429 }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many reset requests')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send reset link' })).toBeEnabled())
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
