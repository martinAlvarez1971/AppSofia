import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Armchair,
  Ban,
  Calendar,
  CheckCircle2,
  Clock,
  Edit2,
  LoaderCircle,
  RotateCcw,
  Users,
  Wrench,
  X,
} from 'lucide-react'
import type { RestaurantTable, TableOccupancy } from '../tables.types'

interface TableDetailModalProps {
  isOpen: boolean
  onClose: () => void
  table: RestaurantTable | null
  isSuperAdmin: boolean
  onEdit: (table: RestaurantTable) => void
  onToggleService: (table: RestaurantTable) => Promise<void>
  onToggleStatus: (table: RestaurantTable) => Promise<void>
  onUpdateOccupancy: (table: RestaurantTable, occupancy: TableOccupancy) => Promise<void>
}

function formatDate(isoString: string) {
  try {
    return new Intl.DateTimeFormat('es-AR', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(isoString))
  } catch {
    return isoString
  }
}

export function TableDetailModal({
  isOpen,
  onClose,
  table,
  isSuperAdmin,
  onEdit,
  onToggleService,
  onToggleStatus,
  onUpdateOccupancy,
}: TableDetailModalProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmDeactivate, setConfirmDeactivate] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setError('')
    setConfirmDeactivate(false)
  }, [table, isOpen])

  useEffect(() => {
    if (!isOpen) return
    const dialog = dialogRef.current
    const focusable = () =>
      dialog?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]',
      )
    focusable()?.[0]?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen || !table) return null

  async function handleOccupancyChange(newOccupancy: TableOccupancy) {
    if (!table) return
    setError('')
    setBusy(true)
    try {
      await onUpdateOccupancy(table, newOccupancy)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cambiar ocupación')
    } finally {
      setBusy(false)
    }
  }

  async function handleServiceToggle() {
    if (!table) return
    setError('')
    setBusy(true)
    try {
      await onToggleService(table)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cambiar estado de servicio')
    } finally {
      setBusy(false)
    }
  }

  async function handleStatusToggle() {
    if (!table) return
    setError('')
    setBusy(true)
    try {
      await onToggleStatus(table)
      setConfirmDeactivate(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cambiar estado de la mesa')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-box modal-box--detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="table-detail-title"
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-box__header">
          <div>
            <span className="eyebrow">DETALLE DE MESA</span>
            <h2 id="table-detail-title">Mesa {table.number}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Cerrar modal"
          >
            <X size={18} />
          </button>
        </div>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="detail-grid">
          <div className="detail-item">
            <span className="detail-label">Sector / Ubicación</span>
            <strong>{table.sector || 'Salón General'}</strong>
          </div>

          <div className="detail-item">
            <span className="detail-label">Capacidad</span>
            <strong>
              <Armchair size={15} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              {table.capacity} personas {table.minCapacity > 1 ? `(mín. ${table.minCapacity})` : ''}
            </strong>
          </div>

          <div className="detail-item">
            <span className="detail-label">Estado operativo</span>
            {table.status === 'inactive' ? (
              <span className="status-pill status-pill--inactive">
                <Ban size={13} /> Desactivada / Archivada
              </span>
            ) : table.isOutOfService ? (
              <span className="status-pill status-pill--warning">
                <Wrench size={13} /> Fuera de servicio
              </span>
            ) : (
              <span className="status-pill status-pill--success">
                <CheckCircle2 size={13} /> Operativa
              </span>
            )}
          </div>

          <div className="detail-item">
            <span className="detail-label">Ocupación presencial</span>
            {table.currentOccupancy === 'occupied' ? (
              <span className="status-pill status-pill--danger">
                <Users size={13} /> Ocupada ahora
              </span>
            ) : (
              <span className="status-pill status-pill--success">
                <CheckCircle2 size={13} /> Libre ahora
              </span>
            )}
          </div>
        </div>

        <div className="detail-section">
          <h3>
            <Calendar size={16} /> Próxima reserva programada
          </h3>
          {table.nextReservation ? (
            <div className="next-res-card">
              <div className="next-res-card__time">
                <Clock size={16} />
                <span>
                  {formatDate(table.nextReservation.startTime)}
                </span>
              </div>
              <div className="next-res-card__info">
                <strong>{table.nextReservation.customerName}</strong>
                <span>{table.nextReservation.partySize} personas</span>
              </div>
            </div>
          ) : (
            <p className="empty-text">No hay reservas programadas para las próximas horas.</p>
          )}
        </div>

        <div className="detail-actions">
          <span className="detail-actions__label">ACCIONES DE OPERACIÓN</span>
          <div className="detail-actions__row">
            {table.status === 'active' && !table.isOutOfService ? (
              table.currentOccupancy === 'occupied' ? (
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => handleOccupancyChange('free')}
                  disabled={busy}
                >
                  {busy ? <LoaderCircle className="spin" size={15} /> : null}
                  Liberar mesa
                </button>
              ) : (
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => handleOccupancyChange('occupied')}
                  disabled={busy}
                >
                  {busy ? <LoaderCircle className="spin" size={15} /> : null}
                  Marcar como ocupada
                </button>
              )
            ) : null}

            {isSuperAdmin ? (
              <>
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => {
                    onClose()
                    onEdit(table)
                  }}
                  disabled={busy}
                >
                  <Edit2 size={14} /> Editar datos
                </button>

                <button
                  type="button"
                  className="button button--secondary"
                  onClick={handleServiceToggle}
                  disabled={busy}
                >
                  <Wrench size={14} />
                  {table.isOutOfService ? 'Habilitar servicio' : 'Poner fuera de servicio'}
                </button>

                {table.status === 'active' ? (
                  confirmDeactivate ? (
                    <div className="confirm-box">
                      <p>
                        <AlertTriangle size={14} /> ¿Confirmás desactivar la mesa {table.number}?
                      </p>
                      <button
                        type="button"
                        className="button button--danger"
                        onClick={handleStatusToggle}
                        disabled={busy}
                      >
                        Sí, desactivar
                      </button>
                      <button
                        type="button"
                        className="button button--secondary"
                        onClick={() => setConfirmDeactivate(false)}
                        disabled={busy}
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="button button--danger-outline"
                      onClick={() => setConfirmDeactivate(true)}
                      disabled={busy}
                    >
                      <Ban size={14} /> Desactivar mesa
                    </button>
                  )
                ) : (
                  <button
                    type="button"
                    className="button button--secondary"
                    onClick={handleStatusToggle}
                    disabled={busy}
                  >
                    <RotateCcw size={14} /> Reactivar mesa
                  </button>
                )}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
