import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { supabaseMock } = vi.hoisted(() => ({
  supabaseMock: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
    },
    from: vi.fn(),
  },
}))

vi.mock('../../lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: supabaseMock,
}))

import { AuthProvider } from './AuthProvider'
import { useAuth } from './auth.context'
import { hasPasswordRecoveryMarker, setPasswordRecoveryMarker } from './recovery-marker'

function AuthStatusProbe() {
  const { status } = useAuth()
  return <output>{status}</output>
}

describe('AuthProvider recovery restoration', () => {
  beforeEach(() => {
    sessionStorage.clear()
    supabaseMock.auth.getSession.mockReset()
    supabaseMock.auth.onAuthStateChange.mockReset()
    supabaseMock.from.mockReset()
  })

  it('preserves a recovery marker while restoring an existing session', async () => {
    setPasswordRecoveryMarker(true)
    supabaseMock.auth.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    })
    supabaseMock.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'u1' } } },
      error: null,
    })
    supabaseMock.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: 'u1', first_name: null, last_name: null,
              email: 'admin@example.test', role: 'operational_admin', status: 'active',
              created_at: '', updated_at: '',
            },
            error: null,
          }),
        }),
      }),
    })

    render(<AuthProvider><AuthStatusProbe /></AuthProvider>)

    expect(await screen.findByText('ready')).toBeInTheDocument()
    expect(hasPasswordRecoveryMarker()).toBe(true)
  })

  it('clears a stale recovery marker when the initial auth event has no session', async () => {
    setPasswordRecoveryMarker(true)
    let authCallback: ((event: string, session: null) => void) | undefined
    supabaseMock.auth.onAuthStateChange.mockImplementation((callback) => {
      authCallback = callback
      return { data: { subscription: { unsubscribe: vi.fn() } } }
    })
    supabaseMock.auth.getSession.mockResolvedValue({
      data: { session: null },
      error: null,
    })

    render(<AuthProvider><AuthStatusProbe /></AuthProvider>)
    authCallback?.('INITIAL_SESSION', null)

    expect(await screen.findByText('ready')).toBeInTheDocument()
    expect(hasPasswordRecoveryMarker()).toBe(false)
  })
})