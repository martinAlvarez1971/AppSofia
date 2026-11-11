import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  FileSpreadsheet,
  LayoutGrid,
  RefreshCw,
  RotateCcw,
  Timer,
  Users,
  UtensilsCrossed,
} from 'lucide-react';
import { useAuth } from '../auth/auth.context';
import { reportsApi, ReportsApiError } from './reports.api';
import type { OperationalReportResponse, ReportsFilters, ShiftType } from './reports.types';
import {
  downloadReportCsv,
  formatDateTimeBa,
  formatDurationMinutes,
  getCurrentBuenosAiresOperationalDate,
  getMonthStartOperationalDate,
  shiftOperationalDate,
} from './reports.utils';
import { HourlyDemandChart } from './components/HourlyDemandChart';
import { DailyTrendChart } from './components/DailyTrendChart';
import { ServiceMixDonutChart } from './components/ServiceMixDonutChart';
import { SectorOccupancyChart } from './components/SectorOccupancyChart';
import { TableRotationTable } from './components/TableRotationTable';
import { SessionsLogTable } from './components/SessionsLogTable';

type ReportTab = 'overview' | 'rotation' | 'sessions';
type DatePreset = 'all' | 'today' | '7d' | '30d' | 'month' | 'custom';

export function ReportsPage() {
  const { session } = useAuth();
  const token = session?.access_token || '';

  const [activeTab, setActiveTab] = useState<ReportTab>('overview');
  const [preset, setPreset] = useState<DatePreset>('30d');
  const [filters, setFilters] = useState<ReportsFilters>(() => {
    const today = getCurrentBuenosAiresOperationalDate();
    return {
      startDate: shiftOperationalDate(today, -29),
      endDate: today,
      sector: undefined,
      shift: 'all',
    };
  });

  const [report, setReport] = useState<OperationalReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  const loadReport = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await reportsApi.getOverview(token, filters);
      setReport(data);
    } catch (err) {
      if (err instanceof ReportsApiError) {
        setError(err.message);
      } else {
        setError('No se pudo cargar el informe operativo del salón.');
      }
    } finally {
      setLoading(false);
    }
  }, [token, filters]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  function applyDatePreset(nextPreset: DatePreset) {
    setPreset(nextPreset);
    const today = getCurrentBuenosAiresOperationalDate();
    if (nextPreset === 'today') {
      setFilters((prev) => ({ ...prev, startDate: today, endDate: today }));
    } else if (nextPreset === '7d') {
      setFilters((prev) => ({ ...prev, startDate: shiftOperationalDate(today, -6), endDate: today }));
    } else if (nextPreset === '30d') {
      setFilters((prev) => ({ ...prev, startDate: shiftOperationalDate(today, -29), endDate: today }));
    } else if (nextPreset === 'month') {
      setFilters((prev) => ({ ...prev, startDate: getMonthStartOperationalDate(today), endDate: today }));
    } else if (nextPreset === 'all') {
      setFilters((prev) => ({ ...prev, startDate: undefined, endDate: undefined }));
    }
  }

  function resetAllFilters() {
    setPreset('all');
    setFilters({
      startDate: undefined,
      endDate: undefined,
      sector: undefined,
      shift: 'all',
    });
  }

  const availableSectors = useMemo(() => {
    if (report?.floorSnapshot.availableSectors.length) {
      return report.floorSnapshot.availableSectors;
    }
    return ['Salón Principal', 'Terraza Jardín', 'Barra & Sommelier'];
  }, [report]);

  const totalCombinedGuests = report
    ? report.reservations.totalGuests + report.sessions.totalWalkInGuests
    : 0;
  const totalCombinedServices = report
    ? report.reservations.total + report.sessions.walkInSessions
    : 0;

  const isPeriodEmpty =
    report !== null &&
    report.reservations.total === 0 &&
    report.sessions.totalSessions === 0;

  const hasNarrowingFilters = Boolean(
    filters.startDate || filters.endDate || filters.sector || (filters.shift && filters.shift !== 'all'),
  );

  function handleQuickExport(dataset: 'tables' | 'sessions' | 'daily') {
    if (!report) return;
    downloadReportCsv(report, dataset);
    setExportMenuOpen(false);
  }

  return (
    <div className="max-w-7xl mx-auto pb-14">
      {/* Encabezado Top Bar */}
      <div className="page-heading flex-col sm:flex-row items-start sm:items-end justify-between gap-4 mb-6">
        <div>
          <span className="eyebrow">OPERACIÓN / ESTADÍSTICAS E INFORMES</span>
          <h1>Informes Operativos</h1>
          <p>
            Ocupación del salón, rotación de mesas, demanda horaria y rendimiento de reservas y walk-ins.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="relative">
            <button
              type="button"
              disabled={!report || loading}
              onClick={() => setExportMenuOpen((prev) => !prev)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#1b2925] bg-white border border-[#dce4dd] rounded-md hover:bg-[#f8faf8] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download size={14} className="text-[#059669]" />
              Exportar CSV
            </button>

            {exportMenuOpen && report && (
              <div
                onMouseLeave={() => setExportMenuOpen(false)}
                className="absolute right-0 mt-1.5 w-52 bg-white border border-[#dce4dd] rounded-md shadow-md z-20 py-1"
              >
                <button
                  type="button"
                  onClick={() => handleQuickExport('daily')}
                  className="w-full px-3 py-2 text-left text-xs text-[#1b2925] hover:bg-[#f4f6f3] flex items-center gap-2 cursor-pointer"
                >
                  <FileSpreadsheet size={13} className="text-[#059669]" />
                  Evolución diaria (CSV)
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickExport('tables')}
                  className="w-full px-3 py-2 text-left text-xs text-[#1b2925] hover:bg-[#f4f6f3] flex items-center gap-2 cursor-pointer"
                >
                  <FileSpreadsheet size={13} className="text-[#2563eb]" />
                  Rotación por mesa (CSV)
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickExport('sessions')}
                  className="w-full px-3 py-2 text-left text-xs text-[#1b2925] hover:bg-[#f4f6f3] flex items-center gap-2 cursor-pointer"
                >
                  <FileSpreadsheet size={13} className="text-[#d97706]" />
                  Registro de sesiones (CSV)
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => void loadReport()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#059669] border border-[#047857] rounded-md hover:bg-[#047857] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            Actualizar
          </button>
        </div>
      </div>

      {/* Barra de Filtros Operativos */}
      <section className="bg-white border border-[#dce4dd] rounded-lg p-4 mb-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Presets rápidos de período */}
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'today', label: 'Hoy' },
                { id: '7d', label: '7 días' },
                { id: '30d', label: '30 días' },
                { id: 'month', label: 'Mes actual' },
                { id: 'all', label: 'Todo el histórico' },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => applyDatePreset(item.id)}
                className={`px-3 py-1.5 text-xs font-semibold rounded border transition-colors whitespace-nowrap cursor-pointer ${
                  preset === item.id
                    ? 'bg-[#059669] text-white border-[#047857]'
                    : 'bg-[#f8faf8] text-[#4f5e55] border-[#dce4dd] hover:bg-[#eef3ef]'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {/* Rango exacto + Sector + Turno */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs text-[#4f5e55]">
              <Calendar size={13} className="text-[#059669]" />
              <input
                type="date"
                aria-label="Fecha operativa desde"
                value={filters.startDate || ''}
                onChange={(e) => {
                  setPreset('custom');
                  setFilters((prev) => ({ ...prev, startDate: e.target.value || undefined }));
                }}
                className="py-1.5 px-2.5 text-xs font-mono tabular-nums bg-[#f8faf8] border border-[#dce4dd] rounded text-[#1b2925] outline-hidden focus:border-[#059669]"
              />
              <span className="text-[#68766f]">a</span>
              <input
                type="date"
                aria-label="Fecha operativa hasta"
                value={filters.endDate || ''}
                onChange={(e) => {
                  setPreset('custom');
                  setFilters((prev) => ({ ...prev, endDate: e.target.value || undefined }));
                }}
                className="py-1.5 px-2.5 text-xs font-mono tabular-nums bg-[#f8faf8] border border-[#dce4dd] rounded text-[#1b2925] outline-hidden focus:border-[#059669]"
              />
            </div>

            <select
              aria-label="Filtrar por sector"
              value={filters.sector || 'all'}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  sector: e.target.value === 'all' ? undefined : e.target.value,
                }))
              }
              className="py-1.5 px-2.5 text-xs bg-[#f8faf8] border border-[#dce4dd] rounded text-[#1b2925] outline-hidden focus:border-[#059669] cursor-pointer"
            >
              <option value="all">Todos los sectores</option>
              {availableSectors.map((sec) => (
                <option key={sec} value={sec}>
                  {sec}
                </option>
              ))}
            </select>

            <select
              aria-label="Filtrar por turno"
              value={filters.shift || 'all'}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  shift: e.target.value as ShiftType | 'all',
                }))
              }
              className="py-1.5 px-2.5 text-xs bg-[#f8faf8] border border-[#dce4dd] rounded text-[#1b2925] outline-hidden focus:border-[#059669] cursor-pointer"
            >
              <option value="all">Todos los turnos</option>
              <option value="lunch">Almuerzo (11:30–16:00)</option>
              <option value="dinner">Cena (19:30–01:30)</option>
              <option value="other">Fuera de turno</option>
            </select>

            {hasNarrowingFilters && (
              <button
                type="button"
                onClick={resetAllFilters}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-[#68766f] hover:text-[#dc2626] hover:bg-[#fff0ee] rounded transition-colors cursor-pointer"
                title="Limpiar filtros y ver histórico completo"
              >
                <RotateCcw size={13} />
                Limpiar
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Error Explícito */}
      {error && (
        <div
          role="alert"
          className="mb-6 p-4 bg-[#fff0ee] border border-[#f2bcba] rounded-lg text-[#9c3d36] text-xs flex items-center justify-between gap-4"
        >
          <div className="flex items-center gap-2.5">
            <AlertCircle size={16} className="shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => void loadReport()}
            className="font-bold underline hover:no-underline whitespace-nowrap cursor-pointer"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Grilla KPI Principal con acentos visuales vivos e intuitivos */}
      {loading && !report ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 bg-white border border-[#dce4dd] rounded-lg mb-6 overflow-hidden">
          {Array.from({ length: 5 }).map((_, idx) => (
            <div key={idx} className="p-4 border-b lg:border-b-0 lg:border-r last:border-r-0 border-[#edf1ee] animate-pulse">
              <div className="h-3 w-24 bg-[#edf1ee] rounded mb-3" />
              <div className="h-7 w-16 bg-[#e2e8e3] rounded mb-2" />
              <div className="h-3 w-32 bg-[#f3f6f4] rounded" />
            </div>
          ))}
        </div>
      ) : report ? (
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 bg-white border border-[#dce4dd] rounded-lg mb-6 overflow-hidden">
          <div className="p-4 border-b lg:border-b-0 sm:border-r border-[#edf1ee]">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#68766f]">
                Ocupación en Vivo
              </span>
              <span className="p-1.5 rounded bg-amber-50 text-[#d97706]">
                <UtensilsCrossed size={14} />
              </span>
            </div>
            <div className="mt-1.5 flex items-baseline gap-2">
              <strong className="text-2xl font-extrabold font-mono tabular-nums text-[#d97706]">
                {report.floorSnapshot.currentOccupancyPct}%
              </strong>
              <span className="text-xs font-mono tabular-nums text-[#4f5e55]">
                {report.floorSnapshot.occupiedTables}/{report.floorSnapshot.activeTables} mesas
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full bg-[#eef2ef] rounded-xs overflow-hidden">
              <div
                className="h-full bg-[#f59e0b]"
                style={{ width: `${Math.min(100, report.floorSnapshot.currentOccupancyPct)}%` }}
              />
            </div>
            <div className="mt-1.5 text-[11px] text-[#68766f] font-mono tabular-nums">
              {report.floorSnapshot.occupiedCapacity}/{report.floorSnapshot.totalActiveCapacity} cubiertos activos
            </div>
          </div>

          <div className="p-4 border-b lg:border-b-0 lg:border-r border-[#edf1ee]">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#68766f]">
                Servicios del Período
              </span>
              <span className="p-1.5 rounded bg-blue-50 text-[#2563eb]">
                <BarChart3 size={14} />
              </span>
            </div>
            <div className="mt-1.5 flex items-baseline gap-2">
              <strong className="text-2xl font-extrabold font-mono tabular-nums text-[#2563eb]">
                {totalCombinedServices.toLocaleString('es-AR')}
              </strong>
              <span className="text-xs text-[#4f5e55]">totales</span>
            </div>
            <div className="mt-2 text-[11px] text-[#4f5e55] font-mono tabular-nums">
              <span className="font-semibold text-[#059669]">{report.reservations.total}</span> reservas ·{' '}
              <span className="font-semibold text-[#d97706]">{report.sessions.walkInSessions}</span> walk-in
            </div>
          </div>

          <div className="p-4 border-b lg:border-b-0 sm:border-r border-[#edf1ee]">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#68766f]">
                Comensales Totales
              </span>
              <span className="p-1.5 rounded bg-purple-50 text-[#7c3aed]">
                <Users size={14} />
              </span>
            </div>
            <div className="mt-1.5 flex items-baseline gap-2">
              <strong className="text-2xl font-extrabold font-mono tabular-nums text-[#7c3aed]">
                {totalCombinedGuests.toLocaleString('es-AR')}
              </strong>
              <span className="text-xs font-mono tabular-nums text-[#4f5e55]">
                prom. {report.reservations.avgPartySize}
              </span>
            </div>
            <div className="mt-2 text-[11px] text-[#68766f] font-mono tabular-nums">
              {report.reservations.completedGuests} finalizados · {report.sessions.totalWalkInGuests} walk-in
            </div>
          </div>

          <div className="p-4 border-b sm:border-b-0 lg:border-r border-[#edf1ee]">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#68766f]">
                Cumplimiento Reservas
              </span>
              <span className="p-1.5 rounded bg-emerald-50 text-[#059669]">
                <CheckCircle2 size={14} />
              </span>
            </div>
            <div className="mt-1.5 flex items-baseline gap-2">
              <strong className="text-2xl font-extrabold font-mono tabular-nums text-[#059669]">
                {report.reservations.completionRatePct}%
              </strong>
              <span className="text-xs font-mono tabular-nums text-[#4f5e55]">
                {report.reservations.completed} fin.
              </span>
            </div>
            <div className="mt-2 text-[11px] font-mono tabular-nums text-[#68766f]">
              No-show <span className="text-[#9333ea] font-semibold">{report.reservations.noShowRatePct}%</span> · Canc.{' '}
              <span className="text-[#ef4444] font-semibold">{report.reservations.cancellationRatePct}%</span>
            </div>
          </div>

          <div className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#68766f]">
                Estadía Real Promedio
              </span>
              <span className="p-1.5 rounded bg-cyan-50 text-[#0891b2]">
                <Timer size={14} />
              </span>
            </div>
            <div className="mt-1.5 flex items-baseline gap-2">
              <strong className="text-2xl font-extrabold font-mono tabular-nums text-[#0891b2]">
                {report.sessions.avgActualDurationMinutes > 0
                  ? `${report.sessions.avgActualDurationMinutes}m`
                  : '—'}
              </strong>
              <span className="text-xs font-mono tabular-nums text-[#68766f]">
                est. {report.sessions.avgExpectedDurationMinutes || report.operationalSettings.defaultReservationDurationMinutes}m
              </span>
            </div>
            <div className="mt-2 text-[11px] font-mono tabular-nums text-[#68766f]">
              {report.sessions.overrunSessionsCount} excedidas · {report.sessions.openSessions} abiertas
            </div>
          </div>
        </section>
      ) : null}

      {/* Navegación por Sub-Vistas */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="inline-flex items-center gap-1 p-1 bg-white border border-[#dce4dd] rounded-lg">
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'overview'
                ? 'bg-[#059669] text-white'
                : 'text-[#5a6961] hover:text-[#1b2925]'
            }`}
          >
            <BarChart3 size={14} />
            Resumen Ejecutivo
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('rotation')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'rotation'
                ? 'bg-[#059669] text-white'
                : 'text-[#5a6961] hover:text-[#1b2925]'
            }`}
          >
            <LayoutGrid size={14} />
            Ocupación y Rotación
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('sessions')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'sessions'
                ? 'bg-[#059669] text-white'
                : 'text-[#5a6961] hover:text-[#1b2925]'
            }`}
          >
            <Clock size={14} />
            Sesiones y Walk-ins
          </button>
        </div>

        {report && (
          <span className="text-[11px] font-mono tabular-nums text-[#68766f]">
            Corte: {formatDateTimeBa(report.generatedAt)} · Parámetros: {report.operationalSettings.defaultReservationDurationMinutes}m res / {report.operationalSettings.defaultWalkInDurationMinutes}m w/i / {report.operationalSettings.reservationBufferMinutes}m buffer
          </span>
        )}
      </div>

      {/* Aviso de Período sin Actividad + Botón con contraste garantizado */}
      {!loading && isPeriodEmpty && activeTab !== 'rotation' && (
        <section className="bg-white border border-[#dce4dd] rounded-lg p-6 mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-[#ecfdf5] border border-[#a7f3d0] flex items-center justify-center text-[#059669] shrink-0">
              <UtensilsCrossed size={19} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#1b2925] font-['Manrope']">
                Sin reservas ni sesiones registradas en este período
              </h3>
              <p className="text-xs text-[#68766f] mt-0.5 leading-relaxed max-w-xl">
                Abajo podés ver el estado actual del salón y las métricas disponibles. Cuando registres reservas o walk-ins en tus mesas, los gráficos se completarán automáticamente.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {hasNarrowingFilters && (
              <button
                type="button"
                onClick={resetAllFilters}
                className="px-3.5 py-2 text-xs font-bold text-[#047857] bg-[#ecfdf5] border border-[#6ee7b7] rounded-md hover:bg-[#d1fae5] cursor-pointer whitespace-nowrap"
              >
                Ver histórico completo
              </button>
            )}
            <Link
              to="/tables"
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold !text-white bg-[#059669] hover:bg-[#047857] border border-[#047857] rounded-md no-underline whitespace-nowrap"
              style={{ color: '#ffffff' }}
            >
              Ir a Mesas y Salón
              <ArrowRight size={14} />
            </Link>
          </div>
        </section>
      )}

      {report ? (
        <>
          {/* TAB 1: RESUMEN EJECUTIVO */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Fila 1: Gráficos Donut de Resultados + Estado de Salón por Sector */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <ServiceMixDonutChart
                  reservations={report.reservations}
                  walkInSessions={report.sessions.walkInSessions}
                  shifts={report.shifts}
                />
                <SectorOccupancyChart
                  floorSnapshot={report.floorSnapshot}
                  sectorMetrics={report.sectorMetrics}
                />
              </div>

              {/* Fila 2: Demanda Horaria y Evolución Diaria */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <HourlyDemandChart data={report.hourlyDemand} />
                <DailyTrendChart data={report.dailySeries} />
              </div>

              {/* Fila 3: Desglose Estructurado de Turnos y Motivos de Cierre */}
              <section className="grid grid-cols-1 lg:grid-cols-2 bg-white border border-[#dce4dd] rounded-lg overflow-hidden">
                <div className="p-5 border-b lg:border-b-0 lg:border-r border-[#edf1ee]">
                  <h3 className="text-sm font-bold text-[#1b2925] font-['Manrope'] mb-3">
                    Detalle Numérico por Turno
                  </h3>
                  <div className="divide-y divide-[#edf1ee] text-xs">
                    {(
                      [
                        { key: 'lunch', label: 'Almuerzo (11:30–16:00)', dot: '#f59e0b' },
                        { key: 'dinner', label: 'Cena (19:30–01:30)', dot: '#2563eb' },
                        { key: 'other', label: 'Fuera de turno', dot: '#8b5cf6' },
                      ] as const
                    ).map((row) => {
                      const item = report.shifts[row.key];
                      return (
                        <div key={row.key} className="py-2.5 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5">
                            <span className="w-2.5 h-2.5 rounded-xs shrink-0" style={{ backgroundColor: row.dot }} />
                            <div>
                              <div className="font-semibold text-[#1b2925]">{row.label}</div>
                              <div className="text-[11px] font-mono tabular-nums text-[#68766f]">
                                {item.reservations} res. · {item.walkIns} w/i · {item.guests} comensales
                              </div>
                            </div>
                          </div>
                          <div className="text-right font-mono tabular-nums font-bold text-[#1b2925]">
                            {item.avgDurationMinutes > 0
                              ? formatDurationMinutes(item.avgDurationMinutes)
                              : '—'}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="p-5">
                  <h3 className="text-sm font-bold text-[#1b2925] font-['Manrope'] mb-3">
                    Motivos de Cierre de Mesa y Operaciones
                  </h3>
                  <div className="divide-y divide-[#edf1ee] text-xs">
                    <div className="py-2.5 flex items-center justify-between">
                      <span className="text-[#4f5e55]">Servicio de reserva finalizado</span>
                      <strong className="font-mono tabular-nums text-[#059669]">
                        {report.sessions.closeReasons.service_completed}
                      </strong>
                    </div>
                    <div className="py-2.5 flex items-center justify-between">
                      <span className="text-[#4f5e55]">Walk-in cerrado normalmente</span>
                      <strong className="font-mono tabular-nums text-[#d97706]">
                        {report.sessions.closeReasons.walk_in_closed}
                      </strong>
                    </div>
                    <div className="py-2.5 flex items-center justify-between">
                      <span className="text-[#4f5e55]">Liberación operativa</span>
                      <strong className="font-mono tabular-nums text-[#2563eb]">
                        {report.sessions.closeReasons.operational_release}
                      </strong>
                    </div>
                    <div className="py-2.5 flex items-center justify-between">
                      <span className="text-[#4f5e55]">Cancelación con mesa sentada</span>
                      <strong className="font-mono tabular-nums text-[#ef4444]">
                        {report.sessions.closeReasons.reservation_cancelled}
                      </strong>
                    </div>
                    <div className="py-2.5 flex items-center justify-between">
                      <span className="text-[#4f5e55]">Reservas con unión de mesas</span>
                      <strong className="font-mono tabular-nums text-[#7c3aed]">
                        {report.reservations.multiTableReservationsCount}
                      </strong>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          )}

          {/* TAB 2: OCUPACIÓN Y ROTACIÓN */}
          {activeTab === 'rotation' && (
            <div className="space-y-6">
              <SectorOccupancyChart
                floorSnapshot={report.floorSnapshot}
                sectorMetrics={report.sectorMetrics}
              />

              {/* Tabla de Sectores */}
              <section className="bg-white border border-[#dce4dd] rounded-lg overflow-hidden">
                <div className="px-5 py-3.5 border-b border-[#dce4dd] bg-[#f8faf8] flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-[#1b2925] font-['Manrope']">
                      Capacidad y Rotación por Sector
                    </h3>
                    <p className="text-xs text-[#68766f]">
                      Índice de rotación calculado como sesiones físicas atendidas sobre mesas activas del sector
                    </p>
                  </div>
                </div>

                {report.sectorMetrics.length === 0 ? (
                  <div className="py-10 text-center text-xs text-[#68766f]">
                    No hay sectores configurados en el salón.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-[#dce4dd] bg-[#f8faf8] text-[#68766f] uppercase tracking-wider text-[10px] font-bold">
                          <th className="h-10 px-4 text-left">Sector</th>
                          <th className="h-10 px-4 text-right">Mesas Activas</th>
                          <th className="h-10 px-4 text-right">Plazas Activas</th>
                          <th className="h-10 px-4 text-right">Reservas</th>
                          <th className="h-10 px-4 text-right">Sesiones (Walk-in)</th>
                          <th className="h-10 px-4 text-right">Comensales</th>
                          <th className="h-10 px-4 text-right">Estadía Prom.</th>
                          <th className="h-10 px-4 text-right">Rotación / Mesa</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.sectorMetrics.map((sec) => (
                          <tr
                            key={sec.sector}
                            className="h-10 border-b border-[#edf1ee] last:border-b-0 hover:bg-[#f8faf8]"
                          >
                            <td className="px-4 font-semibold text-[#1b2925]">{sec.sector}</td>
                            <td className="px-4 text-right font-mono tabular-nums text-[#4f5e55]">
                              {sec.activeTablesCount}/{sec.tablesCount}
                            </td>
                            <td className="px-4 text-right font-mono tabular-nums text-[#4f5e55]">
                              {sec.totalCapacity}
                            </td>
                            <td className="px-4 text-right font-mono tabular-nums font-semibold text-[#059669]">
                              {sec.reservationsCount}
                            </td>
                            <td className="px-4 text-right font-mono tabular-nums text-[#1b2925]">
                              {sec.sessionsCount}{' '}
                              <span className="text-[#d97706]">({sec.walkInSessionsCount} w/i)</span>
                            </td>
                            <td className="px-4 text-right font-mono tabular-nums font-semibold text-[#1b2925]">
                              {sec.totalGuests.toLocaleString('es-AR')}
                            </td>
                            <td className="px-4 text-right font-mono tabular-nums text-[#4f5e55]">
                              {sec.avgDurationMinutes > 0
                                ? formatDurationMinutes(sec.avgDurationMinutes)
                                : '—'}
                            </td>
                            <td className="px-4 text-right font-mono tabular-nums font-bold text-[#059669]">
                              {sec.rotationRate.toFixed(2)}x
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <TableRotationTable tables={report.tableMetrics} />
            </div>
          )}

          {/* TAB 3: SESIONES Y WALK-INS */}
          {activeTab === 'sessions' && (
            <div className="space-y-6">
              <SessionsLogTable sessions={report.recentSessions} />
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
