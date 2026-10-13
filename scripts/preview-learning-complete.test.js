const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const http = require('node:http');
const {
  createCompleteLearningPreview,
  startCompleteLearningPreview,
} = require('./preview-learning-complete');
const { createOnboardingPreview, courseFixture } = require('./preview-onboarding');
const {
  createLearningPreview,
  createLearningFixture,
  studentNode,
} = require('./preview-learning-workspace');
const { TOKEN } = require('./preview-economy');
const { listenAllowedLoopback, selectionMessage } = require('./fixtures/allowed-loopback');
const { GUIDE_VERSION } = require('../public/max-guide-releases');
const { STEPS } = require('../public/max-guide-stations');

// Real HTTP routers and memory fixtures, not a real browser, MySQL or external AI.
async function openPreview(t, factory = createCompleteLearningPreview) {
  const preview = factory();
  t.after(async () => {
    preview.server.closeAllConnections();
    if (preview.server.listening)
      await new Promise((resolve, reject) => {
        preview.server.close((error) => (error ? reject(error) : resolve()));
      });
  });
  const portSelection = await listenAllowedLoopback(preview.server);
  t.diagnostic(selectionMessage(portSelection));
  const origin = `http://127.0.0.1:${portSelection.port}`;
  async function call(route, { method = 'GET', body, token = TOKEN, headers = {} } = {}) {
    const response = await fetch(`${origin}${route}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    return {
      status: response.status,
      response,
      data: response.headers.get('content-type')?.includes('application/json')
        ? JSON.parse(text)
        : text,
    };
  }
  return { ...preview, origin, call, portSelection };
}

test('composed authoring fixtures are fresh copies and preserve published demo content without publishing source files', () => {
  const first = createLearningFixture();
  const second = createLearningFixture();
  assert.equal(first.nodes.length, 5);
  assert.equal(first.edges.length, 3);
  const longNode = first.nodes.find((node) => node.id === 'SS-02-01');
  assert.ok(studentNode(longNode).markdown.length > 2000);
  assert.ok(
    studentNode(longNode).markdown.split(/\n\s*\n/).length > 40,
    'the actual public authoring body is reused without counting private scoring JSON as reading content',
  );
  assert.match(longNode.markdown, /freebbs-quiz/);
  assert.match(longNode.markdown, /本地演示复核/);
  first.nodes[0].title = 'isolated mutation';
  assert.notEqual(second.nodes[0].title, first.nodes[0].title);
  assert.equal(
    courseFixture('signals').nodes.length,
    4,
    'the old onboarding fixture is not globally replaced',
  );
});

test('one origin serves world, full Max guide, all three courses and long authoring signals with safe student maps', async (t) => {
  const preview = await openPreview(t);
  for (const route of [
    '/',
    '/world?guideTour=1',
    '/guide',
    '/course?course=signals',
    '/knowledge?course=signals&point=SS-02-01',
    '/aichat',
  ]) {
    const page = await preview.call(route);
    assert.equal(page.status, 200, route);
    assert.match(page.data, /data-learning-complete-notice/);
    assert.match(page.data, /未连接|不连接真实 AI|本地模拟/);
    assert.match(page.data, new RegExp(TOKEN));
    assert.match(page.response.headers.get('content-security-policy'), /connect-src 'self'/);
    assert.match(page.response.headers.get('cache-control'), /no-store/);
    assert.ok(
      !page.data.includes('127.0.0.1:23094') && !page.data.includes('127.0.0.1:52146'),
      'no old-port proxy or iframe composition',
    );
  }
  const user = await preview.call('/api/auth/me');
  assert.equal(user.data.user.uid, 'u_preview01');
  assert.equal(user.data.user.id, 1);
  const courses = await preview.call('/api/courses');
  assert.deepEqual(
    courses.data.courses.map((course) => course.slug),
    ['math', 'circuits', 'signals'],
  );
  const signals = await preview.call('/api/courses/signals/map');
  assert.equal(signals.data.nodes.length, 5);
  assert.equal(signals.data.edges.length, 3);
  assert.equal(signals.data.nodes.filter((node) => node.metadata['节点级别'] === '0').length, 2);
  assert.ok(
    signals.data.nodes.every((node) => !node.markdown.includes('freebbs-quiz')),
    'student map cannot leak scoring blocks',
  );
  const detail = await preview.call('/api/courses/signals/map/nodes/SS-02-01');
  assert.equal(
    detail.data.node.markdown,
    studentNode(createLearningFixture().nodes.find((node) => node.id === 'SS-02-01')).markdown,
  );
  assert.match(detail.data.node.documentVersion, /^[a-f0-9]{64}$/);
  assert.ok(!detail.data.node.sections.knowledgeMarkdown.includes('freebbs-quiz'));
  for (const slug of ['math', 'circuits']) {
    const map = await preview.call(`/api/courses/${slug}/map`);
    assert.deepEqual(
      map.data,
      courseFixture(slug),
      'existing math/circuits examples remain intact',
    );
  }
});

test('guide progress, private notes and actual formal/practice attempts share one demo identity without forged completion', async (t) => {
  const preview = await openPreview(t);
  const starsBefore = await preview.call('/api/learning-stars/signals');
  assert.ok(starsBefore.data.course.stars.every((star) => !star.earned));
  assert.ok(starsBefore.data.nodes.every((node) => node.stars.every((star) => !star.earned)));
  assert.deepEqual(preview.learning.assessmentStore.rows, []);
  assert.deepEqual(preview.learning.store.rows, []);
  assert.deepEqual(preview.learning.analyticsStore.rows, []);
  assert.equal(
    (await preview.call('/api/learning-analytics/preferences')).data.preferences.enabled,
    true,
  );
  assert.equal((await preview.call('/api/onboarding')).data.seenAt, null);
  const completion = await preview.call('/api/onboarding', {
    method: 'PATCH',
    body: {
      version: GUIDE_VERSION,
      status: 'completed',
      step: STEPS.length - 1,
    },
  });
  assert.equal(completion.status, 200);
  assert.deepEqual((await preview.call('/api/learning-stars/signals')).data, starsBefore.data);
  assert.deepEqual(preview.learning.assessmentStore.rows, []);
  assert.equal(
    (await preview.call('/api/learning-analytics/preferences')).data.preferences.enabled,
    true,
  );
  const noteEndpoint = '/api/learning/signals/SS-01-01/entries';
  const note = await preview.call(noteEndpoint, {
    method: 'POST',
    body: {
      kind: 'note',
      title: '本地私有稿',
      content: '用户自己记录，不是聊天档案',
      requestKey: randomUUID(),
    },
  });
  assert.equal(note.status, 201);
  assert.equal((await preview.call(noteEndpoint)).data.entries[0].id, note.data.entry.id);
  assert.equal(preview.learning.store.rows[0].user, 1);
  const point = '/api/learning-assessments/signals/SS-02-01';
  const bank = (await preview.call(`${point}/questions`)).data;
  assert.equal(bank.questions.length, 4);
  assert.equal(bank.practiceQuestions.length, 2);
  const formal = bank.questions.find((question) => question.type === 'single_choice');
  const submitted = await preview.call(`${point}/attempts`, {
    method: 'POST',
    body: {
      questionId: formal.id,
      answer: 'A',
      mode: 'selftest',
      requestKey: randomUUID(),
    },
  });
  assert.equal(submitted.status, 201);
  assert.equal(submitted.data.attempt.official, true);
  const practice = bank.practiceQuestions.find((question) => question.type === 'single_choice');
  const practiced = await preview.call(`${point}/attempts`, {
    method: 'POST',
    body: {
      questionId: practice.id,
      answer: 'A',
      mode: 'practice',
      requestKey: randomUUID(),
    },
  });
  assert.equal(practiced.status, 201);
  assert.equal(practiced.data.attempt.official, false);
  const current = (await preview.call(`${point}/attempts`)).data.currentAttempts;
  assert.equal(current.length, 2);
  assert.deepEqual(
    preview.learning.assessmentStore.rows.map((row) => row.user_id),
    [1, 1],
  );
  assert.equal(
    (await preview.call('/api/learning-stars/signals/SS-02-01')).data.node.selftest
      .passedQuestionCount,
    1,
  );
});

test('preview paths accept actual same-course chapter two targets and reject unknown or other-course targets', async (t) => {
  const preview = await openPreview(t);
  const endpoint = '/api/learning/signals/SS-01-01/entries';
  const step = (point) => ({
    id: 'read-next',
    tool: 'content',
    title: '下一章正文',
    minutes: 8,
    completed: false,
    point,
    view: 'reading',
  });
  const path = (point) => ({
    kind: 'path',
    title: '本次路径',
    content: '自行选择',
    path: [step(point)],
    requestKey: randomUUID(),
  });
  const result = await preview.call(endpoint, { method: 'POST', body: path('SS-02-01') });
  assert.equal(result.status, 201);
  assert.equal(result.data.entry.path[0].point, 'SS-02-01');
  assert.equal(
    (await preview.call(endpoint, { method: 'POST', body: path('SS-02-00') })).status,
    201,
  );
  assert.equal(
    (await preview.call(endpoint, { method: 'POST', body: path('SS-99-01') })).status,
    400,
  );
  assert.equal(
    (await preview.call(endpoint, { method: 'POST', body: path('MA-01-1') })).status,
    400,
  );
  assert.equal(
    (await preview.call(endpoint, { method: 'POST', body: path('EC-01-1') })).status,
    400,
  );
  const update = await preview.call(`${endpoint}/${result.data.entry.id}`, {
    method: 'PUT',
    body: {
      ...path('MA-01-1'),
      revision: result.data.entry.revision,
    },
  });
  assert.equal(update.status, 400);
  const records = await preview.call(endpoint);
  assert.equal(records.data.entries.length, 2);
  assert.ok(records.data.entries.every((entry) => entry.path[0].point.startsWith('SS-02-')));
});

test('simulated Max reconstructs the same strategy and authenticated current-version selftest context without writes', async (t) => {
  const preview = await openPreview(t);
  const point = '/api/learning-assessments/signals/SS-01-01';
  const bank = (await preview.call(`${point}/questions`)).data;
  const question = bank.questions.find((record) => record.type === 'single_choice');
  const submitted = await preview.call(`${point}/attempts`, {
    method: 'POST',
    body: {
      questionId: question.id,
      answer: 'A',
      mode: 'selftest',
      requestKey: randomUUID(),
    },
  });
  assert.equal(submitted.status, 201);
  const before = {
    attempts: structuredClone(preview.learning.assessmentStore.rows),
    notes: structuredClone(preview.learning.store.rows),
    stars: structuredClone(preview.learning.starsStore.rows),
    analytics: structuredClone(preview.learning.analyticsStore.rows),
  };
  const chat = await preview.call('/api/ai/knowledge/chat', {
    method: 'POST',
    body: {
      question: '解释这个例子',
      history: [],
      context: {
        courseSlug: 'signals',
        knowledgePointId: 'SS-01-01',
        learningStartPreference: { level: 'familiar', goal: 'concepts' },
        learningTask: {
          tool: 'feedback',
          quizView: 'quick',
          questionId: question.id,
          goal: 'explore',
        },
        learningEvidence: { passed: 999 },
        knowledgePointMarkdown: 'untrusted text should not win',
      },
    },
  });
  assert.equal(chat.status, 200);
  assert.match(chat.response.headers.get('content-type'), /text\/event-stream/);
  assert.match(chat.data, /本地模拟回答/);
  assert.match(chat.data, /模型边界探索/);
  const trusted = preview.requests[0].trustedCompanionContext;
  assert.equal(trusted.learningTask.questionId, question.id);
  assert.equal(trusted.learningTask.goal, 'explore');
  assert.equal(
    trusted.learningStartPreference.goal,
    'concepts',
    'temporary task does not overwrite the course default',
  );
  assert.equal(trusted.learningEvidence.observed, 1);
  assert.equal(trusted.learningEvidence.passed, 1);
  assert.equal(trusted.learningEvidence.officialTotal, 2);
  assert.ok(!trusted.knowledgePointMarkdown.includes('untrusted text should not win'));
  assert.match(preview.requests[0].trustedStrategyHint, /探索/);
  assert.deepEqual(preview.learning.assessmentStore.rows, before.attempts);
  assert.deepEqual(preview.learning.store.rows, before.notes);
  assert.deepEqual(preview.learning.starsStore.rows, before.stars);
  assert.deepEqual(preview.learning.analyticsStore.rows, before.analytics);
});

test('other-course simulated Max reads trusted context without substituting signal-specific teaching or creating evidence', async (t) => {
  const preview = await openPreview(t);
  const before = {
    attempts: structuredClone(preview.learning.assessmentStore.rows),
    notes: structuredClone(preview.learning.store.rows),
    stars: structuredClone(preview.learning.starsStore.rows),
    analytics: structuredClone(preview.learning.analyticsStore.rows),
  };
  for (const slug of ['math', 'circuits']) {
    const fixture = courseFixture(slug);
    const node = fixture.nodes[0];
    for (const question of ['从基本原理解释这个例子', '下一步学习建议']) {
      const chat = await preview.call('/api/ai/knowledge/chat', {
        method: 'POST',
        body: {
          question,
          history: [{ role: 'user', content: '学习这个知识点' }],
          context: {
            courseSlug: slug,
            knowledgePointId: node.id,
            courseName: '伪造的课程名称',
            knowledgePointTitle: '伪造的知识点名称',
            learningStartPreference: { level: 'new', goal: 'concepts' },
            learningTask: { tool: 'content', goal: 'explore' },
            learningEvidence: { passed: 999 },
          },
        },
      });
      assert.equal(chat.status, 200);
      assert.match(chat.response.headers.get('content-type'), /text\/event-stream/);
      const answer = JSON.parse(chat.data.slice('data: '.length).trim()).delta;
      assert.match(answer, /本地模拟入口（不是实时 AI）/);
      assert.ok(answer.includes(fixture.course.name));
      assert.ok(answer.includes(node.title));
      assert.match(answer, /不提供该课程的专业教学回答/);
      assert.match(answer, /不宣称学习效果/);
      assert.match(answer, /正式判分和星标不由此回答决定/);
      assert.doesNotMatch(answer, /卷积|冲激响应|伪造的/);
      const request = preview.requests.at(-1);
      const trusted = request.trustedCompanionContext;
      assert.equal(trusted.courseSlug, slug);
      assert.equal(trusted.courseName, fixture.course.name);
      assert.equal(trusted.knowledgePointId, node.id);
      assert.equal(trusted.knowledgePointTitle, node.title);
      assert.equal(trusted.learningStartPreference.level, 'new');
      assert.equal(trusted.learningStartPreference.goal, 'concepts');
      assert.equal(trusted.learningTask.goal, 'explore');
      assert.equal(trusted.learningEvidence.officialTotal, 0);
      assert.equal(trusted.learningEvidence.passed, 0);
      assert.match(request.trustedStrategyHint, /探索/);
    }
  }
  assert.equal(preview.requests.length, 4);
  assert.deepEqual(preview.learning.assessmentStore.rows, before.attempts);
  assert.deepEqual(preview.learning.store.rows, before.notes);
  assert.deepEqual(preview.learning.starsStore.rows, before.stars);
  assert.deepEqual(preview.learning.analyticsStore.rows, before.analytics);
});

test('complete preview denies other origins, credentials, unsupported real AI APIs and invalid contexts', async (t) => {
  const preview = await openPreview(t);
  // Undici normalizes the Host header; use native HTTP to actually send a foreign Host.
  const foreignHostStatus = await new Promise((resolve, reject) => {
    const request = http.get(
      `${preview.origin}/world`,
      { headers: { Host: 'www.free-bbs.cn' } },
      (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode));
      },
    );
    request.on('error', reject);
  });
  assert.equal(foreignHostStatus, 403);
  assert.equal(
    (await preview.call('/world', { headers: { Origin: 'https://www.free-bbs.cn' } })).status,
    403,
  );
  assert.equal(
    (await preview.call('/api/onboarding', { headers: { Origin: 'https://www.free-bbs.cn' } }))
      .status,
    403,
  );
  for (const token of ['', 'learning-preview-student', 'real-session-not-accepted'])
    assert.equal(
      (
        await preview.call('/api/ai/knowledge/chat', {
          method: 'POST',
          token,
          body: {
            question: '解释',
            context: { courseSlug: 'signals', knowledgePointId: 'SS-01-01' },
          },
        })
      ).status,
      401,
    );
  assert.equal(
    (
      await preview.call('/api/ai/knowledge/chat', {
        method: 'POST',
        body: {
          question: '解释',
          context: { courseSlug: 'signals', knowledgePointId: 'SS-99-01' },
        },
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await preview.call('/api/ai/knowledge/chat', {
        method: 'POST',
        body: {
          question: '模拟失败',
          context: { courseSlug: 'signals', knowledgePointId: 'SS-01-01' },
        },
      })
    ).status,
    503,
  );
  assert.equal((await preview.call('/api/ai/chat', { method: 'POST', body: {} })).status, 503);
  assert.equal((await preview.call('/api/courses/unknown/map')).status, 404);
  assert.equal((await preview.call('/api/courses/signals/map/nodes/SS-99-01')).status, 404);
  assert.equal((await preview.call('/api/learning-stars/signals', { token: '' })).status, 401);
});

test('opt-in composition leaves the original onboarding and isolated learning factories unchanged', async (t) => {
  const onboarding = await openPreview(t, createOnboardingPreview);
  const legacyMap = await onboarding.call('/api/courses/signals/map');
  assert.deepEqual(legacyMap.data, courseFixture('signals'));
  assert.deepEqual(
    (await onboarding.call('/api/learning-assessments/signals/SS-01-1/questions')).data.questions,
    [],
  );
  assert.equal(
    (await onboarding.call('/api/ai/knowledge/chat', { method: 'POST', body: {} })).status,
    503,
  );
  assert.ok(!Object.hasOwn(onboarding, 'requests'));
  const isolated = await openPreview(t, createLearningPreview);
  assert.equal((await isolated.call('/world', { token: 'learning-preview-student' })).status, 404);
  const original = await isolated.call('/api/courses/signals/map', {
    token: 'learning-preview-student',
  });
  assert.equal(original.data.nodes.length, 5);
  assert.equal(
    (await isolated.call('/api/auth/me', { token: 'learning-preview-student' })).data.user.uid,
    'u_learning01',
  );
  assert.equal(
    (
      await isolated.call('/api/ai/knowledge/chat', {
        method: 'POST',
        token: 'learning-preview-student',
        body: {
          question: '解释',
          context: { courseSlug: 'signals', knowledgePointId: 'SS-01-01' },
        },
      })
    ).status,
    200,
  );
});

test('complete preview start selects its own allowed free loopback port and never depends on old services', async (t) => {
  const preview = await startCompleteLearningPreview();
  t.after(async () => {
    preview.server.closeAllConnections();
    await new Promise((resolve) => {
      preview.server.close(resolve);
    });
  });
  assert.equal(preview.server.address().address, '127.0.0.1');
  assert.equal(preview.server.address().port, preview.portSelection.port);
  assert.ok(preview.portSelection.attemptedPorts.includes(preview.portSelection.port));
  assert.ok(!preview.portSelection.skippedPorts.includes(preview.portSelection.port));
});
