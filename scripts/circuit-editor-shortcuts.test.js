const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const historyModel = require('../public/circuit-history');
const engine = require('../public/circuit-engine');
const renderer = require('../public/circuit-renderer');

const source = fs.readFileSync(require.resolve('../public/circuit.js'), 'utf8');
const copy = (value) => JSON.parse(JSON.stringify(value));
const documentFixture = () =>
  engine.validateDocument({
    version: 1,
    components: [{ id: 'R1', type: 'resistor', x: 180, y: 140, params: { resistance: 1000 } }],
    wires: [],
    analysis: { type: 'dc' },
  });

test('history supports undo/redo, isolates snapshots, and discards redo after a different edit', () => {
  const history = historyModel.create();
  const snapshot = { document: documentFixture(), title: 'original' };
  history.reset(snapshot);
  snapshot.title = 'first';
  history.record(snapshot);
  snapshot.title = 'second';
  history.record(snapshot);
  const previous = history.undo();
  assert.equal(previous.title, 'first');
  previous.title = 'external change';
  assert.equal(history.redo().title, 'second');
  history.undo();
  history.record({ ...snapshot, title: 'new branch' });
  assert.equal(history.canRedo(), false);
  assert.equal(history.undo().title, 'first');
  assert.equal(history.undo().title, 'original');
  assert.equal(history.undo(), null);
});

test('history coalesces contiguous input edits but preserves the pre-edit baseline and other actions', () => {
  let now = 0;
  const history = historyModel.create({ now: () => now });
  history.reset({ value: 0 });
  history.record({ value: 1 }, { group: 'parameter:R1:resistance' });
  now = 200;
  history.record({ value: 2 }, { group: 'parameter:R1:resistance' });
  assert.deepEqual(history.undo(), { value: 0 });
  assert.deepEqual(history.redo(), { value: 2 });
  history.record({ value: 3 }, { group: 'parameter:R1:resistance' });
  now = 2000;
  history.record({ value: 4 }, { group: 'parameter:R1:resistance' });
  assert.deepEqual(history.undo(), { value: 3 });
  assert.deepEqual(history.undo(), { value: 2 });
});

test('history limits memory, resets across documents and preserves undo when syncing a saved version', () => {
  const history = historyModel.create({ limit: 2 });
  history.reset({ value: 0 });
  [1, 2, 3].forEach((value) => history.record({ value }));
  history.synchronize({ value: 3, saved: true });
  assert.deepEqual(history.undo(), { value: 2 });
  assert.deepEqual(history.undo(), { value: 1 });
  assert.equal(history.undo(), null);
  history.reset({ value: 10 });
  assert.equal(history.canUndo(), false);
  assert.equal(history.canRedo(), false);
});

test('electrical history keys ignore layout and plots but detect parameter and connectivity changes', () => {
  const before = documentFixture();
  const after = copy(before);
  Object.assign(after.components[0], { x: 800, y: 360, rotation: 90, mirrorX: true });
  after.display = { mode: 'xy' };
  assert.equal(historyModel.electricalKey(before), historyModel.electricalKey(after));
  after.components[0].params.resistance = 2200;
  assert.notEqual(historyModel.electricalKey(before), historyModel.electricalKey(after));
  after.components[0].params.resistance = before.components[0].params.resistance;
  after.wires.push({
    id: 'w1',
    from: { componentId: 'R1', pin: 0 },
    to: { componentId: 'R1', pin: 1 },
  });
  assert.notEqual(historyModel.electricalKey(before), historyModel.electricalKey(after));
});

function harness() {
  const state = {
    document: documentFixture(),
    selectedId: 'R1',
    selectedWire: '',
    editable: true,
    saving: false,
    wireStart: null,
    wirePoints: [],
    history: historyModel.create(),
    editVersion: 0,
    loadedExample: null,
    annotationControls: { cancelPicking() {} },
  };
  const nodes = new Map();
  const node = (id) => {
    if (!nodes.has(id))
      nodes.set(id, {
        value: '',
        querySelectorAll: () => [],
        contains: () => false,
        hidden: false,
      });
    return nodes.get(id);
  };
  const calls = {
    changed: 0,
    invalidated: 0,
    rendered: 0,
    saved: 0,
    runs: 0,
    max: 0,
    cancelled: 0,
    corners: 0,
  };
  const context = vm.createContext({
    state,
    engine,
    renderer,
    clone: copy,
    prefixes: { resistor: 'R' },
    window: {
      FreeBbsCircuitHistory: historyModel,
      FreeBbsCircuitSidebar: {
        open() {
          calls.max += 1;
        },
      },
    },
    document: { activeElement: null },
    $: node,
    invalidateResult() {
      calls.invalidated += 1;
      state.result = null;
    },
    updateControls() {},
    persistDraft() {},
    checkAgentRunContext() {},
    setStatus() {},
    renderInspector() {},
    renderSweepOptions() {},
    renderAnalysis() {},
    renderSchematic() {
      calls.rendered += 1;
    },
    saveCircuit() {
      calls.saved += 1;
    },
    runSimulation() {
      calls.runs += 1;
    },
    startFromWire() {
      state.wireStart = { wireId: state.selectedWire };
    },
    connectPin(endpoint) {
      state.wireStart = endpoint;
    },
    undoConnectionPoint() {
      calls.corners += 1;
      state.wirePoints.pop();
    },
    cancelConnection() {
      calls.cancelled += 1;
      state.wireStart = null;
      state.wirePoints = [];
    },
  });
  for (const [from, to] of [
    ['  function changed(', '  function currentFrame()'],
    ['  function uniqueId(', '  function addComponent('],
    ['  function removeSelection()', '  function updateParameter('],
  ])
    vm.runInContext(source.slice(source.indexOf(from), source.indexOf(to)), context);
  context.resetHistory();
  return { ...context, state, calls, node };
}

test('editor rotate, screen-axis mirror, duplicate and undo/redo restore actual documents', () => {
  const h = harness();
  h.state.result = {};
  h.dispatchShortcut('rotate', { turns: -1 });
  assert.equal(h.state.document.components[0].rotation, 270);
  h.dispatchShortcut('mirror', { axis: 'x' });
  assert.equal(h.state.document.components[0].mirrorY, true);
  assert.equal(h.calls.invalidated, 0, 'layout changes preserve the simulation');
  // Duplicate invalidates measurements, while keeping original parameters and no new wires.
  h.dispatchShortcut('duplicate');
  assert.equal(h.state.document.components.length, 2);
  const duplicate = h.state.document.components[1];
  assert.equal(duplicate.id, 'R2');
  assert.deepEqual(copy(duplicate.params), copy(h.state.document.components[0].params));
  assert.notEqual(duplicate.params, h.state.document.components[0].params);
  assert.equal(h.state.document.wires.length, 0);
  assert.equal(h.calls.invalidated, 1);
  h.dispatchShortcut('undo');
  assert.equal(h.state.document.components.length, 1);
  h.dispatchShortcut('redo');
  assert.equal(h.state.document.components.length, 2);
});

test('editor movement snaps and clamps, and readonly/busy/agent guards block editing', () => {
  const h = harness();
  h.dispatchShortcut('move', { dx: 1, dy: 0 });
  assert.equal(h.state.document.components[0].x, 200);
  h.dispatchShortcut('move', { dx: 5, dy: -5 });
  assert.equal(h.state.document.components[0].x, 300);
  assert.equal(h.state.document.components[0].y, 60);
  for (const guard of ['saving', 'agentRun', 'readonly']) {
    const before = copy(h.state.document);
    if (guard === 'readonly') h.state.editable = false;
    else h.state[guard] = true;
    for (const action of [
      'delete',
      'duplicate',
      'rotate',
      'mirror',
      'move',
      'undo',
      'redo',
      'wire',
    ])
      assert.equal(h.dispatchShortcut(action), false, `${guard} blocks ${action}`);
    assert.deepEqual(copy(h.state.document), before);
    h.state.editable = true;
    h.state.saving = false;
    h.state.agentRun = null;
  }
});

test('undo and Backspace first retract a wire draft; escape cancels without deleting selection', () => {
  const h = harness();
  h.dispatchShortcut('wire');
  assert.deepEqual(copy(h.state.wireStart), { componentId: 'R1', pin: 0 });
  h.state.wirePoints = [
    { x: 200, y: 200 },
    { x: 260, y: 200 },
  ];
  h.dispatchShortcut('undo');
  assert.equal(h.state.wirePoints.length, 1);
  h.dispatchShortcut('delete', {}, { key: 'Backspace' });
  assert.equal(h.state.wirePoints.length, 0);
  h.dispatchShortcut('cancel');
  assert.equal(h.state.wireStart, null);
  assert.equal(h.state.document.components.length, 1);
  assert.equal(h.state.history.canUndo(), false);
});

test('history restoration updates metadata and drops stale simulation after an electrical edit', () => {
  const h = harness();
  h.node('title').value = '电流镜';
  h.state.document.components[0].params.resistance = 2200;
  h.changed();
  h.state.result = {};
  h.restoreHistory('undo');
  assert.equal(h.state.document.components[0].params.resistance, 1000);
  assert.equal(h.node('title').value, '');
  assert.equal(h.state.result, null);
  h.restoreHistory('redo');
  assert.equal(h.state.document.components[0].params.resistance, 2200);
  assert.equal(h.node('title').value, '电流镜');
});

test('different unnamed plot inputs have separate undo groups, even during rapid edits', () => {
  const h = harness();
  h.state.document.display = engine.normalizeDisplay({ ranges: { xMin: null, xMax: null } });
  h.resetHistory();
  h.document.activeElement = { matches: () => true, dataset: { plotField: 'xMin' } };
  h.state.document.display.ranges.xMin = 0;
  h.changed({ electrical: false });
  h.document.activeElement = { matches: () => true, dataset: { plotField: 'xMax' } };
  h.state.document.display.ranges.xMax = 10;
  h.changed({ electrical: false });
  h.restoreHistory('undo');
  assert.equal(h.state.document.display.ranges.xMin, 0);
  assert.equal(h.state.document.display.ranges.xMax, null);
  h.restoreHistory('undo');
  assert.equal(h.state.document.display.ranges.xMin, null);
});
