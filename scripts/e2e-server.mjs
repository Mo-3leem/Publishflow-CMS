/**
 * E2E server bootstrap.
 *
 * Playwright starts this instead of `next start` so the run is fully
 * self-contained: it rebuilds the E2E database from scratch, migrates and seeds
 * it, then launches the production server. That keeps the developer database
 * untouched and makes every run start from identical, known data.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, '.e2e');

process.env.NODE_ENV = 'production';
process.env.DATABASE_PATH = process.env.DATABASE_PATH ?? './.e2e/publishflow-e2e.db';
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR ?? './.e2e/uploads';

// Deterministic secrets: this database is disposable and never leaves the repo.
process.env.SESSION_SECRET ??= 'e2e-session-secret-0123456789abcdefghijkl';
process.env.CSRF_SECRET ??= 'e2e-csrf-secret-0123456789abcdefghijklmno';
process.env.VIEWER_HASH_SECRET ??= 'e2e-viewer-secret-0123456789abcdefghijk';
process.env.SCHEDULE_JOB_SECRET ??= 'e2e-job-secret-0123456789abcdefghijklmn';
process.env.SESSION_COOKIE_NAME ??= 'pf_session';
process.env.LOG_LEVEL ??= 'error';
process.env.ENABLE_FTS ??= 'true';
process.env.SITE_TIMEZONE ??= 'UTC';

process.env.SEED_ADMIN_EMAIL ??= 'admin@publishflow.local';
process.env.SEED_ADMIN_PASSWORD ??= 'AdminDemo123!ChangeMe';
process.env.SEED_EDITOR_EMAIL ??= 'editor@publishflow.local';
process.env.SEED_EDITOR_PASSWORD ??= 'EditorDemo123!ChangeMe';
process.env.SEED_AUTHOR_EMAIL ??= 'author@publishflow.local';
process.env.SEED_AUTHOR_PASSWORD ??= 'AuthorDemo123!ChangeMe';
process.env.SEED_AUTHOR2_EMAIL ??= 'author2@publishflow.local';
process.env.SEED_AUTHOR2_PASSWORD ??= 'Author2Demo123!ChangeMe';

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: process.env,
    });
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited ${code}`)),
    );
    child.on('error', reject);
  });
}

async function main() {
  // Start from a clean database so tests never inherit state from a previous run.
  rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });

  await run('node', [
    'node_modules/tsx/dist/cli.mjs',
    '--conditions=react-server',
    'src/server/db/migrate.ts',
  ]);
  await run('node', [
    'node_modules/tsx/dist/cli.mjs',
    '--conditions=react-server',
    'src/server/db/seed.ts',
  ]);

  if (!existsSync(path.join(root, '.next', 'BUILD_ID'))) {
    throw new Error('Run "pnpm build" before "pnpm test:e2e" — .next is missing.');
  }

  // `next start` serves the same production build as the standalone bundle, but
  // from the repository's own node_modules. The standalone output is what the
  // Docker image ships; running it here would trip over pnpm's symlinked store
  // on Windows, and it adds nothing the tests can observe.
  const server = spawn(
    'node',
    [
      path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next'),
      'start',
      '-H',
      '127.0.0.1',
      '-p',
      String(process.env.PORT ?? 3100),
    ],
    {
      cwd: root,
      stdio: 'inherit',
      env: process.env,
    },
  );

  const shutdown = () => {
    server.kill();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  server.on('exit', (code) => process.exit(code ?? 0));
}

main().catch((error) => {
  console.error('[e2e-server]', error.message);
  process.exit(1);
});
