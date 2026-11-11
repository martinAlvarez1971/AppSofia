/**
 * SOFIA · Pruebas Unitarias de la Compuerta de Seguridad de Entorno
 * Archivo: src/test/unit-environment-safety-gate.test.ts
 */

import {
  verifyEnvironmentSafetyGate,
  maskSecretKey,
  sanitizeSupabaseUrl,
  extractProjectRef,
  generateTestRunId,
} from './environment-safety-gate.js';

interface TestCaseResult {
  name: string;
  passed: boolean;
  expected: string;
  received: string;
}

const testResults: TestCaseResult[] = [];

function assert(condition: boolean, name: string, expected: string, received: string) {
  testResults.push({
    name,
    passed: condition,
    expected,
    received,
  });
}

// Guardar env original
const originalEnv = { ...process.env };

function resetEnv() {
  process.env = { ...originalEnv };
  delete process.env.SUPABASE_TEST_URL;
  delete process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_TEST_ENVIRONMENT_CONFIRMED;
  delete process.env.SUPABASE_TEST_PROJECT_REF;
}

console.log('🧪 Iniciando verificación de la Compuerta de Seguridad de Entorno...\n');

// 1. Sanitización de URL y enmascaramiento de secretos
const testKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.supersecretkey99999.xyz1234';
const masked = maskSecretKey(testKey);
assert(
  !masked.includes('supersecretkey99999') && masked.includes('chars]'),
  'Enmascaramiento de secretos',
  'No debe contener el secreto original en texto plano',
  masked
);

const sanitized = sanitizeSupabaseUrl('https://isolated-test-db.supabase.co/rest/v1/?apikey=secret');
assert(
  sanitized === 'https://isolated-test-db.supabase.co',
  'Sanitización de URL',
  'https://isolated-test-db.supabase.co',
  sanitized || ''
);

const projectRef = extractProjectRef('https://isolated-test-db.supabase.co');
assert(
  projectRef === 'isolated-test-db',
  'Extracción de Project Ref',
  'isolated-test-db',
  projectRef || ''
);

// 2. Faltan variables obligatorias -> Rechazo y Cero Escrituras
resetEnv();
const missingResult = verifyEnvironmentSafetyGate();
assert(
  !missingResult.isAuthorized &&
    !missingResult.canExecuteDatabaseWrites &&
    missingResult.failureCode === 'MISSING_TEST_CREDENTIALS',
  'Rechazo por falta de variables SUPABASE_TEST_*',
  'isAuthorized=false, canExecuteDatabaseWrites=false, failureCode=MISSING_TEST_CREDENTIALS',
  `isAuthorized=${missingResult.isAuthorized}, failureCode=${missingResult.failureCode}`
);

// 3. Intento de colisión con producción (fallback no autorizado)
resetEnv();
process.env.SUPABASE_URL = 'https://prod-sofia.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'prod-secret-key-12345';
process.env.SUPABASE_TEST_URL = 'https://prod-sofia.supabase.co'; // Intento de apuntar al mismo host
process.env.SUPABASE_TEST_SERVICE_ROLE_KEY = 'test-isolated-key-99999';
process.env.SUPABASE_TEST_ENVIRONMENT_CONFIRMED = 'true';
process.env.SUPABASE_TEST_PROJECT_REF = 'prod-sofia';

const collisionResult = verifyEnvironmentSafetyGate();
assert(
  !collisionResult.isAuthorized && collisionResult.failureCode === 'PRODUCTION_URL_COLLISION',
  'Prevención de colisión con URL de producción',
  'failureCode=PRODUCTION_URL_COLLISION',
  `failureCode=${collisionResult.failureCode}`
);

// 4. Falta de confirmación explícita de entorno
resetEnv();
process.env.SUPABASE_TEST_URL = 'https://test-sandbox-sofia.supabase.co';
process.env.SUPABASE_TEST_SERVICE_ROLE_KEY = 'test-isolated-key-99999';
process.env.SUPABASE_TEST_PROJECT_REF = 'test-sandbox-sofia';
// SUPABASE_TEST_ENVIRONMENT_CONFIRMED no definido

const unconfirmedResult = verifyEnvironmentSafetyGate();
assert(
  !unconfirmedResult.isAuthorized &&
    unconfirmedResult.failureCode === 'MISSING_EXPLICIT_CONFIRMATION',
  'Rechazo por falta de confirmación explícita (CONFIRMED != true)',
  'failureCode=MISSING_EXPLICIT_CONFIRMATION',
  `failureCode=${unconfirmedResult.failureCode}`
);

// 5. Project Ref no coincide con la URL
resetEnv();
process.env.SUPABASE_TEST_URL = 'https://test-sandbox-sofia.supabase.co';
process.env.SUPABASE_TEST_SERVICE_ROLE_KEY = 'test-isolated-key-99999';
process.env.SUPABASE_TEST_ENVIRONMENT_CONFIRMED = 'true';
process.env.SUPABASE_TEST_PROJECT_REF = 'wrong-target-project';

const mismatchResult = verifyEnvironmentSafetyGate();
assert(
  !mismatchResult.isAuthorized && mismatchResult.failureCode === 'PROJECT_REF_MISMATCH',
  'Rechazo por discrepancia entre Project Ref autorizado y URL',
  'failureCode=PROJECT_REF_MISMATCH',
  `failureCode=${mismatchResult.failureCode}`
);

// 6. Configuración válida, aislada y confirmada -> Aprobación
resetEnv();
process.env.SUPABASE_TEST_URL = 'https://test-sandbox-sofia.supabase.co';
process.env.SUPABASE_TEST_SERVICE_ROLE_KEY = 'test-isolated-key-99999';
process.env.SUPABASE_TEST_ENVIRONMENT_CONFIRMED = 'true';
process.env.SUPABASE_TEST_PROJECT_REF = 'test-sandbox-sofia';

const validResult = verifyEnvironmentSafetyGate();
assert(
  validResult.isAuthorized &&
    validResult.canExecuteDatabaseWrites &&
    validResult.projectRef === 'test-sandbox-sofia' &&
    validResult.testRunId.startsWith('sofia-run-'),
  'Autorización exitosa con credenciales aisladas verificadas',
  'isAuthorized=true, canExecuteDatabaseWrites=true',
  `isAuthorized=${validResult.isAuthorized}, canExecuteWrites=${validResult.canExecuteDatabaseWrites}`
);

// 7. Generación de identificador único de corrida (testRunId)
const runId1 = generateTestRunId();
const runId2 = generateTestRunId();
assert(
  runId1 !== runId2 && runId1.startsWith('sofia-run-'),
  'Generación de testRunId únicos e irrepetibles',
  'runId1 !== runId2',
  `runId1=${runId1}, runId2=${runId2}`
);

// Restaurar entorno
process.env = originalEnv;

// Imprimir reporte de pruebas
console.log('--------------------------------------------------------------------------------');
console.log('📋 RESULTADOS DE VERIFICACIÓN DE LA COMPUERTA DE SEGURIDAD');
console.log('--------------------------------------------------------------------------------');
let allPassed = true;
for (const r of testResults) {
  const icon = r.passed ? '✅' : '❌';
  if (!r.passed) allPassed = false;
  console.log(`${icon} ${r.name}`);
  if (!r.passed) {
    console.log(`   Esperado: ${r.expected}`);
    console.log(`   Recibido: ${r.received}`);
  }
}
console.log('--------------------------------------------------------------------------------');
console.log(`Total: ${testResults.length} pruebas | Pasadas: ${testResults.filter((r) => r.passed).length} | Falladas: ${testResults.filter((r) => !r.passed).length}`);

if (!allPassed) {
  console.error('\n❌ Algunas pruebas de la compuerta de seguridad fallaron.');
  process.exit(1);
} else {
  console.log('\n✅ Todas las pruebas de la compuerta de seguridad pasaron con éxito.');
}
