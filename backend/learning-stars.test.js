const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const http = require('node:http');
const {
  createMemoryAssessmentStore,
  createLearningAssessmentRouter,
  parseAssessmentMarkdown,
  gradeAnswer,
} = require('./learning-assessment');
const {
  createMemoryLearningStarStore,
  createMysqlLearningStarStore,
  createLearningStarService,
  createLearningStarsRouter,
  ensureLearningStarTables,
  levelOf,
} = require('./learning-stars');

function markdown({ status = 'published', version = '1', manual = false } = {}) {
  const questions = [
    {
      id: 'a',
      type: 'single_choice',
      prompt: '选出正确项',
      options: [
        { id: 'A', text: '正确' },
        { id: 'B', text: '其他' },
      ],
      scoring: { method: 'exact', answer: 'A', maxScore: 1, passScore: 1 },
    },
    manual
      ? {
          id: 'b',
          type: 'short_answer',
          prompt: '说明理由',
          scoring: { method: 'manual', rubric: '检查理由', maxScore: 2, passScore: 1 },
        }
      : {
          id: 'b',
          type: 'numeric',
          prompt: '求值',
          scoring: {
            method: 'numeric',
            target: 2,
            absoluteTolerance: 0,
            relativeTolerance: 0,
            maxScore: 1,
            passScore: 1,
          },
        },
  ];
  return `# 正文\n\n\x60\x60\x60freebbs-quiz\n${JSON.stringify({ schemaVersion: 1, status, version, source: '课程组原创', reviewedBy: '课程组', questions })}\n\x60\x60\x60`;
}
function fixture({ content = markdown(), level = '核心', extra = [] } = {}) {
  const contexts = [
    {
      course_id: 10,
      slug: 'signals',
      course_name: '信号与系统',
      node_id: 'SS-01-01',
      title: '连续信号',
      document_markdown: content,
      basic_info_markdown: `知识点层级：${level}`,
    },
    ...extra,
  ];
  const assessmentStore = createMemoryAssessmentStore({
    contexts,
    managers: [{ userId: 99, courseId: 10 }],
  });
  const store = createMemoryLearningStarStore({ contexts, assessmentStore });
  const service = createLearningStarService({ store });
  return { contexts, assessmentStore, store, service };
}
const student = { id: 1 };
async function submit(
  f,
  id,
  answer,
  { user = student, point = 'SS-01-01', practice = false } = {},
) {
  const context = f.contexts.find((node) => node.node_id === point);
  const assessment = parseAssessmentMarkdown(context.document_markdown);
  const question = [...assessment.questions, ...assessment.practiceQuestions].find(
    (item) => item.id === id,
  );
  const submitted = practice ? { ...question, official: false } : question;
  return f.assessmentStore.create(
    user,
    context,
    submitted,
    gradeAnswer(submitted, answer),
    crypto.randomUUID(),
    crypto.randomUUID(),
    assessment.documentVersion,
    null,
  );
}
const ownStar = (response, key = 'self_learning') =>
  response.node.stars.find((star) => star.key === key);

test('published final selftest requires every question; one answer cannot grant a node star', async () => {
  const f = fixture();
  await submit(f, 'a', 'A');
  let result = await f.service.reconcile(student, 'signals', 'SS-01-01');
  assert.equal(ownStar(result).earned, false);
  assert.equal(result.node.selftest.passedQuestionCount, 1);
  await submit(f, 'b', 2);
  result = await f.service.reconcile(student, 'signals', 'SS-01-01');
  assert.equal(result.awarded, true);
  assert.equal(ownStar(result).earned, true);
  assert.deepEqual(ownStar(result).evidence.questionIds, ['a', 'b']);
  assert.equal(ownStar(result).evidence.attemptIds.length, 2);
  assert.equal(result.course.stars[0].earned, true);
  assert.equal(result.course.stars[1].earned, false);
  assert.equal(result.course.stars[2].earned, false);
  assert.equal(ownStar(result, 'course_learning').earned, false);
  assert.equal(ownStar(result, 'deep_mastery').available, false);
  assert.equal(f.store.rows.length, 2);
  const again = await f.service.reconcile(student, 'signals', 'SS-01-01');
  assert.equal(again.awarded, false);
  assert.equal(f.store.rows.length, 2);
  assert.deepEqual(ownStar(again).evidence, ownStar(result).evidence);
});

test('practice, drafts and absent quizzes never grant self-learning stars', async () => {
  const practice = fixture();
  await submit(practice, 'a', 'A', { practice: true });
  await submit(practice, 'b', 2, { practice: true });
  assert.equal(
    ownStar(await practice.service.reconcile(student, 'signals', 'SS-01-01')).earned,
    false,
  );
  const draft = fixture({ content: markdown({ status: 'draft' }) });
  await submit(draft, 'a', 'A');
  await submit(draft, 'b', 2);
  const drafted = await draft.service.reconcile(student, 'signals', 'SS-01-01');
  assert.equal(ownStar(drafted).earned, false);
  assert.equal(drafted.node.selftest.available, false);
  const absent = fixture({ content: '# 正文' });
  const missing = await absent.service.reconcile(student, 'signals', 'SS-01-01');
  assert.equal(ownStar(missing).earned, false);
  assert.equal(missing.node.selftest.reason, '未配置发布的正式自测');
});

test('latest official failure or pending result prevents first award; practice does not supersede formal passes', async () => {
  const f = fixture();
  await submit(f, 'a', 'A');
  await submit(f, 'a', 'B');
  await submit(f, 'b', 2);
  assert.equal(ownStar(await f.service.reconcile(student, 'signals', 'SS-01-01')).earned, false);
  await submit(f, 'a', 'A');
  await submit(f, 'a', 'B', { practice: true });
  assert.equal(ownStar(await f.service.reconcile(student, 'signals', 'SS-01-01')).earned, true);
  await submit(f, 'a', 'B');
  assert.equal(ownStar(await f.service.reconcile(student, 'signals', 'SS-01-01')).earned, true);
});

test('current document and question versions cannot combine with old passes', async () => {
  const f = fixture();
  await submit(f, 'a', 'A');
  await submit(f, 'b', 2);
  f.contexts[0].document_markdown += '\n';
  const stale = await f.service.reconcile(student, 'signals', 'SS-01-01');
  assert.equal(ownStar(stale).earned, false);
  assert.equal(stale.node.selftest.passedQuestionCount, 0);
  await submit(f, 'a', 'A');
  await submit(f, 'b', 2);
  const earned = await f.service.reconcile(student, 'signals', 'SS-01-01');
  assert.equal(ownStar(earned).earned, true);
  f.contexts[0].document_markdown = markdown({ version: '2' });
  const historical = await f.service.node(student, 'signals', 'SS-01-01');
  assert.equal(ownStar(historical).earned, true);
  assert.equal(ownStar(historical).historicalVersion, true);
  assert.equal(historical.node.selftest.passedQuestionCount, 0);
});

test('document rollback cannot revive old passes over newer incompatible official failures or pending reviews', async () => {
  for (const manual of [false, true]) {
    const f = fixture();
    const versionA = f.contexts[0].document_markdown;
    await submit(f, 'a', 'A');
    await submit(f, 'b', 2);
    // No award has been reconciled yet. Subsequent formal work takes precedence.
    f.contexts[0].document_markdown = markdown({ version: '2', manual });
    await submit(f, 'a', 'B');
    await submit(f, 'b', manual ? '待复核理由' : 0);
    f.contexts[0].document_markdown = versionA;
    const rolledBack = await f.service.reconcile(student, 'signals', 'SS-01-01');
    assert.equal(ownStar(rolledBack).earned, false);
    assert.equal(rolledBack.node.selftest.passedQuestionCount, 0);
    assert.equal(rolledBack.node.selftest.eligible, false);
    assert.equal(rolledBack.course.stars[0].earned, false);
    await submit(f, 'a', 'A');
    await submit(f, 'b', 2);
    assert.equal(ownStar(await f.service.reconcile(student, 'signals', 'SS-01-01')).earned, true);
  }
});

test('subjective review awards the student, not the course manager; callback fields cannot bypass persisted evidence', async () => {
  const f = fixture({ content: markdown({ manual: true }) });
  await submit(f, 'a', 'A');
  const pending = await submit(f, 'b', '理由');
  const waiting = await f.service.reconcile(student, 'signals', 'SS-01-01');
  assert.equal(ownStar(waiting).earned, false);
  assert.equal(waiting.node.selftest.pendingReviewCount, 1);
  const manager = { id: 99 };
  const attempt = await f.assessmentStore.review(
    manager,
    f.contexts[0],
    pending.id,
    2,
    '理由符合要求',
  );
  await f.service.recordAssessment({ user: manager, context: f.contexts[0], attempt });
  assert.equal(ownStar(await f.service.node(student, 'signals', 'SS-01-01')).earned, true);
  assert.equal(ownStar(await f.service.node(manager, 'signals', 'SS-01-01')).earned, false);
  await f.service.recordAssessment({
    user: { id: 2 },
    context: f.contexts[0],
    attempt: { ...attempt, userId: '2' },
  });
  assert.equal(ownStar(await f.service.node({ id: 2 }, 'signals', 'SS-01-01')).earned, false);
});

test('extension has two stars and is excluded from course scope; chapters are excluded and empty ordinary nodes block course light', async () => {
  const extension = fixture({ level: '拓展' });
  await submit(extension, 'a', 'A');
  await submit(extension, 'b', 2);
  const extra = await extension.service.reconcile(student, 'signals', 'SS-01-01');
  assert.deepEqual(
    extra.node.stars.map((star) => star.key),
    ['self_learning', 'deep_mastery'],
  );
  assert.equal(extra.course.eligibleNodeCount, 0);
  assert.equal(extra.course.stars[0].earned, false);
  const f = fixture({
    extra: [
      {
        course_id: 10,
        slug: 'signals',
        node_id: 'SS-01-00',
        title: '章节',
        basic_info_markdown: '知识点层级：核心',
      },
      {
        course_id: 10,
        slug: 'signals',
        node_id: 'SS-01-02',
        title: '无正式自测',
        basic_info_markdown: '知识点层级：一般',
        document_markdown: '# 待接入',
      },
      {
        course_id: 10,
        slug: 'signals',
        node_id: 'SS-01-03',
        title: '拓展',
        basic_info_markdown: '知识点层级：拓展',
        document_markdown: '# 待接入',
      },
    ],
  });
  await submit(f, 'a', 'A');
  await submit(f, 'b', 2);
  const result = await f.service.reconcile(student, 'signals', 'SS-01-01');
  assert.equal(result.course.eligibleNodeCount, 2);
  assert.equal(result.course.litNodeCount, 1);
  assert.equal(result.course.stars[0].earned, false);
  const course = await f.service.course(student, 'signals');
  assert.equal(course.nodes.length, 3);
  assert.equal(course.nodes.find((node) => node.nodeId === 'SS-01-02').selftest.questionCount, 0);
  await assert.rejects(f.service.node(student, 'signals', 'SS-01-00'), /章节/);
});

test('unclassified nodes prevent false course completion; official overview aliases determine node level', async () => {
  assert.equal(
    levelOf({ basic_info_markdown: '| 字段 | 内容 |\n| 知识点层级 | 拓展 |' }),
    'extension',
  );
  assert.equal(levelOf({ sections: { basicInfoMarkdown: '层级：一般' } }), 'general');
  assert.equal(levelOf({ metadata: { 知识点层级: '核心' } }), 'core');
  const f = fixture({ level: '未标注' });
  await submit(f, 'a', 'A');
  await submit(f, 'b', 2);
  const result = await f.service.reconcile(student, 'signals', 'SS-01-01');
  assert.equal(ownStar(result).earned, true);
  assert.equal(result.course.unclassifiedNodeCount, 1);
  assert.equal(result.course.stars[0].earned, false);
});

test('earned course star preserves its original scope when official course nodes change', async () => {
  const f = fixture();
  await submit(f, 'a', 'A');
  await submit(f, 'b', 2);
  const earned = await f.service.reconcile(student, 'signals', 'SS-01-01');
  assert.equal(earned.course.stars[0].earned, true);
  f.contexts.push({
    course_id: 10,
    slug: 'signals',
    node_id: 'SS-01-02',
    title: '新增知识点',
    basic_info_markdown: '知识点层级：一般',
    document_markdown: '# 正文',
  });
  const changed = await f.service.course(student, 'signals');
  assert.equal(changed.course.stars[0].earned, true);
  assert.equal(changed.course.stars[0].historicalScope, true);
  assert.deepEqual(changed.course.stars[0].evidence.scopeNodeIds, ['SS-01-01']);
});

test('parallel reconciliation is idempotent and transaction rollback keeps no partial awards', async () => {
  const f = fixture();
  await submit(f, 'a', 'A');
  await submit(f, 'b', 2);
  const { grant } = f.store;
  f.store.grant = async function failCourse(...args) {
    if (args[3] === 'course_lit') throw new Error('simulated store failure');
    return grant.apply(this, args);
  };
  await assert.rejects(f.service.reconcile(student, 'signals', 'SS-01-01'), /simulated/);
  assert.equal(f.store.rows.length, 0);
  f.store.grant = grant;
  await Promise.all(
    Array.from({ length: 12 }, () => f.service.reconcile(student, 'signals', 'SS-01-01')),
  );
  assert.equal(f.store.rows.length, 2);
});

test('self-learning rows belong to the student and do not mutate manual learning state', async () => {
  const f = fixture();
  f.contexts[0].manual_state = '未学习';
  await submit(f, 'a', 'A');
  await submit(f, 'b', 2);
  await f.service.reconcile(student, 'signals', 'SS-01-01');
  const other = await f.service.node({ id: 2 }, 'signals', 'SS-01-01');
  assert.equal(ownStar(other).earned, false);
  assert.equal(other.node.selftest.passedQuestionCount, 0);
  assert.equal(f.contexts[0].manual_state, '未学习');
});

test('authenticated API is self-only, no-store, rejects client grades, and readonly GET never grants', async (t) => {
  const f = fixture();
  await submit(f, 'a', 'A');
  await submit(f, 'b', 2);
  const app = express();
  app.use(express.json());
  const requireAuth = async (req, res) => {
    const id = req.headers.authorization;
    if (!id) {
      res.status(401).json({ message: '请登录' });
      return null;
    }
    return { id };
  };
  app.use('/stars', createLearningStarsRouter({ store: f.store, requireAuth }));
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
  const url = `http://127.0.0.1:${server.address().port}/stars/signals`;
  async function call(suffix = '', { method = 'GET', body, auth = '1' } = {}) {
    const res = await fetch(url + suffix, {
      method,
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, data: await res.json(), cache: res.headers.get('cache-control') };
  }
  assert.equal((await call('', { auth: null })).status, 401);
  const get = await call('/SS-01-01');
  assert.equal(get.status, 200);
  assert.equal(get.cache, 'private, no-store');
  assert.equal(get.data.node.selftest.eligible, true);
  assert.equal(ownStar(get.data).earned, false);
  assert.equal(f.store.rows.length, 0);
  assert.equal((await call('?userId=2')).status, 400);
  assert.equal(
    (await call('/SS-01-01/reconcile', { method: 'POST', body: { earned: true } })).status,
    400,
  );
  assert.equal(
    (await call('/SS-01-01/reconcile', { method: 'POST', body: {} })).data.awarded,
    true,
  );
  assert.equal(ownStar((await call('/SS-01-01', { auth: '2' })).data).earned, false);
  assert.equal((await call('/SS-01-99')).status, 404);
});

test('real assessment submission and manual-review router hooks reconcile trusted records', async (t) => {
  const f = fixture();
  const app = express();
  app.use(express.json());
  app.use(
    '/assessment',
    createLearningAssessmentRouter({
      store: f.assessmentStore,
      requireAuth: async () => student,
      onAssessmentEvent: (event) => f.service.recordAssessment(event),
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
  const url = `http://127.0.0.1:${server.address().port}/assessment/signals/SS-01-01/attempts`;
  for (const [questionId, answer] of [
    ['a', 'A'],
    ['b', 2],
  ]) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questionId, answer, requestKey: crypto.randomUUID() }),
    });
    assert.equal(response.status, 201);
  }
  assert.equal(ownStar(await f.service.node(student, 'signals', 'SS-01-01')).earned, true);
});

test('MySQL persistence constrains owner and scope but does not prefilter attempt versions; migration is additive and wallet-free', async () => {
  const calls = [];
  const pool = {
    execute: async (sql, params) => {
      calls.push({ sql, params });
      return [[]];
    },
  };
  await ensureLearningStarTables(pool);
  assert.match(calls[0].sql, /CREATE TABLE IF NOT EXISTS learning_star_awards/);
  assert.match(calls[0].sql, /UNIQUE KEY uq_learning_star_owner/);
  assert.doesNotMatch(calls[0].sql, /wallet|UPDATE users|DROP TABLE/i);
  const store = createMysqlLearningStarStore(pool);
  await store.attempts(
    student,
    { id: 10 },
    { node_id: 'SS-01-01' },
    { documentVersion: 'd'.repeat(64), questionVersion: '1' },
  );
  const query = calls.at(-1);
  assert.match(query.sql, /user_id = \? AND course_id = \? AND node_id = \?/);
  assert.match(query.sql, /AND is_official = 1/);
  assert.doesNotMatch(query.sql, /document_version =|question_version =/);
  assert.deepEqual(query.params, [1, 10, 'SS-01-01']);
});
