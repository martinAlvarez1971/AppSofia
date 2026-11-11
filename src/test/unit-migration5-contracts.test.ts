/**
 * SOFIA · Pruebas Unitarias de Contratos Fase 2 (Migración 5)
 * Archivo: src/test/unit-migration5-contracts.test.ts
 *
 * Verifica de forma 100% local (sin conexión a DB):
 * 1. Canonicalización determinista y SHA-256 hash invariante al orden de claves.
 * 2. Extracción de Idempotency-Key / X-Idempotency-Key y derivación de claves por paso de saga Auth.
 * 3. Mapeo exacto de SQLSTATE (SF409, SF422, SF500, 23P01, 23505, P0001, P0002, 42501, 22023, 40P01) a códigos HTTP.
 * 4. Ausencia de fallback silencioso a memoria demo en src/server/reservations-query.ts en modo Live (C.4).
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  canonicalize,
  computeRequestHash,
  extractIdempotencyKey,
  deriveSagaStepKey,
  mapRpcErrorToHttp,
} from '../server/rpc-helpers.js';
import { createReservationsQueryRouter } from '../server/reservations-query.js';

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
console.log('🧪 SOFIA · PRUEBAS UNITARIAS DE CONTRATOS FASE 2 (RPC HELPERS + NON-FALLBACK)');
console.log('================================================================================\n');

// 1. Canonicalización y Hash determinista
{
  const objA = {
    b: 2,
    a: 1,
    nested: { z: 'last', a: 'first', omit: undefined },
    arr: [{ y: 2, x: 1 }],
  };
  const objB = {
    nested: { a: 'first', z: 'last' },
    a: 1,
    arr: [{ x: 1, y: 2 }],
    b: 2,
  };
  const hashA = computeRequestHash(objA);
  const hashB = computeRequestHash(objB);
  assert(
    hashA === hashB && hashA.length === 64,
    'computeRequestHash produce SHA-256 idéntico independientemente del orden de propiedades',
  );

  const d = new Date('2026-11-15T23:30:00.000Z');
  assert(
    canonicalize({ dt: d, n: null }) && (canonicalize({ dt: d }) as any).dt === '2026-11-15T23:30:00.000Z',
    'canonicalize serializa Date a ISO string estable',
  );
}

// 2. Extract Idempotency-Key & Saga Step Key Derivation
{
  const k1 = extractIdempotencyKey({ headers: { 'idempotency-key': '  req-123  ' } });
  const k2 = extractIdempotencyKey({ headers: { 'x-idempotency-key': 'req-456' } });
  const k3 = extractIdempotencyKey({ headers: {} });
  assert(k1 === 'req-123', 'extractIdempotencyKey lee y recorta idempotency-key');
  assert(k2 === 'req-456', 'extractIdempotencyKey soporta x-idempotency-key');
  assert(k3.length >= 32, 'extractIdempotencyKey genera UUIDv4 si no hay encabezado');

  assert(
    deriveSagaStepKey('op-1', 'begin') === 'op-1:begin' &&
      deriveSagaStepKey('op-1', 'dispatch') === 'op-1:dispatch' &&
      deriveSagaStepKey('op-1', 'complete') === 'op-1:complete' &&
      deriveSagaStepKey('op-1', 'fail') === 'op-1:fail',
    'deriveSagaStepKey genera claves independientes por fase de saga Auth',
  );
}

// 3. Mapeo de SQLSTATE a HTTP
{
  assert(mapRpcErrorToHttp({ code: 'SF409', message: 'Conflicto' }).status === 409, 'SQLSTATE SF409 -> HTTP 409');
  assert(mapRpcErrorToHttp({ code: '23P01', message: 'Overlap' }).status === 409, 'SQLSTATE 23P01 -> HTTP 409');
  assert(mapRpcErrorToHttp({ code: '23505', message: 'Unique' }).status === 409, 'SQLSTATE 23505 -> HTTP 409');
  assert(mapRpcErrorToHttp({ code: 'P0001', message: 'Raise' }).status === 409, 'SQLSTATE P0001 -> HTTP 409');
  assert(mapRpcErrorToHttp({ code: 'SF422', message: 'Invariante capacidad' }).status === 422, 'SQLSTATE SF422 -> HTTP 422');
  assert(mapRpcErrorToHttp({ code: 'P0002', message: 'No encontrado' }).status === 404, 'SQLSTATE P0002 -> HTTP 404');
  assert(mapRpcErrorToHttp({ code: '42501', message: 'Privilegios' }).status === 403, 'SQLSTATE 42501 -> HTTP 403');
  assert(mapRpcErrorToHttp({ code: '22023', message: 'Param' }).status === 400, 'SQLSTATE 22023 -> HTTP 400');
  assert(mapRpcErrorToHttp({ code: 'SF500', message: 'Inconsistencia 1:1' }).status === 500, 'SQLSTATE SF500 -> HTTP 500');
  assert(mapRpcErrorToHttp({ code: '40P01', message: 'Deadlock' }).status === 500, 'SQLSTATE 40P01 -> HTTP 500');
}

// 4. Non-fallback en src/server/reservations-query.ts en modo Live
async function testLiveNonFallback() {
  const errResult = { data: null, error: { message: 'Simulated DB outage' } };
  const makeThenableBuilder = () => {
    const p = Promise.resolve(errResult);
    return Object.assign(p, {
      order: () => makeThenableBuilder(),
      eq: () => ({
        maybeSingle: () => Promise.resolve({ data: null, error: { message: 'Simulated detail outage' } }),
        order: () => Promise.resolve({ data: null, error: { message: 'Simulated timeline outage' } }),
      }),
    });
  };
  const failingSupabase: any = {
    from: () => ({
      select: () => makeThenableBuilder(),
    }),
  };

  const dummyAuth = async (_req: any, _res: any, next: any) => next();
  const router = createReservationsQueryRouter({
    supabaseAdmin: failingSupabase,
    isLiveSupabaseConfigured: true,
    authenticate: dummyAuth,
    demoReservationsStore: [
      {
        id: 'demo-res-secret',
        tableId: 'tbl-1',
        tableNumber: 1,
        customerName: 'Demo Leak Check',
        guestsCount: 2,
        time: '21:00',
        status: 'confirmed',
        notes: 'should never leak in live mode',
      },
    ],
    demoTablesStore: [],
    demoAuditLogsStore: [],
  });

  const findRouteHandler = (routePath: string) => {
    const layer = router.stack.find((l: any) => l.route?.path === routePath);
    const stack = layer?.route?.stack || [];
    return stack[stack.length - 1].handle;
  };

  const makeMockRes = () => {
    const res: any = {
      statusCode: 200,
      body: null,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(data: unknown) {
        this.body = data;
        return this;
      },
    };
    return res;
  };

  const searchHandler = findRouteHandler('/search');
  const searchRes = makeMockRes();
  await searchHandler({ query: {} }, searchRes, () => {});
  assert(
    searchRes.statusCode === 500 && !JSON.stringify(searchRes.body).includes('Demo Leak Check'),
    'GET /reservations-query/search en modo Live devuelve HTTP 500 ante fallo DB sin filtrar datos demo',
  );

  const detailHandler = findRouteHandler('/detail/:id');
  const detailRes = makeMockRes();
  await detailHandler({ params: { id: 'demo-res-secret' } }, detailRes, () => {});
  assert(
    detailRes.statusCode === 500 && !JSON.stringify(detailRes.body).includes('Demo Leak Check'),
    'GET /reservations-query/detail/:id en modo Live devuelve HTTP 500 ante fallo DB sin fallback demo',
  );

  // Verificación estática de cero retornos demo en catch dentro de reservations-query.ts
  const rqSource = fs.readFileSync(path.resolve(process.cwd(), 'src/server/reservations-query.ts'), 'utf-8');
  assert(
    !rqSource.includes('catch') || !/catch[\s\S]{0,200}getFallbackDemo/.test(rqSource),
    'reservations-query.ts no invoca getFallbackDemo dentro de bloques catch en modo Live',
  );
}

testLiveNonFallback()
  .then(() => {
    console.log('\n================================================================================');
    console.log(`🎉 TODAS LAS PRUEBAS DE CONTRATOS MIGRACIÓN 5 PASARON (${passed}/${total})`);
    console.log('================================================================================');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Error inesperado:', err);
    process.exit(1);
  });
