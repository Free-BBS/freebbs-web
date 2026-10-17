const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const { inspectDataRetention, mountDataRetentionRoutes } = require('./data-retention');

const AS_OF = '2026-10-14 12:30:00.000000';
function fixture(options = {}) {
  const calls = [];
  return {
    calls,
    async execute(sql, params = []) {
      calls.push({ sql, params });
      assert.match(sql, /^SELECT\b/);
      assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|REPLACE|TRUNCATE)\b/i);
      if (sql.includes('AS as_of')) return [[{ as_of: options.asOf || AS_OF }]];
      if (sql.includes('information_schema.COLUMNS')) {
        if (options.schemaFails) throw new Error('SECRET_DB_PASSWORD');
        return [
          params.flatMap((table) =>
            options.missingTable === table
              ? []
              : ['created_at', 'expires_at', 'evidence_purged_at'].map((column) => ({
                  table_name: table,
                  column_name: column,
                })),
          ),
        ];
      }
      const table = /FROM `([a-z_]+)`/.exec(sql)?.[1];
      assert.ok(table);
      if (options.failTable === table) throw new Error('SECRET_DB_PASSWORD table details');
      return [
        [
          {
            total_count: '4',
            overdue_count: options.badCount ? 'not-a-count' : '2',
            oldest_created_at: '2020-01-01 09:00:00.000000',
            missing_date_count: table === options.invalidDateTable ? 1 : 0,
          },
        ],
      ];
    },
  };
}

test('read-only inspection reports aggregates without content or schema writes', async () => {
  const pool = fixture();
  const result = await inspectDataRetention(pool, { now: () => new Date('2026-10-14T04:30:01Z') });
  assert.equal(result.mode, 'read_only');
  assert.equal(result.newCleanupEnabled, false);
  assert.equal(result.checkedAt, '2026-10-14T04:30:01.000Z');
  assert.equal(result.asOfDatabaseTime, AS_OF);
  const posts = result.categories.find((category) => category.id === 'discussion_posts');
  assert.equal(posts.proposed, true);
  assert.equal(posts.stats.overdueCount, 2);
  assert.equal(posts.stats.totalCount, 4);
  assert.match(posts.executionStatus, /新增清理未启用/);
  assert.doesNotMatch(
    JSON.stringify(result),
    /messages_json|content_markdown|student_id|user_id|full_name|SECRET/,
  );
  for (const { sql, params } of pool.calls.filter((call) => call.sql.includes('AS total_count'))) {
    assert.doesNotMatch(sql, /SELECT\s+\*|messages_json|content_markdown|reason|user_id/);
    if (params.length)
      assert.deepEqual(params, [AS_OF], 'all comparisons use the same database time');
  }
  const learning = result.categories.find((category) => category.id === 'learning_records');
  assert.equal(learning.stats.totalCount, 8);
  assert.equal(learning.stats.overdueCount, 4);
});

test('active accounts and AI history have no age expiry; calendar years and existing short periods stay distinct', async () => {
  const pool = fixture();
  const result = await inspectDataRetention(pool);
  for (const id of ['accounts', 'registration', 'ai_history']) {
    const item = result.categories.find((category) => category.id === id);
    assert.equal(item.stats.status, 'not_applicable');
    assert.equal(item.stats.overdueCount, null);
    assert.equal(item.stats.totalCount, 4);
  }
  const aiQuery = pool.calls.find(({ sql }) => sql.includes('FROM `ai_dialogs`'));
  assert.deepEqual(aiQuery.params, []);
  assert.doesNotMatch(aiQuery.sql, /DATE_ADD|DATE_SUB|INTERVAL/);
  const postQuery = pool.calls.find(({ sql }) => sql.includes('FROM `discussion_posts`'));
  assert.match(postQuery.sql, /DATE_ADD\(`created_at`, INTERVAL 5 YEAR\) <= \?/);
  assert.doesNotMatch(postQuery.sql, /updated_at|1825|365/);
  const analytics = pool.calls.find(({ sql }) => sql.includes('FROM `learning_analytics_events`'));
  assert.match(analytics.sql, /`created_at` < DATE_SUB\(\?, INTERVAL 180 DAY\)/);
  const evidence = pool.calls.find(({ sql }) => sql.includes('WHERE `evidence_purged_at` IS NULL'));
  assert.match(evidence.sql, /`expires_at` <= \?/);
  assert.doesNotMatch(evidence.sql, /INTERVAL 5 YEAR/);
  assert.match(
    result.categories.find((category) => category.id === 'moderation_evidence').retention,
    /90/,
  );
});

test('missing schema, query failures, unmapped files and invalid dates are not represented as zero', async () => {
  const pool = fixture({
    missingTable: 'discussion_posts',
    failTable: 'learning_entries',
    invalidDateTable: 'discussion_comments',
  });
  const result = await inspectDataRetention(pool);
  const posts = result.categories.find((category) => category.id === 'discussion_posts');
  assert.equal(posts.stats.status, 'unavailable');
  assert.equal(posts.stats.overdueCount, null);
  assert.ok(!pool.calls.some(({ sql }) => sql.includes('FROM `discussion_posts`')));
  const learning = result.categories.find((category) => category.id === 'learning_records');
  assert.equal(learning.stats.status, 'partial');
  assert.equal(learning.stats.totalCount, 4);
  assert.equal(learning.stats.overdueCount, 2);
  const comments = result.categories.find((category) => category.id === 'discussion_comments');
  assert.equal(comments.stats.status, 'partial');
  assert.equal(comments.stats.missingDateCount, 1);
  for (const id of ['attachments', 'other_business', 'case_copies', 'operations']) {
    const category = result.categories.find((item) => item.id === id);
    assert.equal(category.stats.status, 'unavailable');
    assert.equal(category.stats.totalCount, null);
    assert.equal(category.stats.overdueCount, null);
  }
  assert.doesNotMatch(JSON.stringify(result), /SECRET_DB_PASSWORD/);
});

test('unexpected aggregate values fail closed rather than becoming inaccurate counts', async () => {
  const result = await inspectDataRetention(fixture({ badCount: true }));
  const posts = result.categories.find((category) => category.id === 'discussion_posts');
  assert.equal(posts.stats.status, 'unavailable');
  assert.equal(posts.stats.overdueCount, null);
  await assert.rejects(
    inspectDataRetention(fixture({ asOf: 'not-a-time' })),
    /Database time unavailable/,
  );
});

async function httpFixture(t, options = {}) {
  const pool = fixture(options);
  const app = express();
  mountDataRetentionRoutes(app, {
    pool,
    async requireAdmin(request, response) {
      if (request.headers.authorization !== 'Bearer admin') {
        response
          .status(request.headers.authorization ? 403 : 401)
          .json({ message: '需要管理员权限' });
        return null;
      }
      return { id: 1, is_admin: 1 };
    },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => {
    server.once('listening', resolve);
  });
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
      }),
  );
  return { pool, url: `http://127.0.0.1:${server.address().port}/api/admin/data-retention` };
}

test('only administrators can inspect, non-GET requests cannot act, and responses are not cached', async (t) => {
  const { pool, url } = await httpFixture(t);
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers: { Authorization: 'Bearer student' } })).status, 403);
  assert.equal(pool.calls.length, 0, 'unauthorized requests do not inspect the database');
  const response = await fetch(url, { headers: { Authorization: 'Bearer admin' } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal((await response.json()).newCleanupEnabled, false);
  const before = pool.calls.length;
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'])
    assert.equal(
      (await fetch(url, { method, headers: { Authorization: 'Bearer admin' } })).status,
      404,
    );
  assert.equal(pool.calls.length, before);
});

test('schema failures use a safe unavailable response without leaking database details', async (t) => {
  const { url } = await httpFixture(t, { schemaFails: true });
  const response = await fetch(url, { headers: { Authorization: 'Bearer admin' } });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const body = await response.json();
  assert.equal(body.code, 'retention_inspection_unavailable');
  assert.doesNotMatch(JSON.stringify(body), /SECRET_DB_PASSWORD/);
});
