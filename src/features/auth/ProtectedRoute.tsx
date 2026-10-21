import { useState, type PropsWithChildren } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Notice, LoadingState } from '../../components/PageState'
import { useAuth } from './auth.context'
import { getAccessDecision } from './authorization'
import type { AppRole } from './auth.types'

export function ProtectedRoute({ children, allowedRoles }: PropsWithChildren<{ allowedRoles?: readonly AppRole[] }>) {
  const auth = useAuth()
  const location = useLocation()
  const [signOutError, setSignOutError] = useState('')
  const decision = getAccessDecision({
    loading: auth.status === 'loading', configured: auth.configured,
    userId: auth.session?.user.id ?? null, profile: auth.profile,
    error: auth.status === 'error',
  }, allowedRoles)
  async function handleSignOut() {
    const error = await auth.signOut()
    if (error) setSignOutError(error)
  }

  if (decision === 'loading') return <LoadingState label="Verificando sesión y permisos" />
  if (auth.passwordRecovery) return <Navigate to="/auth/reset-password" replace />
  if (decision === 'unconfigured') return <Navigate to="/login" replace />
  if (decision === 'unauthenticated') return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (decision === 'error' || decision === 'pending' || decision === 'forbidden') {
    const messages = {
      error: ['No pudimos verificar tu perfil', 'El acceso permanece bloqueado. Revisá la conexión o contactá al administrador.'],
      pending: ['Cuenta pendiente de habilitación', 'Tu perfil no está activo o todavía no fue creado. Contactá al administrador principal.'],
      forbidden: ['Sección restringida', 'Esta función está reservada al administrador principal.'],
    } as const
    const [title, message] = messages[decision]
    return <div className="state-page"><Notice title={title} warning>{message}</Notice><button className="button button--primary" type="button" onClick={() => void handleSignOut()}>Cerrar sesión</button>{signOutError ? <p className="form-error" role="alert">{signOutError}</p> : null}</div>
  }
  return children ? <>{children}</> : <Outlet />
}