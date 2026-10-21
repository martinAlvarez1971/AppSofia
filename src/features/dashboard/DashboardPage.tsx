import { ArrowUpRight, CalendarDays, ChartNoAxesCombined, Clock3, LayoutGrid } from 'lucide-react'
import { useAuth } from '../auth/auth.context'

const modules = [
  { title: 'Mesas', detail: 'Capacidades y combinaciones', icon: LayoutGrid },
  { title: 'Reservas', detail: 'Disponibilidad y asignación', icon: CalendarDays },
  { title: 'Estadísticas', detail: 'Ocupación y demanda', icon: ChartNoAxesCombined },
]

export function DashboardPage() {
  const { profile, configured, session } = useAuth()
  const name = profile?.first_name || session?.user.email?.split('@')[0] || 'equipo'
  return <div className="dashboard-page">
    <div className="page-heading"><div><span className="eyebrow">PANEL DE OPERACIÓN</span><h1>Buen día, {name}</h1><p>Este espacio se está preparando para acompañar el servicio.</p></div><span className="connection-status">{configured ? 'Configuración presente · conexión sin verificar' : 'Supabase sin configurar'}</span></div>
    <section className="welcome-band"><div><span className="eyebrow">FASE 1 · FUNDACIÓN</span><h2>La operación, lista para crecer.</h2><p>El acceso y los permisos iniciales están preparados. Las herramientas del salón se incorporarán en las siguientes fases.</p></div><span className="welcome-icon"><Clock3 size={28} /></span></section>
    <section className="module-section"><div className="section-heading"><div><span className="eyebrow">LO QUE SIGUE</span><h2>Próximas herramientas</h2></div><small>Sin datos operativos todavía</small></div>
      <div className="module-list">{modules.map(({ title, detail, icon: Icon }, i) => <article className="module-row" key={title}><small>0{i + 1}</small><span className="module-icon"><Icon size={19} /></span><span className="module-copy"><strong>{title}</strong><small>{detail}</small></span><span className="module-status">En planificación <ArrowUpRight size={14} /></span></article>)}</div>
    </section>
  </div>
}