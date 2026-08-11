import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { closeDb, getSqlite, refreshFtsAvailability } from '@/server/db';
import { runMigrations } from '@/server/db/migrator';
import { seedDatabase } from '@/server/db/seed-data';
import { resetEnvCache, getEnv } from '@/server/env';
import { resetRateLimits } from '@/server/http/middleware/rate-limit';

/**
 * Integration test harness.
 *
 * Each suite gets a fresh SQLite file plus upload directory, migrates it, and
 * (optionally) seeds it. Requests go through the real Hono app via
 * `app.request()`, so middleware, validation, authorization and the error
 * mapper are all exercised — not just the services underneath.
 */

export interface TestContext {
  /** Send a request through the real Hono app, carrying cookies and CSRF. */
  request: (method: string, path: string, options?: RequestOptions) => Promise<TestResponse>;
  /** Log in and keep the session for subsequent requests on this client. */
  login: (email: string, password: string) => Promise<TestResponse>;
  logout: () => Promise<TestResponse>;
  /** A second, independent cookie jar — for concurrency and ownership tests. */
  newClient: () => TestContext;
  cookies: () => string;
  cleanup: () => void;
}

export interface RequestOptions {
  body?: unknown;
  formData?: FormData;
  headers?: Record<string, string>;
  /** Omit the Origin header, simulating a non-browser client. */
  noOrigin?: boolean;
  /** Send a deliberately wrong Origin, simulating a cross-site attempt. */
  origin?: string;
  /** Skip the X-CSRF-Token header even when one is available. */
  skipCsrf?: boolean;
}

export interface TestResponse {
  status: number;
  headers: Headers;
  body: unknown;
  /** `body.data` for convenience, typed by the caller. */
  data: <T>() => T;
  error: () => { code: string; message: string; details?: Record<string, unknown> } | null;
}

const APP_ORIGIN = 'http://localhost:3000';

export const SEED_ACCOUNTS = {
  admin: { email: 'admin@publishflow.local', password: 'AdminDemo123!ChangeMe' },
  editor: { email: 'editor@publishflow.local', password: 'EditorDemo123!ChangeMe' },
  author: { email: 'author@publishflow.local', password: 'AuthorDemo123!ChangeMe' },
  author2: { email: 'author2@publishflow.local', password: 'Author2Demo123!ChangeMe' },
} as const;

/**
 * Point the process at a brand-new database file and migrate it.
 * Must run before the Hono app module reads the environment.
 */
export async function setupTestDatabase(options: { seed?: boolean } = {}): Promise<() => void> {
  const dir = path.join(
    os.tmpdir(),
    'publishflow-tests',
    `case-${crypto.randomBytes(8).toString('hex')}`,
  );
  fs.mkdirSync(dir, { recursive: true });

  closeDb();
  process.env.DATABASE_PATH = path.join(dir, 'test.db');
  process.env.UPLOAD_DIR = path.join(dir, 'uploads');
  resetEnvCache();
  resetRateLimits();

  const sqlite = getSqlite();
  runMigrations(sqlite, { enableFts: getEnv().ENABLE_FTS });
  refreshFtsAvailability();

  if (options.seed !== false) {
    await seedDatabase();
  }

  return () => {
    closeDb();
    fs.rmSync(dir, { recursive: true, force: true });
  };
}

/** Build a client with its own cookie jar. */
export function createClient(): TestContext {
  const jar = new Map<string, string>();

  const readCookies = (): string =>
    [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');

  const storeCookies = (response: Response): void => {
    for (const entry of response.headers.getSetCookie?.() ?? []) {
      const pair = entry.split(';')[0];
      if (!pair) continue;
      const index = pair.indexOf('=');
      if (index <= 0) continue;
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      // An empty value with Max-Age=0 is a deletion.
      if (value === '' || /max-age=0/i.test(entry)) jar.delete(name);
      else jar.set(name, value);
    }
  };

  const request = async (
    method: string,
    urlPath: string,
    options: RequestOptions = {},
  ): Promise<TestResponse> => {
    // Imported lazily so the app reads the test database path set above.
    const { app } = await import('@/server/http/app');

    const headers: Record<string, string> = {
      host: 'localhost:3000',
      ...options.headers,
    };

    if (!options.noOrigin) headers.origin = options.origin ?? APP_ORIGIN;

    const cookieHeader = readCookies();
    if (cookieHeader) headers.cookie = cookieHeader;

    if (options.body !== undefined) headers['content-type'] = 'application/json';

    const csrf = jar.get('pf_csrf');
    if (csrf && !options.skipCsrf && method.toUpperCase() !== 'GET') {
      headers['x-csrf-token'] = csrf;
    }

    const response = await app.request(`${APP_ORIGIN}/api/v1${urlPath}`, {
      method,
      headers,
      body:
        options.formData ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
    });

    storeCookies(response);

    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }

    return {
      status: response.status,
      headers: response.headers,
      body,
      data: <T>() => (body as { data: T })?.data,
      error: () =>
        (body as { error?: { code: string; message: string; details?: Record<string, unknown> } })
          ?.error ?? null,
    };
  };

  const context: TestContext = {
    request,
    login: (email, password) => request('POST', '/auth/login', { body: { email, password } }),
    logout: () => request('POST', '/auth/logout'),
    newClient: () => createClient(),
    cookies: readCookies,
    cleanup: () => jar.clear(),
  };

  return context;
}

/** Convenience: a client already signed in as one of the seeded accounts. */
export async function signedInAs(role: keyof typeof SEED_ACCOUNTS): Promise<TestContext> {
  const client = createClient();
  const account = SEED_ACCOUNTS[role];
  const response = await client.login(account.email, account.password);
  if (response.status !== 200) {
    throw new Error(`Test login failed for ${role}: ${JSON.stringify(response.body)}`);
  }
  return client;
}

/** Raw SQLite access for assertions that should bypass the service layer. */
export function sqliteHandle() {
  return getSqlite();
}

/** A minimal, genuinely valid 1x1 PNG. */
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** A GIF — a real image, but not on the allow-list. */
export const TINY_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);
