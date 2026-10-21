import type { ReactNode } from 'react'
import { CircleAlert, LoaderCircle, ShieldCheck } from 'lucide-react'

export function LoadingState({ label = 'Cargando' }: { label?: string }) {
  return <div className="page-state" role="status"><LoaderCircle className="spin" size={22} />{label}</div>
}

export function Notice({ title, children, warning = false }: { title: string; children: ReactNode; warning?: boolean }) {
  const Icon = warning ? CircleAlert : ShieldCheck
  return <section className={`notice${warning ? ' notice--warning' : ''}`}><Icon size={19} aria-hidden="true" /><div><strong>{title}</strong><p>{children}</p></div></section>
}