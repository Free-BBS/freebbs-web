const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { parseAssessmentMarkdown, toPublicQuestion } = require('../backend/learning-assessment');
const { recommend } = require('../public/learning-next-steps');
const {
  viewLabels,
  latestAttempts,
  currentQuestionAttempts,
  isMistake,
  resultLabel,
  legacyPractice,
  createAssessmentController,
  selectQuestions,
  recommendedDifficulty,
} = require('../public/learning-assessment');

class Element {
  constructor(tag = 'div') {
    this.tag = tag;
    this.children = [];
    this.dataset = {};
    this.listeners = new Map();
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.text = '';
    this.className = '';
    this.attributes = new Map();
    const classes = new Set();
    this.classList = {
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
    };
  }

  set textContent(value) {
    this.text = String(value);
    this.children = [];
  }

  get textContent() {
    return this.text + this.children.map((child) => child.textContent).join('');
  }

  set innerHTML(value) {
    this.html = value;
    this.children = [];
  }

  get innerHTML() {
    return this.html || '';
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.text = '';
    this.html = '';
    this.children = children;
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  addEventListener(name, callback) {
    const listeners = this.listeners.get(name) || [];
    listeners.push(callback);
    this.listeners.set(name, listeners);
  }

  dispatchEvent(event) {
    return Promise.all((this.listeners.get(event.type) || []).map((callback) => callback(event)));
  }

  reportValidity() {
    return !this.disabled;
  }

  scrollIntoView() {
    this.scrolled = true;
  }

  querySelectorAll(selector) {
    const matches = [];
    function walk(node) {
      if (
        (selector === '[data-quiz-view]' && node.dataset.quizView) ||
        (selector === '[data-question-id]' && node.dataset.questionId) ||
        node.tag === selector
      )
        matches.push(node);
      node.children.forEach(walk);
    }
    this.children.forEach(walk);
    return matches;
  }
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const tick = async () => {
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
};
const escape = (value) =>
  String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const question = () => ({
  id: 'q1',
  type: 'single_choice',
  prompt: '<img src=x onerror=alert(1)>选择一项',
  source: '<svg onload=alert(2)>',
  official: true,
  questionVersion: '1',
  options: [
    { id: 'A', text: '正确选项' },
    { id: 'B', text: '<script>alert(3)</script>' },
  ],
  scoring: { method: 'exact', maxScore: 1, passScore: 1 },
});
const attempt = (overrides = {}) => ({
  id: '1',
  questionId: 'q1',
  questionVersion: '1',
  documentVersion: 'current',
  answer: 'B',
  status: 'graded',
  verdict: 'fail',
  official: true,
  score: 0,
  maxScore: 1,
  passScore: 1,
  feedback: '核对选项后订正',
  gradingBasis: '完整匹配',
  createdAt: '2026-10-01T00:00:00Z',
  ...overrides,
});
function harness({ loggedIn = true, callApi } = {}) {
  const elements = new Map(
    [
      'knowledge-page',
      'learning-quiz-list',
      'learning-quiz-status',
      'learning-quiz-results',
      'learning-quiz-tabs',
    ].map((id) => [id, new Element()]),
  );
  const page = elements.get('knowledge-page');
  const tabs = elements.get('learning-quiz-tabs');
  Object.keys(viewLabels).forEach((view) => {
    const button = new Element('button');
    button.dataset.quizView = view;
    tabs.append(button);
  });
  const document = {
    querySelector: () => page,
    getElementById: (id) => elements.get(id),
    createElement: (tag) => new Element(tag),
  };
  const browser = new Element();
  browser.CustomEvent = function CustomEvent(type, options) {
    this.type = type;
    this.detail = options.detail;
  };
  browser.crypto = crypto;
  const requests = [];
  const renders = [];
  const events = [];
  page.addEventListener('knowledge:assessment-updated', (event) => events.push(event.detail));
  const app = {
    userState: {
      uid: loggedIn ? 'student' : '',
      token: loggedIn ? 'student-token' : '',
      isLoggedIn: loggedIn,
    },
    sessionReady: Promise.resolve(),
    renderMarkdownContent(value) {
      renders.push(value);
      return escape(value);
    },
    enhanceMarkdownContent() {},
    async callApi(url, options) {
      requests.push({ url, options });
      if (callApi) return callApi(url, options);
      if (url.endsWith('/questions'))
        return {
          questions: [question()],
          practiceQuestions: [],
          documentVersion: 'current',
          canReview: false,
        };
      if (url.endsWith('/attempts') && options.method === 'GET')
        return { attempts: [], documentVersion: 'current' };
      const body = JSON.parse(options.body);
      return {
        attempt: attempt({
          id: '2',
          answer: body.answer,
          score: body.answer === 'A' ? 1 : 0,
          verdict: body.answer === 'A' ? 'pass' : 'fail',
        }),
        documentVersion: 'current',
      };
    },
  };
  const controller = createAssessmentController({ window: browser, document, app });
  const load = (markdown = '') =>
    page.dispatchEvent({
      type: 'knowledge:loaded',
      detail: {
        course: { slug: 'signals' },
        node: { id: 'SS-01-01', markdown, documentVersion: 'current' },
      },
    });
  return { elements, page, browser, app, controller, requests, renders, events, load };
}

function layeredQuestionsResponse(roles) {
  const markdown = `# 学习正文\n\n\x60\x60\x60freebbs-quiz\n${JSON.stringify({
    schemaVersion: 1,
    status: 'published',
    version: '1',
    source: '课程组原创',
    reviewedBy: '课程组',
    questions: roles.map((assessmentRole, index) => ({
      id: `${assessmentRole}-${index}`,
      type: 'single_choice',
      assessmentRole,
      difficulty: assessmentRole === 'exploration' ? 'challenge' : 'basic',
      prompt: '核对卷积的适用条件',
      options: [
        { id: 'A', text: '因果零状态响应' },
        { id: 'B', text: '任意非线性系统' },
      ],
      scoring: { method: 'exact', answer: 'A', maxScore: 1, passScore: 1 },
    })),
  })}\n\x60\x60\x60`;
  const assessment = parseAssessmentMarkdown(markdown);
  return {
    questions: assessment.questions.map(toPublicQuestion),
    practiceQuestions: assessment.practiceQuestions.map(toPublicQuestion),
    documentVersion: assessment.documentVersion,
    canReview: false,
  };
}

function attachWorkspaceRecommendations(h, preference = null) {
  const { browser } = h;
  const source = fs.readFileSync(path.join(__dirname, '../public/knowledge-workspace.js'), 'utf8');
  const selectSource = (start, end) => {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from);
    assert.ok(from >= 0 && to > from, `Workspace contract source exists: ${start}`);
    return source.slice(from, to);
  };
  const state = {
    ready: true,
    node: { id: 'SS-01-01', title: '卷积', markdown: '# 学习正文' },
    entries: [],
    attempts: [],
    questions: [],
    practiceQuestions: [],
    planDirty: false,
    planGoal: '',
  };
  browser.FreeBbsLearningNextSteps = { recommend };
  browser.FreeBbsLearningStart = { currentPreference: () => preference };
  browser.freeBbsKnowledge = { getLearningContext: () => ({ tags: {}, map: {} }) };
  const context = vm.createContext({
    state,
    page: h.page,
    window: browser,
    renderPlan() {},
  });
  vm.runInContext(
    selectSource('  function refreshPlan(', '  function changePlan(') +
      selectSource(
        "  page.addEventListener('knowledge:assessment-updated',",
        "  page.addEventListener('knowledge:tags-change'",
      ),
    context,
  );
  return state;
}

test('feedback tabs keep self-test, private mistakes and existing template practice', () => {
  assert.deepEqual(Object.keys(viewLabels), ['quick', 'mistakes', 'practice']);
  assert.equal(viewLabels.practice, '练习');
});

test('practice layers and exploration filters never reduce the full formal selftest denominator', () => {
  const all = [
    { ...question(), id: 'basic', difficulty: 'basic', assessmentRole: 'selftest' },
    { ...question(), id: 'challenge', difficulty: 'challenge', assessmentRole: 'selftest' },
    {
      ...question(),
      id: 'practice',
      official: false,
      difficulty: 'basic',
      assessmentRole: 'practice',
    },
    {
      ...question(),
      id: 'explore',
      official: false,
      difficulty: 'challenge',
      assessmentRole: 'exploration',
    },
    { ...question(), id: 'old' },
  ];
  assert.deepEqual(
    selectQuestions(all, 'quick', { difficulty: 'basic' }).map((q) => q.id),
    ['basic', 'challenge', 'old'],
  );
  assert.deepEqual(
    selectQuestions(all, 'practice', { difficulty: 'basic' }).map((q) => q.id),
    ['basic', 'practice'],
  );
  assert.deepEqual(
    selectQuestions(all, 'practice', { assessmentRole: 'exploration' }).map((q) => q.id),
    ['explore'],
  );
  assert.equal(recommendedDifficulty({ level: 'new' }), 'basic');
  assert.equal(recommendedDifficulty({ level: 'basic' }), 'standard');
  assert.equal(recommendedDifficulty({ level: 'advanced' }), 'challenge');
  assert.equal(recommendedDifficulty({ level: 'unknown' }), '');
});

test('difficulty filters preserve the full public snapshot and are ignored by formal selftest UI', async () => {
  const all = [
    { ...question(), id: 'basic', difficulty: 'basic', assessmentRole: 'selftest' },
    { ...question(), id: 'challenge', difficulty: 'challenge', assessmentRole: 'selftest' },
  ];
  const h = harness({
    callApi: async (url) =>
      url.endsWith('/questions')
        ? { questions: all, practiceQuestions: [], documentVersion: 'current' }
        : { attempts: [], documentVersion: 'current' },
  });
  await h.load();
  await tick();
  h.controller.selectView('practice', { difficulty: 'basic' });
  assert.equal(h.elements.get('learning-quiz-list').querySelectorAll('form').length, 1);
  assert.match(h.elements.get('learning-quiz-list').textContent, /基础 · 教师估计/);
  assert.equal(h.controller.getSnapshot().questions.length, 2);
  h.controller.selectView('quick');
  assert.equal(h.elements.get('learning-quiz-list').querySelectorAll('form').length, 2);
  assert.equal(h.controller.getSnapshot().questions.length, 2);
});

test('published question groups survive assessment events into the real workspace recommendation', async () => {
  const response = layeredQuestionsResponse(['selftest', 'practice', 'exploration']);
  const h = harness({
    callApi: async (url) =>
      url.endsWith('/questions')
        ? response
        : { attempts: [], documentVersion: response.documentVersion },
  });
  const workspace = attachWorkspaceRecommendations(h, { level: 'basic', goal: 'practice' });
  await h.load();
  await tick();
  const snapshot = h.controller.getSnapshot();
  const event = h.events.at(-1);
  assert.deepEqual(
    snapshot.questions.map((entry) => entry.id),
    ['selftest-0'],
  );
  assert.deepEqual(
    snapshot.practiceQuestions.map((entry) => entry.id),
    ['practice-1', 'exploration-2'],
  );
  assert.deepEqual(event.questions, snapshot.questions);
  assert.deepEqual(event.practiceQuestions, snapshot.practiceQuestions);
  assert.deepEqual(workspace.questions, snapshot.questions);
  assert.deepEqual(workspace.practiceQuestions, snapshot.practiceQuestions);
  const feedback = workspace.plan.steps.find((entry) => entry.tool === 'feedback');
  assert.equal(feedback.questionId, 'practice-1');
  assert.equal(feedback.quizView, 'practice');
  assert.equal(workspace.plan.evidence.failed, false);
  assert.equal(workspace.plan.evidence.pending, false);
  assert.ok(
    workspace.plan.presentation.alternatives.some((entry) => entry.id === 'direct-selftest'),
  );
});

test('without formal questions, real practice and exploration resources still yield a practice entry', async () => {
  for (const assessmentRole of ['practice', 'exploration']) {
    const response = layeredQuestionsResponse([assessmentRole]);
    const h = harness({
      callApi: async (url) =>
        url.endsWith('/questions')
          ? response
          : { attempts: [], documentVersion: response.documentVersion },
    });
    const workspace = attachWorkspaceRecommendations(h);
    await h.load();
    await tick();
    assert.equal(workspace.questions.length, 0);
    assert.equal(workspace.practiceQuestions.length, 1);
    const entry = workspace.plan.presentation.alternatives.find(
      (item) => item.id === 'direct-practice',
    );
    assert.ok(entry, `A real ${assessmentRole} resource has a practice entry`);
    assert.equal(entry.questionId, `${assessmentRole}-0`);
    assert.equal(entry.quizView, 'practice');
    assert.equal(
      workspace.plan.presentation.alternatives.some((item) => item.id === 'direct-selftest'),
      false,
    );
    h.controller.selectView(entry.quizView, {
      assessmentRole: assessmentRole === 'exploration' ? 'exploration' : '',
    });
    const forms = h.elements.get('learning-quiz-list').querySelectorAll('form');
    assert.equal(forms.length, 1);
    assert.equal(
      h.elements.get('learning-quiz-list').querySelectorAll('[data-question-id]')[0].dataset
        .questionId,
      entry.questionId,
    );
  }
});
test('latest private records use monotonic IDs and completed corrections remove old mistakes', () => {
  const records = [attempt({ id: '2', verdict: 'pass', score: 1 }), attempt()];
  assert.equal(latestAttempts(records).get('q1').id, '2');
  assert.equal(isMistake(latestAttempts(records).get('q1')), false);
  assert.equal(isMistake(attempt({ status: 'pending_review', score: null, verdict: null })), false);
  assert.equal(isMistake(attempt({ verdict: 'pass', score: 3, maxScore: 5, passScore: 3 })), false);
});
test('pending, practice-only and historical-version results never claim a current formal pass', () => {
  assert.match(
    resultLabel(attempt({ status: 'pending_review', score: null, verdict: null }), 'current'),
    /待课程组复核/,
  );
  assert.match(
    resultLabel(attempt({ official: false, verdict: 'practice_only', score: 1 }), 'current'),
    /不计入正式测评/,
  );
  assert.match(
    resultLabel(attempt({ verdict: 'pass', score: 1, documentVersion: 'old' }), 'current'),
    /历史版本/,
  );
  assert.match(resultLabel(attempt({ verdict: 'pass', score: 1 }), 'current'), /本题通过/);
});
test('historical failed records only display correction when latest same-version record passed', () => {
  const passed = attempt({ id: '2', verdict: 'pass', score: 1 });
  assert.match(resultLabel(attempt(), 'current', passed), /历史作答 · 已有订正记录/);
  assert.doesNotMatch(
    resultLabel(attempt(), 'current', { ...passed, documentVersion: 'old' }),
    /已有订正记录/,
  );
  assert.doesNotMatch(
    resultLabel(attempt(), 'current', { ...passed, questionVersion: '2' }),
    /已有订正记录/,
  );
});
test('formal and practice records have separate latest states, with version checks after latest selection', () => {
  const failed = attempt();
  const practicePassed = attempt({
    id: '2',
    official: false,
    verdict: 'practice_only',
    score: 1,
  });
  assert.equal(
    currentQuestionAttempts([practicePassed, failed], [question()], 'current').get('q1').id,
    '1',
  );
  assert.equal(currentQuestionAttempts([practicePassed], [question()], 'current').size, 0);
  for (const newer of [
    attempt({ id: '3', documentVersion: 'new-version' }),
    attempt({ id: '3', questionVersion: 'new-question-version' }),
  ])
    assert.equal(
      currentQuestionAttempts([newer, practicePassed, failed], [question()], 'current').size,
      0,
    );
  const passed = attempt({ id: '3', verdict: 'pass', score: 1 });
  assert.equal(
    isMistake(
      currentQuestionAttempts([passed, practicePassed, failed], [question()], 'current').get('q1'),
    ),
    false,
  );
  const practiceQuestion = { ...question(), official: false };
  assert.equal(
    currentQuestionAttempts([practicePassed, failed], [practiceQuestion], 'current').get('q1').id,
    '2',
  );
});
test('legacy course-template exercises display as practice and hide reference details from the prompt', () => {
  const markdown = fs.readFileSync(
    path.join(__dirname, '../docs/course-authoring/examples/知识点/SS-01-01.md'),
    'utf8',
  );
  const questions = legacyPractice(markdown);
  assert.equal(questions[0].id, 'SS-01-01-Q01');
  assert.equal(questions[0].official, false);
  assert.match(questions[0].prompt, /零状态输出/);
  assert.doesNotMatch(questions[0].prompt, /参考解答/);
  assert.equal(legacyPractice('```freebbs-quiz\n{"answer":"SECRET"}\n```').length, 0);
});
test('DOM uses the existing sanitized Markdown renderer for rich question content and text nodes for metadata', async () => {
  const h = harness();
  await h.load();
  await tick();
  const list = h.elements.get('learning-quiz-list');
  assert.match(list.textContent, /<svg onload=alert\(2\)>/);
  const prompt = list.children[0].children.find((node) =>
    node.className.includes('learning-quiz-prompt'),
  );
  assert.equal(prompt.innerHTML, escape(question().prompt));
  assert.doesNotMatch(prompt.innerHTML, /<img/);
  assert.ok(h.renders.includes('<script>alert(3)</script>') === false);
  assert.ok(h.renders.some((value) => value.includes('<script>alert(3)</script>')));
  assert.equal(h.events.at(-1).documentVersion, 'current');
});
test('guest can read template exercises, has no private results and makes no assessment API requests', async () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../docs/course-authoring/examples/知识点/SS-01-01.md'),
    'utf8',
  );
  const h = harness({ loggedIn: false });
  await h.load(source);
  await tick();
  h.controller.selectView('practice');
  assert.equal(h.requests.length, 0);
  assert.match(h.elements.get('learning-quiz-list').textContent, /SS-01-01-Q01/);
  assert.equal(h.elements.get('learning-quiz-list').querySelectorAll('button')[0].disabled, true);
  assert.equal(h.controller.getSnapshot().attempts.length, 0);
});

test('authentication restoration before knowledge context does not emit an incomplete assessment event', async () => {
  const h = harness({ loggedIn: false });
  h.app.userState = { uid: 'student', token: 'student-token', isLoggedIn: true };
  await h.browser.dispatchEvent({ type: 'freebbs:session-change' });
  assert.equal(h.events.length, 0);
  await h.load();
  await tick();
  assert.equal(h.events.at(-1).documentVersion, 'current');
});
test('assessment update waits until peer modules receive the knowledge context', async () => {
  const h = harness();
  let peerReady = false;
  h.page.addEventListener('knowledge:loaded', () => {
    peerReady = true;
  });
  h.page.addEventListener('knowledge:assessment-updated', () => {
    assert.equal(peerReady, true);
  });
  await h.load();
  await tick();
  assert.ok(h.events.length > 0);
});
test('submission uses server grading, UUID intent and emits versioned update event', async () => {
  const h = harness();
  await h.load();
  await tick();
  const form = h.elements.get('learning-quiz-list').querySelectorAll('form')[0];
  const controls = form.querySelectorAll('input');
  controls[0].checked = true;
  await form.dispatchEvent({ type: 'submit', preventDefault() {} });
  const submitted = h.requests.find((request) => request.options.method === 'POST');
  const body = JSON.parse(submitted.options.body);
  assert.equal(body.questionId, 'q1');
  assert.equal(body.answer, 'A');
  assert.equal(body.mode, 'selftest');
  assert.match(body.requestKey, /^[0-9a-f-]{36}$/);
  assert.equal(body.score, undefined);
  assert.equal(h.events.at(-1).attempts[0].verdict, 'pass');
  assert.equal(h.events.at(-1).documentVersion, 'current');
  assert.match(h.elements.get('learning-quiz-results').textContent, /本题通过/);
});
test('failed save preserves answer and repeats the same request intent on retry', async () => {
  let failure = true;
  const h = harness({
    callApi: async (url, options) => {
      if (url.endsWith('/questions'))
        return { questions: [question()], practiceQuestions: [], documentVersion: 'current' };
      if (options.method === 'GET') return { attempts: [], documentVersion: 'current' };
      if (failure) throw new Error('网络连接中断');
      return {
        attempt: attempt({ score: 1, verdict: 'pass', answer: 'A' }),
        documentVersion: 'current',
      };
    },
  });
  await h.load();
  await tick();
  const form = h.elements.get('learning-quiz-list').querySelectorAll('form')[0];
  form.querySelectorAll('input')[0].checked = true;
  await form.dispatchEvent({ type: 'submit', preventDefault() {} });
  assert.match(form.textContent, /输入已保留/);
  assert.equal(form.querySelectorAll('input')[0].checked, true);
  failure = false;
  await form.dispatchEvent({ type: 'submit', preventDefault() {} });
  const bodies = h.requests
    .filter((request) => request.options.method === 'POST')
    .map((request) => JSON.parse(request.options.body));
  assert.equal(bodies[0].requestKey, bodies[1].requestKey);
});
test('changing accounts clears drafts and late responses cannot restore prior user answers', async () => {
  const pending = deferred();
  const h = harness({
    callApi: async (url) =>
      url.endsWith('/questions')
        ? { questions: [question()], practiceQuestions: [], documentVersion: 'current' }
        : pending.promise,
  });
  await h.load();
  await tick();
  h.app.userState = { uid: 'another', token: '', isLoggedIn: false };
  await h.browser.dispatchEvent({ type: 'freebbs:session-change' });
  pending.resolve({
    attempts: [attempt({ answer: 'PRIVATE FROM OLD USER' })],
    documentVersion: 'current',
  });
  await tick();
  assert.equal(h.controller.getSnapshot().attempts.length, 0);
  assert.doesNotMatch(h.elements.get('learning-quiz-results').textContent, /PRIVATE FROM OLD USER/);
});
test('mistake resubmission links only a new private correction and removes the resolved question', async () => {
  const h = harness({
    callApi: async (url, options) => {
      if (url.endsWith('/questions'))
        return { questions: [question()], practiceQuestions: [], documentVersion: 'current' };
      if (options.method === 'GET') return { attempts: [attempt()], documentVersion: 'current' };
      return {
        attempt: attempt({
          id: '2',
          verdict: 'pass',
          score: 1,
          answer: 'A',
          supersedesAttemptId: '1',
        }),
        documentVersion: 'current',
      };
    },
  });
  await h.load();
  await tick();
  h.controller.selectView('mistakes');
  const form = h.elements.get('learning-quiz-list').querySelectorAll('form')[0];
  const controls = form.querySelectorAll('input');
  controls[0].checked = true;
  controls[1].checked = false;
  await form.dispatchEvent({ type: 'submit', preventDefault() {} });
  const body = JSON.parse(
    h.requests.find((request) => request.options.method === 'POST').options.body,
  );
  assert.equal(body.supersedesAttemptId, '1');
  assert.equal(h.controller.getSnapshot().attempts.length, 2);
  assert.match(h.elements.get('learning-quiz-list').textContent, /暂时没有/);
});
test('a later practice pass neither removes a formal mistake nor claims formal success', async () => {
  const practicePassed = attempt({
    id: '2',
    official: false,
    verdict: 'practice_only',
    score: 1,
    answer: 'A',
  });
  const h = harness({
    callApi: async (url, options) => {
      if (url.endsWith('/questions'))
        return { questions: [question()], practiceQuestions: [], documentVersion: 'current' };
      if (options.method === 'GET')
        return { attempts: [practicePassed, attempt()], documentVersion: 'current' };
      return {
        attempt: attempt({
          id: '3',
          verdict: 'pass',
          score: 1,
          answer: 'A',
          supersedesAttemptId: '1',
        }),
        documentVersion: 'current',
      };
    },
  });
  await h.load();
  await tick();
  assert.doesNotMatch(h.elements.get('learning-quiz-results').textContent, /本题通过/);
  assert.match(h.elements.get('learning-quiz-results').textContent, /练习反馈/);
  assert.match(h.elements.get('learning-quiz-results').textContent, /本题尚未通过/);
  h.controller.selectView('mistakes');
  const form = h.elements.get('learning-quiz-list').querySelectorAll('form')[0];
  assert.ok(form);
  const controls = form.querySelectorAll('input');
  controls[0].checked = true;
  controls[1].checked = false;
  await form.dispatchEvent({ type: 'submit', preventDefault() {} });
  const body = JSON.parse(
    h.requests.find((request) => request.options.method === 'POST').options.body,
  );
  assert.equal(body.mode, 'selftest');
  assert.equal(body.supersedesAttemptId, '1');
  assert.match(h.elements.get('learning-quiz-list').textContent, /暂时没有/);
  assert.match(h.elements.get('learning-quiz-results').textContent, /本题通过/);
});
test('newer official snapshots from another version do not revive an older current-version mistake', async () => {
  const h = harness({
    callApi: async (url) =>
      url.endsWith('/questions')
        ? { questions: [question()], practiceQuestions: [], documentVersion: 'current' }
        : {
            attempts: [attempt({ id: '2', documentVersion: 'new-version' }), attempt()],
            documentVersion: 'current',
          },
  });
  await h.load();
  await tick();
  h.controller.selectView('mistakes');
  assert.equal(h.elements.get('learning-quiz-list').querySelectorAll('form').length, 0);
  assert.equal(h.elements.get('learning-quiz-results').querySelectorAll('button').length, 0);
});
test('earlier private results can be loaded without overriding a newer corrected answer', async () => {
  const h = harness({
    callApi: async (url) => {
      if (url.endsWith('/questions'))
        return { questions: [question()], practiceQuestions: [], documentVersion: 'current' };
      if (url.includes('?before='))
        return { attempts: [attempt()], nextCursor: null, documentVersion: 'current' };
      return {
        attempts: [attempt({ id: '2', verdict: 'pass', score: 1 })],
        nextCursor: '2',
        documentVersion: 'current',
      };
    },
  });
  await h.load();
  await tick();
  const button = h.elements
    .get('learning-quiz-results')
    .querySelectorAll('button')
    .find((node) => node.textContent.includes('加载更早'));
  assert.ok(button);
  await button.dispatchEvent({ type: 'click' });
  assert.equal(h.controller.getSnapshot().attempts.length, 2);
  h.controller.selectView('mistakes');
  assert.match(h.elements.get('learning-quiz-list').textContent, /暂时没有/);
  assert.ok(h.requests.some((request) => request.url.includes('before=2')));
});

test('assessment runtime stores no grades in browser storage and creates no independent AI scoring call', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/learning-assessment.js'), 'utf8');
  assert.doesNotMatch(
    source,
    /localStorage\.setItem|sessionStorage\.setItem|streamAi|eval\(|new Function/,
  );
  assert.match(source, /knowledge:assessment-updated/);
  assert.match(source, /freebbs:session-change/);
});
