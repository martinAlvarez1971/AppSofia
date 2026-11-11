import React from 'react';
import type { ReservationStatus, ShiftType } from '../reservations.types';
import { CheckCircle2, Clock, Check, XCircle, AlertCircle, Sun, Moon, Sparkles } from 'lucide-react';

export function ReservationStatusBadge({ status }: { status: ReservationStatus }) {
  switch (status) {
    case 'confirmed':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
          <CheckCircle2 size={13} className="text-emerald-600" />
          Confirmada
        </span>
      );
    case 'seated':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-800 border border-blue-200">
          <Clock size={13} className="text-blue-600 animate-pulse" />
          En curso
        </span>
      );
    case 'completed':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
          <Check size={13} className="text-slate-500" />
          Finalizada
        </span>
      );
    case 'cancelled':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-800 border border-rose-200">
          <XCircle size={13} className="text-rose-600" />
          Cancelada
        </span>
      );
    case 'no_show':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
          <AlertCircle size={13} className="text-amber-600" />
          No-show
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
          {status}
        </span>
      );
  }
}

export function ShiftBadge({ shift }: { shift: ShiftType }) {
  switch (shift) {
    case 'lunch':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-900 border border-amber-200">
          <Sun size={12} className="text-amber-600" />
          Almuerzo
        </span>
      );
    case 'dinner':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-indigo-50 text-indigo-900 border border-indigo-200">
          <Moon size={12} className="text-indigo-600" />
          Cena
        </span>
      );
    case 'other':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700 border border-gray-200">
          <Sparkles size={12} className="text-gray-500" />
          Fuera de turno
        </span>
      );
  }
}
