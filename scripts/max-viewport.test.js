const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

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
