const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const publicDir = path.join(__dirname, '..', 'public');
const controller = fs.readFileSync(path.join(publicDir, 'knowledge-editor.js'), 'utf8');
const html = fs.readFileSync(path.join(publicDir, 'knowledge.html'), 'utf8');
const route = '/courses/signals/map/nodes/A1';
const originalSections = {
  knowledgeMarkdown: '# Original knowledge',
  basicInfoMarkdown: 'Original basic information',
  applicationsMarkdown: 'Original applications',
};

function createElement(dataset = {}) {
  const listeners = new Map();
  const attributes = new Map();
  return {
    dataset,
    disabled: false,
    hidden: false,
    readOnly: false,
    value: '',
    textContent: '',
    innerHTML: '',
    classList: { toggle() {} },
    focus() {},
    closest() {
      return this;
    },
    replaceChildren() {
      this.innerHTML = '';
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    toggleAttribute(name, value) {
      if (name === 'disabled') this.disabled = value;
      if (value) attributes.set(name, '');
      else attributes.delete(name);
    },
    addEventListener(type, listener) {
      const existing = listeners.get(type) || [];
      listeners.set(type, [...existing, listener]);
    },
    async dispatchEvent(event) {
      for (const listener of listeners.get(event.type) || []) await listener(event);
    },
  };
}

async function createHarness() {
  const elements = new Map(
    [...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => [id, createElement()]),
  );
  const element = (suffix) => elements.get(`knowledge-editor-${suffix}`);
  const editor = elements.get('knowledge-editor');
  const page = createElement();
  const window = createElement();
  const sectionButtons = Object.keys(originalSections).map((section) =>
    createElement({ knowledgeEditorSection: section }),
  );
  const modeButtons = ['edit', 'preview'].map((mode) =>
    createElement({ knowledgeEditorMode: mode }),
  );
  const controls = [
    ...sectionButtons,
    ...modeButtons,
    ...['source', 'image-input', 'upload', 'save', 'cancel', 'discard-confirm', 'discard-keep'].map(
      element,
    ),
  ];
  editor.hidden = true;
  editor.querySelectorAll = (selector) => {
    if (selector === 'button, textarea, input') return controls;
    if (selector === '[data-knowledge-editor-section]') return sectionButtons;
    if (selector === '[data-knowledge-editor-mode]') return modeButtons;
    if (selector === '#knowledge-editor-toolbar button, #knowledge-editor-image-input')
      return [element('upload'), element('image-input')];
    throw new Error(`Unexpected selector: ${selector}`);
  };
  const calls = [];
  const savedEvents = [];
  const api = {
    node: { id: 'A1', title: 'Knowledge A1', revision: 'revision-one', sections: originalSections },
    canEdit: true,
    saveError: null,
  };
  const app = {
    userState: { uid: 'manager-one', isLoggedIn: true },
    renderMarkdownContent: (value) => `<p>${value}</p>`,
    enhanceMarkdownContent() {},
    async callApi(url, options) {
      calls.push({ url, options });
      if (options.method === 'PUT' && api.saveError) throw api.saveError;
      if (options.method === 'PUT') {
        return {
          node: {
            ...api.node,
            revision: 'revision-two',
            sections: JSON.parse(options.body).sections,
          },
        };
      }
      assert.equal(options.method, 'GET');
      assert.equal(url, route);
      return { course: { canEditMap: api.canEdit }, node: api.node };
    },
  };
  Object.assign(window, {
    freeBbsApp: app,
    location: { search: '?course=signals&point=A1' },
    clearTimeout,
    setTimeout,
  });
  const document = Object.assign(createElement(), {
    getElementById: (id) => elements.get(id) || null,
    querySelector: (selector) => (selector === '[data-knowledge-page]' ? page : null),
  });
  const context = vm.createContext({ document, window, URLSearchParams, CustomEvent });
  page.addEventListener('knowledge:document-saved', (event) => savedEvents.push(event.detail.node));
  vm.runInContext(controller, context, { filename: 'knowledge-editor.js' });
  await page.dispatchEvent({ type: 'knowledge:loaded', detail: { course: { canEditMap: true } } });

  async function click(button) {
    assert.equal(button.disabled, false, 'the requested control should remain usable');
    await button.dispatchEvent({ type: 'click', target: button });
    await editor.dispatchEvent({ type: 'click', target: button });
  }
  return {
    api,
    app,
    calls,
    editor,
    element,
    savedEvents,
    sectionButtons,
    async open() {
      await click(elements.get('knowledge-edit-toggle'));
    },
    async type(value) {
      const source = element('source');
      assert.equal(source.disabled || source.readOnly, false);
      source.value = value;
      await source.dispatchEvent({ type: 'input' });
    },
    click,
    sessionChanged() {
      return window.dispatchEvent({ type: 'freebbs:session-change' });
    },
    hasUnloadWarning() {
      let warned = false;
      window.dispatchEvent({
        type: 'beforeunload',
        preventDefault() {
          warned = true;
        },
      });
      return warned;
    },
  };
}

test('refreshing the same account preserves the active draft and its original revision', async () => {
  const harness = await createHarness();
  await harness.open();
  await harness.type('Unsaved draft');
  harness.api.node = { ...harness.api.node, revision: 'newer-remote-revision' };
  await harness.sessionChanged();

  assert.equal(harness.editor.hidden, false);
  assert.equal(harness.element('source').value, 'Unsaved draft');
  assert.equal(harness.hasUnloadWarning(), true);
  await harness.click(harness.element('save'));
  const request = harness.calls.find((call) => call.options.method === 'PUT');
  assert.equal(JSON.parse(request.options.body).expectedRevision, 'revision-one');
});

for (const nextAccount of [
  { label: 'logging out', uid: '', isLoggedIn: false },
  { label: 'switching accounts', uid: 'manager-two', isLoggedIn: true },
]) {
  test(`${nextAccount.label} clears the previous account's draft and preview`, async () => {
    const harness = await createHarness();
    await harness.open();
    await harness.type('Private unsaved draft');
    harness.element('preview').innerHTML = 'Private preview';
    Object.assign(harness.app.userState, nextAccount);
    await harness.sessionChanged();

    assert.equal(harness.editor.hidden, true);
    assert.equal(harness.element('source').value, '');
    assert.equal(harness.element('preview').innerHTML, '');
    assert.equal(harness.hasUnloadWarning(), false);
    assert.equal(harness.calls.filter((call) => call.options.method === 'PUT').length, 0);
  });
}

test('a version conflict retains every draft section and keeps editing available', async () => {
  const harness = await createHarness();
  await harness.open();
  await harness.type('Knowledge draft');
  await harness.click(harness.sectionButtons[1]);
  await harness.type('Basic information draft');
  harness.api.saveError = Object.assign(new Error('Conflict'), { status: 409 });
  await harness.click(harness.element('save'));

  assert.equal(harness.editor.hidden, false);
  assert.equal(harness.element('source').value, 'Basic information draft');
  assert.match(harness.element('status').textContent, /草稿仍保留/);
  assert.equal(harness.element('source').readOnly, false);
  await harness.click(harness.sectionButtons[0]);
  assert.equal(harness.element('source').value, 'Knowledge draft');
  assert.equal(harness.savedEvents.length, 0);
  assert.equal(harness.hasUnloadWarning(), true);
});

test('revoked permission leaves drafts readable and allows section switching and discard', async () => {
  const harness = await createHarness();
  await harness.open();
  await harness.type('Copyable draft');
  harness.api.saveError = Object.assign(new Error('Forbidden'), { status: 403 });
  await harness.click(harness.element('save'));

  assert.equal(harness.element('source').readOnly, true);
  assert.equal(harness.element('source').disabled, false, 'read-only text remains selectable');
  assert.equal(harness.element('save').disabled, true);
  assert.equal(harness.element('upload').disabled, true);
  assert.equal(harness.element('image-input').disabled, true);
  await harness.click(harness.sectionButtons[1]);
  assert.equal(harness.element('source').value, originalSections.basicInfoMarkdown);
  await harness.click(harness.sectionButtons[0]);
  assert.equal(harness.element('source').value, 'Copyable draft');
  await harness.click(harness.element('cancel'));
  assert.equal(harness.element('discard').hidden, false);
  await harness.click(harness.element('discard-keep'));
  assert.equal(harness.element('discard').hidden, true);
  assert.equal(harness.element('source').value, 'Copyable draft');
  await harness.click(harness.element('cancel'));
  await harness.click(harness.element('discard-confirm'));
  assert.equal(harness.editor.hidden, true);
  assert.equal(harness.element('source').value, '');
  assert.equal(harness.hasUnloadWarning(), false);
});

test('saving sends all three sections with the read revision and publishes the saved node', async () => {
  const harness = await createHarness();
  await harness.open();
  const sections = {
    knowledgeMarkdown: '# Updated knowledge\n\n![diagram](/uploads/course-map/diagram.png)',
    basicInfoMarkdown: 'Updated basic information',
    applicationsMarkdown: 'Updated applications',
  };
  for (const [index, value] of Object.values(sections).entries()) {
    await harness.click(harness.sectionButtons[index]);
    await harness.type(value);
  }
  await harness.click(harness.element('save'));

  const requests = harness.calls.filter((call) => call.options.method === 'PUT');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, `${route}/document`);
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    sections,
    expectedRevision: 'revision-one',
  });
  assert.equal(harness.savedEvents.length, 1);
  assert.equal(harness.savedEvents[0].revision, 'revision-two');
  assert.deepEqual(harness.savedEvents[0].sections, sections);
  assert.equal(harness.editor.hidden, true);
  assert.equal(harness.element('source').value, '');
  assert.equal(harness.hasUnloadWarning(), false);
});
