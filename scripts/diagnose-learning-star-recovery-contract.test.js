// Recovery diagnostics only: actual registered route handlers and isolated memory
// stores. No HTTP listener, browser, production MySQL, AI, financial reward or queue.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  createLearningAssessmentRouter,
  createMemoryAssessmentStore,
  parseAssessmentMarkdown,
} = require('../backend/learning-assessment');
const {
  createLearningStarService,
  createLearningStarsRouter,
  createMemoryLearningStarStore,
} = require('../backend/learning-stars');
const {
  createLearningAnalyticsRouter,
  createMemoryAnalyticsStore,
  recordAssessmentEvent,
} = require('../backend/learning-analytics');

const student = { id: 1 };
const manager = { id: 99 };
const pointParams = { slug: 'signals', point: 'SS-01-01' };
const paths = {
  attempts: '/:slug/:point/attempts',
  review: '/:slug/:point/attempts/:id/review',
  node: '/:slug/:point',
  course: '/:slug',
  reconcile: '/:slug/:point/reconcile',
};
const reviewBody = { score: 2, feedback: '合成夹具：依据完整' };
const ownStar = (node) => node.stars.find((entry) => entry.key === 'self_learning');
// The review response allows teacher-only ownership/snapshot fields. Personal
// history/current summaries intentionally omit them; keep that boundary explicit.
const personalAttempt = (attempt) =>
  Object.fromEntries(
    Object.entries(attempt).filter(
      ([field]) => !['userId', 'snapshotAvailability', 'questionSnapshot'].includes(field),
    ),
  );

function fixtureMarkdown() {
  const quiz = {
    schemaVersion: 1,
    status: 'published',
    version: 'fixture-original',
    source: '恢复边界合成夹具，非正式课程成绩',
    reviewedBy: 'QA课程组',
    questions: [
      {
        id: 'explain',
        type: 'short_answer',
        prompt: '合成夹具：解释依据。',
        scoring: { method: 'manual', rubric: '合成评分依据', maxScore: 2, passScore: 1 },
      },
    ],
  };
  return `# 合成正文\n\n\x60\x60\x60freebbs-quiz\n${JSON.stringify(quiz)}\n\x60\x60\x60`;
}

function recoveryLab() {
  const context = {
    course_id: 10,
    slug: pointParams.slug,
    node_id: pointParams.point,
    course_name: '合成恢复夹具',
    title: '合成知识点',
    document_markdown: fixtureMarkdown(),
    basic_info_markdown: '知识点层级：核心',
  };
  const assessmentStore = createMemoryAssessmentStore({
    contexts: [context],
    managers: [{ userId: manager.id, courseId: context.course_id }],
  });
  const starStore = createMemoryLearningStarStore({ contexts: [context], assessmentStore });
  const stars = createLearningStarService({ store: starStore });
  const analyticsStore = createMemoryAnalyticsStore({
    contexts: [context],
    businessAttempts: assessmentStore.rows,
  });
  let failReviewSideEffects = false;
  const grant = starStore.grant.bind(starStore);
  starStore.grant = async (...args) => {
    if (failReviewSideEffects) throw new Error('Explicit fixture learning-star store outage');
    return grant(...args);
  };
  const record = analyticsStore.record.bind(analyticsStore);
  analyticsStore.record = async (...args) => {
    if (failReviewSideEffects && args[2].metadata?.reviewed)
      throw new Error('Explicit fixture assessment-process event outage');
    return record(...args);
  };
  const requireAuth = async (req) => req.actor || student;
  const hookCalls = [];
  const assessmentRouter = createLearningAssessmentRouter({
    store: assessmentStore,
    requireAuth,
    onAssessmentEvent: async (event) => {
      hookCalls.push({
        id: event.attempt.id,
        status: event.attempt.status,
        verdict: event.attempt.verdict,
        reviewed: Boolean(event.reviewed),
      });
      // Same dispatch shape as backend/server.js, with explicit fixture failures.
      // Promise.all does not make these independent side effects atomic or durable.
      await Promise.all([
        stars.recordAssessment(event),
        recordAssessmentEvent(analyticsStore, event),
      ]);
    },
  });
  const starRouter = createLearningStarsRouter({ service: stars, store: starStore, requireAuth });
  const analyticsRouter = createLearningAnalyticsRouter({ store: analyticsStore, requireAuth });

  async function call(
    router,
    method,
    routePath,
    { actor = student, body = {}, query = {}, params = pointParams } = {},
  ) {
    const route = router.stack.find(
      (entry) => entry.route?.path === routePath && entry.route.methods[method.toLowerCase()],
    );
    assert.ok(route, `Production route exists: ${method} ${routePath}`);
    const response = {
      headersSent: false,
      statusCode: 200,
      set() {
        return this;
      },
      status(value) {
        this.statusCode = value;
        return this;
      },
      json(value) {
        this.payload = value;
        this.headersSent = true;
        return this;
      },
    };
    await route.route.stack[0].handle({ actor, params, query, body }, response);
    return { status: response.statusCode, data: response.payload };
  }
  const summary = () => call(analyticsRouter, 'GET', '/summary', { query: { window: 'all' } });
  const submit = () =>
    call(assessmentRouter, 'POST', paths.attempts, {
      body: {
        questionId: 'explain',
        answer: '合成夹具：学生自己的解释。',
        mode: 'selftest',
        requestKey: crypto.randomUUID(),
        expectedDocumentVersion: parseAssessmentMarkdown(context.document_markdown).documentVersion,
      },
    });
  const review = (id) =>
    call(assessmentRouter, 'PATCH', paths.review, {
      actor: manager,
      body: reviewBody,
      params: { ...pointParams, id },
    });
  return {
    context,
    assessmentStore,
    starStore,
    analyticsStore,
    hookCalls,
    assessmentRouter,
    starRouter,
    analyticsRouter,
    call,
    submit,
    review,
    summary,
    setOutage(value) {
      failReviewSideEffects = value;
    },
  };
}

async function savedPassWithFailedHook(lab) {
  const consent = await lab.call(lab.analyticsRouter, 'PUT', '/preferences', {
    body: { enabled: true },
  });
  assert.equal(consent.status, 200);
  const submitted = await lab.submit();
  assert.equal(submitted.status, 201);
  assert.equal(submitted.data.attempt.status, 'pending_review');
  assert.equal(lab.analyticsStore.rows.length, 1, 'The initial pending process event was recorded');
  lab.setOutage(true);
  const reviewed = await lab.review(submitted.data.attempt.id);
  assert.equal(reviewed.status, 200, 'Best-effort hook failure does not undo the saved review');
  assert.equal(reviewed.data.attempt.status, 'graded');
  assert.equal(reviewed.data.attempt.verdict, 'pass');
  assert.equal(reviewed.data.attempt.score, 2);
  assert.equal(reviewed.data.attempt.maxScore, 2);
  assert.equal(reviewed.data.attempt.passScore, 1);
  assert.equal(lab.starStore.rows.length, 0, 'No partial star survives the failed transaction');
  assert.equal(lab.analyticsStore.rows.length, 1, 'The graded process event is explicitly missing');
  return reviewed.data.attempt;
}

test('saved review plus failed side effects: same-intent replay and GETs do not deliver events or award stars; existing POST can reconcile current evidence', async () => {
  const lab = recoveryLab();
  const attempt = await savedPassWithFailedHook(lab);
  const savedRow = structuredClone(lab.assessmentStore.rows[0]);
  const hooksBeforeReplay = structuredClone(lab.hookCalls);
  const replay = await lab.review(attempt.id);
  assert.equal(replay.status, 200);
  assert.equal(replay.data.replayed, true);
  assert.deepEqual(replay.data.attempt, attempt);
  assert.deepEqual(lab.hookCalls, hooksBeforeReplay, 'Confirmation never re-dispatches the hook');
  assert.deepEqual(lab.assessmentStore.rows[0], savedRow, 'Confirmation never regrades the record');

  const history = await lab.call(lab.assessmentRouter, 'GET', paths.attempts);
  assert.equal(history.status, 200);
  assert.equal(history.data.attempts.length, 1);
  assert.equal(history.data.nextCursor, null);
  assert.equal(Object.hasOwn(history.data, 'totalCount'), false, 'No invented history total');
  assert.deepEqual(history.data.attempts[0], personalAttempt(attempt));
  assert.deepEqual(history.data.currentAttempts, [personalAttempt(attempt)]);
  for (const field of ['userId', 'snapshotAvailability', 'questionSnapshot'])
    assert.equal(Object.hasOwn(history.data.attempts[0], field), false);
  assert.equal(history.data.documentVersion, attempt.documentVersion);
  const older = await lab.call(lab.assessmentRouter, 'GET', paths.attempts, {
    query: { before: attempt.id },
  });
  assert.deepEqual(older.data.attempts, []);
  assert.equal(Object.hasOwn(older.data, 'currentAttempts'), false, 'Older pages are history only');
  const pending = await lab.call(lab.assessmentRouter, 'GET', paths.attempts, {
    actor: manager,
    query: { review: 'pending' },
  });
  assert.deepEqual(pending.data.attempts, []);
  assert.equal(Object.hasOwn(pending.data, 'currentAttempts'), false);

  const node = await lab.call(lab.starRouter, 'GET', paths.node);
  const course = await lab.call(lab.starRouter, 'GET', paths.course);
  assert.equal(node.data.node.selftest.eligible, true);
  assert.equal(node.data.node.selftest.passedQuestionCount, 1);
  assert.equal(ownStar(node.data.node).earned, false);
  assert.equal(ownStar(course.data.nodes[0]).earned, false);
  assert.equal(lab.starStore.rows.length, 0, 'Reading eligibility is not persisting a star');
  const counts = await lab.summary();
  assert.equal(counts.status, 200);
  assert.equal(counts.data.window, 'all');
  assert.deepEqual(counts.data.selftest, {
    assessmentDataStatus: 'available',
    attempts: 1,
    officialAttempts: 1,
    passed: 1,
    failed: 0,
    pendingReview: 0,
    practiceAttempts: 0,
  });
  assert.equal(counts.data.process.assessmentEvents, 1, 'Only the prior pending event exists');
  assert.equal(lab.analyticsStore.rows[0].metadata_json.status, 'pending_review');
  assert.equal(lab.analyticsStore.rows[0].metadata_json.verdict, null);

  lab.setOutage(false);
  const reconciled = await lab.call(lab.starRouter, 'POST', paths.reconcile);
  assert.equal(reconciled.status, 200);
  assert.equal(reconciled.data.awarded, true);
  assert.equal(ownStar(reconciled.data.node).earned, true);
  assert.deepEqual(ownStar(reconciled.data.node).evidence.attemptIds, [attempt.id]);
  assert.equal(lab.starStore.rows.length, 2, 'Only learning-star and course-light records exist');
  assert.deepEqual(lab.starStore.rows.map((row) => row.star_key).sort(), [
    'course_lit',
    'self_learning',
  ]);
  const again = await lab.call(lab.starRouter, 'POST', paths.reconcile);
  assert.equal(again.data.awarded, false);
  assert.equal(lab.starStore.rows.length, 2, 'Existing star reconciliation is idempotent');
  assert.deepEqual(lab.hookCalls, hooksBeforeReplay);
  assert.deepEqual(lab.assessmentStore.rows[0], savedRow);
  assert.equal((await lab.summary()).data.process.assessmentEvents, 1);
  assert.equal(lab.analyticsStore.rows.length, 1, 'Reconciliation does not repair process events');
});

test('changed body retains the historical pass and all-window business count, but current evidence cannot backfill an old missing star', async () => {
  const lab = recoveryLab();
  const attempt = await savedPassWithFailedHook(lab);
  const savedRow = structuredClone(lab.assessmentStore.rows[0]);
  // The quiz must remain the final block: appending content after its closing
  // fence would invalidate the formal schema instead of testing version changes.
  lab.context.document_markdown = lab.context.document_markdown.replace(
    '# 合成正文',
    '# 合成正文\n\n合成夹具：在恢复服务前正文发生变化。',
  );
  const revisedAssessment = parseAssessmentMarkdown(lab.context.document_markdown);
  assert.equal(revisedAssessment.questions.length, 1);
  assert.deepEqual(revisedAssessment.warnings, []);
  assert.equal(revisedAssessment.questionVersion, attempt.questionVersion);
  assert.notEqual(revisedAssessment.documentVersion, attempt.documentVersion);
  const history = await lab.call(lab.assessmentRouter, 'GET', paths.attempts);
  assert.deepEqual(history.data.attempts, [personalAttempt(attempt)]);
  assert.deepEqual(
    history.data.currentAttempts,
    [personalAttempt(attempt)],
    'Current summary contains latest stored candidates, not validated proof',
  );
  assert.notEqual(history.data.documentVersion, attempt.documentVersion);
  const replay = await lab.review(attempt.id);
  assert.equal(replay.status, 200);
  assert.equal(replay.data.replayed, true);
  assert.deepEqual(
    replay.data.attempt,
    attempt,
    'Replay confirms the original historical snapshot',
  );
  assert.equal(lab.hookCalls.filter((event) => event.reviewed).length, 1);
  const node = await lab.call(lab.starRouter, 'GET', paths.node);
  assert.equal(node.data.node.selftest.available, true);
  assert.equal(node.data.node.selftest.questionCount, 1);
  assert.equal(node.data.node.selftest.passedQuestionCount, 0);
  assert.equal(node.data.node.selftest.eligible, false);
  assert.equal(ownStar(node.data.node).earned, false);
  assert.equal(
    (await lab.summary()).data.selftest.passed,
    1,
    'All-window counts include historical results, not current eligibility',
  );
  lab.setOutage(false);
  const reconciled = await lab.call(lab.starRouter, 'POST', paths.reconcile);
  assert.equal(reconciled.status, 200);
  assert.equal(reconciled.data.awarded, false);
  assert.equal(ownStar(reconciled.data.node).earned, false);
  assert.equal(lab.starStore.rows.length, 0);
  assert.equal(lab.analyticsStore.rows.length, 1);
  assert.deepEqual(lab.assessmentStore.rows[0], savedRow);
});

test('a later new current formal pass on the same node can naturally reconcile stars after service recovery, without replaying the lost review event', async () => {
  const lab = recoveryLab();
  const first = await savedPassWithFailedHook(lab);
  lab.setOutage(false);
  const next = await lab.submit();
  assert.equal(next.data.attempt.status, 'pending_review');
  assert.equal(lab.starStore.rows.length, 0, 'A pending new answer does not recover stars');
  const reviewed = await lab.review(next.data.attempt.id);
  assert.equal(reviewed.status, 200);
  const node = await lab.call(lab.starRouter, 'GET', paths.node);
  assert.equal(ownStar(node.data.node).earned, true);
  assert.deepEqual(ownStar(node.data.node).evidence.attemptIds, [next.data.attempt.id]);
  assert.equal(lab.assessmentStore.rows.length, 2);
  const history = await lab.call(lab.assessmentRouter, 'GET', paths.attempts);
  assert.deepEqual(
    history.data.attempts.map((entry) => entry.id),
    [next.data.attempt.id, first.id],
  );
  assert.deepEqual(
    history.data.currentAttempts.map((entry) => entry.id),
    [next.data.attempt.id],
  );
  const counts = await lab.summary();
  assert.equal(counts.data.selftest.attempts, 2);
  assert.equal(counts.data.selftest.passed, 2, 'Business counts include repeated submissions');
  assert.equal(
    counts.data.process.assessmentEvents,
    3,
    'Original pending, new pending and new graded events only',
  );
  assert.equal(
    lab.analyticsStore.rows.filter(
      (row) => row.metadata_json.attemptId === first.id && row.metadata_json.reviewed,
    ).length,
    0,
  );
  assert.equal(lab.hookCalls.filter((event) => event.reviewed && event.id === first.id).length, 1);
});
