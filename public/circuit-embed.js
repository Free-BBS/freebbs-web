(() => {
  const query = new URLSearchParams(window.location.search);
  const cid = query.get('cid') || '';
  const revision = query.get('revision') || '';
  const view = query.get('view') || '';
  const theme = query.get('theme');
  if (['light', 'dark'].includes(theme)) document.documentElement.dataset.theme = theme;
  const engine = globalThis.FreeBbsCircuitEngine;
  const renderer = globalThis.FreeBbsCircuitRenderer;
  const plot = globalThis.FreeBbsCircuitPlot;
  const annotations = globalThis.FreeBbsCircuitAnnotations;
  const root = document.getElementById('circuit-embed');
  const status = document.getElementById('embed-status');
  const retry = document.getElementById('embed-retry');
  const cancel = document.getElementById('embed-cancel');
  const diagram = document.getElementById('embed-schematic');
  const timeline = document.getElementById('embed-timeline');
  const play = document.getElementById('embed-play');
  const position = document.getElementById('embed-position');
  const time = document.getElementById('embed-time');
  const waves = document.getElementById('embed-waves');
  const channels = document.getElementById('embed-channels');
  const waveform = document.getElementById('embed-waveform');
  const phase = document.getElementById('embed-phase');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const state = {
    circuit: null,
    worker: null,
    timeout: null,
    requestId: 0,
    controller: null,
    schematic: null,
    chart: null,
    result: null,
    display: null,
    playing: false,
    animation: null,
    frame: 0,
    playPosition: 0,
    lastTick: 0,
    traceIds: new Set(),
    layoutFrame: 0,
    chartWidth: 0,
  };
  const names = { schematic: '电路原理图', live: '电路动态图', waveform: '电路波形图' };

  function reportHeight() {
    if (window.parent === window) return;
    const height = Math.ceil(root.getBoundingClientRect().height + 2);
    window.parent.postMessage({ type: 'freebbs:circuit-height', height }, '*');
  }
  function scheduleLayout() {
    if (state.layoutFrame) return;
    state.layoutFrame = window.requestAnimationFrame(() => {
      state.layoutFrame = 0;
      const width = waveform.clientWidth;
      if (state.result && !waves.hidden && waves.open && width > 0 && width !== state.chartWidth) {
        redrawWaveform();
      } else reportHeight();
    });
  }
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleLayout) : null;
  observer?.observe(root);
  observer?.observe(waveform);
  window.addEventListener('resize', scheduleLayout);

  function setStatus(message, error = false) {
    status.textContent = message;
    status.classList.toggle('is-error', error);
    reportHeight();
  }
  function stopWorker() {
    state.worker?.terminate();
    state.worker = null;
    window.clearTimeout(state.timeout);
    state.timeout = null;
    cancel.hidden = true;
  }
  function pause() {
    state.playing = false;
    window.cancelAnimationFrame(state.animation);
    state.animation = null;
    play.textContent = '播放';
    play.setAttribute('aria-pressed', 'false');
    root.classList.add('is-paused');
  }
  function drawFrame(index) {
    state.frame = index;
    position.value = String(index);
    const value = state.result?.x[index];
    time.textContent = `t = ${renderer.formatValue(value, 's')}`;
    state.schematic?.updateFrame(state.result?.frames[index]);
  }
  function tick(timestamp) {
    if (!state.playing || !state.result) return;
    const delta = state.lastTick ? Math.min(timestamp - state.lastTick, 100) : 0;
    state.lastTick = timestamp;
    state.playPosition =
      (state.playPosition +
        engine.playbackFrameStep(state.circuit.document, state.result, {
          duration: 8000,
          frameInterval: delta,
        })) %
      state.result.frames.length;
    const index = Math.floor(state.playPosition);
    if (index !== state.frame) drawFrame(index);
    state.animation = window.requestAnimationFrame(tick);
  }
  function startPlayback() {
    if (!state.result || timeline.hidden || document.hidden) return;
    state.playing = true;
    state.playPosition = state.frame;
    state.lastTick = 0;
    const frameInterval = 1000 / 60;
    const frameStep = engine.playbackFrameStep(state.circuit.document, state.result, {
      duration: 8000,
      frameInterval,
    });
    play.textContent =
      frameStep < (frameInterval / 8000) * state.result.frames.length ? '暂停 · 慢放' : '暂停';
    play.setAttribute('aria-pressed', 'true');
    root.classList.remove('is-paused');
    state.animation = window.requestAnimationFrame(tick);
  }
  function redrawWaveform() {
    if (!state.result) return;
    document.getElementById('embed-channel-summary').textContent =
      `选择测量通道 · 已选 ${state.traceIds.size} 项`;
    const width = waveform.clientWidth;
    if (!width || waves.hidden || !waves.open) {
      state.chartWidth = 0;
      reportHeight();
      return;
    }
    state.chartWidth = width;
    state.chart?.destroy();
    state.chart = renderer.renderWaveform(waveform, state.result, {
      ...state.display,
      traceIds: Array.from(state.traceIds),
      phase: phase.checked,
      logX:
        state.circuit.document.analysis.type === 'ac' &&
        state.circuit.document.analysis.scale === 'log',
    });
    const list = document.getElementById('embed-annotations');
    list.replaceChildren();
    (state.display.annotations || []).forEach((annotation, index) => {
      const point = annotations.resolve(annotation, state.result, {
        ...state.display,
        traceIds: Array.from(state.traceIds),
        phase: phase.checked,
      });
      // Visible annotations already have a complete legend beside their chart.
      // Keep only hidden items here, with the reason needed to recover them.
      if (!point.error) return;
      const item = document.createElement('li');
      const heading = document.createElement('strong');
      heading.textContent = `标记 ${index + 1} · ${annotation.traceId}${annotation.axis === 'phase' ? ' · 相位' : ''}`;
      const note = document.createElement('p');
      note.textContent = annotation.text || '无注释';
      const reason = document.createElement('small');
      reason.textContent = point.error;
      item.append(heading, note, reason);
      list.append(item);
    });
    list.hidden = !list.children.length;
    reportHeight();
  }
  function setupChannels() {
    channels.replaceChildren();
    state.traceIds = new Set(
      state.display.traceIds.filter((id) => state.result.traces.some((trace) => trace.id === id)),
    );
    phase.checked = state.display.phase;
    document.getElementById('embed-channel-picker').hidden = state.display.mode === 'xy';
    const settings = document.getElementById('embed-plot-settings');
    const mode =
      state.display.mode === 'xy'
        ? `X–Y · X: ${state.display.xyX || state.display.ch1} · Y: ${state.display.xyY || state.display.ch2}`
        : 'X–T · 随时间 / 扫描量';
    settings.textContent = `${mode}${state.display.math.length ? ` · ${state.display.math.map((item) => `${item.label || item.id} = ${item.expression}`).join('；')}` : ''} · 使用分享时保存的图像设置`;
    state.result.traces.forEach((trace) => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = trace.id;
      input.checked = state.traceIds.has(trace.id);
      input.addEventListener('change', () => {
        if (input.checked) state.traceIds.add(trace.id);
        else state.traceIds.delete(trace.id);
        redrawWaveform();
      });
      label.append(input, document.createTextNode(`${trace.label} (${trace.unit})`));
      channels.append(label);
    });
    document.getElementById('embed-phase-label').hidden =
      state.circuit.document.analysis.type !== 'ac' || state.display.mode === 'xy';
    redrawWaveform();
  }
  function acceptResult(result) {
    if (
      !result ||
      !Array.isArray(result.x) ||
      !result.x.length ||
      !Array.isArray(result.traces) ||
      !Array.isArray(result.frames)
    ) {
      throw new Error('仿真结果不完整，请重试或在电路编辑器中检查电路。');
    }
    state.display = plot.resolveDisplay(result, state.circuit.document);
    const prepared = plot.buildResult(result, state.display);
    state.result = prepared.result;
    const transient =
      state.circuit.document.analysis.type === 'transient' && result.frames.length > 1;
    timeline.hidden = view !== 'live' || !transient;
    position.max = String(Math.max(0, result.frames.length - 1));
    state.frame = 0;
    if (result.frames.length) state.schematic?.updateFrame(result.frames[0]);
    if (!timeline.hidden) drawFrame(0);
    waves.hidden = false;
    waves.open = view === 'waveform';
    setupChannels();
    const kind = { dc: '直流工作点', transient: '瞬态分析', sweep: '参数扫描', ac: '频率扫描' }[
      state.circuit.document.analysis.type
    ];
    const warnings = [...(result.warnings || []), ...prepared.warnings].join('；');
    const hint = view === 'live' && !transient ? '；当前分析以静态工作点显示，可展开查看波形' : '';
    setStatus(`${kind} · ${result.x.length} 个采样点${hint}`);
    document.getElementById('embed-model').textContent =
      warnings || '教学模型仿真 · 使用此版本保存的分析设置';
    if (!timeline.hidden && !reducedMotion.matches) startPlayback();
  }
  function simulate() {
    stopWorker();
    pause();
    retry.hidden = true;
    state.result = null;
    waves.hidden = true;
    timeline.hidden = true;
    state.requestId += 1;
    const id = state.requestId;
    setStatus('正在计算此版本电路的真实仿真结果…');
    try {
      const worker = new Worker('/circuit-worker.js');
      state.worker = worker;
      cancel.hidden = false;
      const fail = (message) => {
        if (state.worker !== worker) return;
        stopWorker();
        retry.hidden = false;
        setStatus(message, true);
      };
      worker.onmessage = (event) => {
        if (state.worker !== worker || event.data?.id !== id) return;
        if (event.data.error) {
          fail(String(event.data.error));
          return;
        }
        stopWorker();
        try {
          acceptResult(event.data.result);
        } catch (error) {
          retry.hidden = false;
          setStatus(error.message, true);
        }
      };
      worker.onerror = () => fail('仿真计算未能启动或意外中断，请重试。');
      state.timeout = window.setTimeout(
        () => fail('计算超过 20 秒已停止，请打开电路缩短分析范围或增大时间步长。'),
        20000,
      );
      worker.postMessage({
        id,
        document: state.circuit.document,
        options: state.circuit.document.analysis,
      });
    } catch (error) {
      stopWorker();
      retry.hidden = false;
      setStatus('当前浏览器无法启动仿真线程，请重试或使用支持 Web Worker 的浏览器。', true);
    }
  }
  function diagramBounds(documentValue) {
    if (!documentValue.components.length) return [0, 0, 1000, 640];
    const positions = [
      ...documentValue.components,
      ...documentValue.wires.flatMap((wire) => wire.points || []),
    ];
    const xs = positions.map((item) => item.x);
    const ys = positions.map((item) => item.y);
    const left = Math.min(...xs) - 100;
    const top = Math.min(...ys) - 95;
    return [
      left,
      top,
      Math.max(320, Math.max(...xs) - left + 100),
      Math.max(220, Math.max(...ys) - top + 105),
    ];
  }
  async function loadCircuit() {
    retry.hidden = true;
    setStatus('正在加载公开电路版本。');
    state.controller?.abort();
    const controller = new AbortController();
    state.controller = controller;
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    try {
      const local =
        ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname) &&
        window.location.port === '3000';
      const base = local
        ? `${window.location.protocol}//${window.location.hostname}:3001/api`
        : '/api';
      const response = await fetch(`${base}/circuits/${cid}?revision=${revision}`, {
        signal: controller.signal,
        credentials: 'omit',
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || `电路读取失败（${response.status}）。`);
      if (controller !== state.controller) return;
      const { circuit } = payload;
      if (!circuit || circuit.cid !== cid || circuit.revision !== Number(revision))
        throw new Error('服务器返回的电路版本不匹配，请重新打开引用。');
      circuit.document = engine.validateDocument(circuit.document);
      state.circuit = circuit;
      document.getElementById('embed-title').textContent = circuit.title;
      document.title = `${circuit.title} · 电路引用`;
      document.getElementById('embed-meta').textContent =
        `${cid} · 第 ${revision} 版 · ${circuit.owner?.username || '已注销用户'}`;
      const open = document.getElementById('embed-open');
      open.href = `/circuit?${new URLSearchParams({ cid, revision })}`;
      open.hidden = false;
      document.getElementById('embed-model').hidden = view === 'schematic';
      if (view !== 'waveform') {
        diagram.hidden = false;
        state.schematic?.destroy();
        state.schematic = renderer.renderSchematic(diagram, circuit.document, {
          viewBox: diagramBounds(circuit.document),
          animate: view === 'live',
        });
      }
      document.getElementById('embed-live-hint').hidden = view !== 'live';
      if (view === 'schematic')
        setStatus(
          circuit.document.components.length
            ? '此引用固定为已保存版本，后续编辑不会改变此图。'
            : '此版本尚未放置元件。',
        );
      else simulate();
    } catch (error) {
      if (controller !== state.controller) return;
      retry.hidden = false;
      setStatus(error.name === 'AbortError' ? '电路加载超时，请重试。' : error.message, true);
    } finally {
      window.clearTimeout(timeout);
      reportHeight();
    }
  }

  play.addEventListener('click', () => {
    if (state.playing) pause();
    else startPlayback();
  });
  position.addEventListener('input', () => {
    pause();
    drawFrame(Number(position.value));
  });
  phase.addEventListener('change', redrawWaveform);
  retry.addEventListener('click', () => {
    if (state.circuit) simulate();
    else loadCircuit();
  });
  cancel.addEventListener('click', () => {
    stopWorker();
    retry.hidden = false;
    setStatus('已取消仿真，点击重试可重新计算。');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
  });
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches) pause();
  });
  document
    .querySelectorAll('details')
    .forEach((element) => element.addEventListener('toggle', scheduleLayout));
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || event.origin !== window.location.origin) return;
    if (
      event.data?.type !== 'freebbs:circuit-theme' ||
      !['light', 'dark'].includes(event.data.theme)
    )
      return;
    document.documentElement.dataset.theme = event.data.theme;
  });
  window.addEventListener('pagehide', () => {
    pause();
    stopWorker();
    state.controller?.abort();
    state.controller = null;
    observer?.disconnect();
    window.cancelAnimationFrame(state.layoutFrame);
    state.layoutFrame = 0;
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      observer?.observe(root);
      observer?.observe(waveform);
      loadCircuit();
    }
  });
  pause();
  document.getElementById('embed-kind').textContent = names[view] || '电路引用';
  const valid =
    cid.length === 26 &&
    /^c_[0-9a-f]{24}$/.test(cid) &&
    /^[1-9][0-9]*$/.test(revision) &&
    String(Number(revision)) === revision &&
    Number(revision) <= 4294967295 &&
    Object.hasOwn(names, view);
  if (!valid) setStatus('电路引用格式无效：需要合法 CID、版本号和展示方式。', true);
  else if (!engine || !renderer || !plot || !annotations)
    setStatus('电路模块未能加载，请刷新页面后重试。', true);
  else loadCircuit();
})();
