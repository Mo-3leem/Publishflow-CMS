import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { afterAll, beforeAll } from 'vitest';

/**
 * Global test setup.
 *
 * Every test file gets its own temporary database and upload directory, well
 * away from the developer's data/ and uploads/. Vitest runs files in separate
 * forks, so the per-file isolation holds even when files run in parallel.
 */

const runId = crypto.randomBytes(6).toString('hex');
const root = path.join(os.tmpdir(), 'publishflow-tests', runId);

// `NODE_ENV` is typed as read-only by @types/node; tests legitimately need to
// set it before any module reads the environment.
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.APP_URL = 'http://localhost:3000';
process.env.DATABASE_PATH = path.join(root, 'test.db');
process.env.UPLOAD_DIR = path.join(root, 'uploads');
process.env.SESSION_SECRET = 'test-session-secret-0123456789abcdefghij';
process.env.CSRF_SECRET = 'test-csrf-secret-0123456789abcdefghijkl';
process.env.VIEWER_HASH_SECRET = 'test-viewer-secret-0123456789abcdefghij';
process.env.SCHEDULE_JOB_SECRET = 'test-job-secret-0123456789abcdefghijklm';
process.env.SESSION_COOKIE_NAME = 'pf_session';
process.env.SESSION_TTL_HOURS = '168';
process.env.MAX_JSON_BYTES = '1048576';
process.env.MAX_UPLOAD_BYTES = '5242880';
process.env.ENABLE_FTS = 'true';
process.env.SITE_TIMEZONE = 'UTC';
// Keep test output readable; the logger is exercised directly in unit tests.
process.env.LOG_LEVEL = 'silent';
process.env.TRUST_PROXY = 'false';

beforeAll(() => {
  fs.mkdirSync(root, { recursive: true });
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});
