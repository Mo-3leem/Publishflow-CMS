import { Hono } from 'hono';
import fs from 'node:fs';
import { updateMediaBody } from '@/server/contracts/schemas';
import { AppError } from '@/server/errors/app-error';
import { getEnv } from '@/server/env';
import {
  deleteMedia,
  getMediaFile,
  getPublicMediaFile,
  listMedia,
  MEDIA_SORT_FIELDS,
  updateMedia,
  uploadMedia,
} from '@/server/services/media-service';
import { requireAuth, requireCapability } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limit';
import type { AppBindings } from '../types';
import { ctxOf, idParamOf, parseJson, parseQuery, requirePrincipal } from './helpers';
import { z } from 'zod';

export const mediaRoutes = new Hono<AppBindings>();

mediaRoutes.use('*', requireAuth());

const listQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  q: z.string().trim().max(200).optional(),
  sort: z.enum(MEDIA_SORT_FIELDS).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

mediaRoutes.get('/', (c) => c.json(listMedia(requirePrincipal(c), parseQuery(c, listQuery))));

mediaRoutes.post('/', rateLimit({ windowMs: 60_000, max: 30, scope: 'upload' }), async (c) => {
  const env = getEnv();

  // Reject on the declared length before touching the body, so an oversized
  // upload never gets buffered into memory.
  const declared = Number(c.req.header('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > env.MAX_UPLOAD_BYTES) {
    throw new AppError(
      'FILE_TOO_LARGE',
      `The file exceeds the ${Math.floor(env.MAX_UPLOAD_BYTES / (1024 * 1024))} MB limit.`,
    );
  }

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    throw new AppError('BAD_REQUEST', 'Expected a multipart/form-data upload.');
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    throw AppError.validation('A file is required.', { file: ['Choose an image to upload.'] });
  }
  if (file.size > env.MAX_UPLOAD_BYTES) {
    throw new AppError(
      'FILE_TOO_LARGE',
      `The file exceeds the ${Math.floor(env.MAX_UPLOAD_BYTES / (1024 * 1024))} MB limit.`,
    );
  }

  const altTextRaw = form.get('altText');
  const bytes = Buffer.from(await file.arrayBuffer());

  const asset = await uploadMedia(ctxOf(c), {
    bytes,
    originalName: file.name || 'upload',
    altText: typeof altTextRaw === 'string' ? altTextRaw : null,
  });

  return c.json({ data: asset }, 201);
});

mediaRoutes.patch('/:id', async (c) => {
  const body = await parseJson(c, updateMediaBody);
  return c.json({ data: updateMedia(ctxOf(c), idParamOf(c), body.altText) });
});

mediaRoutes.delete('/:id', requireCapability('media.manageAll'), async (c) => {
  await deleteMedia(ctxOf(c), idParamOf(c));
  return c.body(null, 204);
});

/** Authenticated preview stream for the admin media library. */
mediaRoutes.get('/:id/file', (c) => streamAsset(getMediaFile(idParamOf(c))));

/** Public stream — only assets reachable from published content. */
export const publicMediaRoutes = new Hono<AppBindings>();

publicMediaRoutes.get('/:id/file', (c) => streamAsset(getPublicMediaFile(idParamOf(c))));

function streamAsset(asset: { absolutePath: string; mimeType: string }): Response {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(asset.absolutePath);
  } catch {
    // Metadata exists but the file is gone: report as missing, not as a 500.
    throw AppError.notFound('Media asset');
  }

  const body = fs.readFileSync(asset.absolutePath);

  return new Response(new Uint8Array(body), {
    status: 200,
    headers: {
      'Content-Type': asset.mimeType,
      'Content-Length': String(stat.size),
      // Storage keys are random and never reused, so the bytes at a given URL
      // can never change.
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
    },
  });
}
