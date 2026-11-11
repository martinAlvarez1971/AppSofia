import React, { useEffect, useState } from 'react';
import type { ReservationQueryResult, ReservationAuditTimelineEntry } from '../reservations.types';
import { reservationsApi } from '../reservations.api';
import { ReservationStatusBadge, ShiftBadge } from './StatusBadge';
import {
  X,
  Calendar,
  Clock,
  Users,
  MapPin,
  Phone,
  Mail,
  User,
  History,
  FileText,
  AlertTriangle,
  Layers,
  ShieldCheck,
  CheckCircle2,
} from 'lucide-react';

interface DetailDrawerProps {
  reservationId: string | null;
  token: string | null;
  onClose: () => void;
}

export function ReservationDetailDrawer({ reservationId, token, onClose }: DetailDrawerProps) {
  const [detail, setDetail] = useState<ReservationQueryResult | null>(null);
  const [timeline, setTimeline] = useState<ReservationAuditTimelineEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!reservationId || !token) {
      setDetail(null);
      setTimeline([]);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    Promise.all([
      reservationsApi.getDetail(token, reservationId),
      reservationsApi.getTimeline(token, reservationId),
    ])
      .then(([det, time]) => {
        if (!isMounted) return;
        setDetail(det);
        setTimeline(time);
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(err.message || 'Error al cargar detalle');
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [reservationId, token]);

  if (!reservationId) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/40 backdrop-blur-xs flex justify-end animate-fadeIn">
      <div className="w-full max-w-xl bg-white h-full shadow-2xl flex flex-col border-l border-[#dce4dd] overflow-hidden">
        {/* Encabezado del Drawer */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gray-50/70">
          <div className="flex items-center gap-2">
            <span className="font-bold text-base text-[#1b2925] font-['Manrope']">
              Detalle Histórico de Reserva
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded font-bold uppercase bg-gray-200 text-gray-700">
              Solo Lectura
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-black hover:bg-gray-200 rounded-lg transition-colors cursor-pointer"
            title="Cerrar panel"
          >
            <X size={18} />
          </button>
        </div>

        {/* Contenido con Scroll */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-sm text-[#1b2925]">
          {loading ? (
            <div className="space-y-4">
              <div className="h-8 bg-gray-100 rounded animate-pulse" />
              <div className="h-32 bg-gray-100 rounded-lg animate-pulse" />
              <div className="h-44 bg-gray-100 rounded-lg animate-pulse" />
            </div>
          ) : error ? (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-xs">
              <strong>Error:</strong> {error}
            </div>
          ) : detail ? (
            <>
              {/* Tarjeta Principal de Cliente y Estado */}
              <div className="p-4 rounded-xl border border-gray-200 bg-gray-50/50 flex items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-bold text-[#1b2925]">{detail.customerName}</div>
                  <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-gray-600">
                    {detail.customerPhone && (
                      <span className="flex items-center gap-1 font-mono">
                        <Phone size={12} className="text-gray-400" />
                        {detail.customerPhone}
                      </span>
                    )}
                    {detail.customerEmail && (
                      <span className="flex items-center gap-1">
                        <Mail size={12} className="text-gray-400" />
                        {detail.customerEmail}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-gray-400 font-mono mt-1">
                    ID: {detail.id}
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1.5">
                  <ReservationStatusBadge status={detail.status} />
                  <ShiftBadge shift={detail.shift} />
                </div>
              </div>

              {/* Parámetros Temporales y Operativos */}
              <div className="grid grid-cols-2 gap-3.5">
                <div className="p-3.5 rounded-lg border border-gray-100 bg-white shadow-2xs">
                  <div className="text-xs text-gray-500 font-semibold mb-1 flex items-center gap-1">
                    <Calendar size={13} className="text-gray-400" />
                    Fecha Operativa
                  </div>
                  <div className="text-base font-bold text-[#174639]">
                    {detail.operationalDate}
                  </div>
                  <div className="text-[10px] text-gray-400 mt-0.5">
                    Civil: {detail.calendarDate}
                    {detail.isMidnightRollover && ' (🌙 Cruce de medianoche)'}
                  </div>
                </div>

                <div className="p-3.5 rounded-lg border border-gray-100 bg-white shadow-2xs">
                  <div className="text-xs text-gray-500 font-semibold mb-1 flex items-center gap-1">
                    <Clock size={13} className="text-gray-400" />
                    Horario Local
                  </div>
                  <div className="text-base font-bold text-[#174639] font-mono">
                    {detail.localStartTime} - {detail.localEndTime}
                  </div>
                  <div className="text-[10px] text-gray-400 mt-0.5">
                    Duración: {detail.durationMinutes} minutos
                  </div>
                </div>
              </div>

              {/* Mesas y Comensales */}
              <div className="p-4 rounded-xl border border-gray-200 bg-white shadow-2xs">
                <div className="flex items-center justify-between pb-2 mb-3 border-b border-gray-100 text-xs font-bold text-gray-700">
                  <span className="flex items-center gap-1.5">
                    <Layers size={14} className="text-[#1f5a49]" />
                    Distribución de Salón y Capacidad
                  </span>
                  <span className="flex items-center gap-1 text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                    <Users size={12} />
                    {detail.guestsCount} comensales
                  </span>
                </div>

                {detail.tables.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">No registra mesas asociadas.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {detail.tables.map((tbl) => (
                      <div
                        key={tbl.id}
                        className="p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-xs flex items-center justify-between"
                      >
                        <div>
                          <span className="font-bold text-sm text-[#1b2925]">
                            Mesa {tbl.number}
                          </span>
                          <div className="text-[11px] text-gray-500">{tbl.sector}</div>
                        </div>
                        <span className="text-[11px] font-semibold text-gray-600 bg-white px-2 py-0.5 rounded border border-gray-200">
                          Cap: {tbl.capacity} pax
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Notas y Motivo de Cancelación */}
              {(detail.notes || detail.cancellationReason) && (
                <div className="space-y-3">
                  {detail.notes && (
                    <div className="p-3.5 bg-gray-50 rounded-lg border border-gray-200 text-xs">
                      <div className="font-semibold text-gray-700 mb-1 flex items-center gap-1">
                        <FileText size={13} className="text-gray-400" />
                        Notas de la reserva:
                      </div>
                      <p className="text-gray-600 italic">"{detail.notes}"</p>
                    </div>
                  )}

                  {detail.cancellationReason && (
                    <div className="p-3.5 bg-rose-50/70 rounded-lg border border-rose-200 text-xs">
                      <div className="font-semibold text-rose-900 mb-1 flex items-center gap-1">
                        <AlertTriangle size={13} className="text-rose-600" />
                        Motivo de cancelación registrado:
                      </div>
                      <p className="text-rose-800">"{detail.cancellationReason}"</p>
                    </div>
                  )}
                </div>
              )}

              {/* Responsables de Creación y Cancelación */}
              <div className="p-3.5 bg-gray-50 rounded-lg border border-gray-200 text-xs grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="text-gray-400 font-semibold mb-0.5">Registrado por:</div>
                  <div className="font-bold text-gray-800">
                    {detail.createdByProfile
                      ? [detail.createdByProfile.firstName, detail.createdByProfile.lastName]
                          .filter(Boolean)
                          .join(' ') || detail.createdByProfile.email
                      : 'Sistema'}
                  </div>
                  {detail.createdByProfile?.email && (
                    <div className="text-[10px] text-gray-500">{detail.createdByProfile.email}</div>
                  )}
                </div>

                {detail.cancelledByProfile && (
                  <div>
                    <div className="text-rose-600 font-semibold mb-0.5">Cancelado por:</div>
                    <div className="font-bold text-rose-900">
                      {[detail.cancelledByProfile.firstName, detail.cancelledByProfile.lastName]
                        .filter(Boolean)
                        .join(' ') || detail.cancelledByProfile.email}
                    </div>
                    <div className="text-[10px] text-rose-700">{detail.cancelledByProfile.email}</div>
                  </div>
                )}
              </div>

              {/* Hitos del Ciclo de Vida (Migración 5) */}
              {(detail.seatedAt || detail.completedAt || detail.noShowAt) && (
                <div className="p-3.5 bg-[#f8faf8] rounded-lg border border-[#dce4dd] text-xs grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {detail.seatedAt && (
                    <div>
                      <div className="text-gray-500 font-semibold mb-0.5">Check-in (Sentada):</div>
                      <div className="font-mono font-bold text-[#174639]">
                        {new Date(detail.seatedAt).toLocaleString('es-AR')}
                      </div>
                    </div>
                  )}
                  {detail.completedAt && (
                    <div>
                      <div className="text-gray-500 font-semibold mb-0.5">Servicio finalizado:</div>
                      <div className="font-mono font-bold text-emerald-800">
                        {new Date(detail.completedAt).toLocaleString('es-AR')}
                      </div>
                    </div>
                  )}
                  {detail.noShowAt && (
                    <div>
                      <div className="text-amber-700 font-semibold mb-0.5">Registrada No-Show:</div>
                      <div className="font-mono font-bold text-amber-900">
                        {new Date(detail.noShowAt).toLocaleString('es-AR')}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Historial de Actividad (Auditoría Inmutable) */}
              <div className="pt-2 border-t border-gray-200">
                <div className="text-xs font-bold text-gray-700 flex items-center gap-1.5 mb-3">
                  <History size={14} className="text-[#1f5a49]" />
                  Línea de Tiempo de Auditoría ({timeline.length} eventos)
                </div>

                {timeline.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">
                    Sin eventos de auditoría registrados para esta reserva.
                  </p>
                ) : (
                  <div className="space-y-3 relative before:absolute before:left-3 before:top-2 before:bottom-2 before:w-0.5 before:bg-gray-200 pl-7">
                    {timeline.map((item) => (
                      <div key={item.id} className="relative text-xs">
                        {/* Nodo de la línea */}
                        <div className="absolute -left-7 top-1 w-3.5 h-3.5 rounded-full bg-emerald-600 border-2 border-white ring-1 ring-gray-300" />
                        <div className="p-2.5 rounded-lg border border-gray-200 bg-white shadow-2xs">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="font-bold text-[#174639] font-mono">
                              {item.action}
                            </span>
                            <span className="text-[10px] text-gray-400">
                              {new Date(item.createdAt).toLocaleString('es-AR')}
                            </span>
                          </div>
                          <div className="text-gray-600 text-[11px]">
                            Actor:{' '}
                            <span className="font-semibold text-gray-800">{item.actorName}</span>{' '}
                            {item.actorRole && `(${item.actorRole})`}
                          </div>
                          {item.reason && (
                            <div className="text-[11px] text-gray-500 mt-1 italic">
                              Motivo: {item.reason}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>

        {/* Pie de Página: Confirmación de Solo Lectura */}
        <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 flex items-center justify-between text-xs text-gray-500">
          <span className="flex items-center gap-1 text-[#1f5a49]">
            <ShieldCheck size={14} />
            Módulo consultivo de solo lectura
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 font-semibold cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
