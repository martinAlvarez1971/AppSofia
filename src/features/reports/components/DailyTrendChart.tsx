import { useState } from 'react';
import type { DailySeriesPoint } from '../reports.types';
import { formatShortDate } from '../reports.utils';

interface DailyTrendChartProps {
  data: DailySeriesPoint[];
}

export function DailyTrendChart({ data }: DailyTrendChartProps) {
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);

  const sliced = data.length > 21 ? data.slice(data.length - 21) : data;
  const maxVolume = Math.max(1, ...sliced.map((d) => d.reservationsCount + d.walkInsCount));
  const hovered = hoveredDate ? sliced.find((d) => d.date === hoveredDate) || null : null;
  const yTicks = [maxVolume, Math.ceil(maxVolume / 2), 0];

  return (
    <section className="bg-white border border-[#dce4dd] rounded-lg p-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#edf1ee]">
        <div>
          <h3 className="text-sm font-bold text-[#1b2925] font-['Manrope']">
            Evolución Diaria de Servicios
          </h3>
          <p className="text-xs text-[#68766f] mt-0.5">
            {data.length > 21
              ? `Últimas 21 fechas operativas de ${data.length} con actividad`
              : 'Resultado diario por fecha operativa gastronómica'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs text-[#4f5e55]">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <span className="w-3 h-3 rounded-xs bg-[#10b981]" />
            Finalizadas
          </span>
          <span className="inline-flex items-center gap-1.5 font-medium">
            <span className="w-3 h-3 rounded-xs bg-[#2563eb]" />
            Activas
          </span>
          <span className="inline-flex items-center gap-1.5 font-medium">
            <span className="w-3 h-3 rounded-xs bg-[#f59e0b]" />
            Walk-in
          </span>
          <span className="inline-flex items-center gap-1.5 font-medium">
            <span className="w-3 h-3 rounded-xs bg-[#ef4444]" />
            Canc./No-show
          </span>
        </div>
      </div>

      {sliced.length === 0 ? (
        <div className="py-12 text-center text-xs text-[#68766f]">
          No hay jornadas operativas con reservas o sesiones en el rango seleccionado.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 py-2.5 px-3 mt-3 bg-[#f8faf8] border border-[#e6ece7] rounded text-xs">
            {hovered ? (
              <div className="flex flex-wrap items-center gap-4 text-[#1b2925]">
                <span className="font-mono font-bold tabular-nums">{hovered.date}</span>
                <span className="font-mono tabular-nums text-[#2563eb]">
                  Reservas: <strong>{hovered.reservationsCount}</strong>
                </span>
                <span className="font-mono tabular-nums text-[#059669]">
                  Finalizadas: <strong>{hovered.completedCount}</strong>
                </span>
                <span className="font-mono tabular-nums text-[#d97706]">
                  Walk-in: <strong>{hovered.walkInsCount}</strong>
                </span>
                <span className="font-mono tabular-nums text-[#ef4444]">
                  Canc/No-show: <strong>{hovered.cancelledCount + hovered.noShowCount}</strong>
                </span>
                <span className="font-mono tabular-nums">
                  Comensales: <strong>{hovered.totalGuests}</strong>
                </span>
              </div>
            ) : (
              <span className="text-[#68766f]">
                Pasá el cursor sobre una barra para ver el detalle completo de esa fecha.
              </span>
            )}
          </div>

          <div className="mt-4 overflow-x-auto pb-1">
            <div className="flex items-stretch gap-2 min-w-[460px]">
              <div className="flex flex-col justify-between items-end pr-2 pb-6 pt-3 text-[10px] font-mono tabular-nums text-[#68766f] select-none w-7 shrink-0">
                {yTicks.map((tick, idx) => (
                  <span key={idx}>{tick}</span>
                ))}
              </div>

              <div className="flex-1">
                <div
                  className="relative grid items-end gap-2 h-44 pt-4 px-1 border-b border-l border-[#dce4dd]"
                  style={{ gridTemplateColumns: `repeat(${sliced.length}, minmax(0, 1fr))` }}
                >
                  <div className="pointer-events-none absolute inset-x-0 top-4 border-t border-dashed border-[#eef2ef]" />
                  <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-[#eef2ef]" />

                  {sliced.map((d) => {
                    const total = d.reservationsCount + d.walkInsCount;
                    const cancelledOrNoShow = d.cancelledCount + d.noShowCount;
                    const remainingRes = Math.max(0, d.reservationsCount - d.completedCount - cancelledOrNoShow);
                    const heightPct = (total / maxVolume) * 100;

                    return (
                      <div
                        key={d.date}
                        onMouseEnter={() => setHoveredDate(d.date)}
                        onMouseLeave={() => setHoveredDate(null)}
                        className="relative z-10 flex flex-col items-center justify-end h-full cursor-default"
                      >
                        <span className="text-[10px] font-mono font-bold tabular-nums text-[#1b2925] mb-1">
                          {total}
                        </span>
                        <div className="w-full max-w-[28px] flex-1 flex items-end">
                          <div
                            className={`w-full rounded-t-sm overflow-hidden flex flex-col justify-end transition-all duration-300 ${
                              hoveredDate === d.date ? 'ring-2 ring-[#2563eb]/40' : ''
                            }`}
                            style={{ height: `${Math.max(10, heightPct)}%` }}
                          >
                            {cancelledOrNoShow > 0 && (
                              <div
                                className="w-full bg-[#ef4444]"
                                style={{ height: `${(cancelledOrNoShow / total) * 100}%` }}
                              />
                            )}
                            {d.walkInsCount > 0 && (
                              <div
                                className="w-full bg-[#f59e0b]"
                                style={{ height: `${(d.walkInsCount / total) * 100}%` }}
                              />
                            )}
                            {remainingRes > 0 && (
                              <div
                                className="w-full bg-[#2563eb]"
                                style={{ height: `${(remainingRes / total) * 100}%` }}
                              />
                            )}
                            {d.completedCount > 0 && (
                              <div
                                className="w-full bg-[#10b981]"
                                style={{ height: `${(d.completedCount / total) * 100}%` }}
                              />
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div
                  className="grid gap-2 pt-2 px-1"
                  style={{ gridTemplateColumns: `repeat(${sliced.length}, minmax(0, 1fr))` }}
                >
                  {sliced.map((d) => (
                    <div
                      key={d.date}
                      className={`text-center font-mono tabular-nums text-[10px] truncate ${
                        hoveredDate === d.date ? 'font-bold text-[#2563eb]' : 'text-[#4f5e55]'
                      }`}
                    >
                      {formatShortDate(d.date)}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
