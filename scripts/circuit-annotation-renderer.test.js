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

test('annotations retain safe full text, bounds and separate labels on a narrow chart, and support selection', () => {
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
  assert.equal(rendered.length, 32);
  assert.equal(container.all((item) => item.tagName === 'script').length, 0);
  assert.ok(rendered.every((item) => item.getAttribute('aria-label').includes(text)));
  const boxes = container
    .all((item) => item.getAttribute('data-annotation-label'))
    .map((item) =>
      Object.fromEntries(
        ['x', 'y', 'width', 'height'].map((key) => [key, Number(item.getAttribute(key))]),
      ),
    );
  boxes.forEach((box, index) => {
    assert.ok(box.x >= 65 && box.x + box.width <= 276);
    assert.ok(box.y >= 20 && box.y + box.height <= 252);
    boxes.slice(index + 1).forEach((other) => {
      assert.ok(
        box.x + box.width <= other.x ||
          other.x + other.width <= box.x ||
          box.y + box.height <= other.y ||
          other.y + other.height <= box.y,
      );
    });
  });
  rendered[0].emit('click');
  rendered[1].emit('keydown', { key: 'Enter' });
  assert.deepEqual(selected, ['A1', 'A2']);
  pick(svgCharts(container)[0], { target: rendered[0].children[0] });
  assert.equal(picked.length, 0);
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
