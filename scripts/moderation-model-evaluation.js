const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { POLICY_VERSION, getPolicyRule } = require('../backend/moderation-policy');
const { validateLabel } = require('../backend/moderation-audit');
const {
  validateDocument,
  validateTestConfig,
  safeError: regressionSafeError,
  runRegression,
} = require('./moderation-policy-regression');
const { buildComparison, renderHtml } = require('./moderation-evaluation-report');
const { CONTRACT_VERSION } = require('../backend/moderation-ai-diagnostics');

const DEFAULTS = Object.freeze({
  input: path.resolve(__dirname, '../test/fixtures/moderation-policy-v3.json'),
  manifest: path.resolve(__dirname, '../test/fixtures/moderation-policy-v3-manifest.json'),
  models: Object.freeze(['glm-5.1', 'kimi-k2.6']),
  suite: 'smoke',
  config: 'F:\\FreeBBS-Test\\web-test\\config.json',
  output: 'F:\\FreeBBS-Test\\moderation-model-results',
  run: false,
  listModels: false,
});
const MANIFEST_FORMAT = 'freebbs-moderation-evaluation-manifest-v1';
const ENDPOINT = 'https://cloud.infini-ai.com/maas/v1/chat/completions';
const SCOPE = Object.freeze([
  '仅测试已确认虚构的固定文字样例；不读取用户、帖子或附件。',
  '首批预期标签是待负责人复核的草案；标签一致比例不是实际审核准确率。',
  '不同模型使用相同样例与规则版本；全部串行，每条每模型一次，不自动重试。',
  '单模型连续三次 API 或格式失败后停止该模型；仍可测试其余模型。',
  '仅发送样例标题、正文和固定送审字段；预期答案、解释和元数据不会发送。',
  '报告仅供人工核查，不发布、不处罚、不修改审核记录。',
]);
const fail = (code) => Object.assign(new Error(code), { code });
const plain = (value) =>
  Boolean(value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype);
const exactKeys = (value, keys) =>
  plain(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const absolute = (value) =>
  typeof value === 'string' && (path.isAbsolute(value) || path.win32.isAbsolute(value));
const modelId = (value) =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value);
const validText = (value, max) =>
  typeof value === 'string' &&
  Boolean(value.trim()) &&
  value.length <= max &&
  !Array.from(value).some((char) => {
    const code = char.codePointAt(0);
    return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
  });

function validateModels(models) {
  if (!Array.isArray(models) || !models.length || models.some((value) => !modelId(value)))
    throw fail('models');
  const unique = [...new Set(models)];
  if (unique.length > 6) throw fail('models');
  return unique;
}

function parseArguments(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  const result = { ...DEFAULTS, models: [...DEFAULTS.models] };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (
      ![
        '--input',
        '--manifest',
        '--models',
        '--suite',
        '--config',
        '--output',
        '--run',
        '--list-models',
      ].includes(key) ||
      seen.has(key)
    )
      throw fail('arguments');
    seen.add(key);
    if (key === '--run') result.run = true;
    else if (key === '--list-models') result.listModels = true;
    else {
      index += 1;
      const value = args[index];
      if (key === '--models') {
        if (typeof value !== 'string') throw fail('arguments');
        result.models = validateModels(value.split(',').map((item) => item.trim()));
      } else if (key === '--suite') {
        if (!['smoke', 'full'].includes(value)) throw fail('arguments');
        result.suite = value;
      } else {
        if (!absolute(value)) throw fail('arguments');
        result[key.slice(2)] = value;
      }
    }
  }
  if (seen.has('--input') && !seen.has('--manifest')) result.manifest = null;
  if (result.listModels && [...seen].some((key) => !['--list-models', '--config'].includes(key)))
    throw fail('arguments');
  return result;
}

function validateManifest(manifest, document) {
  if (manifest === null || manifest === undefined) return null;
  if (
    !exactKeys(manifest, [
      'format',
      'policyVersion',
      'annotationStatus',
      'syntheticOnly',
      'cases',
    ]) ||
    manifest.format !== MANIFEST_FORMAT ||
    manifest.annotationStatus !== 'draft_pending_owner_review' ||
    manifest.syntheticOnly !== true ||
    !plain(manifest.cases)
  )
    throw fail('manifest_schema');
  if (manifest.policyVersion !== POLICY_VERSION) throw fail('policy_version');
  const ids = document.cases.map((item) => item.id);
  if (Object.keys(manifest.cases).sort().join('\n') !== [...ids].sort().join('\n'))
    throw fail('manifest_cases');
  for (const id of ids) {
    const fixture = document.cases.find((item) => item.id === id);
    const meta = manifest.cases[id];
    const fields = ['ruleFocus', 'bucket', 'smoke', 'rationale'];
    if (Object.hasOwn(meta || {}, 'acceptedExpectations')) fields.push('acceptedExpectations');
    if (
      !exactKeys(meta, fields) ||
      !['prohibited', 'normal', 'boundary', 'support', 'adversarial'].includes(meta.bucket) ||
      typeof meta.smoke !== 'boolean' ||
      !validText(meta.rationale, 2000) ||
      !Array.isArray(meta.ruleFocus) ||
      meta.ruleFocus.length > 6 ||
      new Set(meta.ruleFocus).size !== meta.ruleFocus.length ||
      meta.ruleFocus.some((rule) => !getPolicyRule(rule))
    )
      throw fail('manifest_schema');
    if (Object.hasOwn(meta, 'acceptedExpectations')) {
      if (
        !Array.isArray(meta.acceptedExpectations) ||
        meta.acceptedExpectations.length < 1 ||
        meta.acceptedExpectations.length > 8
      )
        throw fail('manifest_labels');
      for (const expectation of meta.acceptedExpectations) {
        if (
          !exactKeys(expectation, ['expectedDecision', 'categories', 'ruleIds', 'supportPriority'])
        )
          throw fail('manifest_labels');
        if (
          expectation.expectedDecision !== fixture.expectedDecision ||
          expectation.supportPriority !== fixture.supportPriority
        )
          throw fail('manifest_labels');
        try {
          validateLabel({
            decision: expectation.expectedDecision,
            categories: expectation.categories,
            ruleIds: expectation.ruleIds,
            supportPriority: expectation.supportPriority,
          });
        } catch {
          throw fail('manifest_labels');
        }
      }
      const tuples = meta.acceptedExpectations.map((item) =>
        JSON.stringify({
          ...item,
          categories: [...item.categories].sort(),
          ruleIds: [...item.ruleIds].sort(),
        }),
      );
      if (new Set(tuples).size !== tuples.length) throw fail('manifest_labels');
    }
  }
  return structuredClone(manifest);
}

function preparePlan({ document, manifest = null, models = DEFAULTS.models, suite = 'smoke' }) {
  const validated = validateDocument(document);
  const metadata = validateManifest(manifest, validated);
  const selectedModels = validateModels(models);
  if (!['smoke', 'full'].includes(suite)) throw fail('arguments');
  const cases = validated.cases.filter((item) =>
    suite === 'full' || !metadata ? true : metadata.cases[item.id].smoke,
  );
  if (!cases.length) throw fail('case_limit');
  return {
    document: { ...validated, cases },
    manifest: metadata,
    suite,
    selectedModels,
    plannedCalls: cases.length * selectedModels.length,
    caseCount: cases.length,
  };
}

function safeError(error) {
  const messages = {
    arguments: '参数不符合要求；请用 --help 查看用法。',
    models: '请选择 1 至 6 个不同的模型 ID，以英文逗号分隔。',
    manifest_schema: '样例说明文件的格式、虚构确认或元数据不符合要求。',
    manifest_cases: '样例说明必须逐项对应全部样例编号，不能缺失或增加。',
    manifest_labels: '备选预期必须是合法、完整的判断、类别、规则编号及关怀级别组合。',
    report_write_failed: '报告保存失败，已停止安排后续调用；请保留此前已保存的报告。',
    file_size: '输入不是普通文件或超过允许大小。',
  };
  if (Object.hasOwn(messages, error?.code))
    return { code: error.code, status: null, message: messages[error.code] };
  return regressionSafeError(error);
}

async function listAvailableModels({ config, loadModule = require }) {
  const poolConfig = validateTestConfig(config);
  let pool;
  try {
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
      fetchImpl: () => {
        throw fail('request_limit');
      },
    });
    return await client.listModels();
  } finally {
    try {
      await pool?.end();
    } catch {
      /* Never expose database errors. */
    }
  }
}

async function runEvaluation({
  document,
  manifest = null,
  models = DEFAULTS.models,
  suite = 'smoke',
  config,
  loadModule = require,
  fetchImpl = globalThis.fetch,
  persist = () => {},
  persistModel = () => {},
  onProgress = () => {},
  shouldStop = () => false,
  now = () => new Date(),
}) {
  const plan = preparePlan({ document, manifest, models, suite });
  const state = {
    policyVersion: POLICY_VERSION,
    contractVersion: CONTRACT_VERSION,
    suite,
    selectedModels: plan.selectedModels,
    plannedCases: plan.document.cases,
    manifest: plan.manifest,
    startedAt: now().toISOString(),
    completedAt: null,
    status: 'running',
    stopReason: null,
    scope: [...SCOPE],
    models: [],
  };
  let stage = 'configuration';
  const runtime = { calls: 0, writeFailed: false };
  const save = () => {
    try {
      persist(buildComparison(state));
    } catch {
      runtime.writeFailed = true;
      throw fail('report_write_failed');
    }
  };
  try {
    validateTestConfig(config);
    save();
    if (shouldStop()) {
      state.status = 'interrupted';
      state.stopReason = 'user_interrupted';
    } else {
      stage = 'model_preflight';
      const catalog = await listAvailableModels({ config, loadModule });
      if (plan.selectedModels.some((model) => !catalog.models.some((item) => item.id === model)))
        throw fail('model_unavailable');
      stage = 'models';
      for (const model of plan.selectedModels) {
        if (shouldStop()) {
          state.status = 'interrupted';
          state.stopReason = 'user_interrupted';
          break;
        }
        const index = state.models.length;
        const report = await runRegression({
          document: plan.document,
          config,
          model,
          loadModule,
          fetchImpl: (url, options) => {
            if (
              runtime.calls >= plan.plannedCalls ||
              url !== ENDPOINT ||
              options?.method !== 'POST' ||
              options?.redirect !== 'error'
            )
              throw fail('request_limit');
            runtime.calls += 1;
            return fetchImpl(url, options);
          },
          shouldStop,
          now,
          persist: (value) => {
            // The regression runner fills model after its own preflight; the outer plan already fixed it.
            const snapshot = { ...structuredClone(value), model };
            state.models[index] = snapshot;
            try {
              persistModel(model, snapshot);
            } catch {
              runtime.writeFailed = true;
              throw fail('report_write_failed');
            }
            save();
          },
          onProgress: (value) => {
            try {
              onProgress({ ...value, model });
            } catch {
              runtime.writeFailed = true;
              throw fail('report_write_failed');
            }
          },
        });
        state.models[index] = { ...report, model };
        if (runtime.writeFailed) throw fail('report_write_failed');
        if (report.status === 'interrupted' || shouldStop()) {
          state.status = 'interrupted';
          state.stopReason = 'user_interrupted';
          break;
        }
        if (
          report.status === 'failed' ||
          (report.status === 'stopped' && report.stopReason !== 'three_consecutive_api_failures')
        ) {
          state.status = 'failed';
          state.stopReason = report.stopReason;
          if (report.error) state.error = report.error;
          break;
        }
      }
      if (state.status === 'running')
        state.status = state.models.some((report) => report.status !== 'completed')
          ? 'partial'
          : 'completed';
    }
  } catch (error) {
    state.status = 'failed';
    state.stopReason = runtime.writeFailed ? 'report_write_failed' : `${stage}_failed`;
    state.error = safeError(error);
  } finally {
    state.completedAt = now().toISOString();
    try {
      save();
    } catch {
      state.status = 'failed';
      state.stopReason = 'report_write_failed';
      state.error = safeError(fail('report_write_failed'));
    }
  }
  return buildComparison(state);
}

function readJson(file, maxBytes, io = fs) {
  const stat = io.statSync(file);
  if (!stat.isFile() || stat.size > maxBytes) throw fail('file_size');
  const contents = io.readFileSync(file, 'utf8');
  if (Buffer.byteLength(contents, 'utf8') > maxBytes) throw fail('file_size');
  return JSON.parse(contents.replace(/^\uFEFF/, ''));
}

function createBatchWriter(output, models, io = fs) {
  const selectedModels = validateModels(models);
  io.mkdirSync(output, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const directory = path.join(output, `${stamp}-${crypto.randomBytes(6).toString('hex')}`);
  io.mkdirSync(directory);
  const comparisonPath = path.join(directory, 'comparison.json');
  const htmlPath = path.join(directory, 'report.html');
  const progressPath = path.join(directory, 'progress.jsonl');
  const files = new Map();
  for (const [index, model] of selectedModels.entries()) {
    // Model IDs are data, never path components (IDs may contain slashes).
    const modelDirectory = path.join(directory, `model-${String(index + 1).padStart(2, '0')}`);
    io.mkdirSync(modelDirectory);
    files.set(model, {
      reportPath: path.join(modelDirectory, 'report.json'),
      progressPath: path.join(modelDirectory, 'progress.jsonl'),
    });
  }
  for (const file of [
    comparisonPath,
    htmlPath,
    progressPath,
    ...[...files.values()].flatMap((item) => Object.values(item)),
  ])
    io.writeFileSync(file, '', { encoding: 'utf8', flag: 'wx' });
  const atomic = (file, contents) => {
    const temporary = `${file}.tmp`;
    io.writeFileSync(temporary, contents, 'utf8');
    io.renameSync(temporary, file);
  };
  return {
    directory,
    comparisonPath,
    htmlPath,
    progressPath,
    modelFiles: Object.fromEntries(files),
    persist(comparison) {
      const html = renderHtml(comparison);
      atomic(comparisonPath, `${JSON.stringify(comparison, null, 2)}\n`);
      atomic(htmlPath, html);
    },
    persistModel(model, report) {
      if (!files.has(model)) throw fail('models');
      atomic(files.get(model).reportPath, `${JSON.stringify(report, null, 2)}\n`);
    },
    append(value) {
      const line = `${JSON.stringify(value)}\n`;
      if (value.model) {
        if (!files.has(value.model)) throw fail('models');
        io.appendFileSync(files.get(value.model).progressPath, line, 'utf8');
      }
      io.appendFileSync(progressPath, line, 'utf8');
    },
  };
}

async function main(args, dependencies = {}) {
  const io = dependencies.io || fs;
  const write =
    dependencies.write || ((value) => process.stdout.write(`${JSON.stringify(value)}\n`));
  let handler;
  let interrupted = false;
  let writer;
  try {
    const options = parseArguments(args);
    if (options.help) {
      write({
        usage:
          'node scripts/moderation-model-evaluation.js [--models glm-5.1,kimi-k2.6] [--suite smoke|full] [--input <绝对路径>] [--manifest <绝对路径>] [--config <绝对路径>] [--output <绝对路径>] [--run]',
        listModels:
          'node scripts/moderation-model-evaluation.js --list-models [--config <绝对路径>]',
        defaults: DEFAULTS,
        message:
          '默认仅预览；--run 才收费调用。--list-models 仅读本机测试库目录，不解密密钥、不调用供应商。',
      });
      return 0;
    }
    if (options.listModels) {
      const config = readJson(options.config, 1024 * 1024, io);
      const catalog = await listAvailableModels({
        config,
        ...(dependencies.runnerDependencies || {}),
      });
      write({
        event: 'models',
        defaultModel: catalog.defaultModel,
        models: catalog.models,
        settingsRevision: catalog.settingsRevision,
      });
      return 0;
    }
    const document = readJson(options.input, 4 * 1024 * 1024, io);
    const manifest = options.manifest ? readJson(options.manifest, 4 * 1024 * 1024, io) : null;
    const plan = preparePlan({ document, manifest, models: options.models, suite: options.suite });
    write({
      event: options.run ? 'plan' : 'preview',
      run: options.run,
      policyVersion: POLICY_VERSION,
      contractVersion: CONTRACT_VERSION,
      suite: options.suite,
      models: plan.selectedModels,
      caseCount: plan.caseCount,
      plannedCalls: plan.plannedCalls,
      caseIds: plan.document.cases.map((item) => item.id),
      annotationStatus: plan.manifest?.annotationStatus || 'exported_labels_require_owner_review',
      scope: SCOPE,
      message: options.run
        ? `最多 ${plan.plannedCalls} 次 API 调用，串行执行，不自动重试。`
        : '仅校验样例和元数据；未读取配置或数据库、未调用 API、未写报告。添加 --run 才执行。',
    });
    if (!options.run) return 0;
    const config = readJson(options.config, 1024 * 1024, io);
    validateTestConfig(config);
    writer = createBatchWriter(options.output, plan.selectedModels, io);
    handler = () => {
      interrupted = true;
      write({
        event: 'interrupt_requested',
        message: '已停止安排新调用，等待当前调用结束；已完成结果保存在报告中。',
      });
    };
    if (!dependencies.noProcessSignals) process.on('SIGINT', handler);
    const comparison = await runEvaluation({
      document,
      manifest,
      models: plan.selectedModels,
      suite: options.suite,
      config,
      ...(dependencies.runnerDependencies || {}),
      persist: (value) => writer.persist(value),
      persistModel: (model, report) => writer.persistModel(model, report),
      onProgress: (value) => {
        writer.append(value);
        write(value);
      },
      shouldStop: () => interrupted || Boolean(dependencies.shouldStop?.()),
    });
    const summary = {
      event: 'summary',
      status: comparison.status,
      stopReason: comparison.stopReason,
      ...comparison.summary,
      comparisonJson: writer.comparisonPath,
      reportHtml: writer.htmlPath,
      message: '预期标签需负责人复核；一致比例不是准确率，耗时不能代表线上性能。',
    };
    writer.append(summary);
    write(summary);
    if (comparison.status === 'interrupted') return 130;
    if (comparison.status !== 'completed' || comparison.summary.failed > 0) return 1;
    return comparison.summary.labelsToReview > 0 ? 2 : 0;
  } catch (error) {
    write({
      event: 'failed',
      ...safeError(error),
      ...(writer ? { comparisonJson: writer.comparisonPath, reportHtml: writer.htmlPath } : {}),
    });
    return 1;
  } finally {
    if (handler && !dependencies.noProcessSignals) process.removeListener('SIGINT', handler);
  }
}

module.exports = {
  DEFAULTS,
  MANIFEST_FORMAT,
  SCOPE,
  validateModels,
  parseArguments,
  validateManifest,
  preparePlan,
  safeError,
  listAvailableModels,
  runEvaluation,
  createBatchWriter,
  main,
};
if (require.main === module)
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
