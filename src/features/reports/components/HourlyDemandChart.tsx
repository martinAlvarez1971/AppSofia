import { useState } from 'react';
import type { HourlyDemandPoint } from '../reports.types';
import { translateShift } from '../reports.utils';

interface HourlyDemandChartProps {
  data: HourlyDemandPoint[];
}

export function HourlyDemandChart({ data }: HourlyDemandChartProps) {
  const [showFullDay, setShowFullDay] = useState(false);
  const [hoveredHour, setHoveredHour] = useState<number | null>(null);

  const visibleData = showFullDay
    ? data
    : data.filter((pt) => {
        const isCoreWindow = (pt.hour >= 11 && pt.hour <= 23) || pt.hour <= 2;
        return isCoreWindow || pt.totalServices > 0;
      });

  const maxTotal = Math.max(1, ...visibleData.map((d) => d.totalServices));
  const peakPoint = visibleData.reduce<HourlyDemandPoint | null>(
    (best, cur) => (!best || cur.totalServices > best.totalServices ? cur : best),
    null,
  );

  const activeHover =
    hoveredHour !== null ? visibleData.find((d) => d.hour === hoveredHour) || null : null;

  const yTicks = [maxTotal, Math.ceil(maxTotal / 2), 0];

  return (
    <section className="bg-white border border-[#dce4dd] rounded-lg p-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#edf1ee]">
        <div>
          <h3 className="text-sm font-bold text-[#1b2925] font-['Manrope']">
            Demanda Horaria (Jornada Gastronómica BA)
          </h3>
          <p className="text-xs text-[#68766f] mt-0.5">
            Reservas vs. walk-ins hora por hora · sombreado por turno Almuerzo y Cena
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-3 text-xs text-[#4f5e55]">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <span className="w-3 h-3 rounded-xs bg-[#10b981]" />
              Reservas
            </span>
            <span className="inline-flex items-center gap-1.5 font-medium">
              <span className="w-3 h-3 rounded-xs bg-[#f59e0b]" />
              Walk-in
            </span>
          </div>

          <button
            type="button"
            onClick={() => setShowFullDay((prev) => !prev)}
            className="px-2.5 py-1 text-[11px] font-semibold text-[#1b2925] bg-[#f4f6f3] border border-[#dce4dd] rounded hover:bg-[#e8f1eb] transition-colors cursor-pointer whitespace-nowrap"
          >
            {showFullDay ? 'Ventana servicio' : '24 horas'}
          </button>
        </div>
      </div>

      {/* Franja de lectura interactiva */}
      <div className="flex flex-wrap items-center justify-between gap-2 py-2.5 px-3 mt-3 bg-[#f8faf8] border border-[#e6ece7] rounded text-xs">
        {activeHover ? (
          <div className="flex flex-wrap items-center gap-4 text-[#1b2925]">
            <span className="font-mono font-bold tabular-nums">{activeHover.hourLabel} hs</span>
            <span className="font-semibold text-[#2563eb]">{translateShift(activeHover.shift)}</span>
            <span className="font-mono tabular-nums text-[#059669]">
              Reservas: <strong>{activeHover.reservationsCount}</strong>
            </span>
            <span className="font-mono tabular-nums text-[#d97706]">
              Walk-in: <strong>{activeHover.walkInsCount}</strong>
            </span>
            <span className="font-mono tabular-nums">
              Comensales: <strong>{activeHover.guestsCount}</strong>
            </span>
          </div>
        ) : peakPoint && peakPoint.totalServices > 0 ? (
          <div className="flex flex-wrap items-center gap-3 text-[#4f5e55]">
            <span>
              Hora pico del período:{' '}
              <strong className="font-mono tabular-nums text-[#059669]">{peakPoint.hourLabel} hs</strong>
            </span>
            <span className="text-[#dce4dd]">|</span>
            <span className="font-mono tabular-nums text-[#1b2925]">
              <strong>{peakPoint.totalServices}</strong> servicios · <strong>{peakPoint.guestsCount}</strong> comensales
            </span>
          </div>
        ) : (
          <span className="text-[#68766f]">
            Sin servicios en la franja seleccionada · las barras crecerán automáticamente con cada reserva o walk-in.
          </span>
        )}
      </div>

      {/* Chart Canvas con eje Y */}
      <div className="mt-4 overflow-x-auto pb-1">
        <div className="flex items-stretch gap-2 min-w-[540px]">
          {/* Eje Y */}
          <div className="flex flex-col justify-between items-end pr-2 pb-6 pt-3 text-[10px] font-mono tabular-nums text-[#68766f] select-none w-7 shrink-0">
            {yTicks.map((tick, idx) => (
              <span key={idx}>{tick}</span>
            ))}
          </div>

          <div className="flex-1">
            <div
              className="relative grid items-end gap-1.5 h-44 pt-4 px-1 border-b border-l border-[#dce4dd]"
              style={{ gridTemplateColumns: `repeat(${visibleData.length}, minmax(0, 1fr))` }}
            >
              {/* Líneas horizontales de guía */}
              <div className="pointer-events-none absolute inset-x-0 top-4 border-t border-dashed border-[#eef2ef]" />
              <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-[#eef2ef]" />

              {visibleData.map((pt) => {
                const totalPct = (pt.totalServices / maxTotal) * 100;
                const resPct = pt.totalServices > 0 ? (pt.reservationsCount / pt.totalServices) * 100 : 0;
                const walkPct = pt.totalServices > 0 ? (pt.walkInsCount / pt.totalServices) * 100 : 0;
                const isHovered = hoveredHour === pt.hour;
                const shiftTint =
                  pt.shift === 'lunch'
                    ? 'bg-amber-50/60'
                    : pt.shift === 'dinner'
                      ? 'bg-blue-50/50'
                      : 'bg-transparent';

                return (
                  <div
                    key={pt.hour}
                    onMouseEnter={() => setHoveredHour(pt.hour)}
                    onMouseLeave={() => setHoveredHour(null)}
                    className={`relative z-10 flex flex-col items-center justify-end h-full px-0.5 rounded-t-xs transition-colors cursor-default ${shiftTint} ${
                      isHovered ? 'ring-1 ring-[#2563eb]/40 bg-emerald-50/70' : ''
                    }`}
                  >
                    <span
                      className={`text-[10px] font-mono font-bold tabular-nums mb-1 transition-opacity ${
                        pt.totalServices > 0 ? 'text-[#1b2925] opacity-100' : 'opacity-0'
                      }`}
                    >
                      {pt.totalServices > 0 ? pt.totalServices : '0'}
                    </span>

                    <div className="w-full max-w-[24px] flex-1 flex items-end">
                      <div
                        className="w-full rounded-t-sm overflow-hidden flex flex-col justify-end transition-all duration-300"
                        style={{
                          height: pt.totalServices > 0 ? `${Math.max(10, totalPct)}%` : '3px',
                          backgroundColor: pt.totalServices > 0 ? 'transparent' : '#e2e8e3',
                        }}
                      >
                        {pt.walkInsCount > 0 && (
                          <div className="w-full bg-[#f59e0b]" style={{ height: `${walkPct}%` }} />
                        )}
                        {pt.reservationsCount > 0 && (
                          <div className="w-full bg-[#10b981]" style={{ height: `${resPct}%` }} />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Etiquetas de hora + franja de turno */}
            <div
              className="grid gap-1.5 pt-2 px-1"
              style={{ gridTemplateColumns: `repeat(${visibleData.length}, minmax(0, 1fr))` }}
            >
              {visibleData.map((pt) => (
                <div key={pt.hour} className="text-center">
                  <div
                    className={`font-mono tabular-nums text-[10px] ${
                      hoveredHour === pt.hour ? 'font-bold text-[#059669]' : 'text-[#4f5e55]'
                    }`}
                  >
                    {String(pt.hour).padStart(2, '0')}
                  </div>
                  <div
                    className={`h-1 mx-auto mt-1 rounded-xs w-3/4 ${
                      pt.shift === 'lunch'
                        ? 'bg-[#f59e0b]/70'
                        : pt.shift === 'dinner'
                          ? 'bg-[#2563eb]/70'
                          : 'bg-transparent'
                    }`}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
