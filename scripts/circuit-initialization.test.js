const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../public/circuit.js'), 'utf8');
const initialization = source.slice(
  source.indexOf('  async function initialize()'),
  source.indexOf('  window.FreeBbsCircuitEditor ='),
);
function harness(query = '', restored = false) {
  const state = { examples: [], dirty: false, loadedExample: null };
  const calls = { restores: 0, removes: 0, loads: 0, url: '', circuit: '' };
  const nodes = new Map();
  const context = vm.createContext({
    state,
    params: new URLSearchParams(query),
    listPage: false,
    document: {},
    app: { sessionReady: Promise.resolve(), userState: { isLoggedIn: false } },
    engine: {},
    renderer: {},
    window: {
      history: {
        replaceState(_state, _title, url) {
          calls.url = url;
        },
      },
    },
    $: (id) => {
      if (!nodes.has(id)) nodes.set(id, {});
      return nodes.get(id);
    },
    bindEvents() {},
    renderPalette() {},
    resetHistory() {},
    renderAnalysis() {},
    renderInspector() {},
    renderSchematic() {},
    updateControls() {},
    updateExampleControls() {},
    setStatus() {},
    blankExample: () => ({
      title: '未命名电路',
      description: '',
      document: { version: 1, components: [], wires: [], analysis: { type: 'dc' } },
    }),
    async refreshExamples() {
      await Promise.resolve();
      state.examples = [{ id: 42, title: '预设电路' }];
    },
    restoreDraft() {
      calls.restores += 1;
      if (restored) state.document.components = [{ id: 'R1' }];
      return restored;
    },
    removeDraft() {
      calls.removes += 1;
    },
    loadExample() {
      calls.loads += 1;
    },
    loadCircuit(cid) {
      calls.circuit = cid;
    },
  });
  vm.runInContext(initialization, context);
  return { context, state, calls };
}
test('an available template never replaces a new empty circuit during asynchronous initialization', async () => {
  const { context, state, calls } = harness();
  await context.initialize();
  assert.equal(state.examples.length, 1);
  assert.equal(state.document.components.length, 0);
  assert.equal(state.document.wires.length, 0);
  assert.equal(calls.loads, 0);
});
test('explicit New starts blank even with an existing draft and consumes the flag so refresh can resume edits', async () => {
  const { context, state, calls } = harness('new=1', true);
  await context.initialize();
  assert.equal(state.document.components.length, 0);
  assert.equal(calls.restores, 0);
  assert.equal(calls.removes, 1);
  assert.equal(calls.url, '/circuit');
  assert.equal(calls.loads, 0);
});
test('ordinary reopening still restores a draft and saved circuit links still load their circuit', async () => {
  const draft = harness('', true);
  await draft.context.initialize();
  assert.equal(draft.state.document.components[0].id, 'R1');
  const saved = harness('cid=c_0123456789abcdef01234567');
  await saved.context.initialize();
  assert.equal(saved.calls.circuit, 'c_0123456789abcdef01234567');
  assert.equal(saved.calls.removes, 0);
});
