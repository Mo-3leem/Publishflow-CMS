import 'dotenv/config';
import { app } from '@/server/http/app';
import { closeDb } from '@/server/db';
import { getEnv } from '@/server/env';

/**
 * Developer smoke test for the Hono app.
 *
 * Exercises the request pipeline without a browser or a running Next.js server.
 * The automated coverage lives in tests/integration; this script exists so the
 * API can be poked by hand during development.
 */

const BASE = 'http://localhost:3000/api/v1';

let cookies = '';
let csrfToken = '';

function mergeCookies(response: Response): void {
  const raw = response.headers.getSetCookie?.() ?? [];
  for (const entry of raw) {
    const pair = entry.split(';')[0];
    if (!pair) continue;
    const [name] = pair.split('=');
    const kept = cookies
      .split('; ')
      .filter((c) => c.length > 0 && c.split('=')[0] !== name)
      .join('; ');
    cookies = kept ? `${kept}; ${pair}` : pair;
    if (name === 'pf_csrf') csrfToken = pair.slice(pair.indexOf('=') + 1);
  }
}

async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = {
    origin: getEnv().APP_URL,
    host: 'localhost:3000',
  };
  if (cookies) headers.cookie = cookies;
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (csrfToken) headers['x-csrf-token'] = csrfToken;

  const response = await app.request(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  mergeCookies(response);

  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text.slice(0, 120);
  }
  return { status: response.status, json };
}

function show(label: string, result: { status: number; json: unknown }): void {
  const preview = JSON.stringify(result.json);
  console.log(
    `${String(result.status).padEnd(4)} ${label} ${preview ? preview.slice(0, 150) : ''}`,
  );
}

async function main(): Promise<void> {
  const env = getEnv();

  show('GET  /health', await call('GET', '/health'));
  show('GET  /public/settings', await call('GET', '/public/settings'));
  show('GET  /public/posts', await call('GET', '/public/posts?pageSize=2'));
  show('GET  /public/posts?q=locking', await call('GET', '/public/posts?q=locking'));
  show('GET  /public/menus/HEADER', await call('GET', '/public/menus/HEADER'));
  show('GET  /posts (anon → 401)', await call('GET', '/posts'));
  show(
    'GET  /public/posts/:draftSlug (→404)',
    await call('GET', '/public/posts/drafting-the-style-guide'),
  );

  show(
    'POST /auth/login (bad password)',
    await call('POST', '/auth/login', { email: env.SEED_ADMIN_EMAIL, password: 'wrong-password' }),
  );
  show(
    'POST /auth/login (admin)',
    await call('POST', '/auth/login', {
      email: env.SEED_ADMIN_EMAIL,
      password: env.SEED_ADMIN_PASSWORD,
    }),
  );

  show('GET  /auth/me', await call('GET', '/auth/me'));
  show('GET  /posts', await call('GET', '/posts?pageSize=2'));
  show('GET  /categories', await call('GET', '/categories'));
  show('GET  /users', await call('GET', '/users?pageSize=2'));
  show('GET  /menus', await call('GET', '/menus'));
  show('GET  /settings', await call('GET', '/settings'));
  show('GET  /audit-logs', await call('GET', '/audit-logs?pageSize=2'));

  const created = await call('POST', '/posts', {
    categoryId: 1,
    subject: 'Smoke test post',
    content: '# Smoke\n\nCreated by scripts/smoke-api.ts',
  });
  show('POST /posts', created);

  const postId = (created.json as { data?: { id?: number; version?: number } })?.data?.id;
  const version = (created.json as { data?: { version?: number } })?.data?.version ?? 1;

  if (postId) {
    show(
      'PATCH /posts/:id (stale version → 409)',
      await call('PATCH', `/posts/${postId}`, { expectedVersion: 999, subject: 'Nope' }),
    );
    show(
      'PATCH /posts/:id',
      await call('PATCH', `/posts/${postId}`, {
        expectedVersion: version,
        subject: 'Smoke test post (edited)',
      }),
    );
    show('GET  /posts/:id/revisions', await call('GET', `/posts/${postId}/revisions`));
    show(
      'POST /posts/:id/publish (from DRAFT → 409)',
      await call('POST', `/posts/${postId}/publish`, { expectedVersion: version + 1 }),
    );
    show(
      'POST /posts/:id/submit',
      await call('POST', `/posts/${postId}/submit`, { expectedVersion: version + 1 }),
    );
    show(
      'POST /posts/:id/publish',
      await call('POST', `/posts/${postId}/publish`, { expectedVersion: version + 2 }),
    );
    show('GET  /public/posts/smoke-test-post', await call('GET', '/public/posts/smoke-test-post'));
    show('POST /public/.../view #1', await call('POST', '/public/posts/smoke-test-post/view'));
    show('POST /public/.../view #2', await call('POST', '/public/posts/smoke-test-post/view'));
    show(
      'DELETE /posts/:id',
      await call('DELETE', `/posts/${postId}`, { expectedVersion: version + 3 }),
    );
  }

  const spec = await call('GET', '/openapi.json');
  const paths = Object.keys((spec.json as { paths?: object })?.paths ?? {});
  console.log(`200  GET  /openapi.json  ${paths.length} paths documented`);

  show('POST /auth/logout', await call('POST', '/auth/logout'));
  show('GET  /auth/me (after logout)', await call('GET', '/auth/me'));
}

main()
  .then(() => closeDb())
  .catch((error: unknown) => {
    console.error('Smoke test failed:', error);
    closeDb();
    process.exit(1);
  });
