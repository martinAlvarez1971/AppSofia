export type ReservationStatus = 'confirmed' | 'seated' | 'completed' | 'cancelled' | 'no_show';
export type ShiftType = 'lunch' | 'dinner' | 'other';

export interface ReportsFilters {
  startDate?: string;
  endDate?: string;
  sector?: string;
  shift?: ShiftType | 'all';
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
  operationalSettings: {
    defaultReservationDurationMinutes: number;
    defaultWalkInDurationMinutes: number;
    reservationBufferMinutes: number;
  };
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
