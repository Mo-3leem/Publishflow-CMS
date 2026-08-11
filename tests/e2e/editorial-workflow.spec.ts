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

/**
 * Regression: the Review note textarea must keep focus while typing.
 *
 * The dialog's focus-management effect used to list `onClose` in its dependency
 * array. `onClose` is an inline arrow at the call site, so its identity changed
 * on every keystroke-driven re-render; the effect tore down and re-ran, restoring
 * focus to the trigger and then to the dialog's first focusable element (the
 * close button). Every character landed in a different place.
 *
 * `pressSequentially` types character by character with real key events, so a
 * regression reappears here as a truncated value and a lost activeElement.
 */
test('request-changes: the review note keeps focus through continuous typing', async ({ page }) => {
  const subject = uniqueSubject('E2E focus');
  const note = 'Please add a primary source for the second paragraph before this goes live.';

  await signIn(page, 'author');
  const postId = await createDraft(page, subject, 'Body awaiting review.');
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByText('In review').first()).toBeVisible();
  await signOut(page);

  await signIn(page, 'editor');
  await page.goto(`/admin/posts/${postId}/edit`);
  await page.getByRole('button', { name: 'Request changes' }).click();

  const textarea = page.getByLabel('Review note');
  await expect(textarea).toBeVisible();

  // Focus once, then never touch the mouse again.
  await textarea.click();
  await expect(textarea).toBeFocused();

  await textarea.pressSequentially(note, { delay: 15 });

  // The whole sentence arrived, in order, with nothing dropped.
  await expect(textarea).toHaveValue(note);
  // ...and focus never left the field while typing.
  await expect(textarea).toBeFocused();

  // Guard the specific old symptom: focus must not have been stolen by the
  // dialog's close button.
  await expect(page.getByRole('button', { name: 'Close dialog' })).not.toBeFocused();

  // The workflow itself still behaves correctly.
  await page.getByRole('button', { name: 'Send back to draft' }).click();
  await expect(page.getByText('Draft').first()).toBeVisible();

  // The note was stored and is shown in the workflow history.
  await expect(page.getByText(note)).toBeVisible();

  // And the server agrees: status DRAFT, with the comment on the event.
  const detail = await page.request.get(`/api/v1/posts/${postId}`);
  expect((await detail.json()).data.status).toBe('DRAFT');

  const events = await page.request.get(`/api/v1/posts/${postId}/workflow-events`);
  const latest = (await events.json()).data as Array<{
    fromStatus: string | null;
    toStatus: string;
    comment: string | null;
  }>;
  expect(latest[0]).toMatchObject({
    fromStatus: 'IN_REVIEW',
    toStatus: 'DRAFT',
    comment: note,
  });
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
