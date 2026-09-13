const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const engine = require('../public/circuit-engine');
const plot = require('../public/circuit-plot');
const { coordinateAxis } = require('../public/circuit-renderer');
const imports = require('../public/circuit-waveform-import');
const { validateReport } = require('../backend/circuit-workbench');

test('FFT preserves DC, sine peak amplitude, Nyquist and frequency units', () => {
  const time = Array.from({ length: 1024 }, (_, i) => i / 1024);
  const values = time.map((t, i) => 3 + 2 * Math.sin(2 * Math.PI * 64 * t) + (-1) ** i);
  const spectrum = plot.fft(values, time);
  assert.equal(spectrum.x[64], 64);
  assert.ok(Math.abs(spectrum.values[64] - 2) < 1e-10);
  assert.ok(Math.abs(spectrum.values[0] - 3) < 1e-10);
  assert.ok(Math.abs(spectrum.values[512] - 1) < 1e-10);
  assert.equal(spectrum.domain, 'frequency');
  assert.equal(spectrum.xUnit, 'Hz');
  assert.throws(() => plot.fft([1, 2, 3], [0, 1, 3]), /等间隔/);
  assert.throws(() => plot.fft([1, NaN], [0, 1]), /有限/);
  const padded = plot.fft([2, 2, 2], [0, 1, 2]);
  assert.equal(padded.values[0], 2, 'zero padding must not reduce DC amplitude');
});
test('fft(expression) computes before transform and refuses mixed time/frequency arithmetic', () => {
  const x = Array.from({ length: 128 }, (_, i) => i / 128);
  const base = {
    x,
    analysis: { type: 'transient' },
    traces: [{ id: 'V:V1', unit: 'V', values: x.map((t) => Math.sin(2 * Math.PI * 8 * t)) }],
  };
  const display = {
    ch1: 'V:V1',
    traceIds: ['M:M1'],
    math: [
      { id: 'M1', expression: 'fft(CH1*2)' },
      { id: 'M2', expression: 'M1+CH1' },
    ],
  };
  const result = plot.buildResult(base, display);
  assert.ok(Math.abs(result.result.traces[1].values[8] - 2) < 1e-10);
  assert.match(result.warnings.join(' '), /频谱通道/);
  assert.equal(base.traces.length, 1);
  assert.match(
    plot.buildResult({ ...base, analysis: { type: 'dc' } }, display).warnings.join(' '),
    /瞬态/,
  );
  assert.match(
    plot
      .buildResult(base, { ...display, math: [{ id: 'M1', expression: 'abs(fft(CH1))' }] })
      .warnings.join(' '),
    /最外层/,
  );
});
test('log axes preserve geometric spacing and exclude zero without changing linear behavior', () => {
  const axis = coordinateAxis([-10, 0, 1, 10, 1000], 'log', null, null, false);
  assert.equal(axis.min, 0);
  assert.equal(axis.max, 3);
  assert.equal(axis.project(10), 1);
  assert.equal(axis.inverse(2), 100);
  assert.ok(Number.isNaN(axis.project(0)));
  const settings = {
    xScale: 'log',
    yScale: 'linear',
    rightScale: 'log',
    rightTraceIds: ['I:R1'],
    plots: [{ mode: 'xy', xScale: 'linear', yScale: 'log' }],
  };
  const document = engine.validateDocument({
    version: 1,
    components: [],
    wires: [],
    analysis: { type: 'dc' },
    display: settings,
  });
  assert.deepEqual(plot.resolveDisplay({ traces: [] }, document).plots, document.display.plots);
  assert.throws(() => engine.normalizeDisplay({ xScale: 'log', ranges: { xMin: 0 } }), /大于 0/);
  assert.throws(() => engine.normalizeDisplay({ plots: [{ plots: [] }] }), /嵌套/);
  assert.throws(
    () => engine.normalizeDisplay({ plots: Array.from({ length: 6 }, () => ({})) }),
    /6 张/,
  );
});
test('arbitrary source interpolation, delay, loop and DC use separate values', () => {
  const params = {
    ...engine.catalog.voltage.defaults,
    waveform: 'arbitrary',
    samples: '[[0,0],[1,2],[2,0]]',
    dc: 3,
    delay: 1,
  };
  assert.equal(engine.sourceValue(params, { kind: 'transient', time: 1.5 }), 4);
  assert.equal(engine.sourceValue(params, { kind: 'transient', time: 0 }), 3);
  assert.equal(engine.sourceValue(params, { kind: 'transient', time: 5 }), 3);
  assert.equal(
    engine.sourceValue({ ...params, interpolation: 'step' }, { kind: 'transient', time: 1.5 }),
    3,
  );
  assert.equal(
    engine.sourceValue({ ...params, repeat: 'repeat' }, { kind: 'transient', time: 3.5 }),
    4,
  );
  assert.equal(engine.sourceValue(params, { kind: 'dc', sourceScale: 0.5 }), 1.5);
  for (const invalid of ['[[0,1],[0,2]]', '[[1,2],[0,1]]', '[[-1,2],[0,3]]', '[]'])
    assert.throws(() => engine.parseSourceSamples(invalid));
});
test('CSV and MATLAB arrays use explicit mapping and reject invalid timestamps or executable values', () => {
  const csv = imports.columns(imports.textArrays('time,signal\n0,1\n1e-3,-2\n2e-3,3', false));
  assert.equal(csv[0].name, 'time');
  assert.equal(imports.pair(csv[0].values, csv[1].values), '[[0,1],[0.001,-2],[0.002,3]]');
  const m = imports.columns(imports.textArrays('t=[0 0.001 0.002]; y=[1; -2; 3]; % test', true));
  assert.deepEqual(
    m.map((v) => v.values),
    [
      [0, 0.001, 0.002],
      [1, -2, 3],
    ],
  );
  assert.throws(() => imports.textArrays('x=[system("id")];', true));
  assert.throws(() => imports.pair([0, 0], [1, 2]), /递增/);
  assert.throws(() => imports.pair([0, 1], [1]), /等长/);
});
function element(type, bytes) {
  const output = Buffer.alloc(8 + Math.ceil(bytes.length / 8) * 8);
  output.writeUInt32LE(type);
  output.writeUInt32LE(bytes.length, 4);
  bytes.copy(output, 8);
  return output;
}
function mat(compressed) {
  const flags = Buffer.alloc(8);
  flags.writeUInt32LE(6);
  const dims = Buffer.alloc(8);
  dims.writeInt32LE(3);
  dims.writeInt32LE(2, 4);
  const values = Buffer.alloc(48);
  [0, 1, 2, 2, 4, 6].forEach((v, i) => values.writeDoubleLE(v, i * 8));
  const matrix = element(
    14,
    Buffer.concat([
      element(6, flags),
      element(5, dims),
      element(1, Buffer.from('wave')),
      element(9, values),
    ]),
  );
  const header = Buffer.alloc(128);
  header.write('MATLAB 5.0 MAT-file');
  header.write('IM', 126);
  const data = compressed ? zlib.deflateSync(matrix) : matrix;
  const tag = Buffer.alloc(8);
  tag.writeUInt32LE(15);
  tag.writeUInt32LE(data.length, 4);
  const output = Buffer.concat([header, ...(compressed ? [tag] : []), data]);
  return output.buffer.slice(output.byteOffset, output.byteOffset + output.length);
}
test('MAT v6 and compressed v7 matrices read column-major doubles identically', async () => {
  for (const compressed of [false, true]) {
    const columns = imports.columns(await imports.matArrays(mat(compressed)));
    assert.deepEqual(
      columns.map((c) => c.values),
      [
        [0, 1, 2],
        [2, 4, 6],
      ],
    );
  }
  await assert.rejects(imports.matArrays(new ArrayBuffer(16)), /无效/);
});
test('report validation bounds text and circuit revision', () => {
  assert.equal(
    validateReport({ title: '实验', markdown: '# 测试', circuitRevision: 1 }).title,
    '实验',
  );
  for (const bad of [
    { title: '' },
    { markdown: null },
    { circuitRevision: 0 },
    { markdown: 'x'.repeat(2 * 1024 * 1024 + 1) },
  ])
    assert.throws(() =>
      validateReport({ title: '实验', markdown: '', circuitRevision: 1, ...bad }),
    );
});
