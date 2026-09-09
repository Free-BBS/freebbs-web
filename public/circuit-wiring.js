(function circuitWiringModule(root) {
  const renderer =
    typeof module !== 'undefined' && module.exports
      ? require('./circuit-renderer')
      : root.FreeBbsCircuitRenderer;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const sameEndpoint = (a, b) => a.componentId === b.componentId && a.pin === b.pin;
  const samePoint = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-7;
  const endpointKey = (endpoint) => JSON.stringify([endpoint.componentId, endpoint.pin]);

  function pinPosition(document, endpoint) {
    const component = document.components.find((item) => item.id === endpoint?.componentId);
    if (!component || !Number.isInteger(endpoint.pin) || endpoint.pin < 0)
      throw new Error('连接端点无效，请重新选择引脚或导线。');
    const pins =
      component.type === 'junction'
        ? [{ x: component.x, y: component.y }]
        : renderer.getPins(component);
    const pin = pins[endpoint.pin];
    if (!pin) throw new Error('连接端点无效，请重新选择引脚或导线。');
    return { x: pin.x, y: pin.y };
  }

  function wireRoute(document, wire) {
    const from = pinPosition(document, wire.from);
    const to = pinPosition(document, wire.to);
    const middle = Math.round((from.x + to.x) / 40) * 20;
    const custom = Array.isArray(wire.points);
    const points = custom
      ? wire.points
      : [
          { x: middle, y: from.y },
          { x: middle, y: to.y },
        ];
    const route = [from, ...points, to];
    return custom
      ? route
      : route.filter((point, index) => !index || !samePoint(point, route[index - 1]));
  }

  function nearestPoint(route, position) {
    let nearest;
    for (let index = 0; index < route.length - 1; index += 1) {
      const a = route[index];
      const b = route[index + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const squaredLength = dx * dx + dy * dy;
      const fraction = squaredLength
        ? Math.max(
            0,
            Math.min(1, ((position.x - a.x) * dx + (position.y - a.y) * dy) / squaredLength),
          )
        : 0;
      const point = { x: a.x + fraction * dx, y: a.y + fraction * dy };
      const distance = Math.hypot(position.x - point.x, position.y - point.y);
      if (!nearest || distance < nearest.distance) nearest = { index, point, distance };
    }
    return nearest || { index: 0, point: route[0], distance: 0 };
  }

  function connectedEndpoints(document, endpoint) {
    const neighbors = new Map();
    const join = (left, right) => {
      const a = endpointKey(left);
      const b = endpointKey(right);
      if (!neighbors.has(a)) neighbors.set(a, []);
      if (!neighbors.has(b)) neighbors.set(b, []);
      neighbors.get(a).push(b);
      neighbors.get(b).push(a);
    };
    document.wires.forEach((wire) => join(wire.from, wire.to));
    const grounds = document.components.filter((component) => component.type === 'ground');
    grounds
      .slice(1)
      .forEach((component) =>
        join({ componentId: grounds[0].id, pin: 0 }, { componentId: component.id, pin: 0 }),
      );
    const visited = new Set([endpointKey(endpoint)]);
    const pending = [...visited];
    while (pending.length) {
      const current = pending.pop();
      (neighbors.get(current) || []).forEach((neighbor) => {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          pending.push(neighbor);
        }
      });
    }
    return visited;
  }

  function connectToWire(input, wireId, position, { fromEndpoint } = {}) {
    if (!input || !Array.isArray(input.components) || !Array.isArray(input.wires))
      throw new Error('电路数据无效，无法连接导线。');
    const target = input.wires.find((wire) => wire.id === wireId);
    if (!target) throw new Error('目标导线不存在，请重新选择。');
    if (!Number.isFinite(position?.x) || !Number.isFinite(position?.y))
      throw new Error('连接位置无效，请重新点击导线。');
    const fromPosition = fromEndpoint ? pinPosition(input, fromEndpoint) : null;
    const route = wireRoute(input, target);
    const projected = nearestPoint(route, position);
    let endpoint;
    const endpoints = [
      { value: target.from, position: route[0] },
      { value: target.to, position: route.at(-1) },
    ];
    endpoints.sort(
      (a, b) =>
        Math.hypot(a.position.x - projected.point.x, a.position.y - projected.point.y) -
        Math.hypot(b.position.x - projected.point.x, b.position.y - projected.point.y),
    );
    if (
      Math.hypot(
        endpoints[0].position.x - projected.point.x,
        endpoints[0].position.y - projected.point.y,
      ) <= 10
    )
      endpoint = clone(endpoints[0].value);
    else {
      const connected = connectedEndpoints(input, target.from);
      const existing = input.components.find(
        (component) =>
          component.type === 'junction' &&
          samePoint(component, projected.point) &&
          connected.has(endpointKey({ componentId: component.id, pin: 0 })),
      );
      if (existing) endpoint = { componentId: existing.id, pin: 0 };
    }

    const document = clone(input);
    const identifiers = new Set([...document.components, ...document.wires].map((item) => item.id));
    const uniqueId = (prefix) => {
      let index = 1;
      while (identifiers.has(`${prefix}${index}`)) index += 1;
      const id = `${prefix}${index}`;
      identifiers.add(id);
      return id;
    };
    if (!endpoint) {
      // An explicit connection from a pin already at the crossing can share that
      // endpoint directly. Unselected crossings are never merged by position.
      if (fromPosition && samePoint(fromPosition, projected.point)) endpoint = clone(fromEndpoint);
      else {
        const junction = {
          id: uniqueId('J'),
          type: 'junction',
          x: projected.point.x,
          y: projected.point.y,
          rotation: 0,
          params: {},
        };
        endpoint = { componentId: junction.id, pin: 0 };
        document.components.push(junction);
      }
      const before = route.slice(1, projected.index + 1).map((point) => ({ ...point }));
      const after = route.slice(projected.index + 1, -1).map((point) => ({ ...point }));
      while (before.length && samePoint(before.at(-1), projected.point)) before.pop();
      while (after.length && samePoint(after[0], projected.point)) after.shift();
      const targetIndex = document.wires.findIndex((wire) => wire.id === wireId);
      const original = document.wires[targetIndex];
      document.wires.splice(
        targetIndex,
        1,
        { ...original, to: { ...endpoint }, points: before },
        { ...original, id: uniqueId('w'), from: { ...endpoint }, points: after },
      );
    }
    if (
      fromEndpoint &&
      !sameEndpoint(fromEndpoint, endpoint) &&
      !document.wires.some(
        (wire) =>
          (sameEndpoint(wire.from, fromEndpoint) && sameEndpoint(wire.to, endpoint)) ||
          (sameEndpoint(wire.to, fromEndpoint) && sameEndpoint(wire.from, endpoint)),
      )
    )
      document.wires.push({ id: uniqueId('w'), from: clone(fromEndpoint), to: { ...endpoint } });
    if (document.components.length > 80)
      throw new Error('每个电路最多 80 个元件，无法添加导线连接点。');
    if (document.wires.length > 200) throw new Error('每个电路最多 200 条导线，无法完成连接。');
    return { document, endpoint: { ...endpoint } };
  }

  const exported = { connectToWire };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  Object.assign(root, { FreeBbsCircuitWiring: exported });
})(typeof globalThis !== 'undefined' ? globalThis : this);
