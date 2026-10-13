const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const http = require('node:http');
const { listenAllowedLoopback } = require('../scripts/fixtures/allowed-loopback');
const {
  createLearningAssessmentRouter,
  createMemoryAssessmentStore,
  createMysqlAssessmentStore,
  ensureLearningAssessmentTables,
  parseAssessmentMarkdown,
  validateQuiz,
  gradeAnswer,
  parseFiniteNumber,
  toPublicQuestion,
  stripAssessmentBlocks,
  getAssessmentDocumentVersion,
} = require('./learning-assessment');

function quiz(overrides = {}) {
  return {
    schemaVersion: 1,
    status: 'published',
    version: '2026.1',
    source: '课程组教材第一章',
    reviewedBy: '课程负责人',
    questions: [
      {
        id: 'choice',
        type: 'single_choice',
        prompt: '选出正确答案',
        options: [
          { id: 'A', text: '正确项' },
          { id: 'B', text: '其他项' },
        ],
        scoring: { method: 'exact', answer: 'A', maxScore: 2, passScore: 2 },
        explanation: '选择 A 的依据。',
      },
      {
        id: 'multiple',
        type: 'multiple_choice',
        prompt: '选择全部正确选项',
        options: [
          { id: 'A', text: '第一项' },
          { id: 'B', text: '第二项' },
          { id: 'C', text: '第三项' },
        ],
        scoring: { method: 'exact', answer: ['A', 'C'], maxScore: 3, passScore: 3 },
      },
      {
        id: 'number',
        type: 'numeric',
        prompt: '计算有限数值',
        scoring: {
          method: 'numeric',
          target: 1,
          absoluteTolerance: 0.01,
          relativeTolerance: 0,
          maxScore: 1,
          passScore: 1,
        },
      },
      {
        id: 'explain',
        type: 'short_answer',
        prompt: '说明计算过程',
        scoring: { method: 'manual', rubric: '检查适用条件与推导过程', maxScore: 5, passScore: 3 },
      },
    ],
    ...overrides,
  };
}
function markdown(value = quiz()) {
  return `# 原有知识正文\n\n保留课程模板内容。\n\n\x60\x60\x60freebbs-quiz\n${JSON.stringify(value)}\n\x60\x60\x60\n`;
}
const users = {
  student: { id: 1 },
  other: { id: 2 },
  manager: { id: 3 },
  unrelated: { id: 4 },
  admin: { id: 5, is_admin: true },
};
async function fixture(t, content = markdown()) {
  const contexts = [
    { slug: 'signals', course_id: 10, node_id: 'SS-01-01', document_markdown: content },
  ];
  const managers = [
    { userId: 3, courseId: 10 },
    { userId: 4, courseId: 11 },
  ];
  const store = createMemoryAssessmentStore({ contexts, managers });
  const events = [];
  const app = express();
  app.use(express.json());
  app.use(
    '/api/learning-assessments',
    createLearningAssessmentRouter({
      store,
      requireAuth: async (req, res) => {
        const user = users[req.headers.authorization];
        if (!user) res.status(401).json({ message: '请登录' });
        return user;
      },
      onAssessmentEvent: async (event) => events.push(event),
    }),
  );
  const server = http.createServer(app);
  await listenAllowedLoopback(server, { diagnostic: (message) => t.diagnostic(message) });
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const base = `http://127.0.0.1:${server.address().port}/api/learning-assessments/signals/SS-01-01`;
  async function call(method, suffix, body, as = 'student') {
    const response = await fetch(`${base}${suffix}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(as ? { Authorization: as } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
      status: response.status,
      data: await response.json(),
      cache: response.headers.get('cache-control'),
    };
  }
  return { store, contexts, managers, events, call, base };
}
const answer = (questionId = 'choice', value = 'A', extra = {}) => ({
  questionId,
  answer: value,
  requestKey: crypto.randomUUID(),
  ...extra,
});
async function storedAttempt(
  store,
  context,
  questionId,
  rawAnswer,
  { user = users.student, practice = false } = {},
) {
  const assessment = parseAssessmentMarkdown(context.document_markdown);
  const original = [...assessment.questions, ...assessment.practiceQuestions].find(
    (question) => question.id === questionId,
  );
  assert.ok(original, `Fixture question exists: ${questionId}`);
  const question = practice ? { ...original, official: false } : original;
  return store.create(
    user,
    context,
    question,
    gradeAnswer(question, rawAnswer),
    crypto.randomUUID(),
    crypto.randomBytes(32).toString('hex'),
    assessment.documentVersion,
    null,
  );
}

test('optional published fence extends existing Markdown and strips private scoring metadata', () => {
  const source = markdown();
  const parsed = parseAssessmentMarkdown(source);
  assert.equal(parsed.questions.length, 4);
  assert.equal(parsed.practiceQuestions.length, 0);
  assert.equal(parsed.documentVersion, getAssessmentDocumentVersion(source));
  const publicData = parsed.questions.map(toPublicQuestion);
  assert.equal(publicData[0].scoring.answer, undefined);
  assert.equal(publicData[2].scoring.target, undefined);
  assert.equal(publicData[3].scoring.rubric, undefined);
  assert.equal(publicData[0].explanation, undefined);
  assert.match(stripAssessmentBlocks(source), /保留课程模板内容/);
  assert.doesNotMatch(stripAssessmentBlocks(source), /freebbs-quiz|正确项|检查适用条件/);
  assert.equal(stripAssessmentBlocks('正文\n```freebbs-quiz\nsecret'), '正文');
});

test('question layers are optional, teacher-estimated, and preserve legacy selftest semantics', () => {
  const legacy = validateQuiz(quiz()).questions;
  assert.ok(
    legacy.every((question) => question.assessmentRole === 'selftest' && question.official),
  );
  assert.ok(legacy.every((question) => question.difficulty === undefined));
  const source = quiz();
  Object.assign(source.questions[0], {
    difficulty: 'basic',
    assessmentRole: 'practice',
    learningObjective: '检查计算条件',
    misconceptions: '不要漏掉适用条件。',
  });
  Object.assign(source.questions[1], { difficulty: 'challenge', assessmentRole: 'exploration' });
  Object.assign(source.questions[2], { difficulty: 'standard', assessmentRole: 'selftest' });
  const parsed = parseAssessmentMarkdown(markdown(source));
  assert.deepEqual(
    parsed.questions.map((question) => question.id),
    ['number', 'explain'],
  );
  assert.deepEqual(
    parsed.practiceQuestions.map((question) => question.id),
    ['choice', 'multiple'],
  );
  const publicQuestion = toPublicQuestion(parsed.practiceQuestions[0]);
  assert.equal(publicQuestion.reviewed, true);
  assert.equal(publicQuestion.difficultyBasis, 'teacher_estimate');
  assert.equal(publicQuestion.learningObjective, '检查计算条件');
  assert.equal(publicQuestion.misconceptions, undefined);
  assert.equal(publicQuestion.explanation, undefined);
  const grade = gradeAnswer(parsed.practiceQuestions[0], 'A');
  assert.equal(grade.verdict, 'practice_only');
  assert.match(grade.referenceMarkdown, /常见误区.*\n\n不要漏掉适用条件/);
});

test('invalid or calibrated difficulty claims and unknown question roles fail closed', () => {
  for (const fields of [
    { difficulty: 1 },
    { difficulty: 'hard' },
    { difficulty: null },
    { assessmentRole: 'final' },
    { assessmentRole: null },
    { difficultyBasis: 'calibrated' },
    { learningObjective: 'x'.repeat(601) },
    { misconceptions: 'x'.repeat(4001) },
  ])
    assert.throws(() =>
      validateQuiz(
        quiz({
          questions: [{ ...quiz().questions[0], ...fields }],
        }),
      ),
    );
});

test('published exploration and practice cannot be submitted as formal selftests', async (t) => {
  const value = quiz();
  value.questions[0].assessmentRole = 'practice';
  value.questions[1].assessmentRole = 'exploration';
  const { call } = await fixture(t, markdown(value));
  const response = await call('GET', '/questions');
  assert.deepEqual(
    response.data.questions.map((question) => question.id),
    ['number', 'explain'],
  );
  for (const id of ['choice', 'multiple']) {
    assert.equal(
      (await call('POST', '/attempts', answer(id, id === 'choice' ? 'A' : ['A', 'C']))).status,
      404,
    );
    const practice = await call(
      'POST',
      '/attempts',
      answer(id, id === 'choice' ? 'A' : ['A', 'C'], { mode: 'practice' }),
    );
    assert.equal(practice.status, 201);
    assert.equal(practice.data.attempt.official, false);
    assert.equal(practice.data.attempt.verdict, 'practice_only');
    assert.equal(
      practice.data.attempt.assessmentRole,
      id === 'multiple' ? 'exploration' : 'practice',
    );
    assert.equal(practice.data.attempt.question_snapshot, undefined);
    assert.equal(practice.data.attempt.scoring, undefined);
  }
});

test('changing a question role invalidates a stale formal view and never publishes its old evidence', async (t) => {
  const { call, contexts } = await fixture(t);
  const before = await call('GET', '/questions');
  const original = await call(
    'POST',
    '/attempts',
    answer('choice', 'A', { expectedDocumentVersion: before.data.documentVersion }),
  );
  assert.equal(original.data.attempt.assessmentRole, 'selftest');
  const updated = quiz();
  updated.version = '2026.2';
  updated.questions[0].assessmentRole = 'exploration';
  contexts[0].document_markdown = markdown(updated);
  const stale = await call(
    'POST',
    '/attempts',
    answer('choice', 'A', { expectedDocumentVersion: before.data.documentVersion }),
  );
  assert.equal(stale.status, 409);
  const current = await call('GET', '/questions');
  assert.equal(
    current.data.questions.some((question) => question.id === 'choice'),
    false,
  );
  assert.notEqual(current.data.documentVersion, before.data.documentVersion);
  const history = await call('GET', '/attempts');
  assert.equal(history.data.attempts[0].documentVersion, before.data.documentVersion);
});
test('only fully reviewed published data can enter formal self-test', () => {
  for (const overrides of [
    { reviewedBy: '' },
    { source: '' },
    { version: '' },
    { status: 'approved' },
    { schemaVersion: 2 },
  ]) {
    const parsed = parseAssessmentMarkdown(markdown(quiz(overrides)));
    assert.equal(parsed.questions.length, 0);
    assert.equal(parsed.warnings.length, 1);
  }
  const draft = parseAssessmentMarkdown(
    markdown(quiz({ status: 'draft', source: '', reviewedBy: '' })),
  );
  assert.equal(draft.questions.length, 0);
  assert.equal(draft.practiceQuestions.length, 4);
  assert.ok(draft.practiceQuestions.every((question) => question.official === false));
  const unreviewed = parseAssessmentMarkdown(markdown(quiz({ reviewedBy: '' })));
  assert.equal(unreviewed.practiceQuestions.length, 4);
  assert.ok(unreviewed.practiceQuestions.every((question) => question.official === false));
  assert.throws(() => validateQuiz({ ...quiz(), unexpected: 'answer leak' }), /未知字段/);
  assert.throws(
    () => validateQuiz({ ...quiz(), questions: [{ ...quiz().questions[0], score: 10 }] }),
    /未知字段/,
  );
});
test('ambiguous, incomplete and nonterminal scoring fences are never published', () => {
  for (const source of [
    `${markdown()}额外正文`,
    `${markdown()}${markdown()}`,
    '```freebbs-quiz\n{}',
    markdown().replace('"schemaVersion":1', 'invalid'),
  ]) {
    assert.equal(parseAssessmentMarkdown(source).questions.length, 0);
    assert.equal(parseAssessmentMarkdown(source).warnings.length, 1);
  }
  assert.equal(parseAssessmentMarkdown(markdown().replaceAll('```', '~~~~')).questions.length, 4);
});
test('existing course-authoring template exercises are preserved as practice with reference after submit', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../docs/course-authoring/examples/知识点/SS-01-01.md'),
    'utf8',
  );
  const parsed = parseAssessmentMarkdown(source);
  assert.equal(parsed.questions.length, 0);
  const legacy = parsed.practiceQuestions.find((question) => question.id === 'SS-01-01-Q01');
  assert.ok(legacy);
  assert.match(legacy.prompt, /零状态输出/);
  assert.doesNotMatch(legacy.prompt, /提示与参考解答|y\(t\)=/);
  const result = gradeAnswer(legacy, '我尝试先确定积分范围');
  assert.equal(result.status, 'pending_review');
  assert.equal(result.verdict, null);
  assert.equal(result.score, null);
  assert.match(result.referenceMarkdown, /1-e/);
});
test('exact objective grading has no partial credit and validates selected options', () => {
  const { questions } = validateQuiz(quiz());
  assert.equal(gradeAnswer(questions[0], 'A').verdict, 'pass');
  assert.equal(gradeAnswer(questions[0], 'B').score, 0);
  assert.equal(gradeAnswer(questions[1], ['C', 'A']).score, 3);
  assert.equal(gradeAnswer(questions[1], ['A']).score, 0);
  assert.equal(gradeAnswer(questions[1], ['A', 'B', 'C']).score, 0);
  assert.throws(() => gradeAnswer(questions[1], ['A', 'A']), /重复/);
  assert.throws(() => gradeAnswer(questions[0], 'wrong'), /有效选项/);
  assert.throws(() => gradeAnswer(questions[1], 'A'), /有效选项/);
});
test('numeric parser accepts finite scalar notation and rejects expressions, units, overflow and underflow', () => {
  for (const [input, expected] of [
    ['  +1.5e2 ', 150],
    ['-.25', -0.25],
    ['0e-999', 0],
    ['2.', 2],
  ])
    assert.equal(parseFiniteNumber(input), expected);
  for (const input of [
    'NaN',
    'Infinity',
    '1/2',
    'Math.sqrt(2)',
    'process.exit()',
    '0x10',
    '1 V',
    '',
    '1e999',
    '1e-999',
  ])
    assert.throws(() => parseFiniteNumber(input));
});
test('numeric tolerance boundaries, negative targets and strict zero tolerance are deterministic', () => {
  const question = validateQuiz(quiz()).questions[2];
  for (const input of ['0.99', '1', '1.01'])
    assert.equal(gradeAnswer(question, input).verdict, 'pass');
  for (const input of ['0.98999', '1.01001'])
    assert.equal(gradeAnswer(question, input).verdict, 'fail');
  const exact = {
    ...question,
    scoring: { ...question.scoring, target: 1, absoluteTolerance: 0, relativeTolerance: 0 },
  };
  assert.equal(gradeAnswer(exact, '1.0000000000000002').verdict, 'fail');
  const relative = {
    ...question,
    scoring: { ...question.scoring, target: -100, absoluteTolerance: 0, relativeTolerance: 0.01 },
  };
  assert.equal(gradeAnswer(relative, '-101').verdict, 'pass');
  assert.equal(gradeAnswer(relative, '-101.01').verdict, 'fail');
});
test('invalid objective schemas cannot silently choose missing scoring or thresholds', () => {
  const original = quiz().questions[2];
  for (const scoring of [
    { ...original.scoring, absoluteTolerance: undefined },
    { ...original.scoring, relativeTolerance: -1 },
    { ...original.scoring, target: Infinity },
    { ...original.scoring, passScore: 0 },
    { ...original.scoring, passScore: 2 },
    { ...original.scoring, maxScore: 0 },
  ]) {
    assert.throws(() => validateQuiz(quiz({ questions: [{ ...original, scoring }] })));
  }
});
test('every endpoint requires authentication and private no-store responses', async (t) => {
  const { call } = await fixture(t);
  for (const [method, suffix] of [
    ['GET', '/questions'],
    ['GET', '/attempts'],
    ['POST', '/attempts'],
    ['POST', '/attempts/1/review'],
    ['PATCH', '/attempts/1/review'],
  ]) {
    const result = await call(method, suffix, method === 'GET' ? undefined : answer(), '');
    assert.equal(result.status, 401);
    assert.match(result.cache, /private, no-store/);
  }
});
test('question API exposes no answer keys, target values, rubrics or explanations before submit', async (t) => {
  const { call } = await fixture(t);
  const result = await call('GET', '/questions');
  assert.equal(result.status, 200);
  assert.ok(
    result.data.questions.every(
      (question) =>
        !('answer' in question.scoring) &&
        !('target' in question.scoring) &&
        !('rubric' in question.scoring) &&
        !('explanation' in question),
    ),
  );
  assert.equal(result.data.canReview, false);
  assert.equal((await call('GET', '/questions', undefined, 'manager')).data.canReview, true);
});
test('private attempts remain visible only to author except course-scoped pending review', async (t) => {
  const { call } = await fixture(t);
  await call('POST', '/attempts', answer());
  await call('POST', '/attempts', answer('explain', 'PRIVATE EXPLANATION'));
  assert.equal(
    (await call('GET', '/attempts?userId=1', undefined, 'other')).data.attempts.length,
    0,
  );
  assert.equal((await call('GET', '/attempts', undefined, 'manager')).data.attempts.length, 0);
  assert.equal(
    (await call('GET', '/attempts?review=pending', undefined, 'manager')).data.attempts.length,
    1,
  );
  assert.equal((await call('GET', '/attempts?review=pending', undefined, 'unrelated')).status, 403);
  assert.equal((await call('GET', '/attempts?review=pending', undefined, 'other')).status, 403);
});

test('authorized review returns the submitted question snapshot after current content changes without exposing it in ordinary reads', async (t) => {
  const original = quiz();
  Object.assign(original.questions[3], {
    prompt: '提交时条件：仅讨论连续、因果系统。',
    source: '历史讲义第三节',
    learningObjective: '核对提交时的因果条件',
    explanation: 'OLD_REFERENCE_ONLY_AFTER_SUBMIT',
    misconceptions: 'OLD_MISCONCEPTION_ONLY_AFTER_SUBMIT',
    scoring: {
      method: 'manual',
      rubric: 'OLD_SAVED_REVIEW_RUBRIC',
      maxScore: 5,
      passScore: 3,
    },
  });
  const { call, contexts } = await fixture(t, markdown(original));
  const submitted = await call('POST', '/attempts', answer('explain', '我的历史论证'));
  assert.equal(submitted.status, 201);
  assert.equal(submitted.data.attempt.questionSnapshot, undefined);
  assert.equal(submitted.data.attempt.snapshotAvailability, undefined);
  const updated = quiz({ version: '2026.2' });
  updated.questions[3].prompt = '新版本条件：讨论离散、非因果系统。';
  contexts[0].document_markdown = markdown(updated);

  const review = await call('GET', '/attempts?review=pending', undefined, 'manager');
  assert.equal(review.status, 200);
  const attempt = review.data.attempts[0];
  assert.equal(attempt.snapshotAvailability, 'available');
  assert.deepEqual(attempt.questionSnapshot, {
    id: 'explain',
    type: 'short_answer',
    prompt: original.questions[3].prompt,
    questionVersion: original.version,
    source: original.questions[3].source,
    learningObjective: original.questions[3].learningObjective,
  });
  assert.equal(attempt.gradingBasis, 'OLD_SAVED_REVIEW_RUBRIC');
  assert.match(attempt.referenceMarkdown, /OLD_REFERENCE_ONLY_AFTER_SUBMIT/);
  assert.doesNotMatch(
    JSON.stringify(attempt.questionSnapshot),
    /"scoring"|"rubric"|"answer"|"explanation"|"misconceptions"|OLD_SAVED_REVIEW_RUBRIC|OLD_REFERENCE_ONLY_AFTER_SUBMIT/,
  );
  const current = await call('GET', '/questions');
  assert.equal(
    current.data.questions.find((question) => question.id === 'explain').prompt,
    updated.questions[3].prompt,
  );
  assert.equal(current.data.questionSnapshot, undefined);
  const own = await call('GET', '/attempts');
  assert.equal(own.data.attempts[0].questionSnapshot, undefined);
  assert.equal(own.data.attempts[0].snapshotAvailability, undefined);
  assert.equal((await call('GET', '/attempts?review=pending', undefined, 'unrelated')).status, 403);
  assert.equal((await call('GET', '/attempts?review=pending', undefined, 'student')).status, 403);
});

test('review snapshot options use an explicit safe shape and never expose nested scoring or unknown fields', async (t) => {
  const { call, store } = await fixture(t);
  await call('POST', '/attempts', answer('explain', '历史选择论证'));
  const stored = JSON.parse(store.rows[0].question_snapshot);
  Object.assign(stored, {
    type: 'single_choice',
    prompt: '旧题要求：选择适用条件。',
    answer: 'PRIVATE_TOP_LEVEL_KEY',
    options: [
      { id: 'A', text: '旧条件 A', answer: 'PRIVATE_OPTION_KEY', scoring: { answer: 'A' } },
      { id: 'B', text: '旧条件 B', internal: { rubric: 'PRIVATE_NESTED_KEY' } },
    ],
  });
  store.rows[0].question_snapshot = JSON.stringify(stored);
  const review = await call('GET', '/attempts?review=pending', undefined, 'manager');
  const snapshot = review.data.attempts[0].questionSnapshot;
  assert.deepEqual(snapshot.options, [
    { id: 'A', text: '旧条件 A' },
    { id: 'B', text: '旧条件 B' },
  ]);
  assert.equal(snapshot.scoring, undefined);
  assert.equal(snapshot.answer, undefined);
  assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE_|internal|rubric|scoring/);
});

test('missing, malformed or mismatched historical snapshots stay explicitly missing instead of using the current question', async (t) => {
  const { call, store } = await fixture(t);
  await call('POST', '/attempts', answer('explain', '旧记录答案'));
  const stored = JSON.parse(store.rows[0].question_snapshot);
  for (const snapshot of [
    null,
    '',
    '{invalid json',
    '[]',
    JSON.stringify({ ...stored, prompt: '' }),
    JSON.stringify({ ...stored, id: 'another-question' }),
    JSON.stringify({ ...stored, questionVersion: 'another-version' }),
    JSON.stringify({ ...stored, type: 'single_choice', options: [{ id: 'A', text: '不完整' }] }),
    JSON.stringify({
      ...stored,
      type: 'single_choice',
      options: [
        { id: 'A', text: '选项一' },
        { id: 'A', text: '重复选项' },
      ],
    }),
  ]) {
    store.rows[0].question_snapshot = snapshot;
    const review = await call('GET', '/attempts?review=pending', undefined, 'manager');
    assert.equal(review.status, 200);
    assert.equal(review.data.attempts[0].snapshotAvailability, 'missing');
    assert.equal(review.data.attempts[0].questionSnapshot, null);
  }
});

test('mysql and memory review reads use the same saved snapshot shape while ordinary mysql reads omit it', async (t) => {
  const { call, store } = await fixture(t);
  await call('POST', '/attempts', answer('explain', '数据库历史答案'));
  const row = { ...store.rows[0] };
  const queries = [];
  const mysql = createMysqlAssessmentStore({
    execute: async (sql, values) => {
      queries.push({ sql, values });
      return [[row]];
    },
  });
  const context = { course_id: 10, node_id: 'SS-01-01' };
  const review = await mysql.list(users.manager, context, '', true);
  assert.equal(review[0].snapshotAvailability, 'available');
  assert.equal(review[0].questionSnapshot.prompt, '说明计算过程');
  assert.match(queries[0].sql, /question_snapshot/);
  const own = await mysql.list(users.student, context, '', false);
  assert.equal(own[0].questionSnapshot, undefined);
  assert.equal(own[0].snapshotAvailability, undefined);
});
test('server selects question version, official status and score without trusting client metadata', async (t) => {
  const { call, store, events } = await fixture(t);
  const result = await call(
    'POST',
    '/attempts',
    answer('choice', 'B', {
      score: 100,
      verdict: 'pass',
      official: true,
      user_id: 2,
      questionVersion: 'hacked',
      documentVersion: 'hacked',
      stars: 3,
    }),
  );
  assert.equal(result.status, 201);
  assert.equal(result.data.attempt.verdict, 'fail');
  assert.equal(result.data.attempt.score, 0);
  assert.equal(result.data.attempt.questionVersion, '2026.1');
  assert.notEqual(result.data.attempt.documentVersion, 'hacked');
  assert.equal(result.data.attempt.stars, undefined);
  assert.equal(store.rows[0].user_id, 1);
  assert.equal(events[0].attempt.id, result.data.attempt.id);
});
test('request UUID retries are idempotent, conflict on changes, and retain immutable version after document edits', async (t) => {
  const { call, contexts, store } = await fixture(t);
  const body = answer();
  const responses = await Promise.all([
    call('POST', '/attempts', body),
    call('POST', '/attempts', body),
  ]);
  assert.equal(responses[0].data.attempt.id, responses[1].data.attempt.id);
  assert.equal(store.rows.length, 1);
  assert.equal((await call('POST', '/attempts', { ...body, answer: 'B' })).status, 409);
  contexts[0].document_markdown = markdown(quiz({ version: '2026.2' }));
  const retry = await call('POST', '/attempts', body);
  assert.equal(retry.data.attempt.questionVersion, '2026.1');
  assert.equal(retry.data.replayed, true);
  assert.equal((await call('POST', '/attempts', answer())).data.attempt.questionVersion, '2026.2');
  assert.notEqual(
    retry.data.attempt.documentVersion,
    (await call('GET', '/questions')).data.documentVersion,
  );
});
test('stale question views cannot silently grade against a new course document', async (t) => {
  const { call, contexts, store } = await fixture(t);
  const expectedDocumentVersion = getAssessmentDocumentVersion(contexts[0].document_markdown);
  contexts[0].document_markdown = markdown(quiz({ version: '2026.2' }));
  const stale = await call('POST', '/attempts', answer('choice', 'A', { expectedDocumentVersion }));
  assert.equal(stale.status, 409);
  assert.match(stale.data.message, /正文已更新/);
  assert.equal(store.rows.length, 0);
  const fresh = await call(
    'POST',
    '/attempts',
    answer('choice', 'A', {
      expectedDocumentVersion: getAssessmentDocumentVersion(contexts[0].document_markdown),
    }),
  );
  assert.equal(fresh.status, 201);
  assert.equal(fresh.data.attempt.questionVersion, '2026.2');
});

test('new subjective attempts are pending and only a course manager can review once', async (t) => {
  const { call } = await fixture(t);
  const result = await call(
    'POST',
    '/attempts',
    answer('explain', '适用条件与推导', { score: 5, verdict: 'pass' }),
  );
  const { id } = result.data.attempt;
  assert.equal(result.data.attempt.score, null);
  assert.equal(result.data.attempt.verdict, null);
  assert.equal(result.data.attempt.status, 'pending_review');
  assert.equal(
    (await call('PATCH', `/attempts/${id}/review`, { score: 5, feedback: '私自确认' }, 'student'))
      .status,
    403,
  );
  assert.equal(
    (
      await call(
        'PATCH',
        `/attempts/${id}/review`,
        { score: 5, feedback: '另一课程负责人' },
        'unrelated',
      )
    ).status,
    403,
  );
  assert.equal(
    (await call('PATCH', `/attempts/${id}/review`, { score: 6, feedback: '超分数' }, 'manager'))
      .status,
    409,
  );
  const reviewed = await call(
    'PATCH',
    `/attempts/${id}/review`,
    { score: 3, feedback: '条件完整，推导还需补充', reviewedBy: 1 },
    'manager',
  );
  assert.equal(reviewed.status, 200);
  assert.equal(reviewed.data.attempt.verdict, 'pass');
  assert.equal(reviewed.data.attempt.reviewedBy, '3');
  assert.equal(
    (await call('POST', `/attempts/${id}/review`, { score: 0, feedback: '重复覆盖' }, 'manager'))
      .status,
    409,
  );
  assert.equal((await call('GET', '/attempts')).data.attempts[0].score, 3);
});

test('an identical reviewer-owned retry confirms a lost receipt, including zero, normalized feedback and the original historical snapshot', async (t) => {
  const { call, contexts, store, events } = await fixture(t);
  const submitted = await call('POST', '/attempts', answer('explain', '历史条件下的论证'));
  const { id, documentVersion } = submitted.data.attempt;
  const payload = { score: 0, feedback: '  零分，条件仍需补充。\n' };
  // The first real response is deliberately treated as lost by the caller.
  const committed = await call('PATCH', `/attempts/${id}/review`, payload, 'manager');
  assert.equal(committed.status, 200);
  assert.equal(committed.data.replayed, undefined);
  const storedBefore = { ...store.rows[0] };
  contexts[0].document_markdown = markdown(quiz({ version: '2026.2' }));
  for (const method of ['PATCH', 'POST']) {
    const replay = await call(
      method,
      `/attempts/${id}/review`,
      { score: 0, feedback: '\n零分，条件仍需补充。  ' },
      'manager',
    );
    assert.equal(replay.status, 200);
    assert.equal(replay.data.replayed, true);
    assert.equal(replay.data.attempt.score, 0);
    assert.equal(replay.data.attempt.feedback, '零分，条件仍需补充。');
    assert.equal(replay.data.attempt.reviewedBy, '3');
    assert.equal(replay.data.attempt.documentVersion, documentVersion);
    assert.equal(replay.data.attempt.questionSnapshot.prompt, '说明计算过程');
    assert.equal(replay.data.attempt.questionSnapshot.questionVersion, '2026.1');
    assert.equal(replay.data.attempt.questionSnapshot.scoring, undefined);
    assert.notEqual(
      replay.data.attempt.documentVersion,
      (await call('GET', '/questions')).data.documentVersion,
    );
  }
  assert.deepEqual(
    store.rows[0],
    storedBefore,
    'Confirmation never updates the grade, feedback or timestamp',
  );
  assert.equal(
    events.filter((event) => event.reviewed).length,
    1,
    'No duplicate assessment/stars callback',
  );
});

test('review confirmation rejects a different actor or payload and checks current permission before any outcome lookup', async (t) => {
  const { call, store, managers, events } = await fixture(t);
  const id = (await call('POST', '/attempts', answer('explain', '待复核答案'))).data.attempt.id;
  const payload = { score: 3, feedback: '已保存的复核说明。' };
  await call('PATCH', `/attempts/${id}/review`, payload, 'manager');
  const saved = { ...store.rows[0] };
  for (const [actor, altered] of [
    ['admin', payload],
    ['manager', { ...payload, score: 0 }],
    ['manager', { ...payload, feedback: '另一个说明' }],
  ]) {
    const response = await call('PATCH', `/attempts/${id}/review`, altered, actor);
    assert.equal(response.status, 409);
    assert.equal(response.data.attempt, undefined, 'Never expose or claim another saved intent');
  }
  let outcomeReads = 0;
  const originalLookup = store.findReviewResult.bind(store);
  store.findReviewResult = async (...args) => {
    outcomeReads += 1;
    return originalLookup(...args);
  };
  managers.splice(0, managers.length);
  for (const actor of ['manager', 'student', 'unrelated']) {
    const response = await call('POST', `/attempts/${id}/review`, payload, actor);
    assert.equal(response.status, 403);
    assert.equal(response.data.attempt, undefined);
  }
  assert.equal(
    outcomeReads,
    0,
    'A revoked or unrelated caller cannot read even a matching outcome',
  );
  assert.deepEqual(store.rows[0], saved);
  assert.equal(events.filter((event) => event.reviewed).length, 1);
});

test('review confirmation cannot cross course or node scope even for an authorized course manager', async (t) => {
  const { call, contexts, managers, base, store } = await fixture(t);
  const id = (await call('POST', '/attempts', answer('explain', '只属于原知识点'))).data.attempt.id;
  const payload = { score: 3, feedback: '原节点已保存。' };
  await call('PATCH', `/attempts/${id}/review`, payload, 'manager');
  contexts.push(
    { ...contexts[0], slug: 'other-course', course_id: 11 },
    { ...contexts[0], node_id: 'SS-01-02' },
  );
  managers.push({ userId: 3, courseId: 11 });
  for (const scope of ['/other-course/SS-01-01', '/signals/SS-01-02']) {
    const response = await fetch(
      `${base.replace('/signals/SS-01-01', scope)}/attempts/${id}/review`,
      {
        method: 'PATCH',
        headers: { Authorization: 'manager', 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );
    assert.equal(response.status, 409);
    assert.equal((await response.json()).attempt, undefined);
  }
  assert.equal(await store.findReviewResult({ course_id: 11, node_id: 'SS-01-01' }, id), null);
  assert.equal(await store.findReviewResult({ course_id: 10, node_id: 'SS-01-02' }, id), null);
});

test('same-intent concurrent review requests commit once and return one replay without duplicate events', async (t) => {
  const { call, events, store } = await fixture(t);
  const id = (await call('POST', '/attempts', answer('explain', '并发重试夹具'))).data.attempt.id;
  const payload = { score: 0, feedback: '相同并发请求。' };
  const responses = await Promise.all(
    ['PATCH', 'POST'].map((method) => call(method, `/attempts/${id}/review`, payload, 'manager')),
  );
  assert.ok(responses.every((response) => response.status === 200));
  assert.equal(responses.filter((response) => response.data.replayed).length, 1);
  assert.equal(events.filter((event) => event.reviewed).length, 1);
  assert.equal(store.rows[0].score, 0);
  assert.equal(store.rows[0].reviewed_by, 3);
});

test('competing reviewers or changed payloads cannot overwrite the first committed result', async (t) => {
  const { call, store, events } = await fixture(t);
  for (const contenders of [
    [
      ['manager', 3, '同一说明'],
      ['admin', 3, '同一说明'],
    ],
    [
      ['manager', 0, '首次意图'],
      ['manager', 5, '不同意图'],
    ],
  ]) {
    const id = (await call('POST', '/attempts', answer('explain', '竞争复核夹具'))).data.attempt.id;
    const before = events.filter((event) => event.reviewed).length;
    const results = await Promise.all(
      contenders.map(([actor, score, feedback]) =>
        call('PATCH', `/attempts/${id}/review`, { score, feedback }, actor),
      ),
    );
    assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
    const winning = results.find((result) => result.status === 200).data.attempt;
    const saved = store.rows.find((row) => row.id === id);
    assert.equal(saved.score, winning.score);
    assert.equal(saved.feedback, winning.feedback);
    assert.equal(String(saved.reviewed_by), winning.reviewedBy);
    assert.equal(events.filter((event) => event.reviewed).length - before, 1);
    assert.equal(results.find((result) => result.status === 409).data.attempt, undefined);
  }
});

test('a pending, missing or invalid-score record is never mistaken for a saved review replay', async (t) => {
  const { call, events } = await fixture(t);
  const id = (await call('POST', '/attempts', answer('explain', '仍未复核'))).data.attempt.id;
  for (const candidate of [id, '999']) {
    const response = await call(
      'PATCH',
      `/attempts/${candidate}/review`,
      { score: 6, feedback: '超过原满分' },
      'manager',
    );
    assert.equal(response.status, 409);
    assert.equal(response.data.attempt, undefined);
  }
  assert.equal(events.filter((event) => event.reviewed).length, 0);
});

test('mysql review outcome lookup is parameterized and uses the same historical allowlist as memory', async (t) => {
  const { call, store: memory } = await fixture(t);
  const id = (await call('POST', '/attempts', answer('explain', 'SQL形状夹具'))).data.attempt.id;
  await call('PATCH', `/attempts/${id}/review`, { score: 0, feedback: '保存0分' }, 'manager');
  const queries = [];
  const sqlStore = createMysqlAssessmentStore({
    execute: async (sql, values) => {
      queries.push({ sql, values });
      return sql.startsWith('UPDATE') ? [{ affectedRows: 0 }] : [[memory.rows[0]]];
    },
  });
  const context = { course_id: 10, node_id: 'SS-01-01' };
  assert.equal(await sqlStore.review(users.manager, context, id, 0, '保存0分'), null);
  assert.equal(
    queries.length,
    1,
    'Outcome lookup occurs only in the already-authorized router branch',
  );
  assert.match(queries[0].sql, /status = 'pending_review'/);
  const outcome = await sqlStore.findReviewResult(context, id);
  assert.match(queries[1].sql, /WHERE id = \? AND course_id = \? AND node_id = \? LIMIT 1/);
  assert.deepEqual(queries[1].values, [id, 10, 'SS-01-01']);
  assert.equal(outcome.score, 0);
  assert.equal(outcome.reviewedBy, '3');
  assert.equal(outcome.questionSnapshot.scoring, undefined);
  assert.deepEqual(outcome, await memory.findReviewResult(context, id));
});
test('wrong answers can be privately corrected while preserving original result and blocking cross-account links', async (t) => {
  const { call } = await fixture(t);
  const original = (await call('POST', '/attempts', answer('choice', 'B'))).data.attempt;
  assert.equal(
    (
      await call(
        'POST',
        '/attempts',
        answer('choice', 'A', { supersedesAttemptId: original.id }),
        'other',
      )
    ).status,
    404,
  );
  assert.equal(
    (await call('POST', '/attempts', answer('number', '1', { supersedesAttemptId: original.id })))
      .status,
    404,
  );
  const corrected = (
    await call('POST', '/attempts', answer('choice', 'A', { supersedesAttemptId: original.id }))
  ).data.attempt;
  assert.equal(corrected.verdict, 'pass');
  assert.equal(corrected.supersedesAttemptId, original.id);
  const { attempts } = (await call('GET', '/attempts')).data;
  assert.equal(attempts.length, 2);
  assert.equal(attempts[1].verdict, 'fail');
});
test('draft and practice-mode grading never enters official pass/fail, even after manual review', async (t) => {
  const { call } = await fixture(t, markdown(quiz({ status: 'draft', reviewedBy: '' })));
  assert.equal((await call('POST', '/attempts', answer())).status, 404);
  const practice = await call('POST', '/attempts', answer('choice', 'A', { mode: 'practice' }));
  assert.equal(practice.data.attempt.verdict, 'practice_only');
  assert.equal(practice.data.attempt.official, false);
  const pending = (
    await call('POST', '/attempts', answer('explain', '我的理解', { mode: 'practice' }))
  ).data.attempt;
  const reviewed = await call(
    'POST',
    `/attempts/${pending.id}/review`,
    { score: 5, feedback: '练习解释完整' },
    'manager',
  );
  assert.equal(reviewed.data.attempt.verdict, 'practice_only');
  assert.equal(reviewed.data.attempt.official, false);
});
test('inactive courses, invalid identifiers, malformed answer payloads and pagination are rejected', async (t) => {
  const { call, contexts } = await fixture(t);
  for (const extra of [
    { requestKey: 'not-a-uuid' },
    { answer: [] },
    { answer: { score: 100 } },
    { mode: 'admin' },
    { supersedesAttemptId: '../1' },
  ])
    assert.equal((await call('POST', '/attempts', answer('choice', 'A', extra))).status, 400);
  assert.equal((await call('GET', '/attempts?before=1%20OR%201')).status, 400);
  assert.equal((await call('GET', '/attempts?review=all')).status, 400);
  contexts[0].is_active = 0;
  assert.equal((await call('GET', '/questions')).status, 404);
});
test('current per-question channels survive 51 and 201 repeated attempts while history stays paginated', async (t) => {
  for (const repetitions of [51, 201])
    for (const practice of [false, true])
      await t.test(`${repetitions} ${practice ? 'practice' : 'formal'} repeats`, async (child) => {
        const { store, contexts, call } = await fixture(child);
        const buried = await storedAttempt(store, contexts[0], 'number', '0');
        const formal = await storedAttempt(store, contexts[0], 'choice', 'A');
        let newest;
        for (let index = 0; index < repetitions; index += 1)
          newest = await storedAttempt(store, contexts[0], 'choice', 'A', { practice });
        const first = await call('GET', '/attempts');
        assert.equal(first.status, 200);
        assert.equal(first.data.attempts.length, 50);
        assert.ok(first.data.nextCursor);
        assert.ok(first.data.attempts.every((entry) => entry.questionId === 'choice'));
        const summary = first.data.currentAttempts;
        assert.equal(summary.length, practice ? 3 : 2);
        assert.equal(summary.find((entry) => entry.questionId === 'number').id, buried.id);
        assert.equal(summary.find((entry) => entry.questionId === 'number').verdict, 'fail');
        assert.equal(
          summary.find((entry) => entry.questionId === 'choice' && entry.official).id,
          practice ? formal.id : newest.id,
        );
        if (practice)
          assert.equal(
            summary.find((entry) => entry.questionId === 'choice' && !entry.official).id,
            newest.id,
          );
        const second = await call('GET', `/attempts?before=${first.data.nextCursor}`);
        assert.ok(second.data.attempts.length <= 50);
        assert.equal(Object.hasOwn(second.data, 'currentAttempts'), false);
        assert.equal(store.rows.length, repetitions + 2);
        assert.equal(first.cache, 'private, no-store');
      });
});

test('current attempts use exact current public IDs and owner/course/node scope, never review another owner', async (t) => {
  const { store, contexts, call } = await fixture(t);
  const context = contexts[0];
  const formal = await storedAttempt(store, context, 'choice', 'A');
  const practice = await storedAttempt(store, context, 'choice', 'B', { practice: true });
  await storedAttempt(store, context, 'number', '1');
  await storedAttempt(store, context, 'choice', 'B', { user: users.other });
  await storedAttempt(store, { ...context, course_id: 11 }, 'choice', 'B');
  await storedAttempt(store, { ...context, node_id: 'SS-02-01' }, 'choice', 'B');
  await storedAttempt(store, context, 'explain', '另一位同学的推导', { user: users.other });
  context.document_markdown = markdown(quiz({ questions: [quiz().questions[0]] }));
  const first = (await call('GET', '/attempts?userId=2')).data;
  assert.deepEqual(first.currentAttempts.map((entry) => entry.id).sort(), [formal.id, practice.id]);
  assert.ok(first.currentAttempts.every((entry) => entry.questionId === 'choice'));
  assert.ok(
    first.currentAttempts.every(
      (entry) => !Object.hasOwn(entry, 'userId') && !Object.hasOwn(entry, 'questionSnapshot'),
    ),
  );
  assert.equal((await call('GET', '/attempts', undefined, 'other')).data.currentAttempts.length, 1);
  assert.deepEqual((await call('GET', '/attempts', undefined, 'manager')).data.currentAttempts, []);
  const review = await call('GET', '/attempts?review=pending', undefined, 'manager');
  assert.equal(review.data.attempts.length, 1);
  assert.equal(Object.hasOwn(review.data, 'currentAttempts'), false);
  assert.equal((await call('GET', '/attempts?review=pending')).status, 403);
  assert.equal((await call('GET', '/attempts', undefined, '')).status, 401);
  context.document_markdown = '# 正文仍可阅读，但已没有当前题目';
  const empty = (await call('GET', '/attempts')).data;
  assert.deepEqual(empty.currentAttempts, []);
  assert.ok(empty.attempts.length > 0, 'Historical UI is not replaced by the current summary');
});

test('latest state selects across versions before checking compatibility and includes pending formal separately from practice', async (t) => {
  const { store, contexts, call } = await fixture(t);
  const original = contexts[0].document_markdown;
  const old = await storedAttempt(store, contexts[0], 'choice', 'A');
  contexts[0].document_markdown = markdown(quiz({ version: '2026.2' }));
  const newer = await storedAttempt(store, contexts[0], 'choice', 'B');
  const pending = await storedAttempt(store, contexts[0], 'explain', '需要复核的推导');
  const practice = await storedAttempt(store, contexts[0], 'explain', '练习推导', {
    practice: true,
  });
  contexts[0].document_markdown = original;
  const response = await call('GET', '/attempts');
  const selected = response.data.currentAttempts.find((entry) => entry.questionId === 'choice');
  assert.equal(selected.id, newer.id, 'Rollback must not resurrect an older matching pass');
  assert.equal(selected.questionVersion, '2026.2');
  assert.notEqual(selected.documentVersion, response.data.documentVersion);
  assert.ok(response.data.attempts.some((entry) => entry.id === old.id));
  assert.equal(
    response.data.currentAttempts.find((entry) => entry.id === pending.id).status,
    'pending_review',
  );
  assert.equal(
    response.data.currentAttempts.find((entry) => entry.id === practice.id).official,
    false,
  );
});

test('mysql latest uses scoped case-sensitive per-question/channel max IDs, not a global limit or prefiltered version', async () => {
  const queries = [];
  const store = createMysqlAssessmentStore({
    execute: async (sql, values) => {
      queries.push({ sql, values });
      return [[]];
    },
  });
  const context = { course_id: 10, node_id: 'SS-01-01' };
  assert.deepEqual(await store.latest(users.student, context, []), []);
  assert.equal(queries.length, 0);
  await store.latest(users.student, context, ['Q1', 'q1']);
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].values, [1, 10, 'SS-01-01', 'Q1', 'q1']);
  assert.match(queries[0].sql, /MAX\(id\)/);
  assert.match(queries[0].sql, /user_id = \? AND course_id = \? AND node_id = \?/);
  assert.match(queries[0].sql, /BINARY question_id IN \(\?, \?\)/);
  assert.match(queries[0].sql, /GROUP BY BINARY question_id, is_official/);
  assert.doesNotMatch(queries[0].sql, /LIMIT|document_version\s*=|question_version\s*=/);
});

test('mysql store context, read isolation and pending review use scoped parameterized queries', async () => {
  const queries = [];
  const pool = {
    execute: async (sql, values) => {
      queries.push({ sql, values });
      return [[]];
    },
  };
  const store = createMysqlAssessmentStore(pool);
  const context = { course_id: 10, node_id: 'SS-01-01' };
  await store.context('signals', context.node_id);
  assert.match(queries[0].sql, /c\.is_active = 1/);
  assert.deepEqual(queries[0].values, ['signals', context.node_id]);
  await store.list(users.student, context, '20', false);
  assert.match(queries[1].sql, /user_id = \?/);
  assert.deepEqual(queries[1].values, [10, 'SS-01-01', 1, '20']);
  await store.list(users.manager, context, '', true);
  assert.match(queries[2].sql, /status = 'pending_review'/);
  assert.equal(await store.canReview(users.unrelated, context), false);
  assert.match(queries[3].sql, /course_material_managers/);
  assert.deepEqual(queries[3].values, [10, 4]);
  assert.equal(await store.canReview(users.admin, context), true);
  await ensureLearningAssessmentTables(pool);
  assert.match(queries.at(-1).sql, /CREATE TABLE IF NOT EXISTS learning_assessment_attempts/);
  assert.match(
    queries.at(-1).sql,
    /UNIQUE KEY uq_learning_assessment_request \(user_id, request_key\)/,
  );
});
