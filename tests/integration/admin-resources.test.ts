import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createClient,
  setupTestDatabase,
  signedInAs,
  sqliteHandle,
  SEED_ACCOUNTS,
  TINY_GIF,
  TINY_PNG,
  type TestContext,
} from '../helpers/test-app';

let cleanup: () => void;
let admin: TestContext;
let editor: TestContext;
let author: TestContext;

beforeAll(async () => {
  cleanup = await setupTestDatabase();
  admin = await signedInAs('admin');
  editor = await signedInAs('editor');
  author = await signedInAs('author');
});

afterAll(() => cleanup());

interface Category {
  id: number;
  title: string;
  slug: string;
  isActive: boolean;
  parentId: number | null;
  postCount: number;
}

describe('categories', () => {
  it('creates a category and derives its slug', async () => {
    const response = await editor.request('POST', '/categories', {
      body: { title: 'Product Updates' },
    });
    expect(response.status).toBe(201);
    expect(response.data<Category>().slug).toBe('product-updates');
  });

  it('rejects a duplicate explicit slug with 409', async () => {
    await editor.request('POST', '/categories', {
      body: { title: 'Duplicate source', slug: 'duplicate-slug' },
    });
    const second = await editor.request('POST', '/categories', {
      body: { title: 'Duplicate target', slug: 'duplicate-slug' },
    });
    expect(second.status).toBe(409);
    expect(second.error()?.code).toBe('SLUG_EXISTS');
  });

  it('does not let an author manage categories', async () => {
    const response = await author.request('POST', '/categories', {
      body: { title: 'Author attempt' },
    });
    expect(response.status).toBe(403);
  });

  it('lets an author read categories (needed to file a post)', async () => {
    expect((await author.request('GET', '/categories')).status).toBe(200);
  });

  it('rejects self-parenting and cycles', async () => {
    const a = (
      await editor.request('POST', '/categories', { body: { title: 'Cycle A' } })
    ).data<Category>();
    const b = (
      await editor.request('POST', '/categories', { body: { title: 'Cycle B', parentId: a.id } })
    ).data<Category>();

    const selfParent = await editor.request('PATCH', `/categories/${a.id}`, {
      body: { parentId: a.id },
    });
    expect(selfParent.status).toBe(422);

    // Making A a child of its own child B would be a cycle.
    const cycle = await editor.request('PATCH', `/categories/${a.id}`, {
      body: { parentId: b.id },
    });
    expect(cycle.status).toBe(422);
  });

  it('rejects nesting deeper than two levels', async () => {
    const root = (
      await editor.request('POST', '/categories', { body: { title: 'Depth root' } })
    ).data<Category>();
    const child = (
      await editor.request('POST', '/categories', {
        body: { title: 'Depth child', parentId: root.id },
      })
    ).data<Category>();

    const grandchild = await editor.request('POST', '/categories', {
      body: { title: 'Depth grandchild', parentId: child.id },
    });
    expect(grandchild.status).toBe(422);
  });

  it('refuses to delete a category that still has posts', async () => {
    const category = (
      await editor.request('POST', '/categories', { body: { title: 'In use category' } })
    ).data<Category>();

    await author.request('POST', '/posts', {
      body: { categoryId: category.id, subject: 'Blocking post', content: 'Body' },
    });

    const response = await editor.request('DELETE', `/categories/${category.id}`);
    expect(response.status).toBe(409);
    expect(response.error()?.code).toBe('RESOURCE_IN_USE');
    expect(response.error()?.details).toMatchObject({ posts: 1 });
  });

  it('refuses to delete a category that still has children', async () => {
    const root = (
      await editor.request('POST', '/categories', { body: { title: 'Parent with child' } })
    ).data<Category>();
    await editor.request('POST', '/categories', {
      body: { title: 'The child', parentId: root.id },
    });

    const response = await editor.request('DELETE', `/categories/${root.id}`);
    expect(response.status).toBe(409);
    expect(response.error()?.details).toMatchObject({ childCategories: 1 });
  });

  it('deletes an unused category', async () => {
    const category = (
      await editor.request('POST', '/categories', { body: { title: 'Disposable category' } })
    ).data<Category>();
    expect((await editor.request('DELETE', `/categories/${category.id}`)).status).toBe(204);
    expect((await editor.request('GET', `/categories/${category.id}`)).status).toBe(404);
  });
});

interface Menu {
  id: number;
  location: string;
  items: Array<{ id: number; title: string; parentId: number | null; position: number }>;
}

describe('menus', () => {
  async function headerMenu(): Promise<Menu> {
    const response = await editor.request('GET', '/menus');
    return response.data<Menu[]>().find((menu) => menu.location === 'HEADER')!;
  }

  it('rejects a custom item with an unsafe URL', async () => {
    const menu = await headerMenu();
    const response = await editor.request('POST', `/menus/${menu.id}/items`, {
      body: { title: 'Evil', itemType: 'CUSTOM', url: 'javascript:alert(1)' },
    });
    expect(response.status).toBe(422);
  });

  it('accepts an internal path and an absolute https URL', async () => {
    const menu = await headerMenu();
    for (const url of ['/about', 'https://example.com/docs']) {
      const response = await editor.request('POST', `/menus/${menu.id}/items`, {
        body: { title: `Link ${url}`, itemType: 'CUSTOM', url },
      });
      expect(response.status, url).toBe(201);
    }
  });

  it('rejects a POST item with no target', async () => {
    const menu = await headerMenu();
    const response = await editor.request('POST', `/menus/${menu.id}/items`, {
      body: { title: 'No target', itemType: 'POST' },
    });
    expect(response.status).toBe(422);
  });

  it('reorders atomically and preserves nesting', async () => {
    const menu = await headerMenu();
    const flat = (function flatten(items: Menu['items']): Menu['items'] {
      return items.flatMap((item) => [
        item,
        ...flatten((item as unknown as { children: Menu['items'] }).children ?? []),
      ]);
    })(menu.items);

    const reversedRoots = flat.filter((item) => item.parentId === null).reverse();
    const payload = [
      ...reversedRoots.map((item, index) => ({
        id: item.id,
        parentId: null,
        position: index,
      })),
      ...flat
        .filter((item) => item.parentId !== null)
        .map((item, index) => ({ id: item.id, parentId: item.parentId, position: index })),
    ];

    const response = await editor.request('PUT', `/menus/${menu.id}/reorder`, {
      body: { items: payload },
    });
    expect(response.status).toBe(200);

    const after = await headerMenu();
    expect(after.items[0]?.id).toBe(reversedRoots[0]?.id);
  });

  it('rejects a reorder payload that omits an item, and changes nothing', async () => {
    const menu = await headerMenu();
    const before = sqliteHandle()
      .prepare('SELECT id, parent_id, position FROM menu_items WHERE menu_id = ? ORDER BY id')
      .all(menu.id);

    const response = await editor.request('PUT', `/menus/${menu.id}/reorder`, {
      body: { items: [{ id: menu.items[0]!.id, parentId: null, position: 0 }] },
    });

    expect(response.status).toBe(409);
    expect(response.error()?.code).toBe('INVALID_MENU_TREE');

    const after = sqliteHandle()
      .prepare('SELECT id, parent_id, position FROM menu_items WHERE menu_id = ? ORDER BY id')
      .all(menu.id);
    expect(after).toEqual(before);
  });

  it('rejects a reorder payload with a duplicate item', async () => {
    const menu = await headerMenu();
    const first = menu.items[0]!;
    const response = await editor.request('PUT', `/menus/${menu.id}/reorder`, {
      body: {
        items: [
          { id: first.id, parentId: null, position: 0 },
          { id: first.id, parentId: null, position: 1 },
        ],
      },
    });
    expect(response.status).toBe(409);
  });

  it('rejects a reorder payload containing a foreign item id', async () => {
    const menu = await headerMenu();
    const response = await editor.request('PUT', `/menus/${menu.id}/reorder`, {
      body: { items: [{ id: 999_999, parentId: null, position: 0 }] },
    });
    expect(response.status).toBe(409);
  });

  it('does not let an author manage menus', async () => {
    const menu = await headerMenu();
    const response = await author.request('POST', `/menus/${menu.id}/items`, {
      body: { title: 'Author attempt', itemType: 'CUSTOM', url: '/nope' },
    });
    expect(response.status).toBe(403);
  });

  it('omits items with unreachable targets from the public menu', async () => {
    const anon = createClient();
    const publicItems = (await anon.request('GET', '/public/menus/HEADER')).data<
      Array<{ resolvedUrl: string | null }>
    >();
    expect(publicItems.every((item) => item.resolvedUrl !== null)).toBe(true);
  });
});

describe('media uploads', () => {
  async function upload(client: TestContext, bytes: Buffer, filename: string, type: string) {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(bytes)], { type }), filename);
    return client.request('POST', '/media', { formData: form });
  }

  it('accepts a valid PNG and records normalised metadata', async () => {
    const response = await upload(editor, TINY_PNG, 'pixel.png', 'image/png');
    expect(response.status).toBe(201);

    const asset = response.data<{
      id: number;
      mimeType: string;
      width: number;
      height: number;
      sizeBytes: number;
    }>();
    expect(asset.mimeType).toBe('image/png');
    expect(asset.width).toBe(1);
    expect(asset.height).toBe(1);
    expect(asset.sizeBytes).toBeGreaterThan(0);
  });

  it('rejects a file whose real type is not on the allow-list', async () => {
    const response = await upload(editor, TINY_GIF, 'animation.gif', 'image/gif');
    expect(response.status).toBe(415);
    expect(response.error()?.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('rejects a spoofed extension and Content-Type (magic bytes win)', async () => {
    // A GIF renamed to .png and declared as image/png.
    const response = await upload(editor, TINY_GIF, 'actually-a-gif.png', 'image/png');
    expect(response.status).toBe(415);
  });

  it('rejects a text file dressed up as an image', async () => {
    const response = await upload(
      editor,
      Buffer.from('<?php system($_GET["c"]); ?>', 'utf8'),
      'shell.png',
      'image/png',
    );
    expect(response.status).toBe(415);
  });

  it('rejects SVG outright', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      'utf8',
    );
    const response = await upload(editor, svg, 'logo.svg', 'image/svg+xml');
    expect(response.status).toBe(415);
  });

  it('rejects an oversized file', async () => {
    const huge = Buffer.alloc(6 * 1024 * 1024, 1);
    const response = await upload(editor, huge, 'huge.png', 'image/png');
    expect(response.status).toBe(413);
    expect(response.error()?.code).toBe('FILE_TOO_LARGE');
  });

  it('never uses the original filename as the storage key', async () => {
    const response = await upload(editor, TINY_PNG, '../../escape.png', 'image/png');
    expect(response.status).toBe(201);

    const asset = response.data<{ id: number }>();
    const row = sqliteHandle()
      .prepare('SELECT storage_key, original_name FROM media_assets WHERE id = ?')
      .get(asset.id) as { storage_key: string; original_name: string };

    expect(row.storage_key).not.toContain('..');
    expect(row.storage_key).not.toContain('/');
    expect(row.storage_key).toMatch(/^\d{4}-\d{2}-[0-9a-f]{32}\.png$/);
    expect(row.original_name).not.toContain('..');
  });

  it('lets an author upload but not delete', async () => {
    const uploaded = await upload(author, TINY_PNG, 'author.png', 'image/png');
    expect(uploaded.status).toBe(201);

    const asset = uploaded.data<{ id: number }>();
    const deletion = await author.request('DELETE', `/media/${asset.id}`);
    expect(deletion.status).toBe(403);
  });

  it('refuses to delete an asset that a post still references', async () => {
    const uploaded = await upload(editor, TINY_PNG, 'featured.png', 'image/png');
    const asset = uploaded.data<{ id: number }>();

    const categories = await editor.request('GET', '/categories');
    const categoryId = categories.data<Category[]>()[0]!.id;

    await editor.request('POST', '/posts', {
      body: {
        categoryId,
        subject: 'Post using an image',
        content: 'Body',
        featuredImageId: asset.id,
      },
    });

    const response = await editor.request('DELETE', `/media/${asset.id}`);
    expect(response.status).toBe(409);
    expect(response.error()?.code).toBe('RESOURCE_IN_USE');
  });

  it('requires authentication to upload', async () => {
    const response = await upload(createClient(), TINY_PNG, 'anon.png', 'image/png');
    expect(response.status).toBe(401);
  });

  it('does not serve an unreferenced asset through the public media route', async () => {
    const uploaded = await upload(editor, TINY_PNG, 'private.png', 'image/png');
    const asset = uploaded.data<{ id: number }>();

    const anon = createClient();
    expect((await anon.request('GET', `/public/media/${asset.id}/file`)).status).toBe(404);
    // ...but a signed-in staff member can preview it.
    expect((await editor.request('GET', `/media/${asset.id}/file`)).status).toBe(200);
  });
});

describe('users', () => {
  it('does not let an editor reach the user API', async () => {
    expect((await editor.request('GET', '/users')).status).toBe(403);
    expect(
      (
        await editor.request('POST', '/users', {
          body: {
            name: 'X',
            email: 'x@y.local',
            password: 'a-long-enough-password',
            role: 'AUTHOR',
          },
        })
      ).status,
    ).toBe(403);
  });

  it('rejects a duplicate email with 409', async () => {
    const response = await admin.request('POST', '/users', {
      body: {
        name: 'Duplicate Admin',
        email: SEED_ACCOUNTS.admin.email,
        password: 'a-long-enough-password',
        role: 'AUTHOR',
      },
    });
    expect(response.status).toBe(409);
    expect(response.error()?.code).toBe('EMAIL_EXISTS');
  });

  it('rejects a password below the minimum length', async () => {
    const response = await admin.request('POST', '/users', {
      body: { name: 'Weak', email: 'weak@publishflow.local', password: 'short', role: 'AUTHOR' },
    });
    expect(response.status).toBe(422);
  });

  it('never returns a password hash in any user response', async () => {
    const list = await admin.request('GET', '/users?pageSize=50');
    expect(JSON.stringify(list.body)).not.toMatch(/passwordHash|password_hash|\$argon2/);
  });

  it('refuses to demote the last active administrator', async () => {
    const list = await admin.request('GET', '/users?pageSize=50');
    const admins = list
      .data<Array<{ id: number; role: string; status: string }>>()
      .filter((user) => user.role === 'ADMIN' && user.status === 'ACTIVE');
    expect(admins).toHaveLength(1);

    const response = await admin.request('PATCH', `/users/${admins[0]?.id}`, {
      body: { role: 'EDITOR' },
    });

    expect(response.status).toBe(409);
    expect(response.error()?.code).toBe('LAST_ACTIVE_ADMIN');
  });

  it('refuses to disable the last active administrator', async () => {
    const list = await admin.request('GET', '/users?pageSize=50');
    const only = list
      .data<Array<{ id: number; role: string; status: string }>>()
      .find((user) => user.role === 'ADMIN' && user.status === 'ACTIVE');

    const response = await admin.request('PATCH', `/users/${only?.id}`, {
      body: { status: 'DISABLED' },
    });
    expect(response.status).toBe(409);
    expect(response.error()?.code).toBe('LAST_ACTIVE_ADMIN');
  });

  it('allows the demotion once a second administrator exists', async () => {
    const created = await admin.request('POST', '/users', {
      body: {
        name: 'Second Admin',
        email: 'second-admin@publishflow.local',
        password: 'another-long-password',
        role: 'ADMIN',
      },
    });
    expect(created.status).toBe(201);

    const list = await admin.request('GET', '/users?pageSize=50');
    const target = list
      .data<Array<{ id: number; email: string }>>()
      .find((user) => user.email === 'second-admin@publishflow.local');

    const response = await admin.request('PATCH', `/users/${target?.id}`, {
      body: { role: 'EDITOR' },
    });
    expect(response.status).toBe(200);
  });

  it('requires at least one field on update', async () => {
    const list = await admin.request('GET', '/users?pageSize=50');
    const someone = list.data<Array<{ id: number }>>()[0];
    const response = await admin.request('PATCH', `/users/${someone?.id}`, { body: {} });
    expect(response.status).toBe(422);
  });

  it('revokes the target’s sessions on a password reset', async () => {
    const victim = await signedInAs('author2');
    expect((await victim.request('GET', '/auth/me')).status).toBe(200);

    const list = await admin.request('GET', '/users?pageSize=50');
    const target = list
      .data<Array<{ id: number; email: string }>>()
      .find((user) => user.email === SEED_ACCOUNTS.author2.email);

    const response = await admin.request('POST', `/users/${target?.id}/reset-password`, {
      body: { newPassword: 'a-freshly-reset-password' },
    });
    expect(response.status).toBe(200);

    expect((await victim.request('GET', '/auth/me')).status).toBe(401);
  });
});

describe('settings', () => {
  it('is readable and writable only by an administrator', async () => {
    expect((await editor.request('GET', '/settings')).status).toBe(403);
    expect((await author.request('GET', '/settings')).status).toBe(403);
    expect((await admin.request('GET', '/settings')).status).toBe(200);
  });

  it('records who changed it and when', async () => {
    const me = (await admin.request('GET', '/auth/me')).data<{ user: { id: number } }>().user;

    const response = await admin.request('PATCH', '/settings', {
      body: { siteName: 'Renamed Site' },
    });
    expect(response.status).toBe(200);

    const settings = response.data<{
      siteName: string;
      updatedBy: number;
      updatedAt: string;
      updatedByName: string;
    }>();
    expect(settings.siteName).toBe('Renamed Site');
    expect(settings.updatedBy).toBe(me.id);
    expect(new Date(settings.updatedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('rejects an invalid timezone', async () => {
    const response = await admin.request('PATCH', '/settings', {
      body: { timezone: 'Mars/Olympus_Mons' },
    });
    expect(response.status).toBe(422);
  });

  it('rejects an out-of-range postsPerPage', async () => {
    expect((await admin.request('PATCH', '/settings', { body: { postsPerPage: 0 } })).status).toBe(
      422,
    );
    expect(
      (await admin.request('PATCH', '/settings', { body: { postsPerPage: 500 } })).status,
    ).toBe(422);
  });

  it('never exposes internal user detail through the public settings endpoint', async () => {
    const response = await createClient().request('GET', '/public/settings');
    const keys = Object.keys(response.data<Record<string, unknown>>()).sort();
    expect(keys).toEqual([
      'defaultSeoDescription',
      'defaultSeoTitle',
      'logoUrl',
      'postsPerPage',
      'siteDescription',
      'siteName',
      'timezone',
    ]);
  });
});

describe('audit log', () => {
  it('is readable only by an administrator', async () => {
    expect((await editor.request('GET', '/audit-logs')).status).toBe(403);
    expect((await author.request('GET', '/audit-logs')).status).toBe(403);
    expect((await admin.request('GET', '/audit-logs')).status).toBe(200);
  });

  it('records the security-sensitive actions from the specification', async () => {
    const response = await admin.request('GET', '/audit-logs?pageSize=100');
    const actions = new Set(response.data<Array<{ action: string }>>().map((row) => row.action));

    for (const expected of [
      'auth.login.success',
      'user.created',
      'user.password_reset',
      'category.created',
      'category.deleted',
      'post.created',
      'settings.updated',
      'media.uploaded',
      'menu.reordered',
    ]) {
      expect(actions.has(expected), `missing audit action: ${expected}`).toBe(true);
    }
  });

  it('never records a password or a session token', async () => {
    const response = await admin.request('GET', '/audit-logs?pageSize=100');
    const serialised = JSON.stringify(response.body);
    expect(serialised).not.toMatch(/ChangeMe|a-long-enough-password|a-freshly-reset-password/);
    expect(serialised).not.toMatch(/\$argon2/);
  });
});
