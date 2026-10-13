const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '../public/development-commerce-embed.js'),
  'utf8',
);

function setup(search = '?embed=development') {
  const messages = [];
  const listeners = new Map();
  const classes = new Set();
  const location = {
    search,
    href: `https://bbs.example/inventory${search}`,
    origin: 'https://bbs.example',
  };
  const window = {
    location,
    parent: { postMessage: (...args) => messages.push(args) },
    addEventListener: (name, listener) => listeners.set(name, listener),
    requestAnimationFrame: () => 1,
    setTimeout: () => 1,
  };
  const document = {
    documentElement: { classList: { add: (name) => classes.add(name) } },
    addEventListener: (name, listener) => listeners.set(name, listener),
  };
  vm.runInNewContext(source, { window, document, URL, URLSearchParams, ResizeObserver: undefined });
  function click(href, extra = {}) {
    let prevented = false;
    listeners.get('click')?.({
      target: { closest: () => ({ href }) },
      preventDefault: () => {
        prevented = true;
      },
      ...extra,
    });
    return prevented;
  }
  return { messages, classes, click, window };
}

test('embedded warehouse routes profile, ranch and return links through the outer shell', () => {
  const app = setup();
  for (const href of [
    'https://bbs.example/profile?uid=u123#outfits',
    'https://bbs.example/ranch?uid=u123',
    'https://bbs.example/inventory',
  ]) {
    assert.equal(app.click(href), true);
    const message = app.messages.at(-1)[0];
    assert.equal(message.type, 'freebbs:development-commerce-navigation');
    assert.equal(message.path, href.slice('https://bbs.example'.length));
  }
});

test('external, modified and unsupported links are not intercepted', () => {
  const app = setup();
  assert.equal(app.click('https://external.example/profile?uid=u123'), false);
  assert.equal(app.click('https://bbs.example/adminusers'), false);
  assert.equal(app.click('https://bbs.example/profile', { ctrlKey: true }), false);
  assert.equal(app.messages.length, 0);
});

test('ordinary learning pages retain their original navigation', () => {
  const app = setup('');
  assert.equal(app.classes.size, 0);
  assert.equal(app.click('https://bbs.example/profile?uid=u123'), false);
  assert.equal(app.messages.length, 0);
});
