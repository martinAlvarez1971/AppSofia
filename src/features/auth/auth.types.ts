export type AppRole = 'super_admin' | 'operational_admin'
export type ProfileStatus = 'active' | 'inactive'

export interface Profile {
  id: string
  first_name: string | null
  last_name: string | null
  email: string
  role: AppRole
  status: ProfileStatus
  created_at: string
  updated_at: string
}