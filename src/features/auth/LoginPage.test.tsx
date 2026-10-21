import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AuthProvider } from './AuthProvider'
import { AuthContext, type AuthValue } from './auth.context'
import { LoginPage } from './LoginPage'
import type { Session } from '@supabase/supabase-js'

vi.mock('../../lib/supabase', () => ({
  isSupabaseConfigured: false,
  supabase: null,
}))

function SuccessfulLoginProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const auth: AuthValue = {
    session,
    profile: session ? { id: 'u1', first_name: 'Sofía', last_name: 'Admin', email: 'admin@example.test', role: 'operational_admin', status: 'active', created_at: '', updated_at: '' } : null,
    passwordRecovery: false,
    status: 'ready',
    configured: true,
    signIn: async () => {
      setSession({ user: { id: 'u1' } } as Session)
      return null
    },
    signOut: async () => null,
    recover: async () => true,
    updatePassword: async () => null,
  }
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>
}

describe('LoginPage sin Supabase configurado', () => {
  it('explica el estado y no ofrece registro público', async () => {
    render(<MemoryRouter><AuthProvider><LoginPage /></AuthProvider></MemoryRouter>)
    expect(await screen.findByText('Falta configurar Supabase')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeDisabled()
    expect(screen.queryByRole('link', { name: /crear cuenta|registrarse/i })).not.toBeInTheDocument()
  })

  it('espera la sesión restaurada por el provider antes de navegar', async () => {
    render(
      <SuccessfulLoginProvider>
        <MemoryRouter initialEntries={['/login']}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/dashboard" element={<h1>Dashboard autenticado</h1>} />
          </Routes>
        </MemoryRouter>
      </SuccessfulLoginProvider>,
    )

    fireEvent.change(screen.getByRole('textbox', { name: 'Correo electrónico' }), { target: { value: 'admin@example.test' } })
    fireEvent.change(screen.getByLabelText(/Contraseña/), { target: { value: 'una-clave-segura' } })
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))

    expect(await screen.findByRole('heading', { name: 'Dashboard autenticado' })).toBeInTheDocument()
  })
})