import { useState, useMemo, useEffect } from 'react'
import {
  X,
  Plus,
  Trash2,
  AlertTriangle,
  Building2,
  Sparkles,
  Layers,
  Trees,
  Sun,
  ShieldCheck,
  Check,
  RotateCcw,
  RefreshCw,
} from 'lucide-react'
import type { Table, Reservation, CreateTablePayload, InitializeFloorPlanPayload } from '../tables.types'

interface SetupFloorPlanModalProps {
  isOpen: boolean
  onClose: () => void
  currentTables: Table[]
  reservations: Reservation[]
  onSubmitSingle: (payload: CreateTablePayload) => Promise<void>
  onSubmitBatch: (payload: InitializeFloorPlanPayload) => Promise<void>
  busy: boolean
}

const PRESET_SECTORS = [
  'Salón Principal',
  'Afuera o Exterior',
  'Terraza',
  'Salón Chico',
] as const

const INITIAL_SUGGESTION: CreateTablePayload[] = [
  { number: 1, capacity: 4, sector: 'Salón Principal', shape: 'square', maxCapacity: 4 },
  { number: 2, capacity: 2, sector: 'Salón Principal', shape: 'round', maxCapacity: 2 },
  { number: 3, capacity: 6, sector: 'Salón Principal', shape: 'rectangle', maxCapacity: 8 },
  { number: 4, capacity: 4, sector: 'Salón Principal', shape: 'square', maxCapacity: 6 },
  { number: 5, capacity: 8, sector: 'Salón Principal', shape: 'rectangle', maxCapacity: 10 },
  { number: 6, capacity: 4, sector: 'Afuera o Exterior', shape: 'square', maxCapacity: 4 },
  { number: 7, capacity: 4, sector: 'Afuera o Exterior', shape: 'round', maxCapacity: 4 },
  { number: 8, capacity: 6, sector: 'Afuera o Exterior', shape: 'rectangle', maxCapacity: 6 },
  { number: 9, capacity: 2, sector: 'Terraza', shape: 'round', maxCapacity: 2 },
  { number: 10, capacity: 4, sector: 'Terraza', shape: 'square', maxCapacity: 4 },
  { number: 11, capacity: 4, sector: 'Terraza', shape: 'round', maxCapacity: 5 },
  { number: 12, capacity: 4, sector: 'Salón Chico', shape: 'square', maxCapacity: 4 },
  { number: 13, capacity: 6, sector: 'Salón Chico', shape: 'rectangle', maxCapacity: 8 },
]

export function SetupFloorPlanModal({
  isOpen,
  onClose,
  currentTables,
  reservations,
  onSubmitSingle,
  onSubmitBatch,
  busy,
}: SetupFloorPlanModalProps) {
  // Por defecto abrir en 'scratch' para generar/reemplazar el plano de mesas
  const [activeTab, setActiveTab] = useState<'scratch' | 'single'>('scratch')
  const [error, setError] = useState('')

  // -------------------------------------------------------------
  // ESTADO: CARGA INDIVIDUAL
  // -------------------------------------------------------------
  const nextSuggestedNumber = useMemo(() => {
    if (currentTables.length === 0) return 1
    const max = Math.max(...currentTables.map((t) => t.number))
    return max + 1
  }, [currentTables])

  const [singleNumber, setSingleNumber] = useState<number>(nextSuggestedNumber)
  const [singleCapacity, setSingleCapacity] = useState<number>(4)
  const [singleMaxCapacity, setSingleMaxCapacity] = useState<number>(4)
  const [singleSector, setSingleSector] = useState<string>('Salón Principal')
  const [customSector, setCustomSector] = useState<string>('')
  const [singleShape, setSingleShape] = useState<'round' | 'square' | 'rectangle'>('square')

  // Set suggested number when modal opens
  const existingNumbers = useMemo(() => {
    return new Set(currentTables.map((t) => t.number))
  }, [currentTables])

  const isDuplicateNumber = existingNumbers.has(Number(singleNumber))

  // -------------------------------------------------------------
  // ESTADO: CARGA DESDE CERO / GENERAR NUEVO PLANO
  // Sincronizar batchList con las mesas existentes cada vez que se abre el modal
  // -------------------------------------------------------------
  const [batchList, setBatchList] = useState<CreateTablePayload[]>([])

  useEffect(() => {
    if (isOpen) {
      if (currentTables.length > 0) {
        const sorted = [...currentTables].sort((a, b) => a.number - b.number)
        setBatchList(
          sorted.map((t) => ({
            number: t.number,
            capacity: t.capacity,
            maxCapacity: t.maxCapacity || t.capacity,
            sector: t.sector,
            shape: t.shape || 'square',
          }))
        )
      } else {
        setBatchList(INITIAL_SUGGESTION)
      }
      setSingleNumber(nextSuggestedNumber)
      setError('')
    }
  }, [isOpen, currentTables, nextSuggestedNumber])

  // Por requerimiento: al generar un nuevo plano, se reemplaza automáticamente el anterior al guardar
  const [wipeExisting, setWipeExisting] = useState<boolean>(true)
  const [batchReason, setBatchReason] = useState<string>('Generación de nuevo plano del salón')

  if (!isOpen) return null

  // Helper de sector efectivo para carga individual
  const effectiveSector = singleSector === 'Personalizado' ? (customSector.trim() || 'Salón Principal') : singleSector

  // Manejador de carga individual
  async function handleSingleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    const num = Number(singleNumber)
    if (!num || num <= 0) {
      setError('El número de mesa debe ser un entero positivo.')
      return
    }

    if (existingNumbers.has(num)) {
      setError(`Ya existe la Mesa ${num} en el plano. Debe indicar un número no utilizado.`)
      return
    }

    const cap = Number(singleCapacity)
    if (!cap || cap < 1 || cap > 30) {
      setError('La cantidad de comensales debe estar entre 1 y 30.')
      return
    }

    try {
      await onSubmitSingle({
        number: num,
        capacity: cap,
        maxCapacity: Math.max(cap, Number(singleMaxCapacity) || cap),
        sector: effectiveSector,
        shape: singleShape,
      })
      onClose()
    } catch (err: any) {
      setError(err.message || 'Error al guardar la mesa en la base de datos.')
    }
  }

  // Manejador de carga desde cero / por lote
  async function handleBatchSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (batchList.length === 0) {
      setError('Agregue al menos una mesa a la lista.')
      return
    }

    // Validar números
    const seen = new Set<number>()
    for (const item of batchList) {
      const n = Number(item.number)
      if (!n || n <= 0) {
        setError(`El número de mesa ${item.number} no es válido.`)
        return
      }
      if (seen.has(n)) {
        setError(`Existe un número duplicado en la lista: Mesa ${n}. Cada mesa debe tener número único.`)
        return
      }
      seen.add(n)

      if (!wipeExisting && existingNumbers.has(n)) {
        setError(`La Mesa ${n} ya existe en el salón. Active "Reemplazar plano" o cambie el número.`)
        return
      }
    }

    // Comprobar si las mesas eliminadas del plano tienen reservas confirmadas activas
    if (wipeExisting) {
      const remainingNumbers = new Set(batchList.map((item) => Number(item.number)))
      const removedTables = currentTables.filter((t) => !remainingNumbers.has(t.number))

      for (const removed of removedTables) {
        const activeRes = reservations.find((r) => {
          if (r.status !== 'confirmed') return false
          if (r.tableId === removed.id || r.tableNumber === removed.number) return true
          if (r.tableIds && r.tableIds.includes(removed.id)) return true
          if (r.tableNumbers && r.tableNumbers.includes(removed.number)) return true
          return false
        })

        if (activeRes) {
          setError(
            `No es posible eliminar la Mesa ${removed.number} porque posee reservas confirmadas activas (${activeRes.customerName}, ${activeRes.time} hs). Ingrese a la agenda de reservas y cancele o reasigne la reserva antes de eliminar la mesa.`
          )
          return
        }
      }
    }

    try {
      await onSubmitBatch({
        tables: batchList,
        wipeExisting,
        reason: batchReason,
      })
      onClose()
    } catch (err: any) {
      setError(err.message || 'Error al persistir la configuración en la base de datos.')
    }
  }

  // Acciones en la lista masiva
  function addBatchRow() {
    const highest = batchList.length > 0 ? Math.max(...batchList.map((t) => t.number)) : 0
    setBatchList((prev) => [
      ...prev,
      {
        number: highest + 1,
        capacity: 4,
        maxCapacity: 4,
        sector: 'Salón Principal',
        shape: 'square',
      },
    ])
  }

  function removeBatchRow(index: number) {
    setBatchList((prev) => prev.filter((_, i) => i !== index))
  }

  function updateBatchRow(index: number, patch: Partial<CreateTablePayload>) {
    setBatchList((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...patch } : item))
    )
  }

  function loadPresetSuggestion() {
    setBatchList(INITIAL_SUGGESTION)
  }

  function restoreCurrentTables() {
    if (currentTables.length > 0) {
      const sorted = [...currentTables].sort((a, b) => a.number - b.number)
      setBatchList(
        sorted.map((t) => ({
          number: t.number,
          capacity: t.capacity,
          maxCapacity: t.maxCapacity || t.capacity,
          sector: t.sector,
          shape: t.shape || 'square',
        }))
      )
    } else {
      setBatchList([])
    }
  }

  // Resumen de plazas por sector para el lote
  const batchSummary = batchList.reduce(
    (acc, curr) => {
      acc.totalSeats += curr.capacity
      acc.bySector[curr.sector || 'Salón Principal'] =
        (acc.bySector[curr.sector || 'Salón Principal'] || 0) + curr.capacity
      return acc
    },
    { totalSeats: 0, bySector: {} as Record<string, number> }
  )

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-3xl w-full p-6 shadow-2xl border border-[#dce4dd] my-8 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between pb-4 border-b border-[#eef2ee] shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#1f5a49]" />
              <span className="text-[11px] font-bold tracking-widest text-[#1f5a49] uppercase">
                SUPERADMINISTRADOR · CONFIGURACIÓN DE SALÓN
              </span>
            </div>
            <h2 className="text-xl font-extrabold text-[#1b2925] mt-1">
              {activeTab === 'single' ? 'Nueva Mesa en Salón' : 'Cargar Mesas Desde Cero'}
            </h2>
            <p className="text-xs text-[#68766f] mt-0.5">
              Gestione el plano arquitectónico. Los datos se guardan de forma persistente en la base de datos de SOFIA.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-[#eef2ee] shrink-0 mt-3">
          <button
            type="button"
            onClick={() => {
              setActiveTab('scratch')
              setError('')
            }}
            className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === 'scratch'
                ? 'border-[#1f5a49] text-[#1f5a49]'
                : 'border-transparent text-[#68766f] hover:text-[#1b2925]'
            }`}
          >
            <Layers size={14} /> Generar Nuevo Plano (Reemplazo Automático)
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('single')
              setError('')
            }}
            className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === 'single'
                ? 'border-[#1f5a49] text-[#1f5a49]'
                : 'border-transparent text-[#68766f] hover:text-[#1b2925]'
            }`}
          >
            <Plus size={14} /> Agregar Mesa Individual
          </button>
        </div>

        {/* Error notice */}
        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs font-medium flex items-center gap-2 shrink-0">
            <AlertTriangle size={15} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Modal Body */}
        <div className="overflow-y-auto flex-1 pr-1 py-4">
          {activeTab === 'single' ? (
            /* TAB 1: CARGA INDIVIDUAL */
            <form onSubmit={handleSingleSubmit} className="space-y-5">
              {/* Número de Mesa */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold text-[#1b2925]">
                    Número de Mesa <span className="text-red-500">*</span>
                  </label>
                  <span className="text-[11px] text-[#68766f]">
                    {currentTables.length} mesas en salón actualmente
                  </span>
                </div>
                <div className="relative">
                  <input
                    type="number"
                    min={1}
                    max={999}
                    value={singleNumber}
                    onChange={(e) => setSingleNumber(parseInt(e.target.value, 10) || 1)}
                    required
                    className={`w-full px-3.5 py-2 text-sm font-semibold rounded-lg border focus:outline-none transition-colors ${
                      isDuplicateNumber
                        ? 'border-red-400 bg-red-50/50 text-red-900 focus:border-red-500'
                        : 'border-[#dce4dd] bg-white text-[#1b2925] focus:border-[#1f5a49]'
                    }`}
                    placeholder="Ej. 1"
                  />
                  {isDuplicateNumber && (
                    <span className="text-[11px] font-semibold text-red-600 block mt-1">
                      ⚠️ La Mesa {singleNumber} ya existe en el plano. Elija otro número.
                    </span>
                  )}
                </div>
              </div>

              {/* Cantidad de Personas (Capacidad) */}
              <div>
                <label className="text-xs font-bold text-[#1b2925] block mb-1.5">
                  Cantidad de Personas (Capacidad Estándar) <span className="text-red-500">*</span>
                </label>
                <div className="flex items-center gap-2 mb-2">
                  {[2, 4, 6, 8, 10].map((cap) => (
                    <button
                      key={cap}
                      type="button"
                      onClick={() => {
                        setSingleCapacity(cap)
                        if (singleMaxCapacity < cap) setSingleMaxCapacity(cap)
                      }}
                      className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all ${
                        singleCapacity === cap
                          ? 'bg-[#1f5a49] text-white border-[#1f5a49]'
                          : 'bg-white text-[#405047] border-[#dce4dd] hover:bg-[#f4f6f4]'
                      }`}
                    >
                      {cap} personas
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-[11px] text-[#68766f] block mb-1">Capacidad exacta:</span>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={singleCapacity}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10) || 1
                        setSingleCapacity(val)
                        if (singleMaxCapacity < val) setSingleMaxCapacity(val)
                      }}
                      className="w-full px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#dce4dd]"
                    />
                  </div>
                  <div>
                    <span className="text-[11px] text-[#68766f] block mb-1">Capacidad máxima (adicionales):</span>
                    <input
                      type="number"
                      min={singleCapacity}
                      max={40}
                      value={singleMaxCapacity}
                      onChange={(e) => setSingleMaxCapacity(parseInt(e.target.value, 10) || singleCapacity)}
                      className="w-full px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#dce4dd]"
                    />
                  </div>
                </div>
              </div>

              {/* Ubicación / Sector */}
              <div>
                <label className="text-xs font-bold text-[#1b2925] block mb-1.5">
                  Lugar donde se ubica la mesa (Sector del Restaurante)
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
                  {PRESET_SECTORS.map((sec) => (
                    <button
                      key={sec}
                      type="button"
                      onClick={() => setSingleSector(sec)}
                      className={`px-3 py-2 text-xs font-semibold rounded-lg border text-left flex items-center gap-2 transition-all ${
                        singleSector === sec
                          ? 'bg-[#eaf3ed] border-[#1f5a49] text-[#1f5a49] font-bold shadow-xs'
                          : 'bg-white border-[#dce4dd] text-[#405047] hover:bg-[#f9faf8]'
                      }`}
                    >
                      {sec === 'Salón Principal' && <Building2 size={14} className="shrink-0 text-[#1f5a49]" />}
                      {sec === 'Afuera o Exterior' && <Sun size={14} className="shrink-0 text-amber-600" />}
                      {sec === 'Terraza' && <Trees size={14} className="shrink-0 text-emerald-600" />}
                      {sec === 'Salón Chico' && <Sparkles size={14} className="shrink-0 text-indigo-600" />}
                      <span className="truncate">{sec}</span>
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSingleSector('Personalizado')}
                    className={`text-[11px] font-bold underline ${
                      singleSector === 'Personalizado' ? 'text-[#1f5a49]' : 'text-[#68766f]'
                    }`}
                  >
                    + Otro sector personalizado
                  </button>
                  {singleSector === 'Personalizado' && (
                    <input
                      type="text"
                      value={customSector}
                      onChange={(e) => setCustomSector(e.target.value)}
                      placeholder="Ej. Balcón, Cava, Jardín de Invierno"
                      className="flex-1 px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#dce4dd] bg-white"
                      autoFocus
                    />
                  )}
                </div>
              </div>

              {/* Forma / Geometría para el Plano */}
              <div>
                <label className="text-xs font-bold text-[#1b2925] block mb-1.5">
                  Forma Arquitectónica en el Plano
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'square', label: 'Cuadrada', desc: 'Típica 2-4 personas' },
                    { id: 'round', label: 'Redonda', desc: '2-5 personas circular' },
                    { id: 'rectangle', label: 'Rectangular', desc: '6+ personas o larga' },
                  ].map((shape) => (
                    <button
                      key={shape.id}
                      type="button"
                      onClick={() => setSingleShape(shape.id as any)}
                      className={`p-2.5 rounded-lg border text-left transition-all ${
                        singleShape === shape.id
                          ? 'border-[#1f5a49] bg-[#eaf3ed] text-[#1f5a49]'
                          : 'border-[#dce4dd] bg-white text-[#405047] hover:bg-[#f9faf8]'
                      }`}
                    >
                      <span className="text-xs font-bold block">{shape.label}</span>
                      <span className="text-[10px] text-[#68766f]">{shape.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Live Preview Card */}
              <div className="p-4 bg-[#f9faf8] border border-[#dce4dd] rounded-xl flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold tracking-wider text-[#68766f] uppercase block">
                    VISTA PREVIA EN EL PLANO
                  </span>
                  <div className="text-sm font-extrabold text-[#1b2925] mt-0.5">
                    Mesa {singleNumber || '—'} · {effectiveSector}
                  </div>
                  <div className="text-xs text-[#68766f]">
                    Capacidad: {singleCapacity} personas (hasta {singleMaxCapacity}) · Forma:{' '}
                    {singleShape === 'round' ? 'Redonda' : singleShape === 'rectangle' ? 'Rectangular' : 'Cuadrada'}
                  </div>
                </div>

                <div className="w-16 h-16 rounded-xl border-2 border-[#1f5a49] bg-white shadow-xs flex flex-col items-center justify-center relative">
                  <span className="text-xs font-black font-mono text-[#1f5a49]">#{singleNumber || 1}</span>
                  <span className="text-[9px] font-bold text-[#68766f]">{singleCapacity}p</span>
                </div>
              </div>

              {/* Submit Button */}
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={busy || isDuplicateNumber}
                  className="w-full py-2.5 bg-[#1f5a49] text-white text-xs font-bold rounded-lg hover:bg-[#174639] transition-colors shadow-xs disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <Check size={16} /> Guardar Mesa en Base de Datos
                </button>
              </div>
            </form>
          ) : (
            /* TAB 2: GENERAR NUEVO PLANO DE SALÓN (REEMPLAZO AUTOMÁTICO) */
            <form onSubmit={handleBatchSubmit} className="space-y-5">
              <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl">
                <div className="flex items-start gap-2.5">
                  <ShieldCheck size={18} className="text-[#1f5a49] shrink-0 mt-0.5" />
                  <div className="text-xs text-[#174639] leading-relaxed">
                    <span className="font-bold">Garantía de Persistencia Atómica:</span> Al generar y confirmar el nuevo plano, se eliminará automáticamente el dibujo anterior. <span className="font-semibold underline">El plano anterior no se borrará hasta que el nuevo plano se haya guardado con éxito en la base de datos.</span> Mientras esté configurando o si ocurre algún error, el plano actual se conservará intacto.
                  </div>
                </div>
              </div>

              {/* Botón de carga rápida de plantilla y restauración */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={restoreCurrentTables}
                    className="px-3 py-1.5 bg-white border border-[#dce4dd] text-[#1b2925] text-xs font-bold rounded-lg hover:bg-[#f4f6f4] transition-colors flex items-center gap-1.5 shadow-2xs"
                    title="Recarga las mesas actuales del salón"
                  >
                    <RefreshCw size={13} className="text-[#1f5a49]" /> Restaurar Mesas Actuales ({currentTables.length})
                  </button>

                  <button
                    type="button"
                    onClick={loadPresetSuggestion}
                    className="px-3 py-1.5 bg-[#eaf3ed] border border-[#1f5a49]/30 text-[#1f5a49] text-xs font-bold rounded-lg hover:bg-[#d8e9dc] transition-colors flex items-center gap-1.5"
                  >
                    <Sparkles size={14} /> Plantilla Sugerida (13 mesas)
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setBatchList([])}
                  className="text-xs text-[#68766f] hover:text-red-600 flex items-center gap-1 font-semibold px-2 py-1 rounded hover:bg-red-50"
                >
                  <RotateCcw size={12} /> Vaciar lista
                </button>
              </div>

              {/* Lista editable de mesas */}
              <div className="border border-[#dce4dd] rounded-xl overflow-hidden">
                <div className="bg-[#f4f6f4] px-3 py-2 border-b border-[#dce4dd] grid grid-cols-12 gap-2 text-[11px] font-bold text-[#1b2925]">
                  <div className="col-span-2">Mesa #</div>
                  <div className="col-span-3">Comensales</div>
                  <div className="col-span-4">Sector</div>
                  <div className="col-span-2">Forma</div>
                  <div className="col-span-1 text-right">Quitar</div>
                </div>

                <div className="divide-y divide-[#eef2ee] max-h-60 overflow-y-auto">
                  {batchList.map((item, idx) => (
                    <div key={idx} className="px-3 py-2 grid grid-cols-12 gap-2 items-center bg-white hover:bg-[#fafbfa]">
                      <div className="col-span-2">
                        <input
                          type="number"
                          min={1}
                          max={999}
                          value={item.number}
                          onChange={(e) =>
                            updateBatchRow(idx, { number: parseInt(e.target.value, 10) || 1 })
                          }
                          className="w-full px-2 py-1 text-xs font-bold rounded border border-[#dce4dd] text-center"
                        />
                      </div>

                      <div className="col-span-3 flex items-center gap-1">
                        <input
                          type="number"
                          min={1}
                          max={30}
                          value={item.capacity}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10) || 1
                            updateBatchRow(idx, { capacity: val, maxCapacity: Math.max(val, item.maxCapacity || val) })
                          }}
                          className="w-14 px-2 py-1 text-xs font-semibold rounded border border-[#dce4dd] text-center"
                        />
                        <span className="text-[10px] text-[#68766f]">pers.</span>
                      </div>

                      <div className="col-span-4">
                        <select
                          value={item.sector}
                          onChange={(e) => updateBatchRow(idx, { sector: e.target.value })}
                          className="w-full px-2 py-1 text-xs font-semibold rounded border border-[#dce4dd] bg-white"
                        >
                          {PRESET_SECTORS.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="col-span-2">
                        <select
                          value={item.shape || 'square'}
                          onChange={(e) => updateBatchRow(idx, { shape: e.target.value as any })}
                          className="w-full px-2 py-1 text-xs font-semibold rounded border border-[#dce4dd] bg-white"
                        >
                          <option value="square">Cuadrada</option>
                          <option value="round">Redonda</option>
                          <option value="rectangle">Rectangular</option>
                        </select>
                      </div>

                      <div className="col-span-1 text-right">
                        <button
                          type="button"
                          onClick={() => removeBatchRow(idx)}
                          className="text-gray-400 hover:text-red-600 p-1 rounded hover:bg-gray-100"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="bg-[#f9faf8] p-2.5 border-t border-[#dce4dd] flex justify-between items-center">
                  <button
                    type="button"
                    onClick={addBatchRow}
                    className="px-3 py-1 bg-white border border-[#dce4dd] text-[#1f5a49] text-xs font-bold rounded-lg hover:bg-[#eef2ee] transition-colors flex items-center gap-1.5"
                  >
                    <Plus size={13} /> Agregar Mesa
                  </button>

                  <span className="text-xs font-bold text-[#1b2925]">
                    {batchList.length} mesas en lista · {batchSummary.totalSeats} comensales totales
                  </span>
                </div>
              </div>

              {/* Resumen por Sectores */}
              <div className="p-3 bg-[#f9faf8] border border-[#dce4dd] rounded-xl text-xs space-y-1.5">
                <span className="font-bold text-[#1b2925] block">Capacidad por Sector:</span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {PRESET_SECTORS.map((sec) => (
                    <div key={sec} className="p-2 bg-white rounded-lg border border-[#eef2ee]">
                      <span className="text-[10px] text-[#68766f] block font-semibold">{sec}</span>
                      <span className="font-bold text-[#1f5a49]">
                        {batchSummary.bySector[sec] || 0} plazas
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Switch de Reemplazo Automático */}
              <div className="p-3.5 bg-gray-50 border border-gray-200 rounded-xl">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={wipeExisting}
                    onChange={(e) => setWipeExisting(e.target.checked)}
                    className="mt-0.5 rounded text-[#1f5a49] focus:ring-[#1f5a49]"
                  />
                  <div>
                    <span className="text-xs font-bold text-[#1b2925] block">
                      Eliminar automáticamente el dibujo anterior al guardar en la base de datos
                    </span>
                    <span className="text-[11px] text-[#68766f] block mt-0.5">
                      El dibujo anterior permanecerá visible y no se borrará hasta que la nueva distribución quede confirmada y guardada en la base de datos.
                    </span>
                  </div>
                </label>
              </div>

              {/* Submit Button */}
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={busy || batchList.length === 0}
                  className="w-full py-2.5 bg-[#1f5a49] text-white text-xs font-bold rounded-lg hover:bg-[#174639] transition-colors shadow-xs disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <Check size={16} />{' '}
                  {wipeExisting
                    ? `Guardar y Reemplazar Plano en Base de Datos (${batchList.length} Mesas)`
                    : `Guardar e Incorporar Mesas en Base de Datos (${batchList.length} Mesas)`}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
