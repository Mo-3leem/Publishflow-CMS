import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createClient,
  setupTestDatabase,
  SEED_ACCOUNTS,
  signedInAs,
  sqliteHandle,
} from '../helpers/test-app';

let cleanup: () => void;

beforeAll(async () => {
  cleanup = await setupTestDatabase();
});

afterAll(() => cleanup());

describe('POST /auth/login', () => {
  it('creates a session for a seeded account', async () => {
    const client = createClient();
    const response = await client.login(SEED_ACCOUNTS.admin.email, SEED_ACCOUNTS.admin.password);

    expect(response.status).toBe(200);
    const data = response.data<{ user: { email: string; role: string } }>();
    expect(data.user.email).toBe(SEED_ACCOUNTS.admin.email);
    expect(data.user.role).toBe('ADMIN');
    expect(client.cookies()).toContain('pf_session=');
  });

  it('never returns the password hash', async () => {
    const client = createClient();
    const response = await client.login(SEED_ACCOUNTS.admin.email, SEED_ACCOUNTS.admin.password);
    expect(JSON.stringify(response.body)).not.toMatch(/argon2|passwordHash|password_hash/i);
  });

  it('sets an HttpOnly session cookie', async () => {
    const client = createClient();
    const response = await client.login(SEED_ACCOUNTS.admin.email, SEED_ACCOUNTS.admin.password);
    const cookies = response.headers.getSetCookie();
    const session = cookies.find((entry) => entry.startsWith('pf_session='));
    expect(session).toBeDefined();
    expect(session?.toLowerCase()).toContain('httponly');
    expect(session?.toLowerCase()).toContain('samesite=lax');
  });

  it('stores only a hash of the session token, never the raw value', () => {
    const rows = sqliteHandle().prepare('SELECT token_hash FROM sessions').all() as Array<{
      token_hash: string;
    }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      // HMAC-SHA256 hex.
      expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('is case-insensitive about the email address', async () => {
    const client = createClient();
    const response = await client.login(
      SEED_ACCOUNTS.editor.email.toUpperCase(),
      SEED_ACCOUNTS.editor.password,
    );
    expect(response.status).toBe(200);
  });

  it('returns the same generic error for a wrong password and an unknown account', async () => {
    const wrongPassword = await createClient().login(
      SEED_ACCOUNTS.admin.email,
      'definitely-not-the-password',
    );
    const unknownAccount = await createClient().login(
      'nobody@publishflow.local',
      'definitely-not-the-password',
    );

    expect(wrongPassword.status).toBe(401);
    expect(unknownAccount.status).toBe(401);
    expect(wrongPassword.error()?.code).toBe(unknownAccount.error()?.code);
    expect(wrongPassword.error()?.message).toBe(unknownAccount.error()?.message);
    // The message must not disclose *which* half was wrong, or whether the
    // account exists at all.
    expect(wrongPassword.error()?.message).not.toMatch(
      /no such|not found|unknown|does not exist|incorrect password|wrong password|disabled/i,
    );
    expect(wrongPassword.error()?.details).toBeUndefined();
  });

  it('rejects a malformed payload with 422', async () => {
    const response = await createClient().request('POST', '/auth/login', {
      body: { email: '', password: '' },
    });
    expect(response.status).toBe(422);
    expect(response.error()?.code).toBe('VALIDATION_ERROR');
  });
});

describe('disabled accounts', () => {
  it('cannot log in, and the error is indistinguishable from a wrong password', async () => {
    const admin = await signedInAs('admin');

    const users = await admin.request('GET', '/users?pageSize=50');
    const list = users.data<Array<{ id: number; email: string }>>();
    const target = list.find((user) => user.email === SEED_ACCOUNTS.author2.email);
    expect(target).toBeDefined();

    const disable = await admin.request('PATCH', `/users/${target?.id}`, {
      body: { status: 'DISABLED' },
    });
    expect(disable.status).toBe(200);

    const attempt = await createClient().login(
      SEED_ACCOUNTS.author2.email,
      SEED_ACCOUNTS.author2.password,
    );
    expect(attempt.status).toBe(401);
    expect(attempt.error()?.code).toBe('AUTH_INVALID_CREDENTIALS');

    // Restore for other cases in this file.
    await admin.request('PATCH', `/users/${target?.id}`, { body: { status: 'ACTIVE' } });
  });

  it('revokes every active session the moment the account is disabled', async () => {
    const admin = await signedInAs('admin');
    const victim = await signedInAs('author2');

    // The victim has a working session before the change.
    expect((await victim.request('GET', '/auth/me')).status).toBe(200);

    const users = await admin.request('GET', '/users?pageSize=50');
    const target = users
      .data<Array<{ id: number; email: string }>>()
      .find((user) => user.email === SEED_ACCOUNTS.author2.email);

    await admin.request('PATCH', `/users/${target?.id}`, { body: { status: 'DISABLED' } });

    const after = await victim.request('GET', '/auth/me');
    expect(after.status).toBe(401);

    await admin.request('PATCH', `/users/${target?.id}`, { body: { status: 'ACTIVE' } });
  });
});

describe('POST /auth/logout', () => {
  it('revokes the current session', async () => {
    const client = await signedInAs('editor');
    expect((await client.request('GET', '/auth/me')).status).toBe(200);

    const logout = await client.logout();
    expect(logout.status).toBe(204);

    expect((await client.request('GET', '/auth/me')).status).toBe(401);
  });
});

describe('GET /auth/me', () => {
  it('requires a session', async () => {
    const response = await createClient().request('GET', '/auth/me');
    expect(response.status).toBe(401);
    expect(response.error()?.code).toBe('AUTH_REQUIRED');
  });

  it('returns the safe principal only', async () => {
    const client = await signedInAs('author');
    const response = await client.request('GET', '/auth/me');
    const user = response.data<{ user: Record<string, unknown> }>().user;
    expect(Object.keys(user).sort()).toEqual(['email', 'id', 'name', 'role', 'status']);
  });
});

describe('password change', () => {
  it('rejects a wrong current password', async () => {
    const client = await signedInAs('author');
    const response = await client.request('POST', '/auth/change-password', {
      body: { currentPassword: 'wrong-password-value', newPassword: 'a-brand-new-password-1' },
    });
    expect(response.status).toBe(422);
  });

  it('enforces the minimum length on the new password', async () => {
    const client = await signedInAs('author');
    const response = await client.request('POST', '/auth/change-password', {
      body: { currentPassword: SEED_ACCOUNTS.author.password, newPassword: 'short' },
    });
    expect(response.status).toBe(422);
  });

  it('changes the password, revokes other sessions and keeps the caller signed in', async () => {
    const newPassword = 'a-fresh-and-long-passphrase';

    const primary = await signedInAs('editor');
    const other = await signedInAs('editor');
    expect((await other.request('GET', '/auth/me')).status).toBe(200);

    const response = await primary.request('POST', '/auth/change-password', {
      body: { currentPassword: SEED_ACCOUNTS.editor.password, newPassword },
    });
    expect(response.status).toBe(200);

    // The other device is signed out...
    expect((await other.request('GET', '/auth/me')).status).toBe(401);
    // ...while the caller keeps working on a rotated session.
    expect((await primary.request('GET', '/auth/me')).status).toBe(200);

    // The old password no longer works; the new one does.
    expect(
      (await createClient().login(SEED_ACCOUNTS.editor.email, SEED_ACCOUNTS.editor.password))
        .status,
    ).toBe(401);
    const relogin = await createClient().login(SEED_ACCOUNTS.editor.email, newPassword);
    expect(relogin.status).toBe(200);

    // Put it back so later files that reuse this database are unaffected.
    const restored = await createClient();
    await restored.login(SEED_ACCOUNTS.editor.email, newPassword);
    await restored.request('POST', '/auth/change-password', {
      body: { currentPassword: newPassword, newPassword: SEED_ACCOUNTS.editor.password },
    });
  });
});

describe('login rate limiting', () => {
  it('locks out after repeated failures for the same identity', async () => {
    const client = createClient();
    let sawRateLimit = false;

    for (let attempt = 0; attempt < 14; attempt += 1) {
      const response = await client.login(SEED_ACCOUNTS.author.email, `wrong-password-${attempt}`);
      if (response.status === 429) {
        sawRateLimit = true;
        expect(response.error()?.code).toBe('RATE_LIMITED');
        break;
      }
    }

    expect(sawRateLimit).toBe(true);
  });
});
