const { validateAssessment } = require('./moderation-ai-client');
const { POLICY_VERSION } = require('./moderation-policy');
const { normalizePolicyDecision, buildPolicyEvidence } = require('./moderation-policy-decision');
const { getReviewFocus } = require('./moderation-review-focus');

const TEXT_MODEL = 'qwen3.6-27b';
const IMAGE_MODEL = 'kimi-k2.6';
const fail = () =>
  Object.assign(new Error('机器审核结果无法校验，保留人工审核。'), {
    code: 'automatic_result_invalid',
  });
function metadata(value, model) {
  return (
    value?.model === model &&
    value.policyVersion === POLICY_VERSION &&
    Number.isSafeInteger(value.settingsRevision) &&
    value.settingsRevision >= 0
  );
}

// Rebuilt both in the worker and under the publication transaction. Model
// supplied action/authority/display fields are never publication authority.
function buildAutomaticResult({ textResult, imageResults = [], snapshot, elapsedMs = 0 }) {
  if (
    !snapshot ||
    !metadata(textResult, TEXT_MODEL) ||
    !Array.isArray(imageResults) ||
    !Number.isSafeInteger(snapshot.imageCount) ||
    snapshot.imageCount < 0 ||
    snapshot.imageCount > 12
  )
    throw fail();
  const assessment = validateAssessment(textResult.assessment, snapshot);
  const textDecision = normalizePolicyDecision(assessment, {
    hasImages: false,
    redactionCounts: snapshot.counts,
  });
  const images = snapshot.images || [];
  if (
    !Array.isArray(images) ||
    images.length !== snapshot.imageCount ||
    new Set(images.map((image) => image.id)).size !== images.length
  )
    throw fail();
  const seen = [];
  const parsedImages = [];
  for (const batch of imageResults) {
    if (
      !Array.isArray(batch?.attachmentIds) ||
      !batch.attachmentIds.length ||
      batch.attachmentIds.length > 3 ||
      !metadata(batch.response, IMAGE_MODEL) ||
      batch.response.settingsRevision !== textResult.settingsRevision
    )
      throw fail();
    for (const id of batch.attachmentIds) {
      if (images[seen.length]?.id !== id) throw fail();
      seen.push(id);
    }
    const { parseModeration, IMAGE_CONTRACT_VERSION } = require('./moderation-image-client');
    if (batch.response.imageContractVersion !== IMAGE_CONTRACT_VERSION) throw fail();
    const parsed = parseModeration(
      {
        assessment: batch.response.assessment,
        imageObservations: batch.response.imageObservations,
      },
      {
        title: snapshot.title,
        content: snapshot.content,
        imageCount: batch.attachmentIds.length,
      },
    );
    parsedImages.push({
      attachmentIds: [...batch.attachmentIds],
      response: {
        ...parsed,
        model: IMAGE_MODEL,
        settingsRevision: batch.response.settingsRevision,
        policyVersion: POLICY_VERSION,
        imageContractVersion: IMAGE_CONTRACT_VERSION,
        elapsedMs:
          Number.isSafeInteger(batch.response.elapsedMs) && batch.response.elapsedMs >= 0
            ? batch.response.elapsedMs
            : null,
      },
    });
  }
  const imagesReviewed = snapshot.imageCount > 0 && seen.length === images.length;
  const decisions = [
    textDecision,
    ...parsedImages.map((batch) => batch.response.contentPolicyDecision),
  ];
  const allAssessments = [assessment, ...parsedImages.map((batch) => batch.response.assessment)];
  const reviewFocus = getReviewFocus({
    title: snapshot.title,
    content: snapshot.content,
    assessments: allAssessments,
    observations: parsedImages.flatMap((batch) => batch.response.imageObservations),
  });
  const priorities = ['none', 'attention', 'urgent'];
  const supportPriority =
    priorities[Math.max(...allAssessments.map((item) => priorities.indexOf(item.supportPriority)))];
  // A validated hold/block or focus signal can stop remaining paid calls. An
  // incomplete safe result is invalid; it must never acquire publication authority.
  if (
    seen.length !== images.length &&
    decisions.every((item) => item.recommendedAction === 'allow') &&
    !reviewFocus.political &&
    !reviewFocus.psychological &&
    supportPriority === 'none'
  )
    throw fail();
  let action = decisions.some((item) => item.recommendedAction === 'block')
    ? 'block'
    : decisions.every((item) => item.recommendedAction === 'allow')
      ? 'allow'
      : 'hold';
  const reasons = [...new Set(decisions.flatMap((item) => item.reasons))];
  const labels = [...new Set(decisions.flatMap((item) => item.reasonLabels))];
  function hold(code, label) {
    if (action === 'allow') action = 'hold';
    reasons.push(code);
    labels.push(label);
  }
  if (snapshot.imageCount > 0 && !imagesReviewed)
    hold('images_not_reviewed', '部分图片未完成机器审核，交负责人检查。');
  if (reviewFocus.political)
    hold('political_requires_review', '政治敏感相关内容须负责人单独审核。');
  if (reviewFocus.psychological)
    hold('psychological_requires_review', '心理求助或关怀信号须负责人优先关注，求助不等于违规。');
  if (supportPriority !== 'none') hold('support_requires_review', '存在关怀提示，需负责人跟进。');
  return {
    submissionId: snapshot.submissionId,
    version: snapshot.version,
    contentHash: snapshot.contentHash,
    inputHash: snapshot.inputHash,
    source: 'automatic',
    executor: 'moderation-agent',
    inputMode: 'redacted',
    model: TEXT_MODEL,
    imageModel: snapshot.imageCount > 0 ? IMAGE_MODEL : null,
    settingsRevision: textResult.settingsRevision,
    policyVersion: POLICY_VERSION,
    redactorVersion: snapshot.redactorVersion,
    elapsedMs: Number.isSafeInteger(elapsedMs) && elapsedMs >= 0 ? elapsedMs : null,
    imageCount: snapshot.imageCount,
    imagesReviewed,
    automaticPublication: false,
    assessment,
    policyEvidence: buildPolicyEvidence(assessment),
    policyDecision: {
      recommendedAction: action,
      supportPriority,
      reasons: [...new Set(reasons)],
      reasonLabels: [...new Set(labels)],
      imagesReviewed,
      canAutomaticallyPublish: false,
    },
    reviewFocus,
    requiresPostPublicationReview: snapshot.imageCount > 0,
    textResult: {
      assessment,
      model: TEXT_MODEL,
      settingsRevision: textResult.settingsRevision,
      policyVersion: POLICY_VERSION,
    },
    imageResults: parsedImages,
  };
}

module.exports = { TEXT_MODEL, IMAGE_MODEL, buildAutomaticResult };
