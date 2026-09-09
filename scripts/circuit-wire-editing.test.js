const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const engine = require('../public/circuit-engine');
const { getWireRoute, insertWirePoint } = require('../public/circuit-renderer');

function sample() {
  return {
    version: 1,
    components: [
      { id: 'V1', type: 'voltage', x: 100, y: 100, params: { dc: 5 } },
      { id: 'R1', type: 'resistor', x: 400, y: 300, params: { resistance: 1000 } },
      { id: 'GND', type: 'ground', x: 100, y: 420 },
    ],
    wires: [
      { id: 'w1', from: { componentId: 'V1', pin: 1 }, to: { componentId: 'R1', pin: 0 } },
      { id: 'w2', from: { componentId: 'V1', pin: 0 }, to: { componentId: 'GND', pin: 0 } },
      { id: 'w3', from: { componentId: 'R1', pin: 1 }, to: { componentId: 'GND', pin: 0 } },
    ],
    analysis: { type: 'dc' },
  };
}

test('wire geometry is copied, validated and preserved by JSON round trips without altering nets or simulation', () => {
  const document = sample();
  const before = engine.simulate(document);
  const nets = engine.buildNets(document);
  const points = [
    { x: -100000, y: 100000 },
    { x: 250.5, y: 350.25, ignored: 'discard' },
  ];
  document.wires[0].points = points;
  document.wires[1].points = [];
  const normalized = engine.validateDocument(document);
  assert.deepEqual(normalized.wires[0].points, [
    { x: -100000, y: 100000 },
    { x: 250.5, y: 350.25 },
  ]);
  assert.deepEqual(normalized.wires[1].points, []);
  assert.equal(Object.hasOwn(normalized.wires[2], 'points'), false);
  assert.notEqual(normalized.wires[0].points, points);
  assert.notEqual(normalized.wires[0].points[0], points[0]);
  const imported = engine.validateDocument(JSON.parse(JSON.stringify(normalized)));
  assert.deepEqual(imported, normalized);
  assert.deepEqual(engine.buildNets(imported), nets);
  assert.deepEqual(engine.simulate(imported), before);
});

test('wire geometry rejects bad types, excessive points and nonfinite or out-of-range coordinates', () => {
  for (const points of [
    null,
    {},
    '1,2',
    [null],
    [[1, 2]],
    [{ x: '1', y: 2 }],
    [{ x: 1 }],
    [{ x: Infinity, y: 2 }],
    [{ x: 1, y: NaN }],
    [{ x: 100001, y: 0 }],
    [{ x: 0, y: -100001 }],
    Array.from({ length: 33 }, () => ({ x: 1, y: 2 })),
  ]) {
    const document = sample();
    document.wires[0].points = points;
    assert.throws(() => engine.validateDocument(document), /拐点|points/);
  }
  const document = sample();
  document.wires[0].points = Array.from({ length: 32 }, (_, index) => ({ x: index, y: index }));
  assert.equal(engine.validateDocument(document).wires[0].points.length, 32);
});

test('automatic wires are orthogonal; explicit points follow vertices; empty points are straight', () => {
  const document = sample();
  const wire = document.wires[0];
  const automatic = getWireRoute(wire, document.components);
  assert.deepEqual(automatic, [
    { x: 140, y: 100 },
    { x: 260, y: 100 },
    { x: 260, y: 300 },
    { x: 360, y: 300 },
  ]);
  automatic
    .slice(1)
    .forEach((point, index) =>
      assert.ok(point.x === automatic[index].x || point.y === automatic[index].y),
    );
  wire.points = [
    { x: 210, y: 180 },
    { x: 320, y: 140 },
  ];
  assert.deepEqual(getWireRoute(wire, document.components), [
    { x: 140, y: 100 },
    ...wire.points,
    { x: 360, y: 300 },
  ]);
  document.components[0].x += 30;
  const moved = getWireRoute(wire, document.components);
  assert.deepEqual(moved[0], { x: 170, y: 100 });
  assert.deepEqual(moved.slice(1, -1), wire.points);
  wire.points = [];
  assert.deepEqual(getWireRoute(wire, document.components), [
    { x: 170, y: 100 },
    { x: 360, y: 300 },
  ]);
  delete wire.points;
  assert.equal(getWireRoute(wire, document.components).length, 4);
});

test('inserting a point projects onto the nearest segment and preserves endpoint connections', () => {
  const document = sample();
  const wire = document.wires[0];
  const original = structuredClone(wire);
  const inserted = insertWirePoint(wire, document.components, { x: 267, y: 200 });
  assert.deepEqual(inserted, {
    points: [
      { x: 260, y: 100 },
      { x: 260, y: 200 },
      { x: 260, y: 300 },
    ],
    index: 1,
  });
  assert.deepEqual(wire, original);
  wire.points = [];
  const diagonal = insertWirePoint(wire, document.components, { x: 250, y: 200 });
  assert.deepEqual(diagonal.points, [{ x: 250, y: 200 }]);
  wire.points = Array.from({ length: 32 }, (_, index) => ({ x: index, y: index }));
  assert.equal(insertWirePoint(wire, document.components, { x: 10, y: 10 }), null);
});

class Element {
  constructor(tag, ownerDocument) {
    this.tagName = tag;
    this.ownerDocument = ownerDocument;
    this.attributes = new Map();
    this.listeners = new Map();
    this.style = {};
    this.children = [];
    this.parentNode = null;
    this.captured = new Set();
  }

  setAttribute(key, value) {
    this.attributes.set(key, String(value));
  }

  getAttribute(key) {
    return this.attributes.get(key) ?? null;
  }

  append(...elements) {
    elements.forEach((child) => {
      const element = child;
      element.remove();
      element.parentNode = this;
      this.children.push(element);
    });
  }

  replaceChildren(...elements) {
    [...this.children].forEach((element) => element.remove());
    this.append(...elements);
  }

  remove() {
    if (this.parentNode)
      this.parentNode.children = this.parentNode.children.filter((element) => element !== this);
    this.parentNode = null;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  focus() {
    this.ownerDocument.activeElement = this;
    this.dispatch('focus');
  }

  setPointerCapture(id) {
    this.captured.add(id);
  }

  hasPointerCapture(id) {
    return this.captured.has(id);
  }

  releasePointerCapture(id) {
    this.captured.delete(id);
  }

  getScreenCTM() {
    assert.equal(this.tagName, 'svg');
    return { inverse: () => ({}) };
  }

  createSVGPoint() {
    assert.equal(this.tagName, 'svg');
    return {
      x: 0,
      y: 0,
      matrixTransform() {
        return { x: this.x, y: this.y };
      },
    };
  }

  dispatch(type, details = {}) {
    const event = {
      type,
      target: this,
      button: 0,
      pointerId: 1,
      isPrimary: true,
      defaultPrevented: false,
      stopped: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {
        this.stopped = true;
      },
      ...details,
    };
    let element = this;
    while (element) {
      (element.listeners.get(type) || []).forEach((listener) => listener(event));
      if (event.stopped || type === 'focus') break;
      element = element.parentNode;
    }
    return event;
  }

  all(predicate) {
    return [
      ...(predicate(this) ? [this] : []),
      ...this.children.flatMap((child) => child.all(predicate)),
    ];
  }
}
function harness(document = sample(), overrides = {}) {
  const dom = { createElementNS: (_, tag) => new Element(tag, dom), activeElement: null };
  const context = vm.createContext({ document: dom, FreeBbsCircuitEngine: engine });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '../public/circuit-renderer.js'), 'utf8'),
    context,
  );
  const container = new Element('div', dom);
  const changes = [];
  const selections = [];
  const options = {
    interactive: true,
    selectedId: 'w1',
    onWireClick: (id) => selections.push(id),
    onWireChange: (id, points) => changes.push({ id, points: JSON.parse(JSON.stringify(points)) }),
    ...overrides,
  };
  const rendered = context.FreeBbsCircuitRenderer.renderSchematic(container, document, options);
  const find = (attribute, value) =>
    container.all((element) => element.getAttribute(attribute) === String(value))[0];
  return { container, document, dom, changes, selections, rendered, find, context, options };
}

test('pointer dragging previews locally, commits once on release, and supports touch pointers', () => {
  const state = harness();
  const original = JSON.stringify(state.document);
  const handle = state.find('data-wire-point', 0);
  handle.dispatch('pointerdown', { clientX: 260, clientY: 100, pointerType: 'touch' });
  handle.dispatch('pointermove', { clientX: 287, clientY: 137, pointerType: 'touch' });
  assert.equal(state.changes.length, 0);
  assert.match(state.find('data-wire-id', 'w1').getAttribute('d'), /L 290 140/);
  assert.equal(JSON.stringify(state.document), original);
  handle.dispatch('pointerup', { clientX: 287, clientY: 137, pointerType: 'touch' });
  assert.deepEqual(state.changes, [
    {
      id: 'w1',
      points: [
        { x: 290, y: 140 },
        { x: 260, y: 300 },
      ],
    },
  ]);
  assert.equal(JSON.stringify(state.document), original);
});

test('Escape and pointer cancellation restore geometry without committing a partial drag', () => {
  for (const cancel of ['Escape', 'pointercancel']) {
    const state = harness();
    const pathBefore = state.find('data-wire-id', 'w1').getAttribute('d');
    const handle = state.find('data-wire-point', 0);
    handle.dispatch('pointerdown', { clientX: 260, clientY: 100 });
    handle.dispatch('pointermove', { clientX: 300, clientY: 150 });
    if (cancel === 'Escape') {
      const event = handle.dispatch('keydown', { key: 'Escape' });
      assert.equal(event.defaultPrevented, true);
      assert.equal(event.stopped, true);
    } else handle.dispatch('pointercancel');
    assert.equal(state.find('data-wire-id', 'w1').getAttribute('d'), pathBefore);
    assert.equal(state.changes.length, 0);
  }
});

test('double click and touchable plus controls add vertices; keyboard nudges only the selected vertex', () => {
  const state = harness();
  state.find('data-wire-hit', 'w1').dispatch('dblclick', { clientX: 267, clientY: 200 });
  assert.deepEqual(state.changes[0].points, [
    { x: 260, y: 100 },
    { x: 260, y: 200 },
    { x: 260, y: 300 },
  ]);
  assert.equal(state.selections.length, 0);
  const right = state
    .find('data-wire-point', 1)
    .dispatch('keydown', { key: 'ArrowRight', shiftKey: true });
  assert.equal(right.defaultPrevented, true);
  assert.equal(right.stopped, true);
  assert.deepEqual(state.changes[1].points[1], { x: 270, y: 200 });
  const plus = state.find('data-wire-add', 0);
  plus.dispatch('click');
  assert.equal(state.changes[2].points.length, 4);
});

test('visible delete button and Backspace remove vertices; deleting the last one leaves a straight wire', () => {
  const document = sample();
  document.wires[0].points = [
    { x: 240, y: 100 },
    { x: 240, y: 300 },
  ];
  const state = harness(document);
  state.find('data-wire-point', 0).dispatch('click');
  const remove = state.find('data-wire-delete-point', 0);
  assert.equal(remove.getAttribute('aria-label'), '删除拐点 1');
  const click = remove.dispatch('click');
  assert.equal(click.stopped, true);
  assert.deepEqual(state.changes[0], { id: 'w1', points: [{ x: 240, y: 300 }] });
  const deletion = state.find('data-wire-point', 0).dispatch('keydown', { key: 'Backspace' });
  assert.equal(deletion.defaultPrevented, true);
  assert.equal(deletion.stopped, true);
  assert.deepEqual(state.changes[1], { id: 'w1', points: [] });
  assert.equal(state.find('data-wire-id', 'w1').getAttribute('d'), 'M 140 100 L 360 300');
  assert.equal(state.find('data-wire-point', 0), undefined);
  assert.equal(state.selections.length, 0);
  assert.ok(
    state.find('data-wire-add', 0),
    'A straight wire can acquire a new point through its plus control',
  );
  assert.equal(
    state.dom.activeElement,
    state.find('data-wire-add', 0),
    'Deleting the last vertex keeps keyboard focus in the wire controls',
  );
});

test('read-only diagrams expose no wire editing controls or pointer handlers', () => {
  const state = harness(sample(), { interactive: false });
  assert.equal(state.find('data-wire-point', 0), undefined);
  assert.equal(state.find('data-wire-add', 0), undefined);
  assert.equal(state.find('data-wire-hit', 'w1'), undefined);
  assert.equal(state.rendered.svg.getAttribute('role'), 'img');
  state.find('data-wire-id', 'w1').dispatch('dblclick', { clientX: 260, clientY: 200 });
  assert.equal(state.changes.length, 0);
});

function pinHit(state, componentId, pin) {
  return state
    .find('data-component-id', componentId)
    .all((element) => element.getAttribute('data-pin') === String(pin))[0];
}

test('junctions render one centered accessible solid pin without labels, boxes or current arrows', () => {
  const document = sample();
  document.components.push({ id: 'J1', type: 'junction', x: 260, y: 200, params: {} });
  const clicked = [];
  const state = harness(document, { onPinClick: (endpoint) => clicked.push(endpoint) });
  const node = state.find('data-component-id', 'J1');
  assert.equal(node.all((element) => element.tagName === 'text').length, 0);
  assert.equal(node.all((element) => element.tagName === 'rect').length, 0);
  const pin = pinHit(state, 'J1', 0);
  assert.equal(pin.getAttribute('cx'), '0');
  assert.equal(pin.getAttribute('cy'), '0');
  pin.dispatch('click');
  assert.equal(JSON.stringify(clicked), '[{"componentId":"J1","pin":0}]');
  state.rendered.updateFrame({ voltages: {}, currents: { J1: 1 } });
  assert.equal(
    node.all((element) => element.getAttribute('class') === 'circuit-current').length,
    0,
  );
});

test('selected wires report projected click positions; connection mode disables editing and previews snap targets', () => {
  const clicks = [];
  const state = harness(sample(), {
    wireStart: { componentId: 'V1', pin: 0 },
    onWireClick: (id, position) => clicks.push({ id, position }),
  });
  assert.equal(state.find('data-wire-point', 0), undefined);
  const wire = state.find('data-wire-hit', 'w1');
  wire.dispatch('pointermove', { clientX: 266, clientY: 200 });
  const preview = state.find('data-connection-preview', '');
  assert.equal(preview.getAttribute('visibility'), 'visible');
  assert.match(preview.children[0].getAttribute('d'), /M 140 100/);
  assert.match(preview.children[1].getAttribute('d'), /M 60 100 .*260/);
  assert.equal(preview.children[2].getAttribute('cx'), '260');
  assert.equal(preview.children[2].getAttribute('cy'), '200');
  wire.dispatch('click', { clientX: 266, clientY: 200 });
  assert.equal(JSON.stringify(clicks), '[{"id":"w1","position":{"x":260,"y":200}}]');
  assert.equal(state.changes.length, 0);
  pinHit(state, 'R1', 0).dispatch('pointermove', { clientX: 360, clientY: 300 });
  assert.equal(preview.children[0].getAttribute('d'), '');
  assert.equal(preview.children[2].getAttribute('cx'), '360');
});

test('pending wire origins preview without mutating the stored wire or creating junctions', () => {
  const document = sample();
  const before = JSON.stringify(document);
  const state = harness(document, { wireStart: { wireId: 'w1', position: { x: 260, y: 200 } } });
  state.rendered.svg.dispatch('pointermove', { clientX: 600, clientY: 450 });
  const preview = state.find('data-connection-preview', '');
  assert.match(preview.children[1].getAttribute('d'), /^M 260 200 /);
  assert.equal(JSON.stringify(document), before);
  assert.equal(state.changes.length, 0);
});

test('mouse and touch pin drags connect to wires or pins once on release while light clicks retain their behavior', () => {
  for (const pointerType of ['mouse', 'touch']) {
    const connections = [];
    const clicks = [];
    const state = harness(sample(), {
      onConnect: (from, target) => connections.push({ from, target }),
      onPinClick: (endpoint) => clicks.push(endpoint),
    });
    const pin = pinHit(state, 'V1', 0);
    const drag = (x, y) => {
      pin.dispatch('pointerdown', { clientX: 60, clientY: 100, pointerType });
      assert.equal(connections.length, clicks.length);
      pin.dispatch('pointermove', { clientX: x, clientY: y, pointerType });
      assert.equal(
        connections.length,
        clicks.length,
        'drag previews do not invoke owner callbacks',
      );
      pin.dispatch('pointerup', { clientX: x, clientY: y, pointerType });
      pin.dispatch('click');
    };
    drag(265, 200);
    assert.equal(
      JSON.stringify(connections[0]),
      '{"from":{"componentId":"V1","pin":0},"target":{"wireId":"w1","position":{"x":260,"y":200}}}',
    );
    assert.equal(clicks.length, 0, 'the synthetic click after a drag cannot start a second wire');
    connections.length = 0;
    drag(360, 300);
    assert.equal(
      JSON.stringify(connections[0]),
      '{"from":{"componentId":"V1","pin":0},"target":{"endpoint":{"componentId":"R1","pin":0}}}',
    );
    pin.dispatch('pointerdown', { clientX: 60, clientY: 100, pointerType });
    pin.dispatch('pointerup', { clientX: 60, clientY: 100, pointerType });
    pin.dispatch('click');
    assert.equal(clicks.length, 1);
  }
});

test('blank drops, Escape, pointer cancellation and lost capture leave no partial connection', () => {
  for (const finish of ['blank', 'Escape', 'pointercancel', 'lostpointercapture']) {
    const connections = [];
    const clicks = [];
    const state = harness(sample(), {
      onConnect: (...args) => connections.push(args),
      onPinClick: (...args) => clicks.push(args),
    });
    const pin = pinHit(state, 'V1', 0);
    pin.dispatch('pointerdown', { clientX: 60, clientY: 100, pointerType: 'touch' });
    pin.dispatch('pointermove', { clientX: 700, clientY: 500, pointerType: 'touch' });
    if (finish === 'Escape') pin.dispatch('keydown', { key: 'Escape' });
    else if (finish !== 'blank') pin.dispatch(finish);
    pin.dispatch('pointerup', { clientX: 700, clientY: 500, pointerType: 'touch' });
    pin.dispatch('click');
    assert.equal(connections.length, 0, finish);
    assert.equal(clicks.length, 0, finish);
    assert.equal(state.find('data-connection-preview', '').getAttribute('visibility'), 'hidden');
    assert.equal(state.changes.length, 0, finish);
  }
});

test('dragging a junction moves its connected wire ends; cancellation restores the original geometry', () => {
  for (const finish of ['pointerup', 'pointercancel', 'Escape', 'lostpointercapture']) {
    const document = sample();
    document.components.push({ id: 'J1', type: 'junction', x: 260, y: 200, params: {} });
    document.wires[0].to = { componentId: 'J1', pin: 0 };
    document.wires[0].points = [];
    const moves = [];
    const connections = [];
    const state = harness(document, {
      onMove: (...args) => moves.push(args),
      onConnect: (...args) => connections.push(args),
    });
    const pin = pinHit(state, 'J1', 0);
    pin.dispatch('pointerdown', { clientX: 260, clientY: 200, pointerType: 'touch' });
    pin.dispatch('pointermove', { clientX: 290, clientY: 230, pointerType: 'touch' });
    assert.equal(state.find('data-wire-id', 'w1').getAttribute('d'), 'M 140 100 L 290 230');
    assert.equal(moves.length, 0, 'moving previews locally until release');
    assert.equal(document.components.at(-1).x, 260, 'the preview cannot mutate the saved draft');
    if (finish === 'Escape') pin.dispatch('keydown', { key: 'Escape' });
    else pin.dispatch(finish, { clientX: 290, clientY: 230 });
    if (finish === 'pointerup') assert.deepEqual(moves, [['J1', 290, 230]]);
    else {
      assert.equal(moves.length, 0, finish);
      assert.equal(state.find('data-wire-id', 'w1').getAttribute('d'), 'M 140 100 L 260 200');
    }
    assert.equal(connections.length, 0, 'junction movement must not create an extra wire');
  }
});

test('touch pin gestures prevent canvas panning while light taps invoke one connection action', () => {
  const clicks = [];
  const state = harness(sample(), {
    onConnect() {},
    onPinClick: (endpoint) => clicks.push(endpoint),
  });
  const pin = pinHit(state, 'V1', 0);
  pin.dispatch('pointerdown', { clientX: 60, clientY: 100, pointerType: 'touch' });
  assert.equal(pin.dispatch('touchstart').defaultPrevented, true);
  pin.dispatch('pointerup', { clientX: 60, clientY: 100, pointerType: 'touch' });
  pin.dispatch('click');
  assert.equal(clicks.length, 1);
  assert.equal(JSON.stringify(clicks[0]), '{"componentId":"V1","pin":0}');
  assert.equal(
    state.rendered.svg.dispatch('touchstart').defaultPrevented,
    false,
    'blank canvas remains scrollable',
  );
});
