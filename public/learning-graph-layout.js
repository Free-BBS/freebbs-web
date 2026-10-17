/* Read-only knowledge graph geometry. Authored coordinates and learning evidence stay untouched. */
(function expose(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FreeBbsLearningGraphLayout = api;
})(typeof window === 'undefined' ? globalThis : window, () => {
  const CARD_WIDTH = 224;
  const CARD_HEIGHT = 104;
  const GAP_X = 96;
  const GAP_Y = 72;
  const keyOf = (value) => (typeof value === 'string' ? value : '');
  const ordered = (edge) => edge.type === 'ordered';
  const number = (value) => Number(value.toFixed(3));
  const stagger = (id, salt) => {
    let hash = salt;
    for (const character of String(id)) hash = (hash * 31 + character.codePointAt(0)) % 104729;
    return (hash % 33) - 16;
  };

  function titleLines(title, maxWidthApprox = 22, maxLines = 2) {
    const limit = Math.max(2, Math.floor(Number(maxWidthApprox) || 22));
    const count = Math.max(1, Math.floor(Number(maxLines) || 2));
    const characters = Array.from(
      String(title || '')
        .replace(/\s+/g, ' ')
        .trim(),
    );
    const units = (character) => (character.codePointAt(0) > 255 ? 2 : 1);
    const result = [];
    let index = 0;
    while (index < characters.length && result.length < count) {
      let line = '';
      let width = 0;
      while (index < characters.length && width + units(characters[index]) <= limit) {
        width += units(characters[index]);
        line += characters[index];
        index += 1;
      }
      result.push(line.trim());
    }
    if (index < characters.length && result.length) {
      const last = Array.from(result.at(-1));
      while (last.reduce((sum, item) => sum + units(item), 0) > limit - 2) last.pop();
      result[result.length - 1] = `${last.join('').trimEnd()}…`;
    }
    return result.length ? result : [''];
  }

  // Call only after attaching the SVG text. Measuring a hidden/closed graph is
  // not evidence that its fallback is too wide; leave that fallback untouched.
  function fitSvgLabel(
    element,
    source,
    { width = 196, lines = 1, x = 14, y = 25, lineHeight = 23, identifier = false } = {},
  ) {
    const document = element?.ownerDocument;
    const available = Number(width);
    if (
      !document?.createElementNS ||
      !element?.appendChild ||
      !element?.replaceChildren ||
      element.isConnected === false ||
      !Number.isFinite(available) ||
      available <= 0
    )
      return false;
    const full = String(source ?? '');
    if (!full) return false;
    const namespace = 'http://www.w3.org/2000/svg';
    const probe = document.createElementNS(namespace, 'tspan');
    probe.setAttribute('visibility', 'hidden');
    probe.setAttribute('aria-hidden', 'true');
    let result;
    try {
      element.appendChild(probe);
      if (typeof probe.getComputedTextLength !== 'function') return false;
      const measure = (value) => {
        probe.textContent = value;
        const length = probe.getComputedTextLength();
        if (!Number.isFinite(length) || length < 0) throw new Error('SVG measurement unavailable');
        return length;
      };
      if (!measure('W')) return false;
      const fits = (value) => measure(value) <= available;
      const ellipsis = fits('…') ? '…' : '';
      const characters = Array.from(identifier ? full : full.replace(/\s+/g, ' ').trim());
      if (identifier) {
        let fitted = full;
        if (!fits(fitted)) {
          fitted = ellipsis;
          for (let keep = characters.length - 1; keep >= 2; keep -= 1) {
            const head = Math.ceil(keep / 2);
            const tail = Math.floor(keep / 2);
            const candidate = `${characters.slice(0, head).join('')}…${characters.slice(-tail).join('')}`;
            if (fits(candidate)) {
              fitted = candidate;
              break;
            }
          }
        }
        result = [fitted];
      } else {
        result = [];
        const count = Math.max(1, Math.floor(Number(lines) || 1));
        let cursor = 0;
        for (let row = 0; row < count && cursor < characters.length; row += 1) {
          let line = '';
          if (row === count - 1) {
            const remaining = characters.slice(cursor).join('');
            if (fits(remaining)) {
              result.push(remaining);
              break;
            }
            while (cursor < characters.length && fits(line + characters[cursor] + ellipsis)) {
              line += characters[cursor];
              cursor += 1;
            }
            result.push(line.trimEnd() + ellipsis);
            break;
          }
          while (cursor < characters.length && fits(line + characters[cursor])) {
            line += characters[cursor];
            cursor += 1;
          }
          if (!line) {
            result.push(ellipsis);
            break;
          }
          result.push(line.trimEnd());
          while (characters[cursor] === ' ') cursor += 1;
        }
      }
    } catch {
      return false;
    } finally {
      if (probe.parentNode === element) element.removeChild(probe);
    }
    if (!result?.length) return false;
    const coordinate = (value, fallback) =>
      Number.isFinite(Number(value)) ? Number(value) : fallback;
    const spans = result.map((line, index) => {
      const span = document.createElementNS(namespace, 'tspan');
      span.setAttribute('x', coordinate(x, 14));
      span.setAttribute('y', coordinate(y, 25) + index * coordinate(lineHeight, 23));
      span.textContent = line;
      return span;
    });
    element.replaceChildren(...spans);
    return true;
  }

  // Iterative strongly connected components keep cycles finite without imposing
  // a false learning order within a cycle or depending on authored coordinates.
  function levels(nodes, edges) {
    const adjacency = new Map(nodes.map((node) => [node.id, []]));
    const reverse = new Map(nodes.map((node) => [node.id, []]));
    for (const edge of edges.filter(ordered)) {
      adjacency.get(edge.source).push(edge.target);
      reverse.get(edge.target).push(edge.source);
    }
    const visited = new Set();
    const finished = [];
    for (const node of nodes) {
      if (visited.has(node.id)) continue;
      visited.add(node.id);
      const stack = [{ id: node.id, next: 0 }];
      while (stack.length) {
        const frame = stack.at(-1);
        const next = adjacency.get(frame.id);
        if (frame.next < next.length) {
          const target = next[frame.next];
          frame.next += 1;
          if (!visited.has(target)) {
            visited.add(target);
            stack.push({ id: target, next: 0 });
          }
        } else {
          finished.push(frame.id);
          stack.pop();
        }
      }
    }
    const component = new Map();
    const groups = [];
    for (const id of finished.reverse()) {
      if (component.has(id)) continue;
      const index = groups.length;
      const members = [];
      const stack = [id];
      component.set(id, index);
      while (stack.length) {
        const current = stack.pop();
        members.push(current);
        for (const source of reverse.get(current))
          if (!component.has(source)) {
            component.set(source, index);
            stack.push(source);
          }
      }
      groups.push(members);
    }
    const links = groups.map(() => new Set());
    const incoming = groups.map(() => 0);
    for (const edge of edges.filter(ordered)) {
      const a = component.get(edge.source);
      const b = component.get(edge.target);
      if (a !== b && !links[a].has(b)) {
        links[a].add(b);
        incoming[b] += 1;
      }
    }
    const rank = groups.map(() => 0);
    const ready = incoming.flatMap((value, index) => (value === 0 ? [index] : []));
    for (let cursor = 0; cursor < ready.length; cursor += 1) {
      const source = ready[cursor];
      for (const target of links[source]) {
        rank[target] = Math.max(rank[target], rank[source] + 1);
        incoming[target] -= 1;
        if (!incoming[target]) ready.push(target);
      }
    }
    return new Map(nodes.map((node) => [node.id, rank[component.get(node.id)]]));
  }

  function place(nodes, edges, focusId, compact) {
    const boxes = [];
    const labels = [];
    const columns = new Map();
    const add = (node, column, row, group) => {
      const box = {
        id: node.id,
        node,
        x:
          (compact ? 56 : 40) +
          column * (CARD_WIDTH + GAP_X) +
          (compact || group === 'current' ? 0 : stagger(node.id, 17)),
        y:
          72 +
          row * (CARD_HEIGHT + GAP_Y) +
          (compact || group === 'current' ? 0 : stagger(node.id, 53)),
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        ...(group ? { group } : {}),
      };
      boxes.push(box);
      columns.set(box, column);
      return box;
    };
    const focus = nodes.find((node) => node.id === focusId);
    if (compact) {
      const sequence = focus ? [focus, ...nodes.filter((node) => node !== focus)] : nodes;
      sequence.forEach((node, index) => {
        let group;
        if (focus) {
          group = 'related';
          if (
            edges.some(
              (link) => ordered(link) && link.source === focusId && link.target === node.id,
            )
          )
            group = 'outgoing';
          if (
            edges.some(
              (link) => ordered(link) && link.target === focusId && link.source === node.id,
            )
          )
            group = 'incoming';
          if (node === focus) group = 'current';
        }
        add(node, 0, index, group);
      });
    } else if (focus) {
      const incoming = new Set(
        edges.filter((edge) => ordered(edge) && edge.target === focusId).map((edge) => edge.source),
      );
      const outgoing = new Set(
        edges.filter((edge) => ordered(edge) && edge.source === focusId).map((edge) => edge.target),
      );
      const groups = { incoming: [], outgoing: [], related: [] };
      for (const node of nodes) {
        if (node === focus) continue;
        groups[
          incoming.has(node.id) ? 'incoming' : outgoing.has(node.id) ? 'outgoing' : 'related'
        ].push(node);
      }
      const rows = Math.max(1, groups.incoming.length, groups.outgoing.length);
      const branch = (items, column, group, direction) =>
        items.forEach((node, index) => {
          const center = (items.length - 1) / 2;
          const bend = center ? Math.round(Math.abs((index - center) / center) * 40) : 0;
          const box = add(node, column, (rows - items.length) / 2 + index, group);
          box.x += direction * bend;
        });
      branch(groups.incoming, 0, 'incoming', -1);
      const current = add(focus, 1, (rows - 1) / 2, 'current');
      branch(groups.outgoing, 2, 'outgoing', 1);
      groups.related.forEach((node, index) => {
        // Use the empty central space before extending below the side branches.
        // One related point should not be pushed below an entire tall hub.
        if (index === 0) {
          const first = add(node, 1, (rows - 1) / 2, 'related');
          first.x = current.x;
          first.y = current.y + Math.round(1.15 * (CARD_HEIGHT + GAP_Y));
          return;
        }
        const restIndex = index - 1;
        const remaining = Math.min(3, groups.related.length - 1 - Math.floor(restIndex / 3) * 3);
        const column = remaining === 1 ? 1 : remaining === 2 ? (restIndex % 3) * 2 : restIndex % 3;
        const box = add(node, column, rows + 1 + Math.floor(restIndex / 3), 'related');
        box.y += 28 * (1 - Math.abs(column - 1));
      });
      for (const [group, text] of [
        ['incoming', '可先了解'],
        ['current', '当前知识点'],
        ['outgoing', '接着了解'],
        ['related', '补充关联'],
      ]) {
        const first = boxes.find((box) => box.group === group);
        if (first) labels.push({ x: first.x, y: first.y - 24, text, group });
      }
    } else if (edges.some(ordered)) {
      const ranks = levels(nodes, edges);
      const rows = new Map();
      const totals = new Map();
      for (const node of nodes)
        totals.set(ranks.get(node.id), (totals.get(ranks.get(node.id)) || 0) + 1);
      const most = Math.max(...totals.values());
      for (const node of nodes) {
        const column = ranks.get(node.id);
        const row = rows.get(column) || 0;
        rows.set(column, row + 1);
        add(node, column, (most - totals.get(column)) / 2 + row);
      }
    } else {
      const columnCount = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(nodes.length))));
      nodes.forEach((node, index) =>
        add(node, index % columnCount, Math.floor(index / columnCount)),
      );
    }
    return { boxes, labels, columns };
  }

  const equal = (a, b) => a.x === b.x && a.y === b.y;
  function simplify(points) {
    const result = [];
    for (const point of points) {
      if (result.length && equal(result.at(-1), point)) continue;
      while (result.length >= 2) {
        const a = result.at(-2);
        const b = result.at(-1);
        const vertical = a.x === b.x && b.x === point.x && (b.y - a.y) * (point.y - b.y) >= 0;
        const horizontal = a.y === b.y && b.y === point.y && (b.x - a.x) * (point.x - b.x) >= 0;
        if (!vertical && !horizontal) break;
        result.pop();
      }
      result.push({ x: point.x, y: point.y });
    }
    return result;
  }
  function segmentClear(a, b, boxes) {
    if (a.x !== b.x && a.y !== b.y) return false;
    return !boxes.some((box) => {
      const left = box.x - 6;
      const right = box.x + box.width + 6;
      const top = box.y - 6;
      const bottom = box.y + box.height + 6;
      return a.x === b.x
        ? a.x > left && a.x < right && Math.max(a.y, b.y) > top && Math.min(a.y, b.y) < bottom
        : a.y > top && a.y < bottom && Math.max(a.x, b.x) > left && Math.min(a.x, b.x) < right;
    });
  }
  const clear = (points, boxes) =>
    points.length > 1 &&
    points.slice(1).every((point, index) => segmentClear(points[index], point, boxes));
  function ports(box, lane) {
    const offset = ((lane % 9) - 4) * 4;
    const distance = 8 + (Math.floor(lane / 9) % 4) * 4;
    return [
      { x: box.x + box.width + distance, y: box.y + box.height / 2 + offset, nx: 1, ny: 0 },
      { x: box.x - distance, y: box.y + box.height / 2 + offset, nx: -1, ny: 0 },
      { x: box.x + box.width / 2 + offset, y: box.y - distance, nx: 0, ny: -1 },
      { x: box.x + box.width / 2 + offset, y: box.y + box.height + distance, nx: 0, ny: 1 },
    ];
  }
  function roundedPath(points) {
    let path = `M ${number(points[0].x)} ${number(points[0].y)}`;
    for (let index = 1; index < points.length - 1; index += 1) {
      const a = points[index - 1];
      const b = points[index];
      const c = points[index + 1];
      const before = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      const after = Math.abs(c.x - b.x) + Math.abs(c.y - b.y);
      const radius = Math.min(4, before / 2, after / 2);
      const entry = {
        x: b.x - Math.sign(b.x - a.x) * radius,
        y: b.y - Math.sign(b.y - a.y) * radius,
      };
      const exit = {
        x: b.x + Math.sign(c.x - b.x) * radius,
        y: b.y + Math.sign(c.y - b.y) * radius,
      };
      path += ` L ${number(entry.x)} ${number(entry.y)}`;
      path += ` Q ${number(b.x)} ${number(b.y)} ${number(exit.x)} ${number(exit.y)}`;
    }
    const end = points.at(-1);
    return `${path} L ${number(end.x)} ${number(end.y)}`;
  }
  function arrowPath(points) {
    const tip = points.at(-1);
    const previous = points.at(-2);
    const dx = Math.sign(tip.x - previous.x);
    const dy = Math.sign(tip.y - previous.y);
    return `M ${number(tip.x - dx * 8 - dy * 4)} ${number(tip.y - dy * 8 + dx * 4)} L ${number(
      tip.x,
    )} ${number(tip.y)} L ${number(tip.x - dx * 8 + dy * 4)} ${number(tip.y - dy * 8 - dx * 4)}`;
  }
  function route(edge, boxes, byId, index, occupied, columns) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    const sourcePorts = ports(source, index);
    const targetPorts = ports(target, index + (source === target ? 1 : 0));
    const left = Math.min(...boxes.map((box) => box.x)) - 28;
    const right = Math.max(...boxes.map((box) => box.x + box.width)) + 28;
    const top = Math.min(...boxes.map((box) => box.y)) - 28 - index * 6;
    let best;
    let bestScore = Infinity;
    const consider = (raw, start, end) => {
      const points = simplify(raw);
      if (points.length < 2) return;
      const first = points[1];
      const last = points.at(-2);
      const a = points[0];
      const b = points.at(-1);
      if (
        (first.x - a.x) * start.nx + (first.y - a.y) * start.ny <= 0 ||
        (b.x - last.x) * end.nx + (b.y - last.y) * end.ny >= 0
      )
        return;
      if (!clear(points, boxes)) return;
      const signature = JSON.stringify(points);
      const reverse = JSON.stringify([...points].reverse());
      const length = points
        .slice(1)
        .reduce(
          (sum, point, i) =>
            sum + Math.abs(point.x - points[i].x) + Math.abs(point.y - points[i].y),
          0,
        );
      const score =
        length +
        points.length * 16 +
        (occupied.has(signature) || occupied.has(reverse) ? 10000 : 0);
      if (score < bestScore) {
        best = points;
        bestScore = score;
      }
    };
    const nearest = (values, center) =>
      [...new Set(values)].sort((a, b) => Math.abs(a - center) - Math.abs(b - center)).slice(0, 8);
    for (const a of sourcePorts)
      for (const b of targetPorts) {
        if (equal(a, b)) continue;
        consider([a, b], a, b);
        consider([a, { x: b.x, y: a.y }, b], a, b);
        consider([a, { x: a.x, y: b.y }, b], a, b);
        const xs = nearest(
          [
            left,
            right,
            (a.x + b.x) / 2,
            ...boxes.flatMap((box) => [box.x - 28, box.x + box.width + 28]),
          ],
          (a.x + b.x) / 2,
        );
        const ys = nearest(
          [top, (a.y + b.y) / 2, ...boxes.flatMap((box) => [box.y - 28, box.y + box.height + 28])],
          (a.y + b.y) / 2,
        );
        for (const x of xs) consider([a, { x, y: a.y }, { x, y: b.y }, b], a, b);
        for (const y of ys) consider([a, { x: a.x, y }, { x: b.x, y }, b], a, b);
      }
    // Every column has a clear side corridor. This escape stays valid even for
    // dense hubs, backwards edges and arbitrarily long ordered cycles.
    const a = sourcePorts[0];
    const b = targetPorts[0];
    const corridor = (box) =>
      Math.max(
        ...boxes
          .filter((item) => columns.get(item) === columns.get(box))
          .map((item) => item.x + item.width),
      ) + 28;
    const ax = corridor(source);
    const bx = corridor(target);
    consider(
      [a, { x: ax, y: a.y }, { x: ax, y: top }, { x: bx, y: top }, { x: bx, y: b.y }, b],
      a,
      b,
    );
    if (!best) throw new Error('Knowledge graph has no safe reading route');
    occupied.add(JSON.stringify(best));
    return { edge, points: best };
  }

  function layout(rawNodes = [], rawEdges = [], { focusId = '', compact = false } = {}) {
    const seen = new Set();
    const nodes = (Array.isArray(rawNodes) ? rawNodes : []).filter((node) => {
      const id = keyOf(node?.id);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    const edges = (Array.isArray(rawEdges) ? rawEdges : []).filter(
      (edge) =>
        edge &&
        ['ordered', 'related'].includes(edge.type) &&
        seen.has(edge.source) &&
        seen.has(edge.target),
    );
    if (!nodes.length) return { boxes: [], routes: [], labels: [], width: 320, height: 160 };
    const { boxes, labels, columns } = place(nodes, edges, focusId, compact);
    const byId = new Map(boxes.map((box) => [box.id, box]));
    const occupied = new Set();
    const routed = edges.map((edge, index) => route(edge, boxes, byId, index, occupied, columns));
    const all = [
      ...boxes.map((box) => ({ x: box.x, y: box.y })),
      ...routed.flatMap((item) => item.points),
    ];
    const dx = Math.max(0, 16 - Math.min(...all.map((point) => point.x)));
    const dy = Math.max(0, 16 - Math.min(...all.map((point) => point.y)));
    for (const box of boxes) {
      box.x += dx;
      box.y += dy;
    }
    for (const label of labels) {
      label.x += dx;
      label.y += dy;
    }
    const routes = routed.map((item) => {
      const points = item.points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
      return {
        ...item,
        points,
        path: roundedPath(points),
        arrow: ordered(item.edge) ? arrowPath(points) : null,
      };
    });
    return {
      boxes,
      routes,
      labels,
      width: Math.ceil(
        Math.max(
          ...boxes.map((box) => box.x + box.width),
          ...routes.flatMap((item) => item.points.map((point) => point.x)),
        ) + 24,
      ),
      height: Math.ceil(
        Math.max(
          ...boxes.map((box) => box.y + box.height),
          ...routes.flatMap((item) => item.points.map((point) => point.y)),
        ) + 32,
      ),
    };
  }
  return { CARD_WIDTH, CARD_HEIGHT, titleLines, fitSvgLabel, layout };
});
