(() => {
  const root = document.querySelector('[data-circuit-challenge-page]');
  if (!root) return;
  const app = window.freeBbsApp;
  const engine = window.FreeBbsCircuitEngine;
  const renderer = window.FreeBbsCircuitRenderer;
  const wiring = window.FreeBbsCircuitWiring;
  const layout = window.FreeBbsCircuitLayout;
  const historyModel = window.FreeBbsCircuitHistory;
  const shortcuts = window.FreeBbsCircuitShortcuts;
  const $ = (id) => document.getElementById(`challenge-${id}`);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const allowed = [
    'resistor',
    'capacitor',
    'inductor',
    'opamp',
    'diode',
    'bjt',
    'mosfet',
    'ground',
  ];
  const fixedIds = new Set(['V_IN', 'OUT', 'GND', 'VCC', 'VEE']);
  const prefixes = {
    resistor: 'R',
    capacitor: 'C',
    inductor: 'L',
    opamp: 'U',
    diode: 'D',
    bjt: 'Q',
    mosfet: 'M',
    ground: 'G',
    junction: 'J',
  };
  const parameterLabels = {
    resistance: '电阻 / Ω',
    capacitance: '电容 / F',
    inductance: '电感 / H',
    gain: '开环增益',
    railPositive: '正限幅 / V',
    railNegative: '负限幅 / V',
    is: '饱和电流 / A',
    n: '理想因子',
    thermalVoltage: '热电压 / V',
    beta: '正向电流增益 β',
    betaReverse: '反向电流增益 βR',
    polarity: '极性',
    kp: 'Kp / A·V⁻²',
    w: '沟道宽度 / m',
    l: '沟道长度 / m',
    vto: '阈值电压 / V',
    lambda: '沟道调制 / V⁻¹',
  };
  const state = {
    challenges: [],
    progress: null,
    rankingScope: 'overall',
    challenge: null,
    document: baseDocument(),
    original: null,
    result: null,
    selectedId: '',
    selectedWire: '',
    wireStart: null,
    wireAnchor: null,
    wirePoints: [],
    schematic: null,
    history: null,
    shortcuts: null,
    celebrated: false,
    celebrationFrame: 0,
    celebrationTimer: 0,
    adminMode: false,
    adminEditing: null,
    busy: false,
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(
      /[&<>"']/g,
      (character) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
    );
  }

  function baseDocument() {
    const component = (id, type, x, y, params = {}, rotation = 0) => ({
      id,
      type,
      x,
      y,
      rotation,
      params: { ...(engine?.catalog?.[type]?.defaults || {}), ...params },
    });
    return {
      version: 1,
      components: [
        component(
          'V_IN',
          'voltage',
          140,
          300,
          {
            dc: 0,
            waveform: 'sine',
            amplitude: 2,
            frequency: 1000,
            phase: 0,
            duty: 0.5,
            delay: 0,
          },
          90,
        ),
        component('OUT', 'oscilloscope', 860, 300, {}, 90),
        component('GND', 'ground', 500, 560),
        component('VCC', 'fixed_voltage', 360, 100, { dc: 12 }),
        component('VEE', 'fixed_voltage', 640, 540, { dc: -12 }, 180),
      ],
      wires: [
        {
          id: 'fixed_input_ground',
          from: { componentId: 'V_IN', pin: 1 },
          to: { componentId: 'GND', pin: 0 },
        },
        {
          id: 'fixed_output_ground',
          from: { componentId: 'OUT', pin: 1 },
          to: { componentId: 'GND', pin: 0 },
        },
      ],
      analysis: { type: 'transient', stop: 0.004, step: 0.00001, initial: 'zero' },
    };
  }

  function setStatus(message, error = false, target = 'global-status') {
    const element = $(target);
    element.textContent = message || '';
    element.classList.toggle('is-error', Boolean(error));
  }

  function componentCount(document = state.document) {
    return document.components.filter(
      (item) => !fixedIds.has(item.id) && !['junction', 'ground'].includes(item.type),
    ).length;
  }

  function waveformName(value) {
    return value === 'pulse' ? '方波' : '正弦波';
  }

  function uniqueId(prefix) {
    const ids = new Set(
      [...state.document.components, ...state.document.wires].map((item) => item.id),
    );
    let number = 1;
    while (ids.has(`${prefix}${number}`)) number += 1;
    return `${prefix}${number}`;
  }

  function fixedWire(id) {
    return String(id).startsWith('fixed_');
  }

  function renderPalette() {
    $('palette').innerHTML = allowed
      .map(
        (type) =>
          `<button type="button" data-add="${type}"><span class="challenge-symbol">${prefixes[type]}</span>${escapeHtml(engine.catalog[type].label)}</button>`,
      )
      .join('');
  }

  function renderSchematic() {
    state.schematic?.destroy?.();
    state.schematic = renderer.renderSchematic($('stage'), state.document, {
      interactive: true,
      selectable: true,
      selectedId: state.selectedId || state.selectedWire,
      wireStart: state.wireStart,
      wirePoints: state.wirePoints,
      frame: state.result?.frames?.at(-1) || null,
      viewBox: [0, 0, 1000, 640],
      hiddenComponentIds: ['GND'],
      hiddenWireIds: ['fixed_input_ground', 'fixed_output_ground'],
      terminalPorts: {
        V_IN: { side: 'left', positiveLabel: 'IN +', negativeLabel: 'IN − · GND' },
        OUT: { side: 'right', label: 'OUT' },
      },
      onPinClick: connectPin,
      onCanvasPoint: addConnectionPoint,
      onComponentClick(id) {
        state.selectedId = id;
        state.selectedWire = '';
        renderInspector();
        renderSchematic();
        window.FreeBbsCircuitMobile?.show('parameters');
      },
      onWireClick(id, position) {
        if (state.wireStart) return completeConnection(state.wireStart, { wireId: id, position });
        state.selectedId = '';
        state.selectedWire = id;
        state.wireAnchor = position;
        renderInspector();
        renderSchematic();
        window.FreeBbsCircuitMobile?.show('parameters');
      },
      onConnect(from, target) {
        completeConnection(from, target);
      },
      onWireChange(id, points, { source } = {}) {
        if (fixedWire(id)) return;
        const wire = state.document.wires.find((item) => item.id === id);
        if (!wire) return;
        wire.points = points.map((point) => ({ x: point.x, y: point.y }));
        state.selectedId = '';
        state.selectedWire = id;
        changed(false, { historyGroup: source === 'keyboard' ? `wire-move:${id}` : null });
        renderInspector();
        renderSchematic();
      },
      onMove(id, x, y, { source } = {}) {
        if (fixedIds.has(id)) return renderSchematic();
        const component = state.document.components.find((item) => item.id === id);
        if (!component) return;
        const point = renderer.snapPoint({ x, y }, [170, 80, 830, 530]);
        if (component.x === point.x && component.y === point.y) return;
        Object.assign(component, point);
        state.selectedId = id;
        state.selectedWire = '';
        changed(false, { historyGroup: source === 'keyboard' ? `move:${id}` : null });
        renderSchematic();
      },
    });
    state.viewport?.attach();
  }

  function addComponent(type) {
    if (!allowed.includes(type) || state.document.components.length >= 80) return;
    const count = componentCount();
    state.document.components.push({
      id: uniqueId(prefixes[type]),
      type,
      x: 280 + (count % 4) * 140,
      y: 160 + (Math.floor(count / 4) % 3) * 130,
      rotation: 0,
      params: clone(engine.catalog[type].defaults),
    });
    state.selectedId = state.document.components.at(-1).id;
    state.selectedWire = '';
    changed();
    renderInspector();
    renderSchematic();
  }

  function connectPin(endpoint) {
    const target = { componentId: endpoint.componentId, pin: endpoint.pin };
    if (!state.wireStart) {
      state.wireStart = target;
      state.wirePoints = [];
    } else return completeConnection(state.wireStart, { endpoint: target });
    updateControls();
    renderSchematic();
  }

  function completeConnection(origin, target) {
    const draftPoints = origin === state.wireStart ? state.wirePoints : [];
    try {
      if (origin.wireId && origin.wireId === target.wireId) {
        cancelConnection();
        return;
      }
      let { document } = state;
      let from = origin;
      if (origin.wireId) {
        const split = wiring.connectToWire(document, origin.wireId, origin.position);
        document = split.document;
        from = split.endpoint;
      }
      if (target.wireId) {
        document = wiring.connectToWire(document, target.wireId, target.position, {
          fromEndpoint: from,
          points: draftPoints,
        }).document;
      } else {
        const to = target.endpoint;
        if (from.componentId === to.componentId && from.pin === to.pin) return;
        const duplicate = document.wires.some(
          (wire) =>
            (wire.from.componentId === from.componentId &&
              wire.from.pin === from.pin &&
              wire.to.componentId === to.componentId &&
              wire.to.pin === to.pin) ||
            (wire.to.componentId === from.componentId &&
              wire.to.pin === from.pin &&
              wire.from.componentId === to.componentId &&
              wire.from.pin === to.pin),
        );
        if (duplicate) return;
        document = clone(document);
        document.wires.push({ id: uniqueId('w'), from, to, points: clone(draftPoints) });
      }
      state.document = document;
      changed();
    } catch (error) {
      setStatus(error.message, true, 'run-status');
    } finally {
      state.wireStart = null;
      state.wirePoints = [];
      updateControls();
      renderInspector();
      renderSchematic();
    }
  }

  function changed(electrical = true, { history = true, historyGroup = null } = {}) {
    if (history) state.history?.record({ document: state.document }, { group: historyGroup });
    if (electrical) state.result = null;
    state.celebrated = false;
    $('component-count').textContent = `${componentCount()} 个`;
    $('submit').disabled = true;
    $('result-title').textContent = '电路已修改';
    $('run-status').textContent = '重新测试后才能提交成绩。';
    drawWaveform();
  }

  function addConnectionPoint(position) {
    if (!state.wireStart || !Number.isFinite(position?.x) || !Number.isFinite(position?.y)) return;
    const point = renderer.snapPoint(position, [0, 0, 1000, 640]);
    const last = state.wirePoints.at(-1);
    if (last && last.x === point.x && last.y === point.y) return;
    if (state.wirePoints.length >= 32) {
      setStatus('每条导线最多 32 个拐点。', true, 'run-status');
      return;
    }
    state.wirePoints.push(point);
    updateControls();
    renderSchematic();
  }

  function undoConnectionPoint() {
    if (!state.wireStart || !state.wirePoints.length) return false;
    state.wirePoints.pop();
    updateControls();
    renderSchematic();
    return true;
  }

  function cancelConnection() {
    if (!state.wireStart) return false;
    state.wireStart = null;
    state.wirePoints = [];
    updateControls();
    renderSchematic();
    return true;
  }

  function restoreHistory(direction) {
    if (state.busy) return false;
    if (state.wireStart) {
      if (direction === 'undo' && !undoConnectionPoint()) cancelConnection();
      return true;
    }
    const snapshot = state.history?.[direction]();
    if (!snapshot) return false;
    const electrical =
      historyModel.electricalKey(state.document) !== historyModel.electricalKey(snapshot.document);
    state.document = snapshot.document;
    if (!state.document.components.some((item) => item.id === state.selectedId))
      state.selectedId = '';
    if (!state.document.wires.some((item) => item.id === state.selectedWire))
      state.selectedWire = '';
    state.wireStart = null;
    state.wirePoints = [];
    state.wireAnchor = null;
    changed(electrical, { history: false });
    renderInspector();
    renderSchematic();
    setStatus(direction === 'undo' ? '已撤销上一步修改。' : '已重做修改。', false, 'run-status');
    return true;
  }

  function beautifyCircuit() {
    if (state.busy || state.wireStart || !state.document.components.length) return false;
    try {
      const next = engine.validateDocument(
        layout.normalizeCircuitLayout(engine.validateDocument(state.document), {
          lockedComponentIds: [...fixedIds],
          flow: {
            sourceId: 'V_IN',
            sinkId: 'OUT',
            top: 120,
            bottom: 500,
            padding: 170,
          },
        }),
      );
      if (JSON.stringify(next) === JSON.stringify(state.document)) {
        setStatus('当前布局已经整理完成。', false, 'run-status');
        return false;
      }
      state.document = next;
      state.wireAnchor = null;
      changed(false);
      renderInspector();
      renderSchematic();
      setStatus('已整理元件朝向、间距和导线；固定端口保持原位。', false, 'run-status');
      return true;
    } catch (error) {
      setStatus(`美化未完成：${error.message || '请稍后重试'}`, true, 'run-status');
      return false;
    }
  }

  function parameterField(component, key, value) {
    let control;
    if (key === 'polarity') {
      const choices =
        component.type === 'bjt'
          ? [
              ['npn', 'NPN'],
              ['pnp', 'PNP'],
            ]
          : [
              ['n', 'NMOS'],
              ['p', 'PMOS'],
            ];
      control = `<select data-parameter="${key}">${choices.map(([option, label]) => `<option value="${option}" ${option === value ? 'selected' : ''}>${label}</option>`).join('')}</select>`;
    } else
      control = `<input data-parameter="${key}" type="${typeof value === 'number' ? 'number' : 'text'}" step="any" value="${escapeHtml(value)}" />`;
    return `<label>${escapeHtml(parameterLabels[key] || key)}${control}</label>`;
  }

  function renderInspector() {
    const component = state.document.components.find((item) => item.id === state.selectedId);
    const wire = state.document.wires.find((item) => item.id === state.selectedWire);
    $('selection').hidden = !component && !wire;
    $('selection-empty').hidden = Boolean(component || wire);
    if (!component && !wire) return updateControls();
    const fixed = component && fixedIds.has(component.id);
    $('selected-name').textContent = component
      ? `${component.id} / ${engine.catalog[component.type].label}`
      : `导线 ${wire.id}`;
    $('parameters').innerHTML =
      component && !fixed
        ? Object.entries(component.params)
            .map(([key, value]) => parameterField(component, key, value))
            .join('')
        : `<p class="challenge-empty">${fixed || fixedWire(wire?.id) ? '这是题目的固定端口，不能修改。' : '导线没有可调整的电气参数。'}</p>`;
    $('rotate').disabled = !component || fixed;
    $('delete').disabled = fixed || fixedWire(wire?.id);
    $('delete').textContent = wire ? '删除导线' : '删除元件';
    $('start-wire').hidden = !wire || fixedWire(wire?.id) || Boolean(state.wireStart);
    $('reset-wire').hidden = !wire || fixedWire(wire?.id);
  }

  function removeSelection() {
    if (state.selectedId && !fixedIds.has(state.selectedId)) {
      const id = state.selectedId;
      state.document.components = state.document.components.filter((item) => item.id !== id);
      state.document.wires = state.document.wires.filter(
        (wire) => wire.from.componentId !== id && wire.to.componentId !== id,
      );
    } else if (state.selectedWire && !fixedWire(state.selectedWire)) {
      state.document.wires = state.document.wires.filter((wire) => wire.id !== state.selectedWire);
    } else return;
    state.document = wiring.cleanupJunctions(state.document);
    state.selectedId = '';
    state.selectedWire = '';
    changed();
    renderInspector();
    renderSchematic();
  }

  function rotateSelection(turns = 1) {
    const component = state.document.components.find((item) => item.id === state.selectedId);
    if (!component || fixedIds.has(component.id)) return false;
    component.rotation = (component.rotation + turns * 90 + 360) % 360;
    changed(false);
    renderSchematic();
    return true;
  }

  function mirrorSelection(axis) {
    const component = state.document.components.find((item) => item.id === state.selectedId);
    if (!component || fixedIds.has(component.id)) return false;
    let localAxis = axis;
    if (component.rotation % 180 !== 0) localAxis = axis === 'x' ? 'y' : 'x';
    const key = localAxis === 'x' ? 'mirrorX' : 'mirrorY';
    component[key] = !component[key];
    changed(false);
    renderSchematic();
    return true;
  }

  function duplicateSelection() {
    const selected = state.document.components.find((item) => item.id === state.selectedId);
    if (!selected || fixedIds.has(selected.id) || state.busy || state.wireStart) return false;
    if (state.document.components.length >= 80) return false;
    const duplicate = clone(selected);
    duplicate.id = uniqueId(prefixes[selected.type] || 'J');
    Object.assign(
      duplicate,
      renderer.snapPoint({ x: selected.x + 40, y: selected.y + 40 }, [170, 80, 830, 530]),
    );
    state.document.components.push(duplicate);
    state.selectedId = duplicate.id;
    state.selectedWire = '';
    changed();
    renderInspector();
    renderSchematic();
    return true;
  }

  function moveSelection(dx, dy) {
    const selected = state.document.components.find((item) => item.id === state.selectedId);
    if (!selected || fixedIds.has(selected.id) || state.busy) return false;
    const point = renderer.snapPoint(
      { x: selected.x + dx * renderer.gridSize, y: selected.y + dy * renderer.gridSize },
      [170, 80, 830, 530],
    );
    if (point.x === selected.x && point.y === selected.y) return true;
    Object.assign(selected, point);
    state.wireAnchor = null;
    changed(false, { historyGroup: `move:${selected.id}` });
    renderSchematic();
    return true;
  }

  function startFromWire() {
    const wire = state.document.wires.find((item) => item.id === state.selectedWire);
    if (!wire || fixedWire(wire.id) || state.busy) return false;
    const route = renderer.getWireRoute(wire, state.document.components);
    state.wireStart = {
      wireId: wire.id,
      position: renderer.snapWirePoint(
        wire,
        state.document.components,
        state.wireAnchor || route[Math.floor(route.length / 2)],
      ).point,
    };
    state.wirePoints = [];
    updateControls();
    renderInspector();
    renderSchematic();
    return true;
  }

  function updateControls() {
    $('cancel-wire').hidden = !state.wireStart;
    $('undo-wire').hidden = !state.wireStart;
    $('undo-wire').disabled = !state.wirePoints.length;
    $('beautify').disabled =
      state.busy || Boolean(state.wireStart) || !state.document.components.length;
    $('undo').disabled = state.busy || (!state.wireStart && !state.history?.canUndo());
    $('redo').disabled = state.busy || Boolean(state.wireStart) || !state.history?.canRedo();
    $('canvas-help').textContent = state.wireStart
      ? `已放置 ${state.wirePoints.length} 个拐点；点画布继续折线，点引脚或导线接通，退格撤回。`
      : 'IN− 默认接地；VCC / VEE 可选。点引脚拿线，点画布放拐点；选中导线可编辑。';
    $('run').disabled = state.busy || (!state.challenge && !state.adminMode);
    $('reset').disabled = state.busy || !state.original;
    $('admin-save').disabled = state.busy;
    $('palette')
      .querySelectorAll('button')
      .forEach((button) => {
        const control = button;
        control.disabled = state.busy || (!state.challenge && !state.adminMode);
      });
  }

  function sourceSeries(xValues) {
    const source = state.document.components.find((item) => item.id === 'V_IN');
    if (!source) return [];
    const p = source.params;
    return xValues.map((time) => {
      if (time < p.delay) return p.dc;
      const cycle = ((time - p.delay) * p.frequency) % 1;
      return p.waveform === 'pulse'
        ? p.dc + (cycle < p.duty ? p.amplitude : 0)
        : p.dc + p.amplitude * Math.sin(2 * Math.PI * cycle + (p.phase * Math.PI) / 180);
    });
  }

  function drawWaveform() {
    const canvas = $('waveform');
    const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const width = Math.max(300, canvas.clientWidth);
    const height = Math.max(150, canvas.clientHeight);
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const context = canvas.getContext('2d');
    context.scale(ratio, ratio);
    const styles = getComputedStyle(root);
    const grid = styles.getPropertyValue('--ui-line-strong').trim() || '#30443e';
    const target = state.challenge?.target || null;
    const x =
      state.result?.x ||
      target?.x ||
      Array.from({ length: 401 }, (_, index) => (index * state.document.analysis.stop) / 400);
    const input =
      state.result?.traces?.find((trace) => trace.id === 'V:V_IN')?.values || sourceSeries(x);
    const output = state.result?.traces?.find((trace) => trace.id === 'V:OUT')?.values || [];
    const series = [input, target?.values || [], output].filter((values) => values.length);
    const values = series.flat();
    let min = Math.min(...values, -1);
    let max = Math.max(...values, 1);
    if (max === min) {
      max += 1;
      min -= 1;
    }
    const padding = 10;
    const mapX = (index, length) =>
      padding + (index / Math.max(1, length - 1)) * (width - padding * 2);
    const mapY = (value) => padding + ((max - value) / (max - min)) * (height - padding * 2);
    context.clearRect(0, 0, width, height);
    context.strokeStyle = grid;
    context.lineWidth = 1;
    for (let index = 0; index <= 8; index += 1) {
      const px = padding + (index / 8) * (width - padding * 2);
      context.beginPath();
      context.moveTo(px, padding);
      context.lineTo(px, height - padding);
      context.stroke();
    }
    for (let index = 0; index <= 4; index += 1) {
      const py = padding + (index / 4) * (height - padding * 2);
      context.beginPath();
      context.moveTo(padding, py);
      context.lineTo(width - padding, py);
      context.stroke();
    }
    const colors = [
      styles.getPropertyValue('--challenge-input').trim(),
      styles.getPropertyValue('--challenge-target').trim(),
      styles.getPropertyValue('--challenge-accent').trim(),
    ];
    [input, target?.values || [], output].forEach((points, seriesIndex) => {
      if (!points.length) return;
      context.beginPath();
      context.strokeStyle = colors[seriesIndex];
      context.lineWidth = seriesIndex === 1 ? 2.2 : 1.7;
      context.setLineDash(seriesIndex === 0 ? [5, 4] : []);
      points.forEach((value, index) => {
        const px = mapX(index, points.length);
        const py = mapY(value);
        if (!index) context.moveTo(px, py);
        else context.lineTo(px, py);
      });
      context.stroke();
    });
    context.setLineDash([]);
  }

  function clearCelebration() {
    window.cancelAnimationFrame(state.celebrationFrame);
    window.clearTimeout(state.celebrationTimer);
    state.celebrationFrame = 0;
    state.celebrationTimer = 0;
    const celebration = $('celebration');
    celebration.classList.remove('is-active');
    celebration.hidden = true;
  }

  function launchFireworks() {
    clearCelebration();
    const celebration = $('celebration');
    const canvas = $('fireworks');
    celebration.hidden = false;
    celebration.classList.add('is-active');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
      state.celebrationTimer = window.setTimeout(clearCelebration, 1900);
      return;
    }
    const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const context = canvas.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const styles = getComputedStyle(root);
    const colors = [
      styles.getPropertyValue('--challenge-accent').trim() || '#74d6a4',
      styles.getPropertyValue('--challenge-target').trim() || '#f1c66d',
      styles.getPropertyValue('--challenge-input').trim() || '#8398ad',
      '#ef8f78',
      '#d7a8ef',
    ];
    const bursts = [
      { x: 0.2, y: 0.34, delay: 0 },
      { x: 0.78, y: 0.3, delay: 170 },
      { x: 0.38, y: 0.2, delay: 340 },
      { x: 0.64, y: 0.42, delay: 510 },
      { x: 0.5, y: 0.27, delay: 720 },
    ];
    const particles = [];
    const started = performance.now();
    let previous = started;
    const createBurst = (burst) => {
      const count = width < 600 ? 24 : 38;
      for (let index = 0; index < count; index += 1) {
        const angle = (Math.PI * 2 * index) / count + Math.random() * 0.12;
        const speed = 2.5 + Math.random() * 4.2;
        const life = 850 + Math.random() * 650;
        particles.push({
          x: burst.x * width,
          y: burst.y * height,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life,
          total: life,
          color: colors[(index + Math.floor(burst.delay / 170)) % colors.length],
          size: 1.5 + Math.random() * 1.9,
        });
      }
    };
    const animate = (now) => {
      const elapsed = now - started;
      const step = Math.min(2, (now - previous) / 16.67);
      previous = now;
      for (const burst of bursts) {
        if (burst.fired || elapsed < burst.delay) continue;
        createBurst(burst);
        burst.fired = true;
      }
      context.clearRect(0, 0, width, height);
      context.globalCompositeOperation = 'lighter';
      for (const particle of particles) {
        particle.x += particle.vx * step;
        particle.y += particle.vy * step;
        particle.vy += 0.075 * step;
        particle.vx *= 0.994;
        particle.life -= now - (particle.updated || previous);
        particle.updated = now;
        if (particle.life <= 0) continue;
        context.globalAlpha = Math.max(0, particle.life / particle.total);
        context.fillStyle = particle.color;
        context.beginPath();
        context.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        context.fill();
      }
      context.globalAlpha = 1;
      for (let index = particles.length - 1; index >= 0; index -= 1)
        if (particles[index].life <= 0) particles.splice(index, 1);
      if (elapsed < 2200 || particles.length)
        state.celebrationFrame = window.requestAnimationFrame(animate);
      else clearCelebration();
    };
    state.celebrationFrame = window.requestAnimationFrame(animate);
  }

  function localError(result) {
    const actual = result?.traces?.find((trace) => trace.id === 'V:OUT')?.values;
    const target = state.challenge?.target?.values;
    if (!actual || !target || actual.length !== target.length) return Infinity;
    const mean = target.reduce((sum, value) => sum + value, 0) / target.length;
    let error = 0;
    let scale = 0;
    for (let index = 0; index < target.length; index += 1) {
      error += (actual[index] - target[index]) ** 2;
      scale += (target[index] - mean) ** 2;
    }
    return Math.sqrt(error / target.length) / (Math.sqrt(scale / target.length) || 1);
  }

  function runSimulation() {
    if (state.busy) return;
    state.busy = true;
    updateControls();
    $('result-title').textContent = '正在计算';
    $('run-status').textContent = '求解每个采样点的节点电压。';
    const worker = new Worker('/circuit-worker.js');
    const timer = window.setTimeout(() => {
      worker.terminate();
      state.busy = false;
      updateControls();
      setStatus('仿真超时，请检查浮空节点或减少元件。', true, 'run-status');
    }, 20000);
    worker.onmessage = (event) => {
      window.clearTimeout(timer);
      worker.terminate();
      state.busy = false;
      updateControls();
      if (event.data.error) {
        state.result = null;
        $('result-title').textContent = '无法得到输出';
        setStatus(event.data.error, true, 'run-status');
        renderSchematic();
        drawWaveform();
        return;
      }
      state.result = event.data.result;
      renderSchematic();
      drawWaveform();
      if (state.adminMode) {
        $('result-title').textContent = '目标波形已生成';
        $('run-status').textContent = '保存题目后，这条输出曲线会成为玩家目标。';
        return;
      }
      const error = localError(state.result);
      const passed = error <= state.challenge.tolerance;
      if (passed && !state.celebrated) {
        state.celebrated = true;
        launchFireworks();
      }
      $('result-title').textContent = passed ? '波形匹配，可以提交' : '还差一点';
      $('run-status').textContent =
        `归一化误差 ${(error * 100).toFixed(2)}%，要求不超过 ${(state.challenge.tolerance * 100).toFixed(1)}%。`;
      $('submit').disabled = !passed;
    };
    worker.onerror = () => {
      window.clearTimeout(timer);
      worker.terminate();
      state.busy = false;
      updateControls();
      setStatus('仿真线程启动失败。', true, 'run-status');
    };
    try {
      worker.postMessage({
        id: 1,
        document: engine.validateDocument(state.document),
        options: state.document.analysis,
      });
    } catch (error) {
      window.clearTimeout(timer);
      worker.terminate();
      state.busy = false;
      updateControls();
      setStatus(error.message, true, 'run-status');
    }
  }

  function renderLevels() {
    $('level-count').textContent =
      `${state.progress?.cleared || 0} / ${state.progress?.total || state.challenges.length}`;
    $('progress').textContent = app.userState.isLoggedIn
      ? `已连续通过 ${state.progress?.cleared || 0} 关 · ${state.progress?.nextChallengeId ? '通过当前关卡后解锁下一关' : '全部通关'}`
      : '登录后保存通关进度，逐关解锁';
    const next = state.challenges.find((item) => item.id === state.progress?.nextChallengeId);
    $('next').hidden = !next || !state.challenge?.completed || next.id === state.challenge.id;
    $('next').dataset.challengeId = next?.id || '';
    $('level-list').innerHTML = state.challenges.length
      ? state.challenges
          .map(
            (challenge) =>
              `<button class="challenge-level ${challenge.id === state.challenge?.id ? 'is-active' : ''} ${challenge.completed ? 'is-completed' : ''}" data-challenge-id="${challenge.id}" type="button" ${challenge.locked && !app.userState.isAdmin ? 'disabled' : ''} ${challenge.id === state.challenge?.id ? 'aria-current="step"' : ''}><span><strong>${escapeHtml(challenge.title)}</strong><small>${challenge.completed ? '✓ 已通关' : challenge.locked ? '未解锁 · 先通过前面的关卡' : '待挑战'}${challenge.completed && challenge.locked ? ' · 待补齐前关' : ''}</small></span></button>`,
          )
          .join('')
      : '<p class="challenge-empty">还没有上线的关卡。</p>';
  }

  async function loadChallenges(preferredId, refreshOnly = false) {
    setStatus('正在读取关卡…');
    $('retry').hidden = true;
    try {
      const payload = await app.callApi(
        `/circuit-challenges${app.userState.isAdmin ? '?manage=1' : ''}`,
        { method: 'GET' },
      );
      state.challenges = payload.challenges || [];
      state.progress = payload.progress;
      if (state.challenge)
        Object.assign(
          state.challenge,
          state.challenges.find((item) => item.id === state.challenge.id),
        );
      renderLevels();
      setStatus('');
      if (refreshOnly) return;
      const target =
        state.challenges.find(
          (item) => item.id === Number(preferredId) && (!item.locked || app.userState.isAdmin),
        ) ||
        state.challenges.find((item) => item.id === state.progress?.nextChallengeId) ||
        state.challenges.find((item) => item.isActive && !item.locked) ||
        state.challenges[0];
      if (target) await loadChallenge(target.id);
    } catch (error) {
      setStatus(error.message || '关卡读取失败', true);
      $('retry').hidden = false;
    }
  }

  async function loadChallenge(id) {
    if (state.busy) return;
    setStatus('正在装载题目…');
    try {
      const payload = await app.callApi(`/circuit-challenges/${id}`, { method: 'GET' });
      state.challenge = payload.challenge;
      state.document = clone(payload.challenge.document);
      state.original = clone(state.document);
      state.result = null;
      state.celebrated = false;
      state.adminMode = false;
      state.adminEditing = null;
      state.selectedId = '';
      state.selectedWire = '';
      state.wireStart = null;
      state.wirePoints = [];
      state.history?.reset({ document: state.document });
      renderChallenge();
      window.FreeBbsCircuitMobile?.close();
      await loadLeaderboard();
      setStatus('');
    } catch (error) {
      setStatus(error.message || '题目装载失败', true);
    }
  }

  function renderChallenge() {
    const { challenge } = state;
    const empty = !challenge && !state.adminMode;
    root.classList.toggle('is-empty', empty);
    $('empty').hidden = !empty;
    $('title').textContent =
      challenge?.title || (state.adminMode ? '新建闯关题目' : '选择一个关卡');
    $('description').textContent =
      challenge?.description ||
      (state.adminMode
        ? '搭建完整电路，系统会把 OUT 的仿真结果保存为目标波形。'
        : '题目会给出输入与目标输出波形。');
    const source = state.document.components.find((item) => item.id === 'V_IN');
    $('wave-kind').textContent = source
      ? `${waveformName(source.params.waveform)}输入`
      : '等待题目';
    $('input-fact').textContent = source
      ? `${source.params.amplitude} V / ${source.params.frequency} Hz`
      : '-';
    let tolerance = '-';
    if (challenge) tolerance = `${(challenge.tolerance * 100).toFixed(1)}%`;
    $('tolerance').textContent = tolerance;
    $('reward').textContent = challenge
      ? `${Number(challenge.rewardElectric) || 0} 电元`
      : '0 电元';
    $('component-count').textContent = `${componentCount()} 个`;
    $('admin-form').hidden = !state.adminMode;
    $('admin-save').hidden = !state.adminMode;
    $('admin-cancel').hidden = !state.adminMode;
    $('run').hidden = state.adminMode;
    $('submit').hidden = state.adminMode;
    $('reset').hidden = state.adminMode;
    $('admin-edit').hidden = !app.userState.isAdmin || !challenge || state.adminMode;
    $('result-title').textContent = state.adminMode ? '搭建标准答案' : '还没有运行';
    $('run-status').textContent = state.adminMode
      ? '保存时会自动运行仿真并提取 OUT 波形。'
      : '搭好电路后，先测试输出波形。';
    $('submit').disabled = true;
    renderLevels();
    renderInspector();
    renderSchematic();
    drawWaveform();
    updateControls();
  }

  async function loadLeaderboard() {
    if (!state.challenge) {
      $('leaderboard').innerHTML = '<p class="challenge-empty">选择关卡后显示排名。</p>';
      return;
    }
    $('leaderboard').innerHTML = '<p class="challenge-empty">正在读取排名…</p>';
    try {
      const overall = state.rankingScope === 'overall';
      const payload = await app.callApi(
        overall
          ? '/circuit-challenges/leaderboard'
          : `/circuit-challenges/${state.challenge.id}/leaderboard`,
        {
          method: 'GET',
        },
      );
      $('ranking-note').textContent = overall
        ? '按连续通关数排序；进度相同，先达到者领先。仅统计当前有效版本。'
        : '按元件数、误差、达成时间排序。';
      $('my-rank').textContent =
        overall && payload.me
          ? `我的排名 #${payload.me.rank} · 连续通过 ${payload.me.cleared} 关`
          : overall && app.userState.isLoggedIn
            ? '通过第一关后进入总榜'
            : '';
      $('leaderboard').innerHTML = payload.leaderboard.length
        ? payload.leaderboard
            .map(
              (entry) =>
                `<div class="challenge-rank ${entry.isMe ? 'is-me' : ''}"><b>${entry.rank}</b><strong>${escapeHtml(entry.username)}</strong><small>${overall ? `通过 ${entry.cleared} 关` : `${entry.componentCount} 件 · 误差 ${(entry.error * 100).toFixed(2)}%`}</small></div>`,
            )
            .join('')
        : '<p class="challenge-empty">还没有人通关，第一名等你来拿。</p>';
    } catch (error) {
      $('leaderboard').innerHTML =
        `<p class="challenge-empty">${escapeHtml(error.message || '排名读取失败')}</p>`;
    }
  }

  async function submit() {
    if (!state.challenge || !state.result || state.busy) return;
    if (!app.userState.isLoggedIn) {
      setStatus('请先登录，再提交榜单成绩。', true, 'run-status');
      return;
    }
    state.busy = true;
    updateControls();
    try {
      const payload = await app.callApi(`/circuit-challenges/${state.challenge.id}/submissions`, {
        method: 'POST',
        body: JSON.stringify({ revision: state.challenge.revision, document: state.document }),
      });
      $('result-title').textContent = `通关，使用 ${payload.componentCount} 个元件`;
      const rewardNotes = [];
      if (payload.rewards?.completion)
        rewardNotes.push(`首次通关 +${payload.rewards.completion} 电元`);
      if (payload.rewards?.record) rewardNotes.push(`刷新最低纪录 +${payload.rewards.record} 电元`);
      $('run-status').textContent =
        `成绩已进入榜单，误差 ${(payload.error * 100).toFixed(2)}%${rewardNotes.length ? `；${rewardNotes.join('，')}` : ''}。`;
      if (payload.balance) app.syncWallet(payload.balance, app.userState.token);
      await loadChallenges(state.challenge.id, true);
      await loadLeaderboard();
    } catch (error) {
      setStatus(error.message || '提交失败', true, 'run-status');
    } finally {
      state.busy = false;
      updateControls();
    }
  }

  function syncAdminSource() {
    const source = state.document.components.find((item) => item.id === 'V_IN');
    if (!source) return;
    source.params.waveform = $('admin-waveform').value;
    source.params.amplitude = Number($('admin-amplitude').value);
    source.params.frequency = Number($('admin-frequency').value);
    source.params.dc = Number($('admin-dc').value);
    const periods = 4;
    source.params.duty = 0.5;
    source.params.phase = 0;
    source.params.delay = 0;
    state.document.analysis.stop = periods / source.params.frequency;
    state.document.analysis.step = 1 / (source.params.frequency * 100);
    state.result = null;
    state.celebrated = false;
    renderChallenge();
  }

  function beginAdmin(editing = false) {
    state.adminMode = true;
    state.adminEditing = editing ? state.challenge : null;
    state.document = editing ? clone(state.challenge.solution) : baseDocument();
    state.original = clone(state.document);
    state.result = null;
    const source = state.document.components.find((item) => item.id === 'V_IN');
    $('admin-title').value = editing ? state.challenge.title : '';
    $('admin-description').value = editing ? state.challenge.description : '';
    $('admin-waveform').value = source.params.waveform;
    $('admin-amplitude').value = source.params.amplitude;
    $('admin-frequency').value = source.params.frequency;
    $('admin-dc').value = source.params.dc;
    $('admin-tolerance').value = editing ? state.challenge.tolerance * 100 : 6;
    $('admin-reward').value = editing ? state.challenge.rewardElectric : 20;
    $('admin-active').checked = editing ? state.challenge.isActive : true;
    state.selectedId = '';
    state.selectedWire = '';
    state.wireStart = null;
    state.wirePoints = [];
    state.history?.reset({ document: state.document });
    renderChallenge();
  }

  async function saveAdmin() {
    if (!state.adminMode || state.busy || !$('admin-form').reportValidity()) return;
    syncAdminSource();
    state.busy = true;
    updateControls();
    $('result-title').textContent = '正在生成目标波形';
    $('run-status').textContent = '服务端正在复算并保存题目。';
    const editing = state.adminEditing;
    try {
      const payload = await app.callApi(
        editing ? `/circuit-challenges/${editing.id}` : '/circuit-challenges',
        {
          method: editing ? 'PUT' : 'POST',
          body: JSON.stringify({
            title: $('admin-title').value,
            description: $('admin-description').value,
            tolerance: Number($('admin-tolerance').value) / 100,
            rewardElectric: Number($('admin-reward').value),
            isActive: $('admin-active').checked,
            document: state.document,
            ...(editing ? { expectedRevision: editing.revision } : {}),
          }),
        },
      );
      state.adminMode = false;
      state.adminEditing = null;
      state.busy = false;
      updateControls();
      setStatus('题目已保存，目标波形由标准答案自动生成。');
      await loadChallenges(payload.challenge.id);
    } catch (error) {
      setStatus(error.message || '题目保存失败', true, 'run-status');
    } finally {
      state.busy = false;
      updateControls();
    }
  }

  function reset() {
    if (!state.original) return;
    state.document = clone(state.original);
    state.result = null;
    state.selectedId = '';
    state.selectedWire = '';
    state.wireStart = null;
    state.wirePoints = [];
    changed();
    renderInspector();
    renderSchematic();
  }

  function dispatchShortcut(action, detail = {}, event = {}) {
    if (action === 'save') {
      if (!state.adminMode) return false;
      saveAdmin();
      return true;
    }
    if (action === 'run') {
      if (!state.challenge && !state.adminMode) return false;
      runSimulation();
      return true;
    }
    if (action === 'add') {
      $('palette').querySelector('button:not(:disabled)')?.focus({ preventScroll: false });
      return true;
    }
    if (action === 'cancel') {
      if (state.wireStart) cancelConnection();
      else {
        state.selectedId = '';
        state.selectedWire = '';
        renderInspector();
        renderSchematic();
      }
      return true;
    }
    if (state.busy) return false;
    if (action === 'undo' || action === 'redo') return restoreHistory(action);
    if (action === 'delete' && state.wireStart && event.key === 'Backspace') {
      if (!undoConnectionPoint()) cancelConnection();
      return true;
    }
    if (state.wireStart) return false;
    if (action === 'rotate') return rotateSelection(detail.turns);
    if (action === 'mirror') return mirrorSelection(detail.axis);
    if (action === 'duplicate') return duplicateSelection();
    if (action === 'move') return moveSelection(detail.dx, detail.dy);
    if (action === 'delete') {
      if (!state.selectedId && !state.selectedWire) return false;
      removeSelection();
      return true;
    }
    if (action === 'wire') {
      if (state.selectedWire) return startFromWire();
      if (!state.selectedId) return false;
      connectPin({ componentId: state.selectedId, pin: 0 });
      return true;
    }
    return false;
  }

  function bindEvents() {
    state.history = historyModel.create();
    state.history.reset({ document: state.document });
    $('palette').addEventListener('click', (event) => {
      const button = event.target.closest('[data-add]');
      if (button) addComponent(button.dataset.add);
    });
    $('level-list').addEventListener('click', (event) => {
      const button = event.target.closest('[data-challenge-id]');
      if (button) loadChallenge(button.dataset.challengeId);
    });
    $('parameters').addEventListener('change', (event) => {
      const key = event.target.dataset.parameter;
      const component = state.document.components.find((item) => item.id === state.selectedId);
      if (!key || !component) return;
      const previous = component.params[key];
      const value = typeof previous === 'number' ? Number(event.target.value) : event.target.value;
      component.params[key] = value;
      try {
        state.document = engine.validateDocument(state.document);
        changed();
        renderInspector();
        renderSchematic();
      } catch (error) {
        component.params[key] = previous;
        const field = event.target;
        field.value = previous;
        setStatus(error.message, true, 'run-status');
      }
    });
    $('delete').addEventListener('click', removeSelection);
    $('rotate').addEventListener('click', () => rotateSelection());
    $('cancel-wire').addEventListener('click', cancelConnection);
    $('undo-wire').addEventListener('click', undoConnectionPoint);
    $('beautify').addEventListener('click', beautifyCircuit);
    $('undo').addEventListener('click', () => restoreHistory('undo'));
    $('redo').addEventListener('click', () => restoreHistory('redo'));
    $('start-wire').addEventListener('click', startFromWire);
    $('reset-wire').addEventListener('click', () => {
      const wire = state.document.wires.find((item) => item.id === state.selectedWire);
      if (!wire || fixedWire(wire.id)) return;
      delete wire.points;
      changed(false);
      renderSchematic();
    });
    $('run').addEventListener('click', runSimulation);
    $('submit').addEventListener('click', submit);
    $('reset').addEventListener('click', reset);
    $('retry').addEventListener('click', () => loadChallenges(state.challenge?.id));
    $('admin-new').addEventListener('click', () => beginAdmin(false));
    $('admin-edit').addEventListener('click', () => beginAdmin(true));
    $('admin-save').addEventListener('click', saveAdmin);
    $('admin-cancel').addEventListener('click', () =>
      state.challenge ? loadChallenge(state.challenge.id) : loadChallenges(),
    );
    ['waveform', 'amplitude', 'frequency', 'dc'].forEach((id) =>
      $(`admin-${id}`.replace('admin-admin-', 'admin-'))?.addEventListener(
        'change',
        syncAdminSource,
      ),
    );
    window.addEventListener('resize', drawWaveform);
    state.shortcuts = shortcuts.bind({
      target: document,
      dispatch: dispatchShortcut,
      isActive: () => !state.busy,
      helpButton: $('shortcuts'),
      helpDialog: $('shortcuts-dialog'),
    });
    window.addEventListener('pagehide', () => {
      clearCelebration();
      state.shortcuts?.destroy?.();
      state.schematic?.destroy?.();
    });
  }

  async function initialize() {
    if (!app || !engine || !renderer || !wiring || !layout || !historyModel || !shortcuts)
      return setStatus('电路模块未加载，请刷新后重试。', true);
    await app.sessionReady;
    state.viewport = window.FreeBbsCircuitViewport?.create($('stage'), {
      in: $('zoom-in'),
      out: $('zoom-out'),
      reset: $('zoom-reset'),
      pan: $('pan'),
      value: $('zoom-value'),
      expand: $('expand-canvas'),
    });
    $('next').addEventListener('click', () => loadChallenge(Number($('next').dataset.challengeId)));
    $('ranking-scope').addEventListener('change', () => {
      state.rankingScope = $('ranking-scope').value;
      loadLeaderboard();
    });
    $('admin-new').hidden = !app.userState.isAdmin;
    renderPalette();
    bindEvents();
    renderChallenge();
    await loadChallenges(new URLSearchParams(window.location.search).get('id'));
    window.addEventListener('freebbs:session-change', () => {
      $('admin-new').hidden = !app.userState.isAdmin;
      loadChallenges(state.challenge?.id);
    });
  }
  initialize();
})();
