import React, { useState, useMemo } from 'react';
import type { CalendarResponse, ReservationQueryResult } from '../reservations.types';
import { ReservationStatusBadge, ShiftBadge } from './StatusBadge';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  Users,
  Moon,
  Info,
} from 'lucide-react';

interface CalendarSectionProps {
  calendarData: CalendarResponse | null;
  loading: boolean;
  onSelectReservation: (res: ReservationQueryResult) => void;
  onDateRangeChange?: (startDate: string, endDate: string) => void;
}

export function ReservationsCalendarSection({
  calendarData,
  loading,
  onSelectReservation,
  onDateRangeChange,
}: CalendarSectionProps) {
  const [viewMode, setViewMode] = useState<'day' | 'week' | 'month'>('week');
  const [currentDate, setCurrentDate] = useState(() => new Date());

  // Formato YYYY-MM-DD
  const formatDateKey = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  // Calcular fechas a mostrar según el modo (Día, Semana o Mes)
  const daysToShow = useMemo(() => {
    const dates: Date[] = [];
    if (viewMode === 'day') {
      dates.push(new Date(currentDate));
    } else if (viewMode === 'week') {
      // Semana de Lunes a Domingo
      const d = new Date(currentDate);
      const dayOfWeek = d.getDay();
      const diff = d.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // Ajuste al lunes
      const monday = new Date(d.setDate(diff));

      for (let i = 0; i < 7; i++) {
        const next = new Date(monday);
        next.setDate(monday.getDate() + i);
        dates.push(next);
      }
    } else {
      // Mes: primeros 30 días a partir del 1 del mes
      const y = currentDate.getFullYear();
      const m = currentDate.getMonth();
      const firstDay = new Date(y, m, 1);
      const totalDays = new Date(y, m + 1, 0).getDate();

      for (let i = 1; i <= totalDays; i++) {
        dates.push(new Date(y, m, i));
      }
    }
    return dates;
  }, [viewMode, currentDate]);

  // Navegación temporal
  const handlePrev = () => {
    const next = new Date(currentDate);
    if (viewMode === 'day') next.setDate(next.getDate() - 1);
    else if (viewMode === 'week') next.setDate(next.getDate() - 7);
    else next.setMonth(next.getMonth() - 1);
    setCurrentDate(next);
  };

  const handleNext = () => {
    const next = new Date(currentDate);
    if (viewMode === 'day') next.setDate(next.getDate() + 1);
    else if (viewMode === 'week') next.setDate(next.getDate() + 7);
    else next.setMonth(next.getMonth() + 1);
    setCurrentDate(next);
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  // Título del período actual
  const periodLabel = useMemo(() => {
    const months = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
    ];
    if (viewMode === 'day') {
      return `${currentDate.getDate()} de ${months[currentDate.getMonth()]} de ${currentDate.getFullYear()}`;
    }
    if (viewMode === 'week') {
      const first = daysToShow[0];
      const last = daysToShow[daysToShow.length - 1];
      if (first.getMonth() === last.getMonth()) {
        return `${first.getDate()} - ${last.getDate()} de ${months[first.getMonth()]} de ${first.getFullYear()}`;
      }
      return `${first.getDate()} ${months[first.getMonth()]} - ${last.getDate()} ${months[last.getMonth()]} ${last.getFullYear()}`;
    }
    return `${months[currentDate.getMonth()]} de ${currentDate.getFullYear()}`;
  }, [viewMode, currentDate, daysToShow]);

  return (
    <div className="bg-white border border-[#dce4dd] rounded-xl shadow-xs overflow-hidden flex flex-col mb-8">
      {/* Barra de Controles del Calendario */}
      <div className="px-5 py-4 border-b border-gray-100 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-gray-50/50">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-0.5 shadow-2xs">
            <button
              type="button"
              onClick={handlePrev}
              className="p-1.5 text-gray-600 hover:text-black hover:bg-gray-100 rounded-md transition-colors"
              title="Período anterior"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={handleToday}
              className="px-2.5 py-1 text-xs font-semibold text-[#1f5a49] hover:bg-emerald-50 rounded-md transition-colors"
            >
              Hoy
            </button>
            <button
              type="button"
              onClick={handleNext}
              className="p-1.5 text-gray-600 hover:text-black hover:bg-gray-100 rounded-md transition-colors"
              title="Período siguiente"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <h3 className="text-base font-bold text-[#1b2925] font-['Manrope'] capitalize">
            {periodLabel}
          </h3>
        </div>

        {/* Selector de Modo (Día, Semana, Mes) */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-gray-200/70 p-1 rounded-lg text-xs font-semibold">
            <button
              type="button"
              onClick={() => setViewMode('day')}
              className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
                viewMode === 'day'
                  ? 'bg-white text-[#174639] shadow-xs'
                  : 'text-gray-600 hover:text-black'
              }`}
            >
              Día
            </button>
            <button
              type="button"
              onClick={() => setViewMode('week')}
              className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
                viewMode === 'week'
                  ? 'bg-white text-[#174639] shadow-xs'
                  : 'text-gray-600 hover:text-black'
              }`}
            >
              Semana
            </button>
            <button
              type="button"
              onClick={() => setViewMode('month')}
              className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
                viewMode === 'month'
                  ? 'bg-white text-[#174639] shadow-xs'
                  : 'text-gray-600 hover:text-black'
              }`}
            >
              Mes
            </button>
          </div>
        </div>
      </div>

      {/* Nota técnica de jornada gastronómica */}
      <div className="px-5 py-2 bg-emerald-50/40 border-b border-emerald-100/60 flex items-center justify-between text-xs text-[#174639]">
        <div className="flex items-center gap-1.5">
          <Info size={14} className="text-[#1f5a49]" />
          <span>
            <strong>Jornada Operativa:</strong> Las reservas entre 00:00 y 04:59 hs se agrupan en el servicio nocturno previo con etiqueta{' '}
            <span className="font-bold text-indigo-700 bg-indigo-50 px-1 py-0.5 rounded border border-indigo-200">
              🌙 Trasnochada
            </span>.
          </span>
        </div>
      </div>

      {/* Grilla del Calendario */}
      <div className="overflow-x-auto min-h-[460px]">
        {loading ? (
          <div className="p-8 grid grid-cols-1 md:grid-cols-7 gap-4">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="h-64 bg-gray-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : (
          <div
            className={`grid gap-px bg-gray-200 ${
              viewMode === 'day'
                ? 'grid-cols-1'
                : viewMode === 'week'
                ? 'grid-cols-1 sm:grid-cols-2 md:grid-cols-7'
                : 'grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7'
            }`}
          >
            {daysToShow.map((dateObj) => {
              const dateKey = formatDateKey(dateObj);
              const group = calendarData ? calendarData[dateKey] : null;
              const count = group?.count || 0;
              const totalGuests = group?.totalGuests || 0;
              const reservations = group?.reservations || [];
              const isToday = formatDateKey(new Date()) === dateKey;

              const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

              return (
                <div
                  key={dateKey}
                  className={`bg-white min-h-[220px] p-3 flex flex-col ${
                    isToday ? 'ring-2 ring-inset ring-[#1f5a49]/40 bg-emerald-50/10' : ''
                  }`}
                >
                  {/* Encabezado del Día */}
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-gray-100">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-xs font-semibold text-gray-500 uppercase">
                        {dayNames[dateObj.getDay()]}
                      </span>
                      <span
                        className={`text-sm font-bold ${
                          isToday
                            ? 'w-6 h-6 rounded-full bg-[#1f5a49] text-white flex items-center justify-center -ml-0.5'
                            : 'text-[#1b2925]'
                        }`}
                      >
                        {dateObj.getDate()}
                      </span>
                    </div>

                    {count > 0 && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-[#174639]">
                        {count} res ({totalGuests}p)
                      </span>
                    )}
                  </div>

                  {/* Lista de Reservas del Día */}
                  <div className="space-y-2 flex-1 overflow-y-auto max-h-[380px] pr-1">
                    {reservations.length === 0 ? (
                      <div className="h-full flex items-center justify-center text-[11px] text-gray-300 italic py-6">
                        Sin reservas
                      </div>
                    ) : (
                      reservations.map((r) => {
                        const tablesStr =
                          r.tables.length > 0 ? r.tables.map((t) => `M${t.number}`).join('+') : 'S/M';

                        return (
                          <div
                            key={r.id}
                            onClick={() => onSelectReservation(r)}
                            className={`p-2 rounded-lg border text-xs cursor-pointer transition-all hover:shadow-sm hover:border-[#1f5a49] ${
                              r.isMidnightRollover
                                ? 'bg-indigo-50/60 border-indigo-200'
                                : 'bg-gray-50 border-gray-200'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1 mb-1">
                              <span className="font-mono font-bold text-[#174639] flex items-center gap-1">
                                <Clock size={11} className="text-gray-400" />
                                {r.localStartTime}
                              </span>
                              <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-white text-gray-700 border border-gray-200">
                                {tablesStr}
                              </span>
                            </div>

                            <div className="font-semibold text-gray-900 truncate mb-1" title={r.customerName}>
                              {r.customerName}
                            </div>

                            <div className="flex items-center justify-between gap-1 mt-1 pt-1 border-t border-gray-200/50 text-[10px]">
                              <span className="text-gray-500 flex items-center gap-0.5">
                                <Users size={10} />
                                {r.guestsCount}p
                              </span>
                              <div className="scale-85 origin-right">
                                <ReservationStatusBadge status={r.status} />
                              </div>
                            </div>

                            {r.isMidnightRollover && (
                              <div className="mt-1 text-[9px] font-bold text-indigo-700 flex items-center gap-0.5">
                                <Moon size={9} />
                                Trasnochada (+1d)
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
