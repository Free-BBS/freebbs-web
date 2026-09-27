const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const test = require('node:test');
const { loadProfileActivity } = require('./profile-activity');

test(
  'isolated MySQL: profile activity counts visible posts and named comments across Beijing midnight',
  {
    skip: process.env.RUN_PROFILE_ACTIVITY_MYSQL !== '1',
    timeout: 30000,
  },
  async (t) => {
    const mysql = require('mysql2/promise');
    const { isolatedMysqlConfig, assertIsolatedMysql } = require('./test-helpers/isolated-mysql');
    const connection = await mysql.createConnection(
      isolatedMysqlConfig('PROFILE_ACTIVITY_MYSQL_SOCKET'),
    );
    const database = `profile_activity_test_${randomUUID().replaceAll('-', '')}`;
    assert.match(database, /^profile_activity_test_[a-f0-9]{32}$/);
    let created = false;
    t.after(async () => {
      try {
        if (created) await connection.query(`DROP DATABASE ${database}`);
      } finally {
        await connection.end();
      }
    });
    await assertIsolatedMysql(connection);
    await connection.query(`CREATE DATABASE ${database}`);
    created = true;
    await connection.query(`USE ${database}`);
    await connection.query('CREATE TABLE user_checkins (user_id BIGINT, checkin_date DATE)');
    await connection.query(
      'CREATE TABLE discussion_posts (id BIGINT PRIMARY KEY, user_id BIGINT, is_deleted INT, is_hidden INT, login_required INT, is_anonymous INT, created_at DATETIME)',
    );
    await connection.query(
      'CREATE TABLE discussion_comments (id BIGINT PRIMARY KEY, post_id BIGINT, user_id BIGINT, is_deleted INT, created_at DATETIME)',
    );
    const now = new Date('2026-09-27T02:00:00Z');
    const before = Date.parse('2026-09-26T15:59:00Z') / 1000;
    const after = Date.parse('2026-09-26T16:01:00Z') / 1000;
    for (const timezone of ['+00:00', '+08:00']) {
      await connection.execute('SET SESSION time_zone = ?', [timezone]);
      for (const table of ['discussion_comments', 'discussion_posts', 'user_checkins'])
        await connection.query(`DELETE FROM ${table}`);
      await connection.execute('INSERT INTO user_checkins VALUES (7, ?)', ['2026-09-27']);
      for (const row of [
        [1, 7, 0, 0, 0, 0, before],
        [2, 7, 0, 0, 1, 0, after],
        [3, 7, 0, 0, 0, 1, after],
        [4, 7, 0, 1, 0, 0, after],
        [5, 7, 1, 0, 0, 0, after],
        [6, 8, 0, 0, 0, 0, after],
      ])
        await connection.execute(
          'INSERT INTO discussion_posts VALUES (?, ?, ?, ?, ?, ?, FROM_UNIXTIME(?))',
          row,
        );
      for (const row of [
        [1, 1, 7, 0, before],
        [2, 2, 7, 0, after],
        [3, 3, 7, 0, after],
        [4, 6, 7, 0, after],
        [5, 1, 7, 1, after],
        [6, 4, 7, 0, after],
        [7, 5, 7, 0, after],
        [8, 6, 8, 0, after],
        [9, 1, 7, 0, 1],
      ])
        await connection.execute(
          'INSERT INTO discussion_comments VALUES (?, ?, ?, ?, FROM_UNIXTIME(?))',
          row,
        );
      const guest = await loadProfileActivity(connection, 7, now);
      assert.deepEqual(
        guest.days,
        [
          { date: '2026-09-26', checkins: 0, posts: 1, comments: 1, count: 2 },
          { date: '2026-09-27', checkins: 1, posts: 0, comments: 2, count: 3 },
        ],
        `guest counts in ${timezone}`,
      );
      const member = await loadProfileActivity(connection, 7, now, { viewer: { id: 8 } });
      assert.deepEqual(
        member.days,
        [
          { date: '2026-09-26', checkins: 0, posts: 1, comments: 1, count: 2 },
          { date: '2026-09-27', checkins: 1, posts: 1, comments: 3, count: 5 },
        ],
        `member counts in ${timezone}`,
      );
    }
  },
);
