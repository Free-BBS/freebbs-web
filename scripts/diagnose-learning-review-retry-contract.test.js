// Independent, local read-only verification. Invoke the actual registered router
// with an isolated memory store; the SQL executor below is a binding spy, not MySQL.
// UI checks execute the production controller in the existing lightweight DOM.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  createLearningAssessmentRouter,
  createMemoryAssessmentStore,
  createMysqlAssessmentStore,
} = require('../backend/learning-assessment');
const { viewLabels, createAssessmentController } = require('../public/learning-assessment');
const answerDrafts = require('../public/learning-answer-drafts');

function content({ version = 'original', prompt = '原作答题干', maxScore = 5 } = {}) {
  return `# 课程正文\n\n\x60\x60\x60freebbs-quiz\n${JSON.stringify({
    schemaVersion: 1,
    status: 'published',
    version,
    source: '独立内存诊断夹具',
    reviewedBy: 'QA课程组',
    questions: [
      {
        id: 'QA-explain',
        type: 'short_answer',
        prompt,
        scoring: {
          method: 'manual',
          rubric: 'PRIVATE-SCORING-RUBRIC',
          maxScore,
          passScore: maxScore,
        },
      },
    ],
  })}\n\x60\x60\x60\n`;
}

function routerLab() {
  const contexts = [
    { slug: 'signals', course_id: 21, node_id: 'QA-01-01', document_markdown: content() },
    { slug: 'signals', course_id: 21, node_id: 'QA-01-02', document_markdown: content() },
    { slug: 'other', course_id: 22, node_id: 'QA-01-01', document_markdown: content() },
  ];
  const managers = [
    { userId: 13, courseId: 21 },
    { userId: 14, courseId: 21 },
    { userId: 13, courseId: 22 },
  ];
  const store = createMemoryAssessmentStore({ contexts, managers });
  const reviewedEvents = [];
  let simulatedStarHookCalls = 0;
  const router = createLearningAssessmentRouter({
    store,
    requireAuth: async (req, res) => {
      if (!req.actor) {
        res.status(401).json({ message: '请登录' });
        return null;
      }
      return { id: req.actor };
    },
    onAssessmentEvent: async (event) => {
      if (event.reviewed) {
        reviewedEvents.push(event);
        // This observes hook dispatch, not a claim of a real star DB award.
        simulatedStarHookCalls += 1;
      }
    },
  });
  async function call(
    method,
    { id, actor = 13, slug = 'signals', point = 'QA-01-01', body = {} } = {},
  ) {
    const routePath =
      id === undefined ? '/:slug/:point/attempts' : '/:slug/:point/attempts/:id/review';
    const route = router.stack.find(
      (item) => item.route?.path === routePath && item.route.methods[method.toLowerCase()],
    );
    assert.ok(route);
    let data;
    let status = 200;
    const headers = new Map();
    const response = {
      headersSent: false,
      set(name, value) {
        headers.set(name, value);
        return this;
      },
      status(value) {
        status = value;
        return this;
      },
      json(value) {
        data = value;
        this.headersSent = true;
        return this;
      },
    };
    await route.route.stack[0].handle(
      { params: { slug, point, ...(id === undefined ? {} : { id }) }, body, query: {}, actor },
      response,
    );
    assert.equal(headers.get('Cache-Control'), 'private, no-store');
    return { status, data };
  }
  async function pending(mode = 'selftest') {
    const created = await call('POST', {
      actor: 10,
      body: {
        requestKey: crypto.randomUUID(),
        questionId: 'QA-explain',
        answer: '私有原作答',
        mode,
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.attempt.status, 'pending_review');
    return created.data.attempt;
  }
  return {
    contexts,
    managers,
    store,
    call,
    pending,
    reviewedEvents,
    starCalls: () => simulatedStarHookCalls,
  };
}

test('independent router: zero and trim-only equivalent retry preserves original saved intent and emits once', async () => {
  const lab = routerLab();
  const original = await lab.pending();
  const first = await lab.call('PATCH', {
    id: original.id,
    body: { score: 0, feedback: '\u00a0零分\n理由\u3000' },
  });
  assert.equal(first.status, 200);
  assert.equal(first.data.replayed, undefined);
  const saved = structuredClone(lab.store.rows[0]);
  lab.contexts[0].document_markdown = content({
    version: 'replacement',
    prompt: '新版本不可替代旧题干',
    maxScore: 0,
  });
  for (const method of ['POST', 'PATCH']) {
    const replay = await lab.call(method, {
      id: original.id,
      body: { score: -0, feedback: ' 零分\n理由  ' },
    });
    assert.equal(replay.status, 200);
    assert.equal(replay.data.replayed, true);
    assert.equal(replay.data.attempt.score, 0);
    assert.equal(replay.data.attempt.documentVersion, original.documentVersion);
    assert.equal(replay.data.attempt.questionSnapshot.prompt, '原作答题干');
    assert.equal(replay.data.attempt.questionSnapshot.questionVersion, 'original');
    assert.equal(replay.data.attempt.questionSnapshot.scoring, undefined);
    assert.equal(
      JSON.stringify(replay.data.attempt.questionSnapshot).includes('PRIVATE-SCORING-RUBRIC'),
      false,
    );
    // Existing allowlisted result metadata deliberately includes gradingBasis.
    assert.equal(replay.data.attempt.gradingBasis, first.data.attempt.gradingBasis);
  }
  assert.deepEqual(lab.store.rows[0], saved);
  assert.equal(lab.reviewedEvents.length, 1);
  assert.equal(lab.starCalls(), 1);
});

test('independent router: historical score remains retryable after current maximum changes, without regrading', async () => {
  const lab = routerLab();
  const original = await lab.pending();
  const payload = { score: 2.5, feedback: '历史评分依据' };
  assert.equal((await lab.call('POST', { id: original.id, body: payload })).status, 200);
  const saved = structuredClone(lab.store.rows[0]);
  lab.contexts[0].document_markdown = content({ version: 'replacement', maxScore: 0 });
  const retry = await lab.call('PATCH', { id: original.id, body: payload });
  assert.equal(retry.status, 200);
  assert.equal(retry.data.replayed, true);
  assert.equal(retry.data.attempt.maxScore, 5);
  assert.deepEqual(lab.store.rows[0], saved);
});

test('independent router: same score is insufficient for changed internal whitespace, actor, course, node or permission', async () => {
  const lab = routerLab();
  const original = await lab.pending();
  const body = { score: 0, feedback: '甲\n乙' };
  await lab.call('PATCH', { id: original.id, body });
  const saved = structuredClone(lab.store.rows[0]);
  for (const change of [
    { actor: 14 },
    { slug: 'other' },
    { point: 'QA-01-02' },
    { body: { ...body, score: Number.EPSILON } },
    { body: { ...body, feedback: '甲 乙' } },
    { body: { ...body, feedback: '甲\r\n乙' } },
  ]) {
    const result = await lab.call('POST', { id: original.id, body, ...change });
    assert.equal(result.status, 409, JSON.stringify(change));
    assert.equal(result.data.attempt, undefined);
  }
  let lookups = 0;
  const lookup = lab.store.findReviewResult.bind(lab.store);
  lab.store.findReviewResult = async (...args) => {
    lookups += 1;
    return lookup(...args);
  };
  lab.managers.splice(0, lab.managers.length);
  assert.equal((await lab.call('POST', { id: original.id, body })).status, 403);
  assert.equal((await lab.call('PATCH', { id: original.id, body, actor: null })).status, 401);
  assert.equal(lookups, 0, 'Permission/auth rejection precedes any saved private result lookup');
  assert.deepEqual(lab.store.rows[0], saved);
  assert.equal(lab.starCalls(), 1);
});

test('independent router: 24 same-intent concurrent retries update once; different concurrent intents conflict', async () => {
  const lab = routerLab();
  const original = await lab.pending();
  const body = { score: 0, feedback: '相同并发意图' };
  const replies = await Promise.all(
    Array.from({ length: 24 }, (_, index) =>
      lab.call(index % 2 ? 'POST' : 'PATCH', { id: original.id, body }),
    ),
  );
  assert.ok(replies.every((item) => item.status === 200));
  assert.equal(replies.filter((item) => item.data.replayed).length, 23);
  assert.equal(lab.starCalls(), 1);
  const another = await lab.pending();
  const conflicts = await Promise.all([
    lab.call('POST', { id: another.id, body: { score: 0, feedback: '意图一' } }),
    lab.call('PATCH', { id: another.id, actor: 14, body: { score: 5, feedback: '意图二' } }),
  ]);
  assert.deepEqual(conflicts.map((item) => item.status).sort(), [200, 409]);
  assert.equal(lab.starCalls(), 2);
});

test('independent router: practice review replay remains practice and malformed/missing requests never masquerade as success', async () => {
  const lab = routerLab();
  const original = await lab.pending('practice');
  const body = { score: 0, feedback: '练习仍是练习' };
  const first = await lab.call('PATCH', { id: original.id, body });
  const retry = await lab.call('POST', { id: original.id, body });
  assert.equal(first.data.attempt.verdict, 'practice_only');
  assert.equal(retry.data.attempt.official, false);
  assert.equal(retry.data.replayed, true);
  for (const changed of [
    { score: '0', feedback: body.feedback },
    { score: null, feedback: body.feedback },
    { score: -1, feedback: body.feedback },
    { score: 0, feedback: `${' '.repeat(4000)}x` },
  ]) {
    const result = await lab.call('PATCH', { id: original.id, body: changed });
    assert.equal(result.status, 400);
    assert.equal(result.data.replayed, undefined);
  }
  assert.equal((await lab.call('PATCH', { id: '99999', body })).status, 409);
  assert.equal(lab.starCalls(), 1);
});

test('independent SQL binding spy: both write/read scopes are parameters and returned score zero is allowlisted', async () => {
  const lab = routerLab();
  const original = await lab.pending();
  await lab.call('PATCH', { id: original.id, body: { score: 0, feedback: 'SQL绑定夹具' } });
  const row = { ...lab.store.rows[0], score: '0.000' };
  const queries = [];
  let affectedRows = 0;
  const sqlStore = createMysqlAssessmentStore({
    execute: async (sql, values) => {
      queries.push({ sql, values });
      return sql.startsWith('UPDATE') ? [{ affectedRows }] : [[row]];
    },
  });
  const context = { course_id: 21, node_id: 'QA-01-01' };
  assert.equal(await sqlStore.review({ id: 13 }, context, original.id, 0, 'SQL绑定夹具'), null);
  assert.equal(queries.length, 1, 'Failed update does not itself read a private result');
  assert.deepEqual(queries[0].values, [0, 'SQL绑定夹具', 0, 13, original.id, 21, 'QA-01-01', 0]);
  assert.match(
    queries[0].sql,
    /WHERE id = \? AND course_id = \? AND node_id = \? AND status = 'pending_review' AND \? <= max_score/,
  );
  const result = await sqlStore.findReviewResult(context, "1' OR 1=1 --");
  assert.match(queries[1].sql, /WHERE id = \? AND course_id = \? AND node_id = \? LIMIT 1/);
  assert.deepEqual(queries[1].values, ["1' OR 1=1 --", 21, 'QA-01-01']);
  assert.equal(queries[1].sql.includes("1' OR 1=1"), false);
  assert.equal(result.score, 0);
  assert.equal(result.questionSnapshot.scoring, undefined);
  affectedRows = 1;
  assert.equal(
    (await sqlStore.review({ id: 13 }, context, original.id, 0, 'SQL绑定夹具')).score,
    0,
  );
  assert.equal(queries.length, 4, 'Successful write performs one scoped allowlisted lookup');
});

function uiHarness() {
  const source = fs.readFileSync(path.join(__dirname, 'learning-assessment.test.js'), 'utf8');
  const start = source.indexOf('class Element');
  const end = source.indexOf('\nfunction layeredQuestionsResponse', start);
  const helpersStart = source.indexOf('const reviewRecord =');
  const helpersEnd = source.indexOf('\ntest(', helpersStart);
  assert.ok(start > 0 && end > start && helpersStart > end && helpersEnd > helpersStart);
  const scope = {
    assert,
    crypto,
    answerDrafts,
    viewLabels,
    createAssessmentController,
    setImmediate,
  };
  vm.runInNewContext(
    `${source.slice(start, end)}\n${source.slice(helpersStart, helpersEnd)}\nglobalThis.qa = { harness, reviewRecord, reviewButton, reviewCard, deferred, tick };`,
    scope,
  );
  return scope.qa;
}

test('independent dynamic DOM: A locks only itself, B remains live; transient failure restores the exact zero draft for retry', async () => {
  const { harness, reviewRecord, reviewButton, reviewCard, deferred, tick } = uiHarness();
  const waiting = deferred();
  let patches = 0;
  const h = harness({
    callApi: async (url, options) => {
      if (url.endsWith('/questions'))
        return {
          questions: [],
          practiceQuestions: [],
          documentVersion: 'current',
          questionVersion: '1',
          canReview: true,
        };
      if (url.includes('review=pending'))
        return { attempts: [reviewRecord(7), reviewRecord(6)], nextCursor: null };
      if (options.method === 'GET')
        return { attempts: [], currentAttempts: [], documentVersion: 'current' };
      patches += 1;
      return patches === 1
        ? waiting.promise
        : { attempt: reviewRecord(7, { status: 'graded', score: 0 }), replayed: true };
    },
  });
  await h.load();
  await tick();
  await reviewButton(h).dispatchEvent({ type: 'click' });
  const a = reviewCard(h, 7).querySelectorAll('form')[0];
  const b = reviewCard(h, 6).querySelectorAll('form')[0];
  const score = a.querySelectorAll('input')[0];
  const feedback = a.querySelectorAll('textarea')[0];
  const bInput = b.querySelectorAll('textarea')[0];
  score.value = '0';
  feedback.value = '  不改提交前的零分草稿  ';
  const submitting = a.dispatchEvent({ type: 'submit', preventDefault() {} });
  assert.equal(score.disabled, true);
  assert.equal(feedback.disabled, true);
  assert.equal(bInput.disabled, false);
  bInput.value = 'B继续独立输入';
  h.document.activeElement = bInput;
  await b.dispatchEvent({ type: 'input' });
  await a.dispatchEvent({ type: 'submit', preventDefault() {} });
  assert.equal(patches, 1);
  waiting.reject(Object.assign(new Error('QA暂时失败'), { status: 500 }));
  await submitting;
  assert.equal(score.disabled, false);
  assert.equal(feedback.disabled, false);
  assert.equal(score.value, '0');
  assert.equal(feedback.value, '  不改提交前的零分草稿  ');
  await a.dispatchEvent({ type: 'submit', preventDefault() {} });
  assert.equal(reviewCard(h, 7), undefined);
  assert.equal(score.disabled, true);
  assert.equal(reviewCard(h, 6).querySelectorAll('textarea')[0], bInput);
  assert.equal(bInput.value, 'B继续独立输入');
  assert.equal(bInput.detachments, 0);
  assert.equal(h.document.activeElement, bInput);
  const payloads = h.requests
    .filter((request) => request.options.method === 'PATCH')
    .map((request) => JSON.parse(request.options.body));
  assert.deepEqual(JSON.parse(JSON.stringify(payloads)), [
    { score: 0, feedback: '  不改提交前的零分草稿  ' },
    { score: 0, feedback: '  不改提交前的零分草稿  ' },
  ]);
});

test('independent dynamic DOM: late failure or success never unlocks obsolete controls across permission/version/identity/context changes', async () => {
  const { harness, reviewRecord, reviewButton, reviewCard, deferred, tick } = uiHarness();
  for (const change of [
    'permission',
    'document',
    'question',
    'identity',
    'token',
    'storage',
    'node',
  ]) {
    for (const outcome of ['success', 'failure']) {
      const waiting = deferred();
      let changed = false;
      const h = harness({
        callApi: async (url, options) => {
          if (url.endsWith('/questions'))
            return {
              questions: [],
              practiceQuestions: [],
              documentVersion: changed && change === 'document' ? 'new-doc' : 'current',
              questionVersion: changed && change === 'question' ? 'new-question' : '1',
              canReview: !(changed && change === 'permission'),
            };
          if (url.includes('review=pending'))
            return { attempts: [reviewRecord(7), reviewRecord(6)], nextCursor: null };
          if (options.method === 'PATCH') return waiting.promise;
          return { attempts: [], currentAttempts: [], documentVersion: 'current' };
        },
      });
      await h.load();
      await tick();
      await reviewButton(h).dispatchEvent({ type: 'click' });
      const a = reviewCard(h, 7).querySelectorAll('form')[0];
      a.querySelectorAll('input')[0].value = '0';
      a.querySelectorAll('textarea')[0].value = '旧范围评分草稿';
      const submitting = a.dispatchEvent({ type: 'submit', preventDefault() {} });
      changed = true;
      if (change === 'identity' || change === 'token') {
        h.app.userState = {
          ...h.app.userState,
          ...(change === 'identity' ? { uid: 'new-reviewer' } : {}),
          token: 'new-token',
        };
        await h.browser.dispatchEvent({ type: 'freebbs:session-change' });
      } else if (change === 'storage')
        await h.browser.dispatchEvent({ type: 'storage', key: 'free_bbs_auth_token' });
      else if (change === 'node')
        await h.page.dispatchEvent({
          type: 'knowledge:loaded',
          detail: {
            course: { slug: 'signals' },
            node: { id: 'SS-01-02', documentVersion: 'current' },
          },
        });
      else await h.controller.refresh();
      await tick();
      if (outcome === 'failure')
        waiting.reject(Object.assign(new Error('QA迟到失败'), { status: 503 }));
      else
        waiting.resolve({
          attempt: reviewRecord(7, { status: 'graded', score: 0 }),
          replayed: true,
        });
      await submitting;
      const scene = `${change}/${outcome}`;
      assert.equal(a.isConnected, false, scene);
      assert.ok(
        [
          ...a.querySelectorAll('input'),
          ...a.querySelectorAll('textarea'),
          ...a.querySelectorAll('button'),
        ].every((node) => node.disabled),
        scene,
      );
      const before = h.requests.length;
      await a.dispatchEvent({ type: 'submit', preventDefault() {} });
      assert.equal(h.requests.length, before, scene);
      assert.equal(
        h.elements.get('learning-quiz-results').textContent.includes('QA迟到失败'),
        false,
        scene,
      );
    }
  }
});
