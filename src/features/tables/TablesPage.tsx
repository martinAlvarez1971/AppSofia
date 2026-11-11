import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Armchair,
  Ban,
  CheckCircle2,
  Clock,
  Filter,
  Grid3X3,
  List,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Users,
} from 'lucide-react'
import { useAuth } from '../auth/auth.context'
import { supabase } from '../../lib/supabase'
import {
  changeTableStatus,
  createReservation,
  createTable,
  listTables,
  TablesApiError,
  toggleTableService,
  updateTable,
  updateTableOccupancy,
} from './tables.api'
import type {
  CreateReservationInput,
  CreateTableInput,
  RestaurantTable,
  TableOccupancy,
} from './tables.types'
import { TableCard } from './components/TableCard'
import { TableModal } from './components/TableModal'
import { TableDetailModal } from './components/TableDetailModal'
import { MultiTableSelectorBar } from './components/MultiTableSelectorBar'

export function TablesPage() {
  const { profile, session, signOut } = useAuth()
  const token = session?.access_token
  const isSuperAdmin = profile?.role === 'super_admin'

  const [tables, setTables] = useState<RestaurantTable[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  // Filters & View State
  const [search, setSearch] = useState('')
  const [sectorFilter, setSectorFilter] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [minCapacityFilter, setMinCapacityFilter] = useState('ALL')
  const [viewMode, setViewMode] = useState<'map' | 'list'>('map')

  // Modals & Selection
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingTable, setEditingTable] = useState<RestaurantTable | null>(null)
  const [detailTable, setDetailTable] = useState<RestaurantTable | null>(null)
  const [selectedTableIds, setSelectedTableIds] = useState<string[]>([])

  const loadTables = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError('')
    try {
      const data = await listTables(token)
      setTables(data)
    } catch (err) {
      if (err instanceof TablesApiError && err.status === 401) {
        await signOut()
        return
      }
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las mesas.')
    } finally {
      setLoading(false)
    }
  }, [token, signOut])

  useEffect(() => {
    void loadTables()
  }, [loadTables])

  // Realtime subscription (PostgreSQL changes via Supabase Realtime)
  useEffect(() => {
    const client = supabase
    if (!client) return
    const channel = client
      .channel('tables_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'restaurant_tables' },
        () => {
          void loadTables()
        },
      )
      .subscribe()

    return () => {
      void client.removeChannel(channel)
    }
  }, [loadTables])

  // Sectors list
  const existingSectors = useMemo(() => {
    const set = new Set<string>()
    for (const t of tables) {
      if (t.sector) set.add(t.sector)
    }
    return Array.from(set).sort()
  }, [tables])

  // KPIs
  const kpis = useMemo(() => {
    const total = tables.length
    const free = tables.filter((t) => t.derivedState === 'free').length
    const occupied = tables.filter((t) => t.derivedState === 'occupied').length
    const future = tables.filter((t) => t.derivedState === 'has_future_reservation').length
    const outOfService = tables.filter((t) => t.derivedState === 'out_of_service').length
    const inactive = tables.filter((t) => t.derivedState === 'inactive').length
    return { total, free, occupied, future, outOfService, inactive }
  }, [tables])

  // Filtered tables
  const filteredTables = useMemo(() => {
    return tables.filter((t) => {
      if (search.trim()) {
        const query = search.toLowerCase().trim()
        const matchNum = t.number.toLowerCase().includes(query)
        const matchSector = (t.sector || '').toLowerCase().includes(query)
        if (!matchNum && !matchSector) return false
      }
      if (sectorFilter !== 'ALL' && (t.sector || 'Sin sector') !== sectorFilter) {
        return false
      }
      if (statusFilter !== 'ALL' && t.derivedState !== statusFilter) {
        return false
      }
      if (minCapacityFilter !== 'ALL') {
        const minVal = Number.parseInt(minCapacityFilter, 10)
        if (t.capacity < minVal) return false
      }
      return true
    })
  }, [tables, search, sectorFilter, statusFilter, minCapacityFilter])

  // Grouped by sector for room map view
  const tablesBySector = useMemo(() => {
    const groups: Record<string, RestaurantTable[]> = {}
    for (const t of filteredTables) {
      const sectorName = t.sector || 'Salón Principal'
      if (!groups[sectorName]) groups[sectorName] = []
      groups[sectorName].push(t)
    }
    return groups
  }, [filteredTables])

  // Handlers for Multi-Table Selection
  function handleToggleSelect(table: RestaurantTable) {
    setSelectedTableIds((prev) =>
      prev.includes(table.id) ? prev.filter((id) => id !== table.id) : [...prev, table.id],
    )
  }

  function handleRemoveSelectedTable(id: string) {
    setSelectedTableIds((prev) => prev.filter((tId) => tId !== id))
  }

  function handleClearSelection() {
    setSelectedTableIds([])
  }

  const selectedTablesList = useMemo(() => {
    return tables.filter((t) => selectedTableIds.includes(t.id))
  }, [tables, selectedTableIds])

  // Quick occupancy toggle from card
  async function handleQuickOccupancyToggle(table: RestaurantTable) {
    if (!token) return
    const nextOccupancy: TableOccupancy =
      table.currentOccupancy === 'occupied' ? 'free' : 'occupied'
    setBusyId(table.id)
    try {
      await updateTableOccupancy(token, table.id, nextOccupancy)
      await loadTables()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cambiar ocupación')
    } finally {
      setBusyId(null)
    }
  }

  // Save (Create or Update) Table
  async function handleSaveTable(data: CreateTableInput) {
    if (!token) return
    if (editingTable) {
      await updateTable(token, editingTable.id, data)
      setNotice(`Mesa ${data.number} actualizada correctamente.`)
    } else {
      await createTable(token, data)
      setNotice(`Mesa ${data.number} creada exitosamente.`)
    }
    setEditingTable(null)
    await loadTables()
  }

  // Toggle Service
  async function handleToggleService(table: RestaurantTable) {
    if (!token) return
    await toggleTableService(token, table.id, !table.isOutOfService)
    setNotice(
      `Mesa ${table.number} ${!table.isOutOfService ? 'marcada fuera de servicio' : 'habilitada para servicio'}.`,
    )
    await loadTables()
    setDetailTable(null)
  }

  // Toggle Status (Active / Inactive)
  async function handleToggleStatus(table: RestaurantTable) {
    if (!token) return
    const nextStatus = table.status === 'active' ? 'inactive' : 'active'
    await changeTableStatus(token, table.id, nextStatus)
    setNotice(
      `Mesa ${table.number} ${nextStatus === 'inactive' ? 'desactivada' : 'reactivada'}.`,
    )
    await loadTables()
    setDetailTable(null)
  }

  // Detail Occupancy Update
  async function handleDetailOccupancy(table: RestaurantTable, occupancy: TableOccupancy) {
    if (!token) return
    await updateTableOccupancy(token, table.id, occupancy)
    setNotice(`Mesa ${table.number} marcada como ${occupancy === 'occupied' ? 'ocupada' : 'libre'}.`)
    await loadTables()
    setDetailTable((prev) => (prev ? { ...prev, currentOccupancy: occupancy } : null))
  }

  // Create Reservation from Multi-Table bar
  async function handleCreateReservation(input: CreateReservationInput) {
    if (!token) return
    await createReservation(token, input)
    setNotice('Reserva creada y mesas asignadas exitosamente.')
    await loadTables()
  }

  return (
    <div className="tables-module">
      <div className="page-heading">
        <div>
          <span className="eyebrow">OPERACIÓN Y SALÓN</span>
          <h1>Gestión Inteligente de Mesas</h1>
          <p>
            Monitoreo en tiempo real, mapa interactivo del salón, disponibilidad y combinación
            múltiple de mesas.
          </p>
        </div>
        <div className="page-heading__actions">
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void loadTables()}
            disabled={loading}
            aria-label="Actualizar mesas"
          >
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
            Actualizar
          </button>
          {isSuperAdmin ? (
            <button
              type="button"
              className="button button--primary"
              onClick={() => {
                setEditingTable(null)
                setShowCreateModal(true)
              }}
            >
              <Plus size={16} /> Nueva mesa
            </button>
          ) : null}
        </div>
      </div>

      {notice ? (
        <div className="notice" role="status">
          <CheckCircle2 size={16} />
          <div>
            <strong>Operación exitosa</strong>
            <p>{notice}</p>
          </div>
          <button
            type="button"
            className="icon-button"
            style={{ marginLeft: 'auto' }}
            onClick={() => setNotice('')}
            aria-label="Cerrar aviso"
          >
            ×
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}

      {/* KPI Summary Cards */}
      <section className="kpi-grid" aria-label="Resumen de mesas del salón">
        <div className="kpi-card">
          <span className="kpi-card__label">TOTAL MESAS</span>
          <strong className="kpi-card__value">{kpis.total}</strong>
          <small className="kpi-card__sub">En el restaurante</small>
        </div>
        <div className="kpi-card kpi-card--free">
          <span className="kpi-card__label">
            <CheckCircle2 size={13} /> LIBRES AHORA
          </span>
          <strong className="kpi-card__value">{kpis.free}</strong>
          <small className="kpi-card__sub">Disponibles de inmediato</small>
        </div>
        <div className="kpi-card kpi-card--occupied">
          <span className="kpi-card__label">
            <Users size={13} /> OCUPADAS
          </span>
          <strong className="kpi-card__value">{kpis.occupied}</strong>
          <small className="kpi-card__sub">Con comensales</small>
        </div>
        <div className="kpi-card kpi-card--future">
          <span className="kpi-card__label">
            <Clock size={13} /> RESERVA FUTURA
          </span>
          <strong className="kpi-card__value">{kpis.future}</strong>
          <small className="kpi-card__sub">Libres ahora con reserva hoy</small>
        </div>
        <div className="kpi-card kpi-card--warning">
          <span className="kpi-card__label">
            <AlertTriangle size={13} /> FUERA DE SERVICIO
          </span>
          <strong className="kpi-card__value">{kpis.outOfService}</strong>
          <small className="kpi-card__sub">Mantenimiento o rotura</small>
        </div>
      </section>

      {/* Filters Toolbar */}
      <section className="toolbar-section">
        <div className="toolbar-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            placeholder="Buscar por número o sector..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Buscar mesas"
          />
        </div>

        <div className="toolbar-filters">
          <div className="filter-select">
            <Filter size={14} aria-hidden="true" />
            <select
              value={sectorFilter}
              onChange={(e) => setSectorFilter(e.target.value)}
              aria-label="Filtrar por sector"
            >
              <option value="ALL">Todos los sectores</option>
              {existingSectors.map((sec) => (
                <option key={sec} value={sec}>
                  {sec}
                </option>
              ))}
            </select>
          </div>

          <div className="filter-select">
            <Armchair size={14} aria-hidden="true" />
            <select
              value={minCapacityFilter}
              onChange={(e) => setMinCapacityFilter(e.target.value)}
              aria-label="Filtrar por capacidad mínima"
            >
              <option value="ALL">Cualquier capacidad</option>
              <option value="2">Mín. 2 personas</option>
              <option value="4">Mín. 4 personas</option>
              <option value="6">Mín. 6 personas</option>
              <option value="8">Mín. 8 personas</option>
            </select>
          </div>

          <div className="filter-select">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filtrar por estado"
            >
              <option value="ALL">Todos los estados</option>
              <option value="free">Libres ahora</option>
              <option value="occupied">Ocupadas</option>
              <option value="has_future_reservation">Con reserva futura</option>
              <option value="out_of_service">Fuera de servicio</option>
              <option value="inactive">Inactivas / Archivadas</option>
            </select>
          </div>

          <div className="view-toggle" role="group" aria-label="Cambiar vista">
            <button
              type="button"
              className={`view-toggle__btn ${viewMode === 'map' ? 'active' : ''}`}
              onClick={() => setViewMode('map')}
              aria-label="Vista mapa de salón"
              title="Vista de mapa del salón"
            >
              <Grid3X3 size={16} />
            </button>
            <button
              type="button"
              className={`view-toggle__btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode('list')}
              aria-label="Vista lista"
              title="Vista en lista detallada"
            >
              <List size={16} />
            </button>
          </div>
        </div>
      </section>

      {/* Visual Legend */}
      <div className="visual-legend" aria-label="Leyenda de estados de mesas">
        <span className="visual-legend__title">Referencias:</span>
        <div className="legend-item">
          <span className="legend-pill legend-pill--free">
            <CheckCircle2 size={13} /> Libre ahora
          </span>
          <small>Disponible de inmediato</small>
        </div>
        <div className="legend-item">
          <span className="legend-pill legend-pill--occupied">
            <Users size={13} /> Ocupada
          </span>
          <small>Comensales presentes</small>
        </div>
        <div className="legend-item">
          <span className="legend-pill legend-pill--reserved">
            <Clock size={13} /> Reserva futura
          </span>
          <small>Libre ahora, reservada más tarde</small>
        </div>
        <div className="legend-item">
          <span className="legend-pill legend-pill--out-of-service">
            <AlertTriangle size={13} /> Fuera de servicio
          </span>
          <small>Mantenimiento</small>
        </div>
        <div className="legend-item">
          <span className="legend-pill legend-pill--inactive">
            <Ban size={13} /> Inactiva
          </span>
          <small>Archivada</small>
        </div>
      </div>

      {/* Main Content Area */}
      {loading && tables.length === 0 ? (
        <div className="loading-state" role="status">
          <LoaderCircle size={28} className="spin" />
          <p>Cargando mesas del salón...</p>
        </div>
      ) : filteredTables.length === 0 ? (
        <div className="empty-state">
          <Armchair size={36} />
          <h3>No se encontraron mesas</h3>
          <p>
            {tables.length === 0
              ? 'Aún no hay mesas registradas en el sistema. Comienza creando la primera mesa.'
              : 'No hay mesas que coincidan con los filtros aplicados.'}
          </p>
          {isSuperAdmin && tables.length === 0 ? (
            <button
              type="button"
              className="button button--primary"
              onClick={() => {
                setEditingTable(null)
                setShowCreateModal(true)
              }}
            >
              <Plus size={16} /> Crear primera mesa
            </button>
          ) : null}
        </div>
      ) : viewMode === 'map' ? (
        <div className="sectors-map">
          {Object.entries(tablesBySector).map(([sectorName, sectorTables]) => (
            <section key={sectorName} className="sector-group">
              <div className="sector-group__header">
                <h3>{sectorName}</h3>
                <span className="sector-group__badge">
                  {sectorTables.length} {sectorTables.length === 1 ? 'mesa' : 'mesas'}
                </span>
              </div>
              <div className="table-cards-grid">
                {sectorTables.map((table) => (
                  <TableCard
                    key={table.id}
                    table={table}
                    isSelected={selectedTableIds.includes(table.id)}
                    onToggleSelect={handleToggleSelect}
                    onOpenDetail={(t) => setDetailTable(t)}
                    onQuickOccupancyToggle={handleQuickOccupancyToggle}
                    isBusy={busyId === table.id}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        /* List View */
        <div className="table-container">
          <table className="data-table" aria-label="Listado de mesas">
            <thead>
              <tr>
                <th style={{ width: 40 }}>Sel.</th>
                <th>Número</th>
                <th>Sector</th>
                <th>Capacidad</th>
                <th>Estado</th>
                <th>Próxima Reserva</th>
                <th style={{ textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredTables.map((t) => (
                <tr key={t.id} className={selectedTableIds.includes(t.id) ? 'row--selected' : ''}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedTableIds.includes(t.id)}
                      disabled={t.status !== 'active' || t.isOutOfService}
                      onChange={() => handleToggleSelect(t)}
                      aria-label={`Seleccionar mesa ${t.number}`}
                    />
                  </td>
                  <td>
                    <strong>Mesa {t.number}</strong>
                  </td>
                  <td>{t.sector || 'Salón General'}</td>
                  <td>
                    {t.capacity} personas {t.minCapacity > 1 ? `(mín. ${t.minCapacity})` : ''}
                  </td>
                  <td>
                    <span className={`table-badge badge--${t.derivedState}`}>
                      {t.derivedState === 'free'
                        ? 'Libre ahora'
                        : t.derivedState === 'occupied'
                        ? 'Ocupada'
                        : t.derivedState === 'has_future_reservation'
                        ? 'Reserva futura'
                        : t.derivedState === 'out_of_service'
                        ? 'Fuera de servicio'
                        : 'Inactiva'}
                    </span>
                  </td>
                  <td>
                    {t.nextReservation ? (
                      <small>
                        {new Date(t.nextReservation.startTime).toLocaleTimeString('es-AR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}{' '}
                        · {t.nextReservation.customerName}
                      </small>
                    ) : (
                      <small className="muted-text">Sin reservas hoy</small>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      type="button"
                      className="button button--ghost button--sm"
                      onClick={() => setDetailTable(t)}
                    >
                      Ver detalle
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Multi-Table Selection Bar */}
      <MultiTableSelectorBar
        selectedTables={selectedTablesList}
        onRemoveTable={handleRemoveSelectedTable}
        onClearSelection={handleClearSelection}
        onCreateReservation={handleCreateReservation}
      />

      {/* Create / Edit Modal */}
      <TableModal
        isOpen={showCreateModal || Boolean(editingTable)}
        onClose={() => {
          setShowCreateModal(false)
          setEditingTable(null)
        }}
        onSave={handleSaveTable}
        initialData={editingTable}
        existingSectors={existingSectors}
      />

      {/* Table Detail Modal */}
      <TableDetailModal
        isOpen={Boolean(detailTable)}
        onClose={() => setDetailTable(null)}
        table={detailTable}
        isSuperAdmin={isSuperAdmin}
        onEdit={(table) => {
          setEditingTable(table)
        }}
        onToggleService={handleToggleService}
        onToggleStatus={handleToggleStatus}
        onUpdateOccupancy={handleDetailOccupancy}
      />
    </div>
  )
}
