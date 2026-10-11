const { buildPrivacyPreview } = require('./moderation-privacy');

const SAFETY_VERSION = 'freebbs-moderation-image-safety-v1';
const REVIEW_LABEL = '图片关键信息未能可靠核查，请负责人查看原图；不据此认定违规。';

function hasReadingBarrier(value, { imageContext = false } = {}) {
  // Quoted content and the intended audience of a reading aid are not the
  // model's own reading limitations. Raw OCR is never passed to this helper.
  const text = String(value || '')
    .replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"]*"/gu, '')
    .replace(
      /(?:无法|难以|不能|未能|看不清|读不清)[^，,。；;！？!?\n]{0,16}的(?:同学|学生|用户|读者|使用者|患者|群体|人)/gu,
      '',
    )
    .replace(
      /(?:没有|不存在|无|未发现|未出现)(?:任何)?(?:明显)?(?:阅读障碍|模糊|遮挡)|(?:并不|并非|不)模糊|背景(?:略微|轻微|有些|较为|有点)?(?:模糊|虚化)/gu,
      '',
    );
  // Judge regions independently: a clear heading cannot certify a blurred
  // corner. In assessment prose require a visual-reading context as well.
  return text.split(/[，,。；;！？!?\n]|但是|然而|不过|但/u).some((clause) => {
    const visualContext =
      imageContext ||
      /(?:图片|截图|附图|照片|画面|图中|图像|字迹|字幕|关键文字|分辨率|清晰度|读图|识图|OCR|模型)/iu.test(
        clause,
      ) ||
      /(?:文字|正文|标注).{0,8}(?:无法|难以|不能|未能|不可|模糊|遮挡)/u.test(clause);
    if (!visualContext) return false;
    if (
      /(?:看不清|看不出|读不清|不可辨认|不可识别)|(?:无法|难以|不能|未能|不可)(?:可靠|准确|清楚|完整|有效|清晰)?(?:地)?(?:辨认|辨识|识别|读取|读出|看清|看出)/u.test(
        clause,
      )
    )
      return true;
    return (
      /(?:模糊|分辨率(?:过低|不足)|清晰度(?:过低|不足)|严重压缩|关键.{0,6}遮挡)/u.test(clause) &&
      /(?:图|照片|文字|正文|内容|字迹|画面|清晰度|分辨率)/u.test(clause)
    );
  });
}

function getImageSafety({ title = '', content = '', assessment, imageObservations = [] } = {}) {
  const dependsOnImage =
    /(?:看|见|阅读|结合|参见|详见|请看).{0,12}(?:图|截图|附图)|(?:图|截图|附图).{0,12}(?:为准|内容|所示|说明)/u.test(
      `${title}\n${content}`,
    );
  const affected = new Set();
  const reasons = new Set();
  for (const observation of imageObservations) {
    const description = String(observation.description || '');
    if (hasReadingBarrier(description, { imageContext: true })) {
      affected.add(observation.imageIndex);
      reasons.add('image_readability_uncertain');
    } else if (
      dependsOnImage &&
      !String(observation.text || '').trim() &&
      /(?:未能|无法|没有|无)(?:找到|发现|识别|辨认|读取)?(?:任何)?(?:可识别|可辨认|有效|具体)?(?:的)?内容|无有效信息|内容缺失/u.test(
        description,
      ) &&
      !/(?:纯色|白底|空白背景|空白画布|风景|天空|山水|树木|建筑|草地)/u.test(description)
    ) {
      affected.add(observation.imageIndex);
      reasons.add('image_dependent_content_unavailable');
    }
  }
  if (
    (assessment?.uncertainties || []).some((value) =>
      hasReadingBarrier(value, { imageContext: true }),
    ) ||
    hasReadingBarrier(assessment?.reason)
  ) {
    reasons.add('image_readability_uncertain');
    imageObservations.forEach((observation) => affected.add(observation.imageIndex));
  }
  return {
    version: SAFETY_VERSION,
    requiresHumanReview: reasons.size > 0,
    reasons: [...reasons],
    imageIndices: [...affected].filter(Number.isInteger).sort((a, b) => a - b),
    reasonLabels: reasons.size ? [REVIEW_LABEL] : [],
    // This checks the model's reading limitations, not independent pixel quality.
    independentlyVerified: false,
  };
}

function applyImageSafety(decision, safety) {
  if (!safety.requiresHumanReview)
    return {
      ...decision,
      reasons: [...decision.reasons],
      reasonLabels: [...decision.reasonLabels],
    };
  return {
    ...decision,
    recommendedAction: 'hold',
    reasons: [...new Set([...decision.reasons, ...safety.reasons])],
    reasonLabels: [...decision.reasonLabels, REVIEW_LABEL],
    canAutomaticallyPublish: false,
    imagesReviewed: false,
  };
}

function redactDescription(value) {
  if (!value) return '';
  try {
    return buildPrivacyPreview({ content: String(value) }).content;
  } catch {
    return '说明暂不可展示，请负责人查看受限原始记录。';
  }
}

function buildImageDisplay(assessment, observations) {
  const privateContext =
    assessment.categories.includes('privacy') ||
    assessment.ruleMatches.some((match) => /^隐私-/u.test(match.ruleId));
  const displayAssessment = {
    ...assessment,
    categories: [...assessment.categories],
    reason: privateContext
      ? '内容涉及个人身份编号、联系方式或精确位置等信息，请负责人按所列规则核查公开范围与安全风险。'
      : redactDescription(assessment.reason),
    ruleMatches: assessment.ruleMatches.map((match) => ({
      ...match,
      evidence: { ...match.evidence },
      explanation: privateContext
        ? match.ruleId === '隐私-003'
          ? '作者声称公开本人完整编号、凭据或精确寝室信息，需安全复核；不据此认定违法或恶意。'
          : match.ruleId === '隐私-001'
            ? '内容涉及他人身份或精确联系定位信息，请核查公开依据及必要性。'
            : '另有规则匹配，具体适用条件请负责人结合受限原始证据核查。'
        : redactDescription(match.explanation),
    })),
    uncertainties: assessment.uncertainties.map((value) =>
      privateContext
        ? '模型指出存在待核实事项，请负责人查看受限原始记录。'
        : redactDescription(value),
    ),
    supportReason: assessment.supportReason
      ? privateContext
        ? '存在需要负责人关注的支持信号，请查看受限原始记录。'
        : redactDescription(assessment.supportReason)
      : '',
  };
  const displayObservations = observations.map((observation) => ({
    ...observation,
    description: privateContext
      ? '图片含待核查的个人资料，普通说明仅展示信息类型；原文仅供有权限的负责人查看。'
      : redactDescription(observation.description),
  }));
  return { displayAssessment, displayObservations, displayVersion: SAFETY_VERSION };
}

module.exports = {
  SAFETY_VERSION,
  hasReadingBarrier,
  getImageSafety,
  applyImageSafety,
  buildImageDisplay,
};
