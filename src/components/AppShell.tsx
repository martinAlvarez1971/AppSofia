import {
  Armchair,
  BarChart3,
  Bell,
  CalendarDays,
  LayoutDashboard,
  LogOut,
  UsersRound,
} from 'lucide-react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useAuth } from '../features/auth/auth.context'
import { alertsApi } from '../features/alerts/alerts.api'

export function AppShell() {
  const { session, profile, signOut, isDemo } = useAuth()
  const location = useLocation()
  const [signOutError, setSignOutError] = useState('')
  const [pendingAlertsCount, setPendingAlertsCount] = useState<number>(0)
  const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ')

  async function handleSignOut() {
    const error = await signOut()
    if (error) setSignOutError(error)
  }

  // Poll / fetch pending alerts exclusively for super_admin
  useEffect(() => {
    if (profile?.role !== 'super_admin' || !session?.access_token) {
      setPendingAlertsCount(0)
      return
    }

    let isMounted = true
    async function checkAlerts() {
      try {
        const res = await alertsApi.getAlerts(session!.access_token, { status: 'pending' })
        if (isMounted) {
          setPendingAlertsCount(res.summary.pending)
        }
      } catch {
        // Operational admin or transient error fails quietly in navigation badge
      }
    }

    void checkAlerts()
    const interval = setInterval(checkAlerts, 10000)
    return () => {
      isMounted = false
      clearInterval(interval)
    }
  }, [profile?.role, session?.access_token, location.pathname])

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/dashboard">
          <span className="brand-mark">S</span>
          <b>SOFIA</b>
        </a>
        <span className="sidebar-label">OPERACIÓN</span>
        <nav aria-label="Navegación principal">
          <NavLink className="nav-item" to="/dashboard">
            <LayoutDashboard size={17} />
            Inicio
          </NavLink>

          <NavLink className="nav-item" to="/tables">
            <Armchair size={17} />
            Mesas y Salón
          </NavLink>

          {profile?.role === 'super_admin' ? (
            <>
              <NavLink className="nav-item" to="/alerts">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <Bell size={17} />
                    Alertas
                  </span>
                  {pendingAlertsCount > 0 ? (
                    <span
                      style={{
                        background: '#dc5f4e',
                        color: '#fff',
                        fontSize: 10,
                        fontWeight: 800,
                        padding: '1px 6px',
                        borderRadius: 10,
                        minWidth: 18,
                        textAlign: 'center',
                      }}
                    >
                      {pendingAlertsCount}
                    </span>
                  ) : null}
                </div>
              </NavLink>

              <NavLink className="nav-item" to="/users">
                <UsersRound size={17} />
                Administradores
              </NavLink>
            </>
          ) : null}

          <NavLink className="nav-item" to="/reservas">
            <CalendarDays size={17} />
            Reservas
          </NavLink>
          <NavLink className="nav-item" to="/informes">
            <BarChart3 size={17} />
            Informes
          </NavLink>
        </nav>

        <div className="sidebar-account">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <strong>{name || 'Cuenta SOFIA'}</strong>
            {isDemo ? (
              <span
                style={{
                  fontSize: '9px',
                  fontWeight: 700,
                  color: '#9a6128',
                  background: '#fbf1e3',
                  padding: '1px 5px',
                  borderRadius: '4px',
                }}
              >
                DEMO
              </span>
            ) : null}
          </div>
          <small>
            {profile?.role === 'super_admin' ? 'Administrador principal' : 'Administrador operativo'}
          </small>
          <button type="button" onClick={() => void handleSignOut()}>
            <LogOut size={16} />
            Cerrar sesión
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <span className="brand-mobile">SOFIA</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <small>
              ESPACIO DE TRABAJO {isDemo ? '· MODO DEMO' : ''}
            </small>
            {profile?.role === 'super_admin' && pendingAlertsCount > 0 ? (
              <NavLink
                to="/alerts"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  background: '#fff0ee',
                  border: '1px solid #f2bcba',
                  color: '#9c3d36',
                  padding: '3px 8px',
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 700,
                  textDecoration: 'none',
                }}
              >
                <Bell size={13} />
                {pendingAlertsCount} alerta(s)
              </NavLink>
            ) : null}
          </div>
          <button
            className="mobile-logout"
            type="button"
            aria-label="Cerrar sesión"
            onClick={() => void handleSignOut()}
          >
            <LogOut size={18} />
          </button>
        </header>

        <div className="content-wrap">
          {signOutError ? (
            <p className="form-error" role="alert">
              {signOutError}
            </p>
          ) : null}
          <Outlet />
        </div>
      </main>
    </div>
  )
}