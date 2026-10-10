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
  const buttons = prompts.children.slice(1);
  assert.equal(buttons.length, 3);
  buttons[0].events.click();
  assert.deepEqual(opened, [{ tab: 'max', prompt: questions[0] }]);
  assert.doesNotMatch(renderSource, /submitChatPrompt|sendMessage|callApi|innerHTML/);
  assert.match(source, /el\('plan-prompts'\)\?\.remove\(\)/);
  sandbox.state.plan.questions = [];
  sandbox.renderPlan();
  assert.equal(prompts.hidden, true);
  assert.equal(prompts.children.length, 0);
});

test('annotation mode uses the official reading view and independently shows the moved notes panel', () => {
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
    window: { scrollY: 0, FreeBbsKnowledgeAnnotations: { refresh() {} } },
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
  assert.equal(notes.hidden, false);
  assert.equal(elements('knowledge-reading').hidden, false);
  assert.equal(elements('knowledge-overview').hidden, true);
  assert.ok(events.includes('knowledge:show-content'));
  sandbox.switchTool('feedback', { restore: false });
  assert.equal(root.hidden, false);
  assert.equal(notes.hidden, true);
  sandbox.switchTool('content', { restore: false });
  assert.equal(root.hidden, true);
  assert.equal(notes.hidden, true);
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
  for (const id of ['plan-reason', 'plan-tip', 'plan-total', 'plan-chain'])
    assert.equal(el(id).textContent, '');
  assert.equal(el('plan-title').textContent, '下一步');
  assert.equal(el('plan-editor').open, false);
  assert.equal(el('plan-prompts').removed, true);
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
