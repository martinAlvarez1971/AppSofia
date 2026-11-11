import { useState } from 'react';
import type { OperationalReportResponse } from '../reports.types';

interface ServiceMixDonutChartProps {
  reservations: OperationalReportResponse['reservations'];
  walkInSessions: number;
  shifts: OperationalReportResponse['shifts'];
}

interface Slice {
  key: string;
  label: string;
  value: number;
  color: string;
  badgeBg: string;
}

export function ServiceMixDonutChart({
  reservations,
  walkInSessions,
  shifts,
}: ServiceMixDonutChartProps) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const slices: Slice[] = [
    { key: 'completed', label: 'Finalizadas', value: reservations.completed, color: '#10b981', badgeBg: 'bg-emerald-500' },
    { key: 'seated', label: 'En curso', value: reservations.seated, color: '#2563eb', badgeBg: 'bg-blue-600' },
    { key: 'confirmed', label: 'Confirmadas', value: reservations.confirmed, color: '#06b6d4', badgeBg: 'bg-cyan-500' },
    { key: 'walkin', label: 'Walk-in', value: walkInSessions, color: '#f59e0b', badgeBg: 'bg-amber-500' },
    { key: 'no_show', label: 'No-show', value: reservations.no_show, color: '#a855f7', badgeBg: 'bg-purple-500' },
    { key: 'cancelled', label: 'Canceladas', value: reservations.cancelled, color: '#ef4444', badgeBg: 'bg-red-500' },
  ];

  const totalServices = slices.reduce((acc, s) => acc + s.value, 0);
  const nonZeroSlices = slices.filter((s) => s.value > 0);
  const activeSlice = hoveredKey ? slices.find((s) => s.key === hoveredKey) || null : null;

  // SVG Donut geometry
  const size = 196;
  const center = size / 2;
  const radius = 70;
  const strokeWidth = 26;
  const circumference = 2 * Math.PI * radius;

  let cumulativeFraction = 0;
  const segments = nonZeroSlices.map((s) => {
    const fraction = totalServices > 0 ? s.value / totalServices : 0;
    const dashLength = fraction * circumference;
    const dashOffset = -cumulativeFraction * circumference;
    cumulativeFraction += fraction;
    return { ...s, fraction, dashLength, dashOffset };
  });

  // Shift visual distribution
  const shiftItems = [
    {
      key: 'lunch',
      label: 'Almuerzo',
      hours: '11:30–16:00',
      services: shifts.lunch.reservations + shifts.lunch.walkIns,
      guests: shifts.lunch.guests,
      color: '#f59e0b',
    },
    {
      key: 'dinner',
      label: 'Cena',
      hours: '19:30–01:30',
      services: shifts.dinner.reservations + shifts.dinner.walkIns,
      guests: shifts.dinner.guests,
      color: '#2563eb',
    },
    {
      key: 'other',
      label: 'Fuera de turno',
      hours: 'Otros horarios',
      services: shifts.other.reservations + shifts.other.walkIns,
      guests: shifts.other.guests,
      color: '#8b5cf6',
    },
  ];
  const shiftTotal = shiftItems.reduce((acc, it) => acc + it.services, 0);

  return (
    <section className="bg-white border border-[#dce4dd] rounded-lg p-5">
      <div className="pb-4 border-b border-[#edf1ee] flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-[#1b2925] font-['Manrope']">
            Distribución de Resultados y Turnos
          </h3>
          <p className="text-xs text-[#68766f] mt-0.5">
            Proporción visual de reservas por estado, atención walk-in y carga por turno
          </p>
        </div>
        <span className="text-xs font-mono tabular-nums font-bold text-[#1b2925]">
          {totalServices} servicios
        </span>
      </div>

      <div className="mt-5 grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
        {/* Donut SVG */}
        <div className="md:col-span-5 flex flex-col items-center justify-center">
          <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
              <circle
                cx={center}
                cy={center}
                r={radius}
                fill="none"
                stroke="#eef2ef"
                strokeWidth={strokeWidth}
              />
              {segments.map((seg) => {
                const isHovered = hoveredKey === seg.key;
                return (
                  <circle
                    key={seg.key}
                    cx={center}
                    cy={center}
                    r={radius}
                    fill="none"
                    stroke={seg.color}
                    strokeWidth={isHovered ? strokeWidth + 5 : strokeWidth}
                    strokeDasharray={`${Math.max(0, seg.dashLength - (nonZeroSlices.length > 1 ? 2 : 0))} ${circumference}`}
                    strokeDashoffset={seg.dashOffset}
                    className="transition-all duration-200 cursor-pointer"
                    onMouseEnter={() => setHoveredKey(seg.key)}
                    onMouseLeave={() => setHoveredKey(null)}
                  />
                );
              })}
            </svg>

            <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none px-4">
              {activeSlice && totalServices > 0 ? (
                <>
                  <span className="text-[11px] font-bold uppercase tracking-wide text-[#4f5e55]">
                    {activeSlice.label}
                  </span>
                  <strong
                    className="text-2xl font-extrabold font-mono tabular-nums leading-tight"
                    style={{ color: activeSlice.color }}
                  >
                    {Math.round((activeSlice.value / totalServices) * 100)}%
                  </strong>
                  <span className="text-xs font-mono tabular-nums text-[#68766f]">
                    {activeSlice.value} de {totalServices}
                  </span>
                </>
              ) : (
                <>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#68766f]">
                    Total
                  </span>
                  <strong className="text-2xl font-extrabold font-mono tabular-nums text-[#1b2925] leading-tight">
                    {totalServices}
                  </strong>
                  <span className="text-[11px] text-[#68766f]">servicios</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Leyenda interactiva + Barra de Turnos */}
        <div className="md:col-span-7 space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {slices.map((s) => {
              const pct = totalServices > 0 ? Math.round((s.value / totalServices) * 100) : 0;
              const isActive = hoveredKey === s.key;
              return (
                <div
                  key={s.key}
                  onMouseEnter={() => setHoveredKey(s.key)}
                  onMouseLeave={() => setHoveredKey(null)}
                  className={`p-2.5 rounded-md border transition-all cursor-default ${
                    isActive
                      ? 'bg-[#f4f8f5] border-[#1f5a49]'
                      : 'bg-[#fafbfa] border-[#e6ece7] hover:border-[#cdd8cf]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-xs shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="text-xs font-semibold text-[#1b2925] truncate">{s.label}</span>
                  </div>
                  <div className="mt-1.5 flex items-baseline justify-between font-mono tabular-nums">
                    <strong className="text-base font-bold text-[#1b2925]">{s.value}</strong>
                    <span className="text-xs font-semibold" style={{ color: s.value > 0 ? s.color : '#87938c' }}>
                      {pct}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Barra visual de Turnos */}
          <div className="pt-3 border-t border-[#edf1ee]">
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="font-bold text-[#1b2925]">Participación por Turno</span>
              <span className="font-mono tabular-nums text-[#68766f]">{shiftTotal} servicios</span>
            </div>

            <div className="h-3.5 w-full bg-[#eef2ef] rounded-sm overflow-hidden flex gap-0.5 mb-2.5">
              {shiftItems.map((sh) => {
                const pct = shiftTotal > 0 ? (sh.services / shiftTotal) * 100 : 0;
                if (pct <= 0) return null;
                return (
                  <div
                    key={sh.key}
                    style={{ width: `${pct}%`, backgroundColor: sh.color }}
                    className="h-full transition-all duration-300"
                    title={`${sh.label}: ${sh.services} (${Math.round(pct)}%)`}
                  />
                );
              })}
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs">
              {shiftItems.map((sh) => {
                const pct = shiftTotal > 0 ? Math.round((sh.services / shiftTotal) * 100) : 0;
                return (
                  <div key={sh.key} className="flex flex-col">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-xs shrink-0" style={{ backgroundColor: sh.color }} />
                      <span className="font-semibold text-[#1b2925]">{sh.label}</span>
                    </div>
                    <span className="text-[11px] font-mono tabular-nums text-[#4f5e55] pl-4">
                      {sh.services} ({pct}%) · {sh.guests} com.
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
