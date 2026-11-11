/**
 * SOFIA · Pruebas Unitarias del Módulo de Informes (Backend + Exportación CSV)
 * Archivo: src/test/unit-reports-backend.test.ts
 */

import {
  buildOperationalReport,
  createReportsRouter,
  parseReportsFilters,
} from '../server/reports.js';
import { buildReportCsvContent } from '../features/reports/reports.utils.js';

let passed = 0;
let total = 0;

function assert(condition: boolean, label: string, detail?: string) {
  total++;
  if (condition) {
    passed++;
    console.log(`✅ [PASS] ${label}`);
  } else {
    console.error(`❌ [FAIL] ${label}${detail ? ` -> ${detail}` : ''}`);
    process.exit(1);
  }
}

console.log('================================================================================');
console.log('🧪 SOFIA · PRUEBAS UNITARIAS DE INFORMES (MÉTRICAS, HORARIO BA, CSV Y C.4)');
console.log('================================================================================\n');

const sampleTables = [
  { id: 't1', number: 1, sector: 'Salón Principal', capacity: 4, maxCapacity: 6, status: 'occupied' as const, isActive: true },
  { id: 't2', number: 2, sector: 'Salón Principal', capacity: 2, maxCapacity: 2, status: 'available' as const, isActive: true },
  { id: 't3', number: 3, sector: 'Terraza', capacity: 6, maxCapacity: 8, status: 'out_of_service' as const, isActive: false },
];

// 2026-11-10T21:00:00-03:00 -> 2026-11-11T00:00:00Z (Cena, opDate 2026-11-10)
// 2026-11-11T00:30:00-03:00 -> 2026-11-11T03:30:00Z (Cena rollover, opDate 2026-11-10!)
// 2026-11-11T13:00:00-03:00 -> 2026-11-11T16:00:00Z (Almuerzo, opDate 2026-11-11)
const sampleReservations = [
  {
    id: 'r1',
    customerName: 'Mesa A',
    guestsCount: 4,
    startTime: '2026-11-11T00:00:00.000Z',
    endTime: '2026-11-11T02:00:00.000Z',
    durationMinutes: 120,
    status: 'completed' as const,
    tableIds: ['t1'],
  },
  {
    id: 'r2',
    customerName: 'Trasnoche B',
    guestsCount: 2,
    startTime: '2026-11-11T03:30:00.000Z',
    endTime: '2026-11-11T05:30:00.000Z',
    durationMinutes: 120,
    status: 'no_show' as const,
    tableIds: ['t2'],
  },
  {
    id: 'r3',
    customerName: 'Almuerzo C',
    guestsCount: 4,
    startTime: '2026-11-11T16:00:00.000Z',
    endTime: '2026-11-11T18:00:00.000Z',
    durationMinutes: 120,
    status: 'confirmed' as const,
    tableIds: ['t1', 't2'],
  },
];

const sampleSessions = [
  {
    id: 's1',
    tableId: 't1',
    reservationId: 'r1',
    sessionType: 'reservation' as const,
    guestsCount: 4,
    startedAt: '2026-11-11T00:00:00.000Z',
    expectedDurationMinutes: 120,
    estimatedEndAt: '2026-11-11T02:00:00.000Z',
    endedAt: '2026-11-11T02:30:00.000Z', // 150 min -> overrun
    closeReason: 'service_completed',
    notes: null,
  },
  {
    id: 's2',
    tableId: 't2',
    reservationId: null,
    sessionType: 'walk_in' as const,
    guestsCount: 2,
    startedAt: '2026-11-11T01:00:00.000Z', // 22:00 BA opDate 2026-11-10
    expectedDurationMinutes: 90,
    estimatedEndAt: '2026-11-11T02:30:00.000Z',
    endedAt: '2026-11-11T02:00:00.000Z', // 60 min
    closeReason: 'walk_in_closed',
    notes: 'Walk-in rápido; barra llena',
  },
];

const settings = {
  defaultReservationDurationMinutes: 120,
  defaultWalkInDurationMinutes: 90,
  reservationBufferMinutes: 15,
};

// 1. Snapshot y métricas globales
{
  const report = buildOperationalReport({
    tables: sampleTables,
    reservations: sampleReservations,
    sessions: sampleSessions,
    operationalSettings: settings,
    filters: parseReportsFilters({}),
    nowMs: new Date('2026-11-11T18:00:00.000Z').getTime(),
  });

  assert(report.floorSnapshot.activeTables === 2 && report.floorSnapshot.currentOccupancyPct === 50, 'Snapshot calcula 50% ocupación (1/2 mesas activas)');
  assert(report.reservations.total === 3 && report.reservations.completed === 1 && report.reservations.no_show === 1, 'Contabiliza ciclo de vida de reservas');
  assert(report.reservations.multiTableReservationsCount === 1, 'Detecta reserva multi-mesa');
  assert(report.sessions.totalSessions === 2 && report.sessions.walkInSessions === 1 && report.sessions.overrunSessionsCount === 1, 'Calcula sesiones walk-in, reservas y excedidas');
  assert(report.sessions.avgActualDurationMinutes === 105, `Calcula estadía promedio real (150+60)/2 = 105m (obtenido: ${report.sessions.avgActualDurationMinutes})`);
  assert(report.shifts.dinner.reservations === 2 && report.shifts.dinner.walkIns === 1, 'Agrupa 00:30 BA dentro de turno Cena');
  assert(report.dailySeries.length === 2 && report.dailySeries[0].date === '2026-11-10', 'Agrupa jornada trasnoche 00:30 BA en fecha operativa 2026-11-10');

  const csv = buildReportCsvContent(report, 'sessions');
  assert(csv.startsWith('\uFEFF') && csv.includes('"Walk-in rápido; barra llena"'), 'Exportación CSV incluye BOM UTF-8 y escapa delimitadores');
}

// 2. Filtro por fecha operativa y sector
{
  const reportDay10 = buildOperationalReport({
    tables: sampleTables,
    reservations: sampleReservations,
    sessions: sampleSessions,
    operationalSettings: settings,
    filters: parseReportsFilters({ startDate: '2026-11-10', endDate: '2026-11-10', sector: 'Salón Principal' }),
  });
  assert(reportDay10.reservations.total === 2 && reportDay10.sessions.totalSessions === 2, 'Filtro por fecha operativa 2026-11-10 y sector filtra exactamente');

  const emptyTerraza = buildOperationalReport({
    tables: sampleTables,
    reservations: sampleReservations,
    sessions: sampleSessions,
    operationalSettings: settings,
    filters: parseReportsFilters({ sector: 'Terraza' }),
  });
  assert(emptyTerraza.reservations.total === 0 && emptyTerraza.floorSnapshot.totalTables === 1, 'Sector sin reservas retorna 0 servicios manteniendo inventario de mesas');
}

// 3. Condición C.4: Live mode sin fallback demo ante error DB
async function testLiveNonFallbackAndAuth() {
  const errResult = { data: null, error: { message: 'DB timeout' } };
  const makeThenable = () => {
    const p = Promise.resolve(errResult);
    return Object.assign(p, {
      order: () => makeThenable(),
      eq: () => ({ maybeSingle: () => Promise.resolve(errResult) }),
    });
  };
  const failingSupabase: any = {
    from: () => ({ select: () => makeThenable() }),
  };

  const authCheck = async (req: any, res: any, next: any) => {
    if (!req.headers?.authorization) {
      res.status(401).json({ message: 'No autorizado' });
      return;
    }
    next();
  };

  const router = createReportsRouter({
    supabaseAdmin: failingSupabase,
    isLiveSupabaseConfigured: true,
    authenticate: authCheck,
    demoReservationsStore: [{ id: 'demo-secret', customerName: 'NO_LEAK', guestsCount: 2, status: 'confirmed', tableId: 't1', tableNumber: 1 }],
    demoTablesStore: sampleTables,
    demoTableSessionsStore: sampleSessions,
  });

  const makeRes = () => {
    const res: any = { statusCode: 200, body: null, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } };
    return res;
  };

  const layer = router.stack.find((l: any) => l.route?.path === '/overview');
  const handler = layer!.route!.stack[layer!.route!.stack.length - 1].handle;

  const liveErrRes = makeRes();
  await handler({ query: {}, headers: { authorization: 'Bearer ok' } }, liveErrRes, () => {});
  assert(
    liveErrRes.statusCode === 500 && !JSON.stringify(liveErrRes.body).includes('NO_LEAK'),
    'GET /api/reports/overview en modo Live devuelve HTTP 500 ante error DB sin filtrar datos demo (C.4)',
  );

  // Auth middleware check
  const mwLayer = router.stack.find((l: any) => !l.route);
  const unauthRes = makeRes();
  let nextCalled = false;
  await mwLayer!.handle({ headers: {} }, unauthRes, () => { nextCalled = true; });
  assert(unauthRes.statusCode === 401 && !nextCalled, 'Middleware authenticate bloquea peticiones sin token con HTTP 401');
}

testLiveNonFallbackAndAuth()
  .then(() => {
    console.log('\n================================================================================');
    console.log(`🎉 TODAS LAS PRUEBAS UNITARIAS DE INFORMES PASARON (${passed}/${total})`);
    console.log('================================================================================');
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
