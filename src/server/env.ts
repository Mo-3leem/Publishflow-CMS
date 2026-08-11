import 'server-only';
import path from 'node:path';
import fs from 'node:fs';
import { z } from 'zod';

/**
 * Validated server-side environment.
 *
 * Fails fast at startup. Placeholder secrets are accepted in development and test
 * (so `cp .env.example .env` works) but rejected outright in production.
 */

const PLACEHOLDER = 'replace-with-at-least-32-random-bytes';

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === 'boolean' ? value : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()),
  );

const positiveInt = (fallback: number) =>
  z.coerce.number().int().positive().catch(fallback).default(fallback);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  DATABASE_PATH: z.string().min(1).default('./data/publishflow.db'),
  UPLOAD_DIR: z.string().min(1).default('./uploads'),
  SESSION_COOKIE_NAME: z.string().min(1).default('pf_session'),
  SESSION_TTL_HOURS: positiveInt(168),
  SESSION_SECRET: z.string().min(16),
  CSRF_SECRET: z.string().min(16),
  VIEWER_HASH_SECRET: z.string().min(16),
  MAX_JSON_BYTES: positiveInt(1_048_576),
  MAX_UPLOAD_BYTES: positiveInt(5_242_880),
  TRUST_PROXY: booleanish.default(false),
  ENABLE_FTS: booleanish.default(true),
  SITE_TIMEZONE: z.string().min(1).default('UTC'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  SEED_ADMIN_EMAIL: z.string().email().default('admin@publishflow.local'),
  SEED_ADMIN_PASSWORD: z.string().min(12).default('AdminDemo123!ChangeMe'),
  SEED_EDITOR_EMAIL: z.string().email().default('editor@publishflow.local'),
  SEED_EDITOR_PASSWORD: z.string().min(12).default('EditorDemo123!ChangeMe'),
  SEED_AUTHOR_EMAIL: z.string().email().default('author@publishflow.local'),
  SEED_AUTHOR_PASSWORD: z.string().min(12).default('AuthorDemo123!ChangeMe'),
  SEED_AUTHOR2_EMAIL: z.string().email().default('author2@publishflow.local'),
  SEED_AUTHOR2_PASSWORD: z.string().min(12).default('Author2Demo123!ChangeMe'),
  SCHEDULE_JOB_SECRET: z.string().min(16),
});

type RawEnv = z.infer<typeof envSchema>;

export interface AppEnv extends RawEnv {
  /** Absolute path to the SQLite file. */
  databaseFile: string;
  /** Absolute path to the upload directory. */
  uploadDir: string;
  isProduction: boolean;
  isTest: boolean;
  /** Cookie name actually used; `__Host-` prefixed over HTTPS in production. */
  sessionCookieName: string;
  csrfCookieName: string;
  visitorCookieName: string;
  secureCookies: boolean;
}

function fail(message: string): never {
  throw new Error(`[env] ${message}`);
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0']);

function isLoopbackUrl(url: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

function buildEnv(source: NodeJS.ProcessEnv): AppEnv {
  // Tests and dev boot from .env.example values; production must not.
  const fallbackSecret = 'publishflow-development-only-secret-value-0123456789';
  const nodeEnv = source.NODE_ENV ?? 'development';
  const relaxed = nodeEnv !== 'production';

  const candidate = {
    ...source,
    SESSION_SECRET: source.SESSION_SECRET || (relaxed ? fallbackSecret : undefined),
    CSRF_SECRET: source.CSRF_SECRET || (relaxed ? fallbackSecret : undefined),
    VIEWER_HASH_SECRET: source.VIEWER_HASH_SECRET || (relaxed ? fallbackSecret : undefined),
    SCHEDULE_JOB_SECRET: source.SCHEDULE_JOB_SECRET || (relaxed ? fallbackSecret : undefined),
  };

  const parsed = envSchema.safeParse(candidate);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    fail(`Invalid environment configuration:\n${issues}`);
  }

  const value = parsed.data;
  const isProduction = value.NODE_ENV === 'production';

  if (isProduction) {
    const placeholders = (
      ['SESSION_SECRET', 'CSRF_SECRET', 'VIEWER_HASH_SECRET', 'SCHEDULE_JOB_SECRET'] as const
    ).filter((key) => value[key] === PLACEHOLDER || value[key].length < 32);
    if (placeholders.length > 0) {
      fail(
        `Refusing to start in production with placeholder or short secrets: ${placeholders.join(', ')}. ` +
          "Generate values with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
      );
    }
    // Plain HTTP is only tolerable when the app is not actually reachable over a
    // network — a loopback host. Anything else in production must be HTTPS,
    // otherwise the session cookie travels in the clear.
    if (value.APP_URL.startsWith('http://') && !isLoopbackUrl(value.APP_URL)) {
      fail('APP_URL must use https:// in production.');
    }
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value.SITE_TIMEZONE });
  } catch {
    fail(`SITE_TIMEZONE "${value.SITE_TIMEZONE}" is not a valid IANA timezone.`);
  }

  // These paths are resolved at runtime from the environment, not at build time.
  // The turbopackIgnore hints stop the bundler from tracing the whole project in
  // an attempt to statically follow them.
  const databaseFile = path.resolve(/* turbopackIgnore: true */ process.cwd(), value.DATABASE_PATH);
  const uploadDir = path.resolve(/* turbopackIgnore: true */ process.cwd(), value.UPLOAD_DIR);

  fs.mkdirSync(path.dirname(databaseFile), { recursive: true });
  fs.mkdirSync(uploadDir, { recursive: true });

  const secureCookies = isProduction && value.APP_URL.startsWith('https://');

  return {
    ...value,
    databaseFile,
    uploadDir,
    isProduction,
    isTest: value.NODE_ENV === 'test',
    // __Host- requires Secure + Path=/ + no Domain, so it only applies over HTTPS.
    sessionCookieName: secureCookies
      ? `__Host-${value.SESSION_COOKIE_NAME}`
      : value.SESSION_COOKIE_NAME,
    csrfCookieName: secureCookies ? '__Host-pf_csrf' : 'pf_csrf',
    visitorCookieName: secureCookies ? '__Host-pf_visitor' : 'pf_visitor',
    secureCookies,
  };
}

let cached: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (!cached) {
    cached = buildEnv(process.env);
  }
  return cached;
}

/** Test-only: force the env to be re-read (used when a suite swaps DATABASE_PATH). */
export function resetEnvCache(): void {
  cached = null;
}

export const env: AppEnv = new Proxy({} as AppEnv, {
  get(_target, prop: string) {
    return getEnv()[prop as keyof AppEnv];
  },
  has(_target, prop: string) {
    return prop in getEnv();
  },
  ownKeys() {
    return Reflect.ownKeys(getEnv());
  },
  getOwnPropertyDescriptor(_target, prop) {
    return Object.getOwnPropertyDescriptor(getEnv(), prop);
  },
});
