const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { installBubbleControls, selectTip } = require('../public/workbench-companion');

function fixture() {
  const nodes = {};
  for (const name of ['', 'bubble', 'avatar', 'collapse', 'hide', 'show', 'plan']) {
    const handlers = new Map();
    const attributes = new Map();
    nodes[name] = {
      hidden: name === 'show',
      focused: false,
      addEventListener: (event, handler) => handlers.set(event, handler),
      setAttribute: (key, value) => attributes.set(key, value),
      getAttribute: (key) => attributes.get(key),
      trigger: (event, payload) => handlers.get(event)?.(payload),
      focus() {
        this.focused = true;
      },
    };
  }
  const doc = { getElementById: (id) => nodes[id.replace(/^workbench-companion-?/, '')] };
  let hiddenCalls = 0;
  let shownCalls = 0;
  const controls = installBubbleControls({
    document: doc,
    onHide: () => {
      hiddenCalls += 1;
    },
    onShow: () => {
      shownCalls += 1;
    },
  });
  return { nodes, controls, hiddenCalls: () => hiddenCalls, shownCalls: () => shownCalls };
}

test('Max starts collapsed even with markup or an older shown preference, and tip updates do not open it', () => {
  const { nodes, controls } = fixture();
  assert.equal(nodes.bubble.hidden, true);
  assert.equal(nodes.avatar.getAttribute('aria-expanded'), 'false');
  controls.setHidden(false);
  assert.equal(nodes.bubble.hidden, true);
  const tip = selectTip([], new Date('2026-10-02T02:00:00Z'));
  assert.ok(tip.text);
  controls.setHidden(false);
  assert.equal(nodes.bubble.hidden, true);
  nodes.avatar.trigger('click');
  assert.equal(nodes.bubble.hidden, false);
  assert.equal(nodes.avatar.getAttribute('aria-expanded'), 'true');
  controls.setHidden(false);
  assert.equal(
    nodes.bubble.hidden,
    false,
    'refreshing a tip keeps an explicitly opened bubble open',
  );
});

test('avatar toggles, collapse and Escape update aria and return focus to Max', () => {
  const { nodes } = fixture();
  nodes.avatar.trigger('click');
  nodes.collapse.trigger('click');
  assert.equal(nodes.bubble.hidden, true);
  assert.equal(nodes.avatar.getAttribute('aria-expanded'), 'false');
  assert.equal(nodes.avatar.focused, true);
  nodes.avatar.trigger('click');
  let prevented = false;
  nodes.bubble.trigger('keydown', {
    key: 'Escape',
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(nodes.bubble.hidden, true);
  assert.equal(nodes.avatar.getAttribute('aria-expanded'), 'false');
  nodes.avatar.trigger('click');
  nodes.avatar.trigger('click');
  assert.equal(nodes.bubble.hidden, true);
});

test('closing all Max tips keeps the existing hide option and restoring Max keeps the bubble collapsed', () => {
  const view = fixture();
  view.nodes.avatar.trigger('click');
  view.nodes.hide.trigger('click');
  assert.equal(view.hiddenCalls(), 1);
  assert.equal(view.nodes[''].hidden, true);
  assert.equal(view.nodes.show.hidden, false);
  assert.equal(view.nodes.show.focused, true);
  assert.equal(view.nodes.avatar.getAttribute('aria-expanded'), 'false');
  view.nodes.show.trigger('click');
  assert.equal(view.shownCalls(), 1);
  assert.equal(view.nodes[''].hidden, false);
  assert.equal(view.nodes.bubble.hidden, true);
  assert.equal(view.nodes.show.hidden, true);
  assert.equal(view.nodes.avatar.focused, true);
  view.nodes.avatar.trigger('click');
  assert.equal(view.nodes.bubble.hidden, false);
});

test('HTML has a collapsed first paint and native buttons retain Enter and Space activation', () => {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'public/workbench.html'), 'utf8');
  assert.match(html, /id="workbench-companion-bubble" hidden/);
  assert.match(
    html,
    /<button[^>]*type="button"[^>]*id="workbench-companion-avatar"[^>]*aria-expanded="false"/,
  );
  for (const id of ['collapse', 'hide', 'show']) {
    assert.match(html, new RegExp(`<button[^>]*type="button"[^>]*id="workbench-companion-${id}"`));
  }
  const planning = fs.readFileSync(path.join(root, 'public/workbench-planning.js'), 'utf8');
  assert.doesNotMatch(planning, /(?:toggleBubble|bubbleControls\.setOpen)\(true\)/);
  assert.match(planning, /tipsHidden = localStorage\.getItem\(hiddenKey\(\)\) === 'hidden'/);
});
