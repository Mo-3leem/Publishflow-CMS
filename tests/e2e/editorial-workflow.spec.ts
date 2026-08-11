import { expect, test } from '@playwright/test';
import { createDraft, signIn, signOut, uniqueSubject } from './helpers';

/**
 * Flow A — the full editorial round trip.
 *
 * Author drafts and submits, editor requests changes, author revises and
 * resubmits, editor publishes, and the article appears on the public site.
 */
test('editorial workflow: draft → review → changes → publish → public', async ({ page }) => {
  const subject = uniqueSubject('E2E editorial');

  await signIn(page, 'author');
  const postId = await createDraft(page, subject, 'First version of the body.');

  // The draft is not publicly visible.
  const slug = await page.locator('#slug').inputValue();
  const publicCheck = await page.request.get(`/api/v1/public/posts/${slug}`);
  expect(publicCheck.status()).toBe(404);

  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByText('In review').first()).toBeVisible();

  // The author can no longer edit it.
  await expect(page.getByText(/only edit your own posts while they are drafts/i)).toBeVisible();

  await signOut(page);

  // The editor sends it back with a note.
  await signIn(page, 'editor');
  await page.goto(`/admin/posts/${postId}/edit`);

  await page.getByRole('button', { name: 'Request changes' }).click();
  await page.getByLabel('Review note').fill('Please add a source link to the second paragraph.');
  await page.getByRole('button', { name: 'Send back to draft' }).click();

  await expect(page.getByText('Draft').first()).toBeVisible();
  await expect(page.getByText('Please add a source link to the second paragraph.')).toBeVisible();

  await signOut(page);

  // The author revises and resubmits.
  await signIn(page, 'author');
  await page.goto(`/admin/posts/${postId}/edit`);

  await page.locator('#content').fill('Revised body with the requested source link.');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText(/Saved as version/)).toBeVisible();

  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByText('In review').first()).toBeVisible();

  await signOut(page);

  // The editor publishes.
  await signIn(page, 'editor');
  await page.goto(`/admin/posts/${postId}/edit`);
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Published').first()).toBeVisible();

  // The article is now live.
  await page.goto(`/posts/${slug}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(subject);
  await expect(page.getByText('Revised body with the requested source link.')).toBeVisible();
});

test('authorization: an author cannot reach admin-only screens or APIs', async ({ page }) => {
  await signIn(page, 'author');

  // The navigation does not offer them.
  await expect(page.getByRole('link', { name: 'Users' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Audit log' })).toHaveCount(0);

  // Navigating directly shows a refusal rather than the screen.
  await page.goto('/admin/users');
  await expect(page.getByText('Only administrators can manage user accounts.')).toBeVisible();

  await page.goto('/admin/settings');
  await expect(page.getByText('Only administrators can change site settings.')).toBeVisible();

  // And the API refuses directly, which is the control that actually matters.
  for (const path of ['/api/v1/users', '/api/v1/settings', '/api/v1/audit-logs']) {
    const response = await page.request.get(path);
    expect(response.status(), path).toBe(403);
  }
});

test('authorization: an unauthenticated visitor is redirected away from the admin', async ({
  page,
}) => {
  await page.goto('/admin');
  await page.waitForURL('**/admin/login');
  await expect(page.getByRole('heading', { name: /Sign in to/ })).toBeVisible();
});

test('an author cannot publish through a direct API call', async ({ page }) => {
  await signIn(page, 'author');
  const subject = uniqueSubject('E2E direct publish');
  const postId = await createDraft(page, subject);

  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByText('In review').first()).toBeVisible();

  const csrf = (await page.context().cookies()).find((cookie) => cookie.name === 'pf_csrf');

  const response = await page.request.post(`/api/v1/posts/${postId}/publish`, {
    headers: { 'X-CSRF-Token': csrf?.value ?? '' },
    data: { expectedVersion: 2 },
  });

  expect(response.status()).toBe(403);
  expect((await response.json()).error.code).toBe('FORBIDDEN');
});
