import { Hono } from 'hono';
import {
  createUserBody,
  listUsersQuery,
  resetPasswordBody,
  updateUserBody,
} from '@/server/contracts/schemas';
import {
  createUser,
  getUserById,
  listUsers,
  resetUserPassword,
  updateUser,
} from '@/server/services/user-service';
import { requireCapability } from '../middleware/auth';
import type { AppBindings } from '../types';
import { ctxOf, idParamOf, parseJson, parseQuery, requirePrincipal } from './helpers';

/** User administration — Admin only, enforced by both middleware and service. */
export const userRoutes = new Hono<AppBindings>();

userRoutes.use('*', requireCapability('user.manage'));

userRoutes.get('/', (c) => {
  const query = parseQuery(c, listUsersQuery);
  const result = listUsers(requirePrincipal(c), query);
  return c.json(result);
});

userRoutes.post('/', async (c) => {
  const body = await parseJson(c, createUserBody);
  const user = await createUser(ctxOf(c), body);
  return c.json({ data: user }, 201);
});

userRoutes.get('/:id', (c) => {
  const user = getUserById(requirePrincipal(c), idParamOf(c));
  return c.json({ data: user });
});

userRoutes.patch('/:id', async (c) => {
  const body = await parseJson(c, updateUserBody);
  const user = updateUser(ctxOf(c), idParamOf(c), body);
  return c.json({ data: user });
});

userRoutes.post('/:id/reset-password', async (c) => {
  const body = await parseJson(c, resetPasswordBody);
  const user = await resetUserPassword(ctxOf(c), idParamOf(c), body.newPassword);
  return c.json({ data: user });
});
