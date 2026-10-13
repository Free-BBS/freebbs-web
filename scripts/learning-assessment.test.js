const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const answerDrafts = require('../public/learning-answer-drafts');
const { parseAssessmentMarkdown, toPublicQuestion } = require('../backend/learning-assessment');
const { recommend } = require('../public/learning-next-steps');
const {
  viewLabels,
  latestAttempts,
  currentQuestionAttempts,
  mergeCurrentAttempts,
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
    this.parentElement = null;
    this.ownerDocument = null;
    this.connectedRoot = false;
    this.detachments = 0;
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this.selectionDirection = 'none';
    const classes = new Set();
    this.classList = {
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
    };
  }

  set textContent(value) {
    this.replaceChildren();
    this.text = String(value);
  }

  get textContent() {
    return this.text + this.children.map((child) => child.textContent).join('');
  }

  set innerHTML(value) {
    this.replaceChildren();
    this.html = value;
  }

  get innerHTML() {
    return this.html || '';
  }

  append(...children) {
    children.forEach((child) => this.insertBefore(child, null));
  }

  get isConnected() {
    return this.connectedRoot || Boolean(this.parentElement?.isConnected);
  }

  get firstElementChild() {
    return this.children[0] || null;
  }

  get nextElementSibling() {
    if (!this.parentElement) return null;
    const siblings = this.parentElement.children;
    return siblings[siblings.indexOf(this) + 1] || null;
  }

  contains(node) {
    return this === node || this.children.some((child) => child.contains(node));
  }

  insertBefore(child, reference) {
    if (child === reference) return child;
    if (child.parentElement) child.remove();
    const index = reference ? this.children.indexOf(reference) : this.children.length;
    assert.ok(index >= 0, 'Reference belongs to this parent');
    const bind = (node) => {
      node.ownerDocument = this.ownerDocument;
      node.children.forEach(bind);
    };
    bind(child);
    child.parentElement = this;
    this.children.splice(index, 0, child);
    return child;
  }

  remove() {
    if (!this.parentElement) return;
    if (this.isConnected) {
      const detached = (node) => {
        node.detachments += 1;
        node.children.forEach(detached);
      };
      detached(this);
      if (this.contains(this.ownerDocument?.activeElement)) this.ownerDocument.activeElement = null;
    }
    const siblings = this.parentElement.children;
    siblings.splice(siblings.indexOf(this), 1);
    this.parentElement = null;
  }

  replaceChildren(...children) {
    [...this.children].forEach((child) => child.remove());
    this.text = '';
    this.html = '';
    this.append(...children);
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
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
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
function draftStorage() {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}
const ownerDigest = (value) => crypto.createHash('sha256').update(value).digest('hex');
function harness({
  loggedIn = true,
  callApi,
  draftSessionStorage,
  draftDigest = ownerDigest,
} = {}) {
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
    activeElement: null,
  };
  for (const root of elements.values()) {
    root.connectedRoot = true;
    const bind = (node) => {
      node.ownerDocument = document;
      node.children.forEach(bind);
    };
    bind(root);
  }
  const browser = new Element();
  browser.CustomEvent = function CustomEvent(type, options) {
    this.type = type;
    this.detail = options.detail;
  };
  browser.crypto = crypto;
  if (draftSessionStorage)
    browser.FreeBbsLearningAnswerDrafts = {
      createDraftStore: (options) =>
        answerDrafts.createDraftStore({
          ...options,
          storage: draftSessionStorage,
          digest: draftDigest,
        }),
    };
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
  return { elements, page, browser, document, app, controller, requests, renders, events, load };
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
test('pending labels distinguish known old body or question versions without inventing missing versions', () => {
  const pending = attempt({ status: 'pending_review', verdict: null, score: null });
  assert.equal(resultLabel(pending, 'current', null, '1'), '待课程组复核');
  for (const older of [
    { ...pending, documentVersion: 'old-body' },
    { ...pending, questionVersion: 'old-question' },
  ])
    assert.equal(resultLabel(older, 'current', null, '1'), '历史版本待复核，结果不计本版');
  for (const missing of [
    { ...pending, documentVersion: undefined },
    { ...pending, questionVersion: null },
    { ...pending, questionVersion: '   ' },
  ]) {
    assert.match(resultLabel(missing, 'current', null, '1'), /提交时版本未完整记录/);
    assert.doesNotMatch(resultLabel(missing, 'current', null, '1'), /历史版本|本题通过/);
  }
  assert.equal(resultLabel(pending, '', null, null), '待课程组复核');
});
test('student and teacher pending cards label old versions and expose only saved scoring, preserving zero and missing fields', async () => {
  const pending = { status: 'pending_review', verdict: null, score: null, userId: 'fixture-owner' };
  const records = [
    attempt({
      ...pending,
      id: '1',
      documentVersion: 'old-body',
      maxScore: 5,
      passScore: 3,
      gradingBasis: 'SAVED OLD RUBRIC',
      snapshotAvailability: 'available',
      questionSnapshot: {
        id: 'q1',
        type: 'short_answer',
        prompt: 'SAVED OLD PROMPT',
        questionVersion: '1',
      },
    }),
    attempt({ ...pending, id: '2', questionVersion: 'old-question', maxScore: 8, passScore: 4 }),
    attempt({ ...pending, id: '3', maxScore: 0, passScore: 0 }),
    attempt({
      ...pending,
      id: '4',
      documentVersion: undefined,
      questionVersion: null,
      maxScore: 8,
      passScore: null,
    }),
    attempt({ ...pending, id: '5', maxScore: 7, passScore: undefined }),
  ];
  for (const teacher of [false, true]) {
    const h = harness({
      callApi: async (url) => {
        if (url.endsWith('/questions'))
          return {
            questions: [
              { ...question(), scoring: { method: 'exact', maxScore: 100, passScore: 90 } },
            ],
            practiceQuestions: [],
            documentVersion: 'current',
            questionVersion: '1',
            canReview: teacher,
          };
        return { attempts: records, currentAttempts: records, documentVersion: 'current' };
      },
    });
    await h.load();
    await tick();
    const results = h.elements.get('learning-quiz-results');
    if (teacher) {
      await results
        .querySelectorAll('button')
        .find((button) => button.textContent.includes('查看待复核'))
        .dispatchEvent({ type: 'click' });
    }
    const cards = results
      .querySelectorAll('details')
      .filter(
        (card) =>
          card.dataset.attemptId && Boolean(card.querySelectorAll('form').length) === teacher,
      );
    assert.equal(cards.length, records.length);
    for (const card of cards) {
      assert.match(card.textContent, teacher ? /学生作答：/ : /我的作答：/);
      assert.doesNotMatch(card.textContent, teacher ? /我的作答：/ : /学生作答：/);
    }
    for (const id of ['1', '2'])
      assert.match(
        cards.find((card) => card.dataset.attemptId === id).querySelectorAll('summary')[0]
          .textContent,
        /历史版本待复核，结果不计本版/,
      );
    assert.equal(
      cards.find((card) => card.dataset.attemptId === '3').querySelectorAll('summary')[0]
        .textContent,
      'q1 · 待课程组复核',
    );
    assert.match(
      cards.find((card) => card.dataset.attemptId === '4').textContent,
      /版本未完整记录/,
    );
    assert.doesNotMatch(
      cards.find((card) => card.dataset.attemptId === '4').textContent,
      /提交时题目版本 1|历史版本待复核/,
    );
    if (teacher) {
      const old = cards.find((card) => card.dataset.attemptId === '1');
      assert.match(old.textContent, /满分 5 · 通过阈值 3/);
      assert.match(old.textContent, /SAVED OLD RUBRIC|SAVED OLD PROMPT/);
      assert.doesNotMatch(old.textContent, /满分 100|通过阈值 90/);
      const zero = cards.find((card) => card.dataset.attemptId === '3');
      assert.match(zero.textContent, /满分 0 · 通过阈值 0/);
      assert.equal(zero.querySelectorAll('input')[0].max, '0');
      for (const id of ['4', '5']) {
        const missing = cards.find((card) => card.dataset.attemptId === id);
        assert.match(missing.textContent, /通过阈值 未记录/);
        assert.doesNotMatch(missing.textContent, /0–undefined|0–null|满分 0|通过阈值 0/);
        assert.equal(missing.querySelectorAll('input')[0].max, id === '4' ? '8' : '7');
        assert.equal(missing.querySelectorAll('button').at(-1).disabled, false);
      }
    }
  }
});
test('missing or invalid saved full scores retain the existing explicit queue error instead of inventing current scoring', async () => {
  for (const maxScore of [undefined, null, '99']) {
    const h = harness({
      callApi: async (url) => {
        if (url.endsWith('/questions'))
          return {
            questions: [question()],
            practiceQuestions: [],
            documentVersion: 'current',
            canReview: true,
          };
        if (url.includes('review=pending'))
          return {
            attempts: [
              attempt({
                userId: 'fixture-owner',
                status: 'pending_review',
                verdict: null,
                score: null,
                maxScore,
              }),
            ],
          };
        return { attempts: [], currentAttempts: [] };
      },
    });
    await h.load();
    await tick();
    const results = h.elements.get('learning-quiz-results');
    await results
      .querySelectorAll('button')
      .find((button) => button.textContent.includes('查看待复核'))
      .dispatchEvent({ type: 'click' });
    assert.match(results.textContent, /待复核响应格式不完整/);
    assert.equal(results.querySelectorAll('form').length, 0);
    assert.doesNotMatch(results.textContent, /提交时评分：满分 0|复核分数（0–1）/);
  }
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

test('Max help carries only the actively selected question and current answer into an editable draft', async () => {
  for (const type of ['single_choice', 'multiple_choice', 'numeric', 'short_answer']) {
    const activeQuestion = {
      ...question(),
      type,
      ...(type === 'numeric' || type === 'short_answer' ? { options: undefined } : {}),
    };
    const h = harness({
      callApi: async (url) =>
        url.endsWith('/questions')
          ? { questions: [activeQuestion], practiceQuestions: [], documentVersion: 'current' }
          : { attempts: [attempt({ answer: 'PRIVATE HISTORICAL ANSWER' })] },
    });
    const opened = [];
    h.page.addEventListener('knowledge:task-focus', (event) => opened.push(event));
    h.page.addEventListener('knowledge:open-interaction', (event) => opened.push(event));
    await h.load();
    await tick();
    const form = h.elements.get('learning-quiz-list').querySelectorAll('form')[0];
    const help = form.querySelectorAll('button').find((node) => node.className.includes('ask-max'));
    assert.ok(help);
    assert.equal(help.type, 'button');
    if (activeQuestion.options) {
      const controls = form.querySelectorAll('input');
      controls[0].checked = true;
      if (type === 'multiple_choice') controls[1].checked = true;
    } else {
      const control = form.querySelectorAll(type === 'short_answer' ? 'textarea' : 'input')[0];
      control.value = type === 'numeric' ? '2e-3' : '我先检查零状态条件，再计算卷积积分。';
    }
    assert.equal(opened.length, 0);
    const requestCount = h.requests.length;
    await help.dispatchEvent({ type: 'click' });
    assert.deepEqual(
      opened.map((event) => event.type),
      ['knowledge:task-focus', 'knowledge:open-interaction'],
    );
    assert.deepEqual(opened[0].detail, {
      tool: 'feedback',
      quizView: 'quick',
      questionId: 'q1',
    });
    assert.equal(opened[1].detail.tab, 'max');
    const { prompt } = opened[1].detail;
    assert.match(prompt, /q1/);
    assert.match(prompt, /检查思路和条件/);
    assert.doesNotMatch(prompt, /PRIVATE HISTORICAL ANSWER|判定依据|本题通过/);
    if (activeQuestion.options) {
      assert.match(prompt, /A\. 正确选项/);
      if (type === 'multiple_choice') assert.match(prompt, /B\./);
      else assert.doesNotMatch(prompt, /B\./);
    } else assert.match(prompt, type === 'numeric' ? /2e-3/ : /检查零状态条件/);
    assert.equal(h.requests.length, requestCount, 'Opening a draft makes no model or grading call');
    assert.equal(h.controller.getSnapshot().attempts.length, 1);
    assert.match(form.textContent, /可编辑后发送/);
  }
});

test('empty answers request a hint and stale account controls cannot disclose an old draft', async () => {
  const h = harness();
  const opened = [];
  h.page.addEventListener('knowledge:open-interaction', (event) => opened.push(event.detail));
  await h.load();
  await tick();
  h.controller.selectView('practice');
  const form = h.elements.get('learning-quiz-list').querySelectorAll('form')[0];
  const help = form.querySelectorAll('button').find((node) => node.className.includes('ask-max'));
  await help.dispatchEvent({ type: 'click' });
  assert.match(opened[0].prompt, /还没开始作答.*起步提示/);
  assert.equal(
    form.querySelectorAll('input').some((control) => control.checked),
    false,
  );
  assert.equal(
    h.requests.some((request) => request.options.method === 'POST'),
    false,
  );
  form.querySelectorAll('input')[0].checked = true;
  h.app.userState = { uid: 'another', token: 'another-token', isLoggedIn: true };
  await h.browser.dispatchEvent({ type: 'freebbs:session-change' });
  await tick();
  await help.dispatchEvent({ type: 'click' });
  assert.equal(opened.length, 1);
});

test('focusing a question sets only its identity for Max without sharing answers or opening chat', async () => {
  const h = harness();
  const focused = [];
  const opened = [];
  h.page.addEventListener('knowledge:task-focus', (event) => focused.push(event.detail));
  h.page.addEventListener('knowledge:open-interaction', (event) => opened.push(event.detail));
  await h.load();
  await tick();
  const form = firstForm(h);
  form.querySelectorAll('input')[0].checked = true;
  await form.dispatchEvent({ type: 'focusin' });
  assert.deepEqual(focused, [{ tool: 'feedback', quizView: 'quick', questionId: 'q1' }]);
  assert.equal(opened.length, 0);
  assert.equal(
    h.requests.some((request) => request.options.method === 'POST'),
    false,
  );
});

test('long actively supplied thoughts are clearly excerpted within the knowledge chat request limit', async () => {
  const h = harness({
    callApi: async (url) =>
      url.endsWith('/questions')
        ? {
            questions: [{ ...question(), type: 'short_answer', options: undefined }],
            practiceQuestions: [],
            documentVersion: 'current',
          }
        : { attempts: [] },
  });
  let opened;
  h.page.addEventListener('knowledge:open-interaction', (event) => {
    opened = event.detail;
  });
  await h.load();
  await tick();
  const form = h.elements.get('learning-quiz-list').querySelectorAll('form')[0];
  const control = form.querySelectorAll('textarea')[0];
  control.value = '思'.repeat(8000);
  const help = form.querySelectorAll('button').find((node) => node.className.includes('ask-max'));
  await help.dispatchEvent({ type: 'click' });
  assert.match(opened.prompt, /作答节选，可在发送前修改/);
  assert.ok(opened.prompt.length < 4000);
  assert.equal(control.value.length, 8000);
});

test('retesting keeps old answers folded and blank inputs while formal scope and scoring remain inspectable', async () => {
  const h = harness({
    callApi: async (url) =>
      url.endsWith('/questions')
        ? {
            questions: [
              { ...question(), difficulty: 'basic', learningObjective: '核对适用条件' },
              { ...question(), id: 'challenge', difficulty: 'challenge' },
            ],
            practiceQuestions: [],
            documentVersion: 'current',
          }
        : { attempts: [attempt({ referenceMarkdown: 'PRIVATE REFERENCE' })] },
  });
  await h.load();
  await tick();
  const list = h.elements.get('learning-quiz-list');
  assert.equal(list.querySelectorAll('form').length, 2);
  const metadata = list.querySelectorAll('details')[0];
  assert.equal(Boolean(metadata.open), false);
  assert.match(metadata.textContent, /核对适用条件|正式通过标准 1 分/);
  assert.match(metadata.textContent, /来源.*版本/);
  const result = h.elements
    .get('learning-quiz-results')
    .querySelectorAll('details')
    .find((node) => node.dataset.attemptId);
  assert.equal(result.open, false);
  assert.equal(result.children[0].tag, 'summary');
  assert.doesNotMatch(result.children[0].textContent, /我的作答|PRIVATE REFERENCE|判定依据/);
  assert.match(result.textContent, /我的作答：B|PRIVATE REFERENCE/);
  h.controller.selectView('mistakes');
  const form = list.querySelectorAll('form')[0];
  assert.equal(
    form.querySelectorAll('input').some((control) => control.checked),
    false,
  );
  assert.equal(h.controller.getSnapshot().questions.length, 2);
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
    currentAttempts: [attempt({ answer: 'PRIVATE FROM OLD USER' })],
    documentVersion: 'current',
  });
  await tick();
  assert.equal(h.controller.getSnapshot().attempts.length, 0);
  assert.deepEqual(h.controller.getSnapshot().currentAttempts, []);
  assert.equal(h.controller.getSnapshot().currentAttemptsComplete, false);
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

test('authoritative current summary restores a buried mistake and workspace recommendation without loading all history', async () => {
  const history = Array.from({ length: 50 }, (_, index) =>
    attempt({ id: String(252 - index), verdict: 'pass', score: 1 }),
  );
  const buried = attempt({ id: '2', questionId: 'q2' });
  const all = [question(), { ...question(), id: 'q2' }];
  const h = harness({
    callApi: async (url) => {
      if (url.endsWith('/questions'))
        return { questions: all, practiceQuestions: [], documentVersion: 'current' };
      if (url.includes('?before='))
        return {
          attempts: [attempt({ id: '1', questionId: 'q2', verdict: 'pass', score: 1 })],
          nextCursor: null,
          documentVersion: 'current',
        };
      return {
        attempts: history,
        currentAttempts: [history[0], buried],
        nextCursor: '203',
        documentVersion: 'current',
      };
    },
  });
  const workspace = attachWorkspaceRecommendations(h);
  await h.load();
  await tick();
  const snapshot = h.controller.getSnapshot();
  assert.equal(snapshot.attempts.length, 50);
  assert.equal(snapshot.currentAttempts.length, 2);
  assert.equal(snapshot.currentAttemptsComplete, true);
  assert.equal(h.events.at(-1).currentAttemptsComplete, true);
  assert.equal(h.requests.length, 2, 'Only initial questions and history/summary GETs are made');
  assert.equal(workspace.attempts.length, 50);
  assert.equal(workspace.currentAttempts.length, 2);
  assert.equal(workspace.plan.evidence.failed, true);
  h.controller.selectView('mistakes');
  assert.deepEqual(
    h.elements
      .get('learning-quiz-list')
      .querySelectorAll('[data-question-id]')
      .map((node) => node.dataset.questionId),
    ['q2'],
  );
  assert.equal(
    h.elements.get('learning-quiz-results').querySelectorAll('[data-question-id]').length,
    0,
  );
  const more = h.elements
    .get('learning-quiz-results')
    .querySelectorAll('button')
    .find((node) => node.textContent.includes('加载更早'));
  await more.dispatchEvent({ type: 'click' });
  assert.equal(h.controller.getSnapshot().attempts.length, 51);
  assert.deepEqual(
    h.controller
      .getSnapshot()
      .currentAttempts.map((entry) => entry.id)
      .sort(),
    ['2', '252'],
  );
  assert.equal(workspace.plan.evidence.failed, true);
  assert.deepEqual(
    h.elements
      .get('learning-quiz-list')
      .querySelectorAll('[data-question-id]')
      .map((node) => node.dataset.questionId),
    ['q2'],
  );
});

test('an empty authoritative summary overrides old history while an older server retains its explicit loaded-history fallback', async () => {
  for (const authoritative of [true, false]) {
    const h = harness({
      callApi: async (url) =>
        url.endsWith('/questions')
          ? { questions: [question()], practiceQuestions: [], documentVersion: 'current' }
          : {
              attempts: [attempt()],
              ...(authoritative ? { currentAttempts: [] } : {}),
              documentVersion: 'current',
            },
    });
    const workspace = attachWorkspaceRecommendations(h);
    await h.load();
    await tick();
    h.controller.selectView('mistakes');
    assert.equal(h.controller.getSnapshot().attempts.length, 1);
    assert.equal(h.controller.getSnapshot().currentAttemptsComplete, authoritative);
    assert.equal(h.controller.getSnapshot().currentAttempts.length, authoritative ? 0 : 1);
    assert.equal(workspace.plan.evidence.failed, !authoritative);
    assert.equal(
      h.elements.get('learning-quiz-list').querySelectorAll('form').length,
      authoritative ? 0 : 1,
    );
  }
});

test('all current formal passes remain complete when the entire history page contains only newer practice', async () => {
  const formal = [
    attempt({ id: '1', verdict: 'pass', score: 1 }),
    attempt({ id: '2', questionId: 'q2', verdict: 'pass', score: 1 }),
  ];
  const history = Array.from({ length: 50 }, (_, index) =>
    attempt({ id: String(203 - index), official: false, verdict: 'practice_only', score: 1 }),
  );
  const h = harness({
    callApi: async (url) =>
      url.endsWith('/questions')
        ? {
            questions: [question(), { ...question(), id: 'q2' }],
            practiceQuestions: [],
            documentVersion: 'current',
          }
        : {
            attempts: history,
            currentAttempts: [...formal, history[0]],
            nextCursor: '154',
            documentVersion: 'current',
          },
  });
  await h.load();
  await tick();
  const snapshot = h.controller.getSnapshot();
  assert.equal(
    currentQuestionAttempts(snapshot.currentAttempts, snapshot.questions, snapshot.documentVersion)
      .size,
    2,
  );
  const plan = recommend({
    node: { id: 'SS-01-01', markdown: '# 正文' },
    documentVersion: snapshot.documentVersion,
    questions: snapshot.questions,
    recentAttempts: snapshot.attempts,
    currentAttempts: snapshot.currentAttempts,
    map: { nodes: [{ id: 'SS-01-01' }, { id: 'SS-01-02', title: '下一知识点' }], edges: [] },
  });
  assert.equal(plan.mode, 'advance');
  assert.ok(plan.steps.some((step) => step.point === 'SS-01-02'));
  h.controller.selectView('mistakes');
  assert.equal(h.elements.get('learning-quiz-list').querySelectorAll('form').length, 0);
  assert.equal(h.controller.getSnapshot().attempts.length, 50);
  assert.equal(h.requests.length, 2);
});

test('current summary version compatibility is checked after latest selection and never revived from history', async () => {
  for (const newer of [
    attempt({ id: '2', documentVersion: 'later' }),
    attempt({ id: '2', questionVersion: '2' }),
  ]) {
    const h = harness({
      callApi: async (url) =>
        url.endsWith('/questions')
          ? { questions: [question()], practiceQuestions: [], documentVersion: 'current' }
          : { attempts: [attempt()], currentAttempts: [newer], documentVersion: 'current' },
    });
    const workspace = attachWorkspaceRecommendations(h);
    await h.load();
    await tick();
    h.controller.selectView('mistakes');
    assert.equal(h.controller.getSnapshot().currentAttempts[0].id, '2');
    assert.equal(h.elements.get('learning-quiz-list').querySelectorAll('form').length, 0);
    assert.equal(workspace.plan.evidence.failed, false);
    assert.equal(workspace.plan.evidence.pending, false);
  }
});

test('current-state merging preserves other questions and channels, large IDs, older replays and same-ID updates', () => {
  const formal = attempt({ id: '9007199254740993001' });
  const practice = attempt({
    id: '9007199254740993002',
    official: false,
    verdict: 'practice_only',
    score: 1,
  });
  const other = attempt({ id: '3', questionId: 'q2' });
  const existing = [formal, practice, other];
  const merged = mergeCurrentAttempts(existing, [
    attempt({ id: '9007199254740992999', verdict: 'pass', score: 1 }),
    { ...practice, feedback: '复核后的练习反馈' },
  ]);
  assert.equal(merged.length, 3);
  assert.equal(merged.find((entry) => entry.questionId === 'q1' && entry.official).id, formal.id);
  assert.equal(
    merged.find((entry) => entry.questionId === 'q1' && !entry.official).feedback,
    '复核后的练习反馈',
  );
  assert.equal(merged.find((entry) => entry.questionId === 'q2').id, other.id);
  assert.equal(existing[1].feedback, practice.feedback);
});

test('practice and formal submissions update their own latest channel without injecting the summary into history', async () => {
  const initial = [
    attempt({ id: '7' }),
    attempt({ id: '6', questionId: 'q2', verdict: 'pass', score: 1 }),
    attempt({ id: '9', official: false, verdict: 'practice_only', score: 1 }),
  ];
  const h = harness({
    callApi: async (url, options) => {
      if (url.endsWith('/questions'))
        return {
          questions: [question(), { ...question(), id: 'q2' }],
          practiceQuestions: [],
          documentVersion: 'current',
        };
      if (options.method === 'GET')
        return { attempts: [], currentAttempts: initial, documentVersion: 'current' };
      const body = JSON.parse(options.body);
      return {
        attempt: attempt({
          id: body.mode === 'practice' ? '10' : '11',
          answer: 'A',
          score: 1,
          official: body.mode !== 'practice',
          verdict: body.mode === 'practice' ? 'practice_only' : 'pass',
        }),
        documentVersion: 'current',
      };
    },
  });
  await h.load();
  await tick();
  assert.equal(h.controller.getSnapshot().attempts.length, 0);
  h.controller.selectView('practice');
  let form = h.elements.get('learning-quiz-list').querySelectorAll('form')[0];
  form.querySelectorAll('input')[0].checked = true;
  await form.dispatchEvent({ type: 'submit', preventDefault() {} });
  let summary = h.controller.getSnapshot().currentAttempts;
  assert.equal(summary.find((entry) => entry.questionId === 'q1' && entry.official).id, '7');
  assert.equal(summary.find((entry) => entry.questionId === 'q1' && !entry.official).id, '10');
  h.controller.selectView('quick');
  [form] = h.elements.get('learning-quiz-list').querySelectorAll('form');
  form.querySelectorAll('input')[0].checked = true;
  await form.dispatchEvent({ type: 'submit', preventDefault() {} });
  summary = h.controller.getSnapshot().currentAttempts;
  assert.equal(summary.length, 3);
  assert.equal(summary.find((entry) => entry.questionId === 'q1' && entry.official).id, '11');
  assert.equal(summary.find((entry) => entry.questionId === 'q1' && !entry.official).id, '10');
  assert.equal(summary.find((entry) => entry.questionId === 'q2').id, '6');
  assert.equal(h.controller.getSnapshot().currentAttemptsComplete, true);
  assert.equal(h.controller.getSnapshot().attempts.length, 2);
  h.controller.selectView('mistakes');
  assert.equal(h.elements.get('learning-quiz-list').querySelectorAll('form').length, 0);
  assert.deepEqual(
    h.requests
      .filter((request) => request.options.method === 'POST')
      .map((request) => JSON.parse(request.options.body).mode),
    ['practice', 'selftest'],
  );
});

test('refresh replaces the current summary, and a newer pending record cannot fall back to an earlier graded mistake', async () => {
  let summary = [attempt()];
  let version = 'current';
  const h = harness({
    callApi: async (url) =>
      url.endsWith('/questions')
        ? { questions: [question()], practiceQuestions: [], documentVersion: version }
        : { attempts: [attempt()], currentAttempts: summary, documentVersion: version },
  });
  await h.load();
  await tick();
  summary = [attempt({ id: '2', status: 'pending_review', verdict: null, score: null })];
  await h.controller.refresh();
  h.controller.selectView('mistakes');
  assert.equal(h.elements.get('learning-quiz-list').querySelectorAll('form').length, 0);
  assert.equal(h.controller.getSnapshot().currentAttempts[0].id, '2');
  summary = [];
  version = 'updated-document';
  await h.controller.refresh();
  assert.equal(h.controller.getSnapshot().documentVersion, version);
  assert.deepEqual(h.controller.getSnapshot().currentAttempts, []);
  assert.equal(h.controller.getSnapshot().currentAttemptsComplete, true);
  assert.equal(h.controller.getSnapshot().attempts.length, 1);
});

test('node changes ignore a late private submit and start a fresh authoritative summary', async () => {
  const pending = deferred();
  const h = harness({
    callApi: async (url, options) => {
      if (options.method === 'POST') return pending.promise;
      const next = url.includes('/SS-02-01/');
      if (url.endsWith('/questions'))
        return {
          questions: [{ ...question(), id: next ? 'next' : 'q1' }],
          practiceQuestions: [],
          documentVersion: 'current',
        };
      return {
        attempts: [],
        currentAttempts: next
          ? [attempt({ id: '20', questionId: 'next', verdict: 'pass', score: 1 })]
          : [],
        documentVersion: 'current',
      };
    },
  });
  await h.load();
  await tick();
  const form = h.elements.get('learning-quiz-list').querySelectorAll('form')[0];
  form.querySelectorAll('input')[0].checked = true;
  const submitting = form.dispatchEvent({ type: 'submit', preventDefault() {} });
  await tick();
  await h.page.dispatchEvent({
    type: 'knowledge:loaded',
    detail: { course: { slug: 'signals' }, node: { id: 'SS-02-01', documentVersion: 'current' } },
  });
  await tick();
  pending.resolve({
    attempt: attempt({ id: '30', answer: 'PRIVATE OLD NODE' }),
    documentVersion: 'current',
  });
  await submitting;
  await tick();
  assert.deepEqual(
    h.controller.getSnapshot().currentAttempts.map((entry) => entry.questionId),
    ['next'],
  );
  assert.deepEqual(h.controller.getSnapshot().attempts, []);
  assert.doesNotMatch(h.elements.get('learning-quiz-results').textContent, /PRIVATE OLD NODE/);
});

test('older-server manual history pagination augments only the incomplete current fallback', async () => {
  const h = harness({
    callApi: async (url) => {
      if (url.endsWith('/questions'))
        return {
          questions: [question(), { ...question(), id: 'q2' }],
          practiceQuestions: [],
          documentVersion: 'current',
        };
      if (url.includes('?before='))
        return { attempts: [attempt({ id: '1', questionId: 'q2' })], documentVersion: 'current' };
      return {
        attempts: [attempt({ id: '2', verdict: 'pass', score: 1 })],
        nextCursor: '2',
        documentVersion: 'current',
      };
    },
  });
  await h.load();
  await tick();
  assert.equal(h.controller.getSnapshot().currentAttemptsComplete, false);
  const more = h.elements
    .get('learning-quiz-results')
    .querySelectorAll('button')
    .find((node) => node.textContent.includes('加载更早'));
  await more.dispatchEvent({ type: 'click' });
  assert.equal(h.controller.getSnapshot().currentAttempts.length, 2);
  h.controller.selectView('mistakes');
  assert.deepEqual(
    h.elements
      .get('learning-quiz-list')
      .querySelectorAll('[data-question-id]')
      .map((node) => node.dataset.questionId),
    ['q2'],
  );
});

const draftDocument = 'd'.repeat(64);
function draftApi({
  documentVersion = draftDocument,
  questionVersion = '1',
  records = [],
  submit,
} = {}) {
  return async (url, options) => {
    if (url.endsWith('/questions'))
      return {
        questions: [{ ...question(), type: 'short_answer', options: undefined, questionVersion }],
        practiceQuestions: [],
        documentVersion,
      };
    if (options.method === 'GET') return { attempts: records };
    if (submit) return submit(JSON.parse(options.body));
    return {
      attempt: attempt({
        id: '3',
        answer: JSON.parse(options.body).answer,
        documentVersion,
        status: 'pending_review',
        score: null,
        verdict: null,
      }),
      documentVersion,
    };
  };
}
const firstForm = (h) => h.elements.get('learning-quiz-list').querySelectorAll('form')[0];

test('a same-session refresh restores only the current-version unsubmitted answer with a visible notice', async () => {
  const storage = draftStorage();
  const first = harness({ draftSessionStorage: storage, callApi: draftApi() });
  await first.load();
  await tick();
  const form = firstForm(first);
  form.querySelectorAll('textarea')[0].value = '我还在核对卷积积分范围';
  await form.dispatchEvent({ type: 'input' });
  const reopened = harness({ draftSessionStorage: storage, callApi: draftApi() });
  await reopened.load();
  await tick();
  assert.equal(firstForm(reopened).querySelectorAll('textarea')[0].value, '我还在核对卷积积分范围');
  assert.match(firstForm(reopened).textContent, /已恢复未提交作答/);
  assert.equal(reopened.controller.getSnapshot().attempts.length, 0);
  assert.equal(
    reopened.requests.some((request) => request.options.method === 'POST'),
    false,
  );
  reopened.controller.selectView('practice');
  assert.equal(firstForm(reopened).querySelectorAll('textarea')[0].value, '');
  reopened.controller.selectView('quick');
  assert.equal(firstForm(reopened).querySelectorAll('textarea')[0].value, '我还在核对卷积积分范围');
  for (const changed of [{ documentVersion: 'e'.repeat(64) }, { questionVersion: '2' }]) {
    const updated = harness({ draftSessionStorage: storage, callApi: draftApi(changed) });
    await updated.load();
    await tick();
    assert.equal(firstForm(updated).querySelectorAll('textarea')[0].value, '');
    assert.doesNotMatch(firstForm(updated).textContent, /已恢复未提交/);
  }
});

test('unloaded server question versions cannot restore a stored answer', async () => {
  const storage = draftStorage();
  const first = harness({ draftSessionStorage: storage, callApi: draftApi() });
  await first.load();
  await tick();
  firstForm(first).querySelectorAll('textarea')[0].value = 'VERSION-SCOPED ANSWER';
  await firstForm(first).dispatchEvent({ type: 'input' });
  const questions = deferred();
  const normal = draftApi();
  const reopened = harness({
    draftSessionStorage: storage,
    callApi: (url, options) =>
      url.endsWith('/questions') ? questions.promise : normal(url, options),
  });
  await reopened.load();
  await tick();
  assert.equal(reopened.controller.getSnapshot().loaded, false);
  assert.equal(reopened.elements.get('learning-quiz-list').querySelectorAll('form').length, 0);
  questions.resolve(await normal('/questions', { method: 'GET' }));
  await tick();
  assert.equal(firstForm(reopened).querySelectorAll('textarea')[0].value, 'VERSION-SCOPED ANSWER');
});

test('same-page server version updates do not reuse in-memory answers or failed request identities', async () => {
  for (const changed of [{ documentVersion: 'e'.repeat(64) }, { questionVersion: '2' }]) {
    let version = {};
    const h = harness({
      draftSessionStorage: draftStorage(),
      callApi: (url, options) =>
        draftApi({
          ...version,
          submit: async () => {
            throw new Error('offline');
          },
        })(url, options),
    });
    await h.load();
    await tick();
    const oldForm = firstForm(h);
    oldForm.querySelectorAll('textarea')[0].value = 'OLD VERSION THOUGHTS';
    await oldForm.dispatchEvent({ type: 'input' });
    await oldForm.dispatchEvent({ type: 'submit', preventDefault() {} });
    const firstPayload = JSON.parse(
      h.requests.find((request) => request.options.method === 'POST').options.body,
    );
    version = changed;
    await h.controller.refresh();
    await tick();
    const newForm = firstForm(h);
    assert.equal(newForm.querySelectorAll('textarea')[0].value, '');
    const before = h.requests.filter((request) => request.options.method === 'POST').length;
    await oldForm.dispatchEvent({ type: 'submit', preventDefault() {} });
    assert.equal(h.requests.filter((request) => request.options.method === 'POST').length, before);
    assert.match(oldForm.textContent, /题目或学习会话已更新/);
    newForm.querySelectorAll('textarea')[0].value = 'NEW VERSION THOUGHTS';
    await newForm.dispatchEvent({ type: 'input' });
    await newForm.dispatchEvent({ type: 'submit', preventDefault() {} });
    const secondPayload = JSON.parse(
      h.requests.filter((request) => request.options.method === 'POST').at(-1).options.body,
    );
    assert.equal(secondPayload.answer, 'NEW VERSION THOUGHTS');
    assert.equal(secondPayload.expectedDocumentVersion, changed.documentVersion || draftDocument);
    assert.notEqual(secondPayload.requestKey, firstPayload.requestKey);
  }
});

test('draft restoration waits for authenticated server questions without delaying reading or overwriting new typing', async () => {
  const storage = draftStorage();
  const seed = answerDrafts.createDraftStore({ storage, digest: ownerDigest });
  await seed.bind('student', 'student-token');
  seed.save(
    {
      courseSlug: 'signals',
      nodeId: 'SS-01-01',
      documentVersion: draftDocument,
      questionVersion: '1',
      questionId: 'q1',
      mode: 'selftest',
    },
    { answer: 'OLD THOUGHTS' },
  );
  const pending = deferred();
  const h = harness({
    draftSessionStorage: storage,
    draftDigest: () => pending.promise,
    callApi: draftApi(),
  });
  await h.load();
  await tick();
  const form = firstForm(h);
  assert.ok(form, 'Question rendering does not wait for a crypto promise');
  assert.equal(form.querySelectorAll('textarea')[0].value, '');
  form.querySelectorAll('textarea')[0].value = 'NEW THOUGHTS';
  await form.dispatchEvent({ type: 'input' });
  pending.resolve(ownerDigest(JSON.stringify(['student', 'student-token'])));
  await tick();
  assert.equal(form.querySelectorAll('textarea')[0].value, 'NEW THOUGHTS');
  assert.doesNotMatch(form.textContent, /已恢复未提交/);
  assert.equal(
    seed.read({
      courseSlug: 'signals',
      nodeId: 'SS-01-01',
      documentVersion: draftDocument,
      questionVersion: '1',
      questionId: 'q1',
      mode: 'selftest',
    }).answer,
    'NEW THOUGHTS',
  );
});

test('a session change rejects late draft hashing and clears previous-session answer storage', async () => {
  const storage = draftStorage();
  const seed = answerDrafts.createDraftStore({ storage, digest: ownerDigest });
  await seed.bind('student', 'student-token');
  seed.save(
    {
      courseSlug: 'signals',
      nodeId: 'SS-01-01',
      documentVersion: draftDocument,
      questionVersion: '1',
      questionId: 'q1',
      mode: 'selftest',
    },
    { answer: 'OLD PRIVATE THOUGHTS' },
  );
  const pending = deferred();
  const h = harness({
    draftSessionStorage: storage,
    draftDigest: (value) => (value.includes('another') ? ownerDigest(value) : pending.promise),
    callApi: draftApi(),
  });
  await h.load();
  await tick();
  h.app.userState = { uid: 'another', token: 'another-token', isLoggedIn: true };
  await h.browser.dispatchEvent({ type: 'freebbs:session-change' });
  await tick();
  pending.resolve(ownerDigest(JSON.stringify(['student', 'student-token'])));
  await tick();
  assert.equal(firstForm(h).querySelectorAll('textarea')[0].value, '');
  assert.doesNotMatch(JSON.stringify([...storage.values.values()]), /OLD PRIVATE THOUGHTS/);
});

test('refreshing after failed correction freezes UUID and its complete original payload until edited', async () => {
  const storage = draftStorage();
  const first = harness({
    draftSessionStorage: storage,
    callApi: draftApi({
      records: [attempt({ documentVersion: draftDocument })],
      submit: async () => {
        throw new Error('connection lost');
      },
    }),
  });
  await first.load();
  await tick();
  first.controller.selectView('mistakes');
  const form = firstForm(first);
  form.querySelectorAll('textarea')[0].value = '先解释因果支撑，再计算';
  await form.dispatchEvent({ type: 'input' });
  await form.dispatchEvent({ type: 'submit', preventDefault() {} });
  const original = JSON.parse(
    first.requests.find((request) => request.options.method === 'POST').options.body,
  );
  assert.equal(original.supersedesAttemptId, '1');
  const retry = harness({
    draftSessionStorage: storage,
    callApi: draftApi({ records: [attempt({ id: '2', documentVersion: draftDocument })] }),
  });
  await retry.load();
  await tick();
  assert.match(firstForm(retry).textContent, /可核对后重试/);
  await firstForm(retry).dispatchEvent({ type: 'submit', preventDefault() {} });
  const retried = JSON.parse(
    retry.requests.find((request) => request.options.method === 'POST').options.body,
  );
  assert.deepEqual(retried, original);
  const afterSuccess = harness({ draftSessionStorage: storage, callApi: draftApi() });
  await afterSuccess.load();
  await tick();
  assert.equal(firstForm(afterSuccess).querySelectorAll('textarea')[0].value, '');
  assert.doesNotMatch(JSON.stringify([...storage.values.values()]), /先解释因果支撑|score|verdict/);
});

test('editing a restored failed intent creates a fresh UUID and unload warns only about unsubmitted content', async () => {
  const storage = draftStorage();
  const seed = answerDrafts.createDraftStore({ storage, digest: ownerDigest });
  await seed.bind('student', 'student-token');
  const oldKey = crypto.randomUUID();
  seed.save(
    {
      courseSlug: 'signals',
      nodeId: 'SS-01-01',
      documentVersion: draftDocument,
      questionVersion: '1',
      questionId: 'q1',
      mode: 'selftest',
    },
    { answer: 'OLD', requestKey: oldKey, supersedesAttemptId: '1' },
  );
  const h = harness({ draftSessionStorage: storage, callApi: draftApi() });
  await h.load();
  await tick();
  const form = firstForm(h);
  form.querySelectorAll('textarea')[0].value = 'EDITED';
  await form.dispatchEvent({ type: 'input' });
  let warnings = 0;
  await h.browser.dispatchEvent({
    type: 'beforeunload',
    preventDefault() {
      warnings += 1;
    },
  });
  assert.equal(warnings, 1);
  await form.dispatchEvent({ type: 'submit', preventDefault() {} });
  const sent = JSON.parse(
    h.requests.find((request) => request.options.method === 'POST').options.body,
  );
  assert.notEqual(sent.requestKey, oldKey);
  assert.equal(sent.answer, 'EDITED');
  assert.equal(sent.supersedesAttemptId, undefined);
  await h.browser.dispatchEvent({
    type: 'beforeunload',
    preventDefault() {
      warnings += 1;
    },
  });
  assert.equal(warnings, 1);
});

test('blocked session storage preserves the in-memory answer and cannot block submission', async () => {
  const h = harness({
    draftSessionStorage: {
      getItem() {
        throw new Error('blocked');
      },
    },
    callApi: draftApi(),
  });
  await h.load();
  await tick();
  const form = firstForm(h);
  form.querySelectorAll('textarea')[0].value = 'MEMORY ONLY';
  await form.dispatchEvent({ type: 'input' });
  h.controller.selectView('practice');
  h.controller.selectView('quick');
  assert.equal(firstForm(h).querySelectorAll('textarea')[0].value, 'MEMORY ONLY');
  await firstForm(h).dispatchEvent({ type: 'submit', preventDefault() {} });
  assert.equal(h.controller.getSnapshot().attempts[0].answer, 'MEMORY ONLY');
});

test('a late save response cannot erase fresh thoughts typed after switching quiz views', async () => {
  const storage = draftStorage();
  const pending = deferred();
  const h = harness({
    draftSessionStorage: storage,
    callApi: draftApi({ submit: () => pending.promise }),
  });
  await h.load();
  await tick();
  const form = firstForm(h);
  form.querySelectorAll('textarea')[0].value = 'FIRST SUBMITTED THOUGHTS';
  await form.dispatchEvent({ type: 'input' });
  const submission = form.dispatchEvent({ type: 'submit', preventDefault() {} });
  h.controller.selectView('practice');
  h.controller.selectView('quick');
  const newForm = firstForm(h);
  newForm.querySelectorAll('textarea')[0].value = 'FRESH UNSUBMITTED THOUGHTS';
  await newForm.dispatchEvent({ type: 'input' });
  pending.resolve({
    attempt: attempt({ answer: 'FIRST SUBMITTED THOUGHTS', documentVersion: draftDocument }),
    documentVersion: draftDocument,
  });
  await submission;
  assert.equal(newForm.querySelectorAll('textarea')[0].value, 'FRESH UNSUBMITTED THOUGHTS');
  const reopened = harness({ draftSessionStorage: storage, callApi: draftApi() });
  await reopened.load();
  await tick();
  assert.equal(
    firstForm(reopened).querySelectorAll('textarea')[0].value,
    'FRESH UNSUBMITTED THOUGHTS',
  );
});

test('review uses the submitted question snapshot and processing one record preserves the other review draft', async () => {
  const records = [
    attempt({
      id: '11',
      userId: 'other',
      status: 'pending_review',
      verdict: null,
      score: null,
      snapshotAvailability: 'available',
      questionSnapshot: {
        id: 'q1',
        type: 'single_choice',
        prompt: '<img src=x onerror=alert(1)>ORIGINAL QUESTION',
        questionVersion: 'old-version',
        options: [{ id: 'A', text: 'ORIGINAL OPTION' }],
      },
    }),
    attempt({
      id: '12',
      userId: 'another',
      status: 'pending_review',
      verdict: null,
      score: null,
      snapshotAvailability: 'missing',
      questionSnapshot: null,
    }),
  ];
  const h = harness({
    callApi: async (url, options) => {
      if (url.endsWith('/questions'))
        return {
          questions: [question()],
          practiceQuestions: [],
          documentVersion: 'current',
          canReview: true,
        };
      if (url.includes('review=pending')) return { attempts: records };
      if (options.method === 'GET') return { attempts: [] };
      return {};
    },
  });
  await h.load();
  await tick();
  const results = h.elements.get('learning-quiz-results');
  const open = results
    .querySelectorAll('button')
    .find((node) => node.textContent.includes('查看待复核'));
  await open.dispatchEvent({ type: 'click' });
  const reviewCards = results.querySelectorAll('details').filter((node) => node.dataset.attemptId);
  assert.equal(reviewCards[0].open, true);
  const recorded = reviewCards[0].children.find((node) => node.className.includes('review-prompt'));
  assert.equal(recorded.innerHTML, escape(records[0].questionSnapshot.prompt));
  assert.ok(h.renders.includes('A. ORIGINAL OPTION'));
  assert.match(reviewCards[1].textContent, /题干快照缺失/);
  assert.equal(
    reviewCards[1].children.some((node) => node.className.includes('review-prompt')),
    false,
  );
  const forms = results.querySelectorAll('form');
  forms[1].querySelectorAll('input')[0].value = '0.5';
  forms[1].querySelectorAll('textarea')[0].value = 'SECOND REVIEW NOTES';
  await forms[1].dispatchEvent({ type: 'input' });
  forms[0].querySelectorAll('input')[0].value = '1';
  forms[0].querySelectorAll('textarea')[0].value = 'FIRST REVIEW';
  await forms[0].dispatchEvent({ type: 'submit', preventDefault() {} });
  const remaining = results.querySelectorAll('form');
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].querySelectorAll('input')[0].value, '0.5');
  assert.equal(remaining[0].querySelectorAll('textarea')[0].value, 'SECOND REVIEW NOTES');
  h.app.userState = { uid: '', token: '', isLoggedIn: false };
  await h.browser.dispatchEvent({ type: 'freebbs:session-change' });
  assert.doesNotMatch(results.textContent, /SECOND REVIEW NOTES|ORIGINAL QUESTION/);
  h.app.userState = { uid: 'other-teacher', token: 'other-token', isLoggedIn: true };
  await h.browser.dispatchEvent({ type: 'freebbs:session-change' });
  await tick();
  const priorRequests = h.requests.length;
  await remaining[0].dispatchEvent({ type: 'submit', preventDefault() {} });
  await remaining[0].dispatchEvent({ type: 'input' });
  assert.equal(
    h.requests.length,
    priorRequests,
    'Detached review controls cannot act under a new owner',
  );
  await open.dispatchEvent({ type: 'click' });
  assert.equal(results.querySelectorAll('form')[1].querySelectorAll('textarea')[0].value, '');
});

const reviewRecord = (id, overrides = {}) =>
  attempt({
    id: String(id),
    userId: `student-${id}`,
    status: 'pending_review',
    verdict: null,
    score: null,
    snapshotAvailability: 'missing',
    questionSnapshot: null,
    ...overrides,
  });
const reviewResults = (h) => h.elements.get('learning-quiz-results');
const reviewButton = (h, more = false) =>
  reviewResults(h)
    .querySelectorAll('button')
    .find((node) =>
      more ? node.className.includes('review-more') : node.textContent.startsWith('课程负责人：'),
    );
const reviewCard = (h, id) =>
  reviewResults(h)
    .querySelectorAll('details')
    .find((node) => node.dataset.attemptId === String(id));
function reviewHarness({ queue, patch, versions = () => ({}), personalCursor = null } = {}) {
  return harness({
    callApi: async (url, options) => {
      const { documentVersion = 'current', questionVersion = '1' } = versions();
      if (url.endsWith('/questions'))
        return {
          questions: [question()],
          practiceQuestions: [],
          documentVersion,
          questionVersion,
          canReview: true,
        };
      if (url.includes('review=pending')) return queue(url, options);
      if (options.method === 'GET')
        return { attempts: [], nextCursor: personalCursor, documentVersion };
      return patch ? patch(url, options) : {};
    },
  });
}

test('successful review A refreshes personal evidence without detaching B or resetting its active selection', async () => {
  const response = deferred();
  let completed = false;
  let questionReads = 0;
  const h = harness({
    callApi: async (url, options) => {
      if (url.endsWith('/questions')) {
        questionReads += 1;
        return {
          questions: [question()],
          practiceQuestions: [],
          documentVersion: 'current',
          questionVersion: '1',
          canReview: true,
        };
      }
      if (url.includes('review=pending'))
        return { attempts: [reviewRecord(52), reviewRecord(51)], nextCursor: null };
      if (options.method === 'GET') {
        const records = completed
          ? [attempt({ id: '900', answer: 'A', score: 1, verdict: 'pass' })]
          : [];
        return { attempts: records, currentAttempts: records, documentVersion: 'current' };
      }
      await response.promise;
      completed = true;
      return { attempt: attempt({ id: '52' }), documentVersion: 'current' };
    },
  });
  await h.load();
  await tick();
  await reviewButton(h).dispatchEvent({ type: 'click' });
  const a = reviewCard(h, 52).querySelectorAll('form')[0];
  const bCard = reviewCard(h, 51);
  const b = bCard.querySelectorAll('form')[0];
  const score = b.querySelectorAll('input')[0];
  const textarea = b.querySelectorAll('textarea')[0];
  a.querySelectorAll('input')[0].value = '1';
  a.querySelectorAll('textarea')[0].value = 'A review';
  const submitting = a.dispatchEvent({ type: 'submit', preventDefault() {} });
  assert.equal(a.querySelectorAll('input')[0].disabled, true);
  assert.equal(a.querySelectorAll('textarea')[0].disabled, true);
  assert.equal(b.querySelectorAll('input')[0].disabled, false);
  assert.equal(textarea.disabled, false);
  score.value = '0';
  textarea.value = 'B：继续输入中文组合文本';
  textarea.selectionStart = 1;
  textarea.selectionEnd = 4;
  textarea.selectionDirection = 'forward';
  h.document.activeElement = textarea;
  await b.dispatchEvent({ type: 'input' });
  response.resolve();
  await submitting;
  assert.equal(reviewCard(h, 52), undefined);
  assert.equal(a.isConnected, false);
  assert.equal(reviewCard(h, 51), bCard);
  assert.equal(reviewCard(h, 51).querySelectorAll('form')[0], b);
  assert.equal(b.querySelectorAll('textarea')[0], textarea);
  assert.equal(b.querySelectorAll('input')[0], score);
  assert.equal(textarea.isConnected, true);
  assert.equal(textarea.detachments, 0, 'Not even a remove/reinsert of the same node is permitted');
  assert.equal(h.document.activeElement, textarea);
  assert.deepEqual(
    [textarea.selectionStart, textarea.selectionEnd, textarea.selectionDirection],
    [1, 4, 'forward'],
  );
  assert.equal(textarea.value, 'B：继续输入中文组合文本');
  assert.equal(score.value, '0');
  assert.equal(questionReads, 2, 'The current server question/version state is still re-read');
  assert.equal(h.controller.getSnapshot().currentAttempts[0].id, '900');
  assert.ok(reviewCard(h, 900), 'The reviewer personal history is updated as well');
});

test('only A locks while submitting, a transient failure preserves zero and notes, and an identical confirmed retry ends A', async () => {
  const response = deferred();
  let patches = 0;
  const h = reviewHarness({
    queue: async () => ({ attempts: [reviewRecord(52), reviewRecord(51)], nextCursor: null }),
    patch: async () => {
      patches += 1;
      return patches === 1
        ? response.promise
        : { attempt: reviewRecord(52, { status: 'graded', score: 0 }), replayed: true };
    },
  });
  await h.load();
  await tick();
  await reviewButton(h).dispatchEvent({ type: 'click' });
  const a = reviewCard(h, 52).querySelectorAll('form')[0];
  const b = reviewCard(h, 51).querySelectorAll('form')[0];
  const score = a.querySelectorAll('input')[0];
  const notes = a.querySelectorAll('textarea')[0];
  score.value = '0';
  notes.value = '零分，完整保留提交时的说明。';
  const submitting = a.dispatchEvent({ type: 'submit', preventDefault() {} });
  assert.equal(score.disabled, true);
  assert.equal(notes.disabled, true);
  assert.equal(a.querySelectorAll('button')[0].disabled, true);
  assert.equal(b.querySelectorAll('input')[0].disabled, false);
  assert.equal(b.querySelectorAll('textarea')[0].disabled, false);
  await a.dispatchEvent({ type: 'submit', preventDefault() {} });
  assert.equal(patches, 1, 'A second event cannot send a duplicate in-flight request');
  response.reject(Object.assign(new Error('temporary receipt failure'), { status: 503 }));
  await submitting;
  assert.equal(score.disabled, false);
  assert.equal(notes.disabled, false);
  assert.equal(a.querySelectorAll('button')[0].disabled, false);
  assert.equal(score.value, '0');
  assert.equal(notes.value, '零分，完整保留提交时的说明。');
  assert.match(a.textContent, /temporary receipt failure/);
  await a.dispatchEvent({ type: 'submit', preventDefault() {} });
  const payloads = h.requests
    .filter((request) => request.options.method === 'PATCH')
    .map((request) => JSON.parse(request.options.body));
  assert.deepEqual(payloads, [
    { score: 0, feedback: '零分，完整保留提交时的说明。' },
    { score: 0, feedback: '零分，完整保留提交时的说明。' },
  ]);
  assert.equal(reviewCard(h, 52), undefined);
  assert.equal(score.disabled, true);
  assert.equal(notes.disabled, true);
  assert.equal(reviewCard(h, 51).querySelectorAll('form')[0], b);
});

test('late failure finally cannot unlock A after review permission or server versions invalidate its controls', async () => {
  for (const change of ['permission', 'document', 'question']) {
    const response = deferred();
    let changed = false;
    const h = harness({
      callApi: async (url, options) => {
        if (url.endsWith('/questions'))
          return {
            questions: [question()],
            practiceQuestions: [],
            documentVersion: changed && change === 'document' ? 'changed' : 'current',
            questionVersion: changed && change === 'question' ? '2' : '1',
            canReview: !(changed && change === 'permission'),
          };
        if (url.includes('review=pending'))
          return { attempts: [reviewRecord(52), reviewRecord(51)], nextCursor: null };
        if (options.method === 'PATCH') return response.promise;
        return { attempts: [], documentVersion: 'current' };
      },
    });
    await h.load();
    await tick();
    await reviewButton(h).dispatchEvent({ type: 'click' });
    const a = reviewCard(h, 52).querySelectorAll('form')[0];
    a.querySelectorAll('input')[0].value = '0';
    a.querySelectorAll('textarea')[0].value = '被旧范围淘汰的提交';
    const submitting = a.dispatchEvent({ type: 'submit', preventDefault() {} });
    changed = true;
    await h.controller.refresh();
    response.reject(Object.assign(new Error('late failure'), { status: 503 }));
    await submitting;
    assert.equal(a.isConnected, false, change);
    assert.equal(a.querySelectorAll('input')[0].disabled, true, change);
    assert.equal(a.querySelectorAll('textarea')[0].disabled, true, change);
    assert.equal(a.querySelectorAll('button')[0].disabled, true, change);
    const count = h.requests.length;
    await a.dispatchEvent({ type: 'submit', preventDefault() {} });
    assert.equal(h.requests.length, count, change);
    assert.doesNotMatch(reviewResults(h).textContent, /late failure/);
  }
});

test('review paging and transient failure update siblings without replacing a live B editor', async () => {
  const pending = deferred();
  let requests = 0;
  const h = reviewHarness({
    queue: async (url) => {
      if (!url.includes('before='))
        return { attempts: [reviewRecord(52), reviewRecord(51)], nextCursor: '51' };
      requests += 1;
      if (requests === 1) {
        await pending.promise;
        throw Object.assign(new Error('retryable 500'), { status: 500 });
      }
      return { attempts: [reviewRecord(50)], nextCursor: null };
    },
  });
  await h.load();
  await tick();
  await reviewButton(h).dispatchEvent({ type: 'click' });
  const b = reviewCard(h, 51).querySelectorAll('textarea')[0];
  h.document.activeElement = b;
  b.value = 'KEEP LIVE';
  b.selectionStart = 2;
  b.selectionEnd = 6;
  await b.parentElement.parentElement.dispatchEvent({ type: 'input' });
  const loading = reviewButton(h, true).dispatchEvent({ type: 'click' });
  assert.equal(reviewCard(h, 51).querySelectorAll('textarea')[0], b);
  pending.resolve();
  await loading;
  await reviewButton(h, true).dispatchEvent({ type: 'click' });
  assert.equal(reviewCard(h, 51).querySelectorAll('textarea')[0], b);
  assert.equal(h.document.activeElement, b);
  assert.equal(b.detachments, 0);
  assert.deepEqual([b.selectionStart, b.selectionEnd], [2, 6]);
});

for (const action of ['queue', 'patch'])
  for (const status of [401, 403, 500])
    test(`review ${action} ${status} ${status === 500 ? 'preserves' : 'revokes'} live records and drafts`, async () => {
      let queueReads = 0;
      const error = Object.assign(new Error(`HTTP ${status}`), { status });
      const h = reviewHarness({
        queue: async () => {
          queueReads += 1;
          if (action === 'queue' && queueReads > 1) throw error;
          return {
            attempts: [
              reviewRecord(52, { answer: 'PRIVATE A' }),
              reviewRecord(51, { answer: 'PRIVATE B' }),
            ],
            nextCursor: '51',
          };
        },
        patch: async () => {
          throw error;
        },
      });
      await h.load();
      await tick();
      await reviewButton(h).dispatchEvent({ type: 'click' });
      const a = reviewCard(h, 52).querySelectorAll('form')[0];
      const b = reviewCard(h, 51).querySelectorAll('form')[0];
      const bEditor = b.querySelectorAll('textarea')[0];
      b.querySelectorAll('input')[0].value = '0';
      bEditor.value = 'PRIVATE B UNFINISHED REVIEW';
      await b.dispatchEvent({ type: 'input' });
      if (action === 'patch') {
        a.querySelectorAll('input')[0].value = '1';
        a.querySelectorAll('textarea')[0].value = 'A notes';
        await a.dispatchEvent({ type: 'submit', preventDefault() {} });
      } else await reviewButton(h, true).dispatchEvent({ type: 'click' });
      if (status === 500) {
        assert.equal(reviewResults(h).querySelectorAll('form').length, 2);
        assert.equal(reviewCard(h, 51).querySelectorAll('textarea')[0], bEditor);
        assert.equal(bEditor.value, 'PRIVATE B UNFINISHED REVIEW');
        assert.equal(bEditor.detachments, 0);
        assert.equal(b.querySelectorAll('input')[0].value, '0');
        assert.equal(a.querySelectorAll('button')[0].disabled, false);
        assert.match(reviewResults(h).textContent, /HTTP 500/);
      } else {
        assert.equal(reviewResults(h).querySelectorAll('form').length, 0);
        assert.doesNotMatch(reviewResults(h).textContent, /PRIVATE A|PRIVATE B/);
        assert.match(h.elements.get('learning-quiz-status').textContent, /已清除/);
        assert.equal(bEditor.isConnected, false);
        assert.equal(bEditor.disabled, true);
        const requestCount = h.requests.length;
        await b.dispatchEvent({ type: 'input' });
        await b.dispatchEvent({ type: 'submit', preventDefault() {} });
        assert.equal(
          h.requests.length,
          requestCount,
          'Revoked closures cannot make a review request',
        );
        await h.controller.refresh();
        queueReads = 0;
        await reviewButton(h).dispatchEvent({ type: 'click' });
        assert.equal(
          reviewCard(h, 51).querySelectorAll('textarea')[0].value,
          '',
          'Re-authorizing cannot revive the erased review draft',
        );
      }
    });

test('malformed pending payloads are explicit retryable failures, not empty or undefined-person queues', async () => {
  let payload;
  const original = { attempts: [reviewRecord(52), reviewRecord(51)], nextCursor: '51' };
  const h = reviewHarness({ queue: async () => payload || original });
  await h.load();
  await tick();
  await reviewButton(h).dispatchEvent({ type: 'click' });
  const b = reviewCard(h, 51).querySelectorAll('form')[0];
  b.querySelectorAll('input')[0].value = '0';
  b.querySelectorAll('textarea')[0].value = 'KEEP MALFORMED';
  await b.dispatchEvent({ type: 'input' });
  for (const invalid of [
    {},
    { attempts: null },
    { attempts: 'oops' },
    { attempts: {} },
    { attempts: [null] },
    { attempts: [{}] },
    { attempts: [reviewRecord(53, { userId: null })] },
    { attempts: [reviewRecord(53, { questionId: null })] },
    { attempts: [reviewRecord(53, { status: 'graded' })] },
    { attempts: [reviewRecord(53, { maxScore: undefined })] },
  ]) {
    payload = invalid;
    await reviewButton(h).dispatchEvent({ type: 'click' });
    assert.match(reviewResults(h).textContent, /响应格式不完整.*可重试/);
    assert.doesNotMatch(
      reviewResults(h).textContent,
      /已加载待复核 0|没有待复核|复核账号 undefined/,
    );
    assert.equal(reviewCard(h, 51).querySelectorAll('form')[0], b);
    assert.equal(b.querySelectorAll('textarea')[0].value, 'KEEP MALFORMED');
    assert.equal(b.querySelectorAll('input')[0].value, '0');
  }
  payload = original;
  await reviewButton(h).dispatchEvent({ type: 'click' });
  assert.doesNotMatch(reviewResults(h).textContent, /响应格式不完整/);
  assert.equal(b.detachments, 0);
});

test('nonadvancing or malformed review cursors retain the loaded queue and retry the original cursor', async () => {
  let cursorResponse = '51';
  const cursors = [];
  const h = reviewHarness({
    queue: async (url) => {
      const cursor = new URL(url, 'http://test.invalid').searchParams.get('before');
      cursors.push(cursor);
      return cursor
        ? { attempts: [reviewRecord(50)], nextCursor: cursorResponse }
        : { attempts: [reviewRecord(51)], nextCursor: '51' };
    },
  });
  await h.load();
  await tick();
  await reviewButton(h).dispatchEvent({ type: 'click' });
  const b = reviewCard(h, 51);
  await reviewButton(h, true).dispatchEvent({ type: 'click' });
  assert.match(reviewResults(h).textContent, /分页未前进.*可重试/);
  assert.doesNotMatch(reviewResults(h).textContent, /还有更多待复核作答/);
  assert.match(reviewButton(h, true).textContent, /重试加载/);
  assert.equal(reviewCard(h, 50), undefined);
  for (const invalid of [51, {}, [], '']) {
    cursorResponse = invalid;
    await reviewButton(h, true).dispatchEvent({ type: 'click' });
    assert.match(reviewResults(h).textContent, /游标格式无效.*可重试/);
  }
  assert.deepEqual(cursors, [null, '51', '51', '51', '51', '51']);
  assert.equal(reviewCard(h, 51), b);
  assert.equal(b.detachments, 0);
  await tick();
  assert.equal(cursors.length, 6, 'No hidden automatic loop');
  cursorResponse = null;
  await reviewButton(h, true).dispatchEvent({ type: 'click' });
  assert.ok(reviewCard(h, 50));
  assert.equal(reviewButton(h, true), undefined);
});

test('a late old-account 403 cannot revoke the newly authorized queue', async () => {
  const response = deferred();
  const h = reviewHarness({
    queue: async (url) => {
      if (url.includes('before=')) return response.promise;
      return {
        attempts: [reviewRecord(h.app.userState.uid === 'student' ? 52 : 9)],
        nextCursor: '52',
      };
    },
  });
  await h.load();
  await tick();
  await reviewButton(h).dispatchEvent({ type: 'click' });
  const old = reviewCard(h, 52);
  const waiting = reviewButton(h, true).dispatchEvent({ type: 'click' });
  h.app.userState = { uid: 'other-teacher', token: 'other-token', isLoggedIn: true };
  await h.browser.dispatchEvent({ type: 'freebbs:session-change' });
  await tick();
  await reviewButton(h).dispatchEvent({ type: 'click' });
  const current = reviewCard(h, 9);
  response.reject(Object.assign(new Error('late old denied'), { status: 403 }));
  await waiting;
  assert.equal(reviewCard(h, 9), current);
  assert.equal(current.isConnected, true);
  assert.equal(old.isConnected, false);
  assert.doesNotMatch(reviewResults(h).textContent, /late old denied/);
});

test('late PATCH denial after account, token, node or version changes cannot clear a newer live review draft', async () => {
  for (const change of ['account', 'token', 'point', 'version']) {
    const response = deferred();
    let version = {};
    let queueReads = 0;
    const h = reviewHarness({
      versions: () => version,
      queue: async () => {
        queueReads += 1;
        return {
          attempts: queueReads === 1 ? [reviewRecord(52), reviewRecord(51)] : [reviewRecord(9)],
          nextCursor: null,
        };
      },
      patch: async () => response.promise,
    });
    await h.load();
    await tick();
    await reviewButton(h).dispatchEvent({ type: 'click' });
    const a = reviewCard(h, 52).querySelectorAll('form')[0];
    const oldB = reviewCard(h, 51).querySelectorAll('textarea')[0];
    a.querySelectorAll('input')[0].value = '1';
    a.querySelectorAll('textarea')[0].value = 'OLD A';
    const waiting = a.dispatchEvent({ type: 'submit', preventDefault() {} });
    if (change === 'account' || change === 'token') {
      h.app.userState = {
        uid: change === 'account' ? 'new-owner' : 'student',
        token: 'rotated-token',
        isLoggedIn: true,
      };
      await h.browser.dispatchEvent({ type: 'freebbs:session-change' });
    } else if (change === 'point') {
      await h.page.dispatchEvent({
        type: 'knowledge:loaded',
        detail: {
          course: { slug: 'signals' },
          node: { id: 'SS-01-02', markdown: '', documentVersion: 'current' },
        },
      });
    } else {
      version = { documentVersion: 'new-document', questionVersion: '2' };
      await h.controller.refresh();
    }
    await tick();
    await reviewButton(h).dispatchEvent({ type: 'click' });
    const b = reviewCard(h, 9).querySelectorAll('form')[0];
    b.querySelectorAll('input')[0].value = '0';
    const fresh = b.querySelectorAll('textarea')[0];
    fresh.value = 'NEW SCOPE REVIEW';
    await b.dispatchEvent({ type: 'input' });
    response.reject(Object.assign(new Error('late OLD PATCH denied'), { status: 403 }));
    await waiting;
    assert.equal(reviewCard(h, 9).querySelectorAll('textarea')[0], fresh, change);
    assert.equal(fresh.value, 'NEW SCOPE REVIEW', change);
    assert.equal(fresh.disabled, false, change);
    assert.equal(oldB.isConnected, false, change);
    assert.equal(oldB.disabled, true, change);
    assert.doesNotMatch(reviewResults(h).textContent, /late OLD PATCH/, change);
  }
});

test('the server version and permission read after A review invalidates obsolete B controls instead of hiding the update', async () => {
  for (const change of ['document', 'question', 'permission']) {
    let completed = false;
    const h = harness({
      callApi: async (url, options) => {
        if (url.endsWith('/questions'))
          return {
            questions: [question()],
            practiceQuestions: [],
            documentVersion: completed && change === 'document' ? 'new-document' : 'current',
            questionVersion: completed && change === 'question' ? '2' : '1',
            canReview: !(completed && change === 'permission'),
          };
        if (url.includes('review=pending'))
          return { attempts: [reviewRecord(52), reviewRecord(51)], nextCursor: null };
        if (options.method === 'GET') return { attempts: [], documentVersion: 'current' };
        completed = true;
        return {};
      },
    });
    await h.load();
    await tick();
    await reviewButton(h).dispatchEvent({ type: 'click' });
    const a = reviewCard(h, 52).querySelectorAll('form')[0];
    const b = reviewCard(h, 51).querySelectorAll('form')[0];
    const old = b.querySelectorAll('textarea')[0];
    a.querySelectorAll('input')[0].value = '1';
    a.querySelectorAll('textarea')[0].value = 'A valid review';
    await a.dispatchEvent({ type: 'submit', preventDefault() {} });
    assert.equal(old.isConnected, false, change);
    assert.equal(old.disabled, true, change);
    assert.equal(reviewCard(h, 51), undefined, change);
    const count = h.requests.length;
    await b.dispatchEvent({ type: 'submit', preventDefault() {} });
    assert.equal(h.requests.length, count, change);
    if (change === 'document')
      assert.equal(h.controller.getSnapshot().documentVersion, 'new-document');
    if (change === 'permission') assert.equal(reviewButton(h), undefined);
  }
});

test('teacher review explicitly loads all 120 records across independent deduplicated cursor pages', async () => {
  const descending = (high, low) =>
    Array.from({ length: high - low + 1 }, (_, index) => reviewRecord(high - index));
  const queueRequests = [];
  const h = reviewHarness({
    personalCursor: '777',
    queue: async (url) => {
      queueRequests.push(url);
      const cursor = new URL(url, 'http://test.invalid').searchParams.get('before');
      if (!cursor)
        return { attempts: descending(120, 71), nextCursor: '71', documentVersion: 'current' };
      if (cursor === '71')
        return { attempts: descending(71, 22), nextCursor: '22', documentVersion: 'current' };
      assert.equal(cursor, '22');
      return { attempts: descending(21, 1), nextCursor: null, documentVersion: 'current' };
    },
  });
  await h.load();
  await tick();
  assert.equal(queueRequests.length, 0);
  await reviewButton(h).dispatchEvent({ type: 'click' });
  assert.equal(reviewResults(h).querySelectorAll('form').length, 50);
  assert.match(reviewResults(h).textContent, /已加载待复核 50 份。还有更多/);
  assert.doesNotMatch(reviewResults(h).textContent, /总计|总共|共 50 份/);
  assert.equal(queueRequests.length, 1, 'No hidden eager scan of all pending students');
  await reviewButton(h, true).dispatchEvent({ type: 'click' });
  assert.equal(reviewResults(h).querySelectorAll('form').length, 99);
  assert.match(queueRequests[1], /review=pending&before=71$/);
  await reviewButton(h, true).dispatchEvent({ type: 'click' });
  assert.equal(reviewResults(h).querySelectorAll('form').length, 120);
  assert.match(queueRequests[2], /review=pending&before=22$/);
  assert.equal(reviewButton(h, true), undefined);
  assert.match(reviewResults(h).textContent, /已加载待复核 120 份。.*本次队列已加载完毕/);
  assert.ok(
    reviewResults(h)
      .querySelectorAll('button')
      .some((node) => node.textContent === '加载更早的作答记录'),
  );
});

test('teacher cursor failure keeps prior inputs, prevents concurrent fetches and retries the same page', async () => {
  const next = deferred();
  const cursors = [];
  let pageCalls = 0;
  const h = reviewHarness({
    queue: async (url) => {
      const cursor = new URL(url, 'http://test.invalid').searchParams.get('before');
      cursors.push(cursor);
      if (!cursor)
        return {
          attempts: [reviewRecord(52), reviewRecord(51)],
          nextCursor: '51',
          documentVersion: 'current',
        };
      pageCalls += 1;
      if (pageCalls === 1) {
        await next.promise;
        throw new Error('网络暂不可用');
      }
      return { attempts: [reviewRecord(50)], nextCursor: null, documentVersion: 'current' };
    },
  });
  await h.load();
  await tick();
  await reviewButton(h).dispatchEvent({ type: 'click' });
  const second = reviewCard(h, 51).querySelectorAll('form')[0];
  second.querySelectorAll('input')[0].value = '0';
  second.querySelectorAll('textarea')[0].value = '先保留第二位同学的复核依据';
  await second.dispatchEvent({ type: 'input' });
  const pendingMore = reviewButton(h, true).dispatchEvent({ type: 'click' });
  assert.equal(reviewButton(h, true).disabled, true);
  await reviewButton(h, true).dispatchEvent({ type: 'click' });
  assert.equal(cursors.length, 2, 'Repeated clicks do not issue concurrent page requests');
  next.resolve();
  await pendingMore;
  assert.match(reviewResults(h).textContent, /网络暂不可用.*输入保留，可重试/);
  assert.equal(reviewResults(h).querySelectorAll('form').length, 2);
  assert.equal(
    reviewCard(h, 51).querySelectorAll('textarea')[0].value,
    '先保留第二位同学的复核依据',
  );
  assert.equal(reviewCard(h, 51).querySelectorAll('input')[0].value, '0');
  await reviewButton(h, true).dispatchEvent({ type: 'click' });
  assert.deepEqual(cursors, [null, '51', '51']);
  assert.equal(reviewResults(h).querySelectorAll('form').length, 3);
  assert.equal(
    reviewCard(h, 51).querySelectorAll('textarea')[0].value,
    '先保留第二位同学的复核依据',
  );
  assert.doesNotMatch(reviewResults(h).textContent, /网络暂不可用/);
});

test('review head reload and reviewing A preserve B input loaded on a later page', async () => {
  let reviewedA = false;
  const h = reviewHarness({
    queue: async (url) =>
      url.includes('&before=52')
        ? { attempts: [reviewRecord(51)], nextCursor: null, documentVersion: 'current' }
        : {
            attempts: reviewedA ? [] : [reviewRecord(52)],
            nextCursor: '52',
            documentVersion: 'current',
          },
    patch: async () => {
      reviewedA = true;
      return {};
    },
  });
  await h.load();
  await tick();
  await reviewButton(h).dispatchEvent({ type: 'click' });
  await reviewButton(h, true).dispatchEvent({ type: 'click' });
  const b = reviewCard(h, 51).querySelectorAll('form')[0];
  b.querySelectorAll('input')[0].value = '0.5';
  b.querySelectorAll('textarea')[0].value = 'B 独立未提交的复核说明';
  await b.dispatchEvent({ type: 'input' });
  const a = reviewCard(h, 52).querySelectorAll('form')[0];
  a.querySelectorAll('input')[0].value = '1';
  a.querySelectorAll('textarea')[0].value = 'A 已确认';
  await a.dispatchEvent({ type: 'submit', preventDefault() {} });
  assert.equal(reviewCard(h, 52), undefined);
  assert.equal(reviewCard(h, 51).querySelectorAll('textarea')[0].value, 'B 独立未提交的复核说明');
  await reviewButton(h).dispatchEvent({ type: 'click' });
  await reviewButton(h, true).dispatchEvent({ type: 'click' });
  assert.equal(reviewCard(h, 51).querySelectorAll('input')[0].value, '0.5');
  assert.equal(reviewCard(h, 51).querySelectorAll('textarea')[0].value, 'B 独立未提交的复核说明');
});

test('initial teacher queue failure remains retryable and empty pages never invent a total', async () => {
  let calls = 0;
  const h = reviewHarness({
    queue: async () => {
      calls += 1;
      if (calls === 1) throw new Error('队列读取失败');
      return { attempts: [], nextCursor: null, documentVersion: 'current' };
    },
  });
  await h.load();
  await tick();
  await reviewButton(h).dispatchEvent({ type: 'click' });
  assert.match(reviewResults(h).textContent, /队列读取失败.*可重试/);
  assert.equal(reviewButton(h).disabled, false);
  await reviewButton(h).dispatchEvent({ type: 'click' });
  assert.equal(calls, 2);
  assert.match(reviewResults(h).textContent, /已加载待复核 0 份/);
  assert.match(reviewResults(h).textContent, /没有待复核作答/);
  assert.doesNotMatch(reviewResults(h).textContent, /总量|总计|共 0/);
  assert.equal(reviewButton(h, true), undefined);
});

test('identity, course, point and server version changes reject late teacher page responses', async () => {
  for (const change of ['account', 'session', 'course', 'point', 'document', 'question']) {
    let version = {};
    const latePage = deferred();
    let queueCalls = 0;
    const h = reviewHarness({
      versions: () => version,
      queue: async () => {
        queueCalls += 1;
        if (queueCalls === 1)
          return { attempts: [reviewRecord(52)], nextCursor: '52', documentVersion: 'current' };
        if (queueCalls === 2) return latePage.promise;
        return {
          attempts: [reviewRecord(9)],
          nextCursor: null,
          documentVersion: version.documentVersion || 'current',
        };
      },
    });
    await h.load();
    await tick();
    await reviewButton(h).dispatchEvent({ type: 'click' });
    const oldForm = reviewCard(h, 52).querySelectorAll('form')[0];
    oldForm.querySelectorAll('textarea')[0].value = 'OLD OWNER REVIEW';
    await oldForm.dispatchEvent({ type: 'input' });
    const pendingMore = reviewButton(h, true).dispatchEvent({ type: 'click' });
    if (change === 'account' || change === 'session') {
      h.app.userState = {
        uid: change === 'account' ? 'other-teacher' : 'student',
        token: change === 'session' ? 'new-session' : 'student-token',
        isLoggedIn: true,
      };
      await h.browser.dispatchEvent({ type: 'freebbs:session-change' });
    } else if (change === 'course' || change === 'point') {
      await h.page.dispatchEvent({
        type: 'knowledge:loaded',
        detail: {
          course: { slug: change === 'course' ? 'math' : 'signals' },
          node: {
            id: change === 'point' ? 'SS-01-02' : 'SS-01-01',
            markdown: '',
            documentVersion: 'current',
          },
        },
      });
    } else {
      version =
        change === 'document' ? { documentVersion: 'new-document' } : { questionVersion: '2' };
      await h.controller.refresh();
    }
    await tick();
    latePage.resolve({
      attempts: [reviewRecord(51, { answer: 'LATE PRIVATE OLD ANSWER' })],
      nextCursor: '51',
      documentVersion: 'current',
    });
    await pendingMore;
    assert.equal(reviewCard(h, 51), undefined, change);
    assert.equal(reviewButton(h, true), undefined, change);
    assert.doesNotMatch(reviewResults(h).textContent, /LATE PRIVATE OLD ANSWER/);
    const oldRequestCount = h.requests.length;
    await oldForm.dispatchEvent({ type: 'submit', preventDefault() {} });
    assert.equal(h.requests.length, oldRequestCount, 'Old review form is no longer authorized');
    await reviewButton(h).dispatchEvent({ type: 'click' });
    assert.ok(reviewCard(h, 9), change);
  }
});

test('a teacher page from a different server document cannot replace the loaded queue or its draft', async () => {
  let calls = 0;
  const h = reviewHarness({
    queue: async () => {
      calls += 1;
      return calls === 1
        ? { attempts: [reviewRecord(52)], nextCursor: '52', documentVersion: 'current' }
        : {
            attempts: [reviewRecord(51, { answer: 'WRONG VERSION' })],
            nextCursor: null,
            documentVersion: 'changed',
          };
    },
  });
  await h.load();
  await tick();
  await reviewButton(h).dispatchEvent({ type: 'click' });
  const form = reviewCard(h, 52).querySelectorAll('form')[0];
  form.querySelectorAll('textarea')[0].value = 'KEEP THIS REVIEW';
  await form.dispatchEvent({ type: 'input' });
  await reviewButton(h, true).dispatchEvent({ type: 'click' });
  assert.equal(reviewCard(h, 51), undefined);
  assert.equal(reviewCard(h, 52).querySelectorAll('textarea')[0].value, 'KEEP THIS REVIEW');
  assert.match(reviewResults(h).textContent, /版本已更新.*重新加载/);
  assert.doesNotMatch(reviewResults(h).textContent, /WRONG VERSION/);
  assert.equal(reviewButton(h, true).disabled, false);
});

test('a concurrent teacher page cannot revive a reviewed record and only matching revisions restore notes', async () => {
  const latePage = deferred();
  let calls = 0;
  const h = reviewHarness({
    queue: async () => {
      calls += 1;
      if (calls === 1)
        return {
          attempts: [reviewRecord(52, { revision: 1 }), reviewRecord(51, { revision: 1 })],
          nextCursor: '51',
          documentVersion: 'current',
        };
      if (calls === 2) return latePage.promise;
      return {
        attempts: [reviewRecord(51, { revision: 2 })],
        nextCursor: null,
        documentVersion: 'current',
      };
    },
  });
  await h.load();
  await tick();
  await reviewButton(h).dispatchEvent({ type: 'click' });
  const a = reviewCard(h, 52).querySelectorAll('form')[0];
  a.querySelectorAll('input')[0].value = '1';
  a.querySelectorAll('textarea')[0].value = 'A 的确认依据';
  const b = reviewCard(h, 51).querySelectorAll('form')[0];
  b.querySelectorAll('input')[0].value = '0.5';
  b.querySelectorAll('textarea')[0].value = 'B 版本一的说明';
  await b.dispatchEvent({ type: 'input' });
  const more = reviewButton(h, true).dispatchEvent({ type: 'click' });
  await a.dispatchEvent({ type: 'submit', preventDefault() {} });
  latePage.resolve({
    attempts: [
      reviewRecord(52, { revision: 1 }),
      reviewRecord(51, { revision: 1 }),
      reviewRecord(50),
    ],
    nextCursor: null,
    documentVersion: 'current',
  });
  await more;
  assert.equal(
    reviewCard(h, 52),
    undefined,
    'An old pending response cannot revive A after a successful review',
  );
  assert.equal(reviewCard(h, 51).querySelectorAll('textarea')[0].value, 'B 版本一的说明');
  await reviewButton(h).dispatchEvent({ type: 'click' });
  assert.equal(
    reviewCard(h, 51).querySelectorAll('textarea')[0].value,
    '',
    'New revisions never inherit old scoring notes',
  );
  const requestCount = h.requests.length;
  await b.dispatchEvent({ type: 'submit', preventDefault() {} });
  assert.equal(
    h.requests.length,
    requestCount,
    'Detached controls from an older revision cannot submit',
  );
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
