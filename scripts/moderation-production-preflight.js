#!/usr/bin/env node
// Read-only. Never starts the app, runs migrations, writes files, or calls an LLM.
const fs = require('node:fs');
const path = require('node:path');
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
  'privacy_policy_acceptances',
  'ai_dialog_export_audit',
];

function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  );
}

function physicalDirectory(directory) {
  let ancestor = directory;
  const missing = [];
  for (;;) {
    try {
      const stat = fs.lstatSync(ancestor);
      // realpath rejects dangling links; stat also verifies links target directories.
      if (!stat.isDirectory() && !(stat.isSymbolicLink() && fs.statSync(ancestor).isDirectory()))
        throw new Error('not a directory');
      return path.join(fs.realpathSync(ancestor), ...missing);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // A dangling symlink is not a directory that may safely be created later.
      try {
        if (fs.lstatSync(ancestor).isSymbolicLink()) throw new Error('dangling symlink');
      } catch (linkError) {
        if (linkError.code !== 'ENOENT') throw linkError;
      }
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      missing.unshift(path.basename(ancestor));
      ancestor = parent;
    }
  }
}

function inspectUploadStorage(uploadDirectory, projectRoot = path.resolve(__dirname, '..')) {
  const result = {
    status: 'unknown',
    location: null,
    scope: 'running_checkout',
    deploymentRootVerified: false,
    proxyChecked: false,
    message: '上传目录无法核验；请从正式部署目录运行检查，并使用明确的绝对路径。',
  };
  if (!uploadDirectory || !path.isAbsolute(uploadDirectory) || !path.isAbsolute(projectRoot))
    return result;
  try {
    const root = path.resolve(projectRoot);
    if (!fs.statSync(root).isDirectory()) return result;
    const realRoot = fs.realpathSync(root);
    const upload = path.resolve(uploadDirectory);
    const realUpload = physicalDirectory(upload);
    const preserved = (base, candidate) =>
      [path.join(base, 'uploads'), path.join(base, 'database', 'uploads')].some((directory) =>
        within(directory, candidate),
      );
    const unsafe = (base, candidate) => within(base, candidate) && !preserved(base, candidate);
    // Both the configured path and its physical target must survive rsync --delete.
    // An unprotected link into a preserved directory can itself disappear on deploy.
    if (unsafe(root, upload) || unsafe(realRoot, realUpload)) {
      return {
        ...result,
        status: 'unsafe',
        location: 'unprotected_project_directory',
        message:
          '上传目录位于部署同步的非保留位置，更新可能删除私人图片；请先确认持久目录和部署排除规则。',
      };
    }
    return {
      ...result,
      status: 'preserved',
      location: within(realRoot, realUpload) ? 'preserved_upload_directory' : 'outside_project',
      message:
        '按本仓库部署脚本，上传路径及其物理目标位于保留目录或代码目录之外；仍需核对正式部署目录、代理和缓存。',
    };
  } catch {
    return result;
  }
}

async function inspect({
  settings = config,
  connect,
  configurationOnly = false,
  projectRoot = path.resolve(__dirname, '..'),
} = {}) {
  const maxImageStorage = inspectUploadStorage(settings.uploadDir, projectRoot);
  const report = {
    reportVersion: 1,
    readOnly: true,
    nodeMajor: Number(process.versions.node.split('.')[0]),
    environment: settings.discussionModerationEnvironment,
    moderationEnabled: Boolean(settings.discussionModerationEnabled),
    automaticConfigured: Boolean(settings.discussionModerationAutoEnabled),
    providerReviewed: Boolean(settings.discussionModerationProviderReviewed),
    configurationIssues: productionConfigurationIssues(settings, { projectRoot }),
    maxImageStorage,
    noticeVersion: NOTICE_VERSION,
    privateStorageAccessible: false,
    databaseChecked: false,
    missingTables: null,
    paused: null,
    activeReviewerCount: null,
  };
  if (
    settings.discussionModerationEnvironment === 'production' &&
    maxImageStorage.status !== 'preserved'
  )
    report.configurationIssues.push(maxImageStorage.message);
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
        `SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${TABLES.map(() => '?').join(', ')})`,
        TABLES,
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
module.exports = { inspect, inspectUploadStorage, TABLES };
