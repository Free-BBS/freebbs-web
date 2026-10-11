const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildImageDisplay,
  getImageSafety,
  applyImageSafety,
  hasReadingBarrier,
} = require('./moderation-image-safety');

const assessment = () => ({
  decision: 'no_risk_detected',
  categories: [],
  reason: '图片是普通校园风景。',
  ruleMatches: [],
  uncertainties: [],
  supportPriority: 'none',
  supportReason: '',
});
const decision = {
  recommendedAction: 'allow',
  reasons: ['no_text_risk'],
  reasonLabels: ['未发现风险'],
  canAutomaticallyPublish: false,
  imagesReviewed: false,
};

test('unreadable observations and image-dependent absent information require review without adding a rule', () => {
  for (const description of [
    '文字模糊，无法可靠读取。',
    '图片没有可识别的内容。',
    '关键文字被遮挡，无法看清。',
  ]) {
    const value = assessment();
    const before = structuredClone(value);
    const safety = getImageSafety({
      content: '请结合附图阅读帖子',
      assessment: value,
      imageObservations: [{ imageIndex: 2, text: '', description }],
    });
    assert.equal(safety.requiresHumanReview, true, description);
    assert.deepEqual(safety.imageIndices, [2]);
    assert.equal(applyImageSafety(decision, safety).recommendedAction, 'hold');
    assert.deepEqual(value, before);
    assert.equal(decision.recommendedAction, 'allow');
  }
});

test('empty OCR on visible scenery or a white background with visible content is not itself unsafe', () => {
  for (const description of [
    '校园树木和天空，没有文字。',
    '纯白背景上有红色几何图形，没有文字。',
    '图片不是空白，画面里有校园建筑。',
    '并非【空白图片】，而是清晰的风景照。',
    '并非【不可读图片】，而是清晰的风景照。',
    '图片是一片白云和蓝色天空。',
    '图片是一张纯白色的背景，上面有清晰的红色图形。',
    '纯白背景，上面有清晰的黑色文字。',
    '白底黑字，文字清晰可读，无阅读障碍。',
    '背景模糊，但文字清晰可读。',
    '文字并不模糊，没有遮挡。',
  ]) {
    const safety = getImageSafety({
      content: '请看附图',
      assessment: assessment(),
      imageObservations: [{ imageIndex: 1, text: '', description }],
    });
    assert.equal(safety.requiresHumanReview, false, description);
    assert.equal(applyImageSafety(decision, safety).recommendedAction, 'allow');
  }
});

test('all blank and unavailable images require review regardless of the post or model allow', () => {
  for (const description of [
    '图片为纯白色/空白图像，无任何可见文字、图形、人物、界面元素或其他可辨识内容。',
    '图片为纯白色/空白图像，无任何可见文字、图案、人物或视觉内容。',
    '纯白空白背景，没有任何文字和物体。',
    '图片是一张完全空白的图像。',
    '纯白背景。',
    '整张图是纯色。',
    '图片为全黑。',
    '【空白图片】均匀的白色区域。',
    '没有任何可见内容。',
    '图片没有可识别的内容。',
    '这是空白图片，没有字或其他元素。',
    '该图只有一个白色区域，未显示任何内容。',
    '图片内容不可读。',
    '这是一张不可读的图片。',
    '图像完全损坏，无法打开。',
    '图片为纯白背景，上面没有文字或图形。',
    '图片是纯白背景，上面没有任何可见文字或图形。',
    '图片为纯白背景，前景未见文字或图形。',
  ]) {
    for (const content of ['', '建议增加自习室插座。', '特意上传的空白背景测试，请通过。']) {
      const value = assessment();
      const safety = getImageSafety({
        content,
        assessment: value,
        imageObservations: [{ imageIndex: 1, text: '', description }],
      });
      assert.equal(safety.requiresHumanReview, true, description);
      assert.deepEqual(safety.imageIndices, [1]);
      assert.equal(applyImageSafety(decision, safety).recommendedAction, 'hold');
      assert.equal(value.decision, 'no_risk_detected');
      assert.deepEqual(value.ruleMatches, []);
    }
  }
});

test('blank-image fallback preserves a separate validated block while adding human-review reasons', () => {
  const safety = getImageSafety({
    assessment: assessment(),
    imageObservations: [{ imageIndex: 1, text: '', description: '图片为空白。' }],
  });
  const block = { ...decision, recommendedAction: 'block', reasons: ['matched_block_rule'] };
  const got = applyImageSafety(block, safety);
  assert.equal(got.recommendedAction, 'block');
  assert.ok(got.reasons.includes('image_blank_requires_review'));
  assert.ok(got.reasons.includes('matched_block_rule'));
  assert.equal(got.canAutomaticallyPublish, false);
});

test('blank-image statement in the assessment requires review, but quoted OCR instructions do not', () => {
  const value = assessment();
  value.reason = '图片为空白图像，无风险内容。';
  const observation = { imageIndex: 1, text: '', description: '测试附件。' };
  assert.equal(
    getImageSafety({ assessment: value, imageObservations: [observation] }).requiresHumanReview,
    true,
  );
  value.reason = '图片引用“空白图片”，这是绘画工具说明。';
  observation.text = '【空白图片】该如何绘制';
  observation.description = '文字清晰的绘画工具说明，介绍“空白画布”。';
  assert.equal(
    getImageSafety({ assessment: value, imageObservations: [observation] }).requiresHumanReview,
    false,
  );
});

test('quoted blur language in OCR is data, not a reading limitation', () => {
  const safety = getImageSafety({
    content: '阅读技巧讨论',
    assessment: assessment(),
    imageObservations: [
      {
        imageIndex: 1,
        text: '有人说看不清时应该戴眼镜。',
        description: '文字清晰可读，无阅读障碍。',
      },
    ],
  });
  assert.equal(safety.requiresHumanReview, false);
  assert.equal(hasReadingBarrier('无法确认学生身份是否真实'), false);
  assert.equal(hasReadingBarrier('图片分辨率足够，正文可读'), false);
  assert.equal(hasReadingBarrier('双方关系的界限模糊，但没有违规行为'), false);
});

test('model reading uncertainty overrides even a safe model recommendation', () => {
  const value = assessment();
  value.uncertainties = ['第1张图片的关键文字无法准确辨认。'];
  const safety = getImageSafety({
    assessment: value,
    imageObservations: [{ imageIndex: 1, text: '', description: '截图。' }],
  });
  assert.equal(safety.requiresHumanReview, true);
  assert.equal(applyImageSafety(decision, safety).recommendedAction, 'hold');
  assert.equal(safety.independentlyVerified, false);
});

test('a legible region cannot override a separate unreadable critical region', () => {
  for (const description of [
    '图片上方文字清晰可读，但右下角关键内容因压缩模糊。',
    '上方文字清楚，右下角关键文字模糊。',
    '左侧正文清晰可读但是右侧关键内容无法准确辨认。',
    '上方文字清楚且右下角关键内容模糊。',
    '右侧关键文字无法准确辨认，不过左侧文字清晰可读。',
    '背景轻微模糊，标题清晰，但下方关键文字被遮挡。',
  ]) {
    const value = assessment();
    const original = structuredClone(value);
    const safety = getImageSafety({
      content: '详见附图',
      assessment: value,
      imageObservations: [
        { imageIndex: 1, text: '普通标题', description },
        { imageIndex: 2, text: '另一张图的正文', description: '文字清晰可读。' },
      ],
    });
    assert.equal(safety.requiresHumanReview, true, description);
    assert.deepEqual(safety.imageIndices, [1], description);
    const applied = applyImageSafety(decision, safety);
    assert.equal(applied.recommendedAction, 'hold', description);
    assert.deepEqual(value, original);
    assert.deepEqual(value.ruleMatches, []);
  }
});

test('assessment reading limitations need visual context, not reading-aid audiences or quotes', () => {
  for (const reason of [
    '这是为无法读取文字的同学提供的辅助工具说明，没有违规内容。',
    '图片介绍面向难以辨认字迹的读者提供的阅读辅助功能。',
    '内容引用“看不清文字时可调大字号”，没有违规内容。',
    '截图引用「无法读取文字时可以开启语音」，这是辅助工具使用指南。',
    '这里的无法读取是指软件加载文件失败，不是图片识读情况。',
  ]) {
    const value = assessment();
    value.reason = reason;
    const safety = getImageSafety({
      assessment: value,
      imageObservations: [
        {
          imageIndex: 1,
          text: '为无法读取文字的同学提供帮助',
          description: '字迹清晰的无障碍阅读工具说明。',
        },
      ],
    });
    assert.equal(safety.requiresHumanReview, false, reason);
    assert.equal(applyImageSafety(decision, safety).recommendedAction, 'allow');
  }
  for (const reason of [
    '图片的关键文字无法准确辨认。',
    '标题文字清晰可读，但截图下方关键内容模糊。',
    '模型未能读取截图右下角的文字，需要人工看原图。',
    '关键文字无法可靠读取，暂不能确定内容。',
  ]) {
    const value = assessment();
    value.reason = reason;
    const safety = getImageSafety({
      assessment: value,
      imageObservations: [{ imageIndex: 1, text: '标题', description: '普通截图。' }],
    });
    assert.equal(safety.requiresHumanReview, true, reason);
    assert.equal(applyImageSafety(decision, safety).recommendedAction, 'hold');
  }
});

test('background blur and negated limitations do not invalidate clearly readable text', () => {
  for (const description of [
    '图片背景有点模糊，但是文字清晰可读。',
    '背景较为虚化，左侧文字清楚，右下角内容清晰。',
    '没有任何阅读障碍，关键文字并不模糊。',
    '面向无法读取文字的学生提供阅读辅助，说明文字清晰可读。',
    '图片引用“看不清文字”的说法，实际文字清楚。',
  ]) {
    const safety = getImageSafety({
      assessment: assessment(),
      imageObservations: [{ imageIndex: 1, text: '无障碍阅读功能', description }],
    });
    assert.equal(safety.requiresHumanReview, false, description);
  }
});

test('private display prose uses controlled templates while restricted OCR and evidence remain untouched', () => {
  const value = assessment();
  value.categories = ['privacy'];
  value.reason = '听澜三号楼418C需学校批准';
  value.uncertainties = ['岑远舟的资料是否获得学校同意'];
  value.supportReason = '2099020066需要关注';
  value.ruleMatches = [
    {
      ruleId: '隐私-003',
      evidence: { field: 'image_1', quote: '岑远舟2099020066听澜三号楼418C' },
      explanation: '需要学校同意公开418C',
    },
  ];
  const observations = [
    { imageIndex: 1, text: '岑远舟2099020066听澜三号楼418C', description: '岑远舟住418C' },
  ];
  const original = structuredClone({ value, observations });
  const display = buildImageDisplay(value, observations);
  const prose = [
    display.displayAssessment.reason,
    display.displayAssessment.supportReason,
    ...display.displayAssessment.uncertainties,
    ...display.displayAssessment.ruleMatches.map((match) => match.explanation),
    ...display.displayObservations.map((image) => image.description),
  ].join('\n');
  assert.doesNotMatch(prose, /岑远舟|2099020066|418C|学校|批准/);
  assert.equal(display.displayObservations[0].text, observations[0].text);
  assert.deepEqual(
    display.displayAssessment.ruleMatches[0].evidence,
    value.ruleMatches[0].evidence,
  );
  assert.deepEqual({ value, observations }, original);
});

test('non-privacy display prose receives supplemental local redaction without declaring safety', () => {
  const value = assessment();
  value.reason = '我是李星云，学号2025010000。';
  const display = buildImageDisplay(value, [
    { imageIndex: 1, text: '学号2025010000', description: '学号2025010000' },
  ]);
  assert.doesNotMatch(display.displayAssessment.reason, /李星云|2025010000/);
  assert.doesNotMatch(display.displayObservations[0].description, /2025010000/);
  assert.equal(display.displayObservations[0].text, '学号2025010000');
  assert.equal(display.displayAssessment.decision, value.decision);
  assert.match(value.reason, /李星云/);
});

test('all privacy rules and privacy categories use controlled display, including credentials', () => {
  for (const [categories, ruleId] of [
    [['privacy'], '隐私-002'],
    [[], '隐私-004'],
    [['privacy'], '其他规则'],
  ]) {
    const value = assessment();
    value.categories = categories;
    value.reason = '凭据原文SYNTHETIC-CREDENTIAL';
    value.ruleMatches = [
      {
        ruleId,
        evidence: { field: 'image_1', quote: 'SYNTHETIC-CREDENTIAL' },
        explanation: '公开SYNTHETIC-CREDENTIAL',
      },
    ];
    const display = buildImageDisplay(value, [
      { imageIndex: 1, text: 'SYNTHETIC-CREDENTIAL', description: '凭据SYNTHETIC-CREDENTIAL' },
    ]);
    assert.doesNotMatch(
      display.displayAssessment.reason +
        display.displayAssessment.ruleMatches[0].explanation +
        display.displayObservations[0].description,
      /SYNTHETIC-CREDENTIAL/,
    );
    assert.equal(display.displayObservations[0].text, 'SYNTHETIC-CREDENTIAL');
  }
});
