const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('guide controls preserve the illustrated menu while normal outside clicks and Escape still close it', () => {
  const source = fs.readFileSync(require.resolve('../public/max-composer'), 'utf8');
  const start = source.indexOf("  document.addEventListener('pointerdown'");
  const end = source.indexOf('  const update = () => {', start);
  assert.ok(start >= 0 && end > start, 'Composer dismissal listeners must be present');
  const listeners = {};
  const menuContent = {};
  let focused = false;
  const menu = {
    open: true,
    contains: (target) => target === menuContent,
    querySelector: () => ({
      focus: () => {
        focused = true;
      },
    }),
  };
  const document = {
    addEventListener: (name, listener) => {
      listeners[name] = listener;
    },
  };
  const form = {
    querySelectorAll: () => [menu],
    querySelector: () => (menu.open ? menu : null),
    addEventListener: (name, listener) => {
      listeners[name] = listener;
    },
  };
  vm.runInNewContext(source.slice(start, end), { document, form });

  let guideOpen = true;
  const guideDialog = { open: true };
  const guideControl = {
    closest(selector) {
      assert.equal(selector, 'dialog.max-tour[open]');
      return guideOpen ? guideDialog : null;
    },
  };
  listeners.pointerdown({ target: guideControl });
  assert.equal(menu.open, true, 'Expanding or operating the guide must preserve the shown menu');
  listeners.pointerdown({ target: menuContent });
  assert.equal(menu.open, true, 'Interaction inside the menu must still keep it open');
  listeners.pointerdown({ target: { closest: () => null } });
  assert.equal(menu.open, false, 'Ordinary page clicks must still dismiss the menu');
  menu.open = true;
  guideOpen = false;
  listeners.pointerdown({ target: guideControl });
  assert.equal(menu.open, false, 'A closed guide must not exempt ordinary outside clicks');

  menu.open = true;
  let prevented = false;
  listeners.keydown({
    key: 'Enter',
    preventDefault: () => {
      prevented = true;
    },
  });
  assert.equal(menu.open, true);
  assert.equal(prevented, false);
  listeners.keydown({
    key: 'Escape',
    preventDefault: () => {
      prevented = true;
    },
  });
  assert.equal(menu.open, false);
  assert.equal(focused, true, 'Escape must return focus to the menu summary');
  assert.equal(prevented, true);
});

test('mobile input uses visible viewport, folds options, and restores layout after blur', () => {
  const classes = new Set(['aichat-page']);
  const properties = {};
  const listeners = {};
  const input = {};
  const form = { contains: (element) => element === input };
  const options = { open: true };
  const document = {
    activeElement: null,
    body: {
      classList: {
        contains: (name) => classes.has(name),
        toggle: (name, on) => {
          if (on) classes.add(name);
          else classes.delete(name);
        },
      },
    },
    documentElement: {
      style: {
        setProperty: (key, value) => {
          properties[key] = value;
        },
      },
    },
    getElementById: (id) => (id === 'aichat-input' ? input : form),
    querySelector: (selector) => (selector === '.max-composer-tools' ? options : null),
    addEventListener: (name, listener) => {
      listeners[name] = listener;
    },
  };
  const viewport = {
    height: 420,
    offsetTop: 18,
    addEventListener: (name, listener) => {
      listeners[`viewport:${name}`] = listener;
    },
  };
  const mobile = { matches: true, addEventListener() {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/max-composer'), 'utf8'), {
    document,
    window: {
      visualViewport: viewport,
      innerHeight: 844,
      matchMedia: () => mobile,
      addEventListener() {},
    },
    requestAnimationFrame: (callback) => {
      callback();
      return 1;
    },
    cancelAnimationFrame() {},
  });
  document.activeElement = input;
  listeners.focusin();
  assert.equal(classes.has('max-input-active'), true);
  assert.equal(options.open, false);
  assert.equal(properties['--max-visible-height'], '420px');
  assert.equal(properties['--max-visible-top'], '18px');
  viewport.height = 360;
  listeners['viewport:resize']();
  assert.equal(properties['--max-visible-height'], '360px');
  document.activeElement = null;
  listeners.focusout();
  assert.equal(classes.has('max-input-active'), false);
  document.activeElement = input;
  mobile.matches = false;
  listeners.focusin();
  assert.equal(classes.has('max-input-active'), false);
});
