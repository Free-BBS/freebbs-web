const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const engine = require('../public/circuit-engine');
const renderer = require('../public/circuit-renderer');
const wiring = require('../public/circuit-wiring');

const endpoint = (componentId, pin = 0) => ({ componentId, pin });
const copy = (value) => JSON.parse(JSON.stringify(value));
function fixture() {
  return engine.validateDocument({
    version: 1,
    components: [
      { id: 'V1', type: 'voltage', x: 100, y: 100 },
      { id: 'R1', type: 'resistor', x: 500, y: 100 },
      { id: 'R2', type: 'resistor', x: 100, y: 300 },
      { id: 'R3', type: 'resistor', x: 500, y: 300 },
      { id: 'GND', type: 'ground', x: 100, y: 500 },
    ],
    wires: [
      {
        id: 'w1',
        from: endpoint('V1'),
        to: endpoint('R1'),
        points: [
          { x: 220, y: 100 },
          { x: 220, y: 180 },
          { x: 340, y: 180 },
          { x: 340, y: 100 },
        ],
      },
      {
        id: 'w2',
        from: endpoint('R2', 1),
        to: endpoint('R3'),
        points: [
          { x: 240, y: 300 },
          { x: 240, y: 380 },
          { x: 360, y: 380 },
          { x: 360, y: 300 },
        ],
      },
    ],
    analysis: { type: 'dc' },
  });
}

function harness(document = fixture()) {
  const source = fs.readFileSync(path.join(__dirname, '../public/circuit.js'), 'utf8');
  const start = source.indexOf('  function connectPin(endpoint) {');
  const stop = source.indexOf('  function renderPalette() {', start);
  assert.ok(start > 0 && stop > start, 'the test executes the editor draft controller');
  const state = {
    document,
    editable: true,
    selectedWire: '',
    selectedId: '',
    wireStart: null,
    wirePoints: [],
  };
  const statuses = [];
  const calls = { changed: 0, controls: 0, inspector: 0, schematic: 0 };
  const context = vm.createContext({
    window: {},
    state,
    engine,
    renderer,
    wiring,
    clone: copy,
    changed() {
      calls.changed += 1;
    },
    updateControls() {
      calls.controls += 1;
    },
    renderInspector() {
      calls.inspector += 1;
    },
    renderSchematic() {
      calls.schematic += 1;
    },
    setStatus(message, kind = '') {
      statuses.push({ message, kind });
    },
  });
  vm.runInContext(source.slice(start, stop), context);
  return { state, statuses, calls, ...context };
}

test('canvas draft points snap, clamp, deduplicate and undo without changing saved document or dirty state', () => {
  const h = harness();
  const before = copy(h.state.document);
  h.addConnectionPoint({ x: 20, y: 20 });
  assert.equal(h.state.wirePoints.length, 0);
  h.connectPin(endpoint('R1', 1));
  h.addConnectionPoint({ x: 184, y: 206 });
  h.addConnectionPoint({ x: 181, y: 209 });
  h.addConnectionPoint({ x: -100, y: 999 });
  h.addConnectionPoint({ x: 9999, y: -7 });
  for (const invalid of [null, {}, { x: NaN, y: 2 }, { x: 2, y: Infinity }])
    h.addConnectionPoint(invalid);
  assert.deepEqual(copy(h.state.wirePoints), [
    { x: 180, y: 210 },
    { x: 0, y: 640 },
    { x: 1000, y: 0 },
  ]);
  h.undoConnectionPoint();
  assert.deepEqual(copy(h.state.wirePoints), [
    { x: 180, y: 210 },
    { x: 0, y: 640 },
  ]);
  h.undoConnectionPoint();
  h.undoConnectionPoint();
  h.undoConnectionPoint();
  assert.equal(h.state.wirePoints.length, 0);
  assert.deepEqual(copy(h.state.wireStart), endpoint('R1', 1));
  assert.deepEqual(h.state.document, before);
  assert.equal(h.calls.changed, 0);
  for (let index = 0; index < 33; index += 1) h.addConnectionPoint({ x: index * 10, y: 40 });
  assert.equal(h.state.wirePoints.length, 32);
  assert.match(h.statuses.at(-1).message, /32/);
  assert.equal(h.statuses.at(-1).kind, 'error');
});

test('finishing pin-to-pin commits the exact ordered corners once and clears the preview draft', () => {
  for (const points of [
    [],
    [
      { x: 600, y: 120 },
      { x: 650, y: 240 },
      { x: 600, y: 300 },
    ],
  ]) {
    const h = harness();
    const original = h.state.document;
    const before = copy(original);
    h.connectPin(endpoint('R1', 1));
    points.forEach(h.addConnectionPoint);
    const preview = h.state.wirePoints;
    h.connectPin(endpoint('R3', 1));
    const wire = h.state.document.wires.at(-1);
    assert.deepEqual(wire.from, endpoint('R1', 1));
    assert.deepEqual(wire.to, endpoint('R3', 1));
    assert.deepEqual(wire.points, points);
    assert.notEqual(wire.points, preview);
    assert.deepEqual(renderer.getWireRoute(wire, h.state.document.components), [
      { x: 540, y: 100 },
      ...points,
      { x: 540, y: 300 },
    ]);
    assert.deepEqual(original, before);
    assert.equal(h.state.wireStart, null);
    assert.equal(h.state.wirePoints.length, 0);
    assert.equal(h.calls.changed, 1);
    assert.deepEqual(engine.validateDocument(copy(h.state.document)), h.state.document);
  }
});

test('pin-to-wire preserves draft corners and splits the target into a real three-way junction', () => {
  const h = harness();
  const original = copy(h.state.document);
  const points = [
    { x: 60, y: 240 },
    { x: 280, y: 240 },
  ];
  h.connectPin(endpoint('R2'));
  points.forEach(h.addConnectionPoint);
  h.completeConnection(h.state.wireStart, { wireId: 'w1', position: { x: 280, y: 180 } });
  const { document } = h.state;
  const junction = document.components.find((part) => part.type === 'junction');
  assert.equal(junction.x, 280);
  assert.equal(junction.y, 180);
  const branch = document.wires.find(
    (wire) => wire.from.componentId === 'R2' && wire.from.pin === 0,
  );
  assert.deepEqual(branch.points, points);
  assert.deepEqual(branch.to, endpoint(junction.id));
  assert.deepEqual(
    document.wires.find((wire) => wire.id === 'w1').points,
    original.wires[0].points.slice(0, 2),
  );
  const continuation = document.wires.find((wire) => wire.from.componentId === junction.id);
  assert.deepEqual(continuation.points, original.wires[0].points.slice(2));
  assert.deepEqual(continuation.to, endpoint('R1'));
  const nets = engine.buildNets(document).pinNets;
  assert.equal(nets['V1:0'], nets['R1:0']);
  assert.equal(nets['R2:0'], nets['V1:0']);
  assert.equal(nets[`${junction.id}:0`], nets['V1:0']);
  assert.notEqual(nets['R2:1'], nets['V1:0']);
  assert.equal(document.wires.length, original.wires.length + 2);
  assert.equal(h.calls.changed, 1);
});

test('wire-to-wire drafts leave both wires untouched until completion and retain bends between their junctions', () => {
  const h = harness();
  const before = copy(h.state.document);
  h.state.selectedWire = 'w1';
  h.state.wireAnchor = { x: 280, y: 180 };
  h.startFromWire();
  assert.deepEqual(h.state.document, before);
  assert.equal(h.calls.changed, 0);
  const points = [
    { x: 280, y: 240 },
    { x: 300, y: 240 },
    { x: 300, y: 350 },
  ];
  points.forEach(h.addConnectionPoint);
  assert.deepEqual(h.state.document, before);
  h.completeConnection(h.state.wireStart, { wireId: 'w2', position: { x: 300, y: 380 } });
  const { document } = h.state;
  const junctions = document.components.filter((part) => part.type === 'junction');
  assert.equal(junctions.length, 2);
  const branch = document.wires.find(
    (wire) =>
      junctions.some((part) => part.id === wire.from.componentId) &&
      junctions.some((part) => part.id === wire.to.componentId),
  );
  assert.deepEqual(branch.points, points);
  const route = renderer.getWireRoute(branch, document.components);
  assert.deepEqual(route, [{ x: 280, y: 180 }, ...points, { x: 300, y: 380 }]);
  const nets = engine.buildNets(document).pinNets;
  assert.equal(nets['V1:0'], nets['R2:1']);
  assert.equal(nets['R1:0'], nets['R3:0']);
  assert.equal(document.wires.length, before.wires.length + 3);
  assert.deepEqual(engine.validateDocument(copy(document)), document);
  assert.equal(h.calls.changed, 1);
});

test('cancel, self-connections and existing links discard drafts without partial wire splits or document edits', () => {
  for (const action of ['cancel', 'same-wire', 'same-pin', 'duplicate', 'split-to-origin-pin']) {
    const h = harness();
    const before = copy(h.state.document);
    if (['cancel', 'same-wire', 'split-to-origin-pin'].includes(action)) {
      h.state.selectedWire = 'w1';
      h.state.wireAnchor =
        action === 'split-to-origin-pin' ? { x: 60, y: 100 } : { x: 280, y: 180 };
      h.startFromWire();
    } else h.connectPin(endpoint('V1'));
    h.addConnectionPoint({ x: 200, y: 220 });
    if (action === 'cancel') h.cancelConnection();
    else if (action === 'same-wire')
      h.completeConnection(h.state.wireStart, { wireId: 'w1', position: { x: 340, y: 100 } });
    else h.connectPin(endpoint(action === 'duplicate' ? 'R1' : 'V1'));
    assert.deepEqual(h.state.document, before, action);
    assert.equal(h.state.wireStart, null, action);
    assert.equal(h.state.wirePoints.length, 0, action);
    assert.equal(h.calls.changed, 0, action);
  }
});

test('failed target validation after a staged origin split keeps the document and editable draft intact', () => {
  for (const target of [
    { wireId: 'missing', position: { x: 300, y: 380 } },
    { wireId: 'w2', position: { x: NaN, y: 380 } },
    { endpoint: endpoint('missing') },
    { endpoint: endpoint('R3', 99) },
  ]) {
    const h = harness();
    const before = copy(h.state.document);
    h.state.selectedWire = 'w1';
    h.state.wireAnchor = { x: 280, y: 180 };
    h.startFromWire();
    h.addConnectionPoint({ x: 280, y: 250 });
    const origin = copy(h.state.wireStart);
    const points = copy(h.state.wirePoints);
    h.completeConnection(h.state.wireStart, target);
    assert.deepEqual(h.state.document, before);
    assert.deepEqual(copy(h.state.wireStart), origin);
    assert.deepEqual(copy(h.state.wirePoints), points);
    assert.equal(h.calls.changed, 0);
    assert.equal(h.statuses.at(-1).kind, 'error');
  }
});

test('read-only diagrams cannot begin or commit wire drafts', () => {
  const h = harness();
  const before = copy(h.state.document);
  h.state.editable = false;
  h.state.selectedWire = 'w1';
  h.connectPin(endpoint('R1', 1));
  h.startFromWire();
  h.addConnectionPoint({ x: 200, y: 200 });
  h.completeConnection(endpoint('R1', 1), { endpoint: endpoint('R3', 1) });
  assert.deepEqual(h.state.document, before);
  assert.equal(h.state.wireStart, null);
  assert.equal(h.state.wirePoints.length, 0);
  assert.equal(h.calls.changed, 0);
});
