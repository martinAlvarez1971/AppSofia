import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TablesPage } from './TablesPage'
import type { RestaurantTable } from './tables.types'
import * as tablesApi from './tables.api'

const mockTables: RestaurantTable[] = [
  {
    id: 't-1',
    number: '1',
    capacity: 4,
    minCapacity: 1,
    sector: 'Salón Principal',
    status: 'active',
    isOutOfService: false,
    currentOccupancy: 'free',
    derivedState: 'free',
    nextReservation: null,
    createdAt: '2026-10-21T12:00:00Z',
    updatedAt: '2026-10-21T12:00:00Z',
  },
  {
    id: 't-2',
    number: '2',
    capacity: 2,
    minCapacity: 1,
    sector: 'Terraza',
    status: 'active',
    isOutOfService: false,
    currentOccupancy: 'occupied',
    derivedState: 'occupied',
    nextReservation: null,
    createdAt: '2026-10-21T12:00:00Z',
    updatedAt: '2026-10-21T12:00:00Z',
  },
  {
    id: 't-3',
    number: '3',
    capacity: 6,
    minCapacity: 2,
    sector: 'Salón Principal',
    status: 'active',
    isOutOfService: false,
    currentOccupancy: 'free',
    derivedState: 'has_future_reservation',
    nextReservation: {
      id: 'res-99',
      customerName: 'Familia Rossi',
      startTime: '2026-10-21T21:30:00Z',
      endTime: '2026-10-21T23:30:00Z',
      partySize: 5,
    },
    createdAt: '2026-10-21T12:00:00Z',
    updatedAt: '2026-10-21T12:00:00Z',
  },
  {
    id: 't-4',
    number: '4',
    capacity: 4,
    minCapacity: 1,
    sector: 'Patio',
    status: 'active',
    isOutOfService: true,
    currentOccupancy: 'free',
    derivedState: 'out_of_service',
    nextReservation: null,
    createdAt: '2026-10-21T12:00:00Z',
    updatedAt: '2026-10-21T12:00:00Z',
  },
]

const mockAuthContext = vi.fn()

vi.mock('../auth/auth.context', () => ({
  useAuth: () => mockAuthContext(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: null,
}))

describe('TablesPage Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(tablesApi, 'listTables').mockResolvedValue(mockTables)
    mockAuthContext.mockReturnValue({
      profile: { role: 'super_admin', first_name: 'Super', last_name: 'Admin' },
      session: { access_token: 'fake-token' },
      signOut: vi.fn(),
    })
  })

  it('renders page heading, KPIs and sector groups in room map', async () => {
    render(<TablesPage />)

    expect(screen.getByText('Cargando mesas del salón...')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('Gestión Inteligente de Mesas')).toBeInTheDocument()
    })

    // Check KPIs
    expect(screen.getByText('TOTAL MESAS')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument() // Total count

    // Check tables rendered in cards
    expect(screen.getByText('Mesa 1')).toBeInTheDocument()
    expect(screen.getByText('Mesa 2')).toBeInTheDocument()
    expect(screen.getByText('Mesa 3')).toBeInTheDocument()
    expect(screen.getByText('Mesa 4')).toBeInTheDocument()

    // Check sectors
    expect(screen.getByRole('heading', { name: 'Salón Principal' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Terraza' })).toBeInTheDocument()
  })

  it('distinguishes free now table with future reservation from occupied table', async () => {
    render(<TablesPage />)

    await waitFor(() => {
      expect(screen.getByText('Mesa 3')).toBeInTheDocument()
    })

    // Mesa 3 has derivedState 'has_future_reservation'
    expect(screen.getByText('Reserva futura')).toBeInTheDocument()
    expect(screen.getByText('Familia Rossi')).toBeInTheDocument()

    // Mesa 2 is occupied
    expect(screen.getByText('Ocupada')).toBeInTheDocument()

    // Mesa 1 is free now
    expect(screen.getByText('Libre ahora')).toBeInTheDocument()
  })

  it('filters tables by search query', async () => {
    render(<TablesPage />)

    await waitFor(() => {
      expect(screen.getByText('Mesa 1')).toBeInTheDocument()
    })

    const searchInput = screen.getByLabelText('Buscar mesas')
    fireEvent.change(searchInput, { target: { value: 'Terraza' } })

    // Only Mesa 2 in Terraza should remain
    expect(screen.getByText('Mesa 2')).toBeInTheDocument()
    expect(screen.queryByText('Mesa 1')).not.toBeInTheDocument()
  })

  it('shows "Nueva mesa" button only for super_admin and hides for operational_admin', async () => {
    // 1. Super Admin
    const { rerender } = render(<TablesPage />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /nueva mesa/i })).toBeInTheDocument()
    })

    // 2. Operational Admin
    mockAuthContext.mockReturnValue({
      profile: { role: 'operational_admin', first_name: 'Operador', last_name: 'Pérez' },
      session: { access_token: 'fake-token' },
      signOut: vi.fn(),
    })

    rerender(<TablesPage />)
    expect(screen.queryByRole('button', { name: /nueva mesa/i })).not.toBeInTheDocument()
  })

  it('allows multi-table selection and calculates aggregate capacity', async () => {
    render(<TablesPage />)

    await waitFor(() => {
      expect(screen.getByText('Mesa 1')).toBeInTheDocument()
    })

    // Select Mesa 1 (4 pers)
    const checkTable1 = screen.getByLabelText('Seleccionar mesa 1')
    fireEvent.click(checkTable1)

    // Check floating bar appears
    expect(screen.getByLabelText('Selector de mesas múltiples')).toBeInTheDocument()
    expect(screen.getByText('1 mesa seleccionada:')).toBeInTheDocument()
    expect(screen.getByText('4 personas')).toBeInTheDocument()

    // Select Mesa 3 (6 pers)
    const checkTable3 = screen.getByLabelText('Seleccionar mesa 3')
    fireEvent.click(checkTable3)

    // Aggregate capacity: 4 + 6 = 10 personas
    expect(screen.getByText('2 mesas seleccionadas:')).toBeInTheDocument()
    expect(screen.getByText('10 personas')).toBeInTheDocument()
  })

  it('warns when party size exceeds aggregate capacity in multi-table assignment', async () => {
    render(<TablesPage />)

    await waitFor(() => {
      expect(screen.getByText('Mesa 1')).toBeInTheDocument()
    })

    // Select Mesa 1 (4 pers)
    fireEvent.click(screen.getByLabelText('Seleccionar mesa 1'))

    // Open assignment form
    const assignBtn = screen.getByRole('button', { name: /asignar a reserva/i })
    fireEvent.click(assignBtn)

    // Set party size to 8 (exceeds capacity of 4)
    const partyInput = screen.getByLabelText(/cantidad de comensales/i)
    fireEvent.change(partyInput, { target: { value: '8' } })

    expect(
      screen.getByText(/¡Atención! La reserva \(8p\) supera la capacidad \(4p\)/i),
    ).toBeInTheDocument()

    // Confirm button should be disabled
    const submitBtn = screen.getByRole('button', { name: /confirmar reserva y bloquear mesas/i })
    expect(submitBtn).toBeDisabled()
  })

  it('handles quick occupancy toggle', async () => {
    const updateOccupancySpy = vi
      .spyOn(tablesApi, 'updateTableOccupancy')
      .mockResolvedValue({ ...mockTables[0], currentOccupancy: 'occupied' })

    render(<TablesPage />)

    await waitFor(() => {
      expect(screen.getByLabelText('Ocupar mesa 1')).toBeInTheDocument()
    })

    const occupyBtn = screen.getByLabelText('Ocupar mesa 1')
    fireEvent.click(occupyBtn)

    await waitFor(() => {
      expect(updateOccupancySpy).toHaveBeenCalledWith('fake-token', 't-1', 'occupied')
    })
  })
})
