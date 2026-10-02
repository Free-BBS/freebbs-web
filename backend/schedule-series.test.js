const test = require('node:test');
const assert = require('node:assert/strict');
const {
  planMutation,
  summarizeSeries,
  definitionFor,
  importedSeriesKey,
} = require('./schedule-series');

function state() {
  const items = ['2026-09-22', '2026-09-29', '2026-10-06', '2026-10-13'].map((date, index) => ({
    publicId: `ws_${index}`,
    title: '课程',
    description: '',
    allDay: false,
    kind: 'course',
    version: 1,
    startAt: `${date}T01:00:00.000Z`,
    endAt: `${date}T02:00:00.000Z`,
    originalStartAt: `${date}T01:00:00.000Z`,
    originalEndAt: `${date}T02:00:00.000Z`,
  }));
  return {
    key: 'manual:course:abcdef',
    imported: false,
    items,
    selected: items[1],
    definition: definitionFor(items, { unit: 'week', interval: 1, count: 4 }),
    version: 3,
    fingerprint: 'latest',
  };
}
const request = (overrides) => ({
  version: 3,
  fingerprint: 'latest',
  scope: 'following',
  operation: 'update',
  recurrenceMode: 'keep',
  patch: { title: '修改课程' },
  ...overrides,
});

test('saved rules display remaining count; legacy and imported dates are explicit without inferred frequency', () => {
  const sample = state();
  assert.deepEqual(summarizeSeries(sample).recurrence, { unit: 'week', interval: 1, count: 3 });
  sample.definition.recurrence = null;
  assert.equal(summarizeSeries(sample).recurrence, null);
  assert.match(summarizeSeries(sample).description, /旧安排/);
  sample.imported = true;
  assert.match(summarizeSeries(sample).description, /实际教学日期/);
  assert.equal(summarizeSeries(sample).occurrences.length, 4);
});

test('following changes preserve earlier dates and both moved and deleted individual exceptions', () => {
  const sample = state();
  sample.items[2].exception = true;
  sample.items[2].startAt = '2026-10-08T03:00:00.000Z';
  sample.items[2].endAt = '2026-10-08T04:00:00.000Z';
  sample.items[3].exception = true;
  sample.items[3].deleted = true;
  const change = planMutation(sample, request());
  assert.deepEqual(
    change.affected.map((item) => item.publicId),
    ['ws_1'],
  );
  assert.equal(change.patches[0].title, '修改课程');
  assert.deepEqual(
    planMutation(sample, request({ operation: 'delete' })).affected.map((item) => item.publicId),
    ['ws_1'],
  );
  const single = planMutation(sample, request({ scope: 'single' }));
  assert.equal(single.affected.length, 1);
});

test('new biweekly rules are bounded and never regenerate deleted single occurrences', () => {
  const sample = state();
  sample.items[3].exception = true;
  sample.items[3].deleted = true;
  const change = planMutation(
    sample,
    request({
      recurrenceMode: 'replace',
      recurrence: { unit: 'week', interval: 2, until: '2026-11-01' },
    }),
  );
  assert.deepEqual(
    change.generated.map((item) => item.startAt.slice(0, 10)),
    ['2026-09-29', '2026-10-27'],
  );
  assert.equal(change.remove, true);
  assert.throws(
    () =>
      planMutation(
        sample,
        request({
          recurrenceMode: 'replace',
          recurrence: { unit: 'week', interval: 1, count: 201 },
        }),
      ),
    { status: 400 },
  );
  assert.throws(
    () => planMutation(sample, request({ patch: { endAt: '2026-09-30T00:30:00+08:00' } })),
    { status: 400 },
  );
});

test('Beijing midnight exception dates and inclusive end dates remain stable', () => {
  const sample = state();
  for (const item of sample.items) {
    item.startAt = item.startAt.replace('01:00', '16:10');
    item.originalStartAt = item.startAt;
    item.endAt = item.endAt.replace('02:00', '16:30');
    item.originalEndAt = item.endAt;
  }
  sample.items[2].exception = true;
  sample.items[2].deleted = true;
  const change = planMutation(
    sample,
    request({
      recurrenceMode: 'replace',
      recurrence: { unit: 'week', interval: 1, until: '2026-10-07' },
    }),
  );
  assert.equal(change.generated.length, 1);
  assert.equal(change.generated[0].startAt, '2026-09-29T16:10:00.000Z');
});

test('cross-day series moves preserve deleted and individually moved slots through repeated replacement', () => {
  const sample = state();
  sample.selected = sample.items[0];
  const shift = planMutation(
    sample,
    request({
      patch: {
        startAt: '2026-09-23T01:00:00.000Z',
        endAt: '2026-09-23T02:00:00.000Z',
      },
    }),
  );
  shift.affected.forEach((item, index) => Object.assign(item, shift.patches[index]));
  sample.selected = sample.items[1];
  const deleted = planMutation(sample, request({ scope: 'single', operation: 'delete' }));
  Object.assign(deleted.affected[0], { deleted: true, exception: true });
  sample.selected = sample.items[2];
  const personal = planMutation(
    sample,
    request({
      scope: 'single',
      patch: {
        startAt: '2026-10-09T03:00:00.000Z',
        endAt: '2026-10-09T04:00:00.000Z',
      },
    }),
  );
  Object.assign(personal.affected[0], personal.patches[0], { exception: true });
  sample.selected = sample.items[0];
  const replace = request({
    recurrenceMode: 'replace',
    recurrence: { unit: 'week', interval: 1, count: 4 },
  });
  const first = planMutation(sample, replace);
  assert.deepEqual(
    first.generated.map((item) => item.startAt),
    ['2026-09-23T01:00:00.000Z', '2026-10-14T01:00:00.000Z'],
  );
  assert.deepEqual(
    first.exceptions.map((item) => item.originalStartAt),
    ['2026-09-30T01:00:00.000Z', '2026-10-07T01:00:00.000Z'],
  );
  assert.equal(sample.items[2].startAt, '2026-10-09T03:00:00.000Z');
  assert.ok(
    !first.affected.includes(sample.items[2]),
    'personal time is retained, not overwritten',
  );
  const child = {
    ...sample,
    items: first.generated.map((item, index) => ({
      ...item,
      publicId: `child_${index}`,
      kind: 'course',
      originalStartAt: item.startAt,
      originalEndAt: item.endAt,
    })),
  };
  child.selected = child.items[0];
  child.definition = {
    ...definitionFor(child.items, replace.recurrence),
    externalExceptions: first.exceptions,
  };
  assert.deepEqual(
    planMutation(child, replace).generated.map((item) => item.startAt),
    first.generated.map((item) => item.startAt),
    'saved child exceptions stay in the new coordinate system',
  );
  const next = planMutation(child, {
    ...replace,
    patch: {
      startAt: '2026-09-24T01:00:00.000Z',
      endAt: '2026-09-24T02:00:00.000Z',
    },
  });
  assert.deepEqual(
    next.generated.map((item) => item.startAt),
    ['2026-09-24T01:00:00.000Z', '2026-10-15T01:00:00.000Z'],
  );
});

test('exception slot projection uses exact milliseconds across Beijing midnight', () => {
  const sample = state();
  for (const item of sample.items) {
    item.startAt = item.startAt.replace('01:00', '16:10');
    item.originalStartAt = item.startAt;
    item.endAt = item.endAt.replace('02:00', '16:30');
    item.originalEndAt = item.endAt;
  }
  sample.items[2].exception = true;
  sample.items[2].deleted = true;
  const change = planMutation(
    sample,
    request({
      recurrenceMode: 'replace',
      recurrence: { unit: 'week', interval: 1, until: '2026-10-06' },
      patch: {
        startAt: '2026-09-29T15:50:00.000Z',
        endAt: '2026-09-29T15:55:00.000Z',
      },
    }),
  );
  assert.equal(change.generated.length, 1);
  assert.equal(change.exceptions[0].originalStartAt, '2026-10-06T15:50:00.000Z');
});

test('series forms reject stale versions, source fingerprints and malformed field changes', () => {
  const sample = state();
  for (const overrides of [{ version: 2 }, { fingerprint: 'old' }])
    assert.throws(() => planMutation(sample, request(overrides)), { status: 409 });
  for (const overrides of [
    { scope: 'all' },
    { patch: { userId: 2 } },
    { patch: { startAt: '2026-09-29' } },
    { patch: { allDay: true } },
    { recurrenceMode: 'guess' },
  ])
    assert.throws(() => planMutation(sample, request(overrides)), { status: 400 });
});

test('imported slots group by original course/semester/day/sections and never by a guessed teaching frequency', () => {
  const item = {
    semesterId: '2026-autumn',
    courseReference: 'course:1',
    startAt: '2026-09-22T01:00:00Z',
    endAt: '2026-09-22T02:00:00Z',
    sectionStart: 2,
    sectionEnd: 2,
  };
  const key = importedSeriesKey(item);
  assert.equal(
    key,
    importedSeriesKey({ ...item, startAt: '2026-10-13T01:00:00Z', endAt: '2026-10-13T02:00:00Z' }),
  );
  assert.notEqual(key, importedSeriesKey({ ...item, courseReference: 'course:2' }));
  assert.notEqual(key, importedSeriesKey({ ...item, startAt: '2026-09-23T01:00:00Z' }));
});
