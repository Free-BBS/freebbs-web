const { CATEGORIES, getPolicyRule } = require('./moderation-policy');

const DIAGNOSTICS_VERSION = 1;
const CONTRACT_VERSION = 'freebbs-moderation-contract-2026-10-11-v2';
const KNOWN_CONTRACT_VERSIONS = Object.freeze([
  'freebbs-moderation-contract-2026-10-10-v1',
  CONTRACT_VERSION,
]);
const ASSESSMENT_FIELDS = Object.freeze([
  'decision',
  'categories',
  'reason',
  'ruleMatches',
  'uncertainties',
  'supportPriority',
  'supportReason',
]);
const MAX_UNKNOWN_FIELDS = 1000;
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
  'review_topics_invalid',
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

// These are unverified, enumerated model claims, never an accepted assessment.
// No reason, quotation, unknown label, reasoning or provider text is retained.
function sanitizeReviewSignal(value) {
  try {
    if (!plainObject(value) || value.version !== 1) return undefined;
    const known = (items, predicate, maximum) =>
      Array.isArray(items)
        ? [
            ...new Set(
              items.slice(0, 64).filter((item) => typeof item === 'string' && predicate(item)),
            ),
          ].slice(0, maximum)
        : [];
    const result = {
      version: 1,
      reportedDecision: ['no_risk_detected', 'needs_review', 'high_risk'].includes(
        value.reportedDecision,
      )
        ? value.reportedDecision
        : null,
      reportedCategories: known(
        value.reportedCategories,
        (item) => CATEGORIES.includes(item),
        CATEGORIES.length,
      ),
      reportedRuleIds: known(
        value.reportedRuleIds,
        (item) => item.length <= 80 && Boolean(getPolicyRule(item)),
        6,
      ),
      reportedSupportPriority: ['none', 'attention', 'urgent'].includes(
        value.reportedSupportPriority,
      )
        ? value.reportedSupportPriority
        : null,
    };
    return result.reportedDecision !== null ||
      result.reportedSupportPriority !== null ||
      result.reportedCategories.length ||
      result.reportedRuleIds.length
      ? result
      : undefined;
  } catch {
    return undefined;
  }
}

function diagnoseReviewSignal(value) {
  try {
    if (!plainObject(value)) return undefined;
    return sanitizeReviewSignal({
      version: 1,
      reportedDecision: value.decision,
      reportedCategories: value.categories,
      reportedRuleIds: Array.isArray(value.ruleMatches)
        ? value.ruleMatches.slice(0, 64).map((item) => (plainObject(item) ? item.ruleId : null))
        : [],
      reportedSupportPriority: value.supportPriority,
    });
  } catch {
    return undefined;
  }
}

// Record only presence of our fixed field names and a bounded count. In
// particular, a provider's alternative field names and all values stay local.
function diagnoseAssessmentFields(value) {
  try {
    if (!plainObject(value)) return undefined;
    const keys = Object.keys(value);
    return {
      missingFields: ASSESSMENT_FIELDS.filter((field) => !Object.hasOwn(value, field)),
      unknownFieldCount: Math.min(
        MAX_UNKNOWN_FIELDS,
        keys.filter((field) => !ASSESSMENT_FIELDS.includes(field)).length,
      ),
    };
  } catch {
    return undefined;
  }
}

function sanitizeAssessmentFields(value) {
  if (
    !plainObject(value) ||
    !Array.isArray(value.missingFields) ||
    value.missingFields.length > 64 ||
    !Number.isInteger(value.unknownFieldCount) ||
    value.unknownFieldCount < 0 ||
    value.unknownFieldCount > MAX_UNKNOWN_FIELDS
  )
    return undefined;
  return {
    missingFields: ASSESSMENT_FIELDS.filter((field) => value.missingFields.includes(field)),
    unknownFieldCount: value.unknownFieldCount,
  };
}

// Construct a new, bounded object. Never copy provider text, input, arbitrary
// exception messages or extra diagnostic properties into a saved report.
function sanitizeDiagnostics(value) {
  try {
    if (
      !plainObject(value) ||
      value.version !== DIAGNOSTICS_VERSION ||
      !KNOWN_CONTRACT_VERSIONS.includes(value.contractVersion) ||
      !FAILURE_CODES.includes(value.failureCode)
    )
      return null;
    const result = {
      version: DIAGNOSTICS_VERSION,
      contractVersion: value.contractVersion,
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
    const assessmentFields = sanitizeAssessmentFields(value.assessmentFields);
    if (assessmentFields) result.assessmentFields = assessmentFields;
    // Only a completed, parsed assessment can supply these hints. Transport,
    // refusal, envelope and syntax failures cannot acquire model claims.
    if (
      result.httpStatus === 200 &&
      [
        'assessment_fields_invalid',
        'review_topics_invalid',
        'rule_evidence_invalid',
        'rule_unknown',
        'category_rule_mismatch',
        'support_rule_mismatch',
        'high_risk_without_block',
      ].includes(result.failureCode)
    ) {
      const signal = sanitizeReviewSignal(value.reviewSignal);
      if (signal) result.reviewSignal = signal;
    }
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
  diagnoseAssessmentFields,
  diagnoseReviewSignal,
  sanitizeReviewSignal,
};
