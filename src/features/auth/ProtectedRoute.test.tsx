import { fireEvent, render, screen } from '@testing-library/react'
import { useState, type PropsWithChildren } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AuthContext } from './auth.context'
import type { AuthValue } from './auth.context'
import { AuthProvider } from './AuthProvider'
import { ProtectedRoute } from './ProtectedRoute'
import type { Session } from '@supabase/supabase-js'

function TestAuthProvider({
  children,
  passwordRecovery = false,
  profile = null,
}: PropsWithChildren<{ passwordRecovery?: boolean; profile?: AuthValue['profile'] }>) {
  const [session, setSession] = useState<Session | null>({ user: { id: 'u1' } } as Session)
  const auth: AuthValue = {
    session,
    profile,
    passwordRecovery,
    status: 'ready',
    configured: true,
    signIn: vi.fn(),
    signOut: async () => {
      setSession(null)
      return null
    },
    recover: vi.fn(),
    updatePassword: vi.fn(),
  }
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>
}

describe('ProtectedRoute sin Supabase configurado', () => {
  it('redirige una ruta privada a la pantalla pública de acceso', async () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<h1>Acceso público</h1>} />
            <Route element={<ProtectedRoute />}>
              <Route path="/dashboard" element={<h1>Contenido privado</h1>} />
            </Route>
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'Acceso público' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Contenido privado' })).not.toBeInTheDocument()
  })

  it('permite cerrar sesión cuando el perfil está pendiente', async () => {
    render(
      <TestAuthProvider>
        <MemoryRouter initialEntries={['/dashboard']}>
          <Routes>
            <Route path="/login" element={<h1>Acceso público</h1>} />
            <Route element={<ProtectedRoute />}>
              <Route path="/dashboard" element={<h1>Contenido privado</h1>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </TestAuthProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }))
    expect(await screen.findByRole('heading', { name: 'Acceso público' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Contenido privado' })).not.toBeInTheDocument()
  })

  it('envía una sesión de recuperación a la pantalla de restablecimiento', async () => {
    render(
      <TestAuthProvider passwordRecovery profile={{ id: 'u1', first_name: null, last_name: null, email: 'admin@example.test', role: 'super_admin', status: 'active', created_at: '', updated_at: '' }}>
        <MemoryRouter initialEntries={['/dashboard']}>
          <Routes>
            <Route path="/auth/reset-password" element={<h1>Cambiar contraseña</h1>} />
            <Route element={<ProtectedRoute />}>
              <Route path="/dashboard" element={<h1>Contenido privado</h1>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </TestAuthProvider>,
    )

    expect(await screen.findByRole('heading', { name: 'Cambiar contraseña' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Contenido privado' })).not.toBeInTheDocument()
  })
})