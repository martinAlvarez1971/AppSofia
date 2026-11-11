import { createContext, useContext } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { Profile } from './auth.types'

export type AuthStatus = 'loading' | 'ready' | 'unconfigured' | 'error'
export type AuthValue = {
  session: Session | null
  profile: Profile | null
  passwordRecovery: boolean
  status: AuthStatus
  configured: boolean
  signIn: (email: string, password: string) => Promise<string | null>
  signOut: () => Promise<string | null>
  recover: (email: string) => Promise<boolean>
  updatePassword: (password: string) => Promise<string | null>
  enterDemoMode?: (role?: 'super_admin' | 'operational_admin') => void
  isDemo?: boolean
}

export const AuthContext = createContext<AuthValue | null>(null)

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth debe utilizarse dentro de AuthProvider.')
  return value
}