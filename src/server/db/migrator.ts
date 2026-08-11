import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import type { SqliteDatabase } from './index';
import { sqliteSupportsFts5 } from './index';

/**
 * Minimal forward-only SQL migration runner.
 *
 * Migrations are plain `.sql` files in `drizzle/`, applied in filename order and
 * recorded in `__migrations`. Each file runs inside a single transaction, so a
 * failing statement leaves the database on the previous version.
 */

export interface MigrationResult {
  applied: string[];
  skipped: string[];
  ftsEnabled: boolean;
}

const MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS __migrations (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  applied_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

export function resolveMigrationsDir(): string {
  const candidates = [
    path.resolve(process.cwd(), 'drizzle'),
    path.resolve(process.cwd(), '../drizzle'),
    path.resolve(process.cwd(), '../../drizzle'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.endsWith('.sql'))) {
      return dir;
    }
  }
  throw new Error(
    `Could not locate the drizzle/ migrations directory from ${process.cwd()}. ` +
      'Run migrations from the repository root or ship drizzle/ with the deployment.',
  );
}

function splitStatements(sql: string): string[] {
  return sql
    .split('--> statement-breakpoint')
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0 && !/^(--[^\n]*\n?)+$/.test(chunk));
}

export function runMigrations(
  sqlite: SqliteDatabase,
  options: { enableFts?: boolean } = {},
): MigrationResult {
  const enableFts = options.enableFts ?? true;
  const dir = resolveMigrationsDir();

  sqlite.exec(MIGRATIONS_TABLE);

  const alreadyApplied = new Set(
    sqlite
      .prepare('SELECT name FROM __migrations')
      .all()
      .map((row) => (row as { name: string }).name),
  );

  const files = fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const applied: string[] = [];
  const skipped: string[] = [];
  const ftsSupported = sqliteSupportsFts5(sqlite);

  const insertRecord = sqlite.prepare('INSERT INTO __migrations (name) VALUES (?)');

  for (const file of files) {
    if (alreadyApplied.has(file)) continue;

    const isFtsMigration = file.includes('_fts');
    if (isFtsMigration && (!enableFts || !ftsSupported)) {
      skipped.push(file);
      // Record it so a later run with FTS enabled is an explicit, deliberate step
      // rather than a surprise mid-flight schema change on a live database.
      continue;
    }

    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const statements = splitStatements(sql);

    const apply = sqlite.transaction(() => {
      for (const statement of statements) {
        sqlite.exec(statement);
      }
      insertRecord.run(file);
    });

    apply();
    applied.push(file);
  }

  const ftsEnabled =
    enableFts &&
    ftsSupported &&
    sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='posts_fts'`)
      .get() !== undefined;

  return { applied, skipped, ftsEnabled };
}
