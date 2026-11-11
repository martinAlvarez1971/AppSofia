import type {
  AvailabilityResult,
  CreateReservationInput,
  CreateTableInput,
  Reservation,
  RestaurantTable,
  TableOccupancy,
  TableStatus,
  UpdateTableInput,
} from './tables.types'

export class TablesApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'TablesApiError'
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
    throw new TablesApiError(0, 'No se pudo conectar con el servidor. Verificá que el backend esté iniciado.')
  }

  if (!response.ok) {
    let message = 'No se pudo completar la operación.'
    try {
      const body = (await response.json()) as { message?: string | string[] }
      if (Array.isArray(body.message)) message = body.message.join(' ')
      else if (body.message) message = body.message
    } catch {
      message = response.statusText || message
    }
    if (response.status === 401) message = 'La sesión venció. Iniciá sesión nuevamente.'
    if (response.status === 403) message = 'No tenés permisos para realizar esta operación.'
    throw new TablesApiError(response.status, message)
  }

  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export function listTables(token: string, filters?: { sector?: string; minCapacity?: number; status?: TableStatus; search?: string }) {
  const params = new URLSearchParams()
  if (filters?.sector) params.set('sector', filters.sector)
  if (filters?.minCapacity) params.set('minCapacity', filters.minCapacity.toString())
  if (filters?.status) params.set('status', filters.status)
  if (filters?.search) params.set('search', filters.search)
  const qs = params.toString() ? `?${params.toString()}` : ''
  return request<RestaurantTable[]>(`/tables${qs}`, token)
}

export function getTable(token: string, id: string) {
  return request<RestaurantTable>(`/tables/${id}`, token)
}

export function createTable(token: string, input: CreateTableInput) {
  return request<RestaurantTable>('/tables', token, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateTable(token: string, id: string, input: UpdateTableInput) {
  return request<RestaurantTable>(`/tables/${id}`, token, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function changeTableStatus(token: string, id: string, status: TableStatus) {
  return request<RestaurantTable>(`/tables/${id}/status`, token, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
}

export function toggleTableService(token: string, id: string, isOutOfService: boolean) {
  return request<RestaurantTable>(`/tables/${id}/service`, token, {
    method: 'PATCH',
    body: JSON.stringify({ isOutOfService }),
  })
}

export function updateTableOccupancy(token: string, id: string, currentOccupancy: TableOccupancy) {
  return request<RestaurantTable>(`/tables/${id}/occupancy`, token, {
    method: 'PATCH',
    body: JSON.stringify({ currentOccupancy }),
  })
}

export function checkAvailability(
  token: string,
  params: { startTime: string; durationMinutes?: number; partySize?: number },
) {
  const searchParams = new URLSearchParams()
  searchParams.set('startTime', params.startTime)
  if (params.durationMinutes) searchParams.set('durationMinutes', params.durationMinutes.toString())
  if (params.partySize) searchParams.set('partySize', params.partySize.toString())
  return request<AvailabilityResult>(`/reservations/availability?${searchParams.toString()}`, token)
}

export function createReservation(token: string, input: CreateReservationInput) {
  return request<Reservation>('/reservations', token, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}
