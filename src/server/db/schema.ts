import { relations, sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
  check,
} from 'drizzle-orm/sqlite-core';

/**
 * Drizzle schema for PublishFlow.
 *
 * The hand-written SQL in `drizzle/0000_init.sql` is the authoritative DDL because
 * it carries CHECK constraints, partial indexes and FTS5 triggers that drizzle-kit
 * cannot express fully. This file mirrors that DDL so the query builder is typed
 * and `drizzle-kit generate` stays meaningful.
 */

const nowSql = sql`CURRENT_TIMESTAMP`;

export const users = sqliteTable(
  'users',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role', { enum: ['ADMIN', 'EDITOR', 'AUTHOR'] })
      .notNull()
      .default('AUTHOR'),
    status: text('status', { enum: ['ACTIVE', 'DISABLED'] })
      .notNull()
      .default('ACTIVE'),
    createdAt: text('created_at').notNull().default(nowSql),
    updatedAt: text('updated_at').notNull().default(nowSql),
    lastLoginAt: text('last_login_at'),
  },
  (t) => [
    uniqueIndex('users_email_unique').on(t.email),
    check('users_name_len', sql`length(trim(${t.name})) BETWEEN 2 AND 100`),
    check('users_role_valid', sql`${t.role} IN ('ADMIN', 'EDITOR', 'AUTHOR')`),
    check('users_status_valid', sql`${t.status} IN ('ACTIVE', 'DISABLED')`),
  ],
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    csrfNonce: text('csrf_nonce').notNull().default(''),
    createdAt: text('created_at').notNull().default(nowSql),
    expiresAt: text('expires_at').notNull(),
    lastSeenAt: text('last_seen_at'),
    revokedAt: text('revoked_at'),
    userAgent: text('user_agent'),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_unique').on(t.tokenHash),
    index('idx_sessions_user_active').on(t.userId, t.expiresAt, t.revokedAt),
  ],
);

export const mediaAssets = sqliteTable(
  'media_assets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    originalName: text('original_name').notNull(),
    storageKey: text('storage_key').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    width: integer('width'),
    height: integer('height'),
    altText: text('alt_text'),
    uploadedBy: integer('uploaded_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: text('created_at').notNull().default(nowSql),
    deletedAt: text('deleted_at'),
  },
  (t) => [
    uniqueIndex('media_assets_storage_key_unique').on(t.storageKey),
    check('media_size_positive', sql`${t.sizeBytes} > 0`),
    check('media_width_positive', sql`${t.width} IS NULL OR ${t.width} > 0`),
    check('media_height_positive', sql`${t.height} IS NULL OR ${t.height} > 0`),
  ],
);

export const categories = sqliteTable(
  'categories',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    parentId: integer('parent_id'),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    description: text('description').notNull().default(''),
    isActive: integer('is_active').notNull().default(1),
    createdAt: text('created_at').notNull().default(nowSql),
    updatedAt: text('updated_at').notNull().default(nowSql),
  },
  (t) => [
    uniqueIndex('categories_slug_unique').on(t.slug),
    index('idx_categories_parent').on(t.parentId, t.isActive),
    check('categories_title_len', sql`length(trim(${t.title})) BETWEEN 2 AND 100`),
    check('categories_active_bool', sql`${t.isActive} IN (0, 1)`),
    check('categories_no_self_parent', sql`${t.parentId} IS NULL OR ${t.parentId} <> ${t.id}`),
  ],
);

export const posts = sqliteTable(
  'posts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    categoryId: integer('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    authorId: integer('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    featuredImageId: integer('featured_image_id').references(() => mediaAssets.id, {
      onDelete: 'set null',
    }),
    subject: text('subject').notNull(),
    slug: text('slug').notNull(),
    excerpt: text('excerpt').notNull().default(''),
    content: text('content').notNull(),
    sourceUrl: text('source_url'),
    status: text('status', {
      enum: ['DRAFT', 'IN_REVIEW', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED'],
    })
      .notNull()
      .default('DRAFT'),
    readsCount: integer('reads_count').notNull().default(0),
    seoTitle: text('seo_title'),
    seoDescription: text('seo_description'),
    scheduledAt: text('scheduled_at'),
    publishedAt: text('published_at'),
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull().default(nowSql),
    updatedAt: text('updated_at').notNull().default(nowSql),
    deletedAt: text('deleted_at'),
  },
  (t) => [
    uniqueIndex('posts_slug_unique').on(t.slug),
    index('idx_posts_admin_list').on(t.status, t.updatedAt),
    index('idx_posts_author').on(t.authorId, t.status, t.updatedAt),
    index('idx_posts_category').on(t.categoryId, t.status, t.publishedAt),
    check('posts_subject_len', sql`length(trim(${t.subject})) BETWEEN 3 AND 200`),
    check(
      'posts_status_valid',
      sql`${t.status} IN ('DRAFT', 'IN_REVIEW', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED')`,
    ),
    check('posts_reads_non_negative', sql`${t.readsCount} >= 0`),
    check('posts_version_positive', sql`${t.version} >= 1`),
  ],
);

export const postRevisions = sqliteTable(
  'post_revisions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    postId: integer('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    categoryId: integer('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    featuredImageId: integer('featured_image_id').references(() => mediaAssets.id, {
      onDelete: 'set null',
    }),
    subject: text('subject').notNull(),
    slug: text('slug').notNull(),
    excerpt: text('excerpt').notNull(),
    content: text('content').notNull(),
    sourceUrl: text('source_url'),
    status: text('status').notNull(),
    seoTitle: text('seo_title'),
    seoDescription: text('seo_description'),
    scheduledAt: text('scheduled_at'),
    publishedAt: text('published_at'),
    savedBy: integer('saved_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    changeSummary: text('change_summary'),
    createdAt: text('created_at').notNull().default(nowSql),
  },
  (t) => [
    uniqueIndex('post_revisions_post_version_unique').on(t.postId, t.version),
    index('idx_revisions_post').on(t.postId, t.version),
  ],
);

export const workflowEvents = sqliteTable(
  'workflow_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    postId: integer('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    actorId: integer('actor_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    comment: text('comment'),
    createdAt: text('created_at').notNull().default(nowSql),
  },
  (t) => [index('idx_workflow_post').on(t.postId, t.createdAt)],
);

export const menus = sqliteTable(
  'menus',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    location: text('location', { enum: ['HEADER', 'FOOTER'] }).notNull(),
    isActive: integer('is_active').notNull().default(1),
    createdAt: text('created_at').notNull().default(nowSql),
    updatedAt: text('updated_at').notNull().default(nowSql),
  },
  (t) => [
    uniqueIndex('menus_name_unique').on(t.name),
    uniqueIndex('menus_location_unique').on(t.location),
    check('menus_location_valid', sql`${t.location} IN ('HEADER', 'FOOTER')`),
    check('menus_active_bool', sql`${t.isActive} IN (0, 1)`),
  ],
);

export const menuItems = sqliteTable(
  'menu_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    menuId: integer('menu_id')
      .notNull()
      .references(() => menus.id, { onDelete: 'cascade' }),
    parentId: integer('parent_id'),
    title: text('title').notNull(),
    itemType: text('item_type', { enum: ['CUSTOM', 'POST', 'CATEGORY'] }).notNull(),
    url: text('url'),
    postId: integer('post_id').references(() => posts.id, { onDelete: 'cascade' }),
    categoryId: integer('category_id').references(() => categories.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    openInNewTab: integer('open_in_new_tab').notNull().default(0),
    isVisible: integer('is_visible').notNull().default(1),
    createdAt: text('created_at').notNull().default(nowSql),
    updatedAt: text('updated_at').notNull().default(nowSql),
  },
  (t) => [
    index('idx_menu_items_order').on(t.menuId, t.parentId, t.position),
    check('menu_items_title_len', sql`length(trim(${t.title})) BETWEEN 1 AND 100`),
    check('menu_items_type_valid', sql`${t.itemType} IN ('CUSTOM', 'POST', 'CATEGORY')`),
    check('menu_items_position_non_negative', sql`${t.position} >= 0`),
    check('menu_items_new_tab_bool', sql`${t.openInNewTab} IN (0, 1)`),
    check('menu_items_visible_bool', sql`${t.isVisible} IN (0, 1)`),
    check('menu_items_no_self_parent', sql`${t.parentId} IS NULL OR ${t.parentId} <> ${t.id}`),
    check(
      'menu_items_target_exclusive',
      sql`(${t.itemType} = 'CUSTOM' AND ${t.url} IS NOT NULL AND ${t.postId} IS NULL AND ${t.categoryId} IS NULL)
        OR (${t.itemType} = 'POST' AND ${t.url} IS NULL AND ${t.postId} IS NOT NULL AND ${t.categoryId} IS NULL)
        OR (${t.itemType} = 'CATEGORY' AND ${t.url} IS NULL AND ${t.postId} IS NULL AND ${t.categoryId} IS NOT NULL)`,
    ),
  ],
);

export const siteSettings = sqliteTable(
  'site_settings',
  {
    id: integer('id').primaryKey(),
    siteName: text('site_name').notNull(),
    siteDescription: text('site_description').notNull().default(''),
    logoMediaId: integer('logo_media_id').references(() => mediaAssets.id, {
      onDelete: 'set null',
    }),
    defaultSeoTitle: text('default_seo_title'),
    defaultSeoDescription: text('default_seo_description'),
    postsPerPage: integer('posts_per_page').notNull().default(10),
    timezone: text('timezone').notNull().default('UTC'),
    updatedBy: integer('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: text('updated_at').notNull().default(nowSql),
  },
  (t) => [
    check('site_settings_singleton', sql`${t.id} = 1`),
    check('site_settings_posts_per_page', sql`${t.postsPerPage} BETWEEN 1 AND 100`),
  ],
);

export const postViews = sqliteTable(
  'post_views',
  {
    postId: integer('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    viewerHash: text('viewer_hash').notNull(),
    viewedOn: text('viewed_on').notNull(),
    createdAt: text('created_at').notNull().default(nowSql),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.viewerHash, t.viewedOn] }),
    index('idx_post_views_date').on(t.viewedOn),
  ],
);

export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    actorId: integer('actor_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    metadataJson: text('metadata_json'),
    requestId: text('request_id'),
    createdAt: text('created_at').notNull().default(nowSql),
  },
  (t) => [index('idx_audit_created').on(t.createdAt)],
);

export const loginAttempts = sqliteTable(
  'login_attempts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    attemptKey: text('attempt_key').notNull(),
    createdAt: text('created_at').notNull().default(nowSql),
  },
  (t) => [index('idx_login_attempts_key').on(t.attemptKey, t.createdAt)],
);

/* ------------------------------------------------------------------ */
/* Relations                                                           */
/* ------------------------------------------------------------------ */

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  posts: many(posts),
}));

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: 'category_parent',
  }),
  children: many(categories, { relationName: 'category_parent' }),
  posts: many(posts),
}));

export const postsRelations = relations(posts, ({ one, many }) => ({
  category: one(categories, { fields: [posts.categoryId], references: [categories.id] }),
  author: one(users, { fields: [posts.authorId], references: [users.id] }),
  featuredImage: one(mediaAssets, {
    fields: [posts.featuredImageId],
    references: [mediaAssets.id],
  }),
  revisions: many(postRevisions),
  workflowEvents: many(workflowEvents),
}));

export const postRevisionsRelations = relations(postRevisions, ({ one }) => ({
  post: one(posts, { fields: [postRevisions.postId], references: [posts.id] }),
  savedByUser: one(users, { fields: [postRevisions.savedBy], references: [users.id] }),
}));

export const menusRelations = relations(menus, ({ many }) => ({
  items: many(menuItems),
}));

export const menuItemsRelations = relations(menuItems, ({ one, many }) => ({
  menu: one(menus, { fields: [menuItems.menuId], references: [menus.id] }),
  parent: one(menuItems, {
    fields: [menuItems.parentId],
    references: [menuItems.id],
    relationName: 'menu_item_parent',
  }),
  children: many(menuItems, { relationName: 'menu_item_parent' }),
  post: one(posts, { fields: [menuItems.postId], references: [posts.id] }),
  category: one(categories, { fields: [menuItems.categoryId], references: [categories.id] }),
}));

/* ------------------------------------------------------------------ */
/* Inferred row types                                                  */
/* ------------------------------------------------------------------ */

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type MediaAssetRow = typeof mediaAssets.$inferSelect;
export type CategoryRow = typeof categories.$inferSelect;
export type PostRow = typeof posts.$inferSelect;
export type PostRevisionRow = typeof postRevisions.$inferSelect;
export type WorkflowEventRow = typeof workflowEvents.$inferSelect;
export type MenuRow = typeof menus.$inferSelect;
export type MenuItemRow = typeof menuItems.$inferSelect;
export type SiteSettingsRow = typeof siteSettings.$inferSelect;
export type AuditLogRow = typeof auditLogs.$inferSelect;
