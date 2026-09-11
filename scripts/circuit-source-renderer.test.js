const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  componentValue,
  waveformSampleIndices,
  nearestWaveformSample,
} = require('../public/circuit-renderer');

class Element {
  constructor(tag) {
    this.tagName = tag;
    this.attributes = new Map();
    this.children = [];
    this.listeners = new Map();
    this.style = {};
    this.clientWidth = 920;
    this.content = '';
  }

  set textContent(value) {
    this.content = String(value);
    this.children = [];
  }

  get textContent() {
    return this.content + this.children.map((child) => child.textContent).join('');
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.content = '';
    this.children = children;
  }

  addEventListener(name, listener) {
    this.listeners.set(name, listener);
  }

  getBoundingClientRect() {
    return { left: 0, width: this.clientWidth };
  }

  all(predicate) {
    return [
      ...(predicate(this) ? [this] : []),
      ...this.children.flatMap((child) => child.all(predicate)),
    ];
  }
}

function harness() {
  const document = {
    createElementNS: (_, tag) => new Element(tag),
    createElement: (tag) => new Element(tag),
  };
  const context = vm.createContext({ document });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '../public/circuit-renderer.js'), 'utf8'),
    context,
  );
  return { renderer: context.FreeBbsCircuitRenderer, container: new Element('div') };
}

function source(type, waveform) {
  return {
    id: type === 'voltage' ? 'V1' : 'I1',
    type,
    x: 200,
    y: 200,
    params: { waveform, dc: 5, amplitude: 1, frequency: 10000 },
  };
}

test('source descriptions distinguish sine peak, pulse increment and bias with correct units', () => {
  assert.equal(componentValue(source('voltage', 'dc')), '5 V');
  assert.equal(componentValue(source('voltage', 'sine')), '正弦 1 V峰值 · 10 kHz · 偏置 5 V');
  assert.equal(componentValue(source('voltage', 'pulse')), '脉冲 1 V增量 · 10 kHz · 偏置 5 V');
  const current = source('current', 'sine');
  current.params.dc = -0.001;
  current.params.amplitude = 0.002;
  assert.equal(componentValue(current), '正弦 2 mA峰值 · 10 kHz · 偏置 -1 mA');
});

test('source symbols retain polarity and current direction; multiline labels survive frame changes', () => {
  for (const type of ['voltage', 'current']) {
    const symbols = new Map();
    for (const waveform of ['dc', 'sine', 'pulse']) {
      const { renderer, container } = harness();
      const component = source(type, waveform);
      const before = structuredClone(component);
      const diagram = renderer.renderSchematic(container, { components: [component], wires: [] });
      const node = container.all(
        (item) => item.getAttribute('data-component-id') === component.id,
      )[0];
      const paths = node
        .all((item) => item.tagName === 'path')
        .map((item) => item.getAttribute('d'));
      symbols.set(waveform, paths.join(' '));
      if (type === 'current') assert.ok(paths.includes('M -9 0 H 10 M 4 -6 L 10 0 L 4 6'));
      else if (waveform === 'dc') assert.ok(paths.includes('M -12 -4 V 4 M -16 0 H -8 M 8 0 H 16'));
      else assert.ok(paths.includes('M -9 -17 V -11 M -12 -14 H -6 M 6 -14 H 12'));
      const lines = () =>
        node.all((item) => item.tagName === 'tspan').map((item) => item.textContent);
      const expected = waveform === 'dc' ? [] : componentValue(component).split(' · ');
      assert.deepEqual(lines(), expected);
      diagram.updateFrame({ voltages: {}, currents: { [component.id]: 1 } });
      diagram.updateFrame(null);
      assert.deepEqual(lines(), expected);
      assert.deepEqual(component, before);
    }
    assert.notEqual(symbols.get('dc'), symbols.get('sine'));
    assert.notEqual(symbols.get('sine'), symbols.get('pulse'));
  }
});

test('small and single-point waveforms retain all original vertices', () => {
  assert.deepEqual(waveformSampleIndices([], [], 300), []);
  assert.deepEqual(waveformSampleIndices([0], [5], 300), [0]);
  assert.deepEqual(waveformSampleIndices([0, 1, 2, 3], [1, -2, 3, 0], 300), [0, 1, 2, 3]);
  const { renderer, container } = harness();
  renderer.renderWaveform(container, {
    x: [0],
    traces: [{ id: 'V1', label: 'V1', unit: 'V', values: [5] }],
  });
  assert.equal(container.all((item) => item.tagName === 'circle').length, 1);
});

test('100001-point envelopes retain narrow positive and negative spikes, endpoints and sample order', () => {
  const x = Object.freeze(Array.from({ length: 100001 }, (_, index) => index / 100000));
  const values = Array(100001).fill(-2);
  values[0] = 7;
  values[100000] = 8;
  values[12345] = 100;
  values[12346] = -120;
  Object.freeze(values);
  for (const axis of [x, [...x].reverse(), x.map((value) => 10 ** (value * 6))]) {
    const indices = waveformSampleIndices(axis, values, 211, axis[0] === 1);
    assert.ok(indices.length <= 211 * 4);
    assert.equal(indices[0], 0);
    assert.equal(indices.at(-1), 100000);
    assert.ok(indices.includes(12345));
    assert.ok(indices.includes(12346));
    assert.ok(indices.every((value, index) => !index || value > indices[index - 1]));
  }
});

test('nearest-sample search matches full resolution for ascending, descending and logarithmic axes', () => {
  assert.equal(nearestWaveformSample([], 1), -1);
  assert.equal(nearestWaveformSample([5], 100), 0);
  assert.equal(nearestWaveformSample([0, 0, 1], 0.2), 0);
  assert.equal(nearestWaveformSample([0, 2], 1), 0);
  assert.equal(nearestWaveformSample([2, 0], 1), 0);
  for (const x of [
    [0, 1, 2, 4, 8],
    [8, 4, 2, 1, 0],
    [1, 10, 100, 1000],
    [1000, 100, 10, 1],
  ]) {
    for (const logX of x.includes(0) ? [false] : [false, true]) {
      const project = (value) => (logX ? Math.log10(value) : value);
      for (const target of [-1, 0.1, 1, 1.5, 3, 7.9, 9, 31.6, 99, 1000, 1100]) {
        if (logX && target <= 0) continue;
        let expected = 0;
        x.forEach((value, index) => {
          if (
            Math.abs(project(value) - project(target)) <
            Math.abs(project(x[expected]) - project(target))
          )
            expected = index;
        });
        assert.equal(nearestWaveformSample(x, target, logX), expected);
      }
    }
  }
  let reads = 0;
  const large = new Proxy(
    Array.from({ length: 100001 }, (_, index) => index),
    {
      get(target, key, receiver) {
        if (/^\d+$/.test(String(key))) reads += 1;
        return Reflect.get(target, key, receiver);
      },
    },
  );
  assert.equal(nearestWaveformSample(large, 76543.2), 76543);
  assert.ok(reads < 100, `binary search used ${reads} reads`);
});

test('large SVG paths are bounded while pointer readings use untouched full-resolution samples', () => {
  const { renderer, container } = harness();
  const x = Array.from({ length: 100001 }, (_, index) => index / 100000);
  const values = Array.from({ length: x.length }, (_, index) => (index === 54321 ? 99 : 0));
  const result = { x, xUnit: 's', traces: [{ id: 'V1', label: 'V1', unit: 'V', values }] };
  const before = JSON.stringify(result);
  renderer.renderWaveform(container, result);
  const pathElement = container.all(
    (item) => item.getAttribute('vector-effect') === 'non-scaling-stroke',
  )[0];
  assert.ok((pathElement.getAttribute('d').match(/[ML]/g) || []).length <= 820 * 4);
  const svg = container.all((item) => item.tagName === 'svg')[0];
  svg.listeners.get('pointermove')({ clientX: 76 + 0.54321 * 820 });
  const readout = container.all((item) => item.tagName === 'p')[0];
  assert.match(readout.textContent, /99 V/);
  assert.equal(JSON.stringify(result), before);
});
