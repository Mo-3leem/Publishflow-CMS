import 'dotenv/config';
import fs from 'node:fs';
import { getEnv } from '@/server/env';
import { closeDb } from '@/server/db';

/**
 * Drop the local database file (plus its WAL sidecars) so `db:migrate` starts
 * from scratch. Refuses to run in production — this deletes real content.
 */

function main(): void {
  const env = getEnv();

  if (env.isProduction) {
    console.error('Refusing to reset the database while NODE_ENV=production.');
    process.exit(1);
  }

  closeDb();

  const targets = [env.databaseFile, `${env.databaseFile}-wal`, `${env.databaseFile}-shm`];
  let removed = 0;

  for (const file of targets) {
    if (fs.existsSync(file)) {
      fs.rmSync(file, { force: true });
      removed += 1;
    }
  }

  console.log(
    removed === 0
      ? `Nothing to remove; ${env.databaseFile} does not exist.`
      : `Removed ${removed} file(s) for ${env.databaseFile}.`,
  );
  console.log('Run "pnpm db:migrate && pnpm db:seed" to rebuild it.');
}

main();
