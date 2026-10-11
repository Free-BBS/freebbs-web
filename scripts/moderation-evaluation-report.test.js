const test = require('node:test');
const assert = require('node:assert/strict');
const { POLICY_VERSION } = require('../backend/moderation-policy');
const { CONTRACT_VERSION, FAILURE_CODES } = require('../backend/moderation-ai-diagnostics');
const {
  buildComparison,
  renderHtml,
  compareRow,
  percentile,
} = require('./moderation-evaluation-report');

const fixture = (id, decision = 'no_risk_detected', ruleIds = [], support = 'none') => ({
  id,
  title: `样例 ${id}`,
  content: '这是一条编写的校园讨论文字。',
  expectedDecision: decision,
  categories: ruleIds.some((rule) => rule.startsWith('骚扰')) ? ['harassment'] : [],
  ruleIds,
  supportPriority: support,
  reason: '用于核对统计口径。',
  syntheticConfirmed: true,
  policyVersion: POLICY_VERSION,
});
const row = (f, decision = f.expectedDecision, options = {}) => ({
  fixture: f,
  assessment: {
    decision,
    categories: f.categories,
    ruleMatches: f.ruleIds.map((ruleId) => ({
      ruleId,
      evidence: { field: 'content', quote: f.content },
      explanation: '证据适用说明。',
    })),
    supportPriority: f.supportPriority,
    supportReason: '',
    uncertainties: [],
    reason: '模型返回的业务理由。',
  },
  evaluation: { result: 'review', differences: ['ruleIds'] },
  error: null,
  networkAttempted: true,
  settingsRevision: 'revision-a',
  elapsedMs: 1000,
  ...options,
});
const plan = (cases, rows, extra = {}) => ({
  policyVersion: POLICY_VERSION,
  suite: 'full',
  selectedModels: ['model-a', 'model-b'],
  startedAt: '2026-10-10T00:00:00.000Z',
  completedAt: '2026-10-10T00:01:00.000Z',
  status: 'completed',
  stopReason: null,
  plannedCases: cases,
  models: [{ model: 'model-a', status: 'completed', results: rows }],
  ...extra,
});

test('service failures and unprocessed cases never count as semantic misses', () => {
  const cases = [
    fixture('normal'),
    fixture('risk', 'high_risk', ['骚扰-001']),
    fixture('review', 'needs_review', ['骚扰-001']),
    fixture('care', 'no_risk_detected', ['关怀-002'], 'urgent'),
    fixture('failed'),
  ];
  const care = row(cases[3]);
  care.assessment.supportPriority = 'attention';
  const input = plan(cases, [
    row(cases[0], 'needs_review'),
    row(cases[1], 'no_risk_detected'),
    row(cases[2], 'needs_review'),
    care,
    row(cases[4], 'no_risk_detected', {
      assessment: null,
      error: { status: 504, message: '模型调用超时。' },
      elapsedMs: 15000,
    }),
  ]);
  const report = buildComparison(input);
  const m = report.models[0].metrics;
  assert.equal(m.validResults, 4);
  assert.equal(m.failed, 1);
  assert.equal(m.normalEscalations, 1);
  assert.equal(m.riskReleased, 1);
  assert.equal(m.highRiskDowngraded, 1);
  assert.equal(m.careUnderstated, 1);
  assert.equal(m.decisionConfusion.needs_review.needs_review, 1);
  assert.equal(m.latency.p95Ms, 1000);
  assert.equal(report.summary.unprocessed, 5);
  assert.equal(report.plannedCalls, 10);
});

test('predeclared alternative rule sets match separately and never overwrite original evaluation', () => {
  const f = fixture('overlap', 'high_risk', ['骚扰-001']);
  const r = row(f);
  r.assessment.ruleMatches = [
    {
      ruleId: '骚扰-002',
      evidence: { field: 'content', quote: f.content },
      explanation: '同类规则的合理选择。',
    },
  ];
  const manifest = {
    annotationStatus: 'draft_pending_owner_review',
    cases: {
      overlap: {
        ruleFocus: ['骚扰-001', '骚扰-002'],
        bucket: 'prohibited',
        acceptedExpectations: [
          {
            expectedDecision: 'high_risk',
            categories: ['harassment'],
            ruleIds: ['骚扰-002'],
            supportPriority: 'none',
          },
        ],
      },
    },
  };
  const input = plan([f], [r], { manifest });
  const before = JSON.stringify(input);
  const report = buildComparison(input);
  assert.equal(report.models[0].metrics.primaryMatches, 0);
  assert.equal(report.models[0].metrics.acceptedVariantMatches, 1);
  assert.equal(report.models[0].metrics.labelsToReview, 0);
  assert.equal(report.models[0].results[0].evaluation.result, 'review');
  assert.equal(report.models[0].results[0].comparisonEvaluation.acceptedExpectationIndex, 1);
  assert.equal(report.models[0].byRule.length, 2);
  assert.equal(JSON.stringify(input), before);
  assert.equal(buildComparison(report).sampleSetSha256, report.sampleSetSha256);
});

test('care-only review is counted separately without accepting changed decision labels', () => {
  const cases = [
    fixture('attention', 'no_risk_detected', ['关怀-001'], 'attention'),
    fixture('urgent', 'no_risk_detected', ['关怀-002'], 'urgent'),
  ];
  cases[1].content = '我现在已经伤害了自己，害怕继续下去，请有人马上帮助我。';
  const results = cases.map((f) => row(f, 'needs_review'));
  const report = buildComparison(plan(cases, results));
  const m = report.models[0].metrics;
  assert.equal(m.normalEscalations, 0);
  assert.equal(m.careOnlyReviews, 2);
  assert.equal(m.careUnderstated, 0);
  assert.equal(m.matchedLabels, 0);
  assert.equal(m.labelsToReview, 2);
  assert.equal(m.decisionConfusion.no_risk_detected.needs_review, 2);
  assert.equal(report.models[0].byRule[1].careOnlyReviews, 1);
  assert.equal(report.summary.careOnlyReviews, 2);
  for (const r of report.models[0].results) {
    assert.equal(r.comparisonEvaluation.result, 'review');
    assert.deepEqual(r.comparisonEvaluation.differences, ['decision']);
    assert.equal(r.evaluation.result, 'review');
  }
  const html = renderHtml(report);
  assert.match(html, /保护性关怀复核/);
  assert.match(html, /判断标签仍有差异/);
  assert.match(html, /单列该项不改变严格标签对比/);
});

test('ordinary ambiguity, prohibitions, unknown care rules and missing care remain review signals', () => {
  const ordinary = row(fixture('ordinary'), 'needs_review');
  ordinary.assessment.uncertainties = ['尚不清楚这句话是否针对某位同学。'];
  const base = fixture('care-base', 'no_risk_detected', ['关怀-002'], 'urgent');
  const lower = row({ ...base, id: 'care-lower' }, 'needs_review');
  lower.assessment.supportPriority = 'attention';
  const missing = row({ ...base, id: 'care-missing' }, 'needs_review');
  missing.assessment.ruleMatches = [];
  missing.assessment.supportPriority = 'none';
  const withRisk = row({ ...base, id: 'with-risk' }, 'needs_review');
  withRisk.assessment.categories = ['harassment'];
  withRisk.assessment.ruleMatches.push({ ruleId: '骚扰-001' });
  const unknown = row(
    fixture('unknown', 'no_risk_detected', ['关怀-999'], 'urgent'),
    'needs_review',
  );
  const inventedCare = row(
    fixture('fake-care', 'no_risk_detected', ['关怀-001'], 'urgent'),
    'needs_review',
  );
  const wrongRule = row({ ...base, id: 'wrong-rule' }, 'needs_review');
  wrongRule.assessment.ruleMatches = [{ ruleId: '关怀-001' }];
  const high = row({ ...base, id: 'high' }, 'high_risk');
  const all = [ordinary, lower, missing, withRisk, unknown, inventedCare, wrongRule, high];
  const report = buildComparison(
    plan(
      all.map((r) => r.fixture),
      all,
    ),
  );
  assert.equal(report.models[0].metrics.normalEscalations, all.length);
  assert.equal(report.models[0].metrics.careOnlyReviews, 0);
  assert.equal(report.models[0].metrics.careUnderstated, 2);
  assert.equal(report.models[0].metrics.labelsToReview, all.length);
});

test('diagnostic rendering and saved comparison retain only safe fields and accept old reports', () => {
  const marker = 'PRIVATE_DIAGNOSTIC_SHOULD_NOT_APPEAR';
  const diagnostics = {
    version: 1,
    contractVersion: CONTRACT_VERSION,
    failureCode: 'content_json_invalid',
    httpStatus: 200,
    jsonSyntaxKind: 'expected_separator',
    providerText: marker,
    contentShape: {
      startsWithObject: true,
      endsWithObject: true,
      startsWithFence: false,
      singleJsonFence: false,
      fencedJsonParseable: false,
      decodedJsonStringObject: false,
      hasBom: false,
      untrustedKey: marker,
    },
  };
  const error = { status: 502, message: '模型调用或返回格式校验失败。', diagnostics };
  const f = fixture('failed');
  const input = plan([f], [row(f, 'no_risk_detected', { assessment: null, error })], { error });
  input.models[0].error = error;
  const report = buildComparison(input);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_DIAGNOSTIC|providerText|untrustedKey/);
  assert.equal(report.models[0].results[0].error.diagnostics.httpStatus, 200);
  const html = renderHtml(report);
  assert.match(html, /模型审核正文不是有效的结构化数据/);
  assert.match(html, /供应商响应状态：200/);
  assert.match(html, /正文以对象起始符开头：是/);
  assert.match(html, /正文以代码块标记开头：否/);
  assert.match(html, /字段或数组的分隔符不正确/);
  assert.doesNotMatch(html, /PRIVATE_DIAGNOSTIC|providerText|untrustedKey/);
  const old = structuredClone(input);
  delete old.models[0].results[0].error.diagnostics;
  const oldHtml = renderHtml(old);
  assert.match(oldHtml, /模型调用或返回格式校验失败/);
  assert.doesNotMatch(oldHtml, /供应商响应状态：|返回格式检查/);
});

test('unknown diagnostic values are omitted and known failure codes have Chinese descriptions', () => {
  const f = fixture('failed');
  const marker = 'PRIVATE_DIAGNOSTIC_SHOULD_NOT_APPEAR';
  for (const failureCode of [...FAILURE_CODES, marker]) {
    const error = {
      status: 502,
      message: '模型调用或返回格式校验失败。',
      diagnostics: {
        version: 1,
        contractVersion: CONTRACT_VERSION,
        failureCode,
        httpStatus: marker,
        jsonSyntaxKind: marker,
        contentShape: { startsWithObject: marker },
      },
    };
    const report = buildComparison(
      plan([f], [row(f, 'no_risk_detected', { assessment: null, error })]),
    );
    const html = renderHtml(report);
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE_DIAGNOSTIC/);
    assert.doesNotMatch(html, /PRIVATE_DIAGNOSTIC|供应商响应状态：|语法检查|返回格式检查/);
    if (failureCode === marker) {
      assert.equal(report.models[0].results[0].error.diagnostics, undefined);
      assert.doesNotMatch(html, /失败位置/);
    } else {
      assert.match(html, /失败位置/);
      assert.doesNotMatch(html, /失败位置：<\/strong>接口校验失败/);
    }
  }
});

test('field diagnostics show fixed Chinese names and unknown count without report injection', () => {
  const attack = '<img src=x onerror=alert(1)>PRIVATE_DIAGNOSTIC';
  const error = {
    status: 502,
    message: '模型调用或返回格式校验失败。',
    diagnostics: {
      version: 1,
      contractVersion: CONTRACT_VERSION,
      failureCode: 'assessment_fields_invalid',
      httpStatus: 200,
      assessmentFields: {
        missingFields: [
          'decision',
          'categories',
          'reason',
          'ruleMatches',
          'uncertainties',
          'supportPriority',
          'supportReason',
          attack,
        ],
        unknownFieldCount: 5,
        [attack]: attack,
      },
    },
  };
  const f = fixture('fields-failed');
  const report = buildComparison(
    plan([f], [row(f, 'no_risk_detected', { assessment: null, error })]),
  );
  const html = renderHtml(report);
  assert.equal(
    report.models[0].results[0].error.diagnostics.assessmentFields.missingFields.length,
    7,
  );
  assert.match(html, /缺少必需字段（7 项）/);
  assert.match(
    html,
    /判断决定、风险类别、判断理由、适用规则及证据、不确定事项、关怀级别、关怀理由/,
  );
  assert.match(html, /额外字段数量：<\/strong>5/);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_DIAGNOSTIC|onerror|src=x/);
  assert.doesNotMatch(html, /PRIVATE_DIAGNOSTIC|onerror|src=x/);
  assert.equal(report.models[0].results[0].comparisonEvaluation.result, 'error');
  assert.equal(report.models[0].metrics.failed, 1);
  assert.equal(report.models[0].metrics.validResults, 0);
});

test('old contract diagnostics remain readable without changing their version', () => {
  const oldVersion = 'freebbs-moderation-contract-2026-10-10-v1';
  const f = fixture('old-contract');
  const error = {
    status: 502,
    message: '模型调用或返回格式校验失败。',
    diagnostics: {
      version: 1,
      contractVersion: oldVersion,
      failureCode: 'assessment_fields_invalid',
      httpStatus: 200,
    },
  };
  const report = buildComparison(
    plan([f], [row(f, 'no_risk_detected', { assessment: null, error })]),
  );
  assert.equal(report.models[0].results[0].error.diagnostics.contractVersion, oldVersion);
  const html = renderHtml(report);
  assert.match(html, /审核字段、类型或取值不符合约定/);
  assert.match(html, /供应商响应状态：200/);
  assert.doesNotMatch(html, /缺少必需字段|额外字段数量/);
  report.models[0].results[0].error.diagnostics.contractVersion = 'unknown-private-version';
  assert.doesNotMatch(renderHtml(report), /失败位置：|unknown-private-version/);
});

test('alternatives cannot excuse a risk downgrade or a missing care signal', () => {
  const f = fixture('risk', 'high_risk', ['骚扰-001']);
  const r = row(f, 'no_risk_detected');
  r.assessment.ruleMatches = [];
  r.assessment.categories = [];
  assert.equal(
    compareRow(r, {
      acceptedExpectations: [
        {
          expectedDecision: 'no_risk_detected',
          categories: [],
          ruleIds: [],
          supportPriority: 'none',
        },
      ],
    }).result,
    'review',
  );
  const c = fixture('urgent', 'no_risk_detected', ['关怀-002'], 'urgent');
  const care = row(c);
  care.assessment.supportPriority = 'none';
  care.assessment.ruleMatches = [];
  assert.equal(
    compareRow(care, {
      acceptedExpectations: [
        {
          expectedDecision: 'no_risk_detected',
          categories: [],
          ruleIds: [],
          supportPriority: 'none',
        },
      ],
    }).result,
    'review',
  );
});

test('sample percentiles use nearest rank and return null for no valid duration', () => {
  assert.equal(percentile([], 0.95), null);
  assert.equal(percentile([3000], 0.95), 3000);
  assert.equal(
    percentile(
      Array.from({ length: 20 }, (_, i) => (i + 1) * 100),
      0.95,
    ),
    1900,
  );
});

test('sample digest changes with labels and settings revisions warn about comparability', () => {
  const cases = [fixture('one'), fixture('two')];
  const report = buildComparison(
    plan(cases, [
      row(cases[0]),
      row(cases[1], 'no_risk_detected', { settingsRevision: 'revision-b' }),
    ]),
  );
  assert.equal(report.comparabilityWarnings.length, 1);
  const changed = structuredClone(cases);
  changed[0].reason = '负责人修订了预期依据。';
  const second = buildComparison(plan(changed, [row(changed[0]), row(changed[1])]));
  assert.notEqual(report.sampleSetSha256, second.sampleSetSha256);
});

test('HTML escapes every report string, includes evidence, and loads no external resources', () => {
  const attack = '</script><img src=x onerror=alert(1)><script>alert(1)</script>';
  const f = fixture('one');
  f.title = attack;
  f.content = attack;
  f.reason = attack;
  const r = row(f);
  r.assessment.reason = attack;
  r.assessment.ruleMatches = [{ ruleId: attack, explanation: attack, evidence: { quote: attack } }];
  const html = renderHtml(
    plan([f], [r], { selectedModels: ['model-a', attack], stopReason: attack }),
  );
  assert.ok(!html.includes(attack));
  assert.match(html, /&lt;\/script&gt;&lt;img/);
  assert.equal((html.match(/<script>/g) || []).length, 1);
  assert.doesNotMatch(html, /<(?:script|link|img|iframe)\b[^>]*(?:src|href)=/i);
  assert.match(html, /未开始/);
  assert.match(html, /小批 P95 不代表线上性能/);
  assert.match(html, /模型理由/);
  assert.match(html, /无风险预期被升级/);
  assert.match(html, /设置|规则版本|freebbs-policy/);
});
