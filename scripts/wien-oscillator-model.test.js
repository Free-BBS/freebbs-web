const assert = require('node:assert/strict');
const test = require('node:test');
const { evaluate, validParameters, sampleTransient } = require('../public/wien-oscillator-model');

const parameters = {
  rgOhms: 10000,
  rOhms: 10000,
  cFarads: 1e-8,
  rfMinOhms: 15000,
  rfMaxOhms: 25000,
  rfInitialOhms: 18000,
  qMin: 5,
};

test('Wien startup uses growing complex poles and explicit absolute pole Q', () => {
  const decaying = evaluate(parameters, 19000);
  assert.ok(decaying.growthRate < 0);
  assert.equal(decaying.starts, false);
  assert.equal(decaying.satisfies, false, 'high Q below the startup threshold is insufficient');
  const critical = evaluate(parameters, 20000);
  assert.equal(critical.gain, 3);
  assert.equal(critical.q, Infinity);
  assert.equal(critical.growthRate, 0);
  assert.equal(critical.starts, false);
  assert.equal(critical.satisfies, false, 'infinite Q at the critical point must not pass');
  const growing = evaluate(parameters, 21000);
  assert.equal(growing.gain, 3.1);
  assert.ok(Math.abs(growing.q - 10) < 1e-12);
  assert.ok(Math.abs(growing.frequencyHz - 1591.5494309189535) < 1e-9);
  assert.ok(Math.abs(growing.growthRate - 500) < 1e-9);
  assert.equal(growing.starts, true);
  assert.equal(growing.satisfies, true);
  const excessive = evaluate(parameters, 23000);
  assert.equal(excessive.starts, true);
  assert.equal(excessive.satisfies, false, 'starting alone is insufficient when Q is too small');
});

test('Wien strict startup and Q boundaries reject equality on either side', () => {
  for (const qMin of [3, 4, 5, 6, 8]) {
    for (const rgOhms of [6800, 8200, 10000, 12000, 15000]) {
      const p = {
        ...parameters,
        qMin,
        rgOhms,
        rfMinOhms: 1.5 * rgOhms,
        rfMaxOhms: 2.5 * rgOhms,
        rfInitialOhms: 1.8 * rgOhms,
      };
      const lower = 2 * rgOhms;
      const upper = (2 + 1 / qMin) * rgOhms;
      for (const resistance of [lower - 0.001, lower, upper, upper + 0.001]) {
        assert.equal(evaluate(p, resistance).satisfies, false, `${rgOhms}, ${qMin}, ${resistance}`);
      }
      for (const resistance of [lower + 0.001, (lower + upper) / 2, upper - 0.001]) {
        assert.equal(evaluate(p, resistance).satisfies, true, `${rgOhms}, ${qMin}, ${resistance}`);
      }
    }
  }
});

test('Wien model rejects coercion and honors the actual rheostat range', () => {
  for (const resistance of ['21000', null, undefined, NaN, Infinity, {}, true]) {
    assert.throws(() => evaluate(parameters, resistance), TypeError);
  }
  for (const change of [
    { rgOhms: 0 },
    { cFarads: -1 },
    { qMin: 0.5 },
    { rOhms: '10000' },
    { rfMaxOhms: 40000 },
    { rfInitialOhms: 0 },
  ]) {
    assert.equal(validParameters({ ...parameters, ...change }), false);
  }
  const restricted = { ...parameters, rfMinOhms: 20500, rfMaxOhms: 21500, rfInitialOhms: 20500 };
  assert.equal(evaluate(restricted, 20499).satisfies, false);
  assert.equal(evaluate(restricted, 21501).satisfies, false);
  assert.equal(evaluate(restricted, 20500).satisfies, true);
  assert.equal(evaluate(restricted, 21500).satisfies, true);
});

test('Wien transient preserves decaying, neutral and growing envelopes across the whole trace', () => {
  const peak = (points) => Math.max(...points.map(({ value }) => Math.abs(value)));
  const decaying = sampleTransient(parameters, 18000);
  const neutral = sampleTransient(parameters, 20000);
  const growing = sampleTransient(parameters, 22000);

  assert.equal(decaying.points[0].value, 1);
  assert.ok(peak(decaying.points.slice(-60)) < peak(decaying.points.slice(0, 60)) / 10);
  assert.ok(peak(growing.points.slice(-60)) > peak(growing.points.slice(0, 60)) * 10);
  assert.ok(growing.points[0].value < 0.05, 'growth must not be replaced with clipped unit peaks');
  for (let index = 0; index <= 360; index += 30) {
    assert.ok(Math.abs(neutral.points[index].value - (index % 60 === 0 ? 1 : -1)) < 1e-12);
  }
  for (const transient of [decaying, neutral, growing]) {
    assert.equal(transient.normalized, true);
    assert.equal(peak(transient.points), 1);
    assert.ok(
      transient.points.some(({ value }) => value < 0),
      'underdamped response must oscillate',
    );
  }
});

test('Wien transient spans six natural periods with a deterministic, increasing time axis', () => {
  const transient = sampleTransient(parameters, 21000);
  assert.deepEqual(transient, sampleTransient(parameters, 21000));
  assert.equal(transient.points.length, 361);
  assert.equal(transient.points[0].timeSeconds, 0);
  assert.equal(transient.points.at(-1).timeSeconds, transient.durationSeconds);
  assert.ok(
    Math.abs(transient.durationSeconds - 12 * Math.PI * parameters.rOhms * parameters.cFarads) <
      1e-12,
  );
  for (let index = 1; index < transient.points.length; index += 1) {
    assert.ok(transient.points[index].timeSeconds > transient.points[index - 1].timeSeconds);
  }
  const slower = sampleTransient({ ...parameters, cFarads: parameters.cFarads * 2 }, 21000);
  assert.equal(slower.durationSeconds, transient.durationSeconds * 2);
  assert.deepEqual(
    slower.points.map(({ value }) => value),
    transient.points.map(({ value }) => value),
    'changing RC stretches time without changing the startup envelope',
  );
});

test('Wien transient remains finite at both rheostat limits and the zero-feedback critical case', () => {
  const wideRange = { ...parameters, rfMinOhms: 0, rfMaxOhms: 39999 };
  for (const resistance of [0, 0.001, 15000, 25000, 39999]) {
    const transient = sampleTransient(wideRange, resistance);
    for (const point of transient.points) {
      assert.ok(Number.isFinite(point.timeSeconds));
      assert.ok(Number.isFinite(point.value));
      assert.ok(Math.abs(point.value) <= 1);
    }
  }
  const critical = sampleTransient(wideRange, 0);
  assert.equal(critical.points[0].value, 1);
  assert.ok(
    critical.points.every(({ value }) => value > 0),
    'critical damping has no oscillation',
  );
  for (let index = 1; index < critical.points.length; index += 1) {
    assert.ok(critical.points[index].value < critical.points[index - 1].value);
  }
  const phaseAtOnePeriod = 2 * Math.PI;
  assert.ok(
    Math.abs(critical.points[60].value - (1 + phaseAtOnePeriod) * Math.exp(-phaseAtOnePeriod)) <
      1e-12,
    'critical response honors a unit initial displacement and zero initial velocity',
  );
});

test('Wien transient rejects invalid or unrepresentable inputs without changing model acceptance', () => {
  for (const resistance of ['21000', NaN, Infinity, 14999, 25001]) {
    assert.throws(() => sampleTransient(parameters, resistance), TypeError);
  }
  assert.throws(() => sampleTransient({ ...parameters, rgOhms: 0 }, 21000), TypeError);
  for (const change of [
    { rOhms: Number.MAX_VALUE, cFarads: 1 },
    { rOhms: Number.MIN_VALUE, cFarads: Number.MIN_VALUE },
  ]) {
    assert.throws(() => sampleTransient({ ...parameters, ...change }, 21000), TypeError);
  }
  assert.equal(evaluate(parameters, 14999).satisfies, false);
  assert.equal(evaluate(parameters, 25001).satisfies, false);
});
