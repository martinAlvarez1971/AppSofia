import { useMemo } from 'react'
import {
  Armchair,
  Clock,
  Sparkles,
  Users,
  Wrench,
  Wine,
  Trees,
  DoorOpen,
  Sun,
  Link2,
} from 'lucide-react'
import type { Table, Reservation } from '../tables.types'

interface SmartFloorPlanProps {
  tables: Table[]
  reservations?: Reservation[]
  selectedTableIds: string[]
  activeSector: string
  onSelectTable: (table: Table) => void
  onOpenWalkIn: (table: Table) => void
  onSeatReservation: (reservation: Reservation) => void
  onCloseWalkIn: (table: Table, sessionId: string) => void
  onCompleteService: (reservation: Reservation) => void
}

export function SmartFloorPlan({
  tables,
  reservations = [],
  selectedTableIds,
  activeSector,
  onSelectTable,
  onOpenWalkIn,
  onSeatReservation,
  onCloseWalkIn,
  onCompleteService,
}: SmartFloorPlanProps) {
  const filteredTables = useMemo(() => {
    if (!activeSector || activeSector === 'all') return tables
    return tables.filter((t) => t.sector === activeSector)
  }, [tables, activeSector])

  const sectors = useMemo(() => {
    const map = new Map<string, Table[]>()
    filteredTables.forEach((t) => {
      const list = map.get(t.sector) || []
      list.push(t)
      map.set(t.sector, list)
    })
    return Array.from(map.entries())
  }, [filteredTables])

  function getElapsedMinutes(occupiedSince?: string | null): number | null {
    if (!occupiedSince) return null
    const diff = Date.now() - new Date(occupiedSince).getTime()
    return Math.max(0, Math.floor(diff / 60000))
  }

  function getRemainingMinutes(estimatedEndAt?: string | null): number | null {
    if (!estimatedEndAt) return null
    const diff = new Date(estimatedEndAt).getTime() - Date.now()
    return Math.round(diff / 60000)
  }

  function renderSeats(
    capacity: number,
    shape: 'round' | 'square' | 'rectangle' = 'square',
    chairTheme: 'default' | 'reserved-single' | 'reserved-2' | 'reserved-3' | 'occupied' = 'default'
  ) {
    const seats = []
    const total = Math.min(12, capacity)

    let chairBg = 'bg-[#9cb0a3] border-white'
    if (chairTheme === 'reserved-single') {
      chairBg = 'bg-[#fee2e2] border-[#991b1b]'
    } else if (chairTheme === 'reserved-2') {
      chairBg = 'bg-[#ede9fe] border-[#5b21b6]'
    } else if (chairTheme === 'reserved-3') {
      chairBg = 'bg-[#ffedd5] border-[#9a3412]'
    } else if (chairTheme === 'occupied') {
      chairBg = 'bg-[#dbeafe] border-[#1e40af]'
    }

    for (let i = 0; i < total; i++) {
      let positionClass = ''
      if (shape === 'round') {
        const angle = (i / total) * 2 * Math.PI
        const radius = 35
        const x = Math.round(Math.cos(angle) * radius)
        const y = Math.round(Math.sin(angle) * radius)
        seats.push(
          <div
            key={i}
            className={`absolute w-2.5 h-2.5 rounded-full border shadow-2xs pointer-events-none transition-colors ${chairBg}`}
            style={{
              left: `calc(50% + ${x}px - 5px)`,
              top: `calc(50% + ${y}px - 5px)`,
            }}
          />
        )
        continue
      }

      if (i < 2) positionClass = '-top-2 left-1/4 -translate-x-1/2'
      else if (i < 4) positionClass = '-bottom-2 left-1/4 -translate-x-1/2'
      else if (i < 6) positionClass = '-top-2 left-3/4 -translate-x-1/2'
      else if (i < 8) positionClass = '-bottom-2 left-3/4 -translate-x-1/2'
      else if (i % 2 === 0) positionClass = '-left-2 top-1/2 -translate-y-1/2'
      else positionClass = '-right-2 top-1/2 -translate-y-1/2'

      seats.push(
        <div
          key={i}
          className={`absolute w-3 h-2 rounded-xs border shadow-2xs pointer-events-none transition-colors ${chairBg} ${positionClass}`}
        />
      )
    }

    return seats
  }

  return (
    <div className="bg-[#f9faf8] border border-[#dce4dd] rounded-xl p-5 shadow-xs overflow-hidden">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-[#eef2ee]">
        <div>
          <span className="text-[10px] font-bold tracking-widest text-[#1f5a49] uppercase">
            Plano Dinámico en Vivo · SOFIA
          </span>
          <h3 className="text-base font-bold text-[#1b2925]">
            Distribución Visual del Salón & Estado de Mesas
          </h3>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-md border border-[#e2e8e3]">
            <span className="w-3 h-3 rounded-sm bg-[#e8f1eb] border-2 border-[#1f5a49]" />
            <span className="text-[#1f5a49] font-semibold text-[11px]">Disponible</span>
          </div>

          <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-md border border-red-200">
            <span className="w-3 h-3 rounded-sm bg-[#dc2626] border border-[#991b1b]" />
            <span className="text-[#991b1b] font-bold text-[11px]">Reservada</span>
          </div>

          <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-md border border-purple-200">
            <span
              className="w-3.5 h-3 rounded-sm border border-purple-600 shadow-2xs"
              style={{ background: 'linear-gradient(135deg, #7c3aed 50%, #dc2626 50%)' }}
            />
            <span className="text-[#6d28d9] font-bold text-[11px]">Unión 2 Mesas</span>
          </div>

          <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-md border border-orange-200">
            <span
              className="w-3.5 h-3 rounded-sm border border-orange-600 shadow-2xs"
              style={{ background: 'linear-gradient(135deg, #ea580c 50%, #dc2626 50%)' }}
            />
            <span className="text-[#c2410c] font-bold text-[11px]">Unión 3 Mesas</span>
          </div>

          <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-md border border-blue-200">
            <span className="w-3 h-3 rounded-sm bg-[#eff6ff] border-2 border-[#2563eb]" />
            <span className="text-[#1e40af] font-medium text-[11px]">Ocupada (Sesión)</span>
          </div>

          <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-md border border-gray-200">
            <span className="w-3 h-3 rounded-sm bg-[#f1f3f1] border-2 border-[#94a3b8]" />
            <span className="text-[#475569] font-medium text-[11px]">Mantenimiento</span>
          </div>
        </div>
      </div>

      {sectors.length === 0 ? (
        <div className="mt-5 p-12 text-center bg-[#f9faf8] border-2 border-dashed border-[#dce4dd] rounded-2xl">
          <Armchair className="mx-auto text-[#68766f] mb-3 opacity-40" size={40} />
          <h3 className="text-base font-bold text-[#1b2925]">Plano de Mesas Pendiente de Carga</h3>
          <p className="text-xs text-[#68766f] max-w-md mx-auto mt-1">
            Configure las mesas iniciales desde <strong>"Cargar Mesas / Plano"</strong> para comenzar la operación del salón.
          </p>
        </div>
      ) : (
        <div className="mt-5 space-y-8">
          {sectors.map(([sectorName, sectorTables]) => {
            const sLower = sectorName.toLowerCase()
            const isTerrace = sLower.includes('terraza')
            const isExterior = sLower.includes('afuera') || sLower.includes('exterior')
            const isSmallRoom = sLower.includes('chico') || sLower.includes('privado')
            const isBar = sLower.includes('barra') || sLower.includes('sommelier')

            return (
              <div
                key={sectorName}
                className={`p-5 rounded-xl border relative ${
                  isTerrace
                    ? 'bg-gradient-to-br from-[#f2f8f4] to-[#eaf3ed] border-[#c7dccb]'
                    : isExterior
                      ? 'bg-gradient-to-br from-[#fefbf3] to-[#f9f5eb] border-[#ebdcc4]'
                      : isSmallRoom
                        ? 'bg-gradient-to-br from-[#f8f6fc] to-[#f2eef8] border-[#dfd6ed]'
                        : isBar
                          ? 'bg-gradient-to-br from-[#f8f6f0] to-[#f4f0e6] border-[#dfd6c4]'
                          : 'bg-white border-[#dce4dd]'
                }`}
              >
                <div className="flex items-center justify-between pb-3 mb-5 border-b border-black/5">
                  <div className="flex items-center gap-2">
                    {isTerrace ? (
                      <Trees size={16} className="text-[#2d6a4f]" />
                    ) : isExterior ? (
                      <Sun size={16} className="text-[#b45309]" />
                    ) : isSmallRoom ? (
                      <Sparkles size={16} className="text-[#6d28d9]" />
                    ) : isBar ? (
                      <Wine size={16} className="text-[#b45309]" />
                    ) : (
                      <DoorOpen size={16} className="text-[#1f5a49]" />
                    )}
                    <h4 className="font-bold text-sm text-[#1b2925]">{sectorName}</h4>
                    <span className="text-xs text-[#68766f]">
                      · {sectorTables.length} mesas ({sectorTables.reduce((a, b) => a + b.capacity, 0)} plazas)
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-[11px] font-mono">
                    <span className="text-[#1f5a49] font-bold">
                      {sectorTables.filter((t) => t.status === 'available').length} libres
                    </span>
                    <span className="text-[#dc2626] font-bold">
                      {sectorTables.filter((t) => t.status === 'reserved').length} reservadas
                    </span>
                    <span className="text-[#2563eb] font-semibold">
                      {sectorTables.filter((t) => t.status === 'occupied').length} en servicio
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
                  {sectorTables.map((table) => {
                    const isSelected = selectedTableIds.includes(table.id)
                    const isOccupied = table.status === 'occupied'
                    const isOutOfService = table.status === 'out_of_service'
                    const shape =
                      table.shape ||
                      (table.capacity >= 6 ? 'rectangle' : table.capacity === 2 ? 'round' : 'square')
                    const elapsedMin = getElapsedMinutes(table.activeSession?.startedAt || table.occupiedSince)
                    const remainingMin = getRemainingMinutes(table.activeSession?.estimatedEndAt)

                    const confirmedReservation = reservations.find(
                      (r) =>
                        r.status === 'confirmed' &&
                        (r.tableId === table.id || (r.tableIds && r.tableIds.includes(table.id)))
                    )
                    const seatedReservation = reservations.find(
                      (r) =>
                        r.status === 'seated' &&
                        (r.id === table.activeSession?.reservationId ||
                          r.tableId === table.id ||
                          (r.tableIds && r.tableIds.includes(table.id)))
                    )

                    const isReserved = !isOccupied && (table.status === 'reserved' || Boolean(confirmedReservation))

                    let linkedCount = 1
                    let linkedNumbers: number[] = [table.number]

                    if (confirmedReservation && !isOccupied) {
                      if (confirmedReservation.tableIds && confirmedReservation.tableIds.length > 0) {
                        linkedCount = confirmedReservation.tableIds.length
                        const nums = confirmedReservation.tableIds
                          .map((tid) => tables.find((t) => t.id === tid)?.number)
                          .filter((n): n is number => n !== undefined)
                        if (nums.length > 0) {
                          linkedNumbers = Array.from(new Set(nums)).sort((a, b) => a - b)
                        }
                      } else if (confirmedReservation.tableNumbers && confirmedReservation.tableNumbers.length > 0) {
                        linkedNumbers = confirmedReservation.tableNumbers
                        linkedCount = linkedNumbers.length
                      }
                    }

                    let chairTheme: 'default' | 'reserved-single' | 'reserved-2' | 'reserved-3' | 'occupied' = 'default'
                    if (isOccupied) {
                      chairTheme = 'occupied'
                    } else if (isReserved) {
                      if (linkedCount === 2) chairTheme = 'reserved-2'
                      else if (linkedCount === 3) chairTheme = 'reserved-3'
                      else chairTheme = 'reserved-single'
                    }

                    let tableClasses = 'bg-[#f4f8f5] border-[#1f5a49] text-[#174639]'
                    let tableInlineStyle: React.CSSProperties = {
                      minHeight: shape === 'rectangle' ? 120 : 110,
                      borderRadius: shape === 'round' ? '9999px' : '14px',
                    }

                    if (isOccupied) {
                      tableClasses = 'bg-[#eff6ff] border-[#2563eb] text-[#1e3a8a]'
                    } else if (isReserved) {
                      if (linkedCount === 2) {
                        tableClasses = 'border-2 border-[#c084fc] text-white shadow-md ring-2 ring-purple-600/30'
                        tableInlineStyle = {
                          ...tableInlineStyle,
                          background:
                            'linear-gradient(135deg, #7c3aed 0%, #6d28d9 48%, #dc2626 52%, #b91c1c 100%)',
                        }
                      } else if (linkedCount === 3) {
                        tableClasses = 'border-2 border-[#fdba74] text-white shadow-md ring-2 ring-orange-500/30'
                        tableInlineStyle = {
                          ...tableInlineStyle,
                          background:
                            'linear-gradient(135deg, #ea580c 0%, #c2410c 48%, #dc2626 52%, #b91c1c 100%)',
                        }
                      } else if (linkedCount >= 4) {
                        tableClasses = 'border-2 border-pink-400 text-white shadow-md ring-2 ring-pink-500/30'
                        tableInlineStyle = {
                          ...tableInlineStyle,
                          background:
                            'linear-gradient(135deg, #db2777 0%, #be185d 48%, #dc2626 52%, #b91c1c 100%)',
                        }
                      } else {
                        tableClasses = 'border-2 border-[#991b1b] text-white shadow-md ring-1 ring-red-400/40'
                        tableInlineStyle = {
                          ...tableInlineStyle,
                          background: 'linear-gradient(145deg, #ef4444 0%, #dc2626 50%, #b91c1c 100%)',
                        }
                      }
                    } else if (isOutOfService) {
                      tableClasses = 'bg-[#f1f3f1] border-[#94a3b8] text-[#475569] opacity-70'
                    }

                    const isReservationSession = table.activeSession?.sessionType === 'reservation'

                    return (
                      <div
                        key={table.id}
                        onClick={() => onSelectTable(table)}
                        className={`relative group cursor-pointer transition-all duration-200 select-none flex flex-col items-center justify-center p-2.5 rounded-xl border-2 ${tableClasses} ${
                          isSelected
                            ? 'ring-4 ring-[#1f5a49]/40 scale-105 shadow-lg z-10'
                            : 'hover:shadow-md hover:scale-102'
                        }`}
                        style={tableInlineStyle}
                      >
                        {renderSeats(table.capacity, shape, chairTheme)}

                        <div className="flex items-center justify-center w-full z-10 mb-1">
                          {isOccupied ? (
                            <span
                              className={`flex items-center gap-1 px-2 py-0.5 rounded shadow-2xs font-mono font-bold text-[10px] ${
                                remainingMin !== null && remainingMin < 0
                                  ? 'bg-amber-100 text-amber-900 border border-amber-300'
                                  : 'bg-white/95 text-[#2563eb]'
                              }`}
                            >
                              <Clock size={11} className="animate-pulse" />
                              {elapsedMin !== null ? `${elapsedMin}m` : 'En uso'}
                              {table.activeSession
                                ? ` · ${isReservationSession ? 'Res.' : 'Walk-in'}`
                                : ''}
                            </span>
                          ) : isReserved ? (
                            linkedCount === 2 ? (
                              <div className="bg-[#2e1065] text-[#f3e8ff] px-2 py-0.5 rounded shadow-2xs font-black text-[9px] tracking-wider uppercase border border-[#a855f7] flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#c084fc] animate-ping" />
                                RESERVADA
                              </div>
                            ) : linkedCount === 3 ? (
                              <div className="bg-[#431407] text-[#ffedd5] px-2 py-0.5 rounded shadow-2xs font-black text-[9px] tracking-wider uppercase border border-[#fb923c] flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#fdba74] animate-ping" />
                                RESERVADA
                              </div>
                            ) : linkedCount >= 4 ? (
                              <div className="bg-[#500724] text-pink-100 px-2 py-0.5 rounded shadow-2xs font-black text-[9px] tracking-wider uppercase border border-pink-400">
                                RESERVADA
                              </div>
                            ) : (
                              <div className="bg-white text-[#dc2626] px-2 py-0.5 rounded shadow-2xs font-black text-[10px] tracking-widest uppercase border border-red-200 flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#dc2626]" />
                                RESERVADA
                              </div>
                            )
                          ) : isOutOfService ? (
                            <span className="flex items-center gap-1 text-[#64748b] bg-white/95 px-1.5 py-0.5 rounded shadow-2xs text-[10px] font-medium">
                              <Wrench size={11} /> Mantenimiento
                            </span>
                          ) : (
                            <span className="text-[#1f5a49] bg-white/90 px-2 py-0.5 rounded text-[10px] font-sans font-bold shadow-2xs">
                              Disponible
                            </span>
                          )}
                        </div>

                        <div className="my-0.5 text-center z-10 w-full px-1">
                          {isReserved && linkedCount === 2 ? (
                            <div>
                              <div className="flex items-center justify-center gap-1 text-[9px] uppercase tracking-wider font-extrabold text-purple-200">
                                <Link2 size={10} /> 2 Mesas Unidas
                              </div>
                              <span className="block text-sm sm:text-base font-black font-mono leading-tight text-white drop-shadow-sm">
                                Mesas #{linkedNumbers.join(' y #')}
                              </span>
                              <span className="text-[10px] font-bold text-purple-200 block">
                                (Esta: Mesa {table.number})
                              </span>
                            </div>
                          ) : isReserved && linkedCount === 3 ? (
                            <div>
                              <div className="flex items-center justify-center gap-1 text-[9px] uppercase tracking-wider font-extrabold text-orange-200">
                                <Link2 size={10} /> 3 Mesas Unidas
                              </div>
                              <span className="block text-xs sm:text-sm font-black font-mono leading-tight text-white drop-shadow-sm">
                                Mesas #{linkedNumbers.join(', #')}
                              </span>
                              <span className="text-[10px] font-bold text-orange-200 block">
                                (Esta: Mesa {table.number})
                              </span>
                            </div>
                          ) : isReserved && linkedCount >= 4 ? (
                            <div>
                              <div className="text-[9px] uppercase tracking-wider font-extrabold text-pink-200">
                                {linkedCount} Mesas Unidas
                              </div>
                              <span className="block text-xs font-black font-mono leading-tight text-white drop-shadow-sm">
                                Mesas #{linkedNumbers.join(', #')}
                              </span>
                              <span className="text-[10px] font-bold text-pink-200 block">
                                (Esta: Mesa {table.number})
                              </span>
                            </div>
                          ) : (
                            <div>
                              <span
                                className={`block text-2xl font-black font-mono leading-none ${
                                  isReserved ? 'text-white drop-shadow-xs' : ''
                                }`}
                              >
                                {table.number}
                              </span>
                              <span
                                className={`text-[11px] font-medium flex items-center justify-center gap-0.5 mt-0.5 ${
                                  isReserved ? 'text-red-100 font-bold' : 'opacity-80'
                                }`}
                              >
                                <Users size={11} /> {table.capacity} pax
                              </span>
                            </div>
                          )}
                        </div>

                        <div className="z-10 mt-1 max-w-[95%]">
                          {isOccupied && seatedReservation ? (
                            <span className="text-[10px] text-[#1e3a8a] bg-white/90 px-1.5 py-0.5 rounded truncate block shadow-2xs">
                              {seatedReservation.customerName}
                            </span>
                          ) : isOccupied && table.serverName ? (
                            <span className="text-[10px] text-[#1e3a8a] bg-white/90 px-1.5 py-0.5 rounded truncate block shadow-2xs">
                              {table.serverName}
                            </span>
                          ) : isReserved && confirmedReservation ? (
                            <span
                              className="text-[9.5px] font-bold text-white bg-black/35 px-1.5 py-0.5 rounded truncate block shadow-2xs"
                              title={`${confirmedReservation.customerName} (${confirmedReservation.guestsCount} pax) - ${confirmedReservation.time}`}
                            >
                              {confirmedReservation.customerName} · {confirmedReservation.time}
                            </span>
                          ) : table.upcomingReservationsCount > 0 ? (
                            <span className="text-[10px] text-[#78350f] bg-white/90 px-1.5 py-0.5 rounded font-mono shadow-2xs">
                              {table.upcomingReservationsCount} res.
                            </span>
                          ) : null}
                        </div>

                        {/* Context-aware explicit lifecycle hover actions */}
                        <div className="absolute inset-x-2 -bottom-3 hidden group-hover:flex items-center justify-center gap-1 bg-[#1b2925] text-white p-1 rounded-md text-[10px] font-medium shadow-md z-20">
                          {isOccupied && isReservationSession && seatedReservation ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                onCompleteService(seatedReservation)
                              }}
                              className="hover:text-emerald-300 px-1 font-bold"
                            >
                              Finalizar
                            </button>
                          ) : isOccupied && table.activeSession?.sessionType === 'walk_in' ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                onCloseWalkIn(table, table.activeSession!.id)
                              }}
                              className="hover:text-emerald-300 px-1 font-bold"
                            >
                              Cerrar Walk-in
                            </button>
                          ) : isReserved && confirmedReservation ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                onSeatReservation(confirmedReservation)
                              }}
                              className="hover:text-blue-300 px-1 font-bold"
                            >
                              Sentar Res.
                            </button>
                          ) : !isOutOfService && !isOccupied ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                onOpenWalkIn(table)
                              }}
                              className="hover:text-blue-300 px-1"
                            >
                              Walk-in
                            </button>
                          ) : null}
                          <span>·</span>
                          <span className="text-[#b6d2c3]">Ver Ficha</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
