export type TableStatus = 'active' | 'inactive'
export type TableOccupancy = 'free' | 'occupied'

export type TableDerivedState =
  | 'free'
  | 'occupied'
  | 'has_future_reservation'
  | 'out_of_service'
  | 'inactive'

export interface RestaurantTable {
  id: string
  number: string
  capacity: number
  minCapacity: number
  sector: string | null
  status: TableStatus
  isOutOfService: boolean
  currentOccupancy: TableOccupancy
  derivedState: TableDerivedState
  nextReservation?: {
    id: string
    customerName: string
    startTime: string
    endTime: string
    partySize: number
  } | null
  createdAt: string
  updatedAt: string
}

export interface Reservation {
  id: string
  customerName: string
  customerPhone?: string | null
  customerEmail?: string | null
  partySize: number
  startTime: string
  endTime: string
  status: 'confirmed' | 'seated' | 'completed' | 'cancelled' | 'no_show'
  notes?: string | null
  tables: Array<{
    tableId: string
    table: RestaurantTable
  }>
}

export interface AvailabilityResult {
  startTime: string
  endTime: string
  durationMinutes: number
  partySize: number | null
  totalAvailableCapacity: number
  canAccommodate: boolean
  tables: Array<{
    table: {
      id: string
      number: string
      capacity: number
      minCapacity: number
      sector: string | null
    }
    available: boolean
    conflict?: {
      reservationId: string
      customerName: string
      startTime: string
      endTime: string
      partySize: number
    } | null
  }>
}

export interface CreateTableInput {
  number: string
  capacity: number
  minCapacity?: number
  sector?: string
}

export interface UpdateTableInput {
  number?: string
  capacity?: number
  minCapacity?: number
  sector?: string
}

export interface CreateReservationInput {
  customerName: string
  customerPhone?: string
  customerEmail?: string
  partySize: number
  startTime: string
  endTime?: string
  durationMinutes?: number
  tableIds: string[]
  notes?: string
}
