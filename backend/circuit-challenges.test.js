const assert = require('node:assert/strict');
const test = require('node:test');
const engine = require('../public/circuit-engine');
const {
  outputFrom,
  readChallengeInput,
  starterDocument,
  validateChallengeDocument,
  waveformError,
} = require('./circuit-challenges');

function solution() {
  const component = (id, type, x, y, params = {}) => ({
    id,
    type,
    x,
    y,
    rotation: 0,
    params: { ...engine.catalog[type].defaults, ...params },
  });
  return {
    version: 1,
    components: [
      component('V_IN', 'voltage', 90, 260, {
        dc: 0,
        waveform: 'sine',
        amplitude: 2,
        frequency: 1000,
      }),
      component('OUT', 'oscilloscope', 910, 260),
      component('GND', 'ground', 500, 560),
      component('R1', 'resistor', 350, 220, { resistance: 1000 }),
      component('R2', 'resistor', 650, 360, { resistance: 1000 }),
    ],
    wires: [
      ['V_IN', 1, 'GND', 0],
      ['OUT', 1, 'GND', 0],
      ['V_IN', 0, 'R1', 0],
      ['R1', 1, 'OUT', 0],
      ['OUT', 0, 'R2', 0],
      ['R2', 1, 'GND', 0],
    ].map(([fromId, fromPin, toId, toPin], index) => ({
      id: `w${index + 1}`,
      from: { componentId: fromId, pin: fromPin },
      to: { componentId: toId, pin: toPin },
    })),
    analysis: { type: 'transient', stop: 0.002, step: 0.00001, initial: 'zero' },
  };
}

test('challenge authoring derives the target output from the admin circuit', () => {
  const data = readChallengeInput({
    title: '半幅正弦波',
    description: '把输入幅值降为一半。',
    tolerance: 0.06,
    document: solution(),
  });
  assert.equal(data.target.values.length, 201);
  const input = engine.simulate(data.document).traces.find((trace) => trace.id === 'V:V_IN');
  const output = data.target.values;
  output.forEach((value, index) => assert.ok(Math.abs(value - input.values[index] / 2) < 1e-8));
  assert.equal(waveformError(data.target, data.target), 0);
});

test('player starter keeps fixed ports and their ground returns but hides the solution', () => {
  const starter = starterDocument(validateChallengeDocument(solution()));
  assert.deepEqual(
    starter.components.map((item) => item.id),
    ['V_IN', 'OUT', 'GND'],
  );
  assert.equal(starter.wires.length, 2);
  assert.ok(starter.wires.every((wire) => ['V_IN', 'OUT', 'GND'].includes(wire.from.componentId)));
});

test('challenge validation permits only the requested component families and periodic inputs', () => {
  const invalidSource = solution();
  invalidSource.components[0].params.waveform = 'dc';
  assert.throws(() => validateChallengeDocument(invalidSource), /正弦波或方波/);
  const forbidden = solution();
  forbidden.components.push({ id: 'I1', type: 'current', params: engine.catalog.current.defaults });
  assert.throws(() => validateChallengeDocument(forbidden), /不允许使用电流源/);
  const missingOutput = solution();
  missingOutput.components = missingOutput.components.filter((item) => item.id !== 'OUT');
  missingOutput.wires = missingOutput.wires.filter(
    (wire) => wire.from.componentId !== 'OUT' && wire.to.componentId !== 'OUT',
  );
  assert.throws(() => validateChallengeDocument(missingOutput), /固定端口 OUT/);
  const missingGroundReturn = solution();
  missingGroundReturn.wires = missingGroundReturn.wires.filter((wire) => wire.id !== 'w2');
  assert.throws(() => validateChallengeDocument(missingGroundReturn), /输出负端必须连接固定参考地/);
});

test('waveform comparison is normalized and rejects mismatched sample counts', () => {
  const target = outputFrom(validateChallengeDocument(solution()));
  const perturbed = { x: target.x, values: target.values.map((value) => value * 1.02) };
  assert.ok(waveformError(perturbed, target) > 0);
  assert.ok(waveformError(perturbed, target) < 0.03);
  assert.throws(() => waveformError({ values: [1] }, target), /采样点/);
});
