import type { PropsWithChildren, ReactNode } from 'react'
import { Utensils } from 'lucide-react'

export function AuthFrame({ title, description, children, footer }: PropsWithChildren<{ title: string; description: string; footer?: ReactNode }>) {
  return <main className="auth-screen">
    <aside className="auth-story">
      <a className="brand" href="/login"><span className="brand-mark"><Utensils size={19} /></span><b>SOFIA</b></a>
      <div><span className="eyebrow">GESTIÓN DEL SALÓN</span><p className="auth-story__title">Un salón bien coordinado empieza con una bienvenida.</p><span className="auth-story__line" /><small>Mesas · Reservas · Servicio</small></div>
      <small className="auth-story__footer">SOFIA · OPERACIONES</small>
    </aside>
    <section className="auth-panel"><div className="auth-panel__inner">
      <span className="eyebrow">ACCESO DEL EQUIPO</span><h1>{title}</h1><p className="auth-panel__description">{description}</p>
      {children}{footer ? <div className="auth-panel__footer">{footer}</div> : null}
    </div></section>
  </main>
}