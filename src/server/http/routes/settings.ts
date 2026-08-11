import { Hono } from 'hono';
import { updateSettingsBody } from '@/server/contracts/schemas';
import { getSettingsForAdmin, updateSettings } from '@/server/services/settings-service';
import { requireCapability } from '../middleware/auth';
import type { AppBindings } from '../types';
import { ctxOf, parseJson, requirePrincipal } from './helpers';

export const settingsRoutes = new Hono<AppBindings>();

settingsRoutes.use('*', requireCapability('settings.manage'));

settingsRoutes.get('/', (c) => c.json({ data: getSettingsForAdmin(requirePrincipal(c)) }));

settingsRoutes.patch('/', async (c) => {
  const body = await parseJson(c, updateSettingsBody);
  return c.json({ data: updateSettings(ctxOf(c), body) });
});
