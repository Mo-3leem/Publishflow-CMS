import { Hono } from 'hono';
import { changePasswordBody, loginBody } from '@/server/contracts/schemas';
import { AppError } from '@/server/errors/app-error';
import { changeOwnPassword, login, logout } from '@/server/services/auth-service';
import { requireAuth } from '../middleware/auth';
import { clientKey, rateLimit } from '../middleware/rate-limit';
import { clearCsrfCookie, clearSessionCookie, setCsrfCookie, setSessionCookie } from '../cookies';
import { actorContextOf, type AppBindings } from '../types';
import { parseJson } from './helpers';

export const authRoutes = new Hono<AppBindings>();

/**
 * `POST /auth/login`
 *
 * Rate-limited twice over: this per-process limiter blunts bursts, and the
 * database-backed per (email, client) counter in the service survives restarts.
 */
authRoutes.post('/login', rateLimit({ windowMs: 60_000, max: 20, scope: 'login' }), async (c) => {
  const body = await parseJson(c, loginBody);
  const requestId = c.get('requestId');

  const result = await login({
    email: body.email,
    password: body.password,
    userAgent: c.req.header('user-agent') ?? null,
    clientKey: clientKey(c),
    requestId,
  });

  setSessionCookie(c, result.session.token, result.session.expiresAt);
  const csrfToken = setCsrfCookie(c, result.session.tokenHash);

  return c.json({ data: { user: result.user, csrfToken } }, 200);
});

authRoutes.post('/logout', requireAuth(), (c) => {
  const principal = c.get('principal');
  const sessionId = c.get('sessionId');
  if (principal && sessionId !== undefined) {
    logout(actorContextOf(principal, c.get('requestId')), sessionId);
  }
  clearSessionCookie(c);
  clearCsrfCookie(c);
  return c.body(null, 204);
});

authRoutes.get('/me', requireAuth(), (c) => {
  const principal = c.get('principal');
  if (!principal) throw AppError.authRequired();
  return c.json({ data: { user: principal } });
});

/**
 * `GET /auth/csrf`
 *
 * Mints a fresh session-bound token and sets the matching readable cookie. The
 * browser client calls this once on load and after any 403 CSRF_FAILED.
 */
authRoutes.get('/csrf', requireAuth(), (c) => {
  const sessionTokenHash = c.get('sessionTokenHash');
  if (!sessionTokenHash) throw AppError.authRequired();
  const csrfToken = setCsrfCookie(c, sessionTokenHash);
  return c.json({ data: { csrfToken } });
});

authRoutes.post('/change-password', requireAuth(), async (c) => {
  const principal = c.get('principal');
  const sessionId = c.get('sessionId');
  if (!principal || sessionId === undefined) throw AppError.authRequired();

  const body = await parseJson(c, changePasswordBody);

  const session = await changeOwnPassword(
    actorContextOf(principal, c.get('requestId')),
    sessionId,
    {
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
      userAgent: c.req.header('user-agent') ?? null,
    },
  );

  setSessionCookie(c, session.token, session.expiresAt);
  const csrfToken = setCsrfCookie(c, session.tokenHash);

  return c.json({
    data: {
      message: 'Password updated. All other sessions were signed out.',
      csrfToken,
    },
  });
});
