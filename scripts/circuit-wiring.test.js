const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const engine = require('../public/circuit-engine');
const renderer = require('../public/circuit-renderer');
const { connectToWire } = require('../public/circuit-wiring');

const endpoint = (componentId, pin = 0) => ({ componentId, pin });
function fixture() {
  return engine.validateDocument({
    version: 1,
    components: [
      { id: 'V1', type: 'voltage', x: 100, y: 100, params: { dc: 5 } },
      { id: 'R1', type: 'resistor', x: 500, y: 100, params: { resistance: 1000 } },
      { id: 'R2', type: 'resistor', x: 300, y: 300, params: { resistance: 1000 } },
      { id: 'G1', type: 'ground', x: 500, y: 400 },
    ],
    wires: [
      { id: 'w1', from: endpoint('V1'), to: endpoint('R1'), points: [] },
      { id: 'w2', from: endpoint('V1', 1), to: endpoint('G1') },
      { id: 'w3', from: endpoint('R1', 1), to: endpoint('G1') },
      { id: 'w4', from: endpoint('R2', 1), to: endpoint('G1') },
    ],
    analysis: { type: 'dc' },
  });
}

function assertUnchanged(before, input) {
  assert.deepEqual(input, before);
}

test('connecting a pin to a wire projects onto its shape and creates a real three-way electrical junction', () => {
  const input = fixture();
  const before = structuredClone(input);
  const result = connectToWire(input, 'w1', { x: 300, y: 120 }, { fromEndpoint: endpoint('R2') });
  assert.deepEqual(result.endpoint, endpoint('J1'));
  assert.deepEqual(result.document.components.at(-1), {
    id: 'J1',
    type: 'junction',
    x: 300,
    y: 100,
    rotation: 0,
    params: {},
  });
  assert.deepEqual(result.document.wires[0], {
    id: 'w1',
    from: endpoint('V1'),
    to: endpoint('J1'),
    points: [],
  });
  assert.deepEqual(result.document.wires[1], {
    id: 'w5',
    from: endpoint('J1'),
    to: endpoint('R1'),
    points: [],
  });
  assert.deepEqual(result.document.wires.at(-1), {
    id: 'w6',
    from: endpoint('R2'),
    to: endpoint('J1'),
  });
  const normalized = engine.validateDocument(result.document);
  const { pinNets } = engine.buildNets(normalized);
  assert.equal(pinNets['V1:0'], pinNets['J1:0']);
  assert.equal(pinNets['R1:0'], pinNets['J1:0']);
  assert.equal(pinNets['R2:0'], pinNets['J1:0']);
  assert.notEqual(pinNets['G1:0'], pinNets['J1:0']);
  const simulation = engine.simulate(normalized);
  assert.equal(simulation.traces.find((trace) => trace.id === 'V:R2').values[0], 5);
  assertUnchanged(before, input);
  result.document.components[0].params.dc = 100;
  assertUnchanged(before, input);
});

test('starting from a wire creates a junction without changing any existing circuit measurements', () => {
  const input = fixture();
  const result = connectToWire(input, 'w1', { x: 300, y: 100 });
  assert.equal(result.document.wires.length, input.wires.length + 1);
  assert.deepEqual(engine.simulate(result.document).traces, engine.simulate(input).traces);
  const roundTrip = engine.validateDocument(JSON.parse(JSON.stringify(result.document)));
  assert.deepEqual(roundTrip, engine.validateDocument(result.document));
  const further = connectToWire(roundTrip, 'w5', { x: 400, y: 100 });
  assert.equal(further.document.components.at(-1).id, 'J2');
  assert.deepEqual(engine.simulate(further.document).traces, engine.simulate(input).traces);
});

test('custom bends, exact corner splits and automatic routes preserve their visible geometry', () => {
  const input = fixture();
  input.wires[0].points = [
    { x: 150, y: 100 },
    { x: 150, y: 200 },
    { x: 350, y: 200 },
    { x: 350, y: 100 },
  ];
  const split = connectToWire(input, 'w1', { x: 250, y: 190 }).document;
  assert.deepEqual(split.wires[0].points, input.wires[0].points.slice(0, 2));
  assert.deepEqual(split.wires[1].points, input.wires[0].points.slice(2));
  assert.deepEqual(
    { x: split.components.at(-1).x, y: split.components.at(-1).y },
    { x: 260, y: 200 },
  );
  const corner = connectToWire(input, 'w1', { x: 150, y: 200 }).document;
  assert.deepEqual(corner.wires[0].points, [{ x: 150, y: 100 }]);
  assert.deepEqual(corner.wires[1].points, [
    { x: 350, y: 200 },
    { x: 350, y: 100 },
  ]);
  input.components[1].y = 300;
  delete input.wires[0].points;
  const automatic = connectToWire(input, 'w1', { x: 265, y: 200 }).document;
  assert.deepEqual(automatic.wires[0].points, [{ x: 260, y: 100 }]);
  assert.deepEqual(automatic.wires[1].points, [{ x: 260, y: 300 }]);
  const diagonal = fixture();
  diagonal.components[1].y = 300;
  const projected = connectToWire(diagonal, 'w1', { x: 260, y: 210 }).document.components.at(-1);
  assert.equal(projected.x, 264);
  assert.equal(projected.y, 202);
});

test('nearby existing endpoints are reused without zero-length splits or duplicate branch wires', () => {
  for (const [position, expected] of [
    [{ x: 66, y: 104 }, endpoint('V1')],
    [{ x: 451, y: 102 }, endpoint('R1')],
  ]) {
    const input = fixture();
    const reused = connectToWire(input, 'w1', position);
    assert.deepEqual(reused.endpoint, expected);
    assert.deepEqual(reused.document, input);
    const attached = connectToWire(input, 'w1', position, { fromEndpoint: endpoint('R2') });
    assert.equal(attached.document.components.length, input.components.length);
    assert.equal(attached.document.wires.length, input.wires.length + 1);
    assert.deepEqual(
      connectToWire(attached.document, 'w1', position, { fromEndpoint: endpoint('R2') }).document,
      attached.document,
    );
  }
  const input = fixture();
  assert.deepEqual(
    connectToWire(input, 'w1', { x: 60, y: 100 }, { fromEndpoint: endpoint('V1') }).document,
    input,
  );
  const split = connectToWire(input, 'w1', { x: 300, y: 100 }, { fromEndpoint: endpoint('V1') });
  assert.equal(split.document.wires.length, input.wires.length + 1);
});

test('same-position junction reuse requires electrical connection and never merges ordinary crossings', () => {
  const input = fixture();
  input.components.push({ id: 'J1', type: 'junction', x: 300, y: 100, rotation: 0, params: {} });
  input.wires.push({ id: 'w5', from: endpoint('J1'), to: endpoint('R2') });
  const separate = connectToWire(input, 'w1', { x: 300, y: 100 });
  assert.equal(separate.endpoint.componentId, 'J2');
  const nets = engine.buildNets(separate.document).pinNets;
  assert.notEqual(nets['J1:0'], nets['J2:0']);
  input.wires.push({ id: 'w6', from: endpoint('J1'), to: endpoint('R1') });
  const reused = connectToWire(input, 'w1', { x: 300, y: 100 });
  assert.deepEqual(reused.endpoint, endpoint('J1'));
  assert.deepEqual(reused.document, input);
});

test('wire-to-wire connection joins the chosen nets, sharing an explicitly selected crossing junction', () => {
  const input = fixture();
  input.components.push({
    id: 'R3',
    type: 'resistor',
    x: 340,
    y: 0,
    rotation: 0,
    params: { resistance: 1000 },
  });
  input.wires.push({ id: 'w5', from: endpoint('R3'), to: endpoint('R2'), points: [] });
  const start = connectToWire(input, 'w1', { x: 300, y: 100 });
  const before = engine.buildNets(start.document).pinNets;
  assert.notEqual(before['R3:0'], before['J1:0']);
  const completed = connectToWire(
    start.document,
    'w5',
    { x: 286.6666666666667, y: 100 },
    { fromEndpoint: start.endpoint },
  );
  const after = engine.buildNets(completed.document).pinNets;
  assert.equal(after['R3:0'], after['V1:0']);
  assert.equal(completed.document.components.filter((item) => item.type === 'junction').length, 2);
  const crossing = fixture();
  crossing.components.push({
    id: 'R3',
    type: 'resistor',
    x: 340,
    y: 0,
    params: { resistance: 1000 },
  });
  crossing.components[2].x = 340;
  crossing.wires.push({ id: 'w5', from: endpoint('R3'), to: endpoint('R2'), points: [] });
  const first = connectToWire(crossing, 'w1', { x: 300, y: 100 });
  const joined = connectToWire(
    first.document,
    'w5',
    { x: 300, y: 100 },
    { fromEndpoint: first.endpoint },
  );
  assert.deepEqual(joined.endpoint, first.endpoint);
  assert.equal(joined.document.components.length, first.document.components.length);
  assert.equal(joined.document.wires.length, first.document.wires.length + 1);
  const joinedNets = engine.buildNets(joined.document).pinNets;
  assert.equal(joinedNets['R3:0'], joinedNets['V1:0']);
  assert.ok(joined.document.wires.every((wire) => wire.from.componentId !== wire.to.componentId));
});

test('identifier allocation is deterministic and avoids both component and wire identifiers', () => {
  const input = fixture();
  input.components.push({
    id: 'w5',
    type: 'resistor',
    x: 100,
    y: 200,
    params: { resistance: 1000 },
  });
  input.wires.push({ id: 'J1', from: endpoint('R1', 1), to: endpoint('G1') });
  const first = connectToWire(input, 'w1', { x: 300, y: 100 }, { fromEndpoint: endpoint('R2') });
  assert.deepEqual(
    first,
    connectToWire(input, 'w1', { x: 300, y: 100 }, { fromEndpoint: endpoint('R2') }),
  );
  assert.equal(first.endpoint.componentId, 'J2');
  assert.equal(first.document.wires[1].id, 'w6');
  assert.equal(first.document.wires.at(-1).id, 'w7');
  const ids = [...first.document.components, ...first.document.wires].map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('capacity checks count splits and branches exactly while preserving the input on failure', () => {
  const fullComponents = fixture();
  while (fullComponents.components.length < 80)
    fullComponents.components.push({
      id: `unused${fullComponents.components.length}`,
      type: 'resistor',
      x: 100,
      y: 100,
      params: { resistance: 1000 },
    });
  const before = structuredClone(fullComponents);
  assert.throws(() => connectToWire(fullComponents, 'w1', { x: 300, y: 100 }), /最多 80 个元件/);
  assertUnchanged(before, fullComponents);
  assert.equal(
    connectToWire(fullComponents, 'w1', { x: 60, y: 100 }, { fromEndpoint: endpoint('R2') })
      .document.components.length,
    80,
  );
  const fullWires = fixture();
  while (fullWires.wires.length < 199)
    fullWires.wires.push({
      id: `extra${fullWires.wires.length}`,
      from: endpoint('V1', 1),
      to: endpoint('G1'),
    });
  assert.equal(connectToWire(fullWires, 'w1', { x: 300, y: 100 }).document.wires.length, 200);
  assert.throws(
    () => connectToWire(fullWires, 'w1', { x: 300, y: 100 }, { fromEndpoint: endpoint('R2') }),
    /最多 200 条导线/,
  );
  fullWires.wires.push({ id: 'extraLast', from: endpoint('V1', 1), to: endpoint('G1') });
  const fullBefore = structuredClone(fullWires);
  assert.throws(() => connectToWire(fullWires, 'w1', { x: 300, y: 100 }), /最多 200 条导线/);
  assert.deepEqual(connectToWire(fullWires, 'w1', { x: 60, y: 100 }).document, fullWires);
  assertUnchanged(fullBefore, fullWires);
});

test('invalid targets and positions produce useful errors without touching the draft', () => {
  const input = fixture();
  const before = structuredClone(input);
  assert.throws(() => connectToWire(input, 'missing', { x: 100, y: 100 }), /导线不存在/);
  for (const position of [null, {}, { x: NaN, y: 1 }, { x: 1, y: Infinity }])
    assert.throws(() => connectToWire(input, 'w1', position), /连接位置无效/);
  for (const fromEndpoint of [endpoint('missing'), endpoint('R1', -1), endpoint('R1', 2)])
    assert.throws(
      () => connectToWire(input, 'w1', { x: 300, y: 100 }, { fromEndpoint }),
      /连接端点无效/,
    );
  assertUnchanged(before, input);
});

test('the browser build exposes the same immutable connection API', () => {
  const context = vm.createContext({ FreeBbsCircuitRenderer: renderer });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '../public/circuit-wiring.js'), 'utf8'),
    context,
  );
  const input = fixture();
  const result = context.FreeBbsCircuitWiring.connectToWire(input, 'w1', { x: 300, y: 100 });
  assert.deepEqual(
    JSON.parse(JSON.stringify(result)),
    connectToWire(input, 'w1', { x: 300, y: 100 }),
  );
});

test('branch splits use the same snapped landing as the preview and retain precise non-grid geometry', () => {
  const input = fixture();
  input.components[0].y = 103;
  input.components[1].y = 103;
  const wire = input.wires[0];
  const raw = { x: 307, y: 108 };
  const preview = renderer.snapWirePoint(wire, input.components, raw).point;
  assert.deepEqual(preview, { x: 300, y: 103 });
  const result = connectToWire(input, wire.id, raw, { fromEndpoint: endpoint('R2') });
  const junction = result.document.components.at(-1);
  assert.deepEqual({ x: junction.x, y: junction.y }, preview);
  assert.deepEqual(
    connectToWire(input, wire.id, preview, { fromEndpoint: endpoint('R2') }),
    result,
  );
  input.components[0].x = 107;
  assert.deepEqual(connectToWire(input, wire.id, { x: 73, y: 103 }).endpoint, endpoint('V1'));
  input.components[1].y = 303;
  const diagonal = renderer.snapWirePoint(wire, input.components, raw).point;
  const attached = connectToWire(input, wire.id, diagonal).document.components.at(-1);
  assert.deepEqual({ x: attached.x, y: attached.y }, diagonal);
});

test('an explicitly connected pin at an off-grid crossing is reused exactly rather than creating a shifted junction', () => {
  const input = fixture();
  input.components[2].x = 347;
  input.components[2].y = 100;
  const result = connectToWire(input, 'w1', { x: 307, y: 100 }, { fromEndpoint: endpoint('R2') });
  assert.deepEqual(result.endpoint, endpoint('R2'));
  assert.equal(result.document.components.length, input.components.length);
  assert.equal(result.document.wires[0].to.componentId, 'R2');
  assert.equal(result.document.wires[1].from.componentId, 'R2');
  const nets = engine.buildNets(result.document).pinNets;
  assert.equal(nets['R2:0'], nets['V1:0']);
});
