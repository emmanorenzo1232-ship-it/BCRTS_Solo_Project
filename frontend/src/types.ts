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
}
