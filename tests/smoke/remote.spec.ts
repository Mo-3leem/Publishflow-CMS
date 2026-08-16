import { expect, test } from '@playwright/test';
import {
  accounts,
  apiGet,
  gotoAdmin,
  gotoWithRetry,
  signIn,
  signOut,
  uniqueSubject,
} from './helpers';

/**
 * Remote smoke tests.
 *
 * Exercises a deployed PublishFlow instance the way an external user would:
 * over HTTP, through the browser, with no privileged access. Nothing is
 * migrated, seeded or reset — the suite creates exactly one post and removes it
 * again, and never touches content it did not create.
 *
 * Admin navigation goes through `gotoAdmin`, which waits for React to hydrate
 * the target page. The deployment under test is a Next.js dev server behind a
 * Cloudflare tunnel, where a click can otherwise land on server-rendered HTML
 * before any handler is attached and silently do nothing.
 */

test.describe('public surface', () => {
  test('the public site renders', async ({ page }) => {
    const response = await gotoWithRetry(page, '/');

    expect(response.status(), 'GET / should return 200').toBe(200);

    // The site name is whatever the deployment configured, so assert structure
    // rather than a specific string.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('header')).toBeVisible();
    await expect(page.locator('footer')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Staff sign in' })).toBeVisible();
  });

  test('the health endpoint reports healthy', async ({ request }) => {
    const response = await apiGet(request, '/api/v1/health');

    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', database: 'ok' });
  });

  test('the OpenAPI document is reachable', async ({ request }) => {
    const response = await apiGet(request, '/api/v1/openapi.json');

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

  await test.step('author is denied admin-only actions', async () => {
    // The real control is server-side, so assert the API refuses rather than
    // only checking that the nav link is hidden.
    for (const path of ['/api/v1/users', '/api/v1/settings', '/api/v1/audit-logs']) {
      const response = await apiGet(page.request, path);
      expect(response.status(), `${path} must be forbidden for an author`).toBe(403);
    }
    await expect(page.getByRole('link', { name: 'Users' })).toHaveCount(0);
  });

  await test.step('author creates a uniquely named draft', async () => {
    await gotoAdmin(page, '/admin/posts/new');

    await page.getByLabel('Subject').fill(subject);
    await page.locator('#content').fill('Created by the remote smoke suite. Safe to delete.');
    await page.getByRole('button', { name: 'Create draft' }).click();

    await page.waitForURL(/\/admin\/posts\/\d+\/edit/, { timeout: 90_000 });
    postId = /\/admin\/posts\/(\d+)\/edit/.exec(page.url())?.[1] ?? '';
    expect(postId, 'a post id should be in the URL after creation').not.toBe('');

    slug = await page.locator('#slug').inputValue();
    expect(slug).not.toBe('');
  });

  await test.step('the draft is not publicly accessible', async () => {
    const response = await apiGet(page.request, `/api/v1/public/posts/${slug}`);
    expect(response.status(), 'a draft must not be public').toBe(404);
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

    await gotoAdmin(page, `/admin/posts?status=IN_REVIEW&q=${encodeURIComponent(subject)}`);
    // `exact` matters: each row also carries "Edit <subject>" and
    // "Revision history for <subject>" action links.
    await expect(page.getByRole('link', { name: subject, exact: true })).toBeVisible();
  });

  await test.step('editor requests changes with a typed review note', async () => {
    await gotoAdmin(page, `/admin/posts/${postId}/edit`);
    await page.getByRole('button', { name: 'Request changes' }).click();

    const note = page.getByLabel('Review note');
    await expect(note).toBeVisible();
    await note.click();
    await expect(note).toBeFocused();

    // Real sequential key events, not a single value assignment.
    await note.pressSequentially(reviewNote, { delay: 15 });
    await expect(note).toHaveValue(reviewNote);
    await expect(note, 'the field must keep focus while typing').toBeFocused();

    await page.getByRole('button', { name: 'Send back to draft' }).click();
  });

  await test.step('the post returns to draft with the note stored', async () => {
    await expect(page.getByText('Draft').first()).toBeVisible();
    await expect(page.getByText(reviewNote).first()).toBeVisible();

    const events = await apiGet(page.request, `/api/v1/posts/${postId}/workflow-events`);
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

  await test.step('editor signs out', async () => {
    await signOut(page);
  });

  await test.step('author edits the returned draft and resubmits', async () => {
    await signIn(page, author);
    await gotoAdmin(page, `/admin/posts/${postId}/edit`);

    await page
      .locator('#content')
      .fill('Revised by the remote smoke suite, with the source added.');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText(/Saved as version/)).toBeVisible();

    await page.getByRole('button', { name: 'Submit for review' }).click();
    await expect(page.getByText('In review').first()).toBeVisible();
  });

  await test.step('author signs out', async () => {
    await signOut(page);
  });

  await test.step('editor signs back in and publishes it', async () => {
    await signIn(page, editor);
    await gotoAdmin(page, `/admin/posts/${postId}/edit`);

    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByText('Published').first()).toBeVisible();
  });

  await test.step('the published post is accessible publicly', async () => {
    const api = await apiGet(page.request, `/api/v1/public/posts/${slug}`);
    expect(api.status()).toBe(200);

    await gotoWithRetry(page, `/posts/${slug}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(subject);
    await expect(page.locator('.prose-article')).toContainText('Revised by the remote smoke suite');
  });

  await test.step('editor archives it and it leaves the public site', async () => {
    // Addressed by the id captured at creation — never by title matching.
    await gotoAdmin(page, `/admin/posts/${postId}/edit`);

    await page.getByRole('button', { name: 'Archive', exact: true }).click();
    // Scope the confirmation to the dialog: the trigger and the confirm button
    // share a label, so an unscoped locator would be ambiguous.
    await page.getByRole('dialog').getByRole('button', { name: 'Archive', exact: true }).click();
    await expect(page.getByText('Archived').first()).toBeVisible();

    const afterArchive = await apiGet(page.request, `/api/v1/public/posts/${slug}`);
    expect(afterArchive.status(), 'an archived post must not be public').toBe(404);
  });

  await test.step('clean up the smoke-test post', async () => {
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete post' }).click();

    await page.waitForURL('**/admin/posts', { timeout: 90_000 });

    const afterDelete = await apiGet(page.request, `/api/v1/posts/${postId}`);
    expect(afterDelete.status(), 'the deleted post should no longer be readable').toBe(404);
  });

  await test.step('final logout succeeds', async () => {
    await signOut(page);

    // The session really is gone, not just the UI.
    const me = await apiGet(page.request, '/api/v1/auth/me');
    expect(me.status()).toBe(401);
  });
});
