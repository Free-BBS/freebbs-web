const assert = require('node:assert/strict');
const test = require('node:test');
const engine = require('../public/circuit-engine');

function circuit(parts, links, analysis = { type: 'dc' }) {
  const endpoint = (reference) => {
    const [componentId, pin] = reference.split(':');
    return { componentId, pin: Number(pin) };
  };
  return {
    version: 1,
    components: parts.map(([id, type, params = {}]) => ({ id, type, params })),
    wires: links.map(([from, to], index) => ({
      id: `w${index}`,
      from: endpoint(from),
      to: endpoint(to),
    })),
    analysis,
  };
}
function box(params, analysis, source = { dc: 10, acAmplitude: 2, phase: 30 }) {
  return circuit(
    [
      ['V1', 'voltage', source],
      ['N1', 'twoport', params],
      ['RL', 'resistor', { resistance: 1000 }],
      ['GND', 'ground'],
    ],
    [
      ['V1:0', 'N1:0'],
      ['V1:1', 'GND:0'],
      ['N1:1', 'GND:0'],
      ['N1:2', 'RL:0'],
      ['N1:3', 'GND:0'],
      ['RL:1', 'GND:0'],
    ],
    analysis,
  );
}
function near(actual, expected, tolerance = 1e-8) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ${expected} ± ${tolerance}, got ${actual}`,
  );
}
const get = (result, id, index = 0) => result.traces.find((trace) => trace.id === id).values[index];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const neg = (a) => [-a[0], -a[1]];
const sub = (a, b) => add(a, neg(b));
const mul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const div = (a, b) => {
  const denominator = b[0] ** 2 + b[1] ** 2;
  return [(a[0] * b[0] + a[1] * b[1]) / denominator, (a[1] * b[0] - a[0] * b[1]) / denominator];
};
function representations(z) {
  const [a, b, c, d] = z;
  const det = sub(mul(a, d), mul(b, c));
  return {
    Z: z,
    Y: [div(d, det), div(neg(b), det), div(neg(c), det), div(a, det)],
    H: [div(det, d), div(b, d), div(neg(c), d), div([1, 0], d)],
    G: [div([1, 0], a), div(neg(b), a), div(c, a), div(det, a)],
    ABCD: [div(a, c), div(det, c), div([1, 0], c), div(d, c)],
  };
}
function parameters(parameterSet, matrix) {
  return Object.fromEntries([
    ['parameterSet', parameterSet],
    ...['11', '12', '21', '22'].flatMap((key, index) => [
      [`m${key}`, matrix[index][0]],
      [`i${key}`, matrix[index][1]],
    ]),
  ]);
}
function phasor(result, id, index = 0) {
  const trace = result.traces.find((item) => item.id === id);
  const angle = (trace.phase[index] * Math.PI) / 180;
  return [trace.values[index] * Math.cos(angle), trace.values[index] * Math.sin(angle)];
}
function nearPhasor(actual, expected) {
  near(actual[0], expected[0]);
  near(actual[1], expected[1]);
}

test('Z/Y/H/G/ABCD agree with an independently wired resistor T-network in DC, transient, sweep and AC', () => {
  const source = {
    dc: 10,
    waveform: 'sine',
    amplitude: 2,
    frequency: 100,
    acAmplitude: 2,
    phase: 30,
  };
  const physical = circuit(
    [
      ['V1', 'voltage', source],
      ['R1', 'resistor', { resistance: 100 }],
      ['R2', 'resistor', { resistance: 200 }],
      ['R3', 'resistor', { resistance: 300 }],
      ['RL', 'resistor', { resistance: 1000 }],
      ['GND', 'ground'],
    ],
    [
      ['V1:0', 'R1:0'],
      ['V1:1', 'GND:0'],
      ['R1:1', 'R2:0'],
      ['R1:1', 'R3:0'],
      ['R3:1', 'GND:0'],
      ['R2:1', 'RL:0'],
      ['RL:1', 'GND:0'],
    ],
  );
  const matrices = representations([
    [400, 0],
    [300, 0],
    [300, 0],
    [500, 0],
  ]);
  for (const analysis of [
    { type: 'dc' },
    { type: 'transient', stop: 0.01, step: 0.0001 },
    { type: 'sweep', componentId: 'V1', parameter: 'dc', start: -5, stop: 5, points: 5 },
    { type: 'ac', start: 10, stop: 1000, points: 5 },
  ]) {
    const reference = engine.simulate(physical, analysis);
    for (const [kind, matrix] of Object.entries(matrices)) {
      const document = box(parameters(kind, matrix), analysis, source);
      const saved = JSON.stringify(document);
      const result = engine.simulate(document);
      assert.equal(JSON.stringify(document), saved);
      reference.x.forEach((_, index) => {
        near(get(result, 'V:N1', index), get(reference, 'V:V1', index));
        near(get(result, 'V:N1:P2', index), get(reference, 'V:RL', index));
        near(get(result, 'I:N1', index), get(reference, 'I:R1', index));
        if (analysis.type === 'ac')
          nearPhasor(phasor(result, 'I:N1:P2', index), neg(phasor(reference, 'I:RL', index)));
        else near(get(result, 'I:N1:P2', index), -get(reference, 'I:RL', index));
      });
      if (analysis.type !== 'ac') near(result.frames[0].currents['N1:P2'], get(result, 'I:N1:P2'));
    }
  }
});

test('all five complex matrices give the analytical loaded phasors and inward output current', () => {
  const z = [
    [100, 50],
    [20, 10],
    [30, 15],
    [200, -20],
  ];
  const input = [Math.sqrt(3), 1]; // 2 V at +30 degrees.
  const inputCurrent = div(input, sub(z[0], div(mul(z[1], z[2]), add(z[3], [1000, 0]))));
  const outputCurrent = neg(div(mul(z[2], inputCurrent), add(z[3], [1000, 0])));
  const outputVoltage = mul(neg(outputCurrent), [1000, 0]);
  for (const [kind, matrix] of Object.entries(representations(z))) {
    const result = engine.simulate(
      box(parameters(kind, matrix), { type: 'ac', start: 10, stop: 10000, points: 7 }),
    );
    result.x.forEach((_, index) => {
      nearPhasor(phasor(result, 'V:N1', index), input);
      nearPhasor(phasor(result, 'I:N1', index), inputCurrent);
      nearPhasor(phasor(result, 'I:N1:P2', index), outputCurrent);
      nearPhasor(phasor(result, 'V:N1:P2', index), outputVoltage);
    });
    assert.deepEqual(result.frames, []);
    assert.ok(result.warnings.some((warning) => warning.includes('未定义直流工作点')));
  }
});

test('purely reactive matrices solve without fabricating a DC equivalent', () => {
  const result = engine.simulate(
    box(
      { parameterSet: 'ABCD', m11: 1, m12: 0, i12: 1000, m21: 0, m22: 1 },
      { type: 'ac', start: 100, stop: 1000, points: 2 },
      { dc: 0, acAmplitude: 1, phase: 0 },
    ),
  );
  nearPhasor(phasor(result, 'V:N1:P2'), [0.5, -0.5]);
  nearPhasor(phasor(result, 'I:N1'), [0.0005, -0.0005]);
  nearPhasor(phasor(result, 'I:N1:P2'), [-0.0005, 0.0005]);
});

test('direct matrix stamping supports singular Y and ideal ABCD through connection', () => {
  const series = engine.simulate(
    box({ parameterSet: 'Y', m11: 0.001, m12: -0.001, m21: -0.001, m22: 0.001 }),
  );
  near(get(series, 'V:N1:P2'), 5);
  near(get(series, 'I:N1'), 0.005);
  near(get(series, 'I:N1:P2'), -0.005);
  const through = engine.simulate(box({ parameterSet: 'ABCD', m11: 1, m12: 0, m21: 0, m22: 1 }));
  near(get(through, 'V:N1:P2'), 10);
  near(get(through, 'I:N1'), 0.01);
  near(get(through, 'I:N1:P2'), -0.01);
});

test('twoport port voltages are differential with separate external reference potentials', () => {
  const document = box({ parameterSet: 'ABCD', m11: 2, m12: 0, m21: 0, m22: 0.5 });
  document.components.push({ id: 'Vref', type: 'voltage', params: { dc: 3 } });
  document.wires = document.wires.filter(
    (wire) =>
      !(wire.from.componentId === 'N1' && wire.from.pin === 3) &&
      !(wire.from.componentId === 'RL' && wire.from.pin === 1),
  );
  document.wires.push(
    { id: 'r1', from: { componentId: 'Vref', pin: 0 }, to: { componentId: 'N1', pin: 3 } },
    { id: 'r2', from: { componentId: 'Vref', pin: 0 }, to: { componentId: 'RL', pin: 1 } },
    { id: 'r3', from: { componentId: 'Vref', pin: 1 }, to: { componentId: 'GND', pin: 0 } },
  );
  const result = engine.simulate(document);
  near(get(result, 'V:N1:P2'), 5);
  near(get(result, 'I:N1'), 0.0025);
  const nets = engine.buildNets(document);
  near(result.frames[0].voltages[nets.pinNets['N1:2']], 8);
});

test('dual oscilloscope measures independent differential channels without loading or breaking old scopes', () => {
  const document = box({ parameterSet: 'ABCD', m11: 2, m12: 0, m21: 0, m22: 0.5 });
  const baseline = engine.simulate(document);
  document.components.push(
    { id: 'S1', type: 'oscilloscope2' },
    { id: 'Legacy', type: 'oscilloscope' },
  );
  [
    ['S1:0', 'N1:0'],
    ['S1:1', 'GND:0'],
    ['S1:2', 'N1:2'],
    ['S1:3', 'N1:0'],
    ['Legacy:0', 'N1:2'],
    ['Legacy:1', 'GND:0'],
  ].forEach(([from, to], index) => {
    const endpoint = (value) => ({
      componentId: value.split(':')[0],
      pin: Number(value.split(':')[1]),
    });
    document.wires.push({ id: `scope${index}`, from: endpoint(from), to: endpoint(to) });
  });
  const result = engine.simulate(document);
  near(get(result, 'V:S1'), 10);
  near(get(result, 'V:S1:CH2'), -5);
  near(get(result, 'I:S1'), 0);
  near(get(result, 'V:Legacy'), 5);
  near(get(result, 'I:N1'), get(baseline, 'I:N1'));
  const ac = engine.simulate(document, { type: 'ac', start: 10, stop: 100, points: 2 });
  nearPhasor(phasor(ac, 'V:S1:CH2'), neg(phasor(ac, 'V:Legacy')));
});

test('undefined complex time-domain models and invalid matrix parameters are rejected explicitly', () => {
  const document = box({ i11: 1 });
  for (const analysis of [
    { type: 'dc' },
    { type: 'transient', stop: 1, step: 0.1 },
    { type: 'sweep', componentId: 'V1', parameter: 'dc', start: 0, stop: 1, points: 2 },
  ]) {
    assert.throws(() => engine.simulate(document, analysis), /复数二端口矩阵仅定义交流相量关系/);
  }
  assert.throws(
    () =>
      engine.simulate(box({}), {
        type: 'sweep',
        componentId: 'N1',
        parameter: 'i11',
        start: 0,
        stop: 1,
        points: 2,
      }),
    /不能扫描二端口矩阵虚部/,
  );
  document.components.push({ id: 'D1', type: 'diode' });
  assert.throws(
    () => engine.simulate(document, { type: 'ac', start: 10, stop: 100, points: 2 }),
    /未定义直流偏置/,
  );
  assert.throws(() => engine.validateDocument(box({ parameterSet: 'S' })), /参数类型/);
  assert.throws(() => engine.validateDocument(box({ m11: Infinity })), /有限数值/);
});

test('display settings round trip with strict bounds while legacy documents remain unchanged', () => {
  const document = box({});
  assert.equal(Object.hasOwn(engine.validateDocument(document), 'display'), false);
  document.display = {
    version: 1,
    mode: 'xy',
    ch1: 'V:N1',
    ch2: 'V:N1:P2',
    xyX: 'M:M1',
    xyY: 'V:N1:P2',
    traceIds: ['V:N1', 'V:N1:P2', 'M:M1'],
    phase: true,
    math: [{ id: 'M1', label: '输入差值', expression: 'CH1-CH2', unit: 'V' }],
    ranges: { xMin: -5, xMax: 5, yMin: null, yMax: null },
  };
  assert.deepEqual(engine.validateDocument(document).display, document.display);
  for (const display of [
    { version: 2 },
    { mode: 'html' },
    { onclick: 'evil()' },
    { traceIds: ['V:N1', 'V:N1'] },
    { traceIds: ['I:S1:CH2'] },
    { phase: 'yes' },
    { ch1: '__proto__' },
    { math: [{ id: 'M9', expression: 'CH1' }] },
    { math: [{ id: 'M1', expression: 'x'.repeat(161) }] },
    { math: [{ id: 'M1', expression: 'CH1', unit: 'x'.repeat(13) }] },
    { ranges: { xMin: 10, xMax: 5 } },
    { ranges: { yMax: Infinity } },
    JSON.parse('{"__proto__":{"polluted":true}}'),
  ])
    assert.throws(() => engine.normalizeDisplay(display));
  assert.equal(engine.validTraceId('V:N1:P2', document.components), true);
  assert.equal(engine.validTraceId('V:N1:CH2', document.components), false);
  assert.equal(engine.validTraceId('V:V1:P2', document.components), false);
  assert.equal(engine.validTraceId('M:M1'), true);
  assert.equal(engine.traceComponentId('I:N1:P2'), 'N1');
  assert.equal(engine.traceComponentId('M:M1'), null);
});
