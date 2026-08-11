import 'server-only';
import { eq, sql } from 'drizzle-orm';
import { getDb, getSqlite, type Db } from './index';
import { runMigrations } from './migrator';
import {
  categories,
  menuItems,
  menus,
  postRevisions,
  posts,
  siteSettings,
  users,
  workflowEvents,
} from './schema';
import { getEnv } from '@/server/env';
import { hashPassword } from '@/server/auth/password';
import { nowIso } from '@/lib/datetime';
import type { PostStatus, UserRole } from '@/lib/domain';

/**
 * Deterministic development seed.
 *
 * Safe to re-run: every record is looked up by its natural key (email, slug,
 * menu location + title) and updated rather than duplicated. Passwords come from
 * the environment so no credential is hard-coded in the repository.
 */

export interface SeedSummary {
  users: number;
  categories: number;
  posts: number;
  menuItems: number;
  accounts: Array<{ role: UserRole; email: string }>;
}

interface SeedUser {
  key: 'admin' | 'editor' | 'author' | 'author2';
  name: string;
  email: string;
  password: string;
  role: UserRole;
}

interface SeedPost {
  slug: string;
  subject: string;
  categorySlug: string;
  authorKey: SeedUser['key'];
  excerpt: string;
  content: string;
  status: PostStatus;
  sourceUrl?: string;
  seoTitle?: string;
  seoDescription?: string;
  /** Days before now for PUBLISHED, days after now for SCHEDULED. */
  offsetDays?: number;
  readsCount?: number;
}

function seedUsers(): SeedUser[] {
  const env = getEnv();
  return [
    {
      key: 'admin',
      name: 'Dana Okafor',
      email: env.SEED_ADMIN_EMAIL,
      password: env.SEED_ADMIN_PASSWORD,
      role: 'ADMIN',
    },
    {
      key: 'editor',
      name: 'Marco Silva',
      email: env.SEED_EDITOR_EMAIL,
      password: env.SEED_EDITOR_PASSWORD,
      role: 'EDITOR',
    },
    {
      key: 'author',
      name: 'Priya Raman',
      email: env.SEED_AUTHOR_EMAIL,
      password: env.SEED_AUTHOR_PASSWORD,
      role: 'AUTHOR',
    },
    {
      key: 'author2',
      name: 'Tom Bergström',
      email: env.SEED_AUTHOR2_EMAIL,
      password: env.SEED_AUTHOR2_PASSWORD,
      role: 'AUTHOR',
    },
  ];
}

const SEED_CATEGORIES = [
  {
    slug: 'engineering',
    title: 'Engineering',
    description: 'How we build and operate the platform, written by the people who do it.',
  },
  {
    slug: 'company-news',
    title: 'Company News',
    description: 'Announcements, milestones and updates from across the organisation.',
  },
  {
    slug: 'tutorials',
    title: 'Tutorials',
    description: 'Step-by-step guides for getting things done with PublishFlow.',
  },
] as const;

const SEED_POSTS: SeedPost[] = [
  {
    slug: 'why-editorial-workflow-beats-a-shared-folder',
    subject: 'Why an editorial workflow beats a shared folder',
    categorySlug: 'company-news',
    authorKey: 'editor',
    status: 'PUBLISHED',
    offsetDays: 12,
    readsCount: 0,
    seoTitle: 'Why an editorial workflow beats a shared folder',
    seoDescription:
      'Drafts published early, lost edits and no history. Here is how a review queue fixes all three.',
    excerpt:
      'Drafts published before approval, silently overwritten edits and no way to see what changed. A review queue fixes all three.',
    content: `Most small teams start the same way: a shared folder, a chat thread, and a lot of goodwill.

It works until it doesn't.

## The three failures

1. **Drafts go public early.** Someone with publish access clicks the wrong thing, and an unreviewed article is live.
2. **Edits vanish.** Two people open the same document, both save, and the second save quietly wins.
3. **Nobody can answer "what changed?"** There is a final version and nothing else.

## What a workflow adds

A post in PublishFlow moves through explicit states:

| State | Who can move it | What it means |
| --- | --- | --- |
| Draft | Author | Still being written |
| In review | Author submits | Locked for the author, waiting on an editor |
| Published | Editor or Admin | Publicly visible |
| Archived | Editor or Admin | Removed from the public site, kept in history |

The important part is not the diagram. It is that the **server** enforces it. An author cannot publish by calling the API directly, because the permission check lives in the service layer rather than in a hidden button.

## The cost

You trade a little speed for a lot of predictability. For a team publishing a few articles a week, that trade is worth making.`,
  },
  {
    slug: 'optimistic-locking-in-practice',
    subject: 'Optimistic locking in practice',
    categorySlug: 'engineering',
    authorKey: 'author',
    status: 'PUBLISHED',
    offsetDays: 5,
    readsCount: 0,
    sourceUrl: 'https://sqlite.org/lang_transaction.html',
    seoTitle: 'Optimistic locking in practice',
    seoDescription:
      'How a single version column stops two editors from silently overwriting each other.',
    excerpt:
      'One integer column is enough to turn a silent lost update into a clear, recoverable conflict.',
    content: `Two editors open version 5 of the same article. Both make changes. Both press save.

With last-write-wins, the second save destroys the first, and nobody finds out until someone notices a paragraph is missing.

## The fix is one column

Every post carries a \`version\`. The client sends the version it loaded:

\`\`\`json
{ "subject": "Updated subject", "expectedVersion": 5 }
\`\`\`

The update is conditional:

\`\`\`sql
UPDATE posts
SET subject = ?, version = version + 1, updated_at = ?
WHERE id = ? AND version = ?;
\`\`\`

If zero rows change, somebody else got there first. The API returns \`409 VERSION_CONFLICT\` with the current version, and the editor is told to reload — with their typed text still on screen.

## Why not row locking?

Pessimistic locks need a lock holder, a timeout, and a story for the browser tab that was closed mid-edit. Editorial conflicts are rare. Detecting them is cheaper than preventing them.

## Where the revision fits

The version bump and the revision snapshot happen in the **same transaction**. If the snapshot fails, the update rolls back too, so history can never disagree with the current row.`,
  },
  {
    slug: 'building-a-safe-media-pipeline',
    subject: 'Building a safe media upload pipeline',
    categorySlug: 'tutorials',
    authorKey: 'author2',
    status: 'IN_REVIEW',
    excerpt:
      'Trusting a Content-Type header is not validation. Here is what to check before writing a file to disk.',
    content: `A file upload endpoint is the most attacker-facing part of a CMS. Here is the checklist we settled on.

## 1. Never trust the declared type

The browser sends \`Content-Type\`. An attacker sends whatever they like. Read the magic bytes instead.

## 2. Prove it decodes

Magic bytes can be forged onto a polyglot file. Decoding the image with a real image library — and re-encoding it — strips anything appended after the image data.

## 3. Generate the filename

Never build a path from a user-supplied filename. \`../../\` is the obvious attack; less obvious is a name that collides with an application file.

## 4. Allow-list, do not deny-list

JPEG, PNG, WebP. **No SVG** — it is XML, it can carry script, and serving it from your own origin turns it into stored XSS.

## 5. Cap the size before you read

Read a bounded buffer. Do not load an arbitrary body into memory and check afterwards.`,
  },
  {
    slug: 'quarterly-platform-update',
    subject: 'Quarterly platform update',
    categorySlug: 'company-news',
    authorKey: 'editor',
    status: 'SCHEDULED',
    offsetDays: 7,
    excerpt: 'A round-up of what shipped this quarter and what is next.',
    content: `This post is scheduled and will publish automatically when its date arrives.

## Shipped

- Revision history with restore
- Header and footer menu management
- De-duplicated read counting

## Next

- Tag-based classification
- Export to Markdown

The scheduled publishing job runs from either \`pnpm jobs:publish-scheduled\` or a protected internal endpoint, and is safe to run twice.`,
  },
  {
    slug: 'drafting-the-style-guide',
    subject: 'Drafting the editorial style guide',
    categorySlug: 'tutorials',
    authorKey: 'author',
    status: 'DRAFT',
    excerpt: 'Early notes on tone, structure and formatting conventions.',
    content: `_Work in progress — not ready for review yet._

## Tone

Write the way you would explain something to a colleague who is smart but new to the topic.

## Structure

- Lead with the problem
- Show the smallest example that makes the point
- End with the trade-off

## Formatting

Sentence case for headings. Code fences for anything longer than a few words.`,
  },
  {
    slug: 'legacy-migration-notes',
    subject: 'Legacy migration notes',
    categorySlug: 'engineering',
    authorKey: 'author2',
    status: 'ARCHIVED',
    offsetDays: 120,
    readsCount: 0,
    excerpt: 'Superseded notes from the original migration. Kept for reference.',
    content: `These notes covered the first migration and no longer reflect the current schema.

Archived rather than deleted so the history and any inbound links stay intact.`,
  },
];

interface MenuSeedItem {
  title: string;
  itemType: 'CUSTOM' | 'POST' | 'CATEGORY';
  url?: string;
  categorySlug?: string;
  postSlug?: string;
  children?: MenuSeedItem[];
}

const HEADER_ITEMS: MenuSeedItem[] = [
  { title: 'Home', itemType: 'CUSTOM', url: '/' },
  {
    title: 'Engineering',
    itemType: 'CATEGORY',
    categorySlug: 'engineering',
    children: [
      {
        title: 'Optimistic locking',
        itemType: 'POST',
        postSlug: 'optimistic-locking-in-practice',
      },
    ],
  },
  { title: 'Company News', itemType: 'CATEGORY', categorySlug: 'company-news' },
  { title: 'Tutorials', itemType: 'CATEGORY', categorySlug: 'tutorials' },
];

const FOOTER_ITEMS: MenuSeedItem[] = [
  { title: 'Search', itemType: 'CUSTOM', url: '/search' },
  { title: 'All categories', itemType: 'CATEGORY', categorySlug: 'company-news' },
  {
    title: 'SQLite documentation',
    itemType: 'CUSTOM',
    url: 'https://sqlite.org/docs.html',
  },
];

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

export async function seedDatabase(): Promise<SeedSummary> {
  const env = getEnv();
  const sqlite = getSqlite();

  // A seed against an empty file should just work; migrate first if needed.
  runMigrations(sqlite, { enableFts: env.ENABLE_FTS });

  const db = getDb();
  const now = nowIso();
  const definitions = seedUsers();

  // Argon2 is deliberately slow and better-sqlite3 transactions are synchronous,
  // so every hash is computed before the write transaction opens.
  const hashes = new Map<string, string>();
  for (const user of definitions) {
    const existing = db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, user.email.toLowerCase()))
      .get();
    if (!existing) hashes.set(user.key, await hashPassword(user.password));
  }

  return db.transaction((tx) => {
    const userIds = upsertUsers(tx, definitions, hashes, now);
    const categoryIds = upsertCategories(tx, now);
    const postIds = upsertPosts(tx, definitions, userIds, categoryIds, now);
    const menuItemCount = upsertMenus(tx, categoryIds, postIds, now);

    tx.update(siteSettings)
      .set({
        siteName: 'PublishFlow',
        siteDescription: 'Editorial publishing for small teams.',
        defaultSeoTitle: 'PublishFlow — editorial publishing for small teams',
        defaultSeoDescription:
          'Draft, review, schedule and publish articles with revision history and role-based permissions.',
        postsPerPage: 10,
        timezone: env.SITE_TIMEZONE,
        updatedBy: userIds.get('admin') ?? null,
        updatedAt: now,
      })
      .where(eq(siteSettings.id, 1))
      .run();

    return {
      users: userIds.size,
      categories: categoryIds.size,
      posts: postIds.size,
      menuItems: menuItemCount,
      accounts: definitions.map((user) => ({ role: user.role, email: user.email })),
    };
  });
}

function upsertUsers(
  tx: Db,
  definitions: SeedUser[],
  hashes: Map<string, string>,
  now: string,
): Map<string, number> {
  const ids = new Map<string, number>();

  for (const user of definitions) {
    const email = user.email.toLowerCase();
    const existing = tx.select({ id: users.id }).from(users).where(eq(users.email, email)).get();

    if (existing) {
      tx.update(users)
        .set({ name: user.name, role: user.role, status: 'ACTIVE', updatedAt: now })
        .where(eq(users.id, existing.id))
        .run();
      ids.set(user.key, existing.id);
      continue;
    }

    const passwordHash = hashes.get(user.key);
    if (!passwordHash) throw new Error(`Missing password hash for seed user ${user.key}`);

    const inserted = tx
      .insert(users)
      .values({
        name: user.name,
        email,
        passwordHash,
        role: user.role,
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: users.id })
      .get();
    ids.set(user.key, inserted.id);
  }

  return ids;
}

function upsertCategories(tx: Db, now: string): Map<string, number> {
  const ids = new Map<string, number>();

  for (const category of SEED_CATEGORIES) {
    const existing = tx
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.slug, category.slug))
      .get();

    if (existing) {
      tx.update(categories)
        .set({
          title: category.title,
          description: category.description,
          isActive: 1,
          updatedAt: now,
        })
        .where(eq(categories.id, existing.id))
        .run();
      ids.set(category.slug, existing.id);
      continue;
    }

    const inserted = tx
      .insert(categories)
      .values({
        title: category.title,
        slug: category.slug,
        description: category.description,
        isActive: 1,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: categories.id })
      .get();
    ids.set(category.slug, inserted.id);
  }

  return ids;
}

function upsertPosts(
  tx: Db,
  definitions: SeedUser[],
  userIds: Map<string, number>,
  categoryIds: Map<string, number>,
  now: string,
): Map<string, number> {
  void definitions;
  const ids = new Map<string, number>();

  for (const post of SEED_POSTS) {
    const existing = tx.select({ id: posts.id }).from(posts).where(eq(posts.slug, post.slug)).get();
    if (existing) {
      ids.set(post.slug, existing.id);
      continue;
    }

    const categoryId = categoryIds.get(post.categorySlug);
    const authorId = userIds.get(post.authorKey);
    if (!categoryId || !authorId) {
      throw new Error(`Seed post ${post.slug} references an unknown category or author.`);
    }

    const publishedAt =
      post.status === 'PUBLISHED' || post.status === 'ARCHIVED'
        ? daysFromNow(-(post.offsetDays ?? 1))
        : null;
    const scheduledAt = post.status === 'SCHEDULED' ? daysFromNow(post.offsetDays ?? 7) : null;

    const inserted = tx
      .insert(posts)
      .values({
        categoryId,
        authorId,
        subject: post.subject,
        slug: post.slug,
        excerpt: post.excerpt,
        content: post.content,
        sourceUrl: post.sourceUrl ?? null,
        status: post.status,
        readsCount: post.readsCount ?? 0,
        seoTitle: post.seoTitle ?? null,
        seoDescription: post.seoDescription ?? null,
        scheduledAt,
        publishedAt,
        version: 1,
        createdAt: publishedAt ?? now,
        updatedAt: publishedAt ?? now,
      })
      .returning({ id: posts.id })
      .get();

    tx.insert(postRevisions)
      .values({
        postId: inserted.id,
        version: 1,
        categoryId,
        subject: post.subject,
        slug: post.slug,
        excerpt: post.excerpt,
        content: post.content,
        sourceUrl: post.sourceUrl ?? null,
        status: post.status,
        seoTitle: post.seoTitle ?? null,
        seoDescription: post.seoDescription ?? null,
        scheduledAt,
        publishedAt,
        savedBy: authorId,
        changeSummary: 'Seeded content',
        createdAt: publishedAt ?? now,
      })
      .run();

    // Give non-draft posts a plausible history so the review queue and the
    // workflow timeline are not empty on a fresh install.
    const editorId = userIds.get('editor') ?? authorId;
    const trail: Array<{ from: string | null; to: string; actor: number; comment: string | null }> =
      [];
    if (post.status !== 'DRAFT') {
      trail.push({ from: 'DRAFT', to: 'IN_REVIEW', actor: authorId, comment: null });
    }
    if (post.status === 'PUBLISHED' || post.status === 'ARCHIVED') {
      trail.push({ from: 'IN_REVIEW', to: 'PUBLISHED', actor: editorId, comment: null });
    }
    if (post.status === 'SCHEDULED') {
      trail.push({ from: 'IN_REVIEW', to: 'SCHEDULED', actor: editorId, comment: null });
    }
    if (post.status === 'ARCHIVED') {
      trail.push({
        from: 'PUBLISHED',
        to: 'ARCHIVED',
        actor: editorId,
        comment: 'Superseded by the current migration guide.',
      });
    }

    for (const event of trail) {
      tx.insert(workflowEvents)
        .values({
          postId: inserted.id,
          fromStatus: event.from,
          toStatus: event.to,
          actorId: event.actor,
          comment: event.comment,
          createdAt: publishedAt ?? now,
        })
        .run();
    }

    ids.set(post.slug, inserted.id);
  }

  return ids;
}

function upsertMenus(
  tx: Db,
  categoryIds: Map<string, number>,
  postIds: Map<string, number>,
  now: string,
): number {
  let count = 0;

  const locations = [
    { location: 'HEADER' as const, items: HEADER_ITEMS },
    { location: 'FOOTER' as const, items: FOOTER_ITEMS },
  ];

  for (const { location, items } of locations) {
    const menu = tx.select({ id: menus.id }).from(menus).where(eq(menus.location, location)).get();
    if (!menu) continue;

    const existingCount =
      tx
        .select({ count: sql<number>`count(*)` })
        .from(menuItems)
        .where(eq(menuItems.menuId, menu.id))
        .get()?.count ?? 0;

    if (existingCount > 0) {
      count += existingCount;
      continue;
    }

    items.forEach((item, index) => {
      const parentId = insertMenuItem(tx, menu.id, null, item, index, categoryIds, postIds, now);
      count += 1;
      item.children?.forEach((child, childIndex) => {
        insertMenuItem(tx, menu.id, parentId, child, childIndex, categoryIds, postIds, now);
        count += 1;
      });
    });
  }

  return count;
}

function insertMenuItem(
  tx: Db,
  menuId: number,
  parentId: number | null,
  item: MenuSeedItem,
  position: number,
  categoryIds: Map<string, number>,
  postIds: Map<string, number>,
  now: string,
): number {
  const categoryId = item.categorySlug ? (categoryIds.get(item.categorySlug) ?? null) : null;
  const postId = item.postSlug ? (postIds.get(item.postSlug) ?? null) : null;

  const inserted = tx
    .insert(menuItems)
    .values({
      menuId,
      parentId,
      title: item.title,
      itemType: item.itemType,
      url: item.itemType === 'CUSTOM' ? (item.url ?? '/') : null,
      postId: item.itemType === 'POST' ? postId : null,
      categoryId: item.itemType === 'CATEGORY' ? categoryId : null,
      position,
      openInNewTab: item.url?.startsWith('http') ? 1 : 0,
      isVisible: 1,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: menuItems.id })
    .get();

  return inserted.id;
}
