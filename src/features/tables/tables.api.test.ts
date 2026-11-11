import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  changeTableStatus,
  checkAvailability,
  createReservation,
  createTable,
  listTables,
  TablesApiError,
  toggleTableService,
  updateTable,
  updateTableOccupancy,
} from './tables.api'

describe('tables.api', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('listTables fetches tables and builds query string properly', async () => {
    const mockTables = [
      { id: 't1', number: '1', capacity: 4, minCapacity: 1, sector: 'Terraza', status: 'active', isOutOfService: false, currentOccupancy: 'free', derivedState: 'free' },
    ]
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockTables),
    })

    const result = await listTables('fake-token', { sector: 'Terraza', minCapacity: 2 })
    expect(result).toEqual(mockTables)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/tables?sector=Terraza&minCapacity=2'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer fake-token',
        }),
      }),
    )
  })

  it('createTable sends POST with input JSON', async () => {
    const mockCreated = { id: 't2', number: '2', capacity: 6 }
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: () => Promise.resolve(mockCreated),
    })

    const result = await createTable('fake-token', { number: '2', capacity: 6, sector: 'Salón' })
    expect(result).toEqual(mockCreated)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/tables'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ number: '2', capacity: 6, sector: 'Salón' }),
      }),
    )
  })

  it('updateTableOccupancy sends PATCH to occupancy endpoint', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 't1', currentOccupancy: 'occupied' }),
    })

    const result = await updateTableOccupancy('fake-token', 't1', 'occupied')
    expect(result.currentOccupancy).toBe('occupied')
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/tables/t1/occupancy'),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ currentOccupancy: 'occupied' }),
      }),
    )
  })

  it('toggleTableService sends PATCH to service endpoint', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 't1', isOutOfService: true }),
    })

    const result = await toggleTableService('fake-token', 't1', true)
    expect(result.isOutOfService).toBe(true)
  })

  it('changeTableStatus sends PATCH to status endpoint', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 't1', status: 'inactive' }),
    })

    const result = await changeTableStatus('fake-token', 't1', 'inactive')
    expect(result.status).toBe('inactive')
  })

  it('checkAvailability queries reservations/availability', async () => {
    const mockAvail = {
      startTime: '2026-10-22T20:00:00.000Z',
      endTime: '2026-10-22T22:00:00.000Z',
      durationMinutes: 120,
      totalAvailableCapacity: 10,
      canAccommodate: true,
      tables: [],
    }
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockAvail),
    })

    const res = await checkAvailability('fake-token', {
      startTime: '2026-10-22T20:00:00.000Z',
      durationMinutes: 120,
      partySize: 4,
    })
    expect(res.canAccommodate).toBe(true)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/reservations/availability?startTime=2026-10-22T20%3A00%3A00.000Z&durationMinutes=120&partySize=4'),
      expect.any(Object),
    )
  })

  it('createReservation sends POST with multi-table IDs', async () => {
    const mockRes = { id: 'res-1', customerName: 'Juan Pérez', partySize: 8 }
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: () => Promise.resolve(mockRes),
    })

    const res = await createReservation('fake-token', {
      customerName: 'Juan Pérez',
      partySize: 8,
      startTime: '2026-10-22T21:00:00.000Z',
      tableIds: ['t1', 't2'],
    })
    expect(res.id).toBe('res-1')
  })

  it('handles 403 Forbidden with custom message', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ message: 'Forbidden' }),
    })

    await expect(createTable('fake-token', { number: '1', capacity: 4 })).rejects.toThrow(
      'No tenés permisos para realizar esta operación.',
    )
  })

  it('handles network failure with clear error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Failed to fetch'))

    await expect(listTables('fake-token')).rejects.toThrow(
      'No se pudo conectar con el servidor. Verificá que el backend esté iniciado.',
    )
  })
})
