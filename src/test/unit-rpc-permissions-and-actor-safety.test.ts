/**
 * Suite de Pruebas Unitarias y Estáticas:
 * Seguridad de Permisos RPC, Aislamiento de Actor e Invariantes de Migración 5
 *
 * SOFIA - Fase 2 (Migración 5)
 * Valida de forma 100% local (sin conexiones remotas ni escrituras en DB):
 * 1. Revocación total de EXECUTE a public, anon y authenticated en las 24 funciones *_tx de Migración 5.
 * 2. Concesión exclusiva de EXECUTE a service_role en el archivo de migración SQL.
 * 3. Ausencia absoluta de grants directos a clientes (authenticated / anon / public).
 * 4. Presencia obligatoria de 'security definer' y 'set search_path = ''' en las 24 funciones.
 * 5. Invariante de servidor: server.ts deriva p_actor_id y p_created_by estrictamente de req.user!.id,
 *    no contiene escrituras PostgREST directas en audit_logs/admin_alerts ni fallbacks silenciosos.
 * 6. Robustez de la suite de integración: try/finally, orden FK (table_sessions -> reservation_tables -> reservations -> tables) y preservación de auditoría.
 */

import fs from 'node:fs';
import path from 'node:path';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: string;
}

const results: TestResult[] = [];

function assert(condition: boolean, name: string, details?: string) {
  if (condition) {
    results.push({ name, passed: true, details });
  } else {
    results.push({ name, passed: false, error: 'Assertion failed', details });
  }
}

console.log('================================================================================');
console.log('🛡️  EJECUTANDO TESTS UNITARIOS Y ESTÁTICOS: MIGRACIÓN 5 (24 RPCs + SERVER.TS)');
console.log('================================================================================\n');

const migration5Path = path.resolve(
  process.cwd(),
  'supabase/migrations/20261112100000_lifecycle_sessions_and_reporting.sql',
);
const serverPath = path.resolve(process.cwd(), 'server.ts');
const integrationTestPath = path.resolve(process.cwd(), 'src/test/postgres-concurrency-integration.test.ts');

const migrationSql = fs.readFileSync(migration5Path, 'utf-8');
const serverTs = fs.readFileSync(serverPath, 'utf-8');
const integrationTestTs = fs.readFileSync(integrationTestPath, 'utf-8');

// -----------------------------------------------------------------------------
// 1. Verificación de Permisos RPC en Migración 5 (24 funciones *_tx)
// -----------------------------------------------------------------------------
const rpcNames = [
  'create_table_tx',
  'delete_virgin_table_tx',
  'change_table_capacity_tx',
  'set_table_status_tx',
  'initialize_floor_plan_tx',
  'update_operational_settings_tx',
  'review_admin_alert_tx',
  'create_reservation_with_tables_tx',
  'cancel_reservation_tx',
  'reassign_reservation_tables_tx',
  'seat_reservation_tx',
  'no_show_reservation_tx',
  'complete_service_tx',
  'open_walk_in_session_tx',
  'extend_table_session_tx',
  'close_walk_in_session_tx',
  'release_table_operational_tx',
  'set_user_profile_status_tx',
  'transfer_user_profile_role_tx',
  'begin_user_auth_operation_tx',
  'mark_user_auth_dispatched_tx',
  'complete_user_auth_operation_tx',
  'fail_user_auth_operation_tx',
  'reconcile_user_auth_operation_tx',
];

for (const rpc of rpcNames) {
  const revokeRegex = new RegExp(
    `revoke\\s+all\\s+on\\s+function\\s+public\\.${rpc}\\([^)]*\\)\\s+from\\s+public,\\s*anon,\\s*authenticated`,
    'i',
  );
  assert(
    revokeRegex.test(migrationSql),
    `RPC ${rpc}: Revocación obligatoria de EXECUTE para public, anon y authenticated`,
    `Verifica revoke all on function public.${rpc}(...) from public, anon, authenticated`,
  );

  const grantServiceRoleRegex = new RegExp(
    `grant\\s+execute\\s+on\\s+function\\s+public\\.${rpc}\\([^)]*\\)\\s+to\\s+service_role;`,
    'i',
  );
  assert(
    grantServiceRoleRegex.test(migrationSql),
    `RPC ${rpc}: Concesión de EXECUTE estrictamente a service_role`,
    `Verifica grant execute on function public.${rpc}(...) to service_role`,
  );

  const vulnerableGrantRegex = new RegExp(
    `grant\\s+execute\\s+on\\s+function\\s+public\\.${rpc}\\([^)]*\\)\\s+to\\s+[^;]*(authenticated|anon|public)`,
    'i',
  );
  assert(
    !vulnerableGrantRegex.test(migrationSql),
    `RPC ${rpc}: Ausencia de grants directos a clientes (authenticated / anon / public)`,
    `Garantiza que ningún cliente directo de PostgREST pueda invocar ${rpc}`,
  );

  const funcDefRegex = new RegExp(
    `create\\s+(or\\s+replace\\s+)?function\\s+public\\.${rpc}\\([\\s\\S]*?security\\s+definer[\\s\\S]*?set\\s+search_path\\s*=\\s*''`,
    'i',
  );
  assert(
    funcDefRegex.test(migrationSql),
    `RPC ${rpc}: Definición segura con SECURITY DEFINER y search_path vacío`,
    'Impide secuestro de esquemas o funciones durante ejecución privilegiada',
  );
}

// -----------------------------------------------------------------------------
// 2. Verificación de Invariantes de Actor y Eliminación de Escrituras Directas en server.ts
// -----------------------------------------------------------------------------
assert(
  serverTs.includes('p_actor_id: req.user!.id'),
  'server.ts: p_actor_id se deriva estrictamente de req.user!.id',
  'Evita suplantación de identidad del actor en endpoints transaccionales',
);

assert(
  serverTs.includes('p_created_by: req.user!.id'),
  'server.ts: p_created_by se deriva estrictamente de req.user!.id',
  'Garantiza que la reserva queda registrada con el ID del usuario de la sesión autenticada',
);

assert(
  !/p_actor_id\s*:\s*req\.body/i.test(serverTs),
  'server.ts: Ningún endpoint acepta p_actor_id desde req.body',
  'Comprueba que el body del cliente no pueda sobreescribir el actor del audit log',
);

assert(
  !/p_created_by\s*:\s*req\.body/i.test(serverTs),
  'server.ts: Ningún endpoint acepta p_created_by desde req.body',
  'Comprueba que el body del cliente no pueda sobreescribir el creador de la reserva',
);

assert(
  !/supabaseAdmin[\s\S]{0,80}\.from\(\s*['"](audit_logs|admin_alerts|tables|reservations|profiles|operational_settings)['"]\s*\)\s*\.\s*(insert|update|delete|upsert)\(/i.test(serverTs),
  'server.ts: Cero escrituras PostgREST directas en tablas críticas (todo pasa por *_tx)',
  'Garantiza cumplimiento estricto de los triggers diferidos de auditoría de Migración 5',
);

assert(
  !serverTs.includes('does not exist'),
  'server.ts: Cero fallbacks silenciosos ante errores de esquema ("does not exist")',
  'Cumple política estricta de fallar en voz alta sin fallback a memoria demo',
);

assert(
  !/p_resolution\s*:/i.test(serverTs),
  'server.ts: Cero usos de parámetro obsoleto p_resolution en set_table_status_tx',
  'La desactivación de mesa ya no cancela reservas en cascada',
);

// -----------------------------------------------------------------------------
// 3. Verificación de Robustez de Limpieza en la Suite de Integración
// -----------------------------------------------------------------------------
assert(
  integrationTestTs.includes('finally {') && integrationTestTs.includes('testRunId'),
  'Integration Test: Limpieza acotada encapsulada en bloque finally',
  'Asegura que el desmontaje se ejecute incluso ante excepciones o fallos en escenarios',
);

assert(
  integrationTestTs.includes('createdTableIds') && integrationTestTs.includes(".in('id', createdTableIds)"),
  'Integration Test: Rastreo y eliminación de mesas acotadas por ID específico',
  'Evita borrado indiscriminado de tablas al restringir por IDs creados',
);

const tsDeleteMatch = integrationTestTs.search(/client\s*\.\s*from\(\s*['"]table_sessions['"]\s*\)\s*\.\s*delete\(\)/);
const rtDeleteMatch = integrationTestTs.search(/client\s*\.\s*from\(\s*['"]reservation_tables['"]\s*\)\s*\.\s*delete\(\)/);
const rDeleteMatch = integrationTestTs.search(/client\s*\.\s*from\(\s*['"]reservations['"]\s*\)\s*\.\s*delete\(\)/);
const tDeleteMatch = integrationTestTs.search(/client\s*\.\s*from\(\s*['"]tables['"]\s*\)\s*\.\s*delete\(\)/);

assert(
  tsDeleteMatch !== -1 &&
    rtDeleteMatch !== -1 &&
    rDeleteMatch !== -1 &&
    tDeleteMatch !== -1 &&
    tsDeleteMatch < rtDeleteMatch &&
    rtDeleteMatch < rDeleteMatch &&
    rDeleteMatch < tDeleteMatch,
  'Integration Test: Orden de limpieza respeta integridad referencial (TS -> RT -> R -> T)',
  'Elimina table_sessions antes de reservation_tables, reservations y tables',
);

assert(
  !integrationTestTs.includes("client.from('audit_logs').delete()"),
  'Integration Test: audit_logs se preserva inmutable sin eliminaciones',
  'Cumple con la garantía de inmutabilidad del log de auditoría',
);

// -----------------------------------------------------------------------------
// Reporte de resultados
// -----------------------------------------------------------------------------
let allPassed = true;
for (const res of results) {
  if (res.passed) {
    console.log(`✅ [PASS] ${res.name}`);
    if (res.details) console.log(`          ↳ ${res.details}`);
  } else {
    allPassed = false;
    console.error(`❌ [FAIL] ${res.name}: ${res.error}`);
    if (res.details) console.error(`          ↳ ${res.details}`);
  }
}

console.log('\n--------------------------------------------------------------------------------');
if (allPassed) {
  console.log(`🎉 TODAS LAS VERIFICACIONES LOCALES PASARON EXITOSAMENTE (${results.length}/${results.length})`);
  process.exit(0);
} else {
  console.error('💥 ALGUNAS VERIFICACIONES FALLARON');
  process.exit(1);
}
