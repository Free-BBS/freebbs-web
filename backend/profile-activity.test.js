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

test('guest activity counts non-anonymous posts and all visible named comments within a bounded year', async () => {
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
      for (const field of ['is_hidden', 'is_deleted', 'login_required'])
        assert.ok(sql.includes(`p.${field} = 0`));
    }
  }
  assert.match(calls[2].sql, /c.is_deleted = 0/);
  assert.match(calls[1].sql, /p.is_anonymous = 0/);
  assert.doesNotMatch(calls[2].sql, /p.is_anonymous/);
  assert.equal(result.visibility, 'public');
});

test('authenticated viewers include login-visible posts and comments but never anonymous authorship', async () => {
  const calls = [];
  const pool = {
    execute: async (sql) => {
      calls.push(sql);
      return [[]];
    },
  };
  const result = await loadProfileActivity(pool, 7, new Date('2026-09-27T02:00:00Z'), {
    viewer: { id: 8 },
  });
  assert.equal(result.visibility, 'members');
  for (const sql of calls.slice(1)) {
    assert.doesNotMatch(sql, /p.login_required = 0/);
    assert.match(sql, /p.is_hidden = 0/);
    assert.match(sql, /p.is_deleted = 0/);
  }
  assert.match(calls[1], /p.is_anonymous = 0/);
  assert.doesNotMatch(calls[2], /p.is_anonymous/);
});
