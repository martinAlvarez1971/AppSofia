import type { OperationalReportResponse, ReportsFilters } from './reports.types';

const apiBase = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');

export class ReportsApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ReportsApiError';
  }
}

export const reportsApi = {
  async getOverview(token: string, filters?: ReportsFilters): Promise<OperationalReportResponse> {
    const url = new URL(`${apiBase}/reports/overview`, window.location.origin);
    if (filters) {
      if (filters.startDate) url.searchParams.set('startDate', filters.startDate);
      if (filters.endDate) url.searchParams.set('endDate', filters.endDate);
      if (filters.sector && filters.sector !== 'all') url.searchParams.set('sector', filters.sector);
      if (filters.shift && filters.shift !== 'all') url.searchParams.set('shift', filters.shift);
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
      throw new ReportsApiError(0, 'No se pudo conectar con el servidor de SOFIA para generar informes.');
    }

    if (!response.ok) {
      let message = 'Error al obtener informes operativos.';
      let details: unknown = null;
      try {
        const data = await response.json();
        if (data.message) message = data.message;
        if (data.details) details = data.details;
      } catch {
        message = response.statusText || message;
      }
      throw new ReportsApiError(response.status, message, details);
    }

    return response.json() as Promise<OperationalReportResponse>;
  },
};
