/**
 * First-run bootstrap for a container deployment.
 *
 * Creates the initial administrator so a fresh deployment is reachable at all.
 * Idempotent and non-destructive: if an active administrator already exists it
 * does nothing, so it is safe to run again by mistake.
 *
 * Plain JavaScript for the same reason as docker/migrate.mjs — the runtime
 * image ships no TypeScript toolchain. It reuses the argon2 and better-sqlite3
 * copies that the Next.js standalone trace already includes.
 *
 *   docker compose run --rm app node docker/seed.mjs
 */
import Database from 'better-sqlite3';
import argon2 from 'argon2';
import path from 'node:path';

const databasePath = path.resolve(process.env.DATABASE_PATH ?? '/app/data/publishflow.db');

const email = (process.env.SEED_ADMIN_EMAIL ?? '').trim().toLowerCase();
const password = process.env.SEED_ADMIN_PASSWORD ?? '';
const name = process.env.SEED_ADMIN_NAME ?? 'Administrator';

if (!email || !password) {
  console.error('[seed] SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set.');
  process.exit(1);
}
if (password.length < 12) {
  console.error('[seed] SEED_ADMIN_PASSWORD must be at least 12 characters.');
  process.exit(1);
}
if (password === 'AdminDemo123!ChangeMe') {
  console.error('[seed] Refusing to create an administrator with the documented demo password.');
  process.exit(1);
}

const sqlite = new Database(databasePath);
sqlite.pragma('foreign_keys = ON');

const existing = sqlite
  .prepare("SELECT count(*) AS n FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE'")
  .get();

if (existing.n > 0) {
  console.log(`[seed] ${existing.n} active administrator(s) already exist; nothing to do.`);
  sqlite.close();
  process.exit(0);
}

const passwordHash = await argon2.hash(password, {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
});

const now = new Date().toISOString();

sqlite
  .prepare(
    `INSERT INTO users (name, email, password_hash, role, status, created_at, updated_at)
     VALUES (?, ?, ?, 'ADMIN', 'ACTIVE', ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       role = 'ADMIN', status = 'ACTIVE', password_hash = excluded.password_hash, updated_at = excluded.updated_at`,
  )
  .run(name, email, passwordHash, now, now);

sqlite
  .prepare(
    `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata_json, created_at)
     VALUES (NULL, 'user.created', 'user', (SELECT id FROM users WHERE email = ?), ?, ?)`,
  )
  .run(email, JSON.stringify({ via: 'container-bootstrap', role: 'ADMIN' }), now);

console.log(`[seed] created the initial administrator: ${email}`);
console.log('[seed] sign in and change this password immediately.');

sqlite.close();
