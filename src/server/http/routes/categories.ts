import { Hono } from 'hono';
import { createCategoryBody, updateCategoryBody } from '@/server/contracts/schemas';
import {
  createCategory,
  deleteCategory,
  getCategoryById,
  listCategories,
  updateCategory,
} from '@/server/services/category-service';
import { requireAuth, requireCapability } from '../middleware/auth';
import type { AppBindings } from '../types';
import { ctxOf, idParamOf, parseJson } from './helpers';

export const categoryRoutes = new Hono<AppBindings>();

// Any signed-in staff member may read categories (they need them to file a post);
// only Admin/Editor may change them.
// Categories are a small, bounded set (max depth 2), so this list is returned
// whole rather than paginated — the meta block reports the full count.
categoryRoutes.get('/', requireAuth(), (c) => {
  const data = listCategories();
  return c.json({
    data,
    meta: {
      page: 1,
      pageSize: data.length,
      total: data.length,
      totalPages: data.length > 0 ? 1 : 0,
    },
  });
});

categoryRoutes.get('/:id', requireAuth(), (c) => c.json({ data: getCategoryById(idParamOf(c)) }));

categoryRoutes.post('/', requireCapability('category.manage'), async (c) => {
  const body = await parseJson(c, createCategoryBody);
  return c.json({ data: createCategory(ctxOf(c), body) }, 201);
});

categoryRoutes.patch('/:id', requireCapability('category.manage'), async (c) => {
  const body = await parseJson(c, updateCategoryBody);
  return c.json({ data: updateCategory(ctxOf(c), idParamOf(c), body) });
});

categoryRoutes.delete('/:id', requireCapability('category.manage'), (c) => {
  deleteCategory(ctxOf(c), idParamOf(c));
  return c.body(null, 204);
});
