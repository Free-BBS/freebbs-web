// Fixed synthetic acceptance cases. No submission, publication or moderation writes.
const fs = require('node:fs');
const path = require('node:path');
const { getReviewFocus, REVIEW_KEYWORD_VERSION } = require('../backend/moderation-review-focus');
const { TOPIC_CONTRACT_VERSION } = require('../backend/moderation-review-topics');
const { validateAssessment } = require('../backend/moderation-ai-client');
const {
  validateTestConfig,
  createReportWriter,
  safeError,
} = require('./moderation-policy-regression');
const cases = require('../test/fixtures/moderation-topics-v1.json');

const MODEL = 'qwen3.6-27b';

async function runCases(client, persist = () => {}, onProgress = () => {}) {
  const report = {
    format: 'freebbs-topic-evaluation-v1',
    model: MODEL,
    keywordVersion: REVIEW_KEYWORD_VERSION,
    topicContractVersion: TOPIC_CONTRACT_VERSION,
    status: 'running',
    results: [],
  };
  persist(report);
  let failures = 0;
  for (const fixture of cases) {
    const input = { title: '虚构验收样例', content: fixture.content };
    let focus = getReviewFocus(input);
    const row = {
      id: fixture.id,
      content: fixture.content,
      expected: fixture.expected,
      note: fixture.note,
      route: 'keyword',
      apiCalled: false,
    };
    if (!focus.political && !focus.psychological) {
      row.route = 'semantic';
      row.apiCalled = true;
      try {
        const response = await client.assess({
          ...input,
          model: MODEL,
          inputMode: 'synthetic_original',
          requireReviewTopics: true,
        });
        const assessment = validateAssessment(response.assessment, input, {
          requireReviewTopics: true,
        });
        focus = getReviewFocus({ ...input, assessments: [assessment] });
        row.assessment = assessment;
        row.elapsedMs = response.elapsedMs;
        failures = 0;
      } catch (error) {
        row.failure = safeError(error);
        row.status = 'failed_requires_human';
        failures += 1;
      }
    }
    row.focus = focus;
    if (!row.status)
      row.status = ['political', 'psychological'].every(
        (key) => focus[key] === fixture.expected[key],
      )
        ? 'matched'
        : 'needs_inspection';
    report.results.push(row);
    persist(report);
    onProgress({ id: row.id, status: row.status, route: row.route });
    if (failures >= 3) {
      report.status = 'stopped_after_three_failures';
      break;
    }
  }
  if (report.status === 'running') report.status = 'completed';
  report.summary = {
    total: report.results.length,
    matched: report.results.filter((x) => x.status === 'matched').length,
    mismatches: report.results.filter((x) => x.status === 'needs_inspection').length,
    failures: report.results.filter((x) => x.status === 'failed_requires_human').length,
    unrun: cases.length - report.results.length,
  };
  persist(report);
  return report;
}

async function main(args) {
  let pool;
  let writer;
  try {
    const options = {
      run: false,
      config: 'F:\\FreeBBS-Test\\web-test\\config.json',
      output: 'F:\\FreeBBS-Test\\moderation-topic-results',
    };
    const seen = new Set();
    for (let i = 0; i < args.length; i += 1) {
      const flag = args[i];
      if (!['--run', '--config', '--output'].includes(flag) || seen.has(flag))
        throw new Error('arguments');
      seen.add(flag);
      if (flag === '--run') options.run = true;
      else {
        i += 1;
        const value = args[i];
        if (!value || !(path.isAbsolute(value) || path.win32.isAbsolute(value)))
          throw new Error('arguments');
        options[flag.slice(2)] = value;
      }
    }
    const plannedCalls = cases.filter((item) => {
      const focus = getReviewFocus({ content: item.content });
      return !focus.political && !focus.psychological;
    }).length;
    if (!options.run) {
      console.log(
        JSON.stringify({
          event: 'preview',
          cases: cases.length,
          plannedCalls,
          model: MODEL,
          message: '未读配置或数据库，未调用模型。添加 --run 才执行固定虚构文字测试；不发布帖子。',
        }),
      );
      return 0;
    }
    const stat = fs.statSync(options.config);
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('config');
    const config = JSON.parse(fs.readFileSync(options.config, 'utf8').replace(/^\uFEFF/, ''));
    const dbConfig = validateTestConfig(config);
    writer = createReportWriter(options.output);
    pool = require('mysql2/promise').createPool(dbConfig);
    const store = require('../backend/system-settings').createSystemSettingsStore({
      pool,
      encryptionKey: config.SETTINGS_ENCRYPTION_KEY,
      defaultBaseUrl: config.LLM_BASE_URL,
      defaultModel: MODEL,
    });
    const client = require('../backend/moderation-ai-client').createModerationAiClient({
      readSettings: (readOptions) => store.readSettings(readOptions),
    });
    const report = await runCases(
      client,
      (progressReport) => writer.persist(progressReport),
      (row) => console.log(JSON.stringify(row)),
    );
    console.log(
      JSON.stringify({
        event: 'summary',
        status: report.status,
        ...report.summary,
        reportJson: writer.reportPath,
        message: '一致数量不是准确率，原句适用性与模型理由仍需负责人检查。',
      }),
    );
    if (report.summary.failures || report.summary.unrun) return 1;
    return report.summary.mismatches ? 2 : 0;
  } catch {
    console.log(
      JSON.stringify({
        event: 'failed',
        message: '测试未完成。请核对测试路径、配置和模型渠道；未输出配置或密钥。',
        ...(writer ? { reportJson: writer.reportPath } : {}),
      }),
    );
    return 1;
  } finally {
    try {
      await pool?.end();
    } catch {
      /* Never print database error details. */
    }
  }
}
module.exports = { runCases, main };
if (require.main === module)
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
