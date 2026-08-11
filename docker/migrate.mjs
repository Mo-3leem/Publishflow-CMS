/**
 * Production migration runner.
 *
 * Plain JavaScript on purpose: the runtime image ships no TypeScript toolchain,
 * so `tsx src/server/db/migrate.ts` is unavailable there. This mirrors
 * `src/server/db/migrator.ts` — same files, same `__migrations` bookkeeping,
 * same one-transaction-per-file behaviour — using the `better-sqlite3` copy that
 * the Next.js standalone trace already includes.
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const databasePath = path.resolve(process.env.DATABASE_PATH ?? '/app/data/publishflow.db');
const migrationsDir = path.resolve(process.env.MIGRATIONS_DIR ?? '/app/drizzle');
const enableFts = (process.env.ENABLE_FTS ?? 'true').toLowerCase() !== 'false';

fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const sqlite = new Database(databasePath);
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('synchronous = NORMAL');
sqlite.pragma('busy_timeout = 5000');

sqlite.exec(`
CREATE TABLE IF NOT EXISTS __migrations (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  applied_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);

function supportsFts5() {
  try {
    sqlite.exec('CREATE VIRTUAL TABLE temp.__fts_probe USING fts5(x)');
    sqlite.exec('DROP TABLE temp.__fts_probe');
    return true;
  } catch {
    return false;
  }
}

const applied = new Set(
  sqlite
    .prepare('SELECT name FROM __migrations')
    .all()
    .map((row) => row.name),
);

const files = fs
  .readdirSync(migrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .sort();

const ftsSupported = supportsFts5();
const insert = sqlite.prepare('INSERT INTO __migrations (name) VALUES (?)');

let count = 0;
let skipped = 0;

for (const file of files) {
  if (applied.has(file)) continue;

  if (file.includes('_fts') && (!enableFts || !ftsSupported)) {
    skipped += 1;
    console.log(`[migrate] skipped ${file} (FTS5 unavailable or disabled)`);
    continue;
  }

  const statements = fs
    .readFileSync(path.join(migrationsDir, file), 'utf8')
    .split('--> statement-breakpoint')
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0 && !/^(--[^\n]*\n?)+$/.test(chunk));

  const apply = sqlite.transaction(() => {
    for (const statement of statements) sqlite.exec(statement);
    insert.run(file);
  });

  apply();
  count += 1;
  console.log(`[migrate] applied ${file}`);
}

console.log(
  count === 0
    ? '[migrate] schema already up to date'
    : `[migrate] applied ${count} migration(s)${skipped ? `, skipped ${skipped}` : ''}`,
);

sqlite.close();
