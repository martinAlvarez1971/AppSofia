import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@supabase/supabase-js'
import { AuthContext, type AuthValue } from '../auth/auth.context'
import { UsersPage } from './UsersPage'

const user = {
  id: 'user-2',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.test',
  role: 'operational_admin',
  status: 'active',
  createdAt: '2026-10-20T12:00:00.000Z',
}

function renderUsersPage(signOut = vi.fn().mockResolvedValue(null)) {
  const auth: AuthValue = {
    session: { access_token: 'test-token', user: { id: 'user-1' } } as Session,
    profile: { id: 'user-1', first_name: 'Principal', last_name: 'SOFIA', email: 'principal@example.test', role: 'super_admin', status: 'active', created_at: '', updated_at: '' },
    passwordRecovery: false,
    status: 'ready',
    configured: true,
    signIn: vi.fn(),
    signOut,
    recover: vi.fn(),
    updatePassword: vi.fn(),
  }
  return render(<AuthContext.Provider value={auth}><UsersPage /></AuthContext.Provider>)
}

describe('UsersPage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('muestra las cuentas y sus roles/estados', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([user]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })))

    renderUsersPage()

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByText('Operativo')).toBeInTheDocument()
    expect(screen.getByText('Activo')).toBeInTheDocument()
  })

  it('presenta un 403 como autorización insuficiente y no como lista vacía', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })))

    renderUsersPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('No tenés permisos para administrar cuentas.')
    expect(screen.queryByText('No hay cuentas para mostrar.')).not.toBeInTheDocument()
  })

  it('abre un diálogo accesible para invitar una cuenta operativa', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })))

    renderUsersPage()
    fireEvent.click(await screen.findByRole('button', { name: /Invitar administrador/ }))

    expect(screen.getByRole('dialog', { name: 'Invitar administrador' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Rol' })).toHaveValue('operational_admin')
  })

  it('ofrece reintentar logout cuando la transferencia del rol fue exitosa', async () => {
    const signOut = vi.fn()
      .mockResolvedValueOnce('No se pudo cerrar la sesión.')
      .mockResolvedValueOnce(null)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([user]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...user, role: 'super_admin', currentUserDemoted: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))

    renderUsersPage(signOut)
    fireEvent.click(await screen.findByRole('button', { name: 'Transferir rol principal a ada@example.test' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('El rol se transfirió, pero no se pudo cerrar la sesión')
    expect(screen.getByRole('button', { name: /Invitar administrador/ })).toBeDisabled()
    const retry = screen.getByRole('button', { name: 'Reintentar cerrar sesión' })
    fireEvent.click(retry)
    expect(signOut).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Invitar administrador/ })).toBeEnabled()
  })
})