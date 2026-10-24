const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const panel = require('../public/learning-workflow-panel');
const workflow = require('../public/learning-workflow');

const { createSession, reduceSession } = workflow;
const levels = ['new', 'familiar', 'basic', 'advanced'];

class Element {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName;
    this.ownerDocument = ownerDocument;
    this.dataset = {};
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.textContent = '';
    this.value = '';
  }

  append(...children) {
    children.forEach((child) => {
      child.parentNode = this;
      this.children.push(child);
    });
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  addEventListener(name, listener) {
    this.listeners[name] = listener;
  }

  set innerHTML(value) {
    throw new Error(`Unsafe HTML insertion into ${this.tagName}: ${value}`);
  }
}

function harness(value = {}) {
  const events = [];
  const document = { createElement: (tag) => new Element(tag, document) };
  const container = document.createElement('div');
  const options = { session: createSession({ goal: 'review', level: 'new' }), ...value };
  const handlers = Object.fromEntries(
    ['action', 'module', 'ask', 'draft'].map((type) => [
      type,
      (payload) => events.push({ type, payload }),
    ]),
  );
  const all = (node = container) => [node, ...node.children.flatMap((child) => all(child))];
  const text = () =>
    all()
      .map((node) => node.textContent)
      .join(' ');
  const action = (type) => all().find((node) => node.dataset.workflowAction === type);
  const moduleButton = (id) => all().find((node) => node.dataset.workflowModule === id);
  const render = () => panel.render(container, options, handlers);
  return {
    container,
    document,
    options,
    handlers,
    events,
    all,
    text,
    action,
    moduleButton,
    render,
  };
}

test('only supported ephemeral review/exploration sessions append a panel', () => {
  for (const goal of ['concepts', 'practice']) {
    const fixture = harness({ session: createSession({ goal, level: 'new' }) });
    assert.equal(fixture.render(), false);
    assert.equal(fixture.container.children.length, 0);
  }
  const fixture = harness();
  assert.equal(panel.render(null, fixture.options, fixture.handlers), false);
  assert.equal(panel.render(fixture.container, { session: null }, fixture.handlers), false);
  assert.equal(fixture.render(), true);
  assert.equal(fixture.container.children.length, 1);
  assert.equal(fixture.container.children[0].id, 'learning-workflow-card');
  assert.equal(fixture.all().find((node) => node.tagName === 'h3').tabIndex, -1);
  assert.equal(fixture.container.children[0].attributes['aria-label'], '这次复习');
});

test('all four review levels can report clear recall and finish without reading or exercises', () => {
  for (const level of levels) {
    const fixture = harness({
      session: createSession({ goal: 'review', level }),
      hasPractice: false,
      hasContent: false,
    });
    assert.equal(fixture.render(), true);
    assert.match(fixture.text(), /先回忆，或直接试一道/);
    assert.ok(fixture.action('review-clear'));
    assert.ok(fixture.action('review-gap'));
    assert.equal(fixture.action('review-check'), undefined);
    assert.equal(fixture.moduleButton('read'), undefined);
    assert.equal(fixture.events.length, 0);
    fixture.action('review-clear').listeners.click();
    assert.deepEqual(fixture.events, [{ type: 'action', payload: { type: 'review-clear' } }]);
    const finished = reduceSession(fixture.options.session, fixture.events[0].payload);
    assert.equal(finished.phase, 'finished');
    assert.equal(finished.moduleId, 'retrieve');
  }
});

test('direct checks appear only when a real exercise is available and do not imply reading completion', () => {
  const fixture = harness({ hasPractice: true });
  fixture.render();
  fixture.action('review-check').listeners.click();
  assert.deepEqual(fixture.events, [{ type: 'action', payload: { type: 'review-check' } }]);
  assert.equal(fixture.moduleButton('read'), undefined);
});

test('a reported review gap presents targeted lookup, optional checks and an explicit clear ending', () => {
  const session = reduceSession(createSession({ goal: 'review', level: 'familiar' }), {
    type: 'review-gap',
  });
  const fixture = harness({ session, hasContent: true, hasPractice: true });
  fixture.render();
  assert.match(fixture.text(), /只补卡住的这一处/);
  assert.match(fixture.text(), /不需要重读全文/);
  fixture.moduleButton('read').listeners.click();
  fixture.action('ask-max').listeners.click();
  fixture.action('review-check').listeners.click();
  assert.equal(fixture.events[0].type, 'module');
  assert.equal(fixture.events[0].payload, 'read');
  assert.equal(fixture.events[1].type, 'ask');
  assert.match(fixture.events[1].payload, /先问清我卡在哪里/);
  assert.deepEqual(fixture.events[2], { type: 'action', payload: { type: 'review-check' } });
  assert.equal(session.phase, 'repair', 'Rendering and callbacks do not mutate caller state');
  const missing = harness({ session, hasContent: false, hasPractice: false });
  missing.render();
  assert.equal(missing.moduleButton('read'), undefined);
  assert.equal(missing.action('review-check'), undefined);
  assert.ok(missing.action('ask-max'));
  assert.ok(missing.action('review-clear'));
});

test('review checking lets the learner identify a remaining gap or end without declaring a formal result', () => {
  const session = reduceSession(createSession({ goal: 'review', level: 'advanced' }), {
    type: 'review-check',
  });
  const fixture = harness({ session });
  fixture.render();
  assert.match(fixture.text(), /核对一下，顺利就结束/);
  assert.ok(fixture.action('review-clear'));
  assert.ok(fixture.action('review-gap'));
  assert.equal(fixture.moduleButton('read'), undefined);
  assert.doesNotMatch(fixture.text(), /你已掌握|已通过|授星/);
});

test('every exploration level begins with a personal question and accepts an empty question without gating', () => {
  for (const level of levels) {
    const fixture = harness({ session: createSession({ goal: 'explore', level }) });
    fixture.render();
    assert.match(fixture.text(), /先从你关心的问题出发/);
    const input = fixture.all().find((node) => node.tagName === 'textarea');
    assert.equal(input.maxLength, 1000);
    assert.equal(input.rows, 2);
    assert.equal(input.parentNode.tagName, 'label');
    assert.equal(input.parentNode.textContent, '我想弄清的问题');
    assert.equal(input.value, '');
    assert.notEqual(fixture.action('set-question').disabled, true);
    fixture.action('set-question').listeners.click();
    assert.deepEqual(fixture.events, [
      { type: 'action', payload: { type: 'set-question', question: '' } },
    ]);
    assert.equal(
      reduceSession(fixture.options.session, fixture.events[0].payload).phase,
      'investigate',
    );
    fixture.moduleButton('explore').listeners.click();
    assert.deepEqual(fixture.events[1], { type: 'module', payload: 'explore' });
  }
});

test('question typing only retains a local draft; applying explicitly uses the live value', () => {
  const fixture = harness({
    session: createSession({ goal: 'explore', level: 'basic' }),
    questionDraft: '尚未提交的疑问',
  });
  fixture.render();
  const input = fixture.all().find((node) => node.tagName === 'textarea');
  assert.equal(input.value, '尚未提交的疑问');
  input.value = '如果改变一个条件呢？';
  input.listeners.input();
  assert.deepEqual(fixture.events, [{ type: 'draft', payload: input.value }]);
  assert.equal(fixture.options.session.phase, 'question');
  assert.equal(fixture.options.session.question, undefined);
  fixture.action('set-question').listeners.click();
  assert.deepEqual(fixture.events[1], {
    type: 'action',
    payload: { type: 'set-question', question: input.value },
  });
  assert.equal(fixture.events.filter((event) => event.type === 'ask').length, 0);
});

test('only valid, genuinely available module choices are offered in an optional native disclosure', () => {
  const fixture = harness({
    session: createSession({ goal: 'explore', level: 'new' }),
    hasContent: true,
    hasPractice: false,
    modules: [
      { moduleId: 'read', title: '定点查原文', available: true },
      { moduleId: 'origin', title: '知识起源', available: true },
      { moduleId: 'worked-example', title: '不存在的示例', available: false },
      { moduleId: 'practice', title: '不存在的练习', available: true },
      { moduleId: 'read', title: '重复入口', available: true },
      { moduleId: 'admin', title: '越界入口', available: true },
      { moduleId: '__proto__', available: true },
    ],
  });
  fixture.render();
  const details = fixture.all().find((node) => node.tagName === 'details');
  assert.ok(details);
  assert.equal(details.children[0].textContent, '按需找资料或检验');
  assert.notEqual(details.open, true);
  assert.ok(fixture.moduleButton('read'));
  assert.ok(fixture.moduleButton('origin'));
  assert.equal(fixture.moduleButton('practice'), undefined);
  assert.equal(fixture.moduleButton('worked-example'), undefined);
  assert.equal(fixture.moduleButton('admin'), undefined);
  assert.equal(fixture.all().filter((node) => node.dataset.workflowModule === 'read').length, 1);
  assert.doesNotMatch(fixture.text(), /不存在|越界|重复入口/);
  fixture.moduleButton('origin').listeners.click();
  assert.deepEqual(fixture.events, [{ type: 'module', payload: 'origin' }]);
});

test('no authored materials are fabricated, and user prose is inserted only as text and textarea value', () => {
  const source = '<img src=x onerror=alert(1)> & <script>bad()</script>';
  const fixture = harness({
    session: reduceSession(createSession({ goal: 'explore', level: 'advanced' }), {
      type: 'set-question',
      question: source,
    }),
    modules: [{ moduleId: 'read', title: source, available: true }],
    hasContent: false,
  });
  fixture.render();
  assert.equal(fixture.all().find((node) => node.tagName === 'textarea').value, source);
  assert.equal(
    fixture.all().some((node) => node.tagName === 'img' || node.tagName === 'script'),
    false,
  );
  assert.equal(fixture.moduleButton('read'), undefined);
  assert.equal(
    fixture.all().find((node) => node.tagName === 'details'),
    undefined,
  );
  assert.ok(fixture.action('ask-max'));
  assert.ok(fixture.action('finish'));
  assert.equal(fixture.events.length, 0);
});

test('finished and paused panels offer only an explicit return, not more compulsory reading or exercises', () => {
  for (const goal of ['review', 'explore']) {
    const finished = harness({
      session: reduceSession(createSession({ goal, level: 'basic' }), { type: 'finish' }),
    });
    finished.render();
    assert.match(finished.text(), /本次先到这里/);
    assert.match(finished.text(), /不代表正式测评通过/);
    assert.equal(finished.all().filter((node) => node.tagName === 'button').length, 1);
    assert.equal(
      finished.all().some((node) => node.tagName === 'textarea'),
      false,
    );
    finished.action('resume').listeners.click();
    assert.deepEqual(finished.events, [{ type: 'action', payload: { type: 'resume' } }]);
    const paused = harness({ session: createSession({ goal, level: 'basic' }), paused: true });
    paused.render();
    assert.match(paused.text(), /本次先暂停/);
    assert.equal(paused.all().filter((node) => node.tagName === 'button').length, 1);
    assert.ok(paused.action('resume'));
  }
});

test('every control is a non-submitting native button; missing handlers fail closed', () => {
  const fixture = harness({ session: createSession({ goal: 'explore', level: 'new' }) });
  assert.equal(panel.render(fixture.container, fixture.options), true);
  fixture
    .all()
    .filter((node) => node.tagName === 'button')
    .forEach((button) => {
      assert.equal(button.type, 'button');
      assert.equal(button.disabled, true);
    });
});

test('browser integration exposes only render and uses no storage, network, grading or automatic chat', () => {
  const file = fs.readFileSync(
    path.join(__dirname, '../public/learning-workflow-panel.js'),
    'utf8',
  );
  const fixture = harness();
  const browser = { window: { FreeBbsLearningWorkflow: workflow } };
  vm.createContext(browser);
  vm.runInContext(file, browser);
  assert.deepEqual(Object.keys(browser.window.FreeBbsLearningWorkflowPanel), ['render']);
  assert.equal(
    browser.window.FreeBbsLearningWorkflowPanel.render(
      fixture.container,
      fixture.options,
      fixture.handlers,
    ),
    true,
  );
  assert.equal(fixture.events.length, 0);
  assert.doesNotMatch(
    file,
    /innerHTML|insertAdjacentHTML|localStorage|sessionStorage|fetch\(|callApi|recordLearning|\.submit\(/,
  );
});

test('panel styling shares theme tokens, keeps 44px targets, visible keyboard focus and stable active positions', () => {
  const css = fs.readFileSync(
    path.join(__dirname, '../public/learning-workflow-panel.css'),
    'utf8',
  );
  assert.match(css, /min-block-size: 44px/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /button:active\s*\{\s*transform: none/);
  assert.match(css, /var\(--learning-surface, var\(--ui-surface/);
  assert.match(css, /var\(--action-primary-text/);
  assert.match(css, /body\.theme-dark/);
  assert.match(css, /flex-wrap: wrap/);
  assert.match(css, /@media \(max-width: 540px\)/);
  assert.match(css, /#learning-workflow-strip\s*\{[^}]*display: flex;[^}]*flex-wrap: wrap/);
  assert.match(css, /#learning-workflow-strip\[hidden\]\s*\{\s*display: none !important/);
  assert.doesNotMatch(css, /position:\s*(sticky|fixed)/);
});
