const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const nodePath = require('node:path');
const vm = require('node:vm');
const {
  xySampleIndices,
  nearestXYSample,
  waveformSampleIndices,
  getPins,
  transformPoint,
} = require('../public/circuit-renderer');

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
}
function harness() {
  const context = vm.createContext({
    document: {
      createElement: (tag) => new Element(tag),
      createElementNS: (_, tag) => new Element(tag),
    },
  });
  vm.runInContext(
    fs.readFileSync(nodePath.join(__dirname, '../public/circuit-renderer.js'), 'utf8'),
    context,
  );
  return { renderer: context.FreeBbsCircuitRenderer, container: new Element('div') };
}
const trace = (id, values, unit = 'V') => ({ id, label: id, values, unit });
const waveformPath = (container) =>
  container.all((item) => item.getAttribute('vector-effect') === 'non-scaling-stroke')[0];

test('XY plotting preserves negative quadrants and the chronological closed ellipse, even if logX is requested', () => {
  const { renderer, container } = harness();
  const result = {
    x: [0, 1, 2, 3, 4],
    xUnit: 's',
    traces: [trace('V:S:CH1', [2, 0, -2, 0, 2]), trace('V:S:CH2', [0, 1, 0, -1, 0])],
  };
  const before = JSON.stringify(result);
  const drawing = renderer.renderWaveform(container, result, {
    mode: 'xy',
    ch1: 'V:S:CH1',
    ch2: 'V:S:CH2',
    logX: true,
    ranges: { xMin: -2, xMax: 2, yMin: -1, yMax: 1 },
  });
  const path = waveformPath(container);
  assert.equal(
    path.getAttribute('d'),
    'M 896.000 136.000 L 486.000 20.000 L 76.000 136.000 L 486.000 252.000 L 896.000 136.000',
  );
  assert.match(path.getAttribute('clip-path'), /^url\(#circuit-plot-clip-\d+\)$/);
  assert.equal(path.getAttribute('data-x-trace-id'), 'V:S:CH1');
  assert.equal(path.getAttribute('data-trace-id'), 'V:S:CH2');
  assert.match(container.textContent, /-2 V/);
  assert.match(container.textContent, /-1 V/);
  const group = container.children[0];
  assert.deepEqual(JSON.parse(group.getAttribute('data-trace-ids')), ['V:S:CH1', 'V:S:CH2']);
  const svg = container.all((item) => item.tagName === 'svg')[0];
  svg.listeners.get('pointerdown')({ clientX: 486, clientY: 250 });
  assert.match(container.textContent, /3 s · X · V:S:CH1: 0 V · Y · V:S:CH2: -1 V/);
  assert.equal(JSON.stringify(result), before);
  drawing.destroy();
  assert.equal(container.children.length, 0);
});

test('XY cursor minimizes screen-space distance across both dimensions instead of binary-searching X', () => {
  assert.equal(nearestXYSample([0, 0, 0], [-1, 0, 1], 0.01, 0.99), 2);
  assert.equal(nearestXYSample([NaN, 0, 4], [1, NaN, 2], 0, 0), 2);
  assert.equal(nearestXYSample([NaN], [1], 0, 0), -1);
  assert.equal(nearestXYSample([0, 1], [1, 0], 0, 0, 10, 1), 0);
  assert.equal(nearestXYSample([0, 1], [1, 0], 0, 0, 1, 10), 1);
});

test('large XY traces retain X and Y spikes, sample order, endpoints and holes with bounded vertices', () => {
  const x = Array.from({ length: 100001 }, (_, index) => Math.cos(index / 1000));
  const y = x.map((_, index) => Math.sin(index / 1000));
  x[12345] = -100;
  x[12346] = 101;
  y[44444] = -100;
  y[44445] = 101;
  y[50000] = NaN;
  const selected = xySampleIndices(x, y, 250);
  for (const index of [0, 12345, 12346, 44444, 44445, 49999, 50000, 50001, 100000])
    assert.ok(selected.includes(index), String(index));
  assert.ok(selected.length < 250 * 6 + 12);
  assert.ok(selected.every((value, index) => !index || value > selected[index - 1]));
});

test('undefined mathematical samples create gaps in XT and XY paths, including after downsampling', () => {
  for (const count of [7, 10001]) {
    const x = Array.from({ length: count }, (_, index) => index);
    const values = x.map((value) => value * 2);
    values[Math.floor(count / 2)] = NaN;
    const indices = waveformSampleIndices(x, values, 250);
    assert.ok(indices.includes(Math.floor(count / 2)));
    for (const mode of ['xt', 'xy']) {
      const { renderer, container } = harness();
      renderer.renderWaveform(
        container,
        { x, traces: [trace('X', x), trace('M:M1', values)] },
        {
          mode,
          xyX: 'X',
          xyY: 'M:M1',
          traceIds: ['M:M1'],
        },
      );
      const d = waveformPath(container).getAttribute('d');
      assert.equal((d.match(/M /g) || []).length, 2, `${mode} ${count}`);
      assert.doesNotMatch(d, /NaN|Infinity/);
    }
  }
  const { renderer, container } = harness();
  renderer.renderWaveform(container, { x: [0], traces: [trace('M:M1', [NaN])] });
  assert.equal(container.all((item) => item.tagName === 'circle').length, 0);
  assert.equal(waveformPath(container).getAttribute('d'), '');
});

test('manual XT ranges set tick endpoints and clip out-of-range samples without changing the result', () => {
  const { renderer, container } = harness();
  const result = { x: [0, 1, 2], xUnit: 's', traces: [trace('V:R', [-100, 0, 100])] };
  renderer.renderWaveform(container, result, {
    ranges: { xMin: 0.5, xMax: 1.5, yMin: -1, yMax: 1 },
  });
  assert.match(container.textContent, /500 ms/);
  assert.match(container.textContent, /1.5 s/);
  assert.match(container.textContent, /-1 V/);
  const path = waveformPath(container);
  assert.match(path.getAttribute('clip-path'), /^url\(#circuit-plot-clip-\d+\)$/);
  assert.equal(result.traces[0].values[0], -100);
});

test('descending XT sweeps keep scan direction and exact cursor readings with automatic and fixed ranges', () => {
  for (const ranges of [{}, { xMin: 0, xMax: 3, yMin: 0, yMax: 30 }]) {
    const { renderer, container } = harness();
    renderer.renderWaveform(
      container,
      {
        x: [3, 2, 1, 0],
        xUnit: 'V',
        xLabel: '扫描 V1',
        traces: [trace('I:R1', [0, 10, 20, 30], 'A')],
      },
      { ranges },
    );
    const d = waveformPath(container).getAttribute('d');
    assert.match(d, /^M 76\.000 /);
    assert.match(d, /L 896\.000 /);
    const svg = container.all((item) => item.tagName === 'svg')[0];
    svg.listeners.get('pointermove')({ clientX: 76 + (820 * 2) / 3, clientY: 100 });
    assert.match(container.textContent, /1 V · I:R1: 20 A/);
  }
});

test('a mathematical degree unit renders its values independently from an AC phase chart', () => {
  for (const phase of [false, true]) {
    const { renderer, container } = harness();
    renderer.renderWaveform(
      container,
      {
        x: [1, 2],
        traces: [{ ...trace('M:M1', [10, 20], '°'), phase: [-90, -90] }],
      },
      { phase },
    );
    const paths = container.all(
      (item) => item.getAttribute('vector-effect') === 'non-scaling-stroke',
    );
    assert.equal(paths.length, phase ? 2 : 1);
    assert.match(paths[0].getAttribute('d'), /^M .+ L /);
    if (phase) assert.notEqual(paths[0].getAttribute('d'), paths[1].getAttribute('d'));
  }
});

test('four-pin devices retain channel and port identities through mirrors and rotations', () => {
  for (const type of ['oscilloscope2', 'twoport']) {
    for (const rotation of [0, 90, 180, 270]) {
      for (const mirrorX of [false, true]) {
        for (const mirrorY of [false, true]) {
          const part = {
            id: 'X',
            type,
            x: 300,
            y: 200,
            rotation,
            mirrorX,
            mirrorY,
            params: { parameterSet: 'ABCD' },
          };
          const pins = getPins(part);
          const prefix = type === 'oscilloscope2' ? 'CH' : 'P';
          assert.deepEqual(
            pins.map((pin) => pin.label),
            [`${prefix}1+`, `${prefix}1−`, `${prefix}2+`, `${prefix}2−`],
          );
          [
            [-60, -22],
            [-60, 22],
            [60, -22],
            [60, 22],
          ].forEach(([x, y], index) => {
            const point = transformPoint(part, x, y);
            assert.equal(pins[index].x, 300 + point.x);
            assert.equal(pins[index].y, 200 + point.y);
          });
          const { renderer, container } = harness();
          renderer.renderSchematic(container, { components: [part], wires: [] });
          assert.match(container.textContent, new RegExp(`${prefix}1`));
          assert.match(container.textContent, new RegExp(`${prefix}2`));
        }
      }
    }
  }
});

test('MOS arrows sit on the source lead and follow its outward/inward direction under every transform', () => {
  for (const polarity of ['n', 'p']) {
    for (const rotation of [0, 90, 180, 270]) {
      for (const mirrorX of [false, true]) {
        for (const mirrorY of [false, true]) {
          const part = {
            id: 'M',
            type: 'mosfet',
            x: 300,
            y: 200,
            rotation,
            mirrorX,
            mirrorY,
            params: { polarity, w: 1, l: 1 },
          };
          const { renderer, container } = harness();
          renderer.renderSchematic(container, { components: [part], wires: [] });
          const arrow = container.all(
            (item) => item.getAttribute('data-mos-source-arrow') !== null,
          )[0];
          assert.equal(
            arrow.getAttribute('data-mos-source-arrow'),
            polarity === 'p' ? 'in' : 'out',
          );
          const coordinates = arrow.getAttribute('d').match(/-?\d+/g).map(Number);
          const [baseX, baseY, tipX, tipY] = coordinates;
          assert.ok(Math.min(...coordinates.filter((_, index) => index % 2)) > 20);
          const base = transformPoint(part, 0, baseY);
          const tip = transformPoint(part, tipX, tipY);
          const source = getPins(part)[2];
          const sourceDirection = { x: source.x - 300, y: source.y - 200 };
          const direction =
            (tip.x - base.x) * sourceDirection.x + (tip.y - base.y) * sourceDirection.y;
          assert.ok(polarity === 'n' ? direction > 0 : direction < 0);
          assert.equal(baseX, -5);
        }
      }
    }
  }
});
