import { expect, type Page } from '@playwright/test';

/** Shared helpers for the Playwright flows. */

export const ACCOUNTS = {
  admin: { email: 'admin@publishflow.local', password: 'AdminDemo123!ChangeMe' },
  editor: { email: 'editor@publishflow.local', password: 'EditorDemo123!ChangeMe' },
  author: { email: 'author@publishflow.local', password: 'AuthorDemo123!ChangeMe' },
} as const;

export async function signIn(page: Page, account: keyof typeof ACCOUNTS): Promise<void> {
  const { email, password } = ACCOUNTS[account];

  await page.goto('/admin/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await page.waitForURL('**/admin');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Welcome back');
}

export async function signOut(page: Page): Promise<void> {
  await page.goto('/admin');
  await page.getByRole('button', { name: /Dana|Marco|Priya|Tom/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await page.waitForURL('**/admin/login');
}

/** Create a draft through the editor UI and return its numeric id. */
export async function createDraft(
  page: Page,
  subject: string,
  content = 'Body written by the end-to-end test.',
): Promise<number> {
  await page.goto('/admin/posts/new');

  await page.getByLabel('Subject').fill(subject);
  await page.locator('#content').fill(content);
  await page.getByRole('button', { name: 'Create draft' }).click();

  await page.waitForURL(/\/admin\/posts\/\d+\/edit/);
  const match = /\/admin\/posts\/(\d+)\/edit/.exec(page.url());
  if (!match?.[1]) throw new Error(`Could not read the post id from ${page.url()}`);
  return Number(match[1]);
}

/** Click a workflow button and wait for the status badge to settle. */
export async function runWorkflowAction(page: Page, name: string | RegExp): Promise<void> {
  await page.getByRole('button', { name }).click();
}

export function uniqueSubject(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
}
