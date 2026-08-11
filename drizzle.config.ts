import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';
import path from 'node:path';

const databasePath = path.resolve(
  process.cwd(),
  process.env.DATABASE_PATH ?? './data/publishflow.db',
);

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/server/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: databasePath,
  },
  strict: true,
  verbose: true,
});
