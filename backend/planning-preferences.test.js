const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const {
  normalizePreferences,
  availableWindows,
  readPreferences,
  savePreferences,
} = require('./planning-preferences');
const {
  buildPreview,
  createSchedulePlannerRouter,
  overlaps,
} = require('./workbench-schedule-planner');
const { selectTip, messages } = require('../public/workbench-companion');

const now = new Date('2026-09-29T00:00:00Z');
const iso = (clock, day = '2026-09-29') => new Date(`${day}T${clock}:00+08:00`).toISOString();
const prefs = (extra = {}) => normalizePreferences({ ...extra });

test('preferences validate, own nested arrays, allow 24:00, and reject malformed times/limits', () => {
  const a = prefs();
  a.weekdays.pop();
  a.restWindows[0].start = '01:00';
  assert.equal(prefs().weekdays.length, 7);
  assert.equal(prefs().restWindows[0].start, '12:00');
  assert.equal(prefs({ dayEnd: '24:00' }).dayEnd, '24:00');
  for (const patch of [
    { weekdays: [] },
    { weekdays: [0] },
    { weekdays: ['1'] },
    { dayStart: '09:99' },
    { dayEnd: '08:00' },
    { enabled: 'true' },
    { focusMinutes: 0 },
    { dailyMaxMinutes: 29 },
    { dailyMaxMinutes: 481 },
    { restWindows: [{ start: '13:00', end: '12:00' }] },
    { restWindows: Array(5).fill({ start: '12:00', end: '13:00' }) },
    { userId: 2 },
  ])
    assert.throws(() => prefs(patch), { status: 400 });
});

test('gaps avoid courses, manual events, meals, buffers, past time, and disabled weekdays, not deadline markers', () => {
  const busy = [
    { startAt: iso('09:00'), endAt: iso('10:00'), kind: 'course' },
    { startAt: iso('10:30'), endAt: iso('11:00'), kind: 'event' },
    { startAt: iso('13:59'), endAt: iso('14:00'), kind: 'deadline' },
  ];
  const result = availableWindows(busy, now, 2, prefs({ weekdays: [2], dayEnd: '15:00' }));
  assert.deepEqual(
    result.map((gap) => [gap.startAt, gap.endAt]),
    [
      [iso('11:15'), iso('12:00')],
      [iso('13:00'), iso('15:00')],
    ],
  );
  assert.deepEqual(availableWindows(busy, new Date(iso('22:00')), 1, prefs()), []);
});

test('plans use focus length, rest, daily cap and never mutate fixed events', () => {
  const existing = [{ startAt: iso('09:00'), endAt: iso('10:00'), kind: 'course' }];
  const original = JSON.stringify(existing);
  const extraction = {
    kind: 'plan',
    title: '复习',
    days: 2,
    totalMinutes: 180,
    description: '读笔记',
  };
  const { suggestions } = buildPreview(extraction, existing, now, prefs());
  assert.deepEqual(
    suggestions.map((item) => item.startAt),
    [iso('10:15'), iso('11:30'), iso('13:00'), iso('09:00', '2026-09-30')],
  );
  assert.ok(
    suggestions.every(
      (item) =>
        item.description === '读笔记' &&
        Date.parse(item.endAt) - Date.parse(item.startAt) <= 3600000,
    ),
  );
  assert.equal(JSON.stringify(existing), original);
  assert.throws(
    () => buildPreview({ ...extraction, days: 1 }, existing, now, prefs()),
    /还差 60 分钟/,
  );
  assert.doesNotThrow(() =>
    buildPreview({ ...extraction, days: 1 }, existing, now, prefs({ enabled: false })),
  );
  assert.doesNotThrow(() =>
    buildPreview(
      { kind: 'event', title: '手动指定', startAt: iso('22:00'), endAt: iso('23:00') },
      [],
      now,
      prefs(),
    ),
  );
});

test('batch plans share daily budget and buffers; confirmed planner blocks count on subsequent requests', () => {
  const plan = { kind: 'plan', title: '阅读', days: 1, totalMinutes: 90 };
  assert.throws(
    () =>
      buildPreview({ kind: 'batch', tasks: [plan, { ...plan, title: '写作' }] }, [], now, prefs()),
    /还差 60 分钟/,
  );
  const first = buildPreview(plan, [], now, prefs()).suggestions;
  const existing = first.map((item) => ({ ...item, planned: undefined, sourceType: 'agent' }));
  assert.throws(
    () => buildPreview({ ...plan, totalMinutes: 45 }, existing, now, prefs()),
    /还差 15 分钟/,
  );
  const second = buildPreview({ ...plan, totalMinutes: 30 }, existing, now, prefs()).suggestions;
  assert.ok(second.every((item) => !existing.some((other) => overlaps(item, other))));
});

test('saved preference records are isolated by authenticated local user', async () => {
  const records = new Map();
  const pool = {
    async execute(sql, args) {
      if (sql.startsWith('SELECT'))
        return [[...(records.has(args[0]) ? [{ preferences_json: records.get(args[0]) }] : [])]];
      records.set(args[0], args[1]);
      return [{ affectedRows: 1 }];
    },
  };
  await savePreferences(pool, 1, prefs({ focusMinutes: 30 }));
  assert.equal((await readPreferences(pool, 1)).preferences.focusMinutes, 30);
  assert.equal((await readPreferences(pool, 2)).preferences.focusMinutes, 60);
  assert.equal((await readPreferences(pool, 2)).saved, false);
});

test('preference and gap HTTP routes authenticate, validate before writes, and never create schedules', async (t) => {
  const calls = [];
  const app = express();
  app.use(express.json());
  app.use(
    createSchedulePlannerRouter({
      pool: {
        async execute(sql, args) {
          calls.push({ sql, args });
          return sql.startsWith('INSERT') ? [{ affectedRows: 1 }] : [[]];
        },
      },
      requireAuth: async (req, res) => {
        if (req.headers.authorization === 'test') return { id: 19 };
        res.status(401).json({ message: '登录' });
        return null;
      },
      listCourseSchedules: async () => [],
      postAgentChat() {
        assert.fail('No AI service needed');
      },
    }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => {
    server.once('listening', resolve);
  });
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
      }),
  );
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const endpoint of ['/preferences', '/availability?days=7'])
    assert.equal((await fetch(`${base}${endpoint}`)).status, 401);
  assert.equal(calls.length, 0);
  const headers = { Authorization: 'test', 'Content-Type': 'application/json' };
  assert.equal(
    (
      await fetch(`${base}/preferences`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ weekdays: [] }),
      })
    ).status,
    400,
  );
  assert.equal(calls.length, 0);
  assert.equal(
    (await fetch(`${base}/preferences`, { method: 'PUT', headers, body: JSON.stringify(prefs()) }))
      .status,
    200,
  );
  assert.equal((await fetch(`${base}/availability?days=7`, { headers })).status, 200);
  assert.equal((await fetch(`${base}/availability?days=1000`, { headers })).status, 400);
  assert.ok(calls.every((call) => call.args[0] === 19));
  assert.ok(calls.every((call) => !/INSERT INTO schedule_items/.test(call.sql)));
});

test('Max encouragement covers real circumstances without inventing mood or completion', () => {
  const event = (a, b) => ({ startAt: iso(a), endAt: iso(b) });
  assert.equal(selectTip([], now, 0, false).kind, 'welcome');
  assert.equal(selectTip([], now).kind, 'free');
  assert.equal(selectTip([], new Date(iso('23:00'))).kind, 'late');
  assert.equal(selectTip([event('09:00', '10:00'), event('09:30', '11:00')], now).kind, 'conflict');
  assert.equal(selectTip([event('09:00', '11:00')], now).kind, 'continuous');
  assert.equal(selectTip([event('09:00', '12:00'), event('14:00', '18:00')], now).kind, 'busy');
  assert.equal(selectTip([{ ...event('14:59', '15:00'), kind: 'deadline' }], now).kind, 'deadline');
  assert.equal(
    selectTip([{ ...event('14:59', '15:00'), kind: 'deadline', status: 'completed' }], now).kind,
    'free',
  );
  assert.equal(
    selectTip([event('09:00', '10:00'), event('10:00', '11:00')], now).kind,
    'continuous',
  );
  assert.ok(Object.values(messages).every((items) => items.length >= 2));
  assert.notEqual(selectTip([], now, 0).text, selectTip([], now, 1).text);
});
