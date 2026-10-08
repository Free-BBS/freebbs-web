const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const express = require('express');
const {
  createLearningAssessmentRouter,
  createMemoryAssessmentStore,
  parseAssessmentMarkdown,
} = require('../backend/learning-assessment');
const {
  createMemoryLearningStarStore,
  createLearningStarService,
} = require('../backend/learning-stars');

const student = { id: 1 };
const manager = { id: 99 };

function question(id, assessmentRole, difficulty, manual = false) {
  return {
    id,
    type: manual ? 'short_answer' : 'single_choice',
    prompt: '说明卷积适用的前提',
    ...(assessmentRole ? { assessmentRole } : {}),
    ...(difficulty ? { difficulty } : {}),
    ...(manual
      ? { scoring: { method: 'manual', rubric: '检查线性与时不变条件', maxScore: 2, passScore: 1 } }
      : {
          options: [
            { id: 'A', text: '线性时不变系统的零状态响应' },
            { id: 'B', text: '不需要任何条件' },
          ],
          scoring: { method: 'exact', answer: 'A', maxScore: 1, passScore: 1 },
        }),
  };
}

function quiz({ formal = true } = {}) {
  return {
    schemaVersion: 1,
    status: 'published',
    version: '1',
    source: '课程组原创',
    reviewedBy: '课程负责人',
    questions: [
      ...(formal
        ? [
            question('legacy'),
            question('basic-selftest', 'selftest', 'basic'),
            question('challenge-selftest', 'selftest', 'challenge', true),
          ]
        : []),
      question('basic-practice', 'practice', 'basic'),
      question('challenge-exploration', 'exploration', 'challenge'),
    ],
  };
}

function markdown(value) {
  return `# 卷积的适用条件\n\n\x60\x60\x60freebbs-quiz\n${JSON.stringify(value)}\n\x60\x60\x60`;
}

async function fixture(t, value = quiz()) {
  const context = {
    slug: 'signals',
    course_id: 10,
    course_name: '信号与系统',
    node_id: 'SS-01-01',
    title: '卷积',
    basic_info_markdown: '知识点层级：核心',
    document_markdown: markdown(value),
  };
  const contexts = [context];
  const store = createMemoryAssessmentStore({
    contexts,
    managers: [{ userId: manager.id, courseId: context.course_id }],
  });
  const starStore = createMemoryLearningStarStore({ contexts, assessmentStore: store });
  const stars = createLearningStarService({ store: starStore });
  const app = express();
  app.use(express.json());
  app.use(
    '/api/learning-assessments',
    createLearningAssessmentRouter({
      store,
      requireAuth: async (req, res) => {
        const user = req.headers.authorization === 'manager' ? manager : student;
        if (!req.headers.authorization) {
          res.status(401).json({ message: '请登录' });
          return null;
        }
        return user;
      },
      onAssessmentEvent: (event) => stars.recordAssessment(event),
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
  async function call(method, suffix, body, user = 'student') {
    const response = await fetch(`${base}${suffix}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: user },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json() };
  }
  async function submit(questionId, answer = 'A', mode = 'selftest', extra = {}) {
    return call('POST', '/attempts', {
      questionId,
      answer,
      mode,
      requestKey: crypto.randomUUID(),
      expectedDocumentVersion: parseAssessmentMarkdown(context.document_markdown).documentVersion,
      ...extra,
    });
  }
  return { context, store, starStore, stars, call, submit };
}

const selfLearning = (result) => result.node.stars.find((star) => star.key === 'self_learning');

test('real API roles preserve every formal difficulty and old published questions in the star denominator', async (t) => {
  const f = await fixture(t);
  const publicQuestions = await f.call('GET', '/questions');
  assert.equal(publicQuestions.status, 200);
  assert.deepEqual(
    publicQuestions.data.questions.map((entry) => entry.id),
    ['legacy', 'basic-selftest', 'challenge-selftest'],
  );
  assert.deepEqual(
    publicQuestions.data.practiceQuestions.map((entry) => entry.id),
    ['basic-practice', 'challenge-exploration'],
  );
  assert.equal(publicQuestions.data.questions[0].assessmentRole, 'selftest');
  assert.equal(publicQuestions.data.questions[0].difficulty, undefined);
  assert.equal(publicQuestions.data.questions[2].difficultyBasis, 'teacher_estimate');
  for (const id of ['basic-practice', 'challenge-exploration']) {
    const forbidden = await f.submit(id);
    assert.equal(forbidden.status, 404);
    const optional = await f.submit(id, 'A', 'practice', { official: true });
    assert.equal(optional.status, 201);
    assert.equal(optional.data.attempt.official, false);
    assert.equal(optional.data.attempt.verdict, 'practice_only');
    assert.equal(
      optional.data.attempt.assessmentRole,
      id === 'challenge-exploration' ? 'exploration' : 'practice',
    );
  }
  let result = await f.stars.node(student, 'signals', 'SS-01-01');
  assert.equal(result.node.selftest.questionCount, 3);
  assert.equal(result.node.selftest.passedQuestionCount, 0);
  assert.equal(selfLearning(result).earned, false);

  await f.submit('basic-selftest');
  result = await f.stars.node(student, 'signals', 'SS-01-01');
  assert.equal(result.node.selftest.passedQuestionCount, 1);
  assert.equal(selfLearning(result).earned, false);
  await f.submit('legacy');
  const pending = await f.submit('challenge-selftest', '零状态响应需要线性与时不变前提。');
  assert.equal(pending.data.attempt.status, 'pending_review');
  result = await f.stars.node(student, 'signals', 'SS-01-01');
  assert.equal(result.node.selftest.pendingReviewCount, 1);
  assert.equal(result.node.selftest.eligible, false);
  assert.equal(selfLearning(result).earned, false);
  const reviewed = await f.call(
    'POST',
    `/attempts/${pending.data.attempt.id}/review`,
    { score: 2, feedback: '前提完整' },
    'manager',
  );
  assert.equal(reviewed.status, 200);
  result = await f.stars.node(student, 'signals', 'SS-01-01');
  assert.equal(result.node.selftest.passedQuestionCount, 3);
  assert.equal(selfLearning(result).earned, true);
  assert.deepEqual(selfLearning(result).evidence.questionIds, [
    'legacy',
    'basic-selftest',
    'challenge-selftest',
  ]);
  assert.equal(selfLearning(result).evidence.attemptIds.length, 3);
  assert.equal(result.course.stars[0].earned, true);
});

test('failed optional exploration and practice on formal items do not substitute for or block formal proof', async (t) => {
  const value = quiz();
  value.questions[2] = question('challenge-selftest', 'selftest', 'challenge');
  const f = await fixture(t, value);
  const exploratoryFailure = await f.submit('challenge-exploration', 'B', 'practice');
  assert.equal(exploratoryFailure.data.attempt.official, false);
  for (const id of ['legacy', 'basic-selftest', 'challenge-selftest']) {
    const practice = await f.submit(id, 'A', 'practice');
    assert.equal(practice.data.attempt.official, false);
  }
  let result = await f.stars.reconcile(student, 'signals', 'SS-01-01');
  assert.equal(result.node.selftest.passedQuestionCount, 0);
  assert.equal(selfLearning(result).earned, false);
  for (const id of ['legacy', 'basic-selftest', 'challenge-selftest']) await f.submit(id);
  result = await f.stars.node(student, 'signals', 'SS-01-01');
  assert.equal(selfLearning(result).earned, true);
  assert.equal(result.node.selftest.passedQuestionCount, 3);
  assert.ok(
    selfLearning(result).evidence.attemptIds.every((id) =>
      f.store.rows.some((row) => row.id === id && row.is_official === 1),
    ),
  );
});

test('changing a published role invalidates older evidence instead of shrinking a star denominator into a pass', async (t) => {
  const value = quiz();
  value.questions[2] = question('challenge-selftest', 'selftest', 'challenge');
  const f = await fixture(t, value);
  await f.submit('legacy');
  await f.submit('basic-selftest');
  const before = await f.stars.node(student, 'signals', 'SS-01-01');
  assert.equal(before.node.selftest.passedQuestionCount, 2);
  assert.equal(selfLearning(before).earned, false);
  value.questions[2].assessmentRole = 'exploration';
  f.context.document_markdown = markdown(value);
  let result = await f.stars.reconcile(student, 'signals', 'SS-01-01');
  assert.equal(result.node.selftest.questionCount, 2);
  assert.equal(result.node.selftest.passedQuestionCount, 0);
  assert.equal(selfLearning(result).earned, false);
  assert.equal(result.course.stars[0].earned, false);
  await f.submit('legacy');
  result = await f.stars.node(student, 'signals', 'SS-01-01');
  assert.equal(result.node.selftest.passedQuestionCount, 1);
  assert.equal(selfLearning(result).earned, false);
  await f.submit('basic-selftest');
  result = await f.stars.node(student, 'signals', 'SS-01-01');
  assert.equal(selfLearning(result).earned, true);
  assert.deepEqual(selfLearning(result).evidence.questionIds, ['legacy', 'basic-selftest']);
});

test('a reviewed practice and exploration-only block has no formal selftest and cannot award stars', async (t) => {
  const f = await fixture(t, quiz({ formal: false }));
  const api = await f.call('GET', '/questions');
  assert.equal(api.data.questions.length, 0);
  assert.equal(api.data.practiceQuestions.length, 2);
  await f.submit('basic-practice', 'A', 'practice');
  await f.submit('challenge-exploration', 'A', 'practice');
  const result = await f.stars.reconcile(student, 'signals', 'SS-01-01');
  assert.equal(result.node.selftest.questionCount, 0);
  assert.equal(result.node.selftest.available, false);
  assert.equal(result.node.selftest.reason, '未配置发布的正式自测');
  assert.equal(selfLearning(result).earned, false);
  assert.equal(result.course.stars[0].earned, false);
  assert.equal(f.starStore.rows.length, 0);
});
