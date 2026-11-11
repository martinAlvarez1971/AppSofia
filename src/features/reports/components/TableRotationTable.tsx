import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { TableMetricItem } from '../reports.types';
import { formatDurationMinutes, translateTableStatus } from '../reports.utils';

interface TableRotationTableProps {
  tables: TableMetricItem[];
}

type SortKey = 'tableNumber' | 'capacity' | 'reservationsCount' | 'sessionsCount' | 'totalGuests' | 'avgDurationMinutes' | 'utilizationSharePct';

export function TableRotationTable({ tables }: TableRotationTableProps) {
  const [sortBy, setSortBy] = useState<SortKey>('sessionsCount');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const sorted = useMemo(() => {
    const factor = sortOrder === 'asc' ? 1 : -1;
    return [...tables].sort((a, b) => {
      const diff = (a[sortBy] as number) - (b[sortBy] as number);
      if (diff !== 0) return diff * factor;
      return a.tableNumber - b.tableNumber;
    });
  }, [tables, sortBy, sortOrder]);

  function handleSort(key: SortKey) {
    if (sortBy === key) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortOrder(key === 'tableNumber' ? 'asc' : 'desc');
    }
  }

  function renderSortIcon(key: SortKey) {
    if (sortBy !== key) return <ArrowUpDown size={12} className="text-[#87938c]" />;
    return sortOrder === 'asc' ? (
      <ArrowUp size={12} className="text-[#1f5a49]" />
    ) : (
      <ArrowDown size={12} className="text-[#1f5a49]" />
    );
  }

  const statusTagClass = (status: TableMetricItem['status']) => {
    switch (status) {
      case 'available':
        return 'bg-[#e7f3ea] text-[#174639] border-[#c8e1d0]';
      case 'occupied':
        return 'bg-[#fbf1e3] text-[#9a6128] border-[#ecd5b3]';
      case 'reserved':
        return 'bg-[#eef4fa] text-[#1e40af] border-[#cbdcf0]';
      case 'out_of_service':
        return 'bg-[#fff0ee] text-[#9c3d36] border-[#f2bcba]';
    }
  };

  return (
    <section className="bg-white border border-[#dce4dd] rounded-lg overflow-hidden">
      <div className="px-5 py-3.5 border-b border-[#dce4dd] bg-[#f8faf8] flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-[#1b2925] font-['Manrope']">
            Rendimiento y Rotación por Mesa
          </h3>
          <p className="text-xs text-[#68766f]">
            Participación en servicios, comensales atendidos y duración real de estadía
          </p>
        </div>
        <span className="text-xs font-mono tabular-nums text-[#4f5e55]">
          {tables.length} mesas en vista
        </span>
      </div>

      {sorted.length === 0 ? (
        <div className="py-12 text-center text-xs text-[#68766f]">
          No hay mesas registradas para el sector filtrado.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#dce4dd] bg-[#f8faf8] text-[#68766f] uppercase tracking-wider text-[10px] font-bold">
                <th
                  onClick={() => handleSort('tableNumber')}
                  className="h-10 px-4 text-left cursor-pointer hover:bg-[#eff3ef] select-none"
                >
                  <span className="inline-flex items-center gap-1">Mesa {renderSortIcon('tableNumber')}</span>
                </th>
                <th className="h-10 px-4 text-left">Sector</th>
                <th className="h-10 px-4 text-left">Estado Actual</th>
                <th
                  onClick={() => handleSort('capacity')}
                  className="h-10 px-4 text-right cursor-pointer hover:bg-[#eff3ef] select-none"
                >
                  <span className="inline-flex items-center justify-end gap-1">Capacidad {renderSortIcon('capacity')}</span>
                </th>
                <th
                  onClick={() => handleSort('reservationsCount')}
                  className="h-10 px-4 text-right cursor-pointer hover:bg-[#eff3ef] select-none"
                >
                  <span className="inline-flex items-center justify-end gap-1">Reservas {renderSortIcon('reservationsCount')}</span>
                </th>
                <th
                  onClick={() => handleSort('sessionsCount')}
                  className="h-10 px-4 text-right cursor-pointer hover:bg-[#eff3ef] select-none"
                >
                  <span className="inline-flex items-center justify-end gap-1">Sesiones (Walk-in) {renderSortIcon('sessionsCount')}</span>
                </th>
                <th
                  onClick={() => handleSort('totalGuests')}
                  className="h-10 px-4 text-right cursor-pointer hover:bg-[#eff3ef] select-none"
                >
                  <span className="inline-flex items-center justify-end gap-1">Comensales {renderSortIcon('totalGuests')}</span>
                </th>
                <th
                  onClick={() => handleSort('avgDurationMinutes')}
                  className="h-10 px-4 text-right cursor-pointer hover:bg-[#eff3ef] select-none"
                >
                  <span className="inline-flex items-center justify-end gap-1">Estadía Prom. {renderSortIcon('avgDurationMinutes')}</span>
                </th>
                <th
                  onClick={() => handleSort('utilizationSharePct')}
                  className="h-10 px-4 text-right cursor-pointer hover:bg-[#eff3ef] select-none min-w-[140px]"
                >
                  <span className="inline-flex items-center justify-end gap-1">Cuota Uso {renderSortIcon('utilizationSharePct')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((t) => (
                <tr
                  key={t.tableId}
                  className="h-10 border-b border-[#edf1ee] last:border-b-0 hover:bg-[#f8faf8] transition-colors"
                >
                  <td className="px-4 font-mono font-bold tabular-nums text-[#1b2925]">
                    Mesa {t.tableNumber}
                  </td>
                  <td className="px-4 text-[#4f5e55]">{t.sector}</td>
                  <td className="px-4">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-semibold ${statusTagClass(
                        t.status,
                      )}`}
                    >
                      {translateTableStatus(t.status)}
                    </span>
                  </td>
                  <td className="px-4 text-right font-mono tabular-nums text-[#4f5e55]">
                    {t.capacity}
                    {t.maxCapacity > t.capacity ? `–${t.maxCapacity}` : ''}
                  </td>
                  <td className="px-4 text-right font-mono tabular-nums font-semibold text-[#1b2925]">
                    {t.reservationsCount}
                  </td>
                  <td className="px-4 text-right font-mono tabular-nums text-[#1b2925]">
                    {t.sessionsCount}{' '}
                    <span className="text-[#68766f]">({t.walkInSessionsCount} w/i)</span>
                  </td>
                  <td className="px-4 text-right font-mono tabular-nums font-semibold text-[#1b2925]">
                    {t.totalGuests.toLocaleString('es-AR')}
                  </td>
                  <td className="px-4 text-right font-mono tabular-nums text-[#4f5e55]">
                    {t.avgDurationMinutes > 0 ? formatDurationMinutes(t.avgDurationMinutes) : '—'}
                  </td>
                  <td className="px-4 text-right">
                    <div className="inline-flex items-center gap-2 justify-end w-full">
                      <div className="w-16 h-1.5 bg-[#edf1ee] rounded-xs overflow-hidden">
                        <div
                          className="h-full bg-[#059669]"
                          style={{ width: `${Math.min(100, t.utilizationSharePct)}%` }}
                        />
                      </div>
                      <span className="font-mono tabular-nums font-semibold text-[#1b2925] w-8 text-right">
                        {t.utilizationSharePct}%
                      </span>
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
