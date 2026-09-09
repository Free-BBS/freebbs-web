const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const engine = require('../public/circuit-engine');

function circuit(parts, links, analysis = { type: 'dc' }) {
  const endpoint = (pinReference) => {
    const [componentId, pin] = pinReference.split(':');
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
function value(result, id, index = 0) {
  return result.traces.find((trace) => trace.id === id).values.at(index);
}
function near(actual, expected, tolerance = 1e-8) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ${expected} ± ${tolerance}; received ${actual}`,
  );
}
function series(type, params = {}, sourceParams = { dc: 5 }, resistance = 1000) {
  return circuit(
    [
      ['V1', 'voltage', sourceParams],
      ['R1', 'resistor', { resistance }],
      ['X1', type, params],
      ['GND', 'ground'],
    ],
    [
      ['V1:0', 'R1:0'],
      ['R1:1', 'X1:0'],
      ['X1:1', 'GND:0'],
      ['V1:1', 'GND:0'],
    ],
  );
}

test('resistor divider obeys KCL; ideal voltage and current meters do not load the circuit', () => {
  const document = circuit(
    [
      ['V1', 'voltage', { dc: 10 }],
      ['A1', 'ammeter'],
      ['R1', 'resistor', { resistance: 1000 }],
      ['R2', 'resistor', { resistance: 1000 }],
      ['M1', 'voltmeter'],
      ['S1', 'oscilloscope'],
      ['GND', 'ground'],
    ],
    [
      ['V1:0', 'A1:0'],
      ['A1:1', 'R1:0'],
      ['R1:1', 'R2:0'],
      ['R2:1', 'GND:0'],
      ['V1:1', 'GND:0'],
      ['M1:0', 'R2:0'],
      ['M1:1', 'GND:0'],
      ['S1:0', 'R2:0'],
      ['S1:1', 'GND:0'],
    ],
  );
  const result = engine.simulate(document);
  near(value(result, 'V:R2'), 5);
  near(value(result, 'V:M1'), 5);
  near(value(result, 'V:S1'), 5);
  near(value(result, 'I:A1'), 0.005);
  near(value(result, 'I:V1'), -0.005);
  near(value(result, 'I:M1'), 0);
  near(value(result, 'I:S1'), 0);
  const nets = engine.buildNets(document);
  near(result.frames[0].voltages[nets.pinNets['R2:0']], 5);
  assert.equal(nets.pinNets['V1:1'], '0');
});

test('junction wire splits preserve circuit values and allow branches without grounding or extra traces', () => {
  const document = series('resistor', { resistance: 1000 });
  const baseline = engine.simulate(document);
  document.components.push({ id: 'J1', type: 'junction' });
  const wire = document.wires[1];
  const end = wire.to;
  wire.to = { componentId: 'J1', pin: 0 };
  document.wires.push({ id: 'wSplit', from: { componentId: 'J1', pin: 0 }, to: end });
  const result = engine.simulate(document);
  assert.deepEqual(result.traces, baseline.traces);
  assert.equal(Object.hasOwn(result.frames[0].currents, 'J1'), false);
  const nets = engine.buildNets(document);
  assert.equal(nets.pinNets['J1:0'], nets.pinNets['R1:1']);
  assert.equal(nets.pinNets['J1:0'], nets.pinNets['X1:0']);
  assert.notEqual(nets.pinNets['J1:0'], '0');
  document.components.push({ id: 'Rload', type: 'resistor', params: { resistance: 1000 } });
  document.wires.push(
    { id: 'wBranch', from: { componentId: 'J1', pin: 0 }, to: { componentId: 'Rload', pin: 0 } },
    { id: 'wReturn', from: { componentId: 'Rload', pin: 1 }, to: { componentId: 'GND', pin: 0 } },
  );
  near(value(engine.simulate(document), 'V:Rload'), 5 / 3);
});

test('orphan junctions and junction-only wire chains do not add floating electrical unknowns', () => {
  const document = series('resistor', { resistance: 1000 });
  const baseline = engine.simulate(document);
  document.components.push({ id: 'J1', type: 'junction' });
  assert.deepEqual(engine.simulate(document).traces, baseline.traces);
  document.components.push({ id: 'J2', type: 'junction' }, { id: 'J3', type: 'junction' });
  document.wires.push(
    { id: 'wOrphan1', from: { componentId: 'J1', pin: 0 }, to: { componentId: 'J2', pin: 0 } },
    { id: 'wOrphan2', from: { componentId: 'J2', pin: 0 }, to: { componentId: 'J3', pin: 0 } },
  );
  assert.deepEqual(engine.simulate(document).traces, baseline.traces);
  // A real floating component must still contribute its pins to the solve.
  document.components.push({ id: 'Rfloating', type: 'resistor' });
  document.wires.push({
    id: 'wFloating',
    from: { componentId: 'Rfloating', pin: 0 },
    to: { componentId: 'J3', pin: 0 },
  });
  assert.throws(() => engine.simulate(document), /浮空/);
  document.wires.pop();
  assert.throws(() => engine.simulate(document), /浮空/);
});

test('RC step uses zero initial capacitor voltage and converges to analytical exponential', () => {
  const document = series('capacitor', { capacitance: 1e-6 });
  const result = engine.simulate(document, {
    type: 'transient',
    initial: 'zero',
    stop: 0.005,
    step: 0.00001,
  });
  near(value(result, 'V:X1'), 0);
  near(value(result, 'I:X1'), 0.005);
  near(value(result, 'V:X1', 100), 5 * (1 - Math.exp(-1)), 0.01);
  near(value(result, 'V:X1', -1), 5 * (1 - Math.exp(-5)), 0.001);
  assert.equal(result.x.length, 501);
  const operating = engine.simulate(document, {
    type: 'transient',
    initial: 'operating-point',
    stop: 0.001,
    step: 0.00001,
  });
  near(value(operating, 'V:X1'), 5);
  near(value(operating, 'V:X1', -1), 5);
  const shorterFinal = engine.simulate(document, {
    type: 'transient',
    stop: 0.00105,
    step: 0.0001,
  });
  near(shorterFinal.x.at(-1), 0.00105, 1e-15);
});

test('RL current step obeys V/R (1-exp(-Rt/L)) and keeps zero initial inductor current', () => {
  const document = series('inductor', { inductance: 1 }, { dc: 5 }, 1000);
  const result = engine.simulate(document, {
    type: 'transient',
    initial: 'zero',
    stop: 0.005,
    step: 0.00001,
  });
  near(value(result, 'I:X1'), 0);
  near(value(result, 'I:X1', 100), 0.005 * (1 - Math.exp(-1)), 1e-5);
  near(value(result, 'I:X1', -1), 0.005 * (1 - Math.exp(-5)), 1e-6);
  near(value(engine.simulate(document), 'V:X1'), 0);
});

test('RLC transient shows the calculated underdamped response rather than a fabricated waveform', () => {
  const document = circuit(
    [
      ['V1', 'voltage', { dc: 1 }],
      ['R1', 'resistor', { resistance: 10 }],
      ['L1', 'inductor', { inductance: 0.01 }],
      ['C1', 'capacitor', { capacitance: 1e-6 }],
      ['GND', 'ground'],
    ],
    [
      ['V1:0', 'R1:0'],
      ['R1:1', 'L1:0'],
      ['L1:1', 'C1:0'],
      ['C1:1', 'GND:0'],
      ['V1:1', 'GND:0'],
    ],
  );
  const result = engine.simulate(document, {
    type: 'transient',
    initial: 'zero',
    stop: 0.001,
    step: 0.000001,
  });
  const alpha = 500;
  const omega = Math.sqrt(1e8 - alpha ** 2);
  for (const index of [100, 300, 600, 1000]) {
    const time = result.x[index];
    const expected =
      1 -
      Math.exp(-alpha * time) * (Math.cos(omega * time) + (alpha / omega) * Math.sin(omega * time));
    near(value(result, 'V:C1', index), expected, 0.03);
  }
  assert.ok(Math.max(...result.traces.find((trace) => trace.id === 'V:C1').values) > 1.7);
});

test('AC RC corner matches magnitude/phase and RLC resonance matches complex impedance', () => {
  const corner = 1 / (2 * Math.PI * 1000 * 1e-6);
  const rc = engine.simulate(series('capacitor', { capacitance: 1e-6 }), {
    type: 'ac',
    start: corner,
    stop: corner * 2,
    points: 2,
    scale: 'linear',
  });
  near(value(rc, 'V:X1'), Math.SQRT1_2);
  near(rc.traces.find((trace) => trace.id === 'V:X1').phase[0], -45);
  assert.equal(rc.frames.length, 1);
  near(rc.frames[0].currents.V1, 0);
  const document = circuit(
    [
      ['V1', 'voltage', { dc: 0, acAmplitude: 1 }],
      ['R1', 'resistor', { resistance: 10 }],
      ['L1', 'inductor', { inductance: 0.01 }],
      ['C1', 'capacitor', { capacitance: 1e-6 }],
      ['GND', 'ground'],
    ],
    [
      ['V1:0', 'R1:0'],
      ['R1:1', 'L1:0'],
      ['L1:1', 'C1:0'],
      ['C1:1', 'GND:0'],
      ['V1:1', 'GND:0'],
    ],
  );
  const resonance = 1 / (2 * Math.PI * Math.sqrt(0.01 * 1e-6));
  const result = engine.simulate(document, {
    type: 'ac',
    start: resonance,
    stop: resonance * 2,
    points: 2,
  });
  near(value(result, 'V:R1'), 1);
  near(value(result, 'I:R1'), 0.1);
  near(value(result, 'I:R1', 1), 1 / Math.hypot(10, 150));
  near(result.traces.find((trace) => trace.id === 'V:R1').phase[0], 0);
});

test('DC source and resistor parameter sweeps preserve input document and give analytical points', () => {
  const document = series('resistor', { resistance: 1000 });
  const original = JSON.stringify(document);
  const source = engine.simulate(document, {
    type: 'sweep',
    componentId: 'V1',
    parameter: 'dc',
    start: -5,
    stop: 5,
    points: 11,
  });
  source.x.forEach((voltage, index) => near(value(source, 'V:X1', index), voltage / 2));
  const resistance = engine.simulate(document, {
    type: 'sweep',
    componentId: 'R1',
    parameter: 'resistance',
    start: 1000,
    stop: 3000,
    points: 3,
  });
  resistance.x.forEach((ohms, index) =>
    near(value(resistance, 'V:X1', index), (5 * 1000) / (1000 + ohms)),
  );
  assert.equal(JSON.stringify(document), original);
});

test('Shockley diode satisfies its equation and series KCL in forward and reverse bias', () => {
  const document = series('diode', { is: 1e-12, n: 1, thermalVoltage: 0.02585 });
  const result = engine.simulate(document);
  const voltage = value(result, 'V:X1');
  const current = value(result, 'I:X1');
  near(current, (5 - voltage) / 1000, 1e-10);
  near(current, 1e-12 * Math.expm1(voltage / 0.02585), 1e-10);
  near(voltage, 0.57414733919, 1e-8);
  const reverse = engine.simulate(document, {
    type: 'sweep',
    componentId: 'V1',
    parameter: 'dc',
    start: -5,
    stop: 5,
    points: 21,
  });
  near(value(reverse, 'I:X1'), -1e-12, 1e-13);
  const ac = engine.simulate(document, { type: 'ac', start: 10, stop: 100, points: 2 });
  const rd = 0.02585 / (current + 1e-12);
  near(value(ac, 'I:X1'), 1 / (1000 + rd), 1e-9);
});

function bjtCircuit(polarity = 'npn', beta = 100) {
  const sign = polarity === 'npn' ? 1 : -1;
  return circuit(
    [
      ['VC', 'voltage', { dc: sign * 5, acAmplitude: 0 }],
      ['IB', 'current', { dc: -sign * 1e-5, acAmplitude: 1e-6 }],
      ['Q1', 'bjt', { polarity, beta }],
      ['GND', 'ground'],
    ],
    [
      ['VC:0', 'Q1:0'],
      ['VC:1', 'GND:0'],
      ['IB:0', 'Q1:1'],
      ['IB:1', 'GND:0'],
      ['Q1:2', 'GND:0'],
    ],
  );
}
test('NPN/PNP Ebers–Moll models follow beta, including beta sweeps and small-signal AC', () => {
  for (const polarity of ['npn', 'pnp']) {
    const sign = polarity === 'npn' ? 1 : -1;
    const document = bjtCircuit(polarity);
    const result = engine.simulate(document);
    near(value(result, 'I:Q1'), sign * 0.001, 1e-8);
    const sweep = engine.simulate(document, {
      type: 'sweep',
      componentId: 'Q1',
      parameter: 'beta',
      start: 50,
      stop: 200,
      points: 4,
    });
    sweep.x.forEach((beta, index) => near(value(sweep, 'I:Q1', index), sign * beta * 1e-5, 1e-8));
    const ac = engine.simulate(document, { type: 'ac', start: 10, stop: 1000, points: 3 });
    near(value(ac, 'I:Q1'), 1e-4, 1e-9);
  }
});

function mosCircuit(polarity = 'n', drain = 5) {
  const sign = polarity === 'n' ? 1 : -1;
  return circuit(
    [
      ['VD', 'voltage', { dc: sign * drain, acAmplitude: 0 }],
      ['VG', 'voltage', { dc: sign * 2, acAmplitude: 1 }],
      ['M1', 'mosfet', { polarity, kp: 1e-4, w: 1e-5, l: 1e-6, vto: 1, lambda: 0 }],
      ['GND', 'ground'],
    ],
    [
      ['VD:0', 'M1:0'],
      ['VD:1', 'GND:0'],
      ['VG:0', 'M1:1'],
      ['VG:1', 'GND:0'],
      ['M1:2', 'GND:0'],
    ],
  );
}
test('N/P MOS square-law triode/saturation, W/L sweeps and AC gm match formulas', () => {
  for (const polarity of ['n', 'p']) {
    const sign = polarity === 'n' ? 1 : -1;
    const document = mosCircuit(polarity);
    near(value(engine.simulate(document), 'I:M1'), sign * 0.0005, 1e-10);
    near(value(engine.simulate(mosCircuit(polarity, 0.2)), 'I:M1'), sign * 0.00018, 1e-10);
    const width = engine.simulate(document, {
      type: 'sweep',
      componentId: 'M1',
      parameter: 'w',
      start: 1e-6,
      stop: 1e-5,
      points: 5,
    });
    width.x.forEach((w, index) =>
      near(value(width, 'I:M1', index), (sign * 0.5 * 1e-4 * w) / 1e-6, 1e-10),
    );
    const length = engine.simulate(document, {
      type: 'sweep',
      componentId: 'M1',
      parameter: 'l',
      start: 1e-6,
      stop: 1e-5,
      points: 5,
    });
    length.x.forEach((l, index) =>
      near(value(length, 'I:M1', index), (sign * 0.5 * 1e-4 * 1e-5) / l, 1e-10),
    );
    const ac = engine.simulate(document, { type: 'ac', start: 10, stop: 1000, points: 3 });
    near(value(ac, 'I:M1'), 0.001, 1e-9);
  }
});

test('all four controlled sources respect control polarity and current reference direction', () => {
  for (const [type, gain, expected] of [
    ['vcvs', 3, 6],
    ['vccs', 0.001, -2],
    ['ccvs', 1000, -2],
    ['cccs', 2, 4],
  ]) {
    const params = { gain, ...(['ccvs', 'cccs'].includes(type) ? { control: 'V1' } : {}) };
    const links = [
      ['V1:0', 'RS:0'],
      ['V1:1', 'GND:0'],
      ['RS:1', 'GND:0'],
      ['E1:0', 'RL:0'],
      ['E1:1', 'GND:0'],
      ['RL:1', 'GND:0'],
    ];
    if (['vcvs', 'vccs'].includes(type)) links.push(['E1:2', 'V1:0'], ['E1:3', 'GND:0']);
    const document = circuit(
      [
        ['V1', 'voltage', { dc: 2, acAmplitude: 2 }],
        ['RS', 'resistor'],
        ['E1', type, params],
        ['RL', 'resistor'],
        ['GND', 'ground'],
      ],
      links,
    );
    near(value(engine.simulate(document), 'V:RL'), expected);
    const ac = engine.simulate(document, { type: 'ac', start: 1, stop: 10, points: 2 });
    near(value(ac, 'V:RL'), Math.abs(expected));
  }
});

test('finite-gain opamp follower and rail clipping have calculated output and load current', () => {
  const follower = circuit(
    [
      ['V1', 'voltage', { dc: 1 }],
      ['U1', 'opamp'],
      ['RL', 'resistor'],
      ['GND', 'ground'],
    ],
    [
      ['V1:0', 'U1:0'],
      ['V1:1', 'GND:0'],
      ['U1:1', 'U1:2'],
      ['U1:2', 'RL:0'],
      ['RL:1', 'GND:0'],
    ],
  );
  const result = engine.simulate(follower);
  near(value(result, 'V:U1'), 100000 / 100001);
  near(value(result, 'I:U1'), -100 / 100001);
  const openLoop = structuredClone(follower);
  openLoop.wires.find((wire) => wire.from.componentId === 'U1' && wire.from.pin === 1).to = {
    componentId: 'GND',
    pin: 0,
  };
  near(value(engine.simulate(openLoop), 'V:U1'), 12);
  const ac = engine.simulate(follower, { type: 'ac', start: 1, stop: 1000, points: 3 });
  near(value(ac, 'V:U1'), 100000 / 100001);
});

test('safe cubic I–V formula supports k sweep, standard functions and mathematical precedence', () => {
  const document = circuit(
    [
      ['I1', 'current', { dc: -0.001 }],
      ['N1', 'nonlinear'],
      ['GND', 'ground'],
    ],
    [
      ['I1:0', 'N1:0'],
      ['I1:1', 'GND:0'],
      ['N1:1', 'GND:0'],
    ],
  );
  near(value(engine.simulate(document), 'V:N1'), 1, 1e-8);
  const sweep = engine.simulate(document, {
    type: 'sweep',
    componentId: 'N1',
    parameter: 'k',
    start: 0.001,
    stop: 0.008,
    points: 8,
  });
  sweep.x.forEach((k, index) => near(value(sweep, 'V:N1', index), Math.cbrt(0.001 / k), 1e-7));
  const math = circuit(
    [
      ['V1', 'voltage', { dc: 2 }],
      ['N1', 'nonlinear', { expression: 'i=k*(-u^2+pow(u,3)+sin(pi/2)+sqrt(4))', k: 0.001 }],
      ['GND', 'ground'],
    ],
    [
      ['V1:0', 'N1:0'],
      ['V1:1', 'GND:0'],
      ['N1:1', 'GND:0'],
    ],
  );
  near(value(engine.simulate(math), 'I:N1'), 0.007);
});

test('sine/pulse source transient values honor DC offset, phase, delay and duty', () => {
  const sine = series(
    'resistor',
    { resistance: 1000 },
    { dc: 1, waveform: 'sine', amplitude: 2, frequency: 100, phase: 90, delay: 0.001 },
  );
  const result = engine.simulate(sine, {
    type: 'transient',
    stop: 0.003,
    step: 0.001,
    initial: 'zero',
  });
  near(value(result, 'V:V1'), 1);
  near(value(result, 'V:V1', 1), 3);
  near(value(result, 'V:V1', 2), 1 + 2 * Math.cos(0.2 * Math.PI));
  sine.components[0].params = {
    dc: 0,
    waveform: 'pulse',
    amplitude: 5,
    frequency: 100,
    duty: 0.25,
    delay: 0.001,
  };
  const pulse = engine.simulate(sine, { type: 'transient', stop: 0.005, step: 0.001 });
  assert.deepEqual(pulse.traces.find((trace) => trace.id === 'V:V1').values, [0, 5, 5, 5, 0, 0]);
});

test('voltage and current sine sources match their analytic waveform at every transient sample', () => {
  for (const type of ['voltage', 'current']) {
    const params = {
      dc: type === 'voltage' ? 1 : 0.001,
      waveform: 'sine',
      amplitude: type === 'voltage' ? 3 : 0.003,
      frequency: 250,
      phase: 45,
      delay: 0.0002,
    };
    const document = circuit(
      [
        ['S1', type, params],
        ['R1', 'resistor', { resistance: 1000 }],
        ['G1', 'ground'],
      ],
      [
        ['S1:0', 'R1:0'],
        ['S1:1', 'G1:0'],
        ['R1:1', 'G1:0'],
      ],
      { type: 'transient', stop: 0.002, step: 0.00001 },
    );
    const result = engine.simulate(document);
    result.x.forEach((time, index) => {
      const expected =
        time < params.delay
          ? params.dc
          : params.dc +
            params.amplitude *
              Math.sin(
                2 * Math.PI * (params.frequency * (time - params.delay) + params.phase / 360),
              );
      near(value(result, `${type === 'voltage' ? 'V' : 'I'}:S1`, index), expected, 1e-10);
      near(value(result, 'V:R1', index), type === 'voltage' ? expected : -1000 * expected, 1e-9);
    });
  }
});

test('source advice detects aliasing and preserves the transient window while refining its step', () => {
  const document = series(
    'resistor',
    {},
    { dc: 0, waveform: 'sine', amplitude: 12, frequency: 10000 },
  );
  document.analysis = { type: 'transient', stop: 0.1, step: 0.0001, initial: 'operating-point' };
  const original = JSON.stringify(document);
  const coarse = engine.simulate(document);
  assert.ok(
    Math.max(...coarse.traces.find((trace) => trace.id === 'V:V1').values.map(Math.abs)) < 1e-8,
  );
  assert.ok(coarse.warnings.some((warning) => /每周期仅 1 个采样点.*混叠/.test(warning)));
  const advice = engine.sourceAnalysisAdvice(document);
  assert.deepEqual(advice.suggestedAnalysis, {
    type: 'transient',
    stop: 0.1,
    step: 0.000001,
    initial: 'operating-point',
  });
  assert.equal(JSON.stringify(document), original);
  assert.deepEqual(engine.sourceAnalysisAdvice(document, advice.suggestedAnalysis), {
    warnings: [],
    suggestedAnalysis: advice.suggestedAnalysis,
  });
});

test('source advice explains DC and sweep semantics and samples narrow pulses densely', () => {
  const document = series(
    'resistor',
    {},
    { dc: 0, waveform: 'sine', amplitude: 1, frequency: 1000 },
  );
  const dc = engine.sourceAnalysisAdvice(document);
  assert.ok(dc.warnings.some((warning) => /直流工作点.*直流偏置/.test(warning)));
  assert.deepEqual(dc.suggestedAnalysis, {
    type: 'transient',
    stop: 0.01,
    step: 0.00001,
    initial: 'zero',
  });
  const sweep = engine.sourceAnalysisAdvice(document, {
    type: 'sweep',
    componentId: 'R1',
    parameter: 'resistance',
    start: 100,
    stop: 1000,
    points: 3,
  });
  assert.ok(sweep.warnings.some((warning) => /直流扫描/.test(warning)));
  document.components[0].params.waveform = 'pulse';
  document.components[0].params.duty = 0.001;
  const pulse = engine.sourceAnalysisAdvice(document, {
    type: 'transient',
    stop: 0.001,
    step: 0.00001,
  });
  near(pulse.suggestedAnalysis.step, 1e-7, 1e-20);
  assert.ok(pulse.warnings.some((warning) => /漏掉脉冲/.test(warning)));
});

test('source advice includes delayed sources, identifies slow sources and refuses impossible windows', () => {
  const document = series(
    'resistor',
    {},
    { dc: 0, waveform: 'sine', amplitude: 1, frequency: 10000 },
  );
  document.components.push({
    id: 'I1',
    type: 'current',
    params: { waveform: 'sine', frequency: 10, delay: 0.002 },
  });
  let advice = engine.sourceAnalysisAdvice(document);
  near(advice.suggestedAnalysis.stop, 0.003, 1e-15);
  assert.ok(advice.warnings.some((warning) => /I1.*较慢波形.*不足一个完整周期/.test(warning)));
  document.components[0].params.delay = 1;
  advice = engine.sourceAnalysisAdvice(document, { type: 'transient', stop: 0.01, step: 0.00001 });
  assert.equal(advice.suggestedAnalysis, null);
  assert.ok(advice.warnings.some((warning) => /启动延迟不小于/.test(warning)));
  assert.ok(advice.warnings.some((warning) => /无法在 100001 个采样点内兼顾/.test(warning)));
  document.components[0].params.amplitude = 0;
  document.components.at(-1).params.amplitude = 0;
  assert.deepEqual(engine.sourceAnalysisAdvice(document), {
    warnings: [],
    suggestedAnalysis: null,
  });
});

test('source advice can relax an unnecessarily tiny step to include delayed excitation', () => {
  const document = series('resistor', {}, { dc: 0, waveform: 'sine', frequency: 1000, delay: 0.1 });
  const advice = engine.sourceAnalysisAdvice(document, {
    type: 'transient',
    stop: 0.00001,
    step: 1e-9,
  });
  near(advice.suggestedAnalysis.step, 0.00001);
  near(advice.suggestedAnalysis.stop, 0.11);
});

test('playback limits skipping to twenty displayed frames per source period', () => {
  const document = series('resistor', {}, { dc: 0, waveform: 'sine', frequency: 10000 });
  const result = {
    analysis: { type: 'transient', stop: 0.1, step: 1e-6 },
    x: new Array(100001),
  };
  assert.equal(engine.playbackFrameStep(document, result), 5);
  assert.equal(engine.playbackFrameStep(document, result, { frameInterval: 1000 }), 5);
  assert.equal(engine.playbackFrameStep(document, result, { frameInterval: 0 }), 0);
  result.x.length = 101;
  near(engine.playbackFrameStep(document, result), (101 * 50) / 8000);
  result.analysis.step = 0.0001;
  assert.equal(engine.playbackFrameStep(document, result, { frameInterval: 1000 }), 1);
  document.components[0].params.amplitude = 0;
  near(engine.playbackFrameStep(document, result, { frameInterval: 1000 }), 101 / 8);
});

test('duty bounds apply only to pulse while every waveform still requires a finite numeric duty', () => {
  const document = series('resistor', {}, { waveform: 'sine', duty: 50 });
  assert.equal(engine.validateDocument(document).components[0].params.duty, 50);
  document.components[0].params.waveform = 'dc';
  assert.equal(engine.validateDocument(document).components[0].params.duty, 50);
  document.components[0].params.waveform = 'pulse';
  for (const duty of [0, 1, 50, -1]) {
    document.components[0].params.duty = duty;
    assert.throws(() => engine.validateDocument(document), /duty/);
  }
  for (const waveform of ['sine', 'dc', 'pulse']) {
    document.components[0].params.waveform = waveform;
    for (const duty of [NaN, Infinity, '0.5']) {
      document.components[0].params.duty = duty;
      assert.throws(() => engine.validateDocument(document), /duty/);
    }
  }
  delete document.components[0].params.duty;
  assert.equal(engine.validateDocument(document).components[0].params.duty, 0.5);
});

test('transient supports 20000 and 100001 points while scans keep their separate limit', () => {
  assert.deepEqual(engine.limits, { maxTransientPoints: 100001, maxSweepPoints: 2000 });
  const document = series('resistor');
  for (const points of [20000, 100001]) {
    const result = engine.simulate(document, {
      type: 'transient',
      stop: (points - 1) * 1e-6,
      step: 1e-6,
    });
    assert.equal(result.x.length, points);
    near(value(result, 'V:X1', -1), 2.5);
  }
  assert.throws(
    () => engine.simulate(document, { type: 'transient', stop: 0.100001, step: 1e-6 }),
    /100001/,
  );
  assert.throws(
    () => engine.simulate(document, { type: 'ac', start: 1, stop: 1000, points: 2001 }),
    /2000/,
  );
});

test('result memory budget rejects many parallel channels before allocation without changing document limits', () => {
  const parts = [
    ['V1', 'voltage'],
    ['G1', 'ground'],
  ];
  const links = [['V1:1', 'G1:0']];
  for (let index = 0; index < 78; index += 1) {
    parts.push([`R${index}`, 'resistor']);
    links.push(['V1:0', `R${index}:0`], [`R${index}:1`, 'G1:0']);
  }
  const document = circuit(parts, links, { type: 'transient', stop: 0.1, step: 1e-6 });
  assert.equal(engine.validateDocument(document).components.length, 80);
  assert.throws(() => engine.simulate(document), /结果数据量.*减少采样点或元件数量/);
  const ac = engine.simulate(document, { type: 'ac', start: 1, stop: 10000, points: 2000 });
  assert.equal(ac.x.length, 2000);
  assert.equal(ac.frames.length, 1);
});

test('adequately sampled bridge rectification recovers the full-wave output at 100001 points', () => {
  const document = circuit(
    [
      ['Vin', 'voltage', { dc: 0, waveform: 'sine', amplitude: 12, frequency: 10000 }],
      ['Rs', 'resistor', { resistance: 50 }],
      ['RL', 'resistor', { resistance: 50 }],
      ['Dap', 'diode'],
      ['Dbp', 'diode'],
      ['Dna', 'diode'],
      ['Dnb', 'diode'],
      ['G1', 'ground'],
    ],
    [
      ['Vin:0', 'Rs:0'],
      ['Rs:1', 'Dap:0'],
      ['Rs:1', 'Dna:1'],
      ['Vin:1', 'Dbp:0'],
      ['Vin:1', 'Dnb:1'],
      ['Vin:1', 'G1:0'],
      ['Dap:1', 'Dbp:1'],
      ['Dap:1', 'RL:0'],
      ['Dna:0', 'Dnb:0'],
      ['Dna:0', 'RL:1'],
    ],
    { type: 'transient', stop: 0.1, step: 0.0001 },
  );
  const coarse = engine.simulate(document);
  assert.ok(
    Math.max(...coarse.traces.find((trace) => trace.id === 'V:RL').values.map(Math.abs)) < 1e-8,
  );
  const result = engine.simulate(document, engine.sourceAnalysisAdvice(document).suggestedAnalysis);
  assert.equal(result.x.length, 100001);
  near(value(result, 'V:Vin', 25), 12);
  near(value(result, 'V:Vin', 75), -12);
  // Independent scalar Shockley solution: |Vin| = I(Rs + RL) + 2 Vt ln(1 + I/Is).
  let low = 0;
  let high = 0.12;
  for (let index = 0; index < 60; index += 1) {
    const current = (low + high) / 2;
    if (100 * current + 2 * 0.02585 * Math.log1p(current / 1e-12) < 12) low = current;
    else high = current;
  }
  const expected = (50 * (low + high)) / 2;
  near(value(result, 'V:RL', 25), expected, 1e-7);
  near(value(result, 'V:RL', 75), expected, 1e-7);
  near(value(result, 'V:RL', 99975), expected, 1e-7);
  assert.ok(!result.warnings.some((warning) => /混叠/.test(warning)));
});

test('expression code injection, malformed AST, nonfinite values and unsafe identifiers are rejected', () => {
  for (const expression of [
    'globalThis.alert(1)',
    'u.constructor.constructor("return 1")()',
    'i=fetch("https://example.com")',
    'i=u;process.exit()',
    'i=u[0]',
    'i=(()=>1)()',
    'i=__proto__',
    'i=constructor(1)',
    'i=u+',
  ]) {
    const document = series('nonlinear', { expression });
    assert.throws(() => engine.validateDocument(document), /公式/);
  }
  for (const [key, valueToSet] of [
    ['id', ['R1']],
    ['id', 'R1\n'],
    ['type', ['resistor']],
  ]) {
    const document = series('resistor');
    document.components[1][key] = valueToSet;
    assert.throws(() => engine.validateDocument(document));
  }
  const duplicate = series('resistor');
  duplicate.components[1].id = 'V1';
  assert.throws(() => engine.validateDocument(duplicate), /ID/);
  const badWire = series('resistor');
  badWire.wires[0].id = ['w0'];
  assert.throws(() => engine.validateDocument(badWire), /ID/);
  const badPin = series('resistor');
  badPin.wires[0].to.pin = 2;
  assert.throws(() => engine.validateDocument(badPin), /引脚/);
  assert.throws(() => engine.validateDocument(series('resistor', { resistance: 0 })), /大于 0/);
  assert.throws(
    () => engine.validateDocument(series('resistor', { resistance: Infinity })),
    /有限/,
  );
  assert.throws(() => engine.validateDocument(series('resistor', { resistance: -100 })), /大于 0/);
  assert.throws(() => engine.simulate(series('nonlinear', { expression: 'i=1/0' })), /公式|迭代/);
});

test('unfinished drafts can be saved but floating/inconsistent circuits cannot produce fake zero results', () => {
  const empty = { version: 1, components: [], wires: [], analysis: { type: 'dc' } };
  assert.deepEqual(engine.validateDocument(empty), empty);
  assert.throws(() => engine.simulate(empty), /参考地/);
  const floating = circuit(
    [
      ['R1', 'resistor'],
      ['GND', 'ground'],
    ],
    [],
  );
  assert.throws(() => engine.simulate(floating), /奇异|浮空/);
  const conflict = circuit(
    [
      ['V1', 'voltage', { dc: 1 }],
      ['V2', 'voltage', { dc: 2 }],
      ['GND', 'ground'],
    ],
    [
      ['V1:0', 'V2:0'],
      ['V1:1', 'GND:0'],
      ['V2:1', 'GND:0'],
    ],
  );
  assert.throws(() => engine.simulate(conflict), /奇异|冲突/);
  const noControl = circuit(
    [
      ['E1', 'ccvs'],
      ['R1', 'resistor'],
      ['GND', 'ground'],
    ],
    [
      ['E1:0', 'R1:0'],
      ['E1:1', 'GND:0'],
      ['R1:1', 'GND:0'],
    ],
  );
  assert.doesNotThrow(() => engine.validateDocument(noControl));
  assert.throws(() => engine.simulate(noControl), /控制电流/);
  const disconnectedGate = mosCircuit();
  disconnectedGate.wires = disconnectedGate.wires.filter(
    (wire) => wire.to.componentId !== 'M1' || wire.to.pin !== 1,
  );
  assert.throws(() => engine.simulate(disconnectedGate), /浮空|奇异/);
});

test('analysis limits reject excessive work, invalid sweeps and invalid frequency ranges', () => {
  const document = series('resistor');
  assert.throws(
    () => engine.simulate(document, { type: 'transient', stop: 1, step: 1e-9 }),
    /100001/,
  );
  assert.throws(
    () => engine.simulate(document, { type: 'ac', start: 0, stop: 100, points: 10 }),
    /频率/,
  );
  assert.throws(
    () =>
      engine.simulate(document, {
        type: 'sweep',
        componentId: 'V1',
        parameter: 'waveform',
        start: 0,
        stop: 1,
        points: 2,
      }),
    /数值参数/,
  );
  assert.throws(
    () =>
      engine.simulate(document, {
        type: 'sweep',
        componentId: 'R1',
        parameter: 'resistance',
        start: -1,
        stop: 100,
        points: 2,
      }),
    /大于 0/,
  );
  assert.throws(
    () => engine.simulate(document, { type: 'ac', start: 1, stop: 100, points: 2001 }),
    /2000/,
  );
});

test('worker/browser export executes the same engine and returns structured errors', () => {
  const engineSource = fs.readFileSync(path.join(__dirname, '../public/circuit-engine.js'), 'utf8');
  const workerSource = fs.readFileSync(path.join(__dirname, '../public/circuit-worker.js'), 'utf8');
  const messages = [];
  const context = vm.createContext({
    postMessage: (message) => messages.push(message),
    importScripts: (url) => {
      assert.equal(url, '/circuit-engine.js');
      vm.runInContext(engineSource, context);
    },
  });
  vm.runInContext(workerSource, context);
  context.onmessage({ data: { id: 'valid', document: series('resistor') } });
  assert.equal(messages[0].id, 'valid');
  near(value(messages[0].result, 'V:X1'), 2.5);
  context.onmessage({ data: { id: 'bad', document: {} } });
  assert.equal(messages[1].id, 'bad');
  assert.match(messages[1].error, /version/);
  assert.equal(messages[1].result, undefined);
});

test('Newton checks voltage correction as well as residual in high-impedance circuits', () => {
  const document = circuit(
    [
      ['I1', 'current', { dc: -1e-11, acAmplitude: 0 }],
      ['R1', 'resistor', { resistance: 1e12 }],
      ['GND', 'ground'],
    ],
    [
      ['I1:0', 'R1:0'],
      ['I1:1', 'GND:0'],
      ['R1:1', 'GND:0'],
    ],
  );
  const result = engine.simulate(document);
  near(value(result, 'V:R1'), 10, 1e-10);
  near(value(result, 'I:R1'), 1e-11, 1e-23);
  const sweep = engine.simulate(document, {
    type: 'sweep',
    componentId: 'I1',
    parameter: 'dc',
    start: -1e-11,
    stop: -2e-11,
    points: 3,
  });
  sweep.x.forEach((current, index) => near(value(sweep, 'V:R1', index), -current * 1e12, 1e-10));
  const transient = engine.simulate(document, { type: 'transient', stop: 0.001, step: 0.0001 });
  near(value(transient, 'V:R1'), 10, 1e-10);
  near(value(transient, 'V:R1', -1), 10, 1e-10);
});

test('Shockley uses the true exponential above exponent 100 and avoids intermediate exp overflow', () => {
  const directDiode = (voltage, saturationCurrent) =>
    circuit(
      [
        ['V1', 'voltage', { dc: voltage }],
        ['D1', 'diode', { is: saturationCurrent, thermalVoltage: 0.02585 }],
        ['GND', 'ground'],
      ],
      [
        ['V1:0', 'D1:0'],
        ['V1:1', 'GND:0'],
        ['D1:1', 'GND:0'],
      ],
    );
  const document = directDiode(3, 1e-50);
  const result = engine.simulate(document);
  const expected = 1e-50 * Math.expm1(3 / 0.02585);
  near(value(result, 'I:D1'), expected, 1e-10);
  near(value(result, 'I:V1'), -expected, 1e-10);
  const sweep = engine.simulate(document, {
    type: 'sweep',
    componentId: 'V1',
    parameter: 'dc',
    start: 2.8,
    stop: 3,
    points: 5,
  });
  sweep.x.forEach((voltage, index) =>
    near(value(sweep, 'I:D1', index), 1e-50 * Math.expm1(voltage / 0.02585), 1e-10),
  );
  assert.equal(Math.exp(19 / 0.02585), Infinity);
  const logDomainExpected = Math.exp(Math.log(1e-320) + 19 / 0.02585);
  near(value(engine.simulate(directDiode(19, 1e-320)), 'I:D1'), logDomainExpected, 1e-10);
  assert.throws(() => engine.simulate(directDiode(100, 1e-14)), /溢出|数值/);
});

test('BJT Ebers–Moll forward junction retains its exponential at large finite bias', () => {
  for (const polarity of ['npn', 'pnp']) {
    const sign = polarity === 'npn' ? 1 : -1;
    const document = circuit(
      [
        ['VC', 'voltage', { dc: sign * 5 }],
        ['VB', 'voltage', { dc: sign * 3 }],
        ['Q1', 'bjt', { polarity, is: 1e-50, beta: 100 }],
        ['GND', 'ground'],
      ],
      [
        ['VC:0', 'Q1:0'],
        ['VC:1', 'GND:0'],
        ['VB:0', 'Q1:1'],
        ['VB:1', 'GND:0'],
        ['Q1:2', 'GND:0'],
      ],
    );
    const result = engine.simulate(document);
    const expected = sign * 1e-50 * Math.expm1(3 / 0.02585);
    near(value(result, 'I:Q1'), expected, 1e-10);
    near(value(result, 'I:VC'), -expected, 1e-10);
    near(value(result, 'I:VB'), -expected / 100, 1e-12);
  }
});
