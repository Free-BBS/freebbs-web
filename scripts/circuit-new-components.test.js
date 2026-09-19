const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../public/circuit-engine');

function circuit(parts, links, analysis = { type: 'dc' }) {
  const ep = (value) => {
    const [componentId, pin] = value.split(':');
    return { componentId, pin: Number(pin) };
  };
  return {
    version: 1,
    components: parts.map(([id, type, params = {}]) => ({ id, type, params })),
    wires: links.map(([a, b], i) => ({ id: `w${i}`, from: ep(a), to: ep(b) })),
    analysis,
  };
}
const value = (result, id) => result.traces.find((t) => t.id === id).values[0];
test('bulb consumes power and LED conducts only forwards with a series resistor', () => {
  for (const type of ['bulb', 'led']) {
    for (const dc of [5, -5]) {
      const doc = circuit(
        [
          ['V', 'voltage', { dc }],
          ['R', 'resistor', { resistance: 330 }],
          ['L', type],
          ['G', 'ground'],
        ],
        [
          ['V:0', 'R:0'],
          ['R:1', 'L:0'],
          ['L:1', 'G:0'],
          ['V:1', 'G:0'],
        ],
      );
      const current = value(engine.simulate(doc), 'I:L');
      if (type === 'bulb') assert.ok(Math.abs(current - dc / 430) < 1e-8);
      else if (dc > 0) assert.ok(current > 0.005 && current < 0.015);
      else assert.ok(Math.abs(current) < 1e-8);
    }
  }
});
test('voltage-controlled switch changes load voltage across the threshold', () => {
  for (const dc of [0, 5]) {
    const doc = circuit(
      [
        ['V', 'voltage'],
        ['C', 'voltage', { dc }],
        ['S', 'switch'],
        ['R', 'resistor'],
        ['G', 'ground'],
      ],
      [
        ['V:0', 'S:0'],
        ['S:1', 'R:0'],
        ['R:1', 'G:0'],
        ['V:1', 'G:0'],
        ['C:0', 'S:2'],
        ['C:1', 'G:0'],
        ['S:3', 'G:0'],
      ],
    );
    const voltage = value(engine.simulate(doc), 'V:R');
    assert.ok(dc ? voltage > 4.99 : voltage < 0.00001);
  }
});
test('logic chip truth tables and cascaded gates produce correct outputs', () => {
  const gates = {
    AND: (a, b) => a && b,
    OR: (a, b) => a || b,
    NOT: (a) => !a,
    NAND: (a, b) => !(a && b),
    NOR: (a, b) => !(a || b),
    XOR: (a, b) => a !== b,
    XNOR: (a, b) => a === b,
    BUF: (a) => a,
  };
  for (const [gate, truth] of Object.entries(gates))
    for (const a of [0, 1])
      for (const b of [0, 1]) {
        const doc = circuit(
          [
            ['A', 'voltage', { dc: a * 5 }],
            ['B', 'voltage', { dc: b * 5 }],
            ['U', 'logic', { gate }],
            ['N', 'logic', { gate: 'NOT' }],
            ['G', 'ground'],
          ],
          [
            ['A:0', 'U:0'],
            ['B:0', 'U:1'],
            ['A:1', 'G:0'],
            ['B:1', 'G:0'],
            ['U:3', 'G:0'],
            ['U:2', 'N:0'],
            ['N:1', 'G:0'],
            ['N:3', 'G:0'],
          ],
        );
        const result = engine.simulate(doc);
        assert.ok(Math.abs(value(result, 'V:U') - (truth(a, b) ? 5 : 0)) < 1e-6, gate);
        assert.ok(Math.abs(value(result, 'V:N') - (truth(a, b) ? 0 : 5)) < 1e-6, gate);
      }
});
test('square and noise sources run transient analyses with repeatable distinct samples', () => {
  for (const type of ['square', 'noise']) {
    const doc = circuit(
      [
        ['V', type],
        ['R', 'resistor'],
        ['G', 'ground'],
      ],
      [
        ['V:0', 'R:0'],
        ['V:1', 'G:0'],
        ['R:1', 'G:0'],
      ],
      { type: 'transient', stop: 0.005, step: 0.0001 },
    );
    const first = engine.simulate(doc);
    assert.deepEqual(first, engine.simulate(doc));
    const {values} = first.traces.find((t) => t.id === 'V:R');
    assert.ok(new Set(values).size >= 2);
    assert.ok(values.every((v) => Math.abs(v) <= 5.00001));
  }
});
