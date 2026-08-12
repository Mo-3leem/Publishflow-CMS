import { expect, test } from '@playwright/test';
import { accounts, signIn, signOut, uniqueSubject } from './helpers';

/**
 * Remote smoke tests.
 *
 * Exercises a deployed PublishFlow instance the way an external user would:
 * over HTTP, through the browser, with no privileged access. Nothing is
 * migrated, seeded or reset — the suite creates exactly one post and removes it
 * again, and never touches content it did not create.
 */

test.describe('public surface', () => {
  test('the public site renders', async ({ page }) => {
    const response = await page.goto('/');

    expect(response?.status(), 'GET / should return 200').toBe(200);

    // The site name is whatever the deployment configured, so assert structure
    // rather than a specific string.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('header')).toBeVisible();
    await expect(page.locator('footer')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Staff sign in' })).toBeVisible();
  });

  test('the health endpoint reports healthy', async ({ request }) => {
    const response = await request.get('/api/v1/health');

    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', database: 'ok' });
  });

  test('the OpenAPI document is reachable', async ({ request }) => {
    const response = await request.get('/api/v1/openapi.json');

    expect(response.status()).toBe(200);

    const document = (await response.json()) as {
      openapi: string;
      paths: Record<string, unknown>;
    };
    expect(document.openapi).toMatch(/^3\./);
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining(['/auth/login', '/posts', '/public/posts/{slug}']),
    );
  });
});

test('editorial round trip against the live deployment', async ({ page }) => {
  const author = accounts.author();
  const editor = accounts.editor();

  const subject = uniqueSubject();
  const reviewNote = 'Please add a primary source to the second paragraph before publishing.';

  let postId = '';
  let slug = '';

  await test.step('author signs in and the dashboard loads', async () => {
    await signIn(page, author);
    // `exact` matters: the dashboard also links "All posts".
    await expect(page.getByRole('link', { name: 'Posts', exact: true })).toBeVisible();
  });

  await test.step('author is denied an admin-only action', async () => {
    // The real control is server-side, so assert the API refuses rather than
    // just checking that the nav link is hidden.
    for (const path of ['/api/v1/users', '/api/v1/settings', '/api/v1/audit-logs']) {
      const response = await page.request.get(path);
      expect(response.status(), `${path} must be forbidden for an author`).toBe(403);
    }
    await expect(page.getByRole('link', { name: 'Users' })).toHaveCount(0);
  });

  await test.step('author creates a uniquely named draft', async () => {
    await page.goto('/admin/posts/new');
    await page.getByLabel('Subject').fill(subject);
    await page.locator('#content').fill('Created by the remote smoke suite. Safe to delete.');
    await page.getByRole('button', { name: 'Create draft' }).click();

    await page.waitForURL(/\/admin\/posts\/\d+\/edit/);
    postId = /\/admin\/posts\/(\d+)\/edit/.exec(page.url())?.[1] ?? '';
    expect(postId, 'a post id should be in the URL after creation').not.toBe('');

    slug = await page.locator('#slug').inputValue();
    expect(slug).not.toBe('');

    // A draft must not be publicly reachable.
    const publicCheck = await page.request.get(`/api/v1/public/posts/${slug}`);
    expect(publicCheck.status(), 'a draft must not be public').toBe(404);
  });

  await test.step('author submits it for review', async () => {
    await page.getByRole('button', { name: 'Submit for review' }).click();
    await expect(page.getByText('In review').first()).toBeVisible();
  });

  await test.step('author signs out', async () => {
    await signOut(page);
  });

  await test.step('editor signs in and finds the post in the review queue', async () => {
    await signIn(page, editor);

    await page.goto(`/admin/posts?status=IN_REVIEW&q=${encodeURIComponent(subject)}`);
    // `exact` matters: each row also carries "Edit <subject>" and
    // "Revision history for <subject>" action links, so a substring match would
    // resolve to three elements.
    await expect(page.getByRole('link', { name: subject, exact: true })).toBeVisible();
  });

  await test.step('editor requests changes with a typed review note', async () => {
    await page.goto(`/admin/posts/${postId}/edit`);
    await page.getByRole('button', { name: 'Request changes' }).click();

    const note = page.getByLabel('Review note');
    await note.click();
    await expect(note).toBeFocused();

    // Real sequential key events, not a single value assignment.
    await note.pressSequentially(reviewNote, { delay: 15 });
    await expect(note).toHaveValue(reviewNote);
    await expect(note).toBeFocused();

    await page.getByRole('button', { name: 'Send back to draft' }).click();
  });

  await test.step('the post returns to draft with the note stored', async () => {
    await expect(page.getByText('Draft').first()).toBeVisible();
    await expect(page.getByText(reviewNote)).toBeVisible();

    const events = await page.request.get(`/api/v1/posts/${postId}/workflow-events`);
    expect(events.status()).toBe(200);

    const history = (await events.json()).data as Array<{
      fromStatus: string | null;
      toStatus: string;
      comment: string | null;
    }>;
    expect(history[0]).toMatchObject({
      fromStatus: 'IN_REVIEW',
      toStatus: 'DRAFT',
      comment: reviewNote,
    });
  });

  await test.step('the author revises and resubmits', async () => {
    await signOut(page);
    await signIn(page, author);

    await page.goto(`/admin/posts/${postId}/edit`);
    await page
      .locator('#content')
      .fill('Revised by the remote smoke suite, with the source added.');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText(/Saved as version/)).toBeVisible();

    await page.getByRole('button', { name: 'Submit for review' }).click();
    await expect(page.getByText('In review').first()).toBeVisible();

    await signOut(page);
  });

  await test.step('editor publishes it', async () => {
    await signIn(page, editor);
    await page.goto(`/admin/posts/${postId}/edit`);

    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByText('Published').first()).toBeVisible();
  });

  await test.step('the published post is reachable from the public site', async () => {
    const api = await page.request.get(`/api/v1/public/posts/${slug}`);
    expect(api.status()).toBe(200);

    await page.goto(`/posts/${slug}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(subject);
    await expect(page.locator('.prose-article')).toContainText('Revised by the remote smoke suite');
  });

  await test.step('clean up: archive and delete the generated post', async () => {
    // Only ever acts on the post this run created, identified by id.
    await page.goto(`/admin/posts/${postId}/edit`);

    await page.getByRole('button', { name: 'Archive', exact: true }).click();
    // Scope the confirmation to the dialog: the trigger and the confirm button
    // share a label, so an unscoped locator would be ambiguous.
    await page.getByRole('dialog').getByRole('button', { name: 'Archive', exact: true }).click();
    await expect(page.getByText('Archived').first()).toBeVisible();

    // Archiving alone already removes it from the public site.
    const afterArchive = await page.request.get(`/api/v1/public/posts/${slug}`);
    expect(afterArchive.status(), 'an archived post must not be public').toBe(404);

    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete post' }).click();

    await page.waitForURL('**/admin/posts');
    const afterDelete = await page.request.get(`/api/v1/posts/${postId}`);
    expect(afterDelete.status(), 'the deleted post should no longer be readable').toBe(404);
  });

  await test.step('editor signs out', async () => {
    await signOut(page);

    // The session really is gone, not just the UI.
    const me = await page.request.get('/api/v1/auth/me');
    expect(me.status()).toBe(401);
  });
});
