import type {
  Table,
  Reservation,
  TableSessionSummary,
  OperationalSettings,
  CapacityCheckResult,
  DeactivationCheckResult,
  CreateReservationPayload,
  CreateTablePayload,
  InitializeFloorPlanPayload,
  ReassignTablesPayload,
} from './tables.types'

const apiBase = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')

export class TablesApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'TablesApiError'
  }
}

function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `sofia-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

async function request<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method || 'GET').toUpperCase()
  const isMutation = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS'
  let response: Response
  try {
    response = await fetch(`${apiBase}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(isMutation ? { 'Idempotency-Key': generateIdempotencyKey() } : {}),
        ...init.headers,
      },
    })
  } catch {
    throw new TablesApiError(0, 'No se pudo conectar con el servidor de SOFIA.')
  }

  if (!response.ok) {
    let message = 'Error en la operación de sala.'
    let details: unknown = null
    let code: string | undefined
    try {
      const data = await response.json()
      if (data.message) message = data.message
      if (data.details) details = data.details
      if (data.code) code = data.code
    } catch {
      message = response.statusText || message
    }
    throw new TablesApiError(response.status, message, details, code)
  }

  return response.json() as Promise<T>
}

export const tablesApi = {
  getTables(token: string) {
    return request<Table[]>('/tables', token)
  },

  getReservations(token: string) {
    return request<Reservation[]>('/reservations', token)
  },

  getOperationalSettings(token: string) {
    return request<OperationalSettings>('/settings/operational', token)
  },

  updateOperationalSettings(
    token: string,
    payload: Omit<OperationalSettings, 'updatedAt'> & { reason?: string },
  ) {
    return request<OperationalSettings>('/settings/operational', token, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
  },

  checkCapacityConflict(token: string, tableId: string, newCapacity: number) {
    return request<CapacityCheckResult>(`/tables/${tableId}/check-capacity?capacity=${newCapacity}`, token)
  },

  updateCapacity(token: string, tableId: string, newCapacity: number, reason: string, force = false) {
    return request<Table>(`/tables/${tableId}/capacity`, token, {
      method: 'PATCH',
      body: JSON.stringify({ capacity: newCapacity, reason, force }),
    })
  },

  checkDeactivation(token: string, tableId: string) {
    return request<DeactivationCheckResult>(`/tables/${tableId}/check-deactivation`, token)
  },

  updateStatus(
    token: string,
    tableId: string,
    status: 'available' | 'out_of_service',
    reason?: string,
  ) {
    return request<Table>(`/tables/${tableId}/status`, token, {
      method: 'PATCH',
      body: JSON.stringify({ status, reason }),
    })
  },

  openWalkIn(
    token: string,
    tableId: string,
    payload: { guestsCount?: number; expectedDurationMinutes?: number; notes?: string } = {},
  ) {
    return request<TableSessionSummary>(`/tables/${tableId}/walk-in`, token, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  releaseTableOperational(token: string, tableId: string, reason: string) {
    return request<{ tableId: string; number: number; status: Table['status']; closedSessionId: string | null }>(
      `/tables/${tableId}/release-operational`,
      token,
      {
        method: 'POST',
        body: JSON.stringify({ reason }),
      },
    )
  },

  extendTableSession(token: string, sessionId: string, extraMinutes: number, reason?: string) {
    return request<{ id: string; tableId: string; expectedDurationMinutes: number; estimatedEndAt: string }>(
      `/table-sessions/${sessionId}/extend`,
      token,
      {
        method: 'PATCH',
        body: JSON.stringify({ extraMinutes, reason }),
      },
    )
  },

  closeWalkInSession(token: string, sessionId: string, notes?: string) {
    return request<{ id: string; tableId: string; endedAt: string; closeReason: string }>(
      `/table-sessions/${sessionId}/close`,
      token,
      {
        method: 'POST',
        body: JSON.stringify({ notes }),
      },
    )
  },

  createReservation(token: string, payload: CreateReservationPayload) {
    return request<Reservation>('/reservations', token, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  reassignReservationTables(token: string, reservationId: string, payload: ReassignTablesPayload) {
    return request<{ id: string; previousTableIds: string[]; tableIds: string[] }>(
      `/reservations/${reservationId}/reassign-tables`,
      token,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    )
  },

  seatReservation(
    token: string,
    reservationId: string,
    payload: { expectedDurationMinutes?: number; notes?: string } = {},
  ) {
    return request<{
      id: string
      status: 'seated'
      seatedAt: string
      tableIds: string[]
      sessionIds: string[]
      estimatedEndAt: string
    }>(`/reservations/${reservationId}/seat`, token, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  noShowReservation(token: string, reservationId: string, reason: string) {
    return request<{ id: string; status: 'no_show'; noShowAt: string }>(
      `/reservations/${reservationId}/no-show`,
      token,
      {
        method: 'POST',
        body: JSON.stringify({ reason }),
      },
    )
  },

  completeService(token: string, reservationId: string, notes?: string) {
    return request<{
      id: string
      status: 'completed'
      completedAt: string
      closedSessionIds: string[]
      tableIds: string[]
    }>(`/reservations/${reservationId}/complete-service`, token, {
      method: 'POST',
      body: JSON.stringify({ notes }),
    })
  },

  cancelReservation(token: string, reservationId: string, reason: string) {
    return request<{ message: string; reservation: Reservation }>(`/reservations/${reservationId}/cancel`, token, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    })
  },

  createTable(token: string, payload: CreateTablePayload) {
    return request<Table>('/tables', token, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  initializeFloorPlan(token: string, payload: InitializeFloorPlanPayload) {
    return request<{ message: string; count: number; tables: Table[] }>('/tables/initialize-floorplan', token, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  deleteTable(token: string, tableId: string, reason?: string) {
    return request<{ message: string }>(`/tables/${tableId}`, token, {
      method: 'DELETE',
      ...(reason ? { body: JSON.stringify({ reason }) } : {}),
    })
  },
}
