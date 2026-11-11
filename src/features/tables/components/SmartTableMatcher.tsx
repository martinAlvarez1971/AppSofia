import { useMemo, useState } from 'react'
import {
  Sparkles,
  Users,
  Check,
  Plus,
  ArrowRight,
  SplitSquareVertical,
  SlidersHorizontal,
} from 'lucide-react'
import type { Table, SmartRecommendation } from '../tables.types'

interface SmartTableMatcherProps {
  tables: Table[]
  selectedSector: string
  onSelectTables: (tables: Table[]) => void
  onOpenReservationModal: (tables: Table[], guestsCount: number) => void
}

export function SmartTableMatcher({
  tables,
  selectedSector,
  onSelectTables,
  onOpenReservationModal,
}: SmartTableMatcherProps) {
  const [partySize, setPartySize] = useState<number>(4)
  const [targetSector, setTargetSector] = useState<string>(selectedSector || 'all')
  const [preferSingle, setPreferSingle] = useState<boolean>(true)

  // Extract available sectors
  const sectors = useMemo(() => {
    const list = Array.from(new Set(tables.map((t) => t.sector)))
    return list
  }, [tables])

  // Run the smart matching algorithm
  const recommendations = useMemo<SmartRecommendation[]>(() => {
    const candidateTables = tables.filter((t) => {
      if (!t.isActive || t.status !== 'available') return false
      if (targetSector !== 'all' && t.sector !== targetSector) return false
      return true
    })

    const recs: SmartRecommendation[] = []

    // 1. Single Table Matches
    const singleMatches = candidateTables
      .filter((t) => t.capacity >= partySize)
      .map((t) => {
        const waste = t.capacity - partySize
        // Score: closer to 0 waste is best (100 - waste * 15)
        const score = Math.max(20, 100 - waste * 18)
        return {
          type: 'single' as const,
          tables: [t],
          totalCapacity: t.capacity,
          partySize,
          wasteSeats: waste,
          reason: waste === 0
            ? `Ajuste exacto: Mesa ${t.number} en ${t.sector} optimiza el 100% de la capacidad.`
            : `Mesa ${t.number} en ${t.sector} (${t.capacity} plazas, margen de ${waste} asiento${waste > 1 ? 's' : ''}).`,
          matchScore: score,
        }
      })
      .sort((a, b) => b.matchScore - a.matchScore)

    recs.push(...singleMatches.slice(0, 3))

    // 2. Multi-table combination / merging
    // If partySize > 4 or if single matches are scarce, check pairs of adjacent/same-sector tables
    if (candidateTables.length >= 2) {
      const pairMatches: SmartRecommendation[] = []

      for (let i = 0; i < candidateTables.length; i++) {
        for (let j = i + 1; j < candidateTables.length; j++) {
          const t1 = candidateTables[i]
          const t2 = candidateTables[j]

          // Only merge tables in the same sector
          if (t1.sector !== t2.sector) continue

          const combCapacity = t1.capacity + t2.capacity
          if (combCapacity >= partySize) {
            const waste = combCapacity - partySize
            // Bonus if table numbers are close (likely physically adjacent)
            const numberDistance = Math.abs(t1.number - t2.number)
            const adjacencyBonus = numberDistance <= 2 ? 15 : 0
            const score = Math.max(10, 95 - waste * 15 + adjacencyBonus)

            pairMatches.push({
              type: 'merge',
              tables: [t1, t2],
              totalCapacity: combCapacity,
              partySize,
              wasteSeats: waste,
              reason: `Unión Inteligente: Mesa ${t1.number} (${t1.capacity} pax) + Mesa ${t2.number} (${t2.capacity} pax) en ${t1.sector}. Capacidad combinada: ${combCapacity} pax.`,
              matchScore: score,
            })
          }
        }
      }

      pairMatches.sort((a, b) => b.matchScore - a.matchScore)
      if (pairMatches.length > 0) {
        recs.push(...pairMatches.slice(0, 2))
      }
    }

    return recs.sort((a, b) => {
      if (preferSingle) {
        if (a.type === 'single' && b.type === 'merge') return -1
        if (a.type === 'merge' && b.type === 'single') return 1
      }
      return b.matchScore - a.matchScore
    })
  }, [tables, partySize, targetSector, preferSingle])

  return (
    <div className="bg-white border border-[#dce4dd] rounded-xl p-5 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#eef2ee]">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[#e8f1eb] text-[#1f5a49] grid place-items-center">
            <Sparkles size={16} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[#1b2925] tracking-tight">
              Motor de Asignación y Combinación Inteligente
            </h3>
            <p className="text-xs text-[#68766f]">
              Calcula la mejor mesa o sugiere unión dinámica de mesas para optimizar la sala
            </p>
          </div>
        </div>

        {/* Party size quick control */}
        <div className="flex items-center gap-3 bg-[#f8faf8] border border-[#dce4dd] p-1.5 rounded-lg">
          <span className="text-xs font-semibold text-[#1b2925] px-2 flex items-center gap-1.5">
            <Users size={14} className="text-[#1f5a49]" /> Comensales:
          </span>
          <div className="flex items-center gap-1">
            {[2, 4, 6, 8, 10, 12].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setPartySize(n)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  partySize === n
                    ? 'bg-[#1f5a49] text-white shadow-xs'
                    : 'text-[#5a6961] hover:bg-[#e8f1eb] hover:text-[#174639]'
                }`}
              >
                {n}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 border-l border-[#dce4dd] pl-2 ml-1">
            <button
              type="button"
              onClick={() => setPartySize((p) => Math.max(1, p - 1))}
              className="w-6 h-6 rounded bg-white border border-[#dce4dd] text-[#1b2925] font-bold text-xs hover:bg-[#f4f6f4]"
              title="Disminuir comensales"
            >
              -
            </button>
            <span className="text-xs font-mono font-bold w-6 text-center text-[#1b2925]">{partySize}</span>
            <button
              type="button"
              onClick={() => setPartySize((p) => Math.min(30, p + 1))}
              className="w-6 h-6 rounded bg-white border border-[#dce4dd] text-[#1b2925] font-bold text-xs hover:bg-[#f4f6f4]"
              title="Aumentar comensales"
            >
              +
            </button>
          </div>
        </div>
      </div>

      {/* Sector filter & preferences bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-3 pb-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-[#68766f] font-medium flex items-center gap-1">
            <SlidersHorizontal size={13} /> Sector preferido:
          </span>
          <button
            type="button"
            onClick={() => setTargetSector('all')}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              targetSector === 'all'
                ? 'bg-[#1b2925] text-white'
                : 'bg-[#f4f6f3] text-[#5a6961] hover:bg-[#e8f1eb]'
            }`}
          >
            Todos los sectores
          </button>
          {sectors.map((sec) => (
            <button
              key={sec}
              type="button"
              onClick={() => setTargetSector(sec)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                targetSector === sec
                  ? 'bg-[#1b2925] text-white'
                  : 'bg-[#f4f6f3] text-[#5a6961] hover:bg-[#e8f1eb]'
              }`}
            >
              {sec}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 cursor-pointer select-none text-[#5a6961]">
          <input
            type="checkbox"
            checked={preferSingle}
            onChange={(e) => setPreferSingle(e.target.checked)}
            className="rounded border-[#dce4dd] text-[#1f5a49] focus:ring-[#1f5a49]"
          />
          Priorizar mesa individual antes de unir mesas
        </label>
      </div>

      {/* Results grid */}
      <div className="mt-3">
        {recommendations.length === 0 ? (
          <div className="p-6 text-center bg-[#fdfdfd] border border-dashed border-[#dce4dd] rounded-lg">
            <p className="text-sm font-medium text-[#1b2925]">
              No hay combinaciones de mesas disponibles para {partySize} personas en el sector seleccionado.
            </p>
            <p className="text-xs text-[#68766f] mt-1">
              Prueba cambiando a &ldquo;Todos los sectores&rdquo; o revisa las mesas que se liberan en la agenda.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {recommendations.map((rec, idx) => {
              const isSingle = rec.type === 'single'
              return (
                <div
                  key={idx}
                  className={`p-3.5 rounded-lg border transition-all flex flex-col justify-between ${
                    idx === 0
                      ? 'border-[#1f5a49] bg-[#f7faf8] shadow-xs'
                      : 'border-[#dce4dd] bg-white hover:border-[#9abdae]'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="flex items-center gap-1.5 font-bold text-[#1b2925]">
                        {isSingle ? (
                          <span className="text-[#1f5a49] flex items-center gap-1">
                            <Check size={14} /> Mesa {rec.tables[0].number}
                          </span>
                        ) : (
                          <span className="text-[#3b82f6] flex items-center gap-1">
                            <SplitSquareVertical size={14} /> Unión: Mesas{' '}
                            {rec.tables.map((t) => t.number).join(' + ')}
                          </span>
                        )}
                      </span>
                      <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded bg-white border border-[#dce4dd] text-[#1b2925]">
                        {rec.matchScore}% afinidad
                      </span>
                    </div>

                    <p className="text-xs text-[#405047] leading-relaxed mb-2.5">
                      {rec.reason}
                    </p>

                    <div className="flex items-center gap-2 text-[11px] text-[#68766f] mb-3">
                      <span>Capacidad: {rec.totalCapacity} personas</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {rec.wasteSeats === 0
                          ? 'Sin asientos ociosos'
                          : `${rec.wasteSeats} silla${rec.wasteSeats > 1 ? 's' : ''} libre${rec.wasteSeats > 1 ? 's' : ''}`}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-[#eef2ee]">
                    <button
                      type="button"
                      onClick={() => onSelectTables(rec.tables)}
                      className="px-2.5 py-1.5 text-xs font-semibold rounded bg-white border border-[#dce4dd] text-[#1b2925] hover:bg-[#f4f6f4] flex-1 text-center"
                    >
                      Ver en Plano
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenReservationModal(rec.tables, partySize)}
                      className="px-3 py-1.5 text-xs font-semibold rounded bg-[#1f5a49] text-white hover:bg-[#174639] flex items-center justify-center gap-1 flex-1 shadow-xs"
                    >
                      Reservar <ArrowRight size={13} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
