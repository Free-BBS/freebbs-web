const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const engine = require('../public/circuit-engine');
const recognition = require('../public/circuit-recognition');

const clone = (value) => JSON.parse(JSON.stringify(value));
const imageDataUrl = 'data:image/png;base64,aW1hZ2U=';
const imageFile = { name: '电路.png', type: 'image/png', size: 1024 };
const fixture = () => ({
  title: '识别的电阻',
  description: '核对参数后仿真。',
  document: engine.validateDocument({
    version: 1,
    components: [{ id: 'R1', type: 'resistor', x: 200, y: 160, params: { resistance: 1000 } }],
    wires: [],
    analysis: { type: 'dc' },
  }),
});
const response = () => ({ circuit: fixture(), warnings: ['R1 标注不清，请核对。'] });

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function element() {
  const listeners = new Map();
  const classes = new Set();
  return {
    value: '',
    hidden: false,
    disabled: false,
    open: false,
    textContent: '',
    children: [],
    attributes: {},
    classList: {
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
      add(name) {
        classes.add(name);
      },
      remove(name) {
        classes.delete(name);
      },
    },
    get childElementCount() {
      return this.children.length;
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    removeAttribute(name) {
      delete this.attributes[name];
      if (name === 'src') this.src = '';
    },
    replaceChildren(...children) {
      this.children = children;
    },
    addEventListener(name, listener) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(listener);
    },
    emit(name, event = {}) {
      for (const listener of listeners.get(name) || []) listener(event);
    },
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
      this.emit('close');
    },
    click() {
      this.emit('click');
    },
    focus() {
      this.focused = true;
    },
    contains() {
      return false;
    },
  };
}

function harness({
  callApi = async () => response(),
  readImage = async () => imageDataUrl,
  previewError = null,
} = {}) {
  const elements = new Map();
  const html = fs.readFileSync(path.join(__dirname, '../public/circuit.html'), 'utf8');
  for (const match of html.matchAll(/id="(circuit-recogn[^" ]*)"/g))
    elements.set(match[1], element());
  const dom = { getElementById: (id) => elements.get(id), createElement: element };
  const timers = new Map();
  const browser = element();
  browser.AbortController = AbortController;
  browser.setTimeout = (callback, ms) => {
    const token = {};
    timers.set(token, { callback, ms });
    return token;
  };
  browser.clearTimeout = (token) => timers.delete(token);
  const context = { generation: 2, editVersion: 4, uid: 'reader', dirty: true, busy: false };
  const calls = { requests: [], imports: [], previews: [], destroyed: 0 };
  const app = {
    userState: { uid: 'reader', isLoggedIn: true },
    async callApi(url, options) {
      calls.requests.push({ url, options });
      return callApi(url, options);
    },
  };
  const editor = {
    getRecognitionContext: () => ({ ...context }),
    importRecognizedCircuit(circuit, expected) {
      if (context.editVersion !== expected.editVersion || context.uid !== expected.uid)
        throw new Error('当前账号或电路已变化。');
      calls.imports.push({ circuit, expected });
    },
  };
  const renderer = {
    renderSchematic(container, document, options) {
      if (previewError) throw previewError;
      calls.previews.push({ container, document, options });
      return {
        destroy() {
          calls.destroyed += 1;
        },
      };
    },
  };
  const api = recognition.create({
    app,
    editor,
    engine,
    renderer,
    document: dom,
    window: browser,
    readImage,
  });
  const get = (name) => elements.get(`circuit-recognition-${name}`);
  api.open();
  return { api, get, calls, app, context, browser, timers };
}

test('rejects unsupported, empty, and oversized images before reading or sending', async () => {
  assert.throws(
    () => recognition.validateImageFile({ ...imageFile, type: 'image/svg+xml' }),
    /PNG/,
  );
  assert.throws(() => recognition.validateImageFile({ ...imageFile, size: 0 }), /为空/);
  assert.throws(
    () => recognition.validateImageFile({ ...imageFile, size: recognition.MAX_IMAGE_BYTES + 1 }),
    /8 MiB/,
  );
  assert.doesNotThrow(() =>
    recognition.validateImageFile({ ...imageFile, size: recognition.MAX_IMAGE_BYTES }),
  );
  const h = harness({ readImage: () => assert.fail('invalid images must not be read') });
  await h.api.selectFile({ ...imageFile, type: 'application/pdf' });
  await h.api.start();
  assert.equal(h.calls.requests.length, 0);
  assert.equal(h.get('start').disabled, true);
  assert.match(h.get('status').textContent, /PNG/);
});

test('renders recognized circuit and warnings, then imports only after confirmation', async () => {
  const h = harness();
  await h.api.selectFile(imageFile);
  h.get('instructions').value = '  R1 是 1 kΩ  ';
  await h.api.start();
  const request = h.calls.requests[0];
  assert.equal(request.url, '/ai/circuit/recognize');
  assert.equal(request.options.method, 'POST');
  assert.deepEqual(JSON.parse(request.options.body), { imageDataUrl, instructions: 'R1 是 1 kΩ' });
  assert.equal(h.calls.imports.length, 0);
  assert.equal(h.get('result').hidden, false);
  assert.equal(h.get('apply').hidden, false);
  assert.equal(h.get('warnings').children[0].textContent, 'R1 标注不清，请核对。');
  assert.equal(h.calls.previews[0].options.interactive, false);
  assert.equal(h.calls.previews[0].document.components[0].params.resistance, 1000);
  assert.match(h.get('draft-note').textContent, /当前未保存草稿.*备份/);
  assert.equal(h.api.apply(), true);
  assert.equal(h.calls.imports.length, 1);
  assert.equal(h.calls.imports[0].circuit.cid, undefined);
  assert.equal(h.get('dialog').open, false);
  assert.equal(h.timers.size, 0);
});

test('handles 200-body failures and invalid model documents without creating drafts', async () => {
  for (const payload of [
    { ok: false, status: 503, message: '图像识别暂时不可用。' },
    { circuit: { document: { version: 1, components: [{ type: 'unknown' }], wires: [] } } },
    { circuit: { document: { version: 1, components: [], wires: [] } } },
  ]) {
    const h = harness({ callApi: async () => payload });
    await h.api.selectFile(imageFile);
    await h.api.start();
    assert.equal(h.get('apply').hidden, true);
    assert.equal(h.calls.previews.length, 0);
    assert.equal(h.api.apply(), false);
    assert.equal(h.get('start').disabled, false);
    assert.match(h.get('status').className, /is-error/);
  }
});

test('all bounded model and default-parameter warnings remain visible in the review', async () => {
  const warnings = Array.from({ length: 112 }, (_, index) => `元件 ${index + 1} 的参数需要核对。`);
  const h = harness({ callApi: async () => ({ ...response(), warnings }) });
  await h.api.selectFile(imageFile);
  await h.api.start();
  assert.equal(h.get('warnings').childElementCount, 112);
  assert.equal(h.get('warnings').children[111].textContent, warnings[111]);
});

test('a schematic rendering error clears the partial preview and never allows import', async () => {
  const h = harness({ previewError: new Error('图形预览失败，请重试。') });
  await h.api.selectFile(imageFile);
  await h.api.start();
  assert.match(h.get('status').textContent, /图形预览失败/);
  assert.equal(h.get('result').hidden, true);
  assert.equal(h.get('apply').hidden, true);
  assert.equal(h.get('preview').childElementCount, 0);
  assert.equal(h.get('start').disabled, false);
  assert.equal(h.api.apply(), false);
  assert.equal(h.calls.imports.length, 0);
});

test('cancel aborts the request and ignores late responses while allowing a retry', async () => {
  const pending = deferred();
  let count = 0;
  const h = harness({
    callApi: async () => {
      count += 1;
      return count === 1 ? pending.promise : response();
    },
  });
  await h.api.selectFile(imageFile);
  const request = h.api.start();
  assert.equal(h.get('cancel').hidden, false);
  h.api.cancel();
  assert.equal(h.calls.requests[0].options.signal.aborted, true);
  await h.api.start();
  assert.equal(h.calls.previews.length, 1);
  pending.resolve({ ...response(), circuit: { ...fixture(), title: '过期识别结果' } });
  await request;
  assert.equal(h.calls.previews.length, 1);
  assert.equal(h.get('title').textContent, '识别的电阻');
  assert.equal(h.get('start').disabled, false);
});

test('client deadline stops hanging requests and leaves a usable retry action', async () => {
  const pending = deferred();
  const h = harness({ callApi: () => pending.promise });
  await h.api.selectFile(imageFile);
  const request = h.api.start();
  const timer = [...h.timers.values()][0];
  assert.equal(timer.ms, 210000);
  timer.callback();
  assert.equal(h.calls.requests[0].options.signal.aborted, true);
  assert.match(h.get('status').textContent, /超时/);
  assert.equal(h.get('start').disabled, false);
  pending.resolve(response());
  await request;
  assert.equal(h.get('apply').hidden, true);
});

test('editing the circuit invalidates both in-flight and previewed recognition results', async () => {
  const pending = deferred();
  const h = harness({ callApi: () => pending.promise });
  await h.api.selectFile(imageFile);
  const request = h.api.start();
  h.context.editVersion += 1;
  h.browser.emit('freebbs:circuit-editor-change');
  assert.equal(h.calls.requests[0].options.signal.aborted, true);
  pending.resolve(response());
  await request;
  assert.equal(h.calls.previews.length, 0);
  await h.api.start();
  assert.equal(h.get('apply').hidden, false);
  h.context.editVersion += 1;
  h.browser.emit('freebbs:circuit-editor-change');
  assert.equal(h.get('apply').hidden, true);
  assert.equal(h.api.apply(), false);
});

test('switching accounts aborts recognition and clears the uploaded image and instructions', async () => {
  const pending = deferred();
  const h = harness({ callApi: () => pending.promise });
  await h.api.selectFile(imageFile);
  h.get('instructions').value = '私人备注';
  const request = h.api.start();
  h.app.userState = { isLoggedIn: true, uid: 'another-reader' };
  h.context.uid = 'another-reader';
  h.browser.emit('freebbs:session-change');
  assert.equal(h.calls.requests[0].options.signal.aborted, true);
  assert.equal(h.get('image').hidden, true);
  assert.equal(h.get('image').src, '');
  assert.equal(h.get('instructions').value, '');
  assert.equal(h.get('start').disabled, true);
  pending.resolve(response());
  await request;
  assert.equal(h.calls.previews.length, 0);
});

test('closing the dialog cancels work and late file reads cannot replace a new selection', async () => {
  const first = deferred();
  let reads = 0;
  const h = harness({
    readImage: async () => {
      reads += 1;
      return reads === 1 ? first.promise : `${imageDataUrl}Mg==`;
    },
  });
  const reading = h.api.selectFile(imageFile);
  h.api.close();
  h.api.open();
  await h.api.selectFile({ ...imageFile, name: 'new.png' });
  first.resolve(imageDataUrl);
  await reading;
  assert.match(h.get('filename').textContent, /new.png/);
  assert.equal(h.get('image').src, `${imageDataUrl}Mg==`);
});

test('clipboard screenshots and file drops enter the same validated upload flow', async () => {
  const h = harness();
  let prevented = 0;
  h.get('dialog').emit('paste', {
    clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => imageFile }] },
    preventDefault() {
      prevented += 1;
    },
  });
  await Promise.resolve();
  assert.equal(h.get('image').hidden, false);
  h.get('dialog').emit('drop', {
    dataTransfer: { files: [{ ...imageFile, name: 'dropped.png' }] },
    preventDefault() {
      prevented += 1;
    },
  });
  await Promise.resolve();
  assert.match(h.get('filename').textContent, /dropped.png/);
  assert.equal(prevented, 2);
  h.get('instructions').value = 'updated';
  await h.api.start();
  h.get('instructions').emit('input');
  assert.equal(h.get('apply').hidden, true);
});

test('guests see the login action and never send recognition requests', async () => {
  const h = harness();
  h.app.userState = { isLoggedIn: false, uid: '' };
  h.context.uid = '';
  h.browser.emit('freebbs:session-change');
  await h.api.selectFile(imageFile);
  await h.api.start();
  assert.equal(h.get('auth').hidden, false);
  assert.equal(h.get('start').disabled, true);
  assert.equal(h.calls.requests.length, 0);
});

function editorHarness({ storageFails = false } = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../public/circuit.js'), 'utf8');
  const bridge = source.slice(
    source.indexOf('  function recognitionBackupKey('),
    source.indexOf('  async function copyReference('),
  );
  const storage = new Map();
  const state = {
    document: fixture().document,
    cid: 'c_111111111111111111111111',
    revision: 3,
    latestRevision: 3,
    owner: { uid: 'reader' },
    editable: true,
    dirty: true,
    editVersion: 6,
    generation: 4,
    sessionUid: 'reader',
    exampleLoadRequest: 0,
    loadedExample: { id: 1 },
    plotModified: false,
    plotDisplay: null,
  };
  const fields = { title: { value: '原草稿' }, description: { value: '不能丢失的说明' } };
  const calls = { statuses: [], urls: [] };
  const context = {
    state,
    engine,
    clone,
    listPage: false,
    $: (id) => fields[id],
    metadata: () => ({ title: fields.title.value, description: fields.description.value }),
    sessionStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => {
        if (storageFails) throw new Error('QuotaExceededError');
        storage.set(key, value);
      },
    },
    persistDraft: () => true,
    invalidateResult() {
      state.plotDisplay = null;
      state.plotModified = false;
    },
    resetHistory() {},
    renderAnalysis() {},
    renderInspector() {},
    renderSchematic() {},
    updateControls() {},
    setStatus: (message) => calls.statuses.push(message),
    confirmDraftReplacement: () => true,
    window: { history: { replaceState: (data, title, url) => calls.urls.push(url) } },
  };
  vm.createContext(context);
  vm.runInContext(
    `${bridge}\nthis.bridge = { getRecognitionContext, importRecognizedCircuit, restoreRecognitionDraft, recognitionBackupKey };`,
    context,
  );
  return { state, storage, calls, fields, api: context.bridge };
}

test('confirmed import gets a fresh identity and keeps the complete prior draft recoverable', () => {
  const h = editorHarness();
  const before = clone(h.state);
  const context = h.api.getRecognitionContext();
  const next = fixture();
  next.document.components[0].params.resistance = 2200;
  assert.equal(h.api.importRecognizedCircuit(next, context), true);
  assert.equal(h.state.cid, '');
  assert.equal(h.state.revision, 0);
  assert.equal(h.state.owner, null);
  assert.equal(h.state.loadedExample, null);
  assert.equal(h.state.dirty, true);
  assert.equal(h.fields.title.value, '识别的电阻');
  assert.equal(h.state.document.components[0].params.resistance, 2200);
  const backup = JSON.parse(h.storage.get(h.api.recognitionBackupKey()));
  assert.equal(backup.title, '原草稿');
  assert.equal(backup.description, '不能丢失的说明');
  assert.equal(backup.document.components[0].params.resistance, 1000);
  assert.equal(backup.cid, before.cid);
  assert.equal(h.api.restoreRecognitionDraft(), true);
  assert.equal(h.fields.title.value, '原草稿');
  assert.equal(h.state.cid, before.cid);
  assert.equal(h.state.revision, 3);
  assert.equal(h.state.dirty, true);
  assert.equal(h.state.document.components[0].params.resistance, 1000);
  assert.equal(h.calls.urls.at(-1), `/circuit?cid=${before.cid}`);
  assert.equal(h.api.restoreRecognitionDraft(), true);
  assert.equal(h.state.cid, '');
  assert.equal(h.state.document.components[0].params.resistance, 2200);
});

test('stale context, account changes and storage failures cannot replace the current draft', () => {
  for (const mutation of [
    { editVersion: 7 },
    { generation: 5 },
    { sessionUid: 'another-reader' },
    { saving: true },
  ]) {
    const h = editorHarness();
    const expected = h.api.getRecognitionContext();
    Object.assign(h.state, mutation);
    assert.throws(() => h.api.importRecognizedCircuit(fixture(), expected), /已变化/);
    assert.equal(h.fields.title.value, '原草稿');
    assert.equal(h.storage.size, 0);
  }
  const h = editorHarness({ storageFails: true });
  const before = clone(h.state);
  assert.throws(
    () => h.api.importRecognizedCircuit(fixture(), h.api.getRecognitionContext()),
    /无法保留当前草稿/,
  );
  assert.deepEqual(h.state, before);
  assert.equal(h.fields.title.value, '原草稿');
});

test('restoring historical read-only circuits keeps their pinned revision', () => {
  const h = editorHarness();
  Object.assign(h.state, { revision: 2, latestRevision: 3, editable: false, dirty: false });
  h.api.importRecognizedCircuit(fixture(), h.api.getRecognitionContext());
  assert.equal(h.api.restoreRecognitionDraft(), true);
  assert.equal(h.state.editable, false);
  assert.equal(h.state.revision, 2);
  assert.equal(h.state.dirty, false);
  assert.equal(h.calls.urls.at(-1), `/circuit?cid=${h.state.cid}&revision=2`);
});

test('invalid recognition documents and mismatched backup accounts do not mutate editor state', () => {
  const h = editorHarness();
  const before = clone(h.state);
  assert.throws(
    () =>
      h.api.importRecognizedCircuit({ ...fixture(), document: {} }, h.api.getRecognitionContext()),
    /version/,
  );
  assert.deepEqual(h.state, before);
  assert.equal(h.storage.size, 0);
  h.storage.set(
    h.api.recognitionBackupKey(),
    JSON.stringify({ uid: 'someone-else', ...fixture() }),
  );
  assert.equal(h.api.restoreRecognitionDraft(), false);
  assert.deepEqual(h.state, before);
});
