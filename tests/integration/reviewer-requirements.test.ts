import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createClient,
  setupTestDatabase,
  signedInAs,
  TINY_PNG,
  type TestContext,
} from '../helpers/test-app';
import { resetRateLimits } from '@/server/http/middleware/rate-limit';

/**
 * Coverage for the reviewer's final requirement list.
 *
 * The behaviours the reviewer asked about that were already implemented are
 * covered by the existing suites; this file pins the gaps that were closed:
 * search rate limiting, the 5-per-15-minutes login threshold, and media list
 * search/sort/pagination. It also re-asserts the bounded-pagination guarantee
 * across every list endpoint in one place, so a future unbounded list fails
 * here rather than in production.
 */

let cleanup: () => void;
let admin: TestContext;
let editor: TestContext;
let author: TestContext;
let categoryId: number;

beforeAll(async () => {
  cleanup = await setupTestDatabase();
  admin = await signedInAs('admin');
  editor = await signedInAs('editor');
  author = await signedInAs('author');

  const categories = await admin.request('GET', '/categories');
  categoryId = categories.data<Array<{ id: number }>>()[0]!.id;
});

afterAll(() => cleanup());

describe('rate limiting — expensive search', () => {
  it('returns 429 with a Retry-After header once the public search budget is spent', async () => {
    resetRateLimits();
    const anon = createClient();

    let limited: Awaited<ReturnType<typeof anon.request>> | null = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const response = await anon.request('GET', `/public/posts?q=locking${attempt}`);
      if (response.status === 429) {
        limited = response;
        break;
      }
    }

    expect(limited, 'public search should be rate limited').not.toBeNull();
    expect(limited?.error()?.code).toBe('RATE_LIMITED');
    expect(limited?.headers.get('retry-after')).toBeTruthy();
  });

  it('does not meter plain listing on the same endpoint', async () => {
    resetRateLimits();
    const anon = createClient();

    // Far more requests than the search budget; none carry `q`.
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const response = await anon.request('GET', '/public/posts?pageSize=1');
      expect(response.status, 'listing must not consume the search budget').toBe(200);
    }
  });

  it('rate limits authenticated staff search too', async () => {
    resetRateLimits();
    const client = await signedInAs('editor');

    let limited = false;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const response = await client.request('GET', `/posts?q=term${attempt}`);
      if (response.status === 429) {
        limited = true;
        expect(response.error()?.code).toBe('RATE_LIMITED');
        break;
      }
    }

    expect(limited, 'staff search should be rate limited').toBe(true);
  });
});

describe('rate limiting — login threshold', () => {
  it('locks out after 5 failed attempts within the window', async () => {
    resetRateLimits();
    const client = createClient();

    // Five failures are allowed through as normal credential rejections...
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await client.login('rate-target@publishflow.local', `wrong-${attempt}`);
      expect(response.status, `attempt ${attempt} should be a credential failure`).toBe(401);
    }

    // ...the sixth is refused outright.
    const sixth = await client.login('rate-target@publishflow.local', 'wrong-6');
    expect(sixth.status).toBe(429);
    expect(sixth.error()?.code).toBe('RATE_LIMITED');
  });
});

describe('media list — search, sort and bounded pagination', () => {
  async function upload(client: TestContext, filename: string) {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(TINY_PNG)], { type: 'image/png' }), filename);
    form.append('altText', `alt text for ${filename}`);
    const response = await client.request('POST', '/media', { formData: form });
    expect(response.status).toBe(201);
    return response.data<{ id: number }>();
  }

  it('filters by file name and by alt text', async () => {
    resetRateLimits();
    await upload(editor, 'alpha-diagram.png');
    await upload(editor, 'beta-photo.png');

    const byName = await editor.request('GET', '/media?q=alpha-diagram');
    const names = byName.data<Array<{ originalName: string }>>().map((m) => m.originalName);
    expect(names).toContain('alpha-diagram.png');
    expect(names).not.toContain('beta-photo.png');

    const byAlt = await editor.request('GET', '/media?q=alt%20text%20for%20beta-photo');
    const altNames = byAlt.data<Array<{ originalName: string }>>().map((m) => m.originalName);
    expect(altNames).toContain('beta-photo.png');
  });

  it('sorts by an allow-listed field and ignores anything else', async () => {
    const ascending = await editor.request('GET', '/media?sort=originalName&order=asc&pageSize=50');
    const names = ascending.data<Array<{ originalName: string }>>().map((m) => m.originalName);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));

    // An unknown sort field is rejected by the schema rather than reaching SQL.
    const injected = await editor.request(
      'GET',
      `/media?sort=${encodeURIComponent('id; DROP TABLE media_assets')}`,
    );
    expect(injected.status).toBe(422);

    // The table is very much still there.
    expect((await editor.request('GET', '/media')).status).toBe(200);
  });

  it('caps pageSize regardless of what the client asks for', async () => {
    const response = await editor.request('GET', '/media?pageSize=100000');
    expect(response.status).toBe(422);

    const atCap = await editor.request('GET', '/media?pageSize=100');
    expect(atCap.status).toBe(200);
    expect(atCap.meta()?.pageSize).toBeLessThanOrEqual(100);
  });
});

describe('every list endpoint is bounded', () => {
  const listEndpoints = [
    { path: '/posts', client: () => editor },
    { path: '/users', client: () => admin },
    { path: '/media', client: () => editor },
    { path: '/audit-logs', client: () => admin },
  ] as const;

  it('never returns more rows than the maximum page size', async () => {
    resetRateLimits();

    for (const endpoint of listEndpoints) {
      const response = await endpoint.client().request('GET', `${endpoint.path}?pageSize=100`);
      expect(response.status, endpoint.path).toBe(200);

      const meta = response.meta();
      expect(meta, endpoint.path).toBeTruthy();
      expect(meta!.pageSize, `${endpoint.path} pageSize`).toBeLessThanOrEqual(100);
      expect(response.data<unknown[]>().length, `${endpoint.path} row count`).toBeLessThanOrEqual(
        meta!.pageSize,
      );
    }
  });

  it('rejects an out-of-range pageSize rather than silently returning everything', async () => {
    resetRateLimits();

    for (const endpoint of listEndpoints) {
      const response = await endpoint.client().request('GET', `${endpoint.path}?pageSize=5000`);
      expect(response.status, `${endpoint.path} should reject pageSize=5000`).toBe(422);
    }
  });

  it('paginates deterministically', async () => {
    resetRateLimits();

    const first = await editor.request('GET', '/posts?pageSize=2&page=1&sort=createdAt&order=asc');
    const second = await editor.request('GET', '/posts?pageSize=2&page=2&sort=createdAt&order=asc');

    const firstIds = first.data<Array<{ id: number }>>().map((p) => p.id);
    const secondIds = second.data<Array<{ id: number }>>().map((p) => p.id);

    expect(firstIds).toHaveLength(2);
    expect(firstIds.some((id) => secondIds.includes(id))).toBe(false);
    expect(first.meta()?.page).toBe(1);
    expect(second.meta()?.page).toBe(2);
  });
});

describe('workflow — the reviewer’s required behaviours', () => {
  interface Post {
    id: number;
    version: number;
    status: string;
    slug: string;
    scheduledAt: string | null;
  }

  async function draft(subject: string) {
    const response = await author.request('POST', '/posts', {
      body: { categoryId, subject, content: 'Body for the workflow check.' },
    });
    expect(response.status).toBe(201);
    return response.data<Post>();
  }

  it('an editor approves by scheduling a future publication', async () => {
    resetRateLimits();
    const post = await draft('Scheduling approval path');

    const submitted = await author.request('POST', `/posts/${post.id}/submit`, {
      body: { expectedVersion: post.version },
    });
    expect(submitted.data<Post>().status).toBe('IN_REVIEW');

    const when = new Date(Date.now() + 3_600_000).toISOString();
    const scheduled = await editor.request('POST', `/posts/${post.id}/schedule`, {
      body: { expectedVersion: submitted.data<Post>().version, scheduledAt: when },
    });

    expect(scheduled.status).toBe(200);
    expect(scheduled.data<Post>().status).toBe('SCHEDULED');
    expect(scheduled.data<Post>().scheduledAt).toBe(when);
  });

  it('rejects an invalid publication date at the API boundary', async () => {
    const post = await draft('Invalid schedule date');
    const submitted = await author.request('POST', `/posts/${post.id}/submit`, {
      body: { expectedVersion: post.version },
    });
    const version = submitted.data<Post>().version;

    for (const scheduledAt of ['not-a-date', '2020-13-45T99:99:99Z', '']) {
      const response = await editor.request('POST', `/posts/${post.id}/schedule`, {
        body: { expectedVersion: version, scheduledAt },
      });
      expect(response.status, `scheduledAt=${scheduledAt}`).toBe(422);
    }
  });

  it('an author can neither approve nor schedule', async () => {
    resetRateLimits();
    const post = await draft('Author cannot approve');
    const submitted = await author.request('POST', `/posts/${post.id}/submit`, {
      body: { expectedVersion: post.version },
    });
    const version = submitted.data<Post>().version;

    const published = await author.request('POST', `/posts/${post.id}/publish`, {
      body: { expectedVersion: version },
    });
    expect(published.status).toBe(403);

    const scheduled = await author.request('POST', `/posts/${post.id}/schedule`, {
      body: { expectedVersion: version, scheduledAt: new Date(Date.now() + 60_000).toISOString() },
    });
    expect(scheduled.status).toBe(403);
  });

  it('archiving unpublishes without destroying history', async () => {
    resetRateLimits();
    const post = await draft('Archive retains history');

    let version = post.version;
    version = (
      await author.request('POST', `/posts/${post.id}/submit`, {
        body: { expectedVersion: version },
      })
    ).data<Post>().version;
    version = (
      await editor.request('POST', `/posts/${post.id}/publish`, {
        body: { expectedVersion: version },
      })
    ).data<Post>().version;

    const anon = createClient();
    expect((await anon.request('GET', `/public/posts/${post.slug}`)).status).toBe(200);

    const archived = await editor.request('POST', `/posts/${post.id}/archive`, {
      body: { expectedVersion: version },
    });
    expect(archived.data<Post>().status).toBe('ARCHIVED');
    expect((await anon.request('GET', `/public/posts/${post.slug}`)).status).toBe(404);

    // Every state the post passed through is still on record.
    const events = await editor.request('GET', `/posts/${post.id}/workflow-events`);
    const transitions = events
      .data<Array<{ toStatus: string }>>()
      .map((e) => e.toStatus)
      .reverse();
    expect(transitions).toEqual(['IN_REVIEW', 'PUBLISHED', 'ARCHIVED']);

    const revisions = await editor.request('GET', `/posts/${post.id}/revisions`);
    expect(revisions.data<unknown[]>().length).toBeGreaterThanOrEqual(4);
  });
});

describe('backend validation is enforced when the frontend is bypassed', () => {
  it('rejects a missing or too-short subject', async () => {
    resetRateLimits();

    for (const subject of [undefined, '', '  ', 'ab']) {
      const response = await author.request('POST', '/posts', {
        body: { categoryId, subject, content: 'Body' },
      });
      expect(response.status, `subject=${JSON.stringify(subject)}`).toBe(422);
    }
  });

  it('rejects an invalid email and an unknown role when creating a user', async () => {
    const badEmail = await admin.request('POST', '/users', {
      body: {
        name: 'Bad Email',
        email: 'not-an-email',
        password: 'a-long-enough-password',
        role: 'AUTHOR',
      },
    });
    expect(badEmail.status).toBe(422);
    expect(badEmail.error()?.details).toHaveProperty('email');

    const badRole = await admin.request('POST', '/users', {
      body: {
        name: 'Bad Role',
        email: 'bad-role@publishflow.local',
        password: 'a-long-enough-password',
        role: 'SUPERUSER',
      },
    });
    expect(badRole.status).toBe(422);
    expect(badRole.error()?.details).toHaveProperty('role');
  });

  it('rejects a body over the content size limit', async () => {
    const response = await author.request('POST', '/posts', {
      body: { categoryId, subject: 'Oversized body', content: 'x'.repeat(500_001) },
    });
    expect(response.status).toBe(422);
  });
});

describe('production error responses leak nothing', () => {
  it('returns a stable envelope without internals', async () => {
    resetRateLimits();
    const response = await createClient().request('GET', '/posts/999999999');

    expect(response.status).toBe(401);

    const serialised = JSON.stringify(response.body);
    expect(serialised).not.toMatch(/SELECT |INSERT |UPDATE |sqlite|better-sqlite3|drizzle/i);
    expect(serialised).not.toMatch(/at .*\(.*:\d+:\d+\)/);
    expect(serialised).not.toMatch(/node_modules|[A-Za-z]:\\\\|\/home\//);

    const error = response.error();
    expect(Object.keys(error ?? {}).sort()).toEqual(['code', 'message', 'requestId']);
  });
});
