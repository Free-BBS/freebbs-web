// Deterministic controller slices plus the real draft store; no browser/AI claim.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { createDraftStore } = require('../public/learning-chat-drafts');

const source = fs.readFileSync(path.join(__dirname, '../public/knowledge.js'), 'utf8');
function slice(start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first);
  assert.ok(first > 0 && last > first, `Production slice exists: ${start}`);
  return source.slice(first, last);
}
const ownerSlice = slice('  let chatSessionToken =', '  function setHidden(');
const sendSlice = slice('  async function submitChatPrompt(', '  // Share only this knowledge');
const updateSlice = slice(
  "  page.addEventListener('knowledge:document-saved'",
  '  async function initialize()',
);
const digest = async (value) => crypto.createHash('sha256').update(value).digest('hex');
const bodyVersion = 'a'.repeat(64);
const originVersion = 'b'.repeat(64);
const nextBody = 'c'.repeat(64);
const nextOrigin = 'd'.repeat(64);

function harness({ uid = 'u_A', token = 'tokenA', delayedDigest = digest } = {}) {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  const input = { value: '', focus() {} };
  const notice = { textContent: '', hidden: true };
  const elements = new Map([
    ['knowledge-chat-input', input],
    ['knowledge-chat-draft-status', notice],
  ]);
  const messages = [];
  const handlers = {};
  const pageHandlers = {};
  const streams = [];
  const state = {
    node: {
      id: 'SS-01-01',
      title: '卷积',
      documentVersion: bodyVersion,
      originDocumentVersion: originVersion,
    },
    chatSending: false,
    chatMessages: [],
    chatSelection: { quote: '原来的引用', source: 'annotation' },
    chatSelectionDraft: '',
  };
  const statuses = [];
  const app = {
    userState: { uid, token },
    streamKnowledgeRagResponse(request, onDelta) {
      return new Promise((resolve, reject) => {
        streams.push({ request, onDelta, resolve, reject });
      });
    },
  };
  const context = vm.createContext({
    app,
    state,
    nodeId: state.node.id,
    courseSlug: 'signals',
    pendingQuestionNavigation: null,
    window: {
      sessionStorage: storage,
      crypto: crypto.webcrypto,
      FreeBbsLearningChatDrafts: {
        createDraftStore: (options) => createDraftStore({ ...options, digest: delayedDigest }),
      },
      addEventListener: (name, handler) => {
        handlers[name] = handler;
      },
    },
    document: {
      getElementById: (id) => elements.get(id) || null,
      querySelectorAll: () => messages.filter((message) => message.loading),
    },
    page: {
      addEventListener: (name, handler) => {
        pageHandlers[name] = handler;
      },
      dispatchEvent() {},
    },
    CustomEvent: class CustomEvent {
      constructor(name, options) {
        this.type = name;
        this.detail = options.detail;
      }
    },
    setChatOpen() {},
    setChatSending(busy, status = '') {
      state.chatSending = busy;
      statuses.push(status);
    },
    appendChatMessage(role, content, options = {}) {
      const message = { role, content, loading: Boolean(options.loading) };
      messages.push(message);
      return message;
    },
    updateChatMessage(message, content) {
      Object.assign(message, { content, loading: false });
    },
    buildKnowledgeChatRequest: (question) => ({
      question,
      documentVersion: state.node.documentVersion,
      originDocumentVersion: state.node.originDocumentVersion,
    }),
    renderKnowledgeContent(node) {
      assert.equal(node.id, state.node.id);
    },
  });
  elements.set('knowledge-chat-thread', {
    replaceChildren() {
      messages.length = 0;
    },
  });
  elements.set('knowledge-selection-guidance', {
    remove() {
      elements.delete('knowledge-selection-guidance');
    },
  });
  vm.runInContext(`${ownerSlice}\n${sendSlice}\n${updateSlice}`, context);
  return {
    app,
    state,
    input,
    notice,
    values,
    messages,
    streams,
    statuses,
    restore: () => context.restoreChatDraft(),
    persist: () => context.persistChatDraft(),
    send: (question) => context.submitChatPrompt(question),
    session: () => handlers['freebbs:session-change'](),
    document: (patch) =>
      pageHandlers['knowledge:document-saved']({ detail: { node: { ...state.node, ...patch } } }),
  };
}

async function settle() {
  for (let index = 0; index < 4; index += 1)
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
}

test('first same-token UID confirmation retains text typed while identity was loading', async () => {
  const fixture = harness({ uid: '' });
  fixture.input.value = '我在身份确认时写下的问题。';
  fixture.app.userState.uid = 'u_A';
  fixture.session();
  await settle();
  assert.equal(fixture.input.value, '我在身份确认时写下的问题。');
  assert.equal(fixture.persist(), true);
  assert.equal(fixture.messages.length, 1);
  assert.equal(fixture.messages[0].id, 'knowledge-chat-welcome');
  assert.equal(fixture.streams.length, 0);
});

test('real UID changes and same-UID token changes clear private input and excerpts', async () => {
  for (const identity of [
    { uid: 'u_B', token: 'tokenB' },
    { uid: 'u_A', token: 'newTokenA' },
  ]) {
    const fixture = harness();
    await fixture.restore();
    fixture.input.value = 'A 的私人草稿。';
    assert.equal(fixture.persist(), true);
    fixture.state.chatMessages.push({ role: 'user', content: 'A 的私人历史。' });
    Object.assign(fixture.app.userState, identity);
    fixture.session();
    await settle();
    assert.equal(fixture.input.value, '');
    assert.equal(fixture.state.chatMessages.length, 0);
    assert.equal(fixture.state.chatSelection, null);
    assert.equal(fixture.messages.length, 1);
    assert.equal(fixture.messages[0].id, 'knowledge-chat-welcome');
    assert.doesNotMatch(JSON.stringify([...fixture.values]), /A 的私人/);
  }
});

test('a question typed during the asynchronous bind wins over restoration', async () => {
  let finish;
  let signature;
  const fixture = harness({
    delayedDigest: (value) =>
      new Promise((resolve) => {
        signature = value;
        finish = resolve;
      }),
  });
  const pending = fixture.restore();
  fixture.input.value = '等待暂存准备完成时写的新问题。';
  finish(await digest(signature));
  await pending;
  assert.equal(fixture.input.value, '等待暂存准备完成时写的新问题。');
  assert.equal(fixture.persist(), true);
});

test('a late old-owner bind cannot insert text or unset the newly confirmed owner', async () => {
  const waits = [];
  const fixture = harness({
    delayedDigest: (signature) =>
      new Promise((resolve) => {
        waits.push({ signature, resolve });
      }),
  });
  const oldRestore = fixture.restore();
  fixture.app.userState.uid = 'u_B';
  fixture.app.userState.token = 'tokenB';
  fixture.session();
  waits[1].resolve(await digest(waits[1].signature));
  await settle();
  fixture.input.value = 'B 自己的新稿。';
  assert.equal(fixture.persist(), true);
  waits[0].resolve(await digest(waits[0].signature));
  await oldRestore;
  assert.equal(fixture.input.value, 'B 自己的新稿。');
  assert.equal(fixture.persist(), true);
});

for (const patch of [{ documentVersion: nextBody }, { originDocumentVersion: nextOrigin }])
  test(`live ${Object.keys(patch)[0]} change rejects an old stream receipt and protects the new send`, async () => {
    const fixture = harness();
    await fixture.restore();
    fixture.input.value = '旧资料的问题。';
    const oldSend = fixture.send(fixture.input.value);
    const oldStream = fixture.streams[0];
    assert.equal(fixture.state.chatSending, true);
    fixture.document(patch);
    assert.equal(fixture.input.value, '旧资料的问题。');
    assert.equal(fixture.state.chatSending, false);
    assert.equal(fixture.persist(), false);
    assert.match(fixture.notice.textContent, /核对.*引用/);
    assert.equal(fixture.state.chatSelection, null);
    fixture.input.value = '我核对新资料后的下一问。';
    const newerSend = fixture.send(fixture.input.value);
    const newerStream = fixture.streams[1];
    oldStream.onDelta('迟到的旧资料回答不得再出现。');
    oldStream.resolve();
    await oldSend;
    assert.equal(fixture.input.value, '我核对新资料后的下一问。');
    assert.equal(fixture.state.chatSending, true);
    assert.equal(fixture.state.chatMessages.length, 0);
    assert.ok(fixture.messages.every((message) => !message.content.includes('迟到的旧资料回答')));
    newerStream.onDelta('新资料的有效回答。');
    newerStream.resolve();
    await newerSend;
    assert.equal(fixture.state.chatSending, false);
    assert.equal(fixture.input.value, '');
    assert.equal(fixture.state.chatMessages.length, 2);
    assert.equal(fixture.state.chatMessages[1].content, '新资料的有效回答。');
  });
