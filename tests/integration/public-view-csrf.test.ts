import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createClient,
  setupTestDatabase,
  signedInAs,
  sqliteHandle,
  type TestContext,
} from '../helpers/test-app';

/**
 * `POST /public/posts/:slug/view` is a public, session-independent analytics
 * write: it identifies the reader by an opaque visitor cookie, never by the
 * session, and returns only data the article page already shows.
 *
 * It used to 403 for signed-in staff. The CSRF middleware requires a token as
 * soon as a session exists, and the ViewTracker — a public component — has no
 * token to send. Readers who happened to be logged in went uncounted.
 *
 * These tests pin both halves: the view endpoint works with or without a
 * session, and genuinely authenticated mutations still refuse a missing token.
 */

let cleanup: () => void;
let editor: TestContext;
let author: TestContext;
let admin: TestContext;
let categoryId: number;
let slug: string;
let postId: number;

beforeAll(async () => {
  cleanup = await setupTestDatabase();
  editor = await signedInAs('editor');
  author = await signedInAs('author');
  admin = await signedInAs('admin');

  const categories = await editor.request('GET', '/categories');
  categoryId = categories.data<Array<{ id: number }>>()[0]!.id;

  const created = await editor.request('POST', '/posts', {
    body: { categoryId, subject: 'Readable by staff and strangers alike', content: 'Body.' },
  });
  const post = created.data<{ id: number; slug: string; version: number }>();
  postId = post.id;
  slug = post.slug;

  const submitted = await editor.request('POST', `/posts/${postId}/submit`, {
    body: { expectedVersion: post.version },
  });
  await editor.request('POST', `/posts/${postId}/publish`, {
    body: { expectedVersion: submitted.data<{ version: number }>().version },
  });
});

afterAll(() => cleanup());

/** Exactly what the ViewTracker sends: no CSRF token, whatever cookies exist. */
const recordView = (client: TestContext) =>
  client.request('POST', `/public/posts/${slug}/view`, { skipCsrf: true });

interface ViewResult {
  counted: boolean;
  readsCount: number;
}

describe('the public view endpoint accepts readers with or without a session', () => {
  it('records an anonymous view without a CSRF token', async () => {
    const response = await recordView(createClient());

    expect(response.status).toBe(200);
    expect(response.data<ViewResult>().counted).toBe(true);
  });

  it('records a view for a signed-in Author reading the public article', async () => {
    const response = await recordView(author);

    expect(response.status).toBe(200);
    expect(response.data<ViewResult>().counted).toBe(true);
  });

  it('records a view for a signed-in Editor', async () => {
    const response = await recordView(editor);

    expect(response.status).toBe(200);
    expect(response.data<ViewResult>().counted).toBe(true);
  });

  it('records a view for a signed-in Admin', async () => {
    const response = await recordView(admin);

    expect(response.status).toBe(200);
    expect(response.data<ViewResult>().counted).toBe(true);
  });

  /**
   * Staff are readers too, but they are not special readers: the visitor cookie
   * is what identifies them, so each signed-in client counts exactly once.
   */
  it('still de-duplicates a signed-in reader per post per day', async () => {
    const before = await recordView(author);
    expect(before.data<ViewResult>().counted).toBe(false);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const repeat = await recordView(author);
      expect(repeat.data<ViewResult>().counted).toBe(false);
      expect(repeat.data<ViewResult>().readsCount).toBe(before.data<ViewResult>().readsCount);
    }

    // One row per distinct viewer: anonymous + author + editor + admin.
    const rows = sqliteHandle()
      .prepare('SELECT count(*) AS n FROM post_views WHERE post_id = ?')
      .get(postId) as { n: number };
    expect(rows.n).toBe(4);
  });

  it('does not use the session as the viewer identity', async () => {
    // A second client for the same account is a different browser, so it is a
    // different viewer and counts again.
    const secondBrowser = await signedInAs('author');
    const response = await recordView(secondBrowser);

    expect(response.data<ViewResult>().counted).toBe(true);
  });

  it('still refuses to count a view on an unpublished post', async () => {
    const draft = await editor.request('POST', '/posts', {
      body: { categoryId, subject: 'Never published', content: 'Body.' },
    });
    const response = await editor.request(
      'POST',
      `/public/posts/${draft.data<{ slug: string }>().slug}/view`,
      { skipCsrf: true },
    );

    expect(response.status).toBe(404);
  });
});

describe('CSRF protection is unchanged for authenticated mutations', () => {
  it('rejects a post update that omits the CSRF token', async () => {
    const current = await editor.request('GET', `/posts/${postId}`);
    const version = current.data<{ version: number }>().version;

    const response = await editor.request('PATCH', `/posts/${postId}`, {
      body: { expectedVersion: version, subject: 'Renamed without a token' },
      skipCsrf: true,
    });

    expect(response.status).toBe(403);
    expect(response.error()?.code).toBe('CSRF_FAILED');
  });

  it('rejects a publish transition that omits the CSRF token', async () => {
    const response = await editor.request('POST', `/posts/${postId}/archive`, {
      body: { expectedVersion: 99 },
      skipCsrf: true,
    });

    expect(response.status).toBe(403);
    expect(response.error()?.code).toBe('CSRF_FAILED');
  });

  it('rejects a user-creation attempt that omits the CSRF token', async () => {
    const response = await admin.request('POST', '/users', {
      body: {
        name: 'No Token',
        email: 'no-token@publishflow.local',
        password: 'PlentyStrong123!',
        role: 'AUTHOR',
      },
      skipCsrf: true,
    });

    expect(response.status).toBe(403);
    expect(response.error()?.code).toBe('CSRF_FAILED');
  });

  it('rejects logout without a CSRF token', async () => {
    const client = await signedInAs('author');
    const response = await client.request('POST', '/auth/logout', { skipCsrf: true });

    expect(response.status).toBe(403);
    expect(response.error()?.code).toBe('CSRF_FAILED');
  });
});

describe('the view exemption is not a cross-site hole', () => {
  it('rejects a signed-in view request sent from another origin', async () => {
    const response = await author.request('POST', `/public/posts/${slug}/view`, {
      skipCsrf: true,
      origin: 'https://evil.example.com',
    });

    expect(response.status).toBe(403);
    expect(response.error()?.code).toBe('CSRF_FAILED');
  });

  it('rejects a signed-in view request marked cross-site by the browser', async () => {
    const response = await author.request('POST', `/public/posts/${slug}/view`, {
      skipCsrf: true,
      headers: { 'sec-fetch-site': 'cross-site' },
    });

    expect(response.status).toBe(403);
    expect(response.error()?.code).toBe('CSRF_FAILED');
  });

  /** The exemption must be for this endpoint only, not the whole /public tree. */
  it('does not exempt other paths that merely start with the same prefix', async () => {
    const response = await author.request('POST', `/public/posts/${slug}/view/../../../posts`, {
      body: { categoryId, subject: 'Smuggled', content: 'Body.' },
      skipCsrf: true,
    });

    expect(response.status).not.toBe(201);
  });
});
