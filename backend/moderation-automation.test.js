const test = require('node:test');
const assert = require('node:assert/strict');
const {
  automationEnvironmentEnabled,
  imageAutomationEnabled,
  createModerationAutomation,
} = require('./moderation-automation');
const { ModerationAiError } = require('./moderation-ai-client');
const { POLICY_VERSION } = require('./moderation-policy');

const configuration = () => ({
  discussionModerationEnabled: true,
  discussionModerationAiTestEnabled: true,
  discussionModerationAutoTestEnabled: true,
  discussionModerationAutoModel: 'qwen3.6-27b',
  discussionModerationBackupModel: 'glm-5.1',
  apiHost: '127.0.0.1',
  publicWebUrl: 'http://127.0.0.1:3000',
  db: { host: '127.0.0.1' },
});

const acceptedAssessment = () => ({
  decision: 'no_risk_detected',
  categories: [],
  reason: '普通学习建议。',
  ruleMatches: [],
  uncertainties: [],
  supportPriority: 'none',
  supportReason: '',
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function harness() {
  const config = configuration();
  const calls = [];
  const warnings = [];
  const timers = new Map();
  let timerId = 0;
  let time = 0;
  let paused = false;
  let provider;
  let imageProvider;
  let prepare;
  let finish;
  let recover;
  const queue = [];
  const finished = [];
  const snapshots = new Map();
  const response = {
    assessment: acceptedAssessment(),
    model: 'qwen3.6-27b',
    settingsRevision: 1,
    policyVersion: POLICY_VERSION,
    policyDecision: { recommendedAction: 'allow', canAutomaticallyPublish: true },
    policyEvidence: ['UNTRUSTED_PROVIDER_EVIDENCE'],
    apiKey: 'DO_NOT_SAVE',
  };
  const store = {
    async claim() {
      calls.push(['claim']);
      return queue.shift() || null;
    },
    async prepare(claim) {
      calls.push(['prepare', claim.id]);
      if (prepare) return prepare(claim);
      return snapshots.get(claim.id);
    },
    async finish(claim, result, options) {
      calls.push(['finish', claim.id]);
      if (finish) await finish(claim, result, options);
      const applied = options.canApply();
      finished.push({ claim, result, applied });
      return { applied };
    },
    async recover() {
      calls.push(['recover']);
      if (recover) await recover();
    },
    async purge() {
      calls.push(['purge']);
    },
  };
  const client = {
    async assess(input) {
      calls.push(['provider', structuredClone(input)]);
      if (provider) return provider(input);
      return structuredClone(response);
    },
  };
  const options = {
    store,
    client,
    imageClient: {
      async assess(input) {
        calls.push(['imageProvider', structuredClone(input)]);
        return imageProvider(input);
      },
    },
    config,
    isEnabled: async () => !paused,
    now: () => time,
    logger: { warn: (...values) => warnings.push(values) },
    setTimeoutImpl(callback, delay) {
      timerId += 1;
      const id = timerId;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeoutImpl(id) {
      timers.delete(id);
    },
  };
  const worker = createModerationAutomation(options);
  function add(overrides = {}) {
    const number = snapshots.size + 1;
    const claim = {
      id: `job-${number}`,
      submissionId: `submission-${number}`,
      submissionVersion: 1,
      contentHash: String(number).repeat(64),
      token: `lease-${number}`,
    };
    snapshots.set(claim.id, {
      submissionId: claim.submissionId,
      version: claim.submissionVersion,
      contentHash: claim.contentHash,
      inputHash: 'b'.repeat(64),
      title: '自习建议',
      content: '建议自习室增加插座。',
      counts: {},
      imageCount: 0,
      redactorVersion: 'local-preview-v2',
      ...overrides,
    });
    queue.push(claim);
    return claim;
  }
  return {
    worker,
    config,
    options,
    add,
    response,
    calls,
    finished,
    snapshots,
    queue,
    warnings,
    timers,
    pause(value = true) {
      paused = value;
    },
    setTime(value) {
      time = value;
    },
    setProvider(value) {
      provider = value;
    },
    setImageProvider(value) {
      imageProvider = value;
    },
    setPrepare(value) {
      prepare = value;
    },
    setFinish(value) {
      finish = value;
    },
    setRecover(value) {
      recover = value;
    },
  };
}

test('image review is explicitly gated and cannot change the text or image model', () => {
  const config = configuration();
  assert.equal(imageAutomationEnabled(config), false);
  config.discussionModerationAutoImagesEnabled = true;
  assert.equal(imageAutomationEnabled(config), true);
  config.discussionModerationImageModel = 'qwen3.6-27b';
  assert.equal(imageAutomationEnabled(config), false);
  config.discussionModerationImageModel = 'kimi-k2.6';
  config.apiHost = '0.0.0.0';
  assert.equal(imageAutomationEnabled(config), false);
});

const imageSnapshot = (count = 4) => ({
  imageCount: count,
  images: Array.from({ length: count }, (_, i) => ({
    id: `attachment-${i}`,
    mimeType: 'image/webp',
    dataBase64: `TEST_IMAGE_BYTES_${i}`,
  })),
});
const imageResponse = (input) => ({
  assessment: acceptedAssessment(),
  imageObservations: input.images.map((_, i) => ({
    imageIndex: i + 1,
    text: '建议增加插座',
    description: '文字清楚可读。',
  })),
  model: 'kimi-k2.6',
  settingsRevision: 1,
  policyVersion: POLICY_VERSION,
  imageContractVersion: require('./moderation-image-client').IMAGE_CONTRACT_VERSION,
});

test('automatic images use Qwen for text and one Kimi call per batch of at most three, without persisting pixels', async () => {
  const h = harness();
  h.config.discussionModerationAutoImagesEnabled = true;
  h.setImageProvider(imageResponse);
  h.add(imageSnapshot());
  h.worker.start();
  await h.worker.tick();
  h.worker.stop();
  assert.equal(h.calls.filter(([type]) => type === 'provider').length, 1);
  const batches = h.calls.filter(([type]) => type === 'imageProvider');
  assert.deepEqual(
    batches.map(([, input]) => [input.model, input.images.length]),
    [
      ['kimi-k2.6', 3],
      ['kimi-k2.6', 1],
    ],
  );
  assert.equal(h.finished[0].result.policyDecision.recommendedAction, 'allow');
  assert.equal(h.finished[0].result.imagesReviewed, true);
  assert.equal(h.finished[0].result.requiresPostPublicationReview, true);
  assert.doesNotMatch(JSON.stringify(h.finished), /TEST_IMAGE_BYTES|DO_NOT_SAVE/);
});

test('privacy in original text skips image calls and remains manual', async () => {
  const h = harness();
  h.config.discussionModerationAutoImagesEnabled = true;
  h.add({ ...imageSnapshot(1), counts: { name: 1 } });
  h.worker.start();
  await h.worker.tick();
  h.worker.stop();
  assert.equal(h.calls.filter(([type]) => type === 'imageProvider').length, 0);
  assert.equal(h.finished[0].result.policyDecision.recommendedAction, 'hold');
  assert.equal(h.finished[0].result.assessment.decision, 'no_risk_detected');
  assert.equal(h.finished[0].result.imagesReviewed, false);
});

test('image psychological focus stops later batches and is preserved for human attention', async () => {
  const h = harness();
  h.config.discussionModerationAutoImagesEnabled = true;
  h.setImageProvider((input) => {
    const got = imageResponse(input);
    got.imageObservations[0].text = '同学最近情绪崩溃，想寻求帮助';
    return got;
  });
  h.add(imageSnapshot());
  h.worker.start();
  await h.worker.tick();
  h.worker.stop();
  assert.equal(h.calls.filter(([type]) => type === 'imageProvider').length, 1);
  assert.equal(h.finished[0].result.imagesReviewed, false);
  assert.equal(h.finished[0].result.reviewFocus.psychological, true);
  assert.equal(h.finished[0].result.policyDecision.recommendedAction, 'hold');
  assert.equal(h.finished[0].result.imageResults.length, 1);
});

test('text political focus holds a pictured post without unnecessary image calls', async () => {
  const h = harness();
  h.config.discussionModerationAutoImagesEnabled = true;
  h.add({ ...imageSnapshot(1), content: '讨论国家安全法的课程作业。' });
  h.worker.start();
  await h.worker.tick();
  h.worker.stop();
  assert.equal(h.calls.filter(([type]) => type === 'imageProvider').length, 0);
  assert.equal(h.finished[0].result.reviewFocus.political, true);
  assert.equal(h.finished[0].result.policyDecision.recommendedAction, 'hold');
  assert.equal(h.finished[0].result.imagesReviewed, false);
});

test('pause after the first image batch prevents another call or publication', async () => {
  const h = harness();
  h.config.discussionModerationAutoImagesEnabled = true;
  h.setImageProvider((input) => {
    h.pause();
    return imageResponse(input);
  });
  h.add(imageSnapshot());
  h.worker.start();
  await h.worker.tick();
  h.worker.stop();
  assert.equal(h.calls.filter(([type]) => type === 'imageProvider').length, 1);
  assert.equal(h.finished[0].applied, false);
  assert.equal(h.finished[0].result.policyDecision.recommendedAction, 'hold');
});

test('image failures retain sanitized structural diagnostics and never retry the API', async () => {
  const { ModerationImageError } = require('./moderation-image-client');
  const h = harness();
  h.config.discussionModerationAutoImagesEnabled = true;
  h.setImageProvider(() => {
    throw new ModerationImageError('image_observations_invalid', {
      stage: 'validation',
      rawBody: 'NEVER_SAVE_REPLY',
      apiKey: 'NEVER_SAVE_KEY',
    });
  });
  h.add(imageSnapshot(1));
  h.worker.start();
  await h.worker.tick();
  h.worker.stop();
  assert.equal(h.calls.filter(([type]) => type === 'imageProvider').length, 1);
  assert.equal(h.finished[0].result.policyDecision.recommendedAction, 'hold');
  assert.equal(h.finished[0].result.manualReview.validation, 'failed');
  assert.equal(
    h.finished[0].result.manualReview.imageDiagnostics.failureCode,
    'image_observations_invalid',
  );
  assert.doesNotMatch(JSON.stringify(h.finished), /provider-secret|NEVER_SAVE/);
});

test('automatic review requires explicit loopback test gates and exact primary/manual backup models', () => {
  assert.equal(automationEnvironmentEnabled(configuration()), true);
  for (const patch of [
    { discussionModerationEnabled: false },
    { discussionModerationAiTestEnabled: false },
    { discussionModerationAutoTestEnabled: false },
    { discussionModerationAutoTestEnabled: 'true' },
    { apiHost: '0.0.0.0' },
    { db: undefined },
    { db: { host: 'production.example.test' } },
    { db: { host: '192.168.0.2' } },
    { publicWebUrl: 'https://freebbs.example.test' },
    { publicWebUrl: 'http://user:password@127.0.0.1' },
    { publicWebUrl: 'ftp://127.0.0.1' },
    { publicWebUrl: 'not a URL' },
    { discussionModerationAutoModel: 'glm-5.1' },
    { discussionModerationAutoModel: 'unknown-model' },
    { discussionModerationBackupModel: 'kimi-k2.6' },
  ])
    assert.equal(automationEnvironmentEnabled({ ...configuration(), ...patch }), false);
  assert.equal(automationEnvironmentEnabled(), false);
});

test('disabled and stopped workers do not claim jobs, access the provider or schedule timers', async () => {
  const h = harness();
  h.config.discussionModerationAutoTestEnabled = false;
  h.add();
  assert.equal(h.worker.start().running, false);
  assert.equal((await h.worker.tick()).status, 'stopped');
  assert.equal(h.calls.length, 0);
  assert.equal(h.timers.size, 0);
});

test('a paused worker still performs retention/recovery without claiming or calling the provider', async () => {
  const h = harness();
  h.add();
  h.pause();
  h.worker.start();
  assert.equal((await h.worker.tick()).status, 'paused');
  assert.deepEqual(h.calls, [['recover'], ['purge']]);
  assert.equal(h.queue.length, 1);
  h.pause(false);
  await h.worker.tick();
  assert.equal(h.finished.length, 1);
  assert.equal(h.calls.filter(([name]) => name === 'recover').length, 1);
  h.worker.stop();
});

test('one redacted Qwen call produces a local decision and evidence without provider authority fields', async () => {
  const h = harness();
  h.add();
  h.worker.start();
  await h.worker.tick();
  const inputs = h.calls.filter(([name]) => name === 'provider');
  assert.equal(inputs.length, 1);
  assert.deepEqual(inputs[0][1], {
    title: '自习建议',
    content: '建议自习室增加插座。',
    inputMode: 'redacted',
    redactionCounts: {},
    hasImages: false,
    model: 'qwen3.6-27b',
  });
  const { result, applied } = h.finished[0];
  assert.equal(applied, true);
  assert.equal(result.source, 'automatic');
  assert.equal(result.reviewerId, undefined);
  assert.equal(result.policyDecision.recommendedAction, 'allow');
  assert.equal(result.policyDecision.canAutomaticallyPublish, false);
  assert.equal(result.automaticPublication, false);
  assert.deepEqual(result.policyEvidence, []);
  assert.equal(JSON.stringify(result).includes('DO_NOT_SAVE'), false);
  assert.equal(JSON.stringify(result).includes('UNTRUSTED'), false);
  h.worker.stop();
});

test('image submissions go directly to manual review without a paid text call', async () => {
  const h = harness();
  h.add({ imageCount: 1 });
  h.worker.start();
  await h.worker.tick();
  assert.equal(
    h.calls.some(([name]) => name === 'provider'),
    false,
  );
  const { result } = h.finished[0];
  assert.equal(result.assessment, null);
  assert.equal(result.policyDecision.recommendedAction, 'hold');
  assert.equal(result.automationReason, 'image_requires_review');
  assert.deepEqual(result.manualReview, {
    required: true,
    validation: 'not_attempted',
    reason: 'images_not_reviewed',
  });
  h.worker.stop();
});

test('local privacy replacements preserve the original privacy hold even after a no-risk response', async () => {
  const h = harness();
  h.add({ content: '我是【姓名_1】，建议增加插座。', counts: { name: 1 } });
  h.worker.start();
  await h.worker.tick();
  const { result } = h.finished[0];
  assert.equal(result.assessment.decision, 'no_risk_detected');
  assert.equal(result.policyDecision.recommendedAction, 'hold');
  assert.ok(result.policyDecision.reasons.includes('original_privacy_requires_review'));
  h.worker.stop();
});

test('concurrent ticks cannot make concurrent model calls or duplicate job claims', async () => {
  const h = harness();
  h.add();
  h.add();
  const entered = deferred();
  const pending = deferred();
  h.setProvider(() => {
    entered.resolve();
    return pending.promise;
  });
  h.worker.start();
  const first = h.worker.tick();
  await entered.promise;
  assert.equal((await h.worker.tick()).status, 'busy');
  assert.equal(h.calls.filter(([name]) => name === 'claim').length, 1);
  assert.equal(h.calls.filter(([name]) => name === 'provider').length, 1);
  pending.resolve(h.response);
  await first;
  assert.equal(h.queue.length, 1);
  assert.equal(h.finished.length, 1);
  h.worker.stop();
});

test('stop returns immediately and a late provider result cannot publish', async () => {
  const h = harness();
  h.add();
  const entered = deferred();
  const pending = deferred();
  h.setProvider(() => {
    entered.resolve();
    return pending.promise;
  });
  h.worker.start();
  const running = h.worker.tick();
  await entered.promise;
  assert.equal(h.worker.stop().running, false);
  assert.equal(h.timers.size, 0);
  pending.resolve(h.response);
  await running;
  assert.equal(h.finished[0].applied, false);
  assert.equal(h.timers.size, 0);
});

test('restart before a previous response arrives does not authorize that previous generation', async () => {
  const h = harness();
  h.add();
  const entered = deferred();
  const pending = deferred();
  h.setProvider(() => {
    entered.resolve();
    return pending.promise;
  });
  h.worker.start();
  const running = h.worker.tick();
  await entered.promise;
  h.worker.stop();
  h.worker.start();
  assert.equal((await h.worker.tick()).status, 'busy');
  pending.resolve(h.response);
  await running;
  assert.equal(h.finished[0].applied, false);
  assert.equal(h.timers.size, 1);
  h.worker.stop();
});

test('pause during a model call prevents publication of the response', async () => {
  const h = harness();
  h.add();
  const entered = deferred();
  const pending = deferred();
  h.setProvider(() => {
    entered.resolve();
    return pending.promise;
  });
  h.worker.start();
  const running = h.worker.tick();
  await entered.promise;
  h.pause();
  pending.resolve(h.response);
  await running;
  assert.equal(h.finished[0].applied, false);
  h.worker.stop();
});

test('stop while the store finalizes a result is also checked at the final callback', async () => {
  const h = harness();
  h.add();
  h.setFinish(async () => {
    h.worker.stop();
  });
  h.worker.start();
  await h.worker.tick();
  assert.equal(h.finished[0].applied, false);
});

test('a pause after claiming prevents the external call and settles the claim as manual', async () => {
  const h = harness();
  const claim = h.add();
  h.setPrepare(async () => {
    h.pause();
    return h.snapshots.get(claim.id);
  });
  h.worker.start();
  await h.worker.tick();
  assert.equal(
    h.calls.some(([name]) => name === 'provider'),
    false,
  );
  assert.equal(h.finished[0].result.automationReason, 'worker_paused');
  assert.equal(h.finished[0].applied, false);
  h.worker.stop();
});

test('trusted HTTP-200 contract failures retain only sanitized unverified review signals', async () => {
  const h = harness();
  h.add();
  const error = new ModerationAiError(502, 'category_rule_mismatch', {
    httpStatus: 200,
    reviewSignal: {
      version: 1,
      reportedDecision: 'high_risk',
      reportedCategories: ['privacy', 'SECRET'],
      reportedRuleIds: ['隐私-003', 'SECRET'],
      reportedSupportPriority: 'none',
      secret: 'DO_NOT_SAVE',
    },
  });
  error.reviewContext = {
    model: 'qwen3.6-27b',
    settingsRevision: 3,
    policyVersion: POLICY_VERSION,
    apiKey: 'DO_NOT_SAVE',
  };
  error.providerBody = 'DO_NOT_SAVE';
  h.setProvider(async () => {
    throw error;
  });
  h.worker.start();
  await h.worker.tick();
  const { result } = h.finished[0];
  assert.equal(result.assessment, null);
  assert.equal(result.settingsRevision, 3);
  assert.equal(result.policyDecision.recommendedAction, 'hold');
  assert.deepEqual(result.manualReview.diagnostics.reviewSignal, {
    version: 1,
    reportedDecision: 'high_risk',
    reportedCategories: ['privacy'],
    reportedRuleIds: ['隐私-003'],
    reportedSupportPriority: 'none',
  });
  assert.equal(JSON.stringify(result).includes('SECRET'), false);
  assert.equal(JSON.stringify(result).includes('DO_NOT_SAVE'), false);
  h.worker.stop();
});

test('HTTP-403, timeout and unknown errors remain manual with no fallback or automatic retry', async () => {
  for (const error of [
    new ModerationAiError(502, 'http_error', { httpStatus: 403 }),
    new ModerationAiError(504, 'timeout'),
    new Error('DO_NOT_SAVE_RAW_PROVIDER_MESSAGE'),
  ]) {
    const h = harness();
    h.add();
    error.reviewContext = {
      model: 'qwen3.6-27b',
      settingsRevision: 1,
      policyVersion: POLICY_VERSION,
    };
    h.setProvider(async () => {
      throw error;
    });
    h.worker.start();
    await h.worker.tick();
    await h.worker.tick();
    const { result } = h.finished[0];
    assert.equal(h.calls.filter(([name]) => name === 'provider').length, 1);
    assert.equal(result.assessment, null);
    assert.equal(result.model, 'qwen3.6-27b');
    assert.equal(result.manualReview.diagnostics?.reviewSignal, undefined);
    assert.equal(result.policyDecision.recommendedAction, 'hold');
    assert.equal(JSON.stringify(result).includes('DO_NOT_SAVE'), false);
    assert.equal(JSON.stringify(h.warnings).includes('DO_NOT_SAVE'), false);
    h.worker.stop();
  }
});

test('missing or stale response metadata cannot authorize an otherwise valid no-risk assessment', async () => {
  for (const patch of [
    { settingsRevision: undefined },
    { settingsRevision: -1 },
    { model: 'glm-5.1' },
    { policyVersion: 'old-policy' },
  ]) {
    const h = harness();
    h.add();
    Object.assign(h.response, patch);
    h.worker.start();
    await h.worker.tick();
    assert.equal(h.finished[0].result.assessment, null);
    assert.equal(h.finished[0].result.automationReason, 'assessment_invalid');
    assert.equal(h.finished[0].result.policyDecision.recommendedAction, 'hold');
    h.worker.stop();
  }
});

test('an invalid success payload is revalidated against the immutable sent text', async () => {
  const h = harness();
  h.add();
  h.response.assessment = {
    ...acceptedAssessment(),
    decision: 'needs_review',
    categories: ['privacy'],
    ruleMatches: [
      {
        ruleId: '隐私-003',
        evidence: { field: 'content', quote: '不存在的地址' },
        explanation: '隐私',
      },
    ],
  };
  h.worker.start();
  await h.worker.tick();
  assert.equal(h.finished[0].result.assessment, null);
  assert.equal(h.finished[0].result.manualReview.diagnostics.failureCode, 'rule_evidence_invalid');
  h.worker.stop();
});

test('missing, stale or unredacted snapshots are settled without sending content externally', async () => {
  for (const snapshot of [
    null,
    { version: 2 },
    { redactorVersion: null },
    { contentHash: 'invalid' },
    { imageCount: -1 },
  ]) {
    const h = harness();
    const claim = h.add(snapshot || {});
    if (snapshot === null) h.setPrepare(async () => null);
    h.worker.start();
    await h.worker.tick();
    assert.equal(
      h.calls.some(([name]) => name === 'provider'),
      false,
    );
    assert.equal(h.finished[0].claim.id, claim.id);
    assert.equal(h.finished[0].result.automationReason, 'snapshot_invalid');
    h.worker.stop();
  }
});

test('preparation errors settle manual and persistence errors recover without repeating an API call', async () => {
  const h = harness();
  h.add();
  h.setPrepare(async () => {
    throw new Error('DO_NOT_SAVE_SQL_AND_BODY');
  });
  h.worker.start();
  await h.worker.tick();
  assert.equal(h.finished[0].result.automationReason, 'snapshot_invalid');
  assert.equal(
    h.calls.some(([name]) => name === 'provider'),
    false,
  );
  h.setPrepare(null);
  h.add();
  h.setFinish(async () => {
    throw new Error('DO_NOT_SAVE_DATABASE_ERROR');
  });
  assert.equal((await h.worker.tick()).status, 'unavailable');
  h.setTime(31000);
  await h.worker.tick();
  assert.equal(h.calls.filter(([name]) => name === 'provider').length, 1);
  assert.equal(h.calls.filter(([name]) => name === 'recover').length, 2);
  assert.equal(JSON.stringify(h.warnings).includes('DO_NOT_SAVE'), false);
  h.worker.stop();
});

test('a new worker recovers persistent leases before claiming new jobs and does not resubmit them', async () => {
  const h = harness();
  h.add();
  h.setRecover(async () => {
    h.queue.shift();
  });
  const restartedWorker = createModerationAutomation(h.options);
  restartedWorker.start();
  await restartedWorker.tick();
  assert.deepEqual(h.calls, [['recover'], ['purge'], ['claim']]);
  assert.equal(h.finished.length, 0);
  restartedWorker.stop();
});

test('start is idempotent, timers remain bounded and repeated store errors log only fixed throttled messages', async () => {
  const h = harness();
  h.setRecover(async () => {
    throw new Error('DO_NOT_SAVE');
  });
  h.worker.start();
  h.worker.start();
  assert.equal(h.timers.size, 1);
  await h.worker.tick();
  await h.worker.tick();
  assert.equal(h.warnings.length, 1);
  assert.equal(h.timers.size, 1);
  assert.equal([...h.timers.values()][0].delay, 1000);
  h.setTime(31000);
  await h.worker.tick();
  assert.equal(h.warnings.length, 2);
  assert.equal(JSON.stringify(h.warnings).includes('DO_NOT_SAVE'), false);
  h.worker.stop();
  assert.equal(h.timers.size, 0);
});
