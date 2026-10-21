import type { AppRole, ProfileStatus } from '../auth/auth.types'

export interface ManagedUser {
  id: string
  firstName: string | null
  lastName: string | null
  email: string
  role: AppRole
  status: ProfileStatus
  createdAt: string
}

export class UsersApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'UsersApiError'
  }
}

const apiBase = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api').replace(/\/$/, '')

async function request<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${apiBase}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    })
  } catch {
    throw new UsersApiError(0, 'No se pudo conectar con la API. Verificá que el backend esté iniciado.')
  }

  if (!response.ok) {
    let message = 'No se pudo completar la operación.'
    try {
      const body = await response.json() as { message?: string | string[] }
      if (Array.isArray(body.message)) message = body.message.join(' ')
      else if (body.message) message = body.message
    } catch {
      message = response.statusText || message
    }
    if (response.status === 401) message = 'La sesión venció. Iniciá sesión nuevamente.'
    if (response.status === 403) message = 'No tenés permisos para administrar cuentas.'
    throw new UsersApiError(response.status, message)
  }

  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export function listUsers(token: string) {
  return request<ManagedUser[]>('/users', token)
}

export function inviteUser(token: string, input: {
  firstName: string
  lastName: string
  email: string
  role: 'operational_admin'
}) {
  return request<{ user: ManagedUser; invitationSent: boolean }>('/users', token, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function changeUserStatus(token: string, id: string, status: ProfileStatus) {
  return request<ManagedUser>(`/users/${id}/status`, token, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
}

export function transferSuperAdmin(token: string, id: string) {
  return request<ManagedUser & { currentUserDemoted: boolean }>(`/users/${id}/role`, token, {
    method: 'PATCH',
    body: JSON.stringify({ role: 'super_admin' }),
  })
}

export function sendPasswordReset(token: string, id: string) {
  return request<{ message: string }>(`/users/${id}/reset-password`, token, { method: 'POST' })
}