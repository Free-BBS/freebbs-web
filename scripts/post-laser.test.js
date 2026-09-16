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
    add(until, authorId) {
      const node = {
        dataset: { laserExpires: String(until) },
        classList: {
          toggle(name, active) {
            node.active = active;
          },
        },
      };
      if (authorId) node.dataset.laserAuthor = String(authorId);
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
  assert.match(css, /\.discussion-post-card,\s*\.discussion-post-surface,\s*\.discussion-comment/);
  assert.doesNotMatch(css, /\.discussion-detail\)\.has-laser-glow/);
  assert.match(css, /laser-starlight\.svg/);
  assert.match(css, /--laser-wash/);
  assert.doesNotMatch(css, /text-shadow:|filter:|::before|::after/);
});

test('comment payloads synchronize server time and expire independently', () => {
  const c = setup();
  c.api.sync({ comments: [{ laser: { active: true, serverNowMs: 1000, expiresAtMs: 1020 } }] });
  const a = c.add(1020);
  const b = c.add(1040);
  c.api.refresh();
  assert.equal(a.active, true);
  assert.equal(b.active, true);
  c.setNow(100025);
  c.tick();
  assert.equal(a.active, false);
  assert.equal(b.active, true);
  c.api.sync({ comment: { laser: { serverNowMs: 1050 } } });
  assert.equal(b.active, false);
});

test('new author state updates historical cards and replies together without changing another author', () => {
  const c = setup();
  const oldPost = c.add(0, 1);
  const reply = c.add(0, 1);
  const peer = c.add(100100, 2);
  c.api.sync({
    comments: [
      {
        author: { id: 1 },
        laser: { active: true, expiresAtMs: 100050, serverNowMs: 100000 },
      },
    ],
  });
  assert.equal(oldPost.active, true);
  assert.equal(reply.active, true);
  assert.equal(peer.active, true);
  c.setNow(100051);
  c.tick();
  assert.equal(oldPost.active, false);
  assert.equal(reply.active, false);
  assert.equal(peer.active, true);
  c.api.sync({
    user: { id: 1 },
    shopItems: [
      {
        key: 'laser',
        laser: { active: true, expiresAtMs: 100200, serverNowMs: 100051 },
      },
    ],
  });
  assert.equal(oldPost.active, true);
  assert.equal(reply.active, true);
  assert.equal(peer.dataset.laserExpires, '100100');
  assert.match(
    c.api.attributes({ active: false, expiresAtMs: 0, serverNowMs: 99999 }, 1),
    /100200/,
  );
  assert.equal(c.api.attributes(null, 1), '', 'redacted content never inherits author decoration');
});
