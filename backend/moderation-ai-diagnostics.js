const DIAGNOSTICS_VERSION = 1;
const CONTRACT_VERSION = 'freebbs-moderation-contract-2026-10-10-v1';
const FAILURE_CODES = Object.freeze([
  'configuration_invalid',
  'input_invalid',
  'model_unavailable',
  'http_error',
  'transport_error',
  'timeout',
  'response_redirected',
  'response_body_invalid',
  'response_type_invalid',
  'response_too_large',
  'response_utf8_invalid',
  'response_json_invalid',
  'response_envelope_invalid',
  'message_invalid',
  'finish_reason_not_stop',
  'content_json_invalid',
  'assessment_fields_invalid',
  'rule_evidence_invalid',
  'rule_unknown',
  'category_rule_mismatch',
  'support_rule_mismatch',
  'high_risk_without_block',
]);
const SHAPE_KEYS = Object.freeze([
  'startsWithObject',
  'endsWithObject',
  'startsWithFence',
  'singleJsonFence',
  'fencedJsonParseable',
  'decodedJsonStringObject',
  'hasBom',
]);
const JSON_SYNTAX_KINDS = Object.freeze([
  'none',
  'unexpected_end',
  'trailing_content',
  'property_name',
  'expected_separator',
  'invalid_escape',
  'control_character',
  'other',
]);

function plainObject(value) {
  return Boolean(
    value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype,
  );
}

// Construct a new, bounded object. Never copy provider text, input, arbitrary
// exception messages or extra diagnostic properties into a saved report.
function sanitizeDiagnostics(value) {
  try {
    if (
      !plainObject(value) ||
      value.version !== DIAGNOSTICS_VERSION ||
      value.contractVersion !== CONTRACT_VERSION ||
      !FAILURE_CODES.includes(value.failureCode)
    )
      return null;
    const result = {
      version: DIAGNOSTICS_VERSION,
      contractVersion: CONTRACT_VERSION,
      failureCode: value.failureCode,
      httpStatus:
        Number.isInteger(value.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599
          ? value.httpStatus
          : null,
    };
    const shape = value.contentShape;
    if (plainObject(shape) && SHAPE_KEYS.every((key) => typeof shape[key] === 'boolean'))
      result.contentShape = Object.fromEntries(SHAPE_KEYS.map((key) => [key, shape[key]]));
    if (JSON_SYNTAX_KINDS.includes(value.jsonSyntaxKind))
      result.jsonSyntaxKind = value.jsonSyntaxKind;
    return result;
  } catch {
    return null;
  }
}

function diagnoseJsonSyntax(content) {
  try {
    JSON.parse(content);
    return 'none';
  } catch (error) {
    // Engine wording is used locally only; an unknown wording stays "other".
    const message = typeof error?.message === 'string' ? error.message : '';
    if (/unexpected end|unterminated string/i.test(message)) return 'unexpected_end';
    if (/unexpected non-whitespace character after json/i.test(message)) return 'trailing_content';
    if (/expected (?:double-quoted )?property name/i.test(message)) return 'property_name';
    if (/expected.*(?:after property|after array|after json)/i.test(message))
      return 'expected_separator';
    if (/bad (?:escaped character|unicode escape)/i.test(message)) return 'invalid_escape';
    if (/bad control character/i.test(message)) return 'control_character';
    return 'other';
  }
}

// Observation only: the client still parses the original content exactly once.
// A recognizable wrapper is not permission to strip, repair or accept it.
function diagnoseContentShape(content) {
  if (typeof content !== 'string' || content.length > 64 * 1024) return undefined;
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\r?\n([\s\S]*?)\r?\n```$/i.exec(trimmed);
  const singleJsonFence = Boolean(fenced && !/^```/m.test(fenced[1]));
  let fencedJsonParseable = false;
  let decodedJsonStringObject = false;
  if (singleJsonFence) {
    try {
      fencedJsonParseable = plainObject(JSON.parse(fenced[1]));
    } catch {
      // Parse errors may contain source text; never retain their messages.
    }
  }
  try {
    const decoded = JSON.parse(content);
    if (typeof decoded === 'string') decodedJsonStringObject = plainObject(JSON.parse(decoded));
  } catch {
    // This diagnostic must not become an alternative parser.
  }
  return {
    startsWithObject: trimmed.startsWith('{'),
    endsWithObject: trimmed.endsWith('}'),
    startsWithFence: trimmed.startsWith('```'),
    singleJsonFence,
    fencedJsonParseable,
    decodedJsonStringObject,
    hasBom: content.startsWith('\uFEFF'),
  };
}

module.exports = {
  DIAGNOSTICS_VERSION,
  CONTRACT_VERSION,
  FAILURE_CODES,
  JSON_SYNTAX_KINDS,
  sanitizeDiagnostics,
  diagnoseContentShape,
  diagnoseJsonSyntax,
};
