const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePolicyDecision } = require('../backend/moderation-policy-decision');
const {
  QUALITY_VERSION,
  validateQualityExpectations,
  evaluateQuality,
} = require('./moderation-evaluation-quality');

const fixture = () => ({
  id: 'attention',
  title: '想找人聊聊',
  content: '最近压力很大，想找人聊聊。我现在没有伤害自己的计划。',
  expectedDecision: 'no_risk_detected',
  categories: [],
  ruleIds: ['关怀-001'],
  supportPriority: 'attention',
});
const quality = () => ({
  expectedAction: 'allow',
  actionRationale: '普通求助没有独立内容风险，关怀不等于拒绝发布。',
  evidenceAnchors: [{ field: 'content', quote: '想找人聊聊', rationale: '明确表达求助意愿。' }],
  absentFacts: [{ id: 'contact', label: '联系方式', terms: ['联系方式', '手机号'] }],
  reviewQuestions: ['是否把普通求助自动升级成了紧急危险？'],
});
const assessment = () => ({
  decision: 'no_risk_detected',
  categories: [],
  reason: '这是普通心理求助，没有独立的违规内容。',
  supportPriority: 'attention',
  supportReason: '明显压力并主动求助，需要关注。',
  uncertainties: [],
  ruleMatches: [
    {
      ruleId: '关怀-001',
      evidence: { field: 'content', quote: '最近压力很大，想找人聊聊' },
      explanation: '明确痛苦和求助，但没有近期实施或正在受伤的证据。',
    },
  ],
});
const row = () => ({
  fixture: fixture(),
  inputMode: 'synthetic_original',
  assessment: assessment(),
  policyDecision: { recommendedAction: 'allow', canAutomaticallyPublish: false },
  evaluation: { result: 'matched' },
  error: null,
});
const metadata = () => ({ quality: quality() });
const rejects = (value, source = fixture()) =>
  assert.throws(() => validateQualityExpectations(value, source), { code: 'manifest_quality' });

test('quality annotations are optional, versioned and cloned independently of sent fixtures', () => {
  assert.equal(QUALITY_VERSION, 'freebbs-evaluation-quality-2026-10-11-v1');
  assert.equal(validateQualityExpectations(undefined, undefined), null);
  const original = quality();
  const copy = validateQualityExpectations(original, fixture());
  assert.deepEqual(copy, original);
  copy.evidenceAnchors[0].quote = 'changed';
  assert.equal(original.evidenceAnchors[0].quote, '想找人聊聊');
});

test('malformed, incomplete, unsafe-sized or unrecognized annotation values fail closed', () => {
  rejects(null);
  rejects([]);
  rejects(Object.create(quality()));
  for (const key of Object.keys(quality())) {
    const value = quality();
    delete value[key];
    rejects(value);
  }
  for (const patch of [
    { extra: 'not part of the contract' },
    { expectedAction: 'needs_review' },
    { actionRationale: '' },
    { actionRationale: 'x'.repeat(2001) },
    { actionRationale: 'invalid\u0000control' },
    { evidenceAnchors: [] },
    { evidenceAnchors: Array(9).fill(quality().evidenceAnchors[0]) },
    { absentFacts: Array(17).fill(quality().absentFacts[0]) },
    { reviewQuestions: [] },
    { reviewQuestions: Array(9).fill('问题') },
    { reviewQuestions: ['x'.repeat(501)] },
  ])
    rejects({ ...quality(), ...patch });
});

test('anchors must be literal contiguous quotations of the named input field', () => {
  for (const anchor of [
    { field: 'reason', quote: '想找人聊聊', rationale: '理由' },
    { field: 'title', quote: '最近压力很大', rationale: '错字段' },
    { field: 'content', quote: '想找人聊天', rationale: '近义改写不能冒充引文' },
    { field: 'content', quote: '压力很大……没有计划', rationale: '不能拼接引文' },
    { field: 'content', quote: '想找人聊聊', rationale: '理由', surprise: true },
    { field: 'content', quote: '想找人聊聊', rationale: '' },
  ])
    rejects({ ...quality(), evidenceAnchors: [anchor] });
  const value = quality();
  value.evidenceAnchors.push({ ...value.evidenceAnchors[0], rationale: '重复引用的另一个解释' });
  rejects(value);
  rejects(quality(), { title: '', content: null });
  rejects(quality(), { title: '', content: 'x'.repeat(6001) });
});

test('absent-fact and review annotations reject duplicate identities and ill-formed terms', () => {
  for (const fact of [
    { id: 'bad space', label: '联系方式', terms: ['联系方式'] },
    { id: '中文', label: '联系方式', terms: ['联系方式'] },
    { id: 'contact', label: '', terms: ['联系方式'] },
    { id: 'contact', label: '联系方式', terms: [] },
    { id: 'contact', label: '联系方式', terms: ['phone', 'PHONE'] },
    { id: 'contact', label: '联系方式', terms: [' 联系方式'] },
    { id: 'contact', label: '联系方式', terms: ['x'.repeat(81)] },
    { id: 'contact', label: '联系方式', terms: ['联系方式'], extra: true },
  ])
    rejects({ ...quality(), absentFacts: [fact] });
  const value = quality();
  rejects({ ...value, absentFacts: [value.absentFacts[0], value.absentFacts[0]] });
  rejects({ ...value, reviewQuestions: ['同一问题', ' 同一问题 '] });
});

test('the GLM ordinary-care regression compares stored hold against expected allow despite matched labels', () => {
  const value = row();
  value.assessment.uncertainties = ['后续安全情况需要关注。'];
  value.policyDecision = normalizePolicyDecision(value.assessment);
  assert.equal(value.policyDecision.recommendedAction, 'hold');
  assert.equal(value.evaluation.result, 'matched');
  const result = evaluateQuality(value, metadata());
  assert.equal(result.disposition.status, 'review');
  assert.equal(result.disposition.expectedAction, 'allow');
  assert.equal(result.disposition.actualAction, 'hold');
  assert.match(result.disposition.reasons.join(''), /实际最终处置与预期不一致/);
  assert.equal(result.disposition.publicationGuardVerified, true);
});

test('urgent care can match a protective hold without a violation label or automatic publication', () => {
  const value = row();
  value.fixture.content = '我现在已经受伤，需要身边的人立刻陪着我。';
  value.assessment.ruleMatches = [
    {
      ruleId: '关怀-002',
      evidence: { field: 'content', quote: '我现在已经受伤' },
      explanation: '已受伤的即时危险信息需要保护性人工关注。',
    },
  ];
  value.assessment.supportPriority = 'urgent';
  value.policyDecision = normalizePolicyDecision(value.assessment);
  const meta = metadata();
  meta.quality.expectedAction = 'hold';
  meta.quality.evidenceAnchors[0].quote = '我现在已经受伤';
  const result = evaluateQuality(value, meta);
  assert.equal(value.assessment.decision, 'no_risk_detected');
  assert.equal(result.disposition.status, 'matched');
  assert.equal(result.disposition.actualAction, 'hold');
  assert.equal(result.disposition.publicationGuardVerified, true);
});

test('the actual disposition is never recalculated from labels or a stored comparison result', () => {
  const value = row();
  value.policyDecision.recommendedAction = 'block';
  const result = evaluateQuality(value, metadata());
  assert.equal(result.disposition.actualAction, 'block');
  assert.equal(result.disposition.status, 'review');
});

test('absent or invalid actual dispositions cannot pass an annotated test', () => {
  for (const policyDecision of [undefined, null, [], {}, { recommendedAction: 'publish' }]) {
    const result = evaluateQuality({ ...row(), policyDecision }, metadata());
    assert.equal(result.disposition.status, 'unavailable');
    assert.equal(result.disposition.actualAction, null);
  }
});

test('automatic publication must be explicitly false even when the actual action matches', () => {
  for (const canAutomaticallyPublish of [true, undefined, null, 'false', 0]) {
    const value = row();
    value.policyDecision.canAutomaticallyPublish = canAutomaticallyPublish;
    const result = evaluateQuality(value, metadata());
    assert.equal(result.disposition.status, 'review');
    assert.equal(result.disposition.publicationGuardVerified, false);
    assert.match(result.disposition.reasons.join(''), /自动发布保护异常/);
    assert.notEqual(evaluateQuality(value, null).disposition.status, 'unannotated');
  }
});

test('legacy reports remain unannotated instead of claiming disposition or semantic correctness', () => {
  const value = row();
  delete value.policyDecision;
  const result = evaluateQuality(value, null);
  assert.equal(result.disposition.status, 'unannotated');
  assert.equal(result.grounding.status, 'unannotated');
  assert.equal(result.grounding.reviewRequired, true);
  assert.deepEqual(result.grounding.evidenceAnchors, []);
});

test('failed calls are unavailable even when stale result-shaped properties are retained', () => {
  const value = { ...row(), error: { code: 'execution_failed' } };
  const result = evaluateQuality(value, metadata());
  assert.equal(result.disposition.status, 'unavailable');
  assert.equal(result.disposition.actualAction, null);
  assert.equal(result.grounding.status, 'unavailable');
  assert.equal(result.grounding.reviewRequired, true);
});

test('absent-fact terms in all four explanation locations are only human-review clues', () => {
  const value = row();
  value.assessment.reason = '正文公开了联系方式。';
  value.assessment.supportReason = '正文还暴露了手机号。';
  value.assessment.uncertainties = ['联系方式的公开必要性。'];
  value.assessment.ruleMatches[0].explanation = '包含联系方式。';
  const result = evaluateQuality(value, metadata());
  assert.equal(result.grounding.status, 'flagged');
  assert.deepEqual(
    result.grounding.flags.map((item) => item.field),
    ['reason', 'supportReason', 'uncertainties[0]', 'ruleMatches[0].explanation'],
  );
  for (const flag of result.grounding.flags) {
    assert.equal(flag.code, 'absent_fact_term_mentioned');
    assert.match(flag.message, /仅是复核线索/);
    assert.match(flag.message, /不能据此认定编造/);
  }
  assert.equal(result.disposition.status, 'matched');
});

test('negation, opposition and quotation do not become an automatic semantic failure', () => {
  for (const reason of [
    '没有公开联系方式。',
    '作者反对公开联系方式。',
    '这里只引用了“联系方式”这个词。',
  ]) {
    const value = row();
    value.assessment.reason = reason;
    const result = evaluateQuality(value, metadata());
    assert.equal(result.grounding.status, 'flagged');
    assert.equal(result.grounding.flags[0].code, 'absent_fact_term_mentioned');
    assert.equal(result.grounding.reviewRequired, true);
    assert.equal(result.disposition.status, 'matched');
    assert.equal(Object.hasOwn(result.grounding, 'semanticCorrect'), false);
  }
});

test('fabricated quotations and quotes attributed to the wrong input field are explicit evidence flags', () => {
  for (const evidence of [
    { field: 'content', quote: '我留下了手机号' },
    { field: 'title', quote: '我现在没有伤害自己的计划' },
    { field: 'supportReason', quote: '想找人聊聊' },
    { field: 'content', quote: '' },
  ]) {
    const value = row();
    value.assessment.ruleMatches[0].evidence = evidence;
    const result = evaluateQuality(value, metadata());
    assert.equal(result.grounding.status, 'flagged');
    assert.equal(result.grounding.flags[0].code, 'evidence_invalid');
    assert.equal(result.grounding.evidenceChecks[0].status, 'invalid');
  }
});

test('an existing quotation cannot automatically establish that the model interpreted its meaning correctly', () => {
  const value = row();
  value.assessment.ruleMatches[0].evidence.quote = '我现在没有伤害自己的计划';
  value.assessment.ruleMatches[0].explanation = '这证明已有明确行动计划。';
  const result = evaluateQuality(value, metadata());
  assert.equal(result.grounding.evidenceChecks[0].status, 'verified');
  assert.equal(result.grounding.status, 'not_flagged');
  assert.equal(result.grounding.reviewRequired, true);
  assert.equal(Object.hasOwn(result.grounding, 'passed'), false);
  assert.deepEqual(result.grounding.evidenceAnchors, quality().evidenceAnchors);
  assert.deepEqual(result.grounding.reviewQuestions, quality().reviewQuestions);
});

test('missing or redacted actual input is not silently checked against the original fixture text', () => {
  const value = row();
  value.inputMode = 'redacted';
  const result = evaluateQuality(value, metadata());
  assert.equal(result.grounding.status, 'flagged');
  assert.equal(result.grounding.flags[0].code, 'evidence_unavailable');
  assert.equal(result.grounding.evidenceChecks[0].status, 'unavailable');
  delete value.inputMode;
  delete value.fixture.content;
  assert.equal(evaluateQuality(value, null).grounding.evidenceChecks[0].status, 'unavailable');
});

test('malformed model explanation fields are not counted as clean grounding', () => {
  for (const patch of [
    { reason: null },
    { supportReason: null },
    { uncertainties: 'not an array' },
    { uncertainties: [null] },
    { ruleMatches: null },
    { ruleMatches: [{ ruleId: '关怀-001', evidence: { field: 'content', quote: '想找人聊聊' } }] },
  ]) {
    const value = row();
    Object.assign(value.assessment, patch);
    assert.equal(evaluateQuality(value, metadata()).grounding.status, 'flagged');
  }
});

test('malformed optional metadata is reported rather than ignored or treated as passing', () => {
  const result = evaluateQuality(row(), { quality: {} });
  assert.equal(result.disposition.status, 'unavailable');
  assert.equal(result.grounding.status, 'flagged');
  assert.equal(result.grounding.flags[0].code, 'annotation_invalid');
});

test('XSS-like text is inert data and evaluation never mutates model output or annotations', () => {
  const value = row();
  const meta = metadata();
  const script = '<script>globalThis.freebbsQualityExecuted = true</script>';
  value.fixture.content += script;
  value.assessment.ruleMatches[0].evidence.quote = script;
  value.assessment.reason = script;
  meta.quality.evidenceAnchors[0].quote = script;
  meta.quality.absentFacts[0].label = '<img src=x onerror=alert(1)>';
  const before = JSON.stringify([value, meta]);
  const result = evaluateQuality(value, meta);
  assert.equal(globalThis.freebbsQualityExecuted, undefined);
  assert.equal(result.grounding.evidenceChecks[0].quote, script);
  assert.equal(JSON.stringify([value, meta]), before);
  result.grounding.evidenceAnchors[0].quote = 'changed';
  assert.equal(meta.quality.evidenceAnchors[0].quote, script);
});
