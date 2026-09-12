/* Tests mutate isolated invalid documents to exercise strict validation. */
/* eslint-disable no-param-reassign */
const assert = require('node:assert/strict');
const test = require('node:test');
const engine = require('../public/circuit-engine');
const renderer = require('../public/circuit-renderer');
const layout = require('../public/circuit-layout');
const actions = require('../public/circuit-ai-actions');
const { validateCircuitInput } = require('../backend/circuits');

function fixture(rail = 'vcc', dc = 5, analysis = { type: 'dc' }) {
  return engine.validateDocument({
    version: 1,
    components: [
      { id: 'LV1', type: 'fixed_voltage', x: 200, y: 100, params: { dc } },
      { id: 'P1', type: rail, x: 200, y: 240 },
      { id: 'P2', type: rail, x: 600, y: 100 },
      { id: 'R1', type: 'resistor', x: 600, y: 280, params: { resistance: 1000 } },
      { id: 'G1', type: 'ground', x: 600, y: 440 },
    ],
    wires: [
      ['LV1', 0, 'P1', 0],
      ['P2', 0, 'R1', 0],
      ['R1', 1, 'G1', 0],
    ].map(([a, ap, b, bp], i) => ({
      id: `w${i}`,
      from: { componentId: a, pin: ap },
      to: { componentId: b, pin: bp },
    })),
    analysis,
  });
}
const values = (result, id) => result.traces.find((trace) => trace.id === id).values;
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('each named rail connects remote loads, preserving fixed positive, negative and zero levels', () => {
  for (const rail of engine.powerRails) {
    for (const dc of [5, 3.3, -5, 0]) {
      const input = fixture(rail, dc);
      const after = layout.normalizeCircuitLayout(input);
      const nets = engine.buildNets(after);
      assert.equal(nets.pinNets['P1:0'], nets.pinNets['P2:0']);
      assert.deepEqual(nets, engine.buildNets(input));
      const result = engine.simulate(after);
      near(values(result, 'V:R1')[0], dc);
      near(values(result, 'I:R1')[0], dc / 1000);
      near(values(result, 'V:LV1')[0], dc);
      near(values(result, 'I:LV1')[0], -dc / 1000);
      assert.deepEqual(engine.traceDescriptors(after.components[1]), []);
      assert.equal(after.components.find((part) => part.id === 'R1').rotation, 90);
      assert.deepEqual(layout.normalizeCircuitLayout(after), after);
      for (const wire of after.wires) {
        const route = renderer.getWireRoute(wire, after.components);
        route.slice(1).forEach((p, i) => assert.ok(p.x === route[i].x || p.y === route[i].y));
      }
    }
  }
});

test('rail names neither prescribe a voltage nor merge different supplies, and stay local to a document', () => {
  const input = fixture();
  input.components.push(...['vdd', 'vss', 'vee'].map((type, i) => ({ id: `P${i + 3}`, type })));
  const nets = engine.buildNets(input).pinNets;
  assert.equal(new Set(['P1:0', 'P3:0', 'P4:0', 'P5:0', 'G1:0'].map((key) => nets[key])).size, 5);
  const unpowered = fixture();
  unpowered.components = unpowered.components.filter((part) => part.id !== 'LV1');
  unpowered.wires.shift();
  near(values(engine.simulate(unpowered), 'V:R1')[0], 0);
  near(values(engine.simulate(fixture('vcc', 12)), 'V:R1')[0], 12);
  near(values(engine.simulate(fixture('vcc', 3.3)), 'V:R1')[0], 3.3);
  const external = fixture('vdd', 9);
  external.components[0] = { ...external.components[0], type: 'voltage' };
  external.wires.push({
    id: 'return',
    from: { componentId: 'LV1', pin: 1 },
    to: { componentId: 'G1', pin: 0 },
  });
  near(values(engine.simulate(external), 'V:R1')[0], 9);
});

test('fixed levels support transient, signed DC sweep, AC bias and an implicit reference', () => {
  const transient = engine.simulate(
    fixture('vee', -5, { type: 'transient', stop: 0.003, step: 0.001 }),
  );
  values(transient, 'V:R1').forEach((v) => near(v, -5));
  const sweep = engine.simulate(
    fixture('vcc', 5, {
      type: 'sweep',
      componentId: 'LV1',
      parameter: 'dc',
      start: -5,
      stop: 5,
      points: 3,
    }),
  );
  values(sweep, 'V:R1').forEach((v, i) => near(v, [-5, 0, 5][i]));
  const ac = engine.simulate(fixture('vcc', 5, { type: 'ac', start: 10, stop: 1000, points: 3 }));
  values(ac, 'V:R1').forEach((v) => near(v, 0));
  const floatingReference = fixture();
  floatingReference.components = floatingReference.components.filter((part) => part.id !== 'G1');
  floatingReference.components.push({ id: 'LV0', type: 'fixed_voltage', params: { dc: 0 } });
  floatingReference.wires.at(-1).to = { componentId: 'LV0', pin: 0 };
  near(values(engine.simulate(floatingReference), 'V:R1')[0], 5);
});

test('power symbols round trip through strict storage and Max actions and reject invalid pins/parameters', () => {
  const input = fixture();
  const empty = engine.validateDocument({ version: 1, components: [], wires: [] });
  const edits = [
    ...input.components.map((component) => ({ type: 'add_component', component })),
    ...input.wires.map(({ from, to }) => ({ type: 'connect', from, to })),
  ];
  const output = actions.applyActions(empty, actions.validateActions(edits, empty));
  const saved = validateCircuitInput({ title: '电源符号', document: output });
  assert.deepEqual(
    saved.document,
    actions.validateEditorDocument(JSON.parse(JSON.stringify(output))),
  );
  near(values(engine.simulate(saved.document), 'V:R1')[0], 5);
  for (const mutation of [
    (doc) => {
      doc.wires[0].from.pin = 1;
    },
    (doc) => {
      doc.components[0].params.dc = '5V';
    },
    (doc) => {
      doc.components[1].params.dc = 5;
    },
    (doc) => {
      doc.components[0].params.waveform = 'pulse';
    },
  ]) {
    const bad = structuredClone(input);
    mutation(bad);
    assert.throws(() => actions.validateEditorDocument(bad));
  }
});

test('recognition accepts power symbols and retains their topology and signed fixed voltage', () => {
  const { parseCircuitRecognitionResponse } = require('../backend/circuit-recognition');
  const input = fixture('vee', -12);
  const result = parseCircuitRecognitionResponse(
    JSON.stringify({
      recognized: true,
      circuit: { title: '负电源', description: '', document: input },
      warnings: [],
    }),
  );
  assert.deepEqual(engine.buildNets(result.circuit.document), engine.buildNets(input));
  near(values(engine.simulate(result.circuit.document), 'V:R1')[0], -12);
});

test('wire junction reuse understands named rails while keeping distinct names isolated', () => {
  const { connectToWire } = require('../public/circuit-wiring');
  for (const type of ['vcc', 'vdd']) {
    const input = engine.validateDocument({
      version: 1,
      components: [
        { id: 'P1', type: 'vcc', x: 100, y: 100 },
        { id: 'P2', type, x: 500, y: 100 },
        { id: 'J1', type: 'junction', x: 300, y: 140 },
        { id: 'R1', type: 'resistor', x: 700, y: 140 },
      ],
      wires: [
        {
          id: 'w1',
          from: { componentId: 'P1', pin: 0 },
          to: { componentId: 'R1', pin: 0 },
          points: [],
        },
        {
          id: 'w2',
          from: { componentId: 'P2', pin: 0 },
          to: { componentId: 'J1', pin: 0 },
          points: [],
        },
      ],
    });
    const result = connectToWire(input, 'w1', { x: 300, y: 140 });
    assert.equal(result.endpoint.componentId, type === 'vcc' ? 'J1' : 'J2');
    assert.equal(result.document.components.length, type === 'vcc' ? 4 : 5);
  }
});
