const assert = require('node:assert/strict');
const test = require('node:test');
const { reconcileHomeworkCompletion } = require('./homework-state-sync');

test('verified submission completes only this owner source item, preserving manual/cancelled/deleted plans', async () => {
  const reference = 'learn:homework:one';
  const items = [
    { userId: 7, source: 'network_classroom', reference, status: 'confirmed', title: '我的标题' },
    { userId: 8, source: 'network_classroom', reference, status: 'confirmed' },
    { userId: 7, source: 'manual', reference, status: 'confirmed' },
    { userId: 7, source: 'network_classroom', reference, status: 'cancelled' },
    { userId: 7, source: 'network_classroom', reference, status: 'confirmed', deleted: true },
  ];
  const states = [
    { userId: 7, reference, completed: 0 },
    { userId: 8, reference, completed: 0 },
    { userId: 7, reference: 'other', completed: 0 },
    { userId: 7, reference, completed: 1 },
  ];
  const pool = {
    async execute(statement, params) {
      const sql = statement.replace(/\s+/g, ' ');
      if (sql.startsWith('DELETE')) {
        assert.match(sql, /WHERE user_id = \? AND completed = 0 AND homework_reference IN \(\?\)/);
        for (let i = states.length - 1; i >= 0; i -= 1) {
          if (
            states[i].userId === params[0] &&
            states[i].completed === 0 &&
            params.slice(1).includes(states[i].reference)
          )
            states.splice(i, 1);
        }
      } else {
        assert.match(sql, /source_type = 'network_classroom'/);
        assert.match(sql, /status IN \('draft', 'confirmed'\) AND deleted_at IS NULL/);
        assert.doesNotMatch(sql, /SET[^]*title\s*=/);
        for (const item of items) {
          if (
            item.userId === params[1] &&
            item.source === 'network_classroom' &&
            params.slice(2).includes(item.reference) &&
            ['draft', 'confirmed'].includes(item.status) &&
            !item.deleted
          )
            item.status = 'completed';
        }
      }
      return [{ affectedRows: 1 }];
    },
  };
  await reconcileHomeworkCompletion(
    pool,
    7,
    [{ sourceReference: reference, status: 'unsubmitted' }],
    [{ sourceReference: reference, status: 'submitted' }],
    new Date(),
  );
  assert.deepEqual(
    items.map((item) => item.status),
    ['completed', 'confirmed', 'confirmed', 'cancelled', 'confirmed'],
  );
  assert.equal(items[0].title, '我的标题');
  assert.equal(states.length, 3);
  assert.ok(states.some((item) => item.userId === 8 && item.completed === 0));
});

test('unsubmitted, unknown or content-only attempts never trigger auto completion', async () => {
  const pool = { execute: async () => assert.fail('no completion writes without verified status') };
  await reconcileHomeworkCompletion(
    pool,
    7,
    [],
    [
      { sourceReference: 'a', status: 'unsubmitted', submittedFileId: 'uploaded' },
      {
        sourceReference: 'b',
        status: 'unknown',
        submittedAt: new Date(),
        submittedContent: 'attempt',
      },
    ],
    new Date(),
  );
});

test('manual undo after submission survives unchanged submitted and graded snapshots', async () => {
  const calls = [];
  const reopened = { reference: 'a', status: 'confirmed', userOverridden: true };
  const untouched = { reference: 'a', status: 'draft', userOverridden: false };
  const calendarState = { reference: 'a', completed: false };
  const pool = {
    execute: async (sql) => {
      calls.push(sql);
      assert.ok(sql.startsWith('UPDATE important_items'));
      assert.match(sql, /AND user_overridden_at IS NULL/);
      for (const item of [reopened, untouched]) {
        if (['draft', 'confirmed'].includes(item.status) && !item.userOverridden)
          item.status = 'completed';
      }
      return [{ affectedRows: 1 }];
    },
  };
  await reconcileHomeworkCompletion(
    pool,
    7,
    [{ sourceReference: 'a', status: 'submitted' }],
    [{ sourceReference: 'a', status: 'graded' }],
    new Date(),
  );
  assert.equal(calls.length, 1);
  assert.ok(calls[0].startsWith('UPDATE important_items'));
  assert.match(calls[0], /AND user_overridden_at IS NULL/);
  assert.doesNotMatch(calls[0], /OR source_reference/);
  assert.equal(reopened.status, 'confirmed');
  assert.equal(untouched.status, 'completed');
  assert.equal(calendarState.completed, false);
});
