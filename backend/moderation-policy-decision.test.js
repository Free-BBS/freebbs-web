const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePolicyDecision, buildPolicyEvidence } = require('./moderation-policy-decision');
const { getPolicyRule } = require('./moderation-policy');

function assessment(ruleIds = [], overrides = {}) {
  const rules = ruleIds.map(getPolicyRule);
  const categories = [
    ...new Set(
      rules
        .filter((rule) => !rule.supportOnly && rule.recommendedAction !== 'allow')
        .map((rule) => rule.category),
    ),
  ];
  const priorities = ['none', 'attention', 'urgent'];
  const supportPriority =
    priorities[Math.max(0, ...rules.map((rule) => priorities.indexOf(rule.supportPriority)))];
  return {
    decision: categories.length ? 'high_risk' : 'no_risk_detected',
    categories,
    reason: '虚构判断用于检验本地动作边界。',
    ruleMatches: ruleIds.map((ruleId) => ({
      ruleId,
      evidence: { field: 'content', quote: '虚构文本' },
      explanation: '虚构解释',
    })),
    uncertainties: [],
    supportPriority,
    supportReason: supportPriority === 'none' ? '' : '虚构支持信号',
    ...overrides,
  };
}

test('clear block-capable rule requires high risk and no pending contextual questions', () => {
  const high = normalizePolicyDecision(assessment(['HAR-001']));
  assert.equal(high.recommendedAction, 'block');
  assert.ok(high.reasons.includes('clear_rule_violation'));
  assert.equal(high.canAutomaticallyPublish, false);
  assert.equal(high.imagesReviewed, false);
  assert.equal(
    normalizePolicyDecision(assessment(['HAR-001'], { decision: 'needs_review' }))
      .recommendedAction,
    'hold',
  );
  const uncertain = normalizePolicyDecision(
    assessment(['HAR-001'], { uncertainties: ['是否为受害者举报引用，尚需核实。'] }),
  );
  assert.equal(uncertain.recommendedAction, 'hold');
  assert.ok(uncertain.reasons.includes('uncertain_context'));
});

test('review-only political and fact-dispute rules cannot be promoted by a model high-risk label', () => {
  for (const ruleId of ['POL-001', 'POL-002', 'POL-003', 'MIS-002', 'GEN-001']) {
    const result = normalizePolicyDecision(assessment([ruleId]));
    assert.equal(result.recommendedAction, 'hold', ruleId);
    assert.ok(result.reasons.includes('rule_requires_review'));
    assert.ok(!result.reasons.includes('clear_rule_violation'));
  }
});

test('support is independent from violations and urgent help holds protectively without blocking', () => {
  for (const [ruleId, action, priority] of [
    ['MEN-001', 'allow', 'none'],
    ['MEN-002', 'allow', 'attention'],
    ['MEN-003', 'hold', 'urgent'],
  ]) {
    const advice = assessment([ruleId]);
    assert.equal(advice.decision, 'no_risk_detected');
    assert.deepEqual(advice.categories, []);
    const result = normalizePolicyDecision(advice);
    assert.equal(result.recommendedAction, action);
    assert.equal(result.supportPriority, priority);
    assert.ok(!result.reasons.includes('clear_rule_violation'));
  }
  const harmful = normalizePolicyDecision(assessment(['MEN-004']));
  assert.equal(harmful.recommendedAction, 'block');
  assert.equal(harmful.supportPriority, 'attention');
  assert.ok(harmful.reasonLabels.some((label) => label.includes('不因此处罚作者')));
});

test('safe text does not approve unexamined images or the original behind a redacted API copy', () => {
  for (const extra of [
    { hasImages: true },
    { inputMode: 'redacted', redactionCounts: { name: 1 } },
    { inputMode: 'redacted', redactionCounts: { address: 1 } },
    { inputMode: 'synthetic_original', redactionCounts: { studentId: 1 } },
  ]) {
    const result = normalizePolicyDecision(assessment(), extra);
    assert.equal(result.recommendedAction, 'hold');
    assert.equal(result.canAutomaticallyPublish, false);
  }
  assert.equal(
    normalizePolicyDecision(assessment(), { redactionCounts: { address: 0 } }).recommendedAction,
    'allow',
  );
  const blocked = normalizePolicyDecision(assessment(['THR-001']), {
    hasImages: true,
    redactionCounts: { phone: 1 },
  });
  assert.equal(blocked.recommendedAction, 'block');
  assert.ok(blocked.reasons.includes('images_not_reviewed'));
  assert.ok(blocked.reasons.includes('original_privacy_requires_review'));
});

test('missing, unknown, inconsistent or invented support inputs fail to a human hold', () => {
  for (const input of [
    undefined,
    {},
    { decision: 'no_risk_detected', ruleMatches: [], uncertainties: [] },
    assessment([], { ruleMatches: [{ ruleId: 'MODEL-INVENTED' }] }),
    assessment(['EXP-001'], { categories: ['other'], decision: 'high_risk' }),
    assessment([], { supportPriority: 'urgent' }),
    assessment(['HAR-001'], { categories: [] }),
    assessment([], { uncertainties: 'unknown' }),
  ]) {
    const result = normalizePolicyDecision(input);
    assert.equal(result.recommendedAction, 'hold');
    assert.ok(result.reasons.includes('invalid_assessment'));
    assert.equal(result.supportPriority, 'none');
    assert.equal(result.canAutomaticallyPublish, false);
  }
});

test('trusted source cards ignore model supplied URLs and copies cannot mutate the library', () => {
  const input = assessment(['HAR-001']);
  Object.assign(input.ruleMatches[0], {
    rule: { title: 'MODEL TITLE' },
    sources: [{ url: 'https://evil.example' }],
  });
  const evidence = buildPolicyEvidence(input);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].rule.id, 'HAR-001');
  assert.ok(evidence[0].sources.length > 0);
  assert.doesNotMatch(JSON.stringify(evidence), /MODEL TITLE|evil\.example/);
  evidence[0].rule.title = 'LOCAL MUTATION';
  evidence[0].sources[0].url = 'https://mutated.example';
  const again = buildPolicyEvidence(input);
  assert.doesNotMatch(JSON.stringify(again), /LOCAL MUTATION|mutated\.example/);
  assert.deepEqual(buildPolicyEvidence({ ruleMatches: [{ ruleId: 'INVENTED' }] }), []);
});
