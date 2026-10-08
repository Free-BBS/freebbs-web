const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const uiState = require('../public/ui-state');

const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
function extract(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Actual function exists: ${start}`);
  return source.slice(from, to);
}

class Element {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = doc;
    this.dataset = {};
    this.attributes = {};
    this.children = [];
    this.html = '';
    this.text = '';
    this.className = '';
  }

  set textContent(value) {
    this.text = value;
    this.html = '';
    this.children = [];
  }

  get textContent() {
    return (
      this.text +
      this.html.replace(/<[^>]+>/g, '') +
      this.children.map((node) => node.textContent).join('')
    );
  }

  set innerHTML(value) {
    this.html = value;
    this.text = '';
    this.children = [];
  }

  get innerHTML() {
    return this.html;
  }

  get firstElementChild() {
    return this.children[0];
  }

  setAttribute(key, value) {
    this.attributes[key] = String(value);
  }

  getAttribute(key) {
    return this.attributes[key];
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.html = '';
    this.text = '';
    this.children = children;
  }

  addEventListener(type, callback) {
    this.listener = { type, callback };
  }

  focus() {
    this.focused = true;
  }

  matches(selector) {
    const action = selector.match(/data-action="([^"]+)"/);
    if (action) return this.dataset.action === action[1];
    return selector.startsWith('.') && this.className.split(' ').includes(selector.slice(1));
  }

  closest(selector) {
    return this.matches(selector) ? this : null;
  }

  querySelector(selector) {
    for (const child of this.children) {
      if (child.matches(selector)) return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }
}

function fixture() {
  const doc = { createElement: (tag) => new Element(tag, doc) };
  const list = doc.createElement('div');
  const thread = doc.createElement('div');
  const status = doc.createElement('p');
  const state = {
    dialogOwner: 'U1:T1',
    dialogSessionVersion: 0,
    dialogSessionStale: false,
    dialogsRequestId: 0,
    dialogRequestId: 0,
    requestedDid: '',
    dialogsStatus: 'idle',
    dialogsError: '',
    currentDid: '',
    dialogs: [],
    messages: [],
    pendingSend: null,
    isSending: false,
  };
  const requests = [];
  let urlDid = '';
  const storage = new Map([['token', 'T1']]);
  const context = {
    aiChatState: state,
    aiChatDialogList: list,
    aiChatThread: thread,
    aiChatStatus: status,
    aiChatInput: { focus() {} },
    aiChatSend: {},
    userState: { uid: 'U1', token: 'T1', isLoggedIn: true },
    window: {
      freeBbsUiState: uiState,
      crypto: { randomUUID: () => 'SAVED_ID' },
      dispatchEvent() {},
    },
    CustomEvent: function CustomEvent(type, value) {
      this.type = type;
      this.detail = value.detail;
    },
    localStorage: {
      getItem: (key) => storage.get(key),
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    sessionStorage: { removeItem() {} },
    STORAGE_KEY: 'token',
    renderUser: () => context.renderAiDialogList(),
    renderSettingsForm() {},
    renderAdminSection() {},
    setCheckinShortcutState() {},
    isAiChatPage: () => true,
    getAiDialogIdFromUrl: () => urlDid,
    updateAiDialogUrl: (did) => {
      urlDid = did;
    },
    getAiDialogTitle: () => '保存的对话',
    renderAiChatThread: () => {
      thread.textContent = state.messages.map((item) => item.content).join('|');
    },
    setAiChatStatus: (text) => {
      status.textContent = text;
    },
    setAiDialogId() {},
    clearAiChatStatusTimer() {},
    setAiDialogsOpen() {},
    escapeHtml: (value) => String(value || ''),
    formatDateTime: () => '',
    callApi: (url, options) =>
      new Promise((resolve, reject) => {
        requests.push({ url, options, resolve, reject });
      }),
  };
  vm.runInNewContext(
    [
      extract('function getAiDialogOwner()', 'async function saveAiDialog('),
      extract('async function saveAiDialog(', 'async function streamAgentChatResponse('),
      extract('function saveSession(', 'async function callApi('),
    ].join('\n'),
    context,
  );
  return {
    state,
    context,
    requests,
    list,
    thread,
    status,
    setUrl: (value) => {
      urlDid = value;
    },
  };
}

const dialog = (did, text = `正文 ${did}`) => ({
  did,
  title: `对话 ${did}`,
  messages: [{ role: 'assistant', content: text }],
});
async function successfulList(f, rows = [{ did: 'D1', title: '当前用户的对话' }]) {
  const pending = f.context.loadAiDialogs();
  f.requests.at(-1).resolve({ dialogs: rows });
  await pending;
}

function backgroundFixture() {
  const f = fixture();
  const latest = [];
  const polls = [];
  const articles = [];
  const acknowledgements = [];
  const remembered = [];
  Object.assign(f.context, {
    document: { hidden: false },
    getLatestAiBackgroundTask: (kind, did) =>
      new Promise((resolve, reject) => {
        latest.push({ kind, did, resolve, reject });
      }),
    getAiBackgroundTask: (id) =>
      new Promise((resolve, reject) => {
        polls.push({ id, resolve, reject });
      }),
    addMentionedCourseMapRoute: async (result) => result,
    appendAiChatMessage: (role, content) => {
      const article = { role, content };
      articles.push(article);
      return article;
    },
    updateAiChatMessage: (article, content) => {
      article.content = content;
    },
    startAiChatThinkingStatus() {},
    stopAiChatThinkingStatus: (text = '') => {
      f.status.textContent = text;
    },
    setAiChatThinkingBubble() {},
    createAiNavigationSnapshot: () => null,
    createAiRagSnapshot: () => null,
    renderMaxNavigationRoutes() {},
    renderMaxSubagentResult() {},
    acknowledgeAiBackgroundTask: async (id) => acknowledgements.push(id),
    rememberMaxBackgroundTask: (id) => remembered.push(id),
  });
  f.context.window.setTimeout = (callback) => callback();
  vm.runInNewContext(
    extract('async function waitForMaxBackgroundTask(', 'function getAiDialogTitle('),
    f.context,
  );
  f.state.currentDid = 'D1';
  f.state.messages = [{ role: 'user', content: '之前的问题' }];
  f.setUrl('D1');
  return { ...f, latest, polls, articles, acknowledgements, remembered };
}

async function settle() {
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
}

const completedTask = {
  id: 'TASK1',
  status: 'completed',
  acknowledged: false,
  result: { answer: '后台回答', model: 'test-model' },
};

function liveFixture(base = fixture()) {
  const f = base;
  const models = [];
  const articles = [];
  const reasoning = [];
  const busy = [];
  const cleared = [];
  const timers = [];
  let attachments = [{ label: '图片.png', dataUrl: 'data:image/png;base64,YQ==' }];
  Object.assign(f.context, {
    aiChatInput: {
      value: '我的问题',
      disabled: false,
      focus() {
        this.focused = true;
      },
    },
    aiChatSend: { disabled: false },
    appendAiChatMessage: (role, content) => {
      const article = { role, content, querySelector: () => ({}) };
      articles.push(article);
      return article;
    },
    updateAiChatMessage: (article, content) => {
      article.content = content;
    },
    resizeAiChatInput() {},
    startAiChatThinkingStatus: () => {
      f.status.textContent = '思考中';
      f.state.statusTimer = 10;
    },
    stopAiChatThinkingStatus: (text = '') => {
      f.state.statusTimer = 0;
      f.status.textContent = text;
    },
    clearAiChatStatusTimer: () => {
      f.state.statusTimer = 0;
    },
    setAiChatThinkingBubble: (article, text) => {
      article.thinking = text;
    },
    createAiNavigationSnapshot: () => null,
    createAiRagSnapshot: () => null,
    renderMaxNavigationRoutes() {},
    renderMaxSubagentResult() {},
    addMentionedCourseMapRoute: async (result) => result,
    requestMaxNavigation: (payload, onReasoning, onProgress) =>
      new Promise((resolve, reject) => {
        models.push({ payload, onReasoning, onProgress, resolve, reject });
      }),
  });
  Object.assign(f.context.window, {
    setTimeout: (callback) => {
      timers.push(callback);
      return timers.length;
    },
    clearTimeout() {},
    FreeBbsMaxImages: {
      snapshot: () => attachments,
      setBusy: (value) => busy.push(value),
      clear: () => {
        attachments = [];
        cleared.push('images');
      },
      show() {},
    },
    FreeBbsMaxFiles: {
      snapshot: () => '',
      pages: () => [],
      documents: () => [],
      setBusy: (value) => busy.push(value),
      clear: () => cleared.push('files'),
    },
    FreeBbsReasoning: {
      update: (article, value) => reasoning.push(value),
      finish() {},
    },
  });
  vm.runInNewContext(
    [
      extract('function buildAiChatPayload(', 'const MAX_NAVIGATION_PATHS'),
      extract('async function handleAiChatSubmit(', 'function initializeAiChatPage('),
    ].join('\n'),
    f.context,
  );
  return {
    ...f,
    models,
    articles,
    reasoning,
    busy,
    cleared,
    timers,
    submit: () => f.context.handleAiChatSubmit({ preventDefault() {} }),
    setAttachments: (value) => {
      attachments = value;
    },
    attachments: () => attachments,
  };
}

async function startLiveModel(f) {
  const pending = f.submit();
  f.requests.at(-1).resolve({ dialog: { did: f.state.currentDid, title: '当前问题' } });
  await settle();
  assert.equal(f.models.length, 1);
  return { pending };
}

test('AI history initial failure is an error, not a successful empty list, and one manual GET retry recovers', async () => {
  const f = fixture();
  const initial = f.context.loadAiDialogs();
  assert.equal(f.list.dataset.uiState, 'loading');
  assert.equal(f.list.getAttribute('aria-busy'), 'true');
  assert.doesNotMatch(f.list.textContent, /还没有/);
  f.requests[0].reject(new Error('network'));
  await initial;
  assert.equal(f.list.dataset.uiState, 'error');
  assert.equal(f.list.firstElementChild.getAttribute('role'), 'alert');
  assert.doesNotMatch(f.list.textContent, /还没有/);
  assert.equal(f.requests.length, 1);
  const retry = f.list.querySelector('[data-action="retry-ai-dialogs"]');
  const recovery = f.context.handleAiDialogListClick({ target: retry });
  assert.equal(f.requests[1].options.method, 'GET');
  f.requests[1].resolve({ dialogs: [] });
  await recovery;
  assert.equal(f.list.dataset.uiState, 'empty');
  assert.equal(f.list.getAttribute('aria-busy'), 'false');
  assert.equal(f.list.firstElementChild.getAttribute('role'), 'status');
  assert.match(f.list.textContent, /还没有保存的对话/);
});

test('AI history refresh failure keeps the current owner’s real history and a retry action', async () => {
  const f = fixture();
  await successfulList(f);
  const refresh = f.context.loadAiDialogs();
  assert.match(f.list.innerHTML, /当前用户的对话/);
  f.requests.at(-1).reject(Object.assign(new Error('failure'), { status: 503 }));
  await refresh;
  assert.equal(f.state.dialogs[0].did, 'D1');
  assert.match(f.list.innerHTML, /当前用户的对话/);
  assert.equal(f.list.dataset.uiState, 'error');
  assert.ok(f.list.querySelector('[data-action="retry-ai-dialogs"]'));
});

test('an older history error cannot overwrite a newer successful list', async () => {
  const f = fixture();
  const old = f.context.loadAiDialogs();
  const current = f.context.loadAiDialogs();
  f.requests[1].resolve({ dialogs: [{ did: 'CURRENT', title: '新列表' }] });
  await current;
  f.requests[0].reject(new Error('old error'));
  await old;
  assert.equal(f.list.dataset.uiState, 'ready');
  assert.equal(f.state.dialogs[0].did, 'CURRENT');
});

for (const status of [401, 403]) {
  for (const request of ['list', 'detail']) {
    test(`${request} ${status} removes every private AI history/message before showing an error`, async () => {
      const f = fixture();
      f.state.currentDid = 'PRIVATE';
      f.state.dialogs = [{ did: 'PRIVATE', title: '私密标题' }];
      f.state.messages = [{ role: 'assistant', content: '私密正文' }];
      f.state.dialogsStatus = 'ready';
      f.context.renderAiChatThread();
      f.context.renderAiDialogList();
      const pending =
        request === 'list' ? f.context.loadAiDialogs() : f.context.loadAiDialog('PRIVATE');
      f.requests[0].reject(Object.assign(new Error('denied'), { status }));
      await pending;
      assert.equal(f.state.dialogs.length, 0);
      assert.equal(f.state.messages.length, 0);
      assert.equal(f.state.currentDid, '');
      assert.doesNotMatch(f.list.textContent + f.thread.textContent, /私密|PRIVATE/);
      assert.equal(f.list.dataset.uiState, 'error');
      assert.equal(f.thread.getAttribute('aria-busy'), 'false');
    });
  }
}

for (const change of ['uid', 'token', 'session']) {
  for (const request of ['list', 'detail']) {
    for (const failure of [false, true]) {
      test(`late AI ${request} ${failure ? 'error' : 'success'} after ${change} is ignored`, async () => {
        const f = fixture();
        const old = request === 'list' ? f.context.loadAiDialogs() : f.context.loadAiDialog('OLD');
        if (change === 'uid') f.context.userState.uid = 'U2';
        if (change === 'token') f.context.userState.token = 'T2';
        if (change === 'session') f.context.resetAiDialogSession();
        f.state.messages = [{ role: 'assistant', content: '当前用户' }];
        f.state.dialogs = [{ did: 'CURRENT', title: '当前列表' }];
        f.status.textContent = '当前状态';
        if (failure) f.requests[0].reject(new Error('old error'));
        else
          f.requests[0].resolve(
            request === 'list'
              ? { dialogs: [{ did: 'PRIVATE' }] }
              : { dialog: dialog('OLD', '私密旧正文') },
          );
        await old;
        assert.equal(f.state.messages[0].content, '当前用户');
        assert.equal(f.state.dialogs[0].did, 'CURRENT');
        assert.equal(f.status.textContent, '当前状态');
      });
    }
  }
}

test('actual logout invalidates pending details, including a later login with the same uid/token', async () => {
  const f = fixture();
  const old = f.context.loadAiDialog('OLD');
  f.context.clearSession();
  f.context.saveSession('T1', { uid: 'U1', username: 'same user' });
  f.requests[1].resolve({ dialogs: [] });
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  f.requests[0].resolve({ dialog: dialog('OLD', '旧会话私密正文') });
  await old;
  assert.equal(f.state.messages.length, 0);
  assert.equal(f.state.currentDid, '');
  assert.doesNotMatch(f.thread.textContent, /旧会话私密/);
});

test('actual login as another owner clears the previous user’s visible content immediately', async () => {
  const f = fixture();
  f.state.messages = [{ role: 'assistant', content: '私密正文' }];
  f.state.dialogs = [{ did: 'SECRET', title: '私密标题' }];
  f.state.dialogsStatus = 'ready';
  f.context.renderAiChatThread();
  f.context.renderAiDialogList();
  f.context.saveSession('T2', { uid: 'U2', username: 'another user' });
  assert.equal(f.state.messages.length, 0);
  assert.equal(f.state.dialogs.length, 0);
  assert.doesNotMatch(f.thread.textContent + f.list.textContent, /私密/);
  f.requests[0].resolve({ dialogs: [] });
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
});

test('choosing a new dialog invalidates pending detail success and keeps the new blank conversation', async () => {
  const f = fixture();
  const old = f.context.loadAiDialog('OLD');
  f.context.startNewAiDialog();
  f.requests[0].resolve({ dialog: dialog('OLD') });
  await old;
  assert.equal(f.state.currentDid, '');
  assert.equal(f.state.messages.length, 0);
  assert.equal(f.status.textContent, '');
  assert.equal(f.thread.getAttribute('aria-busy'), 'false');
});

test('a late initial history load cannot reopen the old URL after the user chose a new conversation', async () => {
  const f = fixture();
  f.setUrl('OLD_URL');
  const pending = f.context.loadAiDialogs();
  f.context.startNewAiDialog();
  f.requests[0].resolve({ dialogs: [{ did: 'OLD_URL' }] });
  await pending;
  assert.equal(f.requests.length, 1);
  assert.equal(f.state.currentDid, '');
  assert.equal(f.state.messages.length, 0);
});

test('competing detail GETs only apply the most recently selected did', async () => {
  const f = fixture();
  const old = f.context.loadAiDialog('OLD');
  const current = f.context.loadAiDialog('CURRENT');
  f.requests[1].resolve({ dialog: dialog('CURRENT') });
  await current;
  f.requests[0].resolve({ dialog: dialog('OLD') });
  await old;
  assert.equal(f.state.currentDid, 'CURRENT');
  assert.equal(f.state.messages[0].content, '正文 CURRENT');
  assert.equal(f.thread.dataset.uiState, 'ready');
});

test('detail identifier mismatches are rejected and one manual GET retry can recover', async () => {
  const f = fixture();
  const pending = f.context.loadAiDialog('D1');
  f.requests[0].resolve({ dialog: dialog('WRONG') });
  await pending;
  assert.equal(f.state.messages.length, 0);
  assert.equal(f.thread.dataset.uiState, 'error');
  const retry = f.status.querySelector('[data-action="retry-ai-dialog"]');
  assert.ok(retry);
  const recovery = f.context.handleAiDialogDetailRetry({ target: retry });
  assert.equal(f.requests[1].options.method, 'GET');
  f.requests[1].resolve({ dialog: dialog('D1') });
  await recovery;
  assert.equal(f.state.currentDid, 'D1');
  assert.equal(f.state.messages[0].content, '正文 D1');
});

test('a successful save supersedes a pending history GET without changing the saved did', async () => {
  const f = fixture();
  f.state.messages = [{ role: 'user', content: '要保存的消息' }];
  const pending = f.context.loadAiDialogs();
  const save = f.context.saveAiDialog();
  assert.equal(f.requests[1].options.method, 'POST');
  f.requests[1].resolve({ dialog: { did: 'SAVED_ID', title: '保存的对话' } });
  await save;
  f.requests[0].resolve({ dialogs: [] });
  await pending;
  assert.equal(f.state.currentDid, 'SAVED_ID');
  assert.equal(f.state.dialogs[0].did, 'SAVED_ID');
  assert.equal(f.list.dataset.uiState, 'ready');
});

for (const change of ['uid', 'token', 'session', 'new-dialog', 'detail']) {
  for (const failure of [false, true]) {
    test(`late save POST ${failure ? 'failure' : 'ACK'} after ${change} cannot overwrite the current conversation`, async () => {
      const f = fixture();
      f.state.currentDid = 'OLD';
      f.state.messages = [{ role: 'user', content: '旧用户消息' }];
      const pending = f.context.saveAiDialog({ throwOnError: true });
      assert.equal(f.requests.length, 1);
      assert.equal(f.requests[0].options.method, 'POST');
      if (change === 'uid') f.context.userState.uid = 'U2';
      if (change === 'token') f.context.userState.token = 'T2';
      if (change === 'session') f.context.resetAiDialogSession();
      if (change === 'new-dialog') f.context.startNewAiDialog();
      if (change === 'detail') f.context.invalidateAiDialogDetail();
      f.state.currentDid = 'CURRENT';
      f.state.messages = [{ role: 'user', content: '当前用户消息' }];
      f.state.dialogs = [{ did: 'CURRENT', title: '当前历史' }];
      f.state.dialogsStatus = 'ready';
      f.status.textContent = '当前状态';
      f.setUrl('CURRENT');
      if (failure) f.requests[0].reject(new Error('旧保存错误'));
      else f.requests[0].resolve({ dialog: dialog('OLD', '旧私密消息') });
      await pending;
      assert.equal(f.requests.length, 1, 'No automatic write retry');
      assert.equal(f.state.currentDid, 'CURRENT');
      assert.equal(f.state.dialogs[0].did, 'CURRENT');
      assert.equal(f.state.messages[0].content, '当前用户消息');
      assert.equal(f.status.textContent, '当前状态');
      assert.equal(f.context.getAiDialogIdFromUrl(), 'CURRENT');
    });
  }
}

for (const change of ['owner', 'session', 'new-dialog', 'did']) {
  test(`late background latest GET after ${change} does not append or activate the old task`, async () => {
    const f = backgroundFixture();
    const pending = f.context.resumeMaxBackgroundTask();
    assert.equal(f.latest[0].did, 'D1');
    if (change === 'owner') f.context.userState.token = 'T2';
    if (change === 'session') f.context.resetAiDialogSession();
    if (change === 'new-dialog') f.context.startNewAiDialog();
    if (change === 'did') f.setUrl('D2');
    f.status.textContent = '当前状态';
    f.latest[0].resolve(completedTask);
    await pending;
    assert.equal(f.articles.length, 0);
    assert.equal(f.state.isSending, false);
    assert.equal(f.requests.length, 0);
    assert.equal(f.status.textContent, '当前状态');
    assert.equal(f.acknowledgements.length, 0);
  });
}

test('normal background restoration keeps the existing did, saves once and acknowledges the completed answer', async () => {
  const f = backgroundFixture();
  const pending = f.context.resumeMaxBackgroundTask();
  f.latest[0].resolve(completedTask);
  await settle();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].options.method, 'POST');
  assert.equal(JSON.parse(f.requests[0].options.body).did, 'D1');
  f.requests[0].resolve({ dialog: { did: 'D1', title: '当前历史' } });
  await pending;
  assert.equal(f.state.messages.length, 2);
  assert.match(f.state.messages[1].content, /后台回答/);
  assert.equal(f.state.currentDid, 'D1');
  assert.equal(f.state.isSending, false);
  assert.deepEqual(f.acknowledgements, ['TASK1']);
  assert.deepEqual(f.remembered, ['TASK1', '']);
});

for (const failure of [false, true]) {
  test(`background poll ${failure ? 'error' : 'answer'} after session change cannot update the current thread`, async () => {
    const f = backgroundFixture();
    const pending = f.context.resumeMaxBackgroundTask();
    f.latest[0].resolve({ ...completedTask, status: 'running' });
    await settle();
    assert.equal(f.polls.length, 1);
    f.context.resetAiDialogSession();
    f.state.messages = [{ role: 'user', content: '新会话' }];
    f.status.textContent = '当前状态';
    if (failure) f.polls[0].reject(new Error('旧后台错误'));
    else f.polls[0].resolve(completedTask);
    await pending;
    assert.equal(f.state.messages.length, 1);
    assert.equal(f.state.messages[0].content, '新会话');
    assert.equal(f.status.textContent, '当前状态');
    assert.equal(f.requests.length, 0);
    assert.equal(f.acknowledgements.length, 0);
    assert.deepEqual(f.remembered, ['TASK1']);
  });
}

test('background route enrichment awaiting a response cannot append after session changes', async () => {
  const f = backgroundFixture();
  let resolveRoute;
  f.context.addMentionedCourseMapRoute = () =>
    new Promise((resolve) => {
      resolveRoute = resolve;
    });
  const pending = f.context.resumeMaxBackgroundTask();
  f.latest[0].resolve(completedTask);
  await settle();
  assert.equal(typeof resolveRoute, 'function');
  f.context.resetAiDialogSession();
  f.state.messages = [{ role: 'user', content: '新会话' }];
  f.status.textContent = '当前状态';
  resolveRoute(completedTask.result);
  await pending;
  assert.equal(f.state.messages.length, 1);
  assert.equal(f.status.textContent, '当前状态');
  assert.equal(f.requests.length, 0);
  assert.equal(f.acknowledgements.length, 0);
});

test('late background save ACK after owner changes cannot write history or acknowledge the other owner task', async () => {
  const f = backgroundFixture();
  const pending = f.context.resumeMaxBackgroundTask();
  f.latest[0].resolve(completedTask);
  await settle();
  assert.equal(f.requests.length, 1);
  f.context.userState.token = 'T2';
  f.context.syncAiDialogSession();
  f.state.dialogs = [{ did: 'CURRENT', title: '新用户历史' }];
  f.status.textContent = '当前状态';
  f.requests[0].resolve({ dialog: dialog('D1') });
  await pending;
  assert.equal(f.state.currentDid, '');
  assert.equal(f.state.dialogs[0].did, 'CURRENT');
  assert.equal(f.status.textContent, '当前状态');
  assert.equal(f.acknowledgements.length, 0);
});

test('normal live send preserves message/image payload, both saves and current controls', async () => {
  const f = liveFixture();
  const { pending } = await startLiveModel(f);
  f.models[0].onReasoning({ step: '当前思路' });
  f.models[0].onProgress('当前进度');
  assert.equal(f.reasoning.length, 1);
  assert.equal(f.status.textContent, '当前进度');
  f.models[0].resolve(completedTask.result);
  await settle();
  assert.equal(f.requests.length, 2);
  assert.equal(JSON.parse(f.requests[1].options.body).messages.length, 2);
  assert.equal(f.models[0].payload.vision_images[0].label, '图片.png');
  f.requests[1].resolve({ dialog: { did: 'SAVED_ID', title: '当前问题' } });
  await pending;
  assert.equal(f.state.messages.length, 2);
  assert.match(f.state.messages[1].content, /后台回答/);
  assert.equal(f.state.pendingSend, null);
  assert.equal(f.state.isSending, false);
  assert.equal(f.context.aiChatInput.disabled, false);
  assert.equal(f.context.aiChatSend.disabled, false);
  assert.equal(f.attachments().length, 0);
});

test('a current live model failure restores the composer and keeps one retryable user message/image', async () => {
  const f = liveFixture();
  const { pending } = await startLiveModel(f);
  f.models[0].reject(new Error('模型暂时失败'));
  await pending;
  assert.equal(f.requests.length, 1);
  assert.equal(f.state.messages.length, 1);
  assert.equal(f.context.aiChatInput.value, '我的问题');
  assert.match(f.status.textContent, /模型暂时失败/);
  assert.equal(f.state.pendingSend.message, f.state.messages[0]);
  assert.equal(f.attachments().length, 1);
  assert.equal(f.state.isSending, false);
});

for (const change of ['uid', 'token', 'session', 'new-dialog', 'detail']) {
  for (const failure of [false, true]) {
    test(`late live ${failure ? 'error' : 'answer'} and progress after ${change} cannot update the current view`, async () => {
      const f = liveFixture();
      const { pending } = await startLiveModel(f);
      if (change === 'uid') {
        f.context.userState.uid = 'U2';
        f.context.syncAiDialogSession();
      }
      if (change === 'token') {
        f.context.userState.token = 'T2';
        f.context.syncAiDialogSession();
      }
      if (change === 'session') f.context.resetAiDialogSession();
      if (change === 'new-dialog') {
        f.context.invalidateAiDialogDetail();
        f.context.startNewAiDialog();
      }
      if (change === 'detail') {
        f.context.invalidateAiDialogDetail();
        const next = f.context.loadAiDialog('CURRENT');
        f.requests.at(-1).resolve({ dialog: dialog('CURRENT', '当前正文') });
        await next;
      }
      assert.equal(f.state.isSending, false, 'View reset immediately releases old busy state');
      assert.equal(f.state.statusTimer, 0);
      assert.equal(f.context.aiChatInput.disabled, false);
      assert.equal(f.context.aiChatSend.disabled, false);
      f.state.messages = [{ role: 'user', content: '当前消息' }];
      f.context.aiChatInput.value = '当前草稿';
      f.setAttachments([{ label: '当前图片' }]);
      f.status.textContent = '当前状态';
      const reads = f.requests.length;
      const clears = f.cleared.length;
      f.models[0].onReasoning({ step: '旧思路' });
      f.models[0].onProgress('旧进度');
      f.timers[0]();
      if (failure) f.models[0].reject(new Error('旧错误'));
      else f.models[0].resolve(completedTask.result);
      await pending;
      assert.equal(f.state.messages.length, 1);
      assert.equal(f.state.messages[0].content, '当前消息');
      assert.equal(f.context.aiChatInput.value, '当前草稿');
      assert.equal(f.status.textContent, '当前状态');
      assert.equal(f.reasoning.length, 0);
      assert.equal(f.requests.length, reads, 'No stale final save');
      assert.equal(f.cleared.length, clears, 'No stale attachment cleanup');
      assert.equal(f.attachments()[0].label, '当前图片');
    });
  }
}

test('a late initial live save ACK after logout cannot start a model or re-lock the new session', async () => {
  const f = liveFixture();
  const pending = f.submit();
  f.context.clearSession();
  assert.equal(f.state.isSending, false);
  assert.equal(f.context.aiChatInput.disabled, false);
  f.status.textContent = '已退出登录';
  f.requests[0].resolve({ dialog: dialog('SAVED_ID') });
  await pending;
  assert.equal(f.models.length, 0);
  assert.equal(f.status.textContent, '已退出登录');
  assert.equal(f.state.messages.length, 0);
});

test('old live finally cannot unlock a new account’s actively sending turn', async () => {
  const f = liveFixture();
  const { pending: old } = await startLiveModel(f);
  f.context.userState.token = 'T2';
  f.context.syncAiDialogSession();
  f.context.aiChatInput.value = '新用户的问题';
  const current = f.submit();
  assert.equal(f.state.isSending, true);
  assert.equal(f.context.aiChatInput.disabled, true);
  const controls = f.busy.length;
  f.models[0].resolve(completedTask.result);
  await old;
  assert.equal(f.state.isSending, true);
  assert.equal(f.context.aiChatInput.disabled, true);
  assert.equal(f.context.aiChatSend.disabled, true);
  assert.equal(f.busy.length, controls, 'Old finally cannot release new attachment controls');
  f.requests[1].resolve({ dialog: { did: 'SAVED_ID', title: '新问题' } });
  await settle();
  f.models[1].reject(new Error('当前模型失败'));
  await current;
  assert.equal(f.state.isSending, false);
});

test('old background finally cannot unlock a new send after account reset', async () => {
  const f = backgroundFixture();
  const pending = f.context.resumeMaxBackgroundTask();
  f.latest[0].resolve({ ...completedTask, status: 'running' });
  await settle();
  f.context.userState.token = 'T2';
  f.context.syncAiDialogSession();
  assert.equal(f.state.isSending, false);
  f.state.isSending = true;
  f.context.aiChatInput.disabled = true;
  f.context.aiChatSend.disabled = true;
  f.polls[0].resolve(completedTask);
  await pending;
  assert.equal(f.state.isSending, true);
  assert.equal(f.context.aiChatInput.disabled, true);
  assert.equal(f.context.aiChatSend.disabled, true);
});

test('failed history GET during a current send does not cancel the turn or release its controls', async () => {
  const f = liveFixture();
  const { pending } = await startLiveModel(f);
  const list = f.context.loadAiDialogs();
  f.requests[1].reject(Object.assign(new Error('temporary'), { status: 503 }));
  await list;
  assert.equal(f.state.isSending, true);
  assert.equal(f.context.aiChatInput.disabled, true);
  f.models[0].reject(new Error('当前模型失败'));
  await pending;
  assert.equal(f.state.isSending, false);
});

test('late live course-route enrichment cannot append or save after a view reset', async () => {
  const f = liveFixture();
  let resolveRoute;
  f.context.addMentionedCourseMapRoute = () =>
    new Promise((resolve) => {
      resolveRoute = resolve;
    });
  const { pending } = await startLiveModel(f);
  f.models[0].resolve(completedTask.result);
  await settle();
  f.context.resetAiDialogSession();
  f.status.textContent = '当前状态';
  resolveRoute(completedTask.result);
  await pending;
  assert.equal(f.state.messages.length, 0);
  assert.equal(f.requests.length, 1);
  assert.equal(f.status.textContent, '当前状态');
});

test('background resume requires the target conversation details to be loaded', async () => {
  const f = backgroundFixture();
  f.state.currentDid = '';
  await f.context.resumeMaxBackgroundTask();
  assert.equal(f.latest.length, 0);
  assert.equal(f.requests.length, 0);
});

test('a cross-tab stale session cannot submit or save with the old token', async () => {
  const f = liveFixture();
  f.state.messages = [{ role: 'user', content: '旧消息' }];
  f.state.dialogSessionStale = true;
  await f.submit();
  await f.context.saveAiDialog();
  assert.equal(f.requests.length, 0);
  assert.equal(f.models.length, 0);
  assert.equal(f.state.isSending, false);
  assert.match(f.status.textContent, /登录状态已变化/);
});

test('account reset releases controls and forgets only the in-page task tracking', () => {
  const f = liveFixture();
  f.state.backgroundTaskId = 'OLD_PRIVATE_TASK';
  f.state.isSending = true;
  f.state.statusTimer = 10;
  f.context.aiChatInput.disabled = true;
  f.context.aiChatSend.disabled = true;
  f.context.resetAiDialogSession();
  assert.equal(f.state.backgroundTaskId, '');
  assert.equal(f.state.isSending, false);
  assert.equal(f.state.statusTimer, 0);
  assert.equal(f.context.aiChatInput.disabled, false);
  assert.equal(f.context.aiChatSend.disabled, false);
  assert.deepEqual(f.busy, [false, false]);
});

for (const stage of ['options', 'start', 'poll']) {
  test(`late Max task ${stage} response cannot write task storage or callbacks under a different owner`, async () => {
    const f = backgroundFixture();
    const starts = [];
    const progress = [];
    const reasoning = [];
    let resolveOptions;
    let current = true;
    f.context.window.FreeBbsMaxModels = {
      chatOptions: () =>
        new Promise((resolve) => {
          resolveOptions = resolve;
        }),
    };
    f.context.startAiBackgroundTask = (kind, did, payload) =>
      new Promise((resolve) => {
        starts.push({ kind, did, payload, resolve });
      });
    vm.runInNewContext(
      extract('async function requestMaxNavigation(', 'function maxBackgroundTaskKey('),
      f.context,
    );
    const pending = f.context.requestMaxNavigation(
      { did: 'D1' },
      (value) => reasoning.push(value),
      (value) => progress.push(value),
      { isCurrent: () => current },
    );
    if (stage === 'options') current = false;
    resolveOptions({ model: 'test-model' });
    await settle();
    if (stage !== 'options') {
      assert.equal(starts.length, 1);
      if (stage === 'start') current = false;
      starts[0].resolve({ ...completedTask, status: stage === 'poll' ? 'running' : 'completed' });
      await settle();
      if (stage === 'poll') {
        current = false;
        f.polls[0].resolve(completedTask);
      }
    }
    const before = f.remembered.length;
    await pending;
    assert.equal(f.remembered.length, before);
    assert.equal(f.remembered.length, stage === 'poll' ? 1 : 0);
    assert.equal(progress.length, stage === 'poll' ? 1 : 0);
    assert.equal(reasoning.length, 0);
    assert.equal(starts.length, stage === 'options' ? 0 : 1);
  });
}

test('the send/background entry points invalidate detail GETs, not their POST or stream algorithms', () => {
  const send = extract('async function handleAiChatSubmit(', 'function initializeAiChatPage(');
  const background = extract(
    'async function resumeMaxBackgroundTask()',
    'function getAiDialogTitle(',
  );
  assert.match(send, /dialogRequestId = \(aiChatState\.dialogRequestId \|\| 0\) \+ 1/);
  assert.match(background, /invalidateAiDialogDetail\(\)/);
  assert.match(source, /else \{\s*invalidateAiDialogDetail\(\);\s*aiChatState\.currentDid = ''/);
});
