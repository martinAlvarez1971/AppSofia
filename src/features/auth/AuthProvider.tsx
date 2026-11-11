import { useCallback, useEffect, useMemo, useState, type PropsWithChildren } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import type { Profile } from './auth.types'
import { AuthContext, type AuthStatus } from './auth.context'
import { hasPasswordRecoveryMarker, setPasswordRecoveryMarker } from './recovery-marker'

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [demoRole, setDemoRole] = useState<'super_admin' | 'operational_admin' | null>(() => {
    // If Supabase is configured, demo mode is strictly inoperable and ignored
    if (isSupabaseConfigured) return null
    if (typeof window !== 'undefined') {
      return localStorage.getItem('sofia_demo_role') as 'super_admin' | 'operational_admin' | null
    }
    return null
  })
  const [passwordRecovery, setPasswordRecovery] = useState(
    () => isSupabaseConfigured && hasPasswordRecoveryMarker(),
  )
  const [status, setStatus] = useState<AuthStatus>(() => {
    if (!isSupabaseConfigured && demoRole) return 'ready'
    return isSupabaseConfigured ? 'loading' : 'unconfigured'
  })

  const effectiveSession = useMemo<Session | null>(() => {
    if (session) return session
    if (!isSupabaseConfigured && demoRole) {
      return {
        access_token: demoRole === 'super_admin' ? 'demo-super-admin-token' : 'demo-operational-token',
        token_type: 'bearer',
        expires_in: 86400,
        refresh_token: 'demo-refresh',
        user: {
          id: demoRole === 'super_admin' ? '00000000-0000-0000-0000-000000000001' : '00000000-0000-0000-0000-000000000002',
          app_metadata: {},
          user_metadata: {},
          aud: 'authenticated',
          created_at: '2026-01-01T00:00:00.000Z',
          email: demoRole === 'super_admin' ? 'martinalvarez.android@gmail.com' : 'sofia.operaciones@restaurante.com',
        },
      } as unknown as Session
    }
    return null
  }, [session, demoRole])

  const effectiveProfile = useMemo<Profile | null>(() => {
    if (profile) return profile
    if (!isSupabaseConfigured && demoRole) {
      return {
        id: demoRole === 'super_admin' ? '00000000-0000-0000-0000-000000000001' : '00000000-0000-0000-0000-000000000002',
        first_name: demoRole === 'super_admin' ? 'Martín' : 'Sofía',
        last_name: demoRole === 'super_admin' ? 'Álvarez' : 'García',
        email: demoRole === 'super_admin' ? 'martinalvarez.android@gmail.com' : 'sofia.operaciones@restaurante.com',
        role: demoRole,
        status: 'active',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      }
    }
    return null
  }, [profile, demoRole])

  useEffect(() => {
    const client = supabase
    if (!client) return
    let mounted = true
    let receivedEvent = false
    let revision = 0

    const sync = async (next: Session | null) => {
      const current = ++revision
      setSession(next)
      setProfile(null)
      if (!next) {
        setPasswordRecovery(false)
        setPasswordRecoveryMarker(false)
        setStatus('ready')
        return
      }
      setStatus('loading')
      const { data, error } = await client.from('profiles')
        .select('id, first_name, last_name, email, role, status, created_at, updated_at')
        .eq('id', next.user.id).maybeSingle()
      if (!mounted || current !== revision) return
      if (error) {
        setStatus('error')
        return
      }
      setProfile((data as Profile | null) ?? null)
      setStatus('ready')
    }

    const { data: { subscription } } = client.auth.onAuthStateChange((event, next) => {
      receivedEvent = true
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecovery(true)
        setPasswordRecoveryMarker(true)
      }
      if (event === 'SIGNED_OUT') {
        setPasswordRecovery(false)
        setPasswordRecoveryMarker(false)
      }
      queueMicrotask(() => void sync(next))
    })
    void client.auth.getSession().then(({ data, error }) => {
      if (!mounted || receivedEvent) return
      if (error) setStatus('error')
      else {
        if (!data.session) {
          setPasswordRecovery(false)
          setPasswordRecoveryMarker(false)
        }
        void sync(data.session)
      }
    })
    return () => {
      mounted = false
      revision += 1
      subscription.unsubscribe()
    }
  }, [])

  const enterDemoMode = useCallback((role: 'super_admin' | 'operational_admin' = 'super_admin') => {
    localStorage.setItem('sofia_demo_role', role)
    setDemoRole(role)
    setStatus('ready')
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) {
      enterDemoMode('super_admin')
      return null
    }
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (!error) {
      setPasswordRecovery(false)
      setPasswordRecoveryMarker(false)
      return null
    }
    const text = `${error.code ?? ''} ${error.message}`.toLowerCase()
    if (text.includes('invalid')) return 'El correo o la contraseña no son correctos.'
    if (text.includes('not_confirmed')) return 'El correo todavía no fue confirmado. Contactá al administrador.'
    return 'No se pudo iniciar sesión. Revisá tus datos e intentá nuevamente.'
  }, [enterDemoMode])

  const signOut = useCallback(async () => {
    if (demoRole) {
      localStorage.removeItem('sofia_demo_role')
      setDemoRole(null)
      setSession(null)
      setProfile(null)
      setStatus(isSupabaseConfigured ? 'ready' : 'unconfigured')
      return null
    }
    if (!supabase) return null
    try {
      const { error } = await supabase.auth.signOut()
      if (!error) return null
      const { error: localError } = await supabase.auth.signOut({ scope: 'local' })
      return localError ? 'No se pudo cerrar la sesión. Intentá nuevamente.' : null
    } catch {
      try {
        const { error } = await supabase.auth.signOut({ scope: 'local' })
        return error ? 'No se pudo cerrar la sesión. Intentá nuevamente.' : null
      } catch {
        return 'No se pudo cerrar la sesión por un error de conexión. Intentá nuevamente.'
      }
    }
  }, [demoRole])

  const recover = useCallback(async (email: string) => {
    if (!supabase) return false
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    })
    return !error
  }, [])

  const updatePassword = useCallback(async (password: string) => {
    if (!supabase) return 'Supabase todavía no está configurado.'
    const { error } = await supabase.auth.updateUser({ password })
    if (error) return 'No se pudo actualizar. Solicitá un nuevo enlace de recuperación.'
    setPasswordRecovery(false)
    setPasswordRecoveryMarker(false)
    return null
  }, [])

  const effectiveStatus = demoRole ? 'ready' : status

  const value = useMemo(() => ({
    session: effectiveSession,
    profile: effectiveProfile,
    passwordRecovery,
    status: effectiveStatus,
    configured: isSupabaseConfigured || Boolean(demoRole),
    signIn,
    signOut,
    recover,
    updatePassword,
    enterDemoMode,
    isDemo: Boolean(demoRole),
  }), [
    effectiveSession,
    effectiveProfile,
    passwordRecovery,
    effectiveStatus,
    signIn,
    signOut,
    recover,
    updatePassword,
    enterDemoMode,
    demoRole,
  ])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}