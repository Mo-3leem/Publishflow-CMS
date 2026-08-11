import 'dotenv/config';
import { getSqlite, closeDb, isFtsAvailable } from '@/server/db';

/**
 * Database integrity gate.
 *
 * Exits non-zero when SQLite reports corruption or a broken foreign key, or when
 * an application-level invariant that migrations and seeding are supposed to
 * guarantee is missing.
 */

interface Check {
  name: string;
  run: () => { ok: boolean; detail: string };
}

function main(): void {
  const sqlite = getSqlite();

  const checks: Check[] = [
    {
      name: 'PRAGMA quick_check',
      run: () => {
        const rows = sqlite.pragma('quick_check') as Array<{ quick_check: string }>;
        const result = rows[0]?.quick_check ?? 'unknown';
        return { ok: result === 'ok', detail: result };
      },
    },
    {
      name: 'PRAGMA foreign_key_check',
      run: () => {
        const rows = sqlite.pragma('foreign_key_check') as unknown[];
        return {
          ok: rows.length === 0,
          detail: rows.length === 0 ? 'no violations' : `${rows.length} violation(s)`,
        };
      },
    },
    {
      name: 'PRAGMA foreign_keys enabled',
      run: () => {
        const rows = sqlite.pragma('foreign_keys') as Array<{ foreign_keys: number }>;
        const enabled = rows[0]?.foreign_keys === 1;
        return { ok: enabled, detail: enabled ? 'ON' : 'OFF' };
      },
    },
    {
      name: 'site_settings singleton row',
      run: () => {
        const row = sqlite.prepare('SELECT count(*) AS n FROM site_settings').get() as {
          n: number;
        };
        return { ok: row.n === 1, detail: `${row.n} row(s)` };
      },
    },
    {
      name: 'HEADER and FOOTER menus exist',
      run: () => {
        const row = sqlite
          .prepare("SELECT count(*) AS n FROM menus WHERE location IN ('HEADER','FOOTER')")
          .get() as { n: number };
        return { ok: row.n === 2, detail: `${row.n} menu(s)` };
      },
    },
    {
      name: 'at least one active administrator',
      run: () => {
        const row = sqlite
          .prepare("SELECT count(*) AS n FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE'")
          .get() as { n: number };
        return { ok: row.n >= 1, detail: `${row.n} active admin(s)` };
      },
    },
    {
      name: 'every post has a revision',
      run: () => {
        const row = sqlite
          .prepare(
            'SELECT count(*) AS n FROM posts p WHERE NOT EXISTS (SELECT 1 FROM post_revisions r WHERE r.post_id = p.id)',
          )
          .get() as { n: number };
        return {
          ok: row.n === 0,
          detail: row.n === 0 ? 'all covered' : `${row.n} without history`,
        };
      },
    },
    {
      name: 'reads_count matches post_views',
      run: () => {
        // reads_count may legitimately exceed the view rows only if rows were
        // pruned; a lower count means the counter drifted and is a real fault.
        const row = sqlite
          .prepare(
            `SELECT count(*) AS n FROM posts p
             WHERE p.reads_count < (SELECT count(*) FROM post_views v WHERE v.post_id = p.id)`,
          )
          .get() as { n: number };
        return { ok: row.n === 0, detail: row.n === 0 ? 'consistent' : `${row.n} post(s) drifted` };
      },
    },
    {
      name: 'full-text search index',
      run: () => {
        const available = isFtsAvailable();
        return {
          ok: true,
          detail: available ? 'FTS5 active' : 'not present — LIKE fallback in use',
        };
      },
    },
  ];

  let failures = 0;

  console.log('Database integrity check');
  console.log('------------------------');

  for (const check of checks) {
    let outcome: { ok: boolean; detail: string };
    try {
      outcome = check.run();
    } catch (error) {
      outcome = { ok: false, detail: error instanceof Error ? error.message : 'threw' };
    }
    if (!outcome.ok) failures += 1;
    console.log(`${outcome.ok ? 'PASS' : 'FAIL'}  ${check.name}: ${outcome.detail}`);
  }

  console.log('------------------------');
  closeDb();

  if (failures > 0) {
    console.error(`${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('All checks passed.');
}

main();
