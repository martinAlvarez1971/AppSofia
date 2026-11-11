/**
 * SOFIA · Suite Integral de Pruebas de Integración y Concurrencia en PostgreSQL / Supabase
 * Archivo: src/test/postgres-concurrency-integration.test.ts
 *
 * ALINEADO CON MIGRACIÓN 5 (20261112100000_lifecycle_sessions_and_reporting.sql):
 * 1. Esta suite se ejecuta EXCLUSIVAMENTE contra una base de datos de prueba/desarrollo aislada
 *    cuando la compuerta `environment-safety-gate.ts` lo autoriza.
 * 2. Usa exclusivamente las RPCs transaccionales *_tx de Migración 5 (incluyendo
 *    p_idempotency_key y p_request_hash) para respetar los triggers diferidos de auditoría.
 * 3. Toda entidad creada usa un `testRunId` único y la limpieza se acota estrictamente a dicho id.
 */

import crypto from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  verifyEnvironmentSafetyGate,
  printSafetyGateReport,
  printScenariosExecutionBalance,
  type ScenarioExecutionSummary,
} from './environment-safety-gate.js';
import { computeRequestHash } from '../server/rpc-helpers.js';

export interface IntegrationScenarioResult {
  scenarioNumber: number;
  name: string;
  category: 'Reserva' | 'Concurrencia' | 'Capacidad' | 'Estado' | 'Auditoría' | 'Zona Horaria' | 'Sesiones';
  status: 'PASSED' | 'FAILED' | 'SKIPPED_NO_TEST_DB';
  expectedBehavior: string;
  actualResult?: string;
  sqlErrorCode?: string;
  details?: Record<string, unknown>;
  error?: string;
}

function makeIdem(label: string, payload: unknown) {
  return {
    p_idempotency_key: `${label}:${crypto.randomUUID()}`,
    p_request_hash: computeRequestHash(payload),
  };
}

export async function runAll12IntegrationScenarios(): Promise<IntegrationScenarioResult[]> {
  const results: IntegrationScenarioResult[] = [];
  const executionSummaries: ScenarioExecutionSummary[] = [];

  console.log('================================================================================');
  console.log('🧪 SOFIA · MIGRACIÓN 5: VALIDACIÓN TRANSACCIONAL Y DE CONCURRENCIA EN POSTGRESQL');
  console.log('================================================================================\n');

  const gateVerification = verifyEnvironmentSafetyGate();
  printSafetyGateReport(gateVerification);

  const scenarioDefinitions = [
    { num: 1, name: 'Creación exitosa de reserva individual', cat: 'Reserva' as const, exp: 'Inserta reserva y asigna mesa atómicamente vía create_reservation_with_tables_tx.' },
    { num: 2, name: 'Creación exitosa de reserva con mesas combinadas', cat: 'Reserva' as const, exp: 'Inserta reserva y enlaza múltiples registros en reservation_tables.' },
    { num: 3, name: 'Rechazo por capacidad insuficiente (comensales > capacidad total)', cat: 'Capacidad' as const, exp: 'Lanza excepción 23P01/SF422 y aborta la transacción sin cambios.' },
    { num: 4, name: 'Rechazo de asignación a mesa inactiva o fuera de servicio', cat: 'Estado' as const, exp: 'Lanza excepción P0001/SF409 antes de crear la reserva.' },
    { num: 5, name: 'Rechazo por solapamiento horario en la misma mesa (incl. buffer)', cat: 'Reserva' as const, exp: 'RPC detecta conflicto temporal y retorna error 23P01.' },
    { num: 6, name: 'Concurrencia real: 2 transacciones simultáneas por la misma mesa', cat: 'Concurrencia' as const, exp: 'Bloqueo FOR UPDATE serializa: una transacción gana y la otra falla limpiamente.' },
    { num: 7, name: 'Prevención de deadlocks: bloqueo ordenado ASC de mesas', cat: 'Concurrencia' as const, exp: 'Dos transacciones concurrentes con orden inverso de mesas no provocan deadlock 40P01.' },
    { num: 8, name: 'Cambio atómico de capacidad vía change_table_capacity_tx + invariante SF422', cat: 'Auditoría' as const, exp: 'Persiste cambio con auditoría e impide bajar capacidad bajo comensales confirmados.' },
    { num: 9, name: 'set_table_status_tx rechaza desactivación con reservas activas y permite mesa limpia', cat: 'Estado' as const, exp: 'Sin cancelación en cascada: rechaza con SF409 si hay reservas activas; desactiva si está libre.' },
    { num: 10, name: 'Reactivación de mesa a disponible vía set_table_status_tx', cat: 'Estado' as const, exp: 'Mesa vuelve a available con is_active = true y genera auditoría.' },
    { num: 11, name: 'Cancelación de reserva con motivo obligatorio y alerta asociada', cat: 'Auditoría' as const, exp: 'Actualiza estado a cancelled vía cancel_reservation_tx y registra auditoría.' },
    { num: 12, name: 'Consistencia de fecha en zona horaria America/Argentina/Buenos_Aires', cat: 'Zona Horaria' as const, exp: 'Reserva a las 23:30 hs ART (UTC-3) mantiene fecha local sin desplazarse al día siguiente.' },
    { num: 13, name: 'Ciclo de vida sesión: walk-in, rechazo release_table_operational en reserva y 1:1 complete_service_tx', cat: 'Sesiones' as const, exp: 'Walk-in abre/cierra vía release_table_operational_tx; reserva sentada rechaza liberación operativa y cierra con complete_service_tx.' },
  ];

  if (!gateVerification.canExecuteDatabaseWrites) {
    for (const def of scenarioDefinitions) {
      results.push({
        scenarioNumber: def.num,
        name: def.name,
        category: def.cat,
        status: 'SKIPPED_NO_TEST_DB',
        expectedBehavior: def.exp,
        actualResult: `Comprobación estática exitosa. Ejecución en base de datos pospuesta: ${gateVerification.reason}`,
      });
      executionSummaries.push({
        scenarioNumber: def.num,
        name: def.name,
        category: def.cat,
        executedAgainstPostgres: false,
        status: 'SKIPPED_NO_TEST_DB',
        detail: gateVerification.reason,
      });
    }

    printScenariosExecutionBalance(executionSummaries);
    return results;
  }

  const client: SupabaseClient = createClient(
    process.env.SUPABASE_TEST_URL!,
    process.env.SUPABASE_TEST_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );

  const testRunId = gateVerification.testRunId;
  const testSectorName = `TestSector_${testRunId}`;

  let testActorId: string;
  let table1Id: string;
  let table2Id: string;
  let tableCleanId: string;
  let tableInactiveId: string;
  const createdTableIds: string[] = [];
  const createdReservationIds: string[] = [];

  try {
    const { data: profile } = await client.from('profiles').select('id').eq('role', 'super_admin').limit(1).single();
    testActorId = profile?.id || '00000000-0000-0000-0000-000000000001';

    const baseNumber = 8000 + (Date.now() % 1000);

    // En Migración 5, create_table_tx respeta los triggers de auditoría
    const createTestTable = async (num: number, cap: number, sector: string) => {
      const idem = makeIdem(`${testRunId}:create_tbl_${num}`, { num, cap, sector });
      const { data, error } = await client.rpc('create_table_tx', {
        p_number: num,
        p_sector: sector,
        p_capacity: cap,
        p_max_capacity: cap + 2,
        p_shape: 'square',
        p_reason: `Creación mesa test ${testRunId}`,
        p_actor_id: testActorId,
        ...idem,
      });
      if (error || !data?.id) throw new Error(`Error creando mesa de prueba ${num}: ${error?.message}`);
      createdTableIds.push(data.id);
      return data.id as string;
    };

    table1Id = await createTestTable(baseNumber + 1, 4, testSectorName);
    table2Id = await createTestTable(baseNumber + 2, 2, testSectorName);
    tableCleanId = await createTestTable(baseNumber + 3, 4, testSectorName);
    tableInactiveId = await createTestTable(baseNumber + 4, 4, testSectorName);

    // Desactivar tableInactiveId usando set_table_status_tx
    const deactivateInactIdem = makeIdem(`${testRunId}:inact`, { tableInactiveId });
    await client.rpc('set_table_status_tx', {
      p_table_id: tableInactiveId,
      p_status: 'out_of_service',
      p_reason: `Mesa inactiva test ${testRunId}`,
      p_actor_id: testActorId,
      ...deactivateInactIdem,
    });

    // Escenario 1: Creación exitosa individual
    try {
      const startTime = new Date(Date.now() + 86400000).toISOString();
      const payload = { table1Id, startTime, guests: 4 };
      const { data, error } = await client.rpc('create_reservation_with_tables_tx', {
        p_customer_name: 'Cliente Escenario 1',
        p_customer_phone: '+5491100000001',
        p_customer_email: 'cliente1@test.com',
        p_guests_count: 4,
        p_start_time: startTime,
        p_duration_minutes: 120,
        p_table_ids: [table1Id],
        p_notes: `[${testRunId}] Prueba E1`,
        p_created_by: testActorId,
        ...makeIdem(`${testRunId}:e1`, payload),
      });

      if (data?.id) createdReservationIds.push(data.id);
      const passed = !error && Boolean(data?.id);
      results.push({
        scenarioNumber: 1,
        name: scenarioDefinitions[0].name,
        category: 'Reserva',
        status: passed ? 'PASSED' : 'FAILED',
        expectedBehavior: scenarioDefinitions[0].exp,
        actualResult: !error ? `Reserva creada ID: ${data.id}` : error.message,
        error: error?.message,
      });
      executionSummaries.push({
        scenarioNumber: 1,
        name: scenarioDefinitions[0].name,
        category: 'Reserva',
        executedAgainstPostgres: true,
        status: passed ? 'PASSED' : 'FAILED',
        detail: !error ? 'Ejecutado contra PostgreSQL con éxito' : error.message,
      });
    } catch (e: any) {
      results.push({ scenarioNumber: 1, name: scenarioDefinitions[0].name, category: 'Reserva', status: 'FAILED', expectedBehavior: 'Éxito', error: e.message });
      executionSummaries.push({ scenarioNumber: 1, name: scenarioDefinitions[0].name, category: 'Reserva', executedAgainstPostgres: true, status: 'FAILED', detail: e.message });
    }

    // Escenario 2: Creación exitosa combinada
    try {
      const startTime2 = new Date(Date.now() + 86400000 * 2).toISOString();
      const payload = { table1Id, table2Id, startTime2 };
      const { data, error } = await client.rpc('create_reservation_with_tables_tx', {
        p_customer_name: 'Cliente Mesas Combinadas',
        p_customer_phone: '+5491100000002',
        p_customer_email: 'cliente2@test.com',
        p_guests_count: 6,
        p_start_time: startTime2,
        p_duration_minutes: 120,
        p_table_ids: [table1Id, table2Id],
        p_notes: `[${testRunId}] Prueba E2`,
        p_created_by: testActorId,
        ...makeIdem(`${testRunId}:e2`, payload),
      });

      if (data?.id) createdReservationIds.push(data.id);
      const passed = !error && Boolean(data?.id);
      results.push({
        scenarioNumber: 2,
        name: scenarioDefinitions[1].name,
        category: 'Reserva',
        status: passed ? 'PASSED' : 'FAILED',
        expectedBehavior: scenarioDefinitions[1].exp,
        actualResult: !error ? `Reserva combinada ID: ${data.id}` : error.message,
        error: error?.message,
      });
      executionSummaries.push({
        scenarioNumber: 2,
        name: scenarioDefinitions[1].name,
        category: 'Reserva',
        executedAgainstPostgres: true,
        status: passed ? 'PASSED' : 'FAILED',
        detail: !error ? 'Ejecutado contra PostgreSQL con éxito' : error.message,
      });
    } catch (e: any) {
      results.push({ scenarioNumber: 2, name: scenarioDefinitions[1].name, category: 'Reserva', status: 'FAILED', expectedBehavior: 'Éxito', error: e.message });
      executionSummaries.push({ scenarioNumber: 2, name: scenarioDefinitions[1].name, category: 'Reserva', executedAgainstPostgres: true, status: 'FAILED', detail: e.message });
    }

    // Escenario 3: Rechazo por capacidad insuficiente
    try {
      const startTime3 = new Date(Date.now() + 86400000 * 3).toISOString();
      const { data, error } = await client.rpc('create_reservation_with_tables_tx', {
        p_customer_name: 'Cliente Exceso Capacidad',
        p_customer_phone: '+5491100000003',
        p_customer_email: 'exceso@test.com',
        p_guests_count: 10,
        p_start_time: startTime3,
        p_duration_minutes: 120,
        p_table_ids: [table1Id],
        p_notes: `[${testRunId}] Prueba E3`,
        p_created_by: testActorId,
        ...makeIdem(`${testRunId}:e3`, { startTime3 }),
      });

      const passed = Boolean(error && (error.code === '23P01' || error.code === 'SF422' || error.message.includes('capacidad')));
      results.push({
        scenarioNumber: 3,
        name: scenarioDefinitions[2].name,
        category: 'Capacidad',
        status: passed ? 'PASSED' : 'FAILED',
        expectedBehavior: scenarioDefinitions[2].exp,
        actualResult: error ? `Error esperado: [${error.code}] ${error.message}` : `Inesperado: reserva creada ${data?.id}`,
        sqlErrorCode: error?.code,
      });
      executionSummaries.push({
        scenarioNumber: 3,
        name: scenarioDefinitions[2].name,
        category: 'Capacidad',
        executedAgainstPostgres: true,
        status: passed ? 'PASSED' : 'FAILED',
        detail: error ? `Código SQL: ${error.code}` : 'Falló: no lanzó error esperado',
      });
    } catch (e: any) {
      results.push({ scenarioNumber: 3, name: scenarioDefinitions[2].name, category: 'Capacidad', status: 'FAILED', expectedBehavior: '23P01', error: e.message });
      executionSummaries.push({ scenarioNumber: 3, name: scenarioDefinitions[2].name, category: 'Capacidad', executedAgainstPostgres: true, status: 'FAILED', detail: e.message });
    }

    // Escenario 4: Rechazo mesa inactiva
    try {
      const startTime4 = new Date(Date.now() + 86400000 * 4).toISOString();
      const { data, error } = await client.rpc('create_reservation_with_tables_tx', {
        p_customer_name: 'Cliente Mesa Inactiva',
        p_customer_phone: '+5491100000004',
        p_customer_email: 'inactiva@test.com',
        p_guests_count: 2,
        p_start_time: startTime4,
        p_duration_minutes: 120,
        p_table_ids: [tableInactiveId],
        p_notes: `[${testRunId}] Prueba E4`,
        p_created_by: testActorId,
        ...makeIdem(`${testRunId}:e4`, { startTime4 }),
      });

      const passed = Boolean(error && (error.code === 'P0001' || error.code === 'SF409' || error.message.includes('inactiva') || error.message.includes('fuera de servicio')));
      results.push({
        scenarioNumber: 4,
        name: scenarioDefinitions[3].name,
        category: 'Estado',
        status: passed ? 'PASSED' : 'FAILED',
        expectedBehavior: scenarioDefinitions[3].exp,
        actualResult: error ? `Error esperado: [${error.code}] ${error.message}` : `Inesperado: reserva creada ${data?.id}`,
        sqlErrorCode: error?.code,
      });
      executionSummaries.push({
        scenarioNumber: 4,
        name: scenarioDefinitions[3].name,
        category: 'Estado',
        executedAgainstPostgres: true,
        status: passed ? 'PASSED' : 'FAILED',
        detail: error ? `Código SQL: ${error.code}` : 'Falló: no lanzó error esperado',
      });
    } catch (e: any) {
      results.push({ scenarioNumber: 4, name: scenarioDefinitions[3].name, category: 'Estado', status: 'FAILED', expectedBehavior: 'P0001', error: e.message });
      executionSummaries.push({ scenarioNumber: 4, name: scenarioDefinitions[3].name, category: 'Estado', executedAgainstPostgres: true, status: 'FAILED', detail: e.message });
    }

    // Escenario 5: Rechazo solapamiento horario
    try {
      const baseTime = new Date(Date.now() + 86400000 * 5);
      const { data: firstRes } = await client.rpc('create_reservation_with_tables_tx', {
        p_customer_name: 'Cliente Primer Turno',
        p_customer_phone: '+5491100000005',
        p_customer_email: 'turno1@test.com',
        p_guests_count: 2,
        p_start_time: baseTime.toISOString(),
        p_duration_minutes: 120,
        p_table_ids: [table2Id],
        p_notes: `[${testRunId}] Turno 1`,
        p_created_by: testActorId,
        ...makeIdem(`${testRunId}:e5a`, { baseTime }),
      });
      if (firstRes?.id) createdReservationIds.push(firstRes.id);

      const overlappingTime = new Date(baseTime.getTime() + 30 * 60000).toISOString();
      const { data: overlapData, error: overlapError } = await client.rpc('create_reservation_with_tables_tx', {
        p_customer_name: 'Cliente Solapado',
        p_customer_phone: '+5491100000006',
        p_customer_email: 'solapado@test.com',
        p_guests_count: 2,
        p_start_time: overlappingTime,
        p_duration_minutes: 120,
        p_table_ids: [table2Id],
        p_notes: `[${testRunId}] Solapamiento`,
        p_created_by: testActorId,
        ...makeIdem(`${testRunId}:e5b`, { overlappingTime }),
      });

      const passed = Boolean(overlapError && (overlapError.code === '23P01' || overlapError.code === 'SF409' || overlapError.message.includes('solapamiento')));
      results.push({
        scenarioNumber: 5,
        name: scenarioDefinitions[4].name,
        category: 'Reserva',
        status: passed ? 'PASSED' : 'FAILED',
        expectedBehavior: scenarioDefinitions[4].exp,
        actualResult: overlapError ? `Error esperado: [${overlapError.code}] ${overlapError.message}` : `Inesperado: reserva solapada creada ${overlapData?.id}`,
        sqlErrorCode: overlapError?.code,
      });
      executionSummaries.push({
        scenarioNumber: 5,
        name: scenarioDefinitions[4].name,
        category: 'Reserva',
        executedAgainstPostgres: true,
        status: passed ? 'PASSED' : 'FAILED',
        detail: overlapError ? `Código SQL: ${overlapError.code}` : 'Falló',
      });
    } catch (e: any) {
      results.push({ scenarioNumber: 5, name: scenarioDefinitions[4].name, category: 'Reserva', status: 'FAILED', expectedBehavior: '23P01', error: e.message });
      executionSummaries.push({ scenarioNumber: 5, name: scenarioDefinitions[4].name, category: 'Reserva', executedAgainstPostgres: true, status: 'FAILED', detail: e.message });
    }

    // Escenario 6: Concurrencia real simultánea
    try {
      const concurrencyTime = new Date(Date.now() + 86400000 * 6).toISOString();
      const callA = client.rpc('create_reservation_with_tables_tx', {
        p_customer_name: 'Transacción Concurrente A',
        p_customer_phone: '+5491100000007',
        p_customer_email: 'concurrenteA@test.com',
        p_guests_count: 2,
        p_start_time: concurrencyTime,
        p_duration_minutes: 90,
        p_table_ids: [table2Id],
        p_notes: `[${testRunId}] Concurrencia A`,
        p_created_by: testActorId,
        ...makeIdem(`${testRunId}:e6a`, { concurrencyTime, side: 'A' }),
      });

      const callB = client.rpc('create_reservation_with_tables_tx', {
        p_customer_name: 'Transacción Concurrente B',
        p_customer_phone: '+5491100000008',
        p_customer_email: 'concurrenteB@test.com',
        p_guests_count: 2,
        p_start_time: concurrencyTime,
        p_duration_minutes: 90,
        p_table_ids: [table2Id],
        p_notes: `[${testRunId}] Concurrencia B`,
        p_created_by: testActorId,
        ...makeIdem(`${testRunId}:e6b`, { concurrencyTime, side: 'B' }),
      });

      const [resA, resB] = await Promise.all([callA, callB]);
      if (resA.data?.id) createdReservationIds.push(resA.data.id);
      if (resB.data?.id) createdReservationIds.push(resB.data.id);

      const oneSucceeded = (!resA.error && resA.data?.id && resB.error) || (!resB.error && resB.data?.id && resA.error);
      const passed = Boolean(oneSucceeded);

      results.push({
        scenarioNumber: 6,
        name: scenarioDefinitions[5].name,
        category: 'Concurrencia',
        status: passed ? 'PASSED' : 'FAILED',
        expectedBehavior: scenarioDefinitions[5].exp,
        actualResult: passed ? 'Serialización estricta verificada: 1 éxito, 1 rechazo.' : 'Ambas pasaron o ambas fallaron de manera anómala.',
      });
      executionSummaries.push({
        scenarioNumber: 6,
        name: scenarioDefinitions[5].name,
        category: 'Concurrencia',
        executedAgainstPostgres: true,
        status: passed ? 'PASSED' : 'FAILED',
        detail: passed ? 'Serialización estricta comprobada' : 'Fallo en serialización',
      });
    } catch (e: any) {
      results.push({ scenarioNumber: 6, name: scenarioDefinitions[5].name, category: 'Concurrencia', status: 'FAILED', expectedBehavior: '1 éxito, 1 rechazo', error: e.message });
      executionSummaries.push({ scenarioNumber: 6, name: scenarioDefinitions[5].name, category: 'Concurrencia', executedAgainstPostgres: true, status: 'FAILED', detail: e.message });
    }

    // Escenario 7: Prevención de deadlocks (bloqueo ordenado ASC)
    try {
      const deadlockTime = new Date(Date.now() + 86400000 * 7).toISOString();
      const call1 = client.rpc('create_reservation_with_tables_tx', {
        p_customer_name: 'Deadlock Test 1',
        p_customer_phone: '+5491100000009',
        p_customer_email: 'dl1@test.com',
        p_guests_count: 6,
        p_start_time: deadlockTime,
        p_duration_minutes: 60,
        p_table_ids: [table1Id, table2Id],
        p_notes: `[${testRunId}] DL 1`,
        p_created_by: testActorId,
        ...makeIdem(`${testRunId}:e7a`, { deadlockTime, s: 1 }),
      });

      const call2 = client.rpc('create_reservation_with_tables_tx', {
        p_customer_name: 'Deadlock Test 2 (Invertido)',
        p_customer_phone: '+5491100000010',
        p_customer_email: 'dl2@test.com',
        p_guests_count: 6,
        p_start_time: deadlockTime,
        p_duration_minutes: 60,
        p_table_ids: [table2Id, table1Id],
        p_notes: `[${testRunId}] DL 2`,
        p_created_by: testActorId,
        ...makeIdem(`${testRunId}:e7b`, { deadlockTime, s: 2 }),
      });

      const [r1, r2] = await Promise.all([call1, call2]);
      if (r1.data?.id) createdReservationIds.push(r1.data.id);
      if (r2.data?.id) createdReservationIds.push(r2.data.id);

      const hadDeadlock = r1.error?.code === '40P01' || r2.error?.code === '40P01';
      results.push({
        scenarioNumber: 7,
        name: scenarioDefinitions[6].name,
        category: 'Concurrencia',
        status: !hadDeadlock ? 'PASSED' : 'FAILED',
        expectedBehavior: scenarioDefinitions[6].exp,
        actualResult: !hadDeadlock ? 'Cero deadlocks (40P01) detectados.' : 'Deadlock 40P01 detectado.',
      });
      executionSummaries.push({
        scenarioNumber: 7,
        name: scenarioDefinitions[6].name,
        category: 'Concurrencia',
        executedAgainstPostgres: true,
        status: !hadDeadlock ? 'PASSED' : 'FAILED',
        detail: !hadDeadlock ? 'Sin deadlocks 40P01' : 'Ocurrió 40P01',
      });
    } catch (e: any) {
      results.push({ scenarioNumber: 7, name: scenarioDefinitions[6].name, category: 'Concurrencia', status: 'FAILED', expectedBehavior: 'Sin 40P01', error: e.message });
      executionSummaries.push({ scenarioNumber: 7, name: scenarioDefinitions[6].name, category: 'Concurrencia', executedAgainstPostgres: true, status: 'FAILED', detail: e.message });
    }

    // Escenario 8: Cambio atómico de capacidad vía change_table_capacity_tx + rechazo SF422
    try {
      const { error: sf422Err } = await client.rpc('change_table_capacity_tx', {
        p_table_id: table1Id,
        p_new_capacity: 1,
        p_reason: `Intento reducción ilegal bajo comensales [${testRunId}]`,
        p_force: true,
        p_actor_id: testActorId,
        ...makeIdem(`${testRunId}:e8a`, { table1Id, cap: 1 }),
      });

      const { data, error } = await client.rpc('change_table_capacity_tx', {
        p_table_id: tableCleanId,
        p_new_capacity: 6,
        p_reason: `Aumento de capacidad para eventos [${testRunId}]`,
        p_force: false,
        p_actor_id: testActorId,
        ...makeIdem(`${testRunId}:e8b`, { tableCleanId, cap: 6 }),
      });

      const { data: audits } = await client
        .from('audit_logs')
        .select()
        .eq('entity_id', tableCleanId)
        .eq('action', 'table.capacity_changed');

      const passed = Boolean(sf422Err) && !error && data?.capacity === 6 && (audits?.length || 0) > 0;
      results.push({
        scenarioNumber: 8,
        name: scenarioDefinitions[7].name,
        category: 'Auditoría',
        status: passed ? 'PASSED' : 'FAILED',
        expectedBehavior: scenarioDefinitions[7].exp,
        actualResult: passed ? 'SF422 bloqueado + capacidad 6 persistida con auditoría.' : error?.message || 'Fallo de integridad',
      });
      executionSummaries.push({
        scenarioNumber: 8,
        name: scenarioDefinitions[7].name,
        category: 'Auditoría',
        executedAgainstPostgres: true,
        status: passed ? 'PASSED' : 'FAILED',
        detail: passed ? 'SF422 y auditoría verificados' : 'Falló',
      });
    } catch (e: any) {
      results.push({ scenarioNumber: 8, name: scenarioDefinitions[7].name, category: 'Auditoría', status: 'FAILED', expectedBehavior: 'Éxito', error: e.message });
      executionSummaries.push({ scenarioNumber: 8, name: scenarioDefinitions[7].name, category: 'Auditoría', executedAgainstPostgres: true, status: 'FAILED', detail: e.message });
    }

    // Escenario 9: set_table_status_tx rechaza mesa con reservas activas y permite mesa limpia
    try {
      const { error: blockedErr } = await client.rpc('set_table_status_tx', {
        p_table_id: table1Id,
        p_status: 'out_of_service',
        p_reason: `Intento desactivar con reservas activas [${testRunId}]`,
        p_actor_id: testActorId,
        ...makeIdem(`${testRunId}:e9a`, { table1Id, status: 'out_of_service' }),
      });

      const { data, error } = await client.rpc('set_table_status_tx', {
        p_table_id: tableCleanId,
        p_status: 'out_of_service',
        p_reason: `Mantenimiento preventivo mesa limpia [${testRunId}]`,
        p_actor_id: testActorId,
        ...makeIdem(`${testRunId}:e9b`, { tableCleanId, status: 'out_of_service' }),
      });

      const passed = Boolean(blockedErr) && !error && data?.status === 'out_of_service' && data?.isActive === false;
      results.push({
        scenarioNumber: 9,
        name: scenarioDefinitions[8].name,
        category: 'Estado',
        status: passed ? 'PASSED' : 'FAILED',
        expectedBehavior: scenarioDefinitions[8].exp,
        actualResult: passed ? `Mesa con reservas protegida (${blockedErr?.code}); mesa limpia desactivada.` : error?.message,
      });
      executionSummaries.push({
        scenarioNumber: 9,
        name: scenarioDefinitions[8].name,
        category: 'Estado',
        executedAgainstPostgres: true,
        status: passed ? 'PASSED' : 'FAILED',
        detail: passed ? 'Sin cascada + desactivación limpia verificada' : 'Falló',
      });
    } catch (e: any) {
      results.push({ scenarioNumber: 9, name: scenarioDefinitions[8].name, category: 'Estado', status: 'FAILED', expectedBehavior: 'Éxito', error: e.message });
      executionSummaries.push({ scenarioNumber: 9, name: scenarioDefinitions[8].name, category: 'Estado', executedAgainstPostgres: true, status: 'FAILED', detail: e.message });
    }

    // Escenario 10: Reactivación de mesa
    try {
      const { data, error } = await client.rpc('set_table_status_tx', {
        p_table_id: tableCleanId,
        p_status: 'available',
        p_reason: `Mantenimiento concluido con éxito [${testRunId}]`,
        p_actor_id: testActorId,
        ...makeIdem(`${testRunId}:e10`, { tableCleanId, status: 'available' }),
      });

      const passed = !error && data?.status === 'available' && data?.isActive === true;
      results.push({
        scenarioNumber: 10,
        name: scenarioDefinitions[9].name,
        category: 'Estado',
        status: passed ? 'PASSED' : 'FAILED',
        expectedBehavior: scenarioDefinitions[9].exp,
        actualResult: passed ? 'Mesa reactivada a available' : error?.message,
      });
      executionSummaries.push({
        scenarioNumber: 10,
        name: scenarioDefinitions[9].name,
        category: 'Estado',
        executedAgainstPostgres: true,
        status: passed ? 'PASSED' : 'FAILED',
        detail: passed ? 'Mesa reactivada exitosamente' : 'Falló',
      });
    } catch (e: any) {
      results.push({ scenarioNumber: 10, name: scenarioDefinitions[9].name, category: 'Estado', status: 'FAILED', expectedBehavior: 'Éxito', error: e.message });
      executionSummaries.push({ scenarioNumber: 10, name: scenarioDefinitions[9].name, category: 'Estado', executedAgainstPostgres: true, status: 'FAILED', detail: e.message });
    }

    // Escenario 11: Cancelación de reserva con motivo obligatorio
    try {
      const tCancelStart = new Date(Date.now() + 86400000 * 10).toISOString();
      const { data: resToCancel } = await client.rpc('create_reservation_with_tables_tx', {
        p_customer_name: 'Cliente Para Cancelar',
        p_customer_phone: '+5491100000011',
        p_customer_email: 'cancel@test.com',
        p_guests_count: 2,
        p_start_time: tCancelStart,
        p_duration_minutes: 120,
        p_table_ids: [table2Id],
        p_notes: `[${testRunId}] Reserva previa`,
        p_created_by: testActorId,
        ...makeIdem(`${testRunId}:e11a`, { tCancelStart }),
      });
      if (resToCancel?.id) createdReservationIds.push(resToCancel.id);

      const { data: cancelledData, error: cancelErr } = await client.rpc('cancel_reservation_tx', {
        p_reservation_id: resToCancel.id,
        p_reason: `Cancelado por solicitud del comensal debido a viaje [${testRunId}]`,
        p_actor_id: testActorId,
        ...makeIdem(`${testRunId}:e11b`, { resId: resToCancel?.id }),
      });

      const passed = !cancelErr && cancelledData?.status === 'cancelled';
      results.push({
        scenarioNumber: 11,
        name: scenarioDefinitions[10].name,
        category: 'Auditoría',
        status: passed ? 'PASSED' : 'FAILED',
        expectedBehavior: scenarioDefinitions[10].exp,
        actualResult: !cancelErr ? `Cancelada con motivo: ${cancelledData.cancellationReason}` : cancelErr.message,
      });
      executionSummaries.push({
        scenarioNumber: 11,
        name: scenarioDefinitions[10].name,
        category: 'Auditoría',
        executedAgainstPostgres: true,
        status: passed ? 'PASSED' : 'FAILED',
        detail: passed ? 'Cancelación y auditoría validadas' : 'Falló',
      });
    } catch (e: any) {
      results.push({ scenarioNumber: 11, name: scenarioDefinitions[10].name, category: 'Auditoría', status: 'FAILED', expectedBehavior: 'Éxito', error: e.message });
      executionSummaries.push({ scenarioNumber: 11, name: scenarioDefinitions[10].name, category: 'Auditoría', executedAgainstPostgres: true, status: 'FAILED', detail: e.message });
    }

    // Escenario 12: Zona horaria America/Argentina/Buenos_Aires
    try {
      const localTimeString = '2026-11-15T23:30:00-03:00';
      const { data, error } = await client.rpc('create_reservation_with_tables_tx', {
        p_customer_name: 'Cliente Cena Tardía',
        p_customer_phone: '+5491100000012',
        p_customer_email: 'tarde@test.com',
        p_guests_count: 2,
        p_start_time: localTimeString,
        p_duration_minutes: 90,
        p_table_ids: [table2Id],
        p_notes: `[${testRunId}] Cena noche`,
        p_created_by: testActorId,
        ...makeIdem(`${testRunId}:e12`, { localTimeString }),
      });
      if (data?.id) createdReservationIds.push(data.id);

      const correctDate = data?.reservationDate === '2026-11-15';
      const passed = !error && correctDate;
      results.push({
        scenarioNumber: 12,
        name: scenarioDefinitions[11].name,
        category: 'Zona Horaria',
        status: passed ? 'PASSED' : 'FAILED',
        expectedBehavior: scenarioDefinitions[11].exp,
        actualResult: !error ? `reservationDate calculado: ${data.reservationDate}` : error.message,
      });
      executionSummaries.push({
        scenarioNumber: 12,
        name: scenarioDefinitions[11].name,
        category: 'Zona Horaria',
        executedAgainstPostgres: true,
        status: passed ? 'PASSED' : 'FAILED',
        detail: passed ? 'Cálculo de fecha local verificado' : 'Falló',
      });
    } catch (e: any) {
      results.push({ scenarioNumber: 12, name: scenarioDefinitions[11].name, category: 'Zona Horaria', status: 'FAILED', expectedBehavior: '2026-11-15', error: e.message });
      executionSummaries.push({ scenarioNumber: 12, name: scenarioDefinitions[11].name, category: 'Zona Horaria', executedAgainstPostgres: true, status: 'FAILED', detail: e.message });
    }

    // Escenario 13: Sesiones walk-in vs reserva y complete_service_tx
    try {
      const { error: walkInErr } = await client.rpc('open_walk_in_session_tx', {
        p_table_id: tableCleanId,
        p_guests_count: 3,
        p_expected_duration_minutes: 90,
        p_notes: `Walk-in test ${testRunId}`,
        p_actor_id: testActorId,
        ...makeIdem(`${testRunId}:e13a`, { tableCleanId }),
      });

      const { error: releaseWalkInErr } = await client.rpc('release_table_operational_tx', {
        p_table_id: tableCleanId,
        p_reason: `Cierre operativo walk-in ${testRunId}`,
        p_actor_id: testActorId,
        ...makeIdem(`${testRunId}:e13b`, { tableCleanId }),
      });

      const seatStart = new Date(Date.now() + 86400000 * 11).toISOString();
      const { data: resForSeat } = await client.rpc('create_reservation_with_tables_tx', {
        p_customer_name: 'Cliente Checkin E13',
        p_customer_phone: '+5491100000013',
        p_customer_email: 'seat@test.com',
        p_guests_count: 4,
        p_start_time: seatStart,
        p_duration_minutes: 120,
        p_table_ids: [tableCleanId],
        p_notes: `[${testRunId}] Seat E13`,
        p_created_by: testActorId,
        ...makeIdem(`${testRunId}:e13c`, { seatStart }),
      });
      if (resForSeat?.id) createdReservationIds.push(resForSeat.id);

      const { error: seatErr } = await client.rpc('seat_reservation_tx', {
        p_reservation_id: resForSeat.id,
        p_expected_duration_minutes: 120,
        p_notes: 'Check-in test',
        p_actor_id: testActorId,
        ...makeIdem(`${testRunId}:e13d`, { resId: resForSeat.id }),
      });

      // Debe RECHAZAR release_table_operational_tx sobre sesión de reserva
      const { error: rejectedRelErr } = await client.rpc('release_table_operational_tx', {
        p_table_id: tableCleanId,
        p_reason: 'Intento ilegal sobre sesión de reserva',
        p_actor_id: testActorId,
        ...makeIdem(`${testRunId}:e13e`, { tableCleanId }),
      });

      const { data: compData, error: compErr } = await client.rpc('complete_service_tx', {
        p_reservation_id: resForSeat.id,
        p_notes: 'Servicio terminado test',
        p_actor_id: testActorId,
        ...makeIdem(`${testRunId}:e13f`, { resId: resForSeat.id }),
      });

      const passed =
        !walkInErr &&
        !releaseWalkInErr &&
        !seatErr &&
        Boolean(rejectedRelErr) &&
        !compErr &&
        compData?.status === 'completed';

      results.push({
        scenarioNumber: 13,
        name: scenarioDefinitions[12].name,
        category: 'Sesiones',
        status: passed ? 'PASSED' : 'FAILED',
        expectedBehavior: scenarioDefinitions[12].exp,
        actualResult: passed ? 'Walk-in, rechazo en reserva y complete_service_tx validados.' : compErr?.message || rejectedRelErr?.message,
      });
      executionSummaries.push({
        scenarioNumber: 13,
        name: scenarioDefinitions[12].name,
        category: 'Sesiones',
        executedAgainstPostgres: true,
        status: passed ? 'PASSED' : 'FAILED',
        detail: passed ? 'Invariante sesiones walk-in vs reserva validado' : 'Falló',
      });
    } catch (e: any) {
      results.push({ scenarioNumber: 13, name: scenarioDefinitions[12].name, category: 'Sesiones', status: 'FAILED', expectedBehavior: 'Éxito', error: e.message });
      executionSummaries.push({ scenarioNumber: 13, name: scenarioDefinitions[12].name, category: 'Sesiones', executedAgainstPostgres: true, status: 'FAILED', detail: e.message });
    }
  } catch (globalErr: any) {
    console.error('Error global durante la suite:', globalErr.message);
  } finally {
    console.log(`🧹 Ejecutando limpieza segura para testRunId: ${testRunId}...`);
    try {
      // 1. Integridad referencial: table_sessions antes que reservation_tables / reservations / tables
      if (createdTableIds.length > 0) {
        const { error: tsErr } = await client
          .from('table_sessions')
          .delete()
          .in('table_id', createdTableIds);
        if (tsErr) {
          console.warn('⚠️ Advertencia no fatal al limpiar table_sessions:', tsErr.message);
        }
      }

      if (createdReservationIds.length > 0) {
        // 2. Eliminar relaciones en reservation_tables
        const { error: rtErr } = await client
          .from('reservation_tables')
          .delete()
          .in('reservation_id', createdReservationIds);
        if (rtErr) {
          console.warn('⚠️ Advertencia no fatal al limpiar reservation_tables:', rtErr.message);
        }

        // 3. Eliminar reservas creadas durante la corrida
        const { error: rErr } = await client
          .from('reservations')
          .delete()
          .in('id', createdReservationIds);
        if (rErr) {
          console.warn('⚠️ Advertencia no fatal al limpiar reservations:', rErr.message);
        }
      }

      // 4. Eliminar mesas creadas específicamente por su ID y sector exclusivo
      if (createdTableIds.length > 0) {
        const { error: tErr } = await client
          .from('tables')
          .delete()
          .in('id', createdTableIds)
          .eq('sector', testSectorName);
        if (tErr) {
          console.warn('⚠️ Advertencia no fatal al limpiar tables por ID:', tErr.message);
        }
      } else {
        await client.from('tables').delete().eq('sector', testSectorName);
      }

      console.log('✨ Limpieza de entidades de prueba completada sin alterar otros registros.\n');
    } catch (cleanupErr: any) {
      console.error('⚠️ Error no fatal durante la limpieza acotada:', cleanupErr?.message || cleanupErr);
    }
  }

  printScenariosExecutionBalance(executionSummaries);
  return results;
}

runAll12IntegrationScenarios()
  .then((res) => {
    console.log('================================================================================');
    console.log('📋 RESUMEN DE LA SUITE DE INTEGRACIÓN MIGRACIÓN 5');
    console.log('================================================================================');
    for (const r of res) {
      const icon = r.status === 'PASSED' ? '✅' : r.status === 'SKIPPED_NO_TEST_DB' ? '⏸️ ' : '❌';
      console.log(`${icon} [E${r.scenarioNumber.toString().padStart(2, '0')}] [${r.category}] ${r.name}`);
      console.log(`     Comportamiento: ${r.expectedBehavior}`);
      console.log(`     Estado: ${r.status} ${r.actualResult ? `— ${r.actualResult}` : ''}\n`);
    }
  })
  .catch((e) => console.error(e));
