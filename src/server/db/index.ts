import 'server-only';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { getEnv } from '@/server/env';
import * as schema from './schema';

export type SqliteDatabase = Database.Database;

/**
 * Database handle accepted by services.
 *
 * Typed as the shared base rather than the concrete `BetterSQLite3Database` so
 * that a transaction object satisfies it too — services take a `Db` and callers
 * decide whether to pass the connection or an open transaction.
 */
export type Db = BaseSQLiteDatabase<'sync', Database.RunResult, typeof schema>;

interface Connection {
  sqlite: SqliteDatabase;
  db: Db;
  file: string;
  ftsAvailable: boolean;
}

/**
 * One SQLite connection per Node process.
 *
 * Stashed on globalThis so Next.js dev-mode module reloading does not open a new
 * handle on every hot reload (which would exhaust file handles and fight over the
 * single writer lock).
 */
const globalRef = globalThis as typeof globalThis & {
  __publishflowConnection?: Connection;
};

function applyPragmas(sqlite: SqliteDatabase): void {
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('busy_timeout = 5000');
}

function detectFts(sqlite: SqliteDatabase): boolean {
  try {
    const row = sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'posts_fts'`)
      .get();
    return row !== undefined;
  } catch {
    return false;
  }
}

/** Does this SQLite build expose the FTS5 module at all? */
export function sqliteSupportsFts5(sqlite: SqliteDatabase): boolean {
  try {
    sqlite.exec('CREATE VIRTUAL TABLE temp.__fts_probe USING fts5(x)');
    sqlite.exec('DROP TABLE temp.__fts_probe');
    return true;
  } catch {
    return false;
  }
}

function openConnection(): Connection {
  const env = getEnv();
  const sqlite = new Database(env.databaseFile);
  applyPragmas(sqlite);
  const db = drizzle(sqlite, { schema });
  return {
    sqlite,
    db,
    file: env.databaseFile,
    ftsAvailable: env.ENABLE_FTS && detectFts(sqlite),
  };
}

function connection(): Connection {
  const env = getEnv();
  const existing = globalRef.__publishflowConnection;
  if (existing && existing.file === env.databaseFile) {
    return existing;
  }
  if (existing) {
    // The configured database path changed (integration tests). Close the old handle.
    try {
      existing.sqlite.close();
    } catch {
      /* already closed */
    }
  }
  const created = openConnection();
  globalRef.__publishflowConnection = created;
  return created;
}

export function getDb(): Db {
  return connection().db;
}

export function getSqlite(): SqliteDatabase {
  return connection().sqlite;
}

export function isFtsAvailable(): boolean {
  return connection().ftsAvailable;
}

/** Re-run FTS detection after migrations create (or skip) the virtual table. */
export function refreshFtsAvailability(): boolean {
  const conn = connection();
  conn.ftsAvailable = getEnv().ENABLE_FTS && detectFts(conn.sqlite);
  return conn.ftsAvailable;
}

export function closeDb(): void {
  const existing = globalRef.__publishflowConnection;
  if (existing) {
    try {
      existing.sqlite.close();
    } catch {
      /* already closed */
    }
    globalRef.__publishflowConnection = undefined;
  }
}

export { schema };
