const {
  getPins,
  transformPoint,
  componentLabelLayout,
  componentValue,
} = require('../public/circuit-renderer');
const { buildNets } = require('../public/circuit-engine');

const GRID = 20;
const LIMIT = 100000;
const CENTER_LIMIT = LIMIT - 100;
const snap = (value) =>
  Math.max(-CENTER_LIMIT, Math.min(CENTER_LIMIT, Math.round(value / GRID) * GRID)) || 0;
const same = (a, b) => a.x === b.x && a.y === b.y;

// These are symbol bodies, not label boxes. The renderer remains the source of
// truth for actual terminals, including its asymmetric 18/22/28/44 px offsets.
function obstacle(component) {
  if (component.type === 'junction') return null;
  let bounds = [-23, -23, 23, 23];
  if (component.type === 'ground') bounds = [-15, 0, 15, 12];
  else if (component.type === 'resistor') bounds = [-25, -10, 25, 10];
  else if (component.type === 'capacitor') bounds = [-7, -18, 7, 18];
  else if (component.type === 'inductor') bounds = [-25, -20, 25, 2];
  else if (component.type === 'diode') bounds = [-14, -17, 15, 17];
  else if (['bjt', 'mosfet'].includes(component.type)) bounds = [-20, -25, 6, 32];
  else if (component.type === 'opamp') bounds = [-26, -33, 29, 33];
  else if (['vcvs', 'vccs'].includes(component.type)) bounds = [-25, -22, 25, 32];
  else if (['ccvs', 'cccs'].includes(component.type)) bounds = [-25, -22, 25, 22];
  else if (['oscilloscope2', 'twoport'].includes(component.type)) bounds = [-40, -36, 40, 36];
  else if (component.type === 'nonlinear') bounds = [-23, -18, 23, 18];
  const [left, top, right, bottom] = bounds;
  const corners = [
    [left, top],
    [left, bottom],
    [right, top],
    [right, bottom],
  ].map(([x, y]) => transformPoint(component, x, y));
  return {
    left: component.x + Math.floor((Math.min(...corners.map((p) => p.x)) - 8) / GRID) * GRID,
    right: component.x + Math.ceil((Math.max(...corners.map((p) => p.x)) + 8) / GRID) * GRID,
    top: component.y + Math.floor((Math.min(...corners.map((p) => p.y)) - 8) / GRID) * GRID,
    bottom: component.y + Math.ceil((Math.max(...corners.map((p) => p.y)) + 8) / GRID) * GRID,
  };
}

function placementBox(component) {
  const pins = getPins(component);
  const body = obstacle(component);
  return {
    left: Math.min(body?.left ?? component.x, ...pins.map((p) => p.x)) - 10,
    right: Math.max(body?.right ?? component.x, ...pins.map((p) => p.x)) + 10,
    top: Math.min(body?.top ?? component.y, ...pins.map((p) => p.y)) - 10,
    bottom: Math.max(body?.bottom ?? component.y, ...pins.map((p) => p.y)) + 10,
  };
}

function intersects(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function arrangeComponents(components) {
  const placed = [];
  const boxes = [];
  const originalOrder = [...components].sort((a, b) => a.y - b.y || a.x - b.x);
  originalOrder.forEach((component) => {
    const start = { ...component, x: snap(component.x), y: snap(component.y) };
    const startBox = placementBox(start);
    const free = (candidate) => {
      const dx = candidate.x - start.x;
      const dy = candidate.y - start.y;
      const bounds = {
        left: startBox.left + dx,
        right: startBox.right + dx,
        top: startBox.top + dy,
        bottom: startBox.bottom + dy,
      };
      return !boxes.some((box) => intersects(bounds, box));
    };
    let best = start;
    if (!free(start)) {
      // Search nearby grid positions, never rescale/reorder the whole diagram.
      // A ring is finite, and 100 rings comfortably fit all 80 supported symbols.
      let bestCost = Infinity;
      for (let ring = 1; ring <= 100; ring += 1) {
        const offsets = [];
        for (let dx = -ring; dx <= ring; dx += 1) {
          for (const dy of [-ring, ring]) {
            offsets.push([dx, dy]);
          }
        }
        for (let dy = -ring + 1; dy < ring; dy += 1) {
          for (const dx of [-ring, ring]) offsets.push([dx, dy]);
        }
        for (const [dx, dy] of offsets) {
          const candidate = { ...start, x: start.x + dx * GRID, y: start.y + dy * GRID };
          if (
            Math.abs(candidate.x) > CENTER_LIMIT ||
            Math.abs(candidate.y) > CENTER_LIMIT ||
            !free(candidate)
          )
            continue;
          let cost = dx * dx + dy * dy;
          placed.forEach((other, index) => {
            for (const axis of ['x', 'y']) {
              const original = component[axis] - originalOrder[index][axis];
              if (Math.abs(original) >= GRID && original * (candidate[axis] - other[axis]) <= 0)
                cost += 10000;
              if (Math.abs(original) < GRID)
                cost += (Math.abs(candidate[axis] - other[axis]) / GRID) * 6;
            }
          });
          if (cost < bestCost) {
            bestCost = cost;
            best = candidate;
          }
        }
        if (ring * ring >= bestCost) break;
      }
    }
    placed.push(best);
    boxes.push(placementBox(best));
  });
  const positions = new Map(placed.map((component) => [component.id, component]));
  return components.map((component) => positions.get(component.id));
}

function labelBox(component) {
  if (component.type === 'junction') return null;
  const label = componentLabelLayout(component);
  const textWidth = (value) =>
    [...String(value)].reduce((width, char) => width + (char.charCodeAt(0) > 255 ? 12 : 7), 0);
  const width =
    Math.min(240, Math.max(textWidth(component.id), textWidth(componentValue(component)))) + 8;
  const x = component.x + label.x;
  let left = x - width / 2;
  if (label.anchor === 'start') left = x - 4;
  if (label.anchor === 'end') left = x - width + 4;
  return {
    left,
    right: left + width,
    top: component.y + label.nameY - 16,
    bottom: component.y + label.valueY + 4,
  };
}

function wireObstacles(components, wire, pins, pinNets) {
  const net = pinNets[`${wire.from.componentId}:${wire.from.pin}`];
  return components.flatMap((component) => {
    const componentPins = pins.get(component.id);
    const body = obstacle(component);
    const endpoint = [wire.from.componentId, wire.to.componentId].includes(component.id);
    if (component.type === 'junction') {
      if (pinNets[`${component.id}:0`] === net) return [];
      return [
        {
          left: component.x - 8,
          right: component.x + 8,
          top: component.y - 8,
          bottom: component.y + 8,
        },
      ];
    }
    if (!endpoint)
      return [
        {
          left: Math.min(body.left, ...componentPins.map((p) => p.x - 8)),
          right: Math.max(body.right, ...componentPins.map((p) => p.x + 8)),
          top: Math.min(body.top, ...componentPins.map((p) => p.y - 8)),
          bottom: Math.max(body.bottom, ...componentPins.map((p) => p.y + 8)),
        },
      ];
    return [
      body,
      ...componentPins
        .filter((pin) => pinNets[`${component.id}:${pin.pin}`] !== net)
        .map((pin) => ({
          left: pin.x - 6,
          right: pin.x + 6,
          top: pin.y - 6,
          bottom: pin.y + 6,
        })),
    ];
  });
}

function direction(component, pin) {
  let local = pin === 0 ? [-1, 0] : [1, 0];
  if (component.type === 'ground') local = [0, -1];
  else if (component.type === 'junction') return null;
  else if (['bjt', 'mosfet'].includes(component.type))
    local = [
      [0, -1],
      [-1, 0],
      [0, 1],
    ][pin];
  else if (component.type === 'opamp') local = pin < 2 ? [-1, 0] : [1, 0];
  else if (['vcvs', 'vccs'].includes(component.type) && pin > 1) local = [0, 1];
  else if (['oscilloscope2', 'twoport'].includes(component.type))
    local = pin < 2 ? [-1, 0] : [1, 0];
  return transformPoint(component, ...local);
}

function simplify(points) {
  const result = [];
  points.forEach(({ x, y }) => {
    const p = { x, y };
    if (result.length && same(result.at(-1), p)) return;
    while (result.length > 1) {
      const a = result.at(-2);
      const b = result.at(-1);
      if ((a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y)) result.pop();
      else break;
    }
    result.push(p);
  });
  return result;
}

function orthogonal(points) {
  return points.every((p, i) => !i || p.x === points[i - 1].x || p.y === points[i - 1].y);
}

function penetration(a, b, box) {
  if (a.x === b.x && a.x > box.left && a.x < box.right)
    return Math.max(
      0,
      Math.min(Math.max(a.y, b.y), box.bottom) - Math.max(Math.min(a.y, b.y), box.top),
    );
  if (a.y === b.y && a.y > box.top && a.y < box.bottom)
    return Math.max(
      0,
      Math.min(Math.max(a.x, b.x), box.right) - Math.max(Math.min(a.x, b.x), box.left),
    );
  return 0;
}

function collisions(points, obstacles) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1)
    for (const box of obstacles) total += penetration(points[i - 1], points[i], box);
  return total;
}

function outward(a, b, normal) {
  return !normal || (b.x - a.x) * normal.x + (b.y - a.y) * normal.y > 0;
}

function routeCost(points, fromDirection, toDirection, labels) {
  let length = 0;
  for (let i = 1; i < points.length; i += 1)
    length += Math.abs(points[i].x - points[i - 1].x) + Math.abs(points[i].y - points[i - 1].y);
  const wrongExit =
    points.length > 1 &&
    (!outward(points[0], points[1], fromDirection) ||
      !outward(points.at(-1), points.at(-2), toDirection));
  return (
    length +
    Math.max(0, points.length - 2) * 24 +
    (wrongExit ? 200 : 0) +
    collisions(points, labels) * 4
  );
}

function addElbows(points, horizontalFirst) {
  const result = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a.x !== b.x && a.y !== b.y)
      result.push(horizontalFirst ? { x: b.x, y: a.y } : { x: a.x, y: b.y });
    result.push(b);
  }
  return result;
}

class MinHeap {
  constructor() {
    this.items = [];
  }

  push(item) {
    let index = this.items.length;
    this.items.push(item);
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.items[parent].priority <= item.priority) break;
      this.items[index] = this.items[parent];
      index = parent;
    }
    this.items[index] = item;
  }

  pop() {
    const first = this.items[0];
    const last = this.items.pop();
    if (!this.items.length) return first;
    let index = 0;
    while (index * 2 + 1 < this.items.length) {
      let child = index * 2 + 1;
      if (
        child + 1 < this.items.length &&
        this.items[child + 1].priority < this.items[child].priority
      )
        child += 1;
      if (this.items[child].priority >= last.priority) break;
      this.items[index] = this.items[child];
      index = child;
    }
    this.items[index] = last;
    return first;
  }
}

// Only obstacle boundaries and the two terminals form the search grid. Unlike
// a pixel/grid flood-fill, its size does not grow with image/document dimensions.
function findClearRoute(a, b, obstacles) {
  const unique = (values) => [...new Set(values)].sort((x, y) => x - y);
  const xs = unique([
    a.x,
    b.x,
    ...obstacles.flatMap((box) => [box.left, box.right]),
    Math.max(-LIMIT, Math.min(a.x, b.x, ...obstacles.map((box) => box.left)) - GRID),
    Math.min(LIMIT, Math.max(a.x, b.x, ...obstacles.map((box) => box.right)) + GRID),
  ]);
  const ys = unique([
    a.y,
    b.y,
    ...obstacles.flatMap((box) => [box.top, box.bottom]),
    Math.max(-LIMIT, Math.min(a.y, b.y, ...obstacles.map((box) => box.top)) - GRID),
    Math.min(LIMIT, Math.max(a.y, b.y, ...obstacles.map((box) => box.bottom)) + GRID),
  ]);
  const width = xs.length;
  const height = ys.length;
  const horizontal = new Uint8Array((width - 1) * height);
  const vertical = new Uint8Array(width * (height - 1));
  for (const box of obstacles) {
    const left = xs.indexOf(box.left);
    const right = xs.indexOf(box.right);
    const top = ys.indexOf(box.top);
    const bottom = ys.indexOf(box.bottom);
    for (let y = top + 1; y < bottom; y += 1)
      horizontal.fill(1, y * (width - 1) + left, y * (width - 1) + right);
    for (let y = top; y < bottom; y += 1) vertical.fill(1, y * width + left + 1, y * width + right);
  }
  const start = ys.indexOf(a.y) * width + xs.indexOf(a.x);
  const end = ys.indexOf(b.y) * width + xs.indexOf(b.x);
  const distance = new Float64Array(width * height * 2).fill(Infinity);
  const parent = new Int32Array(distance.length).fill(-1);
  const heap = new MinHeap();
  for (let axis = 0; axis < 2; axis += 1) {
    distance[start * 2 + axis] = 0;
    heap.push({
      state: start * 2 + axis,
      cost: 0,
      priority: Math.abs(a.x - b.x) + Math.abs(a.y - b.y),
    });
  }
  while (heap.items.length) {
    const current = heap.pop();
    if (current.cost !== distance[current.state]) continue;
    const cell = Math.floor(current.state / 2);
    const x = cell % width;
    const y = Math.floor(cell / width);
    if (cell === end) {
      const route = [];
      for (let { state } = current; state !== -1; state = parent[state]) {
        const node = Math.floor(state / 2);
        route.push({ x: xs[node % width], y: ys[Math.floor(node / width)] });
      }
      return simplify(route.reverse());
    }
    const visit = (nextX, nextY, axis) => {
      const state = (nextY * width + nextX) * 2 + axis;
      const cost =
        current.cost +
        Math.abs(xs[nextX] - xs[x]) +
        Math.abs(ys[nextY] - ys[y]) +
        (current.state % 2 === axis ? 0 : 24);
      if (cost >= distance[state]) return;
      distance[state] = cost;
      parent[state] = current.state;
      heap.push({
        state,
        cost,
        priority: cost + Math.abs(xs[nextX] - b.x) + Math.abs(ys[nextY] - b.y),
      });
    };
    if (x > 0 && !horizontal[y * (width - 1) + x - 1]) visit(x - 1, y, 0);
    if (x + 1 < width && !horizontal[y * (width - 1) + x]) visit(x + 1, y, 0);
    if (y > 0 && !vertical[(y - 1) * width + x]) visit(x, y - 1, 1);
    if (y + 1 < height && !vertical[y * width + x]) visit(x, y + 1, 1);
  }
  return null;
}

function normalizeRecognizedCircuitLayout(document) {
  const components = arrangeComponents(document.components);
  const componentMap = new Map(components.map((component) => [component.id, component]));
  const pins = new Map(components.map((component) => [component.id, getPins(component)]));
  const { pinNets } = buildNets(document);
  const labels = components.map(labelBox).filter(Boolean);
  const wires = document.wires.map((wire) => {
    const obstacles = wireObstacles(components, wire, pins, pinNets);
    const a = pins.get(wire.from.componentId)[wire.from.pin];
    const b = pins.get(wire.to.componentId)[wire.to.pin];
    const fromDirection = direction(componentMap.get(wire.from.componentId), wire.from.pin);
    const toDirection = direction(componentMap.get(wire.to.componentId), wire.to.pin);
    const original = [{ x: a.x, y: a.y }, ...(wire.points || []), { x: b.x, y: b.y }];
    if (orthogonal(original) && !collisions(original, obstacles) && !collisions(original, labels))
      return { ...wire, points: simplify(original).slice(1, -1) };
    const candidates = [];
    const add = (route) => {
      if (!route) return;
      const points = simplify(route);
      if (
        points.length > 34 ||
        !orthogonal(points) ||
        points.slice(1, -1).some((p) => Math.abs(p.x) > LIMIT || Math.abs(p.y) > LIMIT)
      )
        return;
      if (!collisions(points, obstacles)) candidates.push(points);
    };
    add(addElbows(original, true));
    add(addElbows(original, false));
    add([a, { x: b.x, y: a.y }, b]);
    add([a, { x: a.x, y: b.y }, b]);
    const stub = (point, normal) =>
      normal ? { x: point.x + normal.x * GRID, y: point.y + normal.y * GRID } : point;
    const start = stub(a, fromDirection);
    const end = stub(b, toDirection);
    const xs = [
      ...new Set([
        snap((a.x + b.x) / 2),
        start.x,
        end.x,
        ...obstacles.flatMap((box) => [box.left, box.right]),
      ]),
    ];
    const ys = [
      ...new Set([
        snap((a.y + b.y) / 2),
        start.y,
        end.y,
        ...obstacles.flatMap((box) => [box.top, box.bottom]),
      ]),
    ];
    for (const x of xs) add([a, start, { x, y: start.y }, { x, y: end.y }, end, b]);
    for (const y of ys) add([a, start, { x: start.x, y }, { x: end.x, y }, end, b]);
    if (!candidates.length) {
      const clear = findClearRoute(start, end, obstacles);
      if (clear) add([a, ...clear, b]);
    }
    // Spacing keeps terminals outside every foreign symbol. If a particularly
    // constrained outgoing stub has no path, search directly from the real pins.
    if (!candidates.length) add(findClearRoute(a, b, obstacles));
    if (!candidates.length) throw new Error('无法在保留电路连接的前提下生成不穿过元件的正交导线。');
    candidates.sort(
      (first, second) =>
        routeCost(first, fromDirection, toDirection, labels) -
        routeCost(second, fromDirection, toDirection, labels),
    );
    return { ...wire, points: candidates[0].slice(1, -1) };
  });
  return { ...document, components, wires };
}

module.exports = { normalizeRecognizedCircuitLayout };
