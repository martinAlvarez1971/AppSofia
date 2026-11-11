import {
  AlertTriangle,
  Armchair,
  Ban,
  CheckCircle2,
  Clock,
  Eye,
  Users,
} from 'lucide-react'
import type { RestaurantTable, TableDerivedState } from '../tables.types'

interface TableCardProps {
  table: RestaurantTable
  isSelected: boolean
  onToggleSelect: (table: RestaurantTable) => void
  onOpenDetail: (table: RestaurantTable) => void
  onQuickOccupancyToggle: (table: RestaurantTable) => void
  isBusy: boolean
}

function getDerivedStateBadge(state: TableDerivedState) {
  switch (state) {
    case 'free':
      return {
        label: 'Libre ahora',
        className: 'badge--free',
        icon: CheckCircle2,
      }
    case 'occupied':
      return {
        label: 'Ocupada',
        className: 'badge--occupied',
        icon: Users,
      }
    case 'has_future_reservation':
      return {
        label: 'Reserva futura',
        className: 'badge--reserved',
        icon: Clock,
      }
    case 'out_of_service':
      return {
        label: 'Fuera de servicio',
        className: 'badge--out-of-service',
        icon: AlertTriangle,
      }
    case 'inactive':
      return {
        label: 'Inactiva',
        className: 'badge--inactive',
        icon: Ban,
      }
  }
}

function formatTime(isoString: string) {
  try {
    const date = new Date(isoString)
    return new Intl.DateTimeFormat('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date)
  } catch {
    return isoString
  }
}

export function TableCard({
  table,
  isSelected,
  onToggleSelect,
  onOpenDetail,
  onQuickOccupancyToggle,
  isBusy,
}: TableCardProps) {
  const badge = getDerivedStateBadge(table.derivedState)
  const BadgeIcon = badge.icon
  const isSelectable = table.status === 'active' && !table.isOutOfService

  return (
    <div
      className={`table-card table-card--${table.derivedState} ${
        isSelected ? 'table-card--selected' : ''
      }`}
      aria-label={`Mesa ${table.number}, capacidad ${table.capacity} personas, estado ${badge.label}`}
    >
      <div className="table-card__header">
        <label className="table-card__selector">
          <input
            type="checkbox"
            checked={isSelected}
            disabled={!isSelectable || isBusy}
            onChange={() => onToggleSelect(table)}
            aria-label={`Seleccionar mesa ${table.number}`}
          />
          <span className="table-card__number">Mesa {table.number}</span>
        </label>
        {table.sector ? <span className="table-card__sector">{table.sector}</span> : null}
      </div>

      <div className="table-card__body">
        <div className="table-card__capacity">
          <Armchair size={16} aria-hidden="true" />
          <span>
            <b>{table.capacity}</b> comensales
            {table.minCapacity > 1 ? <small> (mín. {table.minCapacity})</small> : null}
          </span>
        </div>

        <div className={`table-badge ${badge.className}`} role="status">
          <BadgeIcon size={14} aria-hidden="true" />
          <span>{badge.label}</span>
        </div>

        {table.nextReservation ? (
          <div className="table-card__next-res">
            <Clock size={13} aria-hidden="true" />
            <span>
              {formatTime(table.nextReservation.startTime)} ·{' '}
              <strong>{table.nextReservation.customerName}</strong> ({table.nextReservation.partySize}p)
            </span>
          </div>
        ) : (
          <div className="table-card__next-res table-card__next-res--empty">
            <span>Sin reservas programadas hoy</span>
          </div>
        )}
      </div>

      <div className="table-card__footer">
        <button
          type="button"
          className="table-card__btn"
          onClick={() => onOpenDetail(table)}
          disabled={isBusy}
          aria-label={`Ver detalles de la mesa ${table.number}`}
        >
          <Eye size={14} aria-hidden="true" />
          Detalle
        </button>

        {table.status === 'active' && !table.isOutOfService ? (
          <button
            type="button"
            className={`table-card__btn table-card__btn--occupancy ${
              table.currentOccupancy === 'occupied' ? 'btn--free-up' : 'btn--occupy'
            }`}
            onClick={() => onQuickOccupancyToggle(table)}
            disabled={isBusy}
            aria-label={
              table.currentOccupancy === 'occupied'
                ? `Liberar mesa ${table.number}`
                : `Ocupar mesa ${table.number}`
            }
          >
            {table.currentOccupancy === 'occupied' ? 'Liberar' : 'Ocupar'}
          </button>
        ) : null}
      </div>
    </div>
  )
}
