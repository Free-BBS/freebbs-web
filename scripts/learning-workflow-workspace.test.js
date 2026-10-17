const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const workflow = require('../public/learning-workflow');
const strategies = require('../public/learning-strategies');
const nextSteps = require('../public/learning-next-steps');
const policy = require('../public/learning-policy');
const content = require('../public/learning-content');
const panel = require('../public/learning-workflow-panel');
const { labels } = require('../public/knowledge-workspace');

const source = fs.readFileSync(path.join(__dirname, '../public/knowledge-workspace.js'), 'utf8');
function segment(start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, `Missing production segment ${start}`);
  return source.slice(first, last);
}
const pure = (value) => JSON.parse(JSON.stringify(value));

class Element {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.children = [];
    this.listeners = new Map();
    this.dataset = {};
    this.attributes = {};
    this.hidden = false;
    this.value = '';
    this.textContent = '';
    this.classList = { toggle() {} };
    this.queryResults = [];
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = [...children];
  }

  querySelectorAll() {
    return this.queryResults;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(callback);
  }

  dispatchEvent(event) {
    for (const callback of this.listeners.get(event.type) || []) callback(event);
  }

  focus(value) {
    this.focusOptions = value;
  }

  remove() {
    this.removed = true;
  }
}

function harness({
  goal = 'review',
  level = 'new',
  hasBody = true,
  questions = [],
  practiceQuestions = [],
} = {}) {
  let preference = { goal, level };
  const requests = [];
  const events = [];
  const calls = { renders: 0, viewWrites: 0, loadEntries: 0, loadReview: 0 };
  const savedPath = [
    {
      id: 'own-1',
      tool: 'content',
      title: '我自己的步骤',
      minutes: 5,
      completed: true,
      skipped: false,
    },
    {
      id: 'own-2',
      tool: 'feedback',
      title: '暂时跳过',
      minutes: 8,
      completed: false,
      skipped: true,
    },
  ];
  const state = {
    ready: true,
    stale: false,
    uid: 'student-a',
    token: 'session-a',
    course: { slug: 'signals' },
    node: {
      id: 'SS-02-01',
      title: '卷积',
      documentVersion: 'a'.repeat(64),
      sections: { knowledgeMarkdown: hasBody ? '卷积的定义与条件。' : '' },
    },
    planGoal: '',
    workflow: null,
    workflowScope: '',
    workflowDraft: '',
    workflowSelected: false,
    workflowNavigating: false,
    planPaused: false,
    planDirty: true,
    planKey: 'unsaved-path-key',
    plan: { steps: savedPath, reason: '我保留的安排' },
    planRecord: { id: 'saved-path', revision: 3, path: savedPath },
    latestPath: { id: 'saved-path', revision: 3, path: savedPath },
    tool: 'continue',
    previousTool: 'continue',
    positions: {},
    loaded: true,
    generation: 1,
    attempts: [],
    currentAttempts: [],
    questions,
    practiceQuestions,
    resources: [],
    entries: [],
    annotationEntries: [],
    reviewEpoch: 0,
    privateNoteDraft: '我没写完的批注',
    quizDraft: { 'real-question': '还没提交的作答' },
  };
  const elements = new Map();
  const document = {
    createElement(tag) {
      const node = new Element(tag);
      node.ownerDocument = document;
      return node;
    },
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, document.createElement('div'));
      return elements.get(id);
    },
    querySelectorAll() {
      return [];
    },
    querySelector(selector) {
      if (selector === '#learning-workflow-card h3')
        return document.getElementById('focused-workflow-title');
      return null;
    },
  };
  const page = new Element();
  const dispatch = page.dispatchEvent.bind(page);
  page.dispatchEvent = (event) => {
    events.push(event);
    dispatch(event);
  };
  const app = {
    userState: { uid: state.uid, token: state.token, isLoggedIn: true },
    callApi(...args) {
      requests.push(args);
      throw new Error('Unexpected API request');
    },
  };
  const window = new Element();
  Object.assign(window, {
    FreeBbsLearningWorkflow: workflow,
    FreeBbsLearningStrategies: strategies,
    FreeBbsLearningNextSteps: nextSteps,
    FreeBbsLearningPolicy: policy,
    FreeBbsLearningContent: content,
    FreeBbsLearningWorkflowPanel: panel,
    FreeBbsLearningStart: { currentPreference: () => preference },
    FreeBbsKnowledgeAnnotations: { setEditing() {}, refresh() {} },
    freeBbsKnowledge: { getLearningContext: () => ({ map: { nodes: [state.node], edges: [] } }) },
    requestAnimationFrame: (callback) => callback(),
    location: { assign: (url) => requests.push(['navigation', url]) },
    scrollTo() {},
  });
  const sandbox = {
    state,
    app,
    window,
    document,
    page,
    labels,
    root: new Element(),
    URLSearchParams,
    CustomEvent: function CustomEvent(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    },
    text(tag, value, className) {
      const node = document.createElement(tag);
      node.textContent = value;
      node.className = className;
      return node;
    },
    show(node, visible) {
      if (node) node.hidden = !visible;
    },
    el: (id) => document.getElementById(`learning-${id}`),
    loggedIn: () => true,
    scrollPosition: () => 0,
    scrollHost: () => window,
    keepPreference: () => {
      calls.viewWrites += 1;
    },
    renderPlan: () => {
      calls.renders += 1;
    },
    refreshPlan() {},
    resetNote() {},
    syncContributionForm() {},
    renderEntries() {},
    sessionMessage() {},
    resetReviewQueue() {},
    status() {},
    loadEntries: () => {
      calls.loadEntries += 1;
    },
    loadReview: () => {
      calls.loadReview += 1;
    },
  };
  const context = vm.createContext(sandbox);
  const portions = [
    segment('  function currentPlanGoal()', '  function sessionMessage('),
    segment('  function notifyLearningStep()', '  function status('),
    segment('  function switchTool(', '  function resetNote('),
    segment('  function openInteraction(', '  function refreshPlan('),
    segment('  function setPlanPaused(', '  function changePlan('),
    segment('  function navigateStep(', '  function renderPlan('),
    segment('  function resetSession(', "  document.querySelectorAll('[data-knowledge-tool]')"),
    segment(
      "  page.addEventListener('knowledge:tool-select'",
      "  page.addEventListener('knowledge:answer'",
    ),
    segment(
      "  page.addEventListener('knowledge:document-saved'",
      "  page.addEventListener('knowledge:assessment-updated'",
    ),
    segment(
      "  window.addEventListener('learning:start-change'",
      "  page.addEventListener('knowledge:annotation-save'",
    ),
    segment(
      "  window.addEventListener('freebbs:session-change'",
      "  window.addEventListener('beforeunload'",
    ),
  ];
  portions.forEach((code) => vm.runInContext(code, context));
  const all = (node) => [node, ...node.children.flatMap((child) => all(child))];
  const render = () => {
    const container = document.createElement('div');
    context.renderLearningWorkflow(container);
    return container;
  };
  const emit = (target, type, detail) => target.dispatchEvent({ type, detail });
  return {
    context,
    state,
    app,
    window,
    page,
    document,
    requests,
    events,
    calls,
    savedPath,
    render,
    all,
    emit,
    setPreference: (value) => {
      preference = value;
    },
    preference: () => preference,
    protectedState: () =>
      JSON.stringify({
        plan: state.plan,
        planRecord: state.planRecord,
        latestPath: state.latestPath,
        planKey: state.planKey,
        planDirty: state.planDirty,
        note: state.privateNoteDraft,
        quiz: state.quizDraft,
        attempts: state.attempts,
        currentAttempts: state.currentAttempts,
      }),
  };
}

test('currentStep exposes only an explicitly selected session in the matching owner and learning scope', () => {
  const fixture = harness();
  const { context, state } = fixture;
  assert.equal(context.currentLearningStep(), null);
  context.ensureLearningWorkflow();
  assert.equal(context.currentLearningStep(), null);
  state.workflowSelected = true;
  assert.deepEqual(pure(context.currentLearningStep()), {
    goal: 'review',
    level: 'new',
    moduleId: 'retrieve',
    phase: 'recall',
    outcome: 'unknown',
    status: 'active',
  });
  for (const mutate of [
    (fresh) => {
      fresh.state.stale = true;
    },
    (fresh) => {
      fresh.state.ready = false;
    },
    (fresh) => {
      fresh.app.userState.uid = 'student-b';
    },
    (fresh) => {
      fresh.app.userState.token = 'new-token';
    },
  ]) {
    const fresh = harness();
    fresh.context.ensureLearningWorkflow();
    fresh.state.workflowSelected = true;
    assert.notEqual(fresh.context.currentLearningStep(), null);
    mutate(fresh);
    assert.equal(fresh.context.currentLearningStep(), null);
  }
});

test('course, point, document, goal and level changes invalidate then rebuild without reviving private questions', () => {
  for (const dimension of ['course', 'point', 'document', 'goal', 'level']) {
    const fixture = harness({ goal: 'explore', level: 'familiar' });
    fixture.context.ensureLearningWorkflow();
    fixture.context.applyWorkflowAction({
      type: 'set-question',
      question: '只属于上一个范围的疑问',
    });
    fixture.state.workflowDraft = '上一个范围的本地草稿';
    const originalScope = fixture.state.workflowScope;
    if (dimension === 'course') fixture.state.course = { slug: 'math' };
    if (dimension === 'point') fixture.state.node = { ...fixture.state.node, id: 'SS-02-02' };
    if (dimension === 'document')
      fixture.state.node = { ...fixture.state.node, documentVersion: 'b'.repeat(64) };
    if (dimension === 'goal') fixture.setPreference({ goal: 'review', level: 'familiar' });
    if (dimension === 'level') fixture.setPreference({ goal: 'explore', level: 'advanced' });
    assert.equal(fixture.context.currentLearningStep(), null, dimension);
    fixture.context.ensureLearningWorkflow();
    assert.notEqual(fixture.state.workflowScope, originalScope);
    assert.equal(fixture.state.workflowDraft, '');
    assert.equal(fixture.state.workflow.question, undefined);
    assert.equal(fixture.state.workflowSelected, false);
    assert.equal(fixture.context.currentLearningStep(), null);
    assert.equal(fixture.requests.length, 0);
  }
});

test('review clear, gap, checks and finish alter only the ephemeral workflow, never saved path flags or drafts', () => {
  const fixture = harness({ level: 'advanced' });
  const before = fixture.protectedState();
  fixture.context.ensureLearningWorkflow();
  fixture.context.applyWorkflowAction({ type: 'review-gap' });
  assert.equal(fixture.context.currentLearningStep().outcome, 'gap');
  fixture.context.applyWorkflowAction({ type: 'review-check' });
  assert.equal(fixture.context.currentLearningStep().phase, 'check');
  assert.equal(fixture.requests.length, 0, 'A nonexistent exercise must not be opened');
  fixture.context.applyWorkflowAction({ type: 'review-clear' });
  assert.equal(fixture.context.currentLearningStep().status, 'finished');
  assert.equal(fixture.context.currentLearningStep().outcome, 'clear');
  assert.equal(fixture.protectedState(), before);
  assert.strictEqual(fixture.state.plan.steps, fixture.savedPath);
  assert.equal(fixture.requests.length, 0);
  fixture.context.applyWorkflowAction({ type: 'resume' });
  fixture.context.applyWorkflowAction({ type: 'finish' });
  assert.equal(fixture.protectedState(), before);
});

test('pausing and resuming keeps current intent, private drafts and the saved path without completion or requests', () => {
  const fixture = harness({ goal: 'explore' });
  fixture.context.ensureLearningWorkflow();
  fixture.context.applyWorkflowAction({ type: 'set-question', question: '当前问题' });
  fixture.state.workflowDraft = '还没提交的修订';
  const before = fixture.protectedState();
  assert.equal(fixture.context.setPlanPaused(true), true);
  assert.equal(fixture.context.currentLearningStep().status, 'paused');
  assert.equal(fixture.context.currentLearningStep().question, '当前问题');
  fixture.context.applyWorkflowAction({ type: 'resume' });
  assert.equal(fixture.context.currentLearningStep().status, 'active');
  assert.equal(fixture.state.planPaused, false);
  assert.equal(fixture.state.workflowDraft, '还没提交的修订');
  assert.equal(fixture.protectedState(), before);
  assert.equal(fixture.requests.length, 0);
});

test('manual tool or view selection clears the claimed current step; workflow navigation preserves its actual module', () => {
  const fixture = harness();
  fixture.context.ensureLearningWorkflow();
  fixture.state.workflowSelected = true;
  fixture.context.switchTool('content', { restore: false });
  assert.equal(fixture.context.currentLearningStep(), null);
  fixture.state.workflowSelected = true;
  fixture.state.workflowNavigating = true;
  fixture.context.switchTool('feedback', { restore: false });
  assert.equal(fixture.context.currentLearningStep().moduleId, 'retrieve');
  fixture.state.workflowNavigating = false;
  fixture.emit(fixture.page, 'knowledge:view-change', { view: 'reading' });
  assert.equal(fixture.context.currentLearningStep(), null);
  fixture.context.chooseWorkflowModule('read');
  assert.equal(fixture.context.currentLearningStep().moduleId, 'read');
  assert.equal(fixture.context.currentLearningStep().outcome, 'unknown');
  assert.equal(fixture.state.workflowNavigating, false);
  assert.equal(fixture.state.tool, 'content');
  assert.equal(fixture.requests.length, 0);
});

test('document-save and explicit preference-change events discard old question context but preserve ordinary drafts and custom paths', () => {
  const fixture = harness({ goal: 'explore' });
  fixture.context.ensureLearningWorkflow();
  fixture.state.workflowDraft = '旧疑问';
  fixture.context.applyWorkflowAction({ type: 'set-question', question: '旧疑问' });
  const before = fixture.protectedState();
  fixture.emit(fixture.page, 'knowledge:document-saved', {
    node: { ...fixture.state.node, documentVersion: 'c'.repeat(64) },
  });
  assert.equal(fixture.state.workflowDraft, '');
  assert.equal(fixture.context.currentLearningStep(), null);
  assert.equal(fixture.state.workflow.question, undefined);
  fixture.state.workflowDraft = '第二个旧疑问';
  fixture.context.applyWorkflowAction({ type: 'set-question', question: '第二个旧疑问' });
  fixture.state.planGoal = 'explore';
  fixture.setPreference({ goal: 'review', level: 'basic' });
  fixture.emit(fixture.window, 'learning:start-change');
  assert.equal(fixture.state.planGoal, '');
  assert.equal(fixture.state.workflow.goal, 'review');
  assert.equal(fixture.state.workflowDraft, '');
  assert.equal(fixture.context.currentLearningStep(), null);
  assert.equal(fixture.protectedState(), before);
  assert.equal(fixture.requests.length, 0);
});

test('account session changes and cross-tab storage invalidation remove another account’s question and scope', () => {
  const fixture = harness({ goal: 'explore' });
  fixture.context.ensureLearningWorkflow();
  fixture.context.applyWorkflowAction({ type: 'set-question', question: '学生甲的问题' });
  fixture.state.workflowDraft = '甲的未提交问题';
  fixture.app.userState.uid = 'student-b';
  fixture.app.userState.token = 'session-b';
  assert.equal(fixture.context.currentLearningStep(), null);
  fixture.emit(fixture.window, 'freebbs:session-change');
  assert.equal(fixture.state.workflow, null);
  assert.equal(fixture.state.workflowScope, '');
  assert.equal(fixture.state.workflowDraft, '');
  assert.equal(fixture.state.workflowSelected, false);
  fixture.context.ensureLearningWorkflow();
  assert.equal(fixture.state.workflow.question, undefined);
  fixture.state.workflowDraft = '乙的问题';
  fixture.window.dispatchEvent({ type: 'storage', key: 'free_bbs_auth_token' });
  assert.equal(fixture.state.stale, true);
  assert.equal(fixture.state.workflow, null);
  assert.equal(fixture.state.workflowDraft, '');
  assert.equal(fixture.context.currentLearningStep(), null);
});

test('only real exercise routes expose the review check action; conceptual transfer fallbacks do not fabricate one', () => {
  for (const level of ['new', 'familiar', 'basic', 'advanced']) {
    const missing = harness({ level });
    const emptyPanel = missing.render();
    assert.equal(
      missing.all(emptyPanel).some((node) => node.dataset.workflowAction === 'review-check'),
      false,
    );
    assert.equal(missing.requests.length, 0);
    const real = harness({
      level,
      practiceQuestions: [{ id: 'real-practice', assessmentRole: 'practice', difficulty: 'basic' }],
    });
    const container = real.render();
    const check = real
      .all(container)
      .find((node) => node.dataset.workflowAction === 'review-check');
    assert.ok(check);
    check.listeners.get('click')[0]();
    const navigation = real.events.find((event) => event.type === 'knowledge:navigate');
    assert.equal(navigation.detail.tool, 'feedback');
    assert.equal(navigation.detail.questionId, 'real-practice');
    assert.equal(navigation.detail.quizView, 'practice');
    assert.equal(real.context.currentLearningStep().phase, 'check');
    assert.equal(real.requests.length, 0);
    assert.equal(real.state.attempts.length, 0);
  }
});

test('typing exploration questions stays local, while explicit Max help prepares an editable draft without sending', () => {
  const fixture = harness({ goal: 'explore', level: 'new' });
  const before = fixture.protectedState();
  const container = fixture.render();
  const input = fixture.all(container).find((node) => node.tagName === 'textarea');
  input.value = '为什么边界条件会改变结果？';
  input.listeners.get('input')[0]();
  assert.equal(fixture.state.workflowDraft, input.value);
  assert.equal(fixture.state.workflow.question, undefined);
  assert.equal(
    fixture.events.some((event) => event.type === 'knowledge:open-interaction'),
    false,
  );
  const ask = fixture.all(container).find((node) => node.dataset.workflowAction === 'ask-max');
  ask.listeners.get('click')[0]();
  const open = fixture.events.find((event) => event.type === 'knowledge:open-interaction');
  assert.equal(open.detail.tab, 'max');
  assert.match(open.detail.prompt, /区分已有依据与待验证/);
  assert.equal(fixture.context.currentLearningStep().question, input.value);
  assert.equal(fixture.protectedState(), before);
  assert.equal(fixture.requests.length, 0);
});
