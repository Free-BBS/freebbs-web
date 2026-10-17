const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const graph = require('../public/learning-graph-layout');

const nodes = (count) =>
  Array.from({ length: count }, (_, index) => ({
    id: `N-${index}`,
    title: `知识点 ${index}`,
    position: { x: 10, y: 10 },
  }));
const edge = (source, target, type = 'ordered') => ({ source, target, type });
const inside = (point, box, inset = 0) =>
  point.x > box.x + inset &&
  point.x < box.x + box.width - inset &&
  point.y > box.y + inset &&
  point.y < box.y + box.height - inset;
const distance = (point, box) =>
  Math.hypot(
    Math.max(box.x - point.x, 0, point.x - box.x - box.width),
    Math.max(box.y - point.y, 0, point.y - box.y - box.height),
  );
function validate(result, { compact = false } = {}) {
  const { boxes, routes } = result;
  assert.ok(Number.isFinite(result.width) && Number.isFinite(result.height));
  if (compact) assert.ok(result.width <= 380, 'compact graph stays within 380 SVG units');
  for (const box of boxes) {
    assert.equal(box.width, 224);
    assert.equal(box.height, 104);
    assert.ok(box.x >= 0 && box.y >= 0);
    assert.ok(box.x + box.width <= result.width && box.y + box.height <= result.height);
    for (const other of boxes)
      if (other !== box)
        assert.ok(
          box.x + box.width <= other.x ||
            other.x + other.width <= box.x ||
            box.y + box.height <= other.y ||
            other.y + other.height <= box.y,
          'cards never overlap',
        );
  }
  const byId = new Map(boxes.map((box) => [box.id, box]));
  for (const route of routes) {
    assert.ok(route.points.length > 1);
    assert.match(route.path, /^M /);
    assert.ok(distance(route.points[0], byId.get(route.edge.source)) >= 8);
    assert.ok(distance(route.points.at(-1), byId.get(route.edge.target)) >= 8);
    const source = byId.get(route.edge.source);
    const target = byId.get(route.edge.target);
    const first = route.points[0];
    const afterFirst = route.points[1];
    const tip = route.points.at(-1);
    const beforeTip = route.points.at(-2);
    assert.ok(
      (afterFirst.x - first.x) * (first.x - source.x - source.width / 2) +
        (afterFirst.y - first.y) * (first.y - source.y - source.height / 2) >
        0,
      'source terminal points away from its own card',
    );
    assert.ok(
      (tip.x - beforeTip.x) * (target.x + target.width / 2 - tip.x) +
        (tip.y - beforeTip.y) * (target.y + target.height / 2 - tip.y) >
        0,
      'target terminal points towards its own card, not along its border',
    );
    assert.equal(typeof route.arrow === 'string', route.edge.type === 'ordered');
    for (const point of route.points) {
      assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
      assert.ok(
        point.x >= 0 && point.x <= result.width && point.y >= 0 && point.y <= result.height,
      );
    }
    for (let index = 1; index < route.points.length; index += 1) {
      const a = route.points[index - 1];
      const b = route.points[index];
      assert.ok(a.x === b.x || a.y === b.y, 'segments remain orthogonal');
      for (const box of boxes)
        assert.equal(
          a.x === b.x
            ? a.x > box.x &&
                a.x < box.x + box.width &&
                Math.max(a.y, b.y) > box.y &&
                Math.min(a.y, b.y) < box.y + box.height
            : a.y > box.y &&
                a.y < box.y + box.height &&
                Math.max(a.x, b.x) > box.x &&
                Math.min(a.x, b.x) < box.x + box.width,
          false,
          'no segment enters any endpoint or third-party card',
        );
    }
    // Check actual rounded SVG curves, not only their rectilinear skeleton.
    const tokens = route.path.match(/[MLQ]|-?\d+(?:\.\d+)?/g);
    let current;
    for (let cursor = 0; cursor < tokens.length;) {
      const command = tokens[cursor];
      cursor += 1;
      const a = { x: Number(tokens[cursor]), y: Number(tokens[cursor + 1]) };
      cursor += 2;
      if (command === 'M') current = a;
      else if (command === 'L') current = a;
      else {
        assert.equal(command, 'Q');
        const end = { x: Number(tokens[cursor]), y: Number(tokens[cursor + 1]) };
        cursor += 2;
        for (let step = 0; step <= 20; step += 1) {
          const t = step / 20;
          const p = {
            x: (1 - t) ** 2 * current.x + 2 * (1 - t) * t * a.x + t ** 2 * end.x,
            y: (1 - t) ** 2 * current.y + 2 * (1 - t) * t * a.y + t ** 2 * end.y,
          };
          assert.ok(
            boxes.every((box) => !inside(p, box)),
            'rounded corner never clips a card',
          );
        }
        current = end;
      }
    }
    if (route.arrow) {
      const values = route.arrow.match(/-?\d+(?:\.\d+)?/g).map(Number);
      const arrowTip = { x: values[2], y: values[3] };
      assert.deepEqual(arrowTip, route.points.at(-1));
      assert.ok(distance(arrowTip, byId.get(route.edge.target)) >= 6);
      for (let index = 0; index < values.length; index += 2)
        assert.ok(boxes.every((box) => !inside({ x: values[index], y: values[index + 1] }, box)));
    }
  }
}

test('UMD exports the same pure geometry helper without requiring a DOM', () => {
  const sandbox = { window: {} };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../public/learning-graph-layout.js'), 'utf8'),
    sandbox,
  );
  assert.equal(typeof sandbox.window.FreeBbsLearningGraphLayout.layout, 'function');
  assert.equal(typeof sandbox.window.FreeBbsLearningGraphLayout.titleLines, 'function');
});

test('empty and invalid material produce a finite layout without inventing nodes or edges', () => {
  assert.deepEqual(graph.layout(), { boxes: [], routes: [], labels: [], width: 320, height: 160 });
  const result = graph.layout(
    [null, {}, { id: 'A' }, { id: 'A' }],
    [edge('A', 'missing'), edge('A', 'A', 'unknown'), null],
  );
  assert.equal(result.boxes.length, 1);
  assert.equal(result.routes.length, 0);
  validate(result);
});

test('reading layout ignores duplicate authored coordinates and never mutates author data', () => {
  const original = nodes(8);
  const edges = original.slice(1).map((node, index) => edge(original[index].id, node.id));
  const snapshot = JSON.stringify({ original, edges });
  original.forEach((node) => {
    Object.freeze(node.position);
    Object.freeze(node);
  });
  edges.forEach(Object.freeze);
  const result = graph.layout(Object.freeze(original), Object.freeze(edges));
  validate(result);
  assert.equal(result.routes.length, edges.length);
  assert.equal(JSON.stringify({ original, edges }), snapshot);
  result.boxes.forEach((box) =>
    assert.equal(
      box.node,
      original.find((node) => node.id === box.id),
    ),
  );
  result.routes.forEach((route, index) => assert.equal(route.edge, edges[index]));
});

test('focus view keeps incoming, current, outgoing and related branches with explanatory labels', () => {
  const original = nodes(9);
  const edges = [
    edge('N-1', 'N-0'),
    edge('N-2', 'N-0'),
    edge('N-0', 'N-3'),
    edge('N-0', 'N-4'),
    edge('N-0', 'N-5', 'related'),
    edge('N-6', 'N-0', 'related'),
  ];
  const result = graph.layout(original, edges, { focusId: 'N-0' });
  validate(result);
  const current = result.boxes.find((box) => box.id === 'N-0');
  assert.equal(current.group, 'current');
  result.boxes
    .filter((box) => box.group === 'incoming')
    .forEach((box) => assert.ok(box.x < current.x));
  result.boxes
    .filter((box) => box.group === 'outgoing')
    .forEach((box) => assert.ok(box.x > current.x));
  result.boxes
    .filter((box) => box.group === 'related')
    .forEach((box) => assert.ok(box.y > current.y + current.height));
  assert.deepEqual(
    result.labels.map((label) => label.group),
    ['incoming', 'current', 'outgoing', 'related'],
  );
  assert.equal(result.boxes.length, original.length, 'unconnected supplied nodes are not dropped');
});

test('ordered chapters use directed layers while an ordered cycle occupies one finite layer', () => {
  const original = nodes(7);
  const edges = [
    edge('N-0', 'N-1'),
    edge('N-1', 'N-2'),
    edge('N-2', 'N-0'),
    edge('N-2', 'N-3'),
    edge('N-3', 'N-4'),
    edge('N-4', 'N-5'),
    edge('N-5', 'N-6'),
  ];
  const result = graph.layout(original, edges);
  validate(result);
  const byId = new Map(result.boxes.map((box) => [box.id, box]));
  assert.ok(
    Math.max(...['N-0', 'N-1', 'N-2'].map((id) => byId.get(id).x)) -
      Math.min(...['N-0', 'N-1', 'N-2'].map((id) => byId.get(id).x)) <=
      32,
  );
  for (const [a, b] of [
    ['N-2', 'N-3'],
    ['N-3', 'N-4'],
    ['N-4', 'N-5'],
    ['N-5', 'N-6'],
  ])
    assert.ok(byId.get(a).x + byId.get(a).width < byId.get(b).x);
});

test('focus branches use a deterministic restrained fan with related material below, not a rigid grid', () => {
  const original = nodes(13);
  const edges = [1, 2, 3, 4, 5].map((index) => edge(`N-${index}`, 'N-0'));
  edges.push(...[6, 7, 8, 9, 10].map((index) => edge('N-0', `N-${index}`)));
  edges.push(edge('N-0', 'N-11', 'related'), edge('N-0', 'N-12', 'related'));
  const result = graph.layout(original, edges, { focusId: 'N-0' });
  validate(result);
  const get = (id) => result.boxes.find((box) => box.id === id);
  assert.ok(get('N-1').x < get('N-3').x && get('N-5').x < get('N-3').x);
  assert.ok(get('N-6').x > get('N-8').x && get('N-10').x > get('N-8').x);
  assert.deepEqual(result, graph.layout(original, edges, { focusId: 'N-0' }));
});

test('first related point uses the central empty space and each group label follows its actual first card', () => {
  for (const branchSize of [1, 2, 5, 10]) {
    const original = nodes(branchSize * 2 + 2);
    const edges = Array.from({ length: branchSize }, (_, index) => edge(`N-${index + 1}`, 'N-0'));
    edges.push(
      ...Array.from({ length: branchSize }, (_, index) =>
        edge('N-0', `N-${branchSize + index + 1}`),
      ),
    );
    edges.push(edge('N-0', original.at(-1).id, 'related'));
    const result = graph.layout(original, edges, { focusId: 'N-0' });
    validate(result);
    const current = result.boxes.find((box) => box.group === 'current');
    const related = result.boxes.find((box) => box.group === 'related');
    assert.equal(related.x, current.x);
    assert.equal(related.y - current.y, Math.round(1.15 * (104 + 72)));
    for (const label of result.labels) {
      const first = result.boxes.find((box) => box.group === label.group);
      assert.equal(label.x, first.x);
      assert.equal(label.y, first.y - 24);
    }
    if (branchSize === 2)
      assert.ok(result.height < 650, 'five neighbors do not force a 900px tall graph');
  }
});

test('unordered maps have stable restrained staggering rather than authored pile-ups or random jumps', () => {
  const original = nodes(17);
  const edges = original
    .slice(1)
    .map((node, index) => edge(original[index].id, node.id, 'related'));
  const a = graph.layout(original, edges);
  const b = graph.layout(original, edges);
  validate(a);
  assert.deepEqual(a, b);
  assert.ok(
    a.boxes.some((box) => box.x !== 40 && box.x !== 360 && box.x !== 680 && box.x !== 1000),
  );
});

test('compact view is one readable column, focus first, retaining backwards and cross relationships', () => {
  const original = nodes(24);
  const edges = original
    .slice(1)
    .flatMap((node, index) => [
      edge('N-0', node.id),
      edge(node.id, original[(index + 7) % original.length].id, 'related'),
    ]);
  const result = graph.layout(original, edges, { compact: true, focusId: 'N-13' });
  validate(result, { compact: true });
  assert.equal(result.boxes[0].id, 'N-13');
  assert.equal(new Set(result.boxes.map((box) => box.x)).size, 1);
  assert.equal(result.routes.length, edges.length);
});

test('parallel, opposite and self relationships remain independently represented and safely routed', () => {
  const original = nodes(3);
  const edges = Array.from({ length: 40 }, (_, index) =>
    index % 2
      ? edge('N-1', 'N-0', index % 3 ? 'ordered' : 'related')
      : edge('N-0', 'N-1', index % 3 ? 'ordered' : 'related'),
  );
  edges.push(edge('N-0', 'N-0'), edge('N-2', 'N-2', 'related'));
  for (const compact of [false, true]) {
    const result = graph.layout(original, edges, { compact });
    validate(result, { compact });
    assert.equal(result.routes.length, edges.length);
    assert.equal(new Set(result.routes.map((route) => route.path)).size, result.routes.length);
  }
});

test('dense semantic hubs do not sacrifice valid nodes or draw through third-party cards', () => {
  const original = nodes(34);
  const edges = original
    .slice(1)
    .map((node, index) =>
      index < 10 ? edge(node.id, 'N-0') : edge('N-0', node.id, index < 22 ? 'ordered' : 'related'),
    );
  edges.push(
    ...original
      .slice(1, 10)
      .map((node, index) => edge(node.id, original[index + 22].id, 'related')),
  );
  for (const options of [{ focusId: 'N-0' }, { compact: true }, {}]) {
    const result = graph.layout(original, edges, options);
    validate(result, options);
    assert.equal(result.boxes.length, original.length);
    assert.equal(result.routes.length, edges.length);
  }
});

test('deterministic mixed-graph matrix remains finite and collision-free across cycles and sparse islands', () => {
  let seed = 481;
  const random = (maximum) => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed % maximum;
  };
  for (const count of [1, 4, 13, 27]) {
    const original = nodes(count);
    const edges = Array.from({ length: count * 3 }, (_, index) =>
      edge(
        original[random(count)].id,
        original[random(count)].id,
        index % 3 ? 'ordered' : 'related',
      ),
    );
    for (const options of [
      {},
      { focusId: original[0].id },
      { compact: true, focusId: original.at(-1).id },
    ]) {
      const result = graph.layout(original, edges, options);
      validate(result, options);
      assert.equal(result.routes.length, edges.length);
    }
  }
});

test('titles use two readable approximate lines, Unicode-safe clipping and no mutation of original title', () => {
  const title = '卷积与线性时不变系统的响应叠加以及各类边界条件';
  assert.deepEqual(graph.titleLines('连续时间卷积'), ['连续时间卷积']);
  assert.deepEqual(graph.titleLines('ASCII title'), ['ASCII title']);
  const lines = graph.titleLines(title);
  assert.equal(lines.length, 2);
  assert.ok(lines[1].endsWith('…'));
  const units = (line) =>
    Array.from(line).reduce((sum, character) => sum + (character.codePointAt(0) > 255 ? 2 : 1), 0);
  lines.forEach((line) => assert.ok(units(line) <= 22));
  assert.deepEqual(graph.titleLines('😀😀😀😀😀😀😀😀😀😀😀😀', 8, 2), ['😀😀😀😀', '😀😀😀…']);
  assert.deepEqual(graph.titleLines(''), ['']);
});

function svgLabelHarness({ hidden = false, detached = false, failMeasurement = false } = {}) {
  const state = { hidden, failMeasurement };
  const measure = (value) =>
    Array.from(value).reduce((sum, character) => {
      if (character === 'W') return sum + 21;
      if (character === 'i' || character === 'l') return sum + 4;
      if (character === ' ') return sum + 5;
      if (character === '…') return sum + 13;
      return (
        sum + (character.codePointAt(0) > 65535 ? 27 : character.codePointAt(0) > 255 ? 18 : 8)
      );
    }, 0);
  class SvgElement {
    constructor(document, tag) {
      this.ownerDocument = document;
      this.tagName = tag;
      this.children = [];
      this.attributes = new Map();
      this.parentNode = null;
      this.isConnected = false;
      this.value = '';
    }

    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    }

    getAttribute(name) {
      return this.attributes.get(name);
    }

    set textContent(value) {
      this.children = [];
      this.value = String(value);
    }

    get textContent() {
      return this.value + this.children.map((child) => child.textContent).join('');
    }

    appendChild(child) {
      this.children.push(child);
      child.parentNode = this;
      child.isConnected = this.isConnected;
      return child;
    }

    removeChild(child) {
      this.children.splice(this.children.indexOf(child), 1);
      child.parentNode = null;
      child.isConnected = false;
    }

    replaceChildren(...children) {
      [...this.children].forEach((child) => this.removeChild(child));
      this.value = '';
      children.forEach((child) => this.appendChild(child));
    }

    getComputedTextLength() {
      if (state.failMeasurement) throw new Error('measurement failed');
      return !this.isConnected || state.hidden ? 0 : measure(this.textContent);
    }
  }
  const document = { createElementNS: (namespace, tag) => new SvgElement(document, tag) };
  const element = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  element.isConnected = !detached;
  element.setAttribute('aria-label', '原始完整来源');
  element.setAttribute('data-author-id', 'DO-NOT-CHANGE');
  const fallback = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
  fallback.setAttribute('x', 14);
  fallback.setAttribute('y', 25);
  fallback.textContent = '已存在的近似 fallback…';
  element.appendChild(fallback);
  return { element, fallback, state, measure };
}

test('actual SVG measurement shortens wide W identifiers by retaining distinguishable head and tail', () => {
  const h = svgLabelHarness();
  const source = 'WWW-123456789-WWWWWWWWWWWWWWWWWWWW-Z9';
  const attributes = [...h.element.attributes];
  assert.equal(graph.fitSvgLabel(h.element, source, { identifier: true }), true);
  assert.equal(h.element.children.length, 1);
  const label = h.element.children[0];
  assert.ok(h.measure(label.textContent) <= 196);
  assert.ok(label.textContent.startsWith('WWW'));
  assert.ok(label.textContent.endsWith('Z9'));
  assert.ok(label.textContent.includes('…'));
  assert.deepEqual(
    [...h.element.attributes],
    attributes,
    'full accessible source and author identifier remain unchanged',
  );
  assert.equal(source, 'WWW-123456789-WWWWWWWWWWWWWWWWWWWW-Z9');
  assert.equal(label.getAttribute('x'), '14');
  assert.equal(label.getAttribute('y'), '25');
  assert.equal(
    h.element.children.some((child) => child.getAttribute('aria-hidden') === 'true'),
    false,
    'measurement probe is removed',
  );
});

test('real title widths wrap Chinese and mixed-width text into at most two measured lines', () => {
  for (const source of [
    '连续时间线性时不变系统与冲激响应以及卷积运算的边界条件',
    'WWW iiiiii WWW iiiiii WWW iiiiii WWW iiiiii WWW',
  ]) {
    const h = svgLabelHarness();
    assert.equal(
      graph.fitSvgLabel(h.element, source, { width: 196, lines: 2, x: 15, y: 50, lineHeight: 24 }),
      true,
    );
    assert.equal(h.element.children.length, 2);
    h.element.children.forEach((line, index) => {
      assert.ok(h.measure(line.textContent) <= 196);
      assert.equal(line.getAttribute('x'), '15');
      assert.equal(line.getAttribute('y'), String(50 + index * 24));
    });
    assert.ok(h.element.children.at(-1).textContent.endsWith('…'));
  }
});

test('SVG title fitting is Unicode-safe and keeps short full text without unnecessary ellipsis', () => {
  const h = svgLabelHarness();
  assert.equal(
    graph.fitSvgLabel(h.element, '😀😀😀😀😀😀😀😀😀😀😀😀😀😀', { width: 100, lines: 2 }),
    true,
  );
  assert.equal(h.element.children.length, 2);
  h.element.children.forEach((line) => {
    assert.ok(h.measure(line.textContent) <= 100);
    assert.ok(
      !/[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF])|(?<![\\uD800-\\uDBFF])[\\uDC00-\\uDFFF]/u.test(
        line.textContent,
      ),
    );
  });
  assert.equal(graph.fitSvgLabel(h.element, '中文 iii', { lines: 2 }), true);
  assert.equal(h.element.children.length, 1);
  assert.equal(h.element.textContent, '中文 iii');
});

test('zero-sized closed SVG, unavailable metrics and detached labels preserve the exact fallback until reopened', () => {
  for (const options of [{ hidden: true }, { detached: true }, { failMeasurement: true }]) {
    const h = svgLabelHarness(options);
    const attributes = [...h.element.attributes];
    assert.equal(
      graph.fitSvgLabel(h.element, 'WWWWWWWWWWWWWWWWWWWWWWWW', { identifier: true }),
      false,
    );
    assert.equal(h.element.children.length, 1);
    assert.equal(h.element.children[0], h.fallback);
    assert.equal(h.fallback.textContent, '已存在的近似 fallback…');
    assert.deepEqual([...h.element.attributes], attributes);
    h.state.hidden = false;
    h.state.failMeasurement = false;
    h.element.isConnected = true;
    assert.equal(
      graph.fitSvgLabel(h.element, 'WWWWWWWWWWWWWWWWWWWWWWWW', { identifier: true }),
      true,
    );
    assert.ok(h.measure(h.element.textContent) <= 196);
  }
  assert.equal(graph.fitSvgLabel(null, '不连接 DOM'), false);
});
