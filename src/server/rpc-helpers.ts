import crypto from 'node:crypto';
import type { Request } from 'express';

export interface PostgrestLikeError {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
}

export interface HttpMappedError {
  status: number;
  message: string;
  code?: string;
}

/**
 * Normaliza recursivamente valores JSON ordenando claves alfabéticamente
 * para garantizar hashing SHA-256 determinista independientemente del orden
 * de las propiedades en el cuerpo HTTP.
 */
export function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sortedKeys = Object.keys(record).sort();
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      if (record[key] !== undefined) {
        result[key] = canonicalize(record[key]);
      }
    }
    return result;
  }
  return value;
}

/**
 * Calcula un hash SHA-256 estable de un payload de solicitud RPC.
 */
export function computeRequestHash(payload: unknown): string {
  const canonicalJson = JSON.stringify(canonicalize(payload));
  return crypto.createHash('sha256').update(canonicalJson).digest('hex');
}

/**
 * Extrae el encabezado Idempotency-Key (o X-Idempotency-Key) de la petición.
 * Si el cliente no lo envía, genera un UUIDv4 por invocación única.
 */
export function extractIdempotencyKey(req: Pick<Request, 'headers'>): string {
  const raw = req.headers['idempotency-key'] ?? req.headers['x-idempotency-key'];
  if (typeof raw === 'string' && raw.trim().length > 0 && raw.trim().length <= 200) {
    return raw.trim();
  }
  if (Array.isArray(raw) && typeof raw[0] === 'string' && raw[0].trim().length > 0 && raw[0].trim().length <= 200) {
    return raw[0].trim();
  }
  return crypto.randomUUID();
}

export type AuthSagaStep = 'begin' | 'dispatch' | 'complete' | 'fail' | 'reconcile';

/**
 * Deriva claves de idempotencia independientes por fase dentro de una saga Auth
 * multi-paso, evitando colisiones entre RPCs de distintas fases.
 */
export function deriveSagaStepKey(baseKey: string, step: AuthSagaStep): string {
  return `${baseKey}:${step}`;
}

/**
 * Traduce códigos SQLSTATE de PostgreSQL / PostgREST (incluyendo códigos custom
 * SF409, SF422, SF500 de Migración 5) a códigos HTTP precisos y mensajes seguros.
 */
export function mapRpcErrorToHttp(
  pgError: PostgrestLikeError | null | undefined,
  fallbackMessage = 'Error de persistencia en PostgreSQL.'
): HttpMappedError {
  if (!pgError) {
    return { status: 500, message: fallbackMessage };
  }

  const code = (pgError.code || '').toUpperCase();
  const message = pgError.message?.trim() || fallbackMessage;

  switch (code) {
    case 'SF409':
    case '23P01':
    case '23505':
    case 'P0001':
      return { status: 409, message, code };

    case 'SF422':
      return { status: 422, message, code };

    case 'P0002':
      return { status: 404, message, code };

    case '42501':
      return { status: 403, message, code };

    case '22023':
    case '22003':
    case '22P02':
      return { status: 400, message, code };

    case 'SF500':
    case '55000':
    case '40P01':
    default:
      return { status: 500, message, code: code || undefined };
  }
}
