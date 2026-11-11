import {
  CheckCircle,
  Clock,
  Edit2,
  Power,
  Users,
  X,
  PlusCircle,
  AlertTriangle,
  Calendar,
  Trash2,
  ArrowLeftRight,
  UserX,
  ShieldAlert,
  Timer,
} from 'lucide-react'
import type { Table, Reservation } from '../tables.types'

interface TableDetailDrawerProps {
  table: Table | null
  reservations: Reservation[]
  isSuperAdmin?: boolean
  onClose: () => void
  onOpenWalkIn: (table: Table) => void
  onCloseWalkIn: (table: Table, sessionId: string) => void
  onOpenOperationalReleaseModal: (table: Table) => void
  onExtendSession: (sessionId: string, extraMinutes: number) => void
  onSeatReservation: (reservation: Reservation) => void
  onCompleteService: (reservation: Reservation) => void
  onNoShowReservation: (reservation: Reservation) => void
  onOpenReassignModal: (reservation: Reservation) => void
  onOpenCapacityModal: (table: Table) => void
  onOpenDeactivateModal: (table: Table) => void
  onReactivate: (table: Table) => void
  onOpenReservationModal: (tables: Table[], guestsCount?: number) => void
  onCancelReservation: (reservation: Reservation) => void
  onDeleteTable?: (table: Table) => void
  busy: boolean
}

export function TableDetailDrawer({
  table,
  reservations,
  isSuperAdmin,
  onClose,
  onOpenWalkIn,
  onCloseWalkIn,
  onOpenOperationalReleaseModal,
  onExtendSession,
  onSeatReservation,
  onCompleteService,
  onNoShowReservation,
  onOpenReassignModal,
  onOpenCapacityModal,
  onOpenDeactivateModal,
  onReactivate,
  onOpenReservationModal,
  onCancelReservation,
  onDeleteTable,
  busy,
}: TableDetailDrawerProps) {
  if (!table) return null

  const isOccupied = table.status === 'occupied'
  const isReserved = table.status === 'reserved'
  const isOutOfService = table.status === 'out_of_service'
  const isAvailable = table.status === 'available'
  const activeSession = table.activeSession || null
  const isReservationSession = activeSession?.sessionType === 'reservation'
  const isWalkInSession = activeSession?.sessionType === 'walk_in'

  const startRef = activeSession?.startedAt || table.occupiedSince
  const elapsedMinutes = startRef
    ? Math.max(0, Math.floor((Date.now() - new Date(startRef).getTime()) / 60000))
    : null

  const tableReservations = reservations.filter(
    (r) => r.tableId === table.id || (r.tableIds && r.tableIds.includes(table.id))
  )

  const confirmedReservation = tableReservations.find((r) => r.status === 'confirmed')
  const seatedReservation = tableReservations.find(
    (r) => r.status === 'seated' && (!activeSession?.reservationId || r.id === activeSession.reservationId)
  )

  const hasHistory = tableReservations.length > 0 || Boolean(activeSession)

  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-md bg-white border-l border-[#dce4dd] shadow-2xl z-50 flex flex-col justify-between animate-in slide-in-from-right duration-200">
      <div className="p-5 border-b border-[#eef2ee]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span
              className={`w-10 h-10 rounded-xl grid place-items-center text-lg font-bold font-mono ${
                isOccupied
                  ? 'bg-blue-100 text-blue-800'
                  : isReserved
                    ? 'bg-red-600 text-white shadow-xs'
                    : isOutOfService
                      ? 'bg-gray-100 text-gray-600'
                      : 'bg-[#e8f1eb] text-[#1f5a49]'
              }`}
            >
              {table.number}
            </span>
            <div>
              <h3 className="text-base font-bold text-[#1b2925]">
                Mesa {table.number} · {table.sector}
              </h3>
              <div className="flex items-center gap-2 text-xs text-[#68766f]">
                <span>Capacidad: {table.capacity} pax (Máx {table.maxCapacity})</span>
                <span aria-hidden="true">·</span>
                <span className="capitalize">{table.shape || 'cuadrada'}</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#68766f] hover:bg-[#f4f6f4] hover:text-[#1b2925]"
            aria-label="Cerrar panel de mesa"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-6">
        <div
          className={`p-4 rounded-xl border ${
            isOccupied
              ? 'bg-blue-50 border-blue-200 text-blue-900'
              : isReserved
                ? 'bg-rose-50 border-rose-200 text-rose-900'
                : isOutOfService
                  ? 'bg-red-50 border-red-200 text-red-900'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-900'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider">
            <span>Estado Operativo</span>
            <span className="font-bold">
              {isOccupied
                ? isReservationSession
                  ? 'Ocupada · Sesión de Reserva'
                  : isWalkInSession
                    ? 'Ocupada · Sesión Walk-in'
                    : 'Ocupada · Sin Sesión Vinculada'
                : isReserved
                  ? 'Reservada'
                  : isOutOfService
                    ? 'Fuera de Servicio'
                    : 'Disponible'}
            </span>
          </div>

          {isOccupied && (
            <div className="mt-3 pt-3 border-t border-blue-200/60 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-medium">
                  <Clock size={14} className="text-blue-700 animate-pulse" /> Tiempo transcurrido:
                </span>
                <span className="font-bold font-mono text-sm text-blue-950">
                  {elapsedMinutes !== null ? `${elapsedMinutes} minutos` : 'Recién iniciada'}
                </span>
              </div>

              {activeSession && (
                <>
                  <div className="flex items-center justify-between text-[11px] text-blue-800">
                    <span>Fin estimado:</span>
                    <span className="font-mono font-semibold">
                      {new Date(activeSession.estimatedEndAt).toLocaleTimeString('es-AR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}{' '}
                      ({activeSession.expectedDurationMinutes}m)
                    </span>
                  </div>
                  {activeSession.guestsCount !== null && (
                    <div className="flex items-center justify-between text-[11px] text-blue-800">
                      <span>Comensales declarados:</span>
                      <span className="font-semibold">{activeSession.guestsCount} pax</span>
                    </div>
                  )}
                  <div className="pt-2 flex items-center gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onExtendSession(activeSession.id, 15)}
                      className="flex-1 py-1.5 px-2 rounded bg-white border border-blue-300 text-blue-800 font-semibold text-[11px] hover:bg-blue-100 flex items-center justify-center gap-1"
                    >
                      <Timer size={12} /> +15 min
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onExtendSession(activeSession.id, 30)}
                      className="flex-1 py-1.5 px-2 rounded bg-white border border-blue-300 text-blue-800 font-semibold text-[11px] hover:bg-blue-100 flex items-center justify-center gap-1"
                    >
                      <Timer size={12} /> +30 min
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {isOutOfService && (
            <p className="mt-2 text-xs text-red-700 leading-relaxed">
              Esta mesa requiere reactivación autorizada antes de poder asignarle reservas o comensales.
            </p>
          )}
        </div>

        {/* Context-Aware Explicit Session & Lifecycle Actions */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-[#68766f] uppercase tracking-wider block">
            Operaciones de Servicio y Sesión
          </label>

          <div className="grid grid-cols-2 gap-2">
            {isAvailable && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onOpenWalkIn(table)}
                className="p-2.5 rounded-lg bg-[#1f5a49] text-white font-semibold text-xs flex items-center justify-center gap-1.5 hover:bg-[#174639] transition-colors"
              >
                <Users size={14} /> Abrir Walk-in
              </button>
            )}

            {!isOccupied && !isOutOfService && confirmedReservation && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onSeatReservation(confirmedReservation)}
                className="p-2.5 rounded-lg bg-blue-700 text-white font-semibold text-xs flex items-center justify-center gap-1.5 hover:bg-blue-800 transition-colors col-span-2"
              >
                <Users size={14} /> Sentar Reserva ({confirmedReservation.customerName})
              </button>
            )}

            {isOccupied && isReservationSession && seatedReservation && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onCompleteService(seatedReservation)}
                className="p-2.5 rounded-lg bg-emerald-600 text-white font-semibold text-xs flex items-center justify-center gap-1.5 hover:bg-emerald-700 transition-colors col-span-2"
              >
                <CheckCircle size={14} /> Finalizar Servicio (Cerrar Reserva)
              </button>
            )}

            {isOccupied && isWalkInSession && activeSession && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onCloseWalkIn(table, activeSession.id)}
                className="p-2.5 rounded-lg bg-emerald-600 text-white font-semibold text-xs flex items-center justify-center gap-1.5 hover:bg-emerald-700 transition-colors col-span-2"
              >
                <CheckCircle size={14} /> Cerrar Sesión Walk-in
              </button>
            )}

            {isOccupied && !isReservationSession && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onOpenOperationalReleaseModal(table)}
                className="p-2 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 font-semibold text-xs flex items-center justify-center gap-1.5 hover:bg-amber-100 transition-colors col-span-2"
              >
                <ShieldAlert size={13} /> Liberación Operativa Auditada
              </button>
            )}

            <button
              type="button"
              disabled={busy || isOutOfService}
              onClick={() => onOpenReservationModal([table], table.capacity)}
              className="p-2.5 rounded-lg bg-white border border-[#dce4dd] text-[#1b2925] font-semibold text-xs flex items-center justify-center gap-1.5 hover:bg-[#f4f6f4] transition-colors"
            >
              <PlusCircle size={14} className="text-[#1f5a49]" /> Nueva Reserva
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={() => onOpenCapacityModal(table)}
              className="p-2.5 rounded-lg bg-white border border-[#dce4dd] text-[#1b2925] font-semibold text-xs flex items-center justify-center gap-1.5 hover:bg-[#f4f6f4] transition-colors"
            >
              <Edit2 size={13} className="text-[#68766f]" /> Capacidad
            </button>
          </div>
        </div>

        {/* Maintenance / Deactivation Section */}
        <div className="pt-4 border-t border-[#eef2ee]">
          {isOutOfService ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onReactivate(table)}
              className="w-full py-2.5 px-3 rounded-lg bg-[#1f5a49] text-white text-xs font-semibold flex items-center justify-center gap-2 hover:bg-[#174639] transition-colors"
            >
              <CheckCircle size={15} /> Reactivar Mesa para Operación
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => onOpenDeactivateModal(table)}
              className="w-full py-2 px-3 rounded-lg bg-[#fff5f5] border border-red-200 text-red-700 text-xs font-semibold flex items-center justify-center gap-1.5 hover:bg-red-100 transition-colors"
            >
              <Power size={13} /> Desactivar / Mantenimiento (Con Auditoría)
            </button>
          )}
        </div>

        {/* Reservations Agenda for this Table */}
        <div className="pt-4 border-t border-[#eef2ee] space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#68766f] uppercase tracking-wider flex items-center gap-1">
              <Calendar size={13} /> Agenda de Esta Mesa ({tableReservations.length})
            </span>
          </div>

          {tableReservations.length === 0 ? (
            <p className="text-xs text-[#68766f] italic p-3 bg-[#fbfcfb] rounded-lg border border-[#eef2ee]">
              Sin reservas asociadas para esta mesa.
            </p>
          ) : (
            <div className="space-y-2">
              {tableReservations.map((res) => {
                const isInactive =
                  res.status === 'cancelled' || res.status === 'completed' || res.status === 'no_show'
                return (
                  <div
                    key={res.id}
                    className={`p-3 rounded-lg border text-xs flex flex-col justify-between ${
                      isInactive
                        ? 'bg-gray-50 border-gray-200 opacity-65'
                        : 'bg-white border-[#dce4dd]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <strong className="text-[#1b2925]">{res.customerName}</strong>
                      <span className="text-[11px] font-mono text-[#1f5a49] font-bold">
                        {res.time}
                      </span>
                    </div>

                    {res.tableIds && res.tableIds.length > 1 && (
                      <div className="mt-1">
                        <span
                          className={`inline-block text-[10px] font-extrabold px-1.5 py-0.5 rounded ${
                            res.tableIds.length === 2
                              ? 'bg-purple-100 text-purple-900 border border-purple-300'
                              : res.tableIds.length === 3
                                ? 'bg-orange-100 text-orange-900 border border-orange-300'
                                : 'bg-pink-100 text-pink-900 border border-pink-300'
                          }`}
                        >
                          Unión de {res.tableIds.length} Mesas: #{res.tableNumbers ? res.tableNumbers.join(' + #') : res.tableNumber}
                        </span>
                      </div>
                    )}

                    <div className="flex items-center gap-2 text-[#68766f] mt-1 text-[11px]">
                      <span>{res.guestsCount} personas</span>
                      <span>·</span>
                      <span className="uppercase font-bold text-[10px]">{res.status}</span>
                    </div>

                    {(res.status === 'confirmed' || res.status === 'seated') && (
                      <div className="mt-2 pt-2 border-t border-[#f4f6f4] flex flex-wrap items-center justify-end gap-2">
                        {res.status === 'confirmed' && (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => onSeatReservation(res)}
                              className="text-[11px] font-semibold text-blue-700 hover:text-blue-900"
                            >
                              Sentar
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => onOpenReassignModal(res)}
                              className="text-[11px] font-semibold text-[#1f5a49] hover:underline flex items-center gap-0.5"
                            >
                              <ArrowLeftRight size={11} /> Reasignar
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => onNoShowReservation(res)}
                              className="text-[11px] font-semibold text-amber-700 hover:text-amber-900 flex items-center gap-0.5"
                            >
                              <UserX size={11} /> No-Show
                            </button>
                          </>
                        )}
                        {res.status === 'seated' && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => onCompleteService(res)}
                            className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-900"
                          >
                            Finalizar Servicio
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => onCancelReservation(res)}
                          className="text-[11px] font-semibold text-red-700 hover:text-red-900"
                        >
                          Cancelar...
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="p-4 border-t border-[#eef2ee] bg-[#f9faf8] space-y-2">
        {isSuperAdmin && onDeleteTable && (
          <div>
            {hasHistory ? (
              <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-xs">
                <div className="flex items-center gap-1.5 font-bold mb-0.5">
                  <AlertTriangle size={13} className="text-amber-700 shrink-0" />
                  <span>Mesa con historial operativo</span>
                </div>
                <p className="text-[11px] text-amber-800">
                  Solo pueden eliminarse mesas vírgenes sin reservas ni sesiones previas. Use desactivación para conservar la trazabilidad.
                </p>
              </div>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => onDeleteTable(table)}
                className="w-full py-2.5 px-3 rounded-lg border border-red-300 bg-red-50/50 text-red-700 hover:bg-red-100 text-xs font-bold flex items-center justify-center gap-2 transition-colors shadow-2xs"
              >
                <Trash2 size={14} className="text-red-700" /> Eliminar Mesa {table.number} del Plano
              </button>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={onClose}
          className="w-full py-2 px-4 rounded-lg bg-white border border-[#dce4dd] text-[#1b2925] font-semibold text-xs hover:bg-[#f4f6f4]"
        >
          Cerrar
        </button>
      </div>
    </div>
  )
}
