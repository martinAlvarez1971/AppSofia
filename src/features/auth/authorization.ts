import type { AppRole, Profile } from './auth.types'

export type AccessSnapshot = {
  loading: boolean
  configured: boolean
  userId: string | null
  profile: Pick<Profile, 'role' | 'status'> | null
  error: boolean
}

export function getAccessDecision(snapshot: AccessSnapshot, roles?: readonly AppRole[]) {
  if (snapshot.loading) return 'loading'
  if (!snapshot.configured) return 'unconfigured'
  if (snapshot.error) return 'error'
  if (!snapshot.userId) return 'unauthenticated'
  if (!snapshot.profile || snapshot.profile.status !== 'active') return 'pending'
  if (roles && !roles.includes(snapshot.profile.role)) return 'forbidden'
  return 'allowed'
}