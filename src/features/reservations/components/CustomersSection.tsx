import React, { useState } from 'react';
import type { CustomerSummaryItem, CustomersResponse } from '../reservations.types';
import { ShiftBadge } from './StatusBadge';
import {
  Users,
  Search,
  Phone,
  Mail,
  Calendar,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Info,
  ChevronRight,
  TrendingUp,
  History,
} from 'lucide-react';

interface CustomersSectionProps {
  customersData: CustomersResponse | null;
  loading: boolean;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onSelectCustomerReservations?: (clientKey: string, name: string) => void;
}

export function CustomersSection({
  customersData,
  loading,
  searchQuery,
  onSearchChange,
  onSelectCustomerReservations,
}: CustomersSectionProps) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const toggleExpand = (clientKey: string) => {
    setExpandedKey(expandedKey === clientKey ? null : clientKey);
  };

  const customers = customersData?.data || [];
  const totalCount = customersData?.total_count || 0;

  return (
    <div className="space-y-6 mb-8">
      {/* Banner Informativo de Límite y Reglas de Normalización */}
      <div className="bg-amber-50/60 border border-amber-200/80 rounded-xl p-4 text-xs text-amber-900 flex items-start gap-3">
        <Info size={17} className="text-amber-700 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-bold text-amber-950">
            Consolidación Analítica de Clientes (Regla Anti-Fusión)
          </div>
          <p className="text-amber-800 leading-relaxed">
            Los perfiles no se fusionan por simple coincidencia de nombre de pila, sino por número normalizado E.164 (Argentina / Internacional) o correo electrónico validado. Los números sin código de área o incompletos se aíslan por reserva para evitar atribuciones falsas.
          </p>
          <p className="text-[11px] text-amber-700 font-medium">
            * El historial consolidado abarca un universo muestral de hasta 10.000 reservas históricas.
          </p>
        </div>
      </div>

      {/* Barra de Búsqueda de Clientes */}
      <div className="bg-white border border-[#dce4dd] rounded-xl p-4 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative flex-1 w-full">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar cliente por nombre, teléfono, correo o clave..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:bg-white focus:border-[#1f5a49] focus:ring-1 focus:ring-[#1f5a49] outline-hidden text-[#1b2925]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs px-1.5 py-0.5 rounded bg-gray-100"
            >
              ✕
            </button>
          )}
        </div>

        <div className="text-xs text-gray-500 font-semibold shrink-0">
          {totalCount.toLocaleString('es-AR')} clientes registrados
        </div>
      </div>

      {/* Lista de Clientes */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-28 bg-white border border-gray-200 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : customers.length === 0 ? (
        <div className="bg-white border border-[#dce4dd] rounded-xl p-12 text-center">
          <Users size={32} className="mx-auto text-gray-300 mb-2" />
          <h4 className="text-sm font-bold text-gray-700">No se encontraron clientes</h4>
          <p className="text-xs text-gray-400 mt-1">Prueba con otro término de búsqueda.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3.5">
          {customers.map((c) => {
            const isExpanded = expandedKey === c.clientKey;
            const completionRate =
              c.totalReservations > 0
                ? Math.round((c.completedReservations / c.totalReservations) * 100)
                : 0;

            return (
              <div
                key={c.clientKey}
                className="bg-white border border-[#dce4dd] rounded-xl shadow-xs overflow-hidden transition-all hover:border-[#b6d2c3]"
              >
                <div
                  onClick={() => toggleExpand(c.clientKey)}
                  className="p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 cursor-pointer hover:bg-gray-50/50"
                >
                  {/* Datos del Cliente */}
                  <div className="flex items-start gap-3.5">
                    <div className="w-10 h-10 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center text-[#174639] font-bold text-sm shrink-0">
                      {c.primaryName.substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-[#1b2925]">{c.primaryName}</span>
                        <ShiftBadge shift={c.favoriteShift} />
                      </div>
                      <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-gray-500">
                        {c.primaryPhone && (
                          <span className="flex items-center gap-1">
                            <Phone size={12} className="text-gray-400" />
                            {c.primaryPhone}
                          </span>
                        )}
                        {c.primaryEmail && (
                          <span className="flex items-center gap-1">
                            <Mail size={12} className="text-gray-400" />
                            {c.primaryEmail}
                          </span>
                        )}
                        <span className="text-[10px] text-gray-400 font-mono">
                          ID: {c.clientKey}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Estadísticas de Visitas */}
                  <div className="flex flex-wrap items-center gap-4 text-xs">
                    <div className="text-center px-3 py-1 bg-gray-50 rounded-lg border border-gray-100">
                      <div className="text-[10px] uppercase font-bold text-gray-400">Total Visitas</div>
                      <div className="text-base font-extrabold text-[#174639] font-['Manrope']">
                        {c.totalReservations}
                      </div>
                    </div>

                    <div className="text-center px-3 py-1 bg-emerald-50 rounded-lg border border-emerald-100">
                      <div className="text-[10px] uppercase font-bold text-emerald-700">Cumplidas</div>
                      <div className="text-base font-extrabold text-emerald-900 font-['Manrope']">
                        {c.completedReservations}
                      </div>
                    </div>

                    <div className="text-center px-3 py-1 bg-rose-50 rounded-lg border border-rose-100">
                      <div className="text-[10px] uppercase font-bold text-rose-700">Canceladas</div>
                      <div className="text-base font-extrabold text-rose-900 font-['Manrope']">
                        {c.cancelledReservations}
                      </div>
                    </div>

                    <div className="text-center px-3 py-1 bg-amber-50 rounded-lg border border-amber-100">
                      <div className="text-[10px] uppercase font-bold text-amber-700">No-show</div>
                      <div className="text-base font-extrabold text-amber-900 font-['Manrope']">
                        {c.noShowReservations}
                      </div>
                    </div>

                    <button
                      type="button"
                      className="text-gray-400 hover:text-gray-700 p-1"
                    >
                      <ChevronRight
                        size={18}
                        className={`transition-transform duration-200 ${
                          isExpanded ? 'rotate-90' : ''
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {/* Sub-panel Expandible: Últimas 5 Visitas */}
                {isExpanded && (
                  <div className="border-t border-gray-100 bg-gray-50/70 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
                        <History size={14} className="text-[#1f5a49]" />
                        Últimas Visitas Registradas ({c.recentReservations.length})
                      </span>
                      {onSelectCustomerReservations && (
                        <button
                          type="button"
                          onClick={() => onSelectCustomerReservations(c.clientKey, c.primaryName)}
                          className="text-xs font-semibold text-[#1f5a49] hover:underline"
                        >
                          Ver todas en la grilla →
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2.5">
                      {c.recentReservations.map((rec) => (
                        <div
                          key={rec.id}
                          className="p-2.5 bg-white border border-gray-200 rounded-lg text-xs space-y-1 shadow-2xs"
                        >
                          <div className="font-semibold text-gray-900 flex items-center justify-between">
                            <span>{rec.operationalDate}</span>
                            <span className="text-[10px] px-1 py-0.2 bg-gray-100 rounded text-gray-600 font-bold">
                              {rec.tables.length > 0 ? `M${rec.tables.join('+')}` : 'S/M'}
                            </span>
                          </div>
                          <div className="text-[11px] text-gray-500 flex items-center justify-between">
                            <span>{rec.guestsCount} comensales</span>
                            <span className="capitalize font-semibold text-gray-700">
                              {rec.status}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
