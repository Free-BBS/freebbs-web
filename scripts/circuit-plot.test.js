const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const plot = require('../public/circuit-plot');
const engine = require('../public/circuit-engine');

function result(type = 'transient', x = [0, 1, 2], values = [1, 2, 3], second = [3, 2, 1]) {
  return {
    analysis: { type },
    x,
    xLabel: type === 'ac' ? '频率' : '时间',
    xUnit: type === 'ac' ? 'Hz' : 's',
    traces: [
      {
        id: 'V:S1',
        label: '第一通道',
        unit: 'V',
        values,
        ...(type === 'ac' ? { phase: x.map(() => 0) } : {}),
      },
      {
        id: 'V:S1:CH2',
        label: '第二通道',
        unit: 'V',
        values: second,
        ...(type === 'ac' ? { phase: x.map(() => 90) } : {}),
      },
    ],
    frames: [],
    warnings: ['原始仿真提示'],
  };
}
const config = (math, extra = {}) => ({
  ch1: 'V:S1',
  ch2: 'V:S1:CH2',
  math: math.map((expression, index) => ({ id: `M${index + 1}`, expression })),
  ...extra,
});
function close(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be ${expected}`);
}

test('math grammar handles scientific notation, precedence and explicit channel aliases without executing code', () => {
  const compiled = plot.compileExpression('-CH1^2 + 2^3^2 / 1e2 + pow(CH2, -2)');
  close(compiled.evaluate({ CH1: 2, CH2: 2 }), -4 + 512 / 100 + 0.25);
  assert.deepEqual(compiled.dependencies, ['CH1', 'CH2']);
  close(plot.compileExpression('sin(pi / 2) + log(e) + max(1, 2)').evaluate(), 4);
  close(plot.compileExpression('sqrt(abs(ch1))').evaluate({ CH1: -9 }), 3);
  for (const expression of [
    'CH1.constructor',
    'CH1[0]',
    'globalThis',
    'process.exit()',
    'this',
    'CH1;alert(1)',
    '(()=>1)()',
    'CH1 = 5',
    '2CH1',
    'min(CH1)',
    'M9',
    'unknown(CH1)',
    '1e999',
    'CH1 +',
    '',
  ])
    assert.throws(() => plot.compileExpression(expression), undefined, expression);
  assert.throws(() => plot.compileExpression(`${'('.repeat(34)}CH1${')'.repeat(34)}`), /嵌套/);
  assert.throws(() => plot.compileExpression(`${'1+'.repeat(80)}1`), /字符/);
});

test('real maths preserve base results and support chained traces and inferred units', () => {
  const base = result();
  const original = JSON.stringify(base);
  Object.freeze(base.traces);
  const { result: computed, warnings } = plot.buildResult(
    base,
    config(['CH1-CH2', 'M1*CH1', 'CH1/CH2']),
  );
  assert.deepEqual(computed.traces[2].values, [-2, 0, 2]);
  assert.deepEqual(computed.traces[3].values, [-2, 0, 6]);
  assert.deepEqual(
    computed.traces.map((trace) => trace.unit),
    ['V', 'V', 'V', 'V·V', '1'],
  );
  assert.equal(computed.traces[2].id, 'M:M1');
  assert.equal(computed.traces[2].expression, 'CH1-CH2');
  assert.deepEqual(warnings, []);
  assert.deepEqual(computed.warnings, ['原始仿真提示']);
  assert.equal(JSON.stringify(base), original);
  assert.notEqual(computed, base);
  assert.notEqual(computed.traces, base.traces);
  const repeated = plot.buildResult(computed, config(['CH1-CH2']));
  assert.equal(repeated.result.traces.length, 3, 'recalculation replaces math traces');
});

test('AC arithmetic uses both magnitude and phase, including previous math traces', () => {
  const base = result('ac', [1000], [1], [1]);
  const { result: computed, warnings } = plot.buildResult(
    base,
    config(['CH1-CH2', 'CH1+CH2', 'CH1/CH2', 'M1/M2', 'abs(M1)']),
  );
  assert.deepEqual(warnings, []);
  const values = computed.traces.slice(2);
  close(values[0].values[0], Math.SQRT2);
  close(values[0].phase[0], -45);
  close(values[1].values[0], Math.SQRT2);
  close(values[1].phase[0], 45);
  close(values[2].values[0], 1);
  close(values[2].phase[0], -90);
  close(values[3].values[0], 1);
  close(values[3].phase[0], -90);
  close(values[4].values[0], Math.SQRT2);
  close(values[4].phase[0], 0);
});

test('complex powers and elementary functions retain phase and reject undefined complex ordering', () => {
  const base = result('ac', [1000], [2], [1]);
  base.traces[0].phase[0] = 45;
  const { result: computed, warnings } = plot.buildResult(
    base,
    config(['CH1^2', 'sqrt(CH1)', 'exp(log(CH1))', 'min(CH1,CH2)', 'sin(0)+cos(0)']),
  );
  const traces = new Map(computed.traces.map((trace) => [trace.id, trace]));
  close(traces.get('M:M1').values[0], 4);
  close(traces.get('M:M1').phase[0], 90);
  close(traces.get('M:M2').values[0], Math.SQRT2);
  close(traces.get('M:M2').phase[0], 22.5);
  close(traces.get('M:M3').values[0], 2);
  close(traces.get('M:M3').phase[0], 45);
  assert.equal(traces.has('M:M4'), false);
  close(traces.get('M:M5').values[0], 1);
  assert.match(warnings.join('\n'), /相量没有大小顺序/);
});

test('division by zero, undefined real roots and missing samples form gaps instead of fabricated zeros', () => {
  const base = result('transient', [0, 1, 2], [1, 0, -1], [0, 1, 2]);
  const computed = plot.buildResult(base, config(['CH1/CH2', 'sqrt(CH1)', 'M1+1']));
  assert.ok(Number.isNaN(computed.result.traces[2].values[0]));
  assert.equal(computed.result.traces[2].values[1], 0);
  assert.ok(Number.isNaN(computed.result.traces[3].values[2]));
  assert.ok(Number.isNaN(computed.result.traces[4].values[0]));
  assert.equal(computed.warnings.length, 3);
  const ac = result('ac', [1, 2], [null, 1], [1, 0]);
  const complex = plot.buildResult(ac, config(['CH1/CH2']));
  assert.ok(complex.result.traces[2].values.every(Number.isNaN));
  assert.ok(complex.result.traces[2].phase.every(Number.isNaN));
  assert.match(complex.warnings[0], /2 个无效/);
});

test('calculus uses actual nonuniform time samples, supports composition and assigns physical units', () => {
  const x = [0, 0.5, 2, 5];
  const base = result(
    'transient',
    x,
    x.map((value) => value ** 2),
    x.map((value) => 2 * value),
  );
  const { result: computed, warnings } = plot.buildResult(
    base,
    config(['derivative(CH1)', 'integral(CH2)', 'diff(integral(CH2))', 'integral(CH1/CH2)']),
  );
  computed.traces[2].values.forEach((value, index) => close(value, 2 * x[index]));
  computed.traces[3].values.forEach((value, index) => close(value, x[index] ** 2));
  computed.traces[4].values.forEach((value, index) => close(value, 2 * x[index]));
  assert.equal(computed.traces[2].unit, 'V/s');
  assert.equal(computed.traces[3].unit, 'V·s');
  assert.ok(
    computed.traces[5].values.every(Number.isNaN),
    'integral cannot invent area across missing samples',
  );
  assert.match(warnings[0], /4 个无效/);
  for (const type of ['dc', 'sweep', 'ac']) {
    const rejected = plot.buildResult(result(type), config(['integral(CH1)']));
    assert.equal(rejected.result.traces.length, 2);
    assert.match(rejected.warnings[0], /仅支持瞬态/);
  }
  assert.throws(() => plot.compileExpression('diff(CH1)').evaluate({ CH1: 2 }), /时间轴/);
});

test('one-sample derivatives are gaps, and invalid time axes are rejected', () => {
  const single = plot.buildResult(result('transient', [0], [1], [2]), config(['diff(CH1)']));
  assert.ok(Number.isNaN(single.result.traces[2].values[0]));
  const pair = plot.buildResult(
    result('transient', [0, 0.2], [1, 3], [0, 0]),
    config(['diff(CH1)']),
  );
  assert.deepEqual(pair.result.traces[2].values, [10, 10]);
  const reversed = plot.buildResult(result('transient', [0, 2, 1]), config(['integral(CH1)']));
  assert.equal(reversed.result.traces.length, 2);
  assert.match(reversed.warnings[0], /严格递增/);
});

test('invalid rows, duplicate IDs and cyclic or forward references do not prevent independent curves', () => {
  const display = config(['M2+1', 'M1+1', 'CH1', 'CH1.constructor', 'M5+1', 'CH2']);
  display.math.push({ id: 'M3', expression: '1' });
  const { result: computed, warnings } = plot.buildResult(result(), display);
  assert.deepEqual(
    computed.traces.slice(2).map((trace) => trace.id),
    ['M:M3', 'M:M6'],
  );
  assert.equal(warnings.length, 5);
  assert.match(warnings.join('\n'), /自身、后面的/);
  assert.match(warnings.join('\n'), /不重复/);
});

test('missing channels and inconsistent AC phases are explicit errors without silent reassignment', () => {
  const base = result('ac');
  base.traces[0].phase = [];
  const display = config(['CH1+CH2'], {
    ch2: 'V:deleted',
    mode: 'xy',
    xyX: 'V:deleted',
    xyY: 'M:M1',
    traceIds: ['M:M1'],
  });
  const saved = plot.resolveDisplay(base, { display });
  assert.equal(saved.ch2, 'V:deleted');
  assert.equal(saved.xyX, 'V:deleted');
  const computed = plot.buildResult(base, saved);
  assert.equal(computed.result.traces.length, 2);
  assert.match(computed.warnings.join('\n'), /V:deleted 不存在/);
  assert.match(computed.warnings.join('\n'), /缺少交流相位/);
  assert.match(computed.warnings.join('\n'), /显示通道 M:M1 不存在/);
});

test('display defaults prefer both oscilloscope channels and preserve saved empty selections and manual ranges', () => {
  const base = result();
  base.traces.unshift({ id: 'V:R1', values: [1, 2, 3], unit: 'V' });
  const document = {
    components: [
      { id: 'S1', type: 'oscilloscope2' },
      { id: 'R1', type: 'resistor' },
    ],
  };
  const defaults = plot.resolveDisplay(base, document);
  assert.deepEqual(defaults.traceIds, ['V:S1', 'V:S1:CH2']);
  assert.equal(defaults.ch1, 'V:S1');
  assert.equal(defaults.ch2, 'V:S1:CH2');
  assert.equal(defaults.xyX, defaults.ch1);
  assert.equal(defaults.xyY, defaults.ch2);
  document.display = {
    ...defaults,
    mode: 'xy',
    traceIds: [],
    phase: true,
    ranges: { xMin: -5, xMax: 5, yMin: null, yMax: 10 },
    math: [{ id: 'M1', expression: 'CH1-CH2' }],
  };
  const restored = plot.resolveDisplay(base, document);
  assert.deepEqual(restored, document.display);
  restored.math[0].expression = 'CH1';
  restored.ranges.xMin = -2;
  assert.equal(document.display.math[0].expression, 'CH1-CH2');
  assert.equal(document.display.ranges.xMin, -5);
});

test('math workloads and row count are bounded for untrusted shared documents', () => {
  const display = config(Array(12).fill('1'));
  const manyRows = plot.buildResult(result(), display);
  assert.equal(manyRows.result.traces.length, 10);
  assert.match(manyRows.warnings[0], /最多显示 8/);
  const x = Array.from({ length: 100001 }, (_, index) => index);
  const large = result('transient', x, x, x);
  const expressions = Array(8).fill(Array(18).fill('CH1').join('+'));
  const bounded = plot.buildResult(large, config(expressions));
  assert.ok(bounded.result.traces.length < 10);
  assert.match(bounded.warnings.join('\n'), /运算量过大/);
});

test('shared display settings survive engine validation and JSON round trips without losing plot configuration', () => {
  const display = plot.resolveDisplay(result(), {
    display: config(['CH1-CH2'], {
      mode: 'xy',
      xyX: 'V:S1',
      xyY: 'M:M1',
      traceIds: ['V:S1', 'M:M1'],
      ranges: { xMin: -1, xMax: 1, yMin: -5, yMax: 5 },
    }),
  });
  const document = engine.validateDocument({
    version: 1,
    components: [],
    wires: [],
    analysis: { type: 'dc' },
    display,
  });
  const restored = plot.resolveDisplay(result(), JSON.parse(JSON.stringify(document)));
  assert.deepEqual(restored, document.display);
  const computed = plot.buildResult(result(), restored);
  assert.equal(restored.xyY, 'M:M1');
  assert.deepEqual(computed.result.traces[2].values, [-2, 0, 2]);
  assert.deepEqual(computed.warnings, []);
  const empty = plot.resolveDisplay({ traces: [] });
  assert.deepEqual(
    engine.normalizeDisplay(empty),
    empty,
    'empty plots use null channel IDs accepted by storage',
  );
});

test('many dual-channel scopes keep automatic selections within the saved-display limit', () => {
  const components = Array.from({ length: 20 }, (_, index) => ({
    id: `S${index + 1}`,
    type: 'oscilloscope2',
  }));
  const traces = components.flatMap((component) => [
    { id: `V:${component.id}`, unit: 'V', values: [0] },
    { id: `V:${component.id}:CH2`, unit: 'V', values: [0] },
  ]);
  const display = plot.resolveDisplay({ traces }, { components });
  assert.equal(display.traceIds.length, 32);
  assert.equal(display.ch1, 'V:S1');
  assert.equal(display.ch2, 'V:S1:CH2');
  assert.deepEqual(engine.normalizeDisplay(display), display);
  assert.equal(traces.length, 40, 'available result channels are not truncated');
});

test('the same standalone module works inside browser sandboxes without CommonJS or the engine', () => {
  const context = vm.createContext({});
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '../public/circuit-plot.js'), 'utf8'),
    context,
  );
  assert.equal(context.FreeBbsCircuitPlot.compileExpression('CH1/2').evaluate({ CH1: 10 }), 5);
  assert.deepEqual(Object.keys(context.FreeBbsCircuitPlot).sort(), [
    'buildResult',
    'compileExpression',
    'limits',
    'resolveDisplay',
  ]);
});
