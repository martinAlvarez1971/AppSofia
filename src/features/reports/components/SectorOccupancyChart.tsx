import type { OperationalReportResponse } from '../reports.types';

interface SectorOccupancyChartProps {
  floorSnapshot: OperationalReportResponse['floorSnapshot'];
  sectorMetrics: OperationalReportResponse['sectorMetrics'];
}

const SECTOR_COLORS = ['#059669', '#2563eb', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899'];

export function SectorOccupancyChart({
  floorSnapshot,
  sectorMetrics,
}: SectorOccupancyChartProps) {
  const maxSectorServices = Math.max(
    1,
    ...sectorMetrics.map((s) => s.reservationsCount + s.walkInSessionsCount),
  );

  const floorSegments = [
    { label: 'Ocupadas', count: floorSnapshot.occupiedTables, color: '#f59e0b' },
    { label: 'Reservadas', count: floorSnapshot.reservedTables, color: '#2563eb' },
    { label: 'Libres', count: floorSnapshot.availableTables, color: '#10b981' },
    { label: 'Fuera de servicio', count: floorSnapshot.outOfServiceTables, color: '#ef4444' },
  ];

  const totalTables = Math.max(1, floorSnapshot.totalTables);

  return (
    <section className="bg-white border border-[#dce4dd] rounded-lg p-5">
      <div className="pb-4 border-b border-[#edf1ee] flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-[#1b2925] font-['Manrope']">
            Estado del Salón y Demanda por Sector
          </h3>
          <p className="text-xs text-[#68766f] mt-0.5">
            Distribución instantánea de mesas físicas y volumen acumulado por zona
          </p>
        </div>
        <span className="text-xs font-mono tabular-nums font-bold text-[#047857]">
          {floorSnapshot.totalTables} mesas · {floorSnapshot.totalActiveCapacity} plazas activas
        </span>
      </div>

      {/* Mapa Visual Instantáneo de Mesas */}
      <div className="mt-4 p-3.5 bg-[#f8faf8] border border-[#e6ece7] rounded-md">
        <div className="flex items-center justify-between text-xs mb-2">
          <span className="font-bold text-[#1b2925]">Composición Actual de Mesas</span>
          <span className="font-mono tabular-nums font-semibold text-[#1b2925]">
            {floorSnapshot.currentOccupancyPct}% ocupación activa
          </span>
        </div>

        <div className="h-4 w-full bg-[#e6ece7] rounded-sm overflow-hidden flex gap-0.5">
          {floorSnapshot.totalTables > 0 &&
            floorSegments.map((seg) => {
              const pct = (seg.count / totalTables) * 100;
              if (pct <= 0) return null;
              return (
                <div
                  key={seg.label}
                  style={{ width: `${pct}%`, backgroundColor: seg.color }}
                  className="h-full transition-all duration-300"
                  title={`${seg.label}: ${seg.count} mesas (${Math.round(pct)}%)`}
                />
              );
            })}
        </div>

        <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          {floorSegments.map((seg) => (
            <div key={seg.label} className="flex items-center justify-between bg-white px-2.5 py-1.5 rounded border border-[#e6ece7]">
              <span className="inline-flex items-center gap-1.5 text-[#4f5e55] font-medium">
                <span className="w-2.5 h-2.5 rounded-xs shrink-0" style={{ backgroundColor: seg.color }} />
                {seg.label}
              </span>
              <strong className="font-mono tabular-nums text-[#1b2925]">{seg.count}</strong>
            </div>
          ))}
        </div>
      </div>

      {/* Barras Comparativas por Sector */}
      <div className="mt-5 space-y-3.5">
        {sectorMetrics.length === 0 ? (
          <p className="text-xs text-[#68766f] text-center py-4">
            Aún no hay sectores configurados en el salón.
          </p>
        ) : (
          sectorMetrics.map((sec, idx) => {
            const totalServices = sec.reservationsCount + sec.walkInSessionsCount;
            const widthPct = totalServices > 0 ? Math.max(6, (totalServices / maxSectorServices) * 100) : 0;
            const color = SECTOR_COLORS[idx % SECTOR_COLORS.length];

            return (
              <div key={sec.sector} className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-xs shrink-0" style={{ backgroundColor: color }} />
                    <span className="font-bold text-[#1b2925]">{sec.sector}</span>
                    <span className="text-[11px] font-mono tabular-nums text-[#68766f]">
                      ({sec.activeTablesCount}/{sec.tablesCount} mesas · {sec.totalCapacity} plazas)
                    </span>
                  </div>
                  <div className="flex items-center gap-3 font-mono tabular-nums text-[11px]">
                    <span className="text-[#4f5e55]">
                      <strong className="text-[#1b2925]">{totalServices}</strong> servicios
                    </span>
                    <span className="text-[#4f5e55]">
                      <strong className="text-[#1b2925]">{sec.totalGuests}</strong> comensales
                    </span>
                    <span className="font-bold px-1.5 py-0.5 rounded bg-[#eef6f1] text-[#047857]">
                      {sec.rotationRate.toFixed(2)}x rot.
                    </span>
                  </div>
                </div>

                <div className="h-3 w-full bg-[#eef2ef] rounded-sm overflow-hidden">
                  <div
                    className="h-full rounded-sm transition-all duration-500"
                    style={{
                      width: `${widthPct}%`,
                      backgroundColor: color,
                    }}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
