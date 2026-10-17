const QUALITY_VERSION = 'freebbs-evaluation-quality-2026-10-11-v1';
const ACTIONS = ['allow', 'hold', 'block'];
const INPUT_FIELDS = ['title', 'content'];
const plain = (value) =>
  Boolean(value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype);
const exactKeys = (value, keys) =>
  plain(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const text = (value, maximum, required = true) =>
  typeof value === 'string' &&
  value.length <= maximum &&
  (!required || Boolean(value.trim())) &&
  !Array.from(value).some((character) => {
    const code = character.codePointAt(0);
    return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
  });
const unique = (items) => new Set(items).size === items.length;
const fail = () => Object.assign(new Error('manifest_quality'), { code: 'manifest_quality' });

function validateQualityExpectations(quality, fixture) {
  if (quality === undefined) return null;
  if (
    !exactKeys(quality, [
      'expectedAction',
      'actionRationale',
      'evidenceAnchors',
      'absentFacts',
      'reviewQuestions',
    ]) ||
    !ACTIONS.includes(quality.expectedAction) ||
    !text(quality.actionRationale, 2000) ||
    !plain(fixture) ||
    !text(fixture.title, 120, false) ||
    !text(fixture.content, 6000) ||
    !Array.isArray(quality.evidenceAnchors) ||
    quality.evidenceAnchors.length < 1 ||
    quality.evidenceAnchors.length > 8 ||
    !Array.isArray(quality.absentFacts) ||
    quality.absentFacts.length > 16 ||
    !Array.isArray(quality.reviewQuestions) ||
    quality.reviewQuestions.length < 1 ||
    quality.reviewQuestions.length > 8 ||
    quality.reviewQuestions.some((item) => !text(item, 500)) ||
    !unique(quality.reviewQuestions.map((item) => item.trim()))
  )
    throw fail();
  for (const anchor of quality.evidenceAnchors) {
    if (
      !exactKeys(anchor, ['field', 'quote', 'rationale']) ||
      !INPUT_FIELDS.includes(anchor.field) ||
      !text(anchor.quote, 240) ||
      !text(anchor.rationale, 1000) ||
      !fixture[anchor.field].includes(anchor.quote)
    )
      throw fail();
  }
  if (!unique(quality.evidenceAnchors.map((item) => JSON.stringify([item.field, item.quote]))))
    throw fail();
  for (const fact of quality.absentFacts) {
    if (
      !exactKeys(fact, ['id', 'label', 'terms']) ||
      typeof fact.id !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(fact.id) ||
      !text(fact.label, 200) ||
      !Array.isArray(fact.terms) ||
      fact.terms.length < 1 ||
      fact.terms.length > 8 ||
      fact.terms.some((item) => !text(item, 80) || item !== item.trim()) ||
      !unique(fact.terms.map((item) => item.toLowerCase()))
    )
      throw fail();
  }
  if (!unique(quality.absentFacts.map((item) => item.id))) throw fail();
  return structuredClone(quality);
}

function disposition(row, quality, annotationInvalid) {
  const value = row?.policyDecision;
  const actualAction =
    plain(value) && ACTIONS.includes(value.recommendedAction) ? value.recommendedAction : null;
  const result = {
    status: 'unavailable',
    expectedAction: quality?.expectedAction || null,
    actualAction,
    reasons: [],
    actionRationale: quality?.actionRationale || null,
    publicationGuardVerified: plain(value) && value.canAutomaticallyPublish === false,
  };
  if (row?.error || !plain(row?.assessment)) {
    result.actualAction = null;
    result.reasons.push('未取得有效模型结果，无法比较最终处置。');
  } else if (annotationInvalid) {
    result.reasons.push('处置与依据标注无效，无法比较。');
  } else if (!quality && !plain(value)) {
    result.status = 'unannotated';
    result.reasons.push('旧报告未提供处置预期及可比较的实际处置，不计为一致。');
  } else if (!actualAction) {
    result.reasons.push('实际最终处置缺失或无效，不能用判断标签代替。');
  } else if (!quality) {
    result.status = 'unannotated';
    result.reasons.push('未标注预期最终处置，不计为一致。');
  } else if (actualAction !== quality.expectedAction) {
    result.status = 'review';
    result.reasons.push('实际最终处置与预期不一致，需要负责人复核。');
  } else {
    result.status = 'matched';
  }
  // Report the stored result; never recalculate a more convenient disposition from labels.
  if (plain(value) && value.canAutomaticallyPublish !== false) {
    if (result.status !== 'unavailable') result.status = 'review';
    result.reasons.push('自动发布保护异常：canAutomaticallyPublish 必须明确为 false。');
  }
  return result;
}

function grounding(row, quality, annotationInvalid) {
  const result = {
    status: 'unavailable',
    flags: [],
    reviewRequired: true,
    evidenceChecks: [],
    evidenceAnchors: quality?.evidenceAnchors || [],
    reviewQuestions: quality?.reviewQuestions || [],
  };
  if (row?.error || !plain(row?.assessment)) return result;
  const flag = (code, field, message, quote) => {
    result.flags.push({ code, field, message, ...(quote ? { quote } : {}) });
  };
  if (annotationInvalid)
    flag('annotation_invalid', 'metadata.quality', '依据标注无效，需修正后再比较。');
  const { assessment } = row;
  const explanations = [];
  for (const field of ['reason', 'supportReason']) {
    if (text(assessment[field], field === 'reason' ? 180 : 300, field === 'reason'))
      explanations.push({ field, value: assessment[field] });
    else flag('assessment_invalid', field, '模型理由字段缺失、类型或长度不符合约定。');
  }
  if (
    !Array.isArray(assessment.uncertainties) ||
    assessment.uncertainties.length > 4 ||
    assessment.uncertainties.some((item) => !text(item, 300))
  )
    flag('assessment_invalid', 'uncertainties', '待核实事项格式不符合约定。');
  else
    assessment.uncertainties.forEach((value, index) => {
      explanations.push({ field: `uncertainties[${index}]`, value });
    });
  if (!Array.isArray(assessment.ruleMatches) || assessment.ruleMatches.length > 6) {
    flag('evidence_unavailable', 'ruleMatches', '规则证据列表缺失或不符合约定，无法核验引文。');
  } else {
    assessment.ruleMatches.forEach((match, index) => {
      const prefix = `ruleMatches[${index}]`;
      const check = {
        ruleId: text(match?.ruleId, 80) ? match.ruleId : null,
        field: INPUT_FIELDS.includes(match?.evidence?.field) ? match.evidence.field : null,
        quote: text(match?.evidence?.quote, 240) ? match.evidence.quote : null,
        status: 'invalid',
      };
      if (!check.field || !check.quote) {
        flag('evidence_invalid', `${prefix}.evidence`, '引文字段或引用片段不符合约定。');
      } else if (
        !text(row.fixture?.[check.field], check.field === 'title' ? 120 : 6000, false) ||
        (row.inputMode && row.inputMode !== 'synthetic_original')
      ) {
        check.status = 'unavailable';
        flag(
          'evidence_unavailable',
          `${prefix}.evidence`,
          '缺少本次实际送审字段，不能用其他文本验证引文。',
        );
      } else if (!row.fixture[check.field].includes(check.quote)) {
        flag(
          'evidence_invalid',
          `${prefix}.evidence`,
          '引文不是对应送审字段中的逐字连续片段。',
          check.quote,
        );
      } else {
        check.status = 'verified';
      }
      result.evidenceChecks.push(check);
      if (text(match?.explanation, 300))
        explanations.push({ field: `${prefix}.explanation`, value: match.explanation });
      else
        flag(
          'assessment_invalid',
          `${prefix}.explanation`,
          '规则适用解释缺失、类型或长度不符合约定。',
        );
    });
  }
  for (const fact of quality?.absentFacts || []) {
    for (const explanation of explanations) {
      const term = fact.terms.find((item) =>
        explanation.value.toLowerCase().includes(item.toLowerCase()),
      );
      if (term)
        flag(
          'absent_fact_term_mentioned',
          explanation.field,
          `提及预标注原文未提供事项“${fact.label}”的词语；仅是复核线索，需结合否定、反对、引用及上下文判断，不能据此认定编造。`,
          term,
        );
    }
  }
  // No lexical signal proves that the explanation interpreted a real quotation correctly.
  if (result.flags.length) result.status = 'flagged';
  else result.status = quality ? 'not_flagged' : 'unannotated';
  return result;
}

function evaluateQuality(row, metadata) {
  let quality = null;
  let annotationInvalid = false;
  try {
    quality = validateQualityExpectations(metadata?.quality, row?.fixture);
  } catch {
    annotationInvalid = true;
  }
  return {
    disposition: disposition(row, quality, annotationInvalid),
    grounding: grounding(row, quality, annotationInvalid),
  };
}

module.exports = { QUALITY_VERSION, validateQualityExpectations, evaluateQuality };
