const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createModerationImageClient,
  ModerationImageError,
  ENDPOINT,
  BASE_URL,
  IMAGE_CONTRACT_VERSION,
  MAX_RESPONSE_BYTES,
  safeImageError,
  sanitizeImageDiagnostics,
  parseModeration,
} = require('./moderation-image-client');
const { validateAssessment } = require('../backend/moderation-ai-client');
const { getPolicyRule, POLICY_VERSION } = require('../backend/moderation-policy');

const KEY = 'synthetic-secret-never-a-real-api-key';
const IMAGE = {
  mimeType: 'image/png',
  dataBase64: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]).toString('base64'),
};
const INPUT = { model: 'qwen3.6-27b', title: '测试帖子', content: '请看附图', images: [IMAGE] };
const safeAssessment = () => ({
  decision: 'no_risk_detected',
  categories: [],
  reason: '正常建议。',
  ruleMatches: [],
  uncertainties: [],
  supportPriority: 'none',
  supportReason: '',
});
const result = () => ({
  imageObservations: [{ imageIndex: 1, text: '建议增加插座', description: '白底黑字的文字卡片。' }],
  assessment: safeAssessment(),
});
const envelope = (value, extra = {}) => ({
  choices: [
    {
      finish_reason: 'stop',
      message: { role: 'assistant', content: JSON.stringify(value) },
      ...extra,
    },
  ],
});
const response = (value, extra = {}) =>
  new Response(JSON.stringify(envelope(value, extra)), {
    headers: { 'Content-Type': 'application/json' },
  });
function harness({
  reply = () => response(result()),
  config = {},
  timeoutMs = 1000,
  validateAssessmentImpl = validateAssessment,
} = {}) {
  const requests = [];
  const settings = { baseUrl: BASE_URL, apiKey: KEY, revision: 5, ...config };
  const client = createModerationImageClient({
    settings,
    timeoutMs,
    validateAssessmentImpl,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return reply(url, options);
    },
  });
  return { requests, client, settings };
}
const failure = (code, finishReason) => (error) => {
  assert.ok(error instanceof ModerationImageError);
  assert.equal(error.diagnostics.failureCode, code);
  if (finishReason) assert.equal(error.diagnostics.finishReason, finishReason);
  assert.equal(error.cause, undefined);
  assert.doesNotMatch(
    JSON.stringify(error) + error.message,
    /synthetic-secret|provider-secret|private-data/,
  );
  assert.equal(error.assessment, undefined);
  return true;
};

test('both models use image-first base64 JSON-object requests without provider-gate changes', async () => {
  for (const model of ['kimi-k2.6', 'qwen3.6-27b']) {
    const h = harness();
    assert.equal(h.requests.length, 0);
    const value = await h.client.assess({
      ...INPUT,
      model,
      expected: 'hidden-answer-must-not-be-sent',
    });
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].url, ENDPOINT);
    const options = h.requests[0].options;
    const body = JSON.parse(options.body);
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.headers.Authorization, `Bearer ${KEY}`);
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.equal(
      body.messages[1].content[0].image_url.url,
      `data:image/png;base64,${IMAGE.dataBase64}`,
    );
    assert.equal(body.messages[1].content.at(-1).type, 'text');
    assert.deepEqual(JSON.parse(body.messages[1].content.at(-1).text), {
      title: INPUT.title,
      content: INPUT.content,
    });
    assert.doesNotMatch(options.body, /hidden-answer-must-not-be-sent|synthetic-secret/);
    if (model === 'kimi-k2.6') assert.deepEqual(body.thinking, { type: 'disabled' });
    else assert.equal(body.enable_thinking, false);
    assert.equal(value.contentPolicyDecision.recommendedAction, 'allow');
    assert.equal(value.contentPolicyDecision.canAutomaticallyPublish, false);
    assert.equal(value.policyDecision.recommendedAction, 'hold');
    assert.equal(value.policyDecision.imagesReviewed, false);
    assert.equal(value.policyVersion, POLICY_VERSION);
    assert.equal(value.imageContractVersion, 'freebbs-moderation-image-test-v3');
  }
});

test('both image models receive v3 privacy, attribution and unreadable-image constraints', async () => {
  for (const model of ['kimi-k2.6', 'qwen3.6-27b']) {
    const h = harness();
    await h.client.assess({ ...INPUT, model });
    const prompt = JSON.parse(h.requests[0].options.body).messages[0].content;
    assert.ok(prompt.includes(IMAGE_CONTRACT_VERSION));
    assert.match(prompt, /不能仅因无法验证其身份就额外套用“隐私-001”/);
    assert.match(prompt, /只有输入同时提供本人和他人两类适用证据，才可同时引用两条/);
    assert.match(prompt, /不据此认定违法、恶意或必须获得学校、管理方同意/);
    assert.match(prompt, /理由、explanation、uncertainties、supportReason 只描述个人信息类型/);
    assert.match(prompt, /evidence\.quote 只保留支持判断的最短充分连续原文/);
    assert.match(prompt, /不得加入规则没有要求的学校\/管理方批准/);
    assert.match(prompt, /不得编造保本、高额收益、返利、转账等输入未出现的事实/);
    assert.match(prompt, /关键内容无法辨认时，decision 必须 needs_review/);
    assert.match(prompt, /categories=\[\]、ruleMatches=\[\]/);
    assert.match(prompt, /不能把截图里被举报者的言论当作发帖者自己的主张/);
    assert.match(prompt, /"imageIndex":1/);
    assert.match(prompt, /imageIndex 必须是数字整数/);
    assert.doesNotMatch(prompt, /"imageIndex":"/);
    assert.equal(h.requests.length, 1);
  }
});

test('shared parser exports controlled display and safety decisions without altering raw assessment', () => {
  const value = result();
  value.imageObservations[0] = {
    imageIndex: 1,
    text: '',
    description: '图片过于模糊，无法可靠读取文字。',
  };
  const got = parseModeration(value, { title: '附图', content: '请看附图', imageCount: 1 });
  assert.deepEqual(got.assessment, value.assessment);
  assert.equal(got.modelPolicyDecision.recommendedAction, 'allow');
  assert.equal(got.contentPolicyDecision.recommendedAction, 'hold');
  assert.equal(got.imageSafety.requiresHumanReview, true);
  assert.equal(got.policyDecision.canAutomaticallyPublish, false);
  assert.equal(got.displayAssessment.reason, value.assessment.reason);
});

test('validation diagnostics identify structure and reference failures without leaking provider fields or values', async () => {
  const examples = [
    [() => ({ providerSecret: 'private-data' }), 'result', 'object_keys'],
    [
      (v) => {
        v.imageObservations = {};
        return v;
      },
      'imageObservations',
      'type',
    ],
    [
      (v) => {
        v.imageObservations = [];
        return v;
      },
      'imageObservations',
      'count',
    ],
    [
      (v) => {
        v.imageObservations[0].imageIndex = 'private-data';
        return v;
      },
      'imageObservations[0].imageIndex',
      'index',
    ],
    [
      (v) => {
        v.imageObservations[0].providerSecret = 'private-data';
        return v;
      },
      'imageObservations[0]',
      'object_keys',
    ],
    [
      (v) => {
        v.imageObservations[0].description = '';
        return v;
      },
      'imageObservations[0].description',
      'text',
    ],
    [
      (v) => {
        v.assessment.ruleMatches = [
          {
            ruleId: '隐私-003',
            evidence: { field: 'image_1', quote: 'private-data' },
            explanation: '需复核。',
          },
        ];
        return v;
      },
      'assessment.ruleMatches[0].evidence.quote',
      'quote_not_present',
    ],
    [
      (v) => {
        v.assessment.ruleMatches = [
          {
            ruleId: '隐私-003',
            evidence: { field: 'private-data', quote: '建议' },
            explanation: '需复核。',
          },
        ];
        return v;
      },
      'assessment.ruleMatches[0].evidence.field',
      'source_field',
    ],
    [
      (v) => {
        v.assessment.ruleMatches = [
          {
            ruleId: '隐私-003',
            evidence: { field: 'image_1', quote: '建议', providerSecret: 'private-data' },
            explanation: '需复核。',
          },
        ];
        return v;
      },
      'assessment.ruleMatches[0].evidence',
      'object_keys',
    ],
  ];
  for (const [mutate, path, issue] of examples) {
    const h = harness({ reply: () => response(mutate(result())) });
    await assert.rejects(h.client.assess(INPUT), (error) => {
      const safe = safeImageError(error);
      assert.equal(safe.diagnostics.validation.path, path);
      assert.equal(safe.diagnostics.validation.issue, issue);
      assert.equal(safe.diagnostics.httpStatus, 200);
      assert.equal(safe.diagnostics.finishReason, 'stop');
      assert.doesNotMatch(JSON.stringify(safe), /private-data|providerSecret/);
      return true;
    });
    assert.equal(h.requests.length, 1);
  }
});

test('diagnostic sanitizer rejects arbitrary paths, keys, types and negative or excessive counts', () => {
  const value = sanitizeImageDiagnostics({
    failureCode: 'rule_evidence_invalid',
    validation: {
      issue: 'object_keys',
      path: 'assessment.ruleMatches[0].evidence',
      missingFields: ['quote', 'private-data'],
      unexpectedFieldCount: 2,
      actualType: 'private-data',
      actualIndex: 2099010048,
      length: -1,
      sourceField: 'private-data',
      quotePresent: false,
      providerSecret: 'private-data',
    },
  });
  assert.deepEqual(value.validation, {
    issue: 'object_keys',
    path: 'assessment.ruleMatches[0].evidence',
    unexpectedFieldCount: 2,
    missingFields: ['quote'],
    quotePresent: false,
  });
  assert.equal(
    sanitizeImageDiagnostics({ validation: { issue: 'object_keys', path: 'private-data' } })
      .validation,
    undefined,
  );
  assert.equal(
    sanitizeImageDiagnostics({ validation: { issue: 'private-data', path: 'assessment' } })
      .validation,
    undefined,
  );
});

test('self-information review retains raw OCR and minimal evidence separately from reasons', async () => {
  const value = result();
  value.imageObservations[0].text = '这是我的完整学号2025010000，宿舍紫荆一号楼629A。';
  value.assessment = {
    ...safeAssessment(),
    decision: 'needs_review',
    categories: ['privacy'],
    reason: '作者声称公开本人完整学号和精确寝室信息，需按本站测试规则进行安全复核。',
    ruleMatches: [
      {
        ruleId: '隐私-003',
        evidence: { field: 'image_1', quote: '完整学号2025010000' },
        explanation: '本人完整学号和精确寝室信息需人工安全复核，不据此认定恶意。',
      },
    ],
  };
  const before = structuredClone(value);
  const h = harness({ reply: () => response(value) });
  const got = await h.client.assess({ ...INPUT, model: 'kimi-k2.6' });
  assert.deepEqual(got.assessment, before.assessment);
  assert.deepEqual(got.imageObservations, before.imageObservations);
  assert.deepEqual(value, before);
  assert.equal(got.contentPolicyDecision.recommendedAction, 'hold');
  assert.equal(got.policyDecision.recommendedAction, 'hold');
  assert.equal(h.requests.length, 1);
});

test('semantic model mistakes remain visible for report grading rather than being silently repaired', async () => {
  const value = result();
  value.imageObservations[0].text = '这是我的完整学号2025010000，宿舍紫荆一号楼629A。';
  value.assessment = {
    ...safeAssessment(),
    decision: 'needs_review',
    categories: ['privacy'],
    reason: '完整学号2025010000，宿舍紫荆一号楼629A，需核实学校是否同意。',
    ruleMatches: [
      {
        ruleId: '隐私-001',
        evidence: { field: 'image_1', quote: '完整学号2025010000' },
        explanation: '需要核实学校是否同意。',
      },
      {
        ruleId: '隐私-003',
        evidence: { field: 'image_1', quote: '宿舍紫荆一号楼629A' },
        explanation: '本人完整学号和精确寝室信息需人工核查。',
      },
    ],
  };
  const h = harness({ reply: () => response(value) });
  const got = await h.client.assess(INPUT);
  assert.deepEqual(got.assessment, value.assessment);
  assert.equal(got.contentPolicyDecision.recommendedAction, 'hold');
  assert.equal(h.requests.length, 1);
});

test('unreadable image can require review with no invented risk category or evidence', async () => {
  const value = {
    imageObservations: [
      { imageIndex: 1, text: '', description: '模糊的聊天截图，关键文字无法可靠辨认。' },
    ],
    assessment: {
      ...safeAssessment(),
      decision: 'needs_review',
      reason: '图片关键内容无法可靠读取，需要负责人检查。',
      uncertainties: ['第1张图片的正文因模糊无法可靠读取，无法确认是否存在风险。'],
    },
  };
  const h = harness({ reply: () => response(value) });
  const got = await h.client.assess(INPUT);
  assert.deepEqual(got.assessment, value.assessment);
  assert.deepEqual(got.policyEvidence, []);
  assert.equal(got.contentPolicyDecision.recommendedAction, 'hold');
  assert.equal(h.requests.length, 1);
  const badValue = structuredClone(value);
  badValue.assessment.uncertainties = [];
  const bad = harness({ reply: () => response(badValue) });
  await assert.rejects(bad.client.assess(INPUT), failure('assessment_fields_invalid'));
  assert.equal(bad.requests.length, 1);
});

test('three-image evidence stays tied to its actual image including the final image', async () => {
  const value = {
    imageObservations: [
      { imageIndex: 1, text: '建议增加插座', description: '第一张是普通建议截图。' },
      { imageIndex: 2, text: '', description: '第二张文字模糊。' },
      {
        imageIndex: 3,
        text: '这是我的完整学号2025010000。',
        description: '第三张是个人信息卡片。',
      },
    ],
    assessment: {
      ...safeAssessment(),
      decision: 'needs_review',
      categories: ['privacy'],
      reason: '第三张图片含作者声称属于本人的完整学号，需安全复核。',
      ruleMatches: [
        {
          ruleId: '隐私-003',
          evidence: { field: 'image_3', quote: '完整学号2025010000' },
          explanation: '本人完整学号公开前需安全复核。',
        },
      ],
      uncertainties: ['第二张图片的关键文字模糊，需要负责人查看原图。'],
    },
  };
  const input = { ...INPUT, images: [IMAGE, IMAGE, IMAGE] };
  const h = harness({ reply: () => response(value) });
  const got = await h.client.assess(input);
  assert.deepEqual(
    got.imageObservations.map((observation) => observation.imageIndex),
    [1, 2, 3],
  );
  assert.equal(got.assessment.ruleMatches[0].evidence.field, 'image_3');
  for (const field of ['image_1', 'image_2', 'image_4']) {
    const badValue = structuredClone(value);
    badValue.assessment.ruleMatches[0].evidence.field = field;
    const bad = harness({ reply: () => response(badValue) });
    await assert.rejects(bad.client.assess(input), failure('rule_evidence_invalid'));
    assert.equal(bad.requests.length, 1);
  }
});

test('visual probes carry no local expected code, shape counts or metadata', async () => {
  const code = harness({ reply: () => response({ code: 'X4K9ZP' }) });
  const got = await code.client.probe({
    model: INPUT.model,
    images: INPUT.images,
    probeType: 'code',
    expected: { code: 'SECRETANSWER' },
    title: 'SECRETANSWER',
  });
  assert.deepEqual(got.observation, { code: 'X4K9ZP' });
  assert.doesNotMatch(code.requests[0].options.body, /X4K9ZP|SECRETANSWER/);
  const shapes = harness({
    reply: () => response({ redCircles: 2, blueSquares: 3, greenTriangles: 4 }),
  });
  const value = await shapes.client.probe({
    model: INPUT.model,
    images: INPUT.images,
    probeType: 'shapes',
  });
  assert.deepEqual(value.observation, { redCircles: 2, blueSquares: 3, greenTriangles: 4 });
  assert.equal(shapes.requests.length, 1);
});

test('probe validation never repairs unexpected structure or impossible shape counts', async () => {
  for (const value of [
    { code: 'X4K9ZP', explanation: 'guess' },
    { code: 'not a code' },
    { code: '' },
  ]) {
    const h = harness({ reply: () => response(value) });
    await assert.rejects(h.client.probe({ ...INPUT, probeType: 'code' }), failure('probe_invalid'));
  }
  for (const value of [
    { redCircles: 2, blueSquares: 3 },
    { redCircles: -1, blueSquares: 0, greenTriangles: 0 },
    { redCircles: 1.5, blueSquares: 0, greenTriangles: 0 },
  ]) {
    const h = harness({ reply: () => response(value) });
    await assert.rejects(
      h.client.probe({ ...INPUT, probeType: 'shapes' }),
      failure('probe_invalid'),
    );
  }
});

test('current rule/category/support contract validates image evidence and retains source index', async () => {
  const rule = getPolicyRule('骚扰-001');
  const value = result();
  value.imageObservations[0].text = '你是全班最没用的废物，大家每天都去骂你。';
  value.assessment = {
    ...safeAssessment(),
    decision: 'high_risk',
    categories: [rule.category],
    reason: '针对同学的辱骂和群体骚扰。',
    ruleMatches: [
      {
        ruleId: rule.id,
        evidence: { field: 'image_1', quote: '大家每天都去骂你' },
        explanation: '明确组织群体骚扰，没有举报或引用语境。',
      },
    ],
  };
  const h = harness({ reply: () => response(value) });
  const got = await h.client.assess(INPUT);
  assert.equal(got.assessment.ruleMatches[0].evidence.field, 'image_1');
  assert.equal(got.contentPolicyDecision.recommendedAction, 'block');
  assert.equal(got.policyEvidence[0].rule.id, rule.id);
  for (const change of [
    (copy) => {
      copy.assessment.categories = [];
    },
    (copy) => {
      copy.assessment.ruleMatches[0].ruleId = 'FAKE-123';
    },
    (copy) => {
      copy.assessment.supportPriority = 'urgent';
      copy.assessment.supportReason = '虚构紧急信号';
    },
    (copy) => {
      copy.assessment.ruleMatches[0].evidence.quote = '图上没有这些文字';
    },
    (copy) => {
      copy.assessment.ruleMatches[0].evidence.field = 'content';
    },
    (copy) => {
      copy.assessment.ruleMatches[0].evidence.field = 'image_2';
    },
  ]) {
    const copy = structuredClone(value);
    change(copy);
    const bad = harness({ reply: () => response(copy) });
    await assert.rejects(bad.client.assess(INPUT), (error) => {
      assert.ok(error instanceof ModerationImageError);
      assert.equal(error.assessment, undefined);
      return true;
    });
    assert.equal(bad.requests.length, 1);
  }
});

test('all supplied image observations are required exactly once in order, including safe results', async () => {
  for (const observations of [
    [],
    [{ imageIndex: 2, text: '', description: '白底图。' }],
    [
      { imageIndex: 1, text: '', description: '白底图。' },
      { imageIndex: 1, text: '', description: '另一个图。' },
    ],
  ]) {
    const h = harness({ reply: () => response({ ...result(), imageObservations: observations }) });
    await assert.rejects(
      h.client.assess({ ...INPUT, images: [IMAGE, IMAGE] }),
      failure('image_observations_invalid'),
    );
  }
  const value = result();
  value.imageObservations.push({
    imageIndex: 2,
    text: '另一张图片',
    description: '第二张文字卡片。',
  });
  const h = harness({ reply: () => response(value) });
  assert.equal(
    (await h.client.assess({ ...INPUT, images: [IMAGE, IMAGE] })).imageObservations.length,
    2,
  );
});

test('non-stop finish reasons cannot pass and only whitelisted reasons reach reports', async () => {
  for (const [upstream, safe] of [
    ['length', 'length'],
    ['content_filter', 'content_filter'],
    ['tool_calls', 'tool_calls'],
    ['provider-secret-private-data', 'other'],
    [null, 'missing'],
  ]) {
    const h = harness({ reply: () => response(result(), { finish_reason: upstream }) });
    await assert.rejects(h.client.assess(INPUT), failure('finish_reason_not_stop', safe));
    assert.equal(h.requests.length, 1);
  }
});

test('HTTP and transport failures retain only allowlisted parameter mentions without retrying', async () => {
  const h = harness({
    reply: () =>
      new Response(
        `provider-secret ${KEY} private-data response_format image_url enable_thinking`,
        { status: 400 },
      ),
  });
  await assert.rejects(h.client.assess(INPUT), (error) => {
    failure('http_error')(error);
    assert.equal(error.diagnostics.httpStatus, 400);
    assert.deepEqual(error.diagnostics.parameterMentions, [
      'response_format',
      'enable_thinking',
      'image_url',
    ]);
    return true;
  });
  assert.equal(h.requests.length, 1);
  const network = harness({
    reply: () => {
      throw new Error(`provider-secret ${KEY}`);
    },
  });
  await assert.rejects(network.client.assess(INPUT), failure('transport_error'));
  assert.equal(network.requests.length, 1);
});

test('report error helper rejects arbitrary error messages and revalidates diagnostic fields', () => {
  const unknown = safeImageError(new Error(`provider-secret ${KEY}`));
  assert.equal(unknown.code, 'model_result_failed');
  assert.equal(unknown.diagnostics.failureCode, 'transport_error');
  assert.doesNotMatch(JSON.stringify(unknown), /provider-secret|synthetic-secret/);
  const known = new ModerationImageError('http_error', {
    httpStatus: 400,
    parameterMentions: ['image_url', 'provider-secret'],
  });
  known.message = KEY;
  known.diagnostics.finishReason = KEY;
  known.diagnostics.extra = KEY;
  const safe = safeImageError(known);
  assert.equal(safe.diagnostics.finishReason, 'other');
  assert.deepEqual(safe.diagnostics.parameterMentions, ['image_url']);
  assert.doesNotMatch(JSON.stringify(safe), /provider-secret|synthetic-secret/);
});

test('configuration is snapshotted, wrong endpoint and malformed image make zero requests', async () => {
  const h = harness();
  h.settings.apiKey = 'replacement-secret';
  await h.client.assess(INPUT);
  assert.equal(h.requests[0].options.headers.Authorization, `Bearer ${KEY}`);
  for (const baseUrl of [
    'http://127.0.0.1:9/v1',
    'https://example.org/v1',
    `${BASE_URL}?leak=yes`,
  ]) {
    const bad = harness({ config: { baseUrl } });
    await assert.rejects(bad.client.assess(INPUT), failure('configuration_invalid'));
    assert.equal(bad.requests.length, 0);
  }
  for (const images of [
    [],
    [{ mimeType: 'image/png', dataBase64: 'not-base64' }],
    [{ mimeType: 'image/png', dataBase64: Buffer.from('notpng').toString('base64') }],
    [IMAGE, IMAGE, IMAGE, IMAGE],
  ]) {
    const bad = harness();
    await assert.rejects(bad.client.assess({ ...INPUT, images }), failure('input_invalid'));
    assert.equal(bad.requests.length, 0);
  }
});

test('redirect, unexpected content type, envelope and invalid JSON never become assessments', async () => {
  for (const [reply, code] of [
    [() => ({ ok: true, status: 200, redirected: true }), 'response_redirected'],
    [() => ({ ok: true, status: 200, url: 'https://example.org/' }), 'response_redirected'],
    [
      () => new Response('{}', { headers: { 'Content-Type': 'text/html' } }),
      'response_type_invalid',
    ],
    [
      () => new Response('{', { headers: { 'Content-Type': 'application/json' } }),
      'response_json_invalid',
    ],
    [
      () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }),
      'response_envelope_invalid',
    ],
    [
      () => response(result(), { message: { role: 'assistant', content: '```json\n{}\n```' } }),
      'content_json_invalid',
    ],
    [
      () =>
        response(result(), {
          message: { role: 'assistant', content: '{}', tool_calls: [{ private: KEY }] },
        }),
      'message_invalid',
    ],
  ]) {
    const h = harness({ reply });
    await assert.rejects(h.client.assess(INPUT), failure(code));
  }
});

test('size cap applies to streamed bytes regardless of content-length', async () => {
  const h = harness({
    reply: () =>
      new Response(' '.repeat(MAX_RESPONSE_BYTES + 1), {
        headers: { 'Content-Type': 'application/json' },
      }),
  });
  await assert.rejects(h.client.assess(INPUT), failure('response_too_large'));
  assert.equal(h.requests.length, 1);
});

test('timeout aborts a hung call without retries and retains only generic diagnostics', async () => {
  const h = harness({ timeoutMs: 10, reply: () => new Promise(() => {}) });
  await assert.rejects(h.client.assess(INPUT), failure('timeout'));
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].options.signal.aborted, true);
});
