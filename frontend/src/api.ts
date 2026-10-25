import type { AppointmentDay, AppointmentSchedule, AuthSession, CaseHistoryEntry, CaseInput, CaseNote, CaseRecord, CaseStatus, CaseType, User } from './types'

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
  forgotPassword: (email: string) =>
    request<{ message: string }>('/auth/forgot-password', {
      method: 'POST', body: JSON.stringify({ email }),
    }),
  resetPassword: (token: string, password: string) =>
    request<{ message: string }>('/auth/reset-password', {
      method: 'POST', body: JSON.stringify({ token, password }),
    }),
  me: (token: string) => request<User>('/auth/me', {}, token),
  categories: (type: CaseType) => request<string[]>(`/categories?type=${type}`),
  appointmentSettings: (token: string) => request<AppointmentSchedule>('/appointments/settings', {}, token),
  saveAppointmentSettings: (input: AppointmentSchedule, token: string) =>
    request<AppointmentSchedule>('/appointments/settings', { method: 'PUT', body: JSON.stringify(input) }, token),
  appointmentAvailability: (start: string, end: string, token: string) =>
    request<AppointmentDay[]>(`/appointments/availability?start_date=${start}&end_date=${end}`, {}, token),
  appointments: (start: string, end: string, token: string) =>
    request<CaseRecord[]>(`/appointments?start_date=${start}&end_date=${end}`, {}, token),
  cases: (token: string) => request<CaseRecord[]>('/cases', {}, token),
  case: (id: number, token: string) => request<CaseRecord>(`/cases/${id}`, {}, token),
  history: (id: number, token: string) => request<CaseHistoryEntry[]>(`/cases/${id}/history`, {}, token),
  notes: (id: number, token: string) => request<CaseNote[]>(`/cases/${id}/notes`, {}, token),
  addNote: (id: number, body: string, token: string) =>
    request<CaseNote>(`/cases/${id}/notes`, { method: 'POST', body: JSON.stringify({ body }) }, token),
  createCase: (input: CaseInput, token: string) =>
    request<CaseRecord>('/cases', { method: 'POST', body: JSON.stringify(input) }, token),
  updateStatus: (id: number, status: CaseStatus, token: string) =>
    request<CaseRecord>(
      `/cases/${id}/status`,
      { method: 'PATCH', body: JSON.stringify({ status }) },
      token,
    ),
}
