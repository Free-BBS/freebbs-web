const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAutomaticResult } = require('./moderation-automation-result');
const { POLICY_VERSION } = require('./moderation-policy');
const { IMAGE_CONTRACT_VERSION } = require('./moderation-image-client');

const assessment = () => ({
  decision: 'no_risk_detected',
  categories: [],
  reason: '普通学习建议。',
  ruleMatches: [],
  uncertainties: [],
  supportPriority: 'none',
  supportReason: '',
  reviewTopics: { political: [], psychological: [] },
});
function fixture(count = 4) {
  const snapshot = {
    submissionId: 's1',
    version: 1,
    contentHash: 'a'.repeat(64),
    inputHash: 'b'.repeat(64),
    title: '自习建议',
    content: '建议增加插座，请看附图。',
    counts: {},
    imageCount: count,
    redactorVersion: 'test',
    images: Array.from({ length: count }, (_, n) => ({
      id: `image-${n + 1}`,
      dataBase64: 'NEVER_PERSIST_IMAGE_BYTES',
    })),
  };
  const textResult = {
    assessment: assessment(),
    model: 'qwen3.6-27b',
    policyVersion: POLICY_VERSION,
    settingsRevision: 7,
    apiKey: 'NEVER_PERSIST_KEY',
  };
  const imageResults = [];
  for (let offset = 0; offset < count; offset += 3) {
    const ids = snapshot.images.slice(offset, offset + 3).map((image) => image.id);
    imageResults.push({
      attachmentIds: ids,
      response: {
        assessment: assessment(),
        imageObservations: ids.map((_, i) => ({
          imageIndex: i + 1,
          text: '建议增加插座',
          description: '清晰的文字卡片。',
        })),
        model: 'kimi-k2.6',
        policyVersion: POLICY_VERSION,
        settingsRevision: 7,
        imageContractVersion: IMAGE_CONTRACT_VERSION,
        apiKey: 'NEVER_PERSIST_KEY',
        displayAssessment: { reason: 'UNTRUSTED_DISPLAY' },
        contentPolicyDecision: { recommendedAction: 'allow', canAutomaticallyPublish: true },
      },
    });
  }
  return { snapshot, textResult, imageResults };
}

test('four images require both batches and retain independently rebuilt model/display/safety data', () => {
  const input = fixture();
  const got = buildAutomaticResult(input);
  assert.equal(got.policyDecision.recommendedAction, 'allow');
  assert.equal(got.imagesReviewed, true);
  assert.equal(got.requiresPostPublicationReview, true);
  assert.equal(got.imageResults.length, 2);
  assert.equal(got.policyDecision.canAutomaticallyPublish, false);
  assert.equal(got.automaticPublication, false);
  assert.doesNotMatch(JSON.stringify(got), /NEVER_PERSIST|UNTRUSTED_DISPLAY/);
  assert.equal(input.imageResults[0].response.apiKey, 'NEVER_PERSIST_KEY');
});

test('missing, duplicate, reordered, wrong-model, changed-settings and old-contract image results cannot allow', () => {
  const mutations = [
    (x) => x.imageResults.pop(),
    (x) => {
      x.imageResults[1].attachmentIds = ['image-1'];
    },
    (x) => x.imageResults[0].attachmentIds.reverse(),
    (x) => {
      x.imageResults[0].response.model = 'qwen3.6-27b';
    },
    (x) => {
      x.imageResults[1].response.settingsRevision = 8;
    },
    (x) => {
      x.imageResults[0].response.imageContractVersion = 'v2';
    },
    (x) => {
      x.imageResults[0].response.policyVersion = 'old-policy';
    },
    (x) => {
      x.imageResults[0].response.imageObservations.pop();
    },
    (x) => {
      x.snapshot.images[3].id = 'image-1';
    },
  ];
  for (const mutate of mutations) {
    const input = fixture();
    mutate(input);
    assert.throws(() => buildAutomaticResult(input));
  }
});

test('a last-batch explicit violation blocks even when the first three images are safe', () => {
  const input = fixture();
  const response = input.imageResults[1].response;
  response.imageObservations[0].text = '马上交押金领取兼职工作';
  response.assessment = {
    ...assessment(),
    decision: 'high_risk',
    categories: ['fraud'],
    reason: '以兼职名义索取预付费用。',
    ruleMatches: [
      {
        ruleId: '诈骗-001',
        evidence: { field: 'image_1', quote: '交押金领取兼职工作' },
        explanation: '兼职要求先交押金。',
      },
    ],
  };
  const got = buildAutomaticResult(input);
  assert.equal(got.policyDecision.recommendedAction, 'block');
  assert.equal(got.imagesReviewed, true);
});

test('unreadable-image local fallback holds without concealing the raw model allow', () => {
  const input = fixture(1);
  input.imageResults[0].response.imageObservations[0] = {
    imageIndex: 1,
    text: '',
    description: '图片文字非常模糊，无法辨认。',
  };
  const got = buildAutomaticResult(input);
  assert.equal(got.policyDecision.recommendedAction, 'hold');
  assert.equal(got.imageResults[0].response.modelPolicyDecision.recommendedAction, 'allow');
  assert.equal(got.imageResults[0].response.imageSafety.requiresHumanReview, true);
});

test('a blank image in any batch holds even with safe Qwen text, Kimi allow and clear other images', () => {
  for (const description of [
    '图片为纯白色/空白图像，无任何可见文字、图形、人物、界面元素或其他可辨识内容。',
    '图片为纯白色/空白图像，无任何可见文字、图案、人物或视觉内容。',
    '纯白空白背景，没有任何文字和物体。',
    '【空白图片】特意上传的纯色背景。',
    '【不可读图片】附件未能正常呈现。',
  ]) {
    const input = fixture(4);
    input.snapshot.content = '这是普通自习建议，附图仅为背景测试。';
    input.imageResults[1].response.imageObservations[0] = { imageIndex: 1, text: '', description };
    const got = buildAutomaticResult(input);
    assert.equal(got.policyDecision.recommendedAction, 'hold', description);
    assert.equal(got.imageResults[1].response.modelPolicyDecision.recommendedAction, 'allow');
    assert.equal(got.imageResults[1].response.imageSafety.requiresHumanReview, true);
    assert.deepEqual(got.imageResults[1].response.assessment.ruleMatches, []);
    assert.equal(got.policyDecision.canAutomaticallyPublish, false);
  }
});

test('clear photos without OCR can still pass image moderation', () => {
  const input = fixture(1);
  input.imageResults[0].response.imageObservations[0] = {
    imageIndex: 1,
    text: '',
    description: '校园建筑前有树木和蓝天，没有文字，主体清楚。',
  };
  const got = buildAutomaticResult(input);
  assert.equal(got.policyDecision.recommendedAction, 'allow');
  assert.equal(got.requiresPostPublicationReview, true);
});

test('a blank second image does not weaken a grounded fraud block in the same batch', () => {
  const input = fixture(2);
  const { response } = input.imageResults[0];
  response.imageObservations = [
    { imageIndex: 1, text: '马上交押金领取兼职工作', description: '清晰的文字卡片。' },
    { imageIndex: 2, text: '', description: '图片为空白。' },
  ];
  response.assessment = {
    ...assessment(),
    decision: 'high_risk',
    categories: ['fraud'],
    reason: '以兼职名义索取预付费用。',
    ruleMatches: [
      {
        ruleId: '诈骗-001',
        evidence: { field: 'image_1', quote: '交押金领取兼职工作' },
        explanation: '兼职要求先交押金。',
      },
    ],
  };
  const got = buildAutomaticResult(input);
  assert.equal(got.policyDecision.recommendedAction, 'block');
  assert.ok(got.policyDecision.reasons.includes('image_blank_requires_review'));
  assert.equal(got.imageResults[0].response.imageSafety.requiresHumanReview, true);
});

test('text privacy hold can skip image calls, while partial-image safe text cannot publish', () => {
  const input = fixture();
  input.snapshot.counts = { studentId: 1 };
  input.imageResults = [];
  const got = buildAutomaticResult(input);
  assert.equal(got.policyDecision.recommendedAction, 'hold');
  assert.equal(got.imagesReviewed, false);
  assert.ok(got.policyDecision.reasons.includes('original_privacy_requires_review'));
});

test('political and psychological routing requires human attention even with model no-risk', () => {
  for (const [content, key] of [
    ['讨论国家安全法的课程作业', 'political'],
    ['我最近持续焦虑，想找心理咨询', 'psychological'],
  ]) {
    const input = fixture(0);
    input.snapshot.content = content;
    const got = buildAutomaticResult(input);
    assert.equal(got.policyDecision.recommendedAction, 'hold');
    assert.equal(got.reviewFocus[key], true);
    assert.deepEqual(got.assessment.categories, []);
  }
  const input = fixture(1);
  input.imageResults[0].response.imageObservations[0].text = '同学最近情绪崩溃，想寻求帮助';
  assert.equal(buildAutomaticResult(input).reviewFocus.psychological, true);
  input.imageResults[0].response.imageObservations[0] = {
    imageIndex: 1,
    text: '',
    description: '图片是一枚中国共产党党徽。',
  };
  const graphic = buildAutomaticResult(input);
  assert.equal(graphic.reviewFocus.political, true);
  assert.equal(graphic.policyDecision.recommendedAction, 'hold');
  assert.deepEqual(graphic.imageResults[0].response.assessment.categories, []);
  const normal = fixture(0);
  normal.snapshot.content = '希望改善食堂排队问题。';
  assert.equal(buildAutomaticResult(normal).policyDecision.recommendedAction, 'allow');
});

test('privacy display excludes original dorm and invented school approval while restricted evidence is retained', () => {
  const input = fixture(1);
  const response = input.imageResults[0].response;
  response.imageObservations[0].text = '我住听澜三号楼418C';
  response.imageObservations[0].description = '听澜三号楼418C';
  response.assessment = {
    ...assessment(),
    decision: 'needs_review',
    categories: ['privacy'],
    reason: '听澜三号楼418C需要学校批准',
    ruleMatches: [
      {
        ruleId: '隐私-003',
        evidence: { field: 'image_1', quote: '我住听澜三号楼418C' },
        explanation: '听澜三号楼418C需要学校批准',
      },
    ],
  };
  const got = buildAutomaticResult(input).imageResults[0].response;
  assert.equal(got.contentPolicyDecision.recommendedAction, 'hold');
  assert.match(got.assessment.reason, /听澜/);
  assert.match(got.assessment.ruleMatches[0].evidence.quote, /418C/);
  assert.doesNotMatch(
    got.displayAssessment.reason +
      got.displayAssessment.ruleMatches[0].explanation +
      got.displayObservations[0].description,
    /听澜|418C|学校批准/,
  );
});
