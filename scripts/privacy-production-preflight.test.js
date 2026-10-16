const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { inspect, inspectUploadStorage, TABLES } = require('./moderation-production-preflight');

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
    uploadDir: path.resolve(__dirname, '../database/uploads'),
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
  assert.equal(report.maxImageStorage.status, 'preserved');
  assert.equal(report.maxImageStorage.proxyChecked, false);
  assert.equal(report.maxImageStorage.deploymentRootVerified, false);
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

function storageFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-storage-inspection-'));
  const root = path.join(directory, 'checkout');
  const outside = path.join(directory, 'persistent');
  for (const item of [
    root,
    outside,
    path.join(root, 'database', 'uploads'),
    path.join(root, 'uploads'),
  ])
    fs.mkdirSync(item, { recursive: true });
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { root, outside, directory };
}

test('upload preservation checks only read paths and cover nested hidden private storage', (t) => {
  const { root, outside } = storageFixture(t);
  for (const upload of [
    path.join(root, 'uploads'),
    path.join(root, 'database', 'uploads'),
    path.join(root, 'uploads', '.max-images', '.publications'),
  ]) {
    const before = fs.readdirSync(path.join(root, 'uploads'));
    const report = inspectUploadStorage(upload, root);
    assert.equal(report.status, 'preserved');
    assert.equal(report.location, 'preserved_upload_directory');
    assert.equal(report.scope, 'running_checkout');
    assert.equal(report.proxyChecked, false);
    assert.equal(report.deploymentRootVerified, false);
    assert.deepEqual(fs.readdirSync(path.join(root, 'uploads')), before);
    assert.equal(JSON.stringify(report).includes(path.dirname(root)), false);
  }
  assert.equal(fs.existsSync(path.join(root, 'uploads', '.max-images')), false);
  const external = inspectUploadStorage(path.join(outside, 'future', 'uploads'), root);
  assert.equal(external.status, 'preserved');
  assert.equal(external.location, 'outside_project');
  assert.equal(fs.existsSync(path.join(outside, 'future')), false);
});

test('unprotected checkout storage and lookalike directory names are rejected', (t) => {
  const { root } = storageFixture(t);
  for (const upload of [
    root,
    path.join(root, 'private-pictures'),
    path.join(root, 'uploads-backup'),
    path.join(root, 'database', 'uploads-old'),
  ]) {
    const report = inspectUploadStorage(upload, root);
    assert.equal(report.status, 'unsafe');
    assert.equal(report.location, 'unprotected_project_directory');
  }
});

test('relative, missing-root and non-directory storage stay unknown', (t) => {
  const { root } = storageFixture(t);
  const file = path.join(root, 'uploads', 'ordinary-file');
  fs.writeFileSync(file, 'preserve this fixture');
  for (const upload of ['', undefined, 'uploads', file, path.join(file, 'nested')])
    assert.equal(inspectUploadStorage(upload, root).status, 'unknown');
  assert.equal(
    inspectUploadStorage(path.join(root, 'uploads'), path.join(root, 'missing')).status,
    'unknown',
  );
  assert.equal(fs.readFileSync(file, 'utf8'), 'preserve this fixture');
});

test('symlinks must preserve both the link path and the physical image directory', (t) => {
  const { root, outside } = storageFixture(t);
  const link = (target, name) =>
    fs.symlinkSync(target, name, process.platform === 'win32' ? 'junction' : 'dir');
  const unsafeTarget = path.join(root, 'transient');
  fs.mkdirSync(unsafeTarget);
  const alias = path.join(root, 'custom-alias');
  link(path.join(root, 'uploads'), alias);
  assert.equal(inspectUploadStorage(alias, root).status, 'unsafe');
  const preservedLink = path.join(root, 'uploads', 'redirect');
  link(unsafeTarget, preservedLink);
  assert.equal(inspectUploadStorage(path.join(preservedLink, 'missing'), root).status, 'unsafe');
  const externalLink = path.join(outside, 'redirect');
  link(unsafeTarget, externalLink);
  assert.equal(inspectUploadStorage(externalLink, root).status, 'unsafe');
  const safeLink = path.join(root, 'uploads', 'persistent');
  link(outside, safeLink);
  assert.equal(inspectUploadStorage(safeLink, root).status, 'preserved');
  const brokenLink = path.join(root, 'uploads', 'broken');
  link(path.join(outside, 'does-not-exist'), brokenLink);
  assert.equal(inspectUploadStorage(brokenLink, root).status, 'unknown');
});

test('unprotected or unknown image storage blocks production readiness even with all tables', async (t) => {
  const { root, outside } = storageFixture(t);
  for (const uploadDir of [path.join(root, 'private-pictures'), 'relative-uploads']) {
    const database = metadataConnection();
    const report = await inspect({
      settings: { ...settings(), uploadDir, discussionModerationDir: outside },
      projectRoot: root,
      connect: database.connect,
    });
    assert.equal(report.databaseChecked, true);
    assert.deepEqual(report.missingTables, []);
    assert.equal(report.readyForManualAcceptance, false);
    assert.equal(report.readyForAutomaticAcceptance, false);
    assert.ok(report.configurationIssues.includes(report.maxImageStorage.message));
    assert.equal(database.closed, true);
  }
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
