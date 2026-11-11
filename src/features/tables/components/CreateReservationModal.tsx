import { useState } from 'react'
import {
  Calendar,
  Clock,
  Mail,
  Phone,
  User,
  Users,
  X,
  AlertCircle,
  Armchair,
  Check,
} from 'lucide-react'
import type { Table, CreateReservationPayload } from '../tables.types'

interface CreateReservationModalProps {
  initialTables: Table[]
  allTables: Table[]
  initialGuestsCount?: number
  defaultDurationMinutes?: number
  onClose: () => void
  onSubmit: (payload: CreateReservationPayload) => Promise<void>
  busy: boolean
}

export function CreateReservationModal({
  initialTables,
  allTables,
  initialGuestsCount = 4,
  defaultDurationMinutes = 120,
  onClose,
  onSubmit,
  busy,
}: CreateReservationModalProps) {
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [guestsCount, setGuestsCount] = useState<number>(initialGuestsCount)
  const [selectedTableIds, setSelectedTableIds] = useState<string[]>(
    initialTables.map((t) => t.id)
  )

  const defaultDate = new Date(Date.now() + 2 * 3600 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  const defaultIsoDate = `${defaultDate.getFullYear()}-${pad(defaultDate.getMonth() + 1)}-${pad(defaultDate.getDate())}T${pad(defaultDate.getHours())}:00`

  const [startTime, setStartTime] = useState(defaultIsoDate)
  const [durationMinutes, setDurationMinutes] = useState(defaultDurationMinutes)
  const [notes, setNotes] = useState('')
  const [formError, setFormError] = useState('')

  const selectedTables = allTables.filter((t) => selectedTableIds.includes(t.id))
  const combinedCapacity = selectedTables.reduce((acc, t) => acc + t.capacity, 0)
  const hasCapacityDeficit = combinedCapacity < guestsCount

  function toggleTable(tableId: string) {
    setSelectedTableIds((prev) =>
      prev.includes(tableId) ? prev.filter((id) => id !== tableId) : [...prev, tableId]
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError('')

    if (!customerName.trim() || customerName.trim().length < 2) {
      setFormError('Ingrese el nombre del titular (mínimo 2 caracteres).')
      return
    }

    if (selectedTableIds.length === 0) {
      setFormError('Debe seleccionar al menos una mesa para asignar la reserva.')
      return
    }

    if (guestsCount < 1) {
      setFormError('La cantidad de comensales debe ser de al menos 1 persona.')
      return
    }

    if (durationMinutes < 30 || durationMinutes > 360) {
      setFormError('La duración de la reserva debe estar entre 30 y 360 minutos.')
      return
    }

    if (hasCapacityDeficit) {
      setFormError(
        `La capacidad combinada de las mesas seleccionadas (${combinedCapacity} pax) es insuficiente para ${guestsCount} comensales. Seleccione una mesa adicional.`
      )
      return
    }

    try {
      await onSubmit({
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim() || undefined,
        customerEmail: customerEmail.trim() || undefined,
        guestsCount,
        startTime: new Date(startTime).toISOString(),
        durationMinutes,
        tableIds: selectedTableIds,
        notes: notes.trim() || undefined,
      })
    } catch (err: any) {
      setFormError(err.message || 'Error al registrar la reserva.')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/45 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl border border-[#dce4dd] shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between p-5 border-b border-[#eef2ee]">
          <div>
            <span className="text-[10px] font-bold tracking-widest text-[#1f5a49] uppercase">
              Asignación Inteligente
            </span>
            <h3 className="text-base font-bold text-[#1b2925]">
              Nueva Reserva en Salón
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-[#68766f] hover:bg-[#f4f6f4] hover:text-[#1b2925]"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
          {formError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-start gap-2">
              <AlertCircle size={15} className="text-red-600 shrink-0 mt-0.5" />
              <span>{formError}</span>
            </div>
          )}

          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-[#1b2925] block mb-1">
                Nombre del Titular *
              </label>
              <div className="flex items-center gap-2 px-3 py-2 border border-[#dce4dd] rounded-lg focus-within:border-[#1f5a49]">
                <User size={15} className="text-[#68766f]" />
                <input
                  type="text"
                  required
                  placeholder="Ej. Valeria Bianchi"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="w-full text-xs outline-none bg-transparent"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-[#1b2925] block mb-1">
                  Teléfono de Contacto
                </label>
                <div className="flex items-center gap-2 px-3 py-2 border border-[#dce4dd] rounded-lg focus-within:border-[#1f5a49]">
                  <Phone size={14} className="text-[#68766f]" />
                  <input
                    type="tel"
                    placeholder="+54 11 5555-0192"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    className="w-full text-xs outline-none bg-transparent"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-[#1b2925] block mb-1">
                  Email (Opcional)
                </label>
                <div className="flex items-center gap-2 px-3 py-2 border border-[#dce4dd] rounded-lg focus-within:border-[#1f5a49]">
                  <Mail size={14} className="text-[#68766f]" />
                  <input
                    type="email"
                    placeholder="cliente@ejemplo.com"
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    className="w-full text-xs outline-none bg-transparent"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 pt-2 border-t border-[#eef2ee]">
            <div>
              <label className="text-xs font-semibold text-[#1b2925] block mb-1">
                Comensales *
              </label>
              <div className="flex items-center gap-2 px-3 py-2 border border-[#dce4dd] rounded-lg focus-within:border-[#1f5a49]">
                <Users size={15} className="text-[#68766f]" />
                <input
                  type="number"
                  min="1"
                  max="40"
                  required
                  value={guestsCount}
                  onChange={(e) => setGuestsCount(parseInt(e.target.value, 10) || 1)}
                  className="w-full text-xs font-mono font-bold outline-none bg-transparent"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-[#1b2925] block mb-1">
                Fecha y Hora *
              </label>
              <div className="flex items-center gap-1.5 px-2.5 py-2 border border-[#dce4dd] rounded-lg focus-within:border-[#1f5a49]">
                <Calendar size={14} className="text-[#68766f] shrink-0" />
                <input
                  type="datetime-local"
                  required
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full text-[11px] outline-none bg-transparent font-mono"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-[#1b2925] block mb-1">
                Duración (min)
              </label>
              <div className="flex items-center gap-1.5 px-2.5 py-2 border border-[#dce4dd] rounded-lg focus-within:border-[#1f5a49]">
                <Clock size={14} className="text-[#68766f] shrink-0" />
                <input
                  type="number"
                  min="30"
                  max="360"
                  step="15"
                  required
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(parseInt(e.target.value, 10) || 120)}
                  className="w-full text-xs font-mono font-bold outline-none bg-transparent"
                />
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-[#eef2ee]">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-[#1b2925] flex items-center gap-1.5">
                <Armchair size={14} className="text-[#1f5a49]" /> Asignación de Mesas
                (Soporta Unión Multi-Mesa)
              </label>
              <span
                className={`text-[11px] font-mono font-semibold px-2 py-0.5 rounded ${
                  hasCapacityDeficit
                    ? 'bg-red-100 text-red-800'
                    : 'bg-[#e8f1eb] text-[#174639]'
                }`}
              >
                Capacidad: {combinedCapacity} / {guestsCount} pax
              </span>
            </div>

            <p className="text-[11px] text-[#68766f] mb-2">
              Selecciona una o más mesas activas. PostgreSQL valida solapamiento horario y buffer en forma atómica:
            </p>

            <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-2 bg-[#f8faf8] border border-[#dce4dd] rounded-lg">
              {allTables.map((tbl) => {
                const isSelected = selectedTableIds.includes(tbl.id)
                const isReserved = tbl.status === 'reserved'
                const isOccupied = tbl.status === 'occupied'
                const isOutOfService = tbl.status === 'out_of_service' || !tbl.isActive
                const isUnavailable = !isSelected && isOutOfService

                return (
                  <button
                    key={tbl.id}
                    type="button"
                    disabled={isUnavailable}
                    onClick={() => toggleTable(tbl.id)}
                    title={
                      isOutOfService
                        ? `Mesa ${tbl.number} fuera de servicio`
                        : isReserved
                          ? `Mesa ${tbl.number} tiene reservas hoy; se validará superposición en el horario elegido`
                          : isOccupied
                            ? `Mesa ${tbl.number} está en servicio ahora; se validará superposición con la ventana estimada`
                            : undefined
                    }
                    className={`px-2.5 py-1.5 rounded text-xs font-medium flex items-center gap-1.5 transition-colors ${
                      isSelected
                        ? 'bg-[#1f5a49] text-white shadow-xs'
                        : isOutOfService
                          ? 'bg-gray-100 text-gray-400 border border-gray-200 opacity-50 cursor-not-allowed'
                          : isReserved
                            ? 'bg-rose-50 text-rose-800 border border-rose-200 hover:bg-rose-100'
                            : isOccupied
                              ? 'bg-blue-50 text-blue-800 border border-blue-200 hover:bg-blue-100'
                              : 'bg-white border border-[#dce4dd] text-[#1b2925] hover:bg-[#eef2ee]'
                    }`}
                  >
                    {isSelected && <Check size={12} />}
                    <span>Mesa {tbl.number} ({tbl.capacity} pax · {tbl.sector})</span>
                    {isReserved && !isSelected && (
                      <span className="text-[10px] font-bold text-rose-700 uppercase">· Con res.</span>
                    )}
                    {isOccupied && !isSelected && (
                      <span className="text-[10px] font-bold text-blue-700 uppercase">· En uso</span>
                    )}
                    {isOutOfService && !isSelected && (
                      <span className="text-[10px] font-medium text-gray-500">· Inactiva</span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-[#1b2925] block mb-1">
              Notas y Preferencias de Servicio
            </label>
            <textarea
              rows={2}
              placeholder="Ej. Aniversario de bodas, requiere mesa junto al ventanal..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full p-2.5 border border-[#dce4dd] rounded-lg text-xs outline-none focus:border-[#1f5a49]"
            />
          </div>

          <div className="pt-3 border-t border-[#eef2ee] flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-white border border-[#dce4dd] text-[#1b2925] hover:bg-[#f4f6f4]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy || selectedTableIds.length === 0}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#1f5a49] text-white hover:bg-[#174639] disabled:opacity-50 shadow-xs flex items-center gap-1.5"
            >
              {busy ? 'Registrando en PostgreSQL...' : 'Confirmar Reserva en Salón'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
