import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../auth/auth.context';
import { reservationsApi } from './reservations.api';
import type {
  ReservationQueryFilters,
  ReservationOverviewStats,
  SearchResponse,
  CalendarResponse,
  CustomersResponse,
  ReservationQueryResult,
} from './reservations.types';
import { ReservationFilterBar } from './components/ReservationFilterBar';
import { OverviewSection } from './components/OverviewSection';
import { ReservationsTableSection } from './components/ReservationsTableSection';
import { ReservationsCalendarSection } from './components/ReservationsCalendarSection';
import { CustomersSection } from './components/CustomersSection';
import { ReservationDetailDrawer } from './components/ReservationDetailDrawer';
import {
  CalendarDays,
  LayoutDashboard,
  TableProperties,
  UsersRound,
  RefreshCw,
  ShieldCheck,
  AlertCircle,
} from 'lucide-react';

export function ReservationsQueryPage() {
  const { session, profile } = useAuth();
  const token = session?.access_token || '';

  // Tab activo: 'overview' | 'table' | 'calendar' | 'customers'
  const [activeTab, setActiveTab] = useState<'overview' | 'table' | 'calendar' | 'customers'>('overview');

  // Filtros unificados
  const [filters, setFilters] = useState<ReservationQueryFilters>({
    sortBy: 'startTime',
    sortOrder: 'desc',
    page: 1,
    limit: 20,
  });

  // Estados de datos
  const [overviewStats, setOverviewStats] = useState<ReservationOverviewStats | null>(null);
  const [searchData, setSearchData] = useState<SearchResponse | null>(null);
  const [calendarData, setCalendarData] = useState<CalendarResponse | null>(null);
  const [customersData, setCustomersData] = useState<CustomersResponse | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');

  // Reserva seleccionada para el Drawer de Detalle
  const [selectedReservationId, setSelectedReservationId] = useState<string | null>(null);

  // Estados de carga y error
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Carga de datos según el tab activo
  const loadData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);

    try {
      if (activeTab === 'overview') {
        const stats = await reservationsApi.getOverview(token, filters);
        setOverviewStats(stats);
      } else if (activeTab === 'table') {
        const [searchRes, statsRes] = await Promise.all([
          reservationsApi.search(token, filters),
          reservationsApi.getOverview(token, filters),
        ]);
        setSearchData(searchRes);
        setOverviewStats(statsRes);
      } else if (activeTab === 'calendar') {
        const calRes = await reservationsApi.getCalendar(token, filters);
        setCalendarData(calRes);
      } else if (activeTab === 'customers') {
        const custRes = await reservationsApi.getCustomers(token, {
          q: customerSearch || undefined,
          page: 1,
          limit: 50,
        });
        setCustomersData(custRes);
      }
    } catch (err: any) {
      setError(err.message || 'Error al recuperar información de reservas.');
    } finally {
      setLoading(false);
    }
  }, [token, activeTab, filters, customerSearch]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Manejo de actualización de filtros
  const handleFilterChange = (updated: Partial<ReservationQueryFilters>) => {
    setFilters((prev) => ({ ...prev, ...updated }));
  };

  const handleResetFilters = () => {
    setFilters({
      sortBy: 'startTime',
      sortOrder: 'desc',
      page: 1,
      limit: 20,
    });
  };

  const handleCustomerSelect = (clientKey: string, customerName: string) => {
    // Al hacer click en ver reservas de un cliente, cambiar a tabla con búsqueda
    setFilters({
      q: customerName,
      page: 1,
      limit: 20,
      sortBy: 'startTime',
      sortOrder: 'desc',
    });
    setActiveTab('table');
  };

  return (
    <div className="content-wrap max-w-7xl mx-auto pb-16">
      {/* Encabezado de la Página */}
      <div className="page-heading flex-col sm:flex-row items-start sm:items-end justify-between gap-4 mb-6">
        <div>
          <span className="eyebrow uppercase font-bold text-xs tracking-wider text-[#1f5a49]">
            Módulo Consultivo y Analítico
          </span>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#1b2925] font-['Manrope'] mt-1">
            Consultas de Reservas
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">
            Inspección histórica, indicadores gastronómicos, calendario y fidelidad de clientes en tiempo real.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-50 text-[#174639] border border-emerald-200">
            <ShieldCheck size={14} />
            Solo Lectura
          </span>
          <button
            type="button"
            onClick={loadData}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 shadow-2xs transition-all cursor-pointer disabled:opacity-50"
            title="Actualizar datos"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span>Actualizar</span>
          </button>
        </div>
      </div>

      {/* Banner de Error si ocurre */}
      {error && (
        <div className="mb-6 p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle size={16} className="text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={loadData}
            className="text-xs font-bold text-rose-900 underline hover:no-underline ml-4"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Barra de Sub-Navegación / Tabs */}
      <div className="flex items-center gap-1 p-1 bg-gray-100 rounded-xl mb-6 max-w-fit border border-gray-200">
        <button
          type="button"
          onClick={() => setActiveTab('overview')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
            activeTab === 'overview'
              ? 'bg-white text-[#174639] shadow-xs'
              : 'text-gray-600 hover:text-black'
          }`}
        >
          <LayoutDashboard size={15} />
          <span>Resumen</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('table')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
            activeTab === 'table'
              ? 'bg-white text-[#174639] shadow-xs'
              : 'text-gray-600 hover:text-black'
          }`}
        >
          <TableProperties size={15} />
          <span>Reservas</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('calendar')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
            activeTab === 'calendar'
              ? 'bg-white text-[#174639] shadow-xs'
              : 'text-gray-600 hover:text-black'
          }`}
        >
          <CalendarDays size={15} />
          <span>Calendario</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('customers')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
            activeTab === 'customers'
              ? 'bg-white text-[#174639] shadow-xs'
              : 'text-gray-600 hover:text-black'
          }`}
        >
          <UsersRound size={15} />
          <span>Clientes</span>
        </button>
      </div>

      {/* Barra de Filtros Unificada (aplica a Resumen, Reservas y Calendario) */}
      {activeTab !== 'customers' && (
        <ReservationFilterBar
          filters={filters}
          onChange={handleFilterChange}
          onReset={handleResetFilters}
        />
      )}

      {/* Contenido según el Tab Activo */}
      {activeTab === 'overview' && (
        <OverviewSection
          stats={overviewStats}
          loading={loading}
          onNavigateToTab={(tab) => setActiveTab(tab)}
        />
      )}

      {activeTab === 'table' && (
        <ReservationsTableSection
          reservations={searchData?.data || []}
          totalCount={searchData?.total_count || 0}
          page={filters.page || 1}
          limit={filters.limit || 20}
          totalPages={searchData?.total_pages || 1}
          loading={loading}
          filters={filters}
          onFilterChange={handleFilterChange}
          onSelectReservation={(r) => setSelectedReservationId(r.id)}
        />
      )}

      {activeTab === 'calendar' && (
        <ReservationsCalendarSection
          calendarData={calendarData}
          loading={loading}
          onSelectReservation={(r) => setSelectedReservationId(r.id)}
          onDateRangeChange={(startDate, endDate) => {
            handleFilterChange({ startDate, endDate });
          }}
        />
      )}

      {activeTab === 'customers' && (
        <CustomersSection
          customersData={customersData}
          loading={loading}
          searchQuery={customerSearch}
          onSearchChange={setCustomerSearch}
          onSelectCustomerReservations={handleCustomerSelect}
        />
      )}

      {/* Drawer Lateral de Detalle Histórico de Reserva */}
      <ReservationDetailDrawer
        reservationId={selectedReservationId}
        token={token}
        onClose={() => setSelectedReservationId(null)}
      />
    </div>
  );
}
