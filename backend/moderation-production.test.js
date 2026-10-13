const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const {
  NOTICE_VERSION,
  noticeFor,
  withSubmissionNotice,
  productionConfigurationIssues,
  assertProductionConfiguration,
} = require('./moderation-production');
const { automationEnvironmentEnabled } = require('./moderation-automation');
const { aiTestEnvironmentEnabled } = require('./moderation-ai-test');
const { createDiscussionModeration } = require('./discussion-moderation');
const { createModerationAutomationStore } = require('./moderation-automation-store');

function config() {
  return {
    discussionModerationEnvironment: 'production',
    discussionModerationEnabled: true,
    discussionModerationAutoEnabled: true,
    discussionModerationProviderReviewed: true,
    discussionModerationAutoModel: 'qwen3.6-27b',
    discussionModerationBackupModel: 'glm-5.1',
    discussionModerationAutoImagesEnabled: true,
    discussionModerationImageModel: 'kimi-k2.6',
    discussionModerationDir: path.join(os.tmpdir(), 'freebbs-production-test-private'),
    uploadDir: path.resolve(__dirname, '../database/uploads'),
    publicWebUrl: 'https://community.example.edu',
    apiHost: '127.0.0.1',
    db: { host: '10.20.30.40' },
  };
}

test('production supports a separate data server while test APIs stay disabled', () => {
  assert.deepEqual(productionConfigurationIssues(config()), []);
  assert.equal(automationEnvironmentEnabled(config()), true);
  assert.equal(aiTestEnvironmentEnabled(config()), false);
  assert.equal(noticeFor(config()).required, true);
  assert.equal(noticeFor({}).required, false);
});

test('the ninety-day notice has a new version and refuses the old thirty-day acceptance', () => {
  assert.equal(NOTICE_VERSION, 'moderation-data-2026-10-13-v2');
  assert.match(noticeFor(config()).paragraphs.join(' '), /保存 90 天/);
  assert.doesNotMatch(noticeFor(config()).paragraphs.join(' '), /保存 30 天/);
  assert.throws(
    () =>
      withSubmissionNotice(
        {
          payload: { content: '普通建议' },
          moderationNoticeVersion: 'moderation-data-2026-10-12-v1',
        },
        NOTICE_VERSION,
      ),
    { status: 428 },
  );
});

for (const [label, patch] of [
  ['unknown mode', { discussionModerationEnvironment: 'typo' }],
  ['test mode with production switch', { discussionModerationEnvironment: 'test' }],
  ['disabled moderation', { discussionModerationEnabled: false }],
  ['provider not reviewed', { discussionModerationProviderReviewed: false }],
  ['raw test API', { discussionModerationAiTestEnabled: true }],
  ['test worker', { discussionModerationAutoTestEnabled: true }],
  ['plain HTTP', { publicWebUrl: 'http://community.example.edu' }],
  ['local public URL', { publicWebUrl: 'https://localhost' }],
  ['credential in URL', { publicWebUrl: 'https://secret:password@community.example.edu' }],
  ['public backend', { apiHost: '0.0.0.0' }],
  ['relative private directory', { discussionModerationDir: 'database/private' }],
  [
    'private directory within checkout',
    { discussionModerationDir: path.resolve(__dirname, '../database/private') },
  ],
  ['unvalidated text model', { discussionModerationAutoModel: 'other' }],
  ['unvalidated image model', { discussionModerationImageModel: 'other' }],
])
  test(`reject invalid production configuration: ${label}`, () => {
    const value = { ...config(), ...patch };
    assert.throws(() => assertProductionConfiguration(value));
    assert.equal(automationEnvironmentEnabled(value), false);
  });

test('physical directory validation follows symlinks into a deployment root', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-production-path-'));
  const project = path.join(root, 'project');
  const link = path.join(root, 'link');
  fs.mkdirSync(project);
  fs.symlinkSync(project, link, process.platform === 'win32' ? 'junction' : 'dir');
  t.after(() => {
    fs.unlinkSync(link);
    fs.rmdirSync(project);
    fs.rmdirSync(root);
  });
  assert.ok(
    productionConfigurationIssues(
      { ...config(), discussionModerationDir: path.join(link, 'private') },
      { projectRoot: project },
    ).length,
  );
});

test('manual production moderation remains possible before provider review', () => {
  const value = {
    ...config(),
    discussionModerationAutoEnabled: false,
    discussionModerationProviderReviewed: false,
  };
  assert.deepEqual(productionConfigurationIssues(value), []);
  assert.equal(automationEnvironmentEnabled(value), false);
  assert.equal(noticeFor(value).required, true);
});

test('desktop can accept the notice without loosening the local test boundary', () => {
  const value = {
    discussionModerationEnabled: true,
    discussionModerationEnvironment: 'test',
    discussionModerationNoticeTestEnabled: true,
    publicWebUrl: 'http://127.0.0.1:3000',
    apiHost: '127.0.0.1',
    db: { host: '127.0.0.1' },
  };
  assert.equal(noticeFor(value).required, true);
  assert.equal(noticeFor({ ...value, publicWebUrl: 'https://public.example' }).required, false);
  assert.equal(noticeFor({ ...value, db: { host: '10.20.30.40' } }).required, false);
});

test('preflight only reads metadata and never exposes credentials or database errors', async () => {
  const { inspect, TABLES } = require('../scripts/moderation-production-preflight');
  const settings = {
    ...config(),
    discussionModerationDir: os.tmpdir(),
    db: { host: 'private-host-secret', password: 'test-secret-password' },
  };
  let closed = false;
  const report = await inspect({
    settings,
    connect: async () => ({
      async execute(sql) {
        assert.match(sql, /^SELECT /);
        if (sql.includes('information_schema')) return [TABLES.map((name) => ({ name }))];
        if (sql.includes('paused')) return [[{ paused: 1 }]];
        return [[{ total: 2 }]];
      },
      async end() {
        closed = true;
      },
    }),
  });
  assert.equal(closed, true);
  assert.equal(report.databaseChecked, true);
  assert.equal(report.activeReviewerCount, 2);
  assert.doesNotMatch(JSON.stringify(report), /test-secret-password|private-host-secret/);
  const failed = await inspect({
    settings,
    connect: async () => {
      throw new Error('test-secret-password');
    },
  });
  assert.equal(failed.readyForAutomaticAcceptance, false);
  assert.doesNotMatch(JSON.stringify(failed), /test-secret-password/);
  const migrationNames = [
    '067_discussion_moderation.sql',
    '068_moderation_policy_audit.sql',
    '069_moderation_automation.sql',
    '070_moderation_image_reviews.sql',
  ];
  const declared = migrationNames.flatMap((name) =>
    [
      ...fs
        .readFileSync(path.join(__dirname, '../database/migrations', name), 'utf8')
        .matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g),
    ].map((m) => m[1]),
  );
  assert.deepEqual([...TABLES].sort(), declared.sort());
});

test('forged nested evidence and old versions cannot submit or write to the database', async () => {
  let writes = 0;
  const db = {
    execute: async () => {
      writes += 1;
      throw new Error('unexpected write');
    },
  };
  const service = createDiscussionModeration({ requiredNoticeVersion: NOTICE_VERSION });
  for (const version of [undefined, 'old-version', true]) {
    await assert.rejects(
      service.submit(db, {
        moderationNoticeVersion: version,
        payload: { moderationNoticeVersion: NOTICE_VERSION },
      }),
      { status: 428 },
    );
  }
  assert.equal(writes, 0);
});

test('a verified notice version is immutable payload evidence with a stable hash on retries', () => {
  const input = { payload: { content: '普通建议' }, moderationNoticeVersion: NOTICE_VERSION };
  const result = withSubmissionNotice(input, NOTICE_VERSION);
  assert.equal(result.payload.moderationNoticeVersion, NOTICE_VERSION);
  assert.deepEqual(withSubmissionNotice(input, NOTICE_VERSION), result);
  assert.equal(input.payload.moderationNoticeVersion, undefined);
  assert.equal(
    withSubmissionNotice({ payload: { moderationNoticeVersion: NOTICE_VERSION } }, null).payload
      .moderationNoticeVersion,
    undefined,
  );
});

for (const operation of ['prepare', 'finish'])
  test(`old queued content without notice evidence cannot ${operation} automatically`, async () => {
    const id = randomUUID();
    const jobId = randomUUID();
    const contentHash = 'a'.repeat(64);
    const row = {
      id,
      status: 'pending',
      version: 1,
      content_hash: contentHash,
      payload_json: '{"content":"旧稿件"}',
    };
    const job = {
      id: jobId,
      submission_id: id,
      state: 'running',
      lease_token: 'lease',
      submission_version: 1,
      content_hash: contentHash,
    };
    const updates = [];
    const db = {
      async execute(sql, args) {
        if (sql.includes('FROM moderation_auto_control')) return [[{ paused: 0, revision: 1 }]];
        if (sql.includes('FROM moderation_submissions')) return [[row]];
        if (sql.includes('FROM moderation_auto_jobs')) return [[job]];
        if (sql.startsWith('UPDATE moderation_auto_jobs')) {
          updates.push(args);
          return [{ affectedRows: 1 }];
        }
        if (sql.includes('FROM moderation_reviewers')) return [[]];
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    };
    const store = createModerationAutomationStore({
      requiredNoticeVersion: NOTICE_VERSION,
      withDatabaseTransaction: (fn) => fn(db),
      isEnabled: () => true,
    });
    const result = await store[operation](
      { id: jobId, submissionId: id, submissionVersion: 1, contentHash, token: 'lease' },
      { assessment: { decision: 'no_risk_detected' } },
    );
    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0].slice(0, 2), ['review', 'notice_required']);
    if (operation === 'prepare') assert.equal(result, null);
    else assert.equal(result.applied, false);
  });
