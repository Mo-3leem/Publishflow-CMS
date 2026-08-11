import 'dotenv/config';
import { getEnv } from '@/server/env';
import { getSqlite, refreshFtsAvailability, closeDb } from './index';
import { runMigrations } from './migrator';

function main(): void {
  const env = getEnv();
  const sqlite = getSqlite();

  const result = runMigrations(sqlite, { enableFts: env.ENABLE_FTS });

  console.log(`Database: ${env.isProduction ? '(configured path)' : env.databaseFile}`);
  if (result.applied.length === 0) {
    console.log('No pending migrations. Schema is up to date.');
  } else {
    console.log(`Applied ${result.applied.length} migration(s):`);
    for (const name of result.applied) console.log(`  + ${name}`);
  }
  if (result.skipped.length > 0) {
    console.log(`Skipped ${result.skipped.length} migration(s) (FTS5 unavailable or disabled):`);
    for (const name of result.skipped) console.log(`  - ${name}`);
  }
  console.log(
    result.ftsEnabled
      ? 'Full-text search: FTS5 index active.'
      : 'Full-text search: falling back to parameterised LIKE queries.',
  );

  refreshFtsAvailability();
  closeDb();
}

try {
  main();
} catch (error) {
  console.error('Migration failed:', error instanceof Error ? error.message : error);
  closeDb();
  process.exit(1);
}
