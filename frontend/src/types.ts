export type Role = 'resident' | 'staff'
export type CaseType = 'complaint' | 'request'
export type CaseStatus = 'Received' | 'In Progress' | 'Resolved' | 'Closed'

export interface User {
  id: number
  name: string
  email: string
  role: Role
  created_at: string
}

export interface AuthSession {
  access_token: string
  token_type: 'bearer'
  user: User
}

export interface CaseRecord {
  id: number
  reference_number: string
  resident_id: number
  type: CaseType
  category: string
  subject: string
  description: string
  appointment_date: string | null
  appointment_time: string | null
  appointment_status: 'Upcoming' | 'Today' | 'Past' | null
  status: CaseStatus
  created_at: string
  updated_at: string
  resident: Pick<User, 'id' | 'name' | 'email'>
}

export interface CaseInput {
  type: CaseType
  category: string
  subject: string
  description: string
  appointment_date?: string
  appointment_time?: string
}

export interface AppointmentSchedule {
  start_date: string
  interval_days: number
  weekdays: number[]
  opening_time: string
  closing_time: string
  slot_minutes: 15 | 30 | 60
  slot_capacity: number
  daily_limit: number
}

export interface AppointmentDay {
  date: string
  scheduled: boolean
  booked: number
  remaining: number
  slots: { time: string; remaining: number }[]
}

export interface CaseHistoryEntry {
  id: number
  from_status: CaseStatus | null
  to_status: CaseStatus
  created_at: string
  actor: Pick<User, 'id' | 'name' | 'role'>
}

export interface CaseNote {
  id: number
  body: string
  created_at: string
  author: Pick<User, 'id' | 'name' | 'role'>
}
