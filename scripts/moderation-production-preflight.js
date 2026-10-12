#!/usr/bin/env node
// Read-only. Never starts the app, runs migrations, writes files, or calls an LLM.
const fs = require('node:fs');
const config = require('../backend/config');
const {
  NOTICE_VERSION,
  productionConfigurationIssues,
} = require('../backend/moderation-production');

const TABLES = [
  'moderation_meta',
  'moderation_reviewers',
  'moderation_submissions',
  'moderation_attachments',
  'moderation_ai_runs',
  'moderation_ai_feedback',
  'moderation_regression_cases',
  'moderation_auto_control',
  'moderation_auto_jobs',
  'moderation_image_reviews',
];

async function inspect({ settings = config, connect, configurationOnly = false } = {}) {
  const report = {
    reportVersion: 1,
    readOnly: true,
    nodeMajor: Number(process.versions.node.split('.')[0]),
    environment: settings.discussionModerationEnvironment,
    moderationEnabled: Boolean(settings.discussionModerationEnabled),
    automaticConfigured: Boolean(settings.discussionModerationAutoEnabled),
    providerReviewed: Boolean(settings.discussionModerationProviderReviewed),
    configurationIssues: productionConfigurationIssues(settings),
    noticeVersion: NOTICE_VERSION,
    privateStorageAccessible: false,
    databaseChecked: false,
    missingTables: null,
    paused: null,
    activeReviewerCount: null,
  };
  if (settings.discussionModerationDir) {
    try {
      const stat = fs.statSync(settings.discussionModerationDir);
      fs.accessSync(settings.discussionModerationDir, fs.constants.R_OK);
      fs.accessSync(settings.discussionModerationDir, fs.constants.W_OK);
      report.privateStorageAccessible = stat.isDirectory();
    } catch {
      /* Report only a boolean, never a path containing credentials. */
    }
  }
  if (!configurationOnly) {
    let db;
    try {
      db = await (connect || require('mysql2/promise').createConnection)({
        ...settings.db,
        connectTimeout: 5000,
        multipleStatements: false,
      });
      const [tables] = await db.execute(
        'SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE ?',
        ['moderation_%'],
      );
      const names = new Set(tables.map((row) => row.name));
      report.databaseChecked = true;
      report.missingTables = TABLES.filter((name) => !names.has(name));
      if (names.has('moderation_auto_control')) {
        const [[row]] = await db.execute('SELECT paused FROM moderation_auto_control WHERE id = 1');
        report.paused = row ? Boolean(Number(row.paused)) : null;
      }
      if (names.has('moderation_reviewers')) {
        const [[row]] = await db.execute(
          'SELECT COUNT(*) AS total FROM moderation_reviewers WHERE active = 1',
        );
        report.activeReviewerCount = Number(row.total);
      }
    } catch {
      report.databaseError = '数据库只读检查未完成；请在服务器核对连接与读取权限。';
    } finally {
      if (db) await db.end();
    }
  }
  report.readyForManualAcceptance =
    report.nodeMajor >= 24 &&
    report.environment === 'production' &&
    report.moderationEnabled &&
    report.configurationIssues.length === 0 &&
    report.privateStorageAccessible &&
    report.databaseChecked &&
    report.missingTables?.length === 0 &&
    report.activeReviewerCount > 0;
  report.readyForAutomaticAcceptance =
    report.readyForManualAcceptance &&
    report.automaticConfigured &&
    report.providerReviewed &&
    report.paused === true;
  return report;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--configuration-only') || args.length > 1) {
    process.stderr.write(
      'Usage: node scripts/moderation-production-preflight.js [--configuration-only]\n',
    );
    process.exitCode = 1;
  } else
    inspect({ configurationOnly: args.includes('--configuration-only') })
      .then((report) => {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        process.exitCode = report.readyForManualAcceptance ? 0 : 2;
      })
      .catch(() => {
        process.stderr.write('预检查未完成，请在服务器检查运行环境。\n');
        process.exitCode = 1;
      });
}
module.exports = { inspect, TABLES };
