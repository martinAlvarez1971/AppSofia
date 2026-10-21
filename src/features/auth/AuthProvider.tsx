import { useCallback, useEffect, useMemo, useState, type PropsWithChildren } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import type { Profile } from './auth.types'
import { AuthContext, type AuthStatus } from './auth.context'
import { hasPasswordRecoveryMarker, setPasswordRecoveryMarker } from './recovery-marker'

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [passwordRecovery, setPasswordRecovery] = useState(
    () => isSupabaseConfigured && hasPasswordRecoveryMarker(),
  )
  const [status, setStatus] = useState<AuthStatus>(isSupabaseConfigured ? 'loading' : 'unconfigured')

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

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) return 'Supabase todavía no está configurado.'
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
  }, [])

  const signOut = useCallback(async () => {
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
  }, [])

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

  const value = useMemo(() => ({
    session, profile, passwordRecovery, status, configured: isSupabaseConfigured,
    signIn, signOut, recover, updatePassword,
  }), [session, profile, passwordRecovery, status, signIn, signOut, recover, updatePassword])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}