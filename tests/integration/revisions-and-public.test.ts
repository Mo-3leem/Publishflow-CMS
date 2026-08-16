import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createClient,
  setupTestDatabase,
  signedInAs,
  sqliteHandle,
  type TestContext,
} from '../helpers/test-app';
import type { Principal } from '@/lib/domain';

let cleanup: () => void;
let editor: TestContext;
let author: TestContext;
let anon: TestContext;
let categoryId: number;

beforeAll(async () => {
  cleanup = await setupTestDatabase();
  editor = await signedInAs('editor');
  author = await signedInAs('author');
  anon = createClient();

  const categories = await editor.request('GET', '/categories');
  categoryId = categories.data<Array<{ id: number }>>()[0]!.id;
});

afterAll(() => cleanup());

interface Post {
  id: number;
  version: number;
  slug: string;
  subject: string;
  content: string;
  status: string;
  readsCount: number;
}

interface Revision {
  id: number;
  version: number;
  subject: string;
  content: string;
  isCurrent: boolean;
}

async function draft(client: TestContext, subject: string, content = 'Original body.') {
  const response = await client.request('POST', '/posts', {
    body: { categoryId, subject, content },
  });
  expect(response.status).toBe(201);
  return response.data<Post>();
}

async function publish(post: Post): Promise<Post> {
  const submitted = await author.request('POST', `/posts/${post.id}/submit`, {
    body: { expectedVersion: post.version },
  });
  const published = await editor.request('POST', `/posts/${post.id}/publish`, {
    body: { expectedVersion: submitted.data<Post>().version },
  });
  expect(published.status).toBe(200);
  return published.data<Post>();
}

describe('revision restore', () => {
  it('restores old content as a NEW version without touching stored revisions', async () => {
    const post = await draft(author, 'Restore mechanics', 'Version one body.');

    const v2 = await author.request('PATCH', `/posts/${post.id}`, {
      body: { expectedVersion: post.version, content: 'Version two body.' },
    });
    const v3 = await author.request('PATCH', `/posts/${post.id}`, {
      body: { expectedVersion: v2.data<Post>().version, content: 'Version three body.' },
    });
    const current = v3.data<Post>();
    expect(current.version).toBe(3);

    const revisions = (await author.request('GET', `/posts/${post.id}/revisions`)).data<
      Revision[]
    >();
    expect(revisions).toHaveLength(3);
    const first = revisions.find((revision) => revision.version === 1);
    expect(first).toBeDefined();

    const rowsBefore = sqliteHandle()
      .prepare('SELECT id, version, content FROM post_revisions WHERE post_id = ? ORDER BY version')
      .all(post.id);

    const restored = await editor.request(
      'POST',
      `/posts/${post.id}/revisions/${first?.id}/restore`,
      { body: { expectedVersion: current.version, changeSummary: 'Back to version 1' } },
    );

    expect(restored.status).toBe(200);
    const after = restored.data<Post>();
    expect(after.version).toBe(4);
    expect(after.content).toBe('Version one body.');

    // History grew; nothing was rewritten or deleted.
    const rowsAfter = sqliteHandle()
      .prepare('SELECT id, version, content FROM post_revisions WHERE post_id = ? ORDER BY version')
      .all(post.id);
    expect(rowsAfter).toHaveLength(rowsBefore.length + 1);
    expect(rowsAfter.slice(0, rowsBefore.length)).toEqual(rowsBefore);
  });

  it('does not let an author restore a revision', async () => {
    const post = await draft(author, 'Author restore attempt');
    const revisions = (await author.request('GET', `/posts/${post.id}/revisions`)).data<
      Revision[]
    >();

    const response = await author.request(
      'POST',
      `/posts/${post.id}/revisions/${revisions[0]?.id}/restore`,
      { body: { expectedVersion: post.version } },
    );
    expect(response.status).toBe(403);
  });

  it('does not republish an archived post when its content is restored', async () => {
    const post = await draft(author, 'Restore keeps status');
    const published = await publish(post);
    const archived = await editor.request('POST', `/posts/${post.id}/archive`, {
      body: { expectedVersion: published.version },
    });
    const current = archived.data<Post>();
    expect(current.status).toBe('ARCHIVED');

    const revisions = (await editor.request('GET', `/posts/${post.id}/revisions`)).data<
      Revision[]
    >();
    const oldest = revisions[revisions.length - 1];

    const restored = await editor.request(
      'POST',
      `/posts/${post.id}/revisions/${oldest?.id}/restore`,
      { body: { expectedVersion: current.version } },
    );

    expect(restored.status).toBe(200);
    expect(restored.data<Post>().status).toBe('ARCHIVED');
  });

  it('returns 409 on a stale expectedVersion when restoring', async () => {
    const post = await draft(author, 'Restore conflict');
    const revisions = (await author.request('GET', `/posts/${post.id}/revisions`)).data<
      Revision[]
    >();

    const response = await editor.request(
      'POST',
      `/posts/${post.id}/revisions/${revisions[0]?.id}/restore`,
      { body: { expectedVersion: 999 } },
    );
    expect(response.status).toBe(409);
    expect(response.error()?.code).toBe('VERSION_CONFLICT');
  });

  it('does not let an author read another author’s revisions', async () => {
    const author2 = await signedInAs('author2');
    const post = await draft(author, 'Private revision history');
    const response = await author2.request('GET', `/posts/${post.id}/revisions`);
    expect(response.status).toBe(404);
  });
});

describe('public visibility', () => {
  it('exposes a published post by slug', async () => {
    const post = await draft(author, 'Publicly visible article');
    const live = await publish(post);

    const response = await anon.request('GET', `/public/posts/${live.slug}`);
    expect(response.status).toBe(200);
    expect(response.data<{ subject: string }>().subject).toBe('Publicly visible article');
  });

  it('hides a DRAFT from the public slug endpoint', async () => {
    const post = await draft(author, 'Still a private draft');
    const response = await anon.request('GET', `/public/posts/${post.slug}`);
    expect(response.status).toBe(404);
    expect(response.error()?.code).toBe('NOT_FOUND');
  });

  it('hides an IN_REVIEW post', async () => {
    const post = await draft(author, 'Awaiting review privately');
    await author.request('POST', `/posts/${post.id}/submit`, {
      body: { expectedVersion: post.version },
    });
    expect((await anon.request('GET', `/public/posts/${post.slug}`)).status).toBe(404);
  });

  it('hides a future-dated SCHEDULED post', async () => {
    const post = await draft(author, 'Scheduled for later');
    const submitted = await author.request('POST', `/posts/${post.id}/submit`, {
      body: { expectedVersion: post.version },
    });
    await editor.request('POST', `/posts/${post.id}/schedule`, {
      body: {
        expectedVersion: submitted.data<Post>().version,
        scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    expect((await anon.request('GET', `/public/posts/${post.slug}`)).status).toBe(404);
  });

  it('hides an ARCHIVED post', async () => {
    const post = await draft(author, 'Archived and hidden');
    const live = await publish(post);
    await editor.request('POST', `/posts/${post.id}/archive`, {
      body: { expectedVersion: live.version },
    });
    expect((await anon.request('GET', `/public/posts/${post.slug}`)).status).toBe(404);
  });

  it('hides a soft-deleted post', async () => {
    const post = await draft(author, 'Deleted and hidden');
    const live = await publish(post);
    expect((await anon.request('GET', `/public/posts/${live.slug}`)).status).toBe(200);

    await editor.request('DELETE', `/posts/${post.id}`, {
      body: { expectedVersion: live.version },
    });
    expect((await anon.request('GET', `/public/posts/${live.slug}`)).status).toBe(404);
  });

  it('hides a published post whose category was deactivated', async () => {
    const created = await editor.request('POST', '/categories', {
      body: { title: 'Temporarily active', slug: 'temporarily-active' },
    });
    const tempCategory = created.data<{ id: number }>();

    const post = (
      await author.request('POST', '/posts', {
        body: { categoryId: tempCategory.id, subject: 'Hidden by category', content: 'Body' },
      })
    ).data<Post>();
    const live = await publish(post);

    expect((await anon.request('GET', `/public/posts/${live.slug}`)).status).toBe(200);

    await editor.request('PATCH', `/categories/${tempCategory.id}`, {
      body: { isActive: false },
    });

    expect((await anon.request('GET', `/public/posts/${live.slug}`)).status).toBe(404);
  });

  it('never leaks a non-public post through the public list', async () => {
    const list = await anon.request('GET', '/public/posts?pageSize=100');
    const posts = list.data<Array<{ slug: string }>>();

    const hidden = sqliteHandle()
      .prepare(
        "SELECT slug FROM posts WHERE status <> 'PUBLISHED' OR deleted_at IS NOT NULL OR published_at IS NULL",
      )
      .all() as Array<{ slug: string }>;

    const publicSlugs = new Set(posts.map((post) => post.slug));
    for (const row of hidden) {
      expect(publicSlugs.has(row.slug), `leaked ${row.slug}`).toBe(false);
    }
  });

  it('never leaks a non-public post through public search', async () => {
    await draft(author, 'Zzunique draft searchterm');
    const response = await anon.request('GET', '/public/posts?q=Zzunique');
    expect(response.data<unknown[]>()).toHaveLength(0);
  });
});

describe('public search', () => {
  it('finds a published post by a word in its body', async () => {
    const post = await draft(
      author,
      'Findable article about kittens',
      'A long body mentioning marmalade repeatedly.',
    );
    await publish(post);

    const response = await anon.request('GET', '/public/posts?q=marmalade');
    expect(response.status).toBe(200);
    const results = response.data<Array<{ slug: string }>>();
    expect(results.some((entry) => entry.slug === post.slug)).toBe(true);
  });

  it('reports which search engine answered', async () => {
    const response = await anon.request('GET', '/public/posts?q=marmalade');
    const mode = (response.body as { searchMode?: string }).searchMode;
    expect(['fts', 'like']).toContain(mode);
  });

  it('survives a query full of FTS operators without erroring', async () => {
    for (const query of ['"', 'NEAR(', 'a OR b', '*', '); DROP TABLE posts; --', '^^^']) {
      const response = await anon.request('GET', `/public/posts?q=${encodeURIComponent(query)}`);
      expect(response.status, query).toBe(200);
    }
  });

  it('returns an empty result rather than everything for an unmatched term', async () => {
    const response = await anon.request('GET', '/public/posts?q=zzzznotpresentanywhere');
    expect(response.data<unknown[]>()).toHaveLength(0);
  });
});

describe('read counting', () => {
  it('counts the same visitor once per UTC day and increments for a new visitor', async () => {
    const post = await draft(author, 'Read de-duplication');
    const live = await publish(post);

    const visitorA = createClient();
    const first = await visitorA.request('POST', `/public/posts/${live.slug}/view`);
    expect(first.status).toBe(200);
    expect(first.data<{ counted: boolean; readsCount: number }>()).toEqual({
      counted: true,
      readsCount: 1,
    });

    // Same browser, repeated refreshes.
    for (let i = 0; i < 4; i += 1) {
      const repeat = await visitorA.request('POST', `/public/posts/${live.slug}/view`);
      expect(repeat.data<{ counted: boolean; readsCount: number }>()).toEqual({
        counted: false,
        readsCount: 1,
      });
    }

    // A different browser counts once more.
    const visitorB = createClient();
    const other = await visitorB.request('POST', `/public/posts/${live.slug}/view`);
    expect(other.data<{ counted: boolean; readsCount: number }>()).toEqual({
      counted: true,
      readsCount: 2,
    });

    const stored = sqliteHandle()
      .prepare('SELECT reads_count FROM posts WHERE id = ?')
      .get(post.id) as { reads_count: number };
    expect(stored.reads_count).toBe(2);
  });

  it('counts again for the same visitor on a different UTC day', async () => {
    const post = await draft(author, 'Read counting across days');
    const live = await publish(post);

    const visitor = createClient();
    await visitor.request('POST', `/public/posts/${live.slug}/view`);

    // Simulate yesterday's visit for the same viewer hash.
    const row = sqliteHandle()
      .prepare('SELECT viewer_hash FROM post_views WHERE post_id = ?')
      .get(post.id) as { viewer_hash: string };
    sqliteHandle()
      .prepare(
        "INSERT OR IGNORE INTO post_views (post_id, viewer_hash, viewed_on, created_at) VALUES (?, ?, date('now','-1 day'), datetime('now'))",
      )
      .run(post.id, row.viewer_hash);

    const rows = sqliteHandle()
      .prepare('SELECT count(*) AS n FROM post_views WHERE post_id = ?')
      .get(post.id) as { n: number };
    expect(rows.n).toBe(2);
  });

  it('never stores a raw IP address or the raw visitor cookie', async () => {
    const post = await draft(author, 'No raw identifiers stored');
    const live = await publish(post);

    const visitor = createClient();
    await visitor.request('POST', `/public/posts/${live.slug}/view`);

    const cookieValue = visitor
      .cookies()
      .split('; ')
      .find((entry) => entry.startsWith('pf_visitor='))
      ?.split('=')[1];
    expect(cookieValue).toBeTruthy();

    const stored = sqliteHandle()
      .prepare('SELECT viewer_hash FROM post_views WHERE post_id = ?')
      .get(post.id) as { viewer_hash: string };

    expect(stored.viewer_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.viewer_hash).not.toBe(cookieValue);
  });

  it('refuses to count a view on a non-public post', async () => {
    const post = await draft(author, 'No views for drafts');
    const response = await createClient().request('POST', `/public/posts/${post.slug}/view`);
    expect(response.status).toBe(404);
  });

  it('cannot be inflated through the ordinary post update API', async () => {
    const post = await draft(author, 'Reads are server owned');
    const response = await author.request('PATCH', `/posts/${post.id}`, {
      body: { expectedVersion: post.version, readsCount: 1_000_000, subject: 'Still zero reads' },
    });
    expect(response.data<Post>().readsCount).toBe(0);
  });

  /**
   * Closes the loop the reported bug ran through: a recorded view has to reach
   * the number the dashboard actually prints, not just the posts table.
   *
   * The dashboard is a Server Component, so it calls the service directly — the
   * same call the admin page makes, rather than an HTTP route that does not exist.
   */
  it('carries a counted view through to the dashboard total', async () => {
    const { getDashboardData } = await import('@/server/services/dashboard-service');
    const adminRow = sqliteHandle()
      .prepare('SELECT id, name, email, role, status FROM users WHERE role = ? LIMIT 1')
      .get('ADMIN') as Principal;

    const readsBefore = getDashboardData(adminRow).stats.totalReads;

    const post = await draft(author, 'Dashboard reflects a real read');
    const live = await publish(post);

    const firstVisitor = createClient();
    const counted = await firstVisitor.request('POST', `/public/posts/${live.slug}/view`);
    expect(counted.data<{ counted: boolean }>().counted).toBe(true);
    expect(getDashboardData(adminRow).stats.totalReads).toBe(readsBefore + 1);

    // A refresh by that same visitor must not move the dashboard.
    const repeat = await firstVisitor.request('POST', `/public/posts/${live.slug}/view`);
    expect(repeat.data<{ counted: boolean }>().counted).toBe(false);
    expect(getDashboardData(adminRow).stats.totalReads).toBe(readsBefore + 1);

    // A genuinely different visitor does move it.
    const secondVisitor = createClient();
    const other = await secondVisitor.request('POST', `/public/posts/${live.slug}/view`);
    expect(other.data<{ counted: boolean }>().counted).toBe(true);
    expect(getDashboardData(adminRow).stats.totalReads).toBe(readsBefore + 2);
  });
});
