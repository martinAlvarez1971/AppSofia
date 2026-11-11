import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Bell,
  CalendarDays,
  ChartNoAxesCombined,
  Clock3,
  LayoutGrid,
  ShieldCheck,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/auth.context'

export function DashboardPage() {
  const { profile, configured, session, isDemo } = useAuth()
  const isSuperAdmin = profile?.role === 'super_admin'
  const name = profile?.first_name || session?.user.email?.split('@')[0] || 'equipo'

  return (
    <div className="dashboard-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">PANEL DE OPERACIÓN</span>
          <h1>Buen día, {name}</h1>
          <p>
            {isSuperAdmin
              ? 'Panel de control con acceso a supervisión de auditoría y alertas privadas.'
              : 'Espacio de trabajo habilitado para la operación y gestión del salón.'}
          </p>
        </div>
        <span className="connection-status">
          {isDemo
            ? 'Modo Demostración activo'
            : configured
              ? 'Configuración presente · conexión sin verificar'
              : 'Supabase sin configurar'}
        </span>
      </div>

      <section className="welcome-band">
        <div>
          <span className="eyebrow">FASE 2A · AUDITORÍA Y SALÓN</span>
          <h2>Operación trazable y alertas en tiempo real.</h2>
          <p>
            Cada cambio en mesas, capacidades o cancelaciones queda resguardado en la auditoría inmutable.
            {isSuperAdmin ? ' El centro privado de alertas te permite revisar eventos sensibles al instante.' : ''}
          </p>
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <Link to="/tables" className="button button--primary" style={{ textDecoration: 'none', fontSize: 12 }}>
              Ver Mesas y Salón <ArrowRight size={14} style={{ marginLeft: 6 }} />
            </Link>
            {isSuperAdmin ? (
              <Link to="/alerts" className="button button--quiet" style={{ textDecoration: 'none', fontSize: 12, background: '#fff' }}>
                <Bell size={14} style={{ marginRight: 6 }} /> Centro de Alertas
              </Link>
            ) : null}
          </div>
        </div>
        <span className="welcome-icon">
          {isSuperAdmin ? <ShieldCheck size={30} /> : <Clock3 size={28} />}
        </span>
      </section>

      {/* Acceso Rápido a Módulos */}
      <section className="module-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">HERRAMIENTAS OPERATIVAS</span>
            <h2>Módulos del Sistema</h2>
          </div>
          <small>Fase 2A implementada</small>
        </div>

        <div className="module-list">
          <Link to="/tables" style={{ textDecoration: 'none', color: 'inherit' }}>
            <article className="module-row">
              <small>01</small>
              <span className="module-icon">
                <LayoutGrid size={19} />
              </span>
              <span className="module-copy">
                <strong>Mesas y Operación</strong>
                <small>Capacidades, bloqueos por mantenimiento y cancelaciones auditadas</small>
              </span>
              <span className="module-status" style={{ color: 'var(--forest)' }}>
                Activo <ArrowUpRight size={14} />
              </span>
            </article>
          </Link>

          {isSuperAdmin ? (
            <Link to="/alerts" style={{ textDecoration: 'none', color: 'inherit' }}>
              <article className="module-row">
                <small>02</small>
                <span className="module-icon">
                  <Bell size={19} />
                </span>
                <span className="module-copy">
                  <strong>Centro Privado de Alertas</strong>
                  <small>Supervisión exclusiva, verificación de eventos y auditoría inmutable</small>
                </span>
                <span className="module-status" style={{ color: '#b24c30' }}>
                  Supervisión <ArrowUpRight size={14} />
                </span>
              </article>
            </Link>
          ) : null}

          <Link to="/reservas" style={{ textDecoration: 'none', color: 'inherit' }}>
            <article className="module-row">
              <small>03</small>
              <span className="module-icon">
                <CalendarDays size={19} />
              </span>
              <span className="module-copy">
                <strong>Consultas de Reservas</strong>
                <small>Búsqueda histórica, calendario operativo, clientes y auditoría trazable</small>
              </span>
              <span className="module-status" style={{ color: 'var(--forest)' }}>
                Activo <ArrowUpRight size={14} />
              </span>
            </article>
          </Link>

          <Link to="/informes" style={{ textDecoration: 'none', color: 'inherit' }}>
            <article className="module-row">
              <small>04</small>
              <span className="module-icon">
                <ChartNoAxesCombined size={19} />
              </span>
              <span className="module-copy">
                <strong>Estadísticas e Informes</strong>
                <small>Ocupación, rotación de mesas, demanda horaria y sesiones walk-in</small>
              </span>
              <span className="module-status" style={{ color: 'var(--forest)' }}>
                Activo <ArrowUpRight size={14} />
              </span>
            </article>
          </Link>
        </div>
      </section>
    </div>
  )
}