const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const policy = require('../public/learning-policy');

const version = 'a'.repeat(64);
const questionVersion = 'b'.repeat(64);
const questions = [
  {
    id: 'q-basic',
    official: true,
    assessmentRole: 'selftest',
    difficulty: 'basic',
    questionVersion,
  },
  { id: 'q-standard', assessmentRole: 'practice', difficulty: 'standard', questionVersion },
  { id: 'q-challenge', assessmentRole: 'practice', difficulty: 'challenge', questionVersion },
  { id: 'q-explore', assessmentRole: 'exploration', difficulty: 'standard', questionVersion },
];
const actual = {
  materials: { body: true, origin: true, relations: true },
  questions,
  documentVersion: version,
};

test('all sixteen starting combinations have deterministic named modular chains and no grades', () => {
  const keys = new Set();
  for (const purpose of Object.keys(policy.PURPOSES))
    for (const level of Object.keys(policy.LEVELS)) {
      const input = { purpose, level };
      const result = policy.buildPolicy(input, actual);
      assert.deepEqual(result, policy.buildPolicy(input, actual));
      assert.equal(result.policyVersion, 'purpose-level-v1');
      assert.equal(result.strategyId, `${purpose}:${level}`);
      assert.deepEqual(
        result.steps.map((step) => step.moduleId),
        policy.CHAINS[`${purpose}:${level}`],
      );
      assert.ok(result.steps.length >= 4 && result.steps.length <= 6);
      assert.ok(result.steps.every((step) => step.output && step.prompt && step.title));
      assert.equal(result.evidenceStatus, 'not_calibrated');
      assert.ok(!('score' in result) && !('stars' in result) && !('mastered' in result));
      keys.add(result.strategyId);
    }
  assert.equal(keys.size, 16);
});

test('new purposes never silently reinterpret a legacy goal without the explicit policy context', () => {
  for (const purpose of ['concepts', 'research', '', null, 'toString', '__proto__']) {
    assert.equal(policy.normalizeConfig({ purpose, level: 'new' }), null);
    assert.equal(policy.buildPolicy({ purpose, level: 'new' }), null);
  }
  assert.equal(policy.normalizeConfig({ goal: 'practice', level: 'new' }), null);
  assert.equal(policy.normalizeConfig({ purpose: ['learn'], level: 'new' }), null);
  assert.equal(policy.normalizeConfig({ purpose: 'learn', level: ['new'] }), null);
});

test('context contract requires exact version and a controlled optional module', () => {
  assert.deepEqual(
    policy.normalizeContext({
      policy: policy.POLICY_VERSION,
      purpose: 'review',
      level: 'familiar',
      module: 'retrieve',
      prompt: 'SECRET',
    }),
    {
      policyVersion: policy.POLICY_VERSION,
      purpose: 'review',
      level: 'familiar',
      module: 'retrieve',
    },
  );
  for (const invalid of [
    null,
    [],
    {},
    { policy: 'old', purpose: 'learn', level: 'new' },
    { policy: policy.POLICY_VERSION, policyVersion: 'different', purpose: 'learn', level: 'new' },
    { policy: policy.POLICY_VERSION, purpose: 'learn', level: 'new', module: 'admin' },
    { policy: policy.POLICY_VERSION, purpose: 'learn', level: 'new', module: ['read'] },
    { policy: policy.POLICY_VERSION, purpose: 'learn', level: 'expert' },
  ]) {
    assert.equal(policy.normalizeContext(invalid), null);
    assert.equal(policy.buildPromptHint(invalid), '');
  }
});

test('controlled Max hint names adjustable support and self-report, never accepts free-form overrides', () => {
  const hint = policy.buildPromptHint(
    {
      policyVersion: policy.POLICY_VERSION,
      purpose: 'review',
      level: 'new',
      module: 'retrieve',
      hint: 'SECRET',
    },
    { hasContent: true },
  );
  assert.match(hint, /purpose-level-v1/);
  assert.match(hint, /本人自述/);
  assert.match(hint, /跳过回忆不是失败/);
  assert.match(hint, /不代做/);
  assert.match(hint, /不判正式成绩或授星/);
  assert.match(hint, /从学习链选择的模块：retrieve/);
  assert.match(hint, /不是能力诊断/);
  assert.match(hint, /不代表效果已经得到验证/);
  assert.match(hint, /当前实际工具与用户本次请求优先/);
  assert.doesNotMatch(hint, /当前主动进入的模块/);
  assert.doesNotMatch(hint, /SECRET/);
});

test('four self-reports do not map one to one to four difficulty categories', () => {
  const selected = Object.keys(policy.LEVELS).map((level) =>
    policy.buildPolicy({ purpose: 'learn', level }, actual),
  );
  const candidate = selected
    .map((result) => result.steps.find((step) => step.moduleId === 'practice')?.question)
    .filter(Boolean);
  assert.ok(candidate.length >= 2);
  assert.ok(
    candidate.every(
      (question) =>
        question.id === 'q-basic' && question.basis === 'published_role_available_order',
    ),
  );
});

test('question role, then trusted current-version evidence, selects candidates without changing official mode', () => {
  const context = {
    ...actual,
    trustedEvidence: {
      source: 'authenticated_current_version',
      attempts: [
        {
          questionId: 'q-basic',
          official: true,
          documentVersion: version,
          questionVersion,
          status: 'graded',
          verdict: 'pass',
        },
      ],
    },
  };
  const result = policy.buildPolicy({ purpose: 'learn', level: 'new' }, context);
  const selected = result.steps.find((step) => step.moduleId === 'practice').question;
  assert.equal(selected.id, 'q-standard');
  assert.equal(selected.basis, 'current_question_evidence');
  assert.equal(selected.mode, 'practice');
  const transfer = policy
    .buildPolicy({ purpose: 'explore', level: 'advanced' }, context)
    .steps.find((step) => step.moduleId === 'transfer').question;
  assert.equal(transfer.id, 'q-explore');
  assert.equal(transfer.role, 'exploration');
});

test('self-checks, practice, old versions and pending review do not become successful mastery evidence', () => {
  const base = {
    questionId: 'q-basic',
    official: true,
    documentVersion: version,
    questionVersion,
    status: 'graded',
    verdict: 'pass',
  };
  for (const evidence of [
    { source: 'browser', attempts: [base] },
    { source: 'authenticated_current_version', attempts: [{ ...base, official: false }] },
    {
      source: 'authenticated_current_version',
      attempts: [{ ...base, documentVersion: 'c'.repeat(64) }],
    },
    {
      source: 'authenticated_current_version',
      attempts: [{ ...base, questionVersion: 'c'.repeat(64) }],
    },
  ])
    assert.deepEqual(
      policy.currentEvidence(evidence, policy.normalizeQuestions(questions), version),
      [],
    );
  const pending = policy.currentEvidence(
    {
      source: 'authenticated_current_version',
      attempts: [{ ...base, status: 'pending_review', verdict: null }],
    },
    policy.normalizeQuestions(questions),
    version,
  );
  assert.equal(pending[0].outcome, 'pending');
  assert.equal(
    policy.selectQuestion(policy.normalizeQuestions(questions), 'learn', pending, 'practice').basis,
    'published_role_available_order',
  );
});

test('a newer incompatible formal snapshot prevents resurrecting an older matching pass', () => {
  const base = {
    questionId: 'q-basic',
    official: true,
    documentVersion: version,
    questionVersion,
    status: 'graded',
    verdict: 'pass',
  };
  const evidence = {
    source: 'authenticated_current_version',
    attempts: [{ ...base, questionVersion: 'c'.repeat(64) }, base],
  };
  assert.deepEqual(
    policy.currentEvidence(evidence, policy.normalizeQuestions(questions), version),
    [],
  );
});

test('missing materials honestly degrade every combination without claiming worked examples or transfer tests', () => {
  for (const purpose of Object.keys(policy.PURPOSES))
    for (const level of Object.keys(policy.LEVELS)) {
      const result = policy.buildPolicy({ purpose, level });
      assert.ok(result.steps.every((step) => !step.question));
      const reading = result.steps.find((step) => step.moduleId === 'read');
      if (reading) {
        assert.equal(reading.available, false);
        assert.match(reading.note, /尚不可用/);
      }
      const origin = result.steps.find((step) => step.moduleId === 'origin');
      if (origin) assert.match(origin.note, /未读取到知识起源/);
      const transfer = result.steps.find((step) => step.moduleId === 'transfer');
      if (transfer) assert.match(transfer.note, /不声称完成迁移测验/);
      const repair = result.steps.find((step) => step.moduleId === 'repair');
      if (repair) assert.match(repair.note, /不推断你做错了/);
    }
});

test('actual server resource booleans are compatible but a question count never invents question content', () => {
  const result = policy.buildPolicy(
    { purpose: 'learn', level: 'new' },
    { hasContent: true, hasOrigin: true, hasRelations: true, hasQuestions: true },
  );
  assert.equal(result.steps.find((step) => step.moduleId === 'read').available, true);
  assert.equal(result.steps.find((step) => step.moduleId === 'origin').note, '');
  assert.equal(result.steps.find((step) => step.moduleId === 'practice').question, null);
  assert.match(result.steps.find((step) => step.moduleId === 'practice').note, /已有题目入口/);
});

test('origin and relations views follow actual available materials rather than a hardcoded module target', () => {
  const config = { purpose: 'explore', level: 'new' };
  const present = policy.buildPolicy(config, {
    materials: { body: true, origin: true, relations: true },
  });
  assert.equal(present.steps.find((step) => step.moduleId === 'origin').view, 'origin');
  assert.equal(present.steps.find((step) => step.moduleId === 'explore').view, 'relations');
  assert.equal(present.steps.find((step) => step.moduleId === 'overview').view, 'overview');
  const absent = policy.buildPolicy(config, {
    materials: { body: true, origin: false, relations: false },
  });
  assert.equal(absent.steps.find((step) => step.moduleId === 'origin').view, 'reading');
  assert.equal(absent.steps.find((step) => step.moduleId === 'explore').view, 'reading');
});

test('unknown account ownership stays memory-only and verified users have isolated versioned storage keys', () => {
  for (const identity of [
    null,
    {},
    { uid: 'alice' },
    { verified: false, uid: 'alice' },
    { verified: true, uid: '../alice' },
  ])
    assert.equal(policy.ownerKey(identity), null);
  const alice = policy.ownerKey({ verified: true, uid: 'u_alice' });
  const bob = policy.ownerKey({ verified: true, uid: 'u_bob' });
  assert.notEqual(alice, bob);
  assert.match(alice, /purpose-level-v1:schema:2:user:u_alice$/);
});

test('record export only contains one learner chosen minimal metadata, never token, answers or private prose', () => {
  const raw = {
    policyVersion: policy.POLICY_VERSION,
    schemaVersion: policy.LAB_SCHEMA_VERSION,
    purpose: 'review',
    level: 'new',
    course: 'signals',
    point: 'SS-02-01',
    statuses: { retrieve: 'skipped', repair: 'done', admin: 'done', practice: 'pass' },
    paused: true,
    updatedAt: '2026-10-16T00:00:00Z',
    token: 'TOKEN_SECRET',
    uid: 'UID_SECRET',
    note: 'PRIVATE_NOTE',
    answer: 'PRIVATE_ANSWER',
    markdown: 'BODY_SECRET',
    score: 100,
    stars: 3,
  };
  const result = policy.exportRecord(raw);
  assert.deepEqual(result.statuses, { retrieve: 'skipped', repair: 'done' });
  assert.equal(result.paused, true);
  assert.equal(result.strategyId, 'review:new');
  assert.doesNotMatch(JSON.stringify(result), /SECRET|PRIVATE|"score"|"stars"|"uid"|"token"/);
  assert.equal(policy.exportRecord({ ...raw, policyVersion: 'old' }), null);
  assert.equal(policy.exportRecord({ ...raw, schemaVersion: 1 }), null);
});

test('public question sanitization discards answers, unsafe IDs, duplicates and unknown difficulty', () => {
  const result = policy.normalizeQuestions([
    { id: 'q-1', difficulty: 'expert', correctAnswer: 'SECRET' },
    { id: 'q-1' },
    { id: '../bad' },
  ]);
  assert.deepEqual(result, [
    { id: 'q-1', role: 'practice', difficulty: null, questionVersion: '' },
  ]);
});

test('course-authored string quiz versions match real assessment records instead of requiring a document hash', () => {
  for (const authoredVersion of ['1.0', '2026-10-16.2', '课程组修订二', 'b'.repeat(64)]) {
    const metadata = policy.normalizeQuestions([
      {
        id: 'real-published',
        official: true,
        assessmentRole: 'selftest',
        questionVersion: authoredVersion,
      },
    ]);
    assert.equal(metadata[0].questionVersion, authoredVersion);
    const entry = {
      official: true,
      questionId: 'real-published',
      questionVersion: authoredVersion,
      documentVersion: version,
      status: 'graded',
      verdict: 'pass',
    };
    assert.equal(
      policy.currentEvidence(
        { source: 'authenticated_current_version', attempts: [entry] },
        metadata,
        version,
      ).length,
      1,
    );
    assert.deepEqual(
      policy.currentEvidence(
        {
          source: 'authenticated_current_version',
          attempts: [{ ...entry, questionVersion: `${authoredVersion}-old` }],
        },
        metadata,
        version,
      ),
      [],
    );
  }
  for (const invalid of [null, [], 1, '', '   ', 'a'.repeat(65)]) {
    assert.equal(
      policy.normalizeQuestions([{ id: 'invalid-version', questionVersion: invalid }])[0]
        .questionVersion,
      '',
    );
  }
});

test('the pure browser module needs no network, storage, DOM or account dependencies', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/learning-policy.js'), 'utf8');
  const browser = {};
  vm.runInNewContext(source, { window: browser });
  assert.equal(browser.FreeBbsLearningPolicy.POLICY_VERSION, policy.POLICY_VERSION);
  assert.equal(
    browser.FreeBbsLearningPolicy.buildPolicy({ purpose: 'learn', level: 'new' }).strategyId,
    'learn:new',
  );
});

test('building a policy never mutates input resources, questions, preferences or prior formal evidence', () => {
  const config = { purpose: 'learn', level: 'new' };
  const before = JSON.stringify({ config, actual });
  policy.buildPolicy(config, actual);
  assert.equal(JSON.stringify({ config, actual }), before);
});

test('review has a shorter core than initial understanding and only repairs an observed or chosen gap', () => {
  for (const level of Object.keys(policy.LEVELS)) {
    const review = policy.buildPolicy({ purpose: 'review', level }, actual);
    const learning = policy.buildPolicy({ purpose: 'learn', level }, actual);
    assert.equal(review.coreStepCount, 3);
    assert.ok(review.coreStepCount < learning.coreStepCount);
    assert.equal(review.steps[0].moduleId, 'retrieve');
    assert.ok(review.steps.slice(3).every((step) => step.optional));
    const repair = review.steps.find((step) => step.moduleId === 'repair');
    assert.equal(repair.conditional, true);
    assert.match(repair.action, /顺利时可直接跳过/);
    assert.match(repair.note, /不会自动降级/);
    assert.equal(repair.optional, true);
    assert.equal(review.steps.find((step) => step.moduleId === 'retrieve').optional, false);
  }
});

test('all exploration levels start with a question; reading and tests are optional resources, never gates', () => {
  for (const level of Object.keys(policy.LEVELS)) {
    const plan = policy.buildPolicy({ purpose: 'explore', level }, actual);
    assert.equal(plan.steps[0].moduleId, 'explore');
    assert.ok(plan.steps.slice(1).every((step) => step.optional));
    const read = plan.steps.find((step) => step.moduleId === 'read');
    if (read) assert.equal(read.conditional, true);
    assert.match(plan.support, /无论熟悉程度.*自己的问题/);
    assert.match(plan.support, /正文和题目都只在需要时调用/);
  }
});

test('named course resource availability stays truthful even when a fallback action is possible', () => {
  const missing = policy.buildPolicy(
    { purpose: 'learn', level: 'new' },
    {
      materials: { body: false, origin: false, workedExample: false, relations: false },
    },
  );
  for (const id of ['origin', 'read', 'worked-example', 'practice', 'reflect'])
    assert.equal(missing.steps.find((step) => step.moduleId === id).available, false);
  assert.equal(
    policy.buildPolicy({ purpose: 'explore', level: 'new' }).steps[0].available,
    true,
    'A personal question needs no invented course relationship or exercise',
  );
});

test('origin-only reflection retains the annotation tool instead of falling back to plain reading', () => {
  for (const purpose of Object.keys(policy.PURPOSES))
    for (const level of Object.keys(policy.LEVELS)) {
      const origin = policy.buildPolicy(
        { purpose, level },
        { materials: { body: false, origin: true } },
      );
      const reflection = origin.steps.find((step) => step.moduleId === 'reflect');
      if (!reflection) continue;
      assert.equal(reflection.available, true, `${purpose}:${level}`);
      assert.equal(reflection.tool, 'notes', `${purpose}:${level}`);
      assert.doesNotMatch(reflection.note, /不要求在空正文上批注/);

      const missing = policy
        .buildPolicy({ purpose, level }, { materials: { body: false, origin: false } })
        .steps.find((step) => step.moduleId === 'reflect');
      assert.equal(missing.available, false);
      assert.equal(missing.tool, 'content');
    }
});
