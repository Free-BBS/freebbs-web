const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { POLICY_VERSION } = require('../backend/moderation-policy');
const { validateLabel } = require('../backend/moderation-audit');

const DEFAULTS = Object.freeze({
  config: 'F:\\FreeBBS-Test\\web-test\\config.json',
  output: 'F:\\FreeBBS-Test\\moderation-policy-results',
  run: false,
});
const FORMAT = 'freebbs-moderation-regression-v1';
const ENDPOINT = 'https://cloud.infini-ai.com/maas/v1/chat/completions';
const DECISIONS = ['no_risk_detected', 'needs_review', 'high_risk'];
const SUPPORT = ['none', 'attention', 'urgent'];
const SCOPE = Object.freeze([
  '仅发送负责人已改写并确认虚构的回归样例；不读取用户、帖子或附件。',
  '按样例原样送审，不再次脱敏，以便检查人工标注的同一份文字。',
  '逐项比较判断、完整风险类别、完整规则编号及支持优先级；理由仍需人工核查。',
  '标签一致数量不是审核准确率；固定样例的耗时不能代表线上性能。',
  '每条样例最多一次调用，不重试；不发布、不处罚、不修改审核记录。',
]);
const fail = (code) => Object.assign(new Error(code), { code });
const plain = (value) =>
  Boolean(value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype);
const absolute = (value) =>
  typeof value === 'string' && (path.isAbsolute(value) || path.win32.isAbsolute(value));
const exactKeys = (value, keys) =>
  plain(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const validText = (value, max, required = false) =>
  typeof value === 'string' &&
  value.length <= max &&
  (!required || Boolean(value.trim())) &&
  !Array.from(value).some((char) => {
    const code = char.codePointAt(0);
    return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
  });
const modelId = (value) =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value);
const sameSet = (first, second) => [...first].sort().join('\n') === [...second].sort().join('\n');

function parseArguments(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  const result = { ...DEFAULTS };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!['--input', '--config', '--output', '--model', '--run'].includes(key) || seen.has(key))
      throw fail('arguments');
    seen.add(key);
    if (key === '--run') result.run = true;
    else {
      index += 1;
      const value = args[index];
      if (key === '--model' ? !modelId(value) : !absolute(value)) throw fail('arguments');
      result[key.slice(2)] = value;
    }
  }
  if (!result.input) throw fail('arguments');
  return result;
}

function validateDocument(document) {
  if (
    !exactKeys(document, ['format', 'policyVersion', 'exportedAt', 'cases']) ||
    document.format !== FORMAT
  )
    throw fail('export_schema');
  if (document.policyVersion !== POLICY_VERSION) throw fail('policy_version');
  if (
    typeof document.exportedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(document.exportedAt) ||
    !Number.isFinite(Date.parse(document.exportedAt))
  )
    throw fail('export_schema');
  if (!Array.isArray(document.cases) || document.cases.length < 1 || document.cases.length > 100)
    throw fail('case_limit');
  const seen = new Set();
  for (const item of document.cases) {
    if (
      !exactKeys(item, [
        'id',
        'title',
        'content',
        'expectedDecision',
        'categories',
        'ruleIds',
        'supportPriority',
        'reason',
        'syntheticConfirmed',
        'policyVersion',
      ]) ||
      typeof item.id !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(item.id) ||
      seen.has(item.id) ||
      !validText(item.title, 120) ||
      !validText(item.content, 6000, true) ||
      !validText(item.reason, 1000, true) ||
      item.syntheticConfirmed !== true ||
      !DECISIONS.includes(item.expectedDecision) ||
      !SUPPORT.includes(item.supportPriority)
    )
      throw fail('case_schema');
    if (item.policyVersion !== POLICY_VERSION) throw fail('policy_version');
    seen.add(item.id);
    try {
      validateLabel({
        decision: item.expectedDecision,
        categories: item.categories,
        ruleIds: item.ruleIds,
        supportPriority: item.supportPriority,
      });
    } catch {
      throw fail('case_labels');
    }
  }
  return structuredClone(document);
}

function validateTestConfig(config) {
  const enabled = (value) =>
    value === true ||
    (typeof value === 'string' && ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase()));
  let localWeb = false;
  try {
    const url = new URL(config?.PUBLIC_WEB_URL || 'http://127.0.0.1:3000');
    localWeb =
      ['http:', 'https:'].includes(url.protocol) &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
      !url.username &&
      !url.password;
  } catch {
    /* Invalid URL remains false. */
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

function safeError(error) {
  const messages = {
    arguments: '请使用 --input 指定导出 JSON 的绝对路径；可用 --help 查看参数。',
    export_schema: '文件不是完整的工作台回归样例导出格式。',
    policy_version: '样例与当前程序的规则版本不一致，请先在工作台重新核查标注。',
    case_limit: '一次测试需要 1 至 100 条样例，请在工作台分批导出。',
    case_schema: '样例字段、长度、唯一编号或虚构确认不符合要求。',
    case_labels: '样例的预期判断、类别、规则编号或支持优先级不一致。',
    test_config: '配置未同时满足本机测试开关与 127.0.0.1:3307/free_bbs 隔离要求。',
    file_size: '输入文件不是普通文件或超过允许大小。',
    model_unavailable: '所选模型不在测试网站的当前模型列表中。',
    request_limit: '调用超出单条一次的边界，已停止。',
  };
  const statuses = {
    400: '送审输入或模型未通过校验。',
    502: '模型调用或返回格式校验失败。',
    503: '测试模型设置不可用。',
    504: '模型调用超时。',
  };
  const code = Object.hasOwn(messages, error?.code) ? error.code : 'execution_failed';
  const status = Object.hasOwn(statuses, error?.status) ? error.status : null;
  return {
    code,
    status,
    message: messages[code] || statuses[status] || '本地准备、执行或报告写入失败；未输出原始错误。',
  };
}

function evaluate(assessment, fixture) {
  const differences = [];
  if (assessment.decision !== fixture.expectedDecision) differences.push('decision');
  if (!sameSet(assessment.categories, fixture.categories)) differences.push('categories');
  if (
    !sameSet(
      assessment.ruleMatches.map((match) => match.ruleId),
      fixture.ruleIds,
    )
  )
    differences.push('ruleIds');
  if (assessment.supportPriority !== fixture.supportPriority) differences.push('supportPriority');
  return {
    result: differences.length ? 'review' : 'matched',
    differences,
    reasonRequiresHumanReview: true,
  };
}

function summarize(rows) {
  return {
    processed: rows.length,
    networkAttempts: rows.filter((row) => row.networkAttempted).length,
    validResults: rows.filter((row) => row.assessment).length,
    matchedLabels: rows.filter((row) => row.evaluation?.result === 'matched').length,
    labelsToReview: rows.filter((row) => row.evaluation?.result === 'review').length,
    failed: rows.filter((row) => row.error).length,
  };
}

async function runRegression({
  document,
  config,
  model,
  fetchImpl = globalThis.fetch,
  loadModule = require,
  persist = () => {},
  onProgress = () => {},
  shouldStop = () => false,
  now = () => new Date(),
}) {
  const fixtures = validateDocument(document);
  const report = {
    format: 'freebbs-moderation-regression-report-v1',
    policyVersion: POLICY_VERSION,
    exportedAt: fixtures.exportedAt,
    startedAt: now().toISOString(),
    completedAt: null,
    status: 'running',
    stopReason: null,
    plannedCalls: fixtures.cases.length,
    model: null,
    scope: [...SCOPE],
    results: [],
    summary: summarize([]),
  };
  let pool;
  let stage = 'configuration';
  let totalCalls = 0;
  let caseCalls = 0;
  let caseActive = false;
  let exceeded = false;
  let failures = 0;
  const save = () => {
    report.summary = summarize(report.results);
    persist(report);
  };
  try {
    save(); // A writable report is required before loading settings or making paid requests.
    const poolConfig = validateTestConfig(config);
    stage = 'site_modules';
    const mysql = loadModule('../node_modules/mysql2/promise');
    const { createSystemSettingsStore } = loadModule('../backend/system-settings');
    const { createModerationAiClient } = loadModule('../backend/moderation-ai-client');
    pool = mysql.createPool(poolConfig);
    const store = createSystemSettingsStore({
      pool,
      encryptionKey: config.SETTINGS_ENCRYPTION_KEY,
      defaultBaseUrl: config.LLM_BASE_URL || 'https://cloud.infini-ai.com/maas/v1',
      defaultModel: config.LLM_MODEL || 'glm-5.1',
    });
    const client = createModerationAiClient({
      readSettings: (options) => store.readSettings(options),
      modelOverride: config.DISCUSSION_MODERATION_AI_MODEL || '',
      fetchImpl: (url, options) => {
        if (
          !caseActive ||
          caseCalls >= 1 ||
          totalCalls >= fixtures.cases.length ||
          url !== ENDPOINT ||
          options?.method !== 'POST' ||
          options?.redirect !== 'error'
        ) {
          exceeded = true;
          throw fail('request_limit');
        }
        caseCalls += 1;
        totalCalls += 1;
        return fetchImpl(url, options);
      },
    });
    stage = 'model_preflight';
    const catalog = await client.listModels();
    const selectedModel = model || catalog.defaultModel;
    if (!modelId(selectedModel) || !catalog.models.some((item) => item.id === selectedModel))
      throw fail('model_unavailable');
    report.model = selectedModel;
    stage = 'cases';
    for (const fixture of fixtures.cases) {
      if (shouldStop()) {
        report.status = 'interrupted';
        report.stopReason = 'user_interrupted';
        break;
      }
      const before = totalCalls;
      const started = performance.now();
      caseActive = true;
      caseCalls = 0;
      const row = {
        fixture,
        model: selectedModel,
        inputMode: 'synthetic_original',
        assessment: null,
        evaluation: null,
        policyDecision: null,
        elapsedMs: null,
        settingsRevision: null,
        policyVersion: null,
        error: null,
        networkAttempted: false,
      };
      try {
        const result = await client.assess({
          title: fixture.title,
          content: fixture.content,
          inputMode: 'synthetic_original',
          redactionCounts: {},
          hasImages: false,
          model: selectedModel,
        });
        if (exceeded) throw fail('request_limit');
        if (result.policyVersion !== POLICY_VERSION) throw fail('policy_version');
        row.assessment = result.assessment;
        row.policyDecision = result.policyDecision;
        row.settingsRevision = result.settingsRevision;
        row.policyVersion = result.policyVersion;
        row.elapsedMs = result.elapsedMs;
        row.evaluation = evaluate(result.assessment, fixture);
        failures = 0;
      } catch (error) {
        row.error = safeError(error);
        row.elapsedMs = Math.max(0, Math.round(performance.now() - started));
        if ([502, 504].includes(row.error.status)) failures += 1;
        else {
          report.status = 'stopped';
          report.stopReason = 'configuration_or_input_error';
        }
      } finally {
        caseActive = false;
      }
      row.networkAttempted = totalCalls > before;
      report.results.push(row);
      if (exceeded) {
        report.status = 'stopped';
        report.stopReason = 'request_limit_exceeded';
      } else if (failures >= 3) {
        report.status = 'stopped';
        report.stopReason = 'three_consecutive_api_failures';
      } else if (shouldStop()) {
        report.status = 'interrupted';
        report.stopReason = 'user_interrupted';
      }
      save();
      onProgress({
        event: 'result',
        caseId: fixture.id,
        completed: report.results.length,
        planned: fixtures.cases.length,
        result: row.evaluation?.result || 'error',
        differences: row.evaluation?.differences || [],
        elapsedMs: row.elapsedMs,
        status: row.error?.status || null,
      });
      if (report.status !== 'running') break;
    }
    if (report.status === 'running') report.status = 'completed';
  } catch (error) {
    report.status = 'failed';
    report.stopReason = `${stage}_failed`;
    report.error = safeError(error);
  } finally {
    try {
      await pool?.end();
    } catch {
      /* Do not log database error details. */
    }
    report.completedAt = now().toISOString();
    try {
      save();
    } catch {
      report.status = 'failed';
      report.stopReason = 'report_write_failed';
    }
  }
  return report;
}

function readJson(file, maxBytes, io = fs) {
  const stat = io.statSync(file);
  if (!stat.isFile() || stat.size > maxBytes) throw fail('file_size');
  const contents = io.readFileSync(file, 'utf8');
  if (Buffer.byteLength(contents, 'utf8') > maxBytes) throw fail('file_size');
  return JSON.parse(contents.replace(/^\uFEFF/, ''));
}

function createReportWriter(output, io = fs) {
  io.mkdirSync(output, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const directory = path.join(output, `${stamp}-${crypto.randomBytes(6).toString('hex')}`);
  io.mkdirSync(directory);
  const reportPath = path.join(directory, 'report.json');
  const progressPath = path.join(directory, 'progress.jsonl');
  io.writeFileSync(reportPath, '{}\n', { encoding: 'utf8', flag: 'wx' });
  io.writeFileSync(progressPath, '', { encoding: 'utf8', flag: 'wx' });
  return {
    reportPath,
    progressPath,
    persist(report) {
      const temporary = `${reportPath}.tmp`;
      io.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      io.renameSync(temporary, reportPath);
    },
    append(value) {
      io.appendFileSync(progressPath, `${JSON.stringify(value)}\n`, 'utf8');
    },
  };
}

async function main(args, dependencies = {}) {
  const io = dependencies.io || fs;
  const write =
    dependencies.write || ((value) => process.stdout.write(`${JSON.stringify(value)}\n`));
  let writer;
  let handler;
  let interrupted = false;
  let currentReport;
  try {
    const options = parseArguments(args);
    if (options.help) {
      write({
        usage:
          'node scripts/moderation-policy-regression.js --input <导出JSON绝对路径> [--model <模型ID>] [--config <配置绝对路径>] [--output <报告目录绝对路径>] [--run]',
        defaults: DEFAULTS,
        message: '默认仅校验和预览；--run 才读取本机模型配置并产生 API 调用。',
      });
      return 0;
    }
    const document = validateDocument(readJson(options.input, 4 * 1024 * 1024, io));
    if (!options.run) {
      write({
        event: 'preview',
        run: false,
        policyVersion: POLICY_VERSION,
        plannedCalls: document.cases.length,
        model: options.model || '测试网站当前默认模型（执行时校验）',
        caseIds: document.cases.map((item) => item.id),
        scope: SCOPE,
        message: '已校验样例；未读取网站配置或数据库，未调用 API，未写报告。添加 --run 才执行。',
      });
      return 0;
    }
    const config = readJson(options.config, 1024 * 1024, io);
    validateTestConfig(config);
    writer = createReportWriter(options.output, io);
    handler = () => {
      if (interrupted) {
        if (!dependencies.noProcessSignals) process.exit(130);
        return;
      }
      interrupted = true;
      if (currentReport) {
        currentReport.status = 'interrupted';
        currentReport.stopReason = 'user_interrupted';
        try {
          writer.persist(currentReport);
        } catch {
          /* The previous complete snapshot remains. */
        }
      }
      write({
        event: 'interrupt_requested',
        message: '已停止安排新调用，等待当前调用结束；已完成结果已保存。',
      });
    };
    if (!dependencies.noProcessSignals) process.on('SIGINT', handler);
    const report = await runRegression({
      document,
      config,
      model: options.model,
      ...(dependencies.runnerDependencies || {}),
      persist: (value) => {
        currentReport = value;
        writer.persist(value);
      },
      onProgress: (value) => {
        writer.append(value);
        write(value);
      },
      shouldStop: () => interrupted || Boolean(dependencies.shouldStop?.()),
    });
    const summary = {
      event: 'summary',
      status: report.status,
      stopReason: report.stopReason,
      plannedCalls: report.plannedCalls,
      ...report.summary,
      reportJson: writer.reportPath,
      message: '标签一致数量不是准确率；理由、证据适用性和例外仍需人工检查。',
    };
    writer.append(summary);
    write(summary);
    if (report.status === 'interrupted') return 130;
    if (report.status !== 'completed' || report.summary.failed > 0) return 1;
    return report.summary.labelsToReview > 0 ? 2 : 0;
  } catch (error) {
    write({
      event: 'failed',
      ...safeError(error),
      ...(writer ? { reportJson: writer.reportPath } : {}),
    });
    return 1;
  } finally {
    if (handler && !dependencies.noProcessSignals) process.removeListener('SIGINT', handler);
  }
}

module.exports = {
  DEFAULTS,
  FORMAT,
  parseArguments,
  validateDocument,
  validateTestConfig,
  safeError,
  evaluate,
  runRegression,
  createReportWriter,
  main,
};
if (require.main === module)
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
