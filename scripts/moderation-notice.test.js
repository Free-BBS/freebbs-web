/* eslint-disable class-methods-use-this -- Small DOM double for interaction contracts. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { NOTICE_VERSION, noticeFor } = require('../backend/moderation-production');

const source = fs.readFileSync(path.join(__dirname, '../public/moderation-notice.js'), 'utf8');

function harness(
  notice = noticeFor({
    discussionModerationEnvironment: 'production',
    discussionModerationEnabled: true,
  }),
) {
  const elements = [];
  let current = true;
  let tick;
  let requests = 0;
  class Element {
    constructor(tag) {
      this.tag = tag;
      this.events = {};
      this.children = [];
      elements.push(this);
    }

    append(...children) {
      this.children.push(...children);
    }

    setAttribute() {}

    addEventListener(event, handler) {
      this.events[event] = handler;
    }

    showModal() {
      this.open = true;
    }

    focus() {}

    remove() {
      this.removed = true;
    }

    set innerHTML(_) {
      throw new Error('unsafe HTML');
    }
  }
  const window = {
    setInterval(callback) {
      tick = callback;
      return 1;
    },
    clearInterval() {
      tick = null;
    },
  };
  vm.runInNewContext(source, {
    window,
    document: {
      createElement: (tag) => new Element(tag),
      createTextNode: (value) => value,
      body: new Element('body'),
    },
  });
  return {
    start: () =>
      window.FreeBbsModerationNotice.confirm({
        callApi: async (url) => {
          requests += 1;
          assert.equal(url, '/moderation/notice');
          return notice;
        },
        isCurrent: () => current,
      }),
    async show() {
      await Promise.resolve();
      await Promise.resolve();
    },
    find: (tag, text) => elements.find((e) => e.tag === tag && (!text || e.textContent === text)),
    switchAccount() {
      current = false;
      if (tick) tick();
    },
    get requests() {
      return requests;
    },
  };
}

test('local non-required notice performs no confirmation and returns no evidence', async () => {
  const h = harness({ required: false });
  assert.equal(await h.start(), undefined);
  assert.equal(h.find('dialog'), undefined);
});

test('notice requires an unchecked acknowledgement and returns exactly the server version', async () => {
  const h = harness();
  const pending = h.start();
  await h.show();
  const checkbox = h.find('input');
  const accept = h.find('button', '确认并提交');
  assert.equal(checkbox.checked, false);
  assert.equal(accept.disabled, true);
  checkbox.checked = true;
  checkbox.events.change();
  assert.equal(accept.disabled, false);
  accept.events.click();
  assert.equal(await pending, NOTICE_VERSION);
  assert.equal(h.find('dialog').removed, true);
  assert.equal(h.requests, 1);
});

for (const action of ['cancel', 'escape', 'account switch'])
  test(`${action} leaves the submission unconfirmed`, async () => {
    const h = harness();
    const pending = h.start();
    const rejected = assert.rejects(pending, /尚未提交/);
    await h.show();
    if (action === 'cancel') h.find('button', '返回修改').events.click();
    else if (action === 'escape') h.find('dialog').events.cancel({ preventDefault() {} });
    else h.switchAccount();
    await rejected;
    assert.equal(h.find('dialog').removed, true);
  });

test('malformed notice fails closed and concurrent confirmations cannot duplicate submission', async () => {
  await assert.rejects(harness({}).start(), /无法读取/);
  const h = harness();
  const pending = h.start();
  const cancelled = assert.rejects(pending, /尚未提交/);
  await assert.rejects(h.start(), /已打开/);
  await h.show();
  h.find('button', '返回修改').events.click();
  await cancelled;
});
