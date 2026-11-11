import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Armchair,
  Calendar,
  Clock,
  Compass,
  Grid,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  X,
  Layers,
  SlidersHorizontal,
  ArrowLeftRight,
  UserX,
  CheckCircle,
  ShieldAlert,
} from 'lucide-react'
import { useAuth } from '../auth/auth.context'
import { tablesApi, TablesApiError } from './tables.api'
import type {
  Table,
  Reservation,
  OperationalSettings,
  CreateReservationPayload,
  CreateTablePayload,
  InitializeFloorPlanPayload,
} from './tables.types'
import { LoadingState, Notice } from '../../components/PageState'
import { SmartMetricsBar } from './components/SmartMetricsBar'
import { SmartTableMatcher } from './components/SmartTableMatcher'
import { SmartFloorPlan } from './components/SmartFloorPlan'
import { TableDetailDrawer } from './components/TableDetailDrawer'
import { CreateReservationModal } from './components/CreateReservationModal'
import { SetupFloorPlanModal } from './components/SetupFloorPlanModal'

export function TablesOperationsPage() {
  const { session, profile } = useAuth()
  const isSuperAdmin = profile?.role === 'super_admin'

  const [tables, setTables] = useState<Table[]>([])
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [operationalSettings, setOperationalSettings] = useState<OperationalSettings>({
    defaultReservationDurationMinutes: 120,
    defaultWalkInDurationMinutes: 90,
    reservationBufferMinutes: 15,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // View preferences
  const [activeView, setActiveView] = useState<'floorplan' | 'cards'>('floorplan')
  const [selectedSector, setSelectedSector] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Selected table for detailed drawer
  const [selectedTable, setSelectedTable] = useState<Table | null>(null)
  const [highlightedTableIds, setHighlightedTableIds] = useState<string[]>([])

  // Smart Matcher Drawer toggle
  const [showSmartMatcher, setShowSmartMatcher] = useState(true)

  // Modals state
  const [isSetupModalOpen, setIsSetupModalOpen] = useState(false)
  const [isReservationModalOpen, setIsReservationModalOpen] = useState(false)
  const [reservationModalInitialTables, setReservationModalInitialTables] = useState<Table[]>([])
  const [reservationModalInitialGuests, setReservationModalInitialGuests] = useState<number>(4)

  // Operational Settings modal (Super Admin)
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false)
  const [settingsForm, setSettingsForm] = useState({
    defaultReservationDurationMinutes: 120,
    defaultWalkInDurationMinutes: 90,
    reservationBufferMinutes: 15,
    reason: 'Actualización de parámetros operativos del salón',
  })

  // Capacity modal state
  const [editingCapacityTable, setEditingCapacityTable] = useState<Table | null>(null)
  const [newCapacity, setNewCapacity] = useState<number>(4)
  const [capacityReason, setCapacityReason] = useState('')
  const [capacityConflictWarning, setCapacityConflictWarning] = useState<Reservation[] | null>(null)
  const [capacityHardBlocked, setCapacityHardBlocked] = useState(false)
  const [capacityOpenSessionConflict, setCapacityOpenSessionConflict] = useState(false)

  // Deactivate modal state (explicit blocker, NO resolution cascade)
  const [deactivatingTable, setDeactivatingTable] = useState<Table | null>(null)
  const [deactivateReason, setDeactivateReason] = useState('')
  const [deactivateFutureReservations, setDeactivateFutureReservations] = useState<Reservation[]>([])
  const [deactivateHasOpenSessions, setDeactivateHasOpenSessions] = useState(false)
  const [deactivateOpenSessionsCount, setDeactivateOpenSessionsCount] = useState(0)

  // Cancel reservation modal
  const [cancellingReservation, setCancellingReservation] = useState<Reservation | null>(null)
  const [cancelReason, setCancelReason] = useState('')

  // Walk-in modal
  const [walkInTable, setWalkInTable] = useState<Table | null>(null)
  const [walkInGuests, setWalkInGuests] = useState<number>(2)
  const [walkInNotes, setWalkInNotes] = useState('')

  // Operational Release modal (walk-in / orphan only)
  const [operationalReleaseTable, setOperationalReleaseTable] = useState<Table | null>(null)
  const [operationalReleaseReason, setOperationalReleaseReason] = useState('')

  // No-show modal
  const [noShowTarget, setNoShowTarget] = useState<Reservation | null>(null)
  const [noShowReason, setNoShowReason] = useState('')

  // Reassign tables modal
  const [reassigningReservation, setReassigningReservation] = useState<Reservation | null>(null)
  const [reassignTableIds, setReassignTableIds] = useState<string[]>([])
  const [reassignReason, setReassignReason] = useState('')

  const [busy, setBusy] = useState(false)

  const loadData = useCallback(async () => {
    if (!session?.access_token) return
    setLoading(true)
    setError('')
    try {
      const [tList, rList, settingsRes] = await Promise.all([
        tablesApi.getTables(session.access_token),
        tablesApi.getReservations(session.access_token),
        tablesApi.getOperationalSettings(session.access_token).catch(() => null),
      ])
      setTables(tList)
      setReservations(rList)
      if (settingsRes) {
        setOperationalSettings(settingsRes)
      }

      if (selectedTable) {
        const refreshed = tList.find((t) => t.id === selectedTable.id)
        if (refreshed) setSelectedTable(refreshed)
      }
    } catch (err) {
      if (err instanceof TablesApiError) {
        setError(err.message)
      } else {
        setError('No se pudo cargar la información de mesas y reservas.')
      }
    } finally {
      setLoading(false)
    }
  }, [session?.access_token, selectedTable?.id])

  useEffect(() => {
    void loadData()
  }, [loadData])

  function showTemporarySuccess(msg: string) {
    setSuccess(msg)
    setTimeout(() => setSuccess(''), 6000)
  }

  // Open Walk-In Modal
  function openWalkInModalForTable(table: Table) {
    setWalkInTable(table)
    setWalkInGuests(table.capacity)
    setWalkInNotes('')
    setError('')
  }

  async function handleWalkInSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!session?.access_token || !walkInTable) return
    setBusy(true)
    setError('')
    try {
      await tablesApi.openWalkIn(session.access_token, walkInTable.id, {
        guestsCount: walkInGuests,
        expectedDurationMinutes: operationalSettings.defaultWalkInDurationMinutes,
        notes: walkInNotes.trim() || undefined,
      })
      const num = walkInTable.number
      setWalkInTable(null)
      await loadData()
      showTemporarySuccess(`Sesión walk-in iniciada en Mesa ${num}.`)
    } catch (err) {
      if (err instanceof TablesApiError) setError(err.message)
      else setError('No se pudo abrir la sesión walk-in.')
    } finally {
      setBusy(false)
    }
  }

  async function handleCloseWalkIn(table: Table, sessionId: string) {
    if (!session?.access_token) return
    setBusy(true)
    setError('')
    try {
      await tablesApi.closeWalkInSession(session.access_token, sessionId)
      await loadData()
      showTemporarySuccess(`Sesión walk-in de Mesa ${table.number} cerrada correctamente.`)
    } catch (err) {
      if (err instanceof TablesApiError) setError(err.message)
      else setError('No se pudo cerrar la sesión walk-in.')
    } finally {
      setBusy(false)
    }
  }

  async function handleOperationalReleaseSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!session?.access_token || !operationalReleaseTable) return
    setBusy(true)
    setError('')
    try {
      await tablesApi.releaseTableOperational(
        session.access_token,
        operationalReleaseTable.id,
        operationalReleaseReason.trim(),
      )
      const num = operationalReleaseTable.number
      setOperationalReleaseTable(null)
      setOperationalReleaseReason('')
      await loadData()
      showTemporarySuccess(`Liberación operativa auditada ejecutada sobre Mesa ${num}.`)
    } catch (err) {
      if (err instanceof TablesApiError) setError(err.message)
      else setError('No se pudo ejecutar la liberación operativa.')
    } finally {
      setBusy(false)
    }
  }

  async function handleExtendSession(sessionId: string, extraMinutes: number) {
    if (!session?.access_token) return
    setBusy(true)
    setError('')
    try {
      await tablesApi.extendTableSession(session.access_token, sessionId, extraMinutes)
      await loadData()
      showTemporarySuccess(`Estadía extendida en +${extraMinutes} minutos.`)
    } catch (err) {
      if (err instanceof TablesApiError) setError(err.message)
      else setError('No se pudo extender el tiempo de la sesión.')
    } finally {
      setBusy(false)
    }
  }

  async function handleSeatReservation(res: Reservation) {
    if (!session?.access_token) return
    setBusy(true)
    setError('')
    try {
      await tablesApi.seatReservation(session.access_token, res.id, {
        expectedDurationMinutes: res.durationMinutes || operationalSettings.defaultReservationDurationMinutes,
      })
      await loadData()
      showTemporarySuccess(`Check-in confirmado para ${res.customerName}. Sesión de mesa abierta.`)
    } catch (err) {
      if (err instanceof TablesApiError) setError(err.message)
      else setError('No se pudo registrar el check-in de la reserva.')
    } finally {
      setBusy(false)
    }
  }

  async function handleCompleteService(res: Reservation) {
    if (!session?.access_token) return
    setBusy(true)
    setError('')
    try {
      await tablesApi.completeService(session.access_token, res.id)
      await loadData()
      showTemporarySuccess(`Servicio de ${res.customerName} finalizado. Mesas liberadas.`)
    } catch (err) {
      if (err instanceof TablesApiError) setError(err.message)
      else setError('No se pudo finalizar el servicio de la reserva.')
    } finally {
      setBusy(false)
    }
  }

  async function handleNoShowSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!session?.access_token || !noShowTarget) return
    setBusy(true)
    setError('')
    try {
      await tablesApi.noShowReservation(session.access_token, noShowTarget.id, noShowReason.trim())
      const name = noShowTarget.customerName
      setNoShowTarget(null)
      setNoShowReason('')
      await loadData()
      showTemporarySuccess(`Reserva de ${name} marcada como No-Show.`)
    } catch (err) {
      if (err instanceof TablesApiError) setError(err.message)
      else setError('No se pudo marcar la reserva como No-Show.')
    } finally {
      setBusy(false)
    }
  }

  function openReassignModal(res: Reservation) {
    setReassigningReservation(res)
    setReassignTableIds(res.tableIds && res.tableIds.length > 0 ? res.tableIds : [res.tableId])
    setReassignReason('')
    setError('')
  }

  async function handleReassignSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!session?.access_token || !reassigningReservation) return
    setBusy(true)
    setError('')
    try {
      await tablesApi.reassignReservationTables(session.access_token, reassigningReservation.id, {
        tableIds: reassignTableIds,
        reason: reassignReason.trim(),
      })
      const name = reassigningReservation.customerName
      setReassigningReservation(null)
      setReassignReason('')
      await loadData()
      showTemporarySuccess(`Mesas reasignadas correctamente para la reserva de ${name}.`)
    } catch (err) {
      if (err instanceof TablesApiError) setError(err.message)
      else setError('No se pudo reasignar las mesas.')
    } finally {
      setBusy(false)
    }
  }

  async function handleSettingsSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!session?.access_token) return
    setBusy(true)
    setError('')
    try {
      const updated = await tablesApi.updateOperationalSettings(session.access_token, settingsForm)
      setOperationalSettings(updated)
      setIsSettingsModalOpen(false)
      showTemporarySuccess('Parámetros operativos actualizados en base de datos.')
    } catch (err) {
      if (err instanceof TablesApiError) setError(err.message)
      else setError('No se pudieron guardar los parámetros operativos.')
    } finally {
      setBusy(false)
    }
  }

  function handleSelectTablesFromMatcher(recs: Table[]) {
    setHighlightedTableIds(recs.map((t) => t.id))
    if (recs.length > 0) {
      setSelectedTable(recs[0])
    }
  }

  function handleOpenReservationModal(presetTables: Table[], guestsCount = 4) {
    setReservationModalInitialTables(presetTables)
    setReservationModalInitialGuests(guestsCount)
    setIsReservationModalOpen(true)
  }

  async function handleCreateReservationSubmit(payload: CreateReservationPayload) {
    if (!session?.access_token) return
    setBusy(true)
    try {
      await tablesApi.createReservation(session.access_token, payload)
      setIsReservationModalOpen(false)
      await loadData()
      showTemporarySuccess(
        `Reserva registrada exitosamente para ${payload.customerName} (${payload.guestsCount} personas). Asignación vinculada en salón.`
      )
    } finally {
      setBusy(false)
    }
  }

  async function handleCreateSingleTable(payload: CreateTablePayload) {
    if (!session?.access_token) return
    setBusy(true)
    setError('')
    try {
      const created = await tablesApi.createTable(session.access_token, payload)
      setTables((prev) => [...prev, created].sort((a, b) => a.number - b.number))
      showTemporarySuccess(
        `Mesa ${created.number} (${created.sector}, ${created.capacity} personas) creada y guardada en base de datos.`
      )
    } catch (err: any) {
      if (err instanceof TablesApiError) setError(err.message)
      else setError('No se pudo guardar la mesa.')
      throw err
    } finally {
      setBusy(false)
    }
  }

  async function handleInitializeFloorPlan(payload: InitializeFloorPlanPayload) {
    if (!session?.access_token) return
    setBusy(true)
    setError('')
    try {
      const res = await tablesApi.initializeFloorPlan(session.access_token, payload)
      setTables(res.tables)
      setSelectedTable(null)
      showTemporarySuccess(
        `Nuevo plano configurado y guardado con éxito (${res.count} mesas persistidas en base de datos).`
      )
    } catch (err: any) {
      if (err instanceof TablesApiError) setError(err.message)
      else setError('No se pudo guardar el nuevo plano.')
      throw err
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteTable(table: Table) {
    if (!session?.access_token) return
    const ok = window.confirm(`¿Está seguro de eliminar la Mesa ${table.number} (${table.sector}) del plano?`)
    if (!ok) return

    setBusy(true)
    setError('')
    try {
      await tablesApi.deleteTable(session.access_token, table.id, `Eliminación de Mesa ${table.number} sin historial`)
      setTables((prev) => prev.filter((t) => t.id !== table.id))
      if (selectedTable?.id === table.id) setSelectedTable(null)
      showTemporarySuccess(`Mesa ${table.number} eliminada del plano correctamente.`)
    } catch (err: any) {
      if (err instanceof TablesApiError) setError(err.message)
      else setError('No se pudo eliminar la mesa.')
    } finally {
      setBusy(false)
    }
  }

  async function handleCheckCapacitySubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!session?.access_token || !editingCapacityTable) return

    setBusy(true)
    setError('')
    try {
      const check = await tablesApi.checkCapacityConflict(
        session.access_token,
        editingCapacityTable.id,
        newCapacity
      )

      if (check.hasConflict) {
        setCapacityConflictWarning(check.affectedReservations)
        setCapacityHardBlocked(Boolean(check.hardBlocked))
        setCapacityOpenSessionConflict(Boolean(check.openSessionConflict))
        setBusy(false)
        return
      }

      await executeCapacityUpdate(false)
    } catch (err) {
      if (err instanceof TablesApiError) setError(err.message)
      else setError('Error al verificar conflictos de capacidad.')
      setBusy(false)
    }
  }

  async function executeCapacityUpdate(force: boolean) {
    if (!session?.access_token || !editingCapacityTable) return
    setBusy(true)
    setError('')
    try {
      const updated = await tablesApi.updateCapacity(
        session.access_token,
        editingCapacityTable.id,
        newCapacity,
        capacityReason,
        force
      )
      setTables((prev) => prev.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)))
      if (selectedTable?.id === updated.id) setSelectedTable((prev) => (prev ? { ...prev, ...updated } : null))
      setEditingCapacityTable(null)
      setCapacityConflictWarning(null)
      setCapacityHardBlocked(false)
      setCapacityOpenSessionConflict(false)
      setCapacityReason('')
      showTemporarySuccess(
        `Capacidad de Mesa ${updated.number} actualizada a ${updated.capacity}. Acción registrada en auditoría.`
      )
    } catch (err) {
      if (err instanceof TablesApiError) setError(err.message)
      else setError('No se pudo guardar la nueva capacidad.')
    } finally {
      setBusy(false)
    }
  }

  async function openDeactivateModal(table: Table) {
    if (!session?.access_token) return
    setDeactivatingTable(table)
    setDeactivateReason('')
    setDeactivateFutureReservations([])
    setDeactivateHasOpenSessions(false)
    setDeactivateOpenSessionsCount(0)
    setError('')

    try {
      const check = await tablesApi.checkDeactivation(session.access_token, table.id)
      setDeactivateFutureReservations(check.affectedReservations)
      setDeactivateHasOpenSessions(Boolean(check.hasOpenSessions))
      setDeactivateOpenSessionsCount(check.openSessionsCount || 0)
    } catch {
      setDeactivateFutureReservations([])
    }
  }

  async function handleDeactivateSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!session?.access_token || !deactivatingTable) return
    setBusy(true)
    setError('')
    try {
      const updated = await tablesApi.updateStatus(
        session.access_token,
        deactivatingTable.id,
        'out_of_service',
        deactivateReason
      )
      setTables((prev) => prev.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)))
      if (selectedTable?.id === updated.id) setSelectedTable((prev) => (prev ? { ...prev, ...updated } : null))
      setDeactivatingTable(null)
      setDeactivateReason('')
      void loadData()
      showTemporarySuccess(
        `Mesa ${updated.number} puesta fuera de servicio. Se generó alerta administrativa y auditoría inmutable.`
      )
    } catch (err) {
      if (err instanceof TablesApiError) setError(err.message)
      else setError('Error al desactivar la mesa.')
    } finally {
      setBusy(false)
    }
  }

  async function handleReactivate(table: Table) {
    if (!session?.access_token) return
    setBusy(true)
    setError('')
    try {
      const updated = await tablesApi.updateStatus(
        session.access_token,
        table.id,
        'available',
        'Reactivación de mesa operativa'
      )
      setTables((prev) => prev.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)))
      if (selectedTable?.id === updated.id) setSelectedTable((prev) => (prev ? { ...prev, ...updated } : null))
      showTemporarySuccess(`Mesa ${updated.number} reactivada para el servicio.`)
    } catch (err) {
      if (err instanceof TablesApiError) setError(err.message)
      else setError('No se pudo reactivar la mesa.')
    } finally {
      setBusy(false)
    }
  }

  async function handleCancelReservationSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!session?.access_token || !cancellingReservation) return
    setBusy(true)
    setError('')
    try {
      const res = await tablesApi.cancelReservation(
        session.access_token,
        cancellingReservation.id,
        cancelReason
      )
      setCancellingReservation(null)
      setCancelReason('')
      await loadData()
      showTemporarySuccess(
        `Reserva de ${res.reservation?.customerName || cancellingReservation.customerName} cancelada. Liberada la mesa y generada alerta.`
      )
    } catch (err) {
      if (err instanceof TablesApiError) setError(err.message)
      else setError('No se pudo cancelar la reserva.')
    } finally {
      setBusy(false)
    }
  }

  const sectorsList = useMemo(() => {
    return Array.from(new Set(tables.map((t) => t.sector)))
  }, [tables])

  const displayedTables = useMemo(() => {
    return tables.filter((t) => {
      if (selectedSector !== 'all' && t.sector !== selectedSector) return false
      if (statusFilter !== 'all' && t.status !== statusFilter) return false
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const matchesNum = String(t.number).includes(q)
        const matchesSector = t.sector.toLowerCase().includes(q)
        return matchesNum || matchesSector
      }
      return true
    })
  }, [tables, selectedSector, statusFilter, searchQuery])

  const isDeactivationBlocked =
    deactivateFutureReservations.length > 0 || deactivateHasOpenSessions

  const reassignSelectedTables = tables.filter((t) => reassignTableIds.includes(t.id))
  const reassignCombinedCap = reassignSelectedTables.reduce((acc, t) => acc + t.capacity, 0)

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="text-[11px] font-bold tracking-widest text-[#1f5a49] uppercase block mb-1">
            CONTROL DE SALÓN & SESIONES · SOFIA
          </span>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#1b2925] tracking-tight">
            Mesas Inteligentes
          </h1>
          <p className="text-sm text-[#68766f] mt-1 max-w-2xl">
            Plano interactivo, gestión de sesiones walk-in y reservas con trazabilidad inmutable,
            control de capacidad y tiempos de permanencia.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {isSuperAdmin && (
            <>
              <button
                type="button"
                onClick={() => {
                  setSettingsForm({
                    defaultReservationDurationMinutes: operationalSettings.defaultReservationDurationMinutes,
                    defaultWalkInDurationMinutes: operationalSettings.defaultWalkInDurationMinutes,
                    reservationBufferMinutes: operationalSettings.reservationBufferMinutes,
                    reason: 'Actualización de parámetros operativos del salón',
                  })
                  setIsSettingsModalOpen(true)
                }}
                className="px-3 py-2 bg-white border border-[#dce4dd] text-[#1b2925] text-xs font-semibold rounded-lg hover:bg-[#f4f6f4] transition-colors flex items-center gap-1.5"
              >
                <SlidersHorizontal size={14} /> Parámetros Operativos
              </button>

              <button
                type="button"
                onClick={() => setIsSetupModalOpen(true)}
                className="px-4 py-2 bg-[#2d6a4f] text-white text-xs font-bold rounded-lg hover:bg-[#23533e] transition-colors shadow-xs flex items-center gap-1.5"
              >
                <Layers size={15} /> Cargar Mesas / Plano
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => handleOpenReservationModal([], 4)}
            className="px-4 py-2 bg-[#1f5a49] text-white text-xs font-bold rounded-lg hover:bg-[#174639] transition-colors shadow-xs flex items-center gap-1.5"
          >
            <Plus size={15} /> Nueva Reserva
          </button>

          <button
            type="button"
            className="px-3 py-2 bg-white border border-[#dce4dd] text-[#1b2925] text-xs font-semibold rounded-lg hover:bg-[#f4f6f4] transition-colors flex items-center gap-1.5"
            onClick={() => void loadData()}
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Actualizar
          </button>
        </div>
      </div>

      {success && <Notice title="Operación Registrada">{success}</Notice>}

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs font-medium flex items-center gap-2">
          <AlertTriangle size={15} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <SmartMetricsBar tables={tables} reservations={reservations} />

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setShowSmartMatcher((v) => !v)}
            className="text-xs font-bold text-[#1f5a49] flex items-center gap-1.5 hover:underline"
          >
            <Sparkles size={14} />
            {showSmartMatcher
              ? 'Ocultar Asistente de Asignación Inteligente'
              : 'Mostrar Asistente de Asignación Inteligente'}
          </button>
        </div>

        {showSmartMatcher && (
          <SmartTableMatcher
            tables={tables}
            selectedSector={selectedSector}
            onSelectTables={handleSelectTablesFromMatcher}
            onOpenReservationModal={handleOpenReservationModal}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-white border border-[#dce4dd] rounded-xl shadow-xs">
        <div className="flex items-center gap-1 p-1 bg-[#f4f6f3] rounded-lg">
          <button
            type="button"
            onClick={() => setActiveView('floorplan')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5 ${
              activeView === 'floorplan'
                ? 'bg-white text-[#1f5a49] shadow-xs'
                : 'text-[#5a6961] hover:text-[#1b2925]'
            }`}
          >
            <Compass size={14} /> Plano de Salón
          </button>
          <button
            type="button"
            onClick={() => setActiveView('cards')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5 ${
              activeView === 'cards'
                ? 'bg-white text-[#1f5a49] shadow-xs'
                : 'text-[#5a6961] hover:text-[#1b2925]'
            }`}
          >
            <Grid size={14} /> Fichas de Mesas
          </button>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto text-xs">
          <button
            type="button"
            onClick={() => setSelectedSector('all')}
            className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
              selectedSector === 'all'
                ? 'bg-[#1b2925] text-white'
                : 'text-[#5a6961] hover:bg-[#e8f1eb]'
            }`}
          >
            Todos los Sectores
          </button>
          {sectorsList.map((sec) => (
            <button
              key={sec}
              type="button"
              onClick={() => setSelectedSector(sec)}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                selectedSector === sec
                  ? 'bg-[#1b2925] text-white'
                  : 'text-[#5a6961] hover:bg-[#e8f1eb]'
              }`}
            >
              {sec}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <select
            aria-label="Filtrar por estado"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2 py-1.5 border border-[#dce4dd] rounded-lg bg-[#fbfcfb] text-xs text-[#1b2925]"
          >
            <option value="all">Todos los estados</option>
            <option value="available">Disponibles</option>
            <option value="reserved">Reservadas</option>
            <option value="occupied">Ocupadas</option>
            <option value="out_of_service">Fuera de servicio</option>
          </select>

          <div className="flex items-center gap-2 px-2.5 py-1.5 border border-[#dce4dd] rounded-lg bg-[#fbfcfb] text-xs">
            <Search size={14} className="text-[#68766f]" />
            <input
              type="text"
              placeholder="Buscar por mesa o sector..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-36 sm:w-44 bg-transparent outline-none text-[#1b2925]"
            />
          </div>
        </div>
      </div>

      {loading ? (
        <LoadingState label="Cargando estado inteligente del salón..." />
      ) : tables.length === 0 ? (
        <div className="bg-white border border-[#dce4dd] rounded-2xl p-10 text-center space-y-4 max-w-xl mx-auto shadow-xs">
          <div className="w-14 h-14 rounded-2xl bg-[#eaf3ed] text-[#1f5a49] flex items-center justify-center mx-auto">
            <Layers size={28} />
          </div>
          <div>
            <h3 className="text-lg font-extrabold text-[#1b2925]">Plano de Salón sin Mesas</h3>
            <p className="text-xs text-[#68766f] mt-1 max-w-md mx-auto">
              El restaurante aún no tiene mesas configuradas en la base de datos.
            </p>
          </div>
          {isSuperAdmin ? (
            <button
              type="button"
              onClick={() => setIsSetupModalOpen(true)}
              className="px-5 py-2.5 bg-[#1f5a49] text-white text-xs font-bold rounded-lg hover:bg-[#174639] transition-colors shadow-xs inline-flex items-center gap-2"
            >
              <Plus size={16} /> Cargar Mesas Desde Cero
            </button>
          ) : (
            <p className="text-xs font-medium text-amber-700 bg-amber-50 p-2.5 rounded-lg border border-amber-200">
              La carga inicial del plano de mesas está reservada para el Superadministrador.
            </p>
          )}
        </div>
      ) : activeView === 'floorplan' ? (
        <SmartFloorPlan
          tables={displayedTables}
          reservations={reservations}
          selectedTableIds={highlightedTableIds.concat(selectedTable ? [selectedTable.id] : [])}
          activeSector={selectedSector}
          onSelectTable={(table) => {
            setSelectedTable(table)
            setHighlightedTableIds([table.id])
          }}
          onOpenWalkIn={openWalkInModalForTable}
          onSeatReservation={(res) => void handleSeatReservation(res)}
          onCloseWalkIn={(t, sessId) => void handleCloseWalkIn(t, sessId)}
          onCompleteService={(res) => void handleCompleteService(res)}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {displayedTables.map((table) => {
            const isOutOfService = table.status === 'out_of_service'
            const isOccupied = table.status === 'occupied'
            const linkedRes = reservations.find(
              (r) =>
                r.status === 'confirmed' &&
                (r.tableId === table.id || (r.tableIds && r.tableIds.includes(table.id)))
            )
            const isReserved = !isOccupied && (table.status === 'reserved' || Boolean(linkedRes))
            const linkedCount = linkedRes?.tableIds?.length || (linkedRes?.tableNumbers?.length ?? 1)
            const linkedNums = linkedRes?.tableNumbers || (linkedRes ? [linkedRes.tableNumber] : [table.number])

            return (
              <article
                key={table.id}
                onClick={() => setSelectedTable(table)}
                className={`bg-white border rounded-xl p-4 flex flex-col justify-between transition-all cursor-pointer hover:shadow-md ${
                  selectedTable?.id === table.id
                    ? 'border-[#1f5a49] ring-2 ring-[#1f5a49]/20'
                    : isReserved && linkedCount === 2
                      ? 'border-purple-300 ring-1 ring-purple-200'
                      : isReserved && linkedCount === 3
                        ? 'border-orange-300 ring-1 ring-orange-200'
                        : isReserved
                          ? 'border-red-300 ring-1 ring-red-200'
                          : 'border-[#dce4dd]'
                } ${isOutOfService ? 'opacity-70 bg-gray-50' : ''}`}
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`w-9 h-9 rounded-lg grid place-items-center font-mono font-extrabold text-sm ${
                          isOutOfService
                            ? 'bg-gray-100 text-gray-500'
                            : isOccupied
                              ? 'bg-blue-100 text-blue-800'
                              : isReserved && linkedCount === 2
                                ? 'bg-purple-700 text-white shadow-xs'
                                : isReserved && linkedCount === 3
                                  ? 'bg-orange-600 text-white shadow-xs'
                                  : isReserved
                                    ? 'bg-red-600 text-white shadow-xs'
                                    : 'bg-[#e8f1eb] text-[#1f5a49]'
                        }`}
                      >
                        {table.number}
                      </span>
                      <div>
                        <strong className="text-sm font-bold text-[#1b2925] block leading-tight">
                          Mesa {table.number}
                        </strong>
                        <span className="text-[11px] text-[#68766f]">{table.sector}</span>
                      </div>
                    </div>

                    <span
                      className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                        isOutOfService
                          ? 'bg-gray-100 text-gray-600'
                          : isOccupied
                            ? 'bg-blue-50 text-blue-700'
                            : isReserved && linkedCount === 2
                              ? 'bg-purple-100 text-purple-900 border border-purple-300'
                              : isReserved && linkedCount === 3
                                ? 'bg-orange-100 text-orange-900 border border-orange-300'
                                : isReserved
                                  ? 'bg-red-100 text-red-900 border border-red-300'
                                  : 'bg-emerald-50 text-emerald-800'
                      }`}
                    >
                      {isOutOfService
                        ? 'Mantenimiento'
                        : isOccupied
                          ? table.activeSession?.sessionType === 'reservation'
                            ? 'Ocupada (Res.)'
                            : 'Ocupada (Walk-in)'
                          : isReserved
                            ? linkedCount > 1
                              ? `Reservada (${linkedNums.join('+')})`
                              : 'Reservada'
                            : 'Disponible'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs text-[#68766f] py-2 border-t border-[#f4f6f4]">
                    <span className="flex items-center gap-1.5">
                      <Armchair size={13} /> {table.capacity} pax (Máx {table.maxCapacity})
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Calendar size={13} /> {table.upcomingReservationsCount} res.
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-3 border-t border-[#eef2ee] mt-3">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditingCapacityTable(table)
                      setNewCapacity(table.capacity)
                      setCapacityConflictWarning(null)
                      setCapacityHardBlocked(false)
                      setCapacityOpenSessionConflict(false)
                      setCapacityReason('')
                    }}
                    className="flex-1 py-1 px-2 text-xs font-semibold rounded bg-white border border-[#dce4dd] text-[#1b2925] hover:bg-[#f4f6f4]"
                  >
                    Capacidad
                  </button>

                  {isOutOfService ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        void handleReactivate(table)
                      }}
                      className="flex-1 py-1 px-2 text-xs font-semibold rounded bg-[#1f5a49] text-white hover:bg-[#174639]"
                    >
                      Reactivar
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        void openDeactivateModal(table)
                      }}
                      className="flex-1 py-1 px-2 text-xs font-semibold rounded bg-red-50 text-red-700 hover:bg-red-100"
                    >
                      Desactivar
                    </button>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}

      {/* Selected Table Detail Drawer */}
      <TableDetailDrawer
        table={selectedTable}
        reservations={reservations}
        isSuperAdmin={isSuperAdmin}
        onClose={() => setSelectedTable(null)}
        onOpenWalkIn={openWalkInModalForTable}
        onCloseWalkIn={(t, sessId) => void handleCloseWalkIn(t, sessId)}
        onOpenOperationalReleaseModal={(t) => {
          setOperationalReleaseTable(t)
          setOperationalReleaseReason('')
          setError('')
        }}
        onExtendSession={(sessId, mins) => void handleExtendSession(sessId, mins)}
        onSeatReservation={(r) => void handleSeatReservation(r)}
        onCompleteService={(r) => void handleCompleteService(r)}
        onNoShowReservation={(r) => {
          setNoShowTarget(r)
          setNoShowReason('Ausencia del cliente (no-show)')
          setError('')
        }}
        onOpenReassignModal={openReassignModal}
        onOpenCapacityModal={(t) => {
          setEditingCapacityTable(t)
          setNewCapacity(t.capacity)
          setCapacityConflictWarning(null)
          setCapacityHardBlocked(false)
          setCapacityOpenSessionConflict(false)
          setCapacityReason('')
        }}
        onOpenDeactivateModal={(t) => void openDeactivateModal(t)}
        onReactivate={(t) => void handleReactivate(t)}
        onOpenReservationModal={(t, g) => handleOpenReservationModal(t, g)}
        onCancelReservation={(r) => {
          setCancellingReservation(r)
          setCancelReason('')
        }}
        onDeleteTable={handleDeleteTable}
        busy={busy}
      />

      {/* Setup Floor Plan Modal */}
      <SetupFloorPlanModal
        isOpen={isSetupModalOpen}
        onClose={() => setIsSetupModalOpen(false)}
        currentTables={tables}
        reservations={reservations}
        onSubmitSingle={handleCreateSingleTable}
        onSubmitBatch={handleInitializeFloorPlan}
        busy={busy}
      />

      {/* Create Reservation Modal */}
      {isReservationModalOpen && (
        <CreateReservationModal
          initialTables={reservationModalInitialTables}
          allTables={tables}
          initialGuestsCount={reservationModalInitialGuests}
          defaultDurationMinutes={operationalSettings.defaultReservationDurationMinutes}
          onClose={() => setIsReservationModalOpen(false)}
          onSubmit={handleCreateReservationSubmit}
          busy={busy}
        />
      )}

      {/* Modal: Parámetros Operativos (Super Admin) */}
      {isSettingsModalOpen && (
        <div className="fixed inset-0 bg-black/45 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-[#dce4dd] shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-5 border-b border-[#eef2ee] flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold tracking-widest text-[#1f5a49] uppercase">
                  Configuración Singleton · Migración 5
                </span>
                <h3 className="text-base font-bold text-[#1b2925]">
                  Parámetros Operativos del Salón
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsSettingsModalOpen(false)}
                className="p-1 rounded text-[#68766f] hover:bg-[#f4f6f4]"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSettingsSubmit} className="p-5 space-y-4">
              <div>
                <label className="text-xs font-semibold text-[#1b2925] block mb-1">
                  Duración por defecto de Reservas (30 - 360 min)
                </label>
                <input
                  type="number"
                  min={30}
                  max={360}
                  required
                  value={settingsForm.defaultReservationDurationMinutes}
                  onChange={(e) =>
                    setSettingsForm({
                      ...settingsForm,
                      defaultReservationDurationMinutes: parseInt(e.target.value, 10) || 120,
                    })
                  }
                  className="w-full p-2 border border-[#dce4dd] rounded-lg text-sm font-mono font-bold"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-[#1b2925] block mb-1">
                  Duración por defecto de Walk-in (30 - 360 min)
                </label>
                <input
                  type="number"
                  min={30}
                  max={360}
                  required
                  value={settingsForm.defaultWalkInDurationMinutes}
                  onChange={(e) =>
                    setSettingsForm({
                      ...settingsForm,
                      defaultWalkInDurationMinutes: parseInt(e.target.value, 10) || 90,
                    })
                  }
                  className="w-full p-2 border border-[#dce4dd] rounded-lg text-sm font-mono font-bold"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-[#1b2925] block mb-1">
                  Buffer entre reservas (0 - 60 min)
                </label>
                <input
                  type="number"
                  min={0}
                  max={60}
                  required
                  value={settingsForm.reservationBufferMinutes}
                  onChange={(e) =>
                    setSettingsForm({
                      ...settingsForm,
                      reservationBufferMinutes: parseInt(e.target.value, 10) || 0,
                    })
                  }
                  className="w-full p-2 border border-[#dce4dd] rounded-lg text-sm font-mono font-bold"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-[#1b2925] block mb-1">
                  Motivo de actualización (Auditoría)
                </label>
                <input
                  type="text"
                  required
                  minLength={5}
                  value={settingsForm.reason}
                  onChange={(e) => setSettingsForm({ ...settingsForm, reason: e.target.value })}
                  className="w-full p-2 border border-[#dce4dd] rounded-lg text-xs"
                />
              </div>

              <div className="pt-3 border-t border-[#eef2ee] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsSettingsModalOpen(false)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-[#dce4dd]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-[#1f5a49] text-white hover:bg-[#174639]"
                >
                  {busy ? 'Guardando...' : 'Guardar Parámetros'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Abrir Sesión Walk-in */}
      {walkInTable && (
        <div className="fixed inset-0 bg-black/45 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-[#dce4dd] shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-5 border-b border-[#eef2ee] flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold tracking-widest text-[#1f5a49] uppercase">
                  Sesión de Mesa Sin Reserva
                </span>
                <h3 className="text-base font-bold text-[#1b2925]">
                  Abrir Walk-in · Mesa {walkInTable.number}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setWalkInTable(null)}
                className="p-1 rounded text-[#68766f] hover:bg-[#f4f6f4]"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleWalkInSubmit} className="p-5 space-y-4">
              <div>
                <label className="text-xs font-semibold text-[#1b2925] block mb-1">
                  Comensales (Capacidad Mesa {walkInTable.number}: {walkInTable.capacity} pax)
                </label>
                <input
                  type="number"
                  min={1}
                  max={walkInTable.capacity}
                  required
                  value={walkInGuests}
                  onChange={(e) => setWalkInGuests(parseInt(e.target.value, 10) || 1)}
                  className="w-full p-2 border border-[#dce4dd] rounded-lg text-sm font-mono font-bold"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-[#1b2925] block mb-1">
                  Notas de servicio (Opcional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Ej. Comensales de paso, sin reserva previa..."
                  value={walkInNotes}
                  onChange={(e) => setWalkInNotes(e.target.value)}
                  className="w-full p-2 border border-[#dce4dd] rounded-lg text-xs"
                />
              </div>

              <div className="pt-3 border-t border-[#eef2ee] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setWalkInTable(null)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-[#dce4dd]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-[#1f5a49] text-white hover:bg-[#174639]"
                >
                  {busy ? 'Abriendo sesión...' : 'Iniciar Walk-in'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Liberación Operativa Auditada (Solo Walk-in / Huérfana) */}
      {operationalReleaseTable && (
        <div className="fixed inset-0 bg-black/45 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-[#dce4dd] shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-5 border-b border-[#eef2ee] flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold tracking-widest text-amber-700 uppercase">
                  Liberación Operativa
                </span>
                <h3 className="text-base font-bold text-[#1b2925]">
                  Liberar Mesa {operationalReleaseTable.number}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setOperationalReleaseTable(null)}
                className="p-1 rounded text-[#68766f] hover:bg-[#f4f6f4]"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleOperationalReleaseSubmit} className="p-5 space-y-4">
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 flex items-start gap-2">
                <ShieldAlert size={16} className="text-amber-700 shrink-0 mt-0.5" />
                <span>
                  Solo aplicable a sesiones walk-in u ocupaciones sin reserva. Las sesiones vinculadas a reservas deben finalizarse con <strong>Finalizar Servicio</strong> o <strong>Cancelar Reserva</strong>.
                </span>
              </div>

              <div>
                <label className="text-xs font-semibold text-[#1b2925] block mb-1">
                  Motivo operativo (mínimo 5 caracteres) *
                </label>
                <textarea
                  required
                  minLength={5}
                  rows={2}
                  placeholder="Ej. Comensales se retiraron antes de lo previsto..."
                  value={operationalReleaseReason}
                  onChange={(e) => setOperationalReleaseReason(e.target.value)}
                  className="w-full p-2 border border-[#dce4dd] rounded-lg text-xs"
                />
              </div>

              <div className="pt-3 border-t border-[#eef2ee] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOperationalReleaseTable(null)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-[#dce4dd]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy || operationalReleaseReason.trim().length < 5}
                  className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-amber-700 text-white hover:bg-amber-800 disabled:opacity-50"
                >
                  {busy ? 'Liberando...' : 'Confirmar Liberación'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Reasignar Mesas */}
      {reassigningReservation && (
        <div className="fixed inset-0 bg-black/45 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-[#dce4dd] shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="p-5 border-b border-[#eef2ee] flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold tracking-widest text-[#1f5a49] uppercase">
                  Reasignación Auditada
                </span>
                <h3 className="text-base font-bold text-[#1b2925]">
                  Reasignar Mesas · {reassigningReservation.customerName}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setReassigningReservation(null)}
                className="p-1 rounded text-[#68766f] hover:bg-[#f4f6f4]"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleReassignSubmit} className="p-5 space-y-4">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#68766f]">
                  Comensales: <strong>{reassigningReservation.guestsCount} pax</strong>
                </span>
                <span
                  className={`font-mono font-bold px-2 py-0.5 rounded ${
                    reassignCombinedCap < reassigningReservation.guestsCount
                      ? 'bg-red-100 text-red-800'
                      : 'bg-[#e8f1eb] text-[#174639]'
                  }`}
                >
                  Capacidad seleccionada: {reassignCombinedCap} pax
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto p-2 bg-[#f8faf8] border border-[#dce4dd] rounded-lg">
                {tables.map((t) => {
                  const selected = reassignTableIds.includes(t.id)
                  const disabled = !t.isActive || t.status === 'out_of_service'
                  return (
                    <button
                      key={t.id}
                      type="button"
                      disabled={disabled}
                      onClick={() =>
                        setReassignTableIds((prev) =>
                          prev.includes(t.id) ? prev.filter((id) => id !== t.id) : [...prev, t.id]
                        )
                      }
                      className={`px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
                        selected
                          ? 'bg-[#1f5a49] text-white'
                          : disabled
                            ? 'bg-gray-100 text-gray-400 opacity-50 cursor-not-allowed'
                            : 'bg-white border border-[#dce4dd] text-[#1b2925] hover:bg-[#eef2ee]'
                      }`}
                    >
                      Mesa {t.number} ({t.capacity} pax · {t.sector})
                    </button>
                  )
                })}
              </div>

              <div>
                <label className="text-xs font-semibold text-[#1b2925] block mb-1">
                  Motivo de reasignación (mínimo 5 caracteres) *
                </label>
                <textarea
                  required
                  minLength={5}
                  rows={2}
                  placeholder="Ej. Solicitud del cliente de mesa en terraza o mantenimiento preventivo..."
                  value={reassignReason}
                  onChange={(e) => setReassignReason(e.target.value)}
                  className="w-full p-2 border border-[#dce4dd] rounded-lg text-xs"
                />
              </div>

              <div className="pt-3 border-t border-[#eef2ee] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setReassigningReservation(null)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-[#dce4dd]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={
                    busy ||
                    reassignTableIds.length === 0 ||
                    reassignCombinedCap < reassigningReservation.guestsCount ||
                    reassignReason.trim().length < 5
                  }
                  className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-[#1f5a49] text-white hover:bg-[#174639] disabled:opacity-50"
                >
                  {busy ? 'Reasignando...' : 'Confirmar Reasignación'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Marcar No-Show */}
      {noShowTarget && (
        <div className="fixed inset-0 bg-black/45 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-[#dce4dd] shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-5 border-b border-[#eef2ee] flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold tracking-widest text-amber-700 uppercase">
                  Ausencia de Comensales
                </span>
                <h3 className="text-base font-bold text-[#1b2925]">
                  Marcar No-Show · {noShowTarget.customerName}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setNoShowTarget(null)}
                className="p-1 rounded text-[#68766f] hover:bg-[#f4f6f4]"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleNoShowSubmit} className="p-5 space-y-4">
              <p className="text-xs text-[#68766f]">
                Se registrará la ausencia, se liberará la disponibilidad de la(s) mesa(s) y se generará alerta administrativa.
              </p>

              <div>
                <label className="text-xs font-semibold text-[#1b2925] block mb-1">
                  Motivo / Observación *
                </label>
                <textarea
                  required
                  minLength={4}
                  rows={2}
                  value={noShowReason}
                  onChange={(e) => setNoShowReason(e.target.value)}
                  className="w-full p-2 border border-[#dce4dd] rounded-lg text-xs"
                />
              </div>

              <div className="pt-3 border-t border-[#eef2ee] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setNoShowTarget(null)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-[#dce4dd]"
                >
                  Cerrar
                </button>
                <button
                  type="submit"
                  disabled={busy || noShowReason.trim().length < 4}
                  className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-amber-700 text-white hover:bg-amber-800 disabled:opacity-50"
                >
                  {busy ? 'Registrando...' : 'Confirmar No-Show'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Modificar Capacidad */}
      {editingCapacityTable && (
        <div className="fixed inset-0 bg-black/45 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-[#dce4dd] shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-5 border-b border-[#eef2ee] flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold tracking-widest text-[#1f5a49] uppercase">
                  Auditoría Transaccional
                </span>
                <h3 className="text-base font-bold text-[#1b2925]">
                  Capacidad · Mesa {editingCapacityTable.number}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingCapacityTable(null)}
                className="p-1 rounded text-[#68766f] hover:bg-[#f4f6f4]"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCheckCapacitySubmit} className="p-5 space-y-4">
              <div>
                <label className="text-xs font-semibold text-[#1b2925] block mb-1">
                  Nueva Capacidad de Comensales (1 a 30)
                </label>
                <input
                  type="number"
                  min="1"
                  max="30"
                  required
                  value={newCapacity}
                  onChange={(e) => {
                    setNewCapacity(parseInt(e.target.value, 10) || 1)
                    setCapacityConflictWarning(null)
                    setCapacityHardBlocked(false)
                    setCapacityOpenSessionConflict(false)
                  }}
                  className="w-full p-2 border border-[#dce4dd] rounded-lg text-sm font-mono font-bold"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-[#1b2925] block mb-1">
                  Motivo Operativo del Cambio (mín. 5 caracteres; mín. 10 con p_force) *
                </label>
                <textarea
                  required
                  minLength={5}
                  rows={2}
                  placeholder="Detalla el motivo para registro inmutable en auditoría..."
                  value={capacityReason}
                  onChange={(e) => setCapacityReason(e.target.value)}
                  className="w-full p-2 border border-[#dce4dd] rounded-lg text-xs"
                />
              </div>

              {capacityConflictWarning && (
                <div
                  className={`p-3 rounded-lg text-xs space-y-2 border ${
                    capacityHardBlocked
                      ? 'bg-red-50 border-red-200 text-red-900'
                      : 'bg-amber-50 border-amber-200 text-amber-900'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-bold">
                    <AlertTriangle
                      size={15}
                      className={capacityHardBlocked ? 'text-red-700' : 'text-amber-700'}
                    />
                    <span>
                      {capacityHardBlocked
                        ? 'Bloqueo estricto de invariante de capacidad (SF422)'
                        : 'Conflicto con reservas existentes'}
                    </span>
                  </div>

                  {capacityHardBlocked ? (
                    <p>
                      {capacityOpenSessionConflict
                        ? 'Existe una sesión walk-in abierta con más comensales que la nueva capacidad. Cierre la sesión o aumente la capacidad.'
                        : `La capacidad combinada resultante quedaría por debajo de los comensales confirmados en ${capacityConflictWarning.length} reserva(s). Esta operación no puede forzarse ni siquiera por Super Admin; reasigne o cancele primero.`}
                    </p>
                  ) : (
                    <>
                      <p>
                        La nueva capacidad ({newCapacity}) afecta a {capacityConflictWarning.length} reserva(s) multi-mesa o confirmada(s).
                      </p>
                      {isSuperAdmin && (
                        <button
                          type="button"
                          onClick={() => void executeCapacityUpdate(true)}
                          disabled={busy || capacityReason.trim().length < 10}
                          className="w-full py-1.5 rounded bg-amber-700 text-white font-semibold text-xs hover:bg-amber-800 disabled:opacity-50"
                        >
                          {capacityReason.trim().length < 10
                            ? 'Escriba al menos 10 caracteres de motivo para forzar'
                            : 'Confirmar con Alerta Crítica a Supervisión'}
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}

              <div className="pt-3 border-t border-[#eef2ee] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingCapacityTable(null)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-[#dce4dd]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy || capacityReason.trim().length < 5 || capacityHardBlocked}
                  className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-[#1f5a49] text-white hover:bg-[#174639] disabled:opacity-50"
                >
                  {busy ? 'Verificando...' : 'Guardar y Auditar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Desactivar Mesa (Sin cancelación en cascada) */}
      {deactivatingTable && (
        <div className="fixed inset-0 bg-black/45 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-[#dce4dd] shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-5 border-b border-[#eef2ee] flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold tracking-widest text-red-700 uppercase">
                  Mantenimiento de Salón
                </span>
                <h3 className="text-base font-bold text-[#1b2925]">
                  Desactivar Mesa {deactivatingTable.number}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setDeactivatingTable(null)}
                className="p-1 rounded text-[#68766f] hover:bg-[#f4f6f4]"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleDeactivateSubmit} className="p-5 space-y-4">
              {isDeactivationBlocked && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-900 space-y-1.5">
                  <span className="font-bold flex items-center gap-1.5">
                    <AlertTriangle size={14} className="text-red-700" />
                    Operación bloqueada hasta resolver dependencias
                  </span>
                  {deactivateHasOpenSessions && (
                    <p>
                      · Hay {deactivateOpenSessionsCount} sesión(es) de mesa abierta(s). Ciérrelas antes de desactivar la mesa.
                    </p>
                  )}
                  {deactivateFutureReservations.length > 0 && (
                    <p>
                      · Hay {deactivateFutureReservations.length} reserva(s) activa(s) asignada(s). Use <strong>Reasignar Mesas</strong> o <strong>Cancelar Reserva</strong> explícitamente desde la agenda o ficha de mesa.
                    </p>
                  )}
                </div>
              )}

              <div>
                <label className="text-xs font-semibold text-[#1b2925] block mb-1">
                  Motivo de la Puesta Fuera de Servicio (mín. 5 caracteres) *
                </label>
                <textarea
                  required
                  minLength={5}
                  rows={2}
                  placeholder="Ej. Pata inestable, mantenimiento eléctrico o limpieza profunda..."
                  value={deactivateReason}
                  onChange={(e) => setDeactivateReason(e.target.value)}
                  className="w-full p-2 border border-[#dce4dd] rounded-lg text-xs"
                />
              </div>

              <div className="pt-3 border-t border-[#eef2ee] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDeactivatingTable(null)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-[#dce4dd]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy || deactivateReason.trim().length < 5 || isDeactivationBlocked}
                  className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-red-700 text-white hover:bg-red-800 disabled:opacity-50"
                >
                  {busy ? 'Aplicando...' : 'Poner Fuera de Servicio'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Cancelar Reserva */}
      {cancellingReservation && (
        <div className="fixed inset-0 bg-black/45 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-[#dce4dd] shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-5 border-b border-[#eef2ee] flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold tracking-widest text-red-700 uppercase">
                  Cancelación de Agenda
                </span>
                <h3 className="text-base font-bold text-[#1b2925]">
                  Cancelar Reserva de {cancellingReservation.customerName}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setCancellingReservation(null)}
                className="p-1 rounded text-[#68766f] hover:bg-[#f4f6f4]"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCancelReservationSubmit} className="p-5 space-y-4">
              <p className="text-xs text-[#68766f]">
                Esta acción liberará la mesa asignada (cerrando sesiones vinculadas si la reserva estaba sentada) y emitirá una alerta al Administrador Principal.
              </p>

              <div>
                <label className="text-xs font-semibold text-[#1b2925] block mb-1">
                  Motivo de la Cancelación (mín. 4 caracteres) *
                </label>
                <textarea
                  required
                  minLength={4}
                  rows={2}
                  placeholder="Ej. Aviso telefónico del cliente o reprogramación..."
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  className="w-full p-2 border border-[#dce4dd] rounded-lg text-xs"
                />
              </div>

              <div className="pt-3 border-t border-[#eef2ee] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCancellingReservation(null)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-[#dce4dd]"
                >
                  Cerrar
                </button>
                <button
                  type="submit"
                  disabled={busy || cancelReason.trim().length < 4}
                  className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-red-700 text-white hover:bg-red-800 disabled:opacity-50"
                >
                  {busy ? 'Cancelando...' : 'Confirmar Cancelación'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bottom: Agenda General de Reservas */}
      <section className="bg-white border border-[#dce4dd] rounded-xl p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#eef2ee]">
          <div>
            <span className="text-[10px] font-bold tracking-widest text-[#1f5a49] uppercase">
              Agenda de Servicio
            </span>
            <h2 className="text-base font-bold text-[#1b2925]">
              Reservas Programadas del Salón
            </h2>
          </div>
          <span className="text-xs text-[#68766f]">
            {reservations.filter((r) => r.status === 'confirmed' || r.status === 'seated').length} activas · Trazabilidad auditada
          </span>
        </div>

        <div className="overflow-x-auto mt-4">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[#eef2ee] text-[#68766f] font-semibold">
                <th className="pb-3">Titular</th>
                <th className="pb-3">Mesa(s)</th>
                <th className="pb-3">Comensales</th>
                <th className="pb-3">Horario</th>
                <th className="pb-3">Estado</th>
                <th className="pb-3">Notas</th>
                <th className="pb-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f4f6f4]">
              {reservations.map((res) => {
                const isClosed =
                  res.status === 'cancelled' || res.status === 'completed' || res.status === 'no_show'
                const badgeClass =
                  res.status === 'confirmed'
                    ? 'bg-emerald-50 text-emerald-800'
                    : res.status === 'seated'
                      ? 'bg-blue-50 text-blue-800'
                      : res.status === 'completed'
                        ? 'bg-slate-100 text-slate-700'
                        : res.status === 'no_show'
                          ? 'bg-amber-50 text-amber-800'
                          : 'bg-gray-100 text-gray-600'
                const badgeLabel =
                  res.status === 'confirmed'
                    ? 'Confirmada'
                    : res.status === 'seated'
                      ? 'En curso'
                      : res.status === 'completed'
                        ? 'Finalizada'
                        : res.status === 'no_show'
                          ? 'No-Show'
                          : 'Cancelada'

                return (
                  <tr key={res.id} className={isClosed ? 'opacity-60' : ''}>
                    <td className="py-3 font-bold text-[#1b2925]">{res.customerName}</td>
                    <td className="py-3">
                      <span className="font-mono font-semibold text-[#1f5a49]">
                        {res.tableNumbers && res.tableNumbers.length > 1
                          ? `Mesas #${res.tableNumbers.join(' + #')}`
                          : `Mesa ${res.tableNumber}`}
                      </span>
                    </td>
                    <td className="py-3">{res.guestsCount} personas</td>
                    <td className="py-3">
                      <span className="flex items-center gap-1 font-mono text-[#405047]">
                        <Clock size={12} /> {res.time}
                      </span>
                    </td>
                    <td className="py-3">
                      <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${badgeClass}`}>
                        {badgeLabel}
                      </span>
                    </td>
                    <td className="py-3 text-[#68766f] max-w-xs truncate">{res.notes || '—'}</td>
                    <td className="py-3 text-right">
                      {!isClosed && (
                        <div className="inline-flex items-center gap-2.5">
                          {res.status === 'confirmed' && (
                            <>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void handleSeatReservation(res)}
                                className="text-blue-700 hover:text-blue-900 font-semibold"
                              >
                                Sentar
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => openReassignModal(res)}
                                className="text-[#1f5a49] hover:underline font-semibold inline-flex items-center gap-0.5"
                              >
                                <ArrowLeftRight size={11} /> Reasignar
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                  setNoShowTarget(res)
                                  setNoShowReason('Ausencia del cliente (no-show)')
                                }}
                                className="text-amber-700 hover:text-amber-900 font-semibold inline-flex items-center gap-0.5"
                              >
                                <UserX size={11} /> No-Show
                              </button>
                            </>
                          )}
                          {res.status === 'seated' && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handleCompleteService(res)}
                              className="text-emerald-700 hover:text-emerald-900 font-semibold inline-flex items-center gap-0.5"
                            >
                              <CheckCircle size={11} /> Finalizar
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setCancellingReservation(res)
                              setCancelReason('')
                            }}
                            className="text-red-700 hover:text-red-900 font-semibold"
                          >
                            Cancelar...
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
