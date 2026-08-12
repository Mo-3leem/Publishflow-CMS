import { expect, type Page } from '@playwright/test';

/**
 * Helpers for the remote smoke suite.
 *
 * Credentials come from the environment only — nothing is hard-coded, so this
 * suite can point at any deployment without editing it.
 */

export interface RemoteAccount {
  email: string;
  password: string;
}

function readAccount(role: 'AUTHOR' | 'EDITOR'): RemoteAccount {
  const email = process.env[`REMOTE_${role}_EMAIL`];
  const password = process.env[`REMOTE_${role}_PASSWORD`];

  if (!email || !password) {
    throw new Error(
      `REMOTE_${role}_EMAIL and REMOTE_${role}_PASSWORD must both be set to run the remote smoke suite.`,
    );
  }
  return { email, password };
}

export const accounts = {
  author: () => readAccount('AUTHOR'),
  editor: () => readAccount('EDITOR'),
};

/** Sign in through the real login form and wait for the dashboard. */
export async function signIn(page: Page, account: RemoteAccount): Promise<void> {
  await page.goto('/admin/login');
  await page.getByLabel('Email address').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await page.waitForURL('**/admin');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Welcome back');
}

/**
 * Sign out via the user menu.
 *
 * Located by `aria-haspopup` rather than the user's name, because the seeded
 * display names on the target deployment are not known here.
 */
export async function signOut(page: Page): Promise<void> {
  await page.goto('/admin');
  await page.locator('button[aria-haspopup="menu"]').click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();

  await page.waitForURL('**/admin/login');
  await expect(page.getByRole('heading', { name: /Sign in to/ })).toBeVisible();
}

/** A subject that cannot collide with pre-existing content. */
export function uniqueSubject(): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[^0-9]/g, '')
    .slice(0, 14);
  const salt = Math.random().toString(36).slice(2, 7);
  return `Smoke test ${stamp} ${salt}`;
}
