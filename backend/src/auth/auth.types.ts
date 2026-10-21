import type { Request } from 'express'

export type AuthenticatedActor = {
  id: string
  email: string
  role: 'super_admin' | 'operational_admin'
}

export type UserRequest = Request & { user?: AuthenticatedActor }