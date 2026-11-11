export type TableStatus = 'available' | 'occupied' | 'reserved' | 'out_of_service'
export type ReservationStatus = 'confirmed' | 'seated' | 'completed' | 'cancelled' | 'no_show'

export interface TableSessionSummary {
  id: string
  tableId: string
  reservationId: string | null
  sessionType: 'reservation' | 'walk_in'
  guestsCount: number | null
  startedAt: string
  expectedDurationMinutes: number
  estimatedEndAt: string
  endedAt: string | null
  closeReason: string | null
  notes: string | null
}

export interface OperationalSettings {
  defaultReservationDurationMinutes: number
  defaultWalkInDurationMinutes: number
  reservationBufferMinutes: number
  updatedAt?: string
}

export interface Table {
  id: string
  number: number
  sector: string
  capacity: number
  maxCapacity: number
  status: TableStatus
  isActive: boolean
  upcomingReservationsCount: number
  shape?: 'round' | 'square' | 'rectangle'
  occupiedSince?: string | null
  serverName?: string | null
  activeSession?: TableSessionSummary | null
}

export interface Reservation {
  id: string
  tableId: string
  tableNumber: number
  customerName: string
  customerPhone?: string | null
  customerEmail?: string | null
  guestsCount: number
  time: string
  startTime?: string
  endTime?: string
  durationMinutes?: number
  status: ReservationStatus
  notes: string
  cancellationReason?: string | null
  seatedAt?: string | null
  completedAt?: string | null
  noShowAt?: string | null
  tableIds?: string[]
  tableNumbers?: number[]
}

export interface CreateTablePayload {
  number: number
  capacity: number
  sector?: string
  maxCapacity?: number
  shape?: 'round' | 'square' | 'rectangle'
  reason?: string
}

export interface InitializeFloorPlanPayload {
  tables: CreateTablePayload[]
  wipeExisting?: boolean
  reason?: string
}

export interface CreateReservationPayload {
  customerName: string
  customerPhone?: string
  customerEmail?: string
  guestsCount: number
  startTime: string
  durationMinutes?: number
  tableIds: string[]
  notes?: string
}

export interface ReassignTablesPayload {
  tableIds: string[]
  reason: string
}

export interface CapacityCheckResult {
  hasConflict: boolean
  hardBlocked?: boolean
  openSessionConflict?: boolean
  affectedReservations: Reservation[]
}

export interface DeactivationCheckResult {
  hasFutureReservations: boolean
  hasOpenSessions?: boolean
  openSessionsCount?: number
  affectedReservations: Reservation[]
}

export interface SmartRecommendation {
  type: 'single' | 'merge'
  tables: Table[]
  totalCapacity: number
  partySize: number
  wasteSeats: number
  reason: string
  matchScore: number
}
