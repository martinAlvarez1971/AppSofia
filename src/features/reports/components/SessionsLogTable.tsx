import { useMemo, useState } from 'react';
import { AlertTriangle, Search } from 'lucide-react';
import type { ReportSessionRow } from '../reports.types';
import {
  formatDateTimeBa,
  formatDurationMinutes,
  translateCloseReason,
  translateShift,
} from '../reports.utils';

interface SessionsLogTableProps {
  sessions: ReportSessionRow[];
}

export function SessionsLogTable({ sessions }: SessionsLogTableProps) {
  const [typeFilter, setTypeFilter] = useState<'all' | 'reservation' | 'walk_in'>('all');
  const [stateFilter, setStateFilter] = useState<'all' | 'open' | 'closed' | 'overrun'>('all');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sessions.filter((s) => {
      if (typeFilter !== 'all' && s.sessionType !== typeFilter) return false;
      if (stateFilter === 'open' && s.endedAt !== null) return false;
      if (stateFilter === 'closed' && s.endedAt === null) return false;
      if (stateFilter === 'overrun' && !s.isOverrun) return false;
      if (q) {
        const matchCustomer = s.customerName?.toLowerCase().includes(q);
        const matchSector = s.sector.toLowerCase().includes(q);
        const matchTable = `mesa ${s.tableNumber}`.includes(q) || String(s.tableNumber) === q;
        const matchNotes = s.notes?.toLowerCase().includes(q);
        if (!matchCustomer && !matchSector && !matchTable && !matchNotes) return false;
      }
      return true;
    });
  }, [sessions, typeFilter, stateFilter, query]);

  return (
    <section className="bg-white border border-[#dce4dd] rounded-lg overflow-hidden">
      <div className="px-5 py-3.5 border-b border-[#dce4dd] bg-[#f8faf8] flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-[#1b2925] font-['Manrope']">
            Registro de Sesiones de Mesa y Walk-ins
          </h3>
          <p className="text-xs text-[#68766f]">
            Trazabilidad real de ocupación física (reservas sentadas y walk-ins) con duración esperada vs. real
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#68766f]" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Mesa, cliente, nota..."
              className="pl-8 pr-3 py-1.5 text-xs bg-white border border-[#dce4dd] rounded text-[#1b2925] outline-hidden focus:border-[#1f5a49] w-44"
            />
          </div>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as 'all' | 'reservation' | 'walk_in')}
            className="py-1.5 px-2.5 text-xs bg-white border border-[#dce4dd] rounded text-[#1b2925] outline-hidden focus:border-[#1f5a49] cursor-pointer"
          >
            <option value="all">Todos los tipos</option>
            <option value="reservation">Reserva sentada</option>
            <option value="walk_in">Walk-in</option>
          </select>

          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value as 'all' | 'open' | 'closed' | 'overrun')}
            className="py-1.5 px-2.5 text-xs bg-white border border-[#dce4dd] rounded text-[#1b2925] outline-hidden focus:border-[#1f5a49] cursor-pointer"
          >
            <option value="all">Cualquier estado</option>
            <option value="open">Abiertas ahora</option>
            <option value="closed">Cerradas</option>
            <option value="overrun">Con exceso de tiempo</option>
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="py-12 text-center text-xs text-[#68766f]">
          No se encontraron sesiones físicas que coincidan con los filtros actuales.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#dce4dd] bg-[#f8faf8] text-[#68766f] uppercase tracking-wider text-[10px] font-bold">
                <th className="h-10 px-4 text-left">Fecha / Inicio</th>
                <th className="h-10 px-4 text-left">Mesa y Sector</th>
                <th className="h-10 px-4 text-left">Origen / Cliente</th>
                <th className="h-10 px-4 text-right">Comensales</th>
                <th className="h-10 px-4 text-right">Estimada</th>
                <th className="h-10 px-4 text-right">Real</th>
                <th className="h-10 px-4 text-left">Cierre / Estado</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr
                  key={s.id}
                  className="h-11 border-b border-[#edf1ee] last:border-b-0 hover:bg-[#f8faf8] transition-colors"
                >
                  <td className="px-4 whitespace-nowrap">
                    <div className="font-mono tabular-nums font-semibold text-[#1b2925]">
                      {s.operationalDate} · {s.localStartTime}
                    </div>
                    <div className="text-[11px] text-[#68766f]">{translateShift(s.shift)}</div>
                  </td>

                  <td className="px-4 whitespace-nowrap">
                    <div className="font-mono font-bold text-[#1b2925]">Mesa {s.tableNumber}</div>
                    <div className="text-[11px] text-[#68766f]">{s.sector}</div>
                  </td>

                  <td className="px-4">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex px-1.5 py-0.5 rounded border text-[10px] font-bold uppercase tracking-wide ${
                          s.sessionType === 'walk_in'
                            ? 'bg-[#fbf1e3] text-[#9a6128] border-[#ecd5b3]'
                            : 'bg-[#e8f1eb] text-[#174639] border-[#c8e1d0]'
                        }`}
                      >
                        {s.sessionType === 'walk_in' ? 'Walk-in' : 'Reserva'}
                      </span>
                      <span className="font-semibold text-[#1b2925] truncate max-w-[200px]">
                        {s.customerName || s.notes || 'Atención directa en salón'}
                      </span>
                    </div>
                  </td>

                  <td className="px-4 text-right font-mono tabular-nums font-semibold text-[#1b2925]">
                    {s.guestsCount ?? '—'}
                  </td>

                  <td className="px-4 text-right font-mono tabular-nums text-[#4f5e55]">
                    {formatDurationMinutes(s.expectedDurationMinutes)}
                  </td>

                  <td className="px-4 text-right font-mono tabular-nums whitespace-nowrap">
                    <span className={s.isOverrun ? 'font-bold text-[#dc2626]' : 'font-semibold text-[#1b2925]'}>
                      {s.endedAt ? formatDurationMinutes(s.actualDurationMinutes) : 'Activa'}
                    </span>
                    {s.isOverrun && (
                      <span
                        className="inline-flex items-center gap-0.5 ml-1.5 text-[10px] font-semibold text-[#dc2626]"
                        title="Superó la duración estimada"
                      >
                        <AlertTriangle size={11} />
                        Excedida
                      </span>
                    )}
                  </td>

                  <td className="px-4 whitespace-nowrap">
                    <div className="text-[#1b2925] font-medium">
                      {translateCloseReason(s.closeReason)}
                    </div>
                    <div className="text-[11px] font-mono tabular-nums text-[#68766f]">
                      {s.endedAt ? `Fin: ${formatDateTimeBa(s.endedAt)}` : `Est.: ${formatDateTimeBa(s.estimatedEndAt)}`}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
