const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildImageFixtures } = require('./moderation-image-fixtures');
const { validateAssessment } = require('../backend/moderation-ai-client');
const { POLICY_VERSION } = require('../backend/moderation-policy');
const {
  parseArguments,
  validateTestConfig,
  textFileHash,
  verifySite,
  readSettingsSnapshot,
  runImageEvaluation,
  renderHtml,
  createWriter,
  main,
} = require('./moderation-image-evaluation');

const settings = {
  baseUrl: 'https://cloud.infini-ai.com/maas/v1',
  apiKey: 'secret-test-never-output',
  revision: 1,
};
const config = {
  DISCUSSION_MODERATION_ENABLED: true,
  DISCUSSION_MODERATION_AI_TEST_ENABLED: true,
  BACKEND_IP: '127.0.0.1',
  MYSQL_PORT: 3307,
  MYSQL_DATABASE: 'free_bbs',
  MYSQL_USER: 'test',
  MYSQL_PASSWORD: 'secret-db',
};
const suitePromise = buildImageFixtures();
const response = (value, finish = 'stop') =>
  new Response(
    JSON.stringify({
      choices: [
        { finish_reason: finish, message: { role: 'assistant', content: JSON.stringify(value) } },
      ],
    }),
    { headers: { 'content-type': 'application/json' } },
  );
function answer(fixture) {
  if (fixture.kind === 'probe') return fixture.expected;
  const observation = fixture.expected.imageText.map((x) => ({
    ...x,
    description: '白底黑字的文字卡片。',
  }));
  const image = observation.at(-1);
  return {
    imageObservations: observation,
    assessment: {
      decision: fixture.expected.decision,
      categories: fixture.expected.categories,
      reason: '根据所提供图片中的具体文字与规则条件判断。',
      ruleMatches: fixture.expected.ruleIds.map((ruleId) => ({
        ruleId,
        evidence: { field: `image_${image.imageIndex}`, quote: image.text.slice(0, 120) },
        explanation: '符合具体适用条件，没有适用例外。',
      })),
      uncertainties:
        fixture.expected.decision === 'needs_review' ? ['需确认公开必要性及安全影响。'] : [],
      supportPriority: 'none',
      supportReason: '',
    },
  };
}
function harness(suite, override) {
  const counts = new Map();
  const requests = [];
  return {
    requests,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      const index = counts.get(body.model) || 0;
      counts.set(body.model, index + 1);
      const fixture = suite.cases[index];
      requests.push(body);
      return override?.({ body, fixture, index }) || response(answer(fixture));
    },
  };
}
async function run(suite, hooks = {}) {
  const transport = harness(suite, hooks.override);
  const report = await runImageEvaluation({
    suite,
    settings,
    validateAssessmentImpl: validateAssessment,
    fetchImpl: transport.fetchImpl,
    ...hooks,
  });
  return { report, requests: transport.requests };
}

test('CLI is preview by default, accepts only requested models and rejects unknown or duplicate options', () => {
  assert.equal(parseArguments([]).run, false);
  assert.deepEqual(parseArguments([]).models, ['kimi-k2.6', 'qwen3.6-27b']);
  assert.equal(parseArguments(['--suite', 'probe', '--run']).suite, 'probe');
  for (const args of [
    ['--models', 'glm-5.1'],
    ['--models', 'kimi-k2.6,kimi-k2.6'],
    ['--run', '--run'],
    ['--output', 'relative'],
    ['--unknown'],
  ])
    assert.throws(() => parseArguments(args));
});

test('isolated configuration rejects remote web/DB and disabled test mode', () => {
  assert.equal(validateTestConfig(config).port, 3307);
  for (const change of [
    { MYSQL_PORT: 3306 },
    { BACKEND_IP: 'prod.example' },
    { PUBLIC_WEB_URL: 'https://example.org' },
    { DISCUSSION_MODERATION_AI_TEST_ENABLED: false },
    { MYSQL_SOCKET: 'socket' },
  ])
    assert.throws(() => validateTestConfig({ ...config, ...change }));
});

test('all 24 synthetic requests use pixels without expected labels or local transcripts in text payload', async () => {
  const suite = await suitePromise;
  const { report, requests } = await run(suite);
  assert.equal(report.status, 'completed');
  assert.equal(report.actualCalls, 24);
  assert.equal(report.results.length, 24);
  assert.ok(report.results.every((x) => x.evaluation?.matched));
  assert.ok(
    report.summary.every((x) => x.visionVerified && x.moderationValid === 10 && x.matched === 10),
  );
  for (const body of requests) {
    const content = body.messages[1].content;
    assert.equal(content[0].type, 'image_url');
    const payloadText = content
      .filter((x) => x.type === 'text')
      .map((x) => x.text)
      .join('');
    assert.equal(payloadText.includes(suite.cases[0].expected.code), false);
    assert.equal(payloadText.includes('expected'), false);
    assert.equal(payloadText.includes('image-personal-information'), false);
    assert.equal(payloadText.includes(suite.cases[6].expected.imageText[0].text), false);
  }
  assert.equal(report.scriptPublishesPosts, false);
  assert.ok(
    report.results
      .filter((x) => x.kind === 'moderation')
      .every((x) => x.result.policyDecision.canAutomaticallyPublish === false),
  );
});

test('failed image probe skips that model moderation and still tests other model', async () => {
  const suite = await suitePromise;
  const { report } = await run(suite, {
    override: ({ body, index }) =>
      body.model === 'kimi-k2.6' && index === 0 ? response({ code: 'ZZZZZZZZ' }) : null,
  });
  assert.equal(report.actualCalls, 14);
  assert.equal(report.status, 'partial');
  assert.equal(report.summary[0].skipped, 10);
  assert.equal(report.summary[0].visionVerified, false);
  assert.equal(report.summary[1].moderationValid, 10);
});

test('probe suite only makes four calls and never claims moderation validation', async () => {
  const suite = await suitePromise;
  const { report } = await run(suite, { suiteMode: 'probe' });
  assert.equal(report.actualCalls, 4);
  assert.ok(report.summary.every((x) => x.moderationValid === 0 && x.visionVerified));
});

test('non-stop completion remains failure and never counts as safe or miss', async () => {
  const suite = await suitePromise;
  const { report } = await run(suite, {
    models: ['qwen3.6-27b'],
    override: ({ fixture, index }) => (index === 3 ? response(answer(fixture), 'length') : null),
  });
  const row = report.results[3];
  assert.equal(row.result, null);
  assert.equal(row.error.diagnostics.finishReason, 'length');
  assert.equal(report.summary[0].failed, 1);
  assert.equal(report.summary[0].suspectedMisses, 0);
});

test('three consecutive errors stop further requests without retry', async () => {
  const suite = await suitePromise;
  const { report } = await run(suite, {
    models: ['qwen3.6-27b'],
    override: ({ index }) =>
      index >= 2 ? new Response('secret-provider-error', { status: 500 }) : null,
  });
  assert.equal(report.actualCalls, 5);
  assert.equal(report.summary[0].failed, 3);
  assert.equal(report.summary[0].skipped, 7);
  assert.equal(JSON.stringify(report).includes('secret-provider-error'), false);
});

test('report persistence failure prevents further API calls', async () => {
  const suite = await suitePromise;
  let saved = 0;
  const { report } = await run(suite, {
    persist: () => {
      saved += 1;
      if (saved >= 2) throw new Error('secret-location');
    },
  });
  assert.equal(report.actualCalls, 1);
  assert.equal(report.status, 'failed');
  assert.equal(report.error.code, 'report_write');
  assert.equal(JSON.stringify(report).includes('secret-location'), false);
});

test('interrupt retains completed results and schedules no more requests', async () => {
  const suite = await suitePromise;
  let completed = 0;
  const { report } = await run(suite, {
    onProgress: () => {
      completed += 1;
    },
    shouldStop: () => completed === 1,
  });
  assert.equal(report.actualCalls, 1);
  assert.equal(report.status, 'interrupted');
});

test('locally known image text catches fabricated but self-consistent model quotation', async () => {
  const suite = await suitePromise;
  const { report } = await run(suite, {
    models: ['qwen3.6-27b'],
    override: ({ fixture, index }) => {
      if (index !== 3) return null;
      const value = answer(fixture);
      value.imageObservations[0].text = '模型编造的画面证据';
      value.assessment.ruleMatches[0].evidence.quote = '模型编造的画面证据';
      return response(value);
    },
  });
  assert.equal(report.results[3].evaluation.matched, false);
  assert.equal(report.summary[0].groundingFlagged, 1);
});

test('valid safe result on risk fixture is separated as suspected miss', async () => {
  const suite = await suitePromise;
  const { report } = await run(suite, {
    models: ['qwen3.6-27b'],
    override: ({ fixture, index }) => {
      if (index !== 3) return null;
      const value = answer(fixture);
      value.assessment = {
        ...value.assessment,
        decision: 'no_risk_detected',
        categories: [],
        ruleMatches: [],
      };
      return response(value);
    },
  });
  assert.equal(report.summary[0].suspectedMisses, 1);
  assert.equal(report.summary[0].failed, 0);
});

test('safe labels alone cannot pass when actual picture transcription is empty or invented', async () => {
  const suite = await suitePromise;
  const { report } = await run(suite, {
    models: ['qwen3.6-27b'],
    override: ({ fixture, index }) => {
      if (index !== 2) return null;
      const value = answer(fixture);
      value.imageObservations[0].text = '';
      return response(value);
    },
  });
  assert.equal(report.results[2].evaluation.labelsAndActionMatched, true);
  assert.equal(report.results[2].evaluation.matched, false);
  assert.equal(report.summary[0].transcriptionFlagged, 1);
  assert.equal(report.summary[0].suspectedMisses, 0);
});

test('site hash handles Windows CRLF while rejecting substantive source changes', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-image-site-test-'));
  try {
    const files = [
      'backend/moderation-ai-client.js',
      'backend/moderation-policy.js',
      'backend/moderation-policy-library.json',
      'backend/moderation-policy-decision.js',
      'backend/moderation-ai-diagnostics.js',
    ];
    fs.mkdirSync(path.join(directory, 'backend'));
    const source = 'first line\nsecond line\n';
    const manifest = {
      format: 'freebbs-moderation-image-package-v1',
      policyVersion: POLICY_VERSION,
      siteHashFormat: 'utf8-crlf-to-lf-sha256',
      siteFiles: Object.fromEntries(files.map((x) => [x, textFileHash(source)])),
    };
    for (const file of files)
      fs.writeFileSync(path.join(directory, file), source.replace(/\n/g, '\r\n'));
    const manifestPath = path.join(directory, 'package-manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    verifySite(directory, manifestPath);
    fs.appendFileSync(path.join(directory, files[0]), 'different');
    assert.throws(() => verifySite(directory, manifestPath), { code: 'site_version' });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('settings snapshot only reads and always closes pool, drops masked secret metadata', async () => {
  let ended = 0;
  const snapshot = await readSettingsSnapshot({
    config,
    siteRequire: (name) => {
      if (name === './node_modules/mysql2/promise')
        return {
          createPool: () => ({
            end: async () => {
              ended += 1;
            },
          }),
        };
      if (name === './backend/system-settings')
        return {
          createSystemSettingsStore: () => ({
            readSettings: async ({ includeSecret }) => {
              assert.equal(includeSecret, true);
              return { ...settings, lastFour: 'xxxx', extra: 'private' };
            },
          }),
        };
      throw new Error('unexpected module');
    },
  });
  assert.deepEqual(snapshot, settings);
  assert.equal(ended, 1);
});

test('writer uses fresh output and HTML escapes model strings, keeps images in local report', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-image-report-test-'));
  try {
    const suite = await suitePromise;
    const writer = createWriter(directory, suite);
    const { report } = await run(suite, { models: ['qwen3.6-27b'], persist: writer.persist });
    const saved = JSON.parse(fs.readFileSync(writer.comparisonJson, 'utf8'));
    assert.ok(
      fs.existsSync(
        path.join(path.dirname(writer.comparisonJson), saved.results[0].images[0].file),
      ),
    );
    report.results[0].description = '<script>alert(1)</script>';
    const html = renderHtml(report);
    assert.ok(html.includes('&lt;script&gt;'));
    assert.equal(html.includes('<script>'), false);
    assert.equal(JSON.stringify(saved).includes('dataBase64'), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('CLI preview succeeds without reading nonexistent config or writing output', async () => {
  const events = [];
  const output = path.join(os.tmpdir(), `freebbs-preview-${Date.now()}`);
  const code = await main(
    [
      '--site',
      path.resolve(__dirname, '..'),
      '--config',
      path.join(output, 'missing.json'),
      '--output',
      output,
    ],
    { write: (x) => events.push(x), noProcessSignals: true },
  );
  assert.equal(code, 0);
  assert.equal(events[0].event, 'preview');
  assert.equal(events[0].plannedCalls, 24);
  assert.equal(fs.existsSync(output), false);
});
