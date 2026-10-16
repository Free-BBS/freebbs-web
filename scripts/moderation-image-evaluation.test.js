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
  selectCases,
  evaluateResult,
  summarize,
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
    imageIndex: x.imageIndex,
    text: x.text,
    description:
      fixture.expected.readability === 'unreadable'
        ? '图片模糊，正文无法可靠读取。'
        : fixture.expected.readability === 'blank'
          ? '纯白图片，无任何可见内容。'
          : '包含校园讨论文字的合成图片。',
  }));
  const image = observation.at(-1);
  return {
    imageObservations: observation,
    assessment: {
      decision: fixture.expected.decision,
      categories: [...fixture.expected.categories],
      reason:
        fixture.expected.readability === 'blank'
          ? '图片为空白图像，按本站规则暂缓发布并交人工查看。'
          : '根据所提供图片中的具体文字与规则条件判断。',
      ruleMatches: fixture.expected.ruleIds.map((ruleId) => ({
        ruleId,
        evidence: { field: `image_${image.imageIndex}`, quote: image.text.slice(0, 120) },
        explanation: '符合具体适用条件，没有适用例外。',
      })),
      uncertainties:
        fixture.expected.readability === 'unreadable'
          ? ['图片正文模糊，无法可靠读取，需要负责人检查。']
          : fixture.expected.readability === 'blank'
            ? ['图片为空白，请负责人确认附件是否完整及是否允许发布。']
            : fixture.expected.decision === 'needs_review'
              ? ['需确认公开必要性及安全影响。']
              : [],
      supportPriority: 'none',
      supportReason: '',
    },
  };
}
function harness(suite, override, suiteMode = 'full') {
  const counts = new Map();
  const requests = [];
  const cases = selectCases(suite, suiteMode);
  return {
    requests,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      const index = counts.get(body.model) || 0;
      counts.set(body.model, index + 1);
      const fixture = cases[index];
      requests.push(body);
      return override?.({ body, fixture, index }) || response(answer(fixture));
    },
  };
}
async function run(suite, hooks = {}) {
  const transport = harness(suite, hooks.override, hooks.suiteMode);
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
  assert.equal(parseArguments([]).suite, 'followup');
  assert.deepEqual(parseArguments([]).models, ['kimi-k2.6']);
  assert.deepEqual(parseArguments(['--models', 'kimi-k2.6,qwen3.6-27b']).models, [
    'kimi-k2.6',
    'qwen3.6-27b',
  ]);
  assert.equal(parseArguments(['--suite', 'probe', '--run']).suite, 'probe');
  for (const args of [
    ['--models', 'glm-5.1'],
    ['--models', 'kimi-k2.6,kimi-k2.6'],
    ['--run', '--run'],
    ['--output', 'relative'],
    ['--suite', 'unknown'],
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

test('all 31 full-suite Kimi requests use pixels without expected labels or local transcripts in text payload', async () => {
  const suite = await suitePromise;
  const { report, requests } = await run(suite);
  assert.equal(report.status, 'completed');
  assert.equal(report.actualCalls, 31);
  assert.equal(report.results.length, 31);
  assert.deepEqual(report.models, ['kimi-k2.6']);
  assert.ok(report.results.every((x) => x.evaluation?.matched));
  assert.ok(
    report.summary.every((x) => x.visionVerified && x.moderationValid === 29 && x.matched === 29),
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
    models: ['kimi-k2.6', 'qwen3.6-27b'],
    override: ({ body, index }) =>
      body.model === 'kimi-k2.6' && index === 0 ? response({ code: 'ZZZZZZZZ' }) : null,
  });
  assert.equal(report.actualCalls, 33);
  assert.equal(report.status, 'partial');
  assert.equal(report.summary[0].skipped, 29);
  assert.equal(report.summary[0].visionVerified, false);
  assert.equal(report.summary[1].moderationValid, 29);
});

test('probe suite defaults to two Kimi calls and never claims moderation validation', async () => {
  const suite = await suitePromise;
  const { report } = await run(suite, { suiteMode: 'probe' });
  assert.equal(report.actualCalls, 2);
  assert.ok(report.summary.every((x) => x.moderationValid === 0 && x.visionVerified));
});

test('filtered privacy and challenging suites preserve probes and use only their selected cases', async () => {
  const suite = await suitePromise;
  for (const [suiteMode, planned, moderation] of [
    ['privacy', 7, 5],
    ['challenging', 16, 14],
    ['followup', 21, 19],
  ]) {
    assert.equal(parseArguments(['--suite', suiteMode]).suite, suiteMode);
    const cases = selectCases(suite, suiteMode);
    assert.equal(cases.length, planned);
    assert.deepEqual(
      cases.slice(0, 2).map((fixture) => fixture.id),
      ['vision-code', 'vision-shapes'],
    );
    const { report, requests } = await run(suite, { suiteMode });
    assert.equal(report.actualCalls, planned);
    assert.equal(requests.length, planned);
    assert.equal(report.summary[0].moderationValid, moderation);
    assert.equal(report.summary[0].matched, moderation);
    assert.deepEqual(
      report.results.map((row) => row.id),
      cases.map((fixture) => fixture.id),
    );
  }
  assert.throws(() => selectCases(suite, 'unknown'), { code: 'arguments' });
});

test('explicit model comparison independently runs all 31 full-suite cases for each model', async () => {
  const suite = await suitePromise;
  const { report } = await run(suite, { models: ['kimi-k2.6', 'qwen3.6-27b'] });
  assert.equal(report.actualCalls, 62);
  assert.equal(report.plannedCalls, 62);
  assert.equal(report.summary.length, 2);
  assert.ok(report.summary.every((summary) => summary.matched === 29 && summary.failed === 0));
});

test('privacy reason quality flags preserve model output and remain separate from disposition', async () => {
  const suite = await suitePromise;
  let original;
  const { report } = await run(suite, {
    suiteMode: 'privacy',
    override: ({ fixture }) => {
      if (fixture.id !== 'image-personal-information') return null;
      original = answer(fixture);
      original.assessment.reason = '公开完整学号2099010048及栖云七号楼512B，需要人工安全核查。';
      original.assessment.uncertainties = [
        '无法判断该信息公开是否经过学校或相关管理方的知情同意。',
      ];
      return response(original);
    },
  });
  const row = report.results.find((item) => item.id === 'image-personal-information');
  assert.deepEqual(row.result.assessment, original.assessment);
  assert.deepEqual(row.result.imageObservations, original.imageObservations);
  assert.equal(row.result.contentPolicyDecision.recommendedAction, 'hold');
  assert.equal(row.evaluation.dispositionMatched, true);
  assert.equal(row.evaluation.labelsAndActionMatched, true);
  assert.equal(row.evaluation.matched, false);
  assert.deepEqual(
    new Set(row.evaluation.reasonQuality.issues.map((issue) => issue.code)),
    new Set(['privacy_value_repeated_in_reason', 'unsupported_institution_consent']),
  );
  assert.equal(report.summary[0].reasonQualityFlagged, 1);
  assert.equal(report.summary[0].dispositionMatched, 5);
  assert.equal(report.summary[0].labelsAndActionMatched, 5);
  assert.equal(report.summary[0].matched, 4);
  assert.equal(report.summary[0].suspectedMisses, 0);
});

test('unreadable controls require explicit uncertainty and separate unsafe allowance from known-risk misses', async () => {
  const suite = await suitePromise;
  const { report } = await run(suite, {
    suiteMode: 'challenging',
    override: ({ fixture }) => {
      if (fixture.id !== 'image-blur-unreadable-2') return null;
      const value = answer(fixture);
      value.assessment.decision = 'no_risk_detected';
      value.assessment.reason = '未发现明显问题。';
      value.assessment.uncertainties = [];
      return response(value);
    },
  });
  const held = report.results.find((row) => row.id === 'image-blur-unreadable-1');
  const allowed = report.results.find((row) => row.id === 'image-blur-unreadable-2');
  assert.equal(held.result.imageObservations[0].text, '');
  assert.equal(held.result.contentPolicyDecision.recommendedAction, 'hold');
  assert.deepEqual(held.result.assessment.categories, []);
  assert.deepEqual(held.result.assessment.ruleMatches, []);
  assert.equal(held.evaluation.matched, true);
  assert.equal(allowed.result.modelPolicyDecision.recommendedAction, 'allow');
  assert.equal(allowed.result.contentPolicyDecision.recommendedAction, 'hold');
  assert.equal(allowed.evaluation.matched, false);
  assert.ok(
    allowed.evaluation.reasonQuality.issues.some(
      (issue) => issue.code === 'missing_readability_uncertainty',
    ),
  );
  assert.equal(report.summary[0].unreadableAllowed, 1);
  assert.equal(report.summary[0].localUnreadableAllowed, 0);
  assert.equal(report.summary[0].suspectedMisses, 0);
  assert.equal(report.summary[0].failed, 0);
});

test('blank images are held and scored separately from normal controls and known-risk misses', async () => {
  const suite = await suitePromise;
  const { report } = await run(suite, {
    suiteMode: 'followup',
    override: ({ fixture }) => {
      if (fixture.id !== 'image-blank-background') return null;
      const value = answer(fixture);
      value.assessment.decision = 'no_risk_detected';
      value.assessment.reason = '图片完全空白，未发现明显违规内容。';
      value.assessment.uncertainties = [];
      return response(value);
    },
  });
  const blank = report.results.find((row) => row.id === 'image-blank-background');
  assert.equal(blank.expected.recommendedAction, 'hold');
  assert.equal(blank.result.modelPolicyDecision.recommendedAction, 'allow');
  assert.equal(blank.result.contentPolicyDecision.recommendedAction, 'hold');
  assert.equal(blank.evaluation.dispositionMatched, true);
  assert.equal(blank.evaluation.matched, false);
  assert.deepEqual(blank.evaluation.reasonQuality.issues, []);
  assert.equal(report.summary[0].blankAllowed, 1);
  assert.equal(report.summary[0].localBlankAllowed, 0);
  assert.equal(report.summary[0].unreadableAllowed, 0);
  assert.equal(report.summary[0].normalEscalations, 0);
  assert.equal(report.summary[0].suspectedMisses, 0);
  const escaped = structuredClone(report.results);
  escaped.find(
    (row) => row.id === 'image-blank-background',
  ).result.contentPolicyDecision.recommendedAction = 'allow';
  const summary = summarize(escaped, selectCases(suite, 'followup'), ['kimi-k2.6'])[0];
  assert.equal(summary.localBlankAllowed, 1);
  assert.equal(summary.suspectedMisses, 0);
  assert.equal(summary.normalEscalations, 0);
  assert.match(renderHtml(report), /模型建议空白放行/);
  assert.match(renderHtml(report), /本地空白放行/);
});

test('blank controls accept limitation-only OCR notices but flag claimed text', async () => {
  const fixture = (await suitePromise).cases.find((item) => item.id === 'image-blank-background');
  const value = {
    ...answer(fixture),
    contentPolicyDecision: { recommendedAction: 'hold' },
  };
  value.imageObservations[0].text = '图片为空白背景，无任何可见文字或图形。';
  assert.equal(evaluateResult(fixture, value).matched, true);
  value.imageObservations[0].text = '图中写着明天下午开会';
  assert.deepEqual(evaluateResult(fixture, value).transcriptionIssues, [
    { imageIndex: 1, issue: 'blank_control_nonempty_transcript' },
  ]);
});

test('complex screenshots accept reordered key fragments but flag missing discussion content', async () => {
  const suite = await suitePromise;
  const fixture = suite.cases.find((item) => item.id === 'image-complex-normal');
  const fragments = fixture.expected.imageText[0].fragments;
  assert.ok(fragments.length > 1);
  const value = {
    ...answer(fixture),
    contentPolicyDecision: { recommendedAction: fixture.expected.recommendedAction },
  };
  value.imageObservations[0].text = [...fragments].reverse().join('\n');
  assert.equal(evaluateResult(fixture, value).matched, true);
  value.imageObservations[0].text = fragments.slice(1).join('\n');
  const omitted = evaluateResult(fixture, value);
  assert.equal(omitted.labelsAndActionMatched, true);
  assert.equal(omitted.matched, false);
  assert.deepEqual(omitted.transcriptionIssues, [
    { imageIndex: 1, issue: 'key_image_text_missing' },
  ]);
});

test('fraud alternatives require the exact paired rule and category combination', async () => {
  const suite = await suitePromise;
  for (const id of ['image-fraud', 'image-small-risk']) {
    const fixture = suite.cases.find((item) => item.id === id);
    const value = { ...answer(fixture), contentPolicyDecision: { recommendedAction: 'block' } };
    assert.equal(evaluateResult(fixture, value).matched, true);
    value.assessment.categories.push('illegal_activity');
    value.assessment.ruleMatches.push({
      ...value.assessment.ruleMatches[0],
      ruleId: '违法交易-001',
    });
    const accepted = evaluateResult(fixture, value);
    assert.equal(accepted.matched, true);
    assert.equal(accepted.acceptedVariantMatched, true);
    value.assessment.ruleMatches.push({ ...value.assessment.ruleMatches[0], ruleId: '威胁-001' });
    value.assessment.categories.push('threat');
    assert.equal(evaluateResult(fixture, value).matched, false);
    value.assessment.ruleMatches.pop();
    value.assessment.categories.pop();
    value.assessment.categories.pop();
    assert.equal(evaluateResult(fixture, value).matched, false);
  }
});

test('followup covers real failures, privacy reasons, fraud, blur and independent normal controls', async () => {
  const selected = selectCases(await suitePromise, 'followup');
  assert.equal(selected.length, 21);
  const ids = new Set(selected.map((item) => item.id));
  for (const id of [
    'image-threat',
    'image-health-education',
    'image-privacy-other',
    'image-privacy-both',
    'image-complex-quoted-help',
    'image-small-antifraud',
    'image-privacy-self',
    'image-small-privacy',
    'image-fraud',
    'image-small-risk',
    'image-blur-unreadable-1',
    'image-blur-unreadable-2',
    'image-blur-text-region-1',
    'image-blur-text-region-2',
    'image-blank-background',
    'image-normal-suggestion',
    'image-privacy-institution',
    'image-complex-fiction',
    'image-blur-mild-normal',
  ])
    assert.ok(ids.has(id), id);
});

test('raw model reason issues remain visible when controlled display wording is present', async () => {
  const fixture = (await suitePromise).cases.find((item) => item.id === 'image-privacy-self');
  const value = { ...answer(fixture), contentPolicyDecision: { recommendedAction: 'hold' } };
  value.assessment.reason = '宿舍听澜三号楼418C应复核。';
  value.displayAssessment = { ...value.assessment, reason: '具体宿舍地址应复核。' };
  const evaluation = evaluateResult(fixture, value);
  assert.equal(evaluation.matched, false);
  assert.ok(
    evaluation.reasonQuality.issues.some(
      (issue) => issue.code === 'privacy_value_repeated_in_reason',
    ),
  );
  assert.equal(value.assessment.reason, '宿舍听澜三号楼418C应复核。');
});

test('latency median averages the middle pair for an even number of valid results', async () => {
  const suite = await suitePromise;
  const fixture = suite.cases.find((item) => item.id === 'image-normal-suggestion');
  const result = {
    ...answer(fixture),
    contentPolicyDecision: { recommendedAction: fixture.expected.recommendedAction },
  };
  const rows = [40, 10, 30, 20].map((elapsedMs) => ({
    model: 'kimi-k2.6',
    kind: 'moderation',
    group: fixture.group,
    expected: fixture.expected,
    result,
    evaluation: evaluateResult(fixture, result),
    elapsedMs,
    networkAttempted: true,
  }));
  const summary = summarize(rows, [fixture], ['kimi-k2.6'])[0];
  assert.equal(summary.latencyMs.median, 25);
  assert.equal(summary.latencyMs.p95, 40);
  assert.equal(summarize([], [fixture], ['kimi-k2.6'])[0].latencyMs.median, null);
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

test('unexpected scoring failures remain reportable without being counted as valid moderation', async () => {
  const suite = await suitePromise;
  let probeIndex = 0;
  const report = await runImageEvaluation({
    suite,
    client: {
      probe: async () => {
        const observation = suite.cases[probeIndex].expected;
        probeIndex += 1;
        return { observation };
      },
      assess: async () => ({ assessment: { reason: 'Unexpected incomplete result' } }),
    },
  });
  assert.equal(report.status, 'partial');
  assert.equal(report.summary[0].failed, 3);
  assert.equal(report.summary[0].skipped, 26);
  assert.equal(report.summary[0].moderationValid, 0);
  const html = renderHtml(report);
  assert.ok(html.includes('接口或输出失败'));
  assert.ok(html.includes('未取得有效结果'));
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
  assert.equal(report.summary[0].skipped, 26);
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
      'backend/moderation-image-client.js',
      'backend/moderation-image-safety.js',
      'backend/moderation-privacy.js',
    ];
    fs.mkdirSync(path.join(directory, 'backend'));
    const source = 'first line\nsecond line\n';
    const manifest = {
      format: 'freebbs-moderation-image-package-v3',
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
  const output = path.join(os.tmpdir(), `freebbs-preview-${Date.now()}`);
  for (const [suiteMode, plannedCalls] of [
    ['full', 31],
    ['privacy', 7],
    ['challenging', 16],
    ['followup', 21],
    ['probe', 2],
  ]) {
    const events = [];
    const code = await main(
      [
        '--site',
        path.resolve(__dirname, '..'),
        '--config',
        path.join(output, 'missing.json'),
        '--output',
        output,
        '--suite',
        suiteMode,
      ],
      { write: (x) => events.push(x), noProcessSignals: true },
    );
    assert.equal(code, 0);
    assert.equal(events[0].event, 'preview');
    assert.equal(events[0].caseCount, plannedCalls);
    assert.equal(events[0].plannedCalls, plannedCalls);
    assert.deepEqual(events[0].models, ['kimi-k2.6']);
    assert.equal(fs.existsSync(output), false);
  }
});
