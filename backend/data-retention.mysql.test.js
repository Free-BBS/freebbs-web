const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { isolatedMysqlConfig, assertIsolatedMysql } = require('./test-helpers/isolated-mysql');
const { inspectDataRetention } = require('./data-retention');

test(
  'isolated MySQL: read-only retention uses calendar anniversaries and preserves newer, undated and active AI records',
  { skip: process.env.RUN_MODERATION_MYSQL !== '1', timeout: 60000 },
  async (t) => {
    const mysql = require('mysql2/promise');
    const config = isolatedMysqlConfig('MODERATION_MYSQL_SOCKET');
    const connection = await mysql.createConnection(config);
    t.after(() => connection.end());
    await assertIsolatedMysql(connection);
    const database = `retention_${randomUUID().replaceAll('-', '')}`;
    assert.match(database, /^retention_[a-f0-9]{32}$/);
    await connection.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`);
    const pool = mysql.createPool({ ...config, database, connectionLimit: 3 });
    t.after(() => pool.end());
    for (const table of [
      'discussion_posts',
      'discussion_comments',
      'ai_dialogs',
      'learning_analytics_events',
    ])
      await pool.execute(
        `CREATE TABLE ${table} (id BIGINT PRIMARY KEY, created_at DATETIME(3) NULL)`,
      );
    await pool.execute(
      'CREATE TABLE moderation_submissions (id BIGINT PRIMARY KEY, created_at DATETIME(3), expires_at DATETIME(3), evidence_purged_at DATETIME(3) NULL)',
    );
    await pool.execute(
      "INSERT INTO discussion_posts VALUES (1,'2020-02-29 12:00:00'),(2,'2020-03-01 12:00:00'),(3,NULL),(4,'2020-02-28 12:00:00'),(5,'2020-02-29 12:00:00.001')",
    );
    await pool.execute("INSERT INTO ai_dialogs VALUES (1,'2010-01-01 00:00:00')");
    await pool.execute(
      "INSERT INTO learning_analytics_events VALUES (1,DATE_SUB('2025-02-28 12:00:00',INTERVAL 180 DAY)),(2,DATE_SUB('2025-02-28 11:59:59.999',INTERVAL 180 DAY))",
    );
    await pool.execute(
      "INSERT INTO moderation_submissions VALUES (1,'2024-11-01 00:00:00','2025-02-28 12:00:00',NULL),(2,'2024-11-01 00:00:00','2025-02-28 11:00:00','2025-02-28 11:01:00')",
    );
    const queries = [];
    const readOnly = {
      execute(sql, params) {
        queries.push(sql);
        assert.match(sql, /^SELECT\b/);
        if (sql.includes('AS as_of'))
          return Promise.resolve([[{ as_of: '2025-02-28 12:00:00.000000' }]]);
        return pool.execute(sql, params);
      },
    };
    const result = await inspectDataRetention(readOnly);
    const posts = result.categories.find((category) => category.id === 'discussion_posts');
    assert.equal(posts.stats.totalCount, 5);
    assert.equal(
      posts.stats.overdueCount,
      2,
      'Feb 29 clamps to Feb 28 after five calendar years; newer millisecond remains',
    );
    assert.equal(posts.stats.missingDateCount, 1);
    assert.equal(posts.stats.status, 'partial');
    const empty = result.categories.find((category) => category.id === 'discussion_comments');
    assert.equal(empty.stats.overdueCount, 0, 'present empty tables differ from missing tables');
    assert.equal(empty.stats.status, 'available');
    assert.equal(
      result.categories.find((category) => category.id === 'notifications').stats.status,
      'unavailable',
    );
    const ai = result.categories.find((category) => category.id === 'ai_history');
    assert.equal(ai.stats.totalCount, 1);
    assert.equal(ai.stats.overdueCount, null);
    assert.equal(
      result.categories.find((category) => category.id === 'learning_analytics').stats.overdueCount,
      1,
      '180-day boundary remains strict',
    );
    assert.equal(
      result.categories.find((category) => category.id === 'moderation_evidence').stats
        .overdueCount,
      1,
    );
    const [[after]] = await pool.execute('SELECT COUNT(*) AS total FROM discussion_posts');
    assert.equal(after.total, 5);
    assert.ok(queries.length > 2);
  },
);
