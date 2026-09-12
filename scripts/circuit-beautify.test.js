const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const engine = require('../public/circuit-engine');
const renderer = require('../public/circuit-renderer');
const layout = require('../public/circuit-layout');
const historyModel = require('../public/circuit-history');
const plot = require('../public/circuit-plot');

const clone = (value) => JSON.parse(JSON.stringify(value));
const source = fs.readFileSync(require.resolve('../public/circuit.js'), 'utf8');
function fixture() {
  return engine.validateDocument({
    version: 1,
    components: [
      { id: 'V1', type: 'voltage', x: 203, y: 307, rotation: 90, params: { dc: 6 } },
      { id: 'R1', type: 'resistor', x: 500, y: 200, rotation: 90, params: { resistance: 1000 } },
      { id: 'R2', type: 'resistor', x: 500, y: 400, rotation: 90, params: { resistance: 2000 } },
      { id: 'G1', type: 'ground', x: 500, y: 540 },
    ],
    wires: [
      ['V1', 0, 'R1', 0],
      ['R1', 1, 'R2', 0],
      ['R2', 1, 'G1', 0],
      ['V1', 1, 'G1', 0],
    ].map(([from, a, to, b], index) => ({
      id: `w${index}`,
      from: { componentId: from, pin: a },
      to: { componentId: to, pin: b },
      points: [],
    })),
  });
}
function harness() {
  const document = fixture();
  const state = {
    document,
    editable: true,
    saving: false,
    dirty: false,
    editVersion: 1,
    history: historyModel.create(),
    result: engine.simulate(document),
    plotDisplay: { mode: 'xt' },
    plotModified: true,
    selectedId: 'R1',
    selectedWire: '',
    wirePoints: [],
    aiUndo: { prior: true },
  };
  const nodes = { title: { value: '分压电路' }, description: { value: '原说明' } };
  const calls = { persisted: 0, invalidated: 0, statuses: [] };
  const context = vm.createContext({
    state,
    engine,
    plot,
    clone,
    window: { FreeBbsCircuitLayout: layout, FreeBbsCircuitHistory: historyModel },
    document: { activeElement: null },
    $: (id) => nodes[id],
    validateParameterInputs: () => true,
    checkAgentRunContext() {},
    updateControls() {},
    persistDraft() {
      calls.persisted += 1;
    },
    invalidateResult() {
      calls.invalidated += 1;
    },
    renderInspector() {},
    renderAnalysis() {},
    renderSchematic() {},
    notifyCircuitEditor() {},
    updatePlot() {},
    setStatus(...args) {
      calls.statuses.push(args);
    },
  });
  vm.runInContext(
    source.slice(
      source.indexOf('  function changed('),
      source.indexOf('  function currentFrame()'),
    ),
    context,
  );
  context.resetHistory();
  return { context, state, calls };
}
test('one-click beautification is one undoable geometry edit and preserves measurements and plot state', () => {
  const { context, state, calls } = harness();
  const before = clone(state.document);
  const { result } = state;
  const display = state.plotDisplay;
  assert.equal(context.beautifyCircuit(), true);
  const after = clone(state.document);
  assert.notDeepEqual(after, before);
  assert.deepEqual(engine.buildNets(after), engine.buildNets(before));
  assert.deepEqual(engine.simulate(after).frames, engine.simulate(before).frames);
  assert.equal(state.result, result);
  assert.equal(state.plotDisplay, display);
  assert.equal(state.plotModified, true);
  assert.equal(state.aiUndo, null);
  assert.equal(state.dirty, true);
  assert.equal(calls.persisted, 1);
  assert.equal(context.beautifyCircuit(), false, 'already tidy should not add an undo entry');
  assert.equal(calls.persisted, 1);
  assert.equal(context.restoreHistory('undo'), true);
  assert.deepEqual(clone(state.document), before);
  assert.equal(context.restoreHistory('undo'), false);
  assert.equal(context.restoreHistory('redo'), true);
  assert.deepEqual(clone(state.document), after);
  assert.equal(state.result, result);
  assert.equal(calls.invalidated, 0);
});
test('read-only, unfinished wires and ongoing work cannot be beautified; failures are atomic', () => {
  for (const flags of [
    { editable: false },
    { saving: true },
    { agentRun: {} },
    { worker: {} },
    { wireStart: {} },
    { exampleBusy: true },
    { exampleLoading: true },
  ]) {
    const { context, state, calls } = harness();
    Object.assign(state, flags);
    const before = clone(state.document);
    assert.equal(context.beautifyCircuit(), false);
    assert.deepEqual(state.document, before);
    assert.equal(calls.persisted, 0);
    assert.equal(state.history.canUndo(), false);
  }
  const { context, state, calls } = harness();
  const before = clone(state.document);
  context.window.FreeBbsCircuitLayout = {
    normalizeCircuitLayout() {
      throw new Error('layout failed');
    },
  };
  assert.equal(context.beautifyCircuit(), false);
  assert.deepEqual(state.document, before);
  assert.equal(calls.persisted, 0);
  assert.equal(state.editVersion, 1);
  assert.equal(state.history.canUndo(), false);
  assert.match(calls.statuses.at(-1)[0], /美化未完成/);
});
test('browser module and recognition backend use the identical deterministic layout', () => {
  const browser = vm.createContext({
    FreeBbsCircuitEngine: engine,
    FreeBbsCircuitRenderer: renderer,
  });
  vm.runInContext(fs.readFileSync(require.resolve('../public/circuit-layout'), 'utf8'), browser);
  const backend = require('../backend/circuit-recognition-layout');
  const expected = backend.normalizeRecognizedCircuitLayout(fixture());
  assert.deepEqual(clone(browser.FreeBbsCircuitLayout.normalizeCircuitLayout(fixture())), expected);
  const html = fs.readFileSync(require.resolve('../public/circuit.html'), 'utf8');
  assert.ok(html.indexOf('src="/circuit-renderer.js"') < html.indexOf('src="/circuit-layout.js"'));
  assert.ok(html.indexOf('src="/circuit-layout.js"') < html.indexOf('src="/circuit.js"'));
  assert.match(html, /id="circuit-beautify"/);
  assert.match(source, /\$\('beautify'\)\.addEventListener\('click', beautifyCircuit\)/);
});
