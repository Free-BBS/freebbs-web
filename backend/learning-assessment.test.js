const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const http = require('node:http');
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
  const store = createMemoryAssessmentStore({
    contexts,
    managers: [
      { userId: 3, courseId: 10 },
      { userId: 4, courseId: 11 },
    ],
  });
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
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
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
  return { store, contexts, events, call };
}
const answer = (questionId = 'choice', value = 'A', extra = {}) => ({
  questionId,
  answer: value,
  requestKey: crypto.randomUUID(),
  ...extra,
});

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
