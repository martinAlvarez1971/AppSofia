import type { AdminAlert, AlertsSummary, AuditLogEntry } from './alerts.types'

const apiBase = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')

export class AlertsApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'AlertsApiError'
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
    throw new AlertsApiError(0, 'No se pudo conectar con el servidor de SOFIA.')
  }

  if (!response.ok) {
    let message = 'Error al consultar las alertas administrativas.'
    try {
      const data = await response.json()
      if (data.message) message = data.message
    } catch {
      message = response.statusText || message
    }
    if (response.status === 401) message = 'Sesión vencida o no autorizada.'
    if (response.status === 403) message = 'Acceso denegado: esta sección es exclusiva para el Administrador Principal.'
    throw new AlertsApiError(response.status, message)
  }

  return response.json() as Promise<T>
}

export const alertsApi = {
  getAlerts(token: string, params?: { status?: string; severity?: string }) {
    const search = new URLSearchParams()
    if (params?.status) search.set('status', params.status)
    if (params?.severity) search.set('severity', params.severity)
    const qs = search.toString() ? `?${search.toString()}` : ''
    return request<{ alerts: AdminAlert[]; summary: AlertsSummary }>(`/alerts${qs}`, token)
  },

  reviewAlert(token: string, alertId: string) {
    return request<AdminAlert>(`/alerts/${alertId}/review`, token, {
      method: 'PATCH',
    })
  },

  getAuditLogs(token: string) {
    return request<AuditLogEntry[]>('/audit-logs', token)
  },
}
