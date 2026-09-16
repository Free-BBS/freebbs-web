const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const clone = (value) => JSON.parse(JSON.stringify(value));
function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return source.slice(from, to);
}
const messageText = '这个是什么图片';
const image = { label: '截图.png', dataUrl: 'data:image/png;base64,YQ==' };
function harness({ failSave = false, failModel = false, loseSaveResponse = false } = {}) {
  const state = { currentDid: '', dialogs: [], messages: [], pendingSend: null, isSending: false };
  const input = { value: messageText, disabled: false, focus() {} };
  let attachments = [image];
  const saves = [];
  const requests = [];
  const stored = new Map();
  let uuidCount = 0;
  let articles = [];
  const append = (role, content) => {
    const article = { role, content, querySelector: () => ({}) };
    articles.push(article);
    return article;
  };
  const context = {
    aiChatState: state,
    aiChatInput: input,
    aiChatSend: {},
    userState: { isLoggedIn: true, token: 'test' },
    window: {
      crypto: {
        randomUUID: () => {
          uuidCount += 1;
          return `00000000-0000-4000-8000-${String(uuidCount).padStart(12, '0')}`;
        },
      },
      setTimeout: () => 1,
      clearTimeout() {},
      FreeBbsMaxImages: {
        snapshot: () => clone(attachments),
        clear: () => {
          attachments = [];
        },
        setBusy() {},
        show() {},
      },
      FreeBbsReasoning: { update() {}, finish() {} },
    },
    appendAiChatMessage: append,
    renderAiChatThread() {
      articles = [];
      state.messages.forEach((message) => append(message.role, message.content));
    },
    updateAiChatMessage: (article, content) => {
      article.content = content;
    },
    resizeAiChatInput() {},
    startAiChatThinkingStatus() {},
    setAiChatThinkingBubble() {},
    stopAiChatThinkingStatus() {},
    setAiChatStatus() {},
    renderAiDialogList() {},
    updateAiDialogUrl() {},
    getAiDialogTitle: () => '图片对话',
    createAiNavigationSnapshot: () => null,
    createAiRagSnapshot: () => null,
    renderMaxNavigationRoutes() {},
    renderMaxSubagentResult() {},
    addMentionedCourseMapRoute: async (result) => result,
    async callApi(route, options) {
      assert.equal(route, '/ai/dialogs');
      const payload = JSON.parse(options.body);
      saves.push(payload);
      const did = payload.did || `server-generated-${saves.length}`;
      if (failSave && saves.length === 1) {
        if (loseSaveResponse) stored.set(did, payload.messages);
        throw new Error('保存响应失败');
      }
      stored.set(did, payload.messages);
      return { dialog: { did, title: payload.title } };
    },
    async requestMaxNavigation(payload) {
      requests.push(clone(payload));
      if (failModel && requests.length === 1) throw new Error('模型请求失败');
      return { answer: '这是一张电路图', model: 'test-vision' };
    },
  };
  vm.createContext(context);
  vm.runInContext(
    [
      section('function buildAiChatPayload(', '\nconst MAX_NAVIGATION_PATHS'),
      section('async function saveAiDialog(', '\nasync function loadAiDialog('),
      section('async function handleAiChatSubmit(', '\nfunction initializeAiChatPage('),
    ].join('\n'),
    context,
  );
  return {
    state,
    input,
    saves,
    requests,
    stored,
    submit: () => context.handleAiChatSubmit({ preventDefault() {} }),
    images: () => attachments,
    setImages: (items) => {
      attachments = items;
    },
    articles: () => articles,
  };
}
function assertSingleTurn(h) {
  assert.equal(h.state.messages.filter((message) => message.role === 'user').length, 1);
  assert.equal(h.state.messages.filter((message) => message.role === 'assistant').length, 1);
  assert.deepEqual(clone(h.state.messages[0].images), [image]);
  for (const saved of h.saves) {
    assert.equal(saved.messages.filter((message) => message.role === 'user').length, 1);
    assert.equal(saved.messages.flatMap((message) => message.images || []).length, 1);
  }
  for (const request of h.requests) {
    assert.deepEqual(request.messages, [{ role: 'user', content: messageText }]);
    assert.deepEqual(request.vision_images, [image]);
  }
  assert.equal(h.articles().filter((article) => article.role === 'user').length, 1);
  assert.equal(h.articles().filter((article) => article.role === 'assistant').length, 1);
  assert.equal(h.state.pendingSend, null);
}

test('save failure retry reuses the user message and image before calling the model', async () => {
  const h = harness({ failSave: true });
  await h.submit();
  assert.equal(h.requests.length, 0);
  assert.equal(h.input.value, messageText);
  assert.deepEqual(h.images(), [image]);
  await h.submit();
  assert.equal(h.requests.length, 1);
  assertSingleTurn(h);
});

test('model failure retry saves and sends one user message and one image', async () => {
  const h = harness({ failModel: true });
  await h.submit();
  assert.equal(h.input.value, messageText);
  assert.deepEqual(h.images(), [image]);
  const originalMessage = h.state.messages[0];
  await h.submit();
  assert.equal(h.requests.length, 2);
  assert.equal(h.state.messages[0], originalMessage);
  assertSingleTurn(h);
});

test('lost save acknowledgement reuses the dialog id instead of creating a second dialog', async () => {
  const h = harness({ failSave: true, loseSaveResponse: true });
  await h.submit();
  await h.submit();
  assert.equal(h.stored.size, 1);
  assert.ok(h.saves[0].did);
  assert.equal(h.saves[0].did, h.saves[1].did);
  assertSingleTurn(h);
});

test('a deliberate identical message after success is a new turn, not a retry', async () => {
  const h = harness();
  await h.submit();
  h.input.value = messageText;
  h.setImages([image]);
  await h.submit();
  assert.equal(h.state.messages.length, 4);
  assert.equal(h.requests[1].messages.length, 3);
});

test('editing a failed question or replacing its image creates a new turn without overwriting history', async () => {
  for (const edit of ['text', 'image']) {
    const h = harness({ failModel: true });
    await h.submit();
    if (edit === 'text') h.input.value = '请解释图片中的电路';
    else h.setImages([{ ...image, label: '另一张图.png', dataUrl: 'data:image/png;base64,Yg==' }]);
    await h.submit();
    assert.equal(h.state.messages.filter((message) => message.role === 'user').length, 2);
    assert.equal(h.state.messages[0].content, messageText);
    assert.deepEqual(clone(h.state.messages[0].images), [image]);
  }
});
