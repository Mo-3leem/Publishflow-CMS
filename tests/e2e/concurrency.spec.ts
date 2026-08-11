import { expect, test } from '@playwright/test';
import { createDraft, signIn, uniqueSubject } from './helpers';

/**
 * Flow B — conflict handling.
 *
 * Two browser contexts load the same version. The first save wins; the second
 * gets a visible conflict and, critically, keeps the text the user had typed.
 */
test('a stale save shows a conflict and preserves the typed text', async ({ browser }) => {
  const subject = uniqueSubject('E2E conflict');

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    await signIn(pageA, 'editor');
    const postId = await createDraft(pageA, subject, 'Shared starting content.');

    // Both contexts open the same version.
    await signIn(pageB, 'admin');
    await pageB.goto(`/admin/posts/${postId}/edit`);
    await expect(pageB.getByText('Version 1')).toBeVisible();

    await pageA.goto(`/admin/posts/${postId}/edit`);
    await expect(pageA.getByText('Version 1')).toBeVisible();

    // Context A saves first and wins.
    await pageA.locator('#content').fill('Content saved by the first editor.');
    await pageA.getByRole('button', { name: 'Save changes' }).click();
    await expect(pageA.getByText(/Saved as version 2/)).toBeVisible();

    // Context B, still on version 1, types something and saves.
    const typedByB = 'Content typed by the second editor that must not be lost.';
    await pageB.locator('#content').fill(typedByB);
    await pageB.getByRole('button', { name: 'Save changes' }).click();

    // A clear conflict message, not a silent overwrite.
    await expect(pageB.getByText('This post was changed by someone else')).toBeVisible();
    await expect(pageB.getByText(/the server now has version 2/i)).toBeVisible();
    await expect(pageB.getByText(/Your unsaved text is still on this page/i)).toBeVisible();

    // The typed text survived on screen.
    await expect(pageB.locator('#content')).toHaveValue(typedByB);

    // And the server still holds context A's version.
    const response = await pageA.request.get(`/api/v1/posts/${postId}`);
    const post = (await response.json()).data as { version: number; content: string };
    expect(post.version).toBe(2);
    expect(post.content).toBe('Content saved by the first editor.');
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

/**
 * Revision recovery: restore older content and confirm the public page follows.
 */
test('an editor can restore an older revision and the public page reflects it', async ({
  page,
}) => {
  const subject = uniqueSubject('E2E revision');

  await signIn(page, 'editor');
  const postId = await createDraft(page, subject, 'The original wording.');
  const slug = await page.locator('#slug').inputValue();

  // Version 2.
  await page.locator('#content').fill('The replacement wording that turned out to be wrong.');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText(/Saved as version 2/)).toBeVisible();

  // Publish so the public page exists.
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Published').first()).toBeVisible();

  // Scope assertions to the rendered article body: the auto-derived excerpt
  // repeats the same sentence above it, which would match twice.
  const articleBody = page.locator('.prose-article');

  await page.goto(`/posts/${slug}`);
  await expect(articleBody).toContainText('The replacement wording that turned out to be wrong.');

  // Restore version 1.
  await page.goto(`/admin/posts/${postId}/revisions`);
  await expect(page.getByRole('heading', { name: 'Revision history' })).toBeVisible();

  const versionOneRow = page.getByRole('row').filter({ hasText: 'v1' }).first();
  await versionOneRow.getByRole('button', { name: 'Restore' }).click();
  await page.getByRole('button', { name: /Restore v1/ }).click();

  await expect(page.getByText(/restored as a new version/i)).toBeVisible();

  // The public page shows the restored wording; the post stayed published.
  await page.goto(`/posts/${slug}`);
  await expect(articleBody).toContainText('The original wording.');
  await expect(articleBody).not.toContainText(
    'The replacement wording that turned out to be wrong.',
  );
});
