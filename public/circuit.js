(() => {
  const page = document.querySelector('[data-circuit-page]');
  if (!page) return;
  const app = window.freeBbsApp;
  const engine = window.FreeBbsCircuitEngine;
  const renderer = window.FreeBbsCircuitRenderer;
  const wiring = window.FreeBbsCircuitWiring;
  const params = new URLSearchParams(window.location.search);
  const listPage = window.location.pathname.replace(/\/$/, '') === '/circuits';
  const $ = (id) => document.getElementById(`circuit-${id}`);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const prefixes = {
    ground: 'G',
    resistor: 'R',
    capacitor: 'C',
    inductor: 'L',
    voltage: 'V',
    current: 'I',
    vcvs: 'E',
    vccs: 'Gm',
    ccvs: 'H',
    cccs: 'F',
    diode: 'D',
    bjt: 'Q',
    mosfet: 'M',
    opamp: 'U',
    nonlinear: 'N',
    voltmeter: 'VM',
    ammeter: 'AM',
    oscilloscope: 'OS',
  };
  const parameterLabels = {
    resistance: '电阻 / Ω',
    capacitance: '电容 / F',
    inductance: '电感 / H',
    dc: '直流偏置',
    waveform: '波形',
    amplitude: '波形峰值',
    frequency: '频率 / Hz',
    phase: '相位 / °',
    duty: '占空比 / 0–1',
    delay: '延迟 / s',
    acAmplitude: 'AC 小信号峰值',
    gain: '增益',
    control: '控制电流元件',
    is: '饱和电流 Is / A',
    n: '理想因子 n',
    beta: '正向电流增益 β',
    betaReverse: '反向电流增益 βR',
    thermalVoltage: '热电压 / V',
    kp: '工艺参数 Kp / A·V⁻²',
    w: '沟道宽度 W / m',
    l: '沟道长度 L / m',
    vto: '阈值电压 / V',
    lambda: '沟道调制 λ / V⁻¹',
    polarity: '极性',
    railPositive: '正限幅 / V',
    railNegative: '负限幅 / V',
    expression: '伏安关系 i(u)',
    k: '特性系数 k',
  };
  const state = {
    document: { version: 1, components: [], wires: [], analysis: { type: 'dc' } },
    cid: '',
    revision: 0,
    latestRevision: 0,
    owner: null,
    editable: true,
    dirty: false,
    editVersion: 0,
    selectedId: '',
    selectedWire: '',
    wireAnchor: null,
    wireStart: null,
    schematic: null,
    result: null,
    traceIds: [],
    frame: 0,
    playing: false,
    animation: 0,
    worker: null,
    workerTimer: 0,
    resizeTimer: 0,
    runId: 0,
    saving: false,
    generation: 0,
    listOffset: 0,
    listLoading: false,
    sessionUid: '',
    examples: [],
    loadedExample: null,
    exampleBusy: false,
    exampleLoading: false,
    exampleRequest: 0,
    exampleLoadRequest: 0,
    deleteExample: null,
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
    );
  }

  function setStatus(message, tone = '', target = 'status') {
    const element = $(target);
    if (!element) return;
    element.textContent = message;
    element.className = `circuit-status${tone ? ` is-${tone}` : ''}`;
  }

  function formatNumber(value, unit = '') {
    if (!Number.isFinite(value)) return '—';
    const absolute = Math.abs(value);
    const number =
      absolute !== 0 && (absolute < 0.001 || absolute >= 10000)
        ? value.toExponential(3)
        : Number(value.toPrecision(5)).toString();
    return `${number}${unit ? ` ${unit}` : ''}`;
  }

  function metadata() {
    return { title: $('title').value.trim(), description: $('description').value.trim() };
  }

  function draftKey(cid = state.cid) {
    return `free_bbs_circuit_draft_v1:${cid || 'new'}`;
  }

  function persistDraft() {
    if (!state.editable || !state.dirty) return true;
    try {
      sessionStorage.setItem(
        draftKey(),
        JSON.stringify({
          ...metadata(),
          document: state.document,
          cid: state.cid,
          revision: state.revision,
          loadedExample: state.loadedExample,
          uid: app.userState.isLoggedIn ? app.userState.uid : '',
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  function removeDraft(cid = state.cid) {
    try {
      sessionStorage.removeItem(draftKey(cid));
    } catch {
      /* The current document remains usable. */
    }
  }

  function restoreDraft() {
    if (!state.editable) return false;
    try {
      const saved = JSON.parse(sessionStorage.getItem(draftKey()) || 'null');
      if (!saved) return false;
      const uid = app.userState.isLoggedIn ? app.userState.uid : '';
      if (saved.uid && saved.uid !== uid) {
        removeDraft();
        return false;
      }
      state.document = engine.validateDocument(saved.document);
      if (
        isExampleAdmin() &&
        Number.isSafeInteger(saved.loadedExample?.id) &&
        saved.loadedExample.id > 0 &&
        Number.isSafeInteger(saved.loadedExample.revision) &&
        saved.loadedExample.revision > 0
      )
        state.loadedExample = saved.loadedExample;
      if (state.cid && Number.isSafeInteger(saved.revision)) state.revision = saved.revision;
      $('title').value = String(saved.title || '未命名电路').slice(0, 120);
      $('description').value = String(saved.description || '').slice(0, 2000);
      state.dirty = true;
      persistDraft();
      setStatus('已恢复此标签页的未保存草稿。');
      return true;
    } catch {
      setStatus('上次草稿无法读取，已保留当前电路。', 'error');
      return false;
    }
  }

  function updateControls() {
    $('save').disabled = state.saving || !state.editable;
    $('publish').hidden = !state.cid;
    $('publish').disabled = state.dirty || state.saving;
    $('publish').title = state.dirty ? '请先保存当前修改，再发表到讨论区' : '';
    const saveLabel = state.cid ? `保存新版本${state.dirty ? ' · 有修改' : ''}` : '保存并获取 CID';
    $('save').textContent = state.saving ? '正在保存…' : saveLabel;
    $('title').readOnly = !state.editable;
    $('description').readOnly = !state.editable;
    $('login').hidden = Boolean(app?.userState?.isLoggedIn);
    $('run').disabled = Boolean(state.worker);
    $('stop').disabled = !state.worker;
    $('load-example').disabled = !state.editable;
    $('import-json').disabled = !state.editable;
    $('rotate').disabled = !state.editable || !state.selectedId;
    $('delete').disabled = !state.editable || (!state.selectedId && !state.selectedWire);
    $('reset-wire').hidden = !state.selectedWire;
    $('reset-wire').disabled = !state.editable;
    $('start-wire').hidden = !state.selectedWire || Boolean(state.wireStart);
    $('start-wire').disabled = !state.editable;
    $('palette')
      .querySelectorAll('button')
      .forEach((button) => {
        const control = button;
        control.disabled = !state.editable;
      });
    $('analysis-form')
      .querySelectorAll('input,select')
      .forEach((control) => {
        const field = control;
        field.disabled = !state.editable;
      });
    page.querySelectorAll('[data-circuit-reference]').forEach((button) => {
      const control = button;
      control.disabled = !state.cid;
      control.title = state.cid ? `引用已保存的第 ${state.revision} 版` : '请先保存电路，获取 CID';
    });
    let referenceHint = '请先保存电路，获取 CID 后即可复制引用。';
    if (!app.userState.isLoggedIn && !state.cid)
      referenceHint = '请先登录并保存电路，获取 CID 后即可复制引用。';
    if (state.cid) referenceHint = `引用指向已保存的第 ${state.revision} 版。`;
    if (state.cid && state.dirty)
      referenceHint += '当前有未保存修改；再次保存后，新的引用才会包含这些修改。';
    $('reference-hint').textContent = referenceHint;
    if (
      !state.cid ||
      !$('reference-text').value.includes(`cid=${state.cid}&revision=${state.revision}&`)
    ) {
      $('reference-text').value = '';
      $('reference-text').hidden = true;
    }
    const junctions = state.document.components.filter((item) => item.type === 'junction').length;
    $('count').textContent =
      `${state.document.components.length - junctions} 个元件${junctions ? ` · ${junctions} 个连接点` : ''} · ${state.document.wires.length} 条导线`;
    const identifier = state.cid ? `${state.cid} · 版本 ${state.revision}` : '尚未保存';
    const owner = state.owner?.username ? ` · ${state.owner.username}` : '';
    const mode = state.editable ? '保存后可通过 CID 公开访问' : '只读视图 · 可复制为新电路';
    $('document-meta').textContent = `${identifier}${owner} · ${mode}`;
    $('cancel-wire').hidden = !state.wireStart;
    let help = '从引脚拖到另一引脚或导线即可接通；也可依次点击连线。';
    if (state.wireStart)
      help = `${state.wireStart.wireId ? `从导线 ${state.wireStart.wireId}` : `从 ${state.wireStart.componentId} 的引脚 ${state.wireStart.pin + 1}`} 连线：点击目标引脚或导线，Esc 取消。`;
    if (!state.editable) help = '只读预览，可选中元件查看参数；复制后继续编辑。';
    $('canvas-help').textContent = help;
    updateExampleControls();
    renderSourceAdvice();
  }

  function stopPlayback() {
    state.playing = false;
    window.clearInterval(state.animation);
    state.animation = 0;
    $('play').textContent = '播放';
  }

  function stopSimulation(message = '') {
    if (state.worker) state.worker.terminate();
    window.clearTimeout(state.workerTimer);
    state.workerTimer = 0;
    state.worker = null;
    state.runId += 1;
    updateControls();
    if (message) setStatus(message, '', 'run-status');
  }

  function invalidateResult() {
    stopSimulation();
    stopPlayback();
    state.result = null;
    state.traceIds = [];
    $('results').hidden = true;
    setStatus('电路或分析参数已修改，请重新运行仿真。', '', 'run-status');
  }

  function changed({ electrical = true } = {}) {
    state.dirty = true;
    state.editVersion += 1;
    if (electrical) invalidateResult();
    updateControls();
    persistDraft();
  }

  function currentFrame() {
    if (!state.result?.frames?.length) return null;
    return state.result.frames.length === state.result.x.length
      ? state.result.frames[state.frame]
      : state.result.frames[0];
  }

  function renderSchematic() {
    state.schematic?.destroy?.();
    state.schematic = renderer.renderSchematic($('stage'), state.document, {
      interactive: state.editable,
      selectable: true,
      selectedId: state.selectedId || state.selectedWire,
      wireStart: state.wireStart,
      frame: currentFrame(),
      animate: state.playing && state.document.analysis.type === 'transient',
      onPinClick: connectPin,
      onComponentClick(id) {
        state.selectedId = id;
        state.selectedWire = '';
        renderInspector();
        renderSchematic();
      },
      onWireClick(id, position) {
        if (state.wireStart) {
          completeConnection(state.wireStart, { wireId: id, position });
          return;
        }
        const wasSelected = state.selectedWire === id;
        state.selectedId = '';
        state.selectedWire = id;
        state.wireAnchor = position;
        renderInspector();
        if (!wasSelected) renderSchematic();
      },
      onConnect(fromEndpoint, target) {
        completeConnection(fromEndpoint, target);
      },
      onWireChange(id, points) {
        if (!state.editable) return;
        const wire = state.document.wires.find((item) => item.id === id);
        if (!wire) return;
        wire.points = points.map((point) => ({ x: point.x, y: point.y }));
        state.selectedId = '';
        state.selectedWire = id;
        changed({ electrical: false });
        renderInspector();
        renderSchematic();
      },
      onMove(id, x, y) {
        if (!state.editable) return;
        const component = state.document.components.find((item) => item.id === id);
        if (!component) return;
        component.x = Math.round(x / 10) * 10;
        component.y = Math.round(y / 10) * 10;
        state.selectedId = id;
        changed({ electrical: false });
        renderInspector();
        renderSchematic();
      },
    });
  }

  function uniqueId(prefix) {
    const identifiers = new Set(
      [...state.document.components, ...state.document.wires].map((item) => item.id),
    );
    let number = 1;
    while (identifiers.has(`${prefix}${number}`)) number += 1;
    return `${prefix}${number}`;
  }

  function addComponent(type) {
    if (!state.editable || !engine.catalog[type]) return;
    if (state.document.components.length >= 80)
      return setStatus('每个电路最多 80 个元件。', 'error');
    const count = state.document.components.length;
    const component = {
      id: uniqueId(prefixes[type] || 'X'),
      type,
      x: 180 + (count % 5) * 150,
      y: 140 + (Math.floor(count / 5) % 4) * 120,
      rotation: 0,
      params: clone(engine.catalog[type].defaults),
    };
    if (['ccvs', 'cccs'].includes(type)) {
      component.params.control =
        state.document.components.find((item) => ['voltage', 'ammeter'].includes(item.type))?.id ||
        '';
    }
    state.document.components.push(component);
    state.selectedId = component.id;
    state.selectedWire = '';
    changed();
    renderInspector();
    renderSweepOptions();
    renderSchematic();
    setStatus(`已添加 ${engine.catalog[type].label} ${component.id}。`);
  }

  function connectPin(endpoint) {
    if (!state.editable) return;
    const target = { componentId: endpoint.componentId, pin: endpoint.pin };
    if (!state.wireStart) {
      state.wireStart = target;
    } else {
      completeConnection(state.wireStart, { endpoint: target });
      return;
    }
    updateControls();
    renderInspector();
    renderSchematic();
  }

  function completeConnection(origin, target) {
    if (!state.editable) return;
    try {
      if (origin.wireId && origin.wireId === target.wireId) {
        setStatus('已取消：起点和终点位于同一条导线。');
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
        }).document;
      } else {
        const to = target.endpoint;
        const samePin = (a, b) => a.componentId === b.componentId && a.pin === b.pin;
        if (samePin(from, to)) {
          setStatus('已取消连线。');
          return;
        }
        const duplicate = document.wires.some(
          (wire) =>
            (samePin(wire.from, from) && samePin(wire.to, to)) ||
            (samePin(wire.to, from) && samePin(wire.from, to)),
        );
        if (duplicate) {
          setStatus('这两个连接点已经接通。');
          return;
        }
        if (document.wires.length >= 200) throw new Error('每个电路最多 200 条导线。');
        document = clone(document);
        const ids = new Set([...document.components, ...document.wires].map((item) => item.id));
        let index = 1;
        while (ids.has(`w${index}`)) index += 1;
        document.wires.push({ id: `w${index}`, from, to });
      }
      state.document = document;
      state.selectedId = '';
      state.selectedWire = '';
      changed();
      setStatus('导线已接通；实心圆点表示电气连接。');
    } catch (error) {
      setStatus(error.message, 'error');
    } finally {
      state.wireStart = null;
      updateControls();
      renderInspector();
      renderSchematic();
    }
  }

  function startFromWire() {
    const wire = state.document.wires.find((item) => item.id === state.selectedWire);
    if (!wire || !state.editable) return;
    const route = renderer.getWireRoute(wire, state.document.components);
    const position = state.wireAnchor || route[Math.floor(route.length / 2)];
    state.wireStart = { wireId: wire.id, position };
    updateControls();
    renderInspector();
    renderSchematic();
  }

  function renderPalette() {
    $('palette').innerHTML = Object.entries(engine.catalog)
      .filter(([type]) => type !== 'junction')
      .map(
        ([type, item]) =>
          `<button type="button" data-add-component="${escapeHtml(type)}"><span class="circuit-palette-symbol" aria-hidden="true">${escapeHtml(prefixes[type])}</span>${escapeHtml(item.label)}</button>`,
      )
      .join('');
  }

  function parameterInput(component, key, value) {
    let options = null;
    if (key === 'waveform')
      options = [
        ['dc', '直流'],
        ['sine', '正弦'],
        ['pulse', '脉冲'],
      ];
    if (key === 'polarity')
      options =
        component.type === 'bjt'
          ? [
              ['npn', 'NPN'],
              ['pnp', 'PNP'],
            ]
          : [
              ['n', 'NMOS'],
              ['p', 'PMOS'],
            ];
    if (key === 'control')
      options = [
        ['', '选择电压源或电流表'],
        ...state.document.components
          .filter((item) => ['voltage', 'ammeter'].includes(item.type))
          .map((item) => [item.id, item.id]),
      ];
    const field = options
      ? `<select data-parameter="${key}" ${state.editable ? '' : 'disabled'}>${options.map(([option, label]) => `<option value="${escapeHtml(option)}" ${option === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select>`
      : `<input data-parameter="${key}" type="${typeof value === 'number' ? 'number' : 'text'}" ${typeof value === 'number' ? 'step="any"' : 'maxlength="256"'} value="${escapeHtml(value)}" ${state.editable ? '' : 'readonly'} />`;
    let label = parameterLabels[key] || key;
    if (['voltage', 'current'].includes(component.type)) {
      const unit = component.type === 'voltage' ? 'V' : 'A';
      if (key === 'dc')
        label = `${component.params.waveform === 'dc' ? '直流值' : '直流偏置'} / ${unit}`;
      if (key === 'amplitude')
        label = `${component.params.waveform === 'pulse' ? '脉冲增量' : '正弦峰值'} / ${unit}`;
      if (key === 'acAmplitude') label = `AC 小信号峰值 / ${unit}`;
    }
    return `<label>${escapeHtml(label)}${field}</label>`;
  }

  function wireLabel(wire) {
    const endpoint = (pin) => {
      const component = state.document.components.find((item) => item.id === pin.componentId);
      return `${pin.componentId} · ${engine.catalog[component?.type]?.pins[pin.pin] || pin.pin + 1}`;
    };
    return `${endpoint(wire.from)} ↔ ${endpoint(wire.to)}`;
  }

  function renderInspector() {
    const component = state.document.components.find((item) => item.id === state.selectedId);
    const selectedWire = state.document.wires.find((wire) => wire.id === state.selectedWire);
    $('selection').hidden = !component && !selectedWire;
    $('selection-empty').hidden = Boolean(component || selectedWire);
    if (!component && !selectedWire) return updateControls();
    $('selected-name').textContent = component
      ? `${component.id} · ${engine.catalog[component.type].label}`
      : `导线 ${selectedWire.id}`;
    $('parameters').innerHTML = component
      ? Object.entries(component.params)
          .filter(([key]) => {
            if (!['voltage', 'current'].includes(component.type)) return true;
            if (key === 'duty') return component.params.waveform === 'pulse';
            return (
              component.params.waveform !== 'dc' ||
              !['amplitude', 'frequency', 'delay'].includes(key)
            );
          })
          .map(([key, value]) => parameterInput(component, key, value))
          .join('')
      : '';
    if (component?.type === 'nonlinear')
      $('parameters').insertAdjacentHTML(
        'beforeend',
        '<p class="circuit-parameter-hint">使用 u、k、数学运算和函数，例如 i=k*u^3。参数变化后可再次扫描特性。</p>',
      );
    if (component && ['voltage', 'current'].includes(component.type)) {
      $('parameters').insertAdjacentHTML(
        'beforeend',
        '<p id="circuit-source-parameter-hint" class="circuit-parameter-hint"></p>',
      );
      renderSourceParameterHint(component);
    }
    if (selectedWire)
      $('parameters').innerHTML =
        '<p class="circuit-parameter-hint">点击“从此处连线”，再点击另一条导线或引脚即可接通。拖动圆点调整形状；点击 + 或双击添加拐点，选中后可删除。</p>';
    if (component?.type === 'junction')
      $('parameters').innerHTML =
        '<p class="circuit-parameter-hint">实心连接点将相连的导线电气接通。拖动圆点可移动连接点，轻点继续连线；删除圆点会移除它连接的导线。</p>';
    const wires = selectedWire
      ? [selectedWire]
      : state.document.wires.filter(
          (wire) => wire.from.componentId === component.id || wire.to.componentId === component.id,
        );
    $('connections').innerHTML = wires.length
      ? wires
          .map(
            (wire) =>
              `<div class="circuit-connection"><span>${escapeHtml(wireLabel(wire))}</span><button type="button" data-delete-wire="${escapeHtml(wire.id)}" ${state.editable ? '' : 'disabled'}>移除</button></div>`,
          )
          .join('')
      : '<p class="circuit-parameter-hint">尚未连接；点击画布上的引脚开始连线。</p>';
    $('delete').textContent = selectedWire ? '删除导线' : '删除元件';
    updateControls();
  }

  function removeSelection() {
    if (!state.editable) return;
    if (state.selectedId) {
      const id = state.selectedId;
      state.document.components = state.document.components.filter(
        (component) => component.id !== id,
      );
      state.document.wires = state.document.wires.filter(
        (wire) => wire.from.componentId !== id && wire.to.componentId !== id,
      );
    } else if (state.selectedWire)
      state.document.wires = state.document.wires.filter((wire) => wire.id !== state.selectedWire);
    else return;
    state.selectedId = '';
    state.selectedWire = '';
    state.wireStart = null;
    changed();
    renderInspector();
    renderSweepOptions();
    renderSchematic();
  }

  function updateParameter(event) {
    if (!state.editable) return;
    const key = event.target.dataset.parameter;
    const component = state.document.components.find((item) => item.id === state.selectedId);
    if (!key || !component) return;
    const value =
      typeof component.params[key] === 'number' ? Number(event.target.value) : event.target.value;
    if (typeof value === 'number' && (!event.target.value.trim() || !Number.isFinite(value))) {
      event.target.setCustomValidity('请填写有限数值。');
      setStatus('参数必须填写有限数值，支持 1e-6 等科学计数法。', 'error');
      return;
    }
    event.target.setCustomValidity('');
    component.params[key] = value;
    changed();
    if (key === 'waveform') {
      renderInspector();
      $('parameters').querySelector('[data-parameter="waveform"]')?.focus();
    } else renderSourceParameterHint(component);
    renderSweepOptions();
    renderSchematic();
    setStatus(`已更新 ${component.id} 的${parameterLabels[key] || key}。`);
  }

  function renderSourceParameterHint(component) {
    const hint = $('source-parameter-hint');
    if (!hint || !['voltage', 'current'].includes(component.type)) return;
    const p = component.params;
    const unit = component.type === 'voltage' ? 'V' : 'A';
    let text = '直流值用于 DC 工作点。';
    if (p.waveform === 'sine') {
      const amplitude = Math.abs(p.amplitude);
      text = `正弦输出 = 直流偏置 + 峰值 × sin(2π × 频率 × (t − 延迟) + 相位)。范围 ${formatNumber(p.dc - amplitude, unit)} 至 ${formatNumber(p.dc + amplitude, unit)}；不需要占空比。`;
    } else if (p.waveform === 'pulse') {
      text = `脉冲在 ${formatNumber(p.dc, unit)} 与 ${formatNumber(p.dc + p.amplitude, unit)} 之间切换；占空比表示高电平占一个周期的比例。`;
    }
    hint.textContent = `${text} 时间波形使用“瞬态响应”；“AC 小信号峰值”只用于交流小信号分析。相位单位为度。`;
  }

  function renderSourceAdvice() {
    const panel = $('source-advice');
    if (!panel) return;
    const button = $('source-transient');
    button.hidden = true;
    const { analysis } = state.document;
    $('sampling-count').textContent =
      analysis.type === 'transient'
        ? `预计 ${Math.ceil(analysis.stop / analysis.step - 1e-10) + 1} 个采样点（含初始点），瞬态最多 ${engine.limits.maxTransientPoints} 点。`
        : '';
    try {
      const advice = engine.sourceAnalysisAdvice(state.document);
      $('source-advice-text').textContent = advice.warnings.join(' ');
      if (
        advice.suggestedAnalysis &&
        JSON.stringify(advice.suggestedAnalysis) !== JSON.stringify(analysis)
      ) {
        const suggested = advice.suggestedAnalysis;
        button.hidden = false;
        button.disabled = !state.editable || Boolean(state.worker);
        button.textContent = `设置合适的瞬态采样：步长 ${formatNumber(suggested.step, 's')}，截止 ${formatNumber(suggested.stop, 's')}`;
        button.title = state.editable
          ? '应用后可运行仿真；保存后才会更新电路版本。'
          : '复制为新电路后可调整分析参数。';
      }
      panel.hidden = !advice.warnings.length && button.hidden;
    } catch (error) {
      panel.hidden = false;
      $('source-advice-text').textContent = error.message;
    }
  }

  function applySourceSampling() {
    if (!state.editable || state.worker) return;
    try {
      const { suggestedAnalysis } = engine.sourceAnalysisAdvice(state.document);
      if (!suggestedAnalysis) return;
      state.document.analysis = suggestedAnalysis;
      renderAnalysis();
      changed();
      renderSchematic();
      setStatus('已应用瞬态采样设置，点击“运行仿真”查看波形。', '', 'run-status');
    } catch (error) {
      setStatus(error.message, 'error', 'run-status');
    }
  }

  function renderSweepOptions() {
    const componentSelect = $('sweep-component');
    const previous = componentSelect.value || state.document.analysis.componentId;
    componentSelect.innerHTML = state.document.components
      .filter((component) =>
        Object.values(component.params).some((value) => typeof value === 'number'),
      )
      .map(
        (component) =>
          `<option value="${escapeHtml(component.id)}">${escapeHtml(component.id)} · ${escapeHtml(engine.catalog[component.type].label)}</option>`,
      )
      .join('');
    if ([...componentSelect.options].some((option) => option.value === previous))
      componentSelect.value = previous;
    const component = state.document.components.find((item) => item.id === componentSelect.value);
    const parameterSelect = $('sweep-parameter');
    const previousParameter = parameterSelect.value || state.document.analysis.parameter;
    parameterSelect.innerHTML = component
      ? Object.entries(component.params)
          .filter(([, value]) => typeof value === 'number')
          .map(
            ([key]) =>
              `<option value="${escapeHtml(key)}">${escapeHtml(parameterLabels[key] || key)}</option>`,
          )
          .join('')
      : '';
    if ([...parameterSelect.options].some((option) => option.value === previousParameter))
      parameterSelect.value = previousParameter;
  }

  function renderAnalysis() {
    const { analysis } = state.document;
    $('analysis-type').value = analysis.type;
    const fields = {
      transient: ['stop', 'step', 'initial'],
      sweep: ['start', 'stop', 'points'],
      ac: ['start', 'stop', 'points', 'scale'],
    };
    Object.entries(fields).forEach(([type, names]) =>
      names.forEach((name) => {
        if (type === analysis.type && analysis[name] !== undefined)
          $(`${type}-${name}`).value = analysis[name];
      }),
    );
    renderSweepOptions();
    if (analysis.type === 'sweep') {
      $('sweep-component').value = analysis.componentId || '';
      renderSweepOptions();
      $('sweep-parameter').value = analysis.parameter || '';
    }
    page.querySelectorAll('[data-analysis]').forEach((element) => {
      const fieldGroup = element;
      fieldGroup.hidden = fieldGroup.dataset.analysis !== analysis.type;
    });
    renderSourceAdvice();
  }

  function readAnalysis() {
    const type = $('analysis-type').value;
    const number = (name) => {
      const { value } = $(name);
      if (!value.trim() || !Number.isFinite(Number(value)))
        throw new Error('请填写有效的分析参数。');
      return Number(value);
    };
    if (type === 'transient')
      return {
        type,
        stop: number('transient-stop'),
        step: number('transient-step'),
        initial: $('transient-initial').value,
      };
    if (type === 'sweep')
      return {
        type,
        componentId: $('sweep-component').value,
        parameter: $('sweep-parameter').value,
        start: number('sweep-start'),
        stop: number('sweep-stop'),
        points: number('sweep-points'),
      };
    if (type === 'ac')
      return {
        type,
        start: number('ac-start'),
        stop: number('ac-stop'),
        points: number('ac-points'),
        scale: $('ac-scale').value,
      };
    return { type: 'dc' };
  }

  function applyAnalysis() {
    if (!state.editable) return;
    try {
      const analysis = readAnalysis();
      page.querySelectorAll('[data-analysis]').forEach((element) => {
        const fieldGroup = element;
        fieldGroup.hidden = fieldGroup.dataset.analysis !== analysis.type;
      });
      if (JSON.stringify(analysis) !== JSON.stringify(state.document.analysis)) {
        state.document.analysis = analysis;
        changed();
        renderSchematic();
      }
    } catch (error) {
      setStatus(error.message, 'error', 'run-status');
    }
  }

  function blankExample() {
    return {
      title: '未命名电路',
      description: '',
      document: { version: 1, components: [], wires: [], analysis: { type: 'dc' } },
    };
  }

  function isExampleAdmin() {
    return app.userState.isLoggedIn && app.userState.isAdmin;
  }

  function updateExampleControls() {
    const admin = isExampleAdmin();
    const selected = state.examples.find((item) => String(item.id) === $('example').value);
    const busy = state.exampleBusy || state.exampleLoading;
    $('example-admin').hidden = !admin;
    $('example').disabled = busy;
    $('load-example').disabled = !state.editable || busy;
    $('example-create').disabled = !admin || !state.editable || busy || state.saving;
    $('example-update').disabled =
      !admin ||
      !state.editable ||
      busy ||
      state.saving ||
      !selected ||
      selected.id !== state.loadedExample?.id;
    $('example-delete').disabled = !admin || !selected || busy;
    $('example-delete-yes').disabled = busy;
    $('example-delete-no').disabled = busy;
    $('example-delete-confirm').hidden = !admin || !state.deleteExample;
    $('example-target').textContent = state.loadedExample
      ? `编辑目标：${state.loadedExample.title} · 第 ${state.loadedExample.revision} 版`
      : '先载入要修改的示例。';
  }

  async function refreshExamples(preferred = $('example').value) {
    state.exampleRequest += 1;
    const request = state.exampleRequest;
    state.deleteExample = null;
    state.exampleLoading = true;
    updateExampleControls();
    try {
      const payload = await app.callApi('/circuit-examples', { method: 'GET' });
      if (request !== state.exampleRequest) return false;
      state.examples = payload.examples || [];
      $('example').replaceChildren(
        ...state.examples.map((item) => new window.Option(item.title, String(item.id))),
        new window.Option('空白电路', 'blank'),
      );
      $('example').value = state.examples.some((item) => String(item.id) === preferred)
        ? preferred
        : 'blank';
      $('retry-examples').hidden = true;
      return true;
    } catch (error) {
      if (request === state.exampleRequest) {
        setStatus(`示例读取失败：${error.message}`, 'error', 'example-status');
        $('retry-examples').hidden = false;
      }
      return false;
    } finally {
      if (request === state.exampleRequest) {
        state.exampleLoading = false;
        updateExampleControls();
      }
    }
  }

  function confirmDraftReplacement(action) {
    if (!state.dirty) return true;
    // eslint-disable-next-line no-alert
    return window.confirm(`${action}会替换当前草稿，是否继续？`);
  }

  async function loadExample({ initial = false } = {}) {
    if (!state.editable || state.exampleBusy || (!initial && !confirmDraftReplacement('载入示例')))
      return;
    const id = $('example').value;
    state.exampleLoadRequest += 1;
    const request = state.exampleLoadRequest;
    const { editVersion, generation } = state;
    state.exampleLoading = true;
    state.deleteExample = null;
    updateExampleControls();
    try {
      const sample =
        id === 'blank'
          ? blankExample()
          : (await app.callApi(`/circuit-examples/${encodeURIComponent(id)}`, { method: 'GET' }))
              .example;
      if (request !== state.exampleLoadRequest || generation !== state.generation) return;
      if (editVersion !== state.editVersion) {
        setStatus('读取期间草稿已修改，请再次载入示例。', 'error', 'example-status');
        return;
      }
      state.document = engine.validateDocument(sample.document);
      $('title').value = sample.title;
      $('description').value = sample.description;
      state.loadedExample = sample.id
        ? { id: sample.id, revision: sample.revision, title: sample.title }
        : null;
      if (sample.id) {
        state.examples = state.examples.map((item) =>
          item.id === sample.id
            ? {
                id: sample.id,
                revision: sample.revision,
                title: sample.title,
                description: sample.description,
              }
            : item,
        );
        const option = Array.from($('example').options).find(
          (item) => item.value === String(sample.id),
        );
        if (option) option.textContent = sample.title;
      }
      state.selectedId = '';
      state.selectedWire = '';
      state.wireStart = null;
      if (!initial) changed();
      else invalidateResult();
      renderAnalysis();
      renderInspector();
      renderSchematic();
      updateControls();
      setStatus(initial ? '' : '示例已载入，可修改后另存为自己的电路。', '', 'example-status');
      if (initial) setStatus('选择分析方式，然后运行仿真。', '', 'run-status');
    } catch (error) {
      if (request === state.exampleLoadRequest && generation === state.generation)
        setStatus(`示例载入失败：${error.message}`, 'error', 'example-status');
    } finally {
      if (request === state.exampleLoadRequest) {
        state.exampleLoading = false;
        updateExampleControls();
      }
    }
  }

  async function saveExample(updating) {
    if (!isExampleAdmin() || !state.editable || state.exampleBusy || state.exampleLoading) return;
    if (!$('parameters').reportValidity()) return;
    const target = updating ? state.loadedExample : null;
    if (updating && (!target || String(target.id) !== $('example').value)) return;
    const { generation } = state;
    let data;
    try {
      const analysis = readAnalysis();
      if (JSON.stringify(analysis) !== JSON.stringify(state.document.analysis)) {
        state.document.analysis = analysis;
        changed();
      }
      data = { ...metadata(), document: engine.validateDocument(state.document) };
      if (!data.title) throw new Error('请填写电路名称，作为示例名称。');
    } catch (error) {
      setStatus(error.message, 'error', 'example-status');
      return;
    }
    state.exampleBusy = true;
    state.deleteExample = null;
    updateExampleControls();
    setStatus(updating ? '正在保存示例修改…' : '正在添加示例…', '', 'example-status');
    try {
      const payload = await app.callApi(
        target ? `/circuit-examples/${target.id}` : '/circuit-examples',
        {
          method: target ? 'PUT' : 'POST',
          body: JSON.stringify({
            ...data,
            ...(target ? { expectedRevision: target.revision } : {}),
          }),
        },
      );
      if (generation !== state.generation) return;
      state.loadedExample = {
        id: payload.example.id,
        revision: payload.example.revision,
        title: payload.example.title,
      };
      persistDraft();
      const refreshed = await refreshExamples(String(payload.example.id));
      if (generation !== state.generation) return;
      if (refreshed)
        setStatus(
          `示例「${payload.example.title}」已${updating ? '更新' : '添加'}。`,
          'success',
          'example-status',
        );
      else
        setStatus('示例已保存，但列表刷新失败。请点击“重新读取示例”。', 'error', 'example-status');
    } catch (error) {
      if (generation !== state.generation) return;
      setStatus(
        error.status === 409
          ? '示例已被其他管理员更新。当前电路草稿已保留，请重新载入示例比较，或添加为新示例。'
          : `示例保存失败：${error.message}`,
        'error',
        'example-status',
      );
    } finally {
      if (generation === state.generation) {
        state.exampleBusy = false;
        updateExampleControls();
      }
    }
  }

  function confirmExampleDeletion() {
    const selected = state.examples.find((item) => String(item.id) === $('example').value);
    if (!isExampleAdmin() || !selected || state.exampleBusy || state.exampleLoading) return;
    state.deleteExample = { ...selected };
    $('example-delete-message').textContent =
      `删除示例「${selected.title}」？同学已经另存的电路与引用会保留。`;
    updateExampleControls();
  }

  async function deleteExample() {
    const target = state.deleteExample;
    if (!isExampleAdmin() || !target || state.exampleBusy) return;
    const { generation } = state;
    state.exampleBusy = true;
    updateExampleControls();
    try {
      await app.callApi(`/circuit-examples/${target.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ expectedRevision: target.revision }),
      });
      if (generation !== state.generation) return;
      state.deleteExample = null;
      if (state.loadedExample?.id === target.id) state.loadedExample = null;
      persistDraft();
      const refreshed = await refreshExamples('blank');
      if (generation === state.generation && refreshed)
        setStatus('示例已删除，画布中的电路仍然保留。', 'success', 'example-status');
      else if (generation === state.generation)
        setStatus('示例已删除，但列表刷新失败。请点击“重新读取示例”。', 'error', 'example-status');
    } catch (error) {
      if (generation === state.generation)
        setStatus(
          error.status === 409 ? '示例已更新，请重新读取后再删除。' : `删除失败：${error.message}`,
          'error',
          'example-status',
        );
      if (generation === state.generation && error.status === 409)
        $('retry-examples').hidden = false;
    } finally {
      if (generation === state.generation) {
        state.exampleBusy = false;
        updateExampleControls();
      }
    }
  }

  function publishToDiscussion() {
    if (!state.cid || state.dirty || state.saving) return;
    const query = new URLSearchParams({
      board: 'circuit',
      compose: 'circuit',
      cid: state.cid,
      revision: String(state.revision),
    });
    window.location.assign(`/discussion?${query}`);
  }

  function renderWaveform() {
    if (!state.result) return;
    if (!state.traceIds.length) {
      $('waveform').textContent = '选择至少一条曲线查看结果。';
      return;
    }
    renderer.renderWaveform($('waveform'), state.result, {
      traceIds: state.traceIds,
      phase: $('show-phase').checked,
      logX: state.document.analysis.type === 'ac' && state.document.analysis.scale === 'log',
    });
  }

  function renderMeters() {
    if (!state.result) return;
    const meterIds = state.document.components
      .filter((item) => ['voltmeter', 'ammeter', 'oscilloscope'].includes(item.type))
      .map((item) => `${item.type === 'ammeter' ? 'I' : 'V'}:${item.id}`);
    const selected = [...new Set([...meterIds, ...state.traceIds])];
    $('meters').innerHTML = selected
      .map((id) => state.result.traces.find((trace) => trace.id === id))
      .filter(Boolean)
      .map(
        (trace) =>
          `<div class="circuit-meter"><p>${escapeHtml(trace.label)}${state.document.analysis.type === 'ac' ? ' · 幅值' : ''}</p><strong>${escapeHtml(formatNumber(trace.values[state.frame], trace.unit))}</strong></div>`,
      )
      .join('');
  }

  function setFrame(index) {
    if (!state.result) return;
    state.frame = Math.max(0, Math.min(state.result.x.length - 1, Number(index) || 0));
    $('frame').value = state.frame;
    $('frame-label').textContent = formatNumber(state.result.x[state.frame], state.result.xUnit);
    state.schematic?.updateFrame?.(currentFrame());
    renderMeters();
  }

  function showResult(result) {
    state.result = result;
    const instruments = state.document.components
      .filter((item) => ['voltmeter', 'ammeter', 'oscilloscope'].includes(item.type))
      .map((item) => `${item.type === 'ammeter' ? 'I' : 'V'}:${item.id}`);
    state.traceIds = instruments.filter((id) => result.traces.some((trace) => trace.id === id));
    if (!state.traceIds.length)
      state.traceIds = result.traces
        .filter((trace) => trace.id.startsWith('V:'))
        .slice(0, 3)
        .map((trace) => trace.id);
    $('traces').innerHTML = result.traces
      .map(
        (trace) =>
          `<label class="circuit-inline-check"><input type="checkbox" data-trace="${escapeHtml(trace.id)}" ${state.traceIds.includes(trace.id) ? 'checked' : ''} />${escapeHtml(trace.label)} / ${escapeHtml(trace.unit)}</label>`,
      )
      .join('');
    $('results').hidden = false;
    $('phase-control').hidden = state.document.analysis.type !== 'ac';
    $('show-phase').checked = false;
    $('frame').max = Math.max(0, result.x.length - 1);
    $('play').disabled = state.document.analysis.type !== 'transient' || result.frames.length <= 1;
    $('playback').hidden = result.x.length <= 1;
    $('warnings').textContent = (result.warnings || []).join('；');
    renderWaveform();
    renderSchematic();
    setFrame(0);
    setStatus(
      `仿真完成 · ${result.x.length} 个采样点 · ${result.traces.length} 条测量曲线`,
      'success',
      'run-status',
    );
  }

  function runSimulation() {
    if (state.worker) return;
    if (!$('parameters').reportValidity()) return;
    try {
      if (state.editable) {
        const analysis = readAnalysis();
        if (JSON.stringify(analysis) !== JSON.stringify(state.document.analysis)) {
          state.document.analysis = analysis;
          changed();
        }
      }
      const doc = engine.validateDocument(state.document);
      stopPlayback();
      state.result = null;
      $('results').hidden = true;
      const worker = new Worker('/circuit-worker.js');
      state.worker = worker;
      state.runId += 1;
      const id = state.runId;
      updateControls();
      setStatus('正在求解电路…', '', 'run-status');
      worker.onmessage = (event) => {
        if (id !== state.runId || event.data.id !== id) return;
        window.clearTimeout(state.workerTimer);
        state.workerTimer = 0;
        worker.terminate();
        state.worker = null;
        updateControls();
        if (event.data.error) {
          renderSchematic();
          setStatus(event.data.error, 'error', 'run-status');
        } else {
          try {
            showResult(event.data.result);
          } catch (error) {
            setStatus(`结果显示失败：${error.message}`, 'error', 'run-status');
          }
        }
      };
      worker.onerror = () => {
        if (id !== state.runId) return;
        stopSimulation();
        setStatus('仿真线程启动或运行失败，请刷新后重试。', 'error', 'run-status');
      };
      state.workerTimer = window.setTimeout(() => {
        if (id !== state.runId) return;
        stopSimulation();
        setStatus(
          '求解超过 20 秒，已停止仿真。请减少采样点、检查参数或简化电路后重试。',
          'error',
          'run-status',
        );
      }, 20000);
      worker.postMessage({ id, document: doc, options: doc.analysis });
    } catch (error) {
      stopSimulation();
      setStatus(error.message || '无法运行仿真。', 'error', 'run-status');
    }
  }

  async function saveCircuit() {
    if (state.saving || !state.editable) return;
    if (!$('parameters').reportValidity()) return;
    if (!app.userState.isLoggedIn) {
      state.dirty = true;
      persistDraft();
      setStatus('请先登录后保存。当前标签页草稿已保留，登录后返回此页继续。', 'error');
      $('login').hidden = false;
      return;
    }
    const { title, description } = metadata();
    if (!title) return setStatus('请填写电路名称。', 'error');
    let doc;
    try {
      const analysis = readAnalysis();
      if (JSON.stringify(analysis) !== JSON.stringify(state.document.analysis)) {
        state.document.analysis = analysis;
        changed();
      }
      doc = engine.validateDocument(state.document);
    } catch (error) {
      setStatus(error.message, 'error');
      return;
    }
    state.saving = true;
    const { generation } = state;
    const oldCid = state.cid;
    const { editVersion } = state;
    updateControls();
    setStatus('正在保存公开版本…');
    try {
      const payload = await app.callApi(
        state.cid ? `/circuits/${encodeURIComponent(state.cid)}` : '/circuits',
        {
          method: state.cid ? 'PUT' : 'POST',
          body: JSON.stringify({
            title,
            description,
            document: doc,
            ...(state.cid ? { expectedRevision: state.revision } : {}),
          }),
        },
      );
      if (generation !== state.generation) return;
      const { circuit } = payload;
      state.cid = circuit.cid;
      state.revision = circuit.revision;
      state.latestRevision = circuit.latestRevision || circuit.revision;
      state.owner = circuit.owner;
      state.editable = circuit.canEdit !== false;
      state.dirty = editVersion !== state.editVersion;
      if (!state.dirty) state.document = circuit.document || doc;
      removeDraft(oldCid);
      if (state.dirty) persistDraft();
      else removeDraft();
      window.history.replaceState(null, '', `/circuit?cid=${encodeURIComponent(state.cid)}`);
      setStatus(
        `已保存公开版本 ${state.revision}${state.dirty ? '；保存期间的新修改仍在草稿中' : '，可复制 Markdown 引用'}。`,
        'success',
      );
    } catch (error) {
      if (generation !== state.generation) return;
      state.dirty = true;
      persistDraft();
      if (error.status === 409)
        setStatus(
          '服务器已有更新版本，当前草稿已保留。请先导出 JSON 或复制为新电路，再重新打开最新版本比较修改。',
          'error',
        );
      else setStatus(`${error.message || '保存失败'}，当前草稿已保留。`, 'error');
    } finally {
      if (generation === state.generation) {
        state.saving = false;
        updateControls();
      }
    }
  }

  function copyCircuit() {
    stopSimulation();
    state.generation += 1;
    state.saving = false;
    state.cid = '';
    state.revision = 0;
    state.latestRevision = 0;
    state.owner = null;
    state.loadedExample = null;
    state.editable = true;
    $('title').value = `${$('title').value.replace(/ · 副本$/, '')} · 副本`.slice(0, 120);
    window.history.replaceState(null, '', '/circuit');
    changed({ electrical: false });
    renderAnalysis();
    renderInspector();
    renderSchematic();
    setStatus('已复制为新的本地草稿，保存后获得新的 CID。');
  }

  async function copyReference(view) {
    if (!state.cid) return setStatus('请先保存电路，获取 CID 后再复制引用。', 'error');
    const copiedRevision = state.revision;
    const unsavedHint = state.dirty ? '未保存的修改尚未包含在引用中。' : '';
    const label = { live: '电路动态图', waveform: '电路波形', schematic: '电路原理图' }[view];
    const query = new URLSearchParams({ cid: state.cid, revision: String(state.revision), view });
    const markdown = `[${label}](/circuit?${query.toString()})`;
    $('reference-text').value = markdown;
    $('reference-text').hidden = false;
    try {
      await navigator.clipboard.writeText(markdown);
      setStatus(
        `${label}引用已复制，指向已保存的第 ${copiedRevision} 版。${unsavedHint}`,
        'success',
      );
    } catch {
      $('reference-text').focus();
      $('reference-text').select();
      setStatus(`请复制下方已选中的第 ${copiedRevision} 版 Markdown 引用。${unsavedHint}`);
    }
  }

  function download(contents, type, extension) {
    const url = URL.createObjectURL(new Blob([contents], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${state.cid || 'circuit'}.${extension}`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportCsv() {
    if (!state.result) return;
    const { result } = state;
    const columns = [{ label: `${result.xLabel} (${result.xUnit || ''})`, values: result.x }];
    result.traces.forEach((trace) => {
      columns.push({ label: `${trace.label} (${trace.unit})`, values: trace.values });
      if (trace.phase) columns.push({ label: `${trace.label} 相位 (°)`, values: trace.phase });
    });
    const quote = (value) => `"${String(value).replace(/"/g, '""')}"`;
    const rows = [columns.map((column) => quote(column.label)).join(',')];
    result.x.forEach((_, index) =>
      rows.push(columns.map((column) => column.values[index]).join(',')),
    );
    download(`\uFEFF${rows.join('\r\n')}`, 'text/csv;charset=utf-8', 'csv');
  }

  async function importJson(file) {
    if (!file || !state.editable) return;
    if (file.size > 1024 * 1024) return setStatus('JSON 文件不能超过 1 MB。', 'error');
    if (!confirmDraftReplacement('导入文件')) return;
    const { generation } = state;
    try {
      const parsed = JSON.parse(await file.text());
      if (generation !== state.generation || !state.editable) return;
      state.document = engine.validateDocument(parsed.document || parsed);
      if (typeof parsed.title === 'string') $('title').value = parsed.title.slice(0, 120);
      if (typeof parsed.description === 'string')
        $('description').value = parsed.description.slice(0, 2000);
      state.selectedId = '';
      state.selectedWire = '';
      state.wireStart = null;
      changed();
      renderAnalysis();
      renderInspector();
      renderSchematic();
      setStatus('电路已导入，保存后发布为新版本。');
    } catch (error) {
      setStatus(`导入失败：${error.message}`, 'error');
    }
  }

  async function loadCircuit(cid, revision = '') {
    state.generation += 1;
    const { generation } = state;
    state.editable = false;
    state.loadedExample = null;
    updateControls();
    setStatus('正在载入电路…');
    try {
      const payload = await app.callApi(
        `/circuits/${encodeURIComponent(cid)}${revision ? `?revision=${encodeURIComponent(revision)}` : ''}`,
        { method: 'GET' },
      );
      if (generation !== state.generation) return;
      const { circuit } = payload;
      state.document = engine.validateDocument(circuit.document);
      state.cid = circuit.cid;
      state.revision = circuit.revision;
      state.latestRevision = circuit.latestRevision || circuit.revision;
      state.owner = circuit.owner;
      state.editable = Boolean(circuit.canEdit) && state.revision === state.latestRevision;
      state.dirty = false;
      state.selectedId = '';
      state.selectedWire = '';
      state.wireStart = null;
      $('title').value = circuit.title;
      $('description').value = circuit.description || '';
      const viewStatus =
        state.revision < state.latestRevision
          ? '正在查看已固定的历史版本，可复制为新电路继续实验。'
          : '此电路为只读视图，可运行仿真或复制为新电路。';
      setStatus(state.editable ? '' : viewStatus);
      if (!revision) restoreDraft();
      renderAnalysis();
      renderInspector();
      renderSchematic();
      updateControls();
    } catch (error) {
      if (generation === state.generation) setStatus(error.message || '读取电路失败。', 'error');
    }
  }

  async function loadList({ reset = false } = {}) {
    if (state.listLoading) return;
    if (!app.userState.isLoggedIn) {
      $('list').innerHTML =
        '<div class="circuit-empty">登录后查看自己的电路。<br /><a href="/login">前往登录</a>，也可以先<a href="/circuit">新建本地电路</a>。</div>';
      $('list-more').hidden = true;
      return;
    }
    if (reset) {
      state.listOffset = 0;
      $('list').replaceChildren();
    }
    const { generation } = state;
    state.listLoading = true;
    $('list-more').disabled = true;
    setStatus('正在载入电路…', '', 'list-status');
    try {
      const payload = await app.callApi(`/circuits?mine=1&limit=12&offset=${state.listOffset}`, {
        method: 'GET',
      });
      if (generation !== state.generation) return;
      const circuits = payload.circuits || [];
      $('list').insertAdjacentHTML(
        'beforeend',
        circuits
          .map(
            (circuit) =>
              `<article class="circuit-list-card"><a href="/circuit?cid=${encodeURIComponent(circuit.cid)}">${escapeHtml(circuit.title)}</a><p>${escapeHtml(circuit.description || '暂无实验说明')}</p><small>版本 ${Number(circuit.revision)} · ${escapeHtml(new Date(circuit.updatedAt).toLocaleDateString('zh-CN'))}</small></article>`,
          )
          .join(''),
      );
      state.listOffset += circuits.length;
      if (!state.listOffset)
        $('list').innerHTML =
          '<div class="circuit-empty">还没有保存的电路。从一个分压实验开始吧。</div>';
      $('list-more').hidden = !payload.hasMore;
      setStatus('', '', 'list-status');
    } catch (error) {
      if (generation === state.generation)
        setStatus(error.message || '电路列表加载失败。', 'error', 'list-status');
    } finally {
      if (generation === state.generation) {
        state.listLoading = false;
        $('list-more').disabled = false;
      }
    }
  }

  function bindEvents() {
    $('palette').addEventListener('click', (event) => {
      const button = event.target.closest('[data-add-component]');
      if (button) addComponent(button.dataset.addComponent);
    });
    ['title', 'description'].forEach((id) =>
      $(id).addEventListener('input', () => {
        if (state.editable) changed({ electrical: false });
      }),
    );
    $('parameters').addEventListener('input', updateParameter);
    $('parameters').addEventListener('change', (event) => {
      if (event.target.tagName === 'SELECT') updateParameter(event);
    });
    $('parameters').addEventListener('submit', (event) => event.preventDefault());
    $('connections').addEventListener('click', (event) => {
      const button = event.target.closest('[data-delete-wire]');
      if (!button || !state.editable) return;
      state.document.wires = state.document.wires.filter(
        (wire) => wire.id !== button.dataset.deleteWire,
      );
      state.selectedWire = '';
      changed();
      renderInspector();
      renderSchematic();
    });
    $('rotate').addEventListener('click', () => {
      const selected = state.document.components.find((item) => item.id === state.selectedId);
      if (!selected || !state.editable) return;
      selected.rotation = (selected.rotation + 90) % 360;
      changed({ electrical: false });
      renderSchematic();
    });
    $('delete').addEventListener('click', removeSelection);
    $('cancel-wire').addEventListener('click', () => {
      state.wireStart = null;
      $('canvas-help').textContent = '拖动元件调整位置；依次点击两个引脚连线。';
      updateControls();
      renderSchematic();
    });
    $('load-example').addEventListener('click', loadExample);
    $('start-wire').addEventListener('click', startFromWire);
    $('reset-wire').addEventListener('click', () => {
      if (!state.editable) return;
      const wire = state.document.wires.find((item) => item.id === state.selectedWire);
      if (!wire) return;
      delete wire.points;
      changed({ electrical: false });
      renderSchematic();
    });
    $('retry-examples').addEventListener('click', () => refreshExamples());
    $('example').addEventListener('change', () => {
      state.deleteExample = null;
      updateExampleControls();
    });
    $('example-create').addEventListener('click', () => saveExample(false));
    $('example-update').addEventListener('click', () => saveExample(true));
    $('example-delete').addEventListener('click', confirmExampleDeletion);
    $('example-delete-yes').addEventListener('click', deleteExample);
    $('example-delete-no').addEventListener('click', () => {
      state.deleteExample = null;
      updateExampleControls();
    });
    $('publish').addEventListener('click', publishToDiscussion);
    $('analysis-form').addEventListener('submit', (event) => event.preventDefault());
    $('analysis-form').addEventListener('change', (event) => {
      if (event.target === $('sweep-component')) renderSweepOptions();
      applyAnalysis();
    });
    $('run').addEventListener('click', runSimulation);
    $('source-transient').addEventListener('click', applySourceSampling);
    $('stop').addEventListener('click', () => stopSimulation('仿真已取消。'));
    $('save').addEventListener('click', saveCircuit);
    $('copy').addEventListener('click', copyCircuit);
    $('traces').addEventListener('change', () => {
      state.traceIds = [...$('traces').querySelectorAll('input:checked')].map(
        (input) => input.dataset.trace,
      );
      renderWaveform();
      renderMeters();
    });
    $('show-phase').addEventListener('change', renderWaveform);
    $('frame').addEventListener('input', (event) => {
      stopPlayback();
      renderSchematic();
      setFrame(event.target.value);
    });
    $('play').addEventListener('click', () => {
      if (!state.result) return;
      if (state.playing) {
        stopPlayback();
        renderSchematic();
        return;
      }
      state.playing = true;
      const frameStep = Math.max(
        1,
        Math.floor(
          engine.playbackFrameStep(state.document, state.result, {
            duration: 10000,
            frameInterval: 50,
          }),
        ),
      );
      $('play').textContent =
        frameStep < Math.max(1, Math.floor(state.result.x.length / 200)) ? '暂停 · 慢放' : '暂停';
      renderSchematic();
      state.animation = window.setInterval(() => {
        if (state.result) setFrame((state.frame + frameStep) % state.result.x.length);
      }, 50);
    });
    page
      .querySelectorAll('[data-circuit-reference]')
      .forEach((button) =>
        button.addEventListener('click', () => copyReference(button.dataset.circuitReference)),
      );
    $('export-json').addEventListener('click', () =>
      download(
        JSON.stringify({ ...metadata(), document: state.document }, null, 2),
        'application/json',
        'json',
      ),
    );
    $('export-csv').addEventListener('click', exportCsv);
    $('import-json').addEventListener('click', () => $('import-file').click());
    $('import-file').addEventListener('change', (event) => {
      const input = event.target;
      importJson(input.files?.[0]);
      input.value = '';
    });
    $('list-more').addEventListener('click', () => loadList());
    document.addEventListener('keydown', (event) => {
      if (listPage || event.defaultPrevented) return;
      if (event.target.closest('[data-wire-controls]')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveCircuit();
      }
      if (event.target.closest('input,textarea,select,[contenteditable]')) return;
      if (event.key === 'Escape') {
        state.wireStart = null;
        updateControls();
        renderSchematic();
      }
      if (['Delete', 'Backspace'].includes(event.key) && (state.selectedId || state.selectedWire)) {
        event.preventDefault();
        removeSelection();
      }
    });
    window.addEventListener('beforeunload', (event) => {
      if (state.saving || (state.dirty && !persistDraft())) event.preventDefault();
    });
    window.addEventListener('pagehide', () => {
      window.clearTimeout(state.resizeTimer);
      stopPlayback();
      stopSimulation();
      state.schematic?.destroy?.();
    });
    window.addEventListener('pageshow', (event) => {
      if (event.persisted && !listPage) renderSchematic();
    });
    window.addEventListener('resize', () => {
      window.clearTimeout(state.resizeTimer);
      state.resizeTimer = window.setTimeout(() => {
        if (state.result) renderWaveform();
      }, 120);
    });
    window.addEventListener('freebbs:session-change', () => {
      const uid = app.userState.isLoggedIn ? app.userState.uid : '';
      if (uid === state.sessionUid) {
        updateControls();
        return;
      }
      const previous = state.sessionUid;
      state.sessionUid = uid;
      state.generation += 1;
      state.listLoading = false;
      state.saving = false;
      state.exampleBusy = false;
      state.loadedExample = null;
      state.deleteExample = null;
      state.exampleLoadRequest += 1;
      state.exampleLoading = false;
      if (listPage) {
        loadList({ reset: true });
        return;
      }
      if (previous) {
        removeDraft();
        invalidateResult();
        state.dirty = false;
        if (state.cid) loadCircuit(state.cid);
        else {
          state.document = blankExample().document;
          $('title').value = '未命名电路';
          $('description').value = '';
          state.selectedId = '';
          renderAnalysis();
          renderInspector();
          renderSchematic();
        }
      } else if (state.cid) loadCircuit(state.cid);
      else persistDraft();
      updateControls();
      refreshExamples();
    });
  }

  async function initialize() {
    $('list-page').hidden = !listPage;
    $('editor-page').hidden = listPage;
    if (!app || !engine || !renderer) {
      setStatus('电路模块未加载，请刷新后重试。', 'error', listPage ? 'list-status' : 'status');
      return;
    }
    await app.sessionReady;
    state.sessionUid = app.userState.isLoggedIn ? app.userState.uid : '';
    bindEvents();
    if (listPage) {
      document.title = 'FREE-BBS - 我的电路';
      await loadList({ reset: true });
      return;
    }
    renderPalette();
    const examplesReady = refreshExamples();
    const cid = params.get('cid');
    const revision = params.get('revision');
    if (cid) {
      if (!/^c_[a-f0-9]{24}$/.test(cid) || (revision && !/^[1-9]\d*$/.test(revision))) {
        state.editable = false;
        updateControls();
        setStatus('电路 CID 或版本号无效。', 'error');
        return;
      }
      await loadCircuit(cid, revision || '');
    } else {
      const sample = blankExample();
      state.document = sample.document;
      $('title').value = sample.title;
      $('description').value = sample.description;
      const restored = restoreDraft();
      renderAnalysis();
      renderInspector();
      renderSchematic();
      updateControls();
      await examplesReady;
      if (!restored && !state.dirty && state.examples.length) {
        $('example').value = String(state.examples[0].id);
        await loadExample({ initial: true });
      } else if (state.loadedExample) {
        $('example').value = String(state.loadedExample.id);
        updateExampleControls();
      }
    }
  }

  initialize();
})();
