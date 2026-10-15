const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { labels } = require('../public/knowledge-workspace');
const { recommend } = require('../public/learning-next-steps');

test('six tools preserve existing names with readable collapsed labels', () => {
  assert.equal(Object.keys(labels).length, 6);
  assert.equal(labels.resources[0], '学习资源');
  assert.equal(labels.continue[0], '继续学习');
  Object.values(labels).forEach((value) => assert.ok(value[1].length >= 2));
});

test('the read-only temporary goal stays on this page and clears for an unready or different session', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/knowledge-workspace.js'), 'utf8');
  const start = source.indexOf('  function currentPlanGoal() {');
  const end = source.indexOf('  function sessionMessage(', start);
  assert.ok(start >= 0 && end > start);
  const state = { ready: true, uid: 'student', token: 'same-session', planGoal: 'explore' };
  const app = { userState: { uid: state.uid, token: state.token } };
  const window = {};
  vm.runInNewContext(source.slice(start, end), { state, app, window });
  assert.equal(window.FreeBbsLearningWorkspace.currentGoal(), 'explore');
  state.ready = false;
  assert.equal(window.FreeBbsLearningWorkspace.currentGoal(), '');
  state.ready = true;
  state.stale = true;
  assert.equal(window.FreeBbsLearningWorkspace.currentGoal(), '');
  state.stale = false;
  app.userState.token = 'new-session';
  assert.equal(window.FreeBbsLearningWorkspace.currentGoal(), '');
  app.userState.token = state.token;
  app.userState.uid = 'other';
  assert.equal(window.FreeBbsLearningWorkspace.currentGoal(), '');
  app.userState.uid = state.uid;
  state.planGoal = 'UNKNOWN';
  assert.equal(window.FreeBbsLearningWorkspace.currentGoal(), '');
  assert.doesNotMatch(
    source.slice(start, end),
    /callApi|localStorage|dispatchEvent|recordLearning/,
  );
});

test('pausing is presentation-only, preserves path edits and drafts, and is reversible without awarding completion', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/knowledge-workspace.js'), 'utf8');
  const code = source.slice(
    source.indexOf('  function setPlanPaused('),
    source.indexOf('  function changePlan('),
  );
  const state = {
    ready: true,
    uid: 'student',
    token: 'session',
    planPaused: false,
    plan: { steps: [{ id: 'my-step', title: '我的一步', completed: false, skipped: true }] },
    planDirty: true,
    planKey: 'pending-key',
    planRecord: { id: 'saved', revision: 2 },
    privateDraft: '我还没有写完的解释',
  };
  const preserved = JSON.stringify({ ...state, planPaused: undefined });
  let renders = 0;
  const sandbox = {
    state,
    app: { userState: { uid: 'student', token: 'session' } },
    renderPlan() {
      renders += 1;
    },
  };
  vm.runInNewContext(code, sandbox);
  assert.equal(sandbox.setPlanPaused(true), true);
  assert.equal(state.planPaused, true);
  assert.equal(JSON.stringify({ ...state, planPaused: undefined }), preserved);
  assert.equal(sandbox.setPlanPaused(false), true);
  assert.equal(state.planPaused, false);
  assert.equal(JSON.stringify({ ...state, planPaused: undefined }), preserved);
  assert.equal(renders, 2);
  assert.doesNotMatch(
    code,
    /callApi|localStorage|dispatchEvent|recordLearning|completed\s*=|skipped\s*=|resetNote/,
  );
  sandbox.app.userState.token = 'new-session';
  assert.equal(sandbox.setPlanPaused(true), false);
  assert.equal(state.planPaused, false);
  sandbox.app.userState.token = 'session';
  state.stale = true;
  assert.equal(sandbox.setPlanPaused(true), false);
});

test('background preference and evidence refresh cannot replace the path kept during a pause', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/knowledge-workspace.js'), 'utf8');
  const code = source.slice(
    source.indexOf('  function refreshPlan('),
    source.indexOf('  function setPlanPaused('),
  );
  const original = {
    label: '我的路径',
    steps: [{ id: 'my-step', completed: false, skipped: false }],
  };
  const state = { ready: true, planPaused: true, planDirty: false, plan: original };
  let recommendations = 0;
  let renders = 0;
  const sandbox = {
    state,
    window: {
      FreeBbsLearningNextSteps: {
        recommend() {
          recommendations += 1;
        },
      },
    },
    renderPlan() {
      renders += 1;
    },
  };
  vm.runInNewContext(code, sandbox);
  sandbox.refreshPlan();
  sandbox.refreshPlan();
  assert.equal(state.plan, original);
  assert.equal(state.planDirty, false);
  assert.equal(recommendations, 0);
  assert.equal(renders, 0);
});

test('missing-passage and explicit help tasks open Max without creating or sending a draft', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/knowledge-workspace.js'), 'utf8');
  const code = source.slice(
    source.indexOf('  function navigateStep('),
    source.indexOf('  function renderPlan('),
  );
  const opened = [];
  const sandbox = {
    state: {
      node: { id: 'SS-01-01', sections: { knowledgeMarkdown: '' } },
      course: { slug: 'signals' },
    },
    window: { FreeBbsLearningNextSteps: require('../public/learning-next-steps') },
    openInteraction: (tab, prompt) => opened.push({ tab, prompt }),
  };
  vm.runInNewContext(code, sandbox);
  sandbox.navigateStep({ tool: 'discussion', taskId: 'ask-max' });
  sandbox.navigateStep({ tool: 'notes', title: '旧路径里的一条笔记' });
  assert.deepEqual(opened, [
    { tab: 'max', prompt: undefined },
    { tab: 'max', prompt: undefined },
  ]);
  assert.doesNotMatch(code, /callApi|submitChatPrompt|sendMessage|form\.reset|\.value\s*=/);
});

test('origin-only annotation steps open a real annotation layer and retain that intent across points', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/knowledge-workspace.js'), 'utf8');
  const code = source.slice(
    source.indexOf('  function navigateStep('),
    source.indexOf('  function renderPlan('),
  );
  const events = [];
  const tools = [];
  const modes = [];
  const destinations = [];
  const sandbox = {
    state: { node: { id: 'SS-01-01' }, course: { slug: 'signals' } },
    window: {
      FreeBbsKnowledgeAnnotations: { setEditing: (value) => modes.push(value) },
      location: { assign: (url) => destinations.push(url) },
    },
    requestTool: (tool) => tools.push(tool),
    page: { dispatchEvent: (event) => events.push(event) },
    URLSearchParams,
    CustomEvent: function Event(type, options) {
      this.type = type;
      this.detail = options.detail;
    },
  };
  vm.runInNewContext(code, sandbox);
  const step = { tool: 'content', view: 'origin', taskId: 'annotate-origin' };
  sandbox.navigateStep(step);
  assert.deepEqual(tools, ['content']);
  assert.equal(events[0].detail.view, 'origin');
  assert.deepEqual(modes, [true]);
  sandbox.navigateStep({ ...step, point: 'SS-01-02' });
  const query = new URL(destinations[0], 'http://localhost').searchParams;
  assert.equal(query.get('focus'), 'origin');
  assert.equal(query.get('annotation'), 'origin');
  assert.equal(query.get('tool'), 'content');
  assert.doesNotMatch(code, /callApi|submitChatPrompt|sendMessage/);
});
test('next steps are editable structured suggestions driven by current course evidence', () => {
  const node = {
    id: 'SS-01-01',
    title: '连续时间卷积',
    markdown: '原有课程正文',
    documentVersion: 'current',
  };
  const questions = [{ id: 'one', official: true, questionVersion: '1' }];
  const plan = recommend({
    node,
    questions,
    recentAttempts: [
      {
        questionId: 'one',
        questionVersion: '1',
        documentVersion: 'current',
        official: true,
        status: 'graded',
        verdict: 'fail',
      },
    ],
  });
  assert.equal(plan.mode, 'repair');
  assert.equal(plan.steps[0].tool, 'feedback');
  assert.ok(plan.steps.length >= 2 && plan.steps.length <= 4);
  assert.ok(
    plan.steps.every(
      (step) => typeof step.minutes === 'number' && typeof step.completed === 'boolean',
    ),
  );
  const pending = recommend({
    node,
    questions,
    recentAttempts: [
      {
        questionId: 'one',
        questionVersion: '1',
        documentVersion: 'current',
        official: true,
        status: 'pending_review',
        verdict: null,
      },
    ],
  });
  assert.notEqual(pending.mode, 'repair');
  assert.notEqual(pending.mode, 'advance');
});
test('forms are labelled and resource/assessment boundaries are visible', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/knowledge.html'), 'utf8');
  for (const name of ['reflection', 'note', 'contribution'])
    assert.ok(html.includes(`id="learning-${name}-form"`));
  for (const id of [
    'learning-quiz-list',
    'learning-quiz-status',
    'learning-quiz-results',
    'learning-plan-steps',
    'learning-plan-save',
    'knowledge-body',
  ])
    assert.ok(html.includes(`id="${id}"`));
  assert.match(html, /主观题等待课程组复核/);
  assert.match(html, /resourceLevel/);
  assert.match(html, /来源/);
  assert.match(html, /授权情况/);
  assert.doesNotMatch(html, /id="learning-advice-generate"/);
});
test('only view preferences use localStorage, not notes or shared course data', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/knowledge-workspace.js'), 'utf8');
  assert.match(source, /localStorage\.setItem\(\s*prefKey\(\)/);
  assert.equal((source.match(/localStorage\.setItem/g) || []).length, 1);
  assert.match(source, /generation !== state.generation/);
  assert.match(source, /FreeBbsLearningNextSteps\.recommend/);
  assert.match(source, /kind: 'path'/);
  assert.match(source, /保存失败/);
});

test('start preference refresh preserves unsaved adjustments and existing saved path steps', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/knowledge-workspace.js'), 'utf8');
  const refreshSource = source.slice(
    source.indexOf('  function refreshPlan('),
    source.indexOf('  function changePlan('),
  );
  const node = { id: 'SS-01-01', title: '信号', documentVersion: 'current', markdown: '正式正文' };
  const original = {
    label: '手工调整',
    steps: [{ id: 'my-step', title: '我的一步', tool: 'notes', minutes: 3 }],
  };
  const state = {
    ready: true,
    planDirty: true,
    plan: original,
    latestPath: null,
    entries: [],
    attempts: [],
    questions: [],
    node,
  };
  let renders = 0;
  const sandbox = {
    state,
    window: {
      FreeBbsLearningNextSteps: { recommend },
      FreeBbsLearningStart: { currentPreference: () => ({ level: 'advanced', goal: 'explore' }) },
      freeBbsKnowledge: { getLearningContext: () => ({ tags: {}, map: {} }) },
    },
    renderPlan: () => {
      renders += 1;
    },
  };
  vm.runInNewContext(refreshSource, sandbox);
  sandbox.refreshPlan();
  assert.equal(state.plan, original);
  assert.equal(state.planDirty, true);
  assert.equal(renders, 0);
  state.planDirty = false;
  state.latestPath = { id: '7', documentVersion: 'current', path: original.steps };
  sandbox.refreshPlan();
  assert.equal(state.plan.mode, 'resume');
  assert.deepEqual(
    state.plan.steps.map((step) => step.id),
    ['my-step'],
  );
  assert.equal(state.planRecord.id, '7');
  state.latestPath = null;
  sandbox.refreshPlan();
  assert.equal(state.plan.strategy.key, 'advanced:explore');
  assert.equal(renders, 2);
  assert.match(source, /window\.addEventListener\('learning:start-change'/);
  assert.match(source, /state\.uid !== \(app\.userState\?\.uid \|\| ''\)/);
  assert.match(source, /state\.token !== \(app\.userState\?\.token \|\| ''\)/);
});

test('thinking questions open Max drafts only and are removed during session resets', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/knowledge-workspace.js'), 'utf8');
  const renderSource = source.slice(
    source.indexOf('  function renderPlan('),
    source.indexOf('  async function savePlan('),
  );
  const elements = new Map();
  const opened = [];
  function element(tag, value = '', className = '') {
    return {
      tag,
      textContent: value,
      className,
      children: [],
      events: {},
      classList: { toggle: () => {} },
      replaceChildren() {
        this.children = [];
      },
      append(...children) {
        this.children.push(...children);
        children.forEach((child) => {
          if (child.id) elements.set(child.id, child);
        });
      },
      before(sibling) {
        if (sibling.id) elements.set(sibling.id, sibling);
      },
      after(sibling) {
        elements.set(sibling.id, sibling);
      },
      addEventListener(name, handler) {
        this.events[name] = handler;
      },
    };
  }
  const el = (id) => elements.get(`learning-${id}`);
  for (const id of [
    'plan-title',
    'plan-reason',
    'plan-tip',
    'plan-steps',
    'plan-total',
    'plan-save',
  ])
    elements.set(`learning-${id}`, element('div'));
  const questions = ['能用自己的话解释吗？', '哪些条件需要注意？', '与什么概念有关？'];
  const sandbox = {
    state: { plan: { label: '开始', reason: '', tip: '', steps: [], questions }, busy: false },
    el,
    text: element,
    show: (target, visible) => {
      Object.assign(target, { hidden: !visible });
    },
    window: { FreeBbsLearningNextSteps: require('../public/learning-next-steps') },
    openInteraction: (tab, prompt) => opened.push({ tab, prompt }),
  };
  vm.runInNewContext(renderSource, sandbox);
  sandbox.renderPlan();
  const prompts = el('plan-prompts');
  assert.equal(prompts.hidden, false);
  assert.equal(prompts.children[0].textContent, '可选思考问题');
  const items = prompts.children.slice(1);
  assert.equal(items.length, 3);
  assert.equal(items[0].children[0].textContent, questions[0], 'Thinking is possible without Max');
  items[0].children[1].events.click();
  assert.deepEqual(opened, [{ tab: 'max', prompt: questions[0] }]);
  assert.doesNotMatch(renderSource, /submitChatPrompt|sendMessage|callApi|innerHTML/);
  assert.match(source, /el\('plan-prompts'\)\?\.remove\(\)/);
  sandbox.state.plan.questions = [];
  sandbox.renderPlan();
  assert.equal(prompts.hidden, true);
  assert.equal(prompts.children.length, 0);
});

test('annotation mode opens only the icon layer on the canonical reader, never a moved notes panel', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/knowledge-workspace.js'), 'utf8');
  const switchSource = source.slice(
    source.indexOf('  function switchTool('),
    source.indexOf('  function requestTool('),
  );
  const nodes = new Map();
  const elements = (id) => {
    if (!nodes.has(id))
      nodes.set(id, { hidden: false, textContent: '', focus() {}, classList: { toggle() {} } });
    return nodes.get(id);
  };
  const notes = elements('notes');
  const annotationModes = [];
  const events = [];
  const page = {
    dataset: {},
    dispatchEvent(event) {
      events.push(event.type);
      if (event.type === 'knowledge:show-content') {
        elements('knowledge-reading').hidden = false;
        elements('knowledge-overview').hidden = true;
      }
    },
  };
  const panels = ['feedback', 'continue', 'contribute'].map((tool) => ({
    dataset: { learningPanel: tool },
    hidden: false,
  }));
  const root = { hidden: false, querySelectorAll: () => panels };
  const state = { ready: false, positions: {}, tool: 'feedback', restoring: false };
  const sandbox = {
    labels,
    state,
    page,
    root,
    document: {
      querySelectorAll: () => [],
      getElementById: elements,
      querySelector: (selector) => (selector.includes('notes') ? notes : null),
    },
    window: {
      scrollY: 0,
      FreeBbsKnowledgeAnnotations: {
        refresh() {},
        setEditing(enabled) {
          annotationModes.push(enabled);
        },
      },
    },
    scrollPosition: () => 275,
    scrollHost: () => ({ scrollTo() {} }),
    el: elements,
    show: (element, visible) => {
      if (element) element.hidden = !visible;
    },
    keepPreference() {},
    refreshPlan() {},
    loggedIn: () => false,
    CustomEvent: function Event(type) {
      this.type = type;
    },
  };
  vm.runInNewContext(switchSource, sandbox);
  sandbox.switchTool('notes', { restore: false, preserveView: true });
  assert.equal(root.hidden, true);
  assert.equal(notes.hidden, true);
  assert.deepEqual(annotationModes, [true]);
  assert.equal(elements('knowledge-reading').hidden, false);
  assert.equal(elements('knowledge-overview').hidden, true);
  assert.ok(events.includes('knowledge:show-content'));
  sandbox.switchTool('feedback', { restore: false });
  assert.equal(root.hidden, false);
  assert.equal(notes.hidden, true);
  assert.deepEqual(annotationModes, [true, false]);
  sandbox.switchTool('content', { restore: false });
  assert.equal(root.hidden, true);
  assert.equal(notes.hidden, true);
  assert.deepEqual(annotationModes, [true, false, false]);
  assert.equal(elements('knowledge-reading').hidden, false);
  state.ready = true;
  events.length = 0;
  sandbox.switchTool('feedback', { restore: false });
  sandbox.switchTool('feedback', { restore: false });
  assert.equal(
    events.filter((event) => event === 'knowledge:tool-change').length,
    1,
    'repeated tool-select from guide, navigation or a delayed question must not duplicate tool-open events',
  );
});

test('navigation uses explicit course resource anchors; opening a recommendation never sends a Max question', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/knowledge-workspace.js'), 'utf8');
  const code = source.slice(
    source.indexOf('  function runStep('),
    source.indexOf('  function renderPlan('),
  );
  const events = [];
  const choices = [];
  const tools = [];
  const state = {
    uid: '1',
    token: 'token',
    course: { slug: 'signals' },
    node: { id: 'SS-01-01', documentVersion: 'current' },
    stale: false,
  };
  const sandbox = {
    state,
    app: { userState: { uid: '1', token: 'token' } },
    window: {
      FreeBbsLearningStart: { currentPreference: () => ({ level: 'basic', goal: '' }) },
      FreeBbsLearningAnalytics: { recordLearningChoice: (value) => choices.push(value) },
    },
    page: { dispatchEvent: (event) => events.push(event) },
    requestTool: (tool) => tools.push(tool),
    CustomEvent: function Event(type, options) {
      this.type = type;
      this.detail = options.detail;
    },
  };
  vm.runInNewContext(code, sandbox);
  sandbox.runStep(
    { title: '做一道题', tool: 'feedback', quizView: 'practice', questionId: 'practice-1' },
    'alternative',
  );
  assert.deepEqual(tools, ['feedback']);
  assert.equal(events[0].type, 'knowledge:navigate');
  assert.equal(events[0].detail.questionId, 'practice-1');
  assert.equal(events[0].detail.quizView, 'practice');
  assert.equal(choices[0].goal, null);
  assert.equal(choices[0].pathType, 'alternative');
  state.stale = true;
  sandbox.runStep({ tool: 'content', view: 'origin' });
  assert.equal(choices.length, 1);
  assert.doesNotMatch(code, /submitChatPrompt|sendMessage|knowledge:ask|callApi/);
});

test('switching accounts immediately clears private path text and the collapsed editor, not only step records', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/knowledge-workspace.js'), 'utf8');
  const from = source.indexOf('  function resetSession(');
  const code = source.slice(
    from,
    source.indexOf("  document.querySelectorAll('[data-knowledge-tool]')", from),
  );
  const elements = new Map();
  const el = (id) => {
    if (!elements.has(id))
      elements.set(id, {
        textContent: 'PRIVATE_PATH',
        open: true,
        replaceChildren() {},
        remove() {
          this.removed = true;
        },
      });
    return elements.get(id);
  };
  const state = {
    generation: 7,
    ready: false,
    planGoal: 'explore',
    plan: { label: 'PRIVATE_PATH' },
  };
  const sandbox = {
    state,
    app: { userState: { uid: 'other', token: 'other-token' } },
    page: { querySelectorAll: () => [] },
    root: { querySelectorAll: () => [] },
    el,
    resetNote() {},
    syncContributionForm() {},
    renderEntries() {},
    sessionMessage() {},
    show() {},
  };
  vm.runInNewContext(code, sandbox);
  sandbox.resetSession();
  assert.equal(state.generation, 8);
  assert.equal(state.uid, 'other');
  assert.equal(state.plan, null);
  assert.equal(state.planGoal, '');
  assert.equal(state.planPaused, false);
  for (const id of ['plan-reason', 'plan-tip', 'plan-total', 'plan-chain'])
    assert.equal(el(id).textContent, '');
  assert.equal(el('plan-title').textContent, '下一步');
  assert.equal(el('plan-editor').open, false);
  assert.equal(el('plan-prompts').removed, true);
  assert.equal(el('plan-pause').removed, true);
});

test('real path edits remain dirty and cannot be overwritten by late assessment, start or saved-record refreshes', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/knowledge-workspace.js'), 'utf8');
  const code = source.slice(
    source.indexOf('  function refreshPlan('),
    source.indexOf('  function runStep('),
  );
  const nextSteps = require('../public/learning-next-steps');
  let preference = { level: 'familiar', goal: 'concepts' };
  const state = {
    ready: true,
    planDirty: false,
    node: { id: 'SS-01-01', markdown: '正文', documentVersion: 'current' },
    latestPath: null,
    entries: [],
    attempts: [],
    questions: [],
    practiceQuestions: [],
  };
  const status = { textContent: '' };
  const sandbox = {
    state,
    el: () => status,
    renderPlan() {},
    window: {
      FreeBbsLearningNextSteps: nextSteps,
      FreeBbsLearningStart: { currentPreference: () => preference },
      freeBbsKnowledge: { getLearningContext: () => ({ tags: {}, map: {} }) },
    },
  };
  vm.runInNewContext(code, sandbox);
  sandbox.refreshPlan();
  const before = state.plan.steps.map((step) => step.id);
  sandbox.changePlan(() => {
    state.plan.steps = nextSteps.reorderStep(state.plan.steps, before[0], 1);
  });
  const reordered = JSON.stringify(state.plan.steps);
  assert.equal(state.planDirty, true);
  assert.equal(status.textContent, '尚未保存');
  await Promise.resolve();
  preference = { level: 'advanced', goal: 'explore' };
  state.latestPath = {
    id: 'late-record',
    path: [{ id: 'late-step', title: '迟到的已保存路径', tool: 'notes', minutes: 3 }],
  };
  state.attempts = [
    { official: true, questionId: 'q', documentVersion: 'current', status: 'pending_review' },
  ];
  sandbox.refreshPlan();
  sandbox.refreshPlan();
  sandbox.refreshPlan();
  assert.equal(JSON.stringify(state.plan.steps), reordered);
  assert.deepEqual(
    state.plan.steps.map((step) => step.id),
    [before[1], before[0], ...before.slice(2)],
  );
  assert.equal(state.planDirty, true);
});

function pathAcknowledgmentHarness(existingRevision = null) {
  const source = fs.readFileSync(path.join(__dirname, '../public/knowledge-workspace.js'), 'utf8');
  const steps = require('../public/learning-next-steps');
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const plan = {
    label: '我的路径',
    reason: '本人选择',
    steps: steps.normalizePath([
      { id: 'read', title: '阅读', tool: 'content', minutes: 5, completed: false, skipped: false },
      { id: 'try', title: '尝试', tool: 'feedback', minutes: 5, completed: false, skipped: false },
    ]),
  };
  let stored = existingRevision
    ? { id: 'saved-path', kind: 'path', revision: existingRevision, path: clone(plan.steps) }
    : null;
  const state = {
    ready: true,
    generation: 1,
    busy: false,
    plan: clone(plan),
    planRecord: stored ? clone(stored) : null,
    planDirty: true,
    planKey: null,
    node: { id: 'SS-01-01', markdown: '正文', documentVersion: 'current' },
    entries: [],
    attempts: [],
    questions: [],
    practiceQuestions: [],
  };
  const requests = [];
  const events = [];
  const status = { textContent: '' };
  let release;
  let entered;
  let failFirst = false;
  const written = new Promise((resolve) => {
    entered = resolve;
  });
  const receipt = new Promise((resolve) => {
    release = resolve;
  });
  const scope = {
    state,
    el: () => status,
    renderPlan() {},
    loggedIn: () => true,
    endpoint: () => '/learning/signals/SS-01-01',
    page: { dispatchEvent: (event) => events.push(event) },
    CustomEvent: class {
      constructor(type, options) {
        this.type = type;
        this.detail = options.detail;
      }
    },
    window: {
      crypto: { randomUUID: () => `path-key-${requests.length + 1}` },
      FreeBbsLearningNextSteps: steps,
      FreeBbsLearningStart: { currentPreference: () => null },
      freeBbsKnowledge: { getLearningContext: () => ({ tags: {}, map: {} }) },
    },
    app: {
      callApi: async (url, options) => {
        const body = JSON.parse(options.body);
        requests.push({ url, method: options.method, body });
        const first = requests.length === 1;
        if (options.method === 'PUT' && body.revision !== stored.revision)
          throw Object.assign(new Error('路径已变更，请核对后重试'), { status: 409 });
        if (!first || !failFirst)
          stored = {
            id: stored?.id || 'saved-path',
            kind: 'path',
            revision: stored ? stored.revision + 1 : 1,
            path: clone(body.path),
            title: body.title,
            content: body.content,
          };
        const payload = options.method === 'POST' ? { entry: clone(stored) } : { ok: true };
        if (first) {
          entered();
          await receipt;
        }
        if (first && failFirst)
          throw Object.assign(new Error('本地明确的保存失败'), { status: 503 });
        return payload;
      },
    },
    loadEntries: async () => {
      state.latestPath = clone(stored);
      scope.refreshPlan();
    },
  };
  vm.runInNewContext(
    source.slice(source.indexOf('  function refreshPlan('), source.indexOf('  function runStep(')) +
      source.slice(
        source.indexOf('  async function savePlan('),
        source.indexOf('  function syncContributionForm('),
      ),
    scope,
  );
  const editB = () =>
    scope.changePlan(() => {
      state.plan.steps = steps.toggleStep(state.plan.steps, 'read');
      state.plan.steps = steps.reorderStep(state.plan.steps, 'read', 1);
    });
  return {
    state,
    scope,
    requests,
    events,
    status,
    written,
    release,
    editB,
    stored: () => clone(stored),
    concurrentChange: () => {
      stored = { ...stored, revision: stored.revision + 1 };
    },
    fail: () => {
      failFirst = true;
    },
  };
}

for (const initialRevision of [null, 5]) {
  test(`a delayed ${initialRevision ? 'PUT' : 'POST'} path receipt preserves newer B and its next explicit save uses the confirmed base`, async () => {
    const h = pathAcknowledgmentHarness(initialRevision);
    const first = h.scope.savePlan();
    await h.written;
    assert.equal(h.status.textContent, '正在保存…');
    // A harmless exact-record refresh can replace the object before the user edits.
    if (initialRevision) h.state.planRecord = { ...h.state.planRecord };
    h.editB();
    const b = JSON.stringify(h.state.plan.steps);
    h.release();
    await first;
    assert.equal(JSON.stringify(h.state.plan.steps), b);
    assert.equal(h.state.planDirty, true);
    assert.match(h.status.textContent, /当前调整.*未保存/);
    assert.notEqual(JSON.stringify(h.stored().path), b);
    assert.equal(h.state.planRecord.revision, (initialRevision || 0) + 1);
    await h.scope.savePlan();
    assert.equal(h.requests[1].method, 'PUT');
    assert.equal(h.requests[1].body.revision, (initialRevision || 0) + 1);
    assert.notEqual(h.requests[0].body.requestKey, h.requests[1].body.requestKey);
    assert.equal(JSON.stringify(h.stored().path), b);
    assert.equal(h.state.planDirty, false);
    assert.equal(h.status.textContent, '已保存');
    assert.equal(h.events.length, 2);
  });
}

test('an unchanged path acknowledgment clears dirty state and records only its exact saved path', async () => {
  const h = pathAcknowledgmentHarness();
  const before = JSON.stringify(h.state.plan.steps);
  const saving = h.scope.savePlan();
  await h.written;
  h.release();
  await saving;
  assert.equal(h.state.planDirty, false);
  assert.equal(h.state.planKey, null);
  assert.equal(JSON.stringify(h.state.plan.steps), before);
  assert.equal(h.status.textContent, '已保存');
});

test('a genuine later path revision still conflicts and preserves B instead of accepting an arbitrary newer record', async () => {
  const h = pathAcknowledgmentHarness(5);
  const saving = h.scope.savePlan();
  await h.written;
  h.editB();
  const b = JSON.stringify(h.state.plan.steps);
  h.concurrentChange();
  h.release();
  await saving;
  assert.equal(h.state.planRecord.revision, 6, 'only the own A write is confirmed');
  await h.scope.savePlan();
  assert.equal(h.requests[1].body.revision, 6);
  assert.equal(h.stored().revision, 7);
  assert.equal(JSON.stringify(h.state.plan.steps), b);
  assert.equal(h.state.planDirty, true);
  assert.match(h.status.textContent, /保存失败.*路径已变更/);
});

test('a failed path save does not erase newer adjustments or announce a saved event', async () => {
  const h = pathAcknowledgmentHarness(5);
  h.fail();
  const saving = h.scope.savePlan();
  await h.written;
  h.editB();
  const b = JSON.stringify(h.state.plan.steps);
  h.release();
  await saving;
  assert.equal(JSON.stringify(h.state.plan.steps), b);
  assert.equal(h.state.planDirty, true);
  assert.equal(h.state.busy, false);
  assert.equal(h.state.planRecord.revision, 5);
  assert.equal(h.events.length, 0);
  assert.match(h.status.textContent, /保存失败/);
});

test('a path reply from the old generation does not replace a new account path or publish its event', async () => {
  const h = pathAcknowledgmentHarness();
  const saving = h.scope.savePlan();
  await h.written;
  h.state.generation += 1;
  h.state.plan = { label: '另一账号的路径', reason: '本人选择', steps: [] };
  h.state.planRecord = null;
  h.state.planDirty = false;
  h.state.busy = false;
  h.release();
  await saving;
  assert.equal(h.state.plan.label, '另一账号的路径');
  assert.equal(h.state.planRecord, null);
  assert.equal(h.state.planDirty, false);
  assert.equal(h.events.length, 0);
});

function formAcknowledgmentHarness({ holdSave = false, holdList = false } = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../public/knowledge-workspace.js'), 'utf8');
  const start = source.indexOf('  async function saveForm(');
  const end = source.indexOf('  function draftAnswer(', start);
  assert.ok(start >= 0 && end > start);
  const deferred = () => {
    let resolve;
    const promise = new Promise((done) => {
      resolve = done;
    });
    return { promise, resolve };
  };
  const saveGate = deferred();
  const saveStarted = deferred();
  const listGate = deferred();
  const listStarted = deferred();
  if (!holdSave) saveGate.resolve();
  if (!holdList) listGate.resolve();
  const state = { generation: 1, busy: false, editing: null, contributionAnchor: null };
  const control = { disabled: false };
  const form = {
    dataset: {},
    resetCount: 0,
    querySelectorAll: () => [control],
    reset() {
      this.resetCount += 1;
    },
  };
  const events = [];
  const messages = [];
  let listCalls = 0;
  const scope = {
    state,
    loggedIn: () => true,
    FormData: function FormDataFixture() {
      return [
        ['title', '隔离合成投稿'],
        ['category', 'correction'],
        ['content', '明确本地未真实提交的建议'],
      ];
    },
    window: { crypto: { randomUUID: () => 'fixture-request' } },
    app: {
      callApi: async () => {
        saveStarted.resolve();
        await saveGate.promise;
        return { ok: true };
      },
    },
    endpoint: () => '/isolated-form-contract',
    status: (_form, text) => messages.push(text),
    resetNote: () => {},
    syncContributionForm: () => {},
    loadEntries: async () => {
      listCalls += 1;
      listStarted.resolve();
      await listGate.promise;
    },
    page: { dispatchEvent: (event) => events.push(event) },
    CustomEvent: function CustomEventFixture(type, options) {
      return { type, detail: options.detail };
    },
  };
  vm.runInNewContext(`${source.slice(start, end)}\nthis.saveForm = saveForm;`, scope);
  return {
    state,
    form,
    control,
    events,
    messages,
    scope,
    saveStarted: saveStarted.promise,
    listStarted: listStarted.promise,
    releaseSave: saveGate.resolve,
    releaseList: listGate.resolve,
    listCalls: () => listCalls,
  };
}

test('a current contribution acknowledgment announces its own success once while ordinary notes do not announce a contribution', async () => {
  for (const kind of ['contribution', 'note']) {
    const h = formAcknowledgmentHarness();
    await h.scope.saveForm(h.form, kind);
    assert.equal(h.form.resetCount, 1);
    assert.equal(h.state.busy, false);
    assert.equal(h.control.disabled, false);
    assert.equal(h.listCalls(), 1);
    assert.equal(h.events.length, 1);
    if (kind === 'contribution') {
      assert.equal(h.events[0].type, 'knowledge:contribution-saved');
      assert.equal(h.events[0].detail.success, true);
    } else {
      assert.equal(h.events[0].type, 'knowledge:personal-saved');
      assert.equal(h.events[0].detail.kind, 'note');
    }
  }
});

test('an old form save acknowledgment cannot reset a new context or announce its contribution', async () => {
  const h = formAcknowledgmentHarness({ holdSave: true });
  const saving = h.scope.saveForm(h.form, 'contribution');
  await h.saveStarted;
  h.state.generation += 1;
  h.state.busy = true;
  h.releaseSave();
  await saving;
  assert.equal(h.form.resetCount, 0);
  assert.equal(h.listCalls(), 0);
  assert.equal(h.events.length, 0);
  assert.equal(h.state.busy, true, 'Old finally cannot unlock the newer context');
});

test('a contribution acknowledgment delayed by list reload cannot announce success in a newer context', async () => {
  const h = formAcknowledgmentHarness({ holdList: true });
  const saving = h.scope.saveForm(h.form, 'contribution');
  await h.listStarted;
  assert.equal(h.form.resetCount, 1, 'Its own confirmed form was reset before the context changed');
  h.state.generation += 1;
  h.state.busy = true;
  h.releaseList();
  await saving;
  assert.equal(
    h.events.length,
    0,
    'Old success must not be attributed to the new analytics context',
  );
  assert.equal(h.state.busy, true);
});
