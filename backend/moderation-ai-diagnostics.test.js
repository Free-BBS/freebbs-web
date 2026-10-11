const assert = require('node:assert/strict');
const test = require('node:test');
const {
  DIAGNOSTICS_VERSION,
  CONTRACT_VERSION,
  FAILURE_CODES,
  JSON_SYNTAX_KINDS,
  sanitizeDiagnostics,
  diagnoseContentShape,
  diagnoseJsonSyntax,
  diagnoseAssessmentFields,
  diagnoseReviewSignal,
  sanitizeReviewSignal,
} = require('./moderation-ai-diagnostics');

test('unverified signals retain only known enums and rule identifiers, never free text or invented labels', () => {
  const signal = diagnoseReviewSignal({
    decision: 'high_risk',
    categories: ['privacy', 'private-original', 'privacy', { secret: 'provider-secret' }],
    ruleMatches: [
      {
        ruleId: '隐私-003',
        evidence: { quote: 'private-original' },
        explanation: 'provider-secret',
      },
      { ruleId: 'UNKNOWN-private-original' },
    ],
    supportPriority: 'urgent',
    reason: 'provider-secret',
    supportReason: 'private-original',
    uncertainties: ['provider-secret'],
    rawReasoning: 'private-original',
  });
  assert.deepEqual(signal, {
    version: 1,
    reportedDecision: 'high_risk',
    reportedCategories: ['privacy'],
    reportedRuleIds: ['隐私-003'],
    reportedSupportPriority: 'urgent',
  });
  assert.deepEqual(sanitizeReviewSignal(signal), signal);
  assert.doesNotMatch(
    JSON.stringify(signal),
    /private-original|provider-secret|evidence|reason|UNKNOWN/,
  );
  assert.equal(diagnoseReviewSignal({}), undefined);
  assert.equal(
    diagnoseReviewSignal({ decision: 'provider-secret', categories: ['private-original'] }),
    undefined,
  );
  const negative = diagnoseReviewSignal({ decision: 'no_risk_detected' });
  assert.equal(negative.reportedDecision, 'no_risk_detected');
  assert.equal(negative.reportedSupportPriority, null);
  assert.deepEqual(negative.reportedRuleIds, []);
  assert.equal(sanitizeReviewSignal({ ...signal, version: 2 }), undefined);
  assert.equal(
    diagnoseReviewSignal(
      Object.defineProperty({}, 'decision', {
        get() {
          throw new Error('provider-secret');
        },
      }),
    ),
    undefined,
  );
});

test('only parsed assessment failures from HTTP 200 may carry an unverified review signal', () => {
  const reviewSignal = diagnoseReviewSignal({ decision: 'high_risk' });
  const parsedFailures = [
    'assessment_fields_invalid',
    'rule_evidence_invalid',
    'rule_unknown',
    'category_rule_mismatch',
    'support_rule_mismatch',
    'high_risk_without_block',
  ];
  for (const failureCode of FAILURE_CODES) {
    const clean = sanitizeDiagnostics(diagnostic({ failureCode, reviewSignal }));
    assert.equal(Boolean(clean.reviewSignal), parsedFailures.includes(failureCode), failureCode);
  }
  for (const httpStatus of [null, 400, 429, 500])
    assert.equal(
      sanitizeDiagnostics(
        diagnostic({ httpStatus, failureCode: 'high_risk_without_block', reviewSignal }),
      ).reviewSignal,
      undefined,
    );
});

function diagnostic(extra = {}) {
  return {
    version: DIAGNOSTICS_VERSION,
    contractVersion: CONTRACT_VERSION,
    failureCode: 'content_json_invalid',
    httpStatus: 200,
    ...extra,
  };
}

test('sanitization constructs only bounded known fields and drops provider or private text', () => {
  const shape = diagnoseContentShape('```json\n{"reason":"private-original"}\n```');
  const value = diagnostic({
    contentShape: { ...shape, secret: 'provider-secret' },
    jsonSyntaxKind: 'other',
    message: 'private-original',
    apiKey: 'provider-secret',
    body: { reason: 'private-original' },
  });
  const clean = sanitizeDiagnostics(value);
  assert.deepEqual(clean, diagnostic({ contentShape: shape, jsonSyntaxKind: 'other' }));
  assert.doesNotMatch(JSON.stringify(clean), /private-original|provider-secret|apiKey|message/);
  value.contentShape.startsWithFence = false;
  assert.equal(clean.contentShape.startsWithFence, true);
  assert.deepEqual(sanitizeDiagnostics(clean), clean);
});

test('unknown revisions and codes are rejected without coercion or exposing getter exceptions', () => {
  for (const value of [
    null,
    [],
    'private-original',
    diagnostic({ version: 2 }),
    diagnostic({ contractVersion: 'unknown' }),
    diagnostic({ contractVersion: undefined }),
    diagnostic({ failureCode: 'private-original' }),
    Object.create(diagnostic()),
    Object.defineProperty(diagnostic(), 'contentShape', {
      get() {
        throw new Error('provider-secret');
      },
    }),
  ]) {
    assert.equal(sanitizeDiagnostics(value), null);
  }
});

test('sanitization preserves every known code but never accepts arbitrary nested values', () => {
  for (const failureCode of FAILURE_CODES)
    assert.equal(sanitizeDiagnostics(diagnostic({ failureCode })).failureCode, failureCode);
  for (const httpStatus of [-1, 0, 99, 600, '200', null, Infinity])
    assert.equal(sanitizeDiagnostics(diagnostic({ httpStatus })).httpStatus, null);
  for (const httpStatus of [100, 200, 429, 503, 599])
    assert.equal(sanitizeDiagnostics(diagnostic({ httpStatus })).httpStatus, httpStatus);
  for (const contentShape of [{ startsWithObject: 'private-original' }, {}, [], 'provider-secret'])
    assert.equal(sanitizeDiagnostics(diagnostic({ contentShape })).contentShape, undefined);
  assert.equal(
    sanitizeDiagnostics(diagnostic({ jsonSyntaxKind: 'provider-secret' })).jsonSyntaxKind,
    undefined,
  );
});

test('known v1 and v2 contracts retain their actual version without inventing fields', () => {
  for (const contractVersion of [
    'freebbs-moderation-contract-2026-10-10-v1',
    'freebbs-moderation-contract-2026-10-11-v2',
  ]) {
    const clean = sanitizeDiagnostics(diagnostic({ contractVersion }));
    assert.equal(clean.contractVersion, contractVersion);
    assert.equal(clean.assessmentFields, undefined);
  }
  assert.equal(
    sanitizeDiagnostics(
      diagnostic({ contractVersion: 'freebbs-moderation-contract-2026-10-12-v3' }),
    ),
    null,
  );
});

test('assessment field diagnosis records seven missing and five unknown fields without names or values', () => {
  const fields = diagnoseAssessmentFields({
    PRIVATE_NAME_1: 'private-original',
    PRIVATE_NAME_2: 123456789,
    PRIVATE_NAME_3: ['provider-secret'],
    PRIVATE_NAME_4: { private: true },
    PRIVATE_NAME_5: null,
  });
  assert.deepEqual(fields, {
    missingFields: [
      'decision',
      'categories',
      'reason',
      'ruleMatches',
      'uncertainties',
      'supportPriority',
      'supportReason',
    ],
    unknownFieldCount: 5,
  });
  assert.doesNotMatch(JSON.stringify(fields), /PRIVATE_NAME|private|secret|123456789/);
  assert.deepEqual(
    sanitizeDiagnostics(diagnostic({ assessmentFields: fields })).assessmentFields,
    fields,
  );
});

test('assessment field diagnosis does not inspect values or coerce nonobject content', () => {
  const value = {
    decision: 123456789,
    categories: 'private-original',
    reason: ['provider-secret'],
    ruleMatches: false,
    uncertainties: null,
    supportPriority: { private: true },
  };
  Object.defineProperty(value, 'supportReason', {
    enumerable: true,
    get() {
      throw new Error('provider-secret');
    },
  });
  assert.deepEqual(diagnoseAssessmentFields(value), { missingFields: [], unknownFieldCount: 0 });
  for (const content of [null, undefined, 123456789, 'private-original', ['provider-secret']])
    assert.equal(diagnoseAssessmentFields(content), undefined);
  const many = Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [`private-${i}`, i]));
  assert.equal(diagnoseAssessmentFields(many).unknownFieldCount, 1000);
});

test('saved assessment fields whitelist names and bounded counts without coercion', () => {
  const clean = sanitizeDiagnostics(
    diagnostic({
      assessmentFields: {
        missingFields: ['decision', 'private-original', 'decision', '<script>secret</script>'],
        unknownFieldCount: 5,
        types: { decision: 'private-original' },
        providerText: 'provider-secret',
      },
    }),
  );
  assert.deepEqual(clean.assessmentFields, { missingFields: ['decision'], unknownFieldCount: 5 });
  assert.doesNotMatch(JSON.stringify(clean), /private-original|provider-secret|script|types/);
  for (const count of [-1, 1001, 0.5, '5', null, Infinity])
    assert.equal(
      sanitizeDiagnostics(
        diagnostic({
          assessmentFields: { missingFields: [], unknownFieldCount: count },
        }),
      ).assessmentFields,
      undefined,
    );
  for (const missingFields of ['decision', null, Array(65).fill('decision')])
    assert.equal(
      sanitizeDiagnostics(
        diagnostic({
          assessmentFields: { missingFields, unknownFieldCount: 0 },
        }),
      ).assessmentFields,
      undefined,
    );
});

test('shape diagnosis distinguishes whole JSON fences from prose and multiple blocks without accepting them', () => {
  const content = '{"decision":"no_risk_detected"}';
  const raw = diagnoseContentShape(content);
  assert.equal(raw.startsWithObject, true);
  assert.equal(raw.endsWithObject, true);
  assert.equal(raw.startsWithFence, false);
  for (const fenced of [
    `\u0060\u0060\u0060json\n${content}\n\u0060\u0060\u0060`,
    `\u0060\u0060\u0060\r\n${content}\r\n\u0060\u0060\u0060`,
  ]) {
    const shape = diagnoseContentShape(fenced);
    assert.equal(shape.singleJsonFence, true);
    assert.equal(shape.fencedJsonParseable, true);
    assert.throws(() => JSON.parse(fenced));
  }
  for (const source of [
    `説明\n\u0060\u0060\u0060json\n${content}\n\u0060\u0060\u0060`,
    `\u0060\u0060\u0060json\n${content}\n\u0060\u0060\u0060\n説明`,
    `\u0060\u0060\u0060json\n${content}\n\u0060\u0060\u0060\n\u0060\u0060\u0060json\n${content}\n\u0060\u0060\u0060`,
  ])
    assert.equal(diagnoseContentShape(source).singleJsonFence, false);
  assert.equal(diagnoseContentShape('```json\n[]\n```').fencedJsonParseable, false);
  assert.equal(diagnoseContentShape('```json\n{"broken":}\n```').fencedJsonParseable, false);
});

test('shape diagnosis recognizes double-encoded objects and BOM without changing their parse result', () => {
  assert.equal(
    diagnoseContentShape(JSON.stringify('{"valid":true}')).decodedJsonStringObject,
    true,
  );
  assert.equal(
    diagnoseContentShape(JSON.stringify('private-original')).decodedJsonStringObject,
    false,
  );
  assert.equal(diagnoseContentShape('\uFEFF{"valid":true}').hasBom, true);
  assert.throws(() => JSON.parse('\uFEFF{"valid":true}'));
  assert.equal(diagnoseContentShape(undefined), undefined);
  assert.equal(diagnoseContentShape('x'.repeat(65537)), undefined);
});

test('syntax diagnostics emit enums only and retain no source or parse exception text', () => {
  const cases = [
    ['{}', 'none'],
    ['{"private-original":', 'unexpected_end'],
    ['{} private-original', 'trailing_content'],
    ['{private-original: 1}', 'property_name'],
    ['{"private-original" 1}', 'expected_separator'],
    ['{"private-original":"\\x"}', 'invalid_escape'],
    ['{"private-original":"\n"}', 'control_character'],
    ['provider-secret', 'other'],
  ];
  for (const [source, expected] of cases) {
    const actual = diagnoseJsonSyntax(source);
    assert.equal(actual, expected);
    assert.ok(JSON_SYNTAX_KINDS.includes(actual));
    assert.doesNotMatch(actual, /private-original|provider-secret/);
  }
});
