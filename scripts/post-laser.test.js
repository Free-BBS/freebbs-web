const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../public/post-laser.js'), 'utf8');
function setup() {
  const elements = [];
  const handlers = {};
  let callback;
  let now = 100000;
  const window = {
    document: {
      body: {},
      querySelectorAll: () => elements,
      addEventListener: (event, handler) => {
        handlers[event] = handler;
      },
    },
    addEventListener: (event, handler) => {
      handlers[event] = handler;
    },
    setTimeout: (handler) => {
      callback = handler;
    },
    clearTimeout() {},
    MutationObserver: class {
      observe() {
        this.observing = true;
      }
    },
  };
  vm.runInNewContext(source, { window, Date: { now: () => now } });
  return {
    api: window.FreeBbsPostLaser,
    handlers,
    setNow: (value) => {
      now = value;
    },
    tick: () => callback(),
    add(until) {
      const node = {
        dataset: { laserExpires: String(until) },
        classList: {
          toggle(name, active) {
            node.active = active;
          },
        },
      };
      elements.push(node);
      return node;
    },
  };
}
test('server clock correction and expiry remove glow without another server request', () => {
  const c = setup();
  c.api.sync({ post: { laser: { serverNowMs: 1000 } } });
  assert.match(c.api.attributes({ active: true, expiresAtMs: 1010 }), /1010/);
  const node = c.add(1010);
  c.api.refresh();
  assert.equal(node.active, true);
  c.setNow(100010);
  c.tick();
  assert.equal(node.active, false);
});
test('cached expired decorations and missing/invalid leases cannot reactivate glow', () => {
  const c = setup();
  for (const value of [
    null,
    {},
    { active: false, expiresAtMs: 999999 },
    { active: true, expiresAtMs: 100000 },
    { active: true, expiresAtMs: 'NaN' },
  ])
    assert.equal(c.api.attributes(value), '');
});
test('returning from a background tab clears an expired glow', () => {
  const c = setup();
  const node = c.add(100010);
  c.api.refresh();
  c.setNow(100020);
  c.handlers.visibilitychange();
  assert.equal(node.active, false);
});
test('glow flows outside list/detail cards with reduced-motion and forced-colors fallback', () => {
  const css = fs.readFileSync(path.join(__dirname, '../public/shop-effects.css'), 'utf8');
  assert.match(css, /theme-dark/);
  assert.match(css, /forced-colors/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /animation: laser-halo-flow/);
  assert.match(css, /\.discussion-post-card, \.discussion-detail/);
  assert.match(css, /laser-starlight\.svg/);
  assert.match(css, /--laser-wash/);
  assert.doesNotMatch(css, /text-shadow:|filter:|::before|::after/);
});
