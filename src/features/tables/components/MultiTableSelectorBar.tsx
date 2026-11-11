import { useState } from 'react'
import {
  AlertCircle,
  Armchair,
  CalendarPlus,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Info,
  LoaderCircle,
  Trash2,
  X,
} from 'lucide-react'
import type { CreateReservationInput, RestaurantTable } from '../tables.types'

interface MultiTableSelectorBarProps {
  selectedTables: RestaurantTable[]
  onRemoveTable: (id: string) => void
  onClearSelection: () => void
  onCreateReservation: (input: CreateReservationInput) => Promise<void>
}

export function MultiTableSelectorBar({
  selectedTables,
  onRemoveTable,
  onClearSelection,
  onCreateReservation,
}: MultiTableSelectorBarProps) {
  const [isOpenForm, setIsOpenForm] = useState(false)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [partySize, setPartySize] = useState('4')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [time, setTime] = useState('20:30')
  const [durationMinutes, setDurationMinutes] = useState('120')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  if (selectedTables.length === 0) return null

  const totalCapacity = selectedTables.reduce((sum, t) => sum + t.capacity, 0)
  const requestedPeople = Number.parseInt(partySize, 10) || 0
  const isCapacitySufficient = requestedPeople <= totalCapacity

  async function handleConfirmReservation(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (!customerName.trim()) {
      setError('El nombre del comensal es obligatorio.')
      return
    }

    if (!isCapacitySufficient) {
      setError(
        `Capacidad insuficiente: las mesas seleccionadas suman ${totalCapacity} lugares, pero la reserva es para ${requestedPeople} personas.`,
      )
      return
    }

    const startDateTime = new Date(`${date}T${time}:00`)
    if (Number.isNaN(startDateTime.getTime())) {
      setError('Fecha u hora seleccionada inválida.')
      return
    }

    setSaving(true)
    try {
      await onCreateReservation({
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim() || undefined,
        partySize: requestedPeople,
        startTime: startDateTime.toISOString(),
        durationMinutes: Number.parseInt(durationMinutes, 10) || 120,
        tableIds: selectedTables.map((t) => t.id),
        notes: notes.trim() || undefined,
      })
      setSuccess('¡Reserva creada y mesas asignadas exitosamente!')
      setTimeout(() => {
        setIsOpenForm(false)
        onClearSelection()
        setCustomerName('')
        setCustomerPhone('')
        setNotes('')
      }, 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear la reserva.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <aside className="multi-table-bar" aria-label="Selector de mesas múltiples">
      <div className="multi-table-bar__summary">
        <div className="multi-table-bar__info">
          <span className="multi-table-bar__count">
            <strong>{selectedTables.length}</strong> {selectedTables.length === 1 ? 'mesa seleccionada' : 'mesas seleccionadas'}:
          </span>
          <div className="multi-table-bar__tags">
            {selectedTables.map((t) => (
              <span key={t.id} className="table-tag">
                Mesa {t.number} ({t.capacity}p)
                <button
                  type="button"
                  onClick={() => onRemoveTable(t.id)}
                  aria-label={`Quitar mesa ${t.number}`}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        </div>

        <div className="multi-table-bar__capacity">
          <div className="capacity-pill">
            <Armchair size={15} />
            <span>
              Capacidad total: <strong>{totalCapacity} personas</strong>
            </span>
          </div>

          <div className="multi-table-bar__actions">
            <button
              type="button"
              className="button button--ghost"
              onClick={onClearSelection}
              aria-label="Limpiar selección de mesas"
            >
              <Trash2 size={14} /> Limpiar
            </button>
            <button
              type="button"
              className="button button--primary"
              onClick={() => setIsOpenForm(!isOpenForm)}
            >
              <CalendarPlus size={15} />
              {isOpenForm ? 'Ocultar formulario' : 'Asignar a reserva'}
              {isOpenForm ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
        </div>
      </div>

      <div className="multi-table-bar__disclaimer">
        <Info size={13} />
        <span>
          Nota: La capacidad total es agregada. Verifique la proximidad física si requiere unir las mesas físicamente.
        </span>
      </div>

      {isOpenForm ? (
        <form onSubmit={handleConfirmReservation} className="multi-table-form">
          <h4 className="multi-table-form__title">Nueva reserva con mesas seleccionadas</h4>

          {error ? (
            <p className="form-error" role="alert">
              <AlertCircle size={15} /> {error}
            </p>
          ) : null}

          {success ? (
            <p className="form-success" role="alert">
              <CheckCircle2 size={15} /> {success}
            </p>
          ) : null}

          <div className="form-grid form-grid--3">
            <label className="field">
              <span>Nombre del cliente *</span>
              <div className="field-control">
                <input
                  type="text"
                  required
                  placeholder="Ej. María Gómez"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  disabled={saving}
                />
              </div>
            </label>

            <label className="field">
              <span>Teléfono</span>
              <div className="field-control">
                <input
                  type="tel"
                  placeholder="Ej. +54 9 11 1234-5678"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  disabled={saving}
                />
              </div>
            </label>

            <label className="field">
              <span>Cantidad de comensales *</span>
              <div className={`field-control ${!isCapacitySufficient ? 'field-control--danger' : ''}`}>
                <input
                  type="number"
                  required
                  min={1}
                  max={50}
                  value={partySize}
                  onChange={(e) => setPartySize(e.target.value)}
                  disabled={saving}
                />
              </div>
              {!isCapacitySufficient ? (
                <span className="field-warning">
                  ¡Atención! La reserva ({requestedPeople}p) supera la capacidad ({totalCapacity}p).
                </span>
              ) : null}
            </label>
          </div>

          <div className="form-grid form-grid--3">
            <label className="field">
              <span>Fecha *</span>
              <div className="field-control">
                <input
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  disabled={saving}
                />
              </div>
            </label>

            <label className="field">
              <span>Hora de inicio *</span>
              <div className="field-control">
                <input
                  type="time"
                  required
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  disabled={saving}
                />
              </div>
            </label>

            <label className="field">
              <span>Duración (minutos)</span>
              <div className="field-control">
                <select
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(e.target.value)}
                  disabled={saving}
                >
                  <option value="60">1 hora (60 min)</option>
                  <option value="90">1 hora y media (90 min)</option>
                  <option value="120">2 horas (120 min) - Predeterminado</option>
                  <option value="150">2 horas y media (150 min)</option>
                  <option value="180">3 horas (180 min)</option>
                </select>
              </div>
            </label>
          </div>

          <label className="field">
            <span>Notas o requerimientos especiales</span>
            <div className="field-control">
              <input
                type="text"
                placeholder="Ej. Cumpleaños, ubicación cerca de ventana, comensal en silla de ruedas"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={saving}
              />
            </div>
          </label>

          <div className="multi-table-form__footer">
            <button
              type="submit"
              className="button button--primary"
              disabled={saving || !isCapacitySufficient}
            >
              {saving ? <LoaderCircle className="spin" size={16} /> : null}
              Confirmar reserva y bloquear mesas
            </button>
          </div>
        </form>
      ) : null}
    </aside>
  )
}
