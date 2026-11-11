import { useEffect, useRef, useState, type FormEvent } from 'react'
import { LoaderCircle, X } from 'lucide-react'
import type { CreateTableInput, RestaurantTable } from '../tables.types'

interface TableModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (data: CreateTableInput) => Promise<void>
  initialData?: RestaurantTable | null
  existingSectors: string[]
}

export function TableModal({
  isOpen,
  onClose,
  onSave,
  initialData,
  existingSectors,
}: TableModalProps) {
  const [number, setNumber] = useState('')
  const [capacity, setCapacity] = useState('4')
  const [minCapacity, setMinCapacity] = useState('1')
  const [sector, setSector] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (initialData) {
      setNumber(initialData.number)
      setCapacity(initialData.capacity.toString())
      setMinCapacity(initialData.minCapacity.toString())
      setSector(initialData.sector || '')
    } else {
      setNumber('')
      setCapacity('4')
      setMinCapacity('1')
      setSector('')
    }
    setError('')
  }, [initialData, isOpen])

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

  if (!isOpen) return null

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')

    const cleanNumber = number.trim()
    if (!cleanNumber) {
      setError('El número o código de mesa es obligatorio.')
      return
    }

    const capNum = Number.parseInt(capacity, 10)
    if (Number.isNaN(capNum) || capNum < 1 || capNum > 30) {
      setError('La capacidad debe ser un número entero entre 1 y 30.')
      return
    }

    const minCapNum = minCapacity ? Number.parseInt(minCapacity, 10) : 1
    if (Number.isNaN(minCapNum) || minCapNum < 1 || minCapNum > capNum) {
      setError('La capacidad mínima debe ser mayor o igual a 1 y no puede superar la capacidad máxima.')
      return
    }

    setSaving(true)
    try {
      await onSave({
        number: cleanNumber,
        capacity: capNum,
        minCapacity: minCapNum,
        sector: sector.trim() || undefined,
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la mesa.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="table-modal-title"
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-box__header">
          <h2 id="table-modal-title">
            {initialData ? `Editar Mesa ${initialData.number}` : 'Nueva Mesa'}
          </h2>
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

        <form onSubmit={handleSubmit} className="modal-form">
          <label className="field">
            <span>Número o código visible *</span>
            <div className="field-control">
              <input
                type="text"
                required
                maxLength={20}
                placeholder="Ej. 1, 14, T1, VIP-2"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                disabled={saving}
              />
            </div>
            <small className="field-hint">Identificador único dentro del restaurante.</small>
          </label>

          <div className="form-grid">
            <label className="field">
              <span>Capacidad máxima *</span>
              <div className="field-control">
                <input
                  type="number"
                  required
                  min={1}
                  max={30}
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  disabled={saving}
                />
              </div>
            </label>

            <label className="field">
              <span>Capacidad mínima</span>
              <div className="field-control">
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={minCapacity}
                  onChange={(e) => setMinCapacity(e.target.value)}
                  disabled={saving}
                />
              </div>
            </label>
          </div>

          <label className="field">
            <span>Ubicación o sector</span>
            <div className="field-control">
              <input
                type="text"
                maxLength={50}
                placeholder="Ej. Salón Principal, Terraza, Patio, Barra"
                list="sectors-list"
                value={sector}
                onChange={(e) => setSector(e.target.value)}
                disabled={saving}
              />
              <datalist id="sectors-list">
                {existingSectors.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
          </label>

          <div className="modal-box__actions">
            <button
              type="button"
              className="button button--secondary"
              onClick={onClose}
              disabled={saving}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="button button--primary"
              disabled={saving}
            >
              {saving ? <LoaderCircle className="spin" size={16} /> : null}
              {initialData ? 'Guardar cambios' : 'Crear mesa'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
