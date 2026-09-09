const assert = require('node:assert/strict');
const test = require('node:test');
const { evaluate, validParameters } = require('../public/wien-oscillator-model');

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
