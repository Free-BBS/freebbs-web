const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const engine = require('../public/circuit-engine');
const renderer = require('../public/circuit-renderer');

const orientations = [0, 90, 180, 270].flatMap((rotation) =>
  [false, true].flatMap((mirrorX) =>
    [false, true].map((mirrorY) => ({ rotation, mirrorX, mirrorY })),
  ),
);
const component = (type, orientation = {}) => ({
  id: 'X1',
  type,
  x: 300,
  y: 200,
  params: { ...engine.catalog[type].defaults },
  ...orientation,
});
function rotate(point, orientation) {
  const x = point.x * (orientation.mirrorX ? -1 : 1);
  const y = point.y * (orientation.mirrorY ? -1 : 1);
  const [rx, ry] = { 0: [x, y], 90: [-y, x], 180: [-x, -y], 270: [y, -x] }[orientation.rotation];
  return { x: rx || 0, y: ry || 0 };
}

test('every catalog pin keeps its terminal identity while all rotations and mirrors move its coordinates', () => {
  const special = {
    ground: [[0, -28]],
    junction: [[0, 0]],
    bjt: [
      [0, -40],
      [-40, 0],
      [0, 40],
    ],
    mosfet: [
      [0, -40],
      [-40, 0],
      [0, 40],
    ],
    opamp: [
      [-40, -18],
      [-40, 18],
      [40, 0],
    ],
    vcvs: [
      [-40, 0],
      [40, 0],
      [-18, 44],
      [18, 44],
    ],
    vccs: [
      [-40, 0],
      [40, 0],
      [-18, 44],
      [18, 44],
    ],
  };
  for (const type of Object.keys(engine.catalog)) {
    const baseline = renderer.getPins(component(type));
    for (const orientation of orientations) {
      const pins = renderer.getPins(component(type, orientation));
      assert.equal(pins.length, engine.catalog[type].pins.length);
      pins.forEach((pin, index) => {
        const [x, y] = (special[type] || [
          [-40, 0],
          [40, 0],
        ])[index];
        const expected = rotate({ x, y }, orientation);
        assert.deepEqual(pin, { ...baseline[index], x: 300 + expected.x, y: 200 + expected.y });
      });
    }
  }
});

test('mirror fields survive JSON save/load and repeated flips restore original geometry without adding legacy fields', () => {
  const document = {
    version: 1,
    components: [component('resistor')],
    wires: [],
    analysis: { type: 'dc' },
  };
  const legacy = engine.validateDocument(document);
  assert.equal(Object.hasOwn(legacy.components[0], 'mirrorX'), false);
  assert.equal(Object.hasOwn(legacy.components[0], 'mirrorY'), false);
  for (const orientation of orientations) {
    document.components[0] = component('resistor', orientation);
    const validated = engine.validateDocument(document);
    assert.deepEqual(engine.validateDocument(JSON.parse(JSON.stringify(validated))), validated);
    const part = validated.components[0];
    const pins = renderer.getPins(part);
    part.mirrorX = !part.mirrorX;
    part.mirrorX = !part.mirrorX;
    part.mirrorY = !part.mirrorY;
    part.mirrorY = !part.mirrorY;
    assert.deepEqual(renderer.getPins(part), pins);
  }
  for (const key of ['mirrorX', 'mirrorY']) {
    for (const invalid of [1, 0, 'true', 'false', null, [], {}]) {
      document.components[0] = { ...component('resistor'), [key]: invalid };
      assert.throws(() => engine.validateDocument(document), /镜像.*布尔/);
    }
  }
});

test('mirrored and rotated circuits preserve nets, wire references and solved voltages/currents', () => {
  const endpoint = (componentId, pin = 0) => ({ componentId, pin });
  const document = engine.validateDocument({
    version: 1,
    components: [
      { ...component('voltage'), id: 'V1' },
      { ...component('resistor'), id: 'R1', x: 500 },
      { ...component('resistor'), id: 'R2', y: 400 },
      { ...component('ground'), id: 'GND' },
    ],
    wires: [
      { id: 'w1', from: endpoint('V1'), to: endpoint('R1') },
      { id: 'w2', from: endpoint('R1', 1), to: endpoint('R2'), points: [{ x: 500, y: 400 }] },
      { id: 'w3', from: endpoint('R2', 1), to: endpoint('GND') },
      { id: 'w4', from: endpoint('V1', 1), to: endpoint('GND') },
    ],
    analysis: { type: 'dc' },
  });
  const nets = engine.buildNets(document);
  const result = engine.simulate(document);
  for (const orientation of orientations) {
    const transformed = structuredClone(document);
    transformed.components.forEach((part) => Object.assign(part, orientation));
    const restored = engine.validateDocument(JSON.parse(JSON.stringify(transformed)));
    assert.deepEqual(engine.buildNets(restored), nets);
    assert.deepEqual(engine.simulate(restored), result);
    assert.deepEqual(restored.wires, document.wires);
    const route = renderer.getWireRoute(restored.wires[1], restored.components);
    const pin = renderer.getPins(restored.components[1])[1];
    assert.deepEqual(route[0], { x: pin.x, y: pin.y });
    assert.deepEqual(route[1], document.wires[1].points[0]);
  }
});

class Element {
  constructor(tagName) {
    this.tagName = tagName;
    this.attributes = new Map();
    this.children = [];
    this.style = {};
    this.listeners = new Map();
    this.content = '';
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
    this.children = children;
  }

  addEventListener(name, listener) {
    this.listeners.set(name, listener);
  }

  set textContent(value) {
    this.content = String(value);
    this.children = [];
  }

  get textContent() {
    return this.content + this.children.map((child) => child.textContent).join('');
  }

  all(predicate) {
    return [
      ...(predicate(this) ? [this] : []),
      ...this.children.flatMap((child) => child.all(predicate)),
    ];
  }
}
function render(part, options = {}) {
  const context = vm.createContext({ document: { createElementNS: (_, tag) => new Element(tag) } });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '../public/circuit-renderer.js'), 'utf8'),
    context,
  );
  const container = new Element('div');
  const drawing = context.FreeBbsCircuitRenderer.renderSchematic(
    container,
    { components: [part], wires: [] },
    options,
  );
  const find = (key, value) => container.all((item) => item.getAttribute(key) === value)[0];
  return { container, drawing, find };
}

test('rotated and mirrored names/values stay upright and outside the full symbol footprint, including multiline source labels', () => {
  for (const type of Object.keys(engine.catalog).filter((value) => value !== 'junction')) {
    for (const orientation of orientations) {
      const part = component(type, orientation);
      if (['voltage', 'current'].includes(type)) part.params.waveform = 'sine';
      const { find } = render(part);
      const layout = renderer.componentLabelLayout(part);
      const name = find('data-component-label', 'name');
      const value = find('data-component-label', 'value');
      assert.equal(name.getAttribute('transform'), null);
      assert.equal(value.getAttribute('transform'), null);
      const count = value.children.length || 1;
      const textTop = Number(name.getAttribute('y')) - 14;
      const textBottom = Number(value.getAttribute('y')) + 14 * (count - 1) + 3;
      const x = Number(name.getAttribute('x'));
      const outline = find('class', 'circuit-selection');
      const outlineTop = Number(outline.getAttribute('y'));
      const outlineBottom = outlineTop + Number(outline.getAttribute('height'));
      if (layout.side === 'top') assert.ok(textBottom < outlineTop, `${type} top`);
      else if (layout.side === 'bottom') assert.ok(textTop > outlineBottom, `${type} bottom`);
      else if (layout.side === 'left') {
        assert.ok(x < layout.bounds.left);
        assert.equal(name.getAttribute('text-anchor'), 'end');
      } else {
        assert.ok(x > layout.bounds.right);
        assert.equal(name.getAttribute('text-anchor'), 'start');
      }
      const symbol = find('data-component-symbol', 'X1');
      assert.equal(
        symbol.getAttribute('transform'),
        `rotate(${orientation.rotation}) scale(${orientation.mirrorX ? -1 : 1} ${orientation.mirrorY ? -1 : 1})`,
      );
      symbol
        .all((item) => item.tagName === 'text')
        .forEach((text) => {
          // R*S times a glyph's S*R^-1 is identity: text follows its pin without turning backwards.
          assert.ok(
            text
              .getAttribute('transform')
              .endsWith(
                `scale(${orientation.mirrorX ? -1 : 1} ${orientation.mirrorY ? -1 : 1}) rotate(${-orientation.rotation})`,
              ),
          );
        });
    }
  }
});

test('signed current arrows and moving paths follow terminal direction through every mirror and rotation', () => {
  for (const type of Object.keys(engine.catalog).filter(
    (value) => !['ground', 'junction'].includes(value),
  )) {
    for (const orientation of orientations) {
      const part = component(type, orientation);
      const pins = renderer.getPins(part);
      const terminal = ['bjt', 'mosfet'].includes(type) ? 2 : 1;
      const expected =
        type === 'opamp'
          ? rotate({ x: -1, y: 0 }, orientation)
          : { x: pins[terminal].x - pins[0].x, y: pins[terminal].y - pins[0].y };
      const { drawing, find } = render(part, { animate: true });
      const indicator = find('data-current-indicator', 'X1');
      const arrow = find('data-current-arrow', 'X1');
      for (const current of [0.01, -0.01, 0]) {
        drawing.updateFrame({ voltages: {}, currents: { X1: current } });
        const geometry = renderer.currentIndicatorGeometry(part, current);
        const vector = { x: geometry.to.x - geometry.from.x, y: geometry.to.y - geometry.from.y };
        assert.ok((vector.x * expected.x + vector.y * expected.y) * (current < 0 ? -1 : 1) > 0);
        assert.equal(Math.abs(vector.x * expected.y - vector.y * expected.x), 0);
        assert.equal(indicator.getAttribute('d'), geometry.path);
        assert.equal(arrow.getAttribute('d'), geometry.arrow);
        assert.equal(indicator.getAttribute('visibility'), current ? 'visible' : 'hidden');
        assert.equal(arrow.getAttribute('visibility'), current ? 'visible' : 'hidden');
      }
      const positive = renderer.currentIndicatorGeometry(part, 1);
      const negative = renderer.currentIndicatorGeometry(part, -1);
      assert.deepEqual(negative.from, positive.to);
      assert.deepEqual(negative.to, positive.from);
    }
  }
});
