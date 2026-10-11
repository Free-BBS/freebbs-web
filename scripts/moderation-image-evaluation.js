const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { performance } = require('node:perf_hooks');
const { POLICY_VERSION } = require('../backend/moderation-policy');
const { buildImageFixtures, validateImageFixtures } = require('./moderation-image-fixtures');
const { createModerationImageClient, safeImageError } = require('./moderation-image-client');
const {
  QUALITY_VERSION,
  isUnreadableNotice,
  checkReasonQuality,
} = require('./moderation-image-quality');

const MODELS = Object.freeze(['kimi-k2.6', 'qwen3.6-27b']);
const DEFAULT_MODELS = Object.freeze(['kimi-k2.6']);
const DEFAULTS = Object.freeze({
  site: 'F:\\FreeBBS-Test\\freebbs-web',
  config: 'F:\\FreeBBS-Test\\web-test\\config.json',
  output: 'F:\\FreeBBS-Test\\moderation-image-results-v3',
});
const ENDPOINT = 'https://cloud.infini-ai.com/maas/v1/chat/completions';
const FORMAT = 'freebbs-moderation-image-comparison-v3';
const FOLLOWUP_CASE_IDS = new Set([
  'image-threat',
  'image-health-education',
  'image-privacy-other',
  'image-privacy-both',
  'image-complex-quoted-help',
  'image-small-antifraud',
  'image-privacy-self',
  'image-small-privacy',
  'image-blur-unreadable-1',
  'image-blur-unreadable-2',
  'image-fraud',
  'image-small-risk',
  'image-blur-text-region-1',
  'image-blur-text-region-2',
  'image-blank-background',
  'image-normal-suggestion',
  'image-privacy-institution',
  'image-complex-fiction',
  'image-blur-mild-normal',
]);
const SCOPE = Object.freeze([
  '仅发送本包生成的虚构图片和固定文字，不读取网站用户、帖子或附件。',
  '先检查图片中的随机码与彩色图形；图片识别未通过的模型不继续内容审核测试。',
  '每个样例每个模型最多一次请求，串行执行，不重试、不切换备用模型。',
  '预期标签、图片转录参考和解释仅用于本地对照，不发送给模型。',
  '建议处置仅用于评测；脚本不发帖、不修改网站配置、模型目录或审核记录。',
  '本轮主要测试文字图片、基础视觉、多图语境和图片内指令隔离，不代表真实照片或色情暴力图片审核能力已验收。',
  '模型自述的图片证据不等于独立事实核验；报告对照已知合成图片文字，理由仍需负责人查看。',
  '默认仅测试 Kimi K2.6；网站文字审核继续使用 Qwen，本脚本不修改默认模型。',
  '新增复杂截图、小字、轻度模糊与不可读图片；看不清应交人工，不能凭原图隐藏内容猜测风险。',
  '理由检查单独标出隐私值复述、主体规则误用及疑似额外审批条件，不通过改写结果消除差异。',
  '默认复测21项问题样例与正常对照；完整测试31项，空白背景正常对照与依赖附图的不可读稿件分别评价。',
]);
const fail = (code) => Object.assign(new Error(code), { code });
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const textFileHash = (value) => sha(String(value).replace(/\r\n/g, '\n'));
const plain = (value) => value && typeof value === 'object' && !Array.isArray(value);
const absolute = (value) =>
  typeof value === 'string' && (path.isAbsolute(value) || path.win32.isAbsolute(value));

function parseArguments(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  const options = { ...DEFAULTS, models: [...DEFAULT_MODELS], suite: 'followup', run: false };
  const seen = new Set();
  for (let i = 0; i < args.length; i += 1) {
    const key = args[i];
    if (
      !['--site', '--config', '--output', '--models', '--suite', '--run'].includes(key) ||
      seen.has(key)
    )
      throw fail('arguments');
    seen.add(key);
    if (key === '--run') options.run = true;
    else {
      i += 1;
      const value = args[i];
      if (key === '--models') {
        const selected = typeof value === 'string' ? value.split(',').map((x) => x.trim()) : [];
        if (
          !selected.length ||
          selected.some((x) => !MODELS.includes(x)) ||
          new Set(selected).size !== selected.length
        )
          throw fail('arguments');
        options.models = selected;
      } else if (key === '--suite') {
        if (!['probe', 'privacy', 'challenging', 'followup', 'full'].includes(value))
          throw fail('arguments');
        options.suite = value;
      } else {
        if (!absolute(value)) throw fail('arguments');
        options[key.slice(2)] = value;
      }
    }
  }
  return options;
}

function readJson(file, maxBytes = 1024 * 1024) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > maxBytes) throw fail('file_size');
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function validateTestConfig(config) {
  const enabled = (x) =>
    x === true ||
    (typeof x === 'string' && ['true', '1', 'yes', 'on'].includes(x.toLowerCase().trim()));
  let localWeb = false;
  try {
    const url = new URL(config?.PUBLIC_WEB_URL || 'http://127.0.0.1:3000');
    localWeb =
      ['http:', 'https:'].includes(url.protocol) &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
      !url.username &&
      !url.password;
  } catch {
    /* Invalid configuration stays rejected. */
  }
  if (
    !plain(config) ||
    !enabled(config.DISCUSSION_MODERATION_ENABLED) ||
    !enabled(config.DISCUSSION_MODERATION_AI_TEST_ENABLED) ||
    !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(config.API_HOST || '127.0.0.1') ||
    !localWeb ||
    !['127.0.0.1', 'localhost'].includes(config.BACKEND_IP) ||
    ![3307, '3307'].includes(config.MYSQL_PORT) ||
    config.MYSQL_DATABASE !== 'free_bbs' ||
    config.MYSQL_SOCKET ||
    config.MYSQL_SOCKET_PATH ||
    config.socketPath ||
    typeof config.MYSQL_USER !== 'string' ||
    !config.MYSQL_USER ||
    typeof config.MYSQL_PASSWORD !== 'string'
  )
    throw fail('test_config');
  return {
    host: '127.0.0.1',
    port: 3307,
    database: 'free_bbs',
    user: config.MYSQL_USER,
    password: config.MYSQL_PASSWORD,
    connectionLimit: 1,
    connectTimeout: 10000,
    multipleStatements: false,
  };
}

function verifySite(site, manifestPath = path.resolve(__dirname, '../package-manifest.json')) {
  if (!fs.existsSync(manifestPath)) {
    // Source-tree development only. Distributed packages always include a manifest.
    if (path.resolve(site) !== path.resolve(__dirname, '..')) throw fail('package_manifest');
    return;
  }
  const manifest = readJson(manifestPath);
  if (
    manifest.format !== 'freebbs-moderation-image-package-v3' ||
    manifest.policyVersion !== POLICY_VERSION ||
    manifest.siteHashFormat !== 'utf8-crlf-to-lf-sha256' ||
    !plain(manifest.siteFiles)
  )
    throw fail('package_manifest');
  const required = [
    'backend/moderation-ai-client.js',
    'backend/moderation-policy.js',
    'backend/moderation-policy-library.json',
    'backend/moderation-policy-decision.js',
    'backend/moderation-ai-diagnostics.js',
    'backend/moderation-image-client.js',
    'backend/moderation-image-safety.js',
    'backend/moderation-privacy.js',
  ];
  if (Object.keys(manifest.siteFiles).sort().join(',') !== required.sort().join(','))
    throw fail('package_manifest');
  for (const file of required) {
    if (textFileHash(fs.readFileSync(path.join(site, file), 'utf8')) !== manifest.siteFiles[file])
      throw fail('site_version');
  }
}

async function readSettingsSnapshot({ config, siteRequire }) {
  const poolConfig = validateTestConfig(config);
  const mysql = siteRequire('./node_modules/mysql2/promise');
  const { createSystemSettingsStore } = siteRequire('./backend/system-settings');
  const pool = mysql.createPool(poolConfig);
  try {
    const store = createSystemSettingsStore({
      pool,
      encryptionKey: config.SETTINGS_ENCRYPTION_KEY,
      defaultBaseUrl: config.LLM_BASE_URL || 'https://cloud.infini-ai.com/maas/v1',
      defaultModel: config.LLM_MODEL || 'glm-5.1',
    });
    const settings = await store.readSettings({ includeSecret: true });
    // Keep only fields needed by this fixed-endpoint test, never masked-key metadata.
    return { baseUrl: settings.baseUrl, apiKey: settings.apiKey, revision: settings.revision };
  } finally {
    try {
      await pool.end();
    } catch {
      /* No raw DB errors in output. */
    }
  }
}

function safeError(error) {
  const messages = {
    arguments: '参数不符合要求，请使用 --help。',
    test_config: '配置不符合本机测试环境 127.0.0.1:3307/free_bbs 的要求。',
    package_manifest: '测试包清单缺失或不完整，请重新解压完整测试包。',
    site_version: '网站审核规则或校验程序与测试包版本不一致，请先核对版本。',
    file_size: '文件类型或大小不符合要求。',
    request_limit: '请求超出预定次数或目标接口，已停止。',
    report_write: '报告保存失败，已停止后续调用。',
    settings_unavailable:
      '无法读取测试网站中保存的模型设置，请确认测试数据库已运行且密钥已在网站保存。',
    preparation: '测试准备失败，请确认完整解压、网站路径及现有依赖。',
  };
  if (messages[error?.code]) return { code: error.code, message: messages[error.code] };
  if (typeof safeImageError === 'function') return safeImageError(error);
  return { code: 'execution_failed', message: '执行失败；未输出包含密钥或数据库信息的原始错误。' };
}

const sameSet = (a, b) => [...a].sort().join('\n') === [...b].sort().join('\n');
const normalizeText = (value) =>
  String(value || '')
    .normalize('NFKC')
    .replace(/[\s\p{P}\p{S}]/gu, '');

function selectCases(suite, mode) {
  if (!['probe', 'privacy', 'challenging', 'followup', 'full'].includes(mode))
    throw fail('arguments');
  return suite.cases.filter(
    (item) =>
      item.kind === 'probe' ||
      mode === 'full' ||
      (mode === 'followup' && FOLLOWUP_CASE_IDS.has(item.id)) ||
      (mode === 'privacy' &&
        (item.group === 'privacy' || item.id === 'image-personal-information')) ||
      (mode === 'challenging' && ['complex', 'small_text', 'blurred'].includes(item.group)),
  );
}

function evaluateResult(fixture, result) {
  const differences = [];
  if (fixture.kind === 'probe') {
    if (fixture.probeType === 'code') {
      if (result.observation?.code !== fixture.expected.code) differences.push('pixel_code');
    } else {
      for (const key of ['redCircles', 'blueSquares', 'greenTriangles']) {
        if (result.observation?.[key] !== fixture.expected[key]) differences.push(key);
      }
    }
    return {
      matched: differences.length === 0,
      differences,
      groundingIssues: [],
      transcriptionIssues: [],
      reasonQuality: null,
      reasonRequiresHumanReview: false,
    };
  }
  const assessment = result.assessment;
  const expectedVariants = [fixture.expected, ...(fixture.expected.acceptedVariants || [])];
  const variantDifferences = expectedVariants.map((expected) => {
    const issues = [];
    if (assessment.decision !== expected.decision) issues.push('decision');
    if (!sameSet(assessment.categories, expected.categories)) issues.push('categories');
    if (
      !sameSet(
        assessment.ruleMatches.map((x) => x.ruleId),
        expected.ruleIds,
      )
    )
      issues.push('ruleIds');
    if (result.contentPolicyDecision.recommendedAction !== expected.recommendedAction)
      issues.push('recommendedAction');
    return issues;
  });
  const matchedVariantIndex = variantDifferences.findIndex((items) => items.length === 0);
  differences.push(...(matchedVariantIndex >= 0 ? [] : variantDifferences[0]));
  const groundingIssues = [];
  const transcriptionIssues = [];
  for (const reference of fixture.expected.imageText) {
    const observed = result.imageObservations.find((x) => x.imageIndex === reference.imageIndex);
    if (fixture.expected.readability === 'unreadable') {
      // Hidden pre-blur text is deliberately not a reading target. A claimed
      // transcript on a visually unreadable control is a review signal, not a
      // measurement of known correct OCR.
      if (observed?.text && !isUnreadableNotice(observed.text)) {
        transcriptionIssues.push({
          imageIndex: reference.imageIndex,
          issue: 'unreadable_control_nonempty_transcript',
        });
      }
      continue;
    }
    const matches =
      observed &&
      (reference.fragments
        ? reference.fragments.every((fragment) =>
            normalizeText(observed.text).includes(normalizeText(fragment)),
          )
        : normalizeText(observed.text) === normalizeText(reference.text));
    if (!matches) {
      transcriptionIssues.push({
        imageIndex: reference.imageIndex,
        issue: reference.fragments
          ? 'key_image_text_missing'
          : 'transcript_differs_from_known_image_text',
      });
    }
  }
  for (const match of assessment.ruleMatches) {
    const field = match.evidence.field;
    if (/^image_[1-9]\d*$/.test(field)) {
      const index = Number(field.slice(6));
      const reference = fixture.expected.imageText.find((x) => x.imageIndex === index)?.text;
      const quote = normalizeText(match.evidence.quote);
      if (!reference || !quote || !normalizeText(reference).includes(quote))
        groundingIssues.push({
          ruleId: match.ruleId,
          field,
          issue: 'quote_not_in_known_image_text',
        });
    }
  }
  const reasonQuality = checkReasonQuality(fixture, result);
  return {
    matched:
      differences.length === 0 &&
      groundingIssues.length === 0 &&
      transcriptionIssues.length === 0 &&
      reasonQuality.issues.length === 0,
    dispositionMatched:
      result.contentPolicyDecision.recommendedAction === fixture.expected.recommendedAction,
    labelsAndActionMatched: differences.length === 0,
    acceptedVariantMatched: matchedVariantIndex > 0,
    matchedVariantIndex: matchedVariantIndex >= 0 ? matchedVariantIndex : null,
    modelRecommendedAction: (result.modelPolicyDecision || result.contentPolicyDecision)
      .recommendedAction,
    localRecommendedAction: result.contentPolicyDecision.recommendedAction,
    differences,
    groundingIssues,
    transcriptionIssues,
    reasonQuality,
    reasonRequiresHumanReview: true,
  };
}

function summarize(rows, cases, models) {
  return models.map((model) => {
    const items = rows.filter((x) => x.model === model);
    const probes = items.filter((x) => x.kind === 'probe');
    const moderation = items.filter((x) => x.kind === 'moderation');
    const valid = moderation.filter((x) => x.result && x.evaluation && !x.error);
    const latencies = valid.map((x) => x.elapsedMs).sort((a, b) => a - b);
    return {
      model,
      planned: cases.length,
      attempted: items.filter((x) => x.networkAttempted).length,
      probePassed: probes.filter((x) => x.evaluation?.matched).length,
      probeRequired: cases.filter((x) => x.kind === 'probe').length,
      visionVerified: probes.length === 2 && probes.every((x) => x.evaluation?.matched),
      moderationValid: valid.length,
      matched: valid.filter((x) => x.evaluation?.matched).length,
      acceptedVariantMatches: valid.filter((x) => x.evaluation?.acceptedVariantMatched).length,
      failed: items.filter((x) => x.error).length,
      skipped: items.filter((x) => x.skipped).length,
      suspectedMisses: valid.filter(
        (x) =>
          x.expected.readability !== 'unreadable' &&
          x.expected.recommendedAction !== 'allow' &&
          x.result.contentPolicyDecision.recommendedAction === 'allow',
      ).length,
      unreadableAllowed: valid.filter(
        (x) =>
          x.expected.readability === 'unreadable' &&
          (x.result.modelPolicyDecision || x.result.contentPolicyDecision).recommendedAction ===
            'allow',
      ).length,
      localUnreadableAllowed: valid.filter(
        (x) =>
          x.expected.readability === 'unreadable' &&
          x.result.contentPolicyDecision.recommendedAction === 'allow',
      ).length,
      normalEscalations: valid.filter(
        (x) =>
          x.expected.recommendedAction === 'allow' &&
          x.result.contentPolicyDecision.recommendedAction !== 'allow',
      ).length,
      groundingFlagged: valid.filter((x) => x.evaluation.groundingIssues.length > 0).length,
      transcriptionFlagged: valid.filter((x) => x.evaluation.transcriptionIssues.length > 0).length,
      labelsAndActionMatched: valid.filter((x) => x.evaluation.labelsAndActionMatched).length,
      dispositionMatched: valid.filter((x) => x.evaluation.dispositionMatched).length,
      reasonQualityFlagged: valid.filter((x) => x.evaluation.reasonQuality.issues.length > 0)
        .length,
      groups: ['baseline', 'privacy', 'complex', 'small_text', 'blurred'].map((group) => {
        const subset = valid.filter((x) => x.group === group);
        return {
          group,
          planned: cases.filter((x) => x.kind === 'moderation' && x.group === group).length,
          valid: subset.length,
          matched: subset.filter((x) => x.evaluation.matched).length,
          dispositionMatched: subset.filter((x) => x.evaluation.dispositionMatched).length,
          reasonQualityFlagged: subset.filter((x) => x.evaluation.reasonQuality.issues.length)
            .length,
          transcriptionFlagged: subset.filter((x) => x.evaluation.transcriptionIssues.length)
            .length,
        };
      }),
      latencyMs: {
        median: latencies.length
          ? (latencies[Math.floor((latencies.length - 1) / 2)] +
              latencies[Math.floor(latencies.length / 2)]) /
            2
          : null,
        p95: latencies.length ? latencies[Math.ceil(latencies.length * 0.95) - 1] : null,
      },
    };
  });
}

async function runImageEvaluation({
  suite,
  suiteMode = 'full',
  models = DEFAULT_MODELS,
  client,
  fetchImpl = globalThis.fetch,
  clientFactory = createModerationImageClient,
  settings,
  validateAssessmentImpl,
  persist = () => {},
  onProgress = () => {},
  shouldStop = () => false,
}) {
  validateImageFixtures(suite);
  if (suite.policyVersion !== POLICY_VERSION) throw fail('arguments');
  const cases = selectCases(suite, suiteMode);
  if (
    !models.length ||
    models.some((x) => !MODELS.includes(x)) ||
    new Set(models).size !== models.length
  )
    throw fail('arguments');
  const report = {
    format: FORMAT,
    suiteVersion: suite.suiteVersion,
    qualityVersion: QUALITY_VERSION,
    suiteMode,
    policyVersion: POLICY_VERSION,
    startedAt: new Date().toISOString(),
    completedAt: null,
    status: 'running',
    plannedCalls: cases.length * models.length,
    actualCalls: 0,
    scope: SCOPE,
    models: [...models],
    results: [],
    summary: [],
    scriptPublishesPosts: false,
    productionIntegrationChanged: false,
  };
  let active = false;
  let caseCalls = 0;
  let writeFailed = false;
  const save = () => {
    report.summary = summarize(report.results, cases, models);
    try {
      persist(report);
    } catch {
      writeFailed = true;
      throw fail('report_write');
    }
  };
  try {
    save();
    const evaluator =
      client ||
      clientFactory({
        settings,
        validateAssessmentImpl,
        fetchImpl: (url, options) => {
          if (
            writeFailed ||
            !active ||
            caseCalls > 0 ||
            report.actualCalls >= report.plannedCalls ||
            url !== ENDPOINT ||
            options?.method !== 'POST' ||
            options?.redirect !== 'error'
          )
            throw fail('request_limit');
          caseCalls += 1;
          report.actualCalls += 1;
          return fetchImpl(url, options);
        },
      });
    for (const model of models) {
      let failedProbes = false;
      let consecutiveErrors = 0;
      for (const fixture of cases) {
        if (shouldStop()) {
          report.status = 'interrupted';
          break;
        }
        const row = {
          id: fixture.id,
          kind: fixture.kind,
          group: fixture.group || 'probe',
          model,
          title: fixture.title,
          content: fixture.text,
          description: fixture.description,
          expected: fixture.expected,
          images: fixture.images.map((img, i) => ({
            index: i + 1,
            sha256: img.sha256,
            width: img.width,
            height: img.height,
          })),
          result: null,
          evaluation: null,
          error: null,
          skipped: null,
          elapsedMs: null,
          networkAttempted: false,
        };
        if ((fixture.kind === 'moderation' && failedProbes) || consecutiveErrors >= 3) {
          row.skipped = failedProbes ? 'vision_probe_not_passed' : 'three_consecutive_failures';
        } else {
          const before = report.actualCalls;
          const started = performance.now();
          active = true;
          caseCalls = 0;
          try {
            const input = {
              model,
              images: fixture.images.map((img) => ({
                mimeType: img.mimeType,
                dataBase64: img.data.toString('base64'),
              })),
            };
            row.result =
              fixture.kind === 'probe'
                ? await evaluator.probe({ ...input, probeType: fixture.probeType })
                : await evaluator.assess({ ...input, title: fixture.title, content: fixture.text });
            row.evaluation = evaluateResult(fixture, row.result);
            if (fixture.kind === 'probe' && !row.evaluation.matched) failedProbes = true;
            consecutiveErrors = 0;
          } catch (error) {
            row.error = safeError(error);
            consecutiveErrors += 1;
            if (fixture.kind === 'probe') failedProbes = true;
          } finally {
            active = false;
            row.networkAttempted = report.actualCalls > before;
            row.elapsedMs = Math.round(performance.now() - started);
          }
        }
        report.results.push(row);
        save();
        onProgress({
          event: 'case',
          model,
          id: row.id,
          result: row.skipped
            ? 'skipped'
            : row.error
              ? 'failed'
              : row.evaluation.matched
                ? 'matched'
                : 'review',
          elapsedMs: row.elapsedMs,
          ...(row.error ? { error: row.error } : {}),
          ...(row.skipped ? { reason: row.skipped } : {}),
        });
      }
      if (report.status === 'interrupted') break;
    }
    if (report.status === 'running')
      report.status = report.results.some((x) => x.skipped) ? 'partial' : 'completed';
  } catch (error) {
    report.status = 'failed';
    report.error = safeError(error);
  }
  report.completedAt = new Date().toISOString();
  try {
    save();
  } catch {
    report.status = 'failed';
    report.error = safeError(fail('report_write'));
  }
  return report;
}

const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
function renderHtml(report) {
  const groups = {
    baseline: '原有基线',
    privacy: '隐私对照',
    complex: '复杂截图',
    small_text: '小字',
    blurred: '模糊图片',
  };
  const actions = { allow: '可通过', hold: '暂缓，交人工', block: '应拦截' };
  const actionText = (value) => actions[value] || '未取得有效结果';
  const summary = report.summary
    .map(
      (x) =>
        `<tr><td>${escapeHtml(x.model)}</td><td>${x.probePassed}/${x.probeRequired}</td><td>${x.moderationValid}</td><td>${x.dispositionMatched}</td><td>${x.matched}</td><td>${x.reasonQualityFlagged}</td><td>${x.suspectedMisses}</td><td>${x.unreadableAllowed}</td><td>${x.normalEscalations}</td><td>${x.failed}/${x.skipped}</td><td>${x.latencyMs.p95 ?? '—'}</td></tr>`,
    )
    .join('');
  const groupRows = report.summary
    .flatMap((model) =>
      (model.groups || [])
        .filter((group) => group.planned)
        .map(
          (group) =>
            `<tr><td>${escapeHtml(model.model)}</td><td>${escapeHtml(groups[group.group] || group.group)}</td><td>${group.valid}/${group.planned}</td><td>${group.dispositionMatched}</td><td>${group.matched}</td><td>${group.reasonQualityFlagged}</td><td>${group.transcriptionFlagged}</td></tr>`,
        ),
    )
    .join('');
  const cards = report.results
    .map((row) => {
      const assessment = !row.error && row.evaluation ? row.result?.assessment : null;
      const qualityIssues = row.evaluation?.reasonQuality?.issues || [];
      const disposition =
        row.kind === 'moderation'
          ? `<p><strong>预期处置：${actionText(row.expected.recommendedAction)} · 模型建议处置：${actionText(!row.error && row.evaluation ? (row.result?.modelPolicyDecision || row.result?.contentPolicyDecision)?.recommendedAction : null)} · 本地兜底后：${actionText(!row.error && row.evaluation ? row.result?.contentPolicyDecision?.recommendedAction : null)}</strong></p><p>预期规则：${escapeHtml(row.expected.ruleIds.join('、') || '无')}<br>明确允许的其他组合：${escapeHtml((row.expected.acceptedVariants || []).map((variant) => variant.ruleIds.join('、')).join('；') || '无')}<br>模型规则：${escapeHtml(assessment?.ruleMatches.map((item) => item.ruleId).join('、') || '无')}</p>`
          : '';
      const reason = assessment
        ? `<h3>理由与依据</h3><p>${escapeHtml(assessment.reason)}</p><ul>${assessment.ruleMatches.map((item) => `<li>${escapeHtml(item.ruleId)}：${escapeHtml(item.explanation)}<br>引用（${escapeHtml(item.evidence.field)}）：${escapeHtml(item.evidence.quote)}</li>`).join('')}</ul><p>待核查事项：${escapeHtml(assessment.uncertainties.join('；') || '模型未列出')}</p><h3>本地理由检查</h3>${qualityIssues.length ? `<ul>${qualityIssues.map((item) => `<li>${escapeHtml(item.message)}（${escapeHtml(item.field)}）</li>`).join('')}</ul>` : '<p>未触发预设检查项；仍需人工判断理由是否准确。</p>'}<p>图片转录差异：${row.evaluation.transcriptionIssues.length} 项；证据引用差异：${row.evaluation.groundingIssues.length} 项。</p>`
        : '';
      const displayed =
        assessment && row.result?.displayAssessment
          ? `<h3>处理后的展示理由</h3><p>${escapeHtml(row.result.displayAssessment.reason)}</p><p>上面的理由检查针对模型原始结果；展示脱敏不抵消原始理由的问题。</p>`
          : '';
      return `<details><summary>${escapeHtml(row.model)} · ${escapeHtml(row.id)} · ${row.skipped ? '跳过' : row.error ? '接口或输出失败' : row.evaluation.matched ? '与预期一致' : '需核查差异'}</summary><p>${escapeHtml(row.description)}</p><p>标题：${escapeHtml(row.title)}<br>正文：${escapeHtml(row.content)}</p>${row.images.map((img) => (img.file ? `<img loading="lazy" src="${escapeHtml(img.file)}" alt="合成测试图片 ${img.index}">` : '')).join('')}${disposition}${reason}${displayed}<details><summary>展开完整预期、原始结果与对照记录</summary><pre>${escapeHtml(JSON.stringify({ expected: row.expected, result: row.result, evaluation: row.evaluation, error: row.error, skipped: row.skipped }, null, 2))}</pre></details></details>`;
    })
    .join('');
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'unsafe-inline'"><title>图片审核测试 v3</title><style>body{font:16px/1.7 system-ui,sans-serif;max-width:1300px;margin:30px auto;padding:0 20px;color:#182635;background:#f5f7fa}table{width:100%;border-collapse:collapse;background:white}td,th{padding:10px;border:1px solid #d4dce5;text-align:left}details{background:white;border:1px solid #d4dce5;border-radius:8px;padding:16px;margin:16px 0}summary{cursor:pointer;font-weight:bold}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px}img{max-width:100%;max-height:420px;border:1px solid #ddd;margin:8px}p,li{overflow-wrap:anywhere}.table{overflow:auto}</style><h1>图片审核测试 v3</h1><p>状态：${escapeHtml(report.status)} · 已调用 ${report.actualCalls} / 最多 ${report.plannedCalls} 次 · 规则 ${escapeHtml(report.policyVersion)}</p><p><strong>本报告不发布任何帖子。处置一致不代表理由正确；全部对照一致也不等于真实审核准确率。</strong></p><p>“全部对照一致”要求标签、处置、已知图片文字、引用及预设理由检查均符合预期。理由检查只是有限线索，需人工复核；严重模糊对照需结合实际图片校准，单列“不可读却通过”。</p><div class="table"><table><tr><th>模型</th><th>看图探测</th><th>有效审核</th><th>处置一致</th><th>全部对照一致</th><th>理由待核查</th><th>疑似漏判</th><th>模型建议不可读放行</th><th>正常被升级</th><th>失败/跳过</th><th>P95毫秒</th></tr>${summary}</table></div><h2>分组结果</h2><div class="table"><table><tr><th>模型</th><th>样例组</th><th>有效/计划</th><th>处置一致</th><th>全部对照一致</th><th>理由待核查</th><th>转录差异</th></tr>${groupRows}</table></div><ul>${SCOPE.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul><h2>逐项结果</h2>${cards}</html>`;
}

function createWriter(output, suite) {
  fs.mkdirSync(output, { recursive: true });
  const directory = path.join(
    output,
    `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(4).toString('hex')}`,
  );
  fs.mkdirSync(directory);
  fs.mkdirSync(path.join(directory, 'images'));
  const imagePaths = new Map();
  let index = 0;
  for (const fixture of suite.cases) {
    const files = [];
    for (const image of fixture.images) {
      index += 1;
      const file = `images/image-${String(index).padStart(3, '0')}.png`;
      fs.writeFileSync(path.join(directory, file), image.data, { flag: 'wx' });
      files.push(file);
    }
    imagePaths.set(fixture.id, files);
  }
  const comparisonJson = path.join(directory, 'comparison.json');
  const reportHtml = path.join(directory, 'report.html');
  let lastReport;
  const atomicWrite = (file, value) => {
    fs.writeFileSync(`${file}.tmp`, value, 'utf8');
    fs.renameSync(`${file}.tmp`, file);
  };
  const persist = (report) => {
    const copy = structuredClone(report);
    for (const row of copy.results)
      row.images.forEach((img, i) => {
        img.file = imagePaths.get(row.id)[i];
      });
    atomicWrite(comparisonJson, `${JSON.stringify(copy, null, 2)}\n`);
    atomicWrite(reportHtml, renderHtml(copy));
    lastReport = copy;
  };
  return {
    comparisonJson,
    reportHtml,
    persist,
    markFailed(error) {
      if (lastReport)
        persist({ ...lastReport, status: 'failed', error, completedAt: new Date().toISOString() });
    },
  };
}

async function main(args, deps = {}) {
  const write = deps.write || ((value) => process.stdout.write(`${JSON.stringify(value)}\n`));
  let writer;
  let interrupted = false;
  const handler = () => {
    interrupted = true;
    write({
      event: 'interrupt_requested',
      message: '停止安排新调用，等待本次请求结束并保存报告。',
    });
  };
  try {
    const options = parseArguments(args);
    if (options.help) {
      write({
        usage:
          'node moderation-image-evaluation.js [--models kimi-k2.6,qwen3.6-27b] [--suite followup|probe|privacy|challenging|full] [--run]',
        defaults: { ...DEFAULTS, models: DEFAULT_MODELS },
        message: '不带 --run 仅预览，不读配置或数据库、不调用 API、不写报告。',
      });
      return 0;
    }
    verifySite(options.site, deps.manifestPath);
    const siteRequire = deps.siteRequire || createRequire(path.join(options.site, 'package.json'));
    const suite = await buildImageFixtures({ sharpImpl: siteRequire('./node_modules/sharp') });
    const selectedSuite = { ...suite, cases: selectCases(suite, options.suite) };
    write({
      event: options.run ? 'plan' : 'preview',
      models: options.models,
      suite: options.suite,
      caseCount: selectedSuite.cases.length,
      plannedCalls: selectedSuite.cases.length * options.models.length,
      policyVersion: POLICY_VERSION,
      scope: SCOPE,
      message: options.run
        ? '仅向无问发送合成图片，串行执行；接口可能计费。'
        : '预览完成：未读配置或数据库、未调用 API、未写报告。',
    });
    if (!options.run) return 0;
    const config = readJson(options.config);
    validateTestConfig(config);
    writer = createWriter(options.output, selectedSuite);
    // Verify report persistence before decrypting credentials or making any paid request.
    writer.persist({
      format: FORMAT,
      status: 'preparing',
      models: options.models,
      results: [],
      summary: [],
      actualCalls: 0,
      plannedCalls: selectedSuite.cases.length * options.models.length,
      policyVersion: POLICY_VERSION,
    });
    let settings;
    try {
      settings = await readSettingsSnapshot({ config, siteRequire });
    } catch {
      throw fail('settings_unavailable');
    }
    const { validateAssessment } = siteRequire('./backend/moderation-ai-client');
    if (!deps.noProcessSignals) process.on('SIGINT', handler);
    const report = await runImageEvaluation({
      suite,
      suiteMode: options.suite,
      models: options.models,
      settings,
      validateAssessmentImpl: validateAssessment,
      persist: writer.persist,
      onProgress: write,
      shouldStop: () => interrupted,
      ...(deps.runnerDependencies || {}),
    });
    write({
      event: 'summary',
      status: report.status,
      summary: report.summary,
      comparisonJson: writer.comparisonJson,
      reportHtml: writer.reportHtml,
      ...(report.error ? { error: report.error } : {}),
    });
    if (report.status === 'interrupted') return 130;
    if (report.status !== 'completed' || report.results.some((x) => x.error)) return 1;
    return report.results.some((x) => !x.evaluation?.matched) ? 2 : 0;
  } catch (error) {
    const safe = safeError(error);
    // Keep the last persisted progress intact if output or final rendering fails.
    try {
      writer?.markFailed(safe);
    } catch {
      /* Keep the last successfully saved snapshot. */
    }
    write({
      event: 'failed',
      ...safe,
      ...(writer ? { comparisonJson: writer.comparisonJson } : {}),
    });
    return 1;
  } finally {
    if (!deps.noProcessSignals) process.removeListener('SIGINT', handler);
  }
}

module.exports = {
  MODELS,
  DEFAULT_MODELS,
  DEFAULTS,
  FORMAT,
  SCOPE,
  parseArguments,
  validateTestConfig,
  textFileHash,
  verifySite,
  readSettingsSnapshot,
  safeError,
  selectCases,
  evaluateResult,
  summarize,
  runImageEvaluation,
  renderHtml,
  createWriter,
  main,
};
if (require.main === module)
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
