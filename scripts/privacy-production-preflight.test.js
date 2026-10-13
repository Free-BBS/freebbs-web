const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const { inspect, TABLES } = require('./moderation-production-preflight');

function settings() {
  return {
    discussionModerationEnvironment: 'production',
    discussionModerationEnabled: true,
    discussionModerationAutoEnabled: true,
    discussionModerationProviderReviewed: true,
    discussionModerationAutoModel: 'qwen3.6-27b',
    discussionModerationBackupModel: 'glm-5.1',
    discussionModerationAutoImagesEnabled: true,
    discussionModerationImageModel: 'kimi-k2.6',
    discussionModerationDir: os.tmpdir(),
    publicWebUrl: 'https://example.test',
    apiHost: '127.0.0.1',
    db: { host: 'database-private-host', password: 'database-private-password' },
  };
}

function metadataConnection(names = TABLES) {
  const statements = [];
  let closed = false;
  return {
    statements,
    get closed() {
      return closed;
    },
    async connect(options) {
      assert.equal(options.multipleStatements, false);
      return {
        async execute(sql, params) {
          statements.push({ sql, params });
          assert.match(sql, /^SELECT /);
          if (sql.includes('information_schema.TABLES')) return [names.map((name) => ({ name }))];
          if (sql === 'SELECT paused FROM moderation_auto_control WHERE id = 1')
            return [[{ paused: 1 }]];
          if (sql === 'SELECT COUNT(*) AS total FROM moderation_reviewers WHERE active = 1')
            return [[{ total: 1 }]];
          throw new Error('unexpected metadata query');
        },
        async end() {
          closed = true;
        },
      };
    },
  };
}

test('production preflight includes privacy and export schemas without reading personal records', async () => {
  const database = metadataConnection();
  const report = await inspect({ settings: settings(), connect: database.connect });
  assert.equal(database.closed, true);
  assert.deepEqual(report.configurationIssues, []);
  assert.equal(report.readyForManualAcceptance, true);
  assert.equal(report.readyForAutomaticAcceptance, true);
  assert.deepEqual(report.missingTables, []);
  const tableQuery = database.statements[0];
  assert.match(tableQuery.sql, /TABLE_SCHEMA = DATABASE\(\) AND TABLE_NAME IN \(\?/);
  assert.deepEqual(tableQuery.params, TABLES);
  for (const name of ['privacy_policy_acceptances', 'ai_dialog_export_audit']) {
    assert.ok(TABLES.includes(name));
    assert.ok(tableQuery.params.includes(name));
    assert.ok(database.statements.every(({ sql }) => !sql.includes(`FROM ${name}`)));
  }
  assert.equal(database.statements.length, 3);
  assert.doesNotMatch(JSON.stringify(report), /database-private|content_sha256|messages_json/);
});

for (const missing of ['privacy_policy_acceptances', 'ai_dialog_export_audit']) {
  test(`production preflight refuses readiness when ${missing} is absent`, async () => {
    const database = metadataConnection(TABLES.filter((name) => name !== missing));
    const report = await inspect({ settings: settings(), connect: database.connect });
    assert.equal(report.databaseChecked, true);
    assert.deepEqual(report.missingTables, [missing]);
    assert.equal(report.readyForManualAcceptance, false);
    assert.equal(report.readyForAutomaticAcceptance, false);
    assert.equal(database.closed, true);
  });
}

test('configuration-only preflight cannot certify the privacy and export schemas', async () => {
  const report = await inspect({
    settings: settings(),
    configurationOnly: true,
    connect: async () => assert.fail('configuration-only must not connect to the database'),
  });
  assert.equal(report.databaseChecked, false);
  assert.equal(report.missingTables, null);
  assert.equal(report.readyForManualAcceptance, false);
  assert.equal(report.readyForAutomaticAcceptance, false);
});
