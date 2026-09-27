import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from './api'
import type { AuthSession, User } from './types'

const STORAGE_KEY = 'bcrts_session'

interface AuthValue {
  user: User | null
  token: string | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (name: string, email: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthValue | null>(null)

function readSession(): AuthSession | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return value ? (JSON.parse(value) as AuthSession) : null
  } catch {
    window.localStorage.removeItem(STORAGE_KEY)
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(readSession)
  const [loading, setLoading] = useState(Boolean(session))

  useEffect(() => {
    if (!session) return setLoading(false)
    api.me(session.access_token)
      .then((user) => {
        const refreshed = { ...session, user }
        setSession(refreshed)
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(refreshed))
      })
      .catch(() => {
        setSession(null)
        window.localStorage.removeItem(STORAGE_KEY)
      })
      .finally(() => setLoading(false))
  }, []) // Restore once on application start.

  const save = (next: AuthSession) => {
    setSession(next)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }

  const value = useMemo<AuthValue>(() => ({
    user: session?.user ?? null,
    token: session?.access_token ?? null,
    loading,
    login: async (email, password) => save(await api.login(email, password)),
    register: async (name, email, password) => save(await api.register(name, email, password)),
    logout: () => {
      setSession(null)
      window.localStorage.removeItem(STORAGE_KEY)
    },
  }), [session, loading])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
