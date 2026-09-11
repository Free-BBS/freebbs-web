const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const annotations = require('../public/circuit-annotations');

class Element {
  constructor(tagName) {
    this.tagName = tagName;
    this.attributes = new Map();
    this.children = [];
    this.style = {};
    this.listeners = new Map();
    this.clientWidth = 920;
    this.content = '';
  }

  setAttribute(key, value) {
    this.attributes.set(key, String(value));
  }

  getAttribute(key) {
    return this.attributes.get(key) ?? null;
  }

  append(...children) {
    children.forEach((child) => {
      Object.assign(child, { parent: this });
    });
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }

  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((item) => item !== this);
  }

  addEventListener(key, listener) {
    this.listeners.set(key, listener);
  }

  set textContent(value) {
    this.content = String(value);
    this.children = [];
  }

  get textContent() {
    return this.content + this.children.map((item) => item.textContent).join('');
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, width: this.clientWidth, height: 310 };
  }

  all(predicate) {
    return [
      ...(predicate(this) ? [this] : []),
      ...this.children.flatMap((item) => item.all(predicate)),
    ];
  }

  emit(type, properties = {}) {
    this.listeners.get(type)?.({
      target: this,
      pointerId: 1,
      clientX: 486,
      clientY: 136,
      button: 0,
      preventDefault() {},
      stopPropagation() {},
      ...properties,
    });
  }
}

function harness() {
  const context = vm.createContext({
    FreeBbsCircuitAnnotations: annotations,
    document: {
      createElement: (tag) => new Element(tag),
      createElementNS: (_, tag) => new Element(tag),
    },
  });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '../public/circuit-renderer.js'), 'utf8'),
    context,
  );
  return { renderer: context.FreeBbsCircuitRenderer, container: new Element('div') };
}

const trace = (id, values, unit = 'V') => ({ id, label: id, values, unit });
const result = (traces, values = [0, 1, 2]) => ({
  analysis: { type: 'transient' },
  x: values,
  xUnit: 's',
  traces,
});
const saved = (changes = {}) => ({
  id: 'A1',
  traceId: 'V:R1',
  at: 1,
  text: '峰值',
  mode: 'xt',
  axis: 'value',
  xTraceId: null,
  analysisKey: 'transient',
  ...changes,
});
const svgCharts = (container) => container.all((item) => item.tagName === 'svg');
const markers = (container) => container.all((item) => item.getAttribute('data-annotation-id'));
const legends = (container) =>
  container.all((item) => item.getAttribute('data-annotation-legend-id'));
const pick = (svg, point = {}) => {
  svg.emit('pointerdown', point);
  svg.emit('pointerup', point);
};

function draw(simulation, options = {}) {
  const { renderer, container } = harness();
  const picks = [];
  renderer.renderWaveform(container, simulation, {
    annotationPicking: true,
    onPointPick: (value) => picks.push(value),
    ...options,
  });
  return { container, charts: svgCharts(container), picks };
}

test('XT picks the closest finite original sample across visible traces and units without changing the result', () => {
  const simulation = result([
    trace('V:R1', [0, 1, 0]),
    trace('M:M1', [0, NaN, 0]),
    trace('I:R2', [0, 2, 0], 'A'),
  ]);
  const original = JSON.stringify(simulation);
  const { charts, picks } = draw(simulation, {
    traceIds: ['V:R1', 'M:M1', 'I:R2'],
    ranges: { xMin: 0, xMax: 2, yMin: 0, yMax: 2 },
  });
  pick(charts[0]);
  assert.deepEqual(JSON.parse(JSON.stringify(picks[0])), {
    traceId: 'V:R1',
    at: 1,
    axis: 'value',
    mode: 'xt',
    xTraceId: null,
  });
  pick(charts[1], { clientY: 20 });
  assert.equal(picks[1].traceId, 'I:R2');
  assert.equal(picks[1].at, 1);
  assert.equal(JSON.stringify(simulation), original);
});

test('sample picking skips math gaps and clipped samples and ignores axes outside the plot', () => {
  const { charts, picks } = draw(result([trace('M:M1', [20, NaN, 1, 2])], [0, 1, 2, 3]), {
    traceIds: ['M:M1'],
    ranges: { xMin: 0, xMax: 3, yMin: 0, yMax: 2 },
  });
  pick(charts[0], { clientX: 76, clientY: 20 });
  assert.equal(picks[0].at, 2);
  pick(charts[0], { clientX: 10 });
  pick(charts[0], { clientY: 285 });
  assert.equal(picks.length, 1);
  const allInvalid = draw(result([trace('M:M1', [NaN, NaN, NaN])]), { traceIds: ['M:M1'] });
  pick(allInvalid.charts[0]);
  assert.equal(allInvalid.picks.length, 0);
});

test('picking uses full samples, screen-space log coordinates and descending sweep coordinates', () => {
  const count = 10001;
  const values = Array.from({ length: count }, () => 0);
  values[4321] = 1;
  const large = draw(
    result(
      [trace('V:R1', values)],
      values.map((_, index) => index),
    ),
    { ranges: { xMin: 0, xMax: count - 1, yMin: 0, yMax: 1 } },
  );
  pick(large.charts[0], { clientX: 76 + (820 * 4321) / 10000, clientY: 20 });
  assert.equal(large.picks[0].at, 4321);
  const log = draw(
    { ...result([trace('V:R1', [0, 1, 0])], [1, 10, 100]), analysis: { type: 'ac' }, xUnit: 'Hz' },
    { logX: true, ranges: { yMin: 0, yMax: 1 } },
  );
  pick(log.charts[0], { clientY: 20 });
  assert.equal(log.picks[0].at, 10);
  const descending = draw(result([trace('V:R1', [0, 1, 0])], [3, 2, 1]), {
    ranges: { yMin: 0, yMax: 1 },
  });
  pick(descending.charts[0], { clientY: 20 });
  assert.equal(descending.picks[0].at, 2);
});

test('a tap creates exactly one pick; scrolling, dragging back, cancel and other pointers create none', () => {
  const {
    charts: [svg],
    picks,
  } = draw(result([trace('V:R1', [0, 1, 0])]));
  svg.emit('pointermove');
  svg.emit('pointerdown');
  svg.emit('pointermove', { clientX: 500 });
  svg.emit('pointermove');
  svg.emit('pointerup');
  svg.emit('pointerdown');
  svg.emit('pointercancel');
  svg.emit('pointerup');
  svg.emit('pointerdown');
  svg.emit('pointerleave');
  svg.emit('pointerup');
  svg.emit('pointerdown');
  svg.emit('pointerup', { pointerId: 2 });
  pick(svg, { button: 2 });
  pick(svg, { isPrimary: false });
  assert.equal(picks.length, 0);
  pick(svg);
  assert.equal(picks.length, 1);
  svg.emit('pointerup');
  assert.equal(picks.length, 1);
  const inspection = draw(result([trace('V:R1', [0, 1, 0])]), { annotationPicking: false });
  pick(inspection.charts[0]);
  assert.equal(inspection.picks.length, 0);
  assert.match(inspection.container.textContent, /1 s · V:R1: 1 V/);
});

test('XY picks preserve base sample time even when horizontal coordinates repeat', () => {
  const simulation = result(
    [trace('V:S', [1, 0, -1, 0, 1]), trace('V:S:CH2', [0, 1, 0, -1, 0])],
    [0, 0.1, 0.2, 0.3, 0.4],
  );
  const options = {
    mode: 'xy',
    xyX: 'V:S',
    xyY: 'V:S:CH2',
    ranges: { xMin: -1, xMax: 1, yMin: -1, yMax: 1 },
  };
  const { charts, picks, container } = draw(simulation, {
    ...options,
    annotations: [saved({ traceId: 'V:S:CH2', xTraceId: 'V:S', at: 0.3, mode: 'xy' })],
  });
  pick(charts[0], { clientX: 486, clientY: 252 });
  assert.deepEqual(JSON.parse(JSON.stringify(picks[0])), {
    traceId: 'V:S:CH2',
    at: 0.3,
    axis: 'value',
    mode: 'xy',
    xTraceId: 'V:S',
  });
  assert.equal(markers(container).length, 1);
  assert.match(
    markers(container)[0].getAttribute('aria-label'),
    /300 ms.*X · V:S: 0 V.*Y · V:S:CH2: -1 V/,
  );
});

test('AC phase markers and picks target the phase chart independently from degree-valued maths', () => {
  const simulation = {
    ...result([{ ...trace('M:M1', [0, 30, 0], '°'), phase: [0, -90, 0] }], [1, 10, 100]),
    analysis: { type: 'ac' },
    xUnit: 'Hz',
  };
  const { charts, picks, container } = draw(simulation, {
    phase: true,
    logX: true,
    annotations: [saved({ traceId: 'M:M1', at: 10, axis: 'phase', analysisKey: 'ac' })],
  });
  assert.equal(markers(charts[0]).length, 0);
  assert.equal(markers(charts[1]).length, 1);
  pick(charts[1], { clientY: 230 });
  assert.equal(picks[0].axis, 'phase');
  assert.equal(picks[0].at, 10);
  assert.match(markers(container)[0].getAttribute('aria-label'), /相位: -90 °/);
});

test('narrow charts keep all annotation text in external legends and retain accessible selection', () => {
  const { renderer, container } = harness();
  container.clientWidth = 300;
  const selected = [];
  const picked = [];
  const text = '<script>alert(1)</script>\n拐点说明 & 这是很长的注释'.repeat(3);
  const values = Array.from({ length: 32 }, (_, index) =>
    saved({ id: `A${index + 1}`, text, at: index < 16 ? 0 : 2 }),
  );
  renderer.renderWaveform(container, result([trace('V:R1', [0, 1, 2])]), {
    annotations: values,
    ranges: { xMin: 0, xMax: 2, yMin: 0, yMax: 2 },
    onAnnotationSelect: (id) => selected.push(id),
    annotationPicking: true,
    onPointPick: (value) => picked.push(value),
  });
  const rendered = markers(container);
  const entries = legends(container);
  assert.equal(rendered.length, 32);
  assert.equal(entries.length, 32);
  assert.equal(container.all((item) => item.tagName === 'script').length, 0);
  assert.ok(rendered.every((item) => item.getAttribute('aria-label').includes(text)));
  assert.ok(entries.every((item) => item.textContent.includes(text)));
  assert.ok(entries.every((item) => item.tagName === 'button'));
  assert.ok(entries.every((item) => item.getAttribute('type') === 'button'));
  assert.ok(entries.every((item) => item.getAttribute('aria-label').startsWith('编辑标记')));
  assert.equal(legends(svgCharts(container)[0]).length, 0);
  rendered.forEach((marker) => {
    assert.equal(marker.all((item) => ['text', 'rect', 'path'].includes(item.tagName)).length, 0);
    const circle = marker.all((item) => item.getAttribute('data-annotation-point'))[0];
    assert.equal(circle.getAttribute('fill'), 'none');
    assert.equal(circle.getAttribute('r'), '4');
    assert.ok(Number(circle.getAttribute('cx')) >= 65);
    assert.ok(Number(circle.getAttribute('cx')) <= 276);
    assert.ok(Number(circle.getAttribute('cy')) >= 20);
    assert.ok(Number(circle.getAttribute('cy')) <= 252);
    assert.match(marker.getAttribute('clip-path'), /^url\(#circuit-plot-clip-/);
  });
  rendered[0].emit('click');
  rendered[1].emit('keydown', { key: 'Enter' });
  rendered[2].emit('keydown', { key: ' ' });
  entries[3].emit('click');
  assert.deepEqual(selected, ['A1', 'A2', 'A3', 'A4']);
  // Legend buttons use native keyboard activation; a second key handler would double-edit.
  assert.equal(entries[3].listeners.has('keydown'), false);
  pick(svgCharts(container)[0], { target: rendered[0].children[0] });
  entries[0].emit('pointerdown');
  entries[0].emit('pointerup');
  assert.equal(picked.length, 0);
});

test('point, vertical and horizontal markers match legend symbols without covering the chart with text', () => {
  const { container, charts } = draw(result([trace('V:R1', [0, 1, 2])]), {
    annotations: [
      saved(),
      saved({ id: 'A2', marker: 'vertical', at: 0, text: '起点' }),
      saved({ id: 'A3', marker: 'horizontal', at: 2, text: '上限' }),
    ],
    ranges: { xMin: 0, xMax: 2, yMin: 0, yMax: 2 },
  });
  const rendered = markers(container);
  assert.deepEqual(
    rendered.map((item) => item.getAttribute('data-annotation-marker')),
    ['point', 'vertical', 'horizontal'],
  );
  const lines = charts[0].all((item) => item.getAttribute('data-annotation-line'));
  assert.equal(lines.length, 2);
  assert.deepEqual(
    ['x1', 'x2', 'y1', 'y2'].map((key) => Number(lines[0].getAttribute(key))),
    [76, 76, 20, 252],
  );
  assert.deepEqual(
    ['x1', 'x2', 'y1', 'y2'].map((key) => Number(lines[1].getAttribute(key))),
    [76, 896, 20, 20],
  );
  lines.forEach((line) => assert.equal(line.getAttribute('stroke-dasharray'), '5 4'));
  const entries = legends(container);
  entries.forEach((entry, index) => {
    const kind = rendered[index].getAttribute('data-annotation-marker');
    assert.equal(entry.children[0].className, `circuit-wave-annotation-swatch is-${kind}`);
    const shape = rendered[index].all(
      (item) =>
        item.getAttribute('data-annotation-point') || item.getAttribute('data-annotation-line'),
    )[0];
    assert.equal(entry.children[0].style.color, shape.getAttribute('stroke'));
  });
  assert.match(entries[1].textContent, /2 · 竖线 · 起点.*0 s · V:R1: 0 V/);
  assert.match(entries[2].textContent, /3 · 横线 · 上限.*2 s · V:R1: 2 V/);
});

test('reference lines survive clipping on the other axis and stay inside the owning unit chart', () => {
  const { container, charts } = draw(
    result([trace('V:R1', [0, 10, 0]), trace('I:R2', [0.5, 0.5, 0.5], 'A')]),
    {
      ranges: { xMin: 0.5, xMax: 1.5, yMin: 0, yMax: 1 },
      annotations: [
        saved({ marker: 'vertical' }),
        saved({ id: 'A2', traceId: 'I:R2', marker: 'horizontal', at: 0 }),
        saved({ id: 'A3', marker: 'point' }),
        saved({ id: 'A4', marker: 'vertical', at: 0 }),
        saved({ id: 'A5', marker: 'horizontal' }),
      ],
    },
  );
  assert.deepEqual(
    markers(charts[0]).map((item) => item.getAttribute('data-annotation-id')),
    ['A1'],
  );
  assert.deepEqual(
    markers(charts[1]).map((item) => item.getAttribute('data-annotation-id')),
    ['A2'],
  );
  assert.deepEqual(
    legends(container).map((item) => item.getAttribute('data-annotation-legend-id')),
    ['A1', 'A2'],
  );
  assert.match(legends(charts[0].parent)[0].textContent, /V:R1: 10 V/);
  assert.match(legends(charts[1].parent)[0].textContent, /0 s · I:R2: 500 mA/);
});

test('XY and logarithmic phase reference lines use projected coordinates and keep their own chart legend', () => {
  const xy = draw(result([trace('V:R1', [-3, 1, 0]), trace('V:R2', [0.5, 5, 1])]), {
    mode: 'xy',
    xyX: 'V:R1',
    xyY: 'V:R2',
    ranges: { xMin: 0, xMax: 2, yMin: 0, yMax: 2 },
    annotations: [
      saved({ traceId: 'V:R2', xTraceId: 'V:R1', mode: 'xy', marker: 'vertical' }),
      saved({
        id: 'A2',
        traceId: 'V:R2',
        xTraceId: 'V:R1',
        mode: 'xy',
        marker: 'horizontal',
        at: 0,
      }),
    ],
  });
  const xyLines = xy.charts[0].all((item) => item.getAttribute('data-annotation-line'));
  assert.equal(xyLines.length, 2);
  assert.equal(Number(xyLines[0].getAttribute('x1')), 486);
  assert.equal(Number(xyLines[1].getAttribute('y1')), 194);
  assert.match(legends(xy.container)[0].textContent, /1 s · X · V:R1: 1 V · Y · V:R2: 5 V/);
  const ac = draw(
    {
      ...result([{ ...trace('V:R1', [0, 1, 2]), phase: [-10, -90, -180] }], [1, 10, 100]),
      analysis: { type: 'ac' },
      xUnit: 'Hz',
    },
    {
      phase: true,
      logX: true,
      ranges: { yMin: 0, yMax: 2 },
      annotations: [saved({ marker: 'vertical', at: 10, axis: 'phase', analysisKey: 'ac' })],
    },
  );
  assert.equal(markers(ac.charts[0]).length, 0);
  const phaseLine = ac.charts[1].all((item) => item.getAttribute('data-annotation-line'))[0];
  assert.equal(Number(phaseLine.getAttribute('x1')), 486);
  assert.match(legends(ac.charts[1].parent)[0].textContent, /10 Hz · V:R1 · 相位: -90 °/);
});

test('read-only shared charts show the same full legends without offering an edit action', () => {
  const { container } = draw(result([trace('V:R1', [0, 1, 2])]), {
    annotations: [saved({ marker: 'vertical', text: '分享注释完整保留' })],
    annotationPicking: false,
  });
  assert.equal(markers(container)[0].getAttribute('role'), 'note');
  assert.equal(markers(container)[0].listeners.has('click'), false);
  assert.equal(markers(container)[0].listeners.has('keydown'), false);
  const entry = legends(container)[0];
  assert.equal(entry.tagName, 'div');
  assert.equal(entry.getAttribute('tabindex'), null);
  assert.equal(entry.getAttribute('role'), null);
  assert.equal(entry.listeners.has('click'), false);
  assert.match(entry.textContent, /1 · 竖线 · 分享注释完整保留.*1 s · V:R1: 1 V/);
});

test('stale analysis, hidden channels, invalid samples and out-of-range annotations stay hidden', () => {
  const { container } = draw(result([trace('V:R1', [0, NaN, 2]), trace('V:R2', [0, 1, 2])]), {
    traceIds: ['V:R1'],
    ranges: { xMin: 0, xMax: 1, yMin: 0, yMax: 1 },
    annotations: [
      saved(),
      saved({ id: 'A2', traceId: 'V:R2' }),
      saved({ id: 'A3', at: 2 }),
      saved({ id: 'A4', at: 0, analysisKey: 'ac' }),
    ],
  });
  assert.equal(markers(container).length, 0);
});

test('shared embed lists only hidden annotations and preserves their recovery reason', () => {
  const { renderer, container } = harness();
  const hidden = new Element('ol');
  const summary = new Element('p');
  const simulation = result([trace('V:R1', [0, 1, 2]), trace('V:R2', [0, 1, 2])]);
  const context = vm.createContext({
    state: {
      result: simulation,
      display: {
        mode: 'xt',
        annotations: [
          saved({ marker: 'vertical', text: '可见说明只放图例' }),
          saved({ id: 'A2', traceId: 'V:R2', text: '隐藏说明仍然保留' }),
        ],
      },
      traceIds: new Set(['V:R1']),
      circuit: { document: { analysis: simulation.analysis } },
    },
    waveform: container,
    waves: { hidden: false, open: true },
    phase: { checked: false },
    renderer,
    annotations,
    reportHeight() {},
    document: {
      createElement: (tag) => new Element(tag),
      getElementById: (id) =>
        ({ 'embed-channel-summary': summary, 'embed-annotations': hidden })[id],
    },
  });
  const source = fs.readFileSync(path.join(__dirname, '../public/circuit-embed.js'), 'utf8');
  const start = source.indexOf('  function redrawWaveform() {');
  const end = source.indexOf('  function setupChannels() {', start);
  vm.runInContext(`${source.slice(start, end)}\nredrawWaveform();`, context);
  assert.equal(legends(container).length, 1);
  assert.match(legends(container)[0].textContent, /可见说明只放图例/);
  assert.equal(hidden.children.length, 1);
  assert.equal(hidden.hidden, false);
  assert.match(hidden.textContent, /标记 2 · V:R2.*隐藏说明仍然保留.*显示此标记的曲线后可查看标记/);
  assert.doesNotMatch(hidden.textContent, /可见说明只放图例/);
  context.state.traceIds.add('V:R2');
  vm.runInContext('redrawWaveform();', context);
  assert.equal(legends(container).length, 2);
  assert.equal(hidden.children.length, 0);
  assert.equal(hidden.hidden, true);
});

test('SVG annotations do not intercept global modified shortcuts, IME confirmation or repeated activation', () => {
  const selected = [];
  const { container } = draw(result([trace('V:R1', [0, 1, 2])]), {
    annotations: [saved()],
    onAnnotationSelect: (id) => selected.push(id),
  });
  const marker = markers(container)[0];
  for (const modifier of [
    { ctrlKey: true },
    { metaKey: true },
    { altKey: true },
    { isComposing: true },
    { keyCode: 229 },
    { getModifierState: (key) => key === 'AltGraph' },
  ]) {
    marker.emit('keydown', {
      key: 'Enter',
      ...modifier,
      preventDefault() {
        assert.fail('modified shortcuts must reach the global handler');
      },
      stopPropagation() {
        assert.fail('modified shortcuts must continue bubbling');
      },
    });
  }
  marker.emit('keydown', { key: 'Enter', repeat: true });
  assert.equal(selected.length, 0);
  marker.emit('keydown', { key: 'Enter' });
  assert.deepEqual(selected, ['A1']);
});
