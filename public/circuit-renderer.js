(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const labels = {
    ground: '接地',
    junction: '连接点',
    resistor: '电阻',
    capacitor: '电容',
    inductor: '电感',
    voltage: '电压源',
    current: '电流源',
    vcvs: '压控电压源',
    vccs: '压控电流源',
    ccvs: '流控电压源',
    cccs: '流控电流源',
    diode: '二极管',
    bjt: 'BJT',
    mosfet: 'MOS',
    opamp: '运放',
    nonlinear: '自定义伏安特性',
    voltmeter: '电压表',
    ammeter: '电流表',
    oscilloscope: '示波器',
    oscilloscope2: '双通道示波器',
    twoport: '二端口网络',
  };

  function formatValue(value, unit = '') {
    if (!Number.isFinite(value)) return '—';
    if (!value) return `0${unit ? ` ${unit}` : ''}`;
    const prefixes = [
      [1e9, 'G'],
      [1e6, 'M'],
      [1e3, 'k'],
      [1, ''],
      [1e-3, 'm'],
      [1e-6, 'µ'],
      [1e-9, 'n'],
      [1e-12, 'p'],
    ];
    const selected = prefixes.find(([factor]) => Math.abs(value) >= factor);
    if (!selected) return `${value.toExponential(2)}${unit ? ` ${unit}` : ''}`;
    const [factor, prefix] = selected;
    return `${Number((value / factor).toPrecision(4))} ${prefix}${unit}`.trim();
  }

  // Mirror in local symbol axes, then rotate. This changes geometry, never pin identity.
  function transformPoint(component, x, y) {
    const localX = x * (component.mirrorX ? -1 : 1);
    const localY = y * (component.mirrorY ? -1 : 1);
    const angle = ((Number(component.rotation) || 0) * Math.PI) / 180;
    return {
      x: Math.round(localX * Math.cos(angle) - localY * Math.sin(angle)),
      y: Math.round(localX * Math.sin(angle) + localY * Math.cos(angle)),
    };
  }

  function getPins(component) {
    let offsets = [
      [-40, 0, '+'],
      [40, 0, '−'],
    ];
    if (component.type === 'ground') offsets = [[0, -28, 'GND']];
    if (component.type === 'junction') offsets = [[0, 0, '连接点']];
    if (component.type === 'bjt')
      offsets = [
        [0, -40, 'C'],
        [-40, 0, 'B'],
        [0, 40, 'E'],
      ];
    if (component.type === 'mosfet')
      offsets = [
        [0, -40, 'D'],
        [-40, 0, 'G'],
        [0, 40, 'S'],
      ];
    if (component.type === 'opamp')
      offsets = [
        [-40, -18, '+'],
        [-40, 18, '−'],
        [40, 0, 'OUT'],
      ];
    if (['vcvs', 'vccs'].includes(component.type))
      offsets = [
        [-40, 0, '+'],
        [40, 0, '−'],
        [-18, 44, 'C+'],
        [18, 44, 'C−'],
      ];
    if (['oscilloscope2', 'twoport'].includes(component.type)) {
      const channels = component.type === 'oscilloscope2' ? ['CH1', 'CH2'] : ['P1', 'P2'];
      offsets = [
        [-60, -22, `${channels[0]}+`],
        [-60, 22, `${channels[0]}−`],
        [60, -22, `${channels[1]}+`],
        [60, 22, `${channels[1]}−`],
      ];
    }
    return offsets.map(([x, y, label], pin) => {
      const position = transformPoint(component, x, y);
      return {
        componentId: component.id,
        pin,
        label,
        x: (Number(component.x) || 0) + position.x,
        y: (Number(component.y) || 0) + position.y,
      };
    });
  }

  function getWireRoute(wire, componentList) {
    const components =
      componentList instanceof Map
        ? componentList
        : new Map((componentList || []).map((component) => [component.id, component]));
    const from = components.get(wire.from?.componentId);
    const to = components.get(wire.to?.componentId);
    if (!from || !to) return [];
    const a = getPins(from)[wire.from.pin];
    const b = getPins(to)[wire.to.pin];
    if (!a || !b) return [];
    const custom = Array.isArray(wire.points);
    const mid = Math.round((a.x + b.x) / 40) * 20;
    const points = custom
      ? wire.points
      : [
          { x: mid, y: a.y },
          { x: mid, y: b.y },
        ];
    const route = [{ x: a.x, y: a.y }, ...points.map(({ x, y }) => ({ x, y })), { x: b.x, y: b.y }];
    // Keep custom vertex ordering exact; automatic routes only remove duplicate
    // adjacent corners. Geometry never joins electrically crossing wires.
    return custom
      ? route
      : route.filter(
          (point, index) =>
            !index || point.x !== route[index - 1].x || point.y !== route[index - 1].y,
        );
  }

  function insertWirePoint(wire, components, position) {
    const route = getWireRoute(wire, components);
    if (route.length < 2 || route.length - 2 >= 32) return null;
    let nearest;
    for (let index = 0; index < route.length - 1; index += 1) {
      const a = route[index];
      const b = route[index + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const denominator = dx * dx + dy * dy;
      const t = denominator
        ? Math.max(
            0,
            Math.min(1, ((position.x - a.x) * dx + (position.y - a.y) * dy) / denominator),
          )
        : 0;
      const point = { x: a.x + t * dx, y: a.y + t * dy };
      const distance = Math.hypot(position.x - point.x, position.y - point.y);
      if (!nearest || distance < nearest.distance) nearest = { index, point, distance };
    }
    const points = route.slice(1, -1);
    points.splice(nearest.index, 0, nearest.point);
    return { points, index: nearest.index };
  }

  const wireFocusRequests = new WeakMap();

  function svgElement(tag, attributes, text) {
    const element = document.createElementNS(NS, tag);
    Object.entries(attributes || {}).forEach(([name, value]) =>
      element.setAttribute(name, String(value)),
    );
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function sourceValueLines(component) {
    const p = component.params || {};
    if (!['voltage', 'current'].includes(component.type) || !['sine', 'pulse'].includes(p.waveform))
      return null;
    const unit = component.type === 'voltage' ? 'V' : 'A';
    return [
      `${p.waveform === 'sine' ? '正弦' : '脉冲'} ${formatValue(Number(p.amplitude), unit)}${p.waveform === 'sine' ? '峰值' : '增量'}`,
      formatValue(Number(p.frequency), 'Hz'),
      `偏置 ${formatValue(Number(p.dc), unit)}`,
    ];
  }

  function componentValue(component) {
    const p = component.params || {};
    const sourceLines = sourceValueLines(component);
    if (sourceLines) return sourceLines.join(' · ');
    if (component.type === 'resistor') return formatValue(Number(p.resistance), 'Ω');
    if (component.type === 'capacitor') return formatValue(Number(p.capacitance), 'F');
    if (component.type === 'inductor') return formatValue(Number(p.inductance), 'H');
    if (component.type === 'voltage') return formatValue(Number(p.dc), 'V');
    if (component.type === 'current') return formatValue(Number(p.dc), 'A');
    if (component.type === 'bjt') return `${p.polarity || 'npn'} · β=${p.beta}`;
    if (component.type === 'mosfet')
      return `${p.polarity || 'n'} · W/L=${Number((Number(p.w) / Number(p.l)).toPrecision(3))}`;
    if (component.type === 'nonlinear') return String(p.expression || 'i = k*u^3').slice(0, 34);
    if (component.type === 'twoport') return `${p.parameterSet || 'Z'} 矩阵`;
    if (['vcvs', 'vccs', 'ccvs', 'cccs'].includes(component.type)) return `增益 ${p.gain}`;
    return labels[component.type] || component.type;
  }

  function componentLabelLayout(component) {
    const transistor = ['bjt', 'mosfet'].includes(component.type);
    // Bounds include terminal dots and the current indicator, so text stays clear
    // of asymmetric shapes and extra control terminals at every orientation.
    let bounds = [-44, -26, 44, 40];
    if (transistor) bounds = [-44, -44, 20, 44];
    else if (component.type === 'ground') bounds = [-19, -32, 19, 16];
    else if (component.type === 'opamp') bounds = [-44, -37, 44, 54];
    else if (['vcvs', 'vccs'].includes(component.type)) bounds = [-44, -26, 44, 64];
    else if (['oscilloscope2', 'twoport'].includes(component.type)) bounds = [-80, -40, 64, 44];
    const [left, top, right, bottom] = bounds;
    const corners = [
      transformPoint(component, left, top),
      transformPoint(component, right, top),
      transformPoint(component, right, bottom),
      transformPoint(component, left, bottom),
    ];
    const box = {
      left: Math.min(...corners.map((point) => point.x)),
      right: Math.max(...corners.map((point) => point.x)),
      top: Math.min(...corners.map((point) => point.y)),
      bottom: Math.max(...corners.map((point) => point.y)),
    };
    const sideLabel = transistor || component.type === 'ground';
    const normal = transformPoint(component, sideLabel ? 1 : 0, sideLabel ? 0 : -1);
    const count = sourceValueLines(component)?.length || 1;
    let side = 'top';
    let x = 0;
    let y = box.top - 20 - count * 14;
    let anchor = 'middle';
    if (normal.x) {
      side = normal.x > 0 ? 'right' : 'left';
      x = normal.x > 0 ? box.right + 12 : box.left - 12;
      y = -4 - (count - 1) * 7;
      anchor = normal.x > 0 ? 'start' : 'end';
    } else if (normal.y > 0) {
      side = 'bottom';
      y = box.bottom + 28;
    }
    return { x, nameY: y, valueY: y + 18, anchor, side, bounds: box };
  }

  function currentIndicatorGeometry(component, current = 1) {
    let points = [
      [-13, 34],
      [13, 34],
    ];
    if (['bjt', 'mosfet'].includes(component.type))
      points = [
        [14, -13],
        [14, 13],
      ];
    else if (component.type === 'opamp')
      points = [
        [13, 48],
        [-13, 48],
      ];
    else if (['vcvs', 'vccs'].includes(component.type))
      points = [
        [-13, 58],
        [13, 58],
      ];
    else if (['oscilloscope2', 'twoport'].includes(component.type))
      points = [
        [-72, -13],
        [-72, 13],
      ];
    const transformed = points.map(([x, y]) => transformPoint(component, x, y));
    if (current < 0) transformed.reverse();
    const [from, to] = transformed;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const dx = (to.x - from.x) / length;
    const dy = (to.y - from.y) / length;
    return {
      from,
      to,
      path: `M ${from.x} ${from.y} L ${to.x} ${to.y}`,
      arrow: `M ${to.x - dx * 6 - dy * 4} ${to.y - dy * 6 + dx * 4} L ${to.x} ${to.y} L ${to.x - dx * 6 + dy * 4} ${to.y - dy * 6 - dx * 4}`,
    };
  }

  function addSymbol(group, component) {
    const line = (d) => group.append(svgElement('path', { d, fill: 'none' }));
    const circle = (r) =>
      group.append(
        svgElement('circle', { cx: 0, cy: 0, r, fill: 'var(--circuit-surface, #102228)' }),
      );
    const text = (value, x = 0, y = 5, size = 15) =>
      group.append(
        svgElement(
          'text',
          {
            x: 0,
            y: size * 0.35,
            // Keep glyphs readable while their anchors follow the transformed symbol.
            transform: `translate(${x} ${y - size * 0.35}) scale(${component.mirrorX ? -1 : 1} ${component.mirrorY ? -1 : 1}) rotate(${-(component.rotation || 0)})`,
            'font-size': size,
            'text-anchor': 'middle',
            stroke: 'none',
            fill: 'currentColor',
          },
          value,
        ),
      );
    const currentArrow = () => line('M -9 0 H 10 M 4 -6 L 10 0 L 4 6');
    const voltageMarks = () => {
      line('M -12 -4 V 4 M -16 0 H -8 M 8 0 H 16');
    };
    const sourceWaveform = component.params?.waveform;
    const varyingSource = ['sine', 'pulse'].includes(sourceWaveform);
    const { type } = component;
    if (type === 'junction') {
      group.append(svgElement('circle', { cx: 0, cy: 0, r: 5, fill: 'currentColor' }));
    } else if (type === 'ground') {
      line('M 0 -28 V 0 M -15 0 H 15 M -10 6 H 10 M -5 12 H 5');
    } else if (type === 'resistor') {
      line('M -40 0 H -25 L -20 -9 L -12 9 L -4 -9 L 4 9 L 12 -9 L 20 9 L 25 0 H 40');
    } else if (type === 'capacitor') {
      line('M -40 0 H -6 M -6 -17 V 17 M 6 -17 V 17 M 6 0 H 40');
    } else if (type === 'inductor') {
      line(
        'M -40 0 H -24 C -24 -20 -12 -20 -12 0 C -12 -20 0 -20 0 0 C 0 -20 12 -20 12 0 C 12 -20 24 -20 24 0 H 40',
      );
    } else if (type === 'diode') {
      line('M -40 0 H -13 M -13 -16 L 14 0 L -13 16 Z M 14 -16 V 16 M 14 0 H 40');
    } else if (type === 'bjt') {
      line('M -40 0 H -15 M -15 -18 V 18 M -15 -10 L 0 -23 V -40 M -15 10 L 0 24 V 40');
      if (component.params?.polarity === 'pnp') line('M -3 20 L -11 14 L -4 12');
      else line('M -10 23 L -2 22 L -4 14');
    } else if (type === 'mosfet') {
      line(
        'M -40 0 H -19 M -19 -20 V 20 M -12 -20 V -9 M -12 -5 V 5 M -12 9 V 20 M -12 -16 H 0 V -40 M -12 16 H 0 V 40',
      );
      // The source-leg convention follows conventional current: nMOS out, pMOS in.
      group.append(
        svgElement('path', {
          d: component.params?.polarity === 'p' ? 'M -5 31 L 0 23 L 5 31' : 'M -5 24 L 0 32 L 5 24',
          fill: 'none',
          'data-mos-source-arrow': component.params?.polarity === 'p' ? 'in' : 'out',
        }),
      );
    } else if (type === 'opamp') {
      line('M -26 -33 L 29 0 L -26 33 Z M -40 -18 H -26 M -40 18 H -26 M 29 0 H 40');
      text('+', -17, -12, 13);
      text('−', -17, 23, 13);
    } else if (['vcvs', 'vccs', 'ccvs', 'cccs'].includes(type)) {
      line('M -40 0 H -25 L 0 -22 L 25 0 L 0 22 L -25 0 M 25 0 H 40');
      if (['vccs', 'cccs'].includes(type)) currentArrow();
      else voltageMarks();
      if (['vcvs', 'vccs'].includes(type)) {
        line('M -18 44 V 32 M 18 44 V 32');
        text('C+', -18, 26, 9);
        text('C−', 18, 26, 9);
      }
    } else if (['oscilloscope2', 'twoport'].includes(type)) {
      line('M -60 -22 H -40 M -60 22 H -40 M 40 -22 H 60 M 40 22 H 60');
      group.append(
        svgElement('rect', {
          x: -40,
          y: -36,
          width: 80,
          height: 72,
          rx: 4,
          fill: 'var(--circuit-surface, #102228)',
        }),
      );
      const channel = type === 'oscilloscope2' ? 'CH' : 'P';
      text(`${channel}1+`, -24, -20, 9);
      text(`${channel}1−`, -24, 25, 9);
      text(`${channel}2+`, 24, -20, 9);
      text(`${channel}2−`, 24, 25, 9);
      if (type === 'twoport') text(component.params?.parameterSet || 'Z', 0, 5, 15);
      else {
        line('M -28 0 C -20 -16 -12 -16 -4 0 C 4 16 12 16 20 0');
        line('M -20 3 C -12 -7 -4 -7 4 3 C 12 13 20 13 28 3');
      }
    } else if (type === 'nonlinear') {
      line('M -40 0 H -23 M 23 0 H 40');
      group.append(
        svgElement('rect', {
          x: -23,
          y: -18,
          width: 46,
          height: 36,
          rx: 3,
          fill: 'var(--circuit-surface, #102228)',
        }),
      );
      text('f(u)', 0, 5, 13);
    } else {
      line('M -40 0 H -22 M 22 0 H 40');
      circle(22);
      if (type === 'voltage') {
        if (varyingSource) {
          line('M -9 -17 V -11 M -12 -14 H -6 M 6 -14 H 12');
          line(
            sourceWaveform === 'sine'
              ? 'M -15 2 C -10 -11 -5 -11 0 2 C 5 15 10 15 15 2'
              : 'M -15 7 H -9 V -5 H 0 V 7 H 8 V -5 H 15',
          );
        } else voltageMarks();
      } else if (type === 'current') {
        currentArrow();
        if (varyingSource)
          line(
            sourceWaveform === 'sine'
              ? 'M -12 -12 C -8 -16 -4 -16 0 -12 C 4 -8 8 -8 12 -12'
              : 'M -12 -9 H -7 V -15 H 0 V -9 H 7 V -15 H 12',
          );
      } else if (type === 'voltmeter') text('V');
      else if (type === 'ammeter') text('A');
      else if (type === 'oscilloscope') line('M -16 0 C -11 -19 -5 -19 0 0 C 5 19 11 19 16 0');
    }
  }

  function renderSchematic(container, circuit, options = {}) {
    container.replaceChildren();
    const svg = svgElement('svg', {
      viewBox: (options.viewBox || [0, 0, 1000, 640]).join(' '),
      width: '100%',
      height: '100%',
      role: options.interactive ? 'group' : 'img',
      'aria-label': '电路原理图',
      class: 'circuit-schematic',
    });
    svg.style.cssText =
      'display:block;min-height:240px;color:var(--circuit-ink,#dfedf0);touch-action:pan-x pan-y';
    svg.append(
      svgElement(
        'style',
        {},
        `
      .circuit-node{cursor:pointer;outline:none}.circuit-node:focus .circuit-selection{stroke:var(--circuit-accent,#48b6bd)}
      .circuit-pin-hit{fill:transparent;stroke:none;cursor:crosshair}.circuit-pin-hit:focus{fill:#48b6bd33;outline:none}
      .circuit-current{stroke-dasharray:3 7;animation:circuit-current-flow 0.8s linear infinite}
      .circuit-wire-hit{cursor:pointer;outline:none}.circuit-wire-hit:focus{stroke:#48b6bd33}
      .circuit-wire-point{cursor:move;outline:none;touch-action:none}.circuit-wire-point:focus + circle{stroke-width:3;fill:var(--circuit-accent,#48b6bd)}
      .circuit-wire-add{cursor:pointer;outline:none;touch-action:manipulation}.circuit-wire-add:focus circle{stroke-width:3}
      @keyframes circuit-current-flow{to{stroke-dashoffset:-20}}
      @media(prefers-reduced-motion:reduce){.circuit-current{animation:none}}
      text{font-family:var(--font-ui,system-ui,sans-serif);font-variant-numeric:tabular-nums}
    `,
      ),
    );
    const background = svgElement('rect', {
      x: 0,
      y: 0,
      width: 1000,
      height: 640,
      fill: 'var(--circuit-surface,#102228)',
    });
    svg.append(background);
    const grid = svgElement('path', {
      d:
        Array.from({ length: 51 }, (_, i) => `M ${i * 20} 0 V 640`).join(' ') +
        Array.from({ length: 33 }, (_, i) => `M 0 ${i * 20} H 1000`).join(' '),
      stroke: 'var(--circuit-grid,#283e44)',
      'stroke-width': 0.7,
      opacity: 0.4,
      fill: 'none',
    });
    grid.style.pointerEvents = 'none';
    svg.append(grid);
    const components = new Map(
      (circuit.components || []).map((component) => [component.id, { ...component }]),
    );
    const wires = [];
    const nodes = [];
    let { frame } = options;
    let netMap = {};
    try {
      netMap = globalThis.FreeBbsCircuitEngine?.buildNets(circuit).pinNets || {};
    } catch {
      /* Draft wiring may be incomplete. */
    }
    const wireLayer = svgElement('g', {
      fill: 'none',
      'stroke-width': 2.4,
      'stroke-linejoin': 'round',
    });
    const nodeLayer = svgElement('g', {
      'stroke-width': 2.2,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    });
    const wireEditLayer = svgElement('g', { class: 'circuit-wire-controls' });
    svg.append(wireLayer, nodeLayer, wireEditLayer);
    const connectionLayer = svgElement('g', {
      'data-connection-preview': '',
      visibility: 'hidden',
      fill: 'none',
      stroke: 'var(--circuit-accent,#48b6bd)',
    });
    connectionLayer.style.pointerEvents = 'none';
    const connectionHighlight = svgElement('path', { 'stroke-width': 8, opacity: 0.3 });
    const connectionPath = svgElement('path', { 'stroke-width': 2.4, 'stroke-dasharray': '7 5' });
    const connectionLanding = svgElement('circle', {
      r: 6,
      fill: 'var(--circuit-accent,#48b6bd)',
      'stroke-width': 2,
    });
    const connectionCorners = svgElement('g', { 'data-draft-corners': '' });
    connectionLayer.append(
      connectionHighlight,
      connectionPath,
      connectionLanding,
      connectionCorners,
    );
    svg.append(connectionLayer);
    let pinDrag = null;

    function nearestWirePosition(wire, position) {
      const route = getWireRoute(wire, components);
      let nearest;
      for (let index = 1; index < route.length; index += 1) {
        const from = route[index - 1];
        const to = route[index];
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const lengthSquared = dx * dx + dy * dy;
        const ratio = lengthSquared
          ? Math.max(
              0,
              Math.min(
                1,
                ((position.x - from.x) * dx + (position.y - from.y) * dy) / lengthSquared,
              ),
            )
          : 0;
        const point = { x: from.x + ratio * dx, y: from.y + ratio * dy };
        const distance = Math.hypot(point.x - position.x, point.y - position.y);
        if (!nearest || distance < nearest.distance) nearest = { position: point, distance };
      }
      return nearest;
    }

    function connectionTarget(position, origin) {
      let closest;
      components.forEach((component) => {
        getPins(component).forEach((pin) => {
          if (pin.componentId === origin.componentId && pin.pin === origin.pin) return;
          const distance = Math.hypot(pin.x - position.x, pin.y - position.y);
          if (distance <= 17 && (!closest || distance < closest.distance))
            closest = {
              endpoint: { componentId: pin.componentId, pin: pin.pin },
              position: { x: pin.x, y: pin.y },
              distance,
            };
        });
      });
      if (closest) return closest;
      wires.forEach(({ wire }) => {
        const point = nearestWirePosition(wire, position);
        if (point?.distance <= 12 && (!closest || point.distance < closest.distance))
          closest = { wireId: wire.id, ...point };
      });
      return closest;
    }

    function clearConnectionPreview() {
      connectionLayer.setAttribute('visibility', 'hidden');
      wireEditLayer.setAttribute('visibility', 'visible');
    }

    function previewConnection(position, origin = options.wireStart) {
      const component = components.get(origin?.componentId);
      const from = origin?.wireId ? origin.position : component && getPins(component)[origin.pin];
      if (!from) return clearConnectionPreview();
      const target = connectionTarget(position, origin);
      const to = target?.position || position;
      const points = origin === options.wireStart ? options.wirePoints || [] : [];
      const route = [from, ...points, to];
      connectionLayer.setAttribute('visibility', 'visible');
      connectionPath.setAttribute(
        'd',
        route.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' '),
      );
      connectionCorners.replaceChildren();
      points.forEach((point) =>
        connectionCorners.append(
          svgElement('circle', {
            cx: point.x,
            cy: point.y,
            r: 4,
            fill: 'var(--circuit-accent,#48b6bd)',
            'data-draft-corner': '',
          }),
        ),
      );
      connectionHighlight.setAttribute(
        'd',
        target?.wireId ? wirePath(wires.find(({ wire }) => wire.id === target.wireId).wire) : '',
      );
      connectionLanding.setAttribute('cx', to.x);
      connectionLanding.setAttribute('cy', to.y);
      connectionLanding.setAttribute('visibility', target ? 'visible' : 'hidden');
      return target;
    }

    const copyPoints = (points) => points.map(({ x, y }) => ({ x, y }));
    const editBounds = options.viewBox || [0, 0, 1000, 640];
    const bounded = (value, axis = 'x') => {
      const start = editBounds[axis === 'x' ? 0 : 1];
      const length = editBounds[axis === 'x' ? 2 : 3];
      return Math.max(start, Math.min(start + length, value));
    };
    const deleteButtonTransform = (point) => {
      const x = Math.max(
        editBounds[0] + 8,
        Math.min(editBounds[0] + editBounds[2] - 104, point.x + 18),
      );
      const y = Math.max(
        editBounds[1] + 8,
        Math.min(editBounds[1] + editBounds[3] - 48, point.y - 52),
      );
      return `translate(${x} ${y})`;
    };

    function wirePath(wire) {
      return getWireRoute(wire, components)
        .map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`)
        .join(' ');
    }

    function editablePoints(entry) {
      if (Array.isArray(entry.wire.points)) return copyPoints(entry.wire.points);
      const route = getWireRoute(entry.wire, components);
      const points = route.slice(1, -1);
      if (points.length || route.length < 2) return points;
      return [{ x: (route[0].x + route.at(-1).x) / 2, y: (route[0].y + route.at(-1).y) / 2 }];
    }

    function controlRoute(entry) {
      const route = getWireRoute(entry.wire, components);
      return route.length > 1 ? [route[0], ...editablePoints(entry), route.at(-1)] : [];
    }

    function updateWireGeometry(entry) {
      const d = wirePath(entry.wire);
      entry.path.setAttribute('d', d);
      entry.hit?.setAttribute('d', d);
      const points = editablePoints(entry);
      if (entry.controls && points.length !== entry.controls.length && !entry.drag) {
        renderWireControls(entry);
        return;
      }
      entry.controls?.forEach(({ hit, dot }, index) => {
        if (!points[index]) return;
        for (const element of [hit, dot]) {
          element.setAttribute('cx', points[index].x);
          element.setAttribute('cy', points[index].y);
        }
      });
      const selectedPoint = points[entry.activePoint];
      if (entry.deleteControl && selectedPoint)
        entry.deleteControl.setAttribute('transform', deleteButtonTransform(selectedPoint));
      const route = controlRoute(entry);
      entry.addButtons?.forEach((button, index) => {
        if (!route[index + 1]) return;
        button.setAttribute(
          'transform',
          `translate(${(route[index].x + route[index + 1].x) / 2} ${(route[index].y + route[index + 1].y) / 2})`,
        );
      });
    }

    function showDeletePoint(storedEntry, index) {
      const entry = storedEntry;
      entry.deleteControl?.remove();
      entry.deleteControl = null;
      entry.activePoint = index;
      const point = editablePoints(entry)[index];
      if (!point || !entry.controlsGroup) return;
      const button = svgElement('g', {
        class: 'circuit-wire-delete-point',
        transform: deleteButtonTransform(point),
        tabindex: 0,
        role: 'button',
        'aria-label': `删除拐点 ${index + 1}`,
        'data-wire-delete-point': index,
      });
      button.style.cursor = 'pointer';
      button.style.touchAction = 'manipulation';
      button.append(
        svgElement('rect', {
          x: -8,
          y: -8,
          width: 112,
          height: 56,
          fill: 'transparent',
          stroke: 'none',
        }),
      );
      button.append(
        svgElement('rect', {
          x: 0,
          y: 0,
          width: 96,
          height: 40,
          rx: 6,
          fill: 'var(--circuit-surface,#102228)',
          stroke: 'var(--circuit-accent,#48b6bd)',
          'stroke-width': 1.5,
        }),
      );
      button.append(
        svgElement(
          'text',
          {
            x: 48,
            y: 25,
            'text-anchor': 'middle',
            'font-size': 15,
            fill: 'var(--circuit-ink,#dfedf0)',
            stroke: 'none',
          },
          '删除拐点',
        ),
      );
      button.addEventListener('pointerdown', (event) => event.stopPropagation());
      const remove = (event) => {
        event.preventDefault();
        event.stopPropagation();
        const updated = editablePoints(entry);
        updated.splice(index, 1);
        commitWirePoints(entry, updated, Math.min(index, updated.length - 1));
      };
      button.addEventListener('click', remove);
      button.addEventListener('keydown', (event) => {
        if (['Enter', ' ', 'Delete', 'Backspace'].includes(event.key)) remove(event);
      });
      entry.controlsGroup.append(button);
      entry.deleteControl = button;
    }

    function focusPoint(entry, index) {
      const control = entry.controls?.[Math.max(0, Math.min(index, entry.controls.length - 1))];
      const target = control?.hit || entry.addButtons?.find(Boolean);
      target?.focus({ preventScroll: true });
    }

    function commitWirePoints(storedEntry, points, focusIndex) {
      const entry = storedEntry;
      entry.wire.points = copyPoints(points);
      wireFocusRequests.set(container, { wireId: entry.wire.id, index: focusIndex });
      options.onWireChange?.(entry.wire.id, copyPoints(points));
      // The owner normally rerenders after updating its document. Keep the
      // renderer functional for callers that keep this SVG mounted instead.
      if (svg.parentNode) {
        renderWireControls(entry);
        updateWireGeometry(entry);
        focusPoint(entry, focusIndex);
      }
    }

    function cancelWireDrag(storedEntry) {
      const entry = storedEntry;
      if (!entry.drag) return;
      const { originalPoints, pointerId, hit } = entry.drag;
      entry.drag = null;
      if (originalPoints === undefined) delete entry.wire.points;
      else entry.wire.points = copyPoints(originalPoints);
      if (hit.hasPointerCapture?.(pointerId)) hit.releasePointerCapture(pointerId);
      renderWireControls(entry);
      updateWireGeometry(entry);
    }

    function addWirePoint(entry, position) {
      const addition = insertWirePoint(entry.wire, components, position);
      if (addition) commitWirePoints(entry, addition.points, addition.index);
    }

    function renderWireControls(storedEntry) {
      const entry = storedEntry;
      entry.controlsGroup?.remove();
      entry.controls = [];
      entry.addButtons = [];
      entry.deleteControl = null;
      if (
        !entry.selected ||
        !options.interactive ||
        options.wireStart ||
        typeof options.onWireChange !== 'function'
      )
        return;
      const group = svgElement('g', { 'data-wire-controls': entry.wire.id });
      entry.controlsGroup = group;
      wireEditLayer.append(group);
      const points = editablePoints(entry);
      const route = controlRoute(entry);
      if (points.length < 32) {
        route.slice(0, -1).forEach((point, index) => {
          const next = route[index + 1];
          if (Math.hypot(next.x - point.x, next.y - point.y) < 34) return;
          const midpoint = { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 };
          const button = svgElement('g', {
            transform: `translate(${midpoint.x} ${midpoint.y})`,
            class: 'circuit-wire-add',
            tabindex: 0,
            role: 'button',
            'aria-label': `在导线 ${entry.wire.id} 第 ${index + 1} 段添加拐点`,
            'data-wire-add': index,
          });
          button.append(svgElement('circle', { r: 17, fill: 'transparent', stroke: 'none' }));
          button.append(
            svgElement('circle', {
              r: 8,
              fill: 'var(--circuit-surface,#102228)',
              stroke: 'var(--circuit-accent,#48b6bd)',
              'stroke-width': 1.5,
            }),
          );
          const plus = svgElement('path', {
            d: 'M -4 0 H 4 M 0 -4 V 4',
            stroke: 'var(--circuit-accent,#48b6bd)',
            'stroke-width': 1.5,
            fill: 'none',
          });
          plus.style.pointerEvents = 'none';
          button.append(plus);
          button.addEventListener('pointerdown', (event) => event.stopPropagation());
          const add = (event) => {
            event.preventDefault();
            event.stopPropagation();
            const currentRoute = controlRoute(entry);
            if (currentRoute[index + 1])
              addWirePoint(entry, {
                x: (currentRoute[index].x + currentRoute[index + 1].x) / 2,
                y: (currentRoute[index].y + currentRoute[index + 1].y) / 2,
              });
          };
          button.addEventListener('click', add);
          button.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') add(event);
          });
          group.append(button);
          entry.addButtons[index] = button;
        });
      }
      points.forEach((point, index) => {
        const hit = svgElement('circle', {
          cx: point.x,
          cy: point.y,
          r: 16,
          class: 'circuit-wire-point',
          fill: 'transparent',
          stroke: 'none',
          tabindex: 0,
          role: 'button',
          'data-wire-point': index,
          'data-wire-id': entry.wire.id,
          'aria-label': `导线 ${entry.wire.id} 拐点 ${index + 1}，拖动调整；方向键微调，Delete 删除，Esc 取消拖动`,
          'aria-keyshortcuts': 'ArrowUp ArrowDown ArrowLeft ArrowRight Delete Backspace Escape',
        });
        const dot = svgElement('circle', {
          cx: point.x,
          cy: point.y,
          r: 6,
          fill: 'var(--circuit-surface,#102228)',
          stroke: 'var(--circuit-accent,#48b6bd)',
          'stroke-width': 2,
        });
        dot.style.pointerEvents = 'none';
        hit.style.touchAction = 'none';
        // SVG geometry does not consistently honor touch-action across mobile
        // engines. Reserve only gestures that start on a vertex for dragging.
        hit.addEventListener('touchstart', (event) => event.preventDefault(), { passive: false });
        hit.addEventListener('focus', () => showDeletePoint(entry, index));
        hit.addEventListener('click', (event) => {
          event.stopPropagation();
          showDeletePoint(entry, index);
        });
        hit.addEventListener('dblclick', (event) => {
          event.preventDefault();
          event.stopPropagation();
        });
        hit.addEventListener('pointerdown', (event) => {
          if (event.button !== 0 || event.isPrimary === false) return;
          event.preventDefault();
          event.stopPropagation();
          hit.focus({ preventScroll: true });
          const start = pointerPosition(event);
          const startPoints = editablePoints(entry);
          entry.drag = {
            pointerId: event.pointerId,
            hit,
            index,
            start,
            startPoints,
            originalPoints:
              entry.wire.points === undefined ? undefined : copyPoints(entry.wire.points),
            moved: false,
          };
          hit.setPointerCapture?.(event.pointerId);
        });
        hit.addEventListener('pointermove', (event) => {
          const { drag } = entry;
          if (!drag || drag.pointerId !== event.pointerId) return;
          event.preventDefault();
          event.stopPropagation();
          const position = pointerPosition(event);
          const dx = position.x - drag.start.x;
          const dy = position.y - drag.start.y;
          if (Math.hypot(dx, dy) < 4 && !drag.moved) return;
          drag.moved = true;
          const updated = copyPoints(drag.startPoints);
          updated[index] = {
            x: bounded(Math.round((drag.startPoints[index].x + dx) / 10) * 10),
            y: bounded(Math.round((drag.startPoints[index].y + dy) / 10) * 10, 'y'),
          };
          entry.wire.points = updated;
          updateWireGeometry(entry);
        });
        hit.addEventListener('pointerup', (event) => {
          const { drag } = entry;
          if (!drag || drag.pointerId !== event.pointerId) return;
          event.preventDefault();
          event.stopPropagation();
          entry.drag = null;
          if (hit.hasPointerCapture?.(event.pointerId)) hit.releasePointerCapture(event.pointerId);
          if (drag.moved) commitWirePoints(entry, entry.wire.points, index);
        });
        const cancel = (event) => {
          if (entry.drag?.pointerId === event.pointerId) cancelWireDrag(entry);
        };
        hit.addEventListener('pointercancel', cancel);
        hit.addEventListener('lostpointercapture', cancel);
        hit.addEventListener('keydown', (event) => {
          const delta = {
            ArrowLeft: [-1, 0],
            ArrowRight: [1, 0],
            ArrowUp: [0, -1],
            ArrowDown: [0, 1],
          }[event.key];
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            cancelWireDrag(entry);
            focusPoint(entry, index);
          } else if (delta || event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault();
            event.stopPropagation();
            if (entry.drag) cancelWireDrag(entry);
            const updated = editablePoints(entry);
            if (delta)
              updated[index] = {
                x: bounded(updated[index].x + delta[0] * (event.shiftKey ? 10 : 1)),
                y: bounded(updated[index].y + delta[1] * (event.shiftKey ? 10 : 1), 'y'),
              };
            else updated.splice(index, 1);
            commitWirePoints(entry, updated, Math.min(index, updated.length - 1));
          }
        });
        group.append(hit, dot);
        entry.controls.push({ hit, dot });
      });
      if (Number.isInteger(entry.activePoint)) showDeletePoint(entry, entry.activePoint);
    }

    (circuit.wires || []).forEach((storedWire) => {
      const wire = {
        ...storedWire,
        ...(storedWire.points === undefined ? {} : { points: copyPoints(storedWire.points) }),
      };
      const path = svgElement('path', {
        d: wirePath(wire),
        stroke: 'currentColor',
        'data-wire-id': wire.id,
      });
      const entry = { wire, path, selected: options.selectedId === wire.id };
      wireLayer.append(path);
      if (options.interactive) {
        const hit = svgElement('path', {
          d: wirePath(wire),
          stroke: 'transparent',
          'stroke-width': 18,
          class: 'circuit-wire-hit',
          tabindex: 0,
          role: 'button',
          'aria-label': `选择导线 ${wire.id}${entry.selected ? '，双击添加拐点' : ''}`,
          'data-wire-hit': wire.id,
        });
        entry.hit = hit;
        const choose = (event) => {
          event.preventDefault();
          event.stopPropagation();
          const route = getWireRoute(wire, components);
          const position =
            Number.isFinite(event.clientX) && Number.isFinite(event.clientY)
              ? pointerPosition(event)
              : route[Math.floor(route.length / 2)];
          options.onWireClick?.(wire.id, nearestWirePosition(wire, position)?.position || position);
        };
        hit.addEventListener('click', choose);
        hit.addEventListener('dblclick', (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!options.wireStart && entry.selected && typeof options.onWireChange === 'function')
            addWirePoint(entry, pointerPosition(event));
          else choose(event);
        });
        hit.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            choose(event);
            if (entry.selected && !options.wireStart) focusPoint(entry, 0);
          }
        });
        wireLayer.append(hit);
      }
      wires.push(entry);
      renderWireControls(entry);
    });

    svg.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && pinDrag) {
        const { hit, pointerId } = pinDrag;
        pinDrag.cancel();
        pinDrag = null;
        if (hit.hasPointerCapture(pointerId)) hit.releasePointerCapture(pointerId);
        clearConnectionPreview();
      }
      if (event.key !== 'Escape' || !wires.some((entry) => entry.drag)) return;
      event.preventDefault();
      event.stopPropagation();
      wires.forEach(cancelWireDrag);
    });

    function pointerPosition(event) {
      const matrix = svg.getScreenCTM();
      if (!matrix) return { x: 0, y: 0 };
      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      return point.matrixTransform(matrix.inverse());
    }
    if (options.interactive) {
      svg.addEventListener('pointermove', (event) => {
        if (options.wireStart && !pinDrag) previewConnection(pointerPosition(event));
      });
      svg.addEventListener('pointerleave', () => {
        if (!pinDrag && !options.wireStart) clearConnectionPreview();
      });
      svg.addEventListener('click', (event) => {
        if (
          !options.wireStart ||
          event.defaultPrevented ||
          event.target.closest('.circuit-node, .circuit-wire-hit, .circuit-wire-controls')
        )
          return;
        const position = pointerPosition(event);
        const target = connectionTarget(position, options.wireStart);
        if (target)
          options.onConnect?.(
            options.wireStart,
            target.endpoint
              ? { endpoint: target.endpoint }
              : { wireId: target.wireId, position: target.position },
          );
        else options.onCanvasPoint?.(position);
      });
    }

    components.forEach((storedComponent) => {
      const component = storedComponent;
      const group = svgElement('g', {
        transform: `translate(${component.x} ${component.y})`,
        'data-component-id': component.id,
        class: 'circuit-node',
      });
      if (options.interactive || options.selectable) {
        group.setAttribute('tabindex', '0');
        group.setAttribute('role', 'button');
        group.setAttribute(
          'aria-label',
          `${component.id} ${labels[component.type] || component.type}，${options.interactive ? '拖动移动，' : ''}回车查看参数`,
        );
      }
      group.append(svgElement('title', {}, `${component.id} · ${componentValue(component)}`));
      const label = componentLabelLayout(component);
      if (component.type !== 'junction')
        group.append(
          svgElement('rect', {
            x: label.bounds.left - 9,
            y: label.bounds.top - 9,
            width: label.bounds.right - label.bounds.left + 18,
            height: label.bounds.bottom - label.bounds.top + 18,
            rx: 7,
            class: 'circuit-selection',
            fill: 'transparent',
            stroke:
              options.selectedId === component.id ? 'var(--circuit-accent,#48b6bd)' : 'transparent',
            'stroke-dasharray': '4 4',
            'stroke-width': 1.3,
          }),
        );
      const symbol = svgElement('g', {
        transform: `rotate(${component.rotation || 0}) scale(${component.mirrorX ? -1 : 1} ${component.mirrorY ? -1 : 1})`,
        'data-component-symbol': component.id,
        stroke: 'currentColor',
        fill: 'none',
      });
      addSymbol(symbol, component);
      group.append(symbol);
      if (component.type !== 'junction')
        group.append(
          svgElement(
            'text',
            {
              x: label.x,
              y: label.nameY,
              'data-component-label': 'name',
              fill: 'currentColor',
              'font-size': 14,
              'font-weight': 600,
              'text-anchor': label.anchor,
              stroke: 'none',
            },
            component.id,
          ),
        );
      const sourceLines = sourceValueLines(component);
      const reading = svgElement(
        'text',
        {
          x: label.x,
          y: label.valueY,
          'data-component-label': 'value',
          fill: 'var(--circuit-muted,#9db4bb)',
          'font-size': 12,
          'text-anchor': label.anchor,
          stroke: 'none',
        },
        sourceLines ? undefined : componentValue(component),
      );
      if (sourceLines)
        sourceLines.forEach((value, index) =>
          reading.append(svgElement('tspan', { x: label.x, dy: index ? 14 : 0 }, value)),
        );
      if (component.type !== 'junction') group.append(reading);
      const pins = [];
      getPins(component).forEach((pin) => {
        const x = pin.x - component.x;
        const y = pin.y - component.y;
        const active =
          options.wireStart?.componentId === component.id && options.wireStart?.pin === pin.pin;
        const inactiveFill =
          component.type === 'junction' ? 'currentColor' : 'var(--circuit-surface,#102228)';
        const dot = svgElement('circle', {
          cx: x,
          cy: y,
          r: active ? 7 : 4,
          fill: active ? 'var(--circuit-accent,#48b6bd)' : inactiveFill,
          stroke: 'currentColor',
          'stroke-width': 2,
        });
        group.append(dot);
        if (options.interactive) {
          const hit = svgElement('circle', {
            cx: x,
            cy: y,
            r: 17,
            class: 'circuit-pin-hit',
            'data-pin': pin.pin,
            tabindex: 0,
            role: 'button',
            'aria-label': `${component.id} ${pin.label} 引脚`,
          });
          const endpoint = { componentId: component.id, pin: pin.pin };
          let suppressClick = false;
          hit.style.touchAction = 'none';
          hit.addEventListener(
            'touchstart',
            (event) => {
              if (pinDrag?.hit === hit) event.preventDefault();
            },
            { passive: false },
          );
          hit.addEventListener('pointerdown', (event) => {
            event.stopPropagation();
            if (
              event.button !== 0 ||
              event.isPrimary === false ||
              (component.type === 'junction'
                ? typeof options.onMove !== 'function'
                : typeof options.onConnect !== 'function')
            )
              return;
            suppressClick = false;
            const originalPosition = { x: component.x, y: component.y };
            pinDrag = {
              endpoint,
              origin: pointerPosition(event),
              pointerId: event.pointerId,
              hit,
              moved: false,
              originalPosition,
              cancel() {
                suppressClick = true;
                if (component.type === 'junction') {
                  component.x = originalPosition.x;
                  component.y = originalPosition.y;
                  group.setAttribute('transform', `translate(${component.x} ${component.y})`);
                  wires.forEach(updateWireGeometry);
                }
              },
            };
            hit.setPointerCapture(event.pointerId);
          });
          hit.addEventListener('pointermove', (event) => {
            if (pinDrag?.hit !== hit || pinDrag.pointerId !== event.pointerId) return;
            const position = pointerPosition(event);
            if (
              !pinDrag.moved &&
              Math.hypot(position.x - pinDrag.origin.x, position.y - pinDrag.origin.y) < 4
            )
              return;
            event.preventDefault();
            event.stopPropagation();
            pinDrag.moved = true;
            suppressClick = true;
            wireEditLayer.setAttribute('visibility', 'hidden');
            if (component.type === 'junction') {
              component.x = bounded(
                Math.round((pinDrag.originalPosition.x + position.x - pinDrag.origin.x) / 10) * 10,
              );
              component.y = bounded(
                Math.round((pinDrag.originalPosition.y + position.y - pinDrag.origin.y) / 10) * 10,
                'y',
              );
              group.setAttribute('transform', `translate(${component.x} ${component.y})`);
              wires.forEach(updateWireGeometry);
            } else previewConnection(position, endpoint);
          });
          hit.addEventListener('pointerup', (event) => {
            if (pinDrag?.hit !== hit || pinDrag.pointerId !== event.pointerId) return;
            event.stopPropagation();
            const { moved } = pinDrag;
            const target =
              moved && component.type !== 'junction'
                ? connectionTarget(pointerPosition(event), endpoint)
                : null;
            pinDrag = null;
            if (hit.hasPointerCapture(event.pointerId)) hit.releasePointerCapture(event.pointerId);
            clearConnectionPreview();
            if (!moved && event.pointerType === 'touch') {
              suppressClick = true;
              options.onPinClick?.(endpoint);
            }
            if (moved && component.type === 'junction')
              options.onMove(component.id, component.x, component.y);
            if (target)
              options.onConnect(
                endpoint,
                target.endpoint
                  ? { endpoint: target.endpoint }
                  : { wireId: target.wireId, position: target.position },
              );
            else if (moved && component.type !== 'junction')
              options.onWireDraftStart?.(endpoint, pointerPosition(event));
          });
          hit.addEventListener('pointercancel', (event) => {
            if (pinDrag?.hit !== hit || pinDrag.pointerId !== event.pointerId) return;
            pinDrag.cancel();
            pinDrag = null;
            if (hit.hasPointerCapture(event.pointerId)) hit.releasePointerCapture(event.pointerId);
            clearConnectionPreview();
          });
          hit.addEventListener('lostpointercapture', () => {
            if (pinDrag?.hit !== hit) return;
            pinDrag.cancel();
            pinDrag = null;
            clearConnectionPreview();
          });
          hit.addEventListener('click', (event) => {
            event.stopPropagation();
            if (suppressClick) {
              suppressClick = false;
              return;
            }
            options.onPinClick?.(endpoint);
          });
          hit.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              event.stopPropagation();
              options.onPinClick?.({ componentId: component.id, pin: pin.pin });
            }
          });
          group.append(hit);
        }
        pins.push({ dot, net: netMap[`${component.id}:${pin.pin}`] });
      });
      const indicator = svgElement('path', {
        d: currentIndicatorGeometry(component).path,
        'data-current-indicator': component.id,
        fill: 'none',
        stroke: 'var(--circuit-accent,#48b6bd)',
        'stroke-width': 3,
        visibility: 'hidden',
      });
      const currentArrow = svgElement('path', {
        d: currentIndicatorGeometry(component).arrow,
        'data-current-arrow': component.id,
        fill: 'none',
        stroke: 'var(--circuit-accent,#48b6bd)',
        'stroke-width': 2,
        visibility: 'hidden',
      });
      if (component.type !== 'junction') group.append(indicator, currentArrow);
      nodes.push({ component, reading, pins, indicator, currentArrow });
      nodeLayer.append(group);
      if (options.selectable && !options.interactive) {
        group.addEventListener('click', () => options.onComponentClick?.(component.id));
        group.addEventListener('keydown', (event) => {
          if (event.target === group && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            options.onComponentClick?.(component.id, { focus: true });
          }
        });
      }
      if (options.interactive) {
        let drag = null;
        group.style.touchAction = 'none';
        group.addEventListener('pointerdown', (event) => {
          if (event.button !== 0) return;
          const point = pointerPosition(event);
          drag = { x: point.x, y: point.y, startX: component.x, startY: component.y, moved: false };
          group.setPointerCapture(event.pointerId);
          group.style.touchAction = 'none';
        });
        group.addEventListener('pointermove', (event) => {
          if (!drag) return;
          const point = pointerPosition(event);
          if (Math.hypot(point.x - drag.x, point.y - drag.y) < 4 && !drag.moved) return;
          drag.moved = true;
          component.x = Math.min(
            940,
            Math.max(60, Math.round((drag.startX + point.x - drag.x) / 10) * 10),
          );
          component.y = Math.min(
            560,
            Math.max(60, Math.round((drag.startY + point.y - drag.y) / 10) * 10),
          );
          group.setAttribute('transform', `translate(${component.x} ${component.y})`);
          wires.forEach(updateWireGeometry);
        });
        group.addEventListener('pointerup', (event) => {
          if (!drag) return;
          const { moved } = drag;
          drag = null;
          if (group.hasPointerCapture(event.pointerId))
            group.releasePointerCapture(event.pointerId);
          if (moved) options.onMove?.(component.id, component.x, component.y);
          else options.onComponentClick?.(component.id);
        });
        group.addEventListener('pointercancel', () => {
          if (drag) options.onMove?.(component.id, component.x, component.y);
          drag = null;
        });
        group.addEventListener('keydown', (event) => {
          if (event.target !== group) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            options.onComponentClick?.(component.id, { focus: true });
          }
          const delta = {
            ArrowLeft: [-10, 0],
            ArrowRight: [10, 0],
            ArrowUp: [0, -10],
            ArrowDown: [0, 10],
          }[event.key];
          if (delta) {
            event.preventDefault();
            options.onMove?.(
              component.id,
              Math.min(940, Math.max(60, component.x + delta[0])),
              Math.min(560, Math.max(60, component.y + delta[1])),
            );
          }
        });
      }
    });

    function updateFrame(nextFrame) {
      frame = nextFrame;
      const voltages = frame?.voltages || {};
      const largest = Math.max(1, ...Object.values(voltages).filter(Number.isFinite).map(Math.abs));
      const color = (net) => {
        if (!frame || !Number.isFinite(voltages[net])) return 'currentColor';
        const voltage = voltages[net];
        if (Math.abs(voltage) < 1e-9) return 'var(--circuit-muted,#9db4bb)';
        return `hsl(${voltage < 0 ? 28 : 184} 65% ${Math.round(45 + Math.min(1, Math.abs(voltage) / largest) * 18)}%)`;
      };
      wires.forEach(({ wire, path, selected }) =>
        path.setAttribute(
          'stroke',
          selected && options.interactive
            ? 'var(--circuit-accent,#48b6bd)'
            : color(netMap[`${wire.from.componentId}:${wire.from.pin}`]),
        ),
      );
      nodes.forEach((node) => {
        const { component, reading, pins, indicator, currentArrow } = node;
        pins.forEach(({ dot, net }) => dot.setAttribute('stroke', color(net)));
        if (frame && ['voltmeter', 'oscilloscope'].includes(component.type)) {
          const a = voltages[netMap[`${component.id}:0`]] || 0;
          const b = voltages[netMap[`${component.id}:1`]] || 0;
          reading.textContent = formatValue(a - b, 'V');
        } else if (frame && component.type === 'oscilloscope2') {
          reading.textContent = [0, 2]
            .map((pin, index) => {
              const a = voltages[netMap[`${component.id}:${pin}`]] || 0;
              const b = voltages[netMap[`${component.id}:${pin + 1}`]] || 0;
              return `CH${index + 1} ${formatValue(a - b, 'V')}`;
            })
            .join(' · ');
        } else if (frame && component.type === 'ammeter')
          reading.textContent = formatValue(frame.currents?.[component.id] || 0, 'A');
        else if (!frame && !sourceValueLines(component))
          reading.textContent = componentValue(component);
        const current = frame?.currents?.[component.id] || 0;
        const geometry = currentIndicatorGeometry(component, current);
        indicator.setAttribute('d', geometry.path);
        currentArrow.setAttribute('d', geometry.arrow);
        const visibility =
          options.animate &&
          Math.abs(current) > 1e-12 &&
          !['ground', 'junction'].includes(component.type)
            ? 'visible'
            : 'hidden';
        indicator.setAttribute('visibility', visibility);
        currentArrow.setAttribute('visibility', visibility);
        indicator.setAttribute('class', options.animate ? 'circuit-current' : '');
        // The actual path reverses with signed current; dashes always move toward its end.
        indicator.style.animationDirection = 'normal';
      });
    }
    container.append(svg);
    if (options.wireStart && options.wirePoints?.length)
      previewConnection(options.wirePoints.at(-1));
    const focusRequest = wireFocusRequests.get(container);
    wireFocusRequests.delete(container);
    if (focusRequest) {
      const entry = wires.find((item) => item.selected && item.wire.id === focusRequest.wireId);
      if (entry) focusPoint(entry, focusRequest.index);
    }
    updateFrame(frame);
    return {
      svg,
      updateFrame,
      destroy() {
        svg.remove();
      },
    };
  }

  const traceColors = ['#2ba5ad', '#e2853f', '#8875cc', '#ca5d82', '#598f43', '#a38532'];

  // Keep each pixel column's envelope, including narrow spikes between its endpoints.
  // Only SVG vertices are reduced; measurements and exports retain every sample.
  function waveformSampleIndices(xValues, values, pixelWidth, logX = false) {
    const count = Math.min(xValues.length, values.length);
    const buckets = Math.max(1, Math.floor(pixelWidth) || 1);
    if (count <= buckets * 4) return Array.from({ length: count }, (_, index) => index);
    const project = (value) => (logX ? Math.log10(value) : value);
    const start = project(xValues[0]);
    const span = project(xValues[count - 1]) - start || 1;
    const indices = [];
    let bucket = -1;
    let first;
    let last;
    let minimum;
    let maximum;
    const flush = () => {
      if (first !== undefined)
        indices.push(...[...new Set([first, minimum, maximum, last])].sort((a, b) => a - b));
    };
    for (let index = 0; index < count; index += 1) {
      if (!Number.isFinite(values[index]) || !Number.isFinite(xValues[index])) {
        flush();
        if (first !== undefined || !indices.length) indices.push(index);
        first = undefined;
        bucket = -1;
        continue;
      }
      const next = Math.max(
        0,
        Math.min(buckets - 1, Math.floor(((project(xValues[index]) - start) / span) * buckets)),
      );
      if (next !== bucket) {
        flush();
        bucket = next;
        first = index;
        minimum = index;
        maximum = index;
      }
      if (values[index] < values[minimum]) minimum = index;
      if (values[index] > values[maximum]) maximum = index;
      last = index;
    }
    flush();
    return indices;
  }

  function nearestWaveformSample(xValues, value, logX = false) {
    if (!xValues.length) return -1;
    const project = (sample) => (logX ? Math.log10(sample) : sample);
    const direction = xValues.at(-1) < xValues[0] ? -1 : 1;
    const target = project(value) * direction;
    const lowerBound = (needle) => {
      let low = 0;
      let high = xValues.length;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (project(xValues[middle]) * direction < needle) low = middle + 1;
        else high = middle;
      }
      return low;
    };
    const after = lowerBound(target);
    let nearest = Math.min(after, xValues.length - 1);
    if (
      after > 0 &&
      Math.abs(project(xValues[after - 1]) * direction - target) <=
        Math.abs(project(xValues[nearest]) * direction - target)
    )
      nearest = after - 1;
    return lowerBound(project(xValues[nearest]) * direction);
  }

  // An XY trace is ordered by time, never by horizontal position. Keep each time
  // block's extrema in both dimensions, and retain missing-data boundaries.
  function xySampleIndices(xValues, yValues, pixelWidth) {
    const count = Math.min(xValues.length, yValues.length);
    const blocks = Math.max(1, Math.floor(pixelWidth) || 1);
    if (count <= blocks * 6) return Array.from({ length: count }, (_, index) => index);
    const result = [];
    let first;
    let last;
    let minX;
    let maxX;
    let minY;
    let maxY;
    let block = -1;
    const flush = () => {
      if (first !== undefined)
        result.push(...[...new Set([first, minX, maxX, minY, maxY, last])].sort((a, b) => a - b));
    };
    for (let index = 0; index < count; index += 1) {
      if (!Number.isFinite(xValues[index]) || !Number.isFinite(yValues[index])) {
        flush();
        if (first !== undefined || !result.length) result.push(index);
        first = undefined;
        block = -1;
        continue;
      }
      const next = Math.floor((index / count) * blocks);
      if (next !== block) {
        flush();
        block = next;
        first = index;
        minX = index;
        maxX = index;
        minY = index;
        maxY = index;
      }
      if (xValues[index] < xValues[minX]) minX = index;
      if (xValues[index] > xValues[maxX]) maxX = index;
      if (yValues[index] < yValues[minY]) minY = index;
      if (yValues[index] > yValues[maxY]) maxY = index;
      last = index;
    }
    flush();
    return result;
  }

  function nearestXYSample(xValues, yValues, x, y, xScale = 1, yScale = 1) {
    let nearest = -1;
    let distance = Infinity;
    const count = Math.min(xValues.length, yValues.length);
    for (let index = 0; index < count; index += 1) {
      if (!Number.isFinite(xValues[index]) || !Number.isFinite(yValues[index])) continue;
      const candidate = ((xValues[index] - x) * xScale) ** 2 + ((yValues[index] - y) * yScale) ** 2;
      if (candidate < distance) {
        distance = candidate;
        nearest = index;
      }
    }
    return nearest;
  }

  function samplePath(indices, xValues, yValues, px, py) {
    let drawing = false;
    return indices
      .map((index) => {
        if (!Number.isFinite(xValues[index]) || !Number.isFinite(yValues[index])) {
          drawing = false;
          return '';
        }
        const vertex = `${drawing ? 'L' : 'M'} ${px(xValues[index]).toFixed(3)} ${py(yValues[index]).toFixed(3)}`;
        drawing = true;
        return vertex;
      })
      .join(' ');
  }

  function axisBounds(minimum, maximum, fixedMin, fixedMax, pad = true) {
    let min = Number.isFinite(minimum) ? minimum : -1;
    let max = Number.isFinite(maximum) ? maximum : 1;
    if (min > max) [min, max] = [max, min];
    const padding = pad ? Math.max((max - min) * 0.09, Math.abs(max) * 0.03, 1e-12) : 0;
    min = Number.isFinite(fixedMin) ? fixedMin : min - padding;
    max = Number.isFinite(fixedMax) ? fixedMax : max + padding;
    if (min >= max) {
      const span = Math.max(Math.abs(min || max) * 0.1, 1e-12);
      if (Number.isFinite(fixedMax) && !Number.isFinite(fixedMin)) min = max - span;
      else max = min + span;
    }
    return [min, max];
  }

  let plotSequence = 0;
  function plotClip(svg, left, top, width, height) {
    plotSequence += 1;
    const id = `circuit-plot-clip-${plotSequence}`;
    const clip = svgElement('clipPath', { id });
    clip.append(svgElement('rect', { x: left, y: top, width, height }));
    const defs = svgElement('defs');
    defs.append(clip);
    svg.append(defs);
    return `url(#${id})`;
  }

  function renderXYWaveform(container, result, options) {
    container.replaceChildren();
    const xTrace = result.traces.find((trace) => trace.id === (options.xyX || options.ch1));
    const yTrace = result.traces.find((trace) => trace.id === (options.xyY || options.ch2));
    if (!xTrace || !yTrace) {
      const empty = document.createElement('p');
      empty.textContent = '为 X 轴和 Y 轴各选择一个通道，查看 X–Y 图像。';
      container.append(empty);
      return {
        destroy() {
          empty.remove();
        },
      };
    }
    const group = document.createElement('section');
    group.className = 'circuit-wave-group';
    group.setAttribute('data-trace-ids', JSON.stringify([xTrace.id, yTrace.id]));
    const heading = document.createElement('div');
    heading.className = 'circuit-wave-legend';
    heading.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12px;padding:8px 0';
    [xTrace, yTrace].forEach((trace, index) => {
      const item = document.createElement('span');
      item.setAttribute('data-trace-id', trace.id);
      item.style.color = traceColors[index];
      item.textContent = `${index ? 'Y' : 'X'} · ${trace.label}${trace.unit ? ` (${trace.unit})` : ''}`;
      heading.append(item);
    });
    group.append(heading);
    const chartWidth = Math.max(300, Math.min(920, container.clientWidth || 920));
    const left = chartWidth < 500 ? 65 : 76;
    const top = 20;
    const width = chartWidth - left - 24;
    const height = 232;
    const xValues = xTrace.values;
    const yValues = yTrace.values;
    let lowX = Infinity;
    let highX = -Infinity;
    let lowY = Infinity;
    let highY = -Infinity;
    for (let index = 0; index < Math.min(xValues.length, yValues.length); index += 1) {
      if (!Number.isFinite(xValues[index]) || !Number.isFinite(yValues[index])) continue;
      lowX = Math.min(lowX, xValues[index]);
      highX = Math.max(highX, xValues[index]);
      lowY = Math.min(lowY, yValues[index]);
      highY = Math.max(highY, yValues[index]);
    }
    const ranges = options.ranges || {};
    const [xMin, xMax] = axisBounds(lowX, highX, ranges.xMin, ranges.xMax);
    const [yMin, yMax] = axisBounds(lowY, highY, ranges.yMin, ranges.yMax);
    const px = (x) => left + ((x - xMin) / (xMax - xMin)) * width;
    const py = (y) => top + (1 - (y - yMin) / (yMax - yMin)) * height;
    const svg = svgElement('svg', {
      viewBox: `0 0 ${chartWidth} 310`,
      width: '100%',
      role: 'img',
      'aria-label': `X–Y 图像 · X: ${xTrace.label} · Y: ${yTrace.label}`,
      'data-wave-mode': 'xy',
    });
    svg.style.cssText =
      'display:block;background:var(--circuit-surface,#102228);color:var(--circuit-ink,#dfedf0)';
    const clipPath = plotClip(svg, left, top, width, height);
    const ticks = chartWidth < 500 ? 3 : 5;
    for (let index = 0; index <= ticks; index += 1) {
      const x = left + (index / ticks) * width;
      const y = top + (index / ticks) * height;
      svg.append(
        svgElement('path', {
          d: `M ${x} ${top} V ${top + height} M ${left} ${y} H ${left + width}`,
          fill: 'none',
          stroke: 'var(--circuit-grid,#283e44)',
          'stroke-width': 1,
        }),
      );
      svg.append(
        svgElement(
          'text',
          {
            x,
            y: top + height + 23,
            fill: 'currentColor',
            'text-anchor': 'middle',
            'font-size': 12,
          },
          formatValue(xMin + ((xMax - xMin) * index) / ticks, xTrace.unit || ''),
        ),
      );
      svg.append(
        svgElement(
          'text',
          {
            x: left - 9,
            y: y + 4,
            fill: 'currentColor',
            'text-anchor': 'end',
            'font-size': 12,
          },
          formatValue(yMax - ((yMax - yMin) * index) / ticks, yTrace.unit || ''),
        ),
      );
    }
    // Explicit zero axes make negative quadrants readable, including closed loops.
    const zeroAxes = [];
    if (xMin < 0 && xMax > 0) zeroAxes.push(`M ${px(0)} ${top} V ${top + height}`);
    if (yMin < 0 && yMax > 0) zeroAxes.push(`M ${left} ${py(0)} H ${left + width}`);
    svg.append(
      svgElement('path', {
        d: zeroAxes.join(' '),
        fill: 'none',
        stroke: 'var(--circuit-muted,#9db4bb)',
        'stroke-width': 1,
        opacity: 0.55,
      }),
    );
    svg.append(
      svgElement(
        'text',
        {
          x: left + width / 2,
          y: 301,
          fill: 'currentColor',
          'text-anchor': 'middle',
          'font-size': 13,
        },
        `X · ${xTrace.label}`,
      ),
    );
    const indices = xySampleIndices(xValues, yValues, width);
    const path = samplePath(indices, xValues, yValues, px, py);
    svg.append(
      svgElement('path', {
        d: path,
        'data-trace-id': yTrace.id,
        'data-x-trace-id': xTrace.id,
        fill: 'none',
        stroke: traceColors[0],
        'stroke-width': 2.2,
        'vector-effect': 'non-scaling-stroke',
        'clip-path': clipPath,
      }),
    );
    if (indices.length === 1 && Number.isFinite(xValues[0]) && Number.isFinite(yValues[0]))
      svg.append(
        svgElement('circle', {
          cx: px(xValues[0]),
          cy: py(yValues[0]),
          r: 4,
          'data-trace-id': yTrace.id,
          fill: traceColors[0],
          'clip-path': clipPath,
        }),
      );
    const cursor = svgElement('circle', {
      r: 5,
      fill: 'var(--circuit-surface,#102228)',
      stroke: traceColors[0],
      'stroke-width': 2,
      visibility: 'hidden',
      'clip-path': clipPath,
    });
    svg.append(cursor);
    const readout = document.createElement('p');
    readout.style.cssText =
      'font-size:12px;font-variant-numeric:tabular-nums;min-height:1.5em;margin:4px 0;color:var(--circuit-muted,#9db4bb)';
    readout.textContent = path
      ? '移动指针或触摸曲线查看同一采样时刻的 X、Y 值。'
      : '这两个通道没有可绘制的有效采样值。';
    function inspect(event) {
      const box = svg.getBoundingClientRect();
      if (!box.width || !box.height) return;
      const x =
        xMin +
        ((((event.clientX - box.left) / box.width) * chartWidth - left) / width) * (xMax - xMin);
      const y =
        yMax - ((((event.clientY - box.top) / box.height) * 310 - top) / height) * (yMax - yMin);
      const nearest = nearestXYSample(
        xValues,
        yValues,
        x,
        y,
        width / (xMax - xMin),
        height / (yMax - yMin),
      );
      if (nearest < 0) return;
      cursor.setAttribute('cx', px(xValues[nearest]));
      cursor.setAttribute('cy', py(yValues[nearest]));
      cursor.setAttribute('visibility', 'visible');
      const sample = Number.isFinite(result.x?.[nearest])
        ? `${formatValue(result.x[nearest], result.xUnit || '')} · `
        : '';
      readout.textContent = `${sample}X · ${xTrace.label}: ${formatValue(xValues[nearest], xTrace.unit || '')} · Y · ${yTrace.label}: ${formatValue(yValues[nearest], yTrace.unit || '')}`;
    }
    svg.addEventListener('pointermove', inspect);
    svg.addEventListener('pointerdown', inspect);
    group.append(svg, readout);
    container.append(group);
    return {
      destroy() {
        group.remove();
      },
    };
  }

  function renderWaveform(container, result, options = {}) {
    if (options.mode === 'xy') return renderXYWaveform(container, result, options);
    container.replaceChildren();
    const selected = result.traces.filter(
      (trace) => !options.traceIds || options.traceIds.includes(trace.id),
    );
    const charts = [];
    const units = [...new Set(selected.map((trace) => trace.unit))].map((unit) => ({
      unit,
      phase: false,
    }));
    if (options.phase && selected.some((trace) => Array.isArray(trace.phase)))
      units.push({ unit: '°', phase: true });
    if (!selected.length) {
      const empty = document.createElement('p');
      empty.textContent = '选择一个电压或电流通道查看波形。';
      container.append(empty);
    }
    units.forEach(({ unit, phase }) => {
      const traces = selected.filter((trace) =>
        phase ? Array.isArray(trace.phase) : trace.unit === unit,
      );
      const group = document.createElement('section');
      group.className = 'circuit-wave-group';
      group.setAttribute('data-trace-ids', JSON.stringify(traces.map((trace) => trace.id)));
      const heading = document.createElement('div');
      heading.className = 'circuit-wave-legend';
      heading.style.cssText =
        'display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12px;padding:8px 0';
      traces.forEach((trace, index) => {
        const item = document.createElement('span');
        item.setAttribute('data-trace-id', trace.id);
        item.style.color = traceColors[index % traceColors.length];
        item.textContent = `${trace.label}${phase ? ' · 相位' : ''}`;
        heading.append(item);
      });
      group.append(heading);
      const chartWidth = Math.max(300, Math.min(920, container.clientWidth || 920));
      const svg = svgElement('svg', {
        viewBox: `0 0 ${chartWidth} 310`,
        width: '100%',
        role: 'img',
        'aria-label': `${result.xLabel || '扫描'} · ${phase ? '相位' : unit} 波形`,
        'data-wave-mode': 'xt',
      });
      svg.style.cssText =
        'display:block;background:var(--circuit-surface,#102228);color:var(--circuit-ink,#dfedf0)';
      const left = chartWidth < 500 ? 65 : 76;
      const top = 20;
      const width = chartWidth - left - 24;
      const height = 232;
      const xValues = result.x || [];
      const ranges = options.ranges || {};
      const logX = Boolean(
        options.logX &&
        xValues.every((x) => x > 0) &&
        (!Number.isFinite(ranges.xMin) || ranges.xMin > 0) &&
        (!Number.isFinite(ranges.xMax) || ranges.xMax > 0),
      );
      const projectX = (x) => (logX ? Math.log10(x) : x);
      const [axisMin, axisMax] = axisBounds(
        xValues[0] ?? 0,
        xValues.at(-1) ?? 1,
        ranges.xMin,
        ranges.xMax,
        false,
      );
      // Sweep endpoints define scan direction. Keep a descending scan descending,
      // including when fixed numeric limits narrow its visible interval.
      const descending = xValues.at(-1) < xValues[0];
      const xMin = projectX(descending ? axisMax : axisMin);
      const xMax = projectX(descending ? axisMin : axisMax);
      const valuesOf = (trace) => (phase ? trace.phase : trace.values);
      let yMin = Infinity;
      let yMax = -Infinity;
      traces.forEach((trace) =>
        valuesOf(trace).forEach((value) => {
          if (Number.isFinite(value)) {
            yMin = Math.min(yMin, value);
            yMax = Math.max(yMax, value);
          }
        }),
      );
      if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
        yMin = -1;
        yMax = 1;
      }
      [yMin, yMax] = axisBounds(yMin, yMax, ranges.yMin, ranges.yMax);
      const px = (x) => left + ((projectX(x) - xMin) / (xMax - xMin || 1)) * width;
      const py = (y) => top + (1 - (y - yMin) / (yMax - yMin)) * height;
      const clipPath = plotClip(svg, left, top, width, height);
      const ticks = chartWidth < 500 ? 3 : 5;
      for (let index = 0; index <= ticks; index += 1) {
        const x = left + (index / ticks) * width;
        const y = top + (index / ticks) * height;
        svg.append(
          svgElement('path', {
            d: `M ${x} ${top} V ${top + height} M ${left} ${y} H ${left + width}`,
            fill: 'none',
            stroke: 'var(--circuit-grid,#283e44)',
            'stroke-width': 1,
          }),
        );
        const xValue = logX
          ? 10 ** (xMin + ((xMax - xMin) * index) / ticks)
          : xMin + ((xMax - xMin) * index) / ticks;
        svg.append(
          svgElement(
            'text',
            {
              x,
              y: top + height + 23,
              fill: 'currentColor',
              'text-anchor': 'middle',
              'font-size': 12,
            },
            formatValue(xValue, result.xUnit || ''),
          ),
        );
        svg.append(
          svgElement(
            'text',
            { x: left - 9, y: y + 4, fill: 'currentColor', 'text-anchor': 'end', 'font-size': 12 },
            formatValue(yMax - ((yMax - yMin) * index) / ticks, unit),
          ),
        );
      }
      svg.append(
        svgElement(
          'text',
          {
            x: left + width / 2,
            y: 301,
            fill: 'currentColor',
            'text-anchor': 'middle',
            'font-size': 13,
          },
          result.xLabel || '采样点',
        ),
      );
      traces.forEach((trace, traceIndex) => {
        const values = valuesOf(trace);
        const path = samplePath(
          waveformSampleIndices(xValues, values, width, logX),
          xValues,
          values,
          px,
          py,
        );
        if (values.length === 1 && Number.isFinite(values[0]) && Number.isFinite(xValues[0]))
          svg.append(
            svgElement('circle', {
              cx: px(xValues[0]),
              cy: py(values[0]),
              r: 4,
              'data-trace-id': trace.id,
              fill: traceColors[traceIndex % traceColors.length],
              'clip-path': clipPath,
            }),
          );
        else
          svg.append(
            svgElement('path', {
              d: path,
              'data-trace-id': trace.id,
              fill: 'none',
              stroke: traceColors[traceIndex % traceColors.length],
              'stroke-width': 2.2,
              'vector-effect': 'non-scaling-stroke',
              'clip-path': clipPath,
            }),
          );
      });
      const cursor = svgElement('path', {
        d: '',
        stroke: 'var(--circuit-muted,#9db4bb)',
        'stroke-width': 1,
        'stroke-dasharray': '3 3',
        'clip-path': clipPath,
      });
      svg.append(cursor);
      const readout = document.createElement('p');
      readout.style.cssText =
        'font-size:12px;font-variant-numeric:tabular-nums;min-height:1.5em;margin:4px 0;color:var(--circuit-muted,#9db4bb)';
      readout.textContent = '移动指针或触摸曲线查看采样值。';
      function inspect(event) {
        const box = svg.getBoundingClientRect();
        const ratio = Math.min(
          1,
          Math.max(0, (((event.clientX - box.left) / box.width) * chartWidth - left) / width),
        );
        const value = logX ? 10 ** (xMin + ratio * (xMax - xMin)) : xMin + ratio * (xMax - xMin);
        const nearest = nearestWaveformSample(xValues, value, logX);
        if (nearest < 0) return;
        cursor.setAttribute('d', `M ${px(xValues[nearest])} ${top} V ${top + height}`);
        readout.textContent = `${formatValue(xValues[nearest], result.xUnit || '')} · ${traces.map((trace) => `${trace.label}: ${formatValue(valuesOf(trace)[nearest], unit)}`).join(' · ')}`;
      }
      svg.addEventListener('pointermove', inspect);
      svg.addEventListener('pointerdown', inspect);
      group.append(svg, readout);
      container.append(group);
      charts.push(group);
    });
    return {
      destroy() {
        charts.forEach((chart) => chart.remove());
      },
    };
  }

  const exported = {
    getPins,
    transformPoint,
    componentLabelLayout,
    currentIndicatorGeometry,
    getWireRoute,
    insertWirePoint,
    formatValue,
    componentValue,
    waveformSampleIndices,
    nearestWaveformSample,
    xySampleIndices,
    nearestXYSample,
    renderSchematic,
    renderWaveform,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  globalThis.FreeBbsCircuitRenderer = exported;
})();
