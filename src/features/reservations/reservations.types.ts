export type ReservationStatus = 'confirmed' | 'seated' | 'completed' | 'cancelled' | 'no_show';
export type ShiftType = 'lunch' | 'dinner' | 'other';

export interface ReservationQueryFilters {
  q?: string;
  startDate?: string;
  endDate?: string;
  status?: ReservationStatus | 'all';
  shift?: ShiftType | 'all';
  sector?: string;
  tableNumber?: number;
  minGuests?: number;
  maxGuests?: number;
  sortBy?: 'startTime' | 'customerName' | 'guestsCount' | 'status' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
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
  calendarDate: string;
  operationalDate: string;
  localStartTime: string;
  localEndTime: string;
  shift: ShiftType;
  isMidnightRollover: boolean;
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

export interface SearchResponse {
  total_count: number;
  page: number;
  limit: number;
  total_pages: number;
  data: ReservationQueryResult[];
}

export interface CalendarDayGroup {
  date: string;
  count: number;
  totalGuests: number;
  reservations: ReservationQueryResult[];
}

export type CalendarResponse = Record<string, CalendarDayGroup>;

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

export interface CustomersResponse {
  total_count: number;
  page: number;
  limit: number;
  total_pages: number;
  data: CustomerSummaryItem[];
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
