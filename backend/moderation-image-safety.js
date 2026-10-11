const { buildPrivacyPreview } = require('./moderation-privacy');

const SAFETY_VERSION = 'freebbs-moderation-image-safety-v2';
const REVIEW_LABEL = '图片为空白或内容未能可靠核查，发布前请负责人查看原图；不据此认定违规。';

function unquoted(value) {
  return String(value || '').replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"]*"/gu, '');
}

function hasBlankImage(value) {
  // Only the model's observation/assessment prose is inspected, never OCR or
  // user instructions. A blank background behind visible content is not a
  // blank image. Match a whole-image statement, not just the word "white".
  const text = unquoted(value);
  const visibleForeground =
    /背景/u.test(text) &&
    text
      .split(/[，,。；;！？!?\n]|但是|然而|不过|但/u)
      .some(
        (clause) =>
          !/(?:没有|并无|不存在|未见|未显示|看不到|无任何)/u.test(clause) &&
          /(?:背景上|上面|上方|前景)(?:面)?.{0,30}(?:有|可见|显示|绘有|写有).{0,30}(?:文字|图形|图案|人物|物品|建筑)/u.test(
            clause,
          ),
      );
  return text.split(/[，,。；;！？!?\n]|但是|然而|不过|但/u).some((clause) => {
    if (
      /(?:并非|不是|并不|不为|非)(?:完全|一张|纯|【)?(?:空白|纯白|纯黑|纯色|全白|全黑)/u.test(
        clause,
      )
    )
      return false;
    if (visibleForeground && /背景/u.test(clause) && !/【空白图片】/u.test(clause)) return false;
    return (
      /【空白图片】/u.test(clause) ||
      /(?:^|这|该图|图片|图像|照片|画面|附图|画布|整张图(?:片)?)(?:为|是|呈现为|显示为|看起来是)?(?:一张)?(?:完全|整张|一片|近乎|几乎)?(?:纯白(?:色)?|纯黑(?:色)?|纯色|空白|全白|全黑)(?:\/空白|空白)?(?:的)?(?:图片|图像|照片|画面|背景|画布|白纸)?\s*$/u.test(
        clause,
      )
    );
  });
}

function hasNoVisibleContent(value) {
  return /(?:未能|无法|没有|无|未)(?:找到|发现|识别|辨认|读取|显示)?(?:任何)?(?:可见|可识别|可辨认|可辨识|视觉|有效|具体)?(?:的)?内容|无有效信息|内容缺失|无(?:任何)?可见(?:文字|图形)[^。；;\n]{0,100}(?:内容|物体|图案|元素)/u.test(
    unquoted(value),
  );
}

function hasReadingBarrier(value, { imageContext = false } = {}) {
  const observation = unquoted(value).replace(/(?:并非|不是|不属于|不算)\s*【不可读图片】/gu, '');
  if (/【不可读图片】/u.test(observation)) return true;
  // Quoted content and the intended audience of a reading aid are not the
  // model's own reading limitations. Raw OCR is never passed to this helper.
  const text = observation
    .replace(
      /(?:无法|难以|不能|未能|看不清|读不清)[^，,。；;！？!?\n]{0,16}的(?:同学|学生|用户|读者|使用者|患者|群体|人)/gu,
      '',
    )
    .replace(
      /(?:没有|不存在|无|未发现|未出现)(?:任何)?(?:明显)?(?:阅读障碍|不可读|模糊|遮挡)|(?:并不|并非|不是|不)(?:模糊|不可读)|背景(?:略微|轻微|有些|较为|有点)?(?:模糊|虚化)/gu,
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
      /(?:看不清|看不出|读不清|不可读|不可辨认|不可识别)|(?:无法|难以|不能|未能|不可)(?:可靠|准确|清楚|完整|有效|清晰)?(?:地)?(?:辨认|辨识|识别|读取|读出|判读|解析|显示|打开|看清|看出)|(?:图片|图像|照片|附图)(?:完全|严重|已)?损坏/u.test(
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

function getImageSafety({ assessment, imageObservations = [] } = {}) {
  const affected = new Set();
  const reasons = new Set();
  for (const observation of imageObservations) {
    const description = String(observation.description || '');
    if (hasReadingBarrier(description, { imageContext: true })) {
      affected.add(observation.imageIndex);
      reasons.add('image_readability_uncertain');
    } else if (hasBlankImage(description)) {
      affected.add(observation.imageIndex);
      reasons.add('image_blank_requires_review');
    } else if (!String(observation.text || '').trim() && hasNoVisibleContent(description)) {
      affected.add(observation.imageIndex);
      reasons.add('image_content_unavailable');
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
  if (
    hasBlankImage(assessment?.reason) ||
    (assessment?.uncertainties || []).some((value) => hasBlankImage(value))
  ) {
    reasons.add('image_blank_requires_review');
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
    recommendedAction: decision.recommendedAction === 'block' ? 'block' : 'hold',
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
