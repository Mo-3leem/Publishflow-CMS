import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { swaggerUI } from '@hono/swagger-ui';
import { getSqlite } from '@/server/db';
import { publishDuePosts } from '@/server/services/schedule-service';
import { requireJobSecret, loadSession } from './middleware/auth';
import { csrfProtection } from './middleware/csrf';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { jsonBodyLimit } from './middleware/body-limit';
import { requestContext } from './middleware/request-context';
import { buildOpenApiDocument } from './openapi';
import { auditRoutes } from './routes/audit';
import { authRoutes } from './routes/auth';
import { categoryRoutes } from './routes/categories';
import { mediaRoutes, publicMediaRoutes } from './routes/media';
import { menuRoutes } from './routes/menus';
import { postRoutes } from './routes/posts';
import { publicRoutes } from './routes/public';
import { settingsRoutes } from './routes/settings';
import { userRoutes } from './routes/users';
import type { AppBindings } from './types';

/**
 * The Hono application, mounted by the App Router catch-all at
 * `src/app/api/[[...route]]/route.ts`. Same origin, so no CORS is configured —
 * broad CORS would only widen the attack surface here.
 */
export const app = new Hono<AppBindings>().basePath('/api/v1');

app.onError(errorHandler);
app.notFound(notFoundHandler);

app.use(
  '*',
  secureHeaders({
    xFrameOptions: 'DENY',
    xContentTypeOptions: 'nosniff',
    referrerPolicy: 'strict-origin-when-cross-origin',
    crossOriginResourcePolicy: 'same-origin',
    // The API returns JSON and image bytes only; nothing here should ever be
    // treated as a document that can load scripts.
    contentSecurityPolicy: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
    },
  }),
);

app.use('*', requestContext());
app.use('*', jsonBodyLimit());
app.use('*', loadSession());
app.use('*', csrfProtection());

/* --------------------------------- system -------------------------------- */

app.get('/health', (c) => {
  let database = 'ok';
  try {
    getSqlite().prepare('SELECT 1').get();
  } catch {
    database = 'error';
  }
  // Deliberately free of filesystem paths, versions and secrets.
  return c.json(
    { status: database === 'ok' ? 'ok' : 'degraded', database },
    database === 'ok' ? 200 : 503,
  );
});

app.get('/openapi.json', (c) => c.json(buildOpenApiDocument()));

app.get('/docs', swaggerUI({ url: '/api/v1/openapi.json', title: 'PublishFlow CMS API' }));

app.post('/internal/jobs/publish-scheduled', requireJobSecret(), (c) => {
  const result = publishDuePosts(new Date(), c.get('requestId'));
  return c.json({ data: result });
});

/* --------------------------------- routes -------------------------------- */

app.route('/auth', authRoutes);
app.route('/users', userRoutes);
app.route('/categories', categoryRoutes);
app.route('/posts', postRoutes);
app.route('/menus', menuRoutes);
app.route('/media', mediaRoutes);
app.route('/settings', settingsRoutes);
app.route('/audit-logs', auditRoutes);
app.route('/public/media', publicMediaRoutes);
app.route('/public', publicRoutes);

export type AppType = typeof app;
