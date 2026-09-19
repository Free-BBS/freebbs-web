/* eslint-disable max-classes-per-file -- Minimal DOM and FileReader doubles. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Element {
  constructor() {
    this.children = [];
    this.events = {};
    this.attributes = {};
    this.dataset = {};
    this.value = '';
  }

  set innerHTML(value) {
    this.markup = value;
    this.nodes = Object.fromEntries(
      ['[data-file-add]', '[data-file-input]', '[data-file-status]', 'ul'].map((key) => [
        key,
        new Element(),
      ]),
    );
  }

  querySelector(key) {
    return this.nodes[key];
  }

  addEventListener(name, callback) {
    this.events[name] = callback;
  }

  setAttribute(key, value) {
    this.attributes[key] = value;
  }

  replaceChildren() {
    this.children = [];
  }

  append(...items) {
    this.children.push(...items);
  }

  prepend(item) {
    this.children.unshift(item);
  }

  click() {
    return this.events.click?.();
  }
}
function harness(fetch) {
  const root = new Element();
  const window = { freeBbsApp: { userState: { token: 'test' } }, addEventListener() {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/max-files'), 'utf8'), {
    window,
    API_BASE_URL: '/api',
    AbortController,
    AbortSignal,
    fetch,
    document: {
      getElementById: (id) => (id === 'aichat-attachments' ? root : null),
      createElement: () => new Element(),
    },
    FileReader: class {
      readAsDataURL(file) {
        this.result = `data:text/plain;base64,${Buffer.from(file.name).toString('base64')}`;
        this.onload();
      }
    },
  });
  const area = root.children[0];
  const input = area.querySelector('[data-file-input]');
  return {
    root,
    area,
    list: area.querySelector('ul'),
    controller: window.FreeBbsMaxFiles,
    select(files) {
      input.files = files;
      return input.events.change();
    },
  };
}
const file = (name) => ({ name, size: 100 });
const response = (text) => ({ ok: true, json: async () => ({ text }) });
const tick = () =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });
test('upload is mounted in the composer and pending/ready attachments remain visible', async () => {
  let finish;
  const h = harness(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  assert.match(h.area.markup, /上传文件/);
  const pending = h.select([file('report.md')]);
  assert.equal(h.list.children[0].children[0].textContent, 'report.md');
  assert.match(h.list.children[0].children[1].textContent, /正在解析/);
  assert.throws(() => h.controller.snapshot(), /正在解析/);
  await tick();
  finish(response('解析后的实验内容'));
  await pending;
  assert.match(h.list.children[0].children[1].textContent, /已就绪/);
  assert.match(h.controller.snapshot(), /report.md[\s\S]*解析后的实验内容/);
  h.controller.setBusy(true);
  assert.equal(h.list.children[0].children[2].disabled, true);
  h.controller.setBusy(false);
  h.list.children[0].children[2].click();
  assert.equal(h.controller.snapshot(), '');
  assert.equal(h.list.hidden, true);
});
test('failed attachments stay visible and block sending until removed', async () => {
  const h = harness(async () => ({ ok: false, json: async () => ({ message: '文件损坏' }) }));
  await h.select([file('broken.pdf')]);
  assert.match(h.list.children[0].children[1].textContent, /文件损坏/);
  assert.throws(() => h.controller.snapshot(), /移除解析失败/);
  h.list.children[0].children[2].click();
  assert.equal(h.controller.snapshot(), '');
});
test('clearing during parsing cancels the old request and cannot overwrite new conversation attachments', async () => {
  const pendingRequests = [];
  const h = harness(
    (_url, options) =>
      new Promise((resolve) => {
        pendingRequests.push({ resolve, signal: options.signal });
      }),
  );
  const first = h.select([file('old.md')]);
  await tick();
  h.controller.clear();
  assert.equal(pendingRequests[0].signal.aborted, true);
  const second = h.select([file('new.md')]);
  await tick();
  pendingRequests[0].resolve(response('旧对话内容'));
  await first;
  assert.throws(() => h.controller.snapshot(), /正在解析/);
  pendingRequests[1].resolve(response('新对话内容'));
  await second;
  assert.match(h.controller.snapshot(), /new.md[\s\S]*新对话内容/);
  assert.doesNotMatch(h.controller.snapshot(), /old.md|旧对话/);
});
test('removing an attachment while parsing prevents its late result from returning', async () => {
  let finish;
  const h = harness(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = h.select([file('removed.md')]);
  await tick();
  h.list.children[0].children[2].click();
  finish(response('late'));
  await pending;
  assert.equal(h.controller.snapshot(), '');
  assert.equal(h.list.hidden, true);
});
