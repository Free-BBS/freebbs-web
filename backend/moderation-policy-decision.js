const { getPolicyRule, getPolicyLibrary } = require('./moderation-policy');

const REASON_LABELS = Object.freeze({
  invalid_assessment: '判断结构不完整，保留人工审核。',
  clear_rule_violation: '明确风险命中允许拦截的规则，建议负责人复核拦截。',
  uncertain_context: '存在待核实事实或语境，需人工核查。',
  rule_requires_review: '适用规则要求负责人判断。',
  content_requires_review: '文字存在风险，需人工核查。',
  no_text_risk: '未发现需要拦截的文字风险。',
  images_not_reviewed: '图片尚未检查，整份稿件仍需人工审核。',
  original_privacy_requires_review: '送审副本包含脱敏替换，原稿隐私仍需人工检查。',
  support_attention: '存在需要关注的求助信号，请提供支持；不因此处罚作者。',
  support_urgent: '存在需要紧急关注的求助信号，请优先人工关怀；不因此处罚作者。',
});

// This is a local recommendation only. The publication service must never infer
// authority to publish from a model result or from these presentation fields.
function normalizePolicyDecision(assessment, { hasImages = false, redactionCounts = {} } = {}) {
  const reasons = [];
  const matches = Array.isArray(assessment?.ruleMatches) ? assessment.ruleMatches : [];
  const rules = matches.map((match) => getPolicyRule(match?.ruleId));
  const supportPriorities = ['none', 'attention', 'urgent'];
  const riskCategories = new Set(
    rules
      .filter((rule) => rule && !rule.supportOnly && rule.recommendedAction !== 'allow')
      .map((rule) => rule.category),
  );
  const expectedSupport =
    supportPriorities[
      Math.max(
        0,
        ...rules.filter(Boolean).map((rule) => supportPriorities.indexOf(rule.supportPriority)),
      )
    ];
  let recommendedAction = 'hold';
  const valid =
    ['no_risk_detected', 'needs_review', 'high_risk'].includes(assessment?.decision) &&
    Array.isArray(assessment?.categories) &&
    assessment.categories.length === riskCategories.size &&
    new Set(assessment.categories).size === assessment.categories.length &&
    assessment.categories.every((category) => riskCategories.has(category)) &&
    (assessment.decision === 'no_risk_detected') === (assessment.categories.length === 0) &&
    Array.isArray(assessment?.ruleMatches) &&
    matches.length <= 6 &&
    new Set(matches.map((match) => match?.ruleId)).size === matches.length &&
    Array.isArray(assessment?.uncertainties) &&
    assessment.uncertainties.length <= 4 &&
    assessment.uncertainties.every(
      (item) => typeof item === 'string' && item.trim() && item.length <= 300,
    ) &&
    assessment.supportPriority === expectedSupport &&
    rules.every(Boolean);
  const supportPriority = valid ? assessment.supportPriority : 'none';
  if (!valid) reasons.push('invalid_assessment');
  else {
    const contentRules = rules.filter((rule) => !rule.supportOnly);
    const pending = assessment.uncertainties.length > 0;
    const reviewRequired = rules.some((rule) => rule.recommendedAction === 'human_review');
    if (pending) reasons.push('uncertain_context');
    if (reviewRequired) reasons.push('rule_requires_review');
    if (
      assessment.decision === 'high_risk' &&
      !pending &&
      !reviewRequired &&
      contentRules.some((rule) => rule.recommendedAction === 'block')
    ) {
      recommendedAction = 'block';
      reasons.push('clear_rule_violation');
    } else if (
      assessment.decision === 'no_risk_detected' &&
      !pending &&
      !reviewRequired &&
      !contentRules.some((rule) => rule.recommendedAction !== 'allow')
    ) {
      recommendedAction = 'allow';
      reasons.push('no_text_risk');
    } else if (!pending && !reviewRequired) reasons.push('content_requires_review');
  }
  if (hasImages) {
    if (recommendedAction === 'allow') recommendedAction = 'hold';
    reasons.push('images_not_reviewed');
  }
  // A safe redacted copy is not evidence that its unmodified original is safe.
  // Preserve this review boundary even when an unrelated text violation blocks.
  const personalFields = [
    'name',
    'studentId',
    'phone',
    'email',
    'nationalId',
    'identifier',
    'custom',
    'url',
    'address',
  ];
  if (
    personalFields.some(
      (key) => Number.isSafeInteger(redactionCounts?.[key]) && redactionCounts[key] > 0,
    )
  ) {
    if (recommendedAction === 'allow') recommendedAction = 'hold';
    reasons.push('original_privacy_requires_review');
  }
  if (supportPriority !== 'none') reasons.push(`support_${supportPriority}`);
  return {
    recommendedAction,
    supportPriority,
    reasons,
    reasonLabels: reasons.map((code) => REASON_LABELS[code]),
    canAutomaticallyPublish: false,
    imagesReviewed: false,
  };
}

function buildPolicyEvidence(assessment) {
  const seen = new Set();
  const sources = new Map(getPolicyLibrary().sources.map((source) => [source.id, source]));
  return (assessment?.ruleMatches || []).flatMap(({ ruleId }) => {
    if (seen.has(ruleId)) return [];
    seen.add(ruleId);
    const rule = getPolicyRule(ruleId);
    if (!rule) return [];
    return [
      {
        rule,
        sources: rule.sourceIds
          .map((id) => {
            const source = sources.get(id);
            return source
              ? { ...source, article: rule.sourceArticles?.[id] || source.article }
              : null;
          })
          .filter(Boolean),
      },
    ];
  });
}

module.exports = { normalizePolicyDecision, buildPolicyEvidence };
