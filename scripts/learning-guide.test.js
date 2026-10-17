const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { steps, courseSteps, install } = require('../public/learning-guide');

const root = path.resolve(__dirname, '..');
test('optional newcomer guide covers the complete route without grading, consent changes or auto prompts', () => {
  assert.equal(steps.length, 5);
  const text = steps.map((step) => step.text).join('');
  assert.match(text, /知识起源/);
  assert.match(text, /批注只对自己/);
  assert.match(text, /完整正式题目范围/);
  assert.match(text, /探索/);
  assert.match(text, /学习过程自动记录/);
  assert.match(text, /批注正文和聊天内容不进入过程统计/);
  assert.match(steps[0].text, /基础条件以正文为准/);
  assert.doesNotMatch(steps[0].text, /概览.*需要哪些基础/);
  const source = fs.readFileSync(path.join(root, 'public/learning-guide.js'), 'utf8');
  assert.doesNotMatch(source, /callApi|localStorage|knowledge:ask|\.confirm\(/);
});

function guideFixture({ course = true, targets = true } = {}) {
  const document = { activeElement: null };
  const observed = [];
  class Element extends EventTarget {
    constructor(tag = 'section') {
      super();
      this.tagName = tag.toUpperCase();
      this.attributes = new Map();
      this.children = [];
      this.dataset = {};
      this.open = false;
      this.disabled = false;
      this.hidden = false;
      this.clicks = 0;
      this.scrolls = [];
    }

    append(...children) {
      this.children.push(...children);
    }

    setAttribute(key, value) {
      this.attributes.set(key, String(value));
    }

    hasAttribute(key) {
      return this.attributes.has(key);
    }

    getAttribute(key) {
      return this.attributes.get(key) ?? null;
    }

    closest() {
      return this.hidden ? this : null;
    }

    getClientRects() {
      return this.hidden ? [] : [{ width: 300, height: 100 }];
    }

    matches() {
      return ['BUTTON', 'INPUT', 'A'].includes(this.tagName);
    }

    scrollIntoView(options) {
      this.scrolls.push(options);
    }

    focus() {
      document.activeElement = this;
    }

    click() {
      if (this.disabled) return;
      this.clicks += 1;
      this.dispatchEvent(new Event('click'));
    }

    showModal() {
      this.open = true;
    }

    close() {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    }
  }
  const page = new Element();
  page.setAttribute(course ? 'data-course-map-page' : 'data-knowledge-page', '');
  const trigger = new Element('button');
  const selectors = new Map();
  const ids = new Map([['learning-guide-open', trigger]]);
  if (targets)
    for (const [index, step] of courseSteps.entries())
      selectors.set(step.target, [
        new Element(index === 1 ? 'input' : index > 1 ? 'button' : 'section'),
      ]);
  if (!course && targets) {
    for (const tool of ['content', 'feedback', 'continue'])
      selectors.set(`[data-knowledge-tool="${tool}"]`, [new Element('button')]);
    for (const id of [
      'knowledge-chat-toggle',
      'knowledge-chat-input',
      'knowledge-history-toggle',
      'knowledge-body',
      'learning-heading',
    ])
      ids.set(
        id,
        new Element(
          id.endsWith('-input') ? 'input' : id.endsWith('-toggle') ? 'button' : 'section',
        ),
      );
  }
  document.body = new Element('body');
  document.createElement = (tag) => new Element(tag);
  document.getElementById = (id) => ids.get(id) || null;
  document.querySelector = (selector) =>
    selector.includes('[data-knowledge-page]') ? page : selectors.get(selector)?.[0] || null;
  document.querySelectorAll = (selector) => selectors.get(selector) || [];
  function MutationObserver(callback) {
    this.callback = callback;
    this.observe = (element, options) => {
      this.element = element;
      this.options = options;
    };
    observed.push(this);
  }
  const browser = {
    document,
    CustomEvent,
    MutationObserver,
  };
  const controller = install(browser);
  const [dialog] = document.body.children;
  const [header, count, title, body, action, footer] = dialog.children;
  const [, close] = header.children;
  const [previous, next] = footer.children;
  return {
    browser,
    document,
    page,
    trigger,
    selectors,
    ids,
    controller,
    dialog,
    count,
    title,
    body,
    action,
    close,
    previous,
    next,
    observed,
    Element,
  };
}

test('course guide is optional and repeatable, and each actual entry action only focuses and scrolls', () => {
  assert.equal(courseSteps.length, 4);
  assert.match(courseSteps[0].text, /没有顺序连线时按目录/);
  assert.match(courseSteps[1].text, /完整目录/);
  const view = guideFixture();
  assert.equal(view.dialog.open, false, 'No forced first-visit prompt');
  assert.equal(install(view.browser), view.controller, 'A repeated script installation is inert');
  assert.equal(view.document.body.children.length, 1);
  for (const [index, step] of courseSteps.entries()) {
    view.trigger.click();
    for (let advance = 0; advance < index; advance += 1) view.next.click();
    assert.equal(view.count.textContent, `${index + 1} / 4`);
    assert.equal(view.title.textContent, step.title);
    const [target] = view.selectors.get(step.target);
    view.action.click();
    assert.equal(view.dialog.open, false);
    assert.equal(
      view.document.activeElement,
      target,
      'Focus stays at the entry, not the guide opener',
    );
    assert.equal(
      target.clicks,
      0,
      'No search, resume or knowledge point is activated for the learner',
    );
    assert.equal(target.scrolls.length, 1);
  }
  view.trigger.click();
  assert.equal(view.controller.getIndex(), 0, 'Reopening starts a short, predictable guide');
  view.close.click();
  assert.equal(view.document.activeElement, view.trigger);
});

test('missing resume and unpublished knowledge never turn the first point into a fabricated last position', () => {
  const view = guideFixture({ targets: false });
  view.trigger.click();
  view.next.click();
  view.next.click();
  assert.equal(view.action.disabled, true);
  assert.equal(view.body.textContent, courseSteps[2].missingText);
  view.action.click();
  assert.equal(view.dialog.open, true);
  view.next.click();
  assert.equal(view.action.disabled, true);
  assert.equal(view.body.textContent, courseSteps[3].missingText);
  view.next.click();
  assert.equal(view.dialog.open, false, 'An empty course does not trap the learner in the guide');
});

test('course guide follows late-loading real controls without retrying or storing learning state', () => {
  const view = guideFixture({ targets: false });
  view.trigger.click();
  assert.equal(view.action.disabled, true);
  const actual = new view.Element();
  view.selectors.set(courseSteps[0].target, [actual]);
  view.observed[0].callback();
  assert.equal(view.action.disabled, false);
  assert.equal(view.observed[0].element, view.page);
  view.action.click();
  assert.equal(view.document.activeElement, actual);
  assert.equal(actual.clicks, 0);
});

test('knowledge guide retains its five real navigation actions and never asks Max automatically', () => {
  const view = guideFixture({ course: false });
  const events = [];
  for (const type of ['knowledge:tool-select', 'knowledge:navigate', 'knowledge:open-interaction'])
    view.page.addEventListener(type, (event) => events.push({ type, detail: event.detail }));
  view.trigger.click();
  view.action.click();
  assert.deepEqual(events, [
    { type: 'knowledge:tool-select', detail: { tool: 'content' } },
    { type: 'knowledge:navigate', detail: { tool: 'content', view: 'origin' } },
  ]);
  events.length = 0;
  view.trigger.click();
  for (let index = 0; index < 4; index += 1) view.next.click();
  view.action.click();
  assert.deepEqual(events, [{ type: 'knowledge:open-interaction', detail: { tab: 'max' } }]);
  assert.equal(view.observed.length, 1, 'Late or disabled real entries update without navigation');
});

test('knowledge guide hands keyboard focus to the chosen surface, while cancel and Escape return to the opener', () => {
  const view = guideFixture({ course: false });
  const destinations = [
    'knowledge-history-toggle',
    'knowledge-body',
    'learning-heading',
    'learning-heading',
    'knowledge-chat-input',
  ];
  for (const [index, destination] of destinations.entries()) {
    view.trigger.click();
    for (let advance = 0; advance < index; advance += 1) view.next.click();
    view.action.click();
    assert.equal(view.dialog.open, false);
    assert.equal(view.document.activeElement, view.ids.get(destination));
    // Chrome delivers close after the explicit action. It must still leave
    // focus at the new surface instead of replaying opener restoration.
    view.dialog.dispatchEvent(new Event('close'));
    assert.equal(view.document.activeElement, view.ids.get(destination));
  }
  view.trigger.click();
  view.close.click();
  assert.equal(view.document.activeElement, view.trigger);
  view.trigger.click();
  view.dialog.close();
  assert.equal(
    view.document.activeElement,
    view.trigger,
    'Native Escape/cancel close restores focus',
  );
});

test('unavailable knowledge entries stay inside the guide and a missing destination returns focus safely', () => {
  const view = guideFixture({ course: false, targets: false });
  view.trigger.click();
  assert.equal(view.action.disabled, true);
  view.action.click();
  assert.equal(view.dialog.open, true);
  const entry = new view.Element('button');
  view.selectors.set('[data-knowledge-tool="content"]', [entry]);
  view.observed[0].callback();
  assert.equal(view.action.disabled, false, 'A late available entry can be used without reopening');
  entry.disabled = true;
  view.action.dispatchEvent(new Event('click'));
  assert.equal(view.dialog.open, true, 'An entry disabled after rendering is rechecked');
  assert.equal(view.document.activeElement, view.close);
  entry.disabled = false;
  view.observed[0].callback();
  view.action.click();
  assert.equal(view.dialog.open, false);
  assert.equal(
    view.document.activeElement,
    view.trigger,
    'No real destination means no lost focus',
  );
});

test('Max-generated small exercises have a visible boundary from official self-tests', () => {
  const html = fs.readFileSync(path.join(root, 'public/knowledge.html'), 'utf8');
  const pageSource = fs.readFileSync(path.join(root, 'public/knowledge.js'), 'utf8');
  assert.match(html, /data-chat-prompt="给我一道检查理解的小题"/);
  assert.match(html, /title="Max 生成练习，不计正式自测与星标"/);
  assert.match(html, /Max 小题不计正式自测 · 对话不写入讨论区/);
  assert.match(pageSource, /status \|\| 'Max 小题不计正式自测 · 对话不写入讨论区'/);
});
test('the reading surface remains unique and annotations only open tools around the official document', () => {
  const html = fs.readFileSync(path.join(root, 'public/knowledge.html'), 'utf8');
  const annotation = fs.readFileSync(path.join(root, 'public/knowledge-annotations.js'), 'utf8');
  assert.equal([...html.matchAll(/id="knowledge-body"/g)].length, 1);
  assert.doesNotMatch(html, /id="learning-annotated-document"/);
  const refresh = annotation.slice(
    annotation.indexOf('    function refresh('),
    annotation.indexOf('    function captureSelection('),
  );
  assert.doesNotMatch(refresh, /cloneNode|learning-annotated-document/);
  assert.match(html, /learning-reading-notes-host/);
  assert.equal([...html.matchAll(/id="learning-annotation-toolbar"/g)].length, 1);
  assert.match(annotation, /if \(notesPanel\) notesPanel\.hidden = true/);
  assert.doesNotMatch(annotation, /inlineHost\.append\(notesPanel\)/);
  assert.match(annotation, /document\.body\.append\(popover\)/);
  assert.match(annotation, /document\.body\.append\(directory\)/);
  assert.match(html, /id="learning-annotation-popover"[\s\S]*?role="dialog"/);
  const toolbar = html.slice(
    html.indexOf('id="learning-annotation-toolbar"'),
    html.indexOf('id="learning-reading-notes-host"'),
  );
  assert.doesNotMatch(toolbar, /<textarea|<details|批注目录/);
});
