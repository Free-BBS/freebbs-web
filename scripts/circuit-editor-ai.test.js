const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const engine = require('../public/circuit-engine');
const plot = require('../public/circuit-plot');
const annotationModel = require('../public/circuit-annotations');
const protocol = require('../public/circuit-ai-actions');
const { validateCircuitAssistantInput } = require('../backend/circuit-assistant');

const source = fs.readFileSync(path.join(__dirname, '../public/circuit.js'), 'utf8');
const bridgeSource = source.slice(
  source.indexOf('  function notifyCircuitEditor()'),
  source.indexOf('  function renderMeters()'),
);
const changeSource = source.slice(
  source.indexOf('  function changed('),
  source.indexOf('  function currentFrame()'),
);
const resultSource = source.slice(
  source.indexOf('  function showResult('),
  source.indexOf('  function runSimulation()'),
);
const workerSource = source.slice(
  source.indexOf('  function runSimulation()'),
  source.indexOf('  function capturePlotSettings()'),
);
const stopSource = source.slice(
  source.indexOf('  function finishSimulation('),
  source.indexOf('  function invalidateResult()'),
);
const clone = (value) => JSON.parse(JSON.stringify(value));
const endpoint = (componentId, pin = 0) => ({ componentId, pin });

function fixture(resistorCount = 1) {
  const resistors = Array.from({ length: resistorCount }, (_, index) => ({
    id: `R${index + 1}`,
    type: 'resistor',
    x: 240 + index * 100,
    y: 160,
    params: { resistance: (index + 1) * 1000 },
  }));
  return engine.validateDocument({
    version: 1,
    components: [
      { id: 'V1', type: 'voltage', x: 100, y: 160, params: { dc: 5 } },
      ...resistors,
      { id: 'G1', type: 'ground', x: 100, y: 360 },
    ],
    wires: [
      { id: 'w1', from: endpoint('V1', 1), to: endpoint('G1') },
      ...resistors.flatMap((component, index) => [
        { id: `w${2 * index + 2}`, from: endpoint('V1'), to: endpoint(component.id) },
        { id: `w${2 * index + 3}`, from: endpoint(component.id, 1), to: endpoint('G1') },
      ]),
    ],
    analysis: { type: 'dc' },
  });
}

function node(dataset = {}) {
  const classes = new Set();
  return {
    dataset,
    checked: false,
    scrolls: 0,
    textContent: '',
    classes,
    classList: {
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
    },
    scrollIntoView() {
      this.scrolls += 1;
    },
    querySelectorAll() {
      return [];
    },
  };
}

function harness({ document = fixture(), measured = true, realWorker = false } = {}) {
  const state = {
    document,
    cid: '',
    revision: 0,
    dirty: true,
    editable: true,
    saving: false,
    editVersion: 7,
    generation: 0,
    sessionUid: 'test-reader',
    worker: null,
    simulationJob: null,
    simulationError: null,
    runId: 0,
    agentRun: null,
    agentRunCounter: 0,
    selectedId: 'R1',
    selectedWire: '',
    wireStart: null,
    wirePoints: [],
    result: measured ? engine.simulate(document) : null,
    traceIds: ['V:R1'],
    frame: 0,
    aiUndo: null,
    aiHighlightedComponents: [],
    aiHighlightedTraces: [],
    aiPendingTraces: null,
  };
  const calls = {
    persisted: 0,
    runs: 0,
    analysis: 0,
    inspector: 0,
    schematic: 0,
    waveform: 0,
    meters: 0,
    events: [],
    statuses: [],
  };
  const components = document.components.map((component) => node({ componentId: component.id }));
  const allTraceIds = document.components
    .filter((component) => !['ground', 'junction'].includes(component.type))
    .flatMap((component) => [`V:${component.id}`, `I:${component.id}`]);
  const checks = allTraceIds.map((id) => node({ trace: id }));
  const charts = allTraceIds.map((id) => node({ traceId: id }));
  const grouped = node({ traceIds: JSON.stringify(['V:R1', 'V:V1']) });
  const elements = {
    stage: node(),
    traces: node(),
    waveform: node(),
    'show-phase': node(),
    results: node(),
    'phase-control': node(),
    frame: node(),
    play: node(),
    playback: node(),
    warnings: node(),
    'plot-status': node(),
    'trace-picker': node(),
  };
  elements.stage.querySelectorAll = () => components;
  elements.traces.querySelectorAll = () => checks;
  elements.waveform.querySelectorAll = (selector) =>
    selector === '[data-trace-id]' ? charts : [grouped];
  const context = {
    Object,
    JSON,
    Array,
    Promise,
    Set,
    Map,
    Number,
    Math,
    state,
    engine,
    plot,
    annotationModel,
    clone,
    listPage: false,
    $: (id) => {
      assert.ok(elements[id], `unexpected UI dependency: ${id}`);
      return elements[id];
    },
    metadata: () => ({ title: '尚未保存的并联电路', description: '草稿中的电阻值' }),
    escapeHtml: (value) => String(value),
    setFrame: (index) => {
      state.frame = index;
    },
    renderer: {
      renderWaveform: () => {
        calls.waveform += 1;
      },
    },
    window: {
      CircuitAIActions: protocol,
      FreeBbsCircuitLayout: require('../public/circuit-layout'),
      FreeBbsCircuitEditor: {},
      dispatchEvent: (event) => calls.events.push(clone(event)),
    },
    CustomEvent: class CustomEvent {
      constructor(type, options) {
        this.type = type;
        this.detail = options.detail;
      }
    },
    updateControls: () => {},
    validateParameterInputs: () => true,
    capturePlotSettings: () => {},
    readAnalysis: () => clone(state.document.analysis),
    stopPlayback: () => {},
    persistDraft: () => {
      calls.persisted += 1;
    },
    invalidateResult: () => {
      if (realWorker) {
        context.stopSimulation();
        state.plotResult = null;
        state.plotDisplay = null;
        state.simulationError = null;
      }
      state.result = null;
      state.traceIds = [];
    },
    renderAnalysis: () => {
      calls.analysis += 1;
    },
    renderInspector: () => {
      calls.inspector += 1;
    },
    renderSchematic: () => {
      calls.schematic += 1;
      context.applySchematicHighlights();
    },
    renderMeters: () => {
      calls.meters += 1;
    },
    setStatus: (...args) => {
      calls.statuses.push(args);
    },
    runSimulation: () => {
      calls.runs += 1;
      context.showResult(engine.simulate(state.document));
    },
  };
  const workers = [];
  const timers = new Map();
  context.window.setTimeout = (callback) => {
    const id = timers.size + 1;
    timers.set(id, callback);
    return id;
  };
  context.window.clearTimeout = (id) => timers.delete(id);
  context.Worker = function FakeWorker() {
    workers.push(this);
    calls.runs += 1;
    this.terminated = false;
    this.postMessage = (message) => {
      this.request = clone(message);
    };
    this.terminate = () => {
      this.terminated = true;
    };
    this.respond = (payload = { result: engine.simulate(this.request.document) }) => {
      this.onmessage({ data: { id: this.request.id, ...payload } });
    };
  };
  vm.runInNewContext(
    `${changeSource}\n${bridgeSource}\n${resultSource}\n${realWorker ? `${stopSource}\n${workerSource}` : ''}`,
    context,
    {
      filename: 'circuit.js:editor-ai-bridge',
    },
  );
  return { context, state, calls, components, checks, charts, grouped, elements, workers, timers };
}

test('editor snapshot carries an independent unsaved document and a bounded, backend-valid simulation summary', () => {
  const document = fixture(16);
  document.components.find((component) => component.id === 'R1').params.resistance = 2200;
  document.analysis = { type: 'transient', stop: 0.01, step: 0.00001, initial: 'operating-point' };
  const { context, state } = harness({ document });
  state.cid = 'c_0123456789abcdef01234567';
  state.revision = 3;
  state.selectedWire = 'w2';
  state.traceIds = ['I:R16'];
  state.result.warnings = Array.from({ length: 18 }, (_, index) => `提示 ${index}`);
  const resultBefore = clone(state.result);
  const snapshot = clone(context.getAssistantSnapshot());
  assert.equal(
    snapshot.document.components.find((component) => component.id === 'R1').params.resistance,
    2200,
  );
  assert.equal(snapshot.title, '尚未保存的并联电路');
  assert.equal(snapshot.cid, state.cid);
  assert.equal(snapshot.canEdit, true);
  assert.equal(snapshot.editVersion, 7);
  assert.deepEqual(snapshot.selection, { componentId: 'R1', wireId: 'w2' });
  assert.equal(snapshot.simulation.sampleCount, 1001);
  assert.equal(snapshot.simulation.traces.length, 24);
  assert.equal(snapshot.simulation.traces[0].id, 'I:R16');
  assert.equal(snapshot.simulation.warnings.length, 12);
  snapshot.simulation.traces.forEach((trace) => {
    assert.equal(trace.samples.length, 64);
    assert.equal(trace.samples[0].x, 0);
    assert.equal(trace.samples.at(-1).x, 0.01);
    assert.ok([trace.min, trace.max, trace.latest].every(Number.isFinite));
    assert.equal(trace.values, undefined);
  });
  assert.equal(snapshot.simulation.frames, undefined);
  const payload = validateCircuitAssistantInput({
    question: '分析当前草稿',
    document: snapshot.document,
    selection: snapshot.selection,
    simulation: snapshot.simulation,
  });
  assert.equal(
    payload.document.components.find((component) => component.id === 'R1').params.resistance,
    2200,
  );
  snapshot.document.components[0].params.dc = 100;
  snapshot.simulation.traces[0].samples[0].value = 100;
  assert.equal(state.document.components[0].params.dc, 5);
  assert.deepEqual(state.result, resultBefore);
});

test('stale suggestions of every type are rejected without changes or a simulation run', () => {
  const { context, state, calls } = harness();
  const before = clone(state);
  const proposals = [
    [{ type: 'set_parameter', componentId: 'R1', parameter: 'resistance', value: 2000 }],
    [{ type: 'highlight_components', componentIds: ['R1'] }],
    [{ type: 'show_traces', traceIds: ['I:R1'] }],
    [{ type: 'run_simulation' }],
  ];
  proposals.forEach((actions) =>
    assert.throws(() => context.applyAssistantActions(actions, { expectedVersion: 6 }), /变化/),
  );
  assert.deepEqual(clone(state), before);
  assert.equal(calls.runs, 0);
  assert.equal(calls.persisted, 0);
});

test('snapshot omits unavailable statistics and bounds long solver warnings before the request', () => {
  const { context, state } = harness();
  state.result.x = [0, 1, 2];
  state.result.traces = state.result.traces.map((trace) => ({ ...trace, values: [1, 2, 3] }));
  state.frame = 0;
  assert.equal(context.getAssistantSnapshot().simulation.traces[0].latest, 3);
  state.result.traces = state.result.traces.map((trace) => ({ ...trace, values: [NaN] }));
  state.result.warnings = ['多个周期源的参数提示：'.repeat(100)];
  const snapshot = clone(context.getAssistantSnapshot());
  snapshot.simulation.traces.forEach((trace) => {
    assert.equal(Object.hasOwn(trace, 'min'), false);
    assert.equal(Object.hasOwn(trace, 'max'), false);
    assert.equal(Object.hasOwn(trace, 'latest'), false);
    assert.deepEqual(trace.samples, []);
  });
  assert.ok(snapshot.simulation.warnings[0].length <= 500);
  assert.doesNotThrow(() =>
    validateCircuitAssistantInput({
      question: '解释结果',
      document: snapshot.document,
      simulation: snapshot.simulation,
    }),
  );
});

test('read-only and saving drafts reject edits while read-only viewing still permits current highlights', () => {
  const { context, state, calls, components } = harness();
  const action = { type: 'set_parameter', componentId: 'R1', parameter: 'resistance', value: 2000 };
  state.editable = false;
  const before = clone(state.document);
  assert.throws(() => context.applyAssistantActions([action], { expectedVersion: 7 }), /只读|保存/);
  context.applyAssistantActions([{ type: 'highlight_components', componentIds: ['R1'] }], {
    expectedVersion: 7,
  });
  assert.ok(
    components
      .find((component) => component.dataset.componentId === 'R1')
      .classes.has('is-ai-highlighted'),
  );
  assert.deepEqual(state.document, before);
  assert.equal(calls.persisted, 0);
  state.editable = true;
  state.saving = true;
  assert.throws(() => context.applyAssistantActions([action], { expectedVersion: 7 }), /只读|保存/);
  assert.deepEqual(state.document, before);
});

test('invalid mixed action batches cannot partially edit, highlight or run the circuit', () => {
  const { context, state, calls, components } = harness();
  const before = clone(state);
  assert.throws(
    () =>
      context.applyAssistantActions(
        [
          { type: 'highlight_components', componentIds: ['R1'] },
          { type: 'set_parameter', componentId: 'R1', parameter: 'resistance', value: 2000 },
          { type: 'run_simulation' },
          { type: 'move_component', componentId: 'R1', x: 100001, y: 0 },
        ],
        { expectedVersion: 7 },
      ),
    /画布范围/,
  );
  assert.deepEqual(clone(state), before);
  assert.ok(components.every((component) => !component.classes.has('is-ai-highlighted')));
  assert.equal(calls.runs, 0);
  assert.equal(calls.persisted, 0);
  assert.equal(calls.events.length, 0);
  assert.throws(
    () =>
      context.applyAssistantActions(
        [
          { type: 'set_parameter', componentId: 'R1', parameter: 'resistance', value: 2000 },
          { type: 'show_traces', traceIds: ['I:R1'] },
        ],
        { expectedVersion: 7 },
      ),
    /运行仿真/,
  );
  assert.deepEqual(clone(state), before);
});

test('a reviewed batch updates the draft once, runs the new circuit and can be undone as one edit', () => {
  const { context, state, calls, components } = harness();
  const original = clone(state.document);
  const snapshot = context.applyAssistantActions(
    [
      { type: 'set_parameter', componentId: 'R1', parameter: 'resistance', value: 2000 },
      { type: 'transform_component', componentId: 'R1', rotation: 90, mirrorX: true },
      { type: 'highlight_components', componentIds: ['R1'] },
      { type: 'show_traces', traceIds: ['I:R1'] },
      { type: 'run_simulation' },
    ],
    { expectedVersion: 7 },
  );
  assert.equal(snapshot.editVersion, 8);
  assert.equal(snapshot.canUndoAi, true);
  assert.equal(calls.persisted, 1);
  assert.equal(calls.runs, 1);
  const resistor = state.document.components.find((component) => component.id === 'R1');
  assert.equal(resistor.params.resistance, 2000);
  assert.equal(resistor.rotation, 90);
  assert.equal(resistor.mirrorX, true);
  assert.equal(state.result.traces.find((trace) => trace.id === 'I:R1').values[0], 0.0025);
  assert.deepEqual(clone(state.traceIds), ['I:R1']);
  assert.deepEqual(clone(state.aiHighlightedTraces), ['I:R1']);
  assert.ok(
    components
      .find((component) => component.dataset.componentId === 'R1')
      .classes.has('is-ai-highlighted'),
  );
  assert.equal(state.selectedId, '');
  assert.equal(calls.events.at(-1).detail.canUndoAi, true);
  const undone = context.undoAssistantActions();
  assert.deepEqual(state.document, original);
  assert.equal(undone.editVersion, 9);
  assert.equal(undone.canUndoAi, false);
  assert.equal(state.result, null);
  assert.equal(state.aiUndo, null);
  assert.equal(calls.persisted, 2);
  assert.ok(components.every((component) => !component.classes.has('is-ai-highlighted')));
  assert.throws(() => context.undoAssistantActions(), /无法撤销/);
});

test('manual changes and unfinished wire drawing prevent stale AI editing or undo', () => {
  const { context, state } = harness();
  state.wireStart = endpoint('R1');
  assert.throws(
    () =>
      context.applyAssistantActions(
        [{ type: 'move_component', componentId: 'R1', x: 300, y: 160 }],
        { expectedVersion: 7 },
      ),
    /导线/,
  );
  state.wireStart = null;
  context.applyAssistantActions([{ type: 'move_component', componentId: 'R1', x: 300, y: 160 }], {
    expectedVersion: 7,
  });
  assert.ok(state.result, 'moving geometry keeps the existing measurements');
  context.changed({ electrical: false });
  assert.throws(() => context.undoAssistantActions(), /无法撤销/);
  assert.equal(context.getAssistantSnapshot().canUndoAi, false);
});

test('visual requests update component and waveform classes, trace checkboxes and clearing without draft writes', () => {
  const { context, state, calls, components, checks, charts, grouped } = harness();
  const before = clone(state.document);
  context.applyAssistantActions(
    [
      { type: 'highlight_components', componentIds: ['R1'] },
      { type: 'show_traces', traceIds: ['V:R1'] },
    ],
    { expectedVersion: 7 },
  );
  assert.ok(
    components
      .find((component) => component.dataset.componentId === 'R1')
      .classes.has('is-ai-highlighted'),
  );
  assert.equal(checks.find((check) => check.dataset.trace === 'V:R1').checked, true);
  assert.equal(checks.find((check) => check.dataset.trace === 'I:R1').checked, false);
  assert.ok(
    charts.find((chart) => chart.dataset.traceId === 'V:R1').classes.has('is-ai-highlighted'),
  );
  assert.ok(grouped.classes.has('is-ai-highlighted'));
  assert.deepEqual(state.document, before);
  assert.equal(state.editVersion, 7);
  assert.equal(calls.persisted, 0);
  assert.equal(calls.runs, 0);
  context.clearAiHighlights();
  assert.ok(
    [...components, ...charts, grouped].every(
      (element) => !element.classes.has('is-ai-highlighted'),
    ),
  );
  assert.deepEqual(clone(state.aiHighlightedTraces), []);
  state.result = null;
  context.applyAssistantActions([{ type: 'show_traces', traceIds: [] }], { expectedVersion: 7 });
  assert.deepEqual(clone(state.traceIds), []);
});

test('simulation reruns preserve an explicit empty trace choice and new documents use defaults', () => {
  const { context, state, calls, elements } = harness();
  context.applyAssistantActions(
    [{ type: 'show_traces', traceIds: [] }, { type: 'run_simulation' }],
    { expectedVersion: 7 },
  );
  assert.equal(calls.runs, 1);
  assert.deepEqual(clone(state.traceIds), []);
  assert.equal(state.aiPendingTraces, null);
  assert.match(elements.waveform.textContent, /选择至少一条曲线/);
  assert.doesNotMatch(elements.traces.innerHTML, / checked/);
  context.applyAssistantActions([{ type: 'run_simulation' }], { expectedVersion: 7 });
  assert.equal(calls.runs, 2);
  assert.deepEqual(clone(state.traceIds), []);
  state.plotDisplay = null;
  context.showResult(engine.simulate(state.document));
  assert.deepEqual(clone(state.traceIds), ['V:V1', 'V:R1']);
  assert.equal(state.aiPendingTraces, null);
  assert.match(elements.traces.innerHTML, /data-trace="V:R1" checked/);
  assert.equal(calls.persisted, 0);
});

test('read-only local math and XY settings survive rerunning and remain out of the saved document', () => {
  const { context, state, elements } = harness();
  state.editable = false;
  state.dirty = false;
  const saved = JSON.stringify(state.document);
  const display = engine.normalizeDisplay({
    mode: 'xy',
    ch1: 'V:V1',
    ch2: 'V:R1',
    xyX: 'V:V1',
    xyY: 'M:M1',
    traceIds: ['M:M1'],
    math: [{ id: 'M1', expression: 'CH1-CH2' }],
  });
  context.updatePlot(display, { persist: true });
  assert.equal(state.dirty, false);
  assert.equal(state.plotModified, true);
  assert.equal(JSON.stringify(state.document), saved);
  context.showResult(engine.simulate(state.document));
  assert.deepEqual(clone(state.plotDisplay), display);
  assert.equal(elements['trace-picker'].hidden, true);
  assert.deepEqual(clone(state.plotResult.traces.find((trace) => trace.id === 'M:M1').values), [0]);
  assert.equal(context.getAssistantSnapshot().document.display.xyY, 'M:M1');
});

test('editable visual settings persist without invalidating physical results and are restored on rerun', () => {
  const { context, state, calls } = harness();
  const result = state.result;
  const display = engine.normalizeDisplay({
    mode: 'xt',
    ch1: 'V:R1',
    ch2: 'I:R1',
    traceIds: ['M:M1'],
    math: [{ id: 'M1', expression: 'CH1*CH2', unit: 'W' }],
    ranges: { yMin: 0, yMax: 1 },
  });
  context.updatePlot(display, { persist: true });
  assert.equal(state.result, result);
  assert.deepEqual(clone(state.document.display), display);
  assert.equal(calls.persisted, 1);
  context.showResult(engine.simulate(state.document));
  assert.deepEqual(clone(state.traceIds), ['M:M1']);
  assert.equal(state.plotResult.traces.find((trace) => trace.id === 'M:M1').values[0], 0.025);
});

test('AI show/hide traces switches XY to the requested time curves and survives the next run', () => {
  const { context, state, elements } = harness();
  state.plotDisplay = engine.normalizeDisplay({
    mode: 'xy',
    ch1: 'V:V1',
    ch2: 'V:R1',
    traceIds: ['V:V1'],
  });
  context.applyAssistantActions([{ type: 'show_traces', traceIds: ['I:R1'] }], {
    expectedVersion: 7,
  });
  assert.equal(state.plotDisplay.mode, 'xt');
  assert.deepEqual(clone(state.plotDisplay.traceIds), ['I:R1']);
  assert.equal(elements['trace-picker'].hidden, false);
  context.showResult(engine.simulate(state.document));
  assert.deepEqual(clone(state.traceIds), ['I:R1']);
  context.applyAssistantActions([{ type: 'show_traces', traceIds: [] }], { expectedVersion: 7 });
  assert.match(elements.waveform.textContent, /选择至少一条曲线/);
});

test('Max configures mathematical XY curves and annotates the new result atomically without rerunning, with one-step undo', () => {
  const { context, state, calls } = harness();
  context.showResult(state.result);
  const previous = clone(state.plotDisplay);
  const physicalResult = state.result;
  const actions = [
    {
      type: 'set_plot',
      display: {
        mode: 'xy',
        ch1: 'V:V1',
        ch2: 'I:R1',
        xyX: 'V:V1',
        xyY: 'M:M1',
        traceIds: ['V:V1', 'M:M1'],
        math: [{ id: 'M1', expression: 'CH1*CH2', unit: 'W' }],
      },
    },
    {
      type: 'set_annotation',
      annotation: {
        id: 'A1',
        traceId: 'M:M1',
        at: 0,
        text: '电阻消耗功率',
        mode: 'xy',
        axis: 'value',
        xTraceId: 'V:V1',
        analysisKey: 'dc',
      },
    },
  ];
  context.applyAssistantActions(actions, { expectedVersion: state.editVersion });
  assert.equal(state.result, physicalResult);
  assert.equal(calls.runs, 0);
  assert.equal(state.plotDisplay.mode, 'xy');
  assert.equal(state.document.display.annotations[0].text, '电阻消耗功率');
  assert.equal(state.plotResult.traces.find((trace) => trace.id === 'M:M1').values[0], 0.025);
  const snapshot = clone(context.getAssistantSnapshot());
  assert.equal(
    snapshot.simulation.traces.find((trace) => trace.id === 'M:M1').maxPoint.value,
    0.025,
  );
  assert.doesNotThrow(() =>
    validateCircuitAssistantInput({
      question: '解释标记的功率',
      document: snapshot.document,
      simulation: snapshot.simulation,
    }),
  );
  context.undoAssistantActions();
  assert.equal(state.result, physicalResult);
  assert.deepEqual(clone(state.plotDisplay), previous);
  assert.equal(state.plotDisplay.annotations, undefined);
});

test('bad math or an invalid new annotation rolls back the entire Max plot batch', () => {
  for (const actions of [
    [
      {
        type: 'set_plot',
        display: { ch1: 'V:V1', ch2: 'V:R1', math: [{ id: 'M1', expression: 'CH1/0' }] },
      },
    ],
    [
      {
        type: 'set_plot',
        display: { mode: 'xy', ch1: 'V:V1', ch2: 'I:R1', xyX: 'V:V1', xyY: 'I:R1' },
      },
      {
        type: 'set_annotation',
        annotation: {
          id: 'A1',
          traceId: 'I:R1',
          at: 100,
          text: '无效点',
          mode: 'xy',
          axis: 'value',
          xTraceId: 'V:V1',
          analysisKey: 'dc',
        },
      },
    ],
  ]) {
    const { context, state, calls } = harness();
    context.showResult(state.result);
    const before = clone({
      document: state.document,
      display: state.plotDisplay,
      editVersion: state.editVersion,
    });
    assert.throws(
      () => context.applyAssistantActions(actions, { expectedVersion: state.editVersion }),
      /无法|有效|范围/,
    );
    assert.deepEqual(
      clone({
        document: state.document,
        display: state.plotDisplay,
        editVersion: state.editVersion,
      }),
      before,
    );
    assert.equal(calls.persisted, 0);
    assert.equal(state.aiUndo, null);
  }
});

test('annotation-only Max edits and deletion keep existing simulations available and undo safely', () => {
  const { context, state } = harness();
  context.showResult(state.result);
  const original = state.result;
  const annotation = annotationModel.create(state.result, state.plotDisplay, {
    id: 'A1',
    traceId: 'V:R1',
    at: 0,
    text: '5 V',
  });
  context.applyAssistantActions([{ type: 'set_annotation', annotation }], {
    expectedVersion: state.editVersion,
  });
  assert.equal(state.result, original);
  assert.equal(state.document.display.annotations.length, 1);
  context.applyAssistantActions([{ type: 'delete_annotation', annotationId: 'A1' }], {
    expectedVersion: state.editVersion,
  });
  assert.deepEqual(clone(state.document.display.annotations), []);
  context.undoAssistantActions();
  assert.equal(state.result, original);
  assert.equal(state.document.display.annotations[0].text, '5 V');
});

test('Max receives actual extrema positions and phase samples instead of inferred peak locations', () => {
  const document = fixture();
  document.analysis = { type: 'ac', start: 10, stop: 1000, points: 100, scale: 'log' };
  const { context, state } = harness({ document });
  const trace = state.result.traces.find((item) => item.id === 'V:R1');
  trace.values[47] = 17;
  trace.phase[47] = -90;
  context.showResult(state.result);
  const snapshot = clone(context.getAssistantSnapshot());
  const summary = snapshot.simulation.traces.find((item) => item.id === trace.id);
  assert.deepEqual(summary.maxPoint, { x: state.result.x[47], value: 17 });
  assert.deepEqual(summary.phaseMinPoint, { x: state.result.x[47], value: -90 });
  assert.ok(summary.samples.some((sample) => typeof sample.phase === 'number'));
  assert.equal(summary.samples.length, 64);
  assert.doesNotThrow(() =>
    validateCircuitAssistantInput({
      question: '标注真实峰值',
      document: snapshot.document,
      simulation: snapshot.simulation,
    }),
  );
});

test('Max receives derived waveform warnings alongside solver warnings', () => {
  const { context, state } = harness();
  state.result.warnings = ['原始仿真提示'];
  state.plotResult = {
    ...state.result,
    warnings: ['原始仿真提示', 'M1 有 2 个无效采样点，已显示为断点。'],
  };
  const snapshot = clone(context.getAssistantSnapshot());
  assert.deepEqual(snapshot.simulation.warnings, state.plotResult.warnings);
  assert.deepEqual(state.result.warnings, ['原始仿真提示']);
});

test('autonomous steps wait for the worker, use its measurements for math and annotations, and undo the entire run', async () => {
  const { context, state, workers, calls } = harness({ realWorker: true });
  context.showResult(state.result);
  const before = clone(context.getAssistantSnapshot().document);
  const originalResult = state.result;
  const { runId, snapshot } = context.beginAgentRun();
  let completed = false;
  const solving = context
    .executeAgentActions(
      [
        { type: 'set_parameter', componentId: 'R1', parameter: 'resistance', value: 2000 },
        { type: 'run_simulation' },
      ],
      { runId, expectedVersion: snapshot.editVersion },
    )
    .then((result) => {
      completed = true;
      return result;
    });
  await Promise.resolve();
  assert.equal(completed, false);
  assert.equal(context.getAssistantSnapshot().isSimulationRunning, true);
  assert.equal(context.getAssistantSnapshot().simulation, null);
  assert.equal(
    workers[0].request.document.components.find((row) => row.id === 'R1').params.resistance,
    2000,
  );
  workers[0].respond();
  const measured = await solving;
  assert.equal(measured.isSimulationRunning, false);
  assert.equal(measured.simulation.traces.find((trace) => trace.id === 'I:R1').latest, 0.0025);
  assert.equal(measured.canUndoAi, false);
  const plotted = await context.executeAgentActions(
    [
      {
        type: 'set_plot',
        display: {
          mode: 'xy',
          ch1: 'V:V1',
          ch2: 'I:R1',
          xyX: 'V:V1',
          xyY: 'M:M1',
          traceIds: ['M:M1'],
          math: [{ id: 'M1', expression: 'CH1*CH2', unit: 'W' }],
        },
      },
    ],
    { runId, expectedVersion: measured.editVersion },
  );
  const point = plotted.simulation.traces.find((trace) => trace.id === 'M:M1').maxPoint;
  assert.equal(point.value, 0.0125);
  const annotated = await context.executeAgentActions(
    [
      {
        type: 'set_annotation',
        annotation: {
          id: 'A1',
          traceId: 'M:M1',
          at: point.x,
          text: '计算后的功率',
          mode: 'xy',
          axis: 'value',
          xTraceId: 'V:V1',
          analysisKey: 'dc',
        },
      },
    ],
    { runId, expectedVersion: plotted.editVersion },
  );
  assert.equal(annotated.document.display.annotations[0].text, '计算后的功率');
  assert.equal(calls.runs, 1);
  assert.throws(() => context.undoAssistantActions(), /先停止/);
  assert.equal(context.endAgentRun(runId).canUndoAi, true);
  assert.deepEqual(clone(context.undoAssistantActions().document), before);
  assert.equal(state.result, originalResult);
  assert.equal(calls.runs, 1);
});

test('solver failure returns an actionable observation and permits a corrective next step', async () => {
  const { context, state, workers } = harness({ realWorker: true });
  const { runId, snapshot } = context.beginAgentRun();
  const first = context.executeAgentActions(
    [
      { type: 'set_parameter', componentId: 'R1', parameter: 'resistance', value: 2000 },
      { type: 'run_simulation' },
    ],
    { runId, expectedVersion: snapshot.editVersion },
  );
  workers[0].respond({ error: '矩阵奇异：请检查浮空节点与接地连接。' });
  await assert.rejects(
    first,
    (error) => error.code === 'SIMULATION_FAILED' && /浮空节点/.test(error.message),
  );
  const failed = context.getAssistantSnapshot();
  assert.match(failed.simulationError, /浮空节点/);
  assert.equal(failed.simulation, null);
  assert.equal(failed.isSimulationRunning, false);
  assert.equal(state.document.components.find((row) => row.id === 'R1').params.resistance, 2000);
  const retry = context.executeAgentActions([{ type: 'run_simulation' }], {
    runId,
    expectedVersion: failed.editVersion,
  });
  workers[1].respond();
  const done = await retry;
  assert.equal(done.simulationError, null);
  assert.equal(done.simulation.traces.find((trace) => trace.id === 'I:R1').latest, 0.0025);
  context.endAgentRun(runId);
  assert.equal(
    context.undoAssistantActions().document.components.find((row) => row.id === 'R1').params
      .resistance,
    1000,
  );
});

test('stopping an agent cancels its worker, ignores late completion, and leaves one undo for completed edits', async () => {
  const { context, state, workers } = harness({ realWorker: true });
  const controller = new AbortController();
  const { runId, snapshot } = context.beginAgentRun();
  const pending = context.executeAgentActions(
    [
      { type: 'set_parameter', componentId: 'R1', parameter: 'resistance', value: 3000 },
      { type: 'run_simulation' },
    ],
    { runId, expectedVersion: snapshot.editVersion, signal: controller.signal },
  );
  controller.abort();
  await assert.rejects(pending, (error) => error.code === 'AGENT_STOPPED');
  assert.equal(workers[0].terminated, true);
  workers[0].respond();
  assert.equal(state.result, null);
  await assert.rejects(
    context.executeAgentActions([{ type: 'run_simulation' }], {
      runId,
      expectedVersion: state.editVersion,
    }),
    (error) => error.code === 'AGENT_STOPPED',
  );
  context.endAgentRun(runId);
  assert.equal(
    context.undoAssistantActions().document.components.find((row) => row.id === 'R1').params
      .resistance,
    1000,
  );
});

test('manual edits during a solve terminate the run and are never overwritten by end or late worker output', async () => {
  const { context, state, workers } = harness({ realWorker: true });
  const { runId, snapshot } = context.beginAgentRun();
  const pending = context.executeAgentActions([{ type: 'run_simulation' }], {
    runId,
    expectedVersion: snapshot.editVersion,
  });
  state.document.components.find((row) => row.id === 'R1').params.resistance = 4700;
  context.changed();
  await assert.rejects(pending, (error) => error.code === 'AGENT_STALE');
  assert.equal(workers[0].terminated, true);
  workers[0].respond();
  const ended = context.endAgentRun(runId);
  assert.equal(ended.document.components.find((row) => row.id === 'R1').params.resistance, 4700);
  assert.equal(ended.canUndoAi, false);
  assert.equal(state.result, null);
});

test('loading a circuit or changing the account invalidates a waiting agent even without a change callback', async () => {
  for (const change of [
    (state) => {
      state.generation += 1;
    },
    (state) => {
      state.sessionUid = 'different-reader';
    },
    (state) => {
      state.cid = 'c_abcdefabcdefabcdefabcdef';
    },
  ]) {
    const { context, state, workers } = harness({ realWorker: true });
    const { runId, snapshot } = context.beginAgentRun();
    const pending = context.executeAgentActions([{ type: 'run_simulation' }], {
      runId,
      expectedVersion: snapshot.editVersion,
    });
    change(state);
    context.notifyCircuitEditor();
    await assert.rejects(pending, (error) => error.code === 'AGENT_STALE');
    assert.equal(workers[0].terminated, true);
    context.endAgentRun(runId);
    assert.equal(state.aiUndo, null);
  }
});

test('pending manual annotation edits are committed before checking the agent version', async () => {
  const { context, state } = harness({ realWorker: true });
  const { runId, snapshot } = context.beginAgentRun();
  context.validateParameterInputs = () => {
    state.document.components.find((row) => row.id === 'R1').params.resistance = 6800;
    context.changed();
    context.validateParameterInputs = () => true;
    return true;
  };
  await assert.rejects(
    context.executeAgentActions(
      [{ type: 'set_parameter', componentId: 'R1', parameter: 'resistance', value: 2000 }],
      { runId, expectedVersion: snapshot.editVersion },
    ),
    (error) => error.code === 'AGENT_STALE',
  );
  context.endAgentRun(runId);
  assert.equal(state.document.components.find((row) => row.id === 'R1').params.resistance, 6800);
  assert.equal(state.aiUndo, null);
});

test('agent worker timeouts and startup errors settle with retryable diagnostics', async () => {
  for (const failure of ['timeout', 'thread']) {
    const { context, state, workers, timers } = harness({ realWorker: true });
    const { runId, snapshot } = context.beginAgentRun();
    const pending = context.executeAgentActions([{ type: 'run_simulation' }], {
      runId,
      expectedVersion: snapshot.editVersion,
    });
    if (failure === 'timeout') [...timers.values()][0]();
    else workers[0].onerror();
    await assert.rejects(
      pending,
      (error) =>
        error.code === (failure === 'timeout' ? 'SIMULATION_TIMEOUT' : 'SIMULATION_FAILED'),
    );
    assert.equal(state.worker, null);
    assert.equal(timers.size, 0);
    assert.match(
      context.getAssistantSnapshot().simulationError,
      failure === 'timeout' ? /20 秒/ : /线程/,
    );
    context.endAgentRun(runId);
  }
});

test('empty or rejected runs preserve earlier undo and end is idempotent', async () => {
  const { context, state } = harness({ realWorker: true });
  context.applyAssistantActions([{ type: 'move_component', componentId: 'R1', x: 300, y: 160 }], {
    expectedVersion: 7,
  });
  const priorUndo = state.aiUndo;
  const { runId, snapshot } = context.beginAgentRun();
  await assert.rejects(
    context.executeAgentActions([{ type: 'move_component', componentId: 'R1', x: 100001, y: 0 }], {
      runId,
      expectedVersion: snapshot.editVersion,
    }),
    /范围/,
  );
  assert.equal(context.endAgentRun('obsolete-id').canUndoAi, false);
  context.endAgentRun(runId);
  assert.equal(state.aiUndo, priorUndo);
  context.endAgentRun(runId);
  assert.equal(state.aiUndo, priorUndo);
  assert.equal(
    context.undoAssistantActions().document.components.find((row) => row.id === 'R1').x,
    240,
  );
});

test('agent start rejects unfinished wires and ongoing work without replacing their state', () => {
  const { context, state } = harness({ realWorker: true });
  state.wireStart = endpoint('R1');
  assert.throws(() => context.beginAgentRun(), /导线/);
  state.wireStart = null;
  state.saving = true;
  assert.throws(
    () => context.beginAgentRun(),
    (error) => error.code === 'AGENT_BUSY',
  );
  state.saving = false;
  const run = context.beginAgentRun();
  assert.throws(
    () => context.beginAgentRun(),
    (error) => error.code === 'AGENT_BUSY',
  );
  context.endAgentRun(run.runId);
});

test('ending a waiting run releases its worker even without an abort signal', async () => {
  const { context, state, workers } = harness({ realWorker: true });
  const { runId, snapshot } = context.beginAgentRun();
  const pending = context.executeAgentActions([{ type: 'run_simulation' }], {
    runId,
    expectedVersion: snapshot.editVersion,
  });
  context.endAgentRun(runId);
  await assert.rejects(pending, (error) => error.code === 'AGENT_STOPPED');
  assert.equal(workers[0].terminated, true);
  workers[0].respond();
  assert.equal(state.result, null);
  const next = context.beginAgentRun();
  const solving = context.executeAgentActions([{ type: 'run_simulation' }], {
    runId: next.runId,
    expectedVersion: next.snapshot.editVersion,
  });
  workers[0].respond();
  assert.equal(state.result, null);
  workers[1].respond();
  assert.ok((await solving).simulation);
  context.endAgentRun(next.runId);
});

test('manual simulation retains a handled completion promise and invalid parameter failures settle without a worker', async () => {
  const { context, state, workers } = harness({ realWorker: true });
  const pending = context.runSimulation();
  workers[0].respond({ error: '电路没有参考地。' });
  await assert.rejects(pending, /参考地/);
  assert.match(state.simulationError, /参考地/);
  context.validateParameterInputs = () => false;
  await assert.rejects(
    context.runSimulation(),
    (error) => error.code === 'SIMULATION_FAILED' && /参数/.test(error.message),
  );
  assert.equal(workers.length, 1);
  assert.equal(state.worker, null);
});

test('read-only autonomous waveform viewing never offers an unavailable draft undo', async () => {
  const { context, state } = harness({ realWorker: true });
  state.editable = false;
  context.showResult(state.result);
  const before = clone(state.document);
  const { runId, snapshot } = context.beginAgentRun();
  const viewed = await context.executeAgentActions([{ type: 'show_traces', traceIds: [] }], {
    runId,
    expectedVersion: snapshot.editVersion,
  });
  assert.deepEqual(clone(viewed.document.display.traceIds), []);
  const ended = context.endAgentRun(runId);
  assert.equal(ended.canEdit, false);
  assert.equal(ended.canUndoAi, false);
  assert.equal(state.aiUndo, null);
  assert.deepEqual(clone(state.document), before);
});

test('starting an unfinished wire takes over from the agent and preserves the manual wire draft', async () => {
  const { context, state } = harness({ realWorker: true });
  const { runId, snapshot } = context.beginAgentRun();
  await context.executeAgentActions(
    [{ type: 'set_parameter', componentId: 'R1', parameter: 'resistance', value: 2000 }],
    { runId, expectedVersion: snapshot.editVersion },
  );
  const wireStart = endpoint('R1');
  state.wireStart = wireStart;
  state.wirePoints = [{ x: 350, y: 160 }];
  context.notifyCircuitEditor();
  assert.equal(context.getAssistantSnapshot().isWiring, true);
  await assert.rejects(
    context.executeAgentActions([{ type: 'highlight_components', componentIds: ['R1'] }], {
      runId,
      expectedVersion: state.editVersion,
    }),
    (error) => error.code === 'AGENT_STALE',
  );
  const ended = context.endAgentRun(runId);
  assert.equal(ended.canUndoAi, false);
  assert.equal(state.wireStart, wireStart);
  assert.deepEqual(state.wirePoints, [{ x: 350, y: 160 }]);
  assert.equal(state.document.components.find((row) => row.id === 'R1').params.resistance, 2000);
  assert.deepEqual(clone(state.aiHighlightedComponents), []);
  assert.throws(() => context.undoAssistantActions(), /无法撤销/);
  assert.equal(state.wireStart, wireStart);
});

test('a manual wire started during an agent solve cancels the worker and keeps its draft points', async () => {
  const { context, state, workers } = harness({ realWorker: true });
  const { runId, snapshot } = context.beginAgentRun();
  const solving = context.executeAgentActions([{ type: 'run_simulation' }], {
    runId,
    expectedVersion: snapshot.editVersion,
  });
  state.wireStart = endpoint('V1');
  state.wirePoints = [{ x: 150, y: 200 }];
  context.notifyCircuitEditor();
  await assert.rejects(solving, (error) => error.code === 'AGENT_STALE');
  assert.equal(workers[0].terminated, true);
  workers[0].respond();
  assert.equal(state.result, null);
  context.endAgentRun(runId);
  assert.deepEqual(state.wireStart, endpoint('V1'));
  assert.deepEqual(state.wirePoints, [{ x: 150, y: 200 }]);
  assert.equal(state.aiUndo, null);
});

test('Max generation beautifies the entire batch before simulation and undo restores the pre-generation draft', async () => {
  const empty = engine.validateDocument({ version: 1, components: [], wires: [] });
  const { context, state, workers } = harness({
    document: empty,
    measured: false,
    realWorker: true,
  });
  const { runId, snapshot } = context.beginAgentRun();
  const blueprint = fixture();
  const actions = [
    ...blueprint.components.map((component) => ({
      type: 'add_component',
      component: { ...component, x: component.x + 7 },
    })),
    ...blueprint.wires.map(({ from, to }) => ({ type: 'connect', from, to, points: [] })),
    { type: 'run_simulation' },
  ];
  const pending = context.executeAgentActions(actions, {
    runId,
    expectedVersion: snapshot.editVersion,
  });
  assert.equal(workers.length, 1);
  const simulated = workers[0].request.document;
  const { getWireRoute } = require('../public/circuit-renderer');
  simulated.components.forEach(({ x, y }) => {
    assert.equal(x % 20, 0);
    assert.equal(y % 20, 0);
  });
  simulated.wires.forEach((wire) => {
    const route = getWireRoute(wire, simulated.components);
    assert.ok(
      route.every((point, i) => !i || point.x === route[i - 1].x || point.y === route[i - 1].y),
    );
  });
  assert.deepEqual(clone(state.document), simulated);
  workers[0].respond();
  await pending;
  context.endAgentRun(runId);
  assert.equal(state.result.traces.find((trace) => trace.id === 'V:R1').values[0], 5);
  assert.deepEqual(clone(context.undoAssistantActions().document), empty);
});

test('automatic beautification failure cannot partially apply Max edits or visual effects', () => {
  const { context, state, calls } = harness();
  const before = clone(state);
  context.window.FreeBbsCircuitLayout = {
    normalizeCircuitLayout() {
      throw new Error('layout failed');
    },
  };
  assert.throws(
    () =>
      context.applyAssistantActions(
        [
          { type: 'set_parameter', componentId: 'R1', parameter: 'resistance', value: 2000 },
          { type: 'highlight_components', componentIds: ['R1'] },
        ],
        { expectedVersion: 7 },
      ),
    /layout failed/,
  );
  assert.deepEqual(clone(state), before);
  assert.equal(calls.persisted, 0);
  assert.equal(calls.events.length, 0);
  context.applyAssistantActions([{ type: 'highlight_components', componentIds: ['R1'] }], {
    expectedVersion: 7,
  });
  assert.deepEqual(
    clone(state.document),
    before.document,
    'view-only Max actions do not invoke layout',
  );
});
