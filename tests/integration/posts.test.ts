import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createClient,
  setupTestDatabase,
  signedInAs,
  sqliteHandle,
  type TestContext,
} from '../helpers/test-app';

let cleanup: () => void;
let admin: TestContext;
let editor: TestContext;
let author: TestContext;
let author2: TestContext;
let categoryId: number;

beforeAll(async () => {
  cleanup = await setupTestDatabase();
  admin = await signedInAs('admin');
  editor = await signedInAs('editor');
  author = await signedInAs('author');
  author2 = await signedInAs('author2');

  const categories = await admin.request('GET', '/categories');
  categoryId = categories.data<Array<{ id: number }>>()[0]!.id;
});

afterAll(() => cleanup());

interface Post {
  id: number;
  version: number;
  slug: string;
  subject: string;
  status: string;
  authorId: number;
  readsCount: number;
  publishedAt: string | null;
  scheduledAt: string | null;
}

async function createDraft(client: TestContext, overrides: Record<string, unknown> = {}) {
  const response = await client.request('POST', '/posts', {
    body: {
      categoryId,
      subject: 'A test post subject',
      content: '# Heading\n\nBody text.',
      ...overrides,
    },
  });
  expect(response.status).toBe(201);
  return response.data<Post>();
}

describe('creating posts', () => {
  it('creates a DRAFT at version 1 with an initial revision', async () => {
    const post = await createDraft(author, { subject: 'Initial creation test' });

    expect(post.status).toBe('DRAFT');
    expect(post.version).toBe(1);
    expect(post.publishedAt).toBeNull();
    expect(post.readsCount).toBe(0);

    const revisions = await author.request('GET', `/posts/${post.id}/revisions`);
    expect(revisions.data<unknown[]>()).toHaveLength(1);
  });

  it('always assigns the caller as the author, ignoring any authorId in the payload', async () => {
    const me = (await author.request('GET', '/auth/me')).data<{ user: { id: number } }>().user;
    const post = await createDraft(author, {
      subject: 'Author spoofing attempt',
      authorId: 1,
    });
    expect(post.authorId).toBe(me.id);
  });

  it('ignores a client-supplied status, readsCount and publishedAt', async () => {
    const post = await createDraft(author, {
      subject: 'Server owned fields test',
      status: 'PUBLISHED',
      readsCount: 9999,
      publishedAt: '2020-01-01T00:00:00.000Z',
    });
    expect(post.status).toBe('DRAFT');
    expect(post.readsCount).toBe(0);
    expect(post.publishedAt).toBeNull();
  });

  it('derives a slug from the subject when none is given', async () => {
    const post = await createDraft(author, { subject: 'Slug Derivation Works Here' });
    expect(post.slug).toBe('slug-derivation-works-here');
  });

  it('returns 409 SLUG_EXISTS for an explicit duplicate slug', async () => {
    await createDraft(author, { subject: 'First claimant', slug: 'contested-slug' });

    const second = await author.request('POST', '/posts', {
      body: {
        categoryId,
        subject: 'Second claimant',
        slug: 'contested-slug',
        content: 'Body',
      },
    });
    expect(second.status).toBe(409);
    expect(second.error()?.code).toBe('SLUG_EXISTS');
  });

  it('suffixes a generated slug rather than colliding', async () => {
    const first = await createDraft(author, { subject: 'Repeated subject line' });
    const second = await createDraft(author, { subject: 'Repeated subject line' });
    expect(second.slug).toBe(`${first.slug}-2`);
  });

  it('rejects an unsafe source URL', async () => {
    const response = await author.request('POST', '/posts', {
      body: {
        categoryId,
        subject: 'Unsafe source test',
        content: 'Body',
        sourceUrl: 'javascript:alert(1)',
      },
    });
    expect(response.status).toBe(422);
    expect(response.error()?.details).toHaveProperty('sourceUrl');
  });

  it('rejects an unknown category', async () => {
    const response = await author.request('POST', '/posts', {
      body: { categoryId: 999_999, subject: 'Bad category test', content: 'Body' },
    });
    expect(response.status).toBe(422);
  });

  it('rejects a subject shorter than three characters', async () => {
    const response = await author.request('POST', '/posts', {
      body: { categoryId, subject: 'ab', content: 'Body' },
    });
    expect(response.status).toBe(422);
  });
});

describe('ownership and permissions', () => {
  it('does not let an author update another author’s draft', async () => {
    const post = await createDraft(author2, { subject: 'Belongs to author two' });

    const response = await author.request('PATCH', `/posts/${post.id}`, {
      body: { expectedVersion: post.version, subject: 'Hijacked' },
    });

    // Reported as 404 so an author cannot even confirm the post exists.
    expect(response.status).toBe(404);

    const unchanged = await author2.request('GET', `/posts/${post.id}`);
    expect(unchanged.data<Post>().subject).toBe('Belongs to author two');
  });

  it('does not let an author read another author’s draft', async () => {
    const post = await createDraft(author2, { subject: 'Private to author two' });
    const response = await author.request('GET', `/posts/${post.id}`);
    expect(response.status).toBe(404);
  });

  it('scopes the author’s list query to their own posts', async () => {
    const me = (await author.request('GET', '/auth/me')).data<{ user: { id: number } }>().user;
    const list = await author.request('GET', '/posts?pageSize=100');
    const posts = list.data<Post[]>();
    expect(posts.length).toBeGreaterThan(0);
    expect(posts.every((post) => post.authorId === me.id)).toBe(true);
  });

  it('ignores an authorId filter that would widen an author’s view', async () => {
    const me = (await author.request('GET', '/auth/me')).data<{ user: { id: number } }>().user;
    const list = await author.request('GET', '/posts?pageSize=100&authorId=1');
    expect(list.data<Post[]>().every((post) => post.authorId === me.id)).toBe(true);
  });

  it('lets an editor edit any post', async () => {
    const post = await createDraft(author, { subject: 'Editor may edit this' });
    const response = await editor.request('PATCH', `/posts/${post.id}`, {
      body: { expectedVersion: post.version, subject: 'Edited by the editor' },
    });
    expect(response.status).toBe(200);
    expect(response.data<Post>().subject).toBe('Edited by the editor');
  });

  it('does not let an author edit their own post once it is in review', async () => {
    const post = await createDraft(author, { subject: 'Locked after submission' });

    const submitted = await author.request('POST', `/posts/${post.id}/submit`, {
      body: { expectedVersion: post.version },
    });
    expect(submitted.status).toBe(200);
    const current = submitted.data<Post>();

    const attempt = await author.request('PATCH', `/posts/${post.id}`, {
      body: { expectedVersion: current.version, subject: 'Sneaky edit' },
    });
    expect(attempt.status).toBe(403);
    expect(attempt.error()?.code).toBe('FORBIDDEN');
  });

  it('does not let an author delete a post', async () => {
    const post = await createDraft(author, { subject: 'Author cannot delete' });
    const response = await author.request('DELETE', `/posts/${post.id}`, {
      body: { expectedVersion: post.version },
    });
    expect(response.status).toBe(403);
  });
});

describe('updates, versions and revisions', () => {
  it('creates exactly one new revision per successful update', async () => {
    const post = await createDraft(author, { subject: 'Revision counting' });

    const before = (await author.request('GET', `/posts/${post.id}/revisions`)).data<unknown[]>();
    expect(before).toHaveLength(1);

    const updated = await author.request('PATCH', `/posts/${post.id}`, {
      body: { expectedVersion: post.version, content: 'Updated body', changeSummary: 'Tweak' },
    });
    expect(updated.status).toBe(200);
    expect(updated.data<Post>().version).toBe(post.version + 1);

    const after = (await author.request('GET', `/posts/${post.id}/revisions`)).data<unknown[]>();
    expect(after).toHaveLength(2);
  });

  it('requires at least one editable field', async () => {
    const post = await createDraft(author, { subject: 'Empty update test' });
    const response = await author.request('PATCH', `/posts/${post.id}`, {
      body: { expectedVersion: post.version },
    });
    expect(response.status).toBe(422);
  });

  it('does not accept readsCount, status or publishedAt through the update API', async () => {
    const post = await createDraft(author, { subject: 'Immutable fields on update' });

    const response = await author.request('PATCH', `/posts/${post.id}`, {
      body: {
        expectedVersion: post.version,
        subject: 'Still a draft',
        readsCount: 5000,
        status: 'PUBLISHED',
        publishedAt: '2020-01-01T00:00:00.000Z',
      },
    });

    expect(response.status).toBe(200);
    const updated = response.data<Post>();
    expect(updated.readsCount).toBe(0);
    expect(updated.status).toBe('DRAFT');
    expect(updated.publishedAt).toBeNull();
  });

  it('does not change the slug when only the subject changes', async () => {
    const post = await createDraft(author, { subject: 'Stable slug behaviour' });
    const originalSlug = post.slug;

    const updated = await author.request('PATCH', `/posts/${post.id}`, {
      body: { expectedVersion: post.version, subject: 'A completely different subject' },
    });

    expect(updated.data<Post>().slug).toBe(originalSlug);
  });

  it('changes the slug only when it is edited explicitly', async () => {
    const post = await createDraft(author, { subject: 'Explicit slug edit' });
    const updated = await author.request('PATCH', `/posts/${post.id}`, {
      body: { expectedVersion: post.version, slug: 'deliberately-renamed' },
    });
    expect(updated.data<Post>().slug).toBe('deliberately-renamed');
  });
});

describe('optimistic locking', () => {
  it('returns 409 VERSION_CONFLICT for a stale update and changes nothing', async () => {
    const post = await createDraft(author, { subject: 'Concurrency subject' });

    // User A saves first.
    const first = await author.request('PATCH', `/posts/${post.id}`, {
      body: { expectedVersion: post.version, subject: 'Saved by user A' },
    });
    expect(first.status).toBe(200);

    const revisionsBefore = (await author.request('GET', `/posts/${post.id}/revisions`)).data<
      unknown[]
    >().length;

    // User B still holds the original version.
    const second = await author.request('PATCH', `/posts/${post.id}`, {
      body: { expectedVersion: post.version, subject: 'Saved by user B' },
    });

    expect(second.status).toBe(409);
    expect(second.error()?.code).toBe('VERSION_CONFLICT');
    expect(second.error()?.details).toMatchObject({
      expectedVersion: post.version,
      currentVersion: post.version + 1,
    });

    // User A's write survived, and the failed attempt left no revision behind.
    const current = (await author.request('GET', `/posts/${post.id}`)).data<Post>();
    expect(current.subject).toBe('Saved by user A');
    expect(current.version).toBe(post.version + 1);

    const revisionsAfter = (await author.request('GET', `/posts/${post.id}/revisions`)).data<
      unknown[]
    >().length;
    expect(revisionsAfter).toBe(revisionsBefore);
  });

  it('applies optimistic locking to workflow actions too', async () => {
    const post = await createDraft(author, { subject: 'Workflow locking' });

    await author.request('PATCH', `/posts/${post.id}`, {
      body: { expectedVersion: post.version, content: 'Bumped the version' },
    });

    const stale = await author.request('POST', `/posts/${post.id}/submit`, {
      body: { expectedVersion: post.version },
    });
    expect(stale.status).toBe(409);
    expect(stale.error()?.code).toBe('VERSION_CONFLICT');
  });

  it('requires expectedVersion on every mutation', async () => {
    const post = await createDraft(author, { subject: 'Missing version test' });
    const response = await author.request('PATCH', `/posts/${post.id}`, {
      body: { subject: 'No version supplied' },
    });
    expect(response.status).toBe(422);
  });
});

describe('workflow transitions', () => {
  it('walks draft → review → published and records events plus audit entries', async () => {
    const post = await createDraft(author, { subject: 'Full editorial journey' });

    const submitted = await author.request('POST', `/posts/${post.id}/submit`, {
      body: { expectedVersion: post.version },
    });
    expect(submitted.status).toBe(200);
    expect(submitted.data<Post>().status).toBe('IN_REVIEW');

    const published = await editor.request('POST', `/posts/${post.id}/publish`, {
      body: { expectedVersion: submitted.data<Post>().version },
    });
    expect(published.status).toBe(200);
    const live = published.data<Post>();
    expect(live.status).toBe('PUBLISHED');
    expect(live.publishedAt).not.toBeNull();

    const events = sqliteHandle()
      .prepare('SELECT from_status, to_status FROM workflow_events WHERE post_id = ? ORDER BY id')
      .all(post.id) as Array<{ from_status: string; to_status: string }>;
    expect(events).toEqual([
      { from_status: 'DRAFT', to_status: 'IN_REVIEW' },
      { from_status: 'IN_REVIEW', to_status: 'PUBLISHED' },
    ]);

    const audits = sqliteHandle()
      .prepare("SELECT action FROM audit_logs WHERE entity_type = 'post' AND entity_id = ?")
      .all(String(post.id)) as Array<{ action: string }>;
    expect(audits.map((row) => row.action)).toContain('post.published');
  });

  it('rejects an illegal transition with 409 INVALID_STATE_TRANSITION', async () => {
    const post = await createDraft(author, { subject: 'Illegal jump test' });

    const response = await editor.request('POST', `/posts/${post.id}/publish`, {
      body: { expectedVersion: post.version },
    });

    expect(response.status).toBe(409);
    expect(response.error()?.code).toBe('INVALID_STATE_TRANSITION');
    expect(response.error()?.details).toMatchObject({ from: 'DRAFT', to: 'PUBLISHED' });
  });

  it('does not let an author publish by calling the API directly', async () => {
    const post = await createDraft(author, { subject: 'Author publish attempt' });
    const submitted = await author.request('POST', `/posts/${post.id}/submit`, {
      body: { expectedVersion: post.version },
    });

    const response = await author.request('POST', `/posts/${post.id}/publish`, {
      body: { expectedVersion: submitted.data<Post>().version },
    });

    expect(response.status).toBe(403);
    expect(response.error()?.code).toBe('FORBIDDEN');

    const unchanged = (await author.request('GET', `/posts/${post.id}`)).data<Post>();
    expect(unchanged.status).toBe('IN_REVIEW');
  });

  it('requires a comment when requesting changes', async () => {
    const post = await createDraft(author, { subject: 'Request changes validation' });
    const submitted = await author.request('POST', `/posts/${post.id}/submit`, {
      body: { expectedVersion: post.version },
    });
    const version = submitted.data<Post>().version;

    const noComment = await editor.request('POST', `/posts/${post.id}/request-changes`, {
      body: { expectedVersion: version },
    });
    expect(noComment.status).toBe(422);
    expect(noComment.error()?.details).toHaveProperty('comment');

    const tooShort = await editor.request('POST', `/posts/${post.id}/request-changes`, {
      body: { expectedVersion: version, comment: 'no' },
    });
    expect(tooShort.status).toBe(422);

    const ok = await editor.request('POST', `/posts/${post.id}/request-changes`, {
      body: { expectedVersion: version, comment: 'Please add a source for the second claim.' },
    });
    expect(ok.status).toBe(200);
    expect(ok.data<Post>().status).toBe('DRAFT');

    const events = sqliteHandle()
      .prepare('SELECT comment FROM workflow_events WHERE post_id = ? ORDER BY id DESC LIMIT 1')
      .get(post.id) as { comment: string };
    expect(events.comment).toBe('Please add a source for the second claim.');
  });

  it('requires a future date when scheduling', async () => {
    const post = await createDraft(author, { subject: 'Scheduling validation' });
    const submitted = await author.request('POST', `/posts/${post.id}/submit`, {
      body: { expectedVersion: post.version },
    });
    const version = submitted.data<Post>().version;

    const past = await editor.request('POST', `/posts/${post.id}/schedule`, {
      body: { expectedVersion: version, scheduledAt: '2020-01-01T00:00:00.000Z' },
    });
    expect(past.status).toBe(422);

    const future = new Date(Date.now() + 86_400_000).toISOString();
    const ok = await editor.request('POST', `/posts/${post.id}/schedule`, {
      body: { expectedVersion: version, scheduledAt: future },
    });
    expect(ok.status).toBe(200);
    expect(ok.data<Post>().status).toBe('SCHEDULED');
    expect(ok.data<Post>().scheduledAt).toBe(future);
  });

  it('clears publishedAt when an archived post returns to draft', async () => {
    const post = await createDraft(author, { subject: 'Archive and restore cycle' });

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
    version = (
      await editor.request('POST', `/posts/${post.id}/archive`, {
        body: { expectedVersion: version },
      })
    ).data<Post>().version;

    const restored = await editor.request('POST', `/posts/${post.id}/restore-draft`, {
      body: { expectedVersion: version },
    });

    expect(restored.status).toBe(200);
    expect(restored.data<Post>().status).toBe('DRAFT');
    expect(restored.data<Post>().publishedAt).toBeNull();
  });

  it('rejects an unknown workflow action', async () => {
    const post = await createDraft(author, { subject: 'Unknown action test' });
    const response = await author.request('POST', `/posts/${post.id}/detonate`, {
      body: { expectedVersion: post.version },
    });
    expect(response.status).toBe(404);
  });
});

describe('soft deletion', () => {
  it('hides the post from listings but keeps its slug reserved', async () => {
    const post = await createDraft(author, { subject: 'Soft delete behaviour' });

    const deleted = await editor.request('DELETE', `/posts/${post.id}`, {
      body: { expectedVersion: post.version },
    });
    expect(deleted.status).toBe(204);

    expect((await editor.request('GET', `/posts/${post.id}`)).status).toBe(404);

    const list = await editor.request('GET', '/posts?pageSize=100');
    expect(list.data<Post[]>().some((entry) => entry.id === post.id)).toBe(false);

    // The row is still there, marked deleted.
    const row = sqliteHandle()
      .prepare('SELECT deleted_at FROM posts WHERE id = ?')
      .get(post.id) as { deleted_at: string | null };
    expect(row.deleted_at).not.toBeNull();

    // The slug cannot be taken over by a new post.
    const takeover = await author.request('POST', '/posts', {
      body: { categoryId, subject: 'Trying to take the slug', slug: post.slug, content: 'Body' },
    });
    expect(takeover.status).toBe(409);
    expect(takeover.error()?.code).toBe('SLUG_EXISTS');
  });
});

describe('unauthenticated access', () => {
  it('rejects every staff post endpoint with 401', async () => {
    const anon = createClient();
    for (const [method, path] of [
      ['GET', '/posts'],
      ['POST', '/posts'],
      ['GET', '/posts/1'],
      ['PATCH', '/posts/1'],
      ['DELETE', '/posts/1'],
      ['GET', '/posts/1/revisions'],
    ] as const) {
      const response = await anon.request(method, path, {
        body: method === 'GET' ? undefined : {},
      });
      expect(response.status, `${method} ${path}`).toBe(401);
    }
  });
});
