(() => {
  const page = document.querySelector('[data-circuit-page]');
  if (!page) return;
  const app = window.freeBbsApp;
  const engine = window.FreeBbsCircuitEngine;
  const renderer = window.FreeBbsCircuitRenderer;
  const wiring = window.FreeBbsCircuitWiring;
  const plot = window.FreeBbsCircuitPlot;
  const annotationModel = window.FreeBbsCircuitAnnotations;
  const params = new URLSearchParams(window.location.search);
  const listPage = window.location.pathname.replace(/\/$/, '') === '/circuits';
  const $ = (id) => document.getElementById(`circuit-${id}`);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const prefixes = {
    ground: 'G',
    vcc: 'VCC',
    vdd: 'VDD',
    vss: 'VSS',
    vee: 'VEE',
    fixed_voltage: 'LV',
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
    oscilloscope2: 'DS',
    twoport: 'TP',
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
    parameterSet: '矩阵类型',
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
    wirePoints: [],
    aiUndo: null,
    agentRun: null,
    agentRunCounter: 0,
    aiHighlightedComponents: [],
    aiHighlightedTraces: [],
    aiPendingTraces: null,
    schematic: null,
    result: null,
    plotResult: null,
    plotDisplay: null,
    plotModified: false,
    plotControls: null,
    annotationControls: null,
    annotationPicking: false,
    chart: null,
    traceIds: [],
    frame: 0,
    playing: false,
    animation: 0,
    worker: null,
    workerTimer: 0,
    simulationJob: null,
    simulationError: null,
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
    history: null,
    shortcuts: null,
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
    if ($('recognize')) $('recognize').disabled = getRecognitionContext().busy;
    if ($('beautify'))
      $('beautify').disabled =
        !state.editable ||
        state.saving ||
        Boolean(state.agentRun) ||
        Boolean(state.worker) ||
        Boolean(state.wireStart) ||
        state.exampleBusy ||
        state.exampleLoading ||
        !state.document.components.length;
    if ($('recognition-restore')) {
      $('recognition-restore').hidden = !getRecognitionContext().hasBackup;
      $('recognition-restore').disabled = getRecognitionContext().busy;
    }
    $('save').disabled = state.saving || !state.editable;
    $('publish').hidden = !state.cid;
    $('publish').disabled = state.dirty || state.plotModified || state.saving;
    $('publish').title =
      state.dirty || state.plotModified ? '请先保存当前修改，再发表到讨论区' : '';
    const saveLabel = state.cid ? '保存新版本' : '保存电路';
    const saveText = $('save').querySelector?.('[data-action-label]') || $('save');
    saveText.textContent = state.saving ? '正在保存…' : saveLabel;
    $('title').readOnly = !state.editable;
    $('description').readOnly = !state.editable;
    $('login').hidden = Boolean(app?.userState?.isLoggedIn);
    $('run').disabled = Boolean(state.worker);
    $('stop').disabled = !state.worker;
    $('load-example').disabled = !state.editable;
    $('import-json').disabled = !state.editable;
    $('rotate').disabled = !state.editable || !state.selectedId;
    $('mirror-x').disabled = !state.editable || !state.selectedId;
    $('mirror-y').disabled = !state.editable || !state.selectedId;
    const selection = state.document.components.find(
      (component) => component.id === state.selectedId,
    );
    const sideways = selection && selection.rotation % 180 !== 0;
    $('mirror-x').setAttribute(
      'aria-pressed',
      String(Boolean(selection?.[sideways ? 'mirrorY' : 'mirrorX'])),
    );
    $('mirror-y').setAttribute(
      'aria-pressed',
      String(Boolean(selection?.[sideways ? 'mirrorX' : 'mirrorY'])),
    );
    $('delete').disabled = !state.editable || (!state.selectedId && !state.selectedWire);
    if ($('duplicate'))
      $('duplicate').disabled = !state.editable || state.saving || !state.selectedId;
    if ($('undo'))
      $('undo').disabled =
        !state.editable ||
        state.saving ||
        Boolean(state.agentRun) ||
        (!state.wireStart && !state.history?.canUndo());
    if ($('redo'))
      $('redo').disabled =
        !state.editable ||
        state.saving ||
        Boolean(state.agentRun) ||
        Boolean(state.wireStart) ||
        !state.history?.canRedo();
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
      control.disabled = !state.cid || state.dirty || state.plotModified || state.saving;
      control.title =
        state.dirty || state.plotModified
          ? '请先保存电路与图像设置'
          : state.cid
            ? `引用已保存的第 ${state.revision} 版`
            : '请先保存电路，获取 CID';
    });
    let referenceHint = '请先保存电路，获取 CID 后即可复制引用。';
    if (!app.userState.isLoggedIn && !state.cid)
      referenceHint = '请先登录并保存电路，获取 CID 后即可复制引用。';
    if (state.cid) referenceHint = `引用指向已保存的第 ${state.revision} 版。`;
    if (state.cid && (state.dirty || state.plotModified))
      referenceHint += state.editable
        ? '请先保存当前电路与图像设置，再复制引用。'
        : '图像设置已在本地修改；请复制为新电路并保存，再分享当前图像。';
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
    $('undo-wire').hidden = !state.wireStart;
    $('undo-wire').disabled = !state.wirePoints.length;
    let help = '点引脚拿起导线，点画布按格点设置拐点，再点目标接通；选中导线可拖动线段或拐点。';
    if (state.wireStart)
      help = `${state.wireStart.wireId ? `从导线 ${state.wireStart.wireId}` : `从 ${state.wireStart.componentId} 的引脚 ${state.wireStart.pin + 1}`} 连线 · ${state.wirePoints.length} 个拐点：点画布放拐点，点目标接通；退格撤回，Esc 取消。`;
    if (!state.editable) help = '只读预览，可选中元件查看参数；复制后继续编辑。';
    $('canvas-help').textContent = help;
    state.annotationControls?.setEditable(state.editable && !state.saving);
    if ($('annotation-pick'))
      $('annotation-pick').disabled = !state.editable || state.saving || !state.result;
    updateExampleControls();
    renderSourceAdvice();
    notifyCircuitEditor();
  }

  function stopPlayback() {
    state.playing = false;
    window.clearInterval(state.animation);
    state.animation = 0;
    $('play').textContent = '播放';
  }

  function finishSimulation(job, error, result) {
    if (state.simulationJob !== job) return;
    state.simulationJob = null;
    if (state.worker) state.worker.terminate();
    window.clearTimeout(state.workerTimer);
    state.workerTimer = 0;
    state.worker = null;
    state.runId += 1;
    if (error) job.reject(error);
    else job.resolve(result);
    updateControls();
  }

  function stopSimulation(message = '', error = null) {
    if (state.simulationJob) {
      finishSimulation(
        state.simulationJob,
        error || agentError('AGENT_STOPPED', message || '仿真已取消。'),
      );
      if (message) setStatus(message, '', 'run-status');
      return;
    }
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
    state.plotResult = null;
    state.simulationError = null;
    state.plotDisplay = null;
    state.plotModified = false;
    state.annotationPicking = false;
    state.annotationControls?.reset();
    state.chart?.destroy?.();
    state.chart = null;
    state.traceIds = [];
    $('results').hidden = true;
    setStatus('电路或分析参数已修改，请重新运行仿真。', '', 'run-status');
  }

  function changed({ electrical = true, history = true, historyGroup } = {}) {
    if (history)
      state.history?.record(historySnapshot(), { group: historyGroup ?? historyInputGroup() });
    state.dirty = true;
    state.editVersion += 1;
    state.aiUndo = null;
    checkAgentRunContext();
    state.aiHighlightedComponents = [];
    state.aiHighlightedTraces = [];
    state.aiPendingTraces = null;
    if (electrical) invalidateResult();
    updateControls();
    persistDraft();
  }

  function historySnapshot() {
    return {
      document: state.document,
      title: $('title').value,
      description: $('description').value,
      loadedExample: state.loadedExample,
    };
  }

  function historyInputGroup() {
    const input = document.activeElement;
    if (!input?.matches?.('input,textarea')) return null;
    return input;
  }

  function resetHistory() {
    state.history?.reset(historySnapshot());
  }

  function restoreHistory(direction) {
    if (!state.editable || state.saving || state.agentRun) return false;
    if (state.wireStart) {
      if (direction === 'undo') {
        if (state.wirePoints.length) undoConnectionPoint();
        else cancelConnection();
      }
      return true;
    }
    const snapshot = state.history?.[direction]();
    if (!snapshot) return false;
    const electrical =
      window.FreeBbsCircuitHistory.electricalKey(state.document) !==
      window.FreeBbsCircuitHistory.electricalKey(snapshot.document);
    state.document = snapshot.document;
    $('title').value = snapshot.title;
    $('description').value = snapshot.description;
    state.loadedExample = snapshot.loadedExample;
    if (!state.document.components.some((item) => item.id === state.selectedId))
      state.selectedId = '';
    if (!state.document.wires.some((item) => item.id === state.selectedWire))
      state.selectedWire = '';
    state.wireAnchor = null;
    state.wireStart = null;
    state.wirePoints = [];
    state.annotationControls?.cancelPicking();
    window.FreeBbsCircuitParameterPopover?.hide();
    changed({ electrical, history: false });
    if (!electrical && state.result) {
      state.plotDisplay = null;
      state.plotModified = true;
      updatePlot(plot.resolveDisplay(state.result, state.document));
    }
    renderAnalysis();
    renderInspector();
    renderSchematic();
    setStatus(direction === 'undo' ? '已撤销上一步修改。' : '已重做修改。');
    return true;
  }

  function beautifiedDocument(document) {
    const layout = window.FreeBbsCircuitLayout;
    if (!layout) throw new Error('布局模块尚未加载，请刷新后重试。');
    return engine.validateDocument(
      layout.normalizeCircuitLayout(engine.validateDocument(document)),
    );
  }

  function beautifyCircuit() {
    if (
      !state.editable ||
      state.saving ||
      state.agentRun ||
      state.worker ||
      state.wireStart ||
      state.exampleBusy ||
      state.exampleLoading ||
      !state.document.components.length
    )
      return false;
    if (!validateParameterInputs()) return false;
    try {
      const next = beautifiedDocument(state.document);
      if (JSON.stringify(next) === JSON.stringify(state.document)) {
        setStatus('当前布局已整理，无需调整。');
        return false;
      }
      state.document = next;
      state.wireAnchor = null;
      window.FreeBbsCircuitParameterPopover?.hide();
      changed({ electrical: false, historyGroup: null });
      renderInspector();
      renderSchematic();
      setStatus('已美化电路：整理元件朝向、对齐布局和导线，可撤销。', 'success');
      notifyCircuitEditor();
      return true;
    } catch (error) {
      setStatus(`美化未完成：${error.message || '请稍后重试'}`, 'error');
      return false;
    }
  }

  function currentFrame() {
    if (!state.result?.frames?.length) return null;
    return state.result.frames.length === state.result.x.length
      ? state.result.frames[state.frame]
      : state.result.frames[0];
  }

  function renderSchematic() {
    const focused = document.activeElement;
    const focusedComponent = $('stage').contains(focused)
      ? focused.closest?.('[data-component-id]')?.dataset.componentId
      : null;
    const focusedPin = focusedComponent ? focused.dataset.pin : undefined;
    const focusedWire = $('stage').contains(focused)
      ? focused.getAttribute?.('data-wire-hit')
      : null;
    state.schematic?.destroy?.();
    state.schematic = renderer.renderSchematic($('stage'), state.document, {
      interactive: state.editable,
      selectable: true,
      selectedId: state.selectedId || state.selectedWire,
      wireStart: state.wireStart,
      wirePoints: state.wirePoints,
      frame: currentFrame(),
      animate: state.playing && state.document.analysis.type === 'transient',
      onPinClick: connectPin,
      onCanvasPoint: addConnectionPoint,
      onWireDraftStart(endpoint, position) {
        state.wireStart = endpoint;
        state.wirePoints = [];
        addConnectionPoint(position);
      },
      onComponentClick(id, { focus = false } = {}) {
        state.selectedId = id;
        state.selectedWire = '';
        state.wireAnchor = null;
        renderInspector();
        renderSchematic();
        syncParameterPopover({ show: true, focus });
      },
      onWireClick(id, position, { source } = {}) {
        window.FreeBbsCircuitParameterPopover?.hide();
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
        if (source !== 'keyboard') window.FreeBbsCircuitSidebar?.open('parameters');
      },
      onConnect(fromEndpoint, target) {
        completeConnection(fromEndpoint, target);
      },
      onWireChange(id, points, { source } = {}) {
        if (source === 'keyboard' && (state.saving || state.agentRun)) return false;
        if (!state.editable) return;
        const wire = state.document.wires.find((item) => item.id === id);
        if (!wire) return;
        wire.points = points.map((point) => ({ x: point.x, y: point.y }));
        state.selectedId = '';
        state.selectedWire = id;
        changed({
          electrical: false,
          historyGroup: source === 'keyboard' ? `wire-move:${id}` : undefined,
        });
        renderInspector();
        renderSchematic();
      },
      onMove(id, x, y, { source } = {}) {
        if (source === 'keyboard' && (state.saving || state.agentRun)) return false;
        if (!state.editable) return;
        const component = state.document.components.find((item) => item.id === id);
        if (!component) return;
        const point = renderer.snapPoint(
          { x, y },
          component.type === 'junction' ? [0, 0, 1000, 640] : [60, 60, 880, 500],
        );
        if (component.x === point.x && component.y === point.y) return;
        component.x = point.x;
        component.y = point.y;
        state.selectedId = id;
        state.selectedWire = '';
        state.wireAnchor = null;
        changed({
          electrical: false,
          historyGroup: source === 'keyboard' ? `move:${id}` : undefined,
        });
        renderInspector();
        renderSchematic();
      },
    });
    applySchematicHighlights();
    syncParameterPopover();
    if (focusedComponent) {
      const component = [...$('stage').querySelectorAll('[data-component-id]')].find(
        (node) => node.dataset.componentId === focusedComponent,
      );
      const target =
        focusedPin === undefined
          ? component
          : component?.querySelector(`[data-pin="${focusedPin}"]`);
      target?.focus({ preventScroll: true });
    } else if (focusedWire && !document.activeElement?.closest?.('[data-wire-controls]')) {
      [...$('stage').querySelectorAll('[data-wire-hit]')]
        .find((node) => node.dataset.wireHit === focusedWire)
        ?.focus({ preventScroll: true });
    }
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
      x: 180 + (count % 5) * 160,
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
    syncParameterPopover({ show: true });
    setStatus(`已添加 ${engine.catalog[type].label} ${component.id}。`);
  }

  function connectPin(endpoint) {
    if (!state.editable) return;
    const target = { componentId: endpoint.componentId, pin: endpoint.pin };
    if (!state.wireStart) {
      state.wireStart = target;
      state.wirePoints = [];
    } else {
      completeConnection(state.wireStart, { endpoint: target });
      return;
    }
    updateControls();
    renderInspector();
    renderSchematic();
  }

  function addConnectionPoint(position) {
    if (!state.editable || !state.wireStart) return;
    if (!Number.isFinite(position?.x) || !Number.isFinite(position?.y)) return;
    const point = renderer.snapPoint(position, [0, 0, 1000, 640]);
    const last = state.wirePoints.at(-1);
    if (last && point.x === last.x && point.y === last.y) return;
    if (state.wirePoints.length >= 32) {
      setStatus('每条导线最多 32 个拐点；请连接目标，或撤回上一拐点。', 'error');
      return;
    }
    state.wirePoints.push(point);
    updateControls();
    renderSchematic();
  }

  function cancelConnection() {
    state.wireStart = null;
    state.wirePoints = [];
    updateControls();
    renderInspector();
    renderSchematic();
  }

  function undoConnectionPoint() {
    if (!state.wireStart || !state.wirePoints.length) return;
    state.wirePoints.pop();
    updateControls();
    renderSchematic();
  }

  function completeConnection(origin, target) {
    if (!state.editable) return;
    const draftPoints = origin === state.wireStart ? state.wirePoints || [] : [];
    try {
      if (origin.wireId && origin.wireId === target.wireId) {
        setStatus('已取消：起点和终点位于同一条导线。');
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
        const samePin = (a, b) => a.componentId === b.componentId && a.pin === b.pin;
        if (samePin(from, to)) {
          setStatus('已取消连线。');
          cancelConnection();
          return;
        }
        const duplicate = document.wires.some(
          (wire) =>
            (samePin(wire.from, from) && samePin(wire.to, to)) ||
            (samePin(wire.to, from) && samePin(wire.from, to)),
        );
        if (duplicate) {
          setStatus('这两个连接点已经接通。');
          cancelConnection();
          return;
        }
        if (document.wires.length >= 200) throw new Error('每个电路最多 200 条导线。');
        document = clone(document);
        const ids = new Set([...document.components, ...document.wires].map((item) => item.id));
        let index = 1;
        while (ids.has(`w${index}`)) index += 1;
        document.wires.push({ id: `w${index}`, from, to, points: clone(draftPoints) });
      }
      state.document = engine.validateDocument(document);
      state.selectedId = '';
      state.selectedWire = '';
      state.wireStart = null;
      state.wirePoints = [];
      changed();
      setStatus('导线已接通；实心圆点表示电气连接。');
    } catch (error) {
      setStatus(error.message, 'error');
    } finally {
      updateControls();
      renderInspector();
      renderSchematic();
    }
  }

  function startFromWire() {
    const wire = state.document.wires.find((item) => item.id === state.selectedWire);
    if (!wire || !state.editable) return;
    const route = renderer.getWireRoute(wire, state.document.components);
    const position = renderer.snapWirePoint(
      wire,
      state.document.components,
      state.wireAnchor || route[Math.floor(route.length / 2)],
    ).point;
    state.wireStart = { wireId: wire.id, position };
    state.wirePoints = [];
    window.FreeBbsCircuitSidebar?.close({ mobileOnly: true });
    updateControls();
    renderInspector();
    renderSchematic();
  }

  function renderPalette() {
    const powerSymbols = { vcc: '↑', vdd: '↑', vss: '↓', vee: '↓', fixed_voltage: '⎓' };
    $('palette').innerHTML = Object.entries(engine.catalog)
      .filter(([type]) => type !== 'junction')
      .map(
        ([type, item]) =>
          `<button type="button" data-add-component="${escapeHtml(type)}"><span class="circuit-palette-symbol" aria-hidden="true">${escapeHtml(powerSymbols[type] || prefixes[type])}</span>${escapeHtml(item.label)}</button>`,
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
    if (key === 'parameterSet')
      options = [
        ['Z', 'Z · 阻抗'],
        ['Y', 'Y · 导纳'],
        ['H', 'h · 混合'],
        ['G', 'g · 逆混合'],
        ['ABCD', 'ABCD · 传输'],
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
    if (component.type === 'twoport' && /^[mi][12][12]$/.test(key)) {
      const symbols =
        component.params.parameterSet === 'ABCD'
          ? ['A', 'B', 'C', 'D']
          : ['11', '12', '21', '22'].map(
              (position) => `${component.params.parameterSet.toLowerCase()}${position}`,
            );
      const units = {
        Z: ['Ω', 'Ω', 'Ω', 'Ω'],
        Y: ['S', 'S', 'S', 'S'],
        H: ['Ω', '1', '1', 'S'],
        G: ['S', '1', '1', 'Ω'],
        ABCD: ['1', 'Ω', 'S', '1'],
      }[component.params.parameterSet];
      const index = ['11', '12', '21', '22'].indexOf(key.slice(1));
      label = `${symbols[index]} ${key[0] === 'i' ? '虚部' : '实部'} / ${units[index]}`;
    }
    if (['voltage', 'current'].includes(component.type)) {
      const unit = component.type === 'voltage' ? 'V' : 'A';
      if (key === 'dc')
        label = `${component.params.waveform === 'dc' ? '直流值' : '直流偏置'} / ${unit}`;
      if (key === 'amplitude')
        label = `${component.params.waveform === 'pulse' ? '脉冲增量' : '正弦峰值'} / ${unit}`;
      if (key === 'acAmplitude') label = `AC 小信号峰值 / ${unit}`;
    }
    if (component.type === 'fixed_voltage' && key === 'dc') label = '固定电压 / V';
    return `<label>${escapeHtml(label)}${field}</label>`;
  }

  function parameterFieldsHtml(component) {
    if (['vcc', 'vdd', 'vss', 'vee'].includes(component.type))
      return '<p class="circuit-parameter-hint">同名电源符号在本电路内自动连通。连接固定电平或电压源供电；名称本身不指定电压，VSS / VEE 也不自动接地。</p>';
    if (component.type === 'fixed_voltage')
      return `${parameterInput(component, 'dc', component.params.dc)}<p class="circuit-parameter-hint">相对参考地的理想直流电压，可设正值、负值或 0 V。连接电源符号即可为同名网络供电，AC 小信号为 0。</p>`;
    if (component.type === 'twoport') {
      const equations = {
        Z: '[V₁, V₂]ᵀ = Z [I₁, I₂]ᵀ',
        Y: '[I₁, I₂]ᵀ = Y [V₁, V₂]ᵀ',
        H: '[V₁, I₂]ᵀ = h [I₁, V₂]ᵀ',
        G: '[I₁, V₂]ᵀ = g [V₁, I₂]ᵀ',
        ABCD: '[V₁, I₁]ᵀ = ABCD [V₂, −I₂]ᵀ',
      };
      const cells = (prefix) =>
        ['11', '12', '21', '22']
          .map((key) => parameterInput(component, prefix + key, component.params[prefix + key]))
          .join('');
      return `${parameterInput(component, 'parameterSet', component.params.parameterSet)}<p class="circuit-parameter-hint circuit-matrix-note">${equations[component.params.parameterSet]}<br> V₁/V₂ = 端口 + 对 − 的电压，I₁/I₂ 均流入 + 端。切换类型后请按所选定义填写矩阵。</p><div class="circuit-matrix-fields">${cells('m')}</div><details><summary>复数矩阵 · AC 虚部</summary><div class="circuit-matrix-fields">${cells('i')}</div></details><p class="circuit-parameter-hint">系数为常数。非零虚部仅支持线性电路的 AC 分析；直流与瞬态须将虚部设为 0。</p>`;
    }
    if (component.type === 'oscilloscope2')
      return '<p class="circuit-parameter-hint">CH1+ / CH1− 和 CH2+ / CH2− 分别测量两路差分电压，理想高输入阻抗。运行后在“波形与读数”中选择 X–T 或 X–Y 模式。</p>';
    return Object.entries(component.params)
      .filter(([key]) => {
        if (!['voltage', 'current'].includes(component.type)) return true;
        if (key === 'duty') return component.params.waveform === 'pulse';
        return (
          component.params.waveform !== 'dc' || !['amplitude', 'frequency', 'delay'].includes(key)
        );
      })
      .map(([key, value]) => parameterInput(component, key, value))
      .join('');
  }

  function syncParameterPopover({ show = false, focus = false } = {}) {
    const popover = window.FreeBbsCircuitParameterPopover;
    if (!popover) return;
    const component = state.document.components.find((item) => item.id === state.selectedId);
    if (!component || state.wireStart || listPage) {
      popover.hide();
      return;
    }
    let html = parameterFieldsHtml(component);
    if (['voltage', 'current'].includes(component.type))
      html += `<p class="circuit-parameter-hint">${escapeHtml(sourceParameterHint(component))}</p>`;
    if (component.type === 'nonlinear')
      html += '<p class="circuit-parameter-hint">使用 u、k、数学运算和函数，例如 i=k*u^3。</p>';
    if (!html)
      html = '<p class="circuit-parameter-hint">此元件没有可调参数，可在侧栏查看连接。</p>';
    const snapshot = {
      componentId: component.id,
      title: `${component.id} · ${engine.catalog[component.type].label}`,
      html,
      editable: state.editable,
    };
    if (show) popover.show(snapshot, { focus });
    else popover.update(snapshot, { preserveFocus: true });
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
    $('parameters').innerHTML = component ? parameterFieldsHtml(component) : '';
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

  function rotateSelection(turns = 1) {
    const selected = state.document.components.find((item) => item.id === state.selectedId);
    if (!selected || !state.editable) return false;
    selected.rotation = (selected.rotation + turns * 90 + 360) % 360;
    changed({ electrical: false });
    renderInspector();
    renderSchematic();
    return true;
  }

  function mirrorSelection(axis) {
    const selected = state.document.components.find((item) => item.id === state.selectedId);
    if (!selected || !state.editable) return false;
    const localAxis = selected.rotation % 180 === 0 ? axis : axis === 'x' ? 'y' : 'x';
    const key = localAxis === 'x' ? 'mirrorX' : 'mirrorY';
    selected[key] = !selected[key];
    changed({ electrical: false });
    renderInspector();
    renderSchematic();
    return true;
  }

  function duplicateSelection() {
    const selected = state.document.components.find((item) => item.id === state.selectedId);
    if (!selected || !state.editable || state.saving || state.wireStart) return false;
    if (state.document.components.length >= 80) {
      setStatus('每个电路最多 80 个元件。', 'error');
      return false;
    }
    const duplicate = clone(selected);
    duplicate.id = uniqueId(prefixes[selected.type] || 'J');
    const offset = renderer.gridSize * 2;
    Object.assign(
      duplicate,
      renderer.snapPoint(
        {
          x: selected.x + (selected.x > 900 ? -offset : offset),
          y: selected.y + (selected.y > 520 ? -offset : offset),
        },
        selected.type === 'junction' ? [0, 0, 1000, 640] : [60, 60, 880, 500],
      ),
    );
    state.document.components.push(duplicate);
    state.selectedId = duplicate.id;
    state.selectedWire = '';
    changed();
    renderInspector();
    renderSweepOptions();
    renderSchematic();
    focusSelectedComponent();
    setStatus(`已复制 ${selected.id} 为 ${duplicate.id}，可继续移动或连接。`);
    return true;
  }

  function focusSelectedComponent() {
    [...$('stage').querySelectorAll('[data-component-id]')]
      .find((node) => node.dataset.componentId === state.selectedId)
      ?.focus({ preventScroll: true });
  }

  function moveSelection(dx, dy) {
    const selected = state.document.components.find((item) => item.id === state.selectedId);
    if (!selected || !state.editable) return false;
    const bounds = selected.type === 'junction' ? [0, 0, 1000, 640] : [60, 60, 880, 500];
    const point = renderer.snapPoint(
      { x: selected.x + dx * renderer.gridSize, y: selected.y + dy * renderer.gridSize },
      bounds,
    );
    if (point.x === selected.x && point.y === selected.y) return true;
    Object.assign(selected, point);
    state.selectedWire = '';
    state.wireAnchor = null;
    changed({ electrical: false, historyGroup: `move:${selected.id}` });
    renderInspector();
    renderSchematic();
    if (!$('stage').contains(document.activeElement)) focusSelectedComponent();
    return true;
  }

  function dispatchShortcut(action, detail = {}, event = {}) {
    if (action === 'save') {
      saveCircuit();
      return true;
    }
    if (action === 'run') {
      if (state.worker || state.agentRun) return false;
      runSimulation();
      return true;
    }
    if (action === 'max') {
      window.FreeBbsCircuitSidebar?.open('max');
      return true;
    }
    if (action === 'cancel') {
      if (state.annotationPicking) state.annotationControls.cancelPicking();
      else if (state.wireStart) cancelConnection();
      else {
        window.FreeBbsCircuitParameterPopover?.hide();
        state.selectedId = '';
        state.selectedWire = '';
        renderInspector();
        renderSchematic();
      }
      return true;
    }
    if (!state.editable || state.saving || state.agentRun) return false;
    if (action === 'undo' || action === 'redo') return restoreHistory(action);
    if (action === 'delete' && state.wireStart && event.key === 'Backspace') {
      if (state.wirePoints.length) undoConnectionPoint();
      else cancelConnection();
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
      if (state.selectedWire) startFromWire();
      else if (state.selectedId) {
        const selected = state.document.components.find((item) => item.id === state.selectedId);
        if (!selected) return false;
        const focusedPin = document.activeElement?.closest?.('[data-pin]');
        const pin =
          focusedPin?.closest('[data-component-id]')?.dataset.componentId === selected.id
            ? Number(focusedPin.dataset.pin)
            : 0;
        window.FreeBbsCircuitParameterPopover?.hide();
        connectPin({ componentId: selected.id, pin });
      } else return false;
      return true;
    }
    return false;
  }

  function updateParameter(event, { componentId = state.selectedId, popover = false } = {}) {
    if (!state.editable) return;
    const key = event.target.dataset.parameter;
    if (componentId !== state.selectedId) return;
    const component = state.document.components.find((item) => item.id === componentId);
    if (!key || !component || !Object.hasOwn(component.params, key)) return;
    const value =
      typeof component.params[key] === 'number' ? Number(event.target.value) : event.target.value;
    if (typeof value === 'number' && (!event.target.value.trim() || !Number.isFinite(value))) {
      event.target.setCustomValidity('请填写有限数值。');
      setStatus('参数必须填写有限数值，支持 1e-6 等科学计数法。', 'error');
      return;
    }
    event.target.setCustomValidity('');
    if (component.params[key] === value) return;
    component.params[key] = value;
    changed();
    if (popover || ['waveform', 'parameterSet'].includes(key)) {
      renderInspector();
      if (!popover) $('parameters').querySelector(`[data-parameter="${key}"]`)?.focus();
    } else renderSourceParameterHint(component);
    renderSweepOptions();
    renderSchematic();
    setStatus(`已更新 ${component.id} 的${parameterLabels[key] || key}。`);
  }

  function sourceParameterHint(component) {
    const p = component.params;
    const unit = component.type === 'voltage' ? 'V' : 'A';
    let text = '直流值用于 DC 工作点。';
    if (p.waveform === 'sine') {
      const amplitude = Math.abs(p.amplitude);
      text = `正弦输出 = 直流偏置 + 峰值 × sin(2π × 频率 × (t − 延迟) + 相位)。范围 ${formatNumber(p.dc - amplitude, unit)} 至 ${formatNumber(p.dc + amplitude, unit)}；不需要占空比。`;
    } else if (p.waveform === 'pulse') {
      text = `脉冲在 ${formatNumber(p.dc, unit)} 与 ${formatNumber(p.dc + p.amplitude, unit)} 之间切换；占空比表示高电平占一个周期的比例。`;
    }
    return `${text} 时间波形使用“瞬态响应”；“AC 小信号峰值”只用于交流小信号分析。相位单位为度。`;
  }

  function renderSourceParameterHint(component) {
    const hint = $('source-parameter-hint');
    if (hint && ['voltage', 'current'].includes(component.type))
      hint.textContent = sourceParameterHint(component);
  }

  function validateParameterInputs() {
    if (state.result && state.plotControls?.validate() === false) return false;
    if (state.result && state.annotationControls?.commitPending() === false) return false;
    if (window.FreeBbsCircuitParameterPopover?.reportValidity?.() === false) return false;
    if ($('parameters').checkValidity()) return true;
    window.FreeBbsCircuitSidebar?.open('parameters');
    $('parameters').reportValidity();
    return false;
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
      state.wirePoints = [];
      if (!initial) changed();
      else {
        state.editVersion += 1;
        invalidateResult();
        resetHistory();
      }
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
    if (!validateParameterInputs()) return;
    capturePlotSettings();
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
    if (!state.cid || state.dirty || state.plotModified || state.saving) return;
    const query = new URLSearchParams({
      board: 'circuit',
      compose: 'circuit',
      cid: state.cid,
      revision: String(state.revision),
    });
    window.location.assign(`/discussion?${query}`);
  }

  function notifyCircuitEditor() {
    checkAgentRunContext();
    if (!window.FreeBbsCircuitEditor || listPage) return;
    window.dispatchEvent(
      new CustomEvent('freebbs:circuit-editor-change', {
        detail: {
          editVersion: state.editVersion,
          canEdit: state.editable && !state.saving,
          canUndoAi: Boolean(
            state.editable &&
            !state.agentRun &&
            state.aiUndo &&
            state.aiUndo.editVersion === state.editVersion,
          ),
          cid: state.cid,
          revision: state.revision,
        },
      }),
    );
  }

  function getAssistantSnapshot() {
    const measured = state.plotResult || state.result;
    const required = new Set([
      state.plotDisplay?.ch1,
      state.plotDisplay?.ch2,
      state.plotDisplay?.xyX,
      state.plotDisplay?.xyY,
    ]);
    const preferred = new Set([
      ...state.traceIds,
      ...(state.plotDisplay?.mode === 'xy' ? [state.plotDisplay.xyX, state.plotDisplay.xyY] : []),
    ]);
    const simulation = state.result
      ? {
          analysis: clone(state.result.analysis),
          sampleCount: state.result.x.length,
          warnings: (measured.warnings || [])
            .slice(0, 12)
            .map((message) => String(message).slice(0, 500)),
          traces: [...measured.traces]
            .sort(
              (a, b) =>
                Number(required.has(b.id)) * 4 +
                Number(preferred.has(b.id)) * (b.id.startsWith('M:') ? 2 : 1) -
                (Number(required.has(a.id)) * 4 +
                  Number(preferred.has(a.id)) * (a.id.startsWith('M:') ? 2 : 1)),
            )
            .slice(0, 24)
            .map((trace) => {
              let min = Infinity;
              let max = -Infinity;
              let minIndex = -1;
              let maxIndex = -1;
              trace.values.forEach((value, index) => {
                if (Number.isFinite(value)) {
                  if (value < min) {
                    min = value;
                    minIndex = index;
                  }
                  if (value > max) {
                    max = value;
                    maxIndex = index;
                  }
                }
              });
              const count = Math.min(64, trace.values.length);
              const samples = Array.from({ length: count }, (_, index) => {
                const at =
                  count === 1 ? 0 : Math.round((index * (trace.values.length - 1)) / (count - 1));
                return {
                  x: state.result.x[at],
                  value: trace.values[at],
                  ...(Number.isFinite(trace.phase?.[at]) ? { phase: trace.phase[at] } : {}),
                };
              }).filter((sample) => Number.isFinite(sample.x) && Number.isFinite(sample.value));
              const latest = trace.values.at(-1);
              const point = (index, values = trace.values) => ({
                x: state.result.x[index],
                value: values[index],
              });
              const phasePoints = {};
              if (trace.phase) {
                let low = -1;
                let high = -1;
                trace.phase.forEach((value, index) => {
                  if (!Number.isFinite(value)) return;
                  if (low < 0 || value < trace.phase[low]) low = index;
                  if (high < 0 || value > trace.phase[high]) high = index;
                });
                if (low >= 0) phasePoints.phaseMinPoint = point(low, trace.phase);
                if (high >= 0) phasePoints.phaseMaxPoint = point(high, trace.phase);
              }
              return {
                id: trace.id,
                label: trace.label.slice(0, 120),
                unit: trace.unit.slice(0, 24),
                ...(minIndex >= 0 ? { minPoint: point(minIndex) } : {}),
                ...(maxIndex >= 0 ? { maxPoint: point(maxIndex) } : {}),
                ...phasePoints,
                ...(Number.isFinite(min) ? { min } : {}),
                ...(Number.isFinite(max) ? { max } : {}),
                ...(Number.isFinite(latest) ? { latest } : {}),
                samples,
              };
            }),
        }
      : null;
    return {
      document: clone(
        state.plotDisplay ? { ...state.document, display: state.plotDisplay } : state.document,
      ),
      editVersion: state.editVersion,
      generation: state.generation,
      cid: state.cid,
      revision: state.revision,
      ...metadata(),
      selection: {
        ...(state.selectedId ? { componentId: state.selectedId } : {}),
        ...(state.selectedWire ? { wireId: state.selectedWire } : {}),
      },
      simulation,
      simulationError: state.simulationError || null,
      isSimulationRunning: Boolean(state.worker),
      isWiring: Boolean(state.wireStart),
      canEdit: state.editable && !state.saving,
      canUndoAi: Boolean(
        state.editable &&
        !state.agentRun &&
        state.aiUndo &&
        state.aiUndo.editVersion === state.editVersion,
      ),
    };
  }

  function applySchematicHighlights() {
    $('stage')
      .querySelectorAll('[data-component-id]')
      .forEach((element) => {
        element.classList.toggle(
          'is-ai-highlighted',
          state.aiHighlightedComponents.includes(element.dataset.componentId),
        );
      });
  }

  function clearAiHighlights() {
    state.aiHighlightedComponents = [];
    state.aiHighlightedTraces = [];
    state.aiPendingTraces = null;
    applySchematicHighlights();
    renderWaveform();
  }

  function agentError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function checkAgentRunContext() {
    const run = state.agentRun;
    if (!run || run.applying || run.error) return !run?.error;
    if (
      run.expectedVersion !== state.editVersion ||
      run.generation !== state.generation ||
      run.sessionUid !== state.sessionUid ||
      run.cid !== state.cid ||
      state.wireStart
    ) {
      run.error = agentError(
        'AGENT_STALE',
        '画布或登录状态已变化，Max 已停止；请根据当前电路重新开始。',
      );
      state.aiUndo = null;
      if (state.simulationJob?.agentRunId === run.id) stopSimulation('', run.error);
      return false;
    }
    return true;
  }

  function beginAgentRun() {
    if (state.agentRun) throw agentError('AGENT_BUSY', 'Max 已在执行，请先停止当前任务。');
    if (state.worker || state.saving)
      throw agentError('AGENT_BUSY', '请等待当前仿真或保存完成，再让 Max 开始执行。');
    if (state.wireStart) throw new Error('请先完成或取消正在绘制的导线。');
    if (!validateParameterInputs()) throw new Error('请先修正当前参数或标记输入。');
    capturePlotSettings();
    const snapshot = getAssistantSnapshot();
    state.agentRunCounter += 1;
    const id = `agent-${state.agentRunCounter}`;
    state.agentRun = {
      id,
      expectedVersion: state.editVersion,
      generation: state.generation,
      sessionUid: state.sessionUid,
      cid: state.cid,
      applying: false,
      executing: false,
      changed: false,
      error: null,
      priorUndo: state.aiUndo,
      checkpoint: {
        document: clone(snapshot.document),
        result: state.result,
        plotDisplay: state.plotDisplay ? clone(state.plotDisplay) : null,
        plotModified: state.plotModified,
        frame: state.frame,
      },
    };
    updateControls();
    return { runId: id, snapshot };
  }

  async function executeAgentActions(actions, { runId, expectedVersion, signal } = {}) {
    const run = state.agentRun;
    if (!run || run.id !== runId) throw agentError('AGENT_STOPPED', 'Max 本轮执行已结束。');
    if (!checkAgentRunContext()) throw run.error;
    if (expectedVersion !== run.expectedVersion)
      throw agentError('AGENT_STALE', '操作依据的画布版本已过期，请重新读取当前电路。');
    if (run.executing) throw agentError('AGENT_BUSY', '上一批操作尚未完成。');
    if (state.worker) throw agentError('AGENT_BUSY', '仿真仍在运行，请等待结果。');
    if (!validateParameterInputs()) throw new Error('请先修正当前参数或标记输入。');
    if (!checkAgentRunContext()) throw run.error;
    const abort = () => {
      run.error = agentError('AGENT_STOPPED', 'Max 已停止，已完成的修改仍保留在草稿中。');
      if (state.simulationJob?.agentRunId === run.id) stopSimulation('', run.error);
    };
    if (signal?.aborted) {
      abort();
      throw run.error;
    }
    signal?.addEventListener('abort', abort, { once: true });
    run.executing = true;
    let completion = null;
    try {
      run.applying = true;
      try {
        applyAssistantActions(actions, {
          expectedVersion,
          onSimulation: (pending) => {
            completion = pending;
          },
        });
      } finally {
        run.applying = false;
        run.expectedVersion = state.editVersion;
        run.changed ||=
          JSON.stringify(getAssistantSnapshot().document) !==
          JSON.stringify(run.checkpoint.document);
      }
      if (completion) await completion;
      if (state.agentRun !== run) throw agentError('AGENT_STOPPED', 'Max 本轮执行已结束。');
      if (!checkAgentRunContext() || run.error) throw run.error;
      return getAssistantSnapshot();
    } finally {
      run.executing = false;
      signal?.removeEventListener('abort', abort);
    }
  }

  function endAgentRun(runId) {
    const run = state.agentRun;
    if (!run || run.id !== runId) return getAssistantSnapshot();
    checkAgentRunContext();
    if (state.simulationJob?.agentRunId === run.id)
      stopSimulation('', agentError('AGENT_STOPPED', 'Max 本轮执行已结束。'));
    const unchangedContext =
      run.expectedVersion === state.editVersion &&
      run.generation === state.generation &&
      run.sessionUid === state.sessionUid &&
      run.cid === state.cid &&
      !state.wireStart &&
      run.error?.code !== 'AGENT_STALE';
    if (unchangedContext && !state.editable) state.aiUndo = null;
    if (unchangedContext && state.editable) {
      state.aiUndo = run.changed
        ? {
            document: run.checkpoint.document,
            checkpoint: run.checkpoint,
            electrical: true,
            editVersion: state.editVersion,
          }
        : run.priorUndo;
    }
    state.agentRun = null;
    updateControls();
    return getAssistantSnapshot();
  }

  function applyAssistantActions(actions, { expectedVersion, onSimulation } = {}) {
    const protocol = window.CircuitAIActions;
    if (!protocol) throw new Error('AI 操作模块尚未加载，请刷新后重试。');
    if (!Array.isArray(actions)) throw new Error('AI 操作列表无效。');
    const editing = actions.some((action) => protocol.isEditingAction(action));
    if (editing && (!state.editable || state.saving))
      throw new Error('当前电路只读或正在保存，无法修改草稿。');
    if (!validateParameterInputs()) throw new Error('请先修正当前参数或标记输入。');
    if (expectedVersion !== state.editVersion)
      throw new Error('画布已变化，请让 Max 根据当前电路重新给出建议。');
    if (state.wireStart && editing) throw new Error('请先完成或取消正在绘制的导线。');
    const actionDocument = clone(
      state.plotDisplay ? { ...state.document, display: state.plotDisplay } : state.document,
    );
    const availableResult = state.plotResult || state.result;
    let previewDocument = clone(actionDocument);
    let previewResult = availableResult;
    const checkedActions = [];
    for (const action of actions) {
      let checked = action;
      if (action.type === 'set_plot') {
        if (!state.result) throw new Error('请先运行仿真，再配置图像。');
        previewDocument = protocol.applyActions(previewDocument, [action]);
        const prepared = plot.buildResult(state.result, previewDocument.display);
        for (const row of previewDocument.display.math) {
          const trace = prepared.result.traces.find((item) => item.id === `M:${row.id}`);
          if (!trace || !trace.values.some(Number.isFinite))
            throw new Error(
              `数学曲线 ${row.id} 无法计算有效采样值：${prepared.warnings.join('；')}`,
            );
        }
        previewResult = prepared.result;
      } else {
        if (action.type === 'set_annotation') {
          if (!previewResult) throw new Error('请先运行仿真，再标记真实采样点。');
          const annotation = engine.normalizeAnnotation(action.annotation);
          const point = annotationModel.resolve(
            annotation,
            previewResult,
            previewDocument.display || {},
          );
          if (point.error) throw new Error(`无法添加标记：${point.error}`);
          checked = { ...action, annotation: { ...annotation, at: point.at } };
        }
        previewDocument = protocol.applyActions(previewDocument, clone([checked]));
      }
      checkedActions.push(clone(checked));
    }
    const valid = protocol.validateActions(
      checkedActions,
      actionDocument,
      (availableResult?.traces || []).map((trace) => trace.id),
    );
    // Validate the complete batch before applying any edit or visual effect.
    let next = protocol.applyActions(actionDocument, valid);
    const autoBeautify = valid.some((action) =>
      [
        'add_component',
        'connect',
        'delete_component',
        'move_component',
        'transform_component',
        'set_parameter',
      ].includes(action.type),
    );
    if (autoBeautify) next = beautifiedDocument(next);
    const electrical = valid.some((action) => protocol.isElectricalAction(action));
    const run = valid.some((action) => action.type === 'run_simulation');
    if (
      valid.some((action) => action.type === 'show_traces' && action.traceIds.length) &&
      !run &&
      (electrical || !state.result)
    )
      throw new Error('此操作需要重新运行仿真后才能查看有效波形。');
    if (editing) {
      const previous = clone(actionDocument);
      state.document = next;
      state.selectedId = '';
      state.selectedWire = '';
      changed({ electrical });
      state.aiUndo = { document: previous, editVersion: state.editVersion, electrical };
      if (!electrical && state.result && next.display) updatePlot(next.display);
      renderAnalysis();
      renderInspector();
      renderSchematic();
      setStatus(
        autoBeautify
          ? '已应用 Max 建议并自动美化电路，可在右侧撤销。'
          : '已应用 Max 建议到当前草稿，可在右侧撤销。',
        'success',
      );
    }
    valid.forEach((action) => {
      if (action.type === 'highlight_components') {
        state.aiHighlightedComponents = [...action.componentIds];
        applySchematicHighlights();
        $('stage').scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      if (action.type === 'show_traces') {
        state.aiHighlightedTraces = [...action.traceIds];
        if (!action.traceIds.length) state.traceIds = [];
        if (run) state.aiPendingTraces = [...action.traceIds];
        else if (state.result) {
          state.traceIds = [...action.traceIds];
          state.plotDisplay = {
            ...(state.plotDisplay || plot.resolveDisplay(state.result, state.document)),
            mode: 'xt',
            traceIds: [...action.traceIds],
          };
          state.plotModified = true;
          updatePlot(state.plotDisplay);
          $('traces')
            .querySelectorAll('input[data-trace]')
            .forEach((input) => {
              input.checked = state.traceIds.includes(input.dataset.trace);
            });
          renderWaveform();
          renderMeters();
          $('waveform').scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else if (action.traceIds.length) throw new Error('当前没有有效波形，请先运行仿真。');
      }
    });
    if (run) {
      const completion = runSimulation();
      onSimulation?.(completion);
    }
    notifyCircuitEditor();
    return getAssistantSnapshot();
  }

  function undoAssistantActions() {
    if (state.agentRun) throw new Error('请先停止 Max，再撤销本轮操作。');
    if (
      !state.editable ||
      state.saving ||
      !state.aiUndo ||
      state.aiUndo.editVersion !== state.editVersion
    )
      throw new Error('画布已继续编辑，无法撤销上一批 Max 操作。');
    const undo = state.aiUndo;
    const electrical = undo.electrical !== false;
    state.document = clone(undo.document);
    state.selectedId = '';
    state.selectedWire = '';
    state.wireStart = null;
    state.wirePoints = [];
    changed({ electrical });
    if (undo.checkpoint) {
      state.plotDisplay = undo.checkpoint.plotDisplay ? clone(undo.checkpoint.plotDisplay) : null;
      state.plotModified = undo.checkpoint.plotModified;
      if (undo.checkpoint.result) {
        showResult(undo.checkpoint.result);
        setFrame(undo.checkpoint.frame);
      }
    } else if (!electrical && state.result)
      updatePlot(plot.resolveDisplay(state.result, state.document));
    clearAiHighlights();
    renderAnalysis();
    renderInspector();
    renderSchematic();
    setStatus('已撤销上一批 Max 修改。');
    return getAssistantSnapshot();
  }

  function updatePlot(settings, { persist = false } = {}) {
    if (!state.result) return;
    const display = engine.normalizeDisplay(settings);
    const prepared = plot.buildResult(state.result, display);
    state.plotDisplay = display;
    state.plotResult = prepared.result;
    state.traceIds = display.traceIds.filter((id) =>
      prepared.result.traces.some((trace) => trace.id === id),
    );
    if (persist) state.plotModified = true;
    if (persist && state.editable) {
      state.document.display = clone(display);
      changed({ electrical: false });
    }
    $('plot-status').textContent = [
      ...prepared.warnings,
      ...(state.plotModified
        ? [
            state.editable
              ? '图像设置已修改，保存后可分享。'
              : '当前图像设置仅在本页生效；复制为新电路并保存后可分享。',
          ]
        : []),
    ].join('；');
    updateControls();
    $('plot-status').classList.toggle('is-error', prepared.warnings.length > 0);
    $('traces').innerHTML = prepared.result.traces
      .map(
        (trace) =>
          `<label class="circuit-inline-check"><input type="checkbox" data-trace="${escapeHtml(trace.id)}" ${state.traceIds.includes(trace.id) ? 'checked' : ''} />${escapeHtml(trace.label)} / ${escapeHtml(trace.unit)}</label>`,
      )
      .join('');
    $('trace-picker').hidden = display.mode === 'xy';
    $('show-phase').checked = display.phase;
    $('phase-control').hidden = state.document.analysis.type !== 'ac' || display.mode === 'xy';
    state.plotControls?.update(prepared.result, display);
    state.annotationControls?.update(prepared.result, display, {
      editable: state.editable && !state.saving,
    });
    renderWaveform();
    renderMeters();
  }

  function renderWaveform() {
    if (!state.result) return;
    state.chart?.destroy?.();
    state.chart = null;
    const display = state.plotDisplay || {};
    if (!state.traceIds.length && display.mode !== 'xy') {
      $('waveform').textContent = '选择至少一条曲线查看结果。';
      return;
    }
    state.chart = renderer.renderWaveform($('waveform'), state.plotResult || state.result, {
      ...display,
      annotationPicking: state.annotationPicking,
      onPointPick: (point) => state.annotationControls?.pick(point),
      onAnnotationSelect: (id) => state.annotationControls?.select(id),
      traceIds: state.traceIds,
      phase: $('show-phase').checked,
      logX: state.document.analysis.type === 'ac' && state.document.analysis.scale === 'log',
    });
    $('waveform')
      .querySelectorAll('[data-trace-id]')
      .forEach((chart) => {
        chart.classList.toggle(
          'is-ai-highlighted',
          state.aiHighlightedTraces.includes(chart.dataset.traceId),
        );
      });
    $('waveform')
      .querySelectorAll('[data-trace-ids]')
      .forEach((chart) => {
        chart.classList.toggle(
          'is-ai-highlighted',
          JSON.parse(chart.dataset.traceIds).some((id) => state.aiHighlightedTraces.includes(id)),
        );
      });
  }

  function renderMeters() {
    if (!state.result) return;
    const meterIds = state.document.components
      .filter((item) =>
        ['voltmeter', 'ammeter', 'oscilloscope', 'oscilloscope2'].includes(item.type),
      )
      .flatMap((item) =>
        item.type === 'oscilloscope2'
          ? [`V:${item.id}`, `V:${item.id}:CH2`]
          : [`${item.type === 'ammeter' ? 'I' : 'V'}:${item.id}`],
      );
    const selected = [...new Set([...meterIds, ...state.traceIds])];
    $('meters').innerHTML = selected
      .map((id) => (state.plotResult || state.result).traces.find((trace) => trace.id === id))
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
    const display = plot.resolveDisplay(
      result,
      state.plotDisplay ? { ...state.document, display: state.plotDisplay } : state.document,
    );
    if (state.aiPendingTraces !== null) {
      display.mode = 'xt';
      state.plotModified = true;
      display.traceIds = state.aiPendingTraces.filter((id) =>
        result.traces.some((trace) => trace.id === id),
      );
      state.aiPendingTraces = null;
    }
    $('results').hidden = false;
    updatePlot(display);
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
    notifyCircuitEditor();
  }

  function runSimulation() {
    let job = null;
    const rejected = (error) => {
      const pending = Promise.reject(error);
      // Manual toolbar handlers intentionally do not await the worker.
      pending.catch(() => {});
      return pending;
    };
    if (state.worker) return rejected(agentError('AGENT_BUSY', '仿真仍在运行，请等待结果。'));
    try {
      if (!validateParameterInputs()) throw new Error('请先修正当前参数或标记输入。');
      capturePlotSettings();
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
      state.plotResult = null;
      state.simulationError = null;
      $('results').hidden = true;
      const worker = new Worker('/circuit-worker.js');
      state.worker = worker;
      state.runId += 1;
      const id = state.runId;
      let resolve;
      let reject;
      const promise = new Promise((accept, fail) => {
        resolve = accept;
        reject = fail;
      });
      promise.catch(() => {});
      job = {
        id,
        promise,
        resolve,
        reject,
        agentRunId: state.agentRun?.applying ? state.agentRun.id : null,
      };
      state.simulationJob = job;
      updateControls();
      setStatus('正在求解电路…', '', 'run-status');
      const fail = (message, code = 'SIMULATION_FAILED') => {
        if (state.simulationJob !== job) return;
        state.simulationError = String(message).slice(0, 1000);
        finishSimulation(job, agentError(code, state.simulationError));
        renderSchematic();
        setStatus(state.simulationError, 'error', 'run-status');
      };
      worker.onmessage = (event) => {
        if (id !== state.runId || event.data.id !== id || state.simulationJob !== job) return;
        if (job.agentRunId && !checkAgentRunContext()) return;
        if (event.data.error) fail(event.data.error);
        else {
          try {
            showResult(event.data.result);
            finishSimulation(job, null, event.data.result);
          } catch (error) {
            state.result = null;
            state.plotResult = null;
            $('results').hidden = true;
            fail(`结果显示失败：${error.message}`);
          }
        }
      };
      worker.onerror = () => {
        if (id !== state.runId) return;
        fail('仿真线程启动或运行失败，请检查电路后重试。');
      };
      state.workerTimer = window.setTimeout(() => {
        if (id !== state.runId) return;
        fail(
          '求解超过 20 秒，已停止仿真。请减少采样点、检查参数或简化电路后重试。',
          'SIMULATION_TIMEOUT',
        );
      }, 20000);
      worker.postMessage({ id, document: doc, options: doc.analysis });
      return promise;
    } catch (error) {
      state.simulationError = error.message || '无法运行仿真。';
      const failure = agentError('SIMULATION_FAILED', state.simulationError);
      if (job) finishSimulation(job, failure);
      else stopSimulation();
      setStatus(state.simulationError, 'error', 'run-status');
      return job?.promise || rejected(failure);
    }
  }

  function capturePlotSettings() {
    if (state.result && state.plotControls?.read && state.editable) {
      const current = state.plotControls.read();
      if (JSON.stringify(current) !== JSON.stringify(state.plotDisplay))
        updatePlot(current, { persist: true });
    }
    if (
      state.plotDisplay &&
      state.plotModified &&
      state.editable &&
      JSON.stringify(state.document.display) !== JSON.stringify(state.plotDisplay)
    ) {
      state.document.display = clone(state.plotDisplay);
      changed({ electrical: false });
    }
  }

  async function saveCircuit() {
    if (state.saving || !state.editable) return;
    if (!validateParameterInputs()) return;
    capturePlotSettings();
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
      if (!state.dirty) {
        state.document = circuit.document || doc;
        state.plotModified = false;
        if (state.result) updatePlot(state.plotDisplay);
        state.history?.synchronize(historySnapshot());
      }
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
    state.editVersion += 1;
    state.aiUndo = null;
    state.saving = false;
    state.cid = '';
    state.revision = 0;
    state.latestRevision = 0;
    state.owner = null;
    state.loadedExample = null;
    state.editable = true;
    if (state.plotDisplay) state.document.display = clone(state.plotDisplay);
    $('title').value = `${$('title').value.replace(/ · 副本$/, '')} · 副本`.slice(0, 120);
    window.history.replaceState(null, '', '/circuit');
    changed({ electrical: false });
    resetHistory();
    renderAnalysis();
    renderInspector();
    renderSchematic();
    setStatus('已复制为新的本地草稿，保存后获得新的 CID。');
  }

  function recognitionBackupKey(uid = state.sessionUid) {
    return `free_bbs_circuit_recognition_backup_v1:${uid || 'guest'}`;
  }

  function getRecognitionContext() {
    let hasBackup = false;
    try {
      hasBackup = Boolean(sessionStorage.getItem(recognitionBackupKey()));
    } catch {
      /* Import will report storage failures before replacing a draft. */
    }
    return {
      generation: state.generation,
      editVersion: state.editVersion,
      uid: state.sessionUid,
      dirty: state.dirty || state.plotModified,
      busy: state.saving || Boolean(state.agentRun) || state.exampleBusy || state.exampleLoading,
      hasBackup,
    };
  }

  function recognitionDraftSnapshot() {
    return {
      ...metadata(),
      document: state.plotDisplay
        ? { ...state.document, display: clone(state.plotDisplay) }
        : state.document,
      uid: state.sessionUid,
      cid: state.cid,
      revision: state.revision,
      latestRevision: state.latestRevision,
      owner: state.owner,
      editable: state.editable,
      dirty: state.dirty || state.plotModified,
      loadedExample: state.loadedExample,
    };
  }

  function replaceWithRecognitionDraft(draft) {
    const validated = engine.validateDocument(draft.document);
    try {
      sessionStorage.setItem(recognitionBackupKey(), JSON.stringify(recognitionDraftSnapshot()));
    } catch {
      throw new Error('无法保留当前草稿，请先导出 JSON 或保存当前电路，再重试。');
    }
    persistDraft();
    state.generation += 1;
    state.editVersion += 1;
    state.exampleLoadRequest += 1;
    state.aiUndo = null;
    state.aiHighlightedComponents = [];
    state.aiHighlightedTraces = [];
    state.aiPendingTraces = null;
    state.cid = draft.cid || '';
    state.revision = draft.revision || 0;
    state.latestRevision = draft.latestRevision || 0;
    state.owner = draft.owner || null;
    state.loadedExample = draft.loadedExample || null;
    state.editable = draft.editable !== false;
    state.dirty = Boolean(draft.dirty);
    state.document = validated;
    state.selectedId = '';
    state.selectedWire = '';
    state.wireAnchor = null;
    state.wireStart = null;
    state.wirePoints = [];
    window.FreeBbsCircuitParameterPopover?.hide();
    invalidateResult();
    $('title').value = String(draft.title || '识别的电路').slice(0, 120);
    $('description').value = String(draft.description || '').slice(0, 2000);
    window.history.replaceState(
      null,
      '',
      state.cid
        ? `/circuit?cid=${encodeURIComponent(state.cid)}${state.editable && state.revision === state.latestRevision ? '' : `&revision=${state.revision}`}`
        : '/circuit',
    );
    resetHistory();
    renderAnalysis();
    renderInspector();
    renderSchematic();
    updateControls();
    return persistDraft();
  }

  function importRecognizedCircuit(circuit, context) {
    const current = getRecognitionContext();
    if (
      listPage ||
      current.busy ||
      !current.uid ||
      !context ||
      context.uid !== current.uid ||
      context.generation !== current.generation ||
      context.editVersion !== current.editVersion
    )
      throw new Error('当前账号或电路已变化，请重新识别后再生成草稿。');
    const persisted = replaceWithRecognitionDraft({
      title: circuit.title,
      description: circuit.description,
      document: circuit.document,
      dirty: true,
      editable: true,
    });
    setStatus(
      persisted
        ? '已生成新电路草稿。核对后点击“保存电路”；上一份草稿可通过“恢复上一份草稿”找回。'
        : '已生成电路，上一份草稿已备份；当前浏览器存储空间不足，请及时保存或导出新电路。',
      persisted ? 'success' : 'error',
    );
    return true;
  }

  function restoreRecognitionDraft() {
    if (getRecognitionContext().busy || !confirmDraftReplacement('恢复上一份草稿')) return false;
    try {
      const draft = JSON.parse(sessionStorage.getItem(recognitionBackupKey()) || 'null');
      if (!draft || draft.uid !== state.sessionUid) throw new Error('没有可恢复的草稿。');
      const persisted = replaceWithRecognitionDraft(draft);
      setStatus(
        persisted
          ? '已恢复上一份草稿，刚才的电路也已备份，可再次切换。'
          : '已恢复上一份草稿，请及时保存或导出当前电路。',
        persisted ? 'success' : 'error',
      );
      return true;
    } catch (error) {
      setStatus(error.message || '无法恢复草稿。', 'error');
      return false;
    }
  }

  async function copyReference(view) {
    if (state.dirty || state.plotModified)
      return setStatus(
        state.editable
          ? '请先保存电路与图像设置，再复制此版本的引用。'
          : '请复制为新电路并保存，以分享当前图像设置。',
        'error',
      );
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
    const result = state.plotResult || state.result;
    const columns = [{ label: `${result.xLabel} (${result.xUnit || ''})`, values: result.x }];
    result.traces.forEach((trace) => {
      columns.push({ label: `${trace.label} (${trace.unit})`, values: trace.values });
      if (trace.phase) columns.push({ label: `${trace.label} 相位 (°)`, values: trace.phase });
    });
    const quote = (value) => `"${String(value).replace(/"/g, '""')}"`;
    const rows = [columns.map((column) => quote(column.label)).join(',')];
    result.x.forEach((_, index) =>
      rows.push(
        columns
          .map((column) => (Number.isFinite(column.values[index]) ? column.values[index] : ''))
          .join(','),
      ),
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
    state.editVersion += 1;
    state.aiUndo = null;
    const { generation } = state;
    state.editable = false;
    state.loadedExample = null;
    invalidateResult();
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
      state.editVersion += 1;
      state.aiUndo = null;
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
      resetHistory();
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
        '<div class="circuit-empty">登录后查看自己的电路。<br /><a href="/login">前往登录</a>，也可以先<a href="/circuit?new=1">新建本地电路</a>。</div>';
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
    state.history = window.FreeBbsCircuitHistory.create();
    document.addEventListener('focusin', (event) => {
      if (event.target.matches?.('input,textarea')) state.history.breakGroup();
    });
    $('palette').addEventListener('click', (event) => {
      const button = event.target.closest('[data-add-component]');
      if (button) addComponent(button.dataset.addComponent);
    });
    ['title', 'description'].forEach((id) =>
      $(id).addEventListener('input', () => {
        if (state.editable) changed({ electrical: false });
      }),
    );
    $('parameters').addEventListener('input', (event) => {
      if (event.target.tagName !== 'SELECT') updateParameter(event);
    });
    window.addEventListener('freebbs:circuit-parameter-input', (event) => {
      const { componentId, input } = event.detail || {};
      if (input) updateParameter({ target: input }, { componentId, popover: true });
    });
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
    $('rotate').addEventListener('click', () => rotateSelection());
    ['x', 'y'].forEach((axis) =>
      $(`mirror-${axis}`).addEventListener('click', () => mirrorSelection(axis)),
    );
    $('duplicate').addEventListener('click', duplicateSelection);
    $('undo').addEventListener('click', () => restoreHistory('undo'));
    $('beautify').addEventListener('click', beautifyCircuit);
    $('redo').addEventListener('click', () => restoreHistory('redo'));
    $('delete').addEventListener('click', removeSelection);
    $('cancel-wire').addEventListener('click', cancelConnection);
    $('undo-wire').addEventListener('click', undoConnectionPoint);
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
    $('recognition-restore')?.addEventListener('click', restoreRecognitionDraft);
    state.plotControls = window.FreeBbsCircuitPlotControls.create($('plot-controls'), (display) => {
      if (state.annotationControls?.commitPending() === false)
        throw new Error('请先完成或取消标记输入。');
      updatePlot(
        {
          ...display,
          ...(state.plotDisplay?.annotations ? { annotations: state.plotDisplay.annotations } : {}),
        },
        { persist: true },
      );
    });
    state.annotationControls = window.FreeBbsCircuitAnnotationControls.create($('annotations'), {
      onChange: (display) => {
        if (!state.editable || state.saving) throw new Error('当前电路只读或正在保存。');
        if (state.plotControls.validate() === false) throw new Error('请先修正图像设置中的输入。');
        updatePlot(
          { ...state.plotControls.read(), annotations: display.annotations },
          { persist: true },
        );
      },
      onPickingChange: (picking) => {
        state.annotationPicking = picking;
        $('annotation-pick').setAttribute('aria-pressed', String(picking));
        $('annotation-pick').textContent = picking ? '取消选点' : '在波形上添加标记';
        $('annotation-pick-hint').textContent = picking ? '点击或轻触曲线添加标记，Esc 取消。' : '';
        $('waveform').classList.toggle('is-annotation-picking', picking);
        renderWaveform();
      },
    });
    $('annotation-pick').addEventListener('click', () => {
      if (state.plotControls.validate()) state.annotationControls.togglePicking();
    });
    $('traces').addEventListener('change', () => {
      if (
        state.plotControls?.validate() === false ||
        state.annotationControls?.commitPending() === false
      ) {
        $('traces')
          .querySelectorAll('input')
          .forEach((input) => {
            const field = input;
            field.checked = state.traceIds.includes(field.dataset.trace);
          });
        return;
      }
      const traceIds = [...$('traces').querySelectorAll('input:checked')].map(
        (input) => input.dataset.trace,
      );
      try {
        updatePlot({ ...state.plotControls.read(), traceIds }, { persist: true });
      } catch (error) {
        setStatus(error.message, 'error', 'plot-status');
        $('traces')
          .querySelectorAll('input')
          .forEach((input) => {
            const field = input;
            field.checked = state.traceIds.includes(field.dataset.trace);
          });
      }
    });
    $('show-phase').addEventListener('change', () => {
      if (
        state.plotControls?.validate() === false ||
        state.annotationControls?.commitPending() === false
      ) {
        $('show-phase').checked = state.plotDisplay.phase;
        return;
      }
      updatePlot(
        { ...state.plotControls.read(), phase: $('show-phase').checked },
        { persist: true },
      );
    });
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
    state.shortcuts = window.FreeBbsCircuitShortcuts.bind({
      target: document,
      isActive: () => !listPage && !$('editor-page').hidden && !$('recognition-dialog')?.open,
      dispatch: dispatchShortcut,
      helpButton: $('shortcuts'),
      helpDialog: $('shortcuts-dialog'),
      onHelpOpen: () => window.FreeBbsCircuitParameterPopover?.hide(),
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
      if (previous) {
        try {
          sessionStorage.removeItem(recognitionBackupKey(previous));
        } catch {
          /* Account-specific keys prevent restoring another user's draft. */
        }
      }
      state.sessionUid = uid;
      state.generation += 1;
      state.editVersion += 1;
      state.aiUndo = null;
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
          resetHistory();
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
      if (params.get('new') === '1') {
        removeDraft();
        params.delete('new');
        const query = params.toString();
        window.history.replaceState({}, '', `/circuit${query ? `?${query}` : ''}`);
      } else restoreDraft();
      resetHistory();
      renderAnalysis();
      renderInspector();
      renderSchematic();
      updateControls();
      await examplesReady;
      if (state.loadedExample) {
        $('example').value = String(state.loadedExample.id);
        updateExampleControls();
      }
    }
  }

  window.FreeBbsCircuitEditor = {
    getRecognitionContext,
    importRecognizedCircuit,
    beautify: beautifyCircuit,
    getSnapshot: getAssistantSnapshot,
    applyActions: applyAssistantActions,
    beginAgentRun,
    executeAgentActions,
    endAgentRun,
    undoAiActions: undoAssistantActions,
    clearHighlights: clearAiHighlights,
  };
  initialize().then(() => {
    if (!listPage) {
      window.dispatchEvent(new CustomEvent('freebbs:circuit-editor-ready'));
      notifyCircuitEditor();
    }
  });
})();
