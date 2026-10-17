const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateAssessment,
  createModerationAiClient,
  POLICY_VERSION,
} = require('./moderation-ai-client');
const { validateReviewTopics } = require('./moderation-review-topics');
const {
  parseModeration,
  createModerationImageClient,
  BASE_URL,
} = require('./moderation-image-client');
const { buildAutomaticResult } = require('./moderation-automation-result');
const data = {
  title: '分享近况',
  content: '最近几个星期什么都不想做，连以前最喜欢的活动也提不起兴趣，想找人聊聊。',
};
const safe = () => ({
  decision: 'no_risk_detected',
  categories: [],
  reason: '无独立违规。',
  ruleMatches: [],
  uncertainties: [],
  supportPriority: 'none',
  supportReason: '',
});
const topics = () => ({
  political: [],
  psychological: [
    {
      field: 'content',
      quote: data.content,
      reason: '持续兴趣丧失与求助表达，需要关怀复核，不作诊断。',
    },
  ],
});
const full = () => ({ ...safe(), reviewTopics: topics() });
const envelope = (assessment) =>
  new Response(
    JSON.stringify({
      choices: [
        {
          finish_reason: 'stop',
          message: { role: 'assistant', content: JSON.stringify(assessment) },
        },
      ],
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );

test('ordinary psychological distress can require review without a violation or clinical urgency', () => {
  const assessment = validateAssessment(full(), data, { requireReviewTopics: true });
  const result = buildAutomaticResult({
    snapshot: { ...data, imageCount: 0, counts: {} },
    textResult: {
      assessment,
      model: 'qwen3.6-27b',
      settingsRevision: 1,
      policyVersion: POLICY_VERSION,
    },
  });
  assert.equal(result.reviewFocus.psychological, true);
  assert.equal(result.reviewFocus.political, false);
  assert.equal(result.policyDecision.recommendedAction, 'hold');
  assert.equal(result.policyDecision.supportPriority, 'none');
  assert.deepEqual(result.assessment.categories, []);
  assert.deepEqual(result.reviewFocus.keywordMatches.psychological, []);
});

test('missing, malformed, invented or cross-field evidence never acquires automatic authority', () => {
  const bad = [
    undefined,
    {},
    { political: [] },
    { political: false, psychological: false },
    { ...topics(), extra: [] },
    { ...topics(), psychological: [{ ...topics().psychological[0], field: 'title' }] },
    { ...topics(), psychological: [{ ...topics().psychological[0], quote: '输入并没有这句话' }] },
    { ...topics(), psychological: Array(4).fill(topics().psychological[0]) },
  ];
  for (const value of bad)
    assert.throws(() =>
      validateAssessment({ ...safe(), reviewTopics: value }, data, { requireReviewTopics: true }),
    );
  assert.throws(() => validateAssessment(safe(), data, { requireReviewTopics: true }));
  assert.throws(() =>
    buildAutomaticResult({
      snapshot: { ...data, imageCount: 0 },
      textResult: {
        assessment: safe(),
        model: 'qwen3.6-27b',
        settingsRevision: 1,
        policyVersion: POLICY_VERSION,
      },
    }),
  );
  assert.doesNotThrow(() => validateAssessment(safe(), data)); // legacy manual evidence remains readable
});

test('automatic text calls request the extended contract once and never send expectations', async () => {
  for (const model of ['qwen3.6-27b', 'glm-5.1']) {
    const calls = [];
    const client = createModerationAiClient({
      readSettings: async () => ({
        baseUrl: BASE_URL,
        apiKey: 'synthetic-test-key',
        model,
        revision: 1,
      }),
      fetchImpl: async (_url, options) => {
        calls.push(JSON.parse(options.body));
        return envelope(full());
      },
    });
    const result = await client.assess({
      ...data,
      inputMode: 'redacted',
      model,
      requireReviewTopics: true,
    });
    assert.deepEqual(result.assessment.reviewTopics, topics());
    assert.equal(calls.length, 1);
    const prompt = calls[0].messages[0].content;
    assert.match(prompt, /reviewTopics/);
    assert.match(prompt, /整|完整正文/);
    assert.doesNotMatch(prompt, /supportReason 七个|七个必需字段/);
    assert.deepEqual(Object.keys(JSON.parse(calls[0].messages[1].content)).sort(), [
      'content',
      'hasImages',
      'inputMode',
      'redactionCounts',
      'title',
    ]);
    if (model === 'glm-5.1')
      assert.ok(calls[0].response_format.json_schema.schema.required.includes('reviewTopics'));
  }
});

test('a legacy seven-field reply to an automatic call fails closed without retrying', async () => {
  let calls = 0;
  const client = createModerationAiClient({
    readSettings: async () => ({
      baseUrl: BASE_URL,
      apiKey: 'synthetic-test-key',
      model: 'qwen3.6-27b',
      revision: 1,
    }),
    fetchImpl: async () => {
      calls++;
      return envelope(safe());
    },
  });
  await assert.rejects(
    client.assess({ ...data, inputMode: 'redacted', requireReviewTopics: true }),
  );
  assert.equal(calls, 1);
});

test('image semantic evidence must come from its own observation, not a different image or joined fields', () => {
  const input = { title: '看图', content: '课程材料', imageCount: 2, requireReviewTopics: true };
  const value = {
    assessment: {
      ...safe(),
      reviewTopics: {
        political: [
          {
            field: 'image_2',
            quote: '讨论该国执政集团的权力交接安排',
            reason: '存在政治权力交接语义，需要负责人核查。',
          },
        ],
        psychological: [],
      },
    },
    imageObservations: [
      { imageIndex: 1, text: '校园地图', description: '清晰地图' },
      { imageIndex: 2, text: '讨论该国执政集团的权力交接安排', description: '清晰文字截图' },
    ],
  };
  const got = parseModeration(value, input);
  assert.equal(got.assessment.reviewTopics.political[0].field, 'image_2');
  value.assessment.reviewTopics.political[0].field = 'image_1';
  assert.throws(() => parseModeration(value, input));
  delete value.assessment.reviewTopics;
  assert.throws(() => parseModeration(value, input));
  assert.throws(() =>
    validateReviewTopics(
      { political: [{ field: 'image_1', quote: 'ab', reason: 'test' }], psychological: [] },
      { image_1: ['a', 'b'] },
    ),
  );
});

test('Kimi automatic image requests require and preserve the same independent topic contract', async () => {
  const requests = [];
  const value = {
    assessment: full(),
    imageObservations: [{ imageIndex: 1, text: '校园风景', description: '清晰的校园照片' }],
  };
  const client = createModerationImageClient({
    settings: { baseUrl: BASE_URL, apiKey: 'synthetic-test-key', revision: 1 },
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return envelope(value);
    },
  });
  const result = await client.assess({
    ...data,
    model: 'kimi-k2.6',
    requireReviewTopics: true,
    images: [
      {
        mimeType: 'image/png',
        dataBase64: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]).toString('base64'),
      },
    ],
  });
  assert.deepEqual(result.assessment.reviewTopics, topics());
  assert.equal(requests.length, 1);
  assert.match(requests[0].messages[0].content, /supportReason\/reviewTopics/);
  assert.match(requests[0].messages[0].content, /八个字段/);
});
