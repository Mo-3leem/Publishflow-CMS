import 'server-only';
import { eq, isNull, and } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { mediaAssets, siteSettings, users } from '@/server/db/schema';
import { nowIso, isValidTimezone } from '@/lib/datetime';
import { can } from '@/lib/permissions';
import type { Principal } from '@/lib/domain';
import { AppError } from '@/server/errors/app-error';
import { writeAudit } from './audit-service';
import type { ActorContext } from './context';

/**
 * Site settings — one typed singleton row rather than untyped key/value pairs,
 * so every field is validated and the shape is known at compile time.
 */

export interface SiteSettingsDto {
  siteName: string;
  siteDescription: string;
  logoMediaId: number | null;
  logoUrl: string | null;
  defaultSeoTitle: string | null;
  defaultSeoDescription: string | null;
  postsPerPage: number;
  timezone: string;
  updatedBy: number | null;
  updatedByName: string | null;
  updatedAt: string;
}

/** Fields that are safe to expose to anonymous visitors. */
export interface PublicSettingsDto {
  siteName: string;
  siteDescription: string;
  logoUrl: string | null;
  defaultSeoTitle: string | null;
  defaultSeoDescription: string | null;
  postsPerPage: number;
  timezone: string;
}

interface CacheEntry {
  value: SiteSettingsDto;
  expiresAt: number;
}

const CACHE_TTL_MS = 15_000;
const globalRef = globalThis as typeof globalThis & { __publishflowSettingsCache?: CacheEntry };

export function invalidateSettingsCache(): void {
  globalRef.__publishflowSettingsCache = undefined;
}

function load(): SiteSettingsDto {
  const db = getDb();
  const row = db
    .select({
      siteName: siteSettings.siteName,
      siteDescription: siteSettings.siteDescription,
      logoMediaId: siteSettings.logoMediaId,
      defaultSeoTitle: siteSettings.defaultSeoTitle,
      defaultSeoDescription: siteSettings.defaultSeoDescription,
      postsPerPage: siteSettings.postsPerPage,
      timezone: siteSettings.timezone,
      updatedBy: siteSettings.updatedBy,
      updatedByName: users.name,
      updatedAt: siteSettings.updatedAt,
    })
    .from(siteSettings)
    .leftJoin(users, eq(users.id, siteSettings.updatedBy))
    .where(eq(siteSettings.id, 1))
    .get();

  if (!row) {
    // The migration seeds this row; a missing one means the schema was tampered with.
    throw new AppError('INTERNAL_ERROR', 'Site settings are not initialised.');
  }

  return {
    ...row,
    logoUrl: row.logoMediaId ? `/api/v1/public/media/${row.logoMediaId}/file` : null,
  };
}

/** Cached briefly: read on nearly every public page render. */
export function getSettings(): SiteSettingsDto {
  const cached = globalRef.__publishflowSettingsCache;
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const value = load();
  globalRef.__publishflowSettingsCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

export function getPublicSettings(): PublicSettingsDto {
  const settings = getSettings();
  return {
    siteName: settings.siteName,
    siteDescription: settings.siteDescription,
    logoUrl: settings.logoUrl,
    defaultSeoTitle: settings.defaultSeoTitle,
    defaultSeoDescription: settings.defaultSeoDescription,
    postsPerPage: settings.postsPerPage,
    timezone: settings.timezone,
  };
}

export function getSettingsForAdmin(actor: Principal): SiteSettingsDto {
  if (!can(actor.role, 'settings.manage')) {
    throw AppError.forbidden('Only administrators can view site settings.');
  }
  return getSettings();
}

export interface UpdateSettingsInput {
  siteName?: string;
  siteDescription?: string;
  logoMediaId?: number | null;
  defaultSeoTitle?: string | null;
  defaultSeoDescription?: string | null;
  postsPerPage?: number;
  timezone?: string;
}

export function updateSettings(ctx: ActorContext, input: UpdateSettingsInput): SiteSettingsDto {
  if (!can(ctx.actor.role, 'settings.manage')) {
    throw AppError.forbidden('Only administrators can change site settings.');
  }

  if (Object.keys(input).length === 0) {
    throw AppError.validation('Provide at least one setting to update.');
  }

  if (input.timezone !== undefined && !isValidTimezone(input.timezone)) {
    throw AppError.validation('The timezone is not a recognised IANA identifier.', {
      timezone: ['Use a value such as UTC, Europe/London or Africa/Cairo.'],
    });
  }

  const db = getDb();

  db.transaction((tx) => {
    if (input.logoMediaId != null) {
      const asset = tx
        .select({ id: mediaAssets.id })
        .from(mediaAssets)
        .where(and(eq(mediaAssets.id, input.logoMediaId), isNull(mediaAssets.deletedAt)))
        .get();
      if (!asset) {
        throw AppError.validation('The selected logo image does not exist.', {
          logoMediaId: ['Unknown media asset.'],
        });
      }
    }

    tx.update(siteSettings)
      .set({
        ...(input.siteName !== undefined ? { siteName: input.siteName.trim() } : {}),
        ...(input.siteDescription !== undefined
          ? { siteDescription: input.siteDescription.trim() }
          : {}),
        ...(input.logoMediaId !== undefined ? { logoMediaId: input.logoMediaId } : {}),
        ...(input.defaultSeoTitle !== undefined
          ? { defaultSeoTitle: input.defaultSeoTitle?.trim() || null }
          : {}),
        ...(input.defaultSeoDescription !== undefined
          ? { defaultSeoDescription: input.defaultSeoDescription?.trim() || null }
          : {}),
        ...(input.postsPerPage !== undefined ? { postsPerPage: input.postsPerPage } : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
        // Server-owned: never read from the payload.
        updatedBy: ctx.actor.id,
        updatedAt: nowIso(),
      })
      .where(eq(siteSettings.id, 1))
      .run();

    writeAudit(tx, {
      actorId: ctx.actor.id,
      action: 'settings.updated',
      entityType: 'settings',
      entityId: 1,
      metadata: { fields: Object.keys(input) },
      requestId: ctx.requestId,
    });
  });

  invalidateSettingsCache();
  return getSettings();
}
