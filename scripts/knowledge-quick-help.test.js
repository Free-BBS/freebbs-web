const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/knowledge.js'), 'utf8');
const first = source.indexOf('  function prepareChatPrompt(');
const last = source.indexOf('  async function submitChatPrompt(', first);
assert.ok(first > 0 && last > first);
const code = source.slice(first, last);

function harness({ draft = '', sending = false, selection = null } = {}) {
  const input = { value: draft, focus() {} };
  const notices = [];
  const opens = [];
  const tabs = [];
  let saved = 0;
  const state = {
    chatSending: sending,
    chatSelection: selection,
    chatSelectionDraft: selection ? draft : '',
    chatMessages: [{ role: 'user', content: '之前的真实提问' }],
  };
  const sandbox = {
    state,
    document: { getElementById: () => input },
    setChatOpen: (value) => opens.push(value),
    setChatTab: (value) => tabs.push(value),
    setChatDraftNotice: (value) => notices.push(value),
    persistChatDraft: () => {
      saved += 1;
    },
    submitChatPrompt: () => {
      throw new Error('Preparing help must not send');
    },
  };
  vm.runInNewContext(code, sandbox);
  return {
    input,
    state,
    notices,
    opens,
    tabs,
    prepare: sandbox.prepareChatPrompt,
    saved: () => saved,
  };
}

test('quick help prepares one editable draft without sending, adding evidence or changing history', () => {
  const fixture = harness();
  const before = JSON.stringify(fixture.state);
  assert.equal(fixture.prepare('  用直觉解释这个知识点  '), true);
  assert.equal(fixture.input.value, '用直觉解释这个知识点');
  assert.equal(fixture.saved(), 1);
  assert.deepEqual(fixture.tabs, ['max']);
  assert.deepEqual(fixture.opens, [true]);
  assert.match(fixture.notices.at(-1), /点击“发送”/);
  assert.equal(JSON.stringify(fixture.state), before);
  assert.doesNotMatch(
    code,
    /streamKnowledgeRagResponse|submitChatPrompt\(|callApi|chatMessages\.push/,
  );
});

test('an existing hand-written or selected-quote draft always wins over a shortcut', () => {
  for (const selection of [null, { quote: '原文引用', source: 'origin' }]) {
    const fixture = harness({ draft: '我自己的问题和引用，尚未发送。', selection });
    const before = JSON.stringify(fixture.state);
    assert.equal(fixture.prepare('给我一道练习小题'), false);
    assert.equal(fixture.input.value, '我自己的问题和引用，尚未发送。');
    assert.equal(fixture.saved(), 0);
    assert.equal(JSON.stringify(fixture.state), before);
    assert.match(fixture.notices.at(-1), /已保留/);
  }
});

test('pending replies and their next-question drafts stay untouched by another help event', () => {
  for (const draft of ['', '等待回复时想起的下一条问题']) {
    const fixture = harness({
      draft,
      sending: true,
      selection: { quote: '当前引用', source: 'annotation' },
    });
    const before = JSON.stringify(fixture.state);
    assert.equal(fixture.prepare('快捷问题'), false);
    assert.equal(fixture.input.value, draft);
    assert.equal(fixture.saved(), 0);
    assert.equal(JSON.stringify(fixture.state), before);
    assert.match(fixture.notices.at(-1), /正在等待回答/);
  }
});

test('empty shortcuts do nothing and prepared questions stay within the visible input limit', () => {
  const fixture = harness();
  assert.equal(fixture.prepare('  '), false);
  assert.deepEqual(fixture.opens, []);
  assert.equal(fixture.prepare('问'.repeat(4500)), true);
  assert.equal(fixture.input.value.length, 4000);
});

test('both shortcut surfaces prepare a question while the normal form remains the send action', () => {
  const ask = source.slice(
    source.indexOf("  page.addEventListener('knowledge:ask'"),
    source.indexOf("  page.addEventListener('knowledge:show-content'"),
  );
  assert.match(ask, /prepareChatPrompt\(event\.detail\?\.prompt\)/);
  assert.doesNotMatch(ask, /submitChatPrompt|streamKnowledgeRagResponse/);
  const binding = source.slice(
    source.indexOf('  function bindChatControls('),
    source.indexOf('  function renderKnowledgeOrigin('),
  );
  assert.match(binding, /prepareChatPrompt\(button\.dataset\.chatPrompt\)/);
  assert.match(
    binding,
    /form\?\.addEventListener\('submit'[\s\S]*await submitChatPrompt\(prompt\)/,
  );
  assert.equal(
    (source.match(/\bsubmitChatPrompt\(/g) || []).length,
    2,
    'one definition and one explicit form send',
  );
});
