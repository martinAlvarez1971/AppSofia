/**
 * SOFIA · Compuerta de Seguridad de Entorno para Integración y Pruebas PostgreSQL
 * Archivo: src/test/environment-safety-gate.ts
 *
 * MÓDULO CRÍTICO DE AISLAMIENTO:
 * Garantiza que ninguna prueba de integración, migración o escritura transaccional
 * pueda ejecutarse contra una base de datos no verificada o de producción.
 *
 * CUMPLE LOS 10 REQUISITOS OBLIGATORIOS:
 * 1. Utiliza exclusivamente SUPABASE_TEST_URL y SUPABASE_TEST_SERVICE_ROLE_KEY.
 * 2. Se detiene sin escrituras si falta alguna variable.
 * 3. Exige confirmación explícita (SUPABASE_TEST_ENVIRONMENT_CONFIRMED === 'true').
 * 4. Prohíbe y bloquea cualquier fallback automático a SUPABASE_URL o credenciales de producción.
 * 5. Muestra identificador y URL con todos los secretos completamente enmascarados/redactados.
 * 6. Comprueba coincidencia exacta con SUPABASE_TEST_PROJECT_REF autorizado.
 * 7. No ejecuta migraciones ni pruebas destructivas al inicio del servidor.
 * 8. Provee testRunId único para etiquetar y limpiar exclusivamente datos de la ejecución.
 * 9. Registra el balance entre pruebas ejecutadas en PostgreSQL vs pendientes.
 * 10. No muta esquemas ni aplica migraciones sin orden explícita.
 */

import crypto from 'crypto';

export interface SafetyGateVerification {
  isAuthorized: boolean;
  canExecuteDatabaseWrites: boolean;
  reason: string;
  projectRef: string | null;
  sanitizedUrl: string | null;
  maskedKey: string | null;
  testRunId: string;
  failureCode?:
    | 'MISSING_TEST_CREDENTIALS'
    | 'MISSING_EXPLICIT_CONFIRMATION'
    | 'MISSING_AUTHORIZED_PROJECT_REF'
    | 'PROJECT_REF_MISMATCH'
    | 'PRODUCTION_URL_COLLISION'
    | 'INVALID_URL_FORMAT';
}

/**
 * Enmascara credenciales de forma segura.
 * Nunca expone más de 4 caracteres iniciales y oculta el payload del JWT o clave de servicio.
 */
export function maskSecretKey(key?: string | null): string {
  if (!key) return '[NO_CONFIGURADO]';
  if (key.length <= 8) return '[CLAVE_REDACTADA_LONGITUD_INSEGURA]';
  const prefix = key.slice(0, 4);
  const suffix = key.slice(-4);
  return `${prefix}••••••••••••••••[REDACTED_SECRET: ${key.length} chars]••••${suffix}`;
}

/**
 * Sanitiza una URL eliminando credenciales embebidas (user:pass) y queries.
 */
export function sanitizeSupabaseUrl(rawUrl?: string | null): string | null {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '[URL_INVÁLIDA_NO_PARSEABLE]';
  }
}

/**
 * Extrae el project reference de una URL de Supabase (ej: abcdefgh.supabase.co -> abcdefgh)
 * o devuelve el host para entornos locales (localhost, 127.0.0.1).
 */
export function extractProjectRef(rawUrl?: string | null): string | null {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname;
    if (hostname.endsWith('.supabase.co')) {
      return hostname.replace('.supabase.co', '');
    }
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return `local-${hostname}`;
    }
    return hostname;
  } catch {
    return null;
  }
}

/**
 * Genera un identificador único por corrida de prueba.
 * Todas las entidades creadas durante una ejecución deben etiquetarse con este id.
 */
export function generateTestRunId(): string {
  const timestamp = Date.now();
  const randomHex = crypto.randomBytes(4).toString('hex');
  return `sofia-run-${timestamp}-${randomHex}`;
}

/**
 * Verifica rigurosamente la compuerta de seguridad del entorno.
 * Si alguna regla de aislamiento no se cumple, rechaza la ejecución y prohíbe escrituras.
 */
export function verifyEnvironmentSafetyGate(): SafetyGateVerification {
  const testRunId = generateTestRunId();

  // REGLA 1 & 4: Leer EXCLUSIVAMENTE variables de test.
  // Rechazo rotundo a fallbacks de producción.
  const rawTestUrl = process.env.SUPABASE_TEST_URL;
  const rawTestKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
  const rawConfirmed = process.env.SUPABASE_TEST_ENVIRONMENT_CONFIRMED;
  const rawExpectedProjectRef = process.env.SUPABASE_TEST_PROJECT_REF;

  // Variables de producción para detección de colisión prohibida
  const prodUrl = process.env.SUPABASE_URL;
  const prodKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // 1. Validar presencia obligatoria de variables de test
  if (!rawTestUrl || !rawTestKey) {
    return {
      isAuthorized: false,
      canExecuteDatabaseWrites: false,
      reason:
        'Faltan variables SUPABASE_TEST_URL o SUPABASE_TEST_SERVICE_ROLE_KEY. ' +
        'Por regla de seguridad no se aplican fallbacks a credenciales de producción ni escrituras.',
      projectRef: null,
      sanitizedUrl: sanitizeSupabaseUrl(rawTestUrl),
      maskedKey: maskSecretKey(rawTestKey),
      testRunId,
      failureCode: 'MISSING_TEST_CREDENTIALS',
    };
  }

  // 2. Prohibición de colisión con producción (fallback protection)
  if (prodUrl && rawTestUrl.trim().toLowerCase() === prodUrl.trim().toLowerCase()) {
    return {
      isAuthorized: false,
      canExecuteDatabaseWrites: false,
      reason:
        'COLISIÓN DE SEGURIDAD: SUPABASE_TEST_URL coincide exactamente con SUPABASE_URL de producción. ' +
        'Se aborta la ejecución para prevenir escrituras en la base de datos principal.',
      projectRef: extractProjectRef(rawTestUrl),
      sanitizedUrl: sanitizeSupabaseUrl(rawTestUrl),
      maskedKey: maskSecretKey(rawTestKey),
      testRunId,
      failureCode: 'PRODUCTION_URL_COLLISION',
    };
  }

  if (prodKey && rawTestKey.trim() === prodKey.trim()) {
    return {
      isAuthorized: false,
      canExecuteDatabaseWrites: false,
      reason:
        'COLISIÓN DE SEGURIDAD: SUPABASE_TEST_SERVICE_ROLE_KEY coincide con la clave de producción. ' +
        'Se aborta la ejecución para prevenir cualquier mutación con permisos de servicio reales.',
      projectRef: extractProjectRef(rawTestUrl),
      sanitizedUrl: sanitizeSupabaseUrl(rawTestUrl),
      maskedKey: maskSecretKey(rawTestKey),
      testRunId,
      failureCode: 'PRODUCTION_URL_COLLISION',
    };
  }

  // 3. Confirmación explícita requerida
  const isExplicitlyConfirmed =
    rawConfirmed !== undefined && rawConfirmed.trim().toLowerCase() === 'true';
  if (!isExplicitlyConfirmed) {
    return {
      isAuthorized: false,
      canExecuteDatabaseWrites: false,
      reason:
        'Falta confirmación explícita de entorno de pruebas. ' +
        'Debe definirse SUPABASE_TEST_ENVIRONMENT_CONFIRMED=true para autorizar pruebas en la instancia.',
      projectRef: extractProjectRef(rawTestUrl),
      sanitizedUrl: sanitizeSupabaseUrl(rawTestUrl),
      maskedKey: maskSecretKey(rawTestKey),
      testRunId,
      failureCode: 'MISSING_EXPLICIT_CONFIRMATION',
    };
  }

  // 4. Validación de proyecto autorizado (Project Ref)
  const actualProjectRef = extractProjectRef(rawTestUrl);
  if (!actualProjectRef) {
    return {
      isAuthorized: false,
      canExecuteDatabaseWrites: false,
      reason: 'No se pudo derivar el identificador de proyecto (Project Ref) de SUPABASE_TEST_URL.',
      projectRef: null,
      sanitizedUrl: sanitizeSupabaseUrl(rawTestUrl),
      maskedKey: maskSecretKey(rawTestKey),
      testRunId,
      failureCode: 'INVALID_URL_FORMAT',
    };
  }

  if (!rawExpectedProjectRef || rawExpectedProjectRef.trim().length === 0) {
    return {
      isAuthorized: false,
      canExecuteDatabaseWrites: false,
      reason:
        `Falta definir SUPABASE_TEST_PROJECT_REF para certificar que el destino coincida con el proyecto autorizado. ` +
        `Destino detectado: '${actualProjectRef}'.`,
      projectRef: actualProjectRef,
      sanitizedUrl: sanitizeSupabaseUrl(rawTestUrl),
      maskedKey: maskSecretKey(rawTestKey),
      testRunId,
      failureCode: 'MISSING_AUTHORIZED_PROJECT_REF',
    };
  }

  if (rawExpectedProjectRef.trim().toLowerCase() !== actualProjectRef.toLowerCase()) {
    return {
      isAuthorized: false,
      canExecuteDatabaseWrites: false,
      reason:
        `DISCREPANCIA DE DESTINO: El proyecto autorizado en SUPABASE_TEST_PROJECT_REF ('${rawExpectedProjectRef.trim()}') ` +
        `no coincide con el destino de SUPABASE_TEST_URL ('${actualProjectRef}'). Se detiene la ejecución inmediatamente.`,
      projectRef: actualProjectRef,
      sanitizedUrl: sanitizeSupabaseUrl(rawTestUrl),
      maskedKey: maskSecretKey(rawTestKey),
      testRunId,
      failureCode: 'PROJECT_REF_MISMATCH',
    };
  }

  // AUTORIZACIÓN EXITOSA
  return {
    isAuthorized: true,
    canExecuteDatabaseWrites: true,
    reason: 'Compuerta superada exitosamente. Entorno aislado y autorizado verificado.',
    projectRef: actualProjectRef,
    sanitizedUrl: sanitizeSupabaseUrl(rawTestUrl),
    maskedKey: maskSecretKey(rawTestKey),
    testRunId,
  };
}

/**
 * Imprime el reporte de inspección de la compuerta de seguridad en consola.
 * Oculta todos los secretos y muestra con claridad el estado del aislamiento.
 */
export function printSafetyGateReport(verification: SafetyGateVerification): void {
  console.log('╔════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║ 🛡️  SOFIA · COMPUERTA DE SEGURIDAD Y AISLAMIENTO DE ENTORNO (FASE A.2)          ║');
  console.log('╠════════════════════════════════════════════════════════════════════════════════╣');
  console.log(`║ Estado de autorización: ${verification.isAuthorized ? '✅ AUTORIZADO (AISLADO)' : '🛑 BLOQUEADO / NO AUTORIZADO'}    `);
  console.log(`║ Escrituras en BD:       ${verification.canExecuteDatabaseWrites ? 'PERMITIDAS EN INSTANCIA DE PRUEBAS' : 'TOTALMENTE PROHIBIDAS (CERO ESCRITURAS)'} `);
  console.log(`║ URL Destino (sanitizada): ${verification.sanitizedUrl || '[NO CONFIGURADA]'}`);
  console.log(`║ Project Ref Detectado:    ${verification.projectRef || '[NO DETECTADO]'}`);
  console.log(`║ Service Key:              ${verification.maskedKey}`);
  console.log(`║ Test Run ID generado:     ${verification.testRunId}`);
  console.log('╠════════════════════════════════════════════════════════════════════════════════╣');
  console.log(`║ Dictamen: ${verification.reason}`);
  console.log('╚════════════════════════════════════════════════════════════════════════════════╝\n');
}

/**
 * Reporta el estado de ejecución de los escenarios (efectuados vs pendientes).
 */
export interface ScenarioExecutionSummary {
  scenarioNumber: number;
  name: string;
  category: string;
  executedAgainstPostgres: boolean;
  status: 'PASSED' | 'FAILED' | 'SKIPPED_NO_TEST_DB';
  detail: string;
}

export function printScenariosExecutionBalance(scenarios: ScenarioExecutionSummary[]): void {
  const executed = scenarios.filter((s) => s.executedAgainstPostgres);
  const pending = scenarios.filter((s) => !s.executedAgainstPostgres);

  console.log('================================================================================');
  console.log('📊 BALANCE DE EJECUCIÓN TRANSACCIONAL EN POSTGRESQL');
  console.log('================================================================================');
  console.log(`  Total Escenarios Planificados:  ${scenarios.length}`);
  console.log(`  Ejecutados contra PostgreSQL:   ${executed.length}`);
  console.log(`  Pendientes / Pospuestos:        ${pending.length}`);
  console.log('--------------------------------------------------------------------------------');

  for (const s of scenarios) {
    const icon = s.executedAgainstPostgres ? (s.status === 'PASSED' ? '✅' : '❌') : '⏸️ ';
    console.log(
      `${icon} [E${s.scenarioNumber.toString().padStart(2, '0')}] [${s.category}] ${s.name} ` +
      `-> ${s.executedAgainstPostgres ? `EJECUTADO (${s.status})` : 'PENDIENTE (NO EJECUTADO EN BD)'}`
    );
    if (!s.executedAgainstPostgres) {
      console.log(`     Motivo: ${s.detail}`);
    }
  }
  console.log('================================================================================\n');
}
