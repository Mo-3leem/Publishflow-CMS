import { Hono } from 'hono';
import { listAuditQuery } from '@/server/contracts/schemas';
import { listAuditFacets, listAuditLogs } from '@/server/services/audit-service';
import { requireCapability } from '../middleware/auth';
import type { AppBindings } from '../types';
import { parseQuery, requirePrincipal } from './helpers';

export const auditRoutes = new Hono<AppBindings>();

auditRoutes.use('*', requireCapability('audit.view'));

auditRoutes.get('/', (c) => {
  const query = parseQuery(c, listAuditQuery);
  return c.json(listAuditLogs(requirePrincipal(c), query));
});

/** Distinct actions/entity types for the filter dropdowns. */
auditRoutes.get('/facets', (c) => c.json({ data: listAuditFacets(requirePrincipal(c)) }));
