const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/knowledge.js'), 'utf8');
const start = source.indexOf('  function selectionHelpPrompt(');
const end = source.indexOf('  function buildKnowledgeChatRequest(', start);
assert.ok(start > 0 && end > start);

class Element {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.value = '';
    this.scrollHeight = 100;
  }

  append(...children) {
    for (const child of children) {
      child.parentNode = this;
      this.children.push(child);
    }
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  addEventListener(name, handler) {
    this.listeners[name] = handler;
  }

  focus(options) {
    this.focusOptions = options;
  }

  remove() {
    if (this.parentNode)
      this.parentNode.children = this.parentNode.children.filter((item) => item !== this);
  }

  replaceChildren() {
    this.children = [];
  }
}

function harness({ inputValue = '', sending = false } = {}) {
  const thread = new Element();
  thread.id = 'knowledge-chat-thread';
  const input = new Element('textarea');
  input.id = 'knowledge-chat-input';
  input.value = inputValue;
  const find = (id, item) =>
    item.id === id ? item : item.children.map((child) => find(id, child)).find(Boolean);
  const document = {
    createElement: (tag) => new Element(tag),
    getElementById: (id) => (id === input.id ? input : find(id, thread)),
  };
  const state = {
    chatSending: sending,
    chatSelection: null,
    chatSelectionDraft: '',
    chatMessages: [{ role: 'user', content: '之前的私人对话' }],
    node: { id: 'SS-02-01', documentVersion: 'body-v1', originDocumentVersion: 'origin-v1' },
  };
  const context = vm.createContext({
    document,
    state,
    nodeId: 'SS-02-01',
    persistChatDraft: () => true,
  });
  vm.runInContext(source.slice(start, end), context);
  return { context, document, state, thread, input };
}

const selection = {
  quote: '卷积表示输入与系统响应的叠加。',
  source: 'annotation',
  nodeId: 'SS-02-01',
  documentVersion: 'body-v1',
};

test('selected prose opens a local question prompt and editable quoted draft without sending', () => {
  const fixture = harness();
  assert.equal(fixture.context.showSelectionHelp(selection), true);
  const card = fixture.document.getElementById('knowledge-selection-guidance');
  assert.equal(card.children[0].textContent, 'Max · 学习引导');
  assert.equal(
    card.children[1].children[2].textContent,
    '这部分你理解了吗？想检查理解，还是需要我解释一下？',
  );
  assert.equal(
    fixture.document.getElementById('knowledge-selection-quote').textContent,
    selection.quote,
  );
  assert.match(fixture.input.value, /关于正文.*卷积.*我的问题是：/);
  assert.equal(fixture.state.chatMessages.length, 1);
  assert.doesNotMatch(
    source.slice(start, end),
    /streamKnowledgeRagResponse|submitChatPrompt|callApi|localStorage|chatMessages\.push/,
  );
});

test('three choices draft distinct support requests but never invoke AI automatically', () => {
  const fixture = harness();
  fixture.context.showSelectionHelp(selection);
  const choices = fixture.document.getElementById('knowledge-selection-guidance').children[1]
    .children[3];
  assert.deepEqual(
    choices.children.map((item) => item.textContent),
    ['解释一下', '检查理解', '我自己提问'],
  );
  choices.children[0].listeners.click();
  assert.match(fixture.input.value, /从必要的基础开始，分步解释/);
  choices.children[1].listeners.click();
  assert.match(fixture.input.value, /检查理解.*先不要给答案.*不计正式自测或星标/);
  choices.children[2].listeners.click();
  assert.match(fixture.input.value, /我的问题是：$/);
  assert.match(
    fixture.document.getElementById('knowledge-selection-notice').textContent,
    /点击“发送”/,
  );
});

test('the knowledge-origin source is visible in both the prompt and editable draft', () => {
  const fixture = harness();
  fixture.context.showSelectionHelp({
    ...selection,
    source: 'origin',
    documentVersion: 'origin-v1',
  });
  const card = fixture.document.getElementById('knowledge-selection-guidance');
  assert.equal(card.children[1].children[0].textContent, '已选知识起源');
  assert.match(fixture.input.value, /关于知识起源中选中的内容/);
});

test('opening a selection and choosing a mode never overwrite a hand-written draft', () => {
  const fixture = harness({ inputValue: '我正在写的问题，不要覆盖它。' });
  fixture.context.showSelectionHelp(selection);
  assert.equal(fixture.input.value, '我正在写的问题，不要覆盖它。');
  assert.equal(fixture.context.draftSelectionHelp('check'), false);
  assert.equal(fixture.input.value, '我正在写的问题，不要覆盖它。');
  assert.match(fixture.document.getElementById('knowledge-selection-notice').textContent, /已保留/);
  fixture.input.value = '';
  assert.equal(fixture.context.draftSelectionHelp('check'), true);
  assert.match(fixture.input.value, /检查理解/);
});

test('a second selection replaces only generated drafts and only the transient local prompt', () => {
  const fixture = harness();
  const oldMessage = new Element('article');
  oldMessage.textContent = '之前的回答';
  fixture.thread.append(oldMessage);
  fixture.context.showSelectionHelp(selection);
  fixture.context.showSelectionHelp({ ...selection, quote: '另一段原文。' });
  assert.equal(fixture.thread.children.length, 2);
  assert.equal(fixture.thread.children[0], oldMessage);
  assert.match(fixture.input.value, /另一段原文/);
  fixture.input.value += '我补充了自己的理解。';
  const edited = fixture.input.value;
  fixture.context.showSelectionHelp(selection);
  assert.equal(fixture.input.value, edited);
});

test('long quotations remain visibly bounded within the server question limit', () => {
  const fixture = harness();
  const prompt = fixture.context.selectionHelpPrompt(
    { quote: '甲'.repeat(8000), source: 'origin' },
    'check',
  );
  assert.ok(prompt.length < 4000);
  assert.match(prompt, /引用已截取/);
  assert.match(prompt, /先不要给答案/);
});

test('raw excerpts remain plain text rather than untrusted markup', () => {
  const fixture = harness();
  const quote = '<img src=x onerror=alert(1)> **不能执行或转换**';
  fixture.context.showSelectionHelp({ ...selection, quote });
  const displayed = fixture.document.getElementById('knowledge-selection-quote');
  assert.equal(displayed.textContent, quote);
  assert.equal(displayed.children.length, 0);
  assert.equal(displayed.innerHTML, undefined);
});

test('different nodes and outdated body/origin versions cannot replace the current selection', () => {
  const fixture = harness();
  fixture.context.showSelectionHelp(selection);
  const current = fixture.state.chatSelection;
  for (const raw of [
    { ...selection, nodeId: 'SS-99-01' },
    { ...selection, documentVersion: 'old-body' },
    { ...selection, source: 'origin', documentVersion: 'body-v1' },
    { ...selection, quote: '  ' },
    null,
  ])
    assert.equal(fixture.context.showSelectionHelp(raw), false);
  assert.equal(fixture.state.chatSelection, current);
});

test('busy requests disable choices and preserve an input draft', () => {
  const fixture = harness({ sending: true, inputValue: '正在发送的上下文' });
  fixture.context.showSelectionHelp(selection);
  const choices = fixture.document.getElementById('knowledge-selection-guidance').children[1]
    .children[3];
  assert.ok(choices.children.every((item) => item.disabled));
  assert.equal(fixture.context.draftSelectionHelp('explain'), false);
  assert.equal(fixture.input.value, '正在发送的上下文');
  assert.match(source, /querySelectorAll\('\[data-chat-prompt\], \[data-selection-help\]'\)/);
});

test('session changes discard excerpts and local drafts together with visible chat history', () => {
  const fixture = harness();
  fixture.context.showSelectionHelp(selection);
  const clearStart = source.indexOf('  function clearChatForSession()');
  const clearEnd = source.indexOf("  window.addEventListener('freebbs:session-change'", clearStart);
  const context = vm.createContext({
    ...fixture,
    state: fixture.state,
    document: fixture.document,
    chatGeneration: 0,
    chatDraftStore: { clear: () => true },
    chatDraftIdentity: 'prior-session',
    chatDraftVersionBlocked: false,
    setChatDraftNotice: () => {},
    appendChatMessage: (role, message) => {
      assert.equal(role, 'assistant');
      const welcome = new Element();
      welcome.textContent = message;
      fixture.thread.append(welcome);
      return welcome;
    },
    pendingQuestionNavigation: {},
  });
  vm.runInContext(source.slice(clearStart, clearEnd), context);
  context.clearChatForSession();
  assert.equal(fixture.state.chatSelection, null);
  assert.equal(fixture.state.chatSelectionDraft, '');
  assert.equal(fixture.state.chatMessages.length, 0);
  assert.equal(fixture.input.value, '');
  assert.equal(fixture.thread.children.length, 1);
  assert.equal(fixture.thread.children[0].id, 'knowledge-chat-welcome');
  assert.match(fixture.thread.children[0].textContent, /需要时.*讲解原理/);
  assert.equal(context.chatDraftIdentity, '');
});

test('annotation entry forwards explicit source and version to the current Max panel', () => {
  const workspace = fs.readFileSync(
    path.join(__dirname, '../public/knowledge-workspace.js'),
    'utf8',
  );
  const eventStart = workspace.indexOf("  page.addEventListener('knowledge:annotation-ask'");
  const eventEnd = workspace.indexOf(
    "  page.addEventListener('knowledge:annotation-correction'",
    eventStart,
  );
  const calls = [];
  const context = vm.createContext({
    page: {
      addEventListener(name, handler) {
        this.handler = handler;
      },
    },
    openInteraction: (...args) => calls.push(args),
  });
  vm.runInContext(workspace.slice(eventStart, eventEnd), context);
  context.page.handler({ detail: { annotation: { anchor: { ...selection, section: 'origin' } } } });
  assert.equal(calls[0][0], 'max');
  assert.equal(calls[0][2].source, 'origin');
  assert.equal(calls[0][2].quote, selection.quote);
  assert.equal(calls[0][2].nodeId, selection.nodeId);
});
