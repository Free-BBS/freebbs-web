const assert = require('node:assert/strict');
const test = require('node:test');
const { listHomeworkDeadlines, setHomeworkCompletion } = require('./homework-schedule');

const range = { start: new Date('2026-09-20T16:00:00Z'), end: new Date('2026-09-27T16:00:00Z') };
const item = {
  sourceReference: 'learn:homework:one',
  title: '作业',
  dueAt: range.start.toISOString(),
  status: 'unsubmitted',
};
function fixture() {
  const state = new Map();
  let snapshots = [
    {
      homework_json: [item, { ...item, sourceReference: 'unknown', deadlineUnverified: true }],
      fetched_at: range.start,
    },
  ];
  return {
    state,
    setSnapshots(value) {
      snapshots = value;
    },
    async execute(sql, params) {
      assert.equal(params[0], 7);
      if (sql.includes('FROM campus_homework_snapshots')) {
        assert.match(sql, /c.generation = s.connector_generation/);
        return [snapshots];
      }
      if (sql.startsWith('SELECT homework_reference'))
        return [
          [...state].map(([reference, completed]) => ({
            homework_reference: reference,
            completed,
          })),
        ];
      if (sql.includes('INSERT INTO campus_homework_calendar_states')) {
        state.set(params[1], params[2]);
        return [{ affectedRows: 1 }];
      }
      throw new Error(sql);
    },
  };
}
test('homework deadlines use exact range boundaries, deduplicate and omit uncertain dates', async () => {
  const pool = fixture();
  pool.setSnapshots([
    {
      homework_json: [
        item,
        item,
        { ...item, sourceReference: 'end', dueAt: range.end.toISOString() },
        { ...item, sourceReference: 'unknown', deadlineUnverified: true },
      ],
    },
  ]);
  const result = await listHomeworkDeadlines(pool, 7, range);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, 'deadline');
  assert.equal(result[0].endAt, range.start.toISOString());
  assert.equal(result[0].completed, false);
});
test('completion and undo survive resync and upstream deadline changes without duplicating items', async () => {
  const pool = fixture();
  assert.equal(await setHomeworkCompletion(pool, 7, item.sourceReference, true), true);
  assert.equal((await listHomeworkDeadlines(pool, 7, range))[0].completed, true);
  pool.setSnapshots([{ homework_json: [{ ...item, dueAt: '2026-09-22T15:59:00Z' }] }]);
  assert.equal((await listHomeworkDeadlines(pool, 7, range))[0].completed, true);
  await setHomeworkCompletion(pool, 7, item.sourceReference, false);
  assert.equal((await listHomeworkDeadlines(pool, 7, range))[0].completed, false);
  assert.equal(pool.state.size, 1);
});
test('submitted work defaults to complete; explicit incomplete overrides it; unknown references cannot be written', async () => {
  const pool = fixture();
  pool.setSnapshots([{ homework_json: [{ ...item, status: 'submitted' }] }]);
  assert.equal((await listHomeworkDeadlines(pool, 7, range))[0].status, 'completed');
  assert.equal((await listHomeworkDeadlines(pool, 7, range, 'confirmed')).length, 0);
  await setHomeworkCompletion(pool, 7, item.sourceReference, false);
  assert.equal((await listHomeworkDeadlines(pool, 7, range))[0].status, 'confirmed');
  assert.equal(await setHomeworkCompletion(pool, 7, 'foreign', true), false);
  assert.equal(pool.state.has('foreign'), false);
});
