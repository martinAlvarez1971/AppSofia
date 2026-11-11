import type { OperationalReportResponse } from './reports.types';

/**
 * Calcula la fecha operativa actual en Buenos Aires (UTC-3 con corte 05:00 hs).
 */
export function getCurrentBuenosAiresOperationalDate(nowMs: number = Date.now()): string {
  const baMs = nowMs - 3 * 60 * 60 * 1000;
  const opMs = baMs - 5 * 60 * 60 * 1000;
  const d = new Date(opMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function shiftOperationalDate(ymd: string, deltaDays: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

export function getMonthStartOperationalDate(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

export function formatShortDate(ymd: string): string {
  if (!ymd || ymd.length < 10) return ymd;
  const [, m, d] = ymd.split('-');
  return `${d}/${m}`;
}

export function formatDateTimeBa(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDurationMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || isNaN(minutes)) return '—';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} m`;
}

export function translateCloseReason(reason: string | null): string {
  switch (reason) {
    case 'service_completed':
      return 'Servicio finalizado';
    case 'walk_in_closed':
      return 'Cierre walk-in';
    case 'operational_release':
      return 'Liberación operativa';
    case 'reservation_cancelled':
      return 'Reserva cancelada';
    default:
      return reason ? reason : 'En curso';
  }
}

export function translateShift(shift: 'lunch' | 'dinner' | 'other'): string {
  switch (shift) {
    case 'lunch':
      return 'Almuerzo';
    case 'dinner':
      return 'Cena';
    case 'other':
      return 'Fuera de turno';
  }
}

export function translateTableStatus(status: 'available' | 'occupied' | 'reserved' | 'out_of_service'): string {
  switch (status) {
    case 'available':
      return 'Libre';
    case 'occupied':
      return 'Ocupada';
    case 'reserved':
      return 'Reservada';
    case 'out_of_service':
      return 'Fuera de servicio';
  }
}

function escapeCsvCell(val: unknown): string {
  const str = val === null || val === undefined ? '' : String(val);
  if (/[",\n\r;]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildReportCsvContent(
  report: OperationalReportResponse,
  dataset: 'tables' | 'sessions' | 'daily',
): string {
  const rows: string[][] = [];

  if (dataset === 'tables') {
    rows.push([
      'Mesa',
      'Sector',
      'Capacidad Base',
      'Capacidad Máxima',
      'Estado Actual',
      'Reservas',
      'Sesiones Totales',
      'Walk-ins',
      'Comensales Totales',
      'Estadía Promedio (min)',
      'Participación (%)',
    ]);
    for (const t of report.tableMetrics) {
      rows.push([
        `Mesa ${t.tableNumber}`,
        t.sector,
        String(t.capacity),
        String(t.maxCapacity),
        translateTableStatus(t.status),
        String(t.reservationsCount),
        String(t.sessionsCount),
        String(t.walkInSessionsCount),
        String(t.totalGuests),
        String(t.avgDurationMinutes),
        `${t.utilizationSharePct}%`,
      ]);
    }
  } else if (dataset === 'sessions') {
    rows.push([
      'ID Sesión',
      'Fecha Operativa',
      'Hora Local BA',
      'Turno',
      'Mesa',
      'Sector',
      'Tipo',
      'Cliente / Referencia',
      'Comensales',
      'Duración Estimada (min)',
      'Duración Real (min)',
      'Excedida',
      'Motivo de Cierre',
      'Notas',
    ]);
    for (const s of report.recentSessions) {
      rows.push([
        s.id,
        s.operationalDate,
        s.localStartTime,
        translateShift(s.shift),
        `Mesa ${s.tableNumber}`,
        s.sector,
        s.sessionType === 'walk_in' ? 'Walk-in' : 'Reserva',
        s.customerName || 'Sin nombre',
        s.guestsCount !== null ? String(s.guestsCount) : '',
        String(s.expectedDurationMinutes),
        s.actualDurationMinutes !== null ? String(s.actualDurationMinutes) : 'En curso',
        s.isOverrun ? 'Sí' : 'No',
        translateCloseReason(s.closeReason),
        s.notes || '',
      ]);
    }
  } else {
    rows.push([
      'Fecha Operativa',
      'Reservas',
      'Finalizadas',
      'Canceladas',
      'No-show',
      'Walk-ins',
      'Sesiones Totales',
      'Total Comensales',
    ]);
    for (const d of report.dailySeries) {
      rows.push([
        d.date,
        String(d.reservationsCount),
        String(d.completedCount),
        String(d.cancelledCount),
        String(d.noShowCount),
        String(d.walkInsCount),
        String(d.sessionsCount),
        String(d.totalGuests),
      ]);
    }
  }

  // UTF-8 BOM para Excel en español
  return '\uFEFF' + rows.map((r) => r.map(escapeCsvCell).join(';')).join('\r\n');
}

export function downloadReportCsv(
  report: OperationalReportResponse,
  dataset: 'tables' | 'sessions' | 'daily',
): void {
  const csv = buildReportCsvContent(report, dataset);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const suffix = report.filtersApplied.startDate || getCurrentBuenosAiresOperationalDate();
  link.href = url;
  link.download = `sofia-informe-${dataset}-${suffix}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
