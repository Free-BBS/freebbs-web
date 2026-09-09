const assert = require('node:assert/strict');
const test = require('node:test');
const { validateCircuitInput } = require('./circuits');

function document() {
  return { version: 1, components: [], wires: [], analysis: { type: 'dc' } };
}

function input() {
  return { title: '  我的电路  ', description: '  测试  ', document: document() };
}

test('circuit drafts accept disconnected documents and normalize text without simulating', () => {
  const draft = input();
  draft.document.components.push({
    id: 'R1',
    type: 'resistor',
    x: 240,
    y: 160,
    rotation: 0,
    params: { resistance: 1000 },
  });
  const validated = validateCircuitInput(draft);
  assert.equal(validated.title, '我的电路');
  assert.equal(validated.description, '测试');
  assert.equal(validated.document.components.length, 1);
  assert.equal(validated.document.wires.length, 0);
  assert.deepEqual(draft.title, '  我的电路  ', 'validation must not mutate input');
});

test('circuit request rejects mass assignment, invalid metadata and invalid revision types', () => {
  for (const changes of [
    { title: '' },
    { title: 't'.repeat(121) },
    { title: 'x\ny' },
    { title: 5 },
    { description: false },
    { description: 'x'.repeat(2001) },
    { owner_id: 1 },
    { cid: 'c_000000000000000000000000' },
    { document: [] },
    { document: null },
  ]) {
    assert.throws(() => validateCircuitInput({ ...input(), ...changes }));
  }
  for (const expectedRevision of [undefined, '1', 0, -1, 1.5, 4294967295]) {
    assert.throws(() => validateCircuitInput({ ...input(), expectedRevision }, { updating: true }));
  }
  assert.equal(
    validateCircuitInput({ ...input(), expectedRevision: 1 }, { updating: true }).expectedRevision,
    1,
  );
});

test('circuit documents reject prototype pollution, excessive nesting, non-JSON values and size', () => {
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const body = input();
    body.document = JSON.parse(`{"version":1,"${key}":{"polluted":true}}`);
    assert.throws(() => validateCircuitInput(body), /不允许的字段/);
    assert.equal({}.polluted, undefined);
  }
  const deep = input();
  deep.document.extra = {};
  let current = deep.document.extra;
  for (let index = 0; index < 20; index += 1) {
    current.next = {};
    current = current.next;
  }
  assert.throws(() => validateCircuitInput(deep), /层级/);
  assert.throws(() => validateCircuitInput({ ...input(), document: new Date() }), /JSON/);
  const infinite = input();
  infinite.document.extra = Infinity;
  assert.throws(() => validateCircuitInput(infinite), /JSON/);
  const oversized = input();
  oversized.document.extra = '测'.repeat(100000);
  assert.throws(() => validateCircuitInput(oversized), /256 KiB/);
});

test('storage uses the engine validator for components, wiring, scans and safe expressions', () => {
  const component = {
    id: 'N1',
    type: 'nonlinear',
    x: 240,
    y: 160,
    rotation: 0,
    params: { expression: 'i=k*u^3', k: 0.001 },
  };
  const valid = input();
  valid.document.components = [component];
  assert.equal(validateCircuitInput(valid).document.components[0].type, 'nonlinear');
  for (const expression of [
    'process.exit()',
    'globalThis.x=1',
    'constructor.constructor("return process")()',
    'u;while(1){}',
  ]) {
    const invalid = structuredClone(valid);
    invalid.document.components[0].params.expression = expression;
    assert.throws(
      () => validateCircuitInput(invalid),
      `must reject unsafe expression: ${expression}`,
    );
  }
  const badWire = input();
  badWire.document.wires = [
    { id: 'w1', from: { componentId: 'missing', pin: 0 }, to: { componentId: 'missing', pin: 1 } },
  ];
  assert.throws(() => validateCircuitInput(badWire));
  const badScan = input();
  badScan.document.analysis = { type: 'ac', start: 10, stop: 1000, points: 2001, scale: 'log' };
  assert.throws(() => validateCircuitInput(badScan));
  const badType = structuredClone(valid);
  badType.document.components[0].type = 'script';
  assert.throws(() => validateCircuitInput(badType));
});

test('create and update validation preserve junction wiring and high resolution sine analysis', () => {
  const body = input();
  body.document.components = [
    {
      id: 'V1',
      type: 'voltage',
      x: 100,
      y: 100,
      params: { dc: 0, waveform: 'sine', amplitude: 12, frequency: 10000, duty: 50 },
    },
    { id: 'R1', type: 'resistor', x: 300, y: 100, params: { resistance: 1000 } },
    { id: 'G1', type: 'ground', x: 300, y: 200 },
    { id: 'J1', type: 'junction', x: 200, y: 100, rotation: 0, params: {} },
  ];
  body.document.wires = [
    {
      id: 'w1',
      from: { componentId: 'V1', pin: 0 },
      to: { componentId: 'J1', pin: 0 },
      points: [{ x: 150, y: 100 }],
    },
    {
      id: 'w2',
      from: { componentId: 'J1', pin: 0 },
      to: { componentId: 'R1', pin: 0 },
      points: [],
    },
    { id: 'w3', from: { componentId: 'R1', pin: 1 }, to: { componentId: 'G1', pin: 0 } },
    { id: 'w4', from: { componentId: 'V1', pin: 1 }, to: { componentId: 'G1', pin: 0 } },
  ];
  body.document.analysis = { type: 'transient', stop: 0.1, step: 1e-6, initial: 'operating-point' };
  const before = JSON.stringify(body);
  const created = validateCircuitInput(body);
  assert.deepEqual(created.document.components[3], body.document.components[3]);
  assert.deepEqual(created.document.wires, body.document.wires);
  assert.deepEqual(created.document.analysis, body.document.analysis);
  assert.equal(created.document.components[0].params.duty, 50);
  const updated = validateCircuitInput({ ...created, expectedRevision: 1 }, { updating: true });
  assert.deepEqual(JSON.parse(JSON.stringify(updated.document)), created.document);
  assert.equal(JSON.stringify(body), before);

  const invalidPin = structuredClone(body);
  invalidPin.document.wires[0].to.pin = 1;
  assert.throws(() => validateCircuitInput(invalidPin), /引脚/);
  const invalidJunction = structuredClone(body);
  invalidJunction.document.components[3].params.resistance = 1;
  assert.throws(() => validateCircuitInput(invalidJunction), /不支持参数/);
  const invalidPoints = structuredClone(body);
  invalidPoints.document.analysis.stop = 0.100001;
  assert.throws(() => validateCircuitInput(invalidPoints), /100001/);
});
