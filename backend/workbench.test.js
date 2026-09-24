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

test('course calendar routes authenticate before reading and validate semester and Monday before writing', async (t) => {
  let queries = 0;
  const base = await startTestServer(t, {
    user: { id: 7 },
    pool: {
      async execute() {
        queries += 1;
        return [[]];
      },
    },
  });
  for (const method of ['GET', 'PUT']) {
    const result = await requestJson(base, '/campus/course-calendar?semester=2026-2027-1', {
      method,
      auth: false,
    });
    assert.equal(result.response.status, 401);
  }
  assert.equal(queries, 0);
  assert.equal(
    (await requestJson(base, '/campus/course-calendar?semester=invalid%2Fsemester')).response
      .status,
    400,
  );
  for (const body of [
    { semesterId: '2026-2027-1', firstWeekMonday: '2026-09-22' },
    { semesterId: '../other', firstWeekMonday: '2026-09-21' },
    {},
  ]) {
    const result = await requestJson(base, '/campus/course-calendar', {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    assert.equal(result.response.status, 400);
  }
  assert.equal(queries, 0);
});

test('saving a semester Monday immediately exposes fixed courses in calendar, summary and conflicts', async (t) => {
  let monday = null;
  let settingsWrites = 0;
  const pool = {
    async execute(sql, parameters) {
      if (sql.includes('INSERT INTO campus_course_calendar_settings')) {
        assert.deepEqual(parameters, ['2026-09-21', '2026-2027-1', 7]);
        [monday] = parameters;
        settingsWrites += 1;
        return [{ affectedRows: 1 }];
      }
      assert.equal(parameters[0], 7);
      if (sql.includes('FROM campus_learn_semester_snapshots s'))
        return [
          [
            {
              semester_id: '2026-2027-1',
              first_week_monday: monday,
              snapshot_generation: 3,
              connector_generation: 3,
              settings_generation: monday ? 3 : null,
              connected_at: '2026-09-20T02:00:00Z',
              fetched_at: '2026-09-21T02:00:00Z',
              sync_status: 'complete',
              courses_json: [
                {
                  sourceReference: 'course:a',
                  title: '信号与系统',
                  scheduleText: '1-16周 周一第2大节',
                },
              ],
            },
          ],
        ];
      assert.doesNotMatch(sql, /INSERT INTO schedule_items|UPDATE schedule_items/);
      return [[]];
    },
  };
  const base = await startTestServer(t, { pool, user: { id: 7 } });
  const before = await requestJson(base, '/campus/course-calendar?semester=2026-2027-1');
  assert.equal(before.payload.scheduledLessons, 0);
  assert.match(before.payload.issues[0].message, /第一教学周/);
  const saved = await requestJson(base, '/campus/course-calendar', {
    method: 'PUT',
    body: JSON.stringify({
      semesterId: '2026-2027-1',
      firstWeekMonday: '2026-09-21',
    }),
  });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.payload.scheduledLessons, 16);
  for (const route of [
    '/schedule-items?from=2026-09-20T16:00:00Z&to=2026-09-27T16:00:00Z',
    '/summary?from=2026-09-20T16:00:00Z&to=2026-09-27T16:00:00Z',
    '/schedule-items/conflicts?startAt=2026-09-21T02:00:00Z&endAt=2026-09-21T03:00:00Z',
  ]) {
    const result = await requestJson(base, route);
    assert.equal(result.response.status, 200, route);
    const items = result.payload.scheduleItems || result.payload.conflicts;
    assert.equal(items.length, 1, route);
    assert.equal(items[0].kind, 'course');
    assert.equal(items[0].status, 'confirmed');
    assert.ok(items[0].courseScheduleReference);
  }
  assert.equal(settingsWrites, 1);
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
      if (sql.includes('FROM campus_learn_semester_snapshots')) return [[]];
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
  assert.equal(calls.length, 4);
  assert.equal(calls[0].parameters[0], 7);
  assert.deepEqual(calls[1].parameters.slice(0, 2), [7, 7]);
  assert.equal(calls[2].parameters[0], 7);
  assert.match(calls[0].sql, /WHERE user_id = \?/);
  assert.match(calls[2].sql, /WHERE user_id = \?/);
});

test('campus semesters expose only the authenticated user normalized snapshot', async (t) => {
  const calls = [];
  const baseUrl = await startTestServer(t, {
    user: { id: 21, is_admin: false },
    pool: {
      async execute(statement, parameters = []) {
        const sql = statement.replace(/\s+/g, ' ').trim();
        calls.push({ sql, parameters });
        if (sql.includes('FROM campus_learn_semester_catalogs')) return [[]];
        return [
          [
            {
              semester_id: '2026-2027-1',
              courses_json: JSON.stringify([{ sourceReference: 'course:a', title: '信号与系统' }]),
              notifications_json: JSON.stringify([
                { sourceReference: 'notice:a', courseReference: 'course:a', title: '第一讲' },
              ]),
              sync_status: 'complete',
              fetched_at: new Date('2026-08-02T08:00:00.000Z'),
            },
          ],
        ];
      },
    },
  });

  const list = await requestJson(baseUrl, '/campus/semesters');
  assert.equal(list.response.status, 200);
  assert.equal(list.payload.semesters[0].courseCount, 1);
  assert.equal(list.payload.semesters[0].notificationCount, 1);

  const detail = await requestJson(baseUrl, '/campus/semesters/2026-2027-1');
  assert.equal(detail.response.status, 200);
  assert.equal(detail.payload.semester.courses[0].title, '信号与系统');
  assert.deepEqual(calls[0].parameters, [21]);
  assert.deepEqual(calls[2].parameters, [21, '2026-2027-1']);
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

test('editing a DDL keeps its one-minute deadline marker invariant', async (t) => {
  const calls = [];
  const start = new Date('2026-09-20T15:58:00.000Z');
  const end = new Date('2026-09-20T15:59:00.000Z');
  const baseUrl = await startTestServer(t, {
    user: { id: 9, is_admin: false },
    pool: {
      async execute(statement) {
        calls.push(statement);
        if (statement.includes('FROM schedule_items'))
          return [
            [
              {
                public_id: 'ws_deadline',
                title: '报告',
                start_at: start,
                end_at: end,
                source_type: 'agent',
                source_reference: 'planner:deadline',
                version: 1,
              },
            ],
          ];
        throw new Error('DDL update should be rejected before writing');
      },
    },
  });
  const { response } = await requestJson(baseUrl, '/schedule-items/ws_deadline', {
    method: 'PATCH',
    body: JSON.stringify({ endAt: '2026-09-20T16:30:00.000Z' }),
  });
  assert.equal(response.status, 400);
  assert.equal(calls.length, 1);
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

test('calendar exposes owned homework and persists completion without modifying upstream homework', async (t) => {
  let completed;
  const pool = {
    async execute(sql, parameters) {
      assert.equal(parameters[0], 7);
      if (sql.includes('FROM schedule_items')) return [[]];
      if (sql.includes('FROM campus_learn_semester_snapshots')) return [[]];
      if (sql.includes('FROM campus_homework_snapshots'))
        return [
          [
            {
              homework_json: [
                {
                  sourceReference: 'learn:homework:one',
                  title: '作业',
                  dueAt: '2026-09-22T15:59:00Z',
                  status: 'unsubmitted',
                },
              ],
            },
          ],
        ];
      if (sql.startsWith('SELECT homework_reference'))
        return [
          completed === undefined ? [] : [{ homework_reference: 'learn:homework:one', completed }],
        ];
      if (sql.includes('INSERT INTO campus_homework_calendar_states')) {
        completed = parameters[2];
        return [{ affectedRows: 1 }];
      }
      throw new Error(sql);
    },
  };
  const base = await startTestServer(t, { pool, user: { id: 7 } });
  const path = '/schedule-items?from=2026-09-20T16:00:00Z&to=2026-09-27T16:00:00Z';
  let result = await requestJson(base, path);
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.scheduleItems[0].completed, false);
  const completionPath = '/homework-deadlines/learn%3Ahomework%3Aone/completion';
  result = await requestJson(base, completionPath, {
    method: 'PATCH',
    body: JSON.stringify({ completed: true }),
  });
  assert.equal(result.response.status, 200);
  result = await requestJson(base, path);
  assert.equal(result.payload.scheduleItems[0].status, 'completed');
  result = await requestJson(base, completionPath, {
    method: 'PATCH',
    body: JSON.stringify({ completed: 'true' }),
  });
  assert.equal(result.response.status, 400);
  result = await requestJson(base, '/homework-deadlines/foreign/completion', {
    method: 'PATCH',
    body: JSON.stringify({ completed: true }),
  });
  assert.equal(result.response.status, 404);
  result = await requestJson(base, completionPath, {
    method: 'PATCH',
    auth: false,
    body: JSON.stringify({ completed: true }),
  });
  assert.equal(result.response.status, 401);
});

test('manual schedule notes round-trip, remain optional, and can be edited or cleared', async (t) => {
  let row;
  const calls = [];
  const pool = {
    async execute(sql, parameters) {
      calls.push({ sql, parameters });
      if (sql.includes('INSERT INTO schedule_items')) {
        row = {
          public_id: parameters[0],
          title: parameters[3],
          description: parameters[4] || null,
          start_at: parameters[5],
          end_at: parameters[6],
          status: 'confirmed',
          source_type: 'manual',
          version: 1,
        };
        assert.deepEqual(parameters.slice(1, 3), [7, 7]);
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('UPDATE schedule_items')) {
        assert.match(sql, /WHERE public_id = \? AND user_id = \?/);
        assert.deepEqual(parameters.slice(-3), [row.public_id, 7, row.version]);
        row.description = parameters[0] || null;
        row.version += 1;
        return [{ affectedRows: 1 }];
      }
      assert.match(sql, /FROM schedule_items/);
      assert.deepEqual(parameters, [row.public_id, 7]);
      return [[row]];
    },
  };
  const base = await startTestServer(t, { pool, user: { id: 7 } });
  const event = {
    title: '例会',
    startAt: '2026-10-01T09:00:00Z',
    endAt: '2026-10-01T10:00:00Z',
  };
  let result = await requestJson(base, '/schedule-items', {
    method: 'POST',
    body: JSON.stringify(event),
  });
  assert.equal(result.response.status, 201);
  assert.equal(result.payload.scheduleItem.description, '');
  for (const description of ['六教 6A201\n带电脑 <script>notes</script>', '']) {
    result = await requestJson(base, `/schedule-items/${row.public_id}`, {
      method: 'PATCH',
      body: JSON.stringify({ description, version: row.version }),
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.scheduleItem.description, description);
  }
  result = await requestJson(base, '/schedule-items', {
    method: 'POST',
    body: JSON.stringify({ ...event, description: '图书馆二层；带书' }),
  });
  assert.equal(result.response.status, 201);
  assert.equal(result.payload.scheduleItem.description, '图书馆二层；带书');
  assert.ok(calls.every((call) => !call.sql.includes('<script>')));
});

test('manual schedule APIs reject malformed notes and cannot edit another user or synced homework', async (t) => {
  const calls = [];
  const base = await startTestServer(t, {
    user: { id: 7 },
    pool: {
      async execute(sql, parameters) {
        calls.push({ sql, parameters });
        assert.match(sql, /SELECT .*description[\s\S]*FROM schedule_items/);
        assert.match(sql, /WHERE public_id = \? AND user_id = \?/);
        if (parameters[0] !== 'ws_own') return [[]];
        return [
          [
            {
              public_id: 'ws_own',
              title: '旧日程',
              description: null,
              start_at: new Date('2026-10-01T09:00:00Z'),
              end_at: new Date('2026-10-01T10:00:00Z'),
              status: 'confirmed',
              source_type: 'manual',
              version: 1,
            },
          ],
        ];
      },
    },
  });
  for (const description of [{ text: '地点' }, [], false, 42, '字'.repeat(4001)]) {
    const event = {
      title: '例会',
      description,
      startAt: '2026-10-01T09:00:00Z',
      endAt: '2026-10-01T10:00:00Z',
    };
    const created = await requestJson(base, '/schedule-items', {
      method: 'POST',
      body: JSON.stringify(event),
    });
    assert.equal(created.response.status, 400);
    const edited = await requestJson(base, '/schedule-items/ws_own', {
      method: 'PATCH',
      body: JSON.stringify({ description }),
    });
    assert.equal(edited.response.status, 400);
  }
  for (const id of ['ws_another_user', 'hw_readonly']) {
    const result = await requestJson(base, `/schedule-items/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ description: '不能修改同步来源' }),
    });
    assert.equal(result.response.status, 404);
    assert.deepEqual(calls.at(-1).parameters, [id, 7]);
  }
  assert.ok(calls.every((call) => !/UPDATE|INSERT|DELETE/.test(call.sql)));
});
