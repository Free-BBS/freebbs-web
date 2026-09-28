const test = require('node:test');
const assert = require('node:assert/strict');
const { expand } = require('../public/schedule-recurrence');

const first = { startAt: '2026-09-28T10:00:00+08:00', endAt: '2026-09-28T11:00:00+08:00' };

test('weekly, biweekly and custom repeats use inclusive Beijing end dates without UTC day drift', () => {
  const dates = (interval, unit = 'week', until = '2026-10-26') =>
    expand({ ...first, recurrence: { interval, unit, until } });
  assert.equal(dates(1).length, 5);
  assert.equal(dates(2).length, 3);
  assert.equal(dates(3, 'day', '2026-10-07').length, 4);
  assert.equal(dates(1, 'week', '2026-09-28').length, 1);
  assert.equal(dates(1, 'week', '2026-10-25').length, 4);
  assert.equal(dates(2).at(-1).startAt, '2026-10-26T02:00:00.000Z');
  const midnight = { startAt: '2026-09-28T00:00:00+08:00', endAt: '2026-09-29T00:00:00+08:00' };
  assert.equal(
    expand({ ...midnight, recurrence: { unit: 'day', interval: 1, until: '2026-09-30' } }).length,
    3,
  );
});

test('invalid, ambiguous and unbounded repeats are rejected before any write', () => {
  for (const recurrence of [
    null,
    {},
    { unit: 'month', interval: 1, count: 2 },
    { unit: 'day', interval: 0, count: 2 },
    { unit: 'week', interval: '2', count: 2 },
    { unit: 'day', interval: 1, count: 201 },
    { unit: 'week', interval: 52, count: 4 },
    { unit: 'day', interval: 1, count: 2, until: '2026-10-01' },
    { unit: 'week', interval: 1, until: '2026-09-27' },
    { unit: 'week', interval: 1, until: '2027-02-30' },
    { unit: 'week', interval: 1, until: '2027-2-03' },
    { unit: 'week', interval: 1, until: '2030-01-01' },
  ]) {
    assert.throws(() => expand({ ...first, recurrence }), { status: 400 });
  }
});
