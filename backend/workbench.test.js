const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const { createWorkbenchRouter, getDefaultWeekRange, parseRange } = require('./workbench');

async function startTestServer(
  t,
  { pool, user, learnConnectorCapabilities, getCampusConnectorStatus },
) {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/workbench',
    createWorkbenchRouter({
      pool,
      requireAuth: async (request, response) => {
        if (request.get('authorization') !== 'Bearer test-token' || !user) {
          response.status(401).json({ message: '未登录或登录已失效' });
          return null;
        }
        return user;
      },
      learnConnectorCapabilities,
      getCampusConnectorStatus,
    }),
  );

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const address = server.address();
  return `http://127.0.0.1:${address.port}/api/workbench`;
}

async function requestJson(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.auth === false ? {} : { Authorization: 'Bearer test-token' }),
      ...(options.headers || {}),
    },
    ...options,
  });
  return {
    response,
    payload: await response.json().catch(() => ({})),
  };
}

test('computes a Monday-to-Monday week in Asia/Shanghai', () => {
  const range = getDefaultWeekRange(new Date('2026-08-01T08:00:00.000Z'));
  assert.equal(range.start.toISOString(), '2026-07-26T16:00:00.000Z');
  assert.equal(range.end.toISOString(), '2026-08-02T16:00:00.000Z');
});

test('rejects inverted and excessively large custom ranges', () => {
  assert.equal(
    parseRange({
      from: '2026-08-02T00:00:00.000Z',
      to: '2026-08-01T00:00:00.000Z',
    }),
    null,
  );
  assert.equal(
    parseRange({
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-08-01T00:00:00.000Z',
    }),
    null,
  );
});

test('summary requires authentication and never queries personal data for guests', async (t) => {
  const calls = [];
  const baseUrl = await startTestServer(t, {
    user: null,
    pool: {
      async execute(statement, parameters) {
        calls.push({ statement, parameters });
        return [[]];
      },
    },
  });

  const { response } = await requestJson(baseUrl, '/summary', { auth: false });
  assert.equal(response.status, 401);
  assert.equal(calls.length, 0);
});

test('learn connector capabilities are authenticated and do not claim private data access', async (t) => {
  const pool = {
    async execute() {
      throw new Error('capability discovery must not query the database');
    },
  };
  const baseUrl = await startTestServer(t, {
    user: { id: 7, is_admin: false },
    pool,
  });

  const unauthorized = await requestJson(baseUrl, '/connectors/tsinghua-learn/capabilities', {
    auth: false,
  });
  assert.equal(unauthorized.response.status, 401);

  const { response, payload } = await requestJson(
    baseUrl,
    '/connectors/tsinghua-learn/capabilities',
  );
  assert.equal(response.status, 200);
  assert.equal(payload.connector.transport.state, 'awaiting_authorized_transport');
  assert.equal(payload.connector.validationState, 'fixture_only');
  assert.equal(payload.connector.liveSyncState, 'blocked_pending_authorization');
  assert.equal(payload.connector.transport.acceptsPasswordFromBrowser, false);
  assert.equal(payload.connector.transport.acceptsCookieFromBrowser, false);
  assert.equal(payload.connector.safeguards.rawResponsesPersisted, false);
});

test('learn connector capabilities expose user-scoped real sync evidence', async (t) => {
  const baseUrl = await startTestServer(t, {
    user: { id: 7, is_admin: false },
    pool: {
      async execute() {
        return [[]];
      },
    },
    learnConnectorCapabilities: {
      learnAuthorizedTransportConfigured: true,
      acceptsPasswordFromBrowser: true,
      authorizationStrategy: 'direct_cas',
    },
    async getCampusConnectorStatus(userId) {
      assert.equal(userId, 7);
      return { connection: { lastSuccessfulSyncAt: '2026-08-02T08:00:00.000Z' } };
    },
  });

  const { response, payload } = await requestJson(
    baseUrl,
    '/connectors/tsinghua-learn/capabilities',
  );
  assert.equal(response.status, 200);
  assert.equal(payload.connector.validationState, 'live_account_verified');
  assert.equal(payload.connector.liveSyncState, 'verified');
  assert.equal(payload.connector.transport.state, 'configured');
  assert.equal(payload.connector.transport.acceptsPasswordFromBrowser, true);
});

test('summary scopes all three data sets to the authenticated user', async (t) => {
  const calls = [];
  const pool = {
    async execute(statement, parameters = []) {
      const sql = statement.replace(/\s+/g, ' ').trim();
      calls.push({ sql, parameters });

      if (sql.includes('FROM important_items')) {
        return [
          [
            {
              public_id: 'wi_1',
              title: '提交实验报告',
              description: '检查格式',
              due_at: new Date('2026-08-02T10:00:00.000Z'),
              priority: 'high',
              status: 'confirmed',
              source_type: 'manual',
            },
          ],
        ];
      }
      if (sql.includes('FROM notifications n')) {
        return [
          [
            {
              public_id: 'wn_1',
              category: 'course',
              source_type: 'network_classroom',
              title: '作业已发布',
              body: '本周日前提交',
              action_url: 'https://learn.tsinghua.edu.cn/',
              importance: 'important',
              published_at: new Date('2026-08-01T02:00:00.000Z'),
              read_at: null,
            },
          ],
        ];
      }
      if (sql.includes('FROM schedule_items')) {
        return [
          [
            {
              public_id: 'ws_1',
              title: '信号与系统',
              description: '课堂',
              start_at: new Date('2026-08-01T05:00:00.000Z'),
              end_at: new Date('2026-08-01T06:00:00.000Z'),
              all_day: 0,
              timezone: 'Asia/Shanghai',
              status: 'confirmed',
              source_type: 'manual',
              version: 1,
            },
          ],
        ];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const baseUrl = await startTestServer(t, {
    pool,
    user: { id: 7, is_admin: false },
  });

  const { response, payload } = await requestJson(
    baseUrl,
    '/summary?from=2026-07-26T16:00:00.000Z&to=2026-08-02T16:00:00.000Z',
  );
  assert.equal(response.status, 200);
  assert.equal(payload.importantItems[0].publicId, 'wi_1');
  assert.equal(payload.notifications[0].publicId, 'wn_1');
  assert.equal(payload.scheduleItems[0].publicId, 'ws_1');
  assert.equal(calls.length, 3);
  assert.equal(calls[0].parameters[0], 7);
  assert.deepEqual(calls[1].parameters.slice(0, 2), [7, 7]);
  assert.equal(calls[2].parameters[0], 7);
  assert.match(calls[0].sql, /WHERE user_id = \?/);
  assert.match(calls[2].sql, /WHERE user_id = \?/);
});

test('notification limits are clamped before being embedded in the query', async (t) => {
  const calls = [];
  const baseUrl = await startTestServer(t, {
    user: { id: 13, is_admin: false },
    pool: {
      async execute(statement, parameters = []) {
        calls.push({ sql: statement.replace(/\s+/g, ' ').trim(), parameters });
        return [[]];
      },
    },
  });

  const { response, payload } = await requestJson(baseUrl, '/notifications?limit=999');
  assert.equal(response.status, 200);
  assert.deepEqual(payload.notifications, []);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /LIMIT 50$/);
  assert.deepEqual(calls[0].parameters, [13, 13]);
});

test('important-item updates cannot cross user boundaries', async (t) => {
  const calls = [];
  const baseUrl = await startTestServer(t, {
    user: { id: 42, is_admin: false },
    pool: {
      async execute(statement, parameters = []) {
        const sql = statement.replace(/\s+/g, ' ').trim();
        calls.push({ sql, parameters });
        if (sql.startsWith('UPDATE important_items')) {
          return [{ affectedRows: 0 }];
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    },
  });

  const { response, payload } = await requestJson(baseUrl, '/important-items/wi_other', {
    method: 'PATCH',
    body: JSON.stringify({ title: '不应成功' }),
  });
  assert.equal(response.status, 404);
  assert.equal(payload.message, '事项不存在');
  assert.deepEqual(calls[0].parameters.slice(-2), ['wi_other', 42]);
  assert.match(calls[0].sql, /public_id = \? AND user_id = \?/);
});

test('schedule creation rejects an end before its start without writing', async (t) => {
  let queryCount = 0;
  const baseUrl = await startTestServer(t, {
    user: { id: 5, is_admin: false },
    pool: {
      async execute() {
        queryCount += 1;
        return [[]];
      },
    },
  });

  const { response } = await requestJson(baseUrl, '/schedule-items', {
    method: 'POST',
    body: JSON.stringify({
      title: '无效日程',
      startAt: '2026-08-02T12:00:00.000Z',
      endAt: '2026-08-02T11:00:00.000Z',
    }),
  });
  assert.equal(response.status, 400);
  assert.equal(queryCount, 0);
});

test('only the owner can confirm an Agent-created schedule draft', async (t) => {
  const calls = [];
  const baseUrl = await startTestServer(t, {
    user: { id: 9, is_admin: false },
    pool: {
      async execute(statement, parameters = []) {
        const sql = statement.replace(/\s+/g, ' ').trim();
        calls.push({ sql, parameters });
        if (sql.startsWith('UPDATE schedule_items')) {
          return [{ affectedRows: 1 }];
        }
        if (sql.includes('FROM schedule_items')) {
          return [
            [
              {
                public_id: 'ws_agent',
                title: 'Agent 草稿',
                description: '',
                start_at: new Date('2026-08-02T01:00:00.000Z'),
                end_at: new Date('2026-08-02T02:00:00.000Z'),
                all_day: 0,
                timezone: 'Asia/Shanghai',
                status: 'confirmed',
                source_type: 'agent',
                version: 2,
                user_confirmed_at: new Date('2026-08-01T00:00:00.000Z'),
              },
            ],
          ];
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    },
  });

  const { response, payload } = await requestJson(baseUrl, '/schedule-items/ws_agent/confirm', {
    method: 'POST',
    body: '{}',
  });
  assert.equal(response.status, 200);
  assert.equal(payload.scheduleItem.status, 'confirmed');
  assert.equal(payload.scheduleItem.sourceType, 'agent');
  assert.deepEqual(calls[0].parameters, ['ws_agent', 9]);
  assert.match(calls[0].sql, /user_id = \?/);
  assert.match(calls[0].sql, /status = 'draft'/);
});

test('notification state changes require visibility to the current user', async (t) => {
  const calls = [];
  const baseUrl = await startTestServer(t, {
    user: { id: 11, is_admin: false },
    pool: {
      async execute(statement, parameters = []) {
        const sql = statement.replace(/\s+/g, ' ').trim();
        calls.push({ sql, parameters });
        if (sql.includes('FROM notifications')) {
          return [[]];
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    },
  });

  const { response } = await requestJson(baseUrl, '/notifications/wn_private/state', {
    method: 'PATCH',
    body: JSON.stringify({ read: true }),
  });
  assert.equal(response.status, 404);
  assert.deepEqual(calls[0].parameters, ['wn_private', 11]);
  assert.match(calls[0].sql, /recipient_user_id = \?/);
  assert.equal(calls.length, 1);
});
