(() => {
  const root = document.querySelector('[data-circuit-challenge-page]');
  if (!root) return;
  const app = window.freeBbsApp;
  const engine = window.FreeBbsCircuitEngine;
  const renderer = window.FreeBbsCircuitRenderer;
  const wiring = window.FreeBbsCircuitWiring;
  const $ = (id) => document.getElementById(`challenge-${id}`);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const allowed = ['resistor', 'capacitor', 'inductor', 'opamp', 'diode', 'bjt', 'mosfet'];
  const fixedIds = new Set(['V_IN', 'OUT', 'GND', 'VCC', 'VEE']);
  const prefixes = {
    resistor: 'R',
    capacitor: 'C',
    inductor: 'L',
    opamp: 'U',
    diode: 'D',
    bjt: 'Q',
    mosfet: 'M',
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
    challenge: null,
    document: baseDocument(),
    original: null,
    result: null,
    selectedId: '',
    selectedWire: '',
    wireStart: null,
    wireAnchor: null,
    schematic: null,
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
    return document.components.filter((item) => !fixedIds.has(item.id) && item.type !== 'junction')
      .length;
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
      frame: state.result?.frames?.at(-1) || null,
      viewBox: [0, 0, 1000, 640],
      hiddenComponentIds: ['GND'],
      hiddenWireIds: ['fixed_input_ground', 'fixed_output_ground'],
      terminalPorts: {
        V_IN: { side: 'left', positiveLabel: 'IN +', negativeLabel: 'IN − · GND' },
        OUT: { side: 'right', label: 'OUT' },
      },
      onPinClick: connectPin,
      onComponentClick(id) {
        state.selectedId = id;
        state.selectedWire = '';
        renderInspector();
        renderSchematic();
      },
      onWireClick(id, position) {
        if (state.wireStart) return completeConnection(state.wireStart, { wireId: id, position });
        state.selectedId = '';
        state.selectedWire = id;
        state.wireAnchor = position;
        renderInspector();
        renderSchematic();
      },
      onConnect(from, target) {
        completeConnection(from, target);
      },
      onWireChange(id, points) {
        if (fixedWire(id)) return;
        const wire = state.document.wires.find((item) => item.id === id);
        if (!wire) return;
        wire.points = points;
        changed(false);
        renderSchematic();
      },
      onMove(id, x, y) {
        if (fixedIds.has(id)) return renderSchematic();
        const component = state.document.components.find((item) => item.id === id);
        if (!component) return;
        component.x = Math.max(170, Math.min(830, Math.round(x / 10) * 10));
        component.y = Math.max(80, Math.min(530, Math.round(y / 10) * 10));
        changed(false);
        renderSchematic();
      },
    });
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
    if (!state.wireStart) state.wireStart = target;
    else return completeConnection(state.wireStart, { endpoint: target });
    updateControls();
    renderSchematic();
  }

  function completeConnection(origin, target) {
    try {
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
        document.wires.push({ id: uniqueId('w'), from, to });
      }
      state.document = document;
      changed();
    } catch (error) {
      setStatus(error.message, true, 'run-status');
    } finally {
      state.wireStart = null;
      updateControls();
      renderInspector();
      renderSchematic();
    }
  }

  function changed(electrical = true) {
    if (electrical) state.result = null;
    $('component-count').textContent = `${componentCount()} 个`;
    $('submit').disabled = true;
    $('result-title').textContent = '电路已修改';
    $('run-status').textContent = '重新测试后才能提交成绩。';
    drawWaveform();
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
    state.selectedId = '';
    state.selectedWire = '';
    changed();
    renderInspector();
    renderSchematic();
  }

  function rotateSelection() {
    const component = state.document.components.find((item) => item.id === state.selectedId);
    if (!component || fixedIds.has(component.id)) return;
    component.rotation = (component.rotation + 90) % 360;
    changed();
    renderSchematic();
  }

  function updateControls() {
    $('cancel-wire').hidden = !state.wireStart;
    $('canvas-help').textContent = state.wireStart
      ? '选择另一个引脚或导线完成连接，按 Esc 取消。'
      : 'IN− 默认接地；VCC / VEE 是可选公共电源，不使用也可。拖动端点完成连线。';
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
    $('level-count').textContent = String(state.challenges.length);
    $('level-list').innerHTML = state.challenges.length
      ? state.challenges
          .map(
            (challenge) =>
              `<button class="challenge-level ${challenge.id === state.challenge?.id ? 'is-active' : ''}" data-challenge-id="${challenge.id}" type="button"><span><strong>${escapeHtml(challenge.title)}</strong><small>${waveformName(challenge.input.waveform)} / ${challenge.input.frequency} Hz · ${Number(challenge.rewardElectric) || 0} 电元</small></span></button>`,
          )
          .join('')
      : '<p class="challenge-empty">还没有上线的关卡。</p>';
  }

  async function loadChallenges(preferredId) {
    setStatus('正在读取关卡…');
    $('retry').hidden = true;
    try {
      const payload = await app.callApi(
        `/circuit-challenges${app.userState.isAdmin ? '?manage=1' : ''}`,
        { method: 'GET' },
      );
      state.challenges = payload.challenges || [];
      renderLevels();
      setStatus('');
      const target =
        state.challenges.find((item) => item.id === Number(preferredId)) ||
        state.challenges.find((item) => item.isActive) ||
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
      state.adminMode = false;
      state.adminEditing = null;
      state.selectedId = '';
      state.selectedWire = '';
      state.wireStart = null;
      renderChallenge();
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
    else if (state.adminMode) tolerance = `${$('admin-tolerance').value}%`;
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
      const payload = await app.callApi(`/circuit-challenges/${state.challenge.id}/leaderboard`, {
        method: 'GET',
      });
      $('leaderboard').innerHTML = payload.leaderboard.length
        ? payload.leaderboard
            .map(
              (entry) =>
                `<div class="challenge-rank"><b>${entry.rank}</b><strong>${escapeHtml(entry.username)}</strong><small>${entry.componentCount} 件<br />误差 ${(entry.error * 100).toFixed(2)}%</small></div>`,
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
    changed();
    renderInspector();
    renderSchematic();
  }

  function bindEvents() {
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
    $('rotate').addEventListener('click', rotateSelection);
    $('cancel-wire').addEventListener('click', () => {
      state.wireStart = null;
      updateControls();
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
    document.addEventListener('keydown', (event) => {
      if (event.target.closest('input,textarea,select,[contenteditable]')) return;
      if (event.key === 'Escape') {
        state.wireStart = null;
        updateControls();
        renderSchematic();
      }
      if (['Delete', 'Backspace'].includes(event.key)) removeSelection();
    });
  }

  async function initialize() {
    if (!app || !engine || !renderer || !wiring)
      return setStatus('电路模块未加载，请刷新后重试。', true);
    await app.sessionReady;
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
