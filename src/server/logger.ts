import 'server-only';
import { getEnv } from '@/server/env';

/**
 * Small structured logger.
 *
 * Deliberately tiny: the assignment does not justify a logging framework. Values
 * are shallow-redacted so a careless call site cannot leak a token or password.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level | 'silent', number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

const REDACT_KEYS = new Set([
  'password',
  'newpassword',
  'currentpassword',
  'passwordhash',
  'password_hash',
  'token',
  'tokenhash',
  'token_hash',
  'sessiontoken',
  'cookie',
  'authorization',
  'csrf',
  'csrftoken',
  'secret',
  'content',
]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 3) return '[truncated]';
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redact(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    out[key] = REDACT_KEYS.has(key.toLowerCase()) ? '[redacted]' : redact(raw, depth + 1);
  }
  return out;
}

function emit(level: Level, message: string, context?: Record<string, unknown>): void {
  const configured = getEnv().LOG_LEVEL;
  if (LEVEL_ORDER[level] < LEVEL_ORDER[configured]) return;

  const record = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...(context ? (redact(context) as Record<string, unknown>) : {}),
  };

  const line = JSON.stringify(record);
  if (level === 'error') {
    console.error(line);
  } else {
    console.warn(line);
  }
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => emit('debug', message, context),
  info: (message: string, context?: Record<string, unknown>) => emit('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => emit('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => emit('error', message, context),
};
