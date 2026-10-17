const fs = require('node:fs');
const path = require('node:path');

const { PRIVACY_POLICY_VERSION } = require('./privacy-policy');

const NOTICE_VERSION = PRIVACY_POLICY_VERSION;
const LOCAL = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function productionModeration(config = {}) {
  return config.discussionModerationEnvironment === 'production';
}

function requiredNoticeVersion(config = {}) {
  return config.discussionModerationEnabled ? NOTICE_VERSION : null;
}

function noticeFor() {
  // Compatibility for cached composers: confirmation now occurs at login.
  return { version: NOTICE_VERSION, required: false, policyUrl: '/privacy', confirmation: 'login' };
}

function withSubmissionNotice(input, requiredVersion) {
  const payload = { ...input.payload };
  delete payload.moderationNoticeVersion;
  // The HTTP route supplies this only after checking the account's persisted
  // policy acceptance. Never pass the version straight from request.body.
  if (requiredVersion) {
    if (input.moderationNoticeVersion !== requiredVersion)
      throw Object.assign(new Error('请先登录并确认当前隐私政策后重新提交。'), { status: 428 });
    payload.moderationNoticeVersion = requiredVersion;
  }
  return { ...input, payload };
}

function contained(root, target) {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

// Resolve existing ancestors, including symlinks, before a directory is created.
function physicalPath(value) {
  let ancestor = path.resolve(value);
  const suffix = [];
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new Error('审核存储目录无法解析。');
    suffix.unshift(path.basename(ancestor));
    ancestor = parent;
  }
  return path.join(fs.realpathSync(ancestor), ...suffix);
}

function productionConfigurationIssues(
  config = {},
  { projectRoot = path.resolve(__dirname, '..') } = {},
) {
  const issues = [];
  const environment = config.discussionModerationEnvironment || 'test';
  if (!['test', 'production'].includes(environment))
    issues.push('审核环境必须为 test 或 production。');
  if (config.discussionModerationAutoEnabled && environment !== 'production')
    issues.push('正式自动审核开关仅可用于 production 环境。');
  if (environment !== 'production') return issues;
  if (
    config.discussionModerationAiTestEnabled ||
    config.discussionModerationAutoTestEnabled ||
    config.discussionModerationNoticeTestEnabled
  )
    issues.push('正式环境必须关闭所有测试审核开关。');
  if (!config.discussionModerationEnabled) {
    if (config.discussionModerationAutoEnabled) issues.push('开启自动审核前必须启用讨论区审核。');
    return issues;
  }
  try {
    const url = new URL(config.publicWebUrl);
    if (
      url.protocol !== 'https:' ||
      LOCAL.has(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      issues.push('正式网站需配置不含凭据、查询参数或片段的 HTTPS 地址。');
  } catch {
    issues.push('正式网站 HTTPS 地址无效。');
  }
  if (!LOCAL.has(config.apiHost)) issues.push('正式审核后端须仅监听本机，由网站代理访问。');
  if (!config.discussionModerationDir || !path.isAbsolute(config.discussionModerationDir))
    issues.push('正式审核图片目录必须是独立的绝对路径。');
  else {
    try {
      const target = physicalPath(config.discussionModerationDir);
      for (const root of [projectRoot, config.uploadDir].filter(Boolean)) {
        if (contained(physicalPath(root), target) || contained(target, physicalPath(root))) {
          issues.push('正式审核图片目录须位于代码部署目录及公开上传目录之外，且不能是其父目录。');
          break;
        }
      }
    } catch {
      issues.push('正式审核图片目录无法核验。');
    }
  }
  if (config.discussionModerationAutoEnabled) {
    if (!config.discussionModerationProviderReviewed)
      issues.push('启用正式自动审核前，需核对供应商数据处理安排并设置 PROVIDER_REVIEWED。');
    if (
      config.discussionModerationAutoModel !== 'qwen3.6-27b' ||
      config.discussionModerationBackupModel !== 'glm-5.1'
    )
      issues.push('正式文字审核使用已验收的 Qwen，备选配置为 GLM。');
    if (
      config.discussionModerationAutoImagesEnabled &&
      config.discussionModerationImageModel !== 'kimi-k2.6'
    )
      issues.push('正式图片审核使用已验收的 Kimi K2.6。');
  }
  return issues;
}

function assertProductionConfiguration(config, options) {
  const issues = productionConfigurationIssues(config, options);
  if (issues.length) throw new Error(`审核配置不符合要求：${issues.join(' ')}`);
}

module.exports = {
  NOTICE_VERSION,
  noticeFor,
  requiredNoticeVersion,
  withSubmissionNotice,
  productionModeration,
  productionConfigurationIssues,
  assertProductionConfiguration,
};
