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
    ['08:00', '09:35'],
    ['09:50', '12:15'],
    ['13:30', '15:05'],
    ['15:20', '16:55'],
    ['17:10', '18:45'],
    ['19:20', '21:45'],
  ]);
  const names = ['一', '二', '三', '四', '五', '六'];
  for (let index = 0; index < names.length; index += 1) {
    const parsed = parseKnownScheduleMessage(`9月20日第${names[index]}大节上课`, sept19);
    const start = new Date(parsed.startAt);
    const end = new Date(parsed.endAt);
    const [hour, minute] = expected[index][0].split(':').map(Number);
    assert.equal(
      start.toISOString(),
      new Date(Date.UTC(2026, 8, 20, hour, minute) - 8 * 3600000).toISOString(),
    );
    assert.equal(
      (end - start) / 60000,
      Number(expected[index][1].slice(0, 2)) * 60 +
        Number(expected[index][1].slice(3)) -
        (Number(expected[index][0].slice(0, 2)) * 60 + Number(expected[index][0].slice(3))),
    );
  }
});

test('weekly course section expands into exactly X future weeks and checks every conflict', () => {
  const parsed = parseKnownScheduleMessage('每周三第三大节上模拟电路，持续8周', sept19);
  const proposal = buildPreview(parsed, [], sept19);
  assert.equal(proposal.suggestions.length, 8);
  assert.equal(proposal.suggestions[0].startAt, '2026-09-23T05:30:00.000Z');
  assert.equal(proposal.suggestions[0].endAt, '2026-09-23T07:05:00.000Z');
  assert.equal(proposal.suggestions[7].description, '周常 · 第 8/8 周');
  assert.equal(
    new Date(proposal.suggestions[1].startAt) - new Date(proposal.suggestions[0].startAt),
    7 * 86400000,
  );
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
  assert.equal(
    buildPreview(parsed, [{ startAt: parsed.startAt, endAt: parsed.endAt }], sept19).suggestions
      .length,
    1,
  );
});

test('AI answer must contain structured JSON', () => {
  assert.deepEqual(parseAgentAnswer({ answer: '```json\n{"kind":"clarify"}\n```' }), {
    kind: 'clarify',
  });
  assert.throws(() => parseAgentAnswer({ answer: 'I think tomorrow' }), /可用的时间信息/);
});

test('known event, weekly, deadline and study-plan previews preserve the single optional notes field', () => {
  const notes = '六教 6A201；带电脑\n讨论 x < 5 的情形';
  for (const message of [
    '9月20日下午5点开会，持续时间2小时',
    '每周三第三大节上课，持续3周',
    '9月20日23:59之前完成报告',
    '接下来3天复习6小时',
  ]) {
    const parsed = parseKnownScheduleMessage(`${message}，地点/备注：${notes}`, sept19);
    assert.equal(parsed.description, notes);
    const preview = buildPreview(parsed, [], sept19);
    assert.ok(preview.suggestions.every((item) => item.description === notes));
  }
  const parsed = parseKnownScheduleMessage('每周三第三大节上课，持续3周', sept19);
  const preview = buildPreview({ ...parsed, description: '地'.repeat(4000) }, [], sept19);
  assert.ok(preview.suggestions.every((item) => item.description.length === 4000));
});

test('AI study plans retain provided notes and reject malformed or excessive notes', () => {
  const plan = { kind: 'plan', title: '复习', days: 3, totalMinutes: 120 };
  const description = '图书馆二层；携带习题册';
  assert.ok(
    buildPreview({ ...plan, description }, [], now).suggestions.every(
      (item) => item.description === description,
    ),
  );
  for (const invalid of [{ text: '地点' }, ['地点'], true, 42, '字'.repeat(4001)]) {
    assert.throws(() => buildPreview({ ...plan, description: invalid }, [], now), { status: 422 });
  }
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

async function startServer(
  t,
  { busy = [], answer, authenticated = true, insertFailureAt, courses = [], courseError } = {},
) {
  const calls = [];
  const courseCalls = [];
  let insertCount = 0;
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
      if (sql.includes('INSERT INTO schedule_items')) insertCount += 1;
      if (sql.includes('INSERT INTO schedule_items') && insertCount === insertFailureAt) {
        throw Object.assign(new Error('Simulated insert failure'), { code: 'ER_TEST_INSERT' });
      }
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
      listCourseSchedules: async (executor, userId, range) => {
        courseCalls.push({
          executor: executor === connection ? 'transaction' : 'pool',
          userId,
          ...range,
        });
        if (courseError) throw courseError;
        return courses;
      },
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
    courseCalls,
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

const sept24Afternoon = new Date('2026-09-24T06:00:00.000Z');
const twoMeetings =
  '我今天晚上9点要开书记会，罗姆楼5103；10点要开支书例会，罗姆楼10-206，两个会都是1小时';

test('two meetings inherit Beijing date, evening and shared duration without mixing titles or locations', () => {
  const parsed = parseKnownScheduleMessage(twoMeetings, sept24Afternoon);
  assert.deepEqual(parsed, {
    kind: 'batch',
    tasks: [
      {
        kind: 'event',
        title: '书记会',
        description: '罗姆楼5103',
        startAt: '2026-09-24T13:00:00.000Z',
        endAt: '2026-09-24T14:00:00.000Z',
      },
      {
        kind: 'event',
        title: '支书例会',
        description: '罗姆楼10-206',
        startAt: '2026-09-24T14:00:00.000Z',
        endAt: '2026-09-24T15:00:00.000Z',
      },
    ],
  });
  const preview = buildPreview(parsed, [], sept24Afternoon);
  assert.equal(preview.kind, 'batch');
  assert.equal(preview.taskCount, 2);
  assert.equal(preview.suggestions.length, 2);
});

test('three tasks preserve individual durations and explicit date or period overrides', () => {
  const parsed = parseKnownScheduleMessage(
    '今天晚上9点开会30分钟；明天上午10点讨论；下午3点读书，三个任务各1小时',
    sept24Afternoon,
  );
  assert.equal(parsed.tasks.length, 3);
  assert.deepEqual(
    parsed.tasks.map(({ startAt, endAt }) => [startAt, endAt]),
    [
      ['2026-09-24T13:00:00.000Z', '2026-09-24T13:30:00.000Z'],
      ['2026-09-25T02:00:00.000Z', '2026-09-25T03:00:00.000Z'],
      ['2026-09-25T07:00:00.000Z', '2026-09-25T08:00:00.000Z'],
    ],
  );
  const crossDate = parseKnownScheduleMessage(
    '今天晚上9点开会1小时；明天10点讨论1小时',
    sept24Afternoon,
  );
  assert.equal(crossDate.tasks[1].startAt, '2026-09-25T02:00:00.000Z');
  const inherited = parseKnownScheduleMessage(
    '今天下午3点开会，4点复习，5点读书，各1小时',
    sept24Afternoon,
  );
  assert.deepEqual(
    inherited.tasks.map((item) => item.startAt),
    ['2026-09-24T07:00:00.000Z', '2026-09-24T08:00:00.000Z', '2026-09-24T09:00:00.000Z'],
  );
});

test('each task retains its own explicit description and notes punctuation', () => {
  const parsed = parseKnownScheduleMessage(
    '明天9点开会1小时，地点/备注：主楼101；带电脑；11点读书1小时，地点/备注：图书馆；带书',
    sept24Afternoon,
  );
  assert.equal(parsed.tasks[0].description, '主楼101；带电脑');
  assert.equal(parsed.tasks[1].description, '图书馆；带书');
});

test('ambiguous multi-task requests delegate the entire sentence instead of returning the first event', () => {
  for (const message of [
    '明天9点开会1小时；10点讨论',
    '明天9点开会；10点讨论1小时',
    '明天9点开会1小时，还有写报告',
    '明天9点开会1小时还有写报告',
    '明天9点开会，写报告，各1小时',
    '明天9点开会1小时；明天写报告',
    '明天9点开会1小时；2月30日10点讨论1小时',
    '接下来3天复习6小时，写报告2小时',
    '明天9点到10点开会；11点读书1小时',
  ])
    assert.equal(parseKnownScheduleMessage(message, sept24Afternoon), null, message);
});

test('more than three independent tasks are rejected without truncating', () => {
  assert.throws(
    () =>
      parseKnownScheduleMessage(
        '明天9点开会；10点读书；11点讨论；下午2点写作，各1小时',
        sept24Afternoon,
      ),
    { status: 422 },
  );
});

test('batch extraction rejects missing, excessive, nested and incomplete tasks', () => {
  const task = parseKnownScheduleMessage('明天9点开会1小时', sept24Afternoon);
  for (const tasks of [
    undefined,
    {},
    [],
    [task, task, task, task],
    [{ kind: 'batch', tasks: [task] }],
    [task, { kind: 'clarify' }],
  ]) {
    assert.throws(() => buildPreview({ kind: 'batch', tasks }, [], sept24Afternoon), {
      status: 422,
    });
  }
  assert.throws(
    () =>
      buildPreview(
        { kind: 'batch', tasks: [task, { kind: 'event', title: '未知日期' }] },
        [],
        sept24Afternoon,
      ),
    { status: 400 },
  );
});

test('batch previews reject internal or existing conflicts and still allow adjacent events', () => {
  const parsed = parseKnownScheduleMessage(twoMeetings, sept24Afternoon);
  assert.equal(buildPreview(parsed, [], sept24Afternoon).suggestions.length, 2);
  assert.throws(
    () =>
      buildPreview(
        {
          kind: 'batch',
          tasks: [parsed.tasks[0], { ...parsed.tasks[1], startAt: '2026-09-24T13:30:00.000Z' }],
        },
        [],
        sept24Afternoon,
      ),
    { status: 409 },
  );
  assert.throws(() => buildPreview(parsed, [parsed.tasks[1]], sept24Afternoon), { status: 409 });
});

test('plans avoid all fixed events and other plans in the batch regardless of task order', () => {
  const fixed = {
    kind: 'event',
    title: '开会',
    startAt: '2026-09-18T01:00:00.000Z',
    endAt: '2026-09-18T02:00:00.000Z',
  };
  const firstPlan = {
    kind: 'plan',
    title: '阅读',
    days: 1,
    totalMinutes: 60,
    dayStart: '09:00',
    dayEnd: '13:00',
  };
  const secondPlan = { ...firstPlan, title: '写作' };
  const preview = buildPreview({ kind: 'batch', tasks: [firstPlan, fixed, secondPlan] }, [], now);
  assert.equal(preview.taskCount, 3);
  assert.deepEqual(
    preview.suggestions.map((item) => item.title),
    ['阅读', '开会', '写作'],
  );
  assert.equal(preview.suggestions[0].startAt, fixed.endAt);
  assert.ok(
    preview.suggestions.every((item, index) =>
      preview.suggestions.slice(index + 1).every((other) => !overlaps(item, other)),
    ),
  );
  assert.throws(
    () =>
      buildPreview(
        { kind: 'batch', tasks: [firstPlan, fixed, { ...secondPlan, dayEnd: '11:00' }] },
        [],
        now,
      ),
    { status: 422 },
  );
});

test('three-intent limit does not limit weekly expansion and aggregate limit remains 52 segments', () => {
  const weekly = parseKnownScheduleMessage('每周三第三大节上课，持续52周', sept19);
  assert.equal(buildPreview({ kind: 'batch', tasks: [weekly] }, [], sept19).suggestions.length, 52);
  const deadline = parseKnownScheduleMessage('明天23:59之前完成报告', sept19);
  assert.equal(
    buildPreview({ kind: 'batch', tasks: [{ ...weekly, weeks: 51 }, deadline] }, [], sept19)
      .suggestions.length,
    52,
  );
  assert.throws(() => buildPreview({ kind: 'batch', tasks: [weekly, deadline] }, [], sept19), {
    status: 422,
  });
});

test('deadline markers do not occupy batch plan availability', () => {
  const deadline = {
    kind: 'deadline',
    title: '截止',
    startAt: '2026-09-18T01:59:00.000Z',
    endAt: '2026-09-18T02:00:00.000Z',
  };
  const plan = {
    kind: 'plan',
    title: '写作',
    days: 1,
    totalMinutes: 60,
    dayStart: '09:00',
    dayEnd: '10:00',
  };
  assert.equal(
    buildPreview({ kind: 'batch', tasks: [deadline, plan] }, [], now).suggestions.length,
    2,
  );
});

test('batch preview API recognizes 2 or 3 tasks without invoking a real or canned Agent', async (t) => {
  const { base, calls } = await startServer(t, { answer: 'invalid JSON' });
  for (const [count, message] of [
    [2, twoMeetings.replace('今天', '明天')],
    [3, '明天上午9点开会；10点读书；11点讨论，各1小时'],
  ]) {
    const response = await fetch(`${base}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    assert.equal(response.status, 200);
    const preview = await response.json();
    assert.equal(preview.taskCount, count);
    assert.equal(preview.suggestions.length, count);
  }
  assert.equal(
    calls.some((call) => call.agentPayload),
    false,
  );
  const response = await fetch(`${base}/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: '明天9点开会；10点读书；11点讨论；下午2点写作，各1小时' }),
  });
  assert.equal(response.status, 422);
  assert.match((await response.json()).message, /最多.*3/);
});

test('Agent batch previews retain every task and prompt requires scoped inheritance and descriptions', async (t) => {
  const task = {
    kind: 'event',
    title: '读书',
    startAt: new Date(Date.now() + 86400000).toISOString(),
    endAt: new Date(Date.now() + 90000000).toISOString(),
    description: '图书馆',
  };
  const { base, calls } = await startServer(t, {
    answer: {
      kind: 'batch',
      tasks: [
        task,
        {
          ...task,
          title: '写作',
          startAt: task.endAt,
          endAt: new Date(Date.now() + 93600000).toISOString(),
        },
      ],
    },
  });
  const response = await fetch(`${base}/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: '替我安排读书和写作这两件事' }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).taskCount, 2);
  const prompt = calls.find((call) => call.agentPayload).agentPayload.message;
  assert.match(prompt, /"kind":"batch"/);
  assert.match(prompt, /1–3 项/);
  assert.match(prompt, /绝不能只返回第一件/);
  assert.match(prompt, /description/);
});

test('Agent cannot silently drop an incomplete task from an explicitly multi-task request', async (t) => {
  for (const answer of [
    {
      kind: 'event',
      title: '开会',
      startAt: new Date(Date.now() + 86400000).toISOString(),
      endAt: new Date(Date.now() + 90000000).toISOString(),
    },
    { kind: 'batch', tasks: [] },
    { kind: 'clarify', question: '请补充讨论的时长。' },
  ]) {
    const { base, calls } = await startServer(t, { answer });
    const response = await fetch(`${base}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '明天9点开会1小时；10点讨论' }),
    });
    assert.equal(response.status, 422);
    assert.ok(calls.some((call) => call.agentPayload));
    assert.equal(
      calls.some((call) => call.sql?.includes('INSERT')),
      false,
    );
  }
});

function futureSuggestions(count) {
  const start = Date.now() + 86400000;
  return Array.from({ length: count }, (_, index) => ({
    kind: 'event',
    title: `任务${index + 1}`,
    description: `地点${index + 1}`,
    startAt: new Date(start + index * 3600000).toISOString(),
    endAt: new Date(start + (index + 1) * 3600000).toISOString(),
  }));
}

test('confirmation saves two or three events and their descriptions in one transaction', async (t) => {
  for (const count of [2, 3]) {
    const { base, calls } = await startServer(t);
    const suggestions = futureSuggestions(count);
    const response = await fetch(`${base}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suggestions }),
    });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).created, count);
    assert.equal(calls.filter((call) => call === 'begin').length, 1);
    assert.equal(calls.filter((call) => call === 'commit').length, 1);
    assert.deepEqual(
      calls.filter((call) => call.sql?.includes('INSERT')).map((call) => call.parameters[5]),
      suggestions.map((item) => item.description),
    );
    assert.equal(calls.at(-1), 'release');
  }
});

test('confirmation rejects a batch conflict before opening a transaction', async (t) => {
  const { base, calls } = await startServer(t);
  const suggestions = futureSuggestions(2);
  suggestions[1].startAt = suggestions[0].startAt;
  const response = await fetch(`${base}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ suggestions }),
  });
  assert.equal(response.status, 409);
  assert.equal(calls.length, 0);
});

test('confirmation rechecks the final batch item against current events before any insert', async (t) => {
  const suggestions = futureSuggestions(3);
  const { base, calls } = await startServer(t, {
    busy: [{ start_at: suggestions[2].startAt, end_at: suggestions[2].endAt }],
  });
  const response = await fetch(`${base}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ suggestions }),
  });
  assert.equal(response.status, 409);
  assert.ok(calls.includes('rollback'));
  assert.equal(
    calls.some((call) => call.sql?.includes('INSERT')),
    false,
  );
});

test('an insert failure rolls back the entire batch and never commits partial success', async (t) => {
  const { base, calls } = await startServer(t, { insertFailureAt: 2 });
  const response = await fetch(`${base}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ suggestions: futureSuggestions(3) }),
  });
  assert.equal(response.status, 500);
  assert.equal(calls.filter((call) => call.sql?.includes('INSERT')).length, 2);
  assert.ok(calls.includes('rollback'));
  assert.equal(calls.includes('commit'), false);
  assert.equal(calls.at(-1), 'release');
});

test('planner preview avoids synchronized classes across its full planning horizon', async (t) => {
  const { base, courseCalls } = await startServer(t, {
    courses: [
      {
        startAt: new Date(Date.now() - 60000).toISOString(),
        endAt: new Date(Date.now() + 3 * 86400000).toISOString(),
      },
    ],
  });
  const response = await fetch(`${base}/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: '明天下午5点开会1小时' }),
  });
  assert.equal(response.status, 409);
  assert.equal(courseCalls.length, 1);
  assert.equal(courseCalls[0].executor, 'pool');
  assert.equal(courseCalls[0].userId, 17);
  assert.ok(courseCalls[0].end - courseCalls[0].start > 370 * 86400000);
});

test('planner confirmation rechecks synchronized classes inside the save transaction', async (t) => {
  const suggestions = futureSuggestions(2);
  const { base, calls, courseCalls } = await startServer(t, { courses: [suggestions[1]] });
  const response = await fetch(`${base}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ suggestions }),
  });
  assert.equal(response.status, 409);
  assert.deepEqual(courseCalls, [
    {
      executor: 'transaction',
      userId: 17,
      start: new Date(suggestions[0].startAt),
      end: new Date(suggestions[1].endAt),
    },
  ]);
  assert.ok(calls.includes('rollback'));
  assert.equal(
    calls.some((call) => call.sql?.includes('INSERT')),
    false,
  );
});

test('unavailable course occupancy fails both preview and confirmation without saving any events', async (t) => {
  const { base, calls } = await startServer(t, {
    courseError: Object.assign(new Error('Unavailable'), { code: 'ER_TEST_COURSES' }),
  });
  for (const [route, payload] of [
    ['preview', { message: '明天9点开会1小时' }],
    ['confirm', { suggestions: futureSuggestions(2) }],
  ]) {
    const response = await fetch(`${base}/${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(response.status, 500);
  }
  assert.ok(calls.includes('rollback'));
  assert.equal(
    calls.some((call) => call.sql?.includes('INSERT')),
    false,
  );
  assert.equal(calls.includes('commit'), false);
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
  assert.match(calls[0].sql, /ORDER BY start_at LIMIT 501$/);
  assert.doesNotMatch(calls[0].sql, /LIMIT\s+\?/i);
  assert.equal(calls[0].parameters.length, 3);
  assert.ok(calls[0].parameters[1] instanceof Date);
  assert.ok(calls[0].parameters[2] instanceof Date);
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
  assert.equal(
    new Date(payload.suggestions[0].endAt) - new Date(payload.suggestions[0].startAt),
    2 * 3600000,
  );
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
  const scheduleRead = calls.find((call) => call.sql?.includes('FROM schedule_items'));
  assert.match(scheduleRead.sql, /LIMIT 501$/);
  assert.doesNotMatch(scheduleRead.sql, /LIMIT\s+\?/i);
  assert.deepEqual(scheduleRead.parameters, [17, new Date(endAt), new Date(startAt)]);
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
    body: JSON.stringify({
      suggestions: [{ kind: 'deadline', title: '完成报告', startAt, endAt }],
    }),
  });
  assert.equal(response.status, 201);
  assert.equal(
    calls.find((call) => call.sql?.includes('INSERT INTO schedule_items')).parameters[3],
    'planner:deadline',
  );
});

test('confirmation saves edited notes as bound text and accepts clearing the optional field', async (t) => {
  const { base, calls } = await startServer(t);
  for (const description of ['主楼 101\n<script>window.notesXss = true</script>', '']) {
    const response = await fetch(`${base}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        suggestions: [
          {
            title: '开会',
            description,
            startAt: new Date(Date.now() + 3600000).toISOString(),
            endAt: new Date(Date.now() + 7200000).toISOString(),
          },
        ],
      }),
    });
    assert.equal(response.status, 201);
    const saved = calls.filter((call) => call.sql?.includes('INSERT INTO schedule_items')).at(-1);
    assert.equal(saved.parameters[5], description);
    assert.doesNotMatch(saved.sql, /主楼|<script>/);
  }
});

test('confirmation rejects non-text or excessive notes before starting a transaction', async (t) => {
  const { base, calls } = await startServer(t);
  for (const description of [{ value: '六教' }, [], 42, false, '字'.repeat(4001)]) {
    const response = await fetch(`${base}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        suggestions: [
          {
            title: '开会',
            description,
            startAt: new Date(Date.now() + 3600000).toISOString(),
            endAt: new Date(Date.now() + 7200000).toISOString(),
          },
        ],
      }),
    });
    assert.equal(response.status, 400);
  }
  assert.equal(calls.length, 0);
});

test('preview keeps the 500-event safety boundary and never accepts a client-supplied limit', async (t) => {
  for (const count of [500, 501]) {
    const { base, calls } = await startServer(t, {
      busy: Array.from({ length: count }, () => ({
        start_at: new Date(Date.now() + 35 * 86400000),
        end_at: new Date(Date.now() + 35 * 86400000 + 3600000),
      })),
    });
    const response = await fetch(`${base}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: '明天下午5点开会，持续时间2小时',
        limit: '1; DROP TABLE schedule_items',
      }),
    });
    assert.equal(response.status, count === 500 ? 200 : 422);
    assert.match(calls[0].sql, /LIMIT 501$/);
    assert.equal(calls[0].parameters.length, 3);
    assert.equal(
      calls.some((call) => call.agentPayload || call.sql?.includes('INSERT')),
      false,
    );
  }
});

test('confirmation rejects the 501st event atomically without changing the server query limit', async (t) => {
  for (const count of [500, 501]) {
    const start = Date.now() + 3 * 3600000;
    const { base, calls } = await startServer(t, {
      busy: Array.from({ length: count }, () => ({
        start_at: new Date(start - 3600000),
        end_at: new Date(start + 3600000),
      })),
    });
    const response = await fetch(`${base}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        suggestions: [
          {
            kind: 'deadline',
            title: '复习',
            startAt: new Date(start).toISOString(),
            endAt: new Date(start + 60000).toISOString(),
          },
        ],
        limit: 9999,
      }),
    });
    assert.equal(response.status, count === 500 ? 201 : 409);
    const scheduleRead = calls.find((call) => call.sql?.includes('FROM schedule_items'));
    assert.match(scheduleRead.sql, /LIMIT 501$/);
    assert.equal(scheduleRead.parameters.length, 3);
    assert.equal(calls.includes('commit'), count === 500);
    assert.equal(calls.includes('rollback'), count === 501);
    assert.equal(
      calls.some((call) => call.sql?.includes('INSERT INTO schedule_items')),
      count === 500,
    );
    assert.equal(calls.at(-1), 'release');
  }
});
