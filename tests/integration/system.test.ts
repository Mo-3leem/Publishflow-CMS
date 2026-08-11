import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createClient,
  setupTestDatabase,
  signedInAs,
  sqliteHandle,
  type TestContext,
} from '../helpers/test-app';
import { publishDuePosts } from '@/server/services/schedule-service';

let cleanup: () => void;
let admin: TestContext;
let editor: TestContext;
let author: TestContext;
let categoryId: number;

const JOB_SECRET = 'test-job-secret-0123456789abcdefghijklm';

beforeAll(async () => {
  cleanup = await setupTestDatabase();
  admin = await signedInAs('admin');
  editor = await signedInAs('editor');
  author = await signedInAs('author');

  const categories = await admin.request('GET', '/categories');
  categoryId = categories.data<Array<{ id: number }>>()[0]!.id;
});

afterAll(() => cleanup());

interface Post {
  id: number;
  version: number;
  slug: string;
  status: string;
}

/** Create a post already in SCHEDULED state, with `scheduledAt` in the past. */
async function createDuePost(subject: string): Promise<Post> {
  const created = (
    await author.request('POST', '/posts', {
      body: { categoryId, subject, content: 'Scheduled body.' },
    })
  ).data<Post>();

  const submitted = await author.request('POST', `/posts/${created.id}/submit`, {
    body: { expectedVersion: created.version },
  });

  const future = new Date(Date.now() + 3_600_000).toISOString();
  const scheduled = await editor.request('POST', `/posts/${created.id}/schedule`, {
    body: { expectedVersion: submitted.data<Post>().version, scheduledAt: future },
  });
  expect(scheduled.status).toBe(200);

  // Backdate it so it is due now. The API deliberately refuses a past date, so
  // this reaches past the service to set up the fixture.
  sqliteHandle()
    .prepare('UPDATE posts SET scheduled_at = ? WHERE id = ?')
    .run(new Date(Date.now() - 60_000).toISOString(), created.id);

  return scheduled.data<Post>();
}

describe('health', () => {
  it('reports process and database status without leaking internals', async () => {
    const response = await createClient().request('GET', '/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', database: 'ok' });

    const serialised = JSON.stringify(response.body);
    expect(serialised).not.toMatch(/[A-Za-z]:\\|\/tmp|\/home|secret|token/i);
  });

  it('returns a request id on every response', async () => {
    const response = await createClient().request('GET', '/health');
    expect(response.headers.get('x-request-id')).toMatch(/^req_/);
  });

  it('does not echo an attacker-supplied request id that fails validation', async () => {
    const response = await createClient().request('GET', '/health', {
      headers: { 'x-request-id': '<script>alert(1)</script>' },
    });
    expect(response.headers.get('x-request-id')).not.toContain('<script>');
  });
});

describe('scheduled publishing', () => {
  it('publishes a due post and is idempotent on a second run', async () => {
    const post = await createDuePost('Due for publication');

    const first = publishDuePosts(new Date(), 'test-run-1');
    expect(first.published).toBeGreaterThanOrEqual(1);
    expect(first.postIds).toContain(post.id);

    const afterFirst = (await editor.request('GET', `/posts/${post.id}`)).data<Post>();
    expect(afterFirst.status).toBe('PUBLISHED');

    const eventsAfterFirst = sqliteHandle()
      .prepare(
        "SELECT count(*) AS n FROM workflow_events WHERE post_id = ? AND to_status = 'PUBLISHED'",
      )
      .get(post.id) as { n: number };
    const revisionsAfterFirst = sqliteHandle()
      .prepare('SELECT count(*) AS n FROM post_revisions WHERE post_id = ?')
      .get(post.id) as { n: number };

    // Second run must be a no-op for this post.
    const second = publishDuePosts(new Date(), 'test-run-2');
    expect(second.postIds).not.toContain(post.id);

    const eventsAfterSecond = sqliteHandle()
      .prepare(
        "SELECT count(*) AS n FROM workflow_events WHERE post_id = ? AND to_status = 'PUBLISHED'",
      )
      .get(post.id) as { n: number };
    const revisionsAfterSecond = sqliteHandle()
      .prepare('SELECT count(*) AS n FROM post_revisions WHERE post_id = ?')
      .get(post.id) as { n: number };

    expect(eventsAfterSecond.n).toBe(eventsAfterFirst.n);
    expect(revisionsAfterSecond.n).toBe(revisionsAfterFirst.n);
  });

  it('leaves a future-dated scheduled post alone', async () => {
    const created = (
      await author.request('POST', '/posts', {
        body: { categoryId, subject: 'Not due yet', content: 'Body' },
      })
    ).data<Post>();
    const submitted = await author.request('POST', `/posts/${created.id}/submit`, {
      body: { expectedVersion: created.version },
    });
    await editor.request('POST', `/posts/${created.id}/schedule`, {
      body: {
        expectedVersion: submitted.data<Post>().version,
        scheduledAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      },
    });

    const result = publishDuePosts(new Date(), 'test-run-3');
    expect(result.postIds).not.toContain(created.id);
    expect((await editor.request('GET', `/posts/${created.id}`)).data<Post>().status).toBe(
      'SCHEDULED',
    );
  });

  it('skips a soft-deleted scheduled post', async () => {
    const post = await createDuePost('Deleted before its time');
    const current = (await editor.request('GET', `/posts/${post.id}`)).data<Post>();
    await editor.request('DELETE', `/posts/${post.id}`, {
      body: { expectedVersion: current.version },
    });

    const result = publishDuePosts(new Date(), 'test-run-4');
    expect(result.postIds).not.toContain(post.id);
  });

  it('makes the published post publicly visible', async () => {
    const post = await createDuePost('Scheduled then public');
    publishDuePosts(new Date(), 'test-run-5');

    const response = await createClient().request('GET', `/public/posts/${post.slug}`);
    expect(response.status).toBe(200);
  });

  it('attributes the publication to the scheduler in the audit metadata', async () => {
    const post = await createDuePost('Attribution check');
    publishDuePosts(new Date(), 'test-run-6');

    const row = sqliteHandle()
      .prepare(
        "SELECT metadata_json FROM audit_logs WHERE entity_type='post' AND entity_id = ? AND action='post.published' ORDER BY id DESC LIMIT 1",
      )
      .get(String(post.id)) as { metadata_json: string };

    expect(JSON.parse(row.metadata_json)).toMatchObject({ via: 'scheduler' });
  });
});

describe('internal job endpoint', () => {
  const path = '/internal/jobs/publish-scheduled';

  it('rejects an unauthenticated call', async () => {
    const response = await createClient().request('POST', path, { body: {} });
    expect(response.status).toBe(401);
  });

  it('rejects a wrong bearer secret', async () => {
    const response = await createClient().request('POST', path, {
      body: {},
      headers: { authorization: 'Bearer not-the-real-secret-value-here' },
    });
    expect(response.status).toBe(401);
  });

  it('is not reachable with an ordinary admin session', async () => {
    const response = await admin.request('POST', path, { body: {} });
    expect(response.status).toBe(401);
  });

  it('runs with the correct secret and returns a summary', async () => {
    await createDuePost('Published through the endpoint');

    const response = await createClient().request('POST', path, {
      body: {},
      headers: { authorization: `Bearer ${JOB_SECRET}` },
    });

    expect(response.status).toBe(200);
    const summary = response.data<{ checked: number; published: number }>();
    expect(summary.published).toBeGreaterThanOrEqual(1);
  });
});

describe('CSRF protection', () => {
  it('rejects a cookie-authenticated mutation with no CSRF token', async () => {
    const client = await signedInAs('editor');
    const response = await client.request('POST', '/categories', {
      body: { title: 'No CSRF token' },
      skipCsrf: true,
    });
    expect(response.status).toBe(403);
    expect(response.error()?.code).toBe('CSRF_FAILED');
  });

  it('rejects a mutation sent from a foreign origin', async () => {
    const client = await signedInAs('editor');
    const response = await client.request('POST', '/categories', {
      body: { title: 'Cross origin attempt' },
      origin: 'https://evil.test',
    });
    expect(response.status).toBe(403);
    expect(response.error()?.code).toBe('CSRF_FAILED');
  });

  it('rejects a cross-site request flagged by Sec-Fetch-Site', async () => {
    const client = await signedInAs('editor');
    const response = await client.request('POST', '/categories', {
      body: { title: 'Sec-Fetch-Site attempt' },
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(response.status).toBe(403);
  });

  it('rejects a CSRF token belonging to a different session', async () => {
    const victim = await signedInAs('editor');
    const attacker = await signedInAs('admin');

    const stolen = attacker
      .cookies()
      .split('; ')
      .find((entry) => entry.startsWith('pf_csrf='))
      ?.slice('pf_csrf='.length);

    const response = await victim.request('POST', '/categories', {
      body: { title: 'Token from another session' },
      headers: { 'x-csrf-token': stolen ?? '' },
      skipCsrf: true,
    });
    expect(response.status).toBe(403);
    expect(response.error()?.code).toBe('CSRF_FAILED');
  });

  it('allows a same-origin mutation carrying the matching token', async () => {
    const client = await signedInAs('editor');
    const response = await client.request('POST', '/categories', {
      body: { title: 'Correct CSRF flow' },
    });
    expect(response.status).toBe(201);
  });

  it('does not require CSRF for a safe method', async () => {
    const client = await signedInAs('editor');
    const response = await client.request('GET', '/categories', { skipCsrf: true });
    expect(response.status).toBe(200);
  });
});

describe('request limits and error shape', () => {
  it('rejects an oversized JSON body before parsing it', async () => {
    const client = await signedInAs('editor');
    const payload = { title: 'Too big', description: 'x'.repeat(2_000_000) };

    // A real HTTP client always sends Content-Length; `app.request()` with a
    // string body does not, so it is set explicitly to exercise the guard.
    const response = await client.request('POST', '/categories', {
      body: payload,
      headers: { 'content-length': String(JSON.stringify(payload).length) },
    });

    expect(response.status).toBe(413);
    expect(response.error()?.code).toBe('FILE_TOO_LARGE');
  });

  it('still rejects an over-long field through validation when no length is declared', async () => {
    const client = await signedInAs('editor');
    const response = await client.request('POST', '/categories', {
      body: { title: 'Too big', description: 'x'.repeat(2_000_000) },
    });
    expect(response.status).toBe(422);
  });

  it('returns a structured error envelope with a request id', async () => {
    const response = await createClient().request('GET', '/posts');
    const error = response.error();
    expect(error).toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(error?.message).toBeTruthy();
    expect((response.body as { error: { requestId: string } }).error.requestId).toMatch(/^req_/);
  });

  it('never returns a stack trace or SQL text', async () => {
    const response = await createClient().request('GET', '/posts/not-a-number');
    const serialised = JSON.stringify(response.body);
    expect(serialised).not.toMatch(/at .*\(.*:\d+:\d+\)|SELECT |INSERT |sqlite/i);
  });

  it('returns 404 with the standard envelope for an unknown endpoint', async () => {
    const response = await createClient().request('GET', '/does-not-exist');
    expect(response.status).toBe(404);
    expect(response.error()?.code).toBe('NOT_FOUND');
  });

  it('rejects malformed JSON with 400', async () => {
    const { app } = await import('@/server/http/app');
    const response = await app.request('http://localhost:3000/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: '{ not valid json',
    });
    expect(response.status).toBe(400);
  });
});

describe('security headers', () => {
  it('sets nosniff and frame protections on API responses', async () => {
    const response = await createClient().request('GET', '/health');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
  });
});

describe('OpenAPI document', () => {
  it('is valid JSON describing OpenAPI 3', async () => {
    const response = await createClient().request('GET', '/openapi.json');
    expect(response.status).toBe(200);

    const document = response.body as { openapi: string; paths: Record<string, unknown> };
    expect(document.openapi).toMatch(/^3\./);
    expect(typeof document.paths).toBe('object');
  });

  it('documents the core routes', async () => {
    const response = await createClient().request('GET', '/openapi.json');
    const paths = Object.keys((response.body as { paths: Record<string, unknown> }).paths);

    for (const expected of [
      '/health',
      '/auth/login',
      '/auth/logout',
      '/auth/me',
      '/users',
      '/users/{id}',
      '/categories',
      '/categories/{id}',
      '/posts',
      '/posts/{id}',
      '/posts/{id}/publish',
      '/posts/{id}/submit',
      '/posts/{id}/revisions',
      '/posts/{id}/revisions/{revisionId}/restore',
      '/menus/{id}/reorder',
      '/media',
      '/settings',
      '/audit-logs',
      '/public/posts',
      '/public/posts/{slug}',
      '/public/posts/{slug}/view',
    ]) {
      expect(paths, `missing documented path: ${expected}`).toContain(expected);
    }
  });

  it('declares the cookie security scheme and component schemas', async () => {
    const response = await createClient().request('GET', '/openapi.json');
    const document = response.body as {
      components: { securitySchemes: Record<string, unknown>; schemas: Record<string, unknown> };
    };

    expect(document.components.securitySchemes).toHaveProperty('cookieAuth');
    for (const schema of ['Post', 'User', 'Category', 'ErrorResponse', 'PaginationMeta']) {
      expect(document.components.schemas, `missing schema ${schema}`).toHaveProperty(schema);
    }
  });

  it('never leaks a secret or a filesystem path', async () => {
    const response = await createClient().request('GET', '/openapi.json');
    const serialised = JSON.stringify(response.body);
    expect(serialised).not.toMatch(/test-job-secret|test-session-secret|test-csrf-secret/);
    expect(serialised).not.toMatch(/[A-Za-z]:\\\\|\/tmp\//);
  });

  it('serves the interactive documentation page', async () => {
    const { app } = await import('@/server/http/app');
    const response = await app.request('http://localhost:3000/api/v1/docs');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('swagger');
  });
});

describe('database integrity after the whole flow', () => {
  it('reports no foreign key violations', () => {
    const violations = sqliteHandle().pragma('foreign_key_check') as unknown[];
    expect(violations).toEqual([]);
  });

  it('passes quick_check', () => {
    const result = sqliteHandle().pragma('quick_check') as Array<{ quick_check: string }>;
    expect(result[0]?.quick_check).toBe('ok');
  });

  it('has foreign key enforcement switched on', () => {
    const result = sqliteHandle().pragma('foreign_keys') as Array<{ foreign_keys: number }>;
    expect(result[0]?.foreign_keys).toBe(1);
  });

  it('keeps every post covered by at least one revision', () => {
    const orphans = sqliteHandle()
      .prepare(
        'SELECT count(*) AS n FROM posts p WHERE NOT EXISTS (SELECT 1 FROM post_revisions r WHERE r.post_id = p.id)',
      )
      .get() as { n: number };
    expect(orphans.n).toBe(0);
  });

  it('keeps reads_count consistent with post_views', () => {
    const drifted = sqliteHandle()
      .prepare(
        'SELECT count(*) AS n FROM posts p WHERE p.reads_count < (SELECT count(*) FROM post_views v WHERE v.post_id = p.id)',
      )
      .get() as { n: number };
    expect(drifted.n).toBe(0);
  });
});
