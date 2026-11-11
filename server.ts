import dotenv from 'dotenv';
dotenv.config();
import express, { type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createReservationsQueryRouter } from './src/server/reservations-query';
import { createReportsRouter } from './src/server/reports';
import {
  computeRequestHash,
  extractIdempotencyKey,
  deriveSagaStepKey,
  mapRpcErrorToHttp,
} from './src/server/rpc-helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type AppRole = 'super_admin' | 'operational_admin';
export type ProfileStatus = 'active' | 'inactive';

interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  role: AppRole;
  status: ProfileStatus;
}

interface ManagedUser {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  role: AppRole;
  status: ProfileStatus;
  createdAt: string;
}

export interface UserAuthOperation {
  id: string;
  correlationId: string;
  operationType: 'invite_user' | 'reset_password';
  targetEmail: string;
  targetUserId: string | null;
  state: 'pending_auth' | 'auth_dispatched' | 'auth_response_received' | 'completed' | 'failed' | 'needs_reconciliation';
  lastError: string | null;
  dispatchedAt: string | null;
  reconciledAt: string | null;
  reconciledBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OperationalSettings {
  defaultReservationDurationMinutes: number;
  defaultWalkInDurationMinutes: number;
  reservationBufferMinutes: number;
  updatedAt?: string;
}

export interface TableSessionSummary {
  id: string;
  tableId: string;
  reservationId: string | null;
  sessionType: 'reservation' | 'walk_in';
  guestsCount: number | null;
  startedAt: string;
  expectedDurationMinutes: number;
  estimatedEndAt: string;
  endedAt: string | null;
  closeReason: string | null;
  notes: string | null;
}

export interface AuditLogEntry {
  id: string;
  actorId: string;
  actorName: string;
  actorEmail: string;
  actorRole: AppRole;
  action: string;
  entity: string;
  entityId: string;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  status: 'success' | 'failure';
  reason: string | null;
  relatedTableId: string | null;
  relatedReservationId: string | null;
  createdAt: string;
}

export interface AdminAlert {
  id: string;
  auditLogId: string;
  title: string;
  severity: 'info' | 'warning' | 'critical';
  status: 'pending' | 'reviewed';
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewedByName: string | null;
  createdAt: string;
  audit: AuditLogEntry;
}

export interface Table {
  id: string;
  number: number;
  sector: string;
  capacity: number;
  maxCapacity: number;
  status: 'available' | 'occupied' | 'reserved' | 'out_of_service';
  isActive: boolean;
  shape?: 'round' | 'square' | 'rectangle';
  occupiedSince?: string | null;
  serverName?: string | null;
  activeSession?: TableSessionSummary | null;
}

export interface Reservation {
  id: string;
  tableId: string;
  tableNumber: number;
  customerName: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  guestsCount: number;
  time: string;
  startTime?: string;
  endTime?: string;
  durationMinutes?: number;
  status: 'confirmed' | 'seated' | 'completed' | 'cancelled' | 'no_show';
  notes: string;
  cancellationReason?: string | null;
  seatedAt?: string | null;
  completedAt?: string | null;
  noShowAt?: string | null;
  tableIds?: string[];
  tableNumbers?: number[];
}

// =========================================================================
// Configuración de Supabase Server-Side (Autoritativo para Producción)
// =========================================================================
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const isLiveSupabaseConfigured = Boolean(
  (process.env.ENFORCE_SUPABASE_AUTH === 'true') ||
  (supabaseUrl &&
    supabaseUrl.startsWith('http') &&
    !supabaseUrl.includes('<project-ref>') &&
    supabaseServiceKey &&
    !supabaseServiceKey.includes('<server-only'))
);

const supabaseAdmin: SupabaseClient | null = (supabaseUrl && supabaseServiceKey && !supabaseUrl.includes('<project-ref>') && !supabaseServiceKey.includes('<server-only'))
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

// =========================================================================
// Modo Demo Aislado (Solo activo cuando Supabase NO está conectado)
// =========================================================================
let demoOperationalSettings: OperationalSettings = {
  defaultReservationDurationMinutes: 120,
  defaultWalkInDurationMinutes: 90,
  reservationBufferMinutes: 15,
  updatedAt: new Date('2026-11-01T12:00:00Z').toISOString(),
};

let demoUsersStore: ManagedUser[] = [
  {
    id: '00000000-0000-0000-0000-000000000001',
    firstName: 'Martín',
    lastName: 'Álvarez',
    email: 'martinalvarez.android@gmail.com',
    role: 'super_admin',
    status: 'active',
    createdAt: new Date('2026-01-10T12:00:00Z').toISOString(),
  },
  {
    id: '00000000-0000-0000-0000-000000000002',
    firstName: 'Sofía',
    lastName: 'García',
    email: 'sofia.operaciones@restaurante.com',
    role: 'operational_admin',
    status: 'active',
    createdAt: new Date('2026-02-01T15:30:00Z').toISOString(),
  },
  {
    id: '00000000-0000-0000-0000-000000000003',
    firstName: 'Mateo',
    lastName: 'Rossi',
    email: 'mateo.salon@restaurante.com',
    role: 'operational_admin',
    status: 'inactive',
    createdAt: new Date('2026-03-12T18:00:00Z').toISOString(),
  },
];

let demoAuthOperationsStore: UserAuthOperation[] = [];

let demoTablesStore: Table[] = [
  { id: 'tbl-1', number: 1, sector: 'Salón Principal', capacity: 4, maxCapacity: 5, status: 'reserved', isActive: true, shape: 'square' },
  { id: 'tbl-2', number: 2, sector: 'Salón Principal', capacity: 2, maxCapacity: 3, status: 'reserved', isActive: true, shape: 'round' },
  { id: 'tbl-3', number: 3, sector: 'Salón Principal', capacity: 6, maxCapacity: 8, status: 'occupied', isActive: true, shape: 'rectangle', occupiedSince: new Date(Date.now() - 48 * 60 * 1000).toISOString(), serverName: 'Mateo R.' },
  { id: 'tbl-7', number: 7, sector: 'Salón Principal', capacity: 4, maxCapacity: 6, status: 'available', isActive: true, shape: 'square' },
  { id: 'tbl-8', number: 8, sector: 'Salón Principal', capacity: 8, maxCapacity: 10, status: 'available', isActive: true, shape: 'rectangle' },
  { id: 'tbl-4', number: 4, sector: 'Terraza Jardín', capacity: 4, maxCapacity: 4, status: 'reserved', isActive: true, shape: 'round' },
  { id: 'tbl-5', number: 5, sector: 'Terraza Jardín', capacity: 4, maxCapacity: 6, status: 'out_of_service', isActive: false, shape: 'square' },
  { id: 'tbl-9', number: 9, sector: 'Terraza Jardín', capacity: 4, maxCapacity: 5, status: 'available', isActive: true, shape: 'round' },
  { id: 'tbl-6', number: 6, sector: 'Barra & Sommelier', capacity: 2, maxCapacity: 2, status: 'available', isActive: true, shape: 'round' },
  { id: 'tbl-10', number: 10, sector: 'Barra & Sommelier', capacity: 2, maxCapacity: 2, status: 'occupied', isActive: true, shape: 'round', occupiedSince: new Date(Date.now() - 18 * 60 * 1000).toISOString(), serverName: 'Sofía G.' },
];

let demoTableSessionsStore: TableSessionSummary[] = [
  {
    id: 'sess-demo-3',
    tableId: 'tbl-3',
    reservationId: null,
    sessionType: 'walk_in',
    guestsCount: 4,
    startedAt: new Date(Date.now() - 48 * 60 * 1000).toISOString(),
    expectedDurationMinutes: 90,
    estimatedEndAt: new Date(Date.now() + 42 * 60 * 1000).toISOString(),
    endedAt: null,
    closeReason: null,
    notes: 'Walk-in de demostración',
  },
  {
    id: 'sess-demo-10',
    tableId: 'tbl-10',
    reservationId: null,
    sessionType: 'walk_in',
    guestsCount: 2,
    startedAt: new Date(Date.now() - 18 * 60 * 1000).toISOString(),
    expectedDurationMinutes: 90,
    estimatedEndAt: new Date(Date.now() + 72 * 60 * 1000).toISOString(),
    endedAt: null,
    closeReason: null,
    notes: 'Barra sin reserva',
  },
];

let demoReservationsStore: Reservation[] = [
  { id: 'res-101', tableId: 'tbl-1', tableNumber: 1, customerName: 'Familia Pérez', guestsCount: 4, time: 'Hoy 21:00 hs', status: 'confirmed', notes: 'Mesa junto al ventanal', tableIds: ['tbl-1'], tableNumbers: [1] },
  { id: 'res-102', tableId: 'tbl-1', tableNumber: 1, customerName: 'Almuerzo Ejecutivo López', guestsCount: 4, time: 'Mañana 13:30 hs', status: 'confirmed', notes: 'Menú degustación', tableIds: ['tbl-1'], tableNumbers: [1] },
  { id: 'res-103', tableId: 'tbl-2', tableNumber: 2, customerName: 'Dr. Roberto Gómez', guestsCount: 2, time: 'Hoy 21:30 hs', status: 'confirmed', notes: 'Aniversario', tableIds: ['tbl-2'], tableNumbers: [2] },
  { id: 'res-104', tableId: 'tbl-4', tableNumber: 4, customerName: 'Cena Empresa TechNova', guestsCount: 4, time: 'Hoy 22:00 hs', status: 'confirmed', notes: 'Requieren factura A', tableIds: ['tbl-4'], tableNumbers: [4] },
];

let demoAuditLogsStore: AuditLogEntry[] = [
  {
    id: 'aud-seed-1',
    actorId: '00000000-0000-0000-0000-000000000001',
    actorName: 'Martín Álvarez',
    actorEmail: 'martinalvarez.android@gmail.com',
    actorRole: 'super_admin',
    action: 'system.initialization',
    entity: 'system',
    entityId: 'sofia-core',
    oldValues: null,
    newValues: { environment: 'SOFIA Core', version: '5.0.0' },
    status: 'success',
    reason: 'Arranque del sistema SOFIA',
    relatedTableId: null,
    relatedReservationId: null,
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
  },
  {
    id: 'aud-seed-2',
    actorId: '00000000-0000-0000-0000-000000000002',
    actorName: 'Sofía García',
    actorEmail: 'sofia.operaciones@restaurante.com',
    actorRole: 'operational_admin',
    action: 'table.deactivated',
    entity: 'table',
    entityId: 'tbl-5',
    oldValues: { status: 'available', isActive: true },
    newValues: { status: 'out_of_service', isActive: false },
    status: 'success',
    reason: 'Mantenimiento de solado y pata inestable en sector Terraza',
    relatedTableId: 'tbl-5',
    relatedReservationId: null,
    createdAt: new Date(Date.now() - 3600000 * 5).toISOString(),
  },
];

let demoAdminAlertsStore: AdminAlert[] = [
  {
    id: 'alt-seed-1',
    auditLogId: 'aud-seed-2',
    title: 'Mesa 5 desactivada por mantenimiento',
    severity: 'warning',
    status: 'pending',
    reviewedAt: null,
    reviewedBy: null,
    reviewedByName: null,
    createdAt: new Date(Date.now() - 3600000 * 5).toISOString(),
    audit: demoAuditLogsStore[1],
  },
];

function recomputeDemoTableAvailability(tableIds: string[]) {
  for (const tid of tableIds) {
    const tbl = demoTablesStore.find((t) => t.id === tid);
    if (!tbl) continue;
    if (!tbl.isActive || tbl.status === 'out_of_service') continue;

    const openSess = demoTableSessionsStore.find((s) => s.tableId === tid && !s.endedAt);
    if (openSess) {
      tbl.status = 'occupied';
      tbl.occupiedSince = openSess.startedAt;
      continue;
    }

    const hasActiveRes = demoReservationsStore.some(
      (r) =>
        (r.status === 'confirmed' || r.status === 'seated') &&
        (r.tableId === tid || (r.tableIds && r.tableIds.includes(tid)))
    );
    tbl.status = hasActiveRes ? 'reserved' : 'available';
    tbl.occupiedSince = null;
    tbl.serverName = null;
  }
}

// Helper exclusivo para modo Demo (en modo vivo toda escritura ocurre dentro de RPCs *_tx)
async function recordAuditAndAlert(params: {
  actor: AuthenticatedUser;
  action: string;
  entity: string;
  entityId: string;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  reason: string | null;
  relatedTableId?: string | null;
  relatedReservationId?: string | null;
  alertTitle?: string;
  severity?: 'info' | 'warning' | 'critical';
}): Promise<{ audit: AuditLogEntry; alert: AdminAlert | null }> {
  if (isLiveSupabaseConfigured && supabaseAdmin) {
    throw new Error('Prohibida la escritura directa fuera de RPC transaccionales *_tx en modo Supabase vivo.');
  }

  const auditId = crypto.randomUUID ? crypto.randomUUID() : `aud-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const auditEntry: AuditLogEntry = {
    id: auditId,
    actorId: params.actor.id,
    actorName: params.actor.name,
    actorEmail: params.actor.email,
    actorRole: params.actor.role,
    action: params.action,
    entity: params.entity,
    entityId: params.entityId,
    oldValues: params.oldValues,
    newValues: params.newValues,
    status: 'success',
    reason: params.reason || null,
    relatedTableId: params.relatedTableId || null,
    relatedReservationId: params.relatedReservationId || null,
    createdAt: new Date().toISOString(),
  };

  demoAuditLogsStore.unshift(auditEntry);

  let alert: AdminAlert | null = null;
  if (params.alertTitle) {
    alert = {
      id: crypto.randomUUID ? crypto.randomUUID() : `alt-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      auditLogId: auditId,
      title: params.alertTitle,
      severity: params.severity || 'warning',
      status: 'pending',
      reviewedAt: null,
      reviewedBy: null,
      reviewedByName: null,
      createdAt: new Date().toISOString(),
      audit: auditEntry,
    };
    demoAdminAlertsStore.unshift(alert);
  }

  return { audit: auditEntry, alert };
}

function mapLiveProfile(row: any): ManagedUser {
  return {
    id: row.id,
    firstName: row.first_name ?? null,
    lastName: row.last_name ?? null,
    email: row.email,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
  };
}

function mapLiveSession(s: any): TableSessionSummary {
  return {
    id: s.id,
    tableId: s.table_id,
    reservationId: s.reservation_id ?? null,
    sessionType: s.session_type,
    guestsCount: s.guests_count ?? null,
    startedAt: s.started_at,
    expectedDurationMinutes: s.expected_duration_minutes,
    estimatedEndAt: s.estimated_end_at,
    endedAt: s.ended_at ?? null,
    closeReason: s.close_reason ?? null,
    notes: s.notes ?? null,
  };
}

function mapLiveAuthOp(row: any): UserAuthOperation {
  return {
    id: row.id,
    correlationId: row.correlation_id,
    operationType: row.operation_type,
    targetEmail: row.target_email,
    targetUserId: row.target_user_id ?? null,
    state: row.state,
    lastError: row.last_error ?? null,
    dispatchedAt: row.dispatched_at ?? null,
    reconciledAt: row.reconciled_at ?? null,
    reconciledBy: row.reconciled_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Extend Request type with authenticated user
interface AuthorizedRequest extends Request {
  user?: AuthenticatedUser;
}

// =========================================================================
// Middleware de Autenticación de Máxima Seguridad (Condiciones A.1 a A.8)
// =========================================================================
async function authenticate(req: AuthorizedRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401).json({ message: 'Se requiere una sesión autenticada.' });
    return;
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    res.status(401).json({ message: 'Token de autorización ausente o inválido.' });
    return;
  }

  if (isLiveSupabaseConfigured) {
    if (token.startsWith('demo-') || token === 'demo-token') {
      res.status(401).json({
        message: 'Tokens demo no permitidos cuando el entorno está configurado con autenticación real de Supabase.',
      });
      return;
    }

    if (supabaseAdmin) {
      try {
        const { data: authData, error: authErr } = await supabaseAdmin.auth.getUser(token);
        if (authErr || !authData.user) {
          res.status(401).json({ message: 'La sesión no es válida o ha caducado en Supabase Auth.' });
          return;
        }

        const { data: profile, error: profErr } = await supabaseAdmin
          .from('profiles')
          .select('id, first_name, last_name, email, role, status')
          .eq('id', authData.user.id)
          .maybeSingle();

        if (profErr || !profile) {
          res.status(403).json({ message: 'No se encontró un perfil habilitado en la base de datos.' });
          return;
        }

        if (profile.status !== 'active') {
          res.status(403).json({ message: 'La cuenta se encuentra inactiva o deshabilitada.' });
          return;
        }

        req.user = {
          id: profile.id,
          name: [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.email,
          email: profile.email,
          role: profile.role,
          status: profile.status,
        };
        next();
        return;
      } catch {
        res.status(503).json({ message: 'Error de comunicación con el servicio de autenticación de Supabase.' });
        return;
      }
    } else {
      res.status(401).json({ message: 'Configuración de Supabase incompleta en el servidor.' });
      return;
    }
  }

  if (token === 'demo-super-admin-token') {
    req.user = {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Martín Álvarez',
      email: 'martinalvarez.android@gmail.com',
      role: 'super_admin',
      status: 'active',
    };
    next();
    return;
  }

  if (token === 'demo-operational-token') {
    req.user = {
      id: '00000000-0000-0000-0000-000000000002',
      name: 'Sofía García',
      email: 'sofia.operaciones@restaurante.com',
      role: 'operational_admin',
      status: 'active',
    };
    next();
    return;
  }

  res.status(401).json({ message: 'Token de sesión no válido o expirado.' });
}

function requireSuperAdmin(req: AuthorizedRequest, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'super_admin') {
    res.status(403).json({
      message: 'Acceso denegado: esta operación está reservada exclusivamente para el Administrador Principal.',
    });
    return;
  }
  next();
}

// =========================================================================
// Express Application Setup
// =========================================================================
export const app = express();
app.use(express.json());

// Normalización de rutas para Vercel Serverless Functions
app.use((req, res, next) => {
  if (req.url && !req.url.startsWith('/api')) {
    req.url = `/api${req.url.startsWith('/') ? '' : '/'}${req.url}`;
  }
  next();
});

  // -----------------------------------------------------------------------
  // Parámetros Operativos del Salón (Migración 5)
  // -----------------------------------------------------------------------
  app.get('/api/settings/operational', authenticate, async (req: AuthorizedRequest, res: Response) => {
    if (isLiveSupabaseConfigured && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from('operational_settings')
        .select('default_reservation_duration_minutes, default_walk_in_duration_minutes, reservation_buffer_minutes, updated_at')
        .eq('id', 1)
        .maybeSingle();

      if (error || !data) {
        res.status(500).json({ message: error?.message || 'No se encontraron parámetros operativos.' });
        return;
      }

      res.json({
        defaultReservationDurationMinutes: data.default_reservation_duration_minutes,
        defaultWalkInDurationMinutes: data.default_walk_in_duration_minutes,
        reservationBufferMinutes: data.reservation_buffer_minutes,
        updatedAt: data.updated_at,
      });
      return;
    }

    res.json(demoOperationalSettings);
  });

  app.put('/api/settings/operational', authenticate, requireSuperAdmin, async (req: AuthorizedRequest, res: Response) => {
    const {
      defaultReservationDurationMinutes,
      defaultWalkInDurationMinutes,
      reservationBufferMinutes,
      reason = 'Actualización de parámetros operativos del salón',
    } = req.body;

    const resDur = parseInt(defaultReservationDurationMinutes, 10);
    const walkDur = parseInt(defaultWalkInDurationMinutes, 10);
    const buffer = parseInt(reservationBufferMinutes, 10);

    if (isNaN(resDur) || resDur < 30 || resDur > 360) {
      res.status(400).json({ message: 'La duración por defecto de reservas debe estar entre 30 y 360 minutos.' });
      return;
    }
    if (isNaN(walkDur) || walkDur < 30 || walkDur > 360) {
      res.status(400).json({ message: 'La duración por defecto de walk-in debe estar entre 30 y 360 minutos.' });
      return;
    }
    if (isNaN(buffer) || buffer < 0 || buffer > 60) {
      res.status(400).json({ message: 'El buffer entre reservas debe estar entre 0 y 60 minutos.' });
      return;
    }

    if (isLiveSupabaseConfigured && supabaseAdmin) {
      const p_idempotency_key = extractIdempotencyKey(req);
      const p_request_hash = computeRequestHash({
        op: 'update_operational_settings',
        resDur,
        walkDur,
        buffer,
        reason: String(reason).trim(),
      });

      const { data: txData, error: txError } = await supabaseAdmin.rpc('update_operational_settings_tx', {
        p_default_reservation_duration_minutes: resDur,
        p_default_walk_in_duration_minutes: walkDur,
        p_reservation_buffer_minutes: buffer,
        p_reason: String(reason).trim(),
        p_actor_id: req.user!.id,
        p_idempotency_key,
        p_request_hash,
      });

      if (txError) {
        const mapped = mapRpcErrorToHttp(txError);
        res.status(mapped.status).json({ message: mapped.message, code: mapped.code });
        return;
      }

      res.json(txData);
      return;
    }

    const oldSettings = { ...demoOperationalSettings };
    demoOperationalSettings = {
      defaultReservationDurationMinutes: resDur,
      defaultWalkInDurationMinutes: walkDur,
      reservationBufferMinutes: buffer,
      updatedAt: new Date().toISOString(),
    };

    await recordAuditAndAlert({
      actor: req.user!,
      action: 'settings.updated',
      entity: 'operational_settings',
      entityId: '1',
      oldValues: oldSettings,
      newValues: { ...demoOperationalSettings },
      reason: String(reason).trim(),
    });

    res.json(demoOperationalSettings);
  });

  // -----------------------------------------------------------------------
  // Centro Privado de Alertas (Exclusivo Super Admin)
  // -----------------------------------------------------------------------
  app.get('/api/alerts', authenticate, requireSuperAdmin, async (req: AuthorizedRequest, res: Response) => {
    const { status, severity } = req.query;

    if (isLiveSupabaseConfigured && supabaseAdmin) {
      let query = supabaseAdmin.from('admin_alerts').select('*, audit:audit_logs(*)').order('created_at', { ascending: false });
      if (status && status !== 'all') query = query.eq('status', status);
      if (severity && severity !== 'all') query = query.eq('severity', severity);

      const { data, error } = await query;
      if (error) {
        res.status(500).json({ message: error.message });
        return;
      }

      const allAlerts = data || [];
      const summary = {
        total: allAlerts.length,
        pending: allAlerts.filter((a) => a.status === 'pending').length,
        reviewed: allAlerts.filter((a) => a.status === 'reviewed').length,
        critical: allAlerts.filter((a) => a.severity === 'critical' && a.status === 'pending').length,
        warning: allAlerts.filter((a) => a.severity === 'warning' && a.status === 'pending').length,
      };
      res.json({ alerts: allAlerts, summary });
      return;
    }

    let filtered = demoAdminAlertsStore;
    if (status && typeof status === 'string' && status !== 'all') {
      filtered = filtered.filter((a) => a.status === status);
    }
    if (severity && typeof severity === 'string' && severity !== 'all') {
      filtered = filtered.filter((a) => a.severity === severity);
    }

    const summary = {
      total: demoAdminAlertsStore.length,
      pending: demoAdminAlertsStore.filter((a) => a.status === 'pending').length,
      reviewed: demoAdminAlertsStore.filter((a) => a.status === 'reviewed').length,
      critical: demoAdminAlertsStore.filter((a) => a.severity === 'critical' && a.status === 'pending').length,
      warning: demoAdminAlertsStore.filter((a) => a.severity === 'warning' && a.status === 'pending').length,
    };

    res.json({ alerts: filtered, summary });
  });

  // Marcar alerta como revisada via review_admin_alert_tx (super_admin exclusivo)
  app.patch('/api/alerts/:id/review', authenticate, requireSuperAdmin, async (req: AuthorizedRequest, res: Response) => {
    const { id } = req.params;
    const reason = typeof req.body?.reason === 'string' && req.body.reason.trim().length > 0
      ? req.body.reason.trim()
      : 'Revisión administrativa de alerta';

    if (isLiveSupabaseConfigured && supabaseAdmin) {
      const p_idempotency_key = extractIdempotencyKey(req);
      const p_request_hash = computeRequestHash({ op: 'review_admin_alert', id, reason });

      const { data: txData, error: txError } = await supabaseAdmin.rpc('review_admin_alert_tx', {
        p_alert_id: id,
        p_reason: reason,
        p_actor_id: req.user!.id,
        p_idempotency_key,
        p_request_hash,
      });

      if (txError) {
        const mapped = mapRpcErrorToHttp(txError);
        res.status(mapped.status).json({ message: mapped.message, code: mapped.code });
        return;
      }

      res.json({ ...txData, reviewedByName: req.user!.name });
      return;
    }

    const alert = demoAdminAlertsStore.find((a) => a.id === id);
    if (!alert) {
      res.status(404).json({ message: 'No se encontró la alerta administrativa solicitada.' });
      return;
    }
    if (alert.status === 'reviewed') {
      res.status(409).json({ message: 'La alerta ya fue marcada como revisada.' });
      return;
    }

    alert.status = 'reviewed';
    alert.reviewedAt = new Date().toISOString();
    alert.reviewedBy = req.user!.id;
    alert.reviewedByName = req.user!.name;

    await recordAuditAndAlert({
      actor: req.user!,
      action: 'admin_alert.reviewed',
      entity: 'admin_alert',
      entityId: alert.id,
      oldValues: { status: 'pending' },
      newValues: { status: 'reviewed', reviewedAt: alert.reviewedAt, reviewedBy: req.user!.id },
      reason,
    });

    res.json(alert);
  });

  // -----------------------------------------------------------------------
  // Auditoría Completa (Exclusivo Super Admin)
  // -----------------------------------------------------------------------
  app.get('/api/audit-logs', authenticate, requireSuperAdmin, async (req: AuthorizedRequest, res: Response) => {
    if (isLiveSupabaseConfigured && supabaseAdmin) {
      const { data, error } = await supabaseAdmin.from('audit_logs').select('*').order('created_at', { ascending: false });
      if (error) {
        res.status(500).json({ message: error.message });
        return;
      }
      res.json(data);
      return;
    }

    res.json(demoAuditLogsStore);
  });

  // -----------------------------------------------------------------------
  // Mesas y Operaciones de Salón
  // -----------------------------------------------------------------------
  app.get('/api/tables', authenticate, async (req: AuthorizedRequest, res: Response) => {
    if (isLiveSupabaseConfigured && supabaseAdmin) {
      const { data: tablesData, error } = await supabaseAdmin.from('tables').select('*').order('number', { ascending: true });
      if (error) {
        res.status(500).json({ message: error.message });
        return;
      }

      const [{ data: resData, error: resErr }, { data: sessData, error: sessErr }] = await Promise.all([
        supabaseAdmin
          .from('reservations')
          .select('id, status, reservation_tables(table_id)')
          .in('status', ['confirmed', 'seated']),
        supabaseAdmin
          .from('table_sessions')
          .select('*')
          .is('ended_at', null),
      ]);

      if (resErr) {
        res.status(500).json({ message: `Error al consultar reservas activas: ${resErr.message}` });
        return;
      }
      if (sessErr) {
        res.status(500).json({ message: `Error al consultar sesiones activas: ${sessErr.message}` });
        return;
      }

      const openSessionByTable = new Map<string, TableSessionSummary>();
      for (const s of sessData || []) {
        openSessionByTable.set(s.table_id, mapLiveSession(s));
      }

      const enriched = (tablesData || []).map((t) => {
        const count = (resData || []).filter((r) =>
          r.reservation_tables?.some((rt: { table_id: string }) => rt.table_id === t.id)
        ).length;
        const cap = t.capacity;
        const shape = t.shape || (cap <= 2 ? 'round' : cap <= 4 ? 'square' : 'rectangle');
        const activeSession = openSessionByTable.get(t.id) || null;
        return {
          id: t.id,
          number: t.number,
          sector: t.sector,
          capacity: t.capacity,
          maxCapacity: t.max_capacity ?? t.maxCapacity ?? t.capacity,
          status: t.status,
          isActive: t.is_active ?? t.isActive ?? true,
          shape,
          occupiedSince: activeSession?.startedAt || t.occupied_since || null,
          serverName: t.server_name || null,
          activeSession,
          upcomingReservationsCount: count,
        };
      });

      res.json(enriched);
      return;
    }

    // Modo Demo
    const enriched = demoTablesStore.map((table) => {
      const upcoming = demoReservationsStore.filter(
        (r) =>
          (r.tableId === table.id || (r.tableIds && r.tableIds.includes(table.id))) &&
          (r.status === 'confirmed' || r.status === 'seated'),
      );
      const activeSession = demoTableSessionsStore.find((s) => s.tableId === table.id && !s.endedAt) || null;
      return {
        ...table,
        occupiedSince: activeSession?.startedAt || table.occupiedSince || null,
        activeSession,
        upcomingReservationsCount: upcoming.length,
      };
    });
    res.json(enriched);
  });

  // -----------------------------------------------------------------------
  // Alta de Mesa Individual via create_table_tx (Exclusivo Super Admin)
  // -----------------------------------------------------------------------
  app.post('/api/tables', authenticate, requireSuperAdmin, async (req: AuthorizedRequest, res: Response) => {
    const { number, capacity, sector, maxCapacity, shape, reason = 'Alta de nueva mesa en plano del salón' } = req.body;

    const tableNum = parseInt(number, 10);
    if (isNaN(tableNum) || tableNum <= 0) {
      res.status(400).json({ message: 'El número de mesa debe ser un entero positivo mayor a cero.' });
      return;
    }

    const cap = parseInt(capacity, 10);
    if (isNaN(cap) || cap < 1 || cap > 30) {
      res.status(400).json({ message: 'La cantidad de personas debe ser un número entre 1 y 30.' });
      return;
    }

    const sec = (sector && typeof sector === 'string' && sector.trim().length > 0)
      ? sector.trim()
      : 'Salón Principal';

    const maxCap = Math.max(cap, parseInt(maxCapacity, 10) || cap);
    const tableShape = (shape === 'round' || shape === 'square' || shape === 'rectangle')
      ? shape
      : (cap <= 2 ? 'round' : cap <= 4 ? 'square' : 'rectangle');

    if (isLiveSupabaseConfigured && supabaseAdmin) {
      try {
        const p_idempotency_key = extractIdempotencyKey(req);
        const p_request_hash = computeRequestHash({
          op: 'create_table',
          number: tableNum,
          sector: sec,
          capacity: cap,
          maxCapacity: maxCap,
          shape: tableShape,
          reason: String(reason).trim(),
        });

        const { data: txData, error: txError } = await supabaseAdmin.rpc('create_table_tx', {
          p_number: tableNum,
          p_sector: sec,
          p_capacity: cap,
          p_max_capacity: maxCap,
          p_shape: tableShape,
          p_reason: String(reason).trim(),
          p_actor_id: req.user!.id,
          p_idempotency_key,
          p_request_hash,
        });

        if (txError) {
          const mapped = mapRpcErrorToHttp(txError);
          res.status(mapped.status).json({ message: mapped.message, code: mapped.code });
          return;
        }

        res.status(201).json({
          ...txData,
          activeSession: null,
          upcomingReservationsCount: 0,
        });
        return;
      } catch (err: any) {
        res.status(500).json({ message: `Error inesperado al persistir mesa: ${err.message || String(err)}` });
        return;
      }
    }

    const existing = demoTablesStore.find((t) => t.number === tableNum);
    if (existing) {
      res.status(409).json({ message: `Ya existe la Mesa ${tableNum} en el salón. Por favor seleccione otro número.` });
      return;
    }

    const newTable: Table = {
      id: `tbl-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      number: tableNum,
      sector: sec,
      capacity: cap,
      maxCapacity: maxCap,
      status: 'available',
      isActive: true,
      shape: tableShape,
      activeSession: null,
    };

    demoTablesStore.push(newTable);
    demoTablesStore.sort((a, b) => a.number - b.number);

    await recordAuditAndAlert({
      actor: req.user!,
      action: 'table.created',
      entity: 'table',
      entityId: newTable.id,
      oldValues: null,
      newValues: {
        number: tableNum,
        capacity: cap,
        maxCapacity: maxCap,
        sector: sec,
        shape: tableShape,
      },
      reason: String(reason).trim(),
      relatedTableId: newTable.id,
      alertTitle: `Nueva Mesa ${tableNum} (${sec}, ${cap} personas) incorporada al plano`,
      severity: 'info',
    });

    res.status(201).json({ ...newTable, upcomingReservationsCount: 0 });
  });

  // -----------------------------------------------------------------------
  // Configuración del Plano desde Cero / Carga Masiva (Exclusivo Super Admin)
  // -----------------------------------------------------------------------
  app.post('/api/tables/initialize-floorplan', authenticate, requireSuperAdmin, async (req: AuthorizedRequest, res: Response) => {
    const { tables: rawTables, wipeExisting = false, reason = 'Configuración inicial del plano del salón' } = req.body;

    if (!Array.isArray(rawTables) || rawTables.length === 0) {
      res.status(400).json({ message: 'Debe ingresar al menos una mesa para configurar el plano.' });
      return;
    }

    const numbersSeen = new Set<number>();
    const sanitizedTables: Array<{
      number: number;
      capacity: number;
      maxCapacity: number;
      sector: string;
      shape: 'round' | 'square' | 'rectangle';
    }> = [];

    for (const item of rawTables) {
      const num = parseInt(item.number, 10);
      if (isNaN(num) || num <= 0) {
        res.status(400).json({ message: `Número de mesa inválido: ${item.number}. Debe ser mayor a 0.` });
        return;
      }
      if (numbersSeen.has(num)) {
        res.status(400).json({ message: `Número de mesa duplicado: Mesa ${num}. Cada mesa debe tener un número identificatorio único.` });
        return;
      }
      numbersSeen.add(num);

      const cap = parseInt(item.capacity, 10);
      if (isNaN(cap) || cap < 1 || cap > 30) {
        res.status(400).json({ message: `Capacidad de la Mesa ${num} inválida. Debe ser entre 1 y 30 personas.` });
        return;
      }

      const sec = (item.sector && typeof item.sector === 'string' && item.sector.trim().length > 0)
        ? item.sector.trim()
        : 'Salón Principal';

      const maxCap = Math.max(cap, parseInt(item.maxCapacity, 10) || cap);
      const shp = (item.shape === 'round' || item.shape === 'square' || item.shape === 'rectangle')
        ? item.shape
        : (cap <= 2 ? 'round' : cap <= 4 ? 'square' : 'rectangle');

      sanitizedTables.push({
        number: num,
        capacity: cap,
        maxCapacity: maxCap,
        sector: sec,
        shape: shp,
      });
    }

    if (isLiveSupabaseConfigured && supabaseAdmin) {
      try {
        const p_idempotency_key = extractIdempotencyKey(req);
        const p_request_hash = computeRequestHash({
          op: 'initialize_floor_plan',
          tables: sanitizedTables,
          wipe: Boolean(wipeExisting),
          reason: String(reason).trim(),
        });

        const { error: txErr } = await supabaseAdmin.rpc('initialize_floor_plan_tx', {
          p_tables: sanitizedTables,
          p_wipe: Boolean(wipeExisting),
          p_reason: String(reason).trim(),
          p_actor_id: req.user!.id,
          p_idempotency_key,
          p_request_hash,
        });

        if (txErr) {
          const mapped = mapRpcErrorToHttp(txErr);
          res.status(mapped.status).json({ message: mapped.message, code: mapped.code });
          return;
        }

        const [{ data: freshTables, error: tFetchErr }, { data: openSess }] = await Promise.all([
          supabaseAdmin.from('tables').select('*').order('number', { ascending: true }),
          supabaseAdmin.from('table_sessions').select('*').is('ended_at', null),
        ]);

        if (tFetchErr) {
          res.status(500).json({ message: `Plano actualizado, pero falló la lectura de mesas: ${tFetchErr.message}` });
          return;
        }

        const sessMap = new Map<string, TableSessionSummary>();
        for (const s of openSess || []) {
          sessMap.set(s.table_id, mapLiveSession(s));
        }

        const formatted = (freshTables || []).map((r) => {
          const activeSession = sessMap.get(r.id) || null;
          return {
            id: r.id,
            number: r.number,
            sector: r.sector,
            capacity: r.capacity,
            maxCapacity: r.max_capacity,
            status: r.status,
            isActive: r.is_active,
            shape: r.shape || (r.capacity <= 2 ? 'round' : r.capacity <= 4 ? 'square' : 'rectangle'),
            occupiedSince: activeSession?.startedAt || null,
            activeSession,
            upcomingReservationsCount: 0,
          };
        });

        res.json({
          message: 'Nuevo plano guardado con éxito en PostgreSQL.',
          count: formatted.length,
          tables: formatted,
        });
        return;
      } catch (err: any) {
        res.status(500).json({ message: `Error al configurar plano: ${err.message || String(err)}` });
        return;
      }
    }

    // Modo Demo Aislado
    const incomingNumbers = new Set(sanitizedTables.map((t) => t.number));
    const removedTables = demoTablesStore.filter((t) => !incomingNumbers.has(t.number));

    if (wipeExisting) {
      for (const removed of removedTables) {
        const activeRes = demoReservationsStore.find((r) => {
          if (r.status !== 'confirmed' && r.status !== 'seated') return false;
          if (r.tableId === removed.id || r.tableNumber === removed.number) return true;
          if (r.tableIds && r.tableIds.includes(removed.id)) return true;
          if (r.tableNumbers && r.tableNumbers.includes(removed.number)) return true;
          return false;
        });

        if (activeRes) {
          res.status(409).json({
            message: `No es posible retirar la Mesa ${removed.number} porque posee reservas activas (${activeRes.customerName}).`,
          });
          return;
        }

        if (demoTableSessionsStore.some((s) => s.tableId === removed.id && !s.endedAt)) {
          res.status(409).json({
            message: `No es posible retirar la Mesa ${removed.number} porque posee una sesión abierta.`,
          });
          return;
        }
      }
    }

    const existingTableMap = new Map(demoTablesStore.map((t) => [t.number, t]));
    const updatedDemoList: Table[] = sanitizedTables.map((t) => {
      const existing = existingTableMap.get(t.number);
      if (existing) {
        return {
          ...existing,
          capacity: t.capacity,
          maxCapacity: Math.max(t.maxCapacity, existing.maxCapacity),
          sector: t.sector,
          shape: t.shape,
          isActive: true,
          status: existing.status === 'out_of_service' ? 'available' : existing.status,
        };
      }
      return {
        id: `tbl-${t.number}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        number: t.number,
        sector: t.sector,
        capacity: t.capacity,
        maxCapacity: t.maxCapacity,
        status: 'available',
        isActive: true,
        shape: t.shape,
      };
    });

    if (wipeExisting) {
      // Preservar mesas históricas desactivándolas en vez de borrarlas
      const historicRemoved = removedTables
        .filter((r) =>
          demoReservationsStore.some((res) => res.tableId === r.id || res.tableIds?.includes(r.id)) ||
          demoTableSessionsStore.some((s) => s.tableId === r.id)
        )
        .map((r) => ({ ...r, isActive: false, status: 'out_of_service' as const }));
      demoTablesStore = [...updatedDemoList, ...historicRemoved];
    } else {
      const currentNums = new Set(demoTablesStore.map((t) => t.number));
      const newlyAdded = updatedDemoList.filter((t) => !currentNums.has(t.number));
      demoTablesStore = [...demoTablesStore, ...newlyAdded];
    }
    demoTablesStore.sort((a, b) => a.number - b.number);

    const sectorsSummary = Array.from(new Set(sanitizedTables.map((t) => t.sector))).join(', ');
    await recordAuditAndAlert({
      actor: req.user!,
      action: wipeExisting ? 'floorplan.reinitialized' : 'floorplan.batch_tables_added',
      entity: 'tables',
      entityId: 'salon-layout',
      oldValues: null,
      newValues: {
        tablesCount: sanitizedTables.length,
        sectors: sectorsSummary,
        wipeExisting,
      },
      reason: String(reason).trim(),
      alertTitle: wipeExisting
        ? `Plano de salón configurado: ${sanitizedTables.length} mesas en [${sectorsSummary}]`
        : `Carga de ${sanitizedTables.length} mesas al plano de salón [${sectorsSummary}]`,
      severity: wipeExisting ? 'warning' : 'info',
    });

    res.json({
      message: 'Plano del salón configurado con éxito.',
      count: demoTablesStore.length,
      tables: demoTablesStore.map((t) => ({ ...t, upcomingReservationsCount: 0 })),
    });
  });

  // -----------------------------------------------------------------------
  // Eliminar Mesa Virgen via delete_virgin_table_tx (Exclusivo Super Admin)
  // -----------------------------------------------------------------------
  app.delete('/api/tables/:id', authenticate, requireSuperAdmin, async (req: AuthorizedRequest, res: Response) => {
    const { id } = req.params;
    const rawReason = req.body?.reason ?? req.query?.reason;
    const reason = (typeof rawReason === 'string' && rawReason.trim().length >= 5)
      ? rawReason.trim()
      : 'Eliminación manual de mesa sin historial operativo';

    if (isLiveSupabaseConfigured && supabaseAdmin) {
      try {
        const p_idempotency_key = extractIdempotencyKey(req);
        const p_request_hash = computeRequestHash({ op: 'delete_virgin_table', id, reason });

        const { data: txData, error: txError } = await supabaseAdmin.rpc('delete_virgin_table_tx', {
          p_table_id: id,
          p_reason: reason,
          p_actor_id: req.user!.id,
          p_idempotency_key,
          p_request_hash,
        });

        if (txError) {
          const mapped = mapRpcErrorToHttp(txError);
          res.status(mapped.status).json({ message: mapped.message, code: mapped.code });
          return;
        }

        res.json({
          message: `Mesa ${txData?.number ?? ''} eliminada correctamente.`,
          ...txData,
        });
        return;
      } catch (err: any) {
        res.status(500).json({ message: `Error al eliminar mesa: ${err.message || String(err)}` });
        return;
      }
    }

    const idx = demoTablesStore.findIndex((t) => t.id === id);
    if (idx === -1) {
      res.status(404).json({ message: 'Mesa no encontrada.' });
      return;
    }

    const table = demoTablesStore[idx];
    const hasHistory =
      demoReservationsStore.some(
        (r) => r.tableId === id || r.tableNumber === table.number || (r.tableIds && r.tableIds.includes(id))
      ) || demoTableSessionsStore.some((s) => s.tableId === id);

    if (hasHistory) {
      res.status(409).json({
        message: `La mesa ${table.number} tiene historial operativo (reservas o sesiones) y no puede eliminarse; desactívela.`,
      });
      return;
    }

    demoTablesStore.splice(idx, 1);
    await recordAuditAndAlert({
      actor: req.user!,
      action: 'table.deleted',
      entity: 'table',
      entityId: table.id,
      oldValues: { number: table.number, sector: table.sector, capacity: table.capacity },
      newValues: null,
      reason,
      alertTitle: `Mesa ${table.number} (${table.sector}) eliminada del catálogo`,
      severity: 'info',
    });

    res.json({ message: `Mesa ${table.number} eliminada correctamente.`, deleted: true, id: table.id, number: table.number });
  });

  // -----------------------------------------------------------------------
  // Listado Operativo de Reservas
  // -----------------------------------------------------------------------
  app.get('/api/reservations', authenticate, async (req: AuthorizedRequest, res: Response) => {
    if (isLiveSupabaseConfigured && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from('reservations')
        .select('*, reservation_tables(table:tables(id, number))')
        .order('start_time', { ascending: true });
      if (error) {
        res.status(500).json({ message: error.message });
        return;
      }
      const formatted = (data || []).map((r: any) => {
        const assignedTables = (r.reservation_tables || []).map((rt: any) => rt.table).filter(Boolean);
        const primaryTable = assignedTables[0];
        return {
          id: r.id,
          tableId: primaryTable?.id || '',
          tableNumber: primaryTable?.number || 0,
          customerName: r.customer_name,
          customerPhone: r.customer_phone,
          customerEmail: r.customer_email,
          guestsCount: r.guests_count,
          time: r.start_time
            ? new Date(r.start_time).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
            : '',
          startTime: r.start_time,
          endTime: r.end_time,
          durationMinutes: r.duration_minutes,
          status: r.status,
          notes: r.notes || '',
          cancellationReason: r.cancellation_reason || null,
          seatedAt: r.seated_at || null,
          completedAt: r.completed_at || null,
          noShowAt: r.no_show_at || null,
          tableIds: assignedTables.map((t: any) => t.id),
          tableNumbers: assignedTables.map((t: any) => t.number),
        };
      });
      res.json(formatted);
      return;
    }

    res.json(demoReservationsStore);
  });

  // Pre-chequeo de cambio de capacidad (invariante duro SUM(capacity) >= guests_count)
  app.get('/api/tables/:id/check-capacity', authenticate, async (req: AuthorizedRequest, res: Response) => {
    const { id } = req.params;
    const newCap = parseInt(req.query.capacity as string, 10);

    if (isLiveSupabaseConfigured && supabaseAdmin) {
      const [{ data: resData, error: qErr }, { data: openSess, error: sErr }] = await Promise.all([
        supabaseAdmin
          .from('reservations')
          .select('id, customer_name, guests_count, status, reservation_tables(table_id, table:tables(id, capacity))')
          .in('status', ['confirmed', 'seated']),
        supabaseAdmin
          .from('table_sessions')
          .select('id, guests_count, session_type')
          .eq('table_id', id)
          .is('ended_at', null)
          .eq('session_type', 'walk_in')
          .maybeSingle(),
      ]);

      if (qErr || sErr) {
        res.status(500).json({ message: `Error al consultar base de datos: ${qErr?.message || sErr?.message}` });
        return;
      }

      const relevant = (resData || []).filter((r: any) =>
        (r.reservation_tables || []).some((rt: any) => rt.table_id === id)
      );

      const affected: any[] = [];
      let hardBlocked = false;
      for (const r of relevant) {
        const newSum = (r.reservation_tables || []).reduce((acc: number, rt: any) => {
          const tblCap = rt.table_id === id ? newCap : (rt.table?.capacity ?? 0);
          return acc + tblCap;
        }, 0);
        if (newSum < r.guests_count) {
          hardBlocked = true;
          affected.push({ ...r, newCombinedCapacity: newSum });
        } else if (r.guests_count > newCap && (r.reservation_tables || []).length === 1) {
          affected.push(r);
        }
      }

      const openSessionConflict = Boolean(openSess && openSess.guests_count && newCap < openSess.guests_count);
      if (openSessionConflict) hardBlocked = true;

      res.json({
        hasConflict: affected.length > 0 || openSessionConflict,
        hardBlocked,
        openSessionConflict,
        affectedReservations: affected,
      });
      return;
    }

    const activeReservations = demoReservationsStore.filter(
      (r) =>
        (r.status === 'confirmed' || r.status === 'seated') &&
        (r.tableId === id || (r.tableIds && r.tableIds.includes(id)))
    );

    const affectedReservations: Reservation[] = [];
    let hardBlocked = false;
    for (const r of activeReservations) {
      const assignedIds = r.tableIds && r.tableIds.length > 0 ? r.tableIds : [r.tableId];
      const newSum = assignedIds.reduce((acc, tid) => {
        if (tid === id) return acc + newCap;
        const tbl = demoTablesStore.find((t) => t.id === tid);
        return acc + (tbl?.capacity ?? 0);
      }, 0);
      if (newSum < r.guestsCount) {
        hardBlocked = true;
        affectedReservations.push(r);
      }
    }

    const openWalkIn = demoTableSessionsStore.find(
      (s) => s.tableId === id && !s.endedAt && s.sessionType === 'walk_in'
    );
    const openSessionConflict = Boolean(openWalkIn?.guestsCount && newCap < openWalkIn.guestsCount);
    if (openSessionConflict) hardBlocked = true;

    res.json({
      hasConflict: affectedReservations.length > 0 || openSessionConflict,
      hardBlocked,
      openSessionConflict,
      affectedReservations,
    });
  });

  // Modificar capacidad de mesa via change_table_capacity_tx
  app.patch('/api/tables/:id/capacity', authenticate, async (req: AuthorizedRequest, res: Response) => {
    const { id } = req.params;
    const { capacity, reason, force } = req.body;

    const newCapacity = parseInt(capacity, 10);
    if (isNaN(newCapacity) || newCapacity < 1 || newCapacity > 30) {
      res.status(400).json({ message: 'La capacidad debe ser un número entre 1 y 30.' });
      return;
    }

    if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
      res.status(400).json({ message: 'Se requiere indicar un motivo detallado (mínimo 5 caracteres).' });
      return;
    }

    if (isLiveSupabaseConfigured && supabaseAdmin) {
      try {
        const p_idempotency_key = extractIdempotencyKey(req);
        const p_request_hash = computeRequestHash({
          op: 'change_table_capacity',
          id,
          capacity: newCapacity,
          reason: reason.trim(),
          force: Boolean(force),
        });

        const { data: txData, error: txError } = await supabaseAdmin.rpc('change_table_capacity_tx', {
          p_table_id: id,
          p_new_capacity: newCapacity,
          p_reason: reason.trim(),
          p_force: Boolean(force),
          p_actor_id: req.user!.id,
          p_idempotency_key,
          p_request_hash,
        });

        if (txError) {
          const mapped = mapRpcErrorToHttp(txError);
          res.status(mapped.status).json({ message: mapped.message, code: mapped.code });
          return;
        }

        res.json(txData);
        return;
      } catch (err: any) {
        res.status(500).json({ message: `Error de servidor en PostgreSQL: ${err.message || String(err)}` });
        return;
      }
    }

    // Modo Demo Aislado (replica invariantes de change_table_capacity_tx)
    if (force) {
      if (req.user!.role !== 'super_admin') {
        res.status(403).json({ message: 'Solo el Administrador Principal activo puede confirmar cambios con p_force.' });
        return;
      }
      if (reason.trim().length < 10) {
        res.status(400).json({ message: 'Cuando p_force=true se requiere un motivo detallado (mínimo 10 caracteres).' });
        return;
      }
    }

    const table = demoTablesStore.find((t) => t.id === id);
    if (!table) {
      res.status(404).json({ message: 'Mesa no encontrada.' });
      return;
    }

    const activeReservations = demoReservationsStore.filter(
      (r) =>
        (r.status === 'confirmed' || r.status === 'seated') &&
        (r.tableId === id || (r.tableIds && r.tableIds.includes(id)))
    );
    for (const r of activeReservations) {
      const assignedIds = r.tableIds && r.tableIds.length > 0 ? r.tableIds : [r.tableId];
      const newSum = assignedIds.reduce((acc, tid) => {
        if (tid === id) return acc + newCapacity;
        const t = demoTablesStore.find((item) => item.id === tid);
        return acc + (t?.capacity ?? 0);
      }, 0);
      if (newSum < r.guestsCount) {
        res.status(422).json({
          message: `Invariante de capacidad: la reserva de ${r.customerName} (${r.guestsCount} comensales) quedaría con capacidad combinada insuficiente (${newSum}). Reasigne mesas primero.`,
          code: 'SF422',
        });
        return;
      }
    }

    const openWalkIn = demoTableSessionsStore.find(
      (s) => s.tableId === id && !s.endedAt && s.sessionType === 'walk_in'
    );
    if (openWalkIn?.guestsCount && newCapacity < openWalkIn.guestsCount) {
      res.status(422).json({
        message: `Invariante de capacidad: la sesión walk-in abierta tiene ${openWalkIn.guestsCount} comensales y no admite capacidad ${newCapacity}.`,
        code: 'SF422',
      });
      return;
    }

    const oldCapacity = table.capacity;
    table.capacity = newCapacity;
    table.maxCapacity = Math.max(newCapacity, table.maxCapacity);

    await recordAuditAndAlert({
      actor: req.user!,
      action: 'table.capacity_changed',
      entity: 'table',
      entityId: table.id,
      oldValues: { capacity: oldCapacity, maxCapacity: table.maxCapacity },
      newValues: { capacity: newCapacity, maxCapacity: table.maxCapacity, forced: Boolean(force) },
      reason: reason.trim(),
      relatedTableId: table.id,
      alertTitle: `Mesa ${table.number}: capacidad modificada de ${oldCapacity} a ${newCapacity}`,
      severity: 'warning',
    });

    res.json(table);
  });

  // Pre-chequeo de desactivación de mesa
  app.get('/api/tables/:id/check-deactivation', authenticate, async (req: AuthorizedRequest, res: Response) => {
    const { id } = req.params;

    if (isLiveSupabaseConfigured && supabaseAdmin) {
      const [{ data: resData, error: qErr }, { data: openSess, error: sErr }] = await Promise.all([
        supabaseAdmin
          .from('reservations')
          .select('id, customer_name, guests_count, start_time, status, reservation_tables!inner(table_id)')
          .eq('reservation_tables.table_id', id)
          .in('status', ['confirmed', 'seated']),
        supabaseAdmin
          .from('table_sessions')
          .select('id, session_type, started_at')
          .eq('table_id', id)
          .is('ended_at', null),
      ]);

      if (qErr || sErr) {
        res.status(500).json({ message: `Error en base de datos: ${qErr?.message || sErr?.message}` });
        return;
      }

      res.json({
        hasFutureReservations: (resData || []).length > 0,
        hasOpenSessions: (openSess || []).length > 0,
        openSessionsCount: (openSess || []).length,
        affectedReservations: resData || [],
      });
      return;
    }

    const activeReservations = demoReservationsStore.filter(
      (r) =>
        (r.status === 'confirmed' || r.status === 'seated') &&
        (r.tableId === id || (r.tableIds && r.tableIds.includes(id)))
    );
    const openSessions = demoTableSessionsStore.filter((s) => s.tableId === id && !s.endedAt);

    res.json({
      hasFutureReservations: activeReservations.length > 0,
      hasOpenSessions: openSessions.length > 0,
      openSessionsCount: openSessions.length,
      affectedReservations: activeReservations,
    });
  });

  // Cambiar estado administrativo de mesa (ONLY available | out_of_service; sin cascada de resolución)
  app.patch('/api/tables/:id/status', authenticate, async (req: AuthorizedRequest, res: Response) => {
    const { id } = req.params;
    const { status, reason } = req.body;

    if (status !== 'available' && status !== 'out_of_service') {
      res.status(409).json({
        message: 'set_table_status solo admite estados available u out_of_service; utilice los endpoints de sesiones para ocupación.',
        code: 'SF409',
      });
      return;
    }

    if (isLiveSupabaseConfigured && supabaseAdmin) {
      try {
        const p_idempotency_key = extractIdempotencyKey(req);
        const p_request_hash = computeRequestHash({
          op: 'set_table_status',
          id,
          status,
          reason: reason ? String(reason).trim() : null,
        });

        const { data: txData, error: txError } = await supabaseAdmin.rpc('set_table_status_tx', {
          p_table_id: id,
          p_status: status,
          p_reason: reason ? String(reason).trim() : null,
          p_actor_id: req.user!.id,
          p_idempotency_key,
          p_request_hash,
        });

        if (txError) {
          const mapped = mapRpcErrorToHttp(txError);
          res.status(mapped.status).json({ message: mapped.message, code: mapped.code });
          return;
        }

        res.json(txData);
        return;
      } catch (err: any) {
        res.status(500).json({ message: `Error de servidor en PostgreSQL: ${err.message || String(err)}` });
        return;
      }
    }

    // Modo Demo Aislado (sin cancelación implícita de reservas)
    const table = demoTablesStore.find((t) => t.id === id);
    if (!table) {
      res.status(404).json({ message: 'Mesa no encontrada.' });
      return;
    }

    const oldStatus = table.status;
    const oldActive = table.isActive;

    if (status === 'out_of_service') {
      if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
        res.status(400).json({ message: 'Para desactivar una mesa es obligatorio declarar el motivo (mínimo 5 caracteres).' });
        return;
      }

      if (demoTableSessionsStore.some((s) => s.tableId === id && !s.endedAt)) {
        res.status(409).json({
          message: `No se puede desactivar la mesa ${table.number} porque tiene una sesión abierta.`,
          code: 'SF409',
        });
        return;
      }

      const activeReservations = demoReservationsStore.filter(
        (r) =>
          (r.status === 'confirmed' || r.status === 'seated') &&
          (r.tableId === id || (r.tableIds && r.tableIds.includes(id)))
      );

      if (activeReservations.length > 0) {
        res.status(409).json({
          message: `La mesa ${table.number} tiene ${activeReservations.length} reserva(s) activa(s). Cancele o reasigne esas reservas antes de desactivarla.`,
          code: 'SF409',
          details: { affectedReservations: activeReservations },
        });
        return;
      }

      table.status = 'out_of_service';
      table.isActive = false;

      await recordAuditAndAlert({
        actor: req.user!,
        action: 'table.deactivated',
        entity: 'table',
        entityId: table.id,
        oldValues: { status: oldStatus, isActive: oldActive },
        newValues: { status: 'out_of_service', isActive: false },
        reason: reason.trim(),
        relatedTableId: table.id,
        alertTitle: `Mesa ${table.number} (${table.sector}) fuera de servicio`,
        severity: 'warning',
      });

      res.json(table);
      return;
    }

    // Reactivación / disponible
    table.status = 'available';
    table.isActive = true;

    await recordAuditAndAlert({
      actor: req.user!,
      action: oldStatus === 'out_of_service' || !oldActive ? 'table.reactivated' : 'table.status_changed',
      entity: 'table',
      entityId: table.id,
      oldValues: { status: oldStatus, isActive: oldActive },
      newValues: { status: 'available', isActive: true },
      reason: reason?.trim() || 'Actualización de estado operativo de mesa',
      relatedTableId: table.id,
      alertTitle: oldStatus === 'out_of_service' ? `Mesa ${table.number} reactivada para el servicio` : undefined,
      severity: 'info',
    });

    res.json(table);
  });

  // -----------------------------------------------------------------------
  // Sesiones de Mesa y Ciclo de Vida de Reservas (Migración 5)
  // -----------------------------------------------------------------------

  // Abrir sesión walk-in en una mesa
  app.post('/api/tables/:id/walk-in', authenticate, async (req: AuthorizedRequest, res: Response) => {
    const { id } = req.params;
    const { guestsCount, expectedDurationMinutes, notes } = req.body || {};

    const guests = guestsCount !== undefined && guestsCount !== null && guestsCount !== ''
      ? parseInt(guestsCount, 10)
      : null;
    if (guests !== null && (isNaN(guests) || guests < 1)) {
      res.status(400).json({ message: 'La cantidad de comensales debe ser mayor a 0.' });
      return;
    }

    const expDur = expectedDurationMinutes !== undefined && expectedDurationMinutes !== null && expectedDurationMinutes !== ''
      ? parseInt(expectedDurationMinutes, 10)
      : null;
    if (expDur !== null && (isNaN(expDur) || expDur < 15 || expDur > 480)) {
      res.status(400).json({ message: 'La duración esperada debe estar entre 15 y 480 minutos.' });
      return;
    }

    if (isLiveSupabaseConfigured && supabaseAdmin) {
      const p_idempotency_key = extractIdempotencyKey(req);
      const p_request_hash = computeRequestHash({
        op: 'open_walk_in_session',
        id,
        guestsCount: guests,
        expectedDurationMinutes: expDur,
        notes: notes ? String(notes).trim() : null,
      });

      const { data: txData, error: txError } = await supabaseAdmin.rpc('open_walk_in_session_tx', {
        p_table_id: id,
        p_guests_count: guests,
        p_expected_duration_minutes: expDur,
        p_notes: notes ? String(notes).trim() : null,
        p_actor_id: req.user!.id,
        p_idempotency_key,
        p_request_hash,
      });

      if (txError) {
        const mapped = mapRpcErrorToHttp(txError);
        res.status(mapped.status).json({ message: mapped.message, code: mapped.code });
        return;
      }

      res.status(201).json(txData);
      return;
    }

    const table = demoTablesStore.find((t) => t.id === id);
    if (!table) {
      res.status(404).json({ message: 'Mesa no encontrada.' });
      return;
    }
    if (!table.isActive || table.status === 'out_of_service') {
      res.status(409).json({ message: `La mesa ${table.number} está inactiva o fuera de servicio.` });
      return;
    }
    if (demoTableSessionsStore.some((s) => s.tableId === id && !s.endedAt)) {
      res.status(409).json({ message: `La mesa ${table.number} ya tiene una sesión abierta.` });
      return;
    }
    if (guests !== null && guests > table.capacity) {
      res.status(422).json({
        message: `Cantidad de comensales (${guests}) excede la capacidad de la mesa (${table.capacity}).`,
        code: 'SF422',
      });
      return;
    }

    const dur = expDur ?? demoOperationalSettings.defaultWalkInDurationMinutes;
    const now = new Date();
    const estEnd = new Date(now.getTime() + dur * 60000);
    const session: TableSessionSummary = {
      id: `sess-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      tableId: table.id,
      reservationId: null,
      sessionType: 'walk_in',
      guestsCount: guests,
      startedAt: now.toISOString(),
      expectedDurationMinutes: dur,
      estimatedEndAt: estEnd.toISOString(),
      endedAt: null,
      closeReason: null,
      notes: notes ? String(notes).trim() : null,
    };

    demoTableSessionsStore.push(session);
    table.serverName = req.user!.name;
    recomputeDemoTableAvailability([table.id]);

    await recordAuditAndAlert({
      actor: req.user!,
      action: 'table_session.walk_in_opened',
      entity: 'table_session',
      entityId: session.id,
      oldValues: null,
      newValues: { tableId: table.id, guestsCount: guests, startedAt: session.startedAt },
      reason: `Apertura de sesión walk-in en mesa ${table.number}`,
      relatedTableId: table.id,
    });

    res.status(201).json(session);
  });

  // Liberación operativa (SOLO walk-in u ocupación huérfana; rechaza sesiones de reserva)
  app.post('/api/tables/:id/release-operational', authenticate, async (req: AuthorizedRequest, res: Response) => {
    const { id } = req.params;
    const { reason } = req.body || {};

    if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
      res.status(400).json({ message: 'Debe indicar motivo operativo para liberar la mesa (mínimo 5 caracteres).' });
      return;
    }

    if (isLiveSupabaseConfigured && supabaseAdmin) {
      const p_idempotency_key = extractIdempotencyKey(req);
      const p_request_hash = computeRequestHash({
        op: 'release_table_operational',
        id,
        reason: reason.trim(),
      });

      const { data: txData, error: txError } = await supabaseAdmin.rpc('release_table_operational_tx', {
        p_table_id: id,
        p_reason: reason.trim(),
        p_actor_id: req.user!.id,
        p_idempotency_key,
        p_request_hash,
      });

      if (txError) {
        const mapped = mapRpcErrorToHttp(txError);
        res.status(mapped.status).json({ message: mapped.message, code: mapped.code });
        return;
      }

      res.json(txData);
      return;
    }

    const table = demoTablesStore.find((t) => t.id === id);
    if (!table) {
      res.status(404).json({ message: 'Mesa no encontrada.' });
      return;
    }

    const openSess = demoTableSessionsStore.find((s) => s.tableId === id && !s.endedAt);
    if (openSess) {
      if (openSess.sessionType === 'reservation') {
        res.status(409).json({
          message: `La mesa ${table.number} tiene una sesión de reserva activa; use Finalizar Servicio o Cancelar Reserva.`,
          code: 'SF409',
        });
        return;
      }
      openSess.endedAt = new Date().toISOString();
      openSess.closeReason = 'operational_release';
    } else if (table.status !== 'occupied') {
      res.status(409).json({ message: `La mesa ${table.number} no tiene sesión abierta ni estado occupied.`, code: 'SF409' });
      return;
    }

    recomputeDemoTableAvailability([table.id]);

    await recordAuditAndAlert({
      actor: req.user!,
      action: 'table.operational_released',
      entity: 'table',
      entityId: table.id,
      oldValues: { status: 'occupied', openSessionId: openSess?.id || null },
      newValues: { status: table.status, closedSessionId: openSess?.id || null },
      reason: reason.trim(),
      relatedTableId: table.id,
      alertTitle: `Liberación operativa de Mesa ${table.number}`,
      severity: 'warning',
    });

    res.json({
      tableId: table.id,
      number: table.number,
      status: table.status,
      closedSessionId: openSess?.id || null,
    });
  });

  // Extender duración estimada de sesión abierta
  app.patch('/api/table-sessions/:id/extend', authenticate, async (req: AuthorizedRequest, res: Response) => {
    const { id } = req.params;
    const { extraMinutes, reason = 'Extensión de tiempo de estadía' } = req.body || {};

    const extra = parseInt(extraMinutes, 10);
    if (isNaN(extra) || extra < 5 || extra > 240) {
      res.status(400).json({ message: 'La extensión debe ser entre 5 y 240 minutos.' });
      return;
    }

    if (isLiveSupabaseConfigured && supabaseAdmin) {
      const p_idempotency_key = extractIdempotencyKey(req);
      const p_request_hash = computeRequestHash({
        op: 'extend_table_session',
        id,
        extraMinutes: extra,
        reason: String(reason).trim(),
      });

      const { data: txData, error: txError } = await supabaseAdmin.rpc('extend_table_session_tx', {
        p_session_id: id,
        p_extra_minutes: extra,
        p_reason: String(reason).trim(),
        p_actor_id: req.user!.id,
        p_idempotency_key,
        p_request_hash,
      });

      if (txError) {
        const mapped = mapRpcErrorToHttp(txError);
        res.status(mapped.status).json({ message: mapped.message, code: mapped.code });
        return;
      }

      res.json(txData);
      return;
    }

    const sess = demoTableSessionsStore.find((s) => s.id === id);
    if (!sess) {
      res.status(404).json({ message: 'Sesión de mesa no encontrada.' });
      return;
    }
    if (sess.endedAt) {
      res.status(409).json({ message: 'La sesión ya se encuentra cerrada.' });
      return;
    }
    const newDur = sess.expectedDurationMinutes + extra;
    if (newDur > 480) {
      res.status(400).json({ message: 'La duración total de la sesión no puede superar 480 minutos.' });
      return;
    }
    sess.expectedDurationMinutes = newDur;
    sess.estimatedEndAt = new Date(new Date(sess.estimatedEndAt).getTime() + extra * 60000).toISOString();

    await recordAuditAndAlert({
      actor: req.user!,
      action: 'table_session.extended',
      entity: 'table_session',
      entityId: sess.id,
      oldValues: null,
      newValues: { expectedDurationMinutes: sess.expectedDurationMinutes, estimatedEndAt: sess.estimatedEndAt },
      reason: String(reason).trim(),
      relatedTableId: sess.tableId,
      relatedReservationId: sess.reservationId,
    });

    res.json({
      id: sess.id,
      tableId: sess.tableId,
      expectedDurationMinutes: sess.expectedDurationMinutes,
      estimatedEndAt: sess.estimatedEndAt,
    });
  });

  // Cerrar sesión walk-in normalmente
  app.post('/api/table-sessions/:id/close', authenticate, async (req: AuthorizedRequest, res: Response) => {
    const { id } = req.params;
    const { notes } = req.body || {};

    if (isLiveSupabaseConfigured && supabaseAdmin) {
      const p_idempotency_key = extractIdempotencyKey(req);
      const p_request_hash = computeRequestHash({
        op: 'close_walk_in_session',
        id,
        notes: notes ? String(notes).trim() : null,
      });

      const { data: txData, error: txError } = await supabaseAdmin.rpc('close_walk_in_session_tx', {
        p_session_id: id,
        p_notes: notes ? String(notes).trim() : null,
        p_actor_id: req.user!.id,
        p_idempotency_key,
        p_request_hash,
      });

      if (txError) {
        const mapped = mapRpcErrorToHttp(txError);
        res.status(mapped.status).json({ message: mapped.message, code: mapped.code });
        return;
      }

      res.json(txData);
      return;
    }

    const sess = demoTableSessionsStore.find((s) => s.id === id);
    if (!sess) {
      res.status(404).json({ message: 'Sesión no encontrada.' });
      return;
    }
    if (sess.endedAt) {
      res.status(409).json({ message: 'La sesión ya se encuentra cerrada.' });
      return;
    }
    if (sess.sessionType !== 'walk_in') {
      res.status(409).json({
        message: 'Las sesiones de reserva deben cerrarse mediante Finalizar Servicio o Cancelar Reserva.',
        code: 'SF409',
      });
      return;
    }

    sess.endedAt = new Date().toISOString();
    sess.closeReason = 'walk_in_closed';
    if (notes) sess.notes = String(notes).trim();
    recomputeDemoTableAvailability([sess.tableId]);

    await recordAuditAndAlert({
      actor: req.user!,
      action: 'table_session.walk_in_closed',
      entity: 'table_session',
      entityId: sess.id,
      oldValues: { endedAt: null },
      newValues: { endedAt: sess.endedAt, closeReason: 'walk_in_closed' },
      reason: notes ? String(notes).trim() : 'Cierre normal de sesión walk-in',
      relatedTableId: sess.tableId,
    });

    res.json({ id: sess.id, tableId: sess.tableId, endedAt: sess.endedAt, closeReason: 'walk_in_closed' });
  });

  // Reasignar mesas de reserva confirmada
  app.post('/api/reservations/:id/reassign-tables', authenticate, async (req: AuthorizedRequest, res: Response) => {
    const { id } = req.params;
    const { tableIds, reason = 'Reasignación de mesas de reserva' } = req.body || {};

    if (!Array.isArray(tableIds) || tableIds.length === 0) {
      res.status(400).json({ message: 'Debe seleccionar al menos una nueva mesa.' });
      return;
    }

    if (isLiveSupabaseConfigured && supabaseAdmin) {
      const p_idempotency_key = extractIdempotencyKey(req);
      const p_request_hash = computeRequestHash({
        op: 'reassign_reservation_tables',
        id,
        tableIds,
        reason: String(reason).trim(),
      });

      const { data: txData, error: txError } = await supabaseAdmin.rpc('reassign_reservation_tables_tx', {
        p_reservation_id: id,
        p_new_table_ids: tableIds,
        p_reason: String(reason).trim(),
        p_actor_id: req.user!.id,
        p_idempotency_key,
        p_request_hash,
      });

      if (txError) {
        const mapped = mapRpcErrorToHttp(txError);
        res.status(mapped.status).json({ message: mapped.message, code: mapped.code });
        return;
      }

      res.json(txData);
      return;
    }

    const resItem = demoReservationsStore.find((r) => r.id === id);
    if (!resItem) {
      res.status(404).json({ message: 'Reserva no encontrada.' });
      return;
    }
    if (resItem.status !== 'confirmed') {
      res.status(409).json({ message: `Solo se pueden reasignar mesas de reservas confirmadas (actual: ${resItem.status}).` });
      return;
    }

    const oldIds = resItem.tableIds || [resItem.tableId];
    const sortedOld = [...oldIds].sort();
    const sortedNew = [...tableIds].sort();
    if (JSON.stringify(sortedOld) === JSON.stringify(sortedNew)) {
      res.status(409).json({ message: 'Las mesas seleccionadas ya coinciden con la asignación actual de la reserva.' });
      return;
    }

    const selectedTables = demoTablesStore.filter((t) => tableIds.includes(t.id));
    if (selectedTables.length !== tableIds.length) {
      res.status(404).json({ message: 'Una o más mesas seleccionadas no existen.' });
      return;
    }
    if (selectedTables.some((t) => !t.isActive || t.status === 'out_of_service')) {
      res.status(409).json({ message: 'No se pueden asignar mesas inactivas o fuera de servicio.' });
      return;
    }
    const totalCap = selectedTables.reduce((sum, t) => sum + t.capacity, 0);
    if (totalCap < resItem.guestsCount) {
      res.status(422).json({
        message: `La capacidad combinada (${totalCap}) es menor a los comensales (${resItem.guestsCount}).`,
        code: 'SF422',
      });
      return;
    }

    resItem.tableId = selectedTables[0].id;
    resItem.tableNumber = selectedTables[0].number;
    resItem.tableIds = selectedTables.map((t) => t.id);
    resItem.tableNumbers = selectedTables.map((t) => t.number);

    recomputeDemoTableAvailability([...new Set([...oldIds, ...tableIds])]);

    await recordAuditAndAlert({
      actor: req.user!,
      action: 'reservation.tables_reassigned',
      entity: 'reservation',
      entityId: resItem.id,
      oldValues: { tableIds: oldIds },
      newValues: { tableIds },
      reason: String(reason).trim(),
      relatedReservationId: resItem.id,
    });

    res.json({ id: resItem.id, previousTableIds: oldIds, tableIds });
  });

  // Sentar reserva (check-in): confirmed -> seated + crea table_sessions por mesa
  app.post('/api/reservations/:id/seat', authenticate, async (req: AuthorizedRequest, res: Response) => {
    const { id } = req.params;
    const { expectedDurationMinutes, notes } = req.body || {};

    const expDur = expectedDurationMinutes !== undefined && expectedDurationMinutes !== null && expectedDurationMinutes !== ''
      ? parseInt(expectedDurationMinutes, 10)
      : null;
    if (expDur !== null && (isNaN(expDur) || expDur < 15 || expDur > 480)) {
      res.status(400).json({ message: 'La duración esperada debe estar entre 15 y 480 minutos.' });
      return;
    }

    if (isLiveSupabaseConfigured && supabaseAdmin) {
      const p_idempotency_key = extractIdempotencyKey(req);
      const p_request_hash = computeRequestHash({
        op: 'seat_reservation',
        id,
        expectedDurationMinutes: expDur,
        notes: notes ? String(notes).trim() : null,
      });

      const { data: txData, error: txError } = await supabaseAdmin.rpc('seat_reservation_tx', {
        p_reservation_id: id,
        p_expected_duration_minutes: expDur,
        p_notes: notes ? String(notes).trim() : null,
        p_actor_id: req.user!.id,
        p_idempotency_key,
        p_request_hash,
      });

      if (txError) {
        const mapped = mapRpcErrorToHttp(txError);
        res.status(mapped.status).json({ message: mapped.message, code: mapped.code });
        return;
      }

      res.json(txData);
      return;
    }

    const resItem = demoReservationsStore.find((r) => r.id === id);
    if (!resItem) {
      res.status(404).json({ message: 'Reserva no encontrada.' });
      return;
    }
    if (resItem.status !== 'confirmed') {
      res.status(409).json({ message: `Solo se pueden sentar reservas en estado confirmed (actual: ${resItem.status}).` });
      return;
    }

    const assignedIds = resItem.tableIds && resItem.tableIds.length > 0 ? resItem.tableIds : [resItem.tableId];
    for (const tid of assignedIds) {
      const tbl = demoTablesStore.find((t) => t.id === tid);
      if (!tbl || !tbl.isActive || tbl.status === 'out_of_service' || tbl.status === 'occupied') {
        res.status(409).json({ message: 'Una o más mesas asignadas están fuera de servicio o ya ocupadas.' });
        return;
      }
      if (demoTableSessionsStore.some((s) => s.tableId === tid && !s.endedAt)) {
        res.status(409).json({ message: 'Una o más mesas asignadas ya tienen una sesión abierta.' });
        return;
      }
    }

    const now = new Date();
    const dur = expDur ?? resItem.durationMinutes ?? demoOperationalSettings.defaultReservationDurationMinutes;
    const estEnd = new Date(now.getTime() + dur * 60000);
    const sessionIds: string[] = [];

    for (const tid of assignedIds) {
      const sessId = `sess-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      demoTableSessionsStore.push({
        id: sessId,
        tableId: tid,
        reservationId: resItem.id,
        sessionType: 'reservation',
        guestsCount: resItem.guestsCount,
        startedAt: now.toISOString(),
        expectedDurationMinutes: dur,
        estimatedEndAt: estEnd.toISOString(),
        endedAt: null,
        closeReason: null,
        notes: notes ? String(notes).trim() : null,
      });
      sessionIds.push(sessId);
      const tbl = demoTablesStore.find((t) => t.id === tid);
      if (tbl) tbl.serverName = req.user!.name;
    }

    resItem.status = 'seated';
    resItem.seatedAt = now.toISOString();
    recomputeDemoTableAvailability(assignedIds);

    await recordAuditAndAlert({
      actor: req.user!,
      action: 'reservation.seated',
      entity: 'reservation',
      entityId: resItem.id,
      oldValues: { status: 'confirmed' },
      newValues: { status: 'seated', seatedAt: resItem.seatedAt, sessionIds },
      reason: 'Check-in y apertura de sesión de reserva',
      relatedTableId: assignedIds[0],
      relatedReservationId: resItem.id,
    });

    res.json({
      id: resItem.id,
      status: 'seated',
      seatedAt: resItem.seatedAt,
      tableIds: assignedIds,
      sessionIds,
      estimatedEndAt: estEnd.toISOString(),
    });
  });

  // Marcar ausencia (no_show): confirmed -> no_show
  app.post('/api/reservations/:id/no-show', authenticate, async (req: AuthorizedRequest, res: Response) => {
    const { id } = req.params;
    const { reason = 'Ausencia del cliente (no-show)' } = req.body || {};

    if (isLiveSupabaseConfigured && supabaseAdmin) {
      const p_idempotency_key = extractIdempotencyKey(req);
      const p_request_hash = computeRequestHash({
        op: 'no_show_reservation',
        id,
        reason: String(reason).trim(),
      });

      const { data: txData, error: txError } = await supabaseAdmin.rpc('no_show_reservation_tx', {
        p_reservation_id: id,
        p_reason: String(reason).trim(),
        p_actor_id: req.user!.id,
        p_idempotency_key,
        p_request_hash,
      });

      if (txError) {
        const mapped = mapRpcErrorToHttp(txError);
        res.status(mapped.status).json({ message: mapped.message, code: mapped.code });
        return;
      }

      res.json(txData);
      return;
    }

    const resItem = demoReservationsStore.find((r) => r.id === id);
    if (!resItem) {
      res.status(404).json({ message: 'Reserva no encontrada.' });
      return;
    }
    if (resItem.status !== 'confirmed') {
      res.status(409).json({ message: `Solo reservas confirmed pueden marcarse como no_show (actual: ${resItem.status}).` });
      return;
    }

    resItem.status = 'no_show';
    resItem.noShowAt = new Date().toISOString();
    resItem.cancellationReason = String(reason).trim();

    const assignedIds = resItem.tableIds || [resItem.tableId];
    recomputeDemoTableAvailability(assignedIds);

    await recordAuditAndAlert({
      actor: req.user!,
      action: 'reservation.no_show',
      entity: 'reservation',
      entityId: resItem.id,
      oldValues: { status: 'confirmed' },
      newValues: { status: 'no_show', noShowAt: resItem.noShowAt },
      reason: String(reason).trim(),
      relatedReservationId: resItem.id,
    });

    res.json({ id: resItem.id, status: 'no_show', noShowAt: resItem.noShowAt });
  });

  // Finalizar servicio de reserva: seated -> completed + cierra sesiones 1:1
  app.post('/api/reservations/:id/complete-service', authenticate, async (req: AuthorizedRequest, res: Response) => {
    const { id } = req.params;
    const { notes } = req.body || {};

    if (isLiveSupabaseConfigured && supabaseAdmin) {
      const p_idempotency_key = extractIdempotencyKey(req);
      const p_request_hash = computeRequestHash({
        op: 'complete_service',
        id,
        notes: notes ? String(notes).trim() : null,
      });

      const { data: txData, error: txError } = await supabaseAdmin.rpc('complete_service_tx', {
        p_reservation_id: id,
        p_notes: notes ? String(notes).trim() : null,
        p_actor_id: req.user!.id,
        p_idempotency_key,
        p_request_hash,
      });

      if (txError) {
        const mapped = mapRpcErrorToHttp(txError);
        res.status(mapped.status).json({ message: mapped.message, code: mapped.code });
        return;
      }

      res.json(txData);
      return;
    }

    const resItem = demoReservationsStore.find((r) => r.id === id);
    if (!resItem) {
      res.status(404).json({ message: 'Reserva no encontrada.' });
      return;
    }
    if (resItem.status !== 'seated') {
      res.status(409).json({ message: `Solo reservas en estado seated pueden finalizar servicio (actual: ${resItem.status}).` });
      return;
    }

    const expectedIds = [...(resItem.tableIds || [resItem.tableId])].sort();
    const openSessions = demoTableSessionsStore.filter(
      (s) => s.reservationId === resItem.id && s.sessionType === 'reservation' && !s.endedAt
    );
    const openTableIds = openSessions.map((s) => s.tableId).sort();
    if (JSON.stringify(expectedIds) !== JSON.stringify(openTableIds)) {
      res.status(500).json({ message: 'Inconsistencia crítica: las mesas asignadas no coinciden 1-a-1 con las sesiones abiertas.' });
      return;
    }

    const now = new Date().toISOString();
    resItem.status = 'completed';
    resItem.completedAt = now;
    const closedSessionIds: string[] = [];
    for (const s of openSessions) {
      s.endedAt = now;
      s.closeReason = 'service_completed';
      if (notes) s.notes = String(notes).trim();
      closedSessionIds.push(s.id);
    }

    recomputeDemoTableAvailability(expectedIds);

    await recordAuditAndAlert({
      actor: req.user!,
      action: 'reservation.service_completed',
      entity: 'reservation',
      entityId: resItem.id,
      oldValues: { status: 'seated' },
      newValues: { status: 'completed', completedAt: now, closedSessionIds },
      reason: notes ? String(notes).trim() : 'Finalización de servicio y liberación de mesas',
      relatedTableId: expectedIds[0],
      relatedReservationId: resItem.id,
    });

    res.json({
      id: resItem.id,
      status: 'completed',
      completedAt: now,
      closedSessionIds,
      tableIds: expectedIds,
    });
  });

  // Cancelar reserva via cancel_reservation_tx (confirmed o seated)
  app.post('/api/reservations/:id/cancel', authenticate, async (req: AuthorizedRequest, res: Response) => {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason || typeof reason !== 'string' || reason.trim().length < 4) {
      res.status(400).json({ message: 'Debe ingresar el motivo de cancelación de la reserva (mínimo 4 caracteres).' });
      return;
    }

    if (isLiveSupabaseConfigured && supabaseAdmin) {
      try {
        const p_idempotency_key = extractIdempotencyKey(req);
        const p_request_hash = computeRequestHash({
          op: 'cancel_reservation',
          id,
          reason: reason.trim(),
        });

        const { data: txData, error: txError } = await supabaseAdmin.rpc('cancel_reservation_tx', {
          p_reservation_id: id,
          p_reason: reason.trim(),
          p_actor_id: req.user!.id,
          p_idempotency_key,
          p_request_hash,
        });

        if (txError) {
          const mapped = mapRpcErrorToHttp(txError);
          res.status(mapped.status).json({ message: mapped.message, code: mapped.code });
          return;
        }

        res.json({ message: 'Reserva cancelada correctamente en PostgreSQL.', reservation: txData });
        return;
      } catch (err: any) {
        res.status(500).json({ message: `Error de servidor en PostgreSQL: ${err.message || String(err)}` });
        return;
      }
    }

    const resItem = demoReservationsStore.find((r) => r.id === id);
    if (!resItem) {
      res.status(404).json({ message: 'Reserva no encontrada.' });
      return;
    }
    if (resItem.status !== 'confirmed' && resItem.status !== 'seated') {
      res.status(409).json({
        message: `Solo pueden cancelarse reservas en estado confirmed o seated (estado actual: ${resItem.status}).`,
        code: 'SF409',
      });
      return;
    }

    const oldStatus = resItem.status;
    resItem.status = 'cancelled';
    resItem.cancellationReason = reason.trim();

    if (oldStatus === 'seated') {
      const now = new Date().toISOString();
      for (const s of demoTableSessionsStore) {
        if (s.reservationId === resItem.id && s.sessionType === 'reservation' && !s.endedAt) {
          s.endedAt = now;
          s.closeReason = 'reservation_cancelled';
        }
      }
    }

    const assignedIds = resItem.tableIds || [resItem.tableId];
    recomputeDemoTableAvailability(assignedIds);

    await recordAuditAndAlert({
      actor: req.user!,
      action: 'reservation.cancelled',
      entity: 'reservation',
      entityId: resItem.id,
      oldValues: { status: oldStatus, tableId: resItem.tableId },
      newValues: { status: 'cancelled' },
      reason: reason.trim(),
      relatedTableId: resItem.tableId,
      relatedReservationId: resItem.id,
      alertTitle: `Cancelación de reserva: ${resItem.customerName} (Mesa ${resItem.tableNumber})`,
      severity: 'warning',
    });

    res.json({ message: 'Reserva cancelada correctamente.', reservation: resItem });
  });

  // Crear nueva reserva con soporte de múltiples mesas y zona horaria via create_reservation_with_tables_tx
  app.post('/api/reservations', authenticate, async (req: AuthorizedRequest, res: Response) => {
    const {
      customerName,
      customerPhone,
      customerEmail,
      guestsCount,
      startTime,
      durationMinutes,
      tableIds,
      notes,
    } = req.body;

    if (!customerName || typeof customerName !== 'string' || customerName.trim().length < 2) {
      res.status(400).json({ message: 'El nombre del cliente debe tener al menos 2 caracteres.' });
      return;
    }

    const guests = parseInt(guestsCount, 10);
    if (isNaN(guests) || guests < 1 || guests > 50) {
      res.status(400).json({ message: 'La cantidad de comensales debe estar entre 1 y 50.' });
      return;
    }

    let duration: number | null = null;
    if (durationMinutes !== undefined && durationMinutes !== null && durationMinutes !== '') {
      duration = parseInt(durationMinutes, 10);
      if (isNaN(duration) || duration < 30 || duration > 360) {
        res.status(400).json({ message: 'La duración debe estar entre 30 y 360 minutos.' });
        return;
      }
    }

    if (!Array.isArray(tableIds) || tableIds.length === 0) {
      res.status(400).json({ message: 'Debe seleccionar al menos una mesa para la reserva.' });
      return;
    }

    const parsedStart = new Date(startTime);
    if (isNaN(parsedStart.getTime())) {
      res.status(400).json({ message: 'Fecha y hora de inicio no válidas.' });
      return;
    }

    if (isLiveSupabaseConfigured && supabaseAdmin) {
      try {
        const p_idempotency_key = extractIdempotencyKey(req);
        const cleanName = customerName.trim();
        const cleanPhone = customerPhone ? String(customerPhone).trim() : null;
        const cleanEmail = customerEmail ? String(customerEmail).trim() : null;
        const cleanNotes = notes ? String(notes).trim() : null;
        const isoStart = parsedStart.toISOString();

        const p_request_hash = computeRequestHash({
          op: 'create_reservation',
          customerName: cleanName,
          customerPhone: cleanPhone,
          customerEmail: cleanEmail,
          guestsCount: guests,
          startTime: isoStart,
          durationMinutes: duration,
          tableIds,
          notes: cleanNotes,
        });

        const { data: txData, error: txError } = await supabaseAdmin.rpc('create_reservation_with_tables_tx', {
          p_customer_name: cleanName,
          p_customer_phone: cleanPhone,
          p_customer_email: cleanEmail,
          p_guests_count: guests,
          p_start_time: isoStart,
          p_duration_minutes: duration,
          p_table_ids: tableIds,
          p_notes: cleanNotes,
          p_created_by: req.user!.id,
          p_idempotency_key,
          p_request_hash,
        });

        if (txError) {
          const mapped = mapRpcErrorToHttp(txError);
          res.status(mapped.status).json({ message: mapped.message, code: mapped.code });
          return;
        }

        const { data: tblMeta } = await supabaseAdmin
          .from('tables')
          .select('id, number')
          .in('id', tableIds)
          .order('number', { ascending: true });

        res.status(201).json({
          ...txData,
          tableId: tblMeta?.[0]?.id || tableIds[0],
          tableNumber: tblMeta?.[0]?.number || 0,
          tableNumbers: (tblMeta || []).map((t) => t.number),
          time: parsedStart.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
        });
        return;
      } catch (err: any) {
        res.status(500).json({ message: `Error de servidor en PostgreSQL: ${err.message || String(err)}` });
        return;
      }
    }

    // Modo Demo Aislado
    const selectedTables = demoTablesStore.filter((t) => tableIds.includes(t.id));
    if (selectedTables.length !== tableIds.length) {
      res.status(404).json({ message: 'Una o más mesas especificadas no existen.' });
      return;
    }

    const disabledTable = selectedTables.find((t) => !t.isActive || t.status === 'out_of_service');
    if (disabledTable) {
      res.status(409).json({ message: `La mesa ${disabledTable.number} se encuentra inactiva o fuera de servicio.` });
      return;
    }

    const totalCapacity = selectedTables.reduce((acc, t) => acc + t.capacity, 0);
    if (totalCapacity < guests) {
      res.status(409).json({
        message: `La capacidad combinada de las mesas (${totalCapacity}) es insuficiente para ${guests} comensales.`,
      });
      return;
    }

    const effectiveDur = duration ?? demoOperationalSettings.defaultReservationDurationMinutes;
    const bufferMs = demoOperationalSettings.reservationBufferMinutes * 60000;
    const newStartMs = parsedStart.getTime();
    const newEndMs = newStartMs + effectiveDur * 60000;

    // Verificar solapamiento con sesiones abiertas y reservas demo existentes con startTime
    for (const s of demoTableSessionsStore) {
      if (!s.endedAt && tableIds.includes(s.tableId)) {
        const sStart = new Date(s.startedAt).getTime();
        const sEstEnd = new Date(s.estimatedEndAt).getTime() + bufferMs;
        if (sStart < newEndMs && sEstEnd > newStartMs) {
          res.status(409).json({
            message: 'Conflicto de asignación: una o más mesas tienen una sesión abierta cuya ventana estimada se solapa con la reserva.',
          });
          return;
        }
      }
    }

    for (const existingRes of demoReservationsStore) {
      if ((existingRes.status === 'confirmed' || existingRes.status === 'seated') && existingRes.startTime) {
        const rIds = existingRes.tableIds || [existingRes.tableId];
        if (rIds.some((tid) => tableIds.includes(tid))) {
          const rStart = new Date(existingRes.startTime).getTime() - bufferMs;
          const rEnd = new Date(existingRes.endTime || new Date(new Date(existingRes.startTime).getTime() + (existingRes.durationMinutes || 120) * 60000)).getTime() + bufferMs;
          if (rStart < newEndMs && rEnd > newStartMs) {
            res.status(409).json({
              message: 'Conflicto de asignación: una o más mesas tienen reservas activas (incluyendo buffer) en esa franja.',
            });
            return;
          }
        }
      }
    }

    const newRes: Reservation = {
      id: `res-${Date.now()}`,
      tableId: selectedTables[0].id,
      tableNumber: selectedTables[0].number,
      customerName: customerName.trim(),
      customerPhone: customerPhone ? String(customerPhone).trim() : null,
      customerEmail: customerEmail ? String(customerEmail).trim() : null,
      guestsCount: guests,
      time: parsedStart.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
      startTime: parsedStart.toISOString(),
      endTime: new Date(newEndMs).toISOString(),
      durationMinutes: effectiveDur,
      status: 'confirmed',
      notes: notes || '',
      tableIds: selectedTables.map((t) => t.id),
      tableNumbers: selectedTables.map((t) => t.number),
    };

    demoReservationsStore.push(newRes);
    recomputeDemoTableAvailability(tableIds);

    await recordAuditAndAlert({
      actor: req.user!,
      action: 'reservation.created',
      entity: 'reservation',
      entityId: newRes.id,
      oldValues: null,
      newValues: { customerName: newRes.customerName, guestsCount: newRes.guestsCount, tableIds },
      reason: 'Reserva creada en salón',
      relatedTableId: selectedTables[0].id,
      relatedReservationId: newRes.id,
      alertTitle: `Nueva reserva: ${newRes.customerName} (${guests} comensales - Mesa ${selectedTables.map((t) => t.number).join(', ')})`,
      severity: 'info',
    });

    res.status(201).json(newRes);
  });

  // -----------------------------------------------------------------------
  // Gestión de Usuarios y Saga Auth (Exclusivo Super Admin)
  // -----------------------------------------------------------------------
  app.get('/api/users', authenticate, requireSuperAdmin, async (req: AuthorizedRequest, res: Response) => {
    if (isLiveSupabaseConfigured && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from('profiles')
        .select('id, first_name, last_name, email, role, status, created_at')
        .order('created_at', { ascending: true });

      if (error) {
        res.status(500).json({ message: `Error al consultar perfiles en PostgreSQL: ${error.message}` });
        return;
      }

      res.json((data || []).map(mapLiveProfile));
      return;
    }

    res.json(demoUsersStore);
  });

  app.get('/api/users/auth-operations', authenticate, requireSuperAdmin, async (req: AuthorizedRequest, res: Response) => {
    if (isLiveSupabaseConfigured && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from('user_auth_operations')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
        res.status(500).json({ message: `Error al consultar operaciones Auth: ${error.message}` });
        return;
      }

      res.json((data || []).map(mapLiveAuthOp));
      return;
    }

    res.json(demoAuthOperationsStore);
  });

  app.post('/api/users/auth-operations/:id/reconcile', authenticate, requireSuperAdmin, async (req: AuthorizedRequest, res: Response) => {
    const { id } = req.params;
    const {
      outcome: rawOutcome,
      targetUserId: bodyTargetUserId,
      evidence: bodyEvidence,
      reason = 'Reconciliación manual de operación Auth',
      autoVerify = false,
    } = req.body || {};

    if (typeof reason !== 'string' || reason.trim().length < 5) {
      res.status(400).json({ message: 'Debe documentar el motivo de reconciliación (mínimo 5 caracteres).' });
      return;
    }

    if (isLiveSupabaseConfigured && supabaseAdmin) {
      const { data: opRow, error: opErr } = await supabaseAdmin
        .from('user_auth_operations')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (opErr) {
        res.status(500).json({ message: `Error al consultar operación Auth: ${opErr.message}` });
        return;
      }
      if (!opRow) {
        res.status(404).json({ message: 'Operación Auth no encontrada.' });
        return;
      }

      let outcome = rawOutcome as string | undefined;
      let targetUserId: string | null = bodyTargetUserId || opRow.target_user_id || null;
      const evidence: Record<string, unknown> = { ...(bodyEvidence || {}) };

      if (autoVerify && opRow.operation_type === 'invite_user') {
        const { data: listData, error: listErr } = await supabaseAdmin.auth.admin.listUsers({
          page: 1,
          perPage: 1000,
        });
        if (listErr) {
          res.status(502).json({ message: `No se pudo consultar GoTrue para verificar la invitación: ${listErr.message}` });
          return;
        }
        const matched = (listData?.users || []).find(
          (u) => (u.email || '').toLowerCase() === opRow.target_email.toLowerCase()
        );
        if (!matched) {
          outcome = outcome || 'failed';
          evidence.authUserExists = false;
        } else {
          const meta = matched.user_metadata || {};
          const corrMatches =
            meta.sofia_invite_op_id === opRow.id ||
            meta.sofia_correlation_id === opRow.correlation_id;
          if (corrMatches) {
            targetUserId = matched.id;
            outcome = 'completed';
            evidence.matchedOperationId = opRow.id;
            evidence.matchedCorrelationId = opRow.correlation_id;
          } else {
            // Regla estricta: correo encontrado sin correlation_id verificado -> NO asumir que fue esta operación
            outcome = 'needs_reconciliation';
            evidence.ambiguousEmailMatch = true;
            evidence.foundUserId = matched.id;
          }
        }
      }

      if (!outcome || !['completed', 'failed', 'needs_reconciliation'].includes(outcome)) {
        res.status(400).json({ message: 'Resultado de reconciliación inválido (completed, failed o needs_reconciliation).' });
        return;
      }

      const p_idempotency_key = extractIdempotencyKey(req);
      const p_request_hash = computeRequestHash({
        op: 'reconcile_user_auth_operation',
        id,
        outcome,
        targetUserId,
        evidence,
        reason: reason.trim(),
      });

      const { data: txData, error: txError } = await supabaseAdmin.rpc('reconcile_user_auth_operation_tx', {
        p_operation_id: id,
        p_outcome: outcome,
        p_target_user_id: targetUserId,
        p_evidence: evidence,
        p_reason: reason.trim(),
        p_actor_id: req.user!.id,
        p_idempotency_key,
        p_request_hash,
      });

      if (txError) {
        const mapped = mapRpcErrorToHttp(txError);
        res.status(mapped.status).json({ message: mapped.message, code: mapped.code });
        return;
      }

      res.json(txData);
      return;
    }

    // Modo Demo
    const op = demoAuthOperationsStore.find((o) => o.id === id);
    if (!op) {
      res.status(404).json({ message: 'Operación Auth no encontrada.' });
      return;
    }
    const outcome = rawOutcome || 'failed';
    if (!['completed', 'failed', 'needs_reconciliation'].includes(outcome)) {
      res.status(400).json({ message: 'Resultado de reconciliación inválido.' });
      return;
    }
    op.state = outcome;
    op.reconciledAt = new Date().toISOString();
    op.reconciledBy = req.user!.id;
    op.updatedAt = op.reconciledAt;
    res.json(op);
  });

  app.post('/api/users', authenticate, requireSuperAdmin, async (req: AuthorizedRequest, res: Response) => {
    const { firstName, lastName, email } = req.body;
    if (!email || typeof email !== 'string') {
      res.status(400).json({ message: 'El correo electrónico es requerido.' });
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanFirst = typeof firstName === 'string' ? firstName.trim() : '';
    const cleanLast = typeof lastName === 'string' ? lastName.trim() : '';

    if (isLiveSupabaseConfigured && supabaseAdmin) {
      const baseKey = extractIdempotencyKey(req);
      const beginHash = computeRequestHash({
        op: 'invite_user',
        email: cleanEmail,
        firstName: cleanFirst,
        lastName: cleanLast,
      });

      // Fase 1 Saga: Registrar operación Auth pendiente + correlation_id antes de llamar a GoTrue
      const { data: beginData, error: beginErr } = await supabaseAdmin.rpc('begin_user_auth_operation_tx', {
        p_operation_type: 'invite_user',
        p_target_email: cleanEmail,
        p_reason: 'Invitación de nuevo administrador operativo',
        p_actor_id: req.user!.id,
        p_idempotency_key: deriveSagaStepKey(baseKey, 'begin'),
        p_request_hash: beginHash,
      });

      if (beginErr || !beginData) {
        const mapped = mapRpcErrorToHttp(beginErr);
        res.status(mapped.status).json({ message: mapped.message, code: mapped.code });
        return;
      }

      const operationId = beginData.operationId as string;
      const correlationId = beginData.correlationId as string;

      // Si ya venía completada por replay de idempotencia y es completed, devolver perfil existente
      if (beginData.state === 'completed') {
        const { data: existingProf } = await supabaseAdmin
          .from('profiles')
          .select('id, first_name, last_name, email, role, status, created_at')
          .eq('email', cleanEmail)
          .maybeSingle();
        if (existingProf) {
          res.status(201).json({ user: mapLiveProfile(existingProf), invitationSent: true, operationId, state: 'completed' });
          return;
        }
      }

      // Fase 2 Saga: Marcar despacho antes de invocar a GoTrue (solo si sigue en pending_auth)
      if (beginData.state === 'pending_auth') {
        const { error: dispErr } = await supabaseAdmin.rpc('mark_user_auth_dispatched_tx', {
          p_operation_id: operationId,
          p_actor_id: req.user!.id,
          p_idempotency_key: deriveSagaStepKey(baseKey, 'dispatch'),
          p_request_hash: computeRequestHash({ op: 'mark_dispatch', operationId }),
        });

        if (dispErr) {
          const mapped = mapRpcErrorToHttp(dispErr);
          res.status(mapped.status).json({ message: mapped.message, code: mapped.code });
          return;
        }
      }

      // Fase 3 Saga: Invocar GoTrue Admin API con token de correlación en raw_user_meta_data
      let invitedUserId: string | null = null;
      let goTrueError: { message: string; status?: number } | null = null;
      let ambiguousFailure = false;

      try {
        const { data: inviteData, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(cleanEmail, {
          data: {
            first_name: cleanFirst || null,
            last_name: cleanLast || null,
            sofia_invite_op_id: operationId,
            sofia_correlation_id: correlationId,
          },
        });
        if (inviteErr) {
          goTrueError = { message: inviteErr.message, status: (inviteErr as any).status };
          ambiguousFailure = !goTrueError.status || goTrueError.status >= 500;
        } else {
          invitedUserId = inviteData?.user?.id || null;
        }
      } catch (err: any) {
        goTrueError = { message: err?.message || 'Error de red o timeout al contactar GoTrue' };
        ambiguousFailure = true;
      }

      if (goTrueError || !invitedUserId) {
        const errMsg = goTrueError?.message || 'GoTrue no devolvió ID de usuario tras la invitación';
        const needsReconciliation = ambiguousFailure || !invitedUserId;

        await supabaseAdmin.rpc('fail_user_auth_operation_tx', {
          p_operation_id: operationId,
          p_error_message: errMsg,
          p_needs_reconciliation: needsReconciliation,
          p_actor_id: req.user!.id,
          p_idempotency_key: deriveSagaStepKey(baseKey, 'fail'),
          p_request_hash: computeRequestHash({ op: 'fail_auth', operationId, errMsg, needsReconciliation }),
        });

        res.status(502).json({
          message: needsReconciliation
            ? `No se pudo confirmar la respuesta de Supabase Auth (${errMsg}). La operación quedó marcada para reconciliación manual sin reenviar automáticamente.`
            : `Supabase Auth rechazó la invitación: ${errMsg}`,
          operationId,
          state: needsReconciliation ? 'needs_reconciliation' : 'failed',
          needsReconciliation,
        });
        return;
      }

      // Fase 4 Saga: Completar operación y enlazar invited_operation_id en profile
      const { error: compErr } = await supabaseAdmin.rpc('complete_user_auth_operation_tx', {
        p_operation_id: operationId,
        p_target_user_id: invitedUserId,
        p_first_name: cleanFirst || null,
        p_last_name: cleanLast || null,
        p_reason: 'Invitación enviada por Supabase Auth y correlacionada',
        p_actor_id: req.user!.id,
        p_idempotency_key: deriveSagaStepKey(baseKey, 'complete'),
        p_request_hash: computeRequestHash({ op: 'complete_auth', operationId, invitedUserId }),
      });

      if (compErr) {
        const mapped = mapRpcErrorToHttp(compErr);
        res.status(mapped.status).json({ message: mapped.message, code: mapped.code, operationId });
        return;
      }

      const { data: createdProfile, error: profFetchErr } = await supabaseAdmin
        .from('profiles')
        .select('id, first_name, last_name, email, role, status, created_at')
        .eq('id', invitedUserId)
        .single();

      if (profFetchErr || !createdProfile) {
        res.status(201).json({
          user: {
            id: invitedUserId,
            firstName: cleanFirst || null,
            lastName: cleanLast || null,
            email: cleanEmail,
            role: 'operational_admin',
            status: 'inactive',
            createdAt: new Date().toISOString(),
          },
          invitationSent: true,
          operationId,
          state: 'completed',
        });
        return;
      }

      res.status(201).json({
        user: mapLiveProfile(createdProfile),
        invitationSent: true,
        operationId,
        state: 'completed',
      });
      return;
    }

    // Modo Demo
    const existing = demoUsersStore.find((u) => u.email === cleanEmail);
    if (existing) {
      res.status(409).json({ message: 'Ya existe una cuenta con ese correo.' });
      return;
    }

    const newUser: ManagedUser = {
      id: crypto.randomUUID ? crypto.randomUUID() : `usr-${Date.now()}`,
      firstName: cleanFirst || null,
      lastName: cleanLast || null,
      email: cleanEmail,
      role: 'operational_admin',
      status: 'inactive',
      createdAt: new Date().toISOString(),
    };

    demoUsersStore.push(newUser);

    await recordAuditAndAlert({
      actor: req.user!,
      action: 'user.invited',
      entity: 'profile',
      entityId: newUser.id,
      oldValues: null,
      newValues: { email: cleanEmail, role: newUser.role, status: 'inactive' },
      reason: 'Invitación de nuevo administrador',
      alertTitle: `Nuevo usuario invitado: ${cleanEmail} (${newUser.role})`,
      severity: 'info',
    });

    res.status(201).json({ user: newUser, invitationSent: true });
  });

  app.patch('/api/users/:id/status', authenticate, requireSuperAdmin, async (req: AuthorizedRequest, res: Response) => {
    const { id } = req.params;
    const { status, reason = 'Actualización administrativa de estado de cuenta' } = req.body;

    if (status !== 'active' && status !== 'inactive') {
      res.status(400).json({ message: 'Estado de usuario inválido (active o inactive).' });
      return;
    }

    if (isLiveSupabaseConfigured && supabaseAdmin) {
      const p_idempotency_key = extractIdempotencyKey(req);
      const p_request_hash = computeRequestHash({
        op: 'set_user_profile_status',
        id,
        status,
        reason: String(reason).trim(),
      });

      const { data: txData, error: txError } = await supabaseAdmin.rpc('set_user_profile_status_tx', {
        p_target_user_id: id,
        p_status: status,
        p_reason: String(reason).trim(),
        p_actor_id: req.user!.id,
        p_idempotency_key,
        p_request_hash,
      });

      if (txError) {
        const mapped = mapRpcErrorToHttp(txError);
        res.status(mapped.status).json({ message: mapped.message, code: mapped.code });
        return;
      }

      // Sincronización best-effort con GoTrue ban_duration (el perfil DB es autoritativo)
      try {
        await supabaseAdmin.auth.admin.updateUserById(id, {
          ban_duration: status === 'inactive' ? '876000h' : 'none',
        });
      } catch {
        // La denegación de acceso queda garantizada igualmente por profiles.status en authenticate() y RLS
      }

      res.json(txData);
      return;
    }

    const user = demoUsersStore.find((u) => u.id === id);
    if (!user) {
      res.status(404).json({ message: 'No se encontró esa cuenta.' });
      return;
    }

    if (user.role === 'super_admin' && status === 'inactive') {
      res.status(409).json({
        message: 'Transferí primero el rol principal a una cuenta activa antes de desactivar.',
      });
      return;
    }

    const oldStatus = user.status;
    user.status = status;

    await recordAuditAndAlert({
      actor: req.user!,
      action: status === 'active' ? 'user.activated' : 'user.deactivated',
      entity: 'profile',
      entityId: user.id,
      oldValues: { status: oldStatus },
      newValues: { status: user.status },
      reason: String(reason).trim(),
      alertTitle: status === 'inactive' ? `Acceso revocado para ${user.email}` : undefined,
      severity: 'warning',
    });

    res.json(user);
  });

  app.patch('/api/users/:id/role', authenticate, requireSuperAdmin, async (req: AuthorizedRequest, res: Response) => {
    const { id } = req.params;
    const { role, reason = 'Transferencia de titularidad de Administrador Principal' } = req.body;

    if (isLiveSupabaseConfigured && supabaseAdmin) {
      const p_idempotency_key = extractIdempotencyKey(req);
      const p_request_hash = computeRequestHash({
        op: 'transfer_user_profile_role',
        id,
        role: role === 'super_admin' ? 'super_admin' : 'operational_admin',
        reason: String(reason).trim(),
      });

      const { data: txData, error: txError } = await supabaseAdmin.rpc('transfer_user_profile_role_tx', {
        p_target_user_id: id,
        p_new_role: role === 'super_admin' ? 'super_admin' : 'operational_admin',
        p_reason: String(reason).trim(),
        p_actor_id: req.user!.id,
        p_idempotency_key,
        p_request_hash,
      });

      if (txError) {
        const mapped = mapRpcErrorToHttp(txError);
        res.status(mapped.status).json({ message: mapped.message, code: mapped.code });
        return;
      }

      res.json({
        id,
        email: txData?.newSuperAdminEmail,
        role: 'super_admin',
        currentUserDemoted: true,
        ...txData,
      });
      return;
    }

    const user = demoUsersStore.find((u) => u.id === id);
    if (!user) {
      res.status(404).json({ message: 'No se encontró esa cuenta.' });
      return;
    }

    if (user.status !== 'active') {
      res.status(409).json({
        message: 'Solo se puede transferir o asignar roles a una cuenta activa.',
      });
      return;
    }

    let currentUserDemoted = false;
    const oldRole = user.role;

    if (role === 'super_admin') {
      demoUsersStore.forEach((u) => {
        if (u.role === 'super_admin' && u.id !== id) {
          u.role = 'operational_admin';
          currentUserDemoted = true;
        }
      });
      user.role = 'super_admin';
    } else {
      user.role = 'operational_admin';
    }

    await recordAuditAndAlert({
      actor: req.user!,
      action: 'user.super_admin_transferred',
      entity: 'profile',
      entityId: user.id,
      oldValues: { role: oldRole },
      newValues: { role: user.role },
      reason: String(reason).trim(),
      alertTitle: `Transferencia de titularidad Super Admin hacia ${user.email}`,
      severity: 'critical',
    });

    res.json({ ...user, currentUserDemoted });
  });

  app.post('/api/users/:id/reset-password', authenticate, requireSuperAdmin, async (req: AuthorizedRequest, res: Response) => {
    const { id } = req.params;

    if (isLiveSupabaseConfigured && supabaseAdmin) {
      const { data: targetProfile, error: profErr } = await supabaseAdmin
        .from('profiles')
        .select('id, email, status')
        .eq('id', id)
        .maybeSingle();

      if (profErr) {
        res.status(500).json({ message: `Error al consultar perfil: ${profErr.message}` });
        return;
      }
      if (!targetProfile) {
        res.status(404).json({ message: 'No se encontró esa cuenta.' });
        return;
      }
      if (targetProfile.status !== 'active') {
        res.status(409).json({ message: 'La cuenta está desactivada; habilitala antes de restablecer el acceso.' });
        return;
      }

      const baseKey = extractIdempotencyKey(req);
      const { data: beginData, error: beginErr } = await supabaseAdmin.rpc('begin_user_auth_operation_tx', {
        p_operation_type: 'reset_password',
        p_target_email: targetProfile.email,
        p_reason: 'Solicitud de recuperación de credenciales',
        p_actor_id: req.user!.id,
        p_idempotency_key: deriveSagaStepKey(baseKey, 'begin'),
        p_request_hash: computeRequestHash({ op: 'reset_password', id, email: targetProfile.email }),
      });

      if (beginErr || !beginData) {
        const mapped = mapRpcErrorToHttp(beginErr);
        res.status(mapped.status).json({ message: mapped.message, code: mapped.code });
        return;
      }

      const operationId = beginData.operationId as string;

      if (beginData.state === 'completed') {
        res.json({ message: 'Se envió un enlace de recuperación al correo de la cuenta.', operationId, state: 'completed' });
        return;
      }

      if (beginData.state === 'pending_auth') {
        const { error: dispErr } = await supabaseAdmin.rpc('mark_user_auth_dispatched_tx', {
          p_operation_id: operationId,
          p_actor_id: req.user!.id,
          p_idempotency_key: deriveSagaStepKey(baseKey, 'dispatch'),
          p_request_hash: computeRequestHash({ op: 'mark_dispatch', operationId }),
        });

        if (dispErr) {
          const mapped = mapRpcErrorToHttp(dispErr);
          res.status(mapped.status).json({ message: mapped.message, code: mapped.code });
          return;
        }
      }

      let resetError: { message: string } | null = null;
      try {
        const { error: authResetErr } = await supabaseAdmin.auth.resetPasswordForEmail(targetProfile.email);
        if (authResetErr) {
          resetError = { message: authResetErr.message };
        }
      } catch (err: any) {
        resetError = { message: err?.message || 'Error de red o timeout en GoTrue' };
      }

      if (resetError) {
        // Regla estricta: nunca reenviar recuperación automáticamente tras fallo ambiguo
        await supabaseAdmin.rpc('fail_user_auth_operation_tx', {
          p_operation_id: operationId,
          p_error_message: resetError.message,
          p_needs_reconciliation: true,
          p_actor_id: req.user!.id,
          p_idempotency_key: deriveSagaStepKey(baseKey, 'fail'),
          p_request_hash: computeRequestHash({ op: 'fail_reset', operationId, err: resetError.message }),
        });

        res.status(502).json({
          message: `Error al despachar recuperación (${resetError.message}). La operación quedó en reconciliación manual y no se reenviará automáticamente.`,
          operationId,
          state: 'needs_reconciliation',
          needsReconciliation: true,
        });
        return;
      }

      const { error: compErr } = await supabaseAdmin.rpc('complete_user_auth_operation_tx', {
        p_operation_id: operationId,
        p_target_user_id: targetProfile.id,
        p_first_name: null,
        p_last_name: null,
        p_reason: 'Enlace de recuperación despachado por GoTrue',
        p_actor_id: req.user!.id,
        p_idempotency_key: deriveSagaStepKey(baseKey, 'complete'),
        p_request_hash: computeRequestHash({ op: 'complete_reset', operationId, targetUserId: targetProfile.id }),
      });

      if (compErr) {
        const mapped = mapRpcErrorToHttp(compErr);
        res.status(mapped.status).json({ message: mapped.message, code: mapped.code, operationId });
        return;
      }

      res.json({
        message: 'Se envió un enlace de recuperación al correo de la cuenta.',
        operationId,
        state: 'completed',
      });
      return;
    }

    const user = demoUsersStore.find((u) => u.id === id);
    if (!user) {
      res.status(404).json({ message: 'No se encontró esa cuenta.' });
      return;
    }

    if (user.status !== 'active') {
      res.status(409).json({
        message: 'La cuenta está desactivada; habilitala antes de restablecer el acceso.',
      });
      return;
    }

    await recordAuditAndAlert({
      actor: req.user!,
      action: 'user.password_reset_sent',
      entity: 'profile',
      entityId: user.id,
      oldValues: null,
      newValues: { delivery: 'email' },
      reason: 'Solicitud de recuperación de credenciales',
      alertTitle: `Recuperación de contraseña solicitada para ${user.email}`,
      severity: 'info',
    });

    res.json({ message: 'Se envió un enlace de recuperación al correo de la cuenta.' });
  });

  // -----------------------------------------------------------------------
  // Módulo de Consultas de Reservas (Exclusivo Solo Lectura - Etapa 1)
  // -----------------------------------------------------------------------
  app.use(
    '/api/reservations-query',
    createReservationsQueryRouter({
      supabaseAdmin,
      isLiveSupabaseConfigured,
      authenticate,
      demoReservationsStore,
      demoTablesStore,
      demoAuditLogsStore,
    })
  );

  // -----------------------------------------------------------------------
  // Módulo de Informes Operativos y Rotación de Salón (Solo Lectura)
  // -----------------------------------------------------------------------
  app.use(
    '/api/reports',
    createReportsRouter({
      supabaseAdmin,
      isLiveSupabaseConfigured,
      authenticate,
      demoReservationsStore,
      demoTablesStore,
      demoTableSessionsStore,
      getDemoOperationalSettings: () => ({ ...demoOperationalSettings }),
    })
  );

  app.get('/api/health', (req: Request, res: Response) => {
    res.json({
      status: 'ok',
      app: 'SOFIA',
      version: '5.0-migration5',
      authMode: isLiveSupabaseConfigured ? 'supabase_production' : 'demo_isolated',
      isLiveConfigured: isLiveSupabaseConfigured,
    });
  });

  // Servir Frontend y escuchar solo fuera de entornos serverless (como Vercel)
  async function startServer() {
    if (process.env.VERCEL) {
      return;
    }

    if (process.env.NODE_ENV === 'production') {
      app.use(express.static(path.resolve(__dirname, 'dist')));
      app.get('*', (req: Request, res: Response) => {
        res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
      });
    } else {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    }

    const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`SOFIA app running on http://0.0.0.0:${PORT} [Auth Mode: ${isLiveSupabaseConfigured ? 'SUPABASE' : 'DEMO'}]`);
    });
  }

  startServer();

  export default app;
