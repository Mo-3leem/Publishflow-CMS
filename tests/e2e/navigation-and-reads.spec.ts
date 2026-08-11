import { expect, test } from '@playwright/test';
import { createDraft, signIn, uniqueSubject } from './helpers';

/**
 * Flow C — settings and menus change the public site.
 */
test('admin changes the site name and menu order, and the public header follows', async ({
  page,
}) => {
  await signIn(page, 'admin');

  const newName = `PublishFlow ${Date.now().toString(36).slice(-4)}`;

  await page.goto('/admin/settings');
  await page.getByLabel('Site name').fill(newName);
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText(/Settings saved/)).toBeVisible();

  // The public site picks it up.
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(newName);

  // Read the current public header order.
  const before = await page.locator('header nav[aria-label="Main navigation"] a').allTextContents();
  expect(before.length).toBeGreaterThan(1);

  // Move the second top-level item up, then save the order.
  await page.goto('/admin/menus');
  await expect(page.getByRole('heading', { name: 'Menus' })).toBeVisible();

  const items = page.locator('ul > li').filter({ has: page.getByLabel(/^Move .* up$/) });
  const secondTitle = (await items.nth(1).locator('span').first().textContent())?.trim();

  await items
    .nth(1)
    .getByLabel(/^Move .* up$/)
    .click();
  await page.getByRole('button', { name: 'Save order' }).click();
  await expect(page.getByText('Menu order saved.')).toBeVisible();

  // The public header reflects the new order.
  await page.goto('/');
  const after = await page.locator('header nav[aria-label="Main navigation"] a').allTextContents();
  expect(after[0]?.trim()).toBe(secondTitle);
  expect(after).not.toEqual(before);
});

/**
 * Flow D — read counting is de-duplicated per browser per UTC day.
 */
test('refreshing a post counts at most one read, while a second browser adds one', async ({
  browser,
}) => {
  const subject = uniqueSubject('E2E reads');

  const authorContext = await browser.newContext();
  const authorPage = await authorContext.newPage();

  let slug = '';
  try {
    await signIn(authorPage, 'editor');
    await createDraft(authorPage, subject, 'An article whose reads are counted.');
    slug = await authorPage.locator('#slug').inputValue();

    await authorPage.getByRole('button', { name: 'Submit for review' }).click();
    await authorPage.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(authorPage.getByText('Published').first()).toBeVisible();
  } finally {
    await authorContext.close();
  }

  /**
   * The view request is fire-and-forget, so the count is polled rather than
   * awaited on a specific response — `waitForResponse` after `goto` races with
   * a request that may already have completed.
   */
  const readsCount = async (page: import('@playwright/test').Page): Promise<number> => {
    const response = await page.request.get(`/api/v1/public/posts/${slug}`);
    return (await response.json()).data.readsCount as number;
  };

  // First visitor reads the article several times.
  const visitorA = await browser.newContext();
  const pageA = await visitorA.newPage();
  try {
    for (let visit = 0; visit < 3; visit += 1) {
      await pageA.goto(`/posts/${slug}`);
      await expect(pageA.getByRole('heading', { level: 1 })).toHaveText(subject);
    }

    await expect.poll(() => readsCount(pageA), { timeout: 10_000 }).toBe(1);

    // Give any late request a chance to land, then confirm it is still 1.
    await pageA.waitForTimeout(500);
    expect(await readsCount(pageA)).toBe(1);
  } finally {
    await visitorA.close();
  }

  // A different browser counts exactly one more.
  const visitorB = await browser.newContext();
  const pageB = await visitorB.newPage();
  try {
    await pageB.goto(`/posts/${slug}`);
    await expect(pageB.getByRole('heading', { level: 1 })).toHaveText(subject);

    await expect.poll(() => readsCount(pageB), { timeout: 10_000 }).toBe(2);
  } finally {
    await visitorB.close();
  }
});

/**
 * Public site basics: search, category pages and the not-found behaviour.
 */
test('public search finds a published article and never surfaces a draft', async ({ page }) => {
  const publishedSubject = uniqueSubject('E2E searchable kumquat');
  const draftSubject = uniqueSubject('E2E hidden kumquat');

  await signIn(page, 'editor');

  await createDraft(page, publishedSubject, 'Body mentioning kumquat prominently.');
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Published').first()).toBeVisible();

  await createDraft(page, draftSubject, 'Another body mentioning kumquat but unpublished.');

  await page.goto('/search?q=kumquat');
  await expect(page.getByText(publishedSubject)).toBeVisible();
  await expect(page.getByText(draftSubject)).toHaveCount(0);
});

test('an unpublished slug returns the friendly not-found page', async ({ page }) => {
  await page.goto('/posts/this-slug-does-not-exist');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to the home page' })).toBeVisible();
});

test('robots.txt and sitemap.xml expose only public content', async ({ page }) => {
  const robots = await page.request.get('/robots.txt');
  expect(robots.status()).toBe(200);
  const robotsBody = await robots.text();
  expect(robotsBody).toContain('Disallow: /admin');
  expect(robotsBody).toContain('Disallow: /api/');
  expect(robotsBody).toContain('Sitemap:');

  const sitemap = await page.request.get('/sitemap.xml');
  expect(sitemap.status()).toBe(200);
  const sitemapBody = await sitemap.text();
  expect(sitemapBody).toContain('<urlset');
  expect(sitemapBody).not.toContain('/admin');
});

test('the OpenAPI documentation is reachable', async ({ page }) => {
  const spec = await page.request.get('/api/v1/openapi.json');
  expect(spec.status()).toBe(200);

  const document = await spec.json();
  expect(document.openapi).toMatch(/^3\./);
  expect(Object.keys(document.paths)).toContain('/posts/{id}/publish');

  // The docs page is asserted at the HTML level rather than the rendered DOM:
  // Swagger UI pulls its bundle from a CDN, which is unavailable in an offline
  // CI run. The served document itself is what this project is responsible for.
  const docs = await page.request.get('/api/v1/docs');
  expect(docs.status()).toBe(200);
  const html = await docs.text();
  expect(html).toContain('swagger');
  expect(html).toContain('/api/v1/openapi.json');
});
