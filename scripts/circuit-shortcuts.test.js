const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const shortcuts = require('../public/circuit-shortcuts');

function eventTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    emit(type, event = {}) {
      listeners.get(type)?.forEach((listener) => listener(event));
    },
  };
}

function element(tagName = 'div', attributes = {}, parentElement = null) {
  return {
    ...eventTarget(),
    tagName,
    parentElement,
    attributes: { ...attributes },
    isConnected: true,
    getAttribute(key) {
      return this.attributes[key] ?? null;
    },
    setAttribute(key, value) {
      this.attributes[key] = String(value);
    },
    removeAttribute(key) {
      delete this.attributes[key];
    },
    closest(selector) {
      const selectors = selector.split(',');
      for (let node = this; node; node = node.parentElement) {
        if (
          selectors.some((part) => {
            const attribute = part.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
            return attribute
              ? Object.hasOwn(node.attributes, attribute[1]) &&
                  (attribute[2] === undefined || node.attributes[attribute[1]] === attribute[2])
              : node.tagName === part;
          })
        )
          return node;
      }
      return null;
    },
    focus() {
      this.focused = (this.focused || 0) + 1;
    },
  };
}

function keyEvent(key, extra = {}) {
  return {
    key,
    target: element(),
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    ...extra,
  };
}

function harness(options = {}) {
  const calls = [];
  const target = eventTarget();
  let active = true;
  let accepted = true;
  const controls = shortcuts.create({
    target,
    isActive: () => active,
    dispatch(action, detail, event) {
      calls.push({ action, detail, event });
      return accepted;
    },
    ...options,
  });
  return {
    controls,
    target,
    calls,
    setActive(value) {
      active = value;
    },
    accept(value) {
      accepted = value;
    },
    press(key, extra = {}) {
      const event = keyEvent(key, extra);
      return { event, handled: controls.handleKeydown(event) };
    },
  };
}

function helpHarness(options = {}) {
  const previous = element('button');
  const helpButton = element('button');
  const closeButton = element('button');
  const helpDialog = element('dialog');
  helpDialog.open = false;
  helpDialog.querySelector = (selector) => {
    assert.equal(selector, '[data-circuit-shortcuts-close]');
    return closeButton;
  };
  helpDialog.showModal = () => {
    helpDialog.open = true;
  };
  helpDialog.close = () => {
    helpDialog.open = false;
    helpDialog.emit('close');
  };
  const h = harness({ ...options, helpButton, helpDialog });
  h.target.activeElement = previous;
  return { ...h, previous, helpButton, closeButton, helpDialog };
}

test('Mac and Windows document shortcuts dispatch the intended action and prevent browser defaults', () => {
  const h = harness();
  for (const modifier of ['ctrlKey', 'metaKey']) {
    for (const [key, shiftKey, action] of [
      ['s', false, 'save'],
      ['S', false, 'save'],
      ['Enter', false, 'run'],
      ['z', false, 'undo'],
      ['Z', true, 'redo'],
      ['d', false, 'duplicate'],
    ]) {
      const { handled, event } = h.press(key, { [modifier]: true, shiftKey });
      assert.equal(handled, true, `${modifier} ${key}`);
      assert.equal(event.defaultPrevented, true);
      assert.equal(h.calls.at(-1).action, action);
      assert.equal(h.calls.at(-1).event, event, 'root receives the original event for wire undo');
    }
  }
  h.press('y', { ctrlKey: true });
  assert.equal(h.calls.at(-1).action, 'redo');
});

test('component shortcuts carry rotation, mirror and movement parameters without adding component hotkeys', () => {
  const h = harness();
  for (const [key, modifiers, action, detail] of [
    ['r', {}, 'rotate', { turns: 1 }],
    ['R', { shiftKey: true }, 'rotate', { turns: -1 }],
    ['x', {}, 'mirror', { axis: 'x' }],
    ['y', {}, 'mirror', { axis: 'y' }],
    ['D', {}, 'duplicate', {}],
    ['Delete', {}, 'delete', {}],
    ['Backspace', {}, 'delete', {}],
    ['w', {}, 'wire', {}],
    ['Escape', {}, 'cancel', {}],
    ['m', {}, 'max', {}],
    ['ArrowLeft', {}, 'move', { dx: -1, dy: 0 }],
    ['ArrowRight', {}, 'move', { dx: 1, dy: 0 }],
    ['ArrowUp', {}, 'move', { dx: 0, dy: -1 }],
    ['ArrowDown', {}, 'move', { dx: 0, dy: 1 }],
    ['ArrowLeft', { shiftKey: true }, 'move', { dx: -5, dy: 0 }],
    ['ArrowDown', { shiftKey: true }, 'move', { dx: 0, dy: 5 }],
  ]) {
    assert.equal(h.press(key, modifiers).handled, true, key);
    assert.equal(h.calls.at(-1).action, action);
    assert.deepEqual(h.calls.at(-1).detail, detail);
  }
  const count = h.calls.length;
  for (const key of ['c', 'v', 'l', 'Enter', ' ', 'F1', 'Process', 'Dead', 'constructor'])
    assert.equal(h.press(key).handled, false, key);
  assert.equal(h.calls.length, count);
});

test('unassigned modifier combinations and AltGraph retain their native behavior', () => {
  const h = harness();
  for (const [key, modifiers] of [
    ['s', { altKey: true, ctrlKey: true }],
    ['d', { shiftKey: true }],
    ['Delete', { shiftKey: true }],
    ['r', { ctrlKey: true }],
    ['ArrowLeft', { metaKey: true }],
    ['s', { ctrlKey: true, shiftKey: true }],
    ['Enter', { metaKey: true, shiftKey: true }],
    ['y', { metaKey: true }],
    ['y', { ctrlKey: true, metaKey: true }],
    ['x', { getModifierState: (keyName) => keyName === 'AltGraph' }],
  ]) {
    const { event, handled } = h.press(key, modifiers);
    assert.equal(handled, false, `${key} ${JSON.stringify(modifiers)}`);
    assert.equal(event.defaultPrevented, false);
  }
  assert.equal(h.calls.length, 0);
});

test('typing, native field undo and IME remain isolated from circuit commands while normal field save works', () => {
  const h = harness();
  const richText = element('div', { contenteditable: '' });
  const targets = [
    element('input'),
    element('textarea'),
    element('select'),
    element('span', {}, richText),
    element('div', { contenteditable: 'plaintext-only' }),
    element('div', { role: 'textbox' }),
    element('div', { role: 'combobox' }),
    element('div', { role: 'spinbutton' }),
    { ...element(), isContentEditable: true },
    { nodeType: 3, parentElement: richText },
  ];
  for (const target of targets) {
    for (const [key, extra] of [
      ['r', {}],
      ['R', { shiftKey: true }],
      ['d', { ctrlKey: true }],
      ['ArrowUp', {}],
      ['Backspace', {}],
      ['Delete', {}],
      ['Escape', {}],
      ['?', { shiftKey: true }],
      ['z', { ctrlKey: true }],
      ['z', { metaKey: true, shiftKey: true }],
      ['y', { ctrlKey: true }],
      ['Enter', { ctrlKey: true }],
    ]) {
      const { event, handled } = h.press(key, { target, ...extra });
      assert.equal(handled, false, `${target.tagName} ${key}`);
      assert.equal(event.defaultPrevented, false);
    }
    const { event, handled } = h.press('s', { target, metaKey: true });
    assert.equal(handled, true);
    assert.equal(event.defaultPrevented, true);
    assert.equal(h.calls.at(-1).action, 'save');
  }
  assert.equal(h.calls.length, targets.length);
  for (const ime of [{ isComposing: true }, { keyCode: 229 }]) {
    for (const key of ['s', 'Enter', 'z', 'd']) {
      const { event, handled } = h.press(key, { ctrlKey: true, ...ime });
      assert.equal(handled, false);
      assert.equal(event.defaultPrevented, false);
    }
  }
  assert.equal(h.calls.length, targets.length);
});

test('shadow DOM inputs are detected from the event path and contenteditable=false is not a text editor', () => {
  const h = harness();
  const host = element('div');
  const input = element('input');
  assert.equal(
    h.press('d', { target: host, composedPath: () => [input, host, h.target] }).handled,
    false,
  );
  assert.equal(h.calls.length, 0);
  assert.equal(
    h.press('d', { target: element('div', { contenteditable: 'false' }) }).handled,
    true,
  );
  assert.equal(h.calls.at(-1).action, 'duplicate');
});

test('component and wire control handlers have priority and wire point editing never dispatches twice', () => {
  const h = harness();
  for (const key of ['ArrowRight', 'Delete', 'Backspace', 'Escape']) {
    assert.equal(h.press(key, { defaultPrevented: true }).handled, false);
    const wireControls = element('g', { 'data-wire-controls': '' });
    const target = element('circle', {}, wireControls);
    assert.equal(h.press(key, { target }).handled, false);
  }
  assert.equal(h.calls.length, 0);
  const wireControls = element('g', { 'data-wire-controls': '' });
  h.press('s', { target: element('circle', {}, wireControls), ctrlKey: true });
  assert.equal(h.calls.at(-1).action, 'save', 'wire focus does not disable document save');
});

test('auto-repeat is consumed for one-shot commands but movement continues and text fields retain repeats', () => {
  const h = harness();
  for (const [key, extra] of [
    ['d', {}],
    ['d', { ctrlKey: true }],
    ['Delete', {}],
    ['r', {}],
    ['Enter', { metaKey: true }],
    ['z', { ctrlKey: true }],
    ['s', { metaKey: true }],
  ]) {
    h.press(key, extra);
    const count = h.calls.length;
    const repeated = h.press(key, { ...extra, repeat: true });
    assert.equal(repeated.handled, true);
    assert.equal(repeated.event.defaultPrevented, true);
    assert.equal(h.calls.length, count);
  }
  const beforeMove = h.calls.length;
  h.press('ArrowRight');
  h.press('ArrowRight', { repeat: true });
  assert.equal(h.calls.length, beforeMove + 2);
  assert.equal(h.press('Backspace', { repeat: true, target: element('input') }).handled, false);
});

test('inactive and unavailable actions do not prevent defaults or execute side effects', () => {
  const h = harness();
  h.setActive(false);
  assert.equal(h.press('s', { ctrlKey: true }).handled, false);
  assert.equal(h.press('Delete', { repeat: true }).handled, false);
  assert.equal(h.calls.length, 0);
  h.setActive(true);
  h.accept(false);
  const { event, handled } = h.press('Delete');
  assert.equal(handled, false);
  assert.equal(event.defaultPrevented, false);
  assert.equal(h.calls.length, 1, 'root can decline edits on read-only or empty selection');
});

test('bindings are idempotent, use bubbling handlers and clean up without affecting another editor', () => {
  const h = harness();
  assert.equal(h.controls.bind(), h.controls);
  h.controls.bind();
  assert.equal(h.target.listeners.get('keydown').size, 1);
  h.target.emit('keydown', keyEvent('r'));
  assert.equal(h.calls.length, 1);
  h.controls.destroy();
  assert.equal(h.target.listeners.get('keydown').size, 0);
  h.target.emit('keydown', keyEvent('r'));
  assert.equal(h.calls.length, 1);
  h.controls.bind();
  h.target.emit('keydown', keyEvent('r'));
  assert.equal(h.calls.length, 2);
  h.controls.destroy();
  const target = eventTarget();
  const bound = shortcuts.bind({ target });
  assert.equal(target.listeners.get('keydown').size, 1);
  bound.destroy();
  assert.equal(target.listeners.get('keydown').size, 0);
});

test('help opens from the discoverable button or question mark, blocks editor actions and restores focus', () => {
  const h = helpHarness();
  h.controls.bind();
  h.helpButton.emit('click');
  assert.equal(h.helpDialog.open, true);
  assert.equal(h.helpButton.getAttribute('aria-expanded'), 'true');
  assert.equal(h.closeButton.focused, 1);
  for (const key of ['r', 'Delete', 'd']) assert.equal(h.press(key).handled, true);
  assert.equal(h.calls.length, 0, 'a modal help dialog does not change the circuit behind it');
  const escape = h.press('Escape');
  assert.equal(escape.handled, true);
  assert.equal(escape.event.defaultPrevented, true);
  assert.equal(h.helpDialog.open, false);
  assert.equal(h.helpButton.getAttribute('aria-expanded'), 'false');
  assert.equal(h.previous.focused, 1);
  assert.equal(h.press('?', { shiftKey: true }).handled, true);
  assert.equal(h.helpDialog.open, true);
  assert.equal(h.press('?', { repeat: true }).handled, true);
  assert.equal(h.helpDialog.open, true);
  h.closeButton.emit('click');
  assert.equal(h.helpDialog.open, false);
  assert.equal(h.previous.focused, 2);
  assert.equal(h.press('/', { shiftKey: true }).handled, true);
  h.controls.destroy();
  assert.equal(h.helpDialog.open, false);
  assert.equal(h.previous.focused, 3);
  assert.equal(h.helpButton.listeners.get('click').size, 0);
});

test('native dialog cancellation, external closing and inactive help maintain accurate expanded state', () => {
  const h = helpHarness();
  h.controls.bind();
  h.setActive(false);
  h.helpButton.emit('click');
  assert.equal(h.helpDialog.open, false);
  h.setActive(true);
  h.controls.openHelp();
  const cancel = keyEvent('Escape');
  h.helpDialog.emit('cancel', cancel);
  assert.equal(cancel.defaultPrevented, true);
  assert.equal(h.helpDialog.open, false);
  assert.equal(h.previous.focused, 1);
  h.controls.openHelp();
  h.helpDialog.close();
  assert.equal(h.helpButton.getAttribute('aria-expanded'), 'false');
  assert.equal(h.previous.focused, 2);
  h.controls.destroy();
});

test('editor page loads the shortcut and history modules first and exposes keyboard help and action buttons', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/circuit.html'), 'utf8');
  const scriptPaths = [...html.matchAll(/<script src="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(scriptPaths.indexOf('/circuit-shortcuts.js') >= 0);
  assert.ok(scriptPaths.indexOf('/circuit-history.js') >= 0);
  assert.ok(scriptPaths.indexOf('/circuit-shortcuts.js') < scriptPaths.indexOf('/circuit.js'));
  assert.ok(scriptPaths.indexOf('/circuit-history.js') < scriptPaths.indexOf('/circuit.js'));
  for (const id of [
    'undo',
    'redo',
    'duplicate',
    'shortcuts',
    'save',
    'run',
    'rotate',
    'mirror-x',
    'mirror-y',
    'delete',
    'start-wire',
  ]) {
    const button = html.match(new RegExp(`<button[^>]+id="circuit-${id}"[^>]*>`));
    assert.ok(button, id);
    assert.match(button[0], /title="[^"]+"/);
    assert.match(button[0], /aria-keyshortcuts="[^"]+"/);
  }
  assert.match(html, /<dialog[^>]+id="circuit-shortcuts-dialog"/);
  assert.match(html, /aria-labelledby="circuit-shortcuts-title"/);
  assert.match(html, /data-circuit-shortcuts-close/);
});

test('help opening dismisses other editor overlays before showing and ignores a stale close event', () => {
  let overlayHidden = false;
  const h = helpHarness({
    onHelpOpen() {
      overlayHidden = true;
    },
  });
  h.helpDialog.showModal = () => {
    assert.equal(overlayHidden, true, 'a capture-phase Escape handler must be dismissed first');
    h.helpDialog.open = true;
  };
  h.controls.bind();
  h.controls.openHelp();
  h.helpDialog.emit('close');
  assert.equal(h.helpButton.getAttribute('aria-expanded'), 'true');
  assert.equal(h.previous.focused, undefined);
  h.previous.isConnected = false;
  h.controls.closeHelp();
  assert.equal(
    h.helpButton.focused,
    1,
    'focus falls back to help if the selected SVG was replaced',
  );
  h.controls.destroy();
});
