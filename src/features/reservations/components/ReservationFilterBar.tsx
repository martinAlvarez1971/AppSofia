import React, { useState } from 'react';
import type { ReservationQueryFilters, ReservationStatus, ShiftType } from '../reservations.types';
import { Search, RotateCcw, Filter, ChevronDown, ChevronUp, Calendar, Users, Hash, MapPin } from 'lucide-react';

interface FilterBarProps {
  filters: ReservationQueryFilters;
  onChange: (updated: Partial<ReservationQueryFilters>) => void;
  onReset: () => void;
  availableSectors?: string[];
}

export function ReservationFilterBar({
  filters,
  onChange,
  onReset,
  availableSectors = ['Salón Principal', 'Terraza Jardín', 'Barra & Sommelier', 'VIP / Privado'],
}: FilterBarProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Contar filtros activos
  let activeCount = 0;
  if (filters.q) activeCount++;
  if (filters.startDate) activeCount++;
  if (filters.endDate) activeCount++;
  if (filters.status && filters.status !== 'all') activeCount++;
  if (filters.shift && filters.shift !== 'all') activeCount++;
  if (filters.sector && filters.sector !== 'all') activeCount++;
  if (filters.tableNumber) activeCount++;
  if (filters.minGuests) activeCount++;
  if (filters.maxGuests) activeCount++;

  return (
    <div className="bg-white border border-[#dce4dd] rounded-xl p-4 shadow-xs mb-6 transition-all">
      {/* Barra Principal */}
      <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between">
        {/* Input de Búsqueda Rápida */}
        <div className="relative flex-1 min-w-[260px]">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar por cliente, teléfono, email o ID..."
            value={filters.q || ''}
            onChange={(e) => onChange({ q: e.target.value || undefined, page: 1 })}
            className="w-full pl-10 pr-4 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:bg-white focus:border-[#1f5a49] focus:ring-1 focus:ring-[#1f5a49] outline-hidden transition-all text-[#1b2925]"
          />
          {filters.q && (
            <button
              type="button"
              onClick={() => onChange({ q: undefined, page: 1 })}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs px-1.5 py-0.5 rounded bg-gray-100"
            >
              ✕
            </button>
          )}
        </div>

        {/* Filtro Estado */}
        <div className="flex items-center gap-2">
          <select
            value={filters.status || 'all'}
            onChange={(e) =>
              onChange({
                status: e.target.value === 'all' ? undefined : (e.target.value as ReservationStatus),
                page: 1,
              })
            }
            className="py-2 px-3 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:bg-white focus:border-[#1f5a49] outline-hidden text-[#1b2925] cursor-pointer"
          >
            <option value="all">Todos los estados</option>
            <option value="confirmed">Confirmadas</option>
            <option value="seated">En curso</option>
            <option value="completed">Finalizadas</option>
            <option value="cancelled">Canceladas</option>
            <option value="no_show">No-show</option>
          </select>

          {/* Filtro Turno */}
          <select
            value={filters.shift || 'all'}
            onChange={(e) =>
              onChange({
                shift: e.target.value === 'all' ? undefined : (e.target.value as ShiftType),
                page: 1,
              })
            }
            className="py-2 px-3 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:bg-white focus:border-[#1f5a49] outline-hidden text-[#1b2925] cursor-pointer"
          >
            <option value="all">Todos los turnos</option>
            <option value="lunch">Almuerzo (11:30 - 16:00)</option>
            <option value="dinner">Cena (19:30 - 01:30)</option>
            <option value="other">Fuera de turno</option>
          </select>
        </div>

        {/* Botones de Control */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border transition-all ${
              showAdvanced || activeCount > 0
                ? 'bg-[#e8f1eb] text-[#174639] border-[#b6d2c3]'
                : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
            }`}
          >
            <Filter size={15} />
            <span>Filtros</span>
            {activeCount > 0 && (
              <span className="ml-1 w-5 h-5 flex items-center justify-center text-xs font-bold rounded-full bg-[#1f5a49] text-white">
                {activeCount}
              </span>
            )}
            {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {activeCount > 0 && (
            <button
              type="button"
              onClick={onReset}
              className="inline-flex items-center gap-1 px-3 py-2 text-sm text-gray-500 hover:text-red-700 hover:bg-red-50 rounded-lg border border-transparent transition-all"
              title="Restablecer todos los filtros"
            >
              <RotateCcw size={14} />
              <span className="hidden sm:inline">Limpiar</span>
            </button>
          )}
        </div>
      </div>

      {/* Panel de Filtros Avanzados */}
      {showAdvanced && (
        <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {/* Fecha Operativa Desde */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1 flex items-center gap-1">
              <Calendar size={13} className="text-gray-400" />
              Fecha Operativa Desde
            </label>
            <input
              type="date"
              value={filters.startDate || ''}
              onChange={(e) => onChange({ startDate: e.target.value || undefined, page: 1 })}
              className="w-full py-1.5 px-3 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:bg-white focus:border-[#1f5a49] outline-hidden text-[#1b2925]"
            />
          </div>

          {/* Fecha Operativa Hasta */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1 flex items-center gap-1">
              <Calendar size={13} className="text-gray-400" />
              Fecha Operativa Hasta
            </label>
            <input
              type="date"
              value={filters.endDate || ''}
              onChange={(e) => onChange({ endDate: e.target.value || undefined, page: 1 })}
              className="w-full py-1.5 px-3 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:bg-white focus:border-[#1f5a49] outline-hidden text-[#1b2925]"
            />
          </div>

          {/* Sector de Mesa */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1 flex items-center gap-1">
              <MapPin size={13} className="text-gray-400" />
              Sector de Salón
            </label>
            <select
              value={filters.sector || 'all'}
              onChange={(e) =>
                onChange({
                  sector: e.target.value === 'all' ? undefined : e.target.value,
                  page: 1,
                })
              }
              className="w-full py-1.5 px-3 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:bg-white focus:border-[#1f5a49] outline-hidden text-[#1b2925]"
            >
              <option value="all">Todos los sectores</option>
              {availableSectors.map((sec) => (
                <option key={sec} value={sec}>
                  {sec}
                </option>
              ))}
            </select>
          </div>

          {/* Número de Mesa */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1 flex items-center gap-1">
              <Hash size={13} className="text-gray-400" />
              Número de Mesa
            </label>
            <input
              type="number"
              placeholder="Ej: 4"
              min={1}
              max={100}
              value={filters.tableNumber || ''}
              onChange={(e) =>
                onChange({
                  tableNumber: e.target.value ? Number(e.target.value) : undefined,
                  page: 1,
                })
              }
              className="w-full py-1.5 px-3 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:bg-white focus:border-[#1f5a49] outline-hidden text-[#1b2925]"
            />
          </div>

          {/* Comensales Mínimos y Máximos */}
          <div className="sm:col-span-2 lg:col-span-2 flex items-center gap-3">
            <div className="flex-1">
              <label className="block text-xs font-semibold text-gray-600 mb-1 flex items-center gap-1">
                <Users size={13} className="text-gray-400" />
                Mín. Comensales
              </label>
              <input
                type="number"
                placeholder="Mín"
                min={1}
                max={50}
                value={filters.minGuests || ''}
                onChange={(e) =>
                  onChange({
                    minGuests: e.target.value ? Number(e.target.value) : undefined,
                    page: 1,
                  })
                }
                className="w-full py-1.5 px-3 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:bg-white focus:border-[#1f5a49] outline-hidden text-[#1b2925]"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-semibold text-gray-600 mb-1 flex items-center gap-1">
                <Users size={13} className="text-gray-400" />
                Máx. Comensales
              </label>
              <input
                type="number"
                placeholder="Máx"
                min={1}
                max={50}
                value={filters.maxGuests || ''}
                onChange={(e) =>
                  onChange({
                    maxGuests: e.target.value ? Number(e.target.value) : undefined,
                    page: 1,
                  })
                }
                className="w-full py-1.5 px-3 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:bg-white focus:border-[#1f5a49] outline-hidden text-[#1b2925]"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
