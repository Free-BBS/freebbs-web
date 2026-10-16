const { getPolicyRule } = require('./moderation-policy');
const { TOPIC_CONTRACT_VERSION } = require('./moderation-review-topics');
const sourceKeywords = require('./moderation-review-keywords.json');

// This local routing list is separate from the prohibition rules. A keyword is
// sufficient for human review, including news, quotations, courses and denials;
// it never establishes a violation, political position or medical diagnosis.
const keywordLibrary = structuredClone(sourceKeywords);
const REVIEW_KEYWORD_VERSION = keywordLibrary.version;
const MAX_KEYWORD_MATCHES = 12;
const FOCUS_KEYS = ['political', 'psychological'];

function normalizeText(value) {
  return typeof value === 'string'
    ? value
        .normalize('NFKC')
        .toLowerCase()
        .replace(/\p{Default_Ignorable_Code_Point}/gu, '')
    : '';
}

function compileAlias(value) {
  const alias = normalizeText(value).replace(/\s/gu, '');
  if (!alias) throw new Error('Review keyword aliases must not be empty');
  if (!/[a-z0-9]/u.test(alias)) return (field) => field.compact.includes(alias);
  // Keep Latin token boundaries, but tolerate spaces inserted inside a name or
  // acronym. This does not mistake a filename such as myptsdmodule for PTSD.
  const escaped = [...alias].map((char) => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const boundary = /^[0-9.]+$/u.test(alias) ? '[a-z0-9.]' : '[a-z0-9_]';
  const pattern = new RegExp(`(?<!${boundary})${escaped.join('\\s*')}(?!${boundary})`, 'u');
  return (field) => pattern.test(field.normalized);
}

const terms = Object.fromEntries(FOCUS_KEYS.map((key) => [key, new Map()]));
for (const group of keywordLibrary.groups) {
  if (!FOCUS_KEYS.includes(group.focus)) throw new Error('Unknown review keyword group');
  for (const item of group.keywords) {
    const canonical = typeof item === 'string' ? item : item.term;
    const aliases = typeof item === 'string' ? [] : item.aliases || [];
    if (typeof canonical !== 'string' || !canonical.trim() || terms[group.focus].has(canonical)) {
      throw new Error('Review keyword terms must be nonempty and unique within a focus');
    }
    terms[group.focus].set(canonical, [canonical, ...aliases].map(compileAlias));
  }
}

function emptyFocus() {
  return {
    political: false,
    psychological: false,
    keywordVersion: REVIEW_KEYWORD_VERSION,
    topicContractVersion: TOPIC_CONTRACT_VERSION,
    keywordMatches: { political: [], psychological: [] },
  };
}

// Metadata may originate in stored snapshots. Retain only current, fixed
// canonical terms; never copy arbitrary excerpts or a supplied library version.
function mergeReviewFocus(...values) {
  const result = emptyFocus();
  for (const key of FOCUS_KEYS) {
    const matches = new Set();
    for (const value of values) {
      if (!value || typeof value !== 'object') continue;
      if (value[key] === true) result[key] = true;
      const incoming = value.keywordMatches?.[key];
      if (!Array.isArray(incoming)) continue;
      for (const term of incoming) {
        if (typeof term === 'string' && terms[key].has(term)) matches.add(term);
      }
    }
    result.keywordMatches[key] = [...terms[key].keys()]
      .filter((term) => matches.has(term))
      .slice(0, MAX_KEYWORD_MATCHES);
    if (matches.size) result[key] = true;
  }
  return result;
}

function getReviewFocus({ title = '', content = '', assessments = [], observations = [] } = {}) {
  const safeAssessments = Array.isArray(assessments) ? assessments : [];
  const safeObservations = Array.isArray(observations) ? observations : [];
  // Do not concatenate fields: a title ending with “习” and body starting with
  // “近平” must not manufacture a name absent from either field.
  const fields = [
    title,
    content,
    ...safeObservations.flatMap((item) => [item?.text, item?.description]),
  ]
    .filter((item) => typeof item === 'string' && item.length)
    .map((item) => {
      const normalized = normalizeText(item);
      return { normalized, compact: normalized.replace(/\s/gu, '') };
    });
  const result = emptyFocus();
  for (const key of FOCUS_KEYS) {
    for (const [canonical, aliases] of terms[key]) {
      if (!fields.some((field) => aliases.some((matches) => matches(field)))) continue;
      result[key] = true;
      if (result.keywordMatches[key].length < MAX_KEYWORD_MATCHES) {
        result.keywordMatches[key].push(canonical);
      }
    }
  }
  const rules = safeAssessments
    .flatMap((item) => (Array.isArray(item?.ruleMatches) ? item.ruleMatches : []))
    .map((match) => getPolicyRule(match?.ruleId))
    .filter(Boolean);
  result.political ||= safeAssessments.some((item) => item?.reviewTopics?.political?.length > 0);
  result.psychological ||= safeAssessments.some(
    (item) => item?.reviewTopics?.psychological?.length > 0,
  );
  result.political ||=
    safeAssessments.some(
      (item) => Array.isArray(item?.categories) && item.categories.includes('political_compliance'),
    ) || rules.some((rule) => rule.category === 'political_compliance');
  result.psychological ||=
    safeAssessments.some((item) => item?.supportPriority && item.supportPriority !== 'none') ||
    safeAssessments.some(
      (item) => Array.isArray(item?.categories) && item.categories.includes('self_harm'),
    ) ||
    rules.some((rule) => rule.domain === 'mental_support' || rule.category === 'self_harm');
  return result;
}

module.exports = { getReviewFocus, mergeReviewFocus, REVIEW_KEYWORD_VERSION, MAX_KEYWORD_MATCHES };
