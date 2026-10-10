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
} = require('./moderation-ai-diagnostics');

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
