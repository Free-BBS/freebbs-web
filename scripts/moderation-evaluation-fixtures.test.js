const test = require('node:test');
const assert = require('node:assert/strict');
const { POLICY_VERSION, getPolicyLibrary, getPolicyRule } = require('../backend/moderation-policy');
const { validateLabel } = require('../backend/moderation-audit');
const { validateDocument } = require('./moderation-policy-regression');
const fixtures = require('../test/fixtures/moderation-policy-v3.json');
const manifest = require('../test/fixtures/moderation-policy-v3-manifest.json');

const cases = new Map(fixtures.cases.map((item) => [item.id, item]));
const allowedBuckets = ['prohibited', 'normal', 'boundary', 'support', 'adversarial'];
const label = (item) => ({
  decision: item.expectedDecision,
  categories: item.categories,
  ruleIds: item.ruleIds,
  supportPriority: item.supportPriority,
});
const signature = (item) =>
  JSON.stringify({
    decision: item.expectedDecision,
    categories: [...item.categories].sort(),
    ruleIds: [...item.ruleIds].sort(),
    supportPriority: item.supportPriority,
  });
const sameSet = (left, right) => assert.deepEqual([...left].sort(), [...right].sort());

test('the corpus remains loadable by the existing regression runner without migrations or secrets', () => {
  assert.deepEqual(validateDocument(fixtures), fixtures);
  assert.equal(manifest.policyVersion, POLICY_VERSION);
  assert.equal(manifest.format, 'freebbs-moderation-evaluation-manifest-v1');
  assert.equal(manifest.syntheticOnly, true);
  assert.equal(manifest.annotationStatus, 'draft_pending_owner_review');
  sameSet(Object.keys(manifest), [
    'format',
    'policyVersion',
    'annotationStatus',
    'syntheticOnly',
    'cases',
  ]);
  sameSet(Object.keys(manifest.cases), cases.keys());
});

test('every active prohibition has an applicable case, a protected contrast and a boundary case', () => {
  for (const rule of getPolicyLibrary().rules) {
    const focused = Object.entries(manifest.cases)
      .filter(([, meta]) => meta.ruleFocus.includes(rule.id))
      .map(([id, meta]) => ({ item: cases.get(id), meta }));
    assert.ok(focused.length > 0, `${rule.id}: no coverage`);
    assert.ok(
      focused.some(
        ({ item, meta }) =>
          meta.bucket === (rule.kind === 'support' ? 'support' : 'prohibited') &&
          item.ruleIds.includes(rule.id),
      ),
      `${rule.id}: no applicable case with the focused rule in its label`,
    );
    assert.ok(
      focused.some(
        ({ item, meta }) =>
          meta.bucket === 'normal' &&
          item.expectedDecision === 'no_risk_detected' &&
          !item.ruleIds.includes(rule.id),
      ),
      `${rule.id}: no protected contrast`,
    );
    assert.ok(
      focused.some(({ meta }) => meta.bucket === 'boundary'),
      `${rule.id}: no boundary case`,
    );
  }
});

test('metadata cannot silently omit samples, invent rules or hide a new expected label', () => {
  for (const [id, meta] of Object.entries(manifest.cases)) {
    assert.ok(cases.has(id), id);
    assert.ok(allowedBuckets.includes(meta.bucket), id);
    assert.equal(typeof meta.smoke, 'boolean', id);
    assert.ok(typeof meta.rationale === 'string' && meta.rationale.trim().length >= 12, id);
    assert.ok(Array.isArray(meta.ruleFocus) && meta.ruleFocus.length > 0, id);
    assert.equal(new Set(meta.ruleFocus).size, meta.ruleFocus.length, id);
    for (const ruleId of meta.ruleFocus) assert.ok(getPolicyRule(ruleId), `${id}: ${ruleId}`);
    assert.ok(
      Object.keys(meta).every((key) =>
        ['ruleFocus', 'bucket', 'smoke', 'rationale', 'acceptedExpectations'].includes(key),
      ),
      id,
    );
    if (meta.bucket === 'normal') {
      assert.equal(cases.get(id).expectedDecision, 'no_risk_detected', id);
      assert.deepEqual(cases.get(id).categories, [], id);
    }
  }
});

test('alternative labels are complete valid tuples and never relax the decision or care level', () => {
  for (const [id, meta] of Object.entries(manifest.cases)) {
    if (!meta.acceptedExpectations) continue;
    assert.ok(Array.isArray(meta.acceptedExpectations), id);
    assert.ok(meta.acceptedExpectations.length > 0 && meta.acceptedExpectations.length <= 3, id);
    const canonical = cases.get(id);
    const seen = new Set([signature(canonical)]);
    for (const alternate of meta.acceptedExpectations) {
      sameSet(Object.keys(alternate), [
        'expectedDecision',
        'categories',
        'ruleIds',
        'supportPriority',
      ]);
      assert.doesNotThrow(() => validateLabel(label(alternate)), id);
      assert.equal(alternate.expectedDecision, canonical.expectedDecision, id);
      assert.equal(alternate.supportPriority, canonical.supportPriority, id);
      for (const focus of meta.ruleFocus.filter((ruleId) => canonical.ruleIds.includes(ruleId))) {
        assert.ok(
          alternate.ruleIds.includes(focus),
          `${id}: alternative drops focused rule ${focus}`,
        );
      }
      const serialized = signature(alternate);
      assert.ok(!seen.has(serialized), `${id}: repeated label`);
      seen.add(serialized);
    }
  }
});

test('sample text has no duplicate payloads or meta disclaimers that would turn violations into quotation', () => {
  const normalized = new Set();
  for (const item of fixtures.cases) {
    const body = `${item.title}\n${item.content}`;
    const comparison = item.content.normalize('NFKC').replace(/[\p{P}\p{Z}\s]/gu, '');
    assert.ok(!normalized.has(comparison), `${item.id}: duplicate content`);
    normalized.add(comparison);
    assert.ok(!/虚构测试|这是测试样例|请审核以下|仅供模型测试|待审核样例/.test(body), item.id);
    assert.ok(!/https?:\/\/|\bsk-[A-Za-z0-9]|\bAKIA[A-Z0-9]{16}\b/.test(body), item.id);
    assert.equal(item.syntheticConfirmed, true, item.id);
    assert.ok(item.content.length >= 15, item.id);
  }
});

test('the small default set exercises decisions, care, privacy, sexual boundaries and political criticism', () => {
  const smoke = Object.entries(manifest.cases)
    .filter(([, meta]) => meta.smoke)
    .map(([id]) => cases.get(id));
  assert.ok(smoke.length >= 10 && smoke.length <= 16, 'keep default external-call cost bounded');
  sameSet(new Set(smoke.map((item) => item.expectedDecision)), [
    'no_risk_detected',
    'needs_review',
    'high_risk',
  ]);
  sameSet(new Set(smoke.map((item) => item.supportPriority)), ['none', 'attention', 'urgent']);
  for (const category of ['privacy', 'sexual_content', 'political_compliance']) {
    assert.ok(
      smoke.some((item) => item.categories.includes(category)),
      category,
    );
  }
  assert.ok(smoke.some((item) => item.expectedDecision === 'needs_review' && !item.ruleIds.length));
  assert.ok(smoke.some((item) => item.id === 'political-security-normal'));
  assert.ok(smoke.some((item) => item.id === 'pornography-normal'));
  assert.ok(smoke.some((item) => item.id === 'adversarial-hidden-harassment'));
  assert.ok(smoke.some((item) => item.id === 'adversarial-redacted-placeholders'));
});

test('political-only matches stay reviewable and care signals do not become a violation category', () => {
  for (const item of fixtures.cases) {
    const rules = item.ruleIds.map(getPolicyRule);
    if (rules.length && rules.every((rule) => rule.category === 'political_compliance')) {
      assert.equal(item.expectedDecision, 'needs_review', item.id);
    }
    if (rules.length && rules.every((rule) => rule.kind === 'support')) {
      assert.equal(item.expectedDecision, 'no_risk_detected', item.id);
      assert.deepEqual(item.categories, [], item.id);
    }
    if (item.expectedDecision === 'high_risk') {
      assert.ok(
        rules.some((rule) => rule.kind === 'prohibition' && rule.recommendedAction === 'block'),
        item.id,
      );
    }
  }
  assert.equal(cases.get('support-urgent-current').supportPriority, 'urgent');
  assert.equal(cases.get('support-attention-current').supportPriority, 'attention');
  assert.equal(cases.get('combined-private-urgent').expectedDecision, 'needs_review');
  sameSet(cases.get('combined-private-urgent').categories, ['privacy']);
  assert.equal(cases.get('combined-private-urgent').supportPriority, 'urgent');
});
