import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import crypto from 'node:crypto';
import { publicListQuery } from '@/server/contracts/schemas';
import { AppError } from '@/server/errors/app-error';
import { getEnv } from '@/server/env';
import { getPublicMenu } from '@/server/services/menu-service';
import {
  getPublishedPostBySlug,
  listPublicCategories,
  listPublishedPosts,
} from '@/server/services/public-service';
import { searchPublishedPosts } from '@/server/services/search-service';
import { getPublicSettings } from '@/server/services/settings-service';
import { recordPostView } from '@/server/services/view-service';
import { MENU_LOCATIONS, type MenuLocation } from '@/lib/domain';
import { rateLimit } from '../middleware/rate-limit';
import { setVisitorCookie } from '../cookies';
import type { AppBindings } from '../types';
import { parseQuery } from './helpers';

/**
 * Public, unauthenticated API.
 *
 * Every handler here reads through the public-visibility predicate, so no draft,
 * scheduled, archived or soft-deleted post can be reached — including by slug.
 */
export const publicRoutes = new Hono<AppBindings>();

publicRoutes.get('/settings', (c) => c.json({ data: getPublicSettings() }));

publicRoutes.get('/menus/:location', (c) => {
  const raw = (c.req.param('location') ?? '').toUpperCase();
  if (!(MENU_LOCATIONS as readonly string[]).includes(raw)) {
    throw AppError.notFound('Menu');
  }
  return c.json({ data: getPublicMenu(raw as MenuLocation) });
});

publicRoutes.get('/categories', (c) => c.json({ data: listPublicCategories() }));

publicRoutes.get('/categories/:slug/posts', (c) => {
  const query = parseQuery(c, publicListQuery);
  const settings = getPublicSettings();
  return c.json(
    listPublishedPosts({ ...query, categorySlug: c.req.param('slug') }, settings.postsPerPage),
  );
});

/**
 * List or search published posts, depending on whether `q` is present.
 *
 * The search branch runs an FTS5 (or LIKE) scan and is reachable without
 * authentication, so it is metered. Plain listing is an indexed read and is
 * deliberately left unmetered by the `when` predicate.
 */
publicRoutes.get(
  '/posts',
  rateLimit({
    windowMs: 60_000,
    max: 30,
    scope: 'public-search',
    when: (c) => (c.req.query('q') ?? '').trim().length > 0,
  }),
  (c) => {
    const query = parseQuery(c, publicListQuery);
    const settings = getPublicSettings();

    if (query.q && query.q.length > 0) {
      const result = searchPublishedPosts(
        {
          q: query.q,
          page: query.page,
          pageSize: query.pageSize,
          categorySlug: query.category ?? null,
        },
        settings.postsPerPage,
      );
      return c.json({ data: result.data, meta: result.meta, searchMode: result.mode });
    }

    return c.json(
      listPublishedPosts({ ...query, categorySlug: query.category ?? null }, settings.postsPerPage),
    );
  },
);

publicRoutes.get('/posts/:slug', (c) => {
  const post = getPublishedPostBySlug(c.req.param('slug'));
  // 404 rather than 403 so an unpublished slug cannot be probed for existence.
  if (!post) throw AppError.notFound('Post');
  return c.json({ data: post });
});

/**
 * `POST /public/posts/:slug/view`
 *
 * Idempotent per (post, visitor, UTC day). The visitor id is a random opaque
 * cookie value; only its HMAC is persisted, and no IP address is stored.
 */
publicRoutes.post(
  '/posts/:slug/view',
  rateLimit({ windowMs: 60_000, max: 120, scope: 'view' }),
  (c) => {
    const env = getEnv();
    let visitorId = getCookie(c, env.visitorCookieName) ?? getCookie(c, 'pf_visitor') ?? undefined;

    if (!visitorId || visitorId.length < 16 || visitorId.length > 128) {
      visitorId = crypto.randomBytes(24).toString('base64url');
      setVisitorCookie(c, visitorId);
    }

    const result = recordPostView(c.req.param('slug'), visitorId);
    return c.json({ data: result });
  },
);
