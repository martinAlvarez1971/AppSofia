import { afterEach, describe, expect, it, vi } from 'vitest'
import { listUsers, UsersApiError } from './users.api'

describe('users API error handling', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns a clear 401 session error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ message: 'Unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    )))

    await expect(listUsers('expired-token')).rejects.toMatchObject<Partial<UsersApiError>>({
      status: 401,
      message: 'La sesión venció. Iniciá sesión nuevamente.',
    })
  })

  it('does not disguise a 403 as an empty user list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ message: 'Forbidden' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    )))

    await expect(listUsers('operational-token')).rejects.toMatchObject<Partial<UsersApiError>>({
      status: 403,
      message: 'No tenés permisos para administrar cuentas.',
    })
  })
})