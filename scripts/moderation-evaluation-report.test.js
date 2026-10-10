const test = require('node:test');
const assert = require('node:assert/strict');
const { POLICY_VERSION } = require('../backend/moderation-policy');
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
