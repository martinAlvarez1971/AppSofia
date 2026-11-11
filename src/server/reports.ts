import { Router, type Request, type Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getBuenosAiresParts, type ReservationStatus, type ShiftType } from './reservations-query';

export interface ReportsFilterInput {
  startDate?: string;
  endDate?: string;
  sector?: string;
  shift?: ShiftType | 'all';
}

export interface ReportTableInput {
  id: string;
  number: number;
  sector: string;
  capacity: number;
  maxCapacity: number;
  status: 'available' | 'occupied' | 'reserved' | 'out_of_service';
  isActive: boolean;
}

export interface ReportReservationInput {
  id: string;
  customerName: string;
  guestsCount: number;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  status: ReservationStatus;
  tableIds: string[];
}

export interface ReportSessionInput {
  id: string;
  tableId: string;
  reservationId: string | null;
  sessionType: 'reservation' | 'walk_in';
  guestsCount: number | null;
  startedAt: string;
  expectedDurationMinutes: number;
  estimatedEndAt: string;
  endedAt: string | null;
  closeReason: string | null;
  notes: string | null;
}

export interface ReportOperationalSettings {
  defaultReservationDurationMinutes: number;
  defaultWalkInDurationMinutes: number;
  reservationBufferMinutes: number;
}

export interface HourlyDemandPoint {
  hour: number;
  hourLabel: string;
  shift: ShiftType;
  reservationsCount: number;
  walkInsCount: number;
  totalServices: number;
  guestsCount: number;
}

export interface DailySeriesPoint {
  date: string;
  reservationsCount: number;
  completedCount: number;
  cancelledCount: number;
  noShowCount: number;
  walkInsCount: number;
  sessionsCount: number;
  totalGuests: number;
}

export interface SectorMetricItem {
  sector: string;
  tablesCount: number;
  activeTablesCount: number;
  totalCapacity: number;
  reservationsCount: number;
  sessionsCount: number;
  walkInSessionsCount: number;
  totalGuests: number;
  avgDurationMinutes: number;
  rotationRate: number;
}

export interface TableMetricItem {
  tableId: string;
  tableNumber: number;
  sector: string;
  capacity: number;
  maxCapacity: number;
  status: 'available' | 'occupied' | 'reserved' | 'out_of_service';
  isActive: boolean;
  reservationsCount: number;
  sessionsCount: number;
  walkInSessionsCount: number;
  totalGuests: number;
  avgDurationMinutes: number;
  utilizationSharePct: number;
}

export interface ReportSessionRow {
  id: string;
  tableId: string;
  tableNumber: number;
  sector: string;
  reservationId: string | null;
  customerName: string | null;
  sessionType: 'reservation' | 'walk_in';
  guestsCount: number | null;
  startedAt: string;
  operationalDate: string;
  localStartTime: string;
  shift: ShiftType;
  expectedDurationMinutes: number;
  estimatedEndAt: string;
  endedAt: string | null;
  actualDurationMinutes: number | null;
  isOverrun: boolean;
  closeReason: string | null;
  notes: string | null;
}

export interface OperationalReportResponse {
  filtersApplied: {
    startDate: string | null;
    endDate: string | null;
    sector: string | null;
    shift: ShiftType | 'all';
  };
  generatedAt: string;
  operationalSettings: ReportOperationalSettings;
  floorSnapshot: {
    totalTables: number;
    activeTables: number;
    outOfServiceTables: number;
    occupiedTables: number;
    reservedTables: number;
    availableTables: number;
    totalActiveCapacity: number;
    occupiedCapacity: number;
    currentOccupancyPct: number;
    availableSectors: string[];
  };
  reservations: {
    total: number;
    confirmed: number;
    seated: number;
    completed: number;
    cancelled: number;
    no_show: number;
    totalGuests: number;
    completedGuests: number;
    avgPartySize: number;
    completionRatePct: number;
    cancellationRatePct: number;
    noShowRatePct: number;
    multiTableReservationsCount: number;
  };
  sessions: {
    totalSessions: number;
    reservationSessions: number;
    walkInSessions: number;
    openSessions: number;
    closedSessions: number;
    totalWalkInGuests: number;
    avgExpectedDurationMinutes: number;
    avgActualDurationMinutes: number;
    overrunSessionsCount: number;
    closeReasons: {
      service_completed: number;
      walk_in_closed: number;
      operational_release: number;
      reservation_cancelled: number;
    };
  };
  shifts: Record<
    ShiftType,
    {
      reservations: number;
      walkIns: number;
      guests: number;
      avgDurationMinutes: number;
    }
  >;
  hourlyDemand: HourlyDemandPoint[];
  dailySeries: DailySeriesPoint[];
  sectorMetrics: SectorMetricItem[];
  tableMetrics: TableMetricItem[];
  recentSessions: ReportSessionRow[];
}

export function parseReportsFilters(query: Record<string, unknown>): ReportsFilterInput {
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  const startDate =
    typeof query.startDate === 'string' && dateRegex.test(query.startDate) ? query.startDate : undefined;
  const endDate =
    typeof query.endDate === 'string' && dateRegex.test(query.endDate) ? query.endDate : undefined;

  const sector =
    typeof query.sector === 'string' && query.sector.trim().length > 0 && query.sector !== 'all'
      ? query.sector.trim()
      : undefined;

  const validShifts: ShiftType[] = ['lunch', 'dinner', 'other'];
  const shift =
    typeof query.shift === 'string' && (validShifts.includes(query.shift as ShiftType) || query.shift === 'all')
      ? (query.shift as ShiftType | 'all')
      : 'all';

  return {
    startDate,
    endDate,
    sector,
    shift,
  };
}

function getHourShift(hours: number): ShiftType {
  if (hours >= 11 && hours <= 16) {
    // 11:30–16:00 approximated cleanly on hourly grid (11h starts lunch prep/early seating)
    return hours >= 11 && hours <= 15 ? 'lunch' : 'other';
  }
  if (hours >= 19 || hours <= 1) {
    return 'dinner';
  }
  return 'other';
}

// Gastronomic day order: 05:00 -> 23:00, then 00:00 -> 04:00
const GASTRONOMIC_HOURS_ORDER = [
  5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4,
];

export function buildOperationalReport(params: {
  tables: ReportTableInput[];
  reservations: ReportReservationInput[];
  sessions: ReportSessionInput[];
  operationalSettings: ReportOperationalSettings;
  filters: ReportsFilterInput;
  nowMs?: number;
}): OperationalReportResponse {
  const { tables, reservations, sessions, operationalSettings, filters, nowMs = Date.now() } = params;

  const tableById = new Map<string, ReportTableInput>();
  const availableSectorsSet = new Set<string>();
  for (const t of tables) {
    tableById.set(t.id, t);
    if (t.sector) availableSectorsSet.add(t.sector);
  }
  const availableSectors = Array.from(availableSectorsSet).sort((a, b) => a.localeCompare(b));

  const reservationById = new Map<string, ReportReservationInput>();
  for (const r of reservations) {
    reservationById.set(r.id, r);
  }

  // Filter tables for floor snapshot (by sector if requested)
  const scopedTables = filters.sector ? tables.filter((t) => t.sector === filters.sector) : tables;
  const activeScopedTables = scopedTables.filter((t) => t.isActive && t.status !== 'out_of_service');
  const occupiedScopedTables = scopedTables.filter((t) => t.status === 'occupied');
  const reservedScopedTables = scopedTables.filter((t) => t.status === 'reserved');
  const availableScopedTables = scopedTables.filter((t) => t.status === 'available');
  const outOfServiceScopedTables = scopedTables.filter((t) => !t.isActive || t.status === 'out_of_service');

  const totalActiveCapacity = activeScopedTables.reduce((sum, t) => sum + t.capacity, 0);
  const occupiedCapacity = occupiedScopedTables.reduce((sum, t) => sum + t.capacity, 0);
  const currentOccupancyPct =
    activeScopedTables.length > 0 ? Math.round((occupiedScopedTables.length / activeScopedTables.length) * 100) : 0;

  // Enrich & filter reservations by operationalDate, shift, and sector
  const filteredReservations = reservations
    .map((r) => {
      const parts = getBuenosAiresParts(r.startTime);
      const rTables = r.tableIds.map((tid) => tableById.get(tid)).filter(Boolean) as ReportTableInput[];
      return {
        ...r,
        operationalDate: parts.operationalDate,
        hours: parts.hours,
        shift: parts.shift,
        tables: rTables,
      };
    })
    .filter((r) => {
      if (filters.startDate && r.operationalDate < filters.startDate) return false;
      if (filters.endDate && r.operationalDate > filters.endDate) return false;
      if (filters.shift && filters.shift !== 'all' && r.shift !== filters.shift) return false;
      if (filters.sector && !r.tables.some((t) => t.sector === filters.sector)) return false;
      return true;
    });

  // Enrich & filter table_sessions
  const filteredSessions = sessions
    .map((s) => {
      const parts = getBuenosAiresParts(s.startedAt);
      const tbl = tableById.get(s.tableId);
      const linkedRes = s.reservationId ? reservationById.get(s.reservationId) : undefined;
      const startMs = new Date(s.startedAt).getTime();
      const endMs = s.endedAt ? new Date(s.endedAt).getTime() : null;
      const estEndMs = new Date(s.estimatedEndAt).getTime();
      const actualDurationMinutes =
        endMs !== null && !isNaN(endMs) && !isNaN(startMs)
          ? Math.max(0, Math.round((endMs - startMs) / 60000))
          : null;
      const effectiveEndMs = endMs !== null ? endMs : nowMs;
      const isOverrun = !isNaN(estEndMs) && effectiveEndMs > estEndMs;

      return {
        ...s,
        tableNumber: tbl?.number ?? 0,
        sector: tbl?.sector ?? 'Sin sector',
        customerName: linkedRes?.customerName ?? null,
        operationalDate: parts.operationalDate,
        localStartTime: parts.localTimeStr,
        hours: parts.hours,
        shift: parts.shift,
        actualDurationMinutes,
        isOverrun,
      };
    })
    .filter((s) => {
      if (filters.startDate && s.operationalDate < filters.startDate) return false;
      if (filters.endDate && s.operationalDate > filters.endDate) return false;
      if (filters.shift && filters.shift !== 'all' && s.shift !== filters.shift) return false;
      if (filters.sector && s.sector !== filters.sector) return false;
      return true;
    });

  // Reservation KPIs
  let confirmed = 0;
  let seated = 0;
  let completed = 0;
  let cancelled = 0;
  let noShow = 0;
  let totalGuests = 0;
  let completedGuests = 0;
  let multiTableReservationsCount = 0;

  for (const r of filteredReservations) {
    if (r.status === 'confirmed') confirmed++;
    else if (r.status === 'seated') seated++;
    else if (r.status === 'completed') {
      completed++;
      completedGuests += r.guestsCount;
    } else if (r.status === 'cancelled') cancelled++;
    else if (r.status === 'no_show') noShow++;

    totalGuests += r.guestsCount;
    if (r.tableIds.length > 1) multiTableReservationsCount++;
  }

  const totalRes = filteredReservations.length;
  const resolvedOutcomeCount = completed + cancelled + noShow;
  const completionRatePct = resolvedOutcomeCount > 0 ? Math.round((completed / resolvedOutcomeCount) * 100) : 0;
  const cancellationRatePct = totalRes > 0 ? Math.round((cancelled / totalRes) * 100) : 0;
  const noShowRatePct = totalRes > 0 ? Math.round((noShow / totalRes) * 100) : 0;
  const avgPartySize = totalRes > 0 ? Number((totalGuests / totalRes).toFixed(1)) : 0;

  // Sessions KPIs
  let reservationSessions = 0;
  let walkInSessions = 0;
  let openSessions = 0;
  let closedSessions = 0;
  let totalWalkInGuests = 0;
  let expectedDurSum = 0;
  let actualDurSum = 0;
  let actualDurCount = 0;
  let overrunSessionsCount = 0;
  const closeReasons = {
    service_completed: 0,
    walk_in_closed: 0,
    operational_release: 0,
    reservation_cancelled: 0,
  };

  for (const s of filteredSessions) {
    if (s.sessionType === 'reservation') reservationSessions++;
    else {
      walkInSessions++;
      totalWalkInGuests += s.guestsCount || 0;
    }

    if (s.endedAt) {
      closedSessions++;
      if (s.actualDurationMinutes !== null) {
        actualDurSum += s.actualDurationMinutes;
        actualDurCount++;
      }
      if (s.closeReason === 'service_completed') closeReasons.service_completed++;
      else if (s.closeReason === 'walk_in_closed') closeReasons.walk_in_closed++;
      else if (s.closeReason === 'operational_release') closeReasons.operational_release++;
      else if (s.closeReason === 'reservation_cancelled') closeReasons.reservation_cancelled++;
    } else {
      openSessions++;
    }

    expectedDurSum += s.expectedDurationMinutes || 0;
    if (s.isOverrun) overrunSessionsCount++;
  }

  const totalSessions = filteredSessions.length;
  const avgExpectedDurationMinutes = totalSessions > 0 ? Math.round(expectedDurSum / totalSessions) : 0;
  const avgActualDurationMinutes = actualDurCount > 0 ? Math.round(actualDurSum / actualDurCount) : 0;

  // Shifts breakdown
  const shiftAcc: Record<
    ShiftType,
    { reservations: number; walkIns: number; guests: number; durSum: number; durCount: number }
  > = {
    lunch: { reservations: 0, walkIns: 0, guests: 0, durSum: 0, durCount: 0 },
    dinner: { reservations: 0, walkIns: 0, guests: 0, durSum: 0, durCount: 0 },
    other: { reservations: 0, walkIns: 0, guests: 0, durSum: 0, durCount: 0 },
  };

  for (const r of filteredReservations) {
    shiftAcc[r.shift].reservations++;
    shiftAcc[r.shift].guests += r.guestsCount;
  }
  for (const s of filteredSessions) {
    if (s.sessionType === 'walk_in') {
      shiftAcc[s.shift].walkIns++;
      shiftAcc[s.shift].guests += s.guestsCount || 0;
    }
    if (s.actualDurationMinutes !== null) {
      shiftAcc[s.shift].durSum += s.actualDurationMinutes;
      shiftAcc[s.shift].durCount++;
    }
  }

  const shifts: OperationalReportResponse['shifts'] = {
    lunch: {
      reservations: shiftAcc.lunch.reservations,
      walkIns: shiftAcc.lunch.walkIns,
      guests: shiftAcc.lunch.guests,
      avgDurationMinutes:
        shiftAcc.lunch.durCount > 0 ? Math.round(shiftAcc.lunch.durSum / shiftAcc.lunch.durCount) : 0,
    },
    dinner: {
      reservations: shiftAcc.dinner.reservations,
      walkIns: shiftAcc.dinner.walkIns,
      guests: shiftAcc.dinner.guests,
      avgDurationMinutes:
        shiftAcc.dinner.durCount > 0 ? Math.round(shiftAcc.dinner.durSum / shiftAcc.dinner.durCount) : 0,
    },
    other: {
      reservations: shiftAcc.other.reservations,
      walkIns: shiftAcc.other.walkIns,
      guests: shiftAcc.other.guests,
      avgDurationMinutes:
        shiftAcc.other.durCount > 0 ? Math.round(shiftAcc.other.durSum / shiftAcc.other.durCount) : 0,
    },
  };

  // Hourly Demand Grid (gastronomic day 05:00 -> 04:00)
  const hourMap = new Map<number, { reservationsCount: number; walkInsCount: number; guestsCount: number }>();
  for (const h of GASTRONOMIC_HOURS_ORDER) {
    hourMap.set(h, { reservationsCount: 0, walkInsCount: 0, guestsCount: 0 });
  }
  for (const r of filteredReservations) {
    const bucket = hourMap.get(r.hours);
    if (bucket) {
      bucket.reservationsCount++;
      bucket.guestsCount += r.guestsCount;
    }
  }
  for (const s of filteredSessions) {
    if (s.sessionType === 'walk_in') {
      const bucket = hourMap.get(s.hours);
      if (bucket) {
        bucket.walkInsCount++;
        bucket.guestsCount += s.guestsCount || 0;
      }
    }
  }

  const hourlyDemand: HourlyDemandPoint[] = GASTRONOMIC_HOURS_ORDER.map((h) => {
    const bucket = hourMap.get(h)!;
    return {
      hour: h,
      hourLabel: `${String(h).padStart(2, '0')}:00`,
      shift: getHourShift(h),
      reservationsCount: bucket.reservationsCount,
      walkInsCount: bucket.walkInsCount,
      totalServices: bucket.reservationsCount + bucket.walkInsCount,
      guestsCount: bucket.guestsCount,
    };
  });

  // Daily Series
  const dailyMap = new Map<string, DailySeriesPoint>();
  const ensureDay = (date: string) => {
    let entry = dailyMap.get(date);
    if (!entry) {
      entry = {
        date,
        reservationsCount: 0,
        completedCount: 0,
        cancelledCount: 0,
        noShowCount: 0,
        walkInsCount: 0,
        sessionsCount: 0,
        totalGuests: 0,
      };
      dailyMap.set(date, entry);
    }
    return entry;
  };

  for (const r of filteredReservations) {
    const day = ensureDay(r.operationalDate);
    day.reservationsCount++;
    if (r.status === 'completed') day.completedCount++;
    else if (r.status === 'cancelled') day.cancelledCount++;
    else if (r.status === 'no_show') day.noShowCount++;
    day.totalGuests += r.guestsCount;
  }
  for (const s of filteredSessions) {
    const day = ensureDay(s.operationalDate);
    day.sessionsCount++;
    if (s.sessionType === 'walk_in') {
      day.walkInsCount++;
      day.totalGuests += s.guestsCount || 0;
    }
  }
  const dailySeries = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  // Table & Sector Utilization + Rotation
  const tableAcc = new Map<
    string,
    {
      reservationsCount: number;
      sessionsCount: number;
      walkInSessionsCount: number;
      totalGuests: number;
      durSum: number;
      durCount: number;
    }
  >();

  for (const t of scopedTables) {
    tableAcc.set(t.id, {
      reservationsCount: 0,
      sessionsCount: 0,
      walkInSessionsCount: 0,
      totalGuests: 0,
      durSum: 0,
      durCount: 0,
    });
  }

  for (const r of filteredReservations) {
    const shareGuests = r.tableIds.length > 0 ? Math.round(r.guestsCount / r.tableIds.length) : 0;
    for (const tid of r.tableIds) {
      const acc = tableAcc.get(tid);
      if (acc) {
        acc.reservationsCount++;
        acc.totalGuests += shareGuests;
      }
    }
  }

  for (const s of filteredSessions) {
    const acc = tableAcc.get(s.tableId);
    if (acc) {
      acc.sessionsCount++;
      if (s.sessionType === 'walk_in') {
        acc.walkInSessionsCount++;
        acc.totalGuests += s.guestsCount || 0;
      }
      if (s.actualDurationMinutes !== null) {
        acc.durSum += s.actualDurationMinutes;
        acc.durCount++;
      }
    }
  }

  const totalTableActivity = Array.from(tableAcc.values()).reduce(
    (sum, item) => sum + item.reservationsCount + item.walkInSessionsCount,
    0,
  );

  const tableMetrics: TableMetricItem[] = scopedTables
    .map((t) => {
      const acc = tableAcc.get(t.id)!;
      const activity = acc.reservationsCount + acc.walkInSessionsCount;
      return {
        tableId: t.id,
        tableNumber: t.number,
        sector: t.sector,
        capacity: t.capacity,
        maxCapacity: t.maxCapacity,
        status: t.status,
        isActive: t.isActive,
        reservationsCount: acc.reservationsCount,
        sessionsCount: acc.sessionsCount,
        walkInSessionsCount: acc.walkInSessionsCount,
        totalGuests: acc.totalGuests,
        avgDurationMinutes: acc.durCount > 0 ? Math.round(acc.durSum / acc.durCount) : 0,
        utilizationSharePct: totalTableActivity > 0 ? Math.round((activity / totalTableActivity) * 100) : 0,
      };
    })
    .sort((a, b) => a.tableNumber - b.tableNumber);

  // Sector aggregation
  const sectorMap = new Map<
    string,
    {
      tablesCount: number;
      activeTablesCount: number;
      totalCapacity: number;
      reservationsCount: number;
      sessionsCount: number;
      walkInSessionsCount: number;
      totalGuests: number;
      durSum: number;
      durCount: number;
    }
  >();

  for (const t of scopedTables) {
    let sec = sectorMap.get(t.sector);
    if (!sec) {
      sec = {
        tablesCount: 0,
        activeTablesCount: 0,
        totalCapacity: 0,
        reservationsCount: 0,
        sessionsCount: 0,
        walkInSessionsCount: 0,
        totalGuests: 0,
        durSum: 0,
        durCount: 0,
      };
      sectorMap.set(t.sector, sec);
    }
    sec.tablesCount++;
    if (t.isActive && t.status !== 'out_of_service') {
      sec.activeTablesCount++;
      sec.totalCapacity += t.capacity;
    }
    const tAcc = tableAcc.get(t.id)!;
    sec.reservationsCount += tAcc.reservationsCount;
    sec.sessionsCount += tAcc.sessionsCount;
    sec.walkInSessionsCount += tAcc.walkInSessionsCount;
    sec.totalGuests += tAcc.totalGuests;
    sec.durSum += tAcc.durSum;
    sec.durCount += tAcc.durCount;
  }

  const sectorMetrics: SectorMetricItem[] = Array.from(sectorMap.entries())
    .map(([sector, s]) => ({
      sector,
      tablesCount: s.tablesCount,
      activeTablesCount: s.activeTablesCount,
      totalCapacity: s.totalCapacity,
      reservationsCount: s.reservationsCount,
      sessionsCount: s.sessionsCount,
      walkInSessionsCount: s.walkInSessionsCount,
      totalGuests: s.totalGuests,
      avgDurationMinutes: s.durCount > 0 ? Math.round(s.durSum / s.durCount) : 0,
      rotationRate: s.activeTablesCount > 0 ? Number((s.sessionsCount / s.activeTablesCount).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.sessionsCount + b.reservationsCount - (a.sessionsCount + a.reservationsCount));

  // Recent sessions sorted newest first (cap at 100)
  const recentSessions: ReportSessionRow[] = [...filteredSessions]
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, 100)
    .map((s) => ({
      id: s.id,
      tableId: s.tableId,
      tableNumber: s.tableNumber,
      sector: s.sector,
      reservationId: s.reservationId,
      customerName: s.customerName,
      sessionType: s.sessionType,
      guestsCount: s.guestsCount,
      startedAt: s.startedAt,
      operationalDate: s.operationalDate,
      localStartTime: s.localStartTime,
      shift: s.shift,
      expectedDurationMinutes: s.expectedDurationMinutes,
      estimatedEndAt: s.estimatedEndAt,
      endedAt: s.endedAt,
      actualDurationMinutes: s.actualDurationMinutes,
      isOverrun: s.isOverrun,
      closeReason: s.closeReason,
      notes: s.notes,
    }));

  return {
    filtersApplied: {
      startDate: filters.startDate || null,
      endDate: filters.endDate || null,
      sector: filters.sector || null,
      shift: filters.shift || 'all',
    },
    generatedAt: new Date(nowMs).toISOString(),
    operationalSettings,
    floorSnapshot: {
      totalTables: scopedTables.length,
      activeTables: activeScopedTables.length,
      outOfServiceTables: outOfServiceScopedTables.length,
      occupiedTables: occupiedScopedTables.length,
      reservedTables: reservedScopedTables.length,
      availableTables: availableScopedTables.length,
      totalActiveCapacity,
      occupiedCapacity,
      currentOccupancyPct,
      availableSectors,
    },
    reservations: {
      total: totalRes,
      confirmed,
      seated,
      completed,
      cancelled,
      no_show: noShow,
      totalGuests,
      completedGuests,
      avgPartySize,
      completionRatePct,
      cancellationRatePct,
      noShowRatePct,
      multiTableReservationsCount,
    },
    sessions: {
      totalSessions,
      reservationSessions,
      walkInSessions,
      openSessions,
      closedSessions,
      totalWalkInGuests,
      avgExpectedDurationMinutes,
      avgActualDurationMinutes,
      overrunSessionsCount,
      closeReasons,
    },
    shifts,
    hourlyDemand,
    dailySeries,
    sectorMetrics,
    tableMetrics,
    recentSessions,
  };
}

interface ReportsRouterDependencies {
  supabaseAdmin: SupabaseClient | null;
  isLiveSupabaseConfigured: boolean;
  authenticate: (req: any, res: any, next: any) => Promise<void>;
  demoReservationsStore?: any[];
  demoTablesStore?: any[];
  demoTableSessionsStore?: any[];
  getDemoOperationalSettings?: () => ReportOperationalSettings;
}

export function createReportsRouter(deps: ReportsRouterDependencies): Router {
  const router = Router();
  const { supabaseAdmin, isLiveSupabaseConfigured, authenticate } = deps;

  router.use(authenticate);

  router.get('/overview', async (req: Request, res: Response) => {
    try {
      const filters = parseReportsFilters(req.query as Record<string, unknown>);

      if (isLiveSupabaseConfigured && supabaseAdmin) {
        const [
          { data: tablesRows, error: tablesErr },
          { data: resRows, error: resErr },
          { data: sessRows, error: sessErr },
          { data: settingsRow, error: settingsErr },
        ] = await Promise.all([
          supabaseAdmin.from('tables').select('id, number, sector, capacity, max_capacity, status, is_active').order('number', { ascending: true }),
          supabaseAdmin
            .from('reservations')
            .select('id, customer_name, guests_count, start_time, end_time, duration_minutes, status, reservation_tables(table_id)'),
          supabaseAdmin
            .from('table_sessions')
            .select('id, table_id, reservation_id, session_type, guests_count, started_at, expected_duration_minutes, estimated_end_at, ended_at, close_reason, notes')
            .order('started_at', { ascending: false }),
          supabaseAdmin
            .from('operational_settings')
            .select('default_reservation_duration_minutes, default_walk_in_duration_minutes, reservation_buffer_minutes')
            .eq('id', 1)
            .maybeSingle(),
        ]);

        if (tablesErr) {
          throw new Error(`Error al consultar mesas para informes: ${tablesErr.message}`);
        }
        if (resErr) {
          throw new Error(`Error al consultar reservas para informes: ${resErr.message}`);
        }
        if (sessErr) {
          throw new Error(`Error al consultar sesiones de mesa para informes: ${sessErr.message}`);
        }
        if (settingsErr) {
          throw new Error(`Error al consultar parámetros operativos para informes: ${settingsErr.message}`);
        }

        const tables: ReportTableInput[] = (tablesRows || []).map((t: any) => ({
          id: t.id,
          number: t.number,
          sector: t.sector,
          capacity: t.capacity,
          maxCapacity: t.max_capacity ?? t.capacity,
          status: t.status,
          isActive: t.is_active ?? true,
        }));

        const reservations: ReportReservationInput[] = (resRows || []).map((r: any) => ({
          id: r.id,
          customerName: r.customer_name,
          guestsCount: r.guests_count,
          startTime: r.start_time,
          endTime: r.end_time,
          durationMinutes: r.duration_minutes,
          status: r.status as ReservationStatus,
          tableIds: (r.reservation_tables || []).map((rt: any) => rt.table_id).filter(Boolean),
        }));

        const sessions: ReportSessionInput[] = (sessRows || []).map((s: any) => ({
          id: s.id,
          tableId: s.table_id,
          reservationId: s.reservation_id ?? null,
          sessionType: s.session_type,
          guestsCount: s.guests_count ?? null,
          startedAt: s.started_at,
          expectedDurationMinutes: s.expected_duration_minutes,
          estimatedEndAt: s.estimated_end_at,
          endedAt: s.ended_at ?? null,
          closeReason: s.close_reason ?? null,
          notes: s.notes ?? null,
        }));

        const operationalSettings: ReportOperationalSettings = {
          defaultReservationDurationMinutes: settingsRow?.default_reservation_duration_minutes ?? 120,
          defaultWalkInDurationMinutes: settingsRow?.default_walk_in_duration_minutes ?? 90,
          reservationBufferMinutes: settingsRow?.reservation_buffer_minutes ?? 15,
        };

        res.json(
          buildOperationalReport({
            tables,
            reservations,
            sessions,
            operationalSettings,
            filters,
          }),
        );
        return;
      }

      // Modo Demo Aislado
      const demoTables: ReportTableInput[] = (deps.demoTablesStore || []).map((t) => ({
        id: t.id,
        number: t.number,
        sector: t.sector,
        capacity: t.capacity,
        maxCapacity: t.maxCapacity ?? t.capacity,
        status: t.status,
        isActive: t.isActive ?? true,
      }));

      const now = new Date();
      const demoReservations: ReportReservationInput[] = (deps.demoReservationsStore || []).map((dr) => {
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
        const end =
          dr.endTime && !isNaN(new Date(dr.endTime).getTime())
            ? new Date(dr.endTime)
            : new Date(start.getTime() + durationMinutes * 60 * 1000);
        const tableIds =
          Array.isArray(dr.tableIds) && dr.tableIds.length > 0
            ? dr.tableIds
            : dr.tableId
              ? [dr.tableId]
              : [];
        return {
          id: dr.id,
          customerName: dr.customerName,
          guestsCount: dr.guestsCount,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          durationMinutes,
          status: dr.status as ReservationStatus,
          tableIds,
        };
      });

      const demoSessions: ReportSessionInput[] = (deps.demoTableSessionsStore || []).map((s) => ({
        id: s.id,
        tableId: s.tableId,
        reservationId: s.reservationId ?? null,
        sessionType: s.sessionType,
        guestsCount: s.guestsCount ?? null,
        startedAt: s.startedAt,
        expectedDurationMinutes: s.expectedDurationMinutes,
        estimatedEndAt: s.estimatedEndAt,
        endedAt: s.endedAt ?? null,
        closeReason: s.closeReason ?? null,
        notes: s.notes ?? null,
      }));

      const settings = deps.getDemoOperationalSettings
        ? deps.getDemoOperationalSettings()
        : {
            defaultReservationDurationMinutes: 120,
            defaultWalkInDurationMinutes: 90,
            reservationBufferMinutes: 15,
          };

      res.json(
        buildOperationalReport({
          tables: demoTables,
          reservations: demoReservations,
          sessions: demoSessions,
          operationalSettings: settings,
          filters,
        }),
      );
    } catch (err: any) {
      res.status(500).json({ message: err.message || 'Error al generar informes operativos' });
    }
  });

  return router;
}
