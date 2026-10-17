const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const outline = require('../public/learning-outline');

function harness({ lateReady = false } = {}) {
  let activeElement;
  class Element extends EventTarget {
    constructor(tag = 'div', label = '') {
      super();
      this.tagName = tag.toUpperCase();
      this.textContent = label;
      this.children = [];
      this.attributes = new Map();
      this.dataset = {};
      this.style = { setProperty() {} };
      this.hidden = false;
      this.open = false;
      this.offsetWidth = 120;
      this.classList = { contains: () => false };
      this.bounds = { top: 300, bottom: 344, right: 370, width: 340 };
    }

    append(...items) {
      this.children.push(...items);
    }

    replaceChildren() {
      this.children = [];
    }

    setAttribute(key, value) {
      this.attributes.set(key, String(value));
    }

    getAttribute(key) {
      return this.attributes.get(key);
    }

    hasAttribute(key) {
      return this.attributes.has(key);
    }

    removeAttribute(key) {
      this.attributes.delete(key);
    }

    closest() {
      return this.blockedAncestor || null;
    }

    querySelectorAll() {
      return this.children;
    }

    getBoundingClientRect() {
      return this.bounds;
    }

    click() {
      this.dispatchEvent(new Event('click'));
    }

    focus() {
      activeElement = this;
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
  const reading = new Element();
  const heading = new Element('header');
  reading.querySelector = () => heading;
  const body = new Element();
  const trigger = new Element('button');
  const paragraphs = [
    new Element('h2', '适用条件'),
    new Element('h3', '例题 1'),
    new Element('h4', '方法比较'),
  ];
  body.children = paragraphs;
  const tools = { feedback: new Element('button'), continue: new Element('button') };
  const dom = new EventTarget();
  dom.body = new Element('body');
  dom.createElement = (tag) => new Element(tag);
  dom.getElementById = (id) =>
    ({
      'knowledge-body': body,
      'knowledge-reading': reading,
      'learning-outline-open': trigger,
    })[id];
  dom.querySelector = (selector) => {
    if (selector === '[data-knowledge-page]') return page;
    return tools[selector.match(/data-knowledge-tool="([^"]+)"/)?.[1]] || null;
  };
  const frames = [];
  const navigations = [];
  let captures = 0;
  const browser = new EventTarget();
  browser.innerWidth = 390;
  browser.getComputedStyle = () => ({ display: 'block', visibility: 'visible' });
  browser.matchMedia = () => ({ matches: false });
  browser.requestAnimationFrame = (fn) => frames.push(fn);
  browser.FreeBbsLearningReader = {
    capture: () => {
      captures += 1;
    },
    scrollToHeading: (target) => {
      navigations.push(target);
      return true;
    },
  };
  if (lateReady) {
    page.setAttribute('aria-busy', 'false');
    browser.freeBbsKnowledge = {
      getLearningContext: () => ({ course: { slug: 'signals' }, node: { id: 'SS-01-01' } }),
    };
  }
  const controller = outline.install(browser, dom);
  const [floating, dialog] = dom.body.children;
  const list = dialog.children[1];
  const loaded = () => {
    page.dispatchEvent(new Event('knowledge:loaded'));
    while (frames.length) frames.shift()();
  };
  return {
    Element,
    page,
    reading,
    heading,
    body,
    trigger,
    paragraphs,
    tools,
    dom,
    browser,
    controller,
    floating,
    dialog,
    list,
    loaded,
    navigations,
    captures: () => captures,
    active: () => activeElement,
  };
}

test('outline lists only current public headings, preserving order, hierarchy and authored attributes', () => {
  const h = harness();
  const hidden = new h.Element('h3', '参考答案');
  hidden.closest = () => ({ open: false });
  h.body.children.push(hidden, new h.Element('h2', '  '));
  const before = h.paragraphs.map((item) => [...item.attributes]);
  const entries = outline.collect(h.body, h.browser);
  assert.deepEqual(
    entries.map(({ label, depth }) => ({ label, depth })),
    [
      { label: '适用条件', depth: 0 },
      { label: '例题 1', depth: 1 },
      { label: '方法比较', depth: 2 },
    ],
  );
  assert.deepEqual(
    h.paragraphs.map((item) => [...item.attributes]),
    before,
  );
  h.body.setAttribute('data-learning-document-empty', '');
  assert.deepEqual(outline.collect(h.body, h.browser), []);
});

test('outline stays closed until asked and opening creates no evidence or tool action', () => {
  const h = harness();
  assert.equal(h.trigger.hidden, true);
  h.trigger.click();
  assert.equal(h.dialog.open, false);
  h.loaded();
  assert.equal(h.dialog.open, false);
  assert.equal(h.floating.hidden, true);
  h.trigger.click();
  assert.equal(h.dialog.open, true);
  assert.equal(h.trigger.getAttribute('aria-expanded'), 'true');
  assert.equal(h.captures(), 0);
  assert.deepEqual(h.navigations, []);
  h.dialog.children[0].children[1].click();
  assert.equal(h.active(), h.trigger);
  assert.equal(h.trigger.getAttribute('aria-expanded'), 'false');
});

test('choosing a real heading uses reader offsets and transient focus without creating anchor IDs', () => {
  const h = harness();
  h.loaded();
  h.trigger.click();
  h.list.children[1].click();
  assert.equal(h.dialog.open, false);
  assert.deepEqual(h.navigations, [h.paragraphs[1]]);
  assert.equal(h.active(), h.paragraphs[1]);
  assert.equal(h.paragraphs[1].getAttribute('tabindex'), '-1');
  assert.equal(h.paragraphs[1].hasAttribute('id'), false);
  h.paragraphs[1].dispatchEvent(new Event('blur'));
  assert.equal(h.paragraphs[1].hasAttribute('tabindex'), false);
});

test('a stale or newly closed reference heading is never a navigation target', () => {
  for (const replacement of ['document', 'hidden']) {
    const h = harness();
    h.loaded();
    h.trigger.click();
    if (replacement === 'document') h.body.children = [];
    else h.paragraphs[1].closest = () => ({ open: false });
    h.list.children[1].click();
    assert.deepEqual(h.navigations, []);
    assert.equal(h.dialog.open, false);
  }
});

test('reading navigation captures the current paragraph then uses the existing real practice control', () => {
  const h = harness();
  let practices = 0;
  h.tools.feedback.addEventListener('click', () => {
    practices += 1;
  });
  h.loaded();
  h.heading.bounds.bottom = -100;
  h.controller.sync();
  assert.equal(h.floating.hidden, false);
  h.floating.click();
  h.dialog.children[2].children[0].click();
  assert.equal(h.captures(), 1);
  assert.equal(practices, 1);
  assert.equal(h.dialog.open, false);
  h.page.dataset.learningTool = 'feedback';
  h.controller.sync();
  assert.equal(h.floating.hidden, true);
  assert.equal(h.trigger.hidden, true);
});

test('reading navigation closes on material replacement and preserves authored focus attributes', () => {
  const h = harness();
  h.loaded();
  h.paragraphs[0].setAttribute('tabindex', '0');
  h.trigger.click();
  h.list.children[0].click();
  assert.equal(h.paragraphs[0].getAttribute('tabindex'), '0');
  h.trigger.click();
  h.page.dispatchEvent(new Event('knowledge:document-saved'));
  assert.equal(h.dialog.open, false);
});

test('mobile navigation uses the real panel-open state rather than hiding behind a nonexistent class', () => {
  const h = harness();
  let open = false;
  const oldQuery = h.dom.querySelector;
  h.dom.querySelector = (selector) =>
    selector === '.knowledge-workbench'
      ? { classList: { contains: (name) => name === 'is-interaction-open' && open } }
      : oldQuery(selector);
  h.browser.matchMedia = () => ({ matches: true });
  h.loaded();
  h.heading.bounds.bottom = -100;
  h.controller.sync();
  assert.equal(h.floating.hidden, false);
  open = true;
  h.controller.sync();
  assert.equal(h.floating.hidden, true);
});

test('navigation leaves a safe gap beside a visible Max button', () => {
  const h = harness();
  const oldLookup = h.dom.getElementById;
  h.dom.getElementById = (id) =>
    id === 'knowledge-chat-toggle'
      ? {
          getBoundingClientRect: () => ({
            left: 280,
            right: 340,
            top: 300,
            bottom: 360,
            width: 60,
          }),
        }
      : oldLookup(id);
  h.loaded();
  h.floating.bounds.width = 120;
  h.heading.bounds.bottom = -100;
  h.controller.sync();
  assert.equal(h.floating.style.left, '152px');
  assert.equal(h.floating.hidden, false);
});

test('a late outline script reads only a confirmed ready public context instead of waiting for a lost event', () => {
  const h = harness({ lateReady: true });
  h.controller.sync();
  assert.equal(h.trigger.hidden, false);
  h.trigger.click();
  assert.equal(h.dialog.open, true);
  assert.equal(h.captures(), 0);
});

test('new reading assets load in dependency order, in the shared reader rather than inside authored prose', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/knowledge.html'), 'utf8');
  assert.ok(html.indexOf('/learning-reader.js?v=') < html.indexOf('/learning-outline.js?v='));
  assert.equal((html.match(/id="learning-outline-open"/g) || []).length, 1);
  assert.match(
    html,
    /class="knowledge-reading-actions">\s*<button[\s\S]*?id="learning-outline-open"/,
  );
  assert.match(html, /\/learning-outline.css\?v=/);
});
