const test = require('node:test');
const assert = require('node:assert/strict');
const {
  conflicts,
  colorIndex,
  deadlineState,
  deadlineRemaining,
  timeBlock,
} = require('../public/workbench-calendar');

const now = Date.parse('2026-09-28T00:00:00+08:00');
const HOUR = 3600000;

test('time block edges meet exactly for adjacent events, including fractional minutes', () => {
  const a = timeBlock(13.5 * HOUR, (15 + 5 / 60) * HOUR, 6 * HOUR);
  const b = timeBlock((15 + 5 / 60) * HOUR, 16 * HOUR, 6 * HOUR);
  assert.equal(a.end, b.top);
  assert.equal(a.top + a.height, b.top);
  assert.ok(Math.abs(a.height - (95 / 60) * 48) < 0.001);
});
test('one-minute and clipped day-end blocks never extend beyond their actual endpoint', () => {
  const short = timeBlock((24 - 1 / 60) * HOUR, 24 * HOUR, 6 * HOUR);
  assert.equal(short.end, 864);
  assert.ok(Math.abs(short.height - 48 / 60) < 0.001);
});
const iso = (hour) => new Date(now + hour * HOUR).toISOString();
const event = (id, start, end, extra = {}) => ({
  publicId: id,
  title: id,
  startAt: iso(start),
  endAt: iso(end),
  status: 'confirmed',
  ...extra,
});

test('deadlines show actual remaining or overdue duration instead of urgency buckets', () => {
  assert.equal(deadlineRemaining(iso(73), false, now), '剩余：3 天 1 小时');
  assert.equal(deadlineRemaining(iso(72), false, now), '剩余：3 天');
  assert.equal(deadlineRemaining(iso(24), false, now), '剩余：1 天');
  assert.equal(deadlineRemaining(iso(12.5), false, now), '剩余：12 小时 30 分钟');
  assert.equal(deadlineRemaining(iso(0.5), false, now), '剩余：30 分钟');
  assert.equal(deadlineRemaining(iso(0.001), false, now), '剩余：不到 1 分钟');
  assert.equal(deadlineRemaining(iso(0), false, now), '已到截止时间');
  assert.equal(deadlineRemaining(iso(-0.001), false, now), '已逾期：不到 1 分钟');
  assert.equal(deadlineRemaining(iso(-2.5), false, now), '已逾期：2 小时 30 分钟');
  assert.equal(deadlineRemaining(iso(-25), false, now), '已逾期：1 天 1 小时');
  assert.equal(deadlineRemaining(iso(-1), true, now), '已完成');
  assert.equal(deadlineRemaining(null, false, now), '截止时间待确认');
  assert.equal(deadlineRemaining('bad', false, now), '截止时间待确认');
});
test('deadline colours honour exact 24/72-hour boundaries, overdue, done and unknown dates', () => {
  assert.equal(deadlineState(iso(73), false, now), 'safe');
  assert.equal(deadlineState(iso(72), false, now), 'soon');
  assert.equal(deadlineState(iso(24.001), false, now), 'soon');
  assert.equal(deadlineState(iso(24), false, now), 'critical');
  assert.equal(deadlineState(iso(0), false, now), 'critical');
  assert.equal(deadlineState(iso(-1), false, now), 'overdue');
  assert.equal(deadlineState(iso(-1), true, now), 'done');
  assert.equal(deadlineState(null, false, now), 'none');
  assert.equal(deadlineState('bad', false, now), 'none');
});
test('real overlap excludes touching ends, DDL, all-day, drafts, completed and invalid intervals', () => {
  const items = [
    event('a', 12, 14),
    event('b', 13.5, 15),
    event('c', 15, 16),
    event('draft', 12, 15, { status: 'draft' }),
    event('ddl', 12, 15, { kind: 'deadline' }),
    event('allday', 0, 24, { allDay: true }),
    event('done', 12, 15, { completed: true }),
    event('bad', 15, 12),
  ];
  const before = structuredClone(items);
  const pairs = conflicts(items);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].start, Date.parse(iso(13.5)));
  assert.equal(pairs[0].end, Date.parse(iso(14)));
  assert.deepEqual(items, before);
});
test('nested, simultaneous and midnight overlaps are complete, clipped to the requested week and deduplicated by identity', () => {
  const pairs = conflicts(
    [event('a', -2, 3), event('b', 1, 2), event('c', 1, 2)],
    now,
    now + HOUR * 2,
  );
  assert.equal(pairs.length, 3);
  assert.ok(pairs.every((pair) => pair.start === now + HOUR && pair.end === now + 2 * HOUR));
  assert.equal(conflicts([event('a', 1, 3), event('a', 1, 3)]).length, 0);
  assert.equal(
    conflicts([event('a', 1, 3), event('b', 2, 4)], now + 4 * HOUR, now + 5 * HOUR).length,
    0,
  );
});
test('recurrences and courses keep their colour across weeks, item IDs, order, notes and edits', () => {
  const first = event('one', 10, 11, { title: '组会', seriesKey: 'manual:recurring:abc' });
  assert.equal(
    colorIndex(first),
    colorIndex({ ...first, publicId: 'two', title: '更正名称', startAt: iso(178) }),
  );
  const course = {
    courseReference: 'learn:abc',
    semesterId: '2026-fall',
    title: '课程',
    description: '第 1 周',
  };
  assert.equal(
    colorIndex(course),
    colorIndex({ ...course, description: '第 2 周', publicId: 'cs_new' }),
  );
  assert.equal(colorIndex({ title: '  组会 ' }), colorIndex({ title: '组会', startAt: iso(178) }));
  assert.ok(
    Array.from({ length: 20 }, (_, i) => colorIndex({ title: `事件 ${i}` })).every(
      (value) => value >= 0 && value < 6,
    ),
  );
});
