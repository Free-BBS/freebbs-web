const assert = require('node:assert/strict');
const test = require('node:test');
const { validateDocument, buildNets, simulate } = require('../public/circuit-engine');
const { getPins, getWireRoute, transformPoint } = require('../public/circuit-renderer');
const { normalizeRecognizedCircuitLayout } = require('./circuit-recognition-layout');

function component(id, type, x, y, rotation = 0, params = {}) {
  return { id, type, x, y, rotation, params };
}

function wire(id, from, fromPin, to, toPin, points = []) {
  return {
    id,
    from: { componentId: from, pin: fromPin },
    to: { componentId: to, pin: toPin },
    points,
  };
}

function document(components, wires, analysis = { type: 'dc' }) {
  return validateDocument({ version: 1, components, wires, analysis });
}

function assertOrthogonal(result) {
  assert.deepEqual(validateDocument(result), result);
  result.components.forEach((part) => {
    assert.equal(Math.abs(part.x % 20), 0);
    assert.equal(Math.abs(part.y % 20), 0);
  });
  result.wires.forEach((entry) => {
    assert.ok(entry.points.length <= 32);
    const route = getWireRoute(entry, result.components);
    route.forEach((point, index) => {
      if (index)
        assert.ok(
          point.x === route[index - 1].x || point.y === route[index - 1].y,
          `${entry.id} has a diagonal segment`,
        );
    });
    const from = getPins(result.components.find((part) => part.id === entry.from.componentId))[
      entry.from.pin
    ];
    const to = getPins(result.components.find((part) => part.id === entry.to.componentId))[
      entry.to.pin
    ];
    assert.deepEqual(route[0], { x: from.x, y: from.y });
    assert.deepEqual(route.at(-1), { x: to.x, y: to.y });
  });
}

function assertNoSegmentThroughBox(route, box) {
  route.slice(1).forEach((point, index) => {
    const previous = route[index];
    const vertical =
      point.x === previous.x &&
      point.x > box.left &&
      point.x < box.right &&
      Math.max(point.y, previous.y) > box.top &&
      Math.min(point.y, previous.y) < box.bottom;
    const horizontal =
      point.y === previous.y &&
      point.y > box.top &&
      point.y < box.bottom &&
      Math.max(point.x, previous.x) > box.left &&
      Math.min(point.x, previous.x) < box.right;
    assert.equal(vertical || horizontal, false, `wire crosses ${JSON.stringify(box)}`);
  });
}

function divider() {
  // Captured Kimi output: the final (200, 520) -> ground pin (500, 492)
  // segment was diagonal; missing points also relied on renderer auto-routing.
  return document(
    [
      component('V1', 'voltage', 200, 300, 90, { dc: 6 }),
      component('R1', 'resistor', 500, 200, 90, { resistance: 1000 }),
      component('R2', 'resistor', 500, 400, 90, { resistance: 2000 }),
      component('GND', 'ground', 500, 520),
      component('J1', 'junction', 500, 300),
    ],
    [
      wire('w1', 'V1', 0, 'R1', 0),
      wire('w2', 'R1', 1, 'J1', 0),
      wire('w3', 'J1', 0, 'R2', 0),
      wire('w4', 'R2', 1, 'GND', 0),
      wire('w5', 'V1', 1, 'GND', 0, [{ x: 200, y: 520 }]),
    ],
  );
}

test('real recognition divider becomes orthogonal without changing its 4 V operating point', () => {
  const before = divider();
  const snapshot = structuredClone(before);
  const result = normalizeRecognizedCircuitLayout(before);
  assertOrthogonal(result);
  assert.deepEqual(before, snapshot, 'input must not be mutated');
  assert.deepEqual(buildNets(result), buildNets(before));
  assert.deepEqual(simulate(result), simulate(before));
  assert.deepEqual(result.components, before.components);
  assert.notDeepEqual(result.wires.at(-1).points, before.wires.at(-1).points);
  assert.deepEqual(normalizeRecognizedCircuitLayout(result), result);
});

test('existing clear orthogonal custom corners and analysis fields are retained', () => {
  const before = document(
    [component('A', 'resistor', 200, 200), component('B', 'resistor', 600, 200)],
    [
      wire('w', 'A', 1, 'B', 0, [
        { x: 300, y: 200 },
        { x: 300, y: 260 },
        { x: 520, y: 260 },
        { x: 520, y: 200 },
      ]),
    ],
    { type: 'ac', start: 10, stop: 10000, points: 100, scale: 'log' },
  );
  const result = normalizeRecognizedCircuitLayout(before);
  assert.deepEqual(result, before);
  assertOrthogonal(result);
});

test('an already orthogonal wire crossing a component label can choose a clearer route', () => {
  const before = document(
    [
      component('A', 'junction', 100, 140),
      component('B', 'junction', 900, 140),
      component('R1', 'resistor', 500, 200, 0, { resistance: 1000 }),
    ],
    [wire('w', 'A', 0, 'B', 0)],
  );
  const after = normalizeRecognizedCircuitLayout(before);
  assertOrthogonal(after);
  const route = getWireRoute(after.wires[0], after.components);
  assertNoSegmentThroughBox(route, { left: 482, right: 518, top: 124, bottom: 162 });
  assert.deepEqual(buildNets(after), buildNets(before));
});

test('all rotated/mirrored asymmetric pin coordinates remain exactly attached', () => {
  for (const type of [
    'ground',
    'bjt',
    'mosfet',
    'opamp',
    'vcvs',
    'vccs',
    'oscilloscope2',
    'twoport',
  ]) {
    for (const rotation of [0, 90, 180, 270]) {
      const part = {
        ...component('U', type, 503, 397, rotation),
        mirrorX: true,
        mirrorY: rotation >= 180,
      };
      const pinCount = getPins(part).length;
      const junctions = Array.from({ length: pinCount }, (_, index) =>
        component(`J${index}`, 'junction', 103 + index * 200, 97),
      );
      const before = document(
        [part, ...junctions],
        junctions.map((entry, index) => wire(`w${index}`, entry.id, 0, 'U', index)),
      );
      const after = normalizeRecognizedCircuitLayout(before);
      assertOrthogonal(after);
      assert.deepEqual(buildNets(after), buildNets(before));
      assert.deepEqual(after.components[0].params, before.components[0].params);
      assert.equal(after.components[0].rotation, rotation);
      assert.equal(after.components[0].mirrorX, true);
      assert.equal(after.components[0].mirrorY, rotation >= 180);
    }
  }
});

test('a source wire exits its real outward pin and routes around its own body', () => {
  const before = document(
    [component('V', 'voltage', 200, 200), component('R', 'resistor', 600, 200)],
    [wire('w', 'V', 0, 'R', 0)],
  );
  const after = normalizeRecognizedCircuitLayout(before);
  const route = getWireRoute(after.wires[0], after.components);
  assertOrthogonal(after);
  assert.ok(route[1].x < route[0].x);
  assertNoSegmentThroughBox(route, { left: 178, right: 222, top: 178, bottom: 222 });
});

test('single and multiple obstacles include their leads and terminals, not just their bodies', () => {
  for (const count of [1, 3]) {
    const blockers = Array.from({ length: count }, (_, index) =>
      component(`C${index}`, 'capacitor', 300 + index * 160, 280, 90),
    );
    const before = document(
      [component('A', 'junction', 100, 240), component('B', 'junction', 900, 240), ...blockers],
      [wire('w', 'A', 0, 'B', 0)],
    );
    const after = normalizeRecognizedCircuitLayout(before);
    const route = getWireRoute(after.wires[0], after.components);
    assertOrthogonal(after);
    blockers.forEach((part) =>
      assertNoSegmentThroughBox(route, {
        left: part.x - 18,
        right: part.x + 18,
        top: part.y - 41,
        bottom: part.y + 41,
      }),
    );
  }
});

test('foreign junctions do not become apparent connections and coincident terminals stay distinct', () => {
  const before = document(
    [
      component('A', 'junction', 100, 200),
      component('B', 'junction', 700, 200),
      component('Foreign', 'junction', 400, 200),
      component('Coincident', 'junction', 400, 200),
    ],
    [wire('w', 'A', 0, 'B', 0)],
  );
  const after = normalizeRecognizedCircuitLayout(before);
  assertOrthogonal(after);
  assert.deepEqual(buildNets(after), buildNets(before));
  const route = getWireRoute(after.wires[0], after.components);
  after.components.slice(2).forEach((part) =>
    assertNoSegmentThroughBox(route, {
      left: part.x - 5,
      right: part.x + 5,
      top: part.y - 5,
      bottom: part.y + 5,
    }),
  );
  assert.notDeepEqual(after.components[2], after.components[3]);
});

test('crowded same-column parts and junctions are spaced in original top-to-bottom order', () => {
  const before = document(
    [
      component('R1', 'resistor', 440, 320, 90),
      component('R2', 'resistor', 440, 370, 90),
      component('J', 'junction', 440, 345),
      component('G', 'ground', 440, 428),
    ],
    [wire('w1', 'R1', 1, 'J', 0), wire('w2', 'J', 0, 'R2', 0), wire('w3', 'R2', 1, 'G', 0)],
  );
  const after = normalizeRecognizedCircuitLayout(before);
  assertOrthogonal(after);
  const byId = new Map(after.components.map((part) => [part.id, part]));
  assert.ok(byId.get('R1').y < byId.get('J').y);
  assert.ok(byId.get('J').y < byId.get('R2').y);
  assert.ok(byId.get('R2').y < byId.get('G').y);
  assert.ok(after.components.every((part) => part.x === 440));
  assert.ok(after.wires.every((entry) => entry.points.length === 0));
  assert.deepEqual(normalizeRecognizedCircuitLayout(after), after);
});

test('bounded obstacle-grid search escapes multiple blocked rows and columns', () => {
  const blockers = [
    [200, 100],
    [200, 300],
    [300, 200],
    [500, 400],
    [700, 400],
    [600, 500],
  ].map(([x, y], index) => component(`V${index}`, 'voltage', x, y));
  const before = document(
    [component('A', 'junction', 200, 200), component('B', 'junction', 600, 400), ...blockers],
    [wire('w', 'A', 0, 'B', 0)],
  );
  const after = normalizeRecognizedCircuitLayout(before);
  assertOrthogonal(after);
  const route = getWireRoute(after.wires[0], after.components);
  blockers.forEach((part) =>
    assertNoSegmentThroughBox(route, {
      left: part.x - 40,
      right: part.x + 40,
      top: part.y - 22,
      bottom: part.y + 22,
    }),
  );
  assert.ok(after.wires[0].points.length >= 2);
});

test('80 parts / 200 wires remain deterministic, valid, and bounded even at coordinate limits', () => {
  for (const crowded of [false, true]) {
    const components = Array.from({ length: 80 }, (_, index) =>
      component(
        `R${index}`,
        'resistor',
        crowded ? 99999 : (index % 10) * 110 + 50,
        crowded ? -99999 : Math.floor(index / 10) * 90 + 50,
        (index % 4) * 90,
        { resistance: 1000 + index },
      ),
    );
    const wires = Array.from({ length: 200 }, (_, index) =>
      wire(`w${index}`, `R${index % 80}`, 0, `R${(index * 13 + 17) % 80}`, 1),
    );
    const before = document(components, wires);
    const after = normalizeRecognizedCircuitLayout(before);
    assertOrthogonal(after);
    assert.deepEqual(buildNets(after), buildNets(before));
    assert.deepEqual(normalizeRecognizedCircuitLayout(before), after);
    assert.deepEqual(normalizeRecognizedCircuitLayout(after), after);
    assert.deepEqual(
      after.components.map(({ x, y, rotation, ...rest }) => rest),
      before.components.map(({ x, y, rotation, ...rest }) => rest),
    );
  }
});

test('existing maximum-corner diagonal hints can be replaced without exceeding 32 corners', () => {
  const before = document(
    [
      component('A', 'resistor', -100000, -100000, 270),
      component('B', 'opamp', 100000, 100000, 90),
    ],
    [
      wire(
        'w',
        'A',
        1,
        'B',
        0,
        Array.from({ length: 32 }, (_, index) => ({ x: index * 30, y: index * 19 })),
      ),
    ],
  );
  const after = normalizeRecognizedCircuitLayout(before);
  assertOrthogonal(after);
  assert.deepEqual(buildNets(after), buildNets(before));
  const pin = getPins(after.components[1])[0];
  const local = transformPoint(after.components[1], -40, -18);
  assert.equal(pin.x, after.components[1].x + local.x);
  assert.equal(pin.y, after.components[1].y + local.y);
});

test('beautification rotates horizontal or reversed two-pin branches without swapping polarized terminals', () => {
  for (const type of ['resistor', 'capacitor', 'inductor', 'diode', 'voltage', 'current']) {
    for (const mirrorX of [false, true]) {
      for (const horizontal of [false, true]) {
        const before = document(
          [
            { ...component('X', type, 400, 300, horizontal ? 90 : 0), mirrorX },
            component('A', 'junction', horizontal ? 160 : 400, horizontal ? 300 : 100),
            component('B', 'junction', horizontal ? 640 : 400, horizontal ? 300 : 500),
          ],
          [wire('a', 'A', 0, 'X', 0), wire('b', 'X', 1, 'B', 0)],
        );
        const snapshot = structuredClone(before);
        const after = normalizeRecognizedCircuitLayout(before);
        const part = after.components[0];
        const expectedRotation = (horizontal ? 0 : 90) + (mirrorX ? 180 : 0);
        assert.equal(part.rotation, expectedRotation);
        assert.equal(part.mirrorX, mirrorX);
        assert.deepEqual(part.params, before.components[0].params);
        assert.deepEqual(buildNets(after), buildNets(before));
        assert.deepEqual(before, snapshot);
        assertOrthogonal(after);
        after.wires.forEach((entry) => assert.equal(entry.points.length, 0));
        assert.deepEqual(normalizeRecognizedCircuitLayout(after), after);
      }
    }
  }
});
