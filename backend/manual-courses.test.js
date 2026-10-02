const assert = require('node:assert/strict');
const test = require('node:test');
const { expandManualCourse, saveManualCourse } = require('./manual-courses');

const sample = {
  title: '旁听 · 最优化',
  description: '六教6C300',
  startAt: '2026-09-29T08:00:00+08:00',
  endAt: '2026-09-29T09:35:00+08:00',
  count: 16,
  intervalWeeks: 1,
};

test('manual courses expand exact weekly/alternate dates without a campus account', () => {
  const items = expandManualCourse(sample);
  assert.equal(items.length, 16);
  assert.equal(items[0].startAt, '2026-09-29T00:00:00.000Z');
  assert.equal(items[15].startAt, '2027-01-12T00:00:00.000Z');
  assert.equal(items[0].description, sample.description);
  assert.equal(items[0].kind, 'course');
  assert.deepEqual(expandManualCourse(sample), items);
  assert.equal(
    expandManualCourse({ ...sample, intervalWeeks: 2 })[1].startAt,
    '2026-10-13T00:00:00.000Z',
  );
});

test('unified repeat rules preserve legacy course identities and ordinary event kind', async () => {
  const body = { ...sample, recurrence: { unit: 'week', interval: 1, count: 16 } };
  assert.deepEqual(expandManualCourse(body), expandManualCourse(sample));
  const events = expandManualCourse(body, { kind: 'event' });
  assert.equal(events.length, 16);
  assert.equal(events[0].kind, 'event');
  assert.match(events[0].sourceReference, /^manual:recurring:/);
  const db = database({ failAt: 2 });
  await assert.rejects(saveManualCourse(db.pool, 17, body, { kind: 'event' }), /unavailable/);
  assert.ok(db.calls.includes('rollback'));
  assert.ok(!db.calls.includes('commit'));
});

test('malformed or cross-midnight courses fail before opening a transaction', async () => {
  for (const overrides of [
    { title: '' },
    { count: 0 },
    { count: 33 },
    { count: 1.5 },
    { intervalWeeks: 3 },
    { startAt: '' },
    { endAt: sample.startAt },
    { endAt: '2026-09-30T01:00:00+08:00' },
    { description: {} },
  ]) {
    await assert.rejects(
      saveManualCourse(
        {
          getConnection() {
            assert.fail('must not connect');
          },
        },
        1,
        { ...sample, ...overrides },
      ),
      { status: 400 },
    );
  }
});

function database({ duplicate = false, failAt = 0, busy = [] } = {}) {
  const calls = [];
  let inserts = 0;
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
    async execute(sql, params) {
      calls.push({ sql, params });
      assert.equal(
        sql.includes('INSERT INTO schedule_items') ? params[1] : params[0],
        17,
        'all reads/writes are owner scoped',
      );
      if (sql.startsWith('SELECT public_id')) return [duplicate ? [{ public_id: 'existing' }] : []];
      if (sql.startsWith('SELECT title')) return [busy];
      if (sql.includes('INSERT INTO schedule_items')) {
        inserts += 1;
        if (inserts === failAt) throw new Error('storage unavailable');
      }
      return [[]];
    },
  };
  return {
    pool: {
      async getConnection() {
        return connection;
      },
    },
    calls,
  };
}

test('manual course creation commits all rows and rejects duplicate submissions', async () => {
  const db = database();
  assert.deepEqual(await saveManualCourse(db.pool, 17, sample), { created: 16 });
  assert.equal(
    db.calls.filter((call) => call.sql?.includes('INSERT INTO schedule_items')).length,
    16,
  );
  const definition = db.calls.find((call) => call.sql?.includes('INSERT INTO schedule_series'));
  assert.deepEqual(JSON.parse(definition.params[2]).recurrence, {
    unit: 'week',
    interval: 1,
    count: 16,
  });
  assert.equal(JSON.parse(definition.params[2]).occurrences.length, 16);
  assert.equal(db.calls.at(-2), 'commit');
  assert.equal(db.calls.at(-1), 'release');
  const duplicate = database({ duplicate: true });
  await assert.rejects(saveManualCourse(duplicate.pool, 17, sample), { status: 409 });
  assert.ok(!duplicate.calls.includes('commit'));
});

test('all repeats are checked for conflicts and an insert failure rolls back the entire series', async () => {
  const busy = [{ start_at: '2026-10-13T00:00:00Z', end_at: '2026-10-13T02:00:00Z' }];
  const conflict = database({ busy });
  await assert.rejects(saveManualCourse(conflict.pool, 17, sample), {
    status: 409,
    code: 'course_conflict',
  });
  assert.equal(conflict.calls.filter((call) => call.sql?.includes('INSERT')).length, 0);
  const acknowledged = database({ busy });
  assert.equal(
    (await saveManualCourse(acknowledged.pool, 17, { ...sample, allowConflicts: true })).created,
    16,
  );
  const failed = database({ failAt: 2 });
  await assert.rejects(saveManualCourse(failed.pool, 17, sample), /unavailable/);
  assert.ok(failed.calls.includes('rollback'));
  assert.ok(!failed.calls.includes('commit'));
  assert.equal(failed.calls.at(-1), 'release');
});
