import { Armchair, BarChart3, CalendarDays, LayoutDashboard, LogOut, UsersRound } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { useState } from 'react'
import { useAuth } from '../features/auth/auth.context'

export function AppShell() {
  const { profile, signOut } = useAuth()
  const [signOutError, setSignOutError] = useState('')
  const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ')
  async function handleSignOut() {
    const error = await signOut()
    if (error) setSignOutError(error)
  }
  return <div className="app-shell">
    <aside className="sidebar"><a className="brand" href="/dashboard"><span className="brand-mark">S</span><b>SOFIA</b></a>
      <span className="sidebar-label">OPERACIÓN</span>
      <nav aria-label="Navegación principal">
        <NavLink className="nav-item" to="/dashboard"><LayoutDashboard size={17} />Inicio</NavLink>
        {profile?.role === 'super_admin' ? <NavLink className="nav-item" to="/users"><UsersRound size={17} />Administradores</NavLink> : null}
        <NavLink className="nav-item" to="/tables"><Armchair size={17} />Mesas</NavLink>
        <span className="nav-item nav-planned"><CalendarDays size={17} />Reservas <small>Próxima fase</small></span>
        <span className="nav-item nav-planned"><BarChart3 size={17} />Informes <small>Próxima fase</small></span>
      </nav>
      <div className="sidebar-account"><strong>{name || 'Cuenta SOFIA'}</strong><small>{profile?.role === 'super_admin' ? 'Administrador principal' : 'Administrador operativo'}</small><button type="button" onClick={() => void handleSignOut()}><LogOut size={16} />Cerrar sesión</button></div>
    </aside>
    <main className="main-content"><header className="topbar"><span className="brand-mobile">SOFIA</span><small>ESPACIO DE TRABAJO</small><button className="mobile-logout" type="button" aria-label="Cerrar sesión" onClick={() => void handleSignOut()}><LogOut size={18} /></button></header><div className="content-wrap">{signOutError ? <p className="form-error" role="alert">{signOutError}</p> : null}<Outlet /></div></main>
  </div>
}