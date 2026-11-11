import React from 'react';
import type { ReservationOverviewStats } from '../reservations.types';
import {
  CalendarDays,
  CheckCircle2,
  Clock,
  Check,
  XCircle,
  AlertCircle,
  Users,
  Sun,
  Moon,
  Sparkles,
  BarChart3,
  TrendingUp,
} from 'lucide-react';

interface OverviewSectionProps {
  stats: ReservationOverviewStats | null;
  loading: boolean;
  onNavigateToTab?: (tab: 'table' | 'calendar' | 'customers') => void;
}

export function OverviewSection({ stats, loading, onNavigateToTab }: OverviewSectionProps) {
  if (loading && !stats) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-8">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="bg-white border border-[#dce4dd] rounded-xl p-4 animate-pulse h-28" />
        ))}
      </div>
    );
  }

  if (!stats) return null;

  const total = stats.total || 0;
  const lunchPct = total > 0 ? Math.round((stats.shifts.lunch / total) * 100) : 0;
  const dinnerPct = total > 0 ? Math.round((stats.shifts.dinner / total) * 100) : 0;
  const otherPct = total > 0 ? Math.round((stats.shifts.other / total) * 100) : 0;

  const cards = [
    {
      title: 'Total Reservas',
      value: stats.total,
      icon: CalendarDays,
      bg: 'bg-emerald-50 text-emerald-800 border-emerald-200',
      iconColor: 'text-emerald-700',
    },
    {
      title: 'Confirmadas',
      value: stats.confirmed,
      icon: CheckCircle2,
      bg: 'bg-teal-50 text-teal-800 border-teal-200',
      iconColor: 'text-teal-700',
    },
    {
      title: 'En Curso',
      value: stats.seated,
      icon: Clock,
      bg: 'bg-blue-50 text-blue-800 border-blue-200',
      iconColor: 'text-blue-700',
    },
    {
      title: 'Finalizadas',
      value: stats.completed,
      icon: Check,
      bg: 'bg-slate-50 text-slate-800 border-slate-200',
      iconColor: 'text-slate-600',
    },
    {
      title: 'Canceladas',
      value: stats.cancelled,
      icon: XCircle,
      bg: 'bg-rose-50 text-rose-800 border-rose-200',
      iconColor: 'text-rose-700',
    },
    {
      title: 'No-show',
      value: stats.no_show,
      icon: AlertCircle,
      bg: 'bg-amber-50 text-amber-800 border-amber-200',
      iconColor: 'text-amber-700',
    },
    {
      title: 'Total Comensales',
      value: stats.totalGuests,
      icon: Users,
      bg: 'bg-indigo-50 text-indigo-800 border-indigo-200',
      iconColor: 'text-indigo-700',
    },
  ];

  return (
    <div className="space-y-6 mb-8">
      {/* Grilla de Tarjetas KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3.5">
        {cards.map((card, idx) => {
          const Icon = card.icon;
          return (
            <div
              key={idx}
              className="bg-white border border-[#dce4dd] rounded-xl p-3.5 shadow-xs flex flex-col justify-between hover:border-[#b6d2c3] transition-all"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider truncate">
                  {card.title}
                </span>
                <span className={`p-1.5 rounded-lg border ${card.bg}`}>
                  <Icon size={15} className={card.iconColor} />
                </span>
              </div>
              <div className="text-2xl font-extrabold text-[#1b2925] font-['Manrope']">
                {card.value.toLocaleString('es-AR')}
              </div>
            </div>
          );
        })}
      </div>

      {/* Gráfico de Distribución por Turnos Gastronómicos */}
      <div className="bg-white border border-[#dce4dd] rounded-xl p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-base font-bold text-[#1b2925] flex items-center gap-2">
              <BarChart3 size={18} className="text-[#1f5a49]" />
              Distribución de Reservas por Turnos
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Clasificación automática según la hora local de Buenos Aires
            </p>
          </div>
          {onNavigateToTab && (
            <button
              type="button"
              onClick={() => onNavigateToTab('calendar')}
              className="text-xs font-semibold text-[#1f5a49] hover:underline flex items-center gap-1 cursor-pointer"
            >
              <TrendingUp size={14} />
              Ver en vista de calendario
            </button>
          )}
        </div>

        {/* Barra de progreso apilada */}
        <div className="h-4 w-full bg-gray-100 rounded-full overflow-hidden flex shadow-inner mb-4">
          <div
            style={{ width: `${lunchPct}%` }}
            className="bg-amber-400 transition-all duration-500 hover:brightness-105"
            title={`Almuerzo: ${stats.shifts.lunch} (${lunchPct}%)`}
          />
          <div
            style={{ width: `${dinnerPct}%` }}
            className="bg-[#1f5a49] transition-all duration-500 hover:brightness-105"
            title={`Cena: ${stats.shifts.dinner} (${dinnerPct}%)`}
          />
          <div
            style={{ width: `${otherPct}%` }}
            className="bg-slate-400 transition-all duration-500 hover:brightness-105"
            title={`Fuera de turno: ${stats.shifts.other} (${otherPct}%)`}
          />
        </div>

        {/* Leyenda con valores y porcentajes */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="flex items-center gap-3 p-2.5 rounded-lg bg-amber-50/50 border border-amber-100">
            <span className="p-2 rounded-lg bg-amber-100 text-amber-800">
              <Sun size={16} />
            </span>
            <div>
              <div className="text-xs font-semibold text-gray-700">Almuerzo (11:30 - 16:00)</div>
              <div className="text-lg font-bold text-[#1b2925] font-['Manrope']">
                {stats.shifts.lunch}{' '}
                <span className="text-xs font-normal text-gray-500">({lunchPct}%)</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 p-2.5 rounded-lg bg-emerald-50/50 border border-emerald-100">
            <span className="p-2 rounded-lg bg-emerald-100 text-[#174639]">
              <Moon size={16} />
            </span>
            <div>
              <div className="text-xs font-semibold text-gray-700">Cena (19:30 - 01:30)</div>
              <div className="text-lg font-bold text-[#1b2925] font-['Manrope']">
                {stats.shifts.dinner}{' '}
                <span className="text-xs font-normal text-gray-500">({dinnerPct}%)</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 p-2.5 rounded-lg bg-slate-50 border border-slate-100">
            <span className="p-2 rounded-lg bg-slate-200 text-slate-700">
              <Sparkles size={16} />
            </span>
            <div>
              <div className="text-xs font-semibold text-gray-700">Fuera de Turno</div>
              <div className="text-lg font-bold text-[#1b2925] font-['Manrope']">
                {stats.shifts.other}{' '}
                <span className="text-xs font-normal text-gray-500">({otherPct}%)</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
