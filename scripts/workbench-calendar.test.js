const test = require('node:test');
const assert = require('node:assert/strict');
const {
  conflicts,
  colorIndex,
  deadlineState,
  deadlineRemaining,
  timeBlock,
  displayTimeBlock,
  overviewHourHeight,
  shortEventGroups,
} = require('../public/workbench-calendar');

const now = Date.parse('2026-09-28T00:00:00+08:00');
const HOUR = 3600000;

test('overview fits applied hours with a midnight display allowance and respects readability bounds', () => {
  for (const height of [550, 650, 800, 1000]) {
    const hourHeight = overviewHourHeight(height, 70);
    assert.ok(hourHeight >= 16 && hourHeight <= 48);
    assert.ok(16 * hourHeight + 70 + 24 + 2 <= height);
  }
  assert.equal(overviewHourHeight(2000, 70), 48);
  assert.equal(overviewHourHeight(300, 70), 16);
  assert.ok(overviewHourHeight(800, 90) < overviewHourHeight(800, 40));
});

test('short display collisions aggregate without inventing real time conflicts or changing intervals', () => {
  const entry = (id, start, end) => ({
    id,
    startMs: start * HOUR,
    endMs: end * HOUR,
    ...displayTimeBlock(start * HOUR, end * HOUR, 0),
  });
  const short = entry('a', 17 + 20 / 60, 17 + 25 / 60);
  const touching = entry('b', 17 + 25 / 60, 17 + 35 / 60);
  const before = structuredClone([short, touching]);
  const groups = shortEventGroups([short, touching]);
  assert.deepEqual(
    groups[0].members.map((item) => item.id),
    ['a', 'b'],
  );
  assert.deepEqual([short, touching], before);
  assert.equal(shortEventGroups([entry('a', 17, 17.1), entry('b', 17.5, 17.6)]).length, 0);
  assert.equal(shortEventGroups([entry('a', 17, 19), entry('b', 18, 20)]).length, 0);
  const long = entry('c', 17.6, 18.8);
  assert.deepEqual(
    shortEventGroups([long, touching, short])[0].members.map((item) => item.id),
    ['a', 'b', 'c'],
  );
  assert.equal(shortEventGroups([short])[0], undefined);
  assert.equal(shortEventGroups([short, touching, entry('d', 17.8, 17.9)]).length, 1);
  assert.ok(overviewHourHeight(700, 70, 18) < overviewHourHeight(700, 70, 16));
});

test('short event display has a half-hour floor without extending its real interval', () => {
  const block = displayTimeBlock(17 * HOUR, 17 * HOUR + 5 * 60000, 6 * HOUR);
  assert.equal(block.top, 11 * 48);
  assert.equal(block.height, 24);
  assert.equal(block.expanded, true);
  assert.equal(displayTimeBlock(0, HOUR / 2, 0).expanded, false);
  assert.equal(displayTimeBlock(0, HOUR, 0).height, 48);
  assert.equal(displayTimeBlock(0, HOUR / 12, 0, 60).height, 30);
  assert.equal(
    conflicts([event('short', 17, 17 + 5 / 60), event('next', 17 + 5 / 60, 18)]).length,
    0,
  );
});

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
