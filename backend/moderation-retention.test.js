const test = require('node:test');
const assert = require('node:assert/strict');
const { ensureModerationRetention, MODERATION_RETENTION_DAYS } = require('./moderation-retention');

test('retention upgrade uses one transaction and connection for all evidence tables', async () => {
  const statements = [];
  let released = 0;
  let connections = 0;
  const pool = {
    async getConnection() {
      connections += 1;
      return {
        async query(sql) {
          statements.push(sql);
        },
        release() {
          released += 1;
        },
      };
    },
  };
  await Promise.all([ensureModerationRetention(pool), ensureModerationRetention(pool)]);
  await ensureModerationRetention(pool);
  assert.equal(MODERATION_RETENTION_DAYS, 90);
  assert.equal(connections, 1);
  assert.equal(released, 1);
  assert.equal(statements[0], 'START TRANSACTION');
  assert.equal(statements.at(-1), 'COMMIT');
  assert.match(statements[1], /SET @moderation_retention_cutoff = NOW\(3\)/);
  for (const table of [
    'moderation_submissions',
    'moderation_attachments',
    'moderation_ai_runs',
    'moderation_regression_cases',
    'moderation_auto_jobs',
    'moderation_image_reviews',
  ]) {
    const updates = statements.filter((sql) => sql.startsWith(`UPDATE ${table}`));
    assert.ok(updates.length >= 1, table);
    for (const sql of updates) {
      assert.match(sql, /DATE_ADD\((?:s\.)?created_at, INTERVAL 90 DAY\)/);
      assert.match(sql, /expires_at > @moderation_retention_cutoff/);
      assert.doesNotMatch(sql, /DATE_ADD\(NOW/);
    }
  }
});

test('an incomplete retention upgrade rolls back, releases, and can be retried', async () => {
  let failure = true;
  let released = 0;
  let rolledBack = 0;
  let committed = 0;
  const pool = {
    async getConnection() {
      return {
        async query(sql) {
          if (failure && sql.startsWith('UPDATE moderation_ai_runs'))
            throw new Error('injected migration failure');
          if (sql === 'COMMIT') committed += 1;
        },
        async rollback() {
          rolledBack += 1;
        },
        release() {
          released += 1;
        },
      };
    },
  };
  await assert.rejects(ensureModerationRetention(pool), /injected migration failure/);
  assert.equal(rolledBack, 1);
  assert.equal(committed, 0);
  failure = false;
  await ensureModerationRetention(pool);
  assert.equal(committed, 1);
  assert.equal(released, 2);
});
