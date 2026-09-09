(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const labels = {
    ground: '接地',
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

  function getPins(component) {
    let offsets = [
      [-40, 0, '+'],
      [40, 0, '−'],
    ];
    if (component.type === 'ground') offsets = [[0, -28, 'GND']];
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
    const angle = ((Number(component.rotation) || 0) * Math.PI) / 180;
    return offsets.map(([x, y, label], pin) => ({
      componentId: component.id,
      pin,
      label,
      x: Number(component.x) + Math.round(x * Math.cos(angle) - y * Math.sin(angle)),
      y: Number(component.y) + Math.round(x * Math.sin(angle) + y * Math.cos(angle)),
    }));
  }

  function svgElement(tag, attributes, text) {
    const element = document.createElementNS(NS, tag);
    Object.entries(attributes || {}).forEach(([name, value]) =>
      element.setAttribute(name, String(value)),
    );
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function componentValue(component) {
    const p = component.params || {};
    if (component.type === 'resistor') return formatValue(Number(p.resistance), 'Ω');
    if (component.type === 'capacitor') return formatValue(Number(p.capacitance), 'F');
    if (component.type === 'inductor') return formatValue(Number(p.inductance), 'H');
    if (component.type === 'voltage') return formatValue(Number(p.dc), 'V');
    if (component.type === 'current') return formatValue(Number(p.dc), 'A');
    if (component.type === 'bjt') return `${p.polarity || 'npn'} · β=${p.beta}`;
    if (component.type === 'mosfet')
      return `${p.polarity || 'n'} · W/L=${Number((Number(p.w) / Number(p.l)).toPrecision(3))}`;
    if (component.type === 'nonlinear') return String(p.expression || 'i = k*u^3').slice(0, 34);
    if (['vcvs', 'vccs', 'ccvs', 'cccs'].includes(component.type)) return `增益 ${p.gain}`;
    return labels[component.type] || component.type;
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
            x,
            y,
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
    const { type } = component;
    if (type === 'ground') {
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
      if (component.params?.polarity === 'p') line('M -5 -5 L -12 0 L -5 5');
      else line('M -12 -5 L -5 0 L -12 5');
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
        text('C+', -18, 30, 9);
        text('C−', 18, 30, 9);
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
      if (type === 'voltage') voltageMarks();
      else if (type === 'current') currentArrow();
      else if (type === 'voltmeter') text('V');
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
      role: 'img',
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
    svg.append(wireLayer, nodeLayer);

    function wirePath(wire) {
      const fromComponent = components.get(wire.from.componentId);
      const toComponent = components.get(wire.to.componentId);
      if (!fromComponent || !toComponent) return '';
      const a = getPins(fromComponent)[wire.from.pin];
      const b = getPins(toComponent)[wire.to.pin];
      if (!a || !b) return '';
      const mid = Math.round((a.x + b.x) / 40) * 20;
      return `M ${a.x} ${a.y} H ${mid} V ${b.y} H ${b.x}`;
    }

    (circuit.wires || []).forEach((wire) => {
      const path = svgElement('path', {
        d: wirePath(wire),
        stroke: 'currentColor',
        'data-wire-id': wire.id,
      });
      wireLayer.append(path);
      if (options.interactive) {
        const hit = svgElement('path', {
          d: wirePath(wire),
          stroke: 'transparent',
          'stroke-width': 18,
          tabindex: 0,
          role: 'button',
          'aria-label': `选择导线 ${wire.id}`,
        });
        const choose = (event) => {
          event.stopPropagation();
          options.onWireClick?.(wire.id);
        };
        hit.addEventListener('click', choose);
        hit.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') choose(event);
        });
        wireLayer.append(hit);
        wires.push({ wire, path, hit });
      } else wires.push({ wire, path });
    });

    function pointerPosition(event) {
      const matrix = svg.getScreenCTM();
      if (!matrix) return { x: 0, y: 0 };
      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      return point.matrixTransform(matrix.inverse());
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
      group.append(
        svgElement('rect', {
          x: -54,
          y: -54,
          width: 108,
          height: 114,
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
        transform: `rotate(${component.rotation || 0})`,
        stroke: 'currentColor',
        fill: 'none',
      });
      addSymbol(symbol, component);
      group.append(symbol);
      const labelX = ['bjt', 'mosfet'].includes(component.type) ? 25 : 0;
      const labelY = ['bjt', 'mosfet'].includes(component.type) ? -14 : -33;
      group.append(
        svgElement(
          'text',
          {
            x: labelX,
            y: labelY,
            fill: 'currentColor',
            'font-size': 14,
            'font-weight': 600,
            'text-anchor': labelX ? 'start' : 'middle',
            stroke: 'none',
          },
          component.id,
        ),
      );
      const reading = svgElement(
        'text',
        {
          x: 0,
          y: ['vcvs', 'vccs'].includes(component.type) ? 68 : 58,
          fill: 'var(--circuit-muted,#9db4bb)',
          'font-size': 12,
          'text-anchor': 'middle',
          stroke: 'none',
        },
        componentValue(component),
      );
      group.append(reading);
      const pins = [];
      getPins(component).forEach((pin) => {
        const x = pin.x - component.x;
        const y = pin.y - component.y;
        const active =
          options.wireStart?.componentId === component.id && options.wireStart?.pin === pin.pin;
        const dot = svgElement('circle', {
          cx: x,
          cy: y,
          r: active ? 7 : 4,
          fill: active ? 'var(--circuit-accent,#48b6bd)' : 'var(--circuit-surface,#102228)',
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
          hit.addEventListener('pointerdown', (event) => event.stopPropagation());
          hit.addEventListener('click', (event) => {
            event.stopPropagation();
            options.onPinClick?.({ componentId: component.id, pin: pin.pin });
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
        d: 'M -13 27 H 13',
        fill: 'none',
        stroke: 'var(--circuit-accent,#48b6bd)',
        'stroke-width': 3,
        visibility: 'hidden',
      });
      group.append(indicator);
      nodes.push({ component, reading, pins, indicator });
      nodeLayer.append(group);
      if (options.selectable && !options.interactive) {
        group.addEventListener('click', () => options.onComponentClick?.(component.id));
        group.addEventListener('keydown', (event) => {
          if (event.target === group && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            options.onComponentClick?.(component.id);
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
          wires.forEach(({ wire, path, hit }) => {
            path.setAttribute('d', wirePath(wire));
            hit?.setAttribute('d', wirePath(wire));
          });
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
            options.onComponentClick?.(component.id);
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
      wires.forEach(({ wire, path }) =>
        path.setAttribute('stroke', color(netMap[`${wire.from.componentId}:${wire.from.pin}`])),
      );
      nodes.forEach((node) => {
        const { component, reading, pins, indicator } = node;
        pins.forEach(({ dot, net }) => dot.setAttribute('stroke', color(net)));
        if (frame && ['voltmeter', 'oscilloscope'].includes(component.type)) {
          const a = voltages[netMap[`${component.id}:0`]] || 0;
          const b = voltages[netMap[`${component.id}:1`]] || 0;
          reading.textContent = formatValue(a - b, 'V');
        } else if (frame && component.type === 'ammeter')
          reading.textContent = formatValue(frame.currents?.[component.id] || 0, 'A');
        else if (!frame) reading.textContent = componentValue(component);
        const current = frame?.currents?.[component.id] || 0;
        indicator.setAttribute(
          'visibility',
          options.animate && Math.abs(current) > 1e-12 && component.type !== 'ground'
            ? 'visible'
            : 'hidden',
        );
        indicator.setAttribute('class', options.animate ? 'circuit-current' : '');
        indicator.style.animationDirection = current < 0 ? 'reverse' : 'normal';
      });
    }
    container.append(svg);
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

  function renderWaveform(container, result, options = {}) {
    container.replaceChildren();
    const selected = result.traces.filter(
      (trace) => !options.traceIds || options.traceIds.includes(trace.id),
    );
    const charts = [];
    const units = [...new Set(selected.map((trace) => trace.unit))];
    if (options.phase && selected.some((trace) => Array.isArray(trace.phase))) units.push('°');
    if (!selected.length) {
      const empty = document.createElement('p');
      empty.textContent = '选择一个电压或电流通道查看波形。';
      container.append(empty);
    }
    units.forEach((unit) => {
      const traces = selected.filter((trace) =>
        unit === '°' ? Array.isArray(trace.phase) : trace.unit === unit,
      );
      const group = document.createElement('section');
      group.className = 'circuit-wave-group';
      const heading = document.createElement('div');
      heading.className = 'circuit-wave-legend';
      heading.style.cssText =
        'display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12px;padding:8px 0';
      traces.forEach((trace, index) => {
        const item = document.createElement('span');
        item.style.color = traceColors[index % traceColors.length];
        item.textContent = `${trace.label}${unit === '°' ? ' · 相位' : ''}`;
        heading.append(item);
      });
      group.append(heading);
      const chartWidth = Math.max(300, Math.min(920, container.clientWidth || 920));
      const svg = svgElement('svg', {
        viewBox: `0 0 ${chartWidth} 310`,
        width: '100%',
        role: 'img',
        'aria-label': `${result.xLabel || '扫描'} · ${unit === '°' ? '相位' : unit} 波形`,
      });
      svg.style.cssText =
        'display:block;background:var(--circuit-surface,#102228);color:var(--circuit-ink,#dfedf0)';
      const left = chartWidth < 500 ? 65 : 76;
      const top = 20;
      const width = chartWidth - left - 24;
      const height = 232;
      const xValues = result.x || [];
      const logX = Boolean(options.logX && xValues.every((x) => x > 0));
      const projectX = (x) => (logX ? Math.log10(x) : x);
      const xMin = projectX(xValues[0] ?? 0);
      const xMax = projectX(xValues.at(-1) ?? 1);
      const valuesOf = (trace) => (unit === '°' ? trace.phase : trace.values);
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
      const padding = Math.max((yMax - yMin) * 0.09, Math.abs(yMax) * 0.03, 1e-12);
      yMin -= padding;
      yMax += padding;
      const px = (x) => left + ((projectX(x) - xMin) / (xMax - xMin || 1)) * width;
      const py = (y) => top + (1 - (y - yMin) / (yMax - yMin)) * height;
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
        const path = values
          .map((value, index) =>
            Number.isFinite(value) && Number.isFinite(xValues[index])
              ? `${index ? 'L' : 'M'} ${px(xValues[index]).toFixed(3)} ${py(value).toFixed(3)}`
              : '',
          )
          .join(' ');
        if (values.length === 1)
          svg.append(
            svgElement('circle', {
              cx: px(xValues[0]),
              cy: py(values[0]),
              r: 4,
              fill: traceColors[traceIndex % traceColors.length],
            }),
          );
        else
          svg.append(
            svgElement('path', {
              d: path,
              fill: 'none',
              stroke: traceColors[traceIndex % traceColors.length],
              'stroke-width': 2.2,
              'vector-effect': 'non-scaling-stroke',
            }),
          );
      });
      const cursor = svgElement('path', {
        d: '',
        stroke: 'var(--circuit-muted,#9db4bb)',
        'stroke-width': 1,
        'stroke-dasharray': '3 3',
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
        let nearest = 0;
        for (let index = 1; index < xValues.length; index += 1)
          if (
            Math.abs(projectX(xValues[index]) - projectX(value)) <
            Math.abs(projectX(xValues[nearest]) - projectX(value))
          )
            nearest = index;
        if (!xValues.length) return;
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

  const exported = { getPins, formatValue, componentValue, renderSchematic, renderWaveform };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  globalThis.FreeBbsCircuitRenderer = exported;
})();
