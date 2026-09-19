const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const {
  buildPlan,
  buildPreview,
  createSchedulePlannerRouter,
  overlaps,
  parseAgentAnswer,
  parseKnownScheduleMessage,
  COURSE_SECTIONS,
} = require('./workbench-schedule-planner');

const now = new Date('2026-09-18T00:00:00.000Z');
const sept19 = new Date('2026-09-18T17:22:23.000Z');

test('availability-constrained plans are delegated instead of scheduled in default hours', () => {
  for (const message of [
    '接下来3天只在晚上学习数学共6小时',
    '接下来3天下午复习6小时',
    '接下来3天19:00到21:00复习6小时',
  ]) {
    assert.equal(parseKnownScheduleMessage(message, now), null);
  }
});

test('local preview respects the entered meeting instead of returning a canned event', () => {
  const parsed = parseKnownScheduleMessage('19号下午5点开会，持续时间2小时', sept19);
  assert.equal(parsed.title, '开会');
  assert.equal(parsed.startAt, '2026-09-19T09:00:00.000Z');
  assert.equal(parsed.endAt, '2026-09-19T11:00:00.000Z');
  assert.equal(buildPreview(parsed, [], sept19).suggestions[0].title, '开会');
});

test('six course sections use the exact Beijing-time knowledge mapping', () => {
  const expected = Object.values(COURSE_SECTIONS);
  assert.deepEqual(expected, [
    ['08:00', '09:35'], ['09:50', '12:15'], ['13:30', '15:05'],
    ['15:20', '16:55'], ['17:10', '18:45'], ['19:20', '21:45'],
  ]);
  const names = ['一', '二', '三', '四', '五', '六'];
  for (let index = 0; index < names.length; index += 1) {
    const parsed = parseKnownScheduleMessage(`9月20日第${names[index]}大节上课`, sept19);
    const start = new Date(parsed.startAt);
    const end = new Date(parsed.endAt);
    const [hour, minute] = expected[index][0].split(':').map(Number);
    assert.equal(start.toISOString(), new Date(Date.UTC(2026, 8, 20, hour, minute) - 8 * 3600000).toISOString());
    assert.equal((end - start) / 60000, (Number(expected[index][1].slice(0, 2)) * 60 + Number(expected[index][1].slice(3))) - (Number(expected[index][0].slice(0, 2)) * 60 + Number(expected[index][0].slice(3))));
  }
});

test('weekly course section expands into exactly X future weeks and checks every conflict', () => {
  const parsed = parseKnownScheduleMessage('每周三第三大节上模拟电路，持续8周', sept19);
  const proposal = buildPreview(parsed, [], sept19);
  assert.equal(proposal.suggestions.length, 8);
  assert.equal(proposal.suggestions[0].startAt, '2026-09-23T05:30:00.000Z');
  assert.equal(proposal.suggestions[0].endAt, '2026-09-23T07:05:00.000Z');
  assert.equal(proposal.suggestions[7].description, '周常 · 第 8/8 周');
  assert.equal(new Date(proposal.suggestions[1].startAt) - new Date(proposal.suggestions[0].startAt), 7 * 86400000);
  assert.throws(() => buildPreview(parsed, [proposal.suggestions[4]], sept19), /冲突/);
});

test('explicit first date followed by every week for X weeks keeps the real task title', () => {
  const parsed = parseKnownScheduleMessage('9月19日第五大节实验课，之后每周都有，持续4周', sept19);
  assert.equal(parsed.kind, 'weekly');
  assert.equal(parsed.title, '实验课');
  assert.equal(parsed.weeks, 4);
  assert.equal(buildPreview(parsed, [], sept19).suggestions.length, 4);
});

test('DDL is an exact one-minute marker and does not occupy the prior study period', () => {
  const parsed = parseKnownScheduleMessage('在9月19日23:59之前完成报告', sept19);
  assert.equal(parsed.kind, 'deadline');
  assert.equal(parsed.title, '完成报告');
  assert.equal(parsed.endAt, '2026-09-19T15:59:00.000Z');
  assert.equal(new Date(parsed.endAt) - new Date(parsed.startAt), 60000);
  assert.equal(buildPreview(parsed, [{ startAt: parsed.startAt, endAt: parsed.endAt }], sept19).suggestions.length, 1);
});

test('AI answer must contain structured JSON', () => {
  assert.deepEqual(parseAgentAnswer({ answer: '```json\n{"kind":"clarify"}\n```' }), {
    kind: 'clarify',
  });
  assert.throws(() => parseAgentAnswer({ answer: 'I think tomorrow' }), /可用的时间信息/);
});

test('multi-day plan fills free time without touching existing events', () => {
  const existing = [
    { startAt: '2026-09-18T01:00:00.000Z', endAt: '2026-09-18T02:00:00.000Z' },
    { startAt: '2026-09-18T05:00:00.000Z', endAt: '2026-09-18T06:00:00.000Z' },
  ];
  const suggestions = buildPlan(
    {
      title: '复习电磁场',
      days: 3,
      totalMinutes: 360,
      dayStart: '09:00',
      dayEnd: '18:00',
    },
    existing,
    now,
  );
  assert.equal(
    suggestions.reduce(
      (minutes, item) => minutes + (new Date(item.endAt) - new Date(item.startAt)) / 60000,
      0,
    ),
    360,
  );
  assert.ok(suggestions.every((item) => existing.every((busy) => !overlaps(item, busy))));
  assert.ok(
    suggestions.every((item, index) =>
      suggestions.slice(index + 1).every((other) => !overlaps(item, other)),
    ),
  );
  assert.ok(suggestions.every((item) => new Date(item.startAt) >= now));
});

test('plan fails honestly when available time is insufficient', () => {
  assert.throws(
    () =>
      buildPlan(
        { title: '实验', days: 1, totalMinutes: 180, dayStart: '09:00', dayEnd: '10:00' },
        [],
        now,
      ),
    /空档不足/,
  );
});

test('fixed AI event cannot silently overwrite an existing event', () => {
  const busy = [{ startAt: '2026-09-18T02:00:00.000Z', endAt: '2026-09-18T03:00:00.000Z' }];
  assert.throws(
    () =>
      buildPreview(
        {
          kind: 'event',
          title: '开会',
          startAt: '2026-09-18T02:30:00.000Z',
          endAt: '2026-09-18T03:30:00.000Z',
        },
        busy,
        now,
      ),
    /冲突/,
  );
  assert.equal(
    buildPreview(
      {
        kind: 'event',
        title: '开会',
        startAt: '2026-09-18T03:00:00.000Z',
        endAt: '2026-09-18T04:00:00.000Z',
      },
      busy,
      now,
    ).suggestions.length,
    1,
  );
});

async function startServer(t, { busy = [], answer, authenticated = true } = {}) {
  const calls = [];
  const connection = {
    async beginTransaction() {
      calls.push('begin');
    },
    async commit() {
      calls.push('commit');
    },
    async rollback() {
      calls.push('rollback');
    },
    release() {
      calls.push('release');
    },
    async execute(sql, parameters) {
      calls.push({ sql, parameters });
      if (sql.includes('FROM schedule_items')) return [busy];
      return [{ affectedRows: 1 }];
    },
  };
  const pool = {
    async execute(sql, parameters) {
      calls.push({ sql, parameters });
      return [busy];
    },
    async getConnection() {
      return connection;
    },
  };
  const app = express();
  app.use(express.json());
  app.use(
    '/api/workbench/schedule-planner',
    createSchedulePlannerRouter({
      pool,
      requireAuth: async (request, response) => {
        if (!authenticated) {
          response.status(401).json({ message: '请先登录' });
          return null;
        }
        return { id: 17, uid: 'u_test' };
      },
      buildAgentChatPayload: (user, payload) => ({ ...payload, user }),
      postAgentChat: async (payload, agentUser) => {
        calls.push({ agentPayload: payload, agentUser });
        return Response.json({ answer });
      },
    }),
  );
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => {
      resolve(instance);
    });
  });
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
      }),
  );
  return {
    base: `http://127.0.0.1:${server.address().port}/api/workbench/schedule-planner`,
    calls,
  };
}

test('planner preview requires login before reading private schedule', async (t) => {
  const { base, calls } = await startServer(t, { authenticated: false });
  const response = await fetch(`${base}/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: '明天开会' }),
  });
  assert.equal(response.status, 401);
  assert.equal(calls.length, 0);
});

test('planner preview only reads authenticated user schedule and does not write', async (t) => {
  const { base, calls } = await startServer(t, {
    answer: JSON.stringify({ kind: 'plan', title: '备课', days: 2, totalMinutes: 120 }),
  });
  const response = await fetch(`${base}/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: '接下来两天备课两小时' }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).suggestions.length > 0, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].parameters[0], 17);
  assert.doesNotMatch(calls[0].sql, /INSERT/i);
});

test('unrecognized natural language is delegated to the existing general-chat Agent contract', async (t) => {
  const { base, calls } = await startServer(t, {
    answer: JSON.stringify({
      kind: 'plan',
      title: '阅读论文',
      days: 2,
      totalMinutes: 120,
      dayStart: '09:00',
      dayEnd: '21:00',
    }),
  });
  const response = await fetch(`${base}/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: '请结合我的已有安排，替我规划一下论文阅读' }),
  });
  assert.equal(response.status, 200);
  const agentCall = calls.find((call) => call.agentPayload);
  assert.equal(agentCall.agentPayload.agent, 'general_chat');
  assert.equal(agentCall.agentPayload.source, 'workbench_schedule');
  assert.equal(agentCall.agentPayload.stream, false);
  assert.equal(agentCall.agentUser.id, 17);
  assert.match(agentCall.agentPayload.message, /第一大节 08:00–09:35/);
  assert.match(agentCall.agentPayload.message, /每周重复、持续 X 周/);
  assert.match(agentCall.agentPayload.message, /DDL/);
  assert.equal((await response.json()).suggestions.length > 0, true);
});

test('planner API uses the entered fixed-time sentence without requiring a canned AI answer', async (t) => {
  const { base } = await startServer(t, { answer: 'not valid JSON' });
  const response = await fetch(`${base}/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: '明天下午5点开会，持续时间2小时' }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.suggestions[0].title, '开会');
  assert.equal(new Date(payload.suggestions[0].endAt) - new Date(payload.suggestions[0].startAt), 2 * 3600000);
});

test('confirmation rechecks conflicts and rolls back without partial inserts', async (t) => {
  const { base, calls } = await startServer(t, {
    busy: [
      { start_at: new Date(Date.now() + 2 * 3600000), end_at: new Date(Date.now() + 4 * 3600000) },
    ],
  });
  const startAt = new Date(Date.now() + 3 * 3600000).toISOString();
  const endAt = new Date(Date.now() + 4 * 3600000).toISOString();
  const response = await fetch(`${base}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ suggestions: [{ title: '写作', startAt, endAt }] }),
  });
  assert.equal(response.status, 409);
  assert.ok(calls.includes('rollback'));
  assert.equal(
    calls.some((call) => call.sql?.includes('INSERT INTO schedule_items')),
    false,
  );
});

test('explicit confirmation writes agent-sourced events in one transaction', async (t) => {
  const { base, calls } = await startServer(t);
  const startAt = new Date(Date.now() + 3 * 3600000).toISOString();
  const endAt = new Date(Date.now() + 4 * 3600000).toISOString();
  const response = await fetch(`${base}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ suggestions: [{ title: '复习', startAt, endAt }] }),
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).created, 1);
  assert.ok(calls.includes('commit'));
  assert.match(
    calls.find((call) => call.sql?.includes('INSERT INTO schedule_items')).sql,
    /'agent'[\s\S]*'confirmed'/,
  );
});

test('confirmed DDL keeps a durable deadline marker instead of becoming a normal event', async (t) => {
  const { base, calls } = await startServer(t);
  const endAt = new Date(Date.now() + 3 * 3600000).toISOString();
  const startAt = new Date(new Date(endAt).getTime() - 60000).toISOString();
  const response = await fetch(`${base}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ suggestions: [{ kind: 'deadline', title: '完成报告', startAt, endAt }] }),
  });
  assert.equal(response.status, 201);
  assert.equal(calls.find((call) => call.sql?.includes('INSERT INTO schedule_items')).parameters[3], 'planner:deadline');
});
