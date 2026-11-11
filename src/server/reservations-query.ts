import { Router, type Request, type Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';

// =========================================================================
// Tipos y Contrato Único de Filtros para Consultas de Reservas
// =========================================================================

export type ReservationStatus = 'confirmed' | 'seated' | 'completed' | 'cancelled' | 'no_show';
export type ShiftType = 'lunch' | 'dinner' | 'other';

export interface ReservationQueryFilters {
  q?: string;
  startDate?: string; // Fecha operativa YYYY-MM-DD
  endDate?: string;   // Fecha operativa YYYY-MM-DD
  status?: ReservationStatus | 'all';
  shift?: ShiftType | 'all';
  sector?: string;
  tableNumber?: number;
  minGuests?: number;
  maxGuests?: number;
  sortBy: 'startTime' | 'customerName' | 'guestsCount' | 'status' | 'createdAt';
  sortOrder: 'asc' | 'desc';
  page: number;
  limit: number;
}

export interface AssociatedTable {
  id: string;
  number: number;
  sector: string;
  capacity: number;
  maxCapacity?: number;
}

export interface ProfileSummary {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  role: string;
}

export interface ReservationQueryResult {
  id: string;
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  guestsCount: number;
  reservationDate: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  status: ReservationStatus;
  notes: string | null;
  cancellationReason: string | null;
  seatedAt?: string | null;
  completedAt?: string | null;
  noShowAt?: string | null;
  createdAt: string;
  updatedAt: string;
  // Campos calculados para jornada gastronómica
  calendarDate: string;
  operationalDate: string;
  localStartTime: string;
  localEndTime: string;
  shift: ShiftType;
  isMidnightRollover: boolean;
  // Mesas asociadas (soporte individual y unión múltiple)
  tables: AssociatedTable[];
  createdByProfile?: ProfileSummary | null;
  cancelledByProfile?: ProfileSummary | null;
}

export interface ReservationOverviewStats {
  total: number;
  confirmed: number;
  seated: number;
  completed: number;
  cancelled: number;
  no_show: number;
  totalGuests: number;
  shifts: {
    lunch: number;
    dinner: number;
    other: number;
  };
}

export interface CustomerSummaryItem {
  clientKey: string;
  primaryName: string;
  primaryPhone: string | null;
  primaryEmail: string | null;
  totalReservations: number;
  completedReservations: number;
  cancelledReservations: number;
  noShowReservations: number;
  totalGuests: number;
  firstVisit: string;
  lastVisit: string;
  favoriteShift: ShiftType;
  recentReservations: Array<{
    id: string;
    operationalDate: string;
    startTime: string;
    guestsCount: number;
    status: ReservationStatus;
    tables: number[];
  }>;
}

export interface ReservationAuditTimelineEntry {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  status: string;
  reason: string | null;
  createdAt: string;
  actorId: string | null;
  actorName: string;
  actorEmail: string | null;
  actorRole: string | null;
}

// =========================================================================
// Utilidades de Fechas y Zona Horaria (America/Argentina/Buenos_Aires)
// =========================================================================

/**
 * Buenos Aires se encuentra en UTC-3 sin horario de verano.
 * Permite descomponer con exactitud el instante UTC en su fecha civil local,
 * fecha operativa gastronómica (con retraso de 5 horas), turno y cruce de medianoche.
 */
export function getBuenosAiresParts(dateInput: string | Date): {
  calendarDate: string;
  operationalDate: string;
  localTimeStr: string;
  hours: number;
  minutes: number;
  shift: ShiftType;
  isMidnightRollover: boolean;
} {
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(d.getTime())) {
    throw new Error('Fecha u hora inválida');
  }

  // Desplazamiento UTC-3 (180 minutos)
  const utcMs = d.getTime();
  const baMs = utcMs - 3 * 60 * 60 * 1000;
  const baDate = new Date(baMs);

  const year = baDate.getUTCFullYear();
  const month = String(baDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(baDate.getUTCDate()).padStart(2, '0');
  const calendarDate = `${year}-${month}-${day}`;

  const hours = baDate.getUTCHours();
  const minutes = baDate.getUTCMinutes();
  const localTimeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

  // Fecha operativa gastronómica: (start_time AT TIME ZONE 'America/Argentina/Buenos_Aires') - interval '5 hours'
  // La jornada comienza a las 05:00 hs y finaliza a las 04:59 hs del día siguiente.
  const opMs = baMs - 5 * 60 * 60 * 1000;
  const opDateObj = new Date(opMs);
  const opYear = opDateObj.getUTCFullYear();
  const opMonth = String(opDateObj.getUTCMonth() + 1).padStart(2, '0');
  const opDay = String(opDateObj.getUTCDate()).padStart(2, '0');
  const operationalDate = `${opYear}-${opMonth}-${opDay}`;

  // Turnos gastronómicos autorizados:
  // - Almuerzo (lunch): 11:30 a 16:00 inclusive.
  // - Cena (dinner): 19:30 a 01:30 inclusive (cruza medianoche).
  // - Fuera de turno (other): los demás horarios.
  const timeMinutes = hours * 60 + minutes;
  let shift: ShiftType = 'other';
  if (timeMinutes >= 11 * 60 + 30 && timeMinutes <= 16 * 60) {
    shift = 'lunch';
  } else if (timeMinutes >= 19 * 60 + 30 || timeMinutes <= 1 * 60 + 30) {
    shift = 'dinner';
  } else {
    shift = 'other';
  }

  // Indicador de trasnochada (servicio nocturno post medianoche: 00:00 a 04:59)
  const isMidnightRollover = hours >= 0 && hours < 5;

  return {
    calendarDate,
    operationalDate,
    localTimeStr,
    hours,
    minutes,
    shift,
    isMidnightRollover,
  };
}

/**
 * Normalización telefónica según estándar argentino (E.164 10 dígitos)
 * e internacional conforme a la matriz de auditoría aprobada.
 */
export function normalizePhone(rawPhone: string | null | undefined, reservationId: string): string {
  if (!rawPhone || !rawPhone.trim()) {
    return `ambiguous:${reservationId}`;
  }
  const trimmed = rawPhone.trim();
  const digitsOnly = trimmed.replace(/\D/g, '');

  // Número con formato internacional explícito '+'
  if (trimmed.startsWith('+')) {
    // Caso Argentina (+54 o +54 9)
    if (trimmed.startsWith('+54') || digitsOnly.startsWith('54')) {
      let national = digitsOnly.replace(/^54/, '');
      if (national.startsWith('9')) {
        national = national.substring(1);
      }
      // Remoción de 15 tras código de área
      if (national.length === 12 && national.startsWith('1115')) {
        national = '11' + national.substring(4);
      } else if (national.length === 11 && national.startsWith('1115')) {
        national = '11' + national.substring(4);
      } else if (national.length === 12 && national.substring(3, 5) === '15') {
        national = national.substring(0, 3) + national.substring(5);
      } else if (national.length === 11 && national.substring(2, 4) === '15') {
        national = national.substring(0, 2) + national.substring(4);
      }

      if (national.length === 10 && !national.startsWith('15')) {
        return `ar:${national}`;
      }
      return `ambiguous:${reservationId}`;
    } else {
      // Número internacional no argentino
      // Si tiene menos de 6 dígitos se considera incompleto y se aísla por reserva
      if (digitsOnly.length >= 6) {
        return `intl:+${digitsOnly}`;
      }
      return `ambiguous:${reservationId}`;
    }
  }

  // Número nacional argentino sin '+'
  let nat = digitsOnly;
  if (nat.startsWith('0')) {
    nat = nat.substring(1);
  }

  if (nat.length === 12 && nat.startsWith('1115')) {
    nat = '11' + nat.substring(4);
  } else if (nat.length === 11 && nat.startsWith('1115')) {
    nat = '11' + nat.substring(4);
  } else if (nat.length === 12 && nat.substring(3, 5) === '15') {
    nat = nat.substring(0, 3) + nat.substring(5);
  } else if (nat.length === 11 && nat.substring(2, 4) === '15') {
    nat = nat.substring(0, 2) + nat.substring(4);
  }

  if (nat.length === 10 && !nat.startsWith('15')) {
    return `ar:${nat}`;
  }

  return `ambiguous:${reservationId}`;
}

/**
 * Clave unívoca de cliente para consolidación de historial de visitas.
 */
export function getClientKey(
  phone: string | null | undefined,
  email: string | null | undefined,
  reservationId: string
): string {
  const normPhone = normalizePhone(phone, reservationId);
  if (!normPhone.startsWith('ambiguous:')) {
    return normPhone;
  }
  if (email && email.trim()) {
    const cleanEmail = email.trim().toLowerCase();
    if (cleanEmail.includes('@') && cleanEmail.includes('.')) {
      return `email:${cleanEmail}`;
    }
  }
  return `anonymous:${reservationId}`;
}

// =========================================================================
// Validador y Parser del Contrato Único de Filtros
// =========================================================================

export function parseReservationFilters(query: Record<string, unknown>): ReservationQueryFilters {
  const q = typeof query.q === 'string' && query.q.trim().length > 0 ? query.q.trim() : undefined;
  
  // Validar formato YYYY-MM-DD
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  const startDate = typeof query.startDate === 'string' && dateRegex.test(query.startDate) ? query.startDate : undefined;
  const endDate = typeof query.endDate === 'string' && dateRegex.test(query.endDate) ? query.endDate : undefined;

  const validStatuses: ReservationStatus[] = ['confirmed', 'seated', 'completed', 'cancelled', 'no_show'];
  const status = typeof query.status === 'string' && (validStatuses.includes(query.status as ReservationStatus) || query.status === 'all')
    ? (query.status as ReservationStatus | 'all')
    : undefined;

  const validShifts: ShiftType[] = ['lunch', 'dinner', 'other'];
  const shift = typeof query.shift === 'string' && (validShifts.includes(query.shift as ShiftType) || query.shift === 'all')
    ? (query.shift as ShiftType | 'all')
    : undefined;

  const sector = typeof query.sector === 'string' && query.sector.trim().length > 0 && query.sector !== 'all'
    ? query.sector.trim()
    : undefined;

  const tableNumberRaw = Number(query.tableNumber);
  const tableNumber = !isNaN(tableNumberRaw) && tableNumberRaw > 0 ? tableNumberRaw : undefined;

  const minGuestsRaw = Number(query.minGuests);
  const minGuests = !isNaN(minGuestsRaw) && minGuestsRaw > 0 ? minGuestsRaw : undefined;

  const maxGuestsRaw = Number(query.maxGuests);
  const maxGuests = !isNaN(maxGuestsRaw) && maxGuestsRaw > 0 ? maxGuestsRaw : undefined;

  const validSortBy = ['startTime', 'customerName', 'guestsCount', 'status', 'createdAt'] as const;
  const sortBy = typeof query.sortBy === 'string' && (validSortBy as readonly string[]).includes(query.sortBy)
    ? (query.sortBy as ReservationQueryFilters['sortBy'])
    : 'startTime';

  const sortOrder = query.sortOrder === 'desc' ? 'desc' : 'asc';

  const pageRaw = Number(query.page);
  const page = !isNaN(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;

  const limitRaw = Number(query.limit);
  const limit = !isNaN(limitRaw) && limitRaw >= 1 ? Math.min(Math.floor(limitRaw), 100) : 20;

  return {
    q,
    startDate,
    endDate,
    status,
    shift,
    sector,
    tableNumber,
    minGuests,
    maxGuests,
    sortBy,
    sortOrder,
    page,
    limit,
  };
}

// =========================================================================
// Factoría de Rutas Router para Consultas de Reservas
// =========================================================================

interface RouterDependencies {
  supabaseAdmin: SupabaseClient | null;
  isLiveSupabaseConfigured: boolean;
  authenticate: (req: any, res: any, next: any) => Promise<void>;
  demoReservationsStore?: any[];
  demoTablesStore?: any[];
  demoAuditLogsStore?: any[];
}

export function createReservationsQueryRouter(deps: RouterDependencies): Router {
  const router = Router();
  const { supabaseAdmin, isLiveSupabaseConfigured, authenticate } = deps;

  function mapProfile(raw: any): ProfileSummary | null {
    if (!raw) return null;
    const item = Array.isArray(raw) ? raw[0] : raw;
    if (!item || !item.id) return null;
    return {
      id: item.id,
      firstName: item.first_name || null,
      lastName: item.last_name || null,
      email: item.email || '',
      role: item.role || 'operational_admin',
    };
  }

  // Middleware obligatorio en toda la ruta
  router.use(authenticate);

  /**
   * Helper de reserva de contingencia / demo
   */
  function getFallbackDemo(filters: ReservationQueryFilters): ReservationQueryResult[] {
    const demoReservations = deps.demoReservationsStore || [];
    const demoTables = deps.demoTablesStore || [];

    const mappedDemo: ReservationQueryResult[] = demoReservations.map((dr) => {
      const now = new Date();
      let start = dr.startTime ? new Date(dr.startTime) : new Date();
      if (!dr.startTime || isNaN(start.getTime())) {
        start = new Date();
        if (dr.time?.includes('Mañana')) {
          start.setDate(now.getDate() + 1);
          start.setHours(13, 30, 0, 0);
        } else {
          start.setHours(21, 0, 0, 0);
        }
      }
      const durationMinutes = Number(dr.durationMinutes) || 120;
      const end = dr.endTime && !isNaN(new Date(dr.endTime).getTime())
        ? new Date(dr.endTime)
        : new Date(start.getTime() + durationMinutes * 60 * 1000);

      const timeParts = getBuenosAiresParts(start.toISOString());
      const endTimeParts = getBuenosAiresParts(end.toISOString());

      const targetIds: string[] = Array.isArray(dr.tableIds) && dr.tableIds.length > 0
        ? dr.tableIds
        : (dr.tableId ? [dr.tableId] : []);
      const matchedTables = targetIds.length > 0
        ? demoTables.filter((t) => targetIds.includes(t.id))
        : demoTables.filter((t) => t.number === dr.tableNumber);

      const tables: AssociatedTable[] = matchedTables.map((t) => ({
        id: t.id,
        number: t.number,
        sector: t.sector,
        capacity: t.capacity,
        maxCapacity: t.maxCapacity,
      }));

      return {
        id: dr.id,
        customerName: dr.customerName,
        customerPhone: dr.customerPhone || null,
        customerEmail: dr.customerEmail || null,
        guestsCount: dr.guestsCount,
        reservationDate: timeParts.calendarDate,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        durationMinutes,
        status: dr.status as ReservationStatus,
        notes: dr.notes || null,
        cancellationReason: dr.cancellationReason || null,
        seatedAt: dr.seatedAt || null,
        completedAt: dr.completedAt || null,
        noShowAt: dr.noShowAt || null,
        createdAt: dr.createdAt || new Date().toISOString(),
        updatedAt: dr.updatedAt || new Date().toISOString(),
        calendarDate: timeParts.calendarDate,
        operationalDate: timeParts.operationalDate,
        localStartTime: timeParts.localTimeStr,
        localEndTime: endTimeParts.localTimeStr,
        shift: timeParts.shift,
        isMidnightRollover: timeParts.isMidnightRollover,
        tables,
      };
    });

    return mappedDemo.filter((r) => {
      if (filters.status && filters.status !== 'all' && r.status !== filters.status) return false;
      if (filters.minGuests && r.guestsCount < filters.minGuests) return false;
      if (filters.maxGuests && r.guestsCount > filters.maxGuests) return false;
      if (filters.startDate && r.operationalDate < filters.startDate) return false;
      if (filters.endDate && r.operationalDate > filters.endDate) return false;
      if (filters.sector && !r.tables.some((t) => t.sector === filters.sector)) return false;
      if (filters.tableNumber && !r.tables.some((t) => t.number === filters.tableNumber)) return false;
      if (filters.shift && filters.shift !== 'all' && r.shift !== filters.shift) return false;
      if (filters.q) {
        const needle = filters.q.toLowerCase();
        const matchesName = r.customerName.toLowerCase().includes(needle);
        const matchesPhone = r.customerPhone?.toLowerCase().includes(needle);
        const matchesEmail = r.customerEmail?.toLowerCase().includes(needle);
        const matchesId = r.id === filters.q;
        if (!matchesName && !matchesPhone && !matchesEmail && !matchesId) return false;
      }
      return true;
    });
  }

  /**
   * Helper unificado para filtrar el universo de reservas en vivo o en modo demo
   */
  async function fetchFilteredReservations(filters: ReservationQueryFilters): Promise<ReservationQueryResult[]> {
    if (isLiveSupabaseConfigured && supabaseAdmin) {
      let query = supabaseAdmin
        .from('reservations')
        .select(`
          id,
          customer_name,
          customer_phone,
          customer_email,
          guests_count,
          reservation_date,
          start_time,
          end_time,
          duration_minutes,
          status,
          notes,
          cancellation_reason,
          seated_at,
          completed_at,
          no_show_at,
          created_at,
          updated_at,
          created_by,
          cancelled_by,
          reservation_tables (
            table:tables (
              id,
              number,
              sector,
              capacity,
              max_capacity
            )
          ),
          created_by_profile:profiles!created_by (
            id,
            first_name,
            last_name,
            email,
            role
          ),
          cancelled_by_profile:profiles!cancelled_by (
            id,
            first_name,
            last_name,
            email,
            role
          )
        `);

      // 1. Filtro de estado
      if (filters.status && filters.status !== 'all') {
        query = query.eq('status', filters.status);
      }

      // 2. Filtro de comensales
      if (filters.minGuests !== undefined) {
        query = query.gte('guests_count', filters.minGuests);
      }
      if (filters.maxGuests !== undefined) {
        query = query.lte('guests_count', filters.maxGuests);
      }

      // 3. Filtro de rango de fechas operativas
      // Para un rango [startDate, endDate], el inicio es startDate 05:00-03 (08:00Z)
      // y el fin es (endDate + 1 día) 04:59:59-03 (07:59:59Z)
      if (filters.startDate) {
        query = query.gte('start_time', `${filters.startDate}T05:00:00-03:00`);
      }
      if (filters.endDate) {
        // Calcular día siguiente en formato YYYY-MM-DD
        const nextDate = new Date(filters.endDate + 'T12:00:00Z');
        nextDate.setUTCDate(nextDate.getUTCDate() + 1);
        const nextStr = nextDate.toISOString().substring(0, 10);
        query = query.lte('start_time', `${nextStr}T04:59:59.999-03:00`);
      }

      // 4. Búsqueda libre en texto (nombre, teléfono o email)
      if (filters.q) {
        const term = `%${filters.q}%`;
        // Si el término coincide con formato UUID, buscar también por ID exacto
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(filters.q);
        if (isUuid) {
          query = query.eq('id', filters.q);
        } else {
          query = query.or(`customer_name.ilike.${term},customer_phone.ilike.${term},customer_email.ilike.${term}`);
        }
      }

      // Ejecutar consulta principal (Condición C.4: sin fallback silencioso a memoria en modo vivo)
      const { data, error } = await query;
      if (error) {
        throw new Error(`Error al consultar reservas en PostgreSQL: ${error.message}`);
      }

      // Mapeo y enriquecimiento
      const mapped: ReservationQueryResult[] = (data || []).map((row: any) => {
        const timeParts = getBuenosAiresParts(row.start_time);
        const endTimeParts = getBuenosAiresParts(row.end_time);

        const tables: AssociatedTable[] = (row.reservation_tables || [])
          .map((rt: any) => rt.table)
          .filter(Boolean)
          .map((tbl: any) => ({
            id: tbl.id,
            number: tbl.number,
            sector: tbl.sector,
            capacity: tbl.capacity,
            maxCapacity: tbl.max_capacity,
          }));

        return {
          id: row.id,
          customerName: row.customer_name,
          customerPhone: row.customer_phone || null,
          customerEmail: row.customer_email || null,
          guestsCount: row.guests_count,
          reservationDate: row.reservation_date,
          startTime: row.start_time,
          endTime: row.end_time,
          durationMinutes: row.duration_minutes,
          status: row.status as ReservationStatus,
          notes: row.notes || null,
          cancellationReason: row.cancellation_reason || null,
          seatedAt: row.seated_at || null,
          completedAt: row.completed_at || null,
          noShowAt: row.no_show_at || null,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          calendarDate: timeParts.calendarDate,
          operationalDate: timeParts.operationalDate,
          localStartTime: timeParts.localTimeStr,
          localEndTime: endTimeParts.localTimeStr,
          shift: timeParts.shift,
          isMidnightRollover: timeParts.isMidnightRollover,
          tables,
          createdByProfile: mapProfile(row.created_by_profile),
          cancelledByProfile: mapProfile(row.cancelled_by_profile),
        };
      });

      // Filtros adicionales en memoria post-enriquecimiento (sector, turno, número de mesa)
      return mapped.filter((r) => {
        if (filters.sector && !r.tables.some((t) => t.sector === filters.sector)) {
          return false;
        }
        if (filters.tableNumber && !r.tables.some((t) => t.number === filters.tableNumber)) {
          return false;
        }
        if (filters.shift && filters.shift !== 'all' && r.shift !== filters.shift) {
          return false;
        }
        return true;
      });
    }

    return getFallbackDemo(filters);
  }

  // =========================================================================
  // 1. ENDPOINT: GET /api/reservations-query/overview
  // =========================================================================
  router.get('/overview', async (req: Request, res: Response) => {
    try {
      const filters = parseReservationFilters(req.query as Record<string, unknown>);
      const list = await fetchFilteredReservations(filters);

      const stats: ReservationOverviewStats = {
        total: list.length,
        confirmed: 0,
        seated: 0,
        completed: 0,
        cancelled: 0,
        no_show: 0,
        totalGuests: 0,
        shifts: {
          lunch: 0,
          dinner: 0,
          other: 0,
        },
      };

      for (const r of list) {
        if (r.status === 'confirmed') stats.confirmed++;
        else if (r.status === 'seated') stats.seated++;
        else if (r.status === 'completed') stats.completed++;
        else if (r.status === 'cancelled') stats.cancelled++;
        else if (r.status === 'no_show') stats.no_show++;

        stats.totalGuests += r.guestsCount;

        if (r.shift === 'lunch') stats.shifts.lunch++;
        else if (r.shift === 'dinner') stats.shifts.dinner++;
        else stats.shifts.other++;
      }

      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ message: err.message || 'Error al calcular indicadores de reservas' });
    }
  });

  // =========================================================================
  // 2. ENDPOINT: GET /api/reservations-query/search
  // =========================================================================
  router.get('/search', async (req: Request, res: Response) => {
    try {
      const filters = parseReservationFilters(req.query as Record<string, unknown>);
      const list = await fetchFilteredReservations(filters);

      // Ordenamiento estable con segundo criterio unívoco r.id ASC
      const factor = filters.sortOrder === 'desc' ? -1 : 1;
      list.sort((a, b) => {
        let cmp = 0;
        if (filters.sortBy === 'startTime') {
          cmp = new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
        } else if (filters.sortBy === 'customerName') {
          cmp = a.customerName.localeCompare(b.customerName);
        } else if (filters.sortBy === 'guestsCount') {
          cmp = a.guestsCount - b.guestsCount;
        } else if (filters.sortBy === 'status') {
          cmp = a.status.localeCompare(b.status);
        } else if (filters.sortBy === 'createdAt') {
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        }

        if (cmp !== 0) return cmp * factor;
        return a.id.localeCompare(b.id);
      });

      const totalCount = list.length;
      const totalPages = Math.ceil(totalCount / filters.limit) || 1;
      const offset = (filters.page - 1) * filters.limit;

      // Paginación segura: si offset excede el total, devuelve array vacío conservando total_count
      const paginatedData = offset < totalCount ? list.slice(offset, offset + filters.limit) : [];

      res.json({
        total_count: totalCount,
        page: filters.page,
        limit: filters.limit,
        total_pages: totalPages,
        data: paginatedData,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message || 'Error al buscar reservas' });
    }
  });

  // =========================================================================
  // 3. ENDPOINT: GET /api/reservations-query/calendar
  // =========================================================================
  router.get('/calendar', async (req: Request, res: Response) => {
    try {
      const filters = parseReservationFilters(req.query as Record<string, unknown>);
      const list = await fetchFilteredReservations(filters);

      // Agrupación por fecha operativa
      const grouped: Record<
        string,
        {
          date: string;
          count: number;
          totalGuests: number;
          reservations: ReservationQueryResult[];
        }
      > = {};

      for (const item of list) {
        const opDate = item.operationalDate;
        if (!grouped[opDate]) {
          grouped[opDate] = {
            date: opDate,
            count: 0,
            totalGuests: 0,
            reservations: [],
          };
        }
        grouped[opDate].count++;
        grouped[opDate].totalGuests += item.guestsCount;
        grouped[opDate].reservations.push(item);
      }

      // Ordenar las reservas internas por hora de inicio cronológica
      for (const opDate of Object.keys(grouped)) {
        grouped[opDate].reservations.sort(
          (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
        );
      }

      res.json(grouped);
    } catch (err: any) {
      res.status(500).json({ message: err.message || 'Error al obtener datos para el calendario' });
    }
  });

  // =========================================================================
  // 4. ENDPOINT: GET /api/reservations-query/detail/:id
  // =========================================================================
  router.get('/detail/:id', async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id || id.trim().length === 0) {
      res.status(400).json({ message: 'Se requiere un ID de reserva válido.' });
      return;
    }

    try {
      if (isLiveSupabaseConfigured && supabaseAdmin) {
        const { data: row, error } = await supabaseAdmin
          .from('reservations')
          .select(`
            id,
            customer_name,
            customer_phone,
            customer_email,
            guests_count,
            reservation_date,
            start_time,
            end_time,
            duration_minutes,
            status,
            notes,
            cancellation_reason,
            seated_at,
            completed_at,
            no_show_at,
            created_at,
            updated_at,
            created_by,
            cancelled_by,
            reservation_tables (
              table:tables (
                id,
                number,
                sector,
                capacity,
                max_capacity
              )
            ),
            created_by_profile:profiles!created_by (
              id,
              first_name,
              last_name,
              email,
              role
            ),
            cancelled_by_profile:profiles!cancelled_by (
              id,
              first_name,
              last_name,
              email,
              role
            )
          `)
          .eq('id', id)
          .maybeSingle();

        if (error) {
          res.status(500).json({ message: `Error al consultar detalle de reserva en PostgreSQL: ${error.message}` });
          return;
        }
        if (!row) {
          res.status(404).json({ message: 'Reserva no encontrada.' });
          return;
        }

        const timeParts = getBuenosAiresParts(row.start_time);
        const endTimeParts = getBuenosAiresParts(row.end_time);

        const tables: AssociatedTable[] = (row.reservation_tables || [])
          .map((rt: any) => rt.table)
          .filter(Boolean)
          .map((tbl: any) => ({
            id: tbl.id,
            number: tbl.number,
            sector: tbl.sector,
            capacity: tbl.capacity,
            maxCapacity: tbl.max_capacity,
          }));

        const result: ReservationQueryResult = {
          id: row.id,
          customerName: row.customer_name,
          customerPhone: row.customer_phone || null,
          customerEmail: row.customer_email || null,
          guestsCount: row.guests_count,
          reservationDate: row.reservation_date,
          startTime: row.start_time,
          endTime: row.end_time,
          durationMinutes: row.duration_minutes,
          status: row.status as ReservationStatus,
          notes: row.notes || null,
          cancellationReason: row.cancellation_reason || null,
          seatedAt: row.seated_at || null,
          completedAt: row.completed_at || null,
          noShowAt: row.no_show_at || null,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          calendarDate: timeParts.calendarDate,
          operationalDate: timeParts.operationalDate,
          localStartTime: timeParts.localTimeStr,
          localEndTime: endTimeParts.localTimeStr,
          shift: timeParts.shift,
          isMidnightRollover: timeParts.isMidnightRollover,
          tables,
          createdByProfile: mapProfile(row.created_by_profile),
          cancelledByProfile: mapProfile(row.cancelled_by_profile),
        };

        res.json(result);
        return;
      }

      // Modo Demo
      const demoReservations = deps.demoReservationsStore || [];
      const item = demoReservations.find((r) => r.id === id);
      if (!item) {
        res.status(404).json({ message: 'Reserva no encontrada.' });
        return;
      }

      const filters: ReservationQueryFilters = {
        q: id,
        sortBy: 'startTime',
        sortOrder: 'asc',
        page: 1,
        limit: 1,
      };
      const found = (await fetchFilteredReservations(filters))[0];
      if (!found) {
        res.status(404).json({ message: 'Reserva no encontrada.' });
        return;
      }
      res.json(found);
    } catch (err: any) {
      res.status(500).json({ message: err.message || 'Error al obtener detalle de la reserva' });
    }
  });

  // =========================================================================
  // 5. ENDPOINT: GET /api/reservations-query/timeline/:id
  // =========================================================================
  router.get('/timeline/:id', async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id || id.trim().length === 0) {
      res.status(400).json({ message: 'Se requiere un ID de reserva válido.' });
      return;
    }

    try {
      if (isLiveSupabaseConfigured && supabaseAdmin) {
        // Consultar únicamente eventos vinculados estrictamente a esta reserva
        const { data: logs, error } = await supabaseAdmin
          .from('audit_logs')
          .select(`
            id,
            action,
            entity,
            entity_id,
            old_values,
            new_values,
            status,
            reason,
            created_at,
            actor_id,
            actor_role,
            profiles:actor_id (
              id,
              first_name,
              last_name,
              email,
              role
            )
          `)
          .or(`related_reservation_id.eq.${id},and(entity.eq.reservation,entity_id.eq.${id})`)
          .order('created_at', { ascending: true });

        if (error) {
          res.status(500).json({ message: `Error al consultar historial de auditoría en PostgreSQL: ${error.message}` });
          return;
        }

        const timeline: ReservationAuditTimelineEntry[] = (logs || []).map((entry: any) => {
          const profile = entry.profiles;
          const actorName = profile
            ? [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.email
            : entry.actor_id
            ? 'Usuario no registrado'
            : 'Sistema';

          return {
            id: entry.id,
            action: entry.action,
            entity: entry.entity,
            entityId: entry.entity_id,
            oldValues: entry.old_values,
            newValues: entry.new_values,
            status: entry.status || 'success',
            reason: entry.reason || null,
            createdAt: entry.created_at,
            actorId: entry.actor_id || null,
            actorName,
            actorEmail: profile?.email || null,
            actorRole: entry.actor_role || profile?.role || null,
          };
        });

        res.json(timeline);
        return;
      }

      // Modo Demo
      const demoLogs = deps.demoAuditLogsStore || [];
      const filteredLogs = demoLogs
        .filter((l) => l.relatedReservationId === id || (l.entity === 'reservation' && l.entityId === id))
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        .map((entry) => ({
          id: entry.id,
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId,
          oldValues: entry.oldValues,
          newValues: entry.newValues,
          status: entry.status,
          reason: entry.reason,
          createdAt: entry.createdAt,
          actorId: entry.actorId,
          actorName: entry.actorName || 'Administrador',
          actorEmail: entry.actorEmail || null,
          actorRole: entry.actorRole || 'operational_admin',
        }));

      res.json(filteredLogs);
    } catch (err: any) {
      res.status(500).json({ message: err.message || 'Error al obtener historial de auditoría' });
    }
  });

  // =========================================================================
  // 6. ENDPOINT: GET /api/reservations-query/customers
  // =========================================================================
  router.get('/customers', async (req: Request, res: Response) => {
    try {
      const q = typeof req.query.q === 'string' && req.query.q.trim().length > 0 ? req.query.q.trim() : undefined;
      const pageRaw = Number(req.query.page);
      const page = !isNaN(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;
      const limitRaw = Number(req.query.limit);
      const limit = !isNaN(limitRaw) && limitRaw >= 1 ? Math.min(Math.floor(limitRaw), 100) : 20;

      // Recuperar reservas base para consolidación de clientes
      const allReservations = await fetchFilteredReservations({
        sortBy: 'startTime',
        sortOrder: 'desc',
        page: 1,
        limit: 10000,
      });

      // Agrupación de fidelidad por clientKey estricta
      const customersMap = new Map<
        string,
        {
          clientKey: string;
          primaryName: string;
          primaryPhone: string | null;
          primaryEmail: string | null;
          totalReservations: number;
          completedReservations: number;
          cancelledReservations: number;
          noShowReservations: number;
          totalGuests: number;
          firstVisit: string;
          lastVisit: string;
          shiftCounts: Record<ShiftType, number>;
          recentReservations: Array<{
            id: string;
            operationalDate: string;
            startTime: string;
            guestsCount: number;
            status: ReservationStatus;
            tables: number[];
          }>;
        }
      >();

      for (const r of allReservations) {
        const clientKey = getClientKey(r.customerPhone, r.customerEmail, r.id);

        let record = customersMap.get(clientKey);
        if (!record) {
          record = {
            clientKey,
            primaryName: r.customerName,
            primaryPhone: r.customerPhone,
            primaryEmail: r.customerEmail,
            totalReservations: 0,
            completedReservations: 0,
            cancelledReservations: 0,
            noShowReservations: 0,
            totalGuests: 0,
            firstVisit: r.startTime,
            lastVisit: r.startTime,
            shiftCounts: { lunch: 0, dinner: 0, other: 0 },
            recentReservations: [],
          };
          customersMap.set(clientKey, record);
        }

        record.totalReservations++;
        if (r.status === 'completed') record.completedReservations++;
        else if (r.status === 'cancelled') record.cancelledReservations++;
        else if (r.status === 'no_show') record.noShowReservations++;

        record.totalGuests += r.guestsCount;
        record.shiftCounts[r.shift]++;

        if (new Date(r.startTime) < new Date(record.firstVisit)) {
          record.firstVisit = r.startTime;
        }
        if (new Date(r.startTime) > new Date(record.lastVisit)) {
          record.lastVisit = r.startTime;
          // Actualizar nombre y contacto más reciente
          record.primaryName = r.customerName;
          if (r.customerPhone) record.primaryPhone = r.customerPhone;
          if (r.customerEmail) record.primaryEmail = r.customerEmail;
        }

        if (record.recentReservations.length < 5) {
          record.recentReservations.push({
            id: r.id,
            operationalDate: r.operationalDate,
            startTime: r.startTime,
            guestsCount: r.guestsCount,
            status: r.status,
            tables: r.tables.map((t) => t.number),
          });
        }
      }

      // Determinar turno favorito y lista final
      let customersList: CustomerSummaryItem[] = Array.from(customersMap.values()).map((c) => {
        let favoriteShift: ShiftType = 'dinner';
        if (c.shiftCounts.lunch >= c.shiftCounts.dinner && c.shiftCounts.lunch >= c.shiftCounts.other) {
          favoriteShift = 'lunch';
        } else if (c.shiftCounts.other > c.shiftCounts.dinner && c.shiftCounts.other > c.shiftCounts.lunch) {
          favoriteShift = 'other';
        }

        return {
          clientKey: c.clientKey,
          primaryName: c.primaryName,
          primaryPhone: c.primaryPhone,
          primaryEmail: c.primaryEmail,
          totalReservations: c.totalReservations,
          completedReservations: c.completedReservations,
          cancelledReservations: c.cancelledReservations,
          noShowReservations: c.noShowReservations,
          totalGuests: c.totalGuests,
          firstVisit: c.firstVisit,
          lastVisit: c.lastVisit,
          favoriteShift,
          recentReservations: c.recentReservations,
        };
      });

      // Filtro de búsqueda en clientes
      if (q) {
        const needle = q.toLowerCase();
        customersList = customersList.filter(
          (c) =>
            c.primaryName.toLowerCase().includes(needle) ||
            c.primaryPhone?.toLowerCase().includes(needle) ||
            c.primaryEmail?.toLowerCase().includes(needle) ||
            c.clientKey.toLowerCase().includes(needle)
        );
      }

      // Ordenar por volumen de reservas decreciente (frecuencia / fidelidad)
      customersList.sort((a, b) => b.totalReservations - a.totalReservations || a.primaryName.localeCompare(b.primaryName));

      const totalCount = customersList.length;
      const totalPages = Math.ceil(totalCount / limit) || 1;
      const offset = (page - 1) * limit;
      const paginatedCustomers = offset < totalCount ? customersList.slice(offset, offset + limit) : [];

      res.json({
        total_count: totalCount,
        page,
        limit,
        total_pages: totalPages,
        data: paginatedCustomers,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message || 'Error al obtener historial de clientes' });
    }
  });

  return router;
}
