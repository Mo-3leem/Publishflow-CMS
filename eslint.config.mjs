import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

/**
 * ESLint flat configuration.
 *
 * `eslint-config-next` v16 ships native flat configs, so they are imported
 * directly rather than through `FlatCompat` — the eslintrc compatibility layer
 * cannot serialise their (circular) plugin objects.
 */
const config = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'blob-report/**',
      'data/**',
      'uploads/**',
      'backups/**',
      '.e2e/**',
      'ci-tmp/**',
      'next-env.d.ts',
    ],
  },

  ...nextCoreWebVitals,
  ...nextTypescript,

  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      // Database and other server-only modules must never be pulled into a
      // client bundle. Server code is exempted below.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/server/db', '**/server/db/*'],
              message:
                'Database modules are server-only. Import them from server services, never from a client component.',
            },
          ],
        },
      ],
    },
  },

  {
    files: [
      'src/server/**/*.ts',
      'scripts/**/*.{ts,mjs}',
      'tests/**/*.{ts,tsx}',
      'docker/**/*.mjs',
    ],
    rules: {
      'no-restricted-imports': 'off',
    },
  },

  {
    // CLI entry points exist to print to stdout.
    files: [
      'scripts/**/*.{ts,mjs}',
      'src/server/db/seed.ts',
      'src/server/db/migrate.ts',
      'docker/**/*.mjs',
    ],
    rules: {
      'no-console': 'off',
    },
  },
];

export default config;
