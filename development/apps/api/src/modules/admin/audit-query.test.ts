import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

import type { AuditLogRecord } from '../../core/database/types.js';

const adminHeaders = { 'X-Demo-User': 'demo-admin' };
const auditPath = '/api/development/v1/admin/audit-logs';

function audit(
  id: string,
  createdAt: string,
  overrides: Partial<AuditLogRecord> = {},
): AuditLogRecord {
  return {
    id,
    actorUid: 'actor-a',
    action: 'admin.module.update',
    resourceType: 'module',
    resourceId: 'sports',
    details: {},
    status: 'recorded',
    ownerUid: 'actor-a',
    scope: { type: 'public', id: '*' },
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function appWithAuditRows(rows: AuditLogRecord[]) {
  const baseStore = createMemoryStore();
  const auditLogs = Object.create(baseStore.auditLogs) as typeof baseStore.auditLogs;
  auditLogs.list = async () => structuredClone(rows);
  const store = {
    ...baseStore,
    auditLogs,
    queryAuditLogs: async (query: {
      actorUid?: string;
      action?: string;
      resourceType?: string;
      resourceId?: string;
      from?: string;
      to?: string;
      page: number;
      pageSize: number;
    }) => {
      const matches = rows
        .filter(
          (row) =>
            (query.actorUid === undefined || row.actorUid === query.actorUid) &&
            (query.action === undefined || row.action === query.action) &&
            (query.resourceType === undefined || row.resourceType === query.resourceType) &&
            (query.resourceId === undefined || row.resourceId === query.resourceId) &&
            (query.from === undefined || Date.parse(row.createdAt) >= Date.parse(query.from)) &&
            (query.to === undefined || Date.parse(row.createdAt) <= Date.parse(query.to)),
        )
        .sort(
          (left, right) =>
            Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
            right.id.localeCompare(left.id),
        );
      const offset = (query.page - 1) * query.pageSize;
      return {
        items: structuredClone(matches.slice(offset, offset + query.pageSize)),
        page: query.page,
        pageSize: query.pageSize,
        total: matches.length,
      };
    },
  };
  return createApp({
    store,
    databaseMode: 'memory',
    authMode: 'demo',
    authClient: new DemoAuthClient(['demo-admin']),
  });
}

describe('audit log query API', () => {
  it('filters exact fields and inclusive dates before deterministic paging', async () => {
    const rows = [
      audit('a', '2026-07-27T10:00:00.000Z'),
      audit('b', '2026-07-27T10:00:00.000Z'),
      audit('c', '2026-07-27T09:59:59.999Z'),
      audit('d', '2026-07-27T10:00:00.000Z', { actorUid: 'actor-b' }),
      audit('e', '2026-07-27T10:00:00.000Z', { action: 'admin.role.update' }),
      audit('f', '2026-07-27T10:00:00.000Z', { resourceType: 'role' }),
      audit('g', '2026-07-27T10:00:00.000Z', { resourceId: 'finance' }),
    ];
    const app = appWithAuditRows(rows);

    const first = await request(app)
      .get(auditPath)
      .query({
        actorUid: 'actor-a',
        action: 'admin.module.update',
        resourceType: 'module',
        resourceId: 'sports',
        from: '2026-07-27T09:59:59.999Z',
        to: '2026-07-27T10:00:00.000Z',
        page: 1,
        pageSize: 2,
      })
      .set(adminHeaders)
      .expect(200);
    expect(first.body.data).toMatchObject({
      items: [{ id: 'b' }, { id: 'a' }],
      page: 1,
      pageSize: 2,
      total: 3,
    });

    const second = await request(app)
      .get(auditPath)
      .query({
        actorUid: 'actor-a',
        action: 'admin.module.update',
        resourceType: 'module',
        resourceId: 'sports',
        from: '2026-07-27T09:59:59.999Z',
        to: '2026-07-27T10:00:00.000Z',
        page: 2,
        pageSize: 2,
      })
      .set(adminHeaders)
      .expect(200);
    expect(second.body.data.items).toEqual([expect.objectContaining({ id: 'c' })]);
  });

  it.each([
    [{ page: 0 }, 'page below one'],
    [{ page: 1.5 }, 'non-integer page'],
    [{ pageSize: 0 }, 'page size below one'],
    [{ pageSize: 101 }, 'page size above one hundred'],
    [{ from: 'not-a-date' }, 'invalid from date'],
    [{ from: '2026-07-27T18:00:00.000+08:00' }, 'non-UTC from date'],
    [{ unexpected: 'field' }, 'unknown filter'],
  ])('rejects %s (%s)', async (query, label) => {
    void label;
    await request(appWithAuditRows([])).get(auditPath).query(query).set(adminHeaders).expect(400);
  });
});
