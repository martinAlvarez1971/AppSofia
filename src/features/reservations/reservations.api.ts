import type {
  ReservationQueryFilters,
  ReservationOverviewStats,
  SearchResponse,
  CalendarResponse,
  ReservationQueryResult,
  CustomersResponse,
  ReservationAuditTimelineEntry,
} from './reservations.types';

const apiBase = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');

export class ReservationsApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = 'ReservationsApiError';
  }
}

async function getRequest<T>(endpoint: string, token: string, params?: Record<string, any>): Promise<T> {
  const url = new URL(`${apiBase}/reservations-query${endpoint}`, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([key, val]) => {
      if (val !== undefined && val !== null && val !== '') {
        url.searchParams.append(key, String(val));
      }
    });
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
  } catch {
    throw new ReservationsApiError(0, 'No se pudo conectar con el servidor de SOFIA.');
  }

  if (!response.ok) {
    let message = 'Error al consultar reservas.';
    let details: unknown = null;
    try {
      const data = await response.json();
      if (data.message) message = data.message;
      if (data.details) details = data.details;
    } catch {
      message = response.statusText || message;
    }
    throw new ReservationsApiError(response.status, message, details);
  }

  return response.json() as Promise<T>;
}

export const reservationsApi = {
  getOverview(token: string, filters?: Partial<ReservationQueryFilters>): Promise<ReservationOverviewStats> {
    return getRequest<ReservationOverviewStats>('/overview', token, filters);
  },

  search(token: string, filters?: Partial<ReservationQueryFilters>): Promise<SearchResponse> {
    return getRequest<SearchResponse>('/search', token, filters);
  },

  getCalendar(token: string, filters?: Partial<ReservationQueryFilters>): Promise<CalendarResponse> {
    return getRequest<CalendarResponse>('/calendar', token, filters);
  },

  getDetail(token: string, id: string): Promise<ReservationQueryResult> {
    return getRequest<ReservationQueryResult>(`/detail/${encodeURIComponent(id)}`, token);
  },

  getTimeline(token: string, id: string): Promise<ReservationAuditTimelineEntry[]> {
    return getRequest<ReservationAuditTimelineEntry[]>(`/timeline/${encodeURIComponent(id)}`, token);
  },

  getCustomers(token: string, params?: { q?: string; page?: number; limit?: number }): Promise<CustomersResponse> {
    return getRequest<CustomersResponse>('/customers', token, params);
  },
};
