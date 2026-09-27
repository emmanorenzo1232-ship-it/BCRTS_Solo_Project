import type { AuthSession, CaseInput, CaseRecord, CaseStatus, User } from './types'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api'

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new ApiError(body?.error?.message ?? 'Something went wrong. Please try again.', response.status)
  }
  return body as T
}

export const api = {
  login: (email: string, password: string) =>
    request<AuthSession>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (name: string, email: string, password: string) =>
    request<AuthSession>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    }),
  me: (token: string) => request<User>('/auth/me', {}, token),
  categories: () => request<string[]>('/categories'),
  cases: (token: string) => request<CaseRecord[]>('/cases', {}, token),
  case: (id: number, token: string) => request<CaseRecord>(`/cases/${id}`, {}, token),
  createCase: (input: CaseInput, token: string) =>
    request<CaseRecord>('/cases', { method: 'POST', body: JSON.stringify(input) }, token),
  updateStatus: (id: number, status: CaseStatus, token: string) =>
    request<CaseRecord>(
      `/cases/${id}/status`,
      { method: 'PATCH', body: JSON.stringify({ status }) },
      token,
    ),
}
