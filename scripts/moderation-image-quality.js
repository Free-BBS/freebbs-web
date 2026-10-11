const QUALITY_VERSION = 'freebbs-moderation-image-quality-v4';
const normalize = (value) =>
  String(value || '')
    .normalize('NFKC')
    .replace(/[\s\p{P}\p{S}]/gu, '');
const institution = /(?:学校|校方|管理方)/u;
const consent = /(?:同意|授权|许可|审批|批准)/u;

function isReadabilityUncertainty(value) {
  const text = String(value || '').replace(/(?:并不|并未|没有|并无|不)模糊/gu, '');
  const missingVisibleInformation =
    /(?:空白(?:图像|图片|背景)?|全白|无(?:任何)?(?:可见|有效可视)?(?:文字|图形|内容)|没有(?:任何)?(?:可见|可辨认)?(?:文字|图形|内容))/u.test(
      text,
    );
  const cannotVerifyImageContent =
    /(?:无法|难以|不能)(?:核实|判断|确认|辨识|辨认|识别|读取|验证).{0,24}(?:图片|图像|原图|附图|实际内容|有效信息|有效可视内容|帖子实际意图)/u.test(
      text,
    ) || /(?:需|需要).{0,6}(?:确认|核实|查看).{0,8}原图/u.test(text);
  return (
    (missingVisibleInformation && cannotVerifyImageContent) ||
    /(?:图片|图像|图中|文字|文本|字迹|正文).{0,12}(?:模糊|看不清|不可辨)/u.test(text) ||
    /^(?:过于|太|很)?(?:模糊|看不清|不可辨)(?:[，。,.]|$)/u.test(text) ||
    /(?:清晰度|分辨率).{0,8}(?:不足|偏低|过低|太低|不够|有限)/u.test(text) ||
    /(?:低|不足的)(?:清晰度|分辨率)/u.test(text) ||
    (/(?:图片|图像|图中|文字|文本|字迹)/u.test(text) &&
      /(?:无法|难以)(?:可靠|准确|清楚|完整|有效)?(?:地)?(?:辨认|辨识|识别|读取)(?!身份|作者|学号归属)/u.test(
        text,
      ))
  );
}

function isUnreadableNotice(value) {
  // Accept short limitation-only OCR placeholders, not a paragraph that mixes
  // "blurred" with claimed content. All other nonempty text is flagged for a
  // human to inspect; it is not automatically declared fabricated.
  const compact = normalize(value);
  if (
    /^(?:图片|图像|图中)?(?:为|是|呈现为)?(?:全白|纯白|空白)(?:背景|图像|图片)?(?:无|没有)?(?:任何)?(?:可见)?(?:文字|图形|内容)?(?:或图形)?$/u.test(
      compact,
    )
  ) {
    return true;
  }
  return (
    compact.length <= 100 &&
    isReadabilityUncertainty(value) &&
    /^(?:(?:第[一二三四五六七八九十0-9]+张)|图片|图像|图中|文字|文本|字迹|内容|具体|任何|过于|模糊|看不清|不可辨认|不可识别|无法|难以|可靠|准确|清楚|完整|有效|辨认|辨识|识别|读取|的|太|很|已|因|因此|且|并|需|需要|请|更|清晰|原图|人工|核查|复核|查看|提供|关键|全部|清晰度|分辨率|不足|较低|过低|低|不够|地)+$/u.test(
      compact,
    )
  );
}

// This flags language for a reviewer; it does not establish a legal requirement
// or repair the provider's assessment. Negated requirements stay distinguishable
// from inability to verify a newly invented requirement (e.g. 无法确认是否经过...).
function institutionConsentClaim(value) {
  return String(value || '')
    .split(/[。！？!?；;\n，,]/u)
    .some((clause) => {
      if (!institution.test(clause) || !consent.test(clause)) return false;
      if (
        !/(?:学校|校方)/u.test(clause) &&
        /(?:本站|本平台|平台|网站|审核).{0,6}管理方/u.test(clause)
      )
        return false;
      if (
        /(?:无需|不需要|不要求|不应要求|未要求|不必|不应当要求|不能凭空要求|没有要求|并非要求|无须)/u.test(
          clause,
        )
      )
        return false;
      if (/(?:同意|授权|许可|审批|批准).{0,8}(?:不能|不可|不应).{0,8}替代/u.test(clause))
        return false;
      if (/不能因为.{0,20}(?:同意|授权|许可|审批|批准).{0,8}就/u.test(clause)) return false;
      if (/(?:不作为|不是|并非).{0,10}(?:前提|条件|要求|依据)/u.test(clause)) return false;
      return /(?:需|应|必须|确认|核实|核查|判断|是否|经过|获得|取得|缺少|缺乏|未经|待)/u.test(
        clause,
      );
    });
}

function checkReasonQuality(fixture, result) {
  const quality = fixture.expected.quality || {};
  const assessment = result.assessment;
  const fields = [
    ['reason', assessment.reason],
    ['supportReason', assessment.supportReason],
    ...assessment.uncertainties.map((value, index) => [`uncertainties[${index}]`, value]),
    ...assessment.ruleMatches.map((match, index) => [
      `ruleMatches[${index}].explanation`,
      match.explanation,
    ]),
    ...result.imageObservations.map((image) => [
      `image_${image.imageIndex}.description`,
      image.description,
    ]),
  ];
  const issues = [];
  for (const [field, value] of fields) {
    if (
      (quality.sensitiveValues || []).some(
        (secret) => normalize(secret) && normalize(value).includes(normalize(secret)),
      )
    ) {
      issues.push({
        code: 'privacy_value_repeated_in_reason',
        field,
        message: '说明重复了已知虚构隐私值，应只描述信息类型。',
      });
    }
    if (quality.forbidInstitutionConsent && institutionConsentClaim(value)) {
      issues.push({
        code: 'unsupported_institution_consent',
        field,
        message: '疑似额外要求学校或管理方同意；需人工核对措辞与规则。',
      });
    }
  }
  const rules = new Set(assessment.ruleMatches.map((match) => match.ruleId));
  if (quality.privacySubject === 'self' && rules.has('隐私-001'))
    issues.push({
      code: 'self_information_treated_as_other',
      field: 'ruleMatches',
      message: '本样例只声称公开本人信息，不应额外套用他人信息规则。',
    });
  if (quality.privacySubject === 'other' && rules.has('隐私-003'))
    issues.push({
      code: 'other_information_treated_as_self',
      field: 'ruleMatches',
      message: '本样例明确公开他人资料，不应套用本人信息规则。',
    });
  if (fixture.expected.readability === 'unreadable') {
    if (!assessment.uncertainties.some(isReadabilityUncertainty)) {
      issues.push({
        code: 'missing_readability_uncertainty',
        field: 'uncertainties',
        message: '严重模糊对照需明确说明可读性限制，不能仅给出与图片无关的核查事项。',
      });
    }
  }
  return {
    version: QUALITY_VERSION,
    issues,
    checked: true,
    requiresHumanReview: true,
    limitation: '仅检查预先标注的隐私值、主体规则和有限措辞线索；未发现问题不代表理由语义已验证。',
  };
}

module.exports = {
  QUALITY_VERSION,
  normalize,
  institutionConsentClaim,
  isReadabilityUncertainty,
  isUnreadableNotice,
  checkReasonQuality,
};
