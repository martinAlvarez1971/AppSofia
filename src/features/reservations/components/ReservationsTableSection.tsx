import React from 'react';
import type { ReservationQueryResult, ReservationQueryFilters } from '../reservations.types';
import { ReservationStatusBadge, ShiftBadge } from './StatusBadge';
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Calendar,
  Clock,
  Users,
  ChevronLeft,
  ChevronRight,
  Info,
  Layers,
  Inbox,
  User,
  ExternalLink,
} from 'lucide-react';

interface TableSectionProps {
  reservations: ReservationQueryResult[];
  totalCount: number;
  page: number;
  limit: number;
  totalPages: number;
  loading: boolean;
  filters: ReservationQueryFilters;
  onFilterChange: (filters: Partial<ReservationQueryFilters>) => void;
  onSelectReservation: (res: ReservationQueryResult) => void;
}

export function ReservationsTableSection({
  reservations,
  totalCount,
  page,
  limit,
  totalPages,
  loading,
  filters,
  onFilterChange,
  onSelectReservation,
}: TableSectionProps) {
  const handleSort = (field: 'startTime' | 'customerName' | 'guestsCount' | 'status' | 'createdAt') => {
    if (filters.sortBy === field) {
      onFilterChange({
        sortOrder: filters.sortOrder === 'asc' ? 'desc' : 'asc',
        page: 1,
      });
    } else {
      onFilterChange({
        sortBy: field,
        sortOrder: 'asc',
        page: 1,
      });
    }
  };

  const getSortIcon = (field: 'startTime' | 'customerName' | 'guestsCount' | 'status' | 'createdAt') => {
    if (filters.sortBy !== field) {
      return <ArrowUpDown size={13} className="text-gray-400 group-hover:text-gray-600" />;
    }
    return filters.sortOrder === 'asc' ? (
      <ArrowUp size={13} className="text-[#1f5a49]" />
    ) : (
      <ArrowDown size={13} className="text-[#1f5a49]" />
    );
  };

  return (
    <div className="bg-white border border-[#dce4dd] rounded-xl shadow-xs overflow-hidden flex flex-col">
      {/* Encabezado de la Grilla */}
      <div className="px-5 py-4 border-b border-gray-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-gray-50/50">
        <div className="flex items-center gap-2">
          <span className="font-bold text-[#1b2925] text-sm">Listado de Reservas</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold">
            {totalCount.toLocaleString('es-AR')} encontradas
          </span>
        </div>

        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span>Filas por página:</span>
          <select
            value={limit}
            onChange={(e) => onFilterChange({ limit: Number(e.target.value), page: 1 })}
            className="py-1 px-2 border border-gray-200 rounded-md bg-white text-gray-700 outline-hidden focus:border-[#1f5a49]"
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>
      </div>

      {/* Contenedor de la Tabla Responsive */}
      <div className="overflow-x-auto min-h-[340px]">
        {loading ? (
          <div className="p-8 space-y-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : reservations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
            <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 mb-3">
              <Inbox size={26} />
            </div>
            <h4 className="text-base font-bold text-gray-800 mb-1">No se encontraron reservas</h4>
            <p className="text-xs text-gray-500 max-w-sm mb-4">
              No hay reservas que coincidan con los filtros aplicados. Intenta modificar o restablecer la búsqueda.
            </p>
          </div>
        ) : (
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/70 text-gray-600 font-semibold uppercase tracking-wider">
                <th
                  onClick={() => handleSort('startTime')}
                  className="py-3 px-4 cursor-pointer hover:bg-gray-100/80 transition-all select-none group"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Fecha y Turno</span>
                    {getSortIcon('startTime')}
                  </div>
                </th>
                <th className="py-3 px-3">Horario</th>
                <th
                  onClick={() => handleSort('customerName')}
                  className="py-3 px-4 cursor-pointer hover:bg-gray-100/80 transition-all select-none group"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Cliente</span>
                    {getSortIcon('customerName')}
                  </div>
                </th>
                <th className="py-3 px-3">Contacto</th>
                <th
                  onClick={() => handleSort('guestsCount')}
                  className="py-3 px-3 cursor-pointer hover:bg-gray-100/80 transition-all select-none group text-center"
                >
                  <div className="flex items-center justify-center gap-1.5">
                    <span>Pax</span>
                    {getSortIcon('guestsCount')}
                  </div>
                </th>
                <th className="py-3 px-3">Mesa(s)</th>
                <th className="py-3 px-3">Sector</th>
                <th
                  onClick={() => handleSort('status')}
                  className="py-3 px-3 cursor-pointer hover:bg-gray-100/80 transition-all select-none group"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Estado</span>
                    {getSortIcon('status')}
                  </div>
                </th>
                <th className="py-3 px-3">Responsable</th>
                <th className="py-3 px-3 text-right">Detalle</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-[#1b2925]">
              {reservations.map((r) => {
                const primaryTable = r.tables[0];
                const creator = r.createdByProfile;
                const creatorName = creator
                  ? [creator.firstName, creator.lastName].filter(Boolean).join(' ') || creator.email
                  : null;

                return (
                  <tr
                    key={r.id}
                    onClick={() => onSelectReservation(r)}
                    className="hover:bg-emerald-50/40 transition-colors cursor-pointer group"
                  >
                    {/* Fecha y Turno */}
                    <td className="py-3.5 px-4 font-medium whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-gray-900">{r.operationalDate}</span>
                        {r.isMidnightRollover && (
                          <span
                            className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800"
                            title="Reserva post-medianoche asignada al servicio nocturno anterior"
                          >
                            🌙 +1d
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5">
                        <ShiftBadge shift={r.shift} />
                      </div>
                    </td>

                    {/* Horario */}
                    <td className="py-3.5 px-3 whitespace-nowrap font-mono text-gray-700">
                      <div className="font-bold text-[#174639]">{r.localStartTime} hs</div>
                      <div className="text-[10px] text-gray-400">hasta {r.localEndTime}</div>
                    </td>

                    {/* Cliente */}
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-[#1b2925] text-sm group-hover:text-[#1f5a49] transition-colors">
                        {r.customerName}
                      </div>
                      {r.notes && (
                        <div className="text-[11px] text-gray-500 truncate max-w-[200px]" title={r.notes}>
                          "{r.notes}"
                        </div>
                      )}
                    </td>

                    {/* Contacto */}
                    <td className="py-3.5 px-3 text-gray-600">
                      <div>{r.customerPhone || <span className="text-gray-300">—</span>}</div>
                      {r.customerEmail && (
                        <div className="text-[10px] text-gray-400 truncate max-w-[140px]" title={r.customerEmail}>
                          {r.customerEmail}
                        </div>
                      )}
                    </td>

                    {/* Comensales */}
                    <td className="py-3.5 px-3 text-center whitespace-nowrap">
                      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-emerald-50 text-emerald-900 font-bold border border-emerald-100">
                        {r.guestsCount}
                      </span>
                    </td>

                    {/* Mesa(s) */}
                    <td className="py-3.5 px-3 whitespace-nowrap">
                      {r.tables.length === 0 ? (
                        <span className="text-gray-400 italic">Sin mesa</span>
                      ) : (
                        <div className="flex flex-wrap gap-1 max-w-[120px]">
                          {r.tables.map((tbl) => (
                            <span
                              key={tbl.id}
                              className="px-2 py-0.5 rounded font-bold text-xs bg-gray-100 text-gray-800 border border-gray-200"
                              title={`Mesa ${tbl.number} (${tbl.sector}, Capacidad: ${tbl.capacity})`}
                            >
                              M{tbl.number}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>

                    {/* Sector */}
                    <td className="py-3.5 px-3 whitespace-nowrap text-gray-600">
                      {primaryTable ? primaryTable.sector : '—'}
                    </td>

                    {/* Estado */}
                    <td className="py-3.5 px-3 whitespace-nowrap">
                      <ReservationStatusBadge status={r.status} />
                    </td>

                    {/* Responsable */}
                    <td className="py-3.5 px-3 whitespace-nowrap text-gray-500 text-[11px]">
                      {creatorName ? (
                        <span className="flex items-center gap-1" title={creator?.email}>
                          <User size={12} className="text-gray-400" />
                          <span className="truncate max-w-[110px]">{creatorName}</span>
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>

                    {/* Acción / Detalle */}
                    <td className="py-3.5 px-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectReservation(r);
                        }}
                        className="p-1.5 text-gray-400 hover:text-[#1f5a49] hover:bg-emerald-50 rounded-md transition-colors"
                        title="Ver detalle histórico"
                      >
                        <ExternalLink size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Barra de Paginación */}
      <div className="px-5 py-3.5 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-3 bg-gray-50/50 text-xs text-gray-600">
        <div>
          Mostrando página <span className="font-bold text-gray-900">{page}</span> de{' '}
          <span className="font-bold text-gray-900">{totalPages}</span> (Total:{' '}
          <span className="font-bold text-[#1f5a49]">{totalCount.toLocaleString('es-AR')}</span> reservas)
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => onFilterChange({ page: page - 1 })}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            <ChevronLeft size={14} />
            <span>Anterior</span>
          </button>

          <span className="px-2 font-semibold text-gray-700">
            {page} / {totalPages}
          </span>

          <button
            type="button"
            disabled={page >= totalPages || loading}
            onClick={() => onFilterChange({ page: page + 1 })}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            <span>Siguiente</span>
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
