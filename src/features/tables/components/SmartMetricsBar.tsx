import { Armchair, CheckCircle2, Clock, Users, UtensilsCrossed } from 'lucide-react'
import type { Table, Reservation } from '../tables.types'

interface SmartMetricsBarProps {
  tables: Table[]
  reservations: Reservation[]
}

export function SmartMetricsBar({ tables, reservations }: SmartMetricsBarProps) {
  const activeTables = tables.filter((t) => t.isActive && t.status !== 'out_of_service')
  const availableTables = tables.filter((t) => t.status === 'available')
  const occupiedTables = tables.filter((t) => t.status === 'occupied')
  const reservedTables = tables.filter((t) => t.status === 'reserved')
  const outOfServiceTables = tables.filter((t) => t.status === 'out_of_service')

  const totalSeats = activeTables.reduce((acc, t) => acc + t.capacity, 0)
  const occupiedSeats = occupiedTables.reduce((acc, t) => acc + t.capacity, 0)
  const occupancyRate = activeTables.length > 0
    ? Math.round((occupiedTables.length / activeTables.length) * 100)
    : 0

  // Calculate average turnaround time for currently occupied tables
  const now = Date.now()
  const elapsedMinutesList = occupiedTables
    .map((t) => (t.occupiedSince ? Math.floor((now - new Date(t.occupiedSince).getTime()) / 60000) : null))
    .filter((m): m is number => m !== null && m >= 0)

  const avgTurnaround = elapsedMinutesList.length > 0
    ? Math.round(elapsedMinutesList.reduce((a, b) => a + b, 0) / elapsedMinutesList.length)
    : 0

  const activeReservationsCount = reservations.filter((r) => r.status === 'confirmed').length

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3 p-4 bg-white border border-[#dce4dd] rounded-xl shadow-xs">
      <div className="flex flex-col gap-1 pr-3 border-r border-[#eef2ee]">
        <span className="text-[11px] font-bold text-[#68766f] tracking-wider uppercase flex items-center gap-1.5">
          <UtensilsCrossed size={13} className="text-[#1f5a49]" /> Ocupación Salón
        </span>
        <div className="flex items-baseline gap-2 mt-0.5">
          <span className="text-2xl font-bold font-mono text-[#1b2925]">{occupancyRate}%</span>
          <span className="text-xs text-[#68766f]">
            {occupiedTables.length}/{activeTables.length} mesas
          </span>
        </div>
        <div className="w-full bg-[#eef2ee] h-1.5 rounded-full overflow-hidden mt-1">
          <div
            className="bg-[#1f5a49] h-full rounded-full transition-all duration-500"
            style={{ width: `${Math.min(100, occupancyRate)}%` }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1 pr-3 border-r border-[#eef2ee]">
        <span className="text-[11px] font-bold text-[#68766f] tracking-wider uppercase flex items-center gap-1.5">
          <CheckCircle2 size={13} className="text-emerald-600" /> Disponibles
        </span>
        <div className="flex items-baseline gap-2 mt-0.5">
          <span className="text-2xl font-bold font-mono text-emerald-700">{availableTables.length}</span>
          <span className="text-xs text-[#68766f]">
            {availableTables.reduce((acc, t) => acc + t.capacity, 0)} plazas libres
          </span>
        </div>
        <span className="text-[11px] text-[#68766f]">Listas para asignar de inmediato</span>
      </div>

      <div className="flex flex-col gap-1 pr-3 border-r border-[#eef2ee]">
        <span className="text-[11px] font-bold text-[#68766f] tracking-wider uppercase flex items-center gap-1.5">
          <Users size={13} className="text-[#3b82f6]" /> Comensales en Mesa
        </span>
        <div className="flex items-baseline gap-2 mt-0.5">
          <span className="text-2xl font-bold font-mono text-[#1e3a8a]">{occupiedSeats}</span>
          <span className="text-xs text-[#68766f]">de {totalSeats} sillas</span>
        </div>
        <span className="text-[11px] text-[#68766f]">
          {reservedTables.length} mesas en espera de arribo
        </span>
      </div>

      <div className="flex flex-col gap-1 pr-3 border-r border-[#eef2ee]">
        <span className="text-[11px] font-bold text-[#68766f] tracking-wider uppercase flex items-center gap-1.5">
          <Clock size={13} className="text-amber-700" /> Tiempo de Servicio
        </span>
        <div className="flex items-baseline gap-2 mt-0.5">
          <span className="text-2xl font-bold font-mono text-[#78350f]">
            {avgTurnaround > 0 ? `${avgTurnaround}m` : '0m'}
          </span>
          <span className="text-xs text-[#68766f]">promedio activo</span>
        </div>
        <span className="text-[11px] text-[#68766f]">
          {activeReservationsCount} reservas agendadas
        </span>
      </div>

      <div className="flex flex-col gap-1 col-span-2 lg:col-span-1">
        <span className="text-[11px] font-bold text-[#68766f] tracking-wider uppercase flex items-center gap-1.5">
          <Armchair size={13} className="text-[#9c3d36]" /> Mantenimiento
        </span>
        <div className="flex items-baseline gap-2 mt-0.5">
          <span className="text-2xl font-bold font-mono text-[#9c3d36]">{outOfServiceTables.length}</span>
          <span className="text-xs text-[#68766f]">fuera de servicio</span>
        </div>
        <span className="text-[11px] text-[#68766f]">
          {outOfServiceTables.length > 0 ? 'Con auditoría preventiva' : 'Salón 100% operativo'}
        </span>
      </div>
    </div>
  )
}
