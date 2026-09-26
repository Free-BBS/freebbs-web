const assert = require('node:assert/strict');
const test = require('node:test');
const { activityWindow, loadProfileActivity } = require('./profile-activity');

test('activity window covers 365 Beijing dates including today and leap days', () => {
  assert.deepEqual(activityWindow(new Date('2026-09-26T16:01:00Z')), {
    start: '2025-09-28',
    end: '2026-09-27',
  });
  assert.equal(activityWindow(new Date('2024-02-29T10:00:00Z')).end, '2024-02-29');
});

test('activity aggregates checkins and visible non-anonymous posts/comments within a bounded year', async () => {
  const calls = [];
  const pool = {
    execute: async (sql, params) => {
      calls.push({ sql, params });
      const count = sql.includes('user_checkins') ? 1 : sql.includes('discussion_comments') ? 4 : 2;
      return [
        [
          { day: '2026-09-27', count },
          { day: '2020-01-01', count: 100 },
        ],
      ];
    },
  };
  const result = await loadProfileActivity(pool, 7, new Date('2026-09-27T02:00:00Z'));
  assert.deepEqual(result.days, [
    { date: '2026-09-27', checkins: 1, posts: 2, comments: 4, count: 7 },
  ]);
  for (const { sql, params } of calls) {
    assert.deepEqual(
      params,
      sql.includes('user_checkins')
        ? [7, '2025-09-28', '2026-09-27']
        : [
            7,
            Date.parse('2025-09-28T00:00:00+08:00') / 1000,
            Date.parse('2026-09-28T00:00:00+08:00') / 1000,
          ],
    );
    if (!sql.includes('user_checkins')) {
      for (const field of ['is_hidden', 'is_deleted', 'login_required', 'is_anonymous'])
        assert.ok(sql.includes(`p.${field} = 0`));
    }
  }
  assert.match(calls[2].sql, /c.is_deleted = 0/);
});
