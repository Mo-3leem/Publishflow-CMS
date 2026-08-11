import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `server-only` throws unless the `react-server` export condition is on,
      // but enabling that condition globally would also swap React for its RSC
      // build, which cannot render in jsdom. Aliasing the marker to a no-op lets
      // node and jsdom suites coexist. Source files keep the real import, so the
      // production bundler still blocks server code in client bundles.
      'server-only': fileURLToPath(new URL('./tests/helpers/server-only-stub.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: [
      'tests/unit/**/*.test.ts',
      'tests/unit/**/*.test.tsx',
      'tests/integration/**/*.test.ts',
    ],
    setupFiles: ['./tests/setup.ts'],
    // SQLite writes are single-writer; isolate each file in its own process and
    // give every file its own temporary database (see tests/helpers/test-app.ts).
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/server/**/*.ts', 'src/lib/**/*.ts'],
      exclude: ['src/server/db/migrate.ts', 'src/server/db/seed.ts'],
    },
  },
});
