import 'server-only';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp, { type Sharp, type Metadata } from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import { and, asc, desc, eq, isNull, like, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { getDb } from '@/server/db';
import { mediaAssets, posts, siteSettings, users } from '@/server/db/schema';
import { getEnv } from '@/server/env';
import { nowIso } from '@/lib/datetime';
import { buildMeta, parsePagination, resolveOrder, resolveSort } from '@/lib/pagination';
import { can, canEditMedia } from '@/lib/permissions';
import { ALLOWED_IMAGE_MIME_TYPES, type PaginationMeta, type Principal } from '@/lib/domain';
import { AppError } from '@/server/errors/app-error';
import { writeAudit } from './audit-service';
import type { ActorContext } from './context';

/**
 * Image media library.
 *
 * The upload path never trusts the client. The declared MIME type and the
 * original filename are both ignored for security decisions: the real type comes
 * from magic bytes plus a successful `sharp` decode, and the storage key is
 * generated, so a filename like `../../app/route.js` cannot escape the directory.
 */

const EXTENSION_FOR_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export interface MediaDto {
  id: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  altText: string | null;
  uploadedBy: number;
  uploadedByName: string;
  createdAt: string;
  url: string;
}

const COLUMNS = {
  id: mediaAssets.id,
  originalName: mediaAssets.originalName,
  storageKey: mediaAssets.storageKey,
  mimeType: mediaAssets.mimeType,
  sizeBytes: mediaAssets.sizeBytes,
  width: mediaAssets.width,
  height: mediaAssets.height,
  altText: mediaAssets.altText,
  uploadedBy: mediaAssets.uploadedBy,
  createdAt: mediaAssets.createdAt,
} as const;

function toDto(row: {
  id: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  altText: string | null;
  uploadedBy: number;
  uploadedByName: string;
  createdAt: string;
}): MediaDto {
  return { ...row, url: `/api/v1/media/${row.id}/file` };
}

export const MEDIA_SORT_FIELDS = ['createdAt', 'originalName', 'sizeBytes'] as const;
export type MediaSortField = (typeof MEDIA_SORT_FIELDS)[number];

/** Sort allow-list: user input selects a key here, never a raw column name. */
const MEDIA_SORT_COLUMNS = {
  createdAt: mediaAssets.createdAt,
  originalName: mediaAssets.originalName,
  sizeBytes: mediaAssets.sizeBytes,
} satisfies Record<MediaSortField, SQLiteColumn>;

export interface ListMediaQuery {
  page?: unknown;
  pageSize?: unknown;
  q?: string | null;
  sort?: unknown;
  order?: unknown;
}

export function listMedia(
  actor: Principal,
  query: ListMediaQuery,
): { data: MediaDto[]; meta: PaginationMeta } {
  const db = getDb();
  const { page, pageSize, offset } = parsePagination(query.page, query.pageSize, 24);
  const sort = resolveSort<MediaSortField>(query.sort, MEDIA_SORT_FIELDS, 'createdAt');
  const order = resolveOrder(query.order, 'desc');

  const conditions: SQL[] = [isNull(mediaAssets.deletedAt)];
  if (query.q && query.q.trim().length > 0) {
    const needle = `%${query.q.trim().slice(0, 200)}%`;
    const search = or(like(mediaAssets.originalName, needle), like(mediaAssets.altText, needle));
    if (search) conditions.push(search);
  }
  const where = and(...conditions);

  const total =
    db
      .select({ count: sql<number>`count(*)` })
      .from(mediaAssets)
      .where(where)
      .get()?.count ?? 0;

  const column = MEDIA_SORT_COLUMNS[sort];
  const rows = db
    .select({ ...COLUMNS, uploadedByName: users.name })
    .from(mediaAssets)
    .innerJoin(users, eq(users.id, mediaAssets.uploadedBy))
    .where(where)
    .orderBy(order === 'asc' ? asc(column) : desc(column), desc(mediaAssets.id))
    .limit(pageSize)
    .offset(offset)
    .all();

  void actor;
  return { data: rows.map(toDto), meta: buildMeta(page, pageSize, total) };
}

export function getMedia(id: number): MediaDto {
  const row = getDb()
    .select({ ...COLUMNS, uploadedByName: users.name })
    .from(mediaAssets)
    .innerJoin(users, eq(users.id, mediaAssets.uploadedBy))
    .where(and(eq(mediaAssets.id, id), isNull(mediaAssets.deletedAt)))
    .get();
  if (!row) throw AppError.notFound('Media asset');
  return toDto(row);
}

export interface MediaFile {
  storageKey: string;
  mimeType: string;
  absolutePath: string;
}

function storagePathFor(storageKey: string): string {
  const uploadDir = getEnv().uploadDir;
  // Defence in depth: the key is generated, but resolve and verify anyway so a
  // corrupted row can never read outside the upload directory.
  const resolved = path.resolve(uploadDir, storageKey);
  const relative = path.relative(uploadDir, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw AppError.notFound('Media asset');
  }
  return resolved;
}

export function getMediaFile(id: number): MediaFile {
  const row = getDb()
    .select({ storageKey: mediaAssets.storageKey, mimeType: mediaAssets.mimeType })
    .from(mediaAssets)
    .where(and(eq(mediaAssets.id, id), isNull(mediaAssets.deletedAt)))
    .get();
  if (!row) throw AppError.notFound('Media asset');
  return { ...row, absolutePath: storagePathFor(row.storageKey) };
}

/**
 * Public media access.
 *
 * Only assets that are actually reachable from public content are served: the
 * site logo, or a featured image on a currently visible published post.
 */
export function getPublicMediaFile(id: number): MediaFile {
  const db = getDb();
  const now = nowIso();

  const isLogo = db
    .select({ id: siteSettings.id })
    .from(siteSettings)
    .where(eq(siteSettings.logoMediaId, id))
    .get();

  const onVisiblePost = db
    .select({ id: posts.id })
    .from(posts)
    .where(
      and(
        eq(posts.featuredImageId, id),
        eq(posts.status, 'PUBLISHED'),
        isNull(posts.deletedAt),
        sql`${posts.publishedAt} IS NOT NULL AND ${posts.publishedAt} <= ${now}`,
      ),
    )
    .get();

  if (!isLogo && !onVisiblePost) throw AppError.notFound('Media asset');
  return getMediaFile(id);
}

export interface UploadInput {
  bytes: Buffer;
  originalName: string;
  altText?: string | null;
}

export async function uploadMedia(ctx: ActorContext, input: UploadInput): Promise<MediaDto> {
  if (!can(ctx.actor.role, 'media.upload')) {
    throw AppError.forbidden('You are not allowed to upload media.');
  }

  const env = getEnv();

  if (input.bytes.byteLength === 0) {
    throw AppError.validation('The uploaded file is empty.', { file: ['Choose a file.'] });
  }
  if (input.bytes.byteLength > env.MAX_UPLOAD_BYTES) {
    throw new AppError(
      'FILE_TOO_LARGE',
      `The file exceeds the ${Math.floor(env.MAX_UPLOAD_BYTES / (1024 * 1024))} MB limit.`,
    );
  }

  // 1. Real type from magic bytes — the client's Content-Type is ignored.
  const detected = await fileTypeFromBuffer(input.bytes);
  if (!detected || !(ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(detected.mime)) {
    throw new AppError(
      'UNSUPPORTED_MEDIA_TYPE',
      'Only JPEG, PNG and WebP images are allowed. SVG is rejected because it can carry active content.',
    );
  }

  // 2. Prove it decodes as an image, then re-encode. Re-encoding strips EXIF and
  //    any appended payload, so a polyglot file cannot survive the round trip.
  let pipeline: Sharp;
  let metadata: Metadata;
  try {
    pipeline = sharp(input.bytes, { failOn: 'error' }).rotate();
    metadata = await pipeline.metadata();
  } catch {
    throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'The file is not a readable image.');
  }

  if (!metadata.width || !metadata.height) {
    throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'The image dimensions could not be determined.');
  }

  const mime = detected.mime as (typeof ALLOWED_IMAGE_MIME_TYPES)[number];
  const normalized =
    mime === 'image/png'
      ? await pipeline.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
      : mime === 'image/webp'
        ? await pipeline.webp({ quality: 88 }).toBuffer({ resolveWithObject: true })
        : await pipeline.jpeg({ quality: 88, mozjpeg: true }).toBuffer({ resolveWithObject: true });

  // 3. Generated storage key: random name, allow-listed extension, flat layout.
  const extension = EXTENSION_FOR_MIME[mime] ?? 'bin';
  const storageKey = `${new Date().toISOString().slice(0, 7)}-${crypto.randomBytes(16).toString('hex')}.${extension}`;
  const absolutePath = storagePathFor(storageKey);

  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, normalized.data, { flag: 'wx' });

  try {
    const db = getDb();
    const inserted = db.transaction((tx) => {
      const row = tx
        .insert(mediaAssets)
        .values({
          originalName: sanitizeDisplayName(input.originalName),
          storageKey,
          mimeType: mime,
          sizeBytes: normalized.data.byteLength,
          width: normalized.info.width,
          height: normalized.info.height,
          altText: input.altText?.trim().slice(0, 300) || null,
          uploadedBy: ctx.actor.id,
          createdAt: nowIso(),
        })
        .returning(COLUMNS)
        .get();

      writeAudit(tx, {
        actorId: ctx.actor.id,
        action: 'media.uploaded',
        entityType: 'media',
        entityId: row.id,
        metadata: { mimeType: mime, sizeBytes: row.sizeBytes },
        requestId: ctx.requestId,
      });

      return row;
    });

    return toDto({ ...inserted, uploadedByName: ctx.actor.name });
  } catch (error) {
    // The row never landed, so the orphaned file must not stay behind.
    await fs.unlink(absolutePath).catch(() => undefined);
    throw error;
  }
}

/** Keep a readable label without letting path separators into the display name. */
function sanitizeDisplayName(name: string): string {
  const base = path.basename(name).replace(/[^\w.\- ]+/g, '_');
  return (base || 'upload').slice(0, 200);
}

export function updateMedia(ctx: ActorContext, id: number, altText: string | null): MediaDto {
  const db = getDb();
  const current = db
    .select({ id: mediaAssets.id, uploadedBy: mediaAssets.uploadedBy })
    .from(mediaAssets)
    .where(and(eq(mediaAssets.id, id), isNull(mediaAssets.deletedAt)))
    .get();
  if (!current) throw AppError.notFound('Media asset');

  if (!canEditMedia(ctx.actor.role, ctx.actor.id, current.uploadedBy)) {
    throw AppError.forbidden('You can only edit media you uploaded.');
  }

  db.transaction((tx) => {
    tx.update(mediaAssets)
      .set({ altText: altText?.trim().slice(0, 300) || null })
      .where(eq(mediaAssets.id, id))
      .run();

    writeAudit(tx, {
      actorId: ctx.actor.id,
      action: 'media.updated',
      entityType: 'media',
      entityId: id,
      requestId: ctx.requestId,
    });
  });

  return getMedia(id);
}

export interface MediaReferences extends Record<string, number> {
  posts: number;
  settings: number;
}

export function countMediaReferences(id: number): MediaReferences {
  const db = getDb();
  const postCount =
    db
      .select({ count: sql<number>`count(*)` })
      .from(posts)
      .where(eq(posts.featuredImageId, id))
      .get()?.count ?? 0;
  const settingsCount =
    db
      .select({ count: sql<number>`count(*)` })
      .from(siteSettings)
      .where(eq(siteSettings.logoMediaId, id))
      .get()?.count ?? 0;
  return { posts: postCount, settings: settingsCount };
}

/**
 * Delete media.
 *
 * A referenced asset is refused outright rather than silently breaking a post or
 * the site logo. Unreferenced assets are removed from the database first; the
 * physical file is unlinked only after that commit succeeds.
 */
export async function deleteMedia(ctx: ActorContext, id: number): Promise<void> {
  if (!can(ctx.actor.role, 'media.manageAll')) {
    throw AppError.forbidden('Only administrators and editors can delete media.');
  }

  const db = getDb();
  const current = db
    .select({ id: mediaAssets.id, storageKey: mediaAssets.storageKey })
    .from(mediaAssets)
    .where(and(eq(mediaAssets.id, id), isNull(mediaAssets.deletedAt)))
    .get();
  if (!current) throw AppError.notFound('Media asset');

  const references = countMediaReferences(id);
  if (references.posts > 0 || references.settings > 0) {
    throw new AppError(
      'RESOURCE_IN_USE',
      'This image is still used by a post or by the site settings.',
      references,
    );
  }

  db.transaction((tx) => {
    tx.update(mediaAssets).set({ deletedAt: nowIso() }).where(eq(mediaAssets.id, id)).run();
    writeAudit(tx, {
      actorId: ctx.actor.id,
      action: 'media.deleted',
      entityType: 'media',
      entityId: id,
      requestId: ctx.requestId,
    });
  });

  await fs.unlink(storagePathFor(current.storageKey)).catch(() => undefined);
}
