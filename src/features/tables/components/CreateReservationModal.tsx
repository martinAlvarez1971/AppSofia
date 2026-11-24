import { useState, useId } from 'react'
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
  Sparkles,
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

const COMMON_TIME_SLOTS = [
  { label: '12:30', time: '12:30', shift: 'Almuerzo' },
  { label: '13:00', time: '13:00', shift: 'Almuerzo' },
  { label: '13:30', time: '13:30', shift: 'Almuerzo' },
  { label: '14:00', time: '14:00', shift: 'Almuerzo' },
  { label: '20:30', time: '20:30', shift: 'Cena' },
  { label: '21:00', time: '21:00', shift: 'Cena' },
  { label: '21:30', time: '21:30', shift: 'Cena' },
  { label: '22:00', time: '22:00', shift: 'Cena' },
]

const QUICK_GUEST_OPTIONS = [2, 4, 6, 8]
const QUICK_DURATION_OPTIONS = [
  { label: '1h 30m', value: 90 },
  { label: '2h (Estándar)', value: 120 },
  { label: '2h 30m', value: 150 },
  { label: '3h', value: 180 },
]

export function CreateReservationModal({
  initialTables,
  allTables,
  initialGuestsCount = 4,
  defaultDurationMinutes = 120,
  onClose,
  onSubmit,
  busy,
}: CreateReservationModalProps) {
  const modalTitleId = useId()
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [guestsCount, setGuestsCount] = useState<number>(initialGuestsCount)
  const [selectedTableIds, setSelectedTableIds] = useState<string[]>(
    initialTables.map((t) => t.id)
  )

  const defaultDate = new Date(Date.now() + 2 * 3600 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  const defaultDateStr = `${defaultDate.getFullYear()}-${pad(defaultDate.getMonth() + 1)}-${pad(defaultDate.getDate())}`
  const defaultTimeStr = `${pad(defaultDate.getHours())}:00`

  const [datePart, setDatePart] = useState(defaultDateStr)
  const [timePart, setTimePart] = useState(defaultTimeStr)
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

    if (!datePart || !timePart) {
      setFormError('Seleccione la fecha y hora de la reserva.')
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

    const startDateTime = new Date(`${datePart}T${timePart}:00`)
    if (isNaN(startDateTime.getTime())) {
      setFormError('Fecha u hora seleccionada inválida.')
      return
    }

    try {
      await onSubmit({
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim() || undefined,
        customerEmail: customerEmail.trim() || undefined,
        guestsCount,
        startTime: startDateTime.toISOString(),
        durationMinutes,
        tableIds: selectedTableIds,
        notes: notes.trim() || undefined,
      })
    } catch (err: any) {
      setFormError(err.message || 'Error al registrar la reserva.')
    }
  }

  // Agrupación de mesas por sector para visualización ordenada
  const sectors = Array.from(new Set(allTables.map((t) => t.sector || 'Salón Principal')))

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={modalTitleId}
        className="bg-white rounded-2xl border border-[#dce4dd] shadow-2xl w-full max-w-xl overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Cabecera del modal */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#eef2ee] bg-[#fbfdfb]">
          <div>
            <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-widest text-[#1f5a49] uppercase">
              <Sparkles size={13} className="text-[#1f5a49]" />
              <span>Asignación Inteligente · Salón</span>
            </div>
            <h3 id={modalTitleId} className="text-lg font-bold text-[#1b2925]">
              Nueva Reserva en Salón
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#68766f] hover:bg-[#eef2ee] hover:text-[#1b2925] transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[82vh] overflow-y-auto">
          {formError && (
            <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 flex items-start gap-2.5">
              <AlertCircle size={16} className="text-red-600 shrink-0 mt-0.5" />
              <span className="font-medium">{formError}</span>
            </div>
          )}

          {/* Sección 1: Datos del Titular */}
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-[#1b2925] block mb-1.5">
                Nombre del Titular *
              </label>
              <div className="flex items-center gap-2.5 px-3.5 py-2.5 border border-[#dce4dd] rounded-xl focus-within:border-[#1f5a49] focus-within:ring-2 focus-within:ring-[#1f5a49]/10 bg-white transition-all">
                <User size={16} className="text-[#68766f]" />
                <input
                  type="text"
                  required
                  placeholder="Ej. Valeria Bianchi o Familia Pérez"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="w-full text-sm outline-none bg-transparent text-[#1b2925] placeholder:text-gray-400"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-[#1b2925] block mb-1.5">
                  Teléfono de Contacto
                </label>
                <div className="flex items-center gap-2.5 px-3.5 py-2.5 border border-[#dce4dd] rounded-xl focus-within:border-[#1f5a49] focus-within:ring-2 focus-within:ring-[#1f5a49]/10 bg-white transition-all">
                  <Phone size={15} className="text-[#68766f]" />
                  <input
                    type="tel"
                    placeholder="+54 11 5555-0192"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    className="w-full text-sm outline-none bg-transparent text-[#1b2925] placeholder:text-gray-400"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-[#1b2925] block mb-1.5">
                  Email (Opcional)
                </label>
                <div className="flex items-center gap-2.5 px-3.5 py-2.5 border border-[#dce4dd] rounded-xl focus-within:border-[#1f5a49] focus-within:ring-2 focus-within:ring-[#1f5a49]/10 bg-white transition-all">
                  <Mail size={15} className="text-[#68766f]" />
                  <input
                    type="email"
                    placeholder="cliente@ejemplo.com"
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    className="w-full text-sm outline-none bg-transparent text-[#1b2925] placeholder:text-gray-400"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Sección 2: Fecha y Hora de la Reserva (Rediseñado para máxima visibilidad) */}
          <div className="p-4 bg-[#f8faf8] border border-[#e2eae3] rounded-xl space-y-3">
            <span className="text-xs font-bold text-[#1f5a49] uppercase tracking-wider block">
              Programación de Turno
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-[#1b2925] block mb-1.5">
                  Fecha de Reserva *
                </label>
                <div className="flex items-center gap-2.5 px-3 py-2.5 bg-white border border-[#dce4dd] rounded-xl focus-within:border-[#1f5a49] focus-within:ring-2 focus-within:ring-[#1f5a49]/10 transition-all">
                  <Calendar size={16} className="text-[#1f5a49] shrink-0" />
                  <input
                    type="date"
                    required
                    value={datePart}
                    onChange={(e) => setDatePart(e.target.value)}
                    className="w-full text-sm font-medium outline-none bg-transparent text-[#1b2925]"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-[#1b2925] block mb-1.5">
                  Hora de Inicio *
                </label>
                <div className="flex items-center gap-2.5 px-3 py-2.5 bg-white border border-[#dce4dd] rounded-xl focus-within:border-[#1f5a49] focus-within:ring-2 focus-within:ring-[#1f5a49]/10 transition-all">
                  <Clock size={16} className="text-[#1f5a49] shrink-0" />
                  <input
                    type="time"
                    required
                    step="900"
                    value={timePart}
                    onChange={(e) => setTimePart(e.target.value)}
                    className="w-full text-sm font-bold font-mono outline-none bg-transparent text-[#1b2925]"
                  />
                </div>
              </div>
            </div>

            {/* Accesos rápidos de horario */}
            <div>
              <span className="text-[11px] font-medium text-[#68766f] block mb-1.5">
                Horarios habituales:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {COMMON_TIME_SLOTS.map((slot) => {
                  const isSelected = timePart === slot.time
                  return (
                    <button
                      key={slot.time}
                      type="button"
                      onClick={() => setTimePart(slot.time)}
                      className={`px-2.5 py-1 text-xs rounded-lg font-mono font-medium border transition-colors ${
                        isSelected
                          ? 'bg-[#1f5a49] text-white border-[#1f5a49] shadow-xs'
                          : 'bg-white text-[#1b2925] border-[#dce4dd] hover:bg-[#eef2ee]'
                      }`}
                    >
                      {slot.time}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Sección 3: Comensales y Duración */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-[#1b2925]">
                  Comensales *
                </label>
                <span className="text-[11px] text-[#68766f]">Personas</span>
              </div>
              <div className="flex items-center gap-2.5 px-3 py-2 border border-[#dce4dd] rounded-xl focus-within:border-[#1f5a49] bg-white">
                <Users size={16} className="text-[#68766f]" />
                <input
                  type="number"
                  min="1"
                  max="50"
                  required
                  value={guestsCount}
                  onChange={(e) => setGuestsCount(parseInt(e.target.value, 10) || 1)}
                  className="w-full text-sm font-mono font-bold outline-none bg-transparent"
                />
              </div>
              <div className="flex gap-1.5 mt-1.5">
                {QUICK_GUEST_OPTIONS.map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => setGuestsCount(num)}
                    className={`flex-1 py-1 text-xs rounded font-mono font-medium border transition-colors ${
                      guestsCount === num
                        ? 'bg-[#1f5a49] text-white border-[#1f5a49]'
                        : 'bg-[#f4f6f4] text-[#1b2925] border-transparent hover:bg-[#eef2ee]'
                    }`}
                  >
                    {num} pax
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-[#1b2925]">
                  Duración Estimada
                </label>
                <span className="text-[11px] text-[#68766f]">{durationMinutes} minutos</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {QUICK_DURATION_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setDurationMinutes(opt.value)}
                    className={`py-2 px-2 text-xs rounded-xl font-medium border text-center transition-colors ${
                      durationMinutes === opt.value
                        ? 'bg-[#1f5a49] text-white border-[#1f5a49] shadow-xs'
                        : 'bg-white text-[#1b2925] border-[#dce4dd] hover:bg-[#f4f6f4]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Sección 4: Asignación de Mesas */}
          <div className="pt-2 border-t border-[#eef2ee] space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-[#1b2925] flex items-center gap-1.5">
                <Armchair size={15} className="text-[#1f5a49]" /> Asignación de Mesas (Soporta Unión Multi-Mesa)
              </label>
              <span
                className={`text-xs font-mono font-bold px-2.5 py-1 rounded-lg border ${
                  hasCapacityDeficit
                    ? 'bg-rose-50 text-rose-800 border-rose-200'
                    : 'bg-[#e8f1eb] text-[#174639] border-[#c2dac8]'
                }`}
              >
                Capacidad: {combinedCapacity} / {guestsCount} pax
              </span>
            </div>

            {hasCapacityDeficit && (
              <p className="text-[11px] text-rose-700 bg-rose-50/70 p-2 rounded-lg border border-rose-100 flex items-center gap-1.5">
                <AlertCircle size={14} className="shrink-0 text-rose-600" />
                <span>La capacidad actual ({combinedCapacity} pax) es menor a los {guestsCount} comensales. Podés seleccionar más de una mesa para unirlas.</span>
              </p>
            )}

            <div className="space-y-2 max-h-44 overflow-y-auto p-2.5 bg-[#f8faf8] border border-[#dce4dd] rounded-xl">
              {sectors.map((sectorName) => {
                const sectorTables = allTables.filter((t) => (t.sector || 'Salón Principal') === sectorName)
                if (sectorTables.length === 0) return null
                return (
                  <div key={sectorName} className="space-y-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#68766f] px-1">
                      {sectorName}
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {sectorTables.map((tbl) => {
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
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
                              isSelected
                                ? 'bg-[#1f5a49] text-white shadow-xs font-semibold ring-2 ring-[#1f5a49]/30'
                                : isOutOfService
                                  ? 'bg-gray-100 text-gray-400 border border-gray-200 opacity-50 cursor-not-allowed'
                                  : isReserved
                                    ? 'bg-amber-50 text-amber-900 border border-amber-300 hover:bg-amber-100'
                                    : isOccupied
                                      ? 'bg-blue-50 text-blue-900 border border-blue-300 hover:bg-blue-100'
                                      : 'bg-white border border-[#dce4dd] text-[#1b2925] hover:bg-[#eef2ee]'
                            }`}
                          >
                            {isSelected ? <Check size={13} className="stroke-[3]" /> : <Armchair size={13} className="text-[#68766f]" />}
                            <span>Mesa {tbl.number} ({tbl.capacity} pax)</span>
                            {isReserved && !isSelected && (
                              <span className="text-[9px] font-bold text-amber-800 bg-amber-100/80 px-1 py-0.2 rounded uppercase">Res.</span>
                            )}
                            {isOccupied && !isSelected && (
                              <span className="text-[9px] font-bold text-blue-800 bg-blue-100/80 px-1 py-0.2 rounded uppercase">En uso</span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Sección 5: Notas y Observaciones */}
          <div>
            <label className="text-xs font-semibold text-[#1b2925] block mb-1.5">
              Notas y Preferencias de Servicio (Opcional)
            </label>
            <textarea
              rows={2}
              placeholder="Ej. Aniversario, requiere mesa junto al ventanal o trona para bebé..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full p-3 border border-[#dce4dd] rounded-xl text-xs outline-none focus:border-[#1f5a49] focus:ring-2 focus:ring-[#1f5a49]/10 resize-none transition-all placeholder:text-gray-400"
            />
          </div>

          {/* Acciones */}
          <div className="pt-3 border-t border-[#eef2ee] flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="px-4 py-2.5 text-xs font-semibold rounded-xl bg-white border border-[#dce4dd] text-[#1b2925] hover:bg-[#f4f6f4] transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy || selectedTableIds.length === 0}
              className="px-5 py-2.5 text-xs font-bold rounded-xl bg-[#1f5a49] text-white hover:bg-[#174639] disabled:opacity-50 shadow-sm flex items-center gap-2 transition-all"
            >
              {busy ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Registrando Reserva...</span>
                </>
              ) : (
                <>
                  <Check size={15} className="stroke-[2.5]" />
                  <span>Confirmar y Asignar Mesas</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
