const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const engine = require('../public/circuit-engine');
const plot = require('../public/circuit-plot');
const annotations = require('../public/circuit-annotations');

function result(extra = {}) {
  return {
    analysis: { type: 'transient' },
    x: [0, 0.25, 0.5, 0.75, 1],
    xUnit: 's',
    traces: [
      { id: 'V:S1', label: 'CH1', unit: 'V', values: [0, 2, 0, -2, 0] },
      { id: 'V:S1:CH2', label: 'CH2', unit: 'V', values: [1, 0, -1, 0, 1] },
    ],
    ...extra,
  };
}

function display(extra = {}) {
  return engine.normalizeDisplay({
    traceIds: ['V:S1', 'V:S1:CH2', 'M:M1'],
    ch1: 'V:S1',
    ch2: 'V:S1:CH2',
    xyX: 'V:S1',
    xyY: 'V:S1:CH2',
    ...extra,
  });
}

function annotation(extra = {}) {
  return {
    id: 'A1',
    traceId: 'V:S1',
    at: 0.25,
    text: '峰值 <script>alert(1)</script>',
    mode: 'xt',
    axis: 'value',
    xTraceId: null,
    analysisKey: 'transient',
    ...extra,
  };
}

test('annotation storage is optional for legacy displays and deep-cloned through math edits and JSON sharing', () => {
  const legacy = display();
  assert.equal(Object.hasOwn(legacy, 'annotations'), false);
  assert.equal(
    Object.hasOwn(plot.resolveDisplay(result(), { display: legacy }), 'annotations'),
    false,
  );
  const saved = engine.validateDocument({
    version: 1,
    components: [],
    wires: [],
    analysis: { type: 'dc' },
    display: display({ annotations: [annotation()] }),
  });
  const restored = plot.resolveDisplay(result(), JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(restored.annotations, saved.display.annotations);
  restored.annotations[0].text = '新注释';
  assert.notEqual(restored.annotations[0].text, saved.display.annotations[0].text);
  const updated = engine.normalizeDisplay({
    ...restored,
    math: [{ id: 'M1', expression: 'CH1-CH2' }],
  });
  assert.equal(updated.annotations[0].text, '新注释');
  updated.annotations[0].at = 0.5;
  assert.equal(restored.annotations[0].at, 0.25);
  assert.deepEqual(engine.normalizeDisplay({ annotations: [] }).annotations, []);
});

test('strict annotation schema rejects unknown fields, malformed channels and unbounded data', () => {
  const invalid = [
    null,
    [],
    {},
    annotation({ id: '__proto__' }),
    annotation({ id: 'A'.repeat(41) }),
    annotation({ traceId: 'I:S1:CH2' }),
    annotation({ traceId: 'M:M9' }),
    annotation({ at: '0.25' }),
    annotation({ at: Infinity }),
    annotation({ at: NaN }),
    annotation({ at: 1e16 }),
    annotation({ text: 'x'.repeat(161) }),
    annotation({ text: {} }),
    annotation({ mode: 'map' }),
    annotation({ axis: 'screenY' }),
    annotation({ xTraceId: 'V:S1:CH2' }),
    annotation({ mode: 'xy', xTraceId: null }),
    annotation({ mode: 'xy', xTraceId: 'V:S1', axis: 'phase' }),
    annotation({ axis: 'phase' }),
    annotation({ analysisKey: 'sweep:R1:__proto__' }),
    annotation({ analysisKey: 'sweep:R1' }),
    annotation({ analysisKey: 'transient:0.5' }),
    { ...annotation(), url: 'https://evil.example' },
    JSON.parse(JSON.stringify(annotation()).replace('{', '{"__proto__":{},')),
  ];
  const missing = annotation();
  delete missing.xTraceId;
  invalid.push(missing);
  for (const value of invalid) {
    assert.throws(() => engine.normalizeAnnotation(value));
    assert.ok(annotations.resolve(value, result(), display()).error);
  }
  assert.deepEqual(engine.normalizeAnnotation(annotation()), annotation());
  for (const traceId of ['V:N1:P2', 'I:N1:P2', 'V:S1:CH2', 'M:M8'])
    assert.equal(engine.normalizeAnnotation(annotation({ traceId })).traceId, traceId);
  assert.throws(
    () => engine.normalizeDisplay({ annotations: [annotation(), annotation()] }),
    /重复/,
  );
  assert.throws(() => engine.normalizeDisplay({ annotations: Array(33).fill(annotation()) }), /32/);
});

test('XT markers snap to real samples and retain data units, including negative and descending sweeps', () => {
  const base = result();
  const marker = annotations.create(base, display(), { at: 0.3, text: '峰值' });
  assert.equal(marker.at, 0.25);
  assert.equal(marker.id, 'A1');
  const point = annotations.resolve(marker, base, display());
  assert.equal(point.index, 1);
  assert.equal(point.x, 0.25);
  assert.equal(point.y, 2);
  assert.equal(point.xUnit, 's');
  assert.equal(point.yUnit, 'V');
  const sweep = result({
    analysis: { type: 'sweep', componentId: 'V1', parameter: 'dc' },
    x: [2, 1, 0, -1, -2],
    xUnit: 'V',
  });
  const swept = annotations.create(sweep, display(), { at: -0.7 });
  assert.equal(swept.at, -1);
  assert.equal(swept.analysisKey, 'sweep:V1:dc');
  assert.equal(annotations.resolve(swept, sweep, display()).index, 3);
  assert.equal(
    annotations.create(sweep, display(), { at: -0.5 }).at,
    0,
    'ties retain the first sample in acquisition order',
  );
  assert.match(
    annotations.resolve(
      swept,
      { ...sweep, analysis: { type: 'sweep', componentId: 'V2', parameter: 'dc' } },
      display(),
    ).error,
    /扫描目标/,
  );
});

test('XY annotations use acquisition time, not the nonmonotonic horizontal curve value', () => {
  const settings = display({ mode: 'xy' });
  const marker = annotations.create(result(), settings, { at: 0.74, text: '下半周' });
  assert.equal(marker.at, 0.75);
  assert.equal(marker.traceId, 'V:S1:CH2');
  assert.equal(marker.xTraceId, 'V:S1');
  const point = annotations.resolve(marker, result(), settings);
  assert.deepEqual([point.index, point.x, point.y, point.xUnit, point.yUnit], [3, -2, 0, 'V', 'V']);
  assert.match(annotations.resolve(marker, result(), { ...settings, xyX: 'M:M1' }).error, /横纵轴/);
  assert.match(annotations.resolve(marker, result(), { ...settings, xyY: 'V:S1' }).error, /横纵轴/);
  assert.match(annotations.resolve(marker, result(), display()).error, /模式/);
});

test('annotations resolve calculated traces and AC phase without replacing invalid samples with other points', () => {
  const settings = display({ math: [{ id: 'M1', expression: 'CH1-CH2' }] });
  const computed = plot.buildResult(result(), settings).result;
  const marker = annotations.create(computed, settings, { traceId: 'M:M1', at: 0.5 });
  assert.equal(annotations.resolve(marker, computed, settings).y, 1);
  const brokenSettings = display({ math: [{ id: 'M1', expression: 'CH1/CH2' }] });
  const broken = plot.buildResult(result(), brokenSettings).result;
  assert.match(
    annotations.resolve({ ...marker, at: 0.25 }, broken, brokenSettings).error,
    /无有效数值/,
  );
  assert.throws(
    () => annotations.create(broken, brokenSettings, { traceId: 'M:M1', at: 0.26 }),
    /无有效数值/,
  );
  const ac = result({
    analysis: { type: 'ac' },
    x: [1, 10, 100],
    xUnit: 'Hz',
    traces: [
      { id: 'V:S1', unit: 'V', values: [1, 1, 1], phase: [0, 0, 0] },
      { id: 'V:S1:CH2', unit: 'V', values: [1, 1, 1], phase: [90, 90, 90] },
    ],
  });
  const acSettings = display({ phase: true, math: [{ id: 'M1', expression: 'CH1+CH2' }] });
  const acComputed = plot.buildResult(ac, acSettings).result;
  const acMarker = annotations.create(acComputed, acSettings, {
    traceId: 'M:M1',
    at: 10,
    axis: 'phase',
  });
  const acPoint = annotations.resolve(acMarker, acComputed, acSettings);
  assert.ok(Math.abs(acPoint.y - 45) < 1e-10);
  assert.deepEqual([acPoint.x, acPoint.xUnit, acPoint.yUnit], [10, 'Hz', '°']);
  assert.match(
    annotations.resolve(acMarker, acComputed, { ...acSettings, phase: false }).error,
    /相位图/,
  );
  assert.match(
    annotations.resolve(
      { ...acMarker, traceId: 'V:S1' },
      { ...ac, traces: [{ ...ac.traces[0], phase: [0, null, 0] }] },
      acSettings,
    ).error,
    /无有效数值/,
  );
});

test('missing traces, hidden channels, changed analysis and manual bounds hide annotations without relocating them', () => {
  const marker = annotation();
  const base = result();
  const cases = [
    [null, display(), /等待/],
    [{ ...base, analysis: { type: 'ac' } }, display(), /分析类型/],
    [{ ...base, traces: [] }, display(), /曲线不存在/],
    [base, display({ traceIds: [] }), /显示此标记的曲线/],
    [base, display({ mode: 'xy' }), /模式/],
    [base, display({ ranges: { xMax: 0.2 } }), /显示范围/],
    [base, display({ ranges: { yMax: 1.9 } }), /显示范围/],
  ];
  for (const [input, settings, error] of cases)
    assert.match(annotations.resolve(marker, input, settings).error, error);
  assert.match(annotations.resolve({ ...marker, at: -1e-10 }, base, display()).error, /仿真范围/);
  assert.match(
    annotations.resolve({ ...marker, at: 1.00000001 }, base, display()).error,
    /仿真范围/,
  );
  assert.equal(
    annotations.resolve(
      marker,
      base,
      display({ ranges: { xMin: 0.25, xMax: 0.5, yMin: 1, yMax: 2 } }),
    ).y,
    2,
  );
  const xySettings = display({ mode: 'xy', ranges: { xMin: -1, xMax: 1 } });
  assert.match(
    annotations.resolve(
      annotation({ mode: 'xy', traceId: 'V:S1:CH2', xTraceId: 'V:S1' }),
      base,
      xySettings,
    ).error,
    /显示范围/,
  );
  assert.equal(marker.at, 0.25);
});

test('marker creation allocates stable IDs, permits marker-only notes, and enforces the shared limit', () => {
  const settings = display({ annotations: [annotation(), annotation({ id: 'A3' })] });
  const created = annotations.create(result(), settings, { at: 0 });
  assert.equal(created.id, 'A2');
  assert.equal(created.text, '');
  assert.deepEqual(engine.normalizeAnnotation(created), created);
  const full = display({
    annotations: Array.from({ length: 32 }, (_, index) => annotation({ id: `A${index + 1}` })),
  });
  assert.throws(() => annotations.create(result(), full, { at: 0 }), /32/);
  assert.equal(annotations.create(result(), full, { id: 'A2', at: 0.5 }).at, 0.5);
  assert.equal(full.annotations[1].at, 0.25, 'creation never mutates saved annotations');
});

test('single-point DC and typed numeric arrays work in standalone browser execution', () => {
  const context = vm.createContext({});
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '../public/circuit-annotations.js'), 'utf8'),
    context,
  );
  const api = context.FreeBbsCircuitAnnotations;
  const dc = result({
    analysis: { type: 'dc' },
    x: new Float64Array([0]),
    traces: [{ id: 'V:S1', unit: 'V', values: new Float64Array([5]) }],
  });
  const marker = api.create(dc, display(), { at: 0 });
  assert.equal(api.resolve(marker, dc, display()).y, 5);
  assert.match(api.resolve({ ...marker, at: 0.01 }, dc, display()).error, /仿真范围/);
  assert.equal(
    api.analysisKey({ type: 'sweep', componentId: 'R1', parameter: 'resistance' }),
    'sweep:R1:resistance',
  );
  assert.equal(
    api.analysisKey({ type: 'sweep', componentId: '../R1', parameter: 'resistance' }),
    null,
  );
  assert.equal(api.analysisKey({ type: 'ac' }), 'ac');
  assert.equal(api.analysisKey(null), null);
});

test('point, vertical and horizontal markers preserve saved styles without migrating legacy objects', () => {
  const legacy = annotation();
  assert.deepEqual(engine.normalizeAnnotation(legacy), legacy);
  assert.equal(
    Object.hasOwn(annotations.create(result(), display(), { at: 0.25 }), 'marker'),
    false,
  );
  for (const marker of ['point', 'vertical', 'horizontal']) {
    const created = annotations.create(result(), display(), { at: 0.3, marker });
    assert.equal(created.at, 0.25);
    assert.equal(created.marker, marker);
    assert.equal(engine.normalizeAnnotation(created).marker, marker);
    assert.equal(annotations.resolve(created, result(), display()).y, 2);
  }
  for (const marker of [null, '', 'diagonal', {}, [], 1, undefined]) {
    const bad = annotation({ marker });
    assert.throws(() => engine.normalizeAnnotation(bad), /样式/);
    assert.ok(annotations.resolve(bad, result(), display()).error);
  }
});

test('reference lines retain their visible axis when the anchored point is clipped on the other axis', () => {
  const croppedY = display({ ranges: { xMin: 0, xMax: 1, yMin: -1, yMax: 1 } });
  assert.match(annotations.resolve(annotation(), result(), croppedY).error, /范围之外/);
  assert.equal(annotations.resolve(annotation({ marker: 'vertical' }), result(), croppedY).y, 2);
  assert.match(
    annotations.resolve(annotation({ marker: 'horizontal' }), result(), croppedY).error,
    /范围之外/,
  );
  const croppedX = display({ ranges: { xMin: 0.5, xMax: 1, yMin: -3, yMax: 3 } });
  assert.equal(
    annotations.resolve(annotation({ marker: 'horizontal' }), result(), croppedX).x,
    0.25,
  );
  assert.match(
    annotations.resolve(annotation({ marker: 'vertical' }), result(), croppedX).error,
    /范围之外/,
  );
  const xy = display({ mode: 'xy', ranges: { xMin: -1, xMax: 1, yMin: -1, yMax: 1 } });
  const horizontal = annotations.create(result(), xy, { at: 0.25, marker: 'horizontal' });
  assert.deepEqual(
    [
      annotations.resolve(horizontal, result(), xy).x,
      annotations.resolve(horizontal, result(), xy).y,
    ],
    [2, 0],
  );
  assert.match(
    annotations.resolve({ ...horizontal, marker: 'point' }, result(), xy).error,
    /范围之外/,
  );
  const invalid = result({ traces: [{ id: 'V:S1', values: [0, NaN, 0, 0, 0], unit: 'V' }] });
  assert.match(
    annotations.resolve(annotation({ marker: 'vertical' }), invalid, croppedY).error,
    /无有效数值/,
  );
});
