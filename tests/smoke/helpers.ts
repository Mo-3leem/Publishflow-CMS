import {
  expect,
  type APIRequestContext,
  type APIResponse,
  type Page,
  type Response,
} from '@playwright/test';

/**
 * Helpers for the remote smoke suite.
 *
 * Credentials come from the environment only — nothing is hard-coded, so this
 * suite can point at any deployment without editing it.
 *
 * The target is a Next.js **development** server behind a Cloudflare tunnel.
 * Two consequences shape everything below:
 *
 *  1. Hydration is slow (on-demand compilation, unminified bundles, tunnel
 *     latency), so a click can land on server-rendered HTML before React has
 *     attached its handlers. The click then does nothing — or, on a <form>,
 *     triggers a native GET submission. Every interaction therefore waits for
 *     the specific control to be hydrated first.
 *  2. A quick tunnel occasionally returns a 5xx/handshake error that has
 *     nothing to do with the application. Navigation and plain GETs are
 *     retried a bounded number of times for *transport* failures only; every
 *     application-level status and assertion is left untouched.
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

/* ------------------------------------------------------------------ */
/* Transient tunnel handling                                           */
/* ------------------------------------------------------------------ */

/** Cloudflare tunnel / edge failures that are never the application's fault. */
const TRANSIENT_STATUSES = new Set([502, 503, 504, 520, 521, 522, 523, 524, 525, 526]);

const TRANSIENT_MESSAGE =
  /net::ERR_|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|tunnel|Timeout .* exceeded while waiting for (?:navigation|the page)/i;

function isTransport(error: unknown): boolean {
  return error instanceof Error && TRANSIENT_MESSAGE.test(error.message);
}

/**
 * Navigate, retrying only genuine transport failures.
 *
 * An application error (4xx, a rendered error page, a failed assertion) is
 * returned or thrown as-is — retries must never mask a deterministic failure.
 */
export async function gotoWithRetry(page: Page, path: string, attempts = 3): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
      if (!response) throw new Error(`No response for ${path}`);

      if (TRANSIENT_STATUSES.has(response.status()) && attempt < attempts) {
        lastError = new Error(`${response.status()} from the tunnel for ${path}`);
        await page.waitForTimeout(attempt * 1_000);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      // Anything that is not a transport problem is a real failure.
      if (!isTransport(error) || attempt === attempts) throw error;
      await page.waitForTimeout(attempt * 1_000);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Could not load ${path}`);
}

const backoff = (attempt: number) => new Promise((resolve) => setTimeout(resolve, attempt * 1_000));

/**
 * GET an endpoint, retrying only transport failures and tunnel 5xx.
 *
 * Every application status — 200, 401, 403, 404 — is returned to the caller
 * untouched, so authorization and visibility assertions stay exact.
 */
export async function apiGet(
  ctx: APIRequestContext,
  path: string,
  attempts = 3,
): Promise<APIResponse> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await ctx.get(path);
      if (TRANSIENT_STATUSES.has(response.status()) && attempt < attempts) {
        lastError = new Error(`${response.status()} from the tunnel for ${path}`);
        await backoff(attempt);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (!isTransport(error) || attempt === attempts) throw error;
      await backoff(attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Could not GET ${path}`);
}

/* ------------------------------------------------------------------ */
/* Hydration                                                           */
/* ------------------------------------------------------------------ */

/**
 * Block until React owns the given element.
 *
 * React attaches a `__reactProps$<instance>` key to every host node it renders,
 * and only once hydration has run. Its presence is therefore a precise,
 * behaviour-based signal that this control's handlers are wired — unlike a
 * fixed sleep, which would either be too short or waste time on every step.
 *
 * Scoped to a specific selector rather than the document so the wait means
 * "this button works", not merely "some script executed".
 */
export async function waitForHydration(
  page: Page,
  selector: string,
  timeout = 90_000,
): Promise<void> {
  await page.locator(selector).first().waitFor({ state: 'visible', timeout });

  await page.waitForFunction(
    (sel: string) => {
      const node = document.querySelector(sel);
      if (!node) return false;
      return Object.keys(node).some((key) => key.startsWith('__reactProps$'));
    },
    selector,
    { timeout, polling: 100 },
  );
}

/**
 * Every authenticated admin page renders the user menu, so it anchors hydration.
 *
 * Scoped to the app's own `<header>`: a Next.js **dev** server injects its Dev
 * Tools launcher into a body-level portal, and that button also carries
 * `aria-haspopup="menu"`. An unscoped selector matches both and trips strict
 * mode.
 */
const ADMIN_HYDRATION_ANCHOR = 'header button[aria-haspopup="menu"]';

/** Navigate to an admin page and wait until its client JavaScript is live. */
export async function gotoAdmin(page: Page, path: string): Promise<void> {
  await gotoWithRetry(page, path);
  await waitForHydration(page, ADMIN_HYDRATION_ANCHOR);
}

/* ------------------------------------------------------------------ */
/* Authentication                                                      */
/* ------------------------------------------------------------------ */

/**
 * Sign in through the real login form.
 *
 * `<form onSubmit>` has no `method`/`action`, so submitting it before hydration
 * performs a native **GET** — which would put the password in the query string
 * and land back on the login page. The hydration wait prevents that, and the
 * explicit check afterwards makes it a loud, obvious failure rather than a
 * confusing timeout if it ever happens again.
 */
export async function signIn(page: Page, account: RemoteAccount): Promise<void> {
  await gotoWithRetry(page, '/admin/login');

  // The submit button lives inside the client component that owns onSubmit.
  await waitForHydration(page, 'form button[type="submit"]');

  await page.getByLabel('Email address').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await page.waitForURL('**/admin', { timeout: 90_000 });

  if (/[?&]password=/.test(page.url())) {
    throw new Error(
      'The login form submitted as a native GET (credentials leaked into the URL). ' +
        'Client JavaScript was not ready — the hydration wait did not hold.',
    );
  }

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Welcome back');
  await waitForHydration(page, ADMIN_HYDRATION_ANCHOR);
}

/**
 * Sign out through the real user menu.
 *
 * The menu is located by `aria-haspopup` rather than the account's display
 * name, which is unknown for an arbitrary deployment. The `aria-expanded`
 * assertion between the two clicks is what turns "menuitem never appeared"
 * into the accurate "the menu did not open".
 */
export async function signOut(page: Page): Promise<void> {
  await gotoAdmin(page, '/admin');

  const trigger = page.locator(ADMIN_HYDRATION_ANCHOR);
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');

  await trigger.click();

  // Proves React handled the click, before looking for anything inside the menu.
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');

  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Sign out' }).click();

  await page.waitForURL('**/admin/login', { timeout: 90_000 });
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
