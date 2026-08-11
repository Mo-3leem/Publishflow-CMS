import { Hono } from 'hono';
import {
  createMenuItemBody,
  reorderMenuBody,
  updateMenuItemBody,
} from '@/server/contracts/schemas';
import {
  createMenuItem,
  deleteMenuItem,
  getMenu,
  listMenus,
  reorderMenu,
  updateMenuItem,
} from '@/server/services/menu-service';
import { requireCapability } from '../middleware/auth';
import type { AppBindings } from '../types';
import { ctxOf, idParamOf, parseJson, requirePrincipal } from './helpers';

export const menuRoutes = new Hono<AppBindings>();

menuRoutes.use('*', requireCapability('menu.manage'));

menuRoutes.get('/', (c) => c.json({ data: listMenus(requirePrincipal(c)) }));

menuRoutes.get('/:id', (c) => c.json({ data: getMenu(requirePrincipal(c), idParamOf(c)) }));

menuRoutes.post('/:id/items', async (c) => {
  const body = await parseJson(c, createMenuItemBody);
  return c.json({ data: createMenuItem(ctxOf(c), idParamOf(c), body) }, 201);
});

menuRoutes.patch('/:id/items/:itemId', async (c) => {
  const body = await parseJson(c, updateMenuItemBody);
  return c.json({
    data: updateMenuItem(ctxOf(c), idParamOf(c), idParamOf(c, 'itemId'), body),
  });
});

menuRoutes.delete('/:id/items/:itemId', (c) =>
  c.json({ data: deleteMenuItem(ctxOf(c), idParamOf(c), idParamOf(c, 'itemId')) }),
);

/** Atomic whole-tree reorder — partial application is impossible by design. */
menuRoutes.put('/:id/reorder', async (c) => {
  const body = await parseJson(c, reorderMenuBody);
  return c.json({ data: reorderMenu(ctxOf(c), idParamOf(c), body.items) });
});
