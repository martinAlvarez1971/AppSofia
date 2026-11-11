import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CheckCircle2,
  Clock,
  Filter,
  Info,
  RefreshCw,
  ShieldAlert,
  User,
  X,
} from 'lucide-react'
import { useAuth } from '../auth/auth.context'
import { alertsApi, AlertsApiError } from './alerts.api'
import type { AdminAlert, AlertsSummary, AuditLogEntry } from './alerts.types'
import { LoadingState, Notice } from '../../components/PageState'

export function AlertsPage() {
  const { session, isDemo } = useAuth()
  const [alerts, setAlerts] = useState<AdminAlert[]>([])
  const [summary, setSummary] = useState<AlertsSummary>({
    total: 0,
    pending: 0,
    reviewed: 0,
    critical: 0,
    warning: 0,
  })
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'reviewed'>('all')
  const [severityFilter, setSeverityFilter] = useState<'all' | 'critical' | 'warning' | 'info'>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedAudit, setSelectedAudit] = useState<AuditLogEntry | null>(null)
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [successNotice, setSuccessNotice] = useState('')

  const loadAlerts = useCallback(async () => {
    if (!session?.access_token) return
    setLoading(true)
    setError('')
    try {
      const data = await alertsApi.getAlerts(session.access_token, {
        status: statusFilter,
        severity: severityFilter,
      })
      setAlerts(data.alerts)
      setSummary(data.summary)
    } catch (err) {
      if (err instanceof AlertsApiError) {
        setError(err.message)
      } else {
        setError('No se pudo cargar el centro de alertas.')
      }
    } finally {
      setLoading(false)
    }
  }, [session?.access_token, statusFilter, severityFilter])

  useEffect(() => {
    void loadAlerts()
  }, [loadAlerts])

  async function handleReviewAlert(alertId: string) {
    if (!session?.access_token) return
    setReviewingId(alertId)
    setSuccessNotice('')
    try {
      const updated = await alertsApi.reviewAlert(session.access_token, alertId)
      setAlerts((prev) =>
        prev.map((a) => (a.id === alertId ? { ...a, status: updated.status, reviewedAt: updated.reviewedAt, reviewedByName: updated.reviewedByName } : a)),
      )
      setSummary((prev) => ({
        ...prev,
        pending: Math.max(0, prev.pending - 1),
        reviewed: prev.reviewed + 1,
      }))
      setSuccessNotice('Alerta marcada como revisada. El evento original de auditoría permanece inalterado.')
      setTimeout(() => setSuccessNotice(''), 4000)
    } catch (err) {
      if (err instanceof AlertsApiError) {
        setError(err.message)
      } else {
        setError('No se pudo actualizar el estado de la alerta.')
      }
    } finally {
      setReviewingId(null)
    }
  }

  function formatDate(iso: string) {
    try {
      const date = new Date(iso)
      return date.toLocaleString('es-AR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return iso
    }
  }

  return (
    <div className="alerts-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">SEGURIDAD Y CONTROL DE SALÓN</span>
          <h1>Alertas Administrativas</h1>
          <p>
            Centro privado de supervisión para el Administrador Principal. Notifica eventos críticos y operacionales
            con trazabilidad inmutable.
          </p>
        </div>
        <button
          type="button"
          className="button button--quiet"
          style={{ minHeight: 38, gap: 6, fontSize: 12 }}
          onClick={() => void loadAlerts()}
          disabled={loading}
        >
          <RefreshCw size={14} className={loading ? 'spin' : ''} />
          Actualizar
        </button>
      </div>

      {isDemo ? (
        <div style={{ marginBottom: 20 }}>
          <Notice title="Entorno de Demostración Local">
            SOFIA está operando con almacenamiento y validaciones en servidor local. Las alertas corresponden a
            operaciones simuladas de salón con registro estricto en auditoría.
          </Notice>
        </div>
      ) : null}

      {/* Tarjetas de Métricas */}
      <section className="alerts-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 24 }}>
        <article style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 8, padding: '16px 20px' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>PENDIENTES</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <strong style={{ fontSize: 26, color: summary.pending > 0 ? '#b24c30' : 'var(--ink)' }}>{summary.pending}</strong>
            <small style={{ color: 'var(--muted)', fontSize: 11 }}>requieren revisión</small>
          </div>
        </article>

        <article style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 8, padding: '16px 20px' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>CRÍTICAS / CONFLICTOS</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <strong style={{ fontSize: 26, color: summary.critical > 0 ? '#9c3d36' : 'var(--forest)' }}>{summary.critical}</strong>
            <small style={{ color: 'var(--muted)', fontSize: 11 }}>afectan reservas</small>
          </div>
        </article>

        <article style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 8, padding: '16px 20px' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>REVISADAS</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <strong style={{ fontSize: 26, color: 'var(--forest)' }}>{summary.reviewed}</strong>
            <small style={{ color: 'var(--muted)', fontSize: 11 }}>verificadas por admin</small>
          </div>
        </article>

        <article style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 8, padding: '16px 20px' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>TOTAL EVENTOS</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <strong style={{ fontSize: 26, color: 'var(--ink)' }}>{summary.total}</strong>
            <small style={{ color: 'var(--muted)', fontSize: 11 }}>en registro histórico</small>
          </div>
        </article>
      </section>

      {/* Barra de Filtros */}
      <div
        className="alerts-toolbar"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '12px 16px',
          background: '#fff',
          border: '1px solid var(--line)',
          borderRadius: 8,
          marginBottom: 18,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>
            <Filter size={14} /> Filtro:
          </span>

          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className={`button ${statusFilter === 'all' ? 'button--primary' : 'button--quiet'}`}
              style={{ minHeight: 32, padding: '0 10px', fontSize: 11 }}
              onClick={() => setStatusFilter('all')}
            >
              Todas
            </button>
            <button
              type="button"
              className={`button ${statusFilter === 'pending' ? 'button--primary' : 'button--quiet'}`}
              style={{ minHeight: 32, padding: '0 10px', fontSize: 11 }}
              onClick={() => setStatusFilter('pending')}
            >
              Pendientes ({summary.pending})
            </button>
            <button
              type="button"
              className={`button ${statusFilter === 'reviewed' ? 'button--primary' : 'button--quiet'}`}
              style={{ minHeight: 32, padding: '0 10px', fontSize: 11 }}
              onClick={() => setStatusFilter('reviewed')}
            >
              Revisadas ({summary.reviewed})
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 11, color: 'var(--muted)' }}>Severidad:</label>
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value as typeof severityFilter)}
            style={{
              minHeight: 32,
              padding: '0 8px',
              border: '1px solid var(--line)',
              borderRadius: 5,
              fontSize: 12,
              color: 'var(--ink)',
              background: '#fff',
            }}
          >
            <option value="all">Todas las gravedades</option>
            <option value="critical">Críticas</option>
            <option value="warning">Advertencias</option>
            <option value="info">Informativas</option>
          </select>
        </div>
      </div>

      {successNotice ? (
        <div style={{ marginBottom: 16 }}>
          <Notice title="Acción Confirmada">{successNotice}</Notice>
        </div>
      ) : null}

      {error ? (
        <p className="form-error" role="alert" style={{ marginBottom: 16 }}>
          {error}
        </p>
      ) : null}

      {/* Lista de Alertas */}
      {loading ? (
        <LoadingState label="Consultando alertas y auditoría" />
      ) : alerts.length === 0 ? (
        <div
          style={{
            background: '#fff',
            border: '1px solid var(--line)',
            borderRadius: 8,
            padding: '48px 20px',
            textAlign: 'center',
          }}
        >
          <CheckCircle2 size={36} color="#356448" style={{ margin: '0 auto 12px' }} />
          <h3 style={{ margin: '0 0 6px', fontSize: 16 }}>No hay alertas que coincidan</h3>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>
            El salón y la gestión operativa no tienen alertas pendientes bajo los filtros seleccionados.
          </p>
        </div>
      ) : (
        <div className="alerts-list" style={{ display: 'grid', gap: 14 }}>
          {alerts.map((alert) => {
            const isPending = alert.status === 'pending'
            const isCritical = alert.severity === 'critical'
            const isWarning = alert.severity === 'warning'

            const badgeBg = isCritical ? '#fff0ee' : isWarning ? '#fbf1e3' : '#eaf1eb'
            const badgeColor = isCritical ? '#9c3d36' : isWarning ? '#9a6128' : '#1f5a49'
            const borderAccent = isPending ? (isCritical ? '#f0b7af' : '#e6cdad') : 'var(--line)'

            return (
              <article
                key={alert.id}
                style={{
                  background: '#fff',
                  border: `1px solid ${borderAccent}`,
                  borderLeft: `5px solid ${isCritical ? '#dc5f4e' : isWarning ? '#dc805f' : '#3d866a'}`,
                  borderRadius: 8,
                  padding: '18px 22px',
                  display: 'grid',
                  gap: 12,
                  boxShadow: isPending ? '0 2px 6px rgb(0 0 0 / 3%)' : 'none',
                  opacity: isPending ? 1 : 0.88,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        padding: '3px 8px',
                        borderRadius: 4,
                        fontSize: 10,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        background: badgeBg,
                        color: badgeColor,
                      }}
                    >
                      {isCritical ? <ShieldAlert size={12} /> : isWarning ? <AlertTriangle size={12} /> : <Info size={12} />}
                      {alert.severity === 'critical' ? 'Crítica' : alert.severity === 'warning' ? 'Advertencia' : 'Informativa'}
                    </span>

                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '3px 8px',
                        borderRadius: 4,
                        fontSize: 10,
                        fontWeight: 700,
                        background: isPending ? '#fbf1e3' : '#edf7ef',
                        color: isPending ? '#795a35' : '#2e6949',
                      }}
                    >
                      {isPending ? 'Pendiente de revisión' : 'Revisada'}
                    </span>

                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--muted)' }}>
                      <Clock size={13} />
                      {formatDate(alert.createdAt)}
                    </span>
                  </div>

                  {/* Acciones de la alerta */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {isPending ? (
                      <button
                        type="button"
                        className="button button--primary"
                        style={{ minHeight: 32, fontSize: 11, padding: '0 12px' }}
                        onClick={() => void handleReviewAlert(alert.id)}
                        disabled={reviewingId === alert.id}
                      >
                        {reviewingId === alert.id ? 'Marcando…' : 'Marcar revisada'}
                      </button>
                    ) : (
                      <span style={{ fontSize: 11, color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <CheckCircle2 size={13} color="#2e6949" />
                        Revisada por {alert.reviewedByName || 'Superadmin'} ({alert.reviewedAt ? formatDate(alert.reviewedAt) : ''})
                      </span>
                    )}

                    <button
                      type="button"
                      className="button button--quiet"
                      style={{ minHeight: 32, fontSize: 11, padding: '0 10px' }}
                      onClick={() => setSelectedAudit(alert.audit)}
                    >
                      Ver Auditoría
                    </button>
                  </div>
                </div>

                <div>
                  <h3 style={{ margin: '0 0 6px', fontSize: 16, color: 'var(--ink)' }}>{alert.title}</h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--muted)', flexWrap: 'wrap' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <User size={13} />
                      <strong>{alert.audit.actorName}</strong> ({alert.audit.actorEmail})
                    </span>
                    <span>·</span>
                    <span
                      style={{
                        padding: '1px 6px',
                        borderRadius: 3,
                        background: alert.audit.actorRole === 'super_admin' ? '#e7f1e9' : '#f0f3f1',
                        color: alert.audit.actorRole === 'super_admin' ? '#1f5a49' : '#526058',
                        fontSize: 10,
                        fontWeight: 700,
                      }}
                    >
                      {alert.audit.actorRole === 'super_admin' ? 'Administrador Principal' : 'Administrador Operativo'}
                    </span>
                    {alert.audit.relatedTableId ? (
                      <>
                        <span>·</span>
                        <span style={{ background: '#f4f6f4', padding: '1px 6px', borderRadius: 3, fontSize: 11 }}>
                          Mesa ID: {alert.audit.relatedTableId}
                        </span>
                      </>
                    ) : null}
                    {alert.audit.relatedReservationId ? (
                      <>
                        <span>·</span>
                        <span style={{ background: '#f4f6f4', padding: '1px 6px', borderRadius: 3, fontSize: 11 }}>
                          Reserva ID: {alert.audit.relatedReservationId}
                        </span>
                      </>
                    ) : null}
                  </div>
                </div>

                {/* Motivo declarado si existe */}
                {alert.audit.reason ? (
                  <div
                    style={{
                      background: '#f8faf8',
                      borderLeft: '3px solid var(--forest)',
                      padding: '8px 12px',
                      borderRadius: '0 5px 5px 0',
                      fontSize: 12,
                      color: '#425349',
                    }}
                  >
                    <strong style={{ color: 'var(--ink)', fontSize: 11, display: 'block', marginBottom: 2 }}>
                      Motivo declarado:
                    </strong>
                    {alert.audit.reason}
                  </div>
                ) : null}

                {/* Diferencial de valores (Diff) */}
                {alert.audit.oldValues || alert.audit.newValues ? (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      background: '#fafcfa',
                      border: '1px solid #edf1ee',
                      borderRadius: 6,
                      padding: '8px 14px',
                      fontSize: 12,
                      flexWrap: 'wrap',
                    }}
                  >
                    <span style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 700 }}>CAMBIO REGISTRADO:</span>
                    {alert.audit.oldValues ? (
                      <span style={{ color: '#884b3d', background: '#fdf3f0', padding: '2px 7px', borderRadius: 4, fontFamily: 'monospace', fontSize: 11 }}>
                        Anterior: {JSON.stringify(alert.audit.oldValues)}
                      </span>
                    ) : null}
                    <ArrowRight size={13} color="var(--muted)" />
                    {alert.audit.newValues ? (
                      <span style={{ color: '#276846', background: '#eff7f1', padding: '2px 7px', borderRadius: 4, fontFamily: 'monospace', fontSize: 11 }}>
                        Nuevo: {JSON.stringify(alert.audit.newValues)}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      )}

      {/* Modal Detalle de Auditoría Inmutable */}
      {selectedAudit ? (
        <div className="modal-backdrop" onClick={() => setSelectedAudit(null)}>
          <div className="users-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <div className="users-modal__heading">
              <div>
                <span className="eyebrow">REGISTRO INMUTABLE DE AUDITORÍA</span>
                <h2>Detalle del Evento</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Cerrar modal"
                onClick={() => setSelectedAudit(null)}
              >
                <X size={18} />
              </button>
            </div>

            <p style={{ margin: '10px 0 16px', color: 'var(--muted)', fontSize: 12 }}>
              Este registro fue generado en el servidor al momento de la operación y se encuentra protegido contra
              modificaciones y borrados.
            </p>

            <div style={{ display: 'grid', gap: 10, background: '#f9fbf9', border: '1px solid var(--line)', borderRadius: 7, padding: 16, fontSize: 12 }}>
              <div><strong>ID de Auditoría:</strong> <code style={{ fontSize: 11 }}>{selectedAudit.id}</code></div>
              <div><strong>Fecha y Hora de Servidor:</strong> {formatDate(selectedAudit.createdAt)} ({selectedAudit.createdAt})</div>
              <div><strong>Actor Responsable:</strong> {selectedAudit.actorName} ({selectedAudit.actorEmail})</div>
              <div><strong>Rol Vigente al Actuar:</strong> <span className="role-tag role-tag--principal">{selectedAudit.actorRole}</span></div>
              <div><strong>Acción del Sistema:</strong> <code style={{ fontSize: 12, fontWeight: 700 }}>{selectedAudit.action}</code></div>
              <div><strong>Entidad Afectada:</strong> {selectedAudit.entity} (ID: {selectedAudit.entityId})</div>
              <div><strong>Resultado de la Transacción:</strong> <span style={{ color: selectedAudit.status === 'success' ? '#2e6949' : '#9c3d36', fontWeight: 700 }}>{selectedAudit.status.toUpperCase()}</span></div>
              {selectedAudit.reason ? <div><strong>Motivo Declarado:</strong> {selectedAudit.reason}</div> : null}
              {selectedAudit.relatedTableId ? <div><strong>Mesa Asociada:</strong> {selectedAudit.relatedTableId}</div> : null}
              {selectedAudit.relatedReservationId ? <div><strong>Reserva Asociada:</strong> {selectedAudit.relatedReservationId}</div> : null}
            </div>

            <div style={{ marginTop: 14 }}>
              <strong style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>Carga útil completa (JSON):</strong>
              <pre
                style={{
                  background: '#1b2925',
                  color: '#dbe7e1',
                  padding: 12,
                  borderRadius: 6,
                  fontSize: 11,
                  overflowX: 'auto',
                  maxHeight: 200,
                }}
              >
                {JSON.stringify(selectedAudit, null, 2)}
              </pre>
            </div>

            <div className="users-modal__actions" style={{ marginTop: 16 }}>
              <button type="button" className="button button--quiet" onClick={() => setSelectedAudit(null)}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
