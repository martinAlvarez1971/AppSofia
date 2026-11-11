import type { AppRole } from '../auth/auth.types'

export type AlertSeverity = 'info' | 'warning' | 'critical'
export type AlertStatus = 'pending' | 'reviewed'
export type AuditResultStatus = 'success' | 'failure'

export interface AuditLogEntry {
  id: string
  actorId: string
  actorName: string
  actorEmail: string
  actorRole: AppRole
  action: string
  entity: string
  entityId: string
  oldValues: Record<string, unknown> | null
  newValues: Record<string, unknown> | null
  status: AuditResultStatus
  reason: string | null
  relatedTableId: string | null
  relatedReservationId: string | null
  createdAt: string
}

export interface AdminAlert {
  id: string
  auditLogId: string
  title: string
  severity: AlertSeverity
  status: AlertStatus
  reviewedAt: string | null
  reviewedBy: string | null
  reviewedByName: string | null
  createdAt: string
  audit: AuditLogEntry
}

export interface AlertsSummary {
  total: number
  pending: number
  reviewed: number
  critical: number
  warning: number
}
