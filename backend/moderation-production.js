const fs = require('node:fs');
const path = require('node:path');

const NOTICE_VERSION = 'moderation-data-2026-10-13-v2';
const LOCAL = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const NOTICE = Object.freeze({
  version: NOTICE_VERSION,
  title: '讨论区内容审核与数据处理说明',
  paragraphs: [
    '帖子、评论及其图片将用于内容审核。系统会把送审内容交给无问芯穹模型服务分析，审核负责人可以查看原文、图片和审核结果。',
    '文字会先尝试在本站替换姓名、学号、地址等个人信息，但可能识别不全。图片会在格式转换后发送，画面中的文字、人物和其他信息不会自动遮挡。请不要提交无权提供的他人隐私。',
    '普通内容可能自动发布；政治相关、心理关怀相关及其他需要核查的内容会等待负责人决定。已自动发布的含图内容仍会提醒负责人复核，必要时撤回。心理求助不等于违规或诊断。',
    '本站审核证据保存 90 天后清理；正常发布的帖子和评论不随审核记录到期删除。数据库备份及供应商处理的数据另按相应约定管理，本站不能代供应商承诺同步删除。',
    '若不确认，本次内容不会提交或发送给模型。你可以返回修改或取消发布；如需了解数据处理安排，请联系网站管理员。',
  ],
  providerPrivacyUrl: 'https://docs.infini-ai.com/legal/privacy.html',
});

function productionModeration(config = {}) {
  return config.discussionModerationEnvironment === 'production';
}

function requiredNoticeVersion(config = {}) {
  let localPreview = false;
  try {
    const url = new URL(config.publicWebUrl);
    localPreview =
      (!config.discussionModerationEnvironment ||
        config.discussionModerationEnvironment === 'test') &&
      config.discussionModerationNoticeTestEnabled === true &&
      LOCAL.has(config.apiHost) &&
      LOCAL.has(config.db?.host) &&
      LOCAL.has(url.hostname) &&
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password;
  } catch {
    /* Invalid local configuration cannot enable the preview. */
  }
  return (productionModeration(config) || localPreview) && config.discussionModerationEnabled
    ? NOTICE_VERSION
    : null;
}

function noticeFor(config = {}) {
  return { ...NOTICE, required: Boolean(requiredNoticeVersion(config)) };
}

function withSubmissionNotice(input, requiredVersion) {
  // Strip caller-provided evidence even in test mode; only the server records it.
  const payload = { ...input.payload };
  delete payload.moderationNoticeVersion;
  if (requiredVersion) {
    if (input.moderationNoticeVersion !== requiredVersion)
      throw Object.assign(new Error('请阅读并确认当前的内容审核与数据处理说明后重新提交。'), {
        status: 428,
      });
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
