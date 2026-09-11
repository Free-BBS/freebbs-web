const assert = require('node:assert/strict');
const test = require('node:test');
const engine = require('../public/circuit-engine');

// Synthetic four-device cascode mirror. No exported user document is a fixture.
function mirror({ polarity = 'n', reference = 1e-5, resistance = 1000, acAmplitude = 0 } = {}) {
  const sign = polarity === 'n' ? 1 : -1;
  const transistor = (id, width) => ({
    id,
    type: 'mosfet',
    params: { polarity, kp: 1e-4, w: width, l: 1e-6, vto: 1, lambda: 0.02 },
  });
  const endpoint = (referencePin) => {
    const [componentId, pin] = referencePin.split(':');
    return { componentId, pin: Number(pin) };
  };
  return {
    version: 1,
    components: [
      { id: 'GND', type: 'ground' },
      { id: 'VDD', type: 'voltage', params: { dc: sign * 5, acAmplitude: 0 } },
      { id: 'IREF', type: 'current', params: { dc: sign * reference, acAmplitude } },
      transistor('M1', 1e-5),
      transistor('M4', 1e-5),
      transistor('M2', 1e-4),
      transistor('M3', 1e-4),
      { id: 'R2', type: 'resistor', params: { resistance } },
      { id: 'AM1', type: 'ammeter' },
    ],
    wires: [
      ['VDD:1', 'GND:0'],
      ['VDD:0', 'IREF:0'],
      ['IREF:1', 'M4:0'],
      ['M4:0', 'M4:1'],
      ['M4:0', 'M3:1'],
      ['M4:2', 'M1:0'],
      ['M1:0', 'M1:1'],
      ['M1:0', 'M2:1'],
      ['M1:2', 'GND:0'],
      ['M2:2', 'GND:0'],
      ['M2:0', 'M3:2'],
      ['VDD:0', 'R2:0'],
      ['R2:1', 'AM1:0'],
      ['AM1:1', 'M3:0'],
    ].map(([from, to], index) => ({ id: `w${index}`, from: endpoint(from), to: endpoint(to) })),
    analysis: { type: 'dc' },
  };
}

function near(actual, expected, absolute = 1e-10, relative = 1e-7) {
  assert.ok(Number.isFinite(actual), `Expected finite value, received ${actual}`);
  const tolerance = absolute + relative * Math.abs(expected);
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ${expected} ± ${tolerance}, received ${actual}`,
  );
}

// Independent scalar reference: integrate channel charge up to pinch-off, then
// use bracketed bisection on the two branch KCL equations. This never calls the
// engine's Newton solver, Jacobian, or nonlinear device evaluation.
function drainCurrent(gateSource, drainSource, ratio) {
  const charge = Math.max(0, gateSource - 1);
  const conductingLength = Math.min(Math.max(0, drainSource), charge);
  return (
    1e-4 * ratio * conductingLength * (charge - conductingLength / 2) * (1 + 0.02 * drainSource)
  );
}

function bisect(residual, start, stop) {
  let lower = start;
  let upper = stop;
  const lowerSign = Math.sign(residual(lower));
  assert.ok(lowerSign * Math.sign(residual(upper)) <= 0, 'Physical solution must be bracketed');
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const middle = (lower + upper) / 2;
    if (Math.sign(residual(middle)) === lowerSign) lower = middle;
    else upper = middle;
  }
  return (lower + upper) / 2;
}

function physicalPoint(reference, resistance) {
  const biasLow = bisect((voltage) => drainCurrent(voltage, voltage, 10) - reference, 1, 5);
  const biasTop = 2 * biasLow;
  const midpoint = (output) =>
    bisect(
      (middle) =>
        drainCurrent(biasLow, middle, 100) - drainCurrent(biasTop - middle, output - middle, 100),
      0,
      output,
    );
  const output = bisect(
    (voltage) => (5 - voltage) / resistance - drainCurrent(biasLow, midpoint(voltage), 100),
    0,
    5,
  );
  return { biasLow, biasTop, output, middle: midpoint(output), current: (5 - output) / resistance };
}

function assertPhysicalFrame(document, frame, reference, resistance, sign = 1) {
  const expected = physicalPoint(reference, resistance);
  const nets = engine.buildNets(document).pinNets;
  const voltage = (pin) => sign * frame.voltages[nets[pin]];
  const current = (id) => sign * frame.currents[id];
  // Match the solver's existing absolute KCL/update tolerances while still
  // detecting even 1 pS of residual shunt leakage in the 10 pA case.
  const currentTolerance = Math.max(5e-14, reference * 2e-5);
  for (const [pin, expectedVoltage] of [
    ['VDD:0', 5],
    ['M1:0', expected.biasLow],
    ['M4:0', expected.biasTop],
    ['M2:0', expected.middle],
    ['M3:0', expected.output],
  ]) {
    near(voltage(pin), expectedVoltage, 2e-7);
    assert.ok(
      voltage(pin) >= -1e-9 && voltage(pin) <= 5 + 1e-9,
      `${pin} must stay within supply rails`,
    );
  }
  near(current('IREF'), reference, currentTolerance);
  near(current('M1'), reference, currentTolerance);
  near(current('M4'), reference, currentTolerance);
  for (const id of ['M2', 'M3', 'AM1', 'R2']) near(current(id), expected.current, currentTolerance);
  // KCL at both bias nodes, the cascode midpoint, output, and supply.
  near(current('IREF') - current('M4'), 0, currentTolerance);
  near(current('M4') - current('M1'), 0, currentTolerance);
  near(current('M3') - current('M2'), 0, currentTolerance);
  near(current('AM1') - current('M3'), 0, currentTolerance);
  near(current('VDD') + current('IREF') + current('R2'), 0, currentTolerance);
  near(current('R2'), (5 - voltage('M3:0')) / resistance, currentTolerance);
  return expected;
}

test('current-fed cascode mirror starts from zero and completes its full load sweep', () => {
  const document = mirror();
  const result = engine.simulate(document, {
    type: 'sweep',
    componentId: 'R2',
    parameter: 'resistance',
    start: 1000,
    stop: 200000,
    points: 101,
  });
  assert.equal(result.x.length, 101);
  assert.equal(result.frames.length, 101);
  assert.equal(result.x[0], 1000);
  assert.equal(result.x.at(-1), 200000);
  result.frames.forEach((frame, index) =>
    assertPhysicalFrame(document, frame, 1e-5, result.x[index]),
  );
  assert.ok(result.frames[0].currents.AM1 / 1e-5 > 9.9);
  assert.ok(result.frames.at(-1).currents.AM1 / 1e-5 < 2.6);
});

// Each case constructs a fresh DC document: a successful forward sweep must
// not hide a startup failure at a later load value by supplying its warm state.
for (const polarity of ['n', 'p']) {
  for (const resistance of [37204.278027715765, 49482.90729204144, 130000, 200000]) {
    test(`${polarity.toUpperCase()} cascode mirror starts independently at R2=${resistance} ohms`, () => {
      const document = mirror({ polarity, resistance });
      const result = engine.simulate(document, { type: 'dc' });
      assert.equal(result.frames.length, 1);
      assertPhysicalFrame(document, result.frames[0], 1e-5, resistance, polarity === 'n' ? 1 : -1);
    });
  }

  test(`${polarity.toUpperCase()} cascode mirror starts at high load and completes the reverse sweep`, () => {
    const document = mirror({ polarity, resistance: 200000 });
    const result = engine.simulate(document, {
      type: 'sweep',
      componentId: 'R2',
      parameter: 'resistance',
      start: 200000,
      stop: 1000,
      points: 101,
    });
    assert.equal(result.x.length, 101);
    assert.equal(result.frames.length, 101);
    assert.equal(result.x[0], 200000);
    assert.equal(result.x.at(-1), 1000);
    result.frames.forEach((frame, index) =>
      assertPhysicalFrame(document, frame, 1e-5, result.x[index], polarity === 'n' ? 1 : -1),
    );
  });
}

test('startup and cascode load behavior are symmetric for N and P devices', () => {
  const analysis = {
    type: 'sweep',
    componentId: 'R2',
    parameter: 'resistance',
    start: 1000,
    stop: 200000,
    points: 11,
  };
  const nDocument = mirror();
  const pDocument = mirror({ polarity: 'p' });
  const nResult = engine.simulate(nDocument, analysis);
  const pResult = engine.simulate(pDocument, analysis);
  pResult.frames.forEach((frame, index) => {
    assertPhysicalFrame(pDocument, frame, 1e-5, pResult.x[index], -1);
    for (const [id, current] of Object.entries(frame.currents)) {
      near(current, -nResult.frames[index].currents[id], 1e-12);
    }
  });
});

test('temporary startup conductance leaves no leakage in picoamp high-impedance mirrors', () => {
  for (const polarity of ['n', 'p']) {
    const document = mirror({ polarity, reference: 1e-11, resistance: 1e10 });
    const result = engine.simulate(document);
    assertPhysicalFrame(document, result.frames[0], 1e-11, 1e10, polarity === 'n' ? 1 : -1);
  }
});

test('AC analysis obtains the same physical operating point before small-signal linearization', () => {
  const reference = 1e-5;
  const resistance = 10000;
  const acAmplitude = 1e-7;
  const document = mirror({ reference, resistance, acAmplitude });
  const result = engine.simulate(document, { type: 'ac', start: 10, stop: 100000, points: 5 });
  assert.equal(result.frames.length, 1);
  assertPhysicalFrame(document, result.frames[0], reference, resistance);
  const increment = 1e-9;
  const gain =
    (physicalPoint(reference + increment, resistance).current -
      physicalPoint(reference - increment, resistance).current) /
    (2 * increment);
  const trace = result.traces.find((item) => item.id === 'I:AM1');
  for (const amplitude of trace.values) near(amplitude, gain * acAmplitude, 1e-11, 1e-5);
});

test('transient operating-point initialization starts the mirror and preserves its DC state', () => {
  const document = mirror({ resistance: 10000 });
  const result = engine.simulate(document, {
    type: 'transient',
    initial: 'operating-point',
    step: 1e-4,
    stop: 1e-3,
  });
  assert.equal(result.frames.length, 11);
  result.frames.forEach((frame) => assertPhysicalFrame(document, frame, 1e-5, 10000));
});

test('startup assistance still rejects truly floating gates, isolated resistors, and conflicting ideal sources', () => {
  const floatingGate = mirror();
  floatingGate.wires = floatingGate.wires.filter(
    (wire) => wire.to.componentId !== 'M2' || wire.to.pin !== 1,
  );
  assert.throws(() => engine.simulate(floatingGate), /浮空|奇异/);
  const isolatedResistor = mirror();
  isolatedResistor.components.push({
    id: 'RFLOAT',
    type: 'resistor',
    params: { resistance: 1000 },
  });
  assert.throws(() => engine.simulate(isolatedResistor), /浮空|奇异/);
  const sourceConflict = mirror();
  sourceConflict.components.push({ id: 'VCONFLICT', type: 'voltage', params: { dc: 4 } });
  sourceConflict.wires.push(
    {
      id: 'conflictPositive',
      from: { componentId: 'VCONFLICT', pin: 0 },
      to: { componentId: 'VDD', pin: 0 },
    },
    {
      id: 'conflictGround',
      from: { componentId: 'VCONFLICT', pin: 1 },
      to: { componentId: 'GND', pin: 0 },
    },
  );
  assert.throws(() => engine.simulate(sourceConflict), /冲突|奇异/);
});
