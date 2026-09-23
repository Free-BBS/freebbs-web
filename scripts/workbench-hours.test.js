const assert = require('node:assert/strict');
const test = require('node:test');
const {
  DEFAULT_HOURS,
  normalizeHours,
  readHours,
  saveHours,
  storageKey,
  layoutDay,
} = require('../public/workbench-hours');

test('display hours accept integer hours only and strictly increasing same-day ranges', () => {
  assert.deepEqual(DEFAULT_HOURS, { start: 6, end: 24 });
  assert.deepEqual(normalizeHours({ start: '0', end: '24' }), { start: 0, end: 24 });
  assert.deepEqual(normalizeHours({ start: 23, end: 24 }), { start: 23, end: 24 });
  for (const value of [
    null,
    {},
    { start: 11, end: 10 },
    { start: 10, end: 10 },
    { start: -1, end: 24 },
    { start: 24, end: 25 },
    { start: 6.5, end: 24 },
    { start: '', end: 24 },
    { start: null, end: 24 },
    { start: true, end: 24 },
    { start: '6:00', end: 24 },
  ]) {
    assert.equal(normalizeHours(value), null, JSON.stringify(value));
  }
});

test('browser preferences are isolated by uid and recover from missing, invalid, or blocked storage', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
  };
  assert.equal(saveHours(storage, 'a', { start: 9, end: 20 }), true);
  assert.deepEqual(readHours(storage, 'a'), { start: 9, end: 20 });
  assert.deepEqual(readHours(storage, 'b'), DEFAULT_HOURS);
  assert.deepEqual(readHours(storage, null), DEFAULT_HOURS);
  assert.equal(saveHours(storage, null, { start: 0, end: 24 }), false);
  assert.equal(saveHours(storage, 'a', { start: 11, end: 10 }), false);
  assert.deepEqual(readHours(storage, 'a'), { start: 9, end: 20 });
  assert.notEqual(storageKey('a:b'), storageKey('a%3Ab'));
  values.set(storageKey('b'), '{invalid json');
  assert.deepEqual(readHours(storage, 'b'), DEFAULT_HOURS);
  values.set(storageKey('b'), JSON.stringify({ start: 11, end: 10 }));
  assert.deepEqual(readHours(storage, 'b'), DEFAULT_HOURS);
  const denied = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('denied');
    },
  };
  assert.deepEqual(readHours(denied, 'a'), DEFAULT_HOURS);
  assert.equal(saveHours(denied, 'a', DEFAULT_HOURS), false);
});

const dayStart = Date.parse('2026-09-21T00:00:00+08:00');
const hourMs = 3600000;
const event = (id, start, end, fields = {}) => ({
  publicId: id,
  startAt: new Date(dayStart + start * hourMs).toISOString(),
  endAt: new Date(dayStart + end * hourMs).toISOString(),
  ...fields,
});

test('display clipping keeps boundaries, midnight splits, all-day and DDL without modifying events', () => {
  const items = [
    event('early', 2, 6),
    event('partial', 5, 7),
    event('late', 22, 23),
    event('overnight', 23, 31),
    event('all-day', 0, 24, { allDay: true }),
    event('deadline', 2, 3, { kind: 'deadline' }),
  ];
  const before = JSON.stringify(items);
  const day = layoutDay(items, dayStart, DEFAULT_HOURS);
  assert.deepEqual(
    day.outside.map((item) => item.publicId),
    ['early'],
  );
  assert.equal(
    day.entries.find(({ item }) => item.publicId === 'partial').start,
    dayStart + 6 * hourMs,
  );
  assert.equal(day.entries.find(({ item }) => item.publicId === 'partial').clipped, true);
  assert.equal(
    day.entries.find(({ item }) => item.publicId === 'overnight').end,
    dayStart + 24 * hourMs,
  );
  assert.ok(day.entries.some(({ item }) => item.publicId === 'all-day'));
  assert.ok(day.entries.some(({ item }) => item.publicId === 'deadline'));
  const next = layoutDay(items, dayStart + 24 * hourMs, DEFAULT_HOURS);
  assert.equal(next.entries.length, 1);
  assert.equal(next.entries[0].start, dayStart + 30 * hourMs);
  assert.equal(next.entries[0].end, dayStart + 31 * hourMs);
  assert.equal(next.entries[0].clipped, true);
  assert.equal(JSON.stringify(items), before);
  const narrow = layoutDay(items, dayStart, { start: 8, end: 20 });
  assert.deepEqual(narrow.entries.map(({ item }) => item.publicId).sort(), ['all-day', 'deadline']);
  assert.equal(narrow.outside.length, 4);
});
