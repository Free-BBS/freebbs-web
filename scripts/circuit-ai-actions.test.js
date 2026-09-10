const assert = require('node:assert/strict');
const test = require('node:test');
const engine = require('../public/circuit-engine');
const actionsApi = require('../public/circuit-ai-actions');

const { validateActions, applyActions, validateEditorDocument } = actionsApi;
const endpoint = (componentId, pin = 0) => ({ componentId, pin });
function fixture() {
  return engine.validateDocument({
    version: 1,
    components: [
      { id: 'V1', type: 'voltage', x: 120, y: 160, params: { dc: 5 } },
      { id: 'R1', type: 'resistor', x: 320, y: 160, params: { resistance: 1000 } },
      { id: 'G1', type: 'ground', x: 320, y: 320 },
    ],
    wires: [
      { id: 'w1', from: endpoint('V1'), to: endpoint('R1') },
      { id: 'w2', from: endpoint('V1', 1), to: endpoint('G1') },
      { id: 'w3', from: endpoint('R1', 1), to: endpoint('G1') },
    ],
    analysis: { type: 'dc' },
  });
}

test('AI edits preserve the input and produce independently validated geometry, parameters, connections and simulation', () => {
  const input = fixture();
  const before = structuredClone(input);
  const actions = [
    { type: 'set_parameter', componentId: 'R1', parameter: 'resistance', value: 2000 },
    { type: 'transform_component', componentId: 'R1', rotation: 90, mirrorX: true, mirrorY: false },
    { type: 'move_component', componentId: 'R1', x: 400, y: 200 },
    {
      type: 'add_component',
      component: { id: 'C1', type: 'capacitor', x: 500, y: 160, params: { capacitance: 0.000001 } },
    },
    { type: 'connect', from: endpoint('C1'), to: endpoint('R1'), points: [{ x: 500, y: 200 }] },
    { type: 'connect', from: endpoint('C1', 1), to: endpoint('G1') },
    {
      type: 'set_analysis',
      analysis: { type: 'transient', stop: 0.01, step: 0.001, initial: 'operating-point' },
    },
    { type: 'highlight_components', componentIds: ['R1', 'C1'] },
    { type: 'run_simulation' },
  ];
  const validated = validateActions(actions, input);
  assert.deepEqual(validated, actions);
  assert.notEqual(validated, actions);
  const edited = applyActions(input, validated);
  assert.deepEqual(input, before);
  assert.equal(edited.components.find((component) => component.id === 'R1').mirrorX, true);
  assert.equal(edited.components.find((component) => component.id === 'R1').rotation, 90);
  assert.equal(edited.wires.at(-1).id, 'w5');
  assert.deepEqual(edited.wires.at(-2).points, [{ x: 500, y: 200 }]);
  assert.deepEqual(edited, engine.validateDocument(edited));
  const result = engine.simulate(edited);
  assert.equal(result.traces.find((trace) => trace.id === 'I:R1').values.at(-1), 0.0025);
  assert.equal(result.x.length, 11);
  edited.components[0].params.dc = 99;
  assert.deepEqual(input, before);
});

test('an invalid later edit rejects the entire batch and cannot be concealed by a later valid overwrite', () => {
  const input = fixture();
  const before = structuredClone(input);
  const actions = [
    { type: 'set_parameter', componentId: 'R1', parameter: 'resistance', value: 2000 },
    { type: 'set_parameter', componentId: 'R1', parameter: 'resistance', value: -1 },
    { type: 'set_parameter', componentId: 'R1', parameter: 'resistance', value: 3000 },
  ];
  assert.throws(() => validateActions(actions, input), /大于 0/);
  assert.throws(() => applyActions(input, actions), /大于 0/);
  assert.deepEqual(input, before);
});

test('visual operations only reference real surviving components and measured traces', () => {
  const input = fixture();
  const visual = [
    { type: 'highlight_components', componentIds: ['R1'] },
    { type: 'show_traces', traceIds: ['V:R1', 'I:R1'] },
  ];
  assert.deepEqual(validateActions(visual, input, ['V:R1', 'I:R1']), visual);
  assert.deepEqual(applyActions(input, visual), input);
  assert.throws(() => validateActions(visual, input, []), /先运行仿真/);
  assert.throws(
    () => validateActions([{ type: 'show_traces', traceIds: ['V:G1'] }], input, ['V:G1']),
    /不存在/,
  );
  assert.throws(
    () => validateActions([{ type: 'highlight_components', componentIds: ['Missing'] }], input),
    /不存在/,
  );
  assert.throws(
    () => validateActions([visual[0], { type: 'delete_component', componentId: 'R1' }], input),
    /已被本次操作删除/,
  );
  assert.throws(
    () => applyActions(input, [{ type: 'show_traces', traceIds: ['V:Missing'] }]),
    /不存在/,
  );
  assert.throws(
    () =>
      validateActions(
        [
          { type: 'set_parameter', componentId: 'R1', parameter: 'resistance', value: 2000 },
          { type: 'show_traces', traceIds: ['I:R1'] },
        ],
        input,
        ['I:R1'],
      ),
    /同一批操作中运行仿真/,
  );
  assert.deepEqual(
    validateActions(
      [
        { type: 'highlight_components', componentIds: [] },
        { type: 'show_traces', traceIds: [] },
      ],
      input,
    ),
    [
      { type: 'highlight_components', componentIds: [] },
      { type: 'show_traces', traceIds: [] },
    ],
  );
});

test('deletion removes incident wires and requires the scan target to be changed first', () => {
  const input = fixture();
  input.analysis = {
    type: 'sweep',
    componentId: 'R1',
    parameter: 'resistance',
    start: 100,
    stop: 1000,
    points: 10,
  };
  assert.throws(
    () => applyActions(input, [{ type: 'delete_component', componentId: 'R1' }]),
    /扫描目标/,
  );
  const edited = applyActions(input, [
    { type: 'set_analysis', analysis: { type: 'dc' } },
    { type: 'delete_component', componentId: 'R1' },
  ]);
  assert.deepEqual(
    edited.wires.map((wire) => wire.id),
    ['w2'],
  );
  assert.equal(edited.components.length, 2);
});

test('unknown fields, dangerous keys, invalid bounds and coercible identifiers are rejected', () => {
  const input = fixture();
  const invalid = [
    { type: 'run_code', code: 'alert(1)' },
    { type: ['run_simulation'] },
    { type: 'run_simulation', url: 'https://example.com' },
    { type: 'set_parameter', componentId: 'R1', parameter: ['resistance'], value: 2 },
    { type: 'set_parameter', componentId: 'R1', parameter: 'voltage', value: 2 },
    { type: 'set_parameter', componentId: 'R1', parameter: 'resistance', value: Infinity },
    { type: 'move_component', componentId: 'R1', x: 100001, y: 0 },
    { type: 'move_component', componentId: 'R1', x: null, y: 0 },
    { type: 'transform_component', componentId: 'R1', rotation: null },
    { type: 'transform_component', componentId: 'R1', rotation: 45 },
    { type: 'transform_component', componentId: 'R1', mirrorY: 1 },
    { type: 'transform_component', componentId: 'R1' },
    { type: 'highlight_components', componentIds: ['R1', 'R1'] },
    { type: 'add_component', component: { id: 'R1', type: 'resistor', x: 0, y: 0 } },
    { type: 'add_component', component: { id: 'R2', type: 'resistor', x: 0, y: 0, onclick: 'x' } },
    { type: 'connect', from: endpoint('R1'), to: endpoint('V1') },
    { type: 'connect', from: endpoint('R1', 4), to: endpoint('G1') },
    { type: 'connect', from: endpoint('R1'), to: endpoint('R1') },
    {
      type: 'connect',
      from: endpoint('V1'),
      to: endpoint('G1'),
      points: Array(33).fill({ x: 0, y: 0 }),
    },
    {
      type: 'connect',
      from: endpoint('V1'),
      to: endpoint('G1'),
      points: [{ x: 0, y: 0, code: '' }],
    },
    { type: 'set_analysis', analysis: { type: 'dc', stop: 10 } },
    { type: 'set_analysis', analysis: { type: 'transient', stop: 100, step: 0.000001 } },
    JSON.parse('{"type":"run_simulation","__proto__":{"polluted":true}}'),
  ];
  const before = structuredClone(input);
  invalid.forEach((action) =>
    assert.throws(() => validateActions([action], input), JSON.stringify(action)),
  );
  assert.throws(() => validateActions(Array(13).fill({ type: 'run_simulation' }), input), /12/);
  assert.deepEqual(input, before);
  assert.equal({}.polluted, undefined);
  assert.throws(() => validateEditorDocument({ ...input, hiddenInstructions: 'x' }), /不支持/);
  const pollutedComponent = structuredClone(input);
  pollutedComponent.components[0].params.hidden = 1;
  assert.throws(() => validateEditorDocument(pollutedComponent), /不支持/);
});

test('nonlinear parameter actions use the existing expression parser and never evaluate JavaScript', () => {
  const input = fixture();
  const add = {
    type: 'add_component',
    component: { id: 'N1', type: 'nonlinear', x: 0, y: 0, params: { expression: 'i=k*u^3' } },
  };
  assert.equal(applyActions(input, [add]).components.at(-1).params.expression, 'i=k*u^3');
  assert.throws(
    () =>
      applyActions(input, [
        add,
        {
          type: 'set_parameter',
          componentId: 'N1',
          parameter: 'expression',
          value: 'globalThis.alert(1)',
        },
      ]),
    /非法字符|不支持/,
  );
});

test('descriptions expose parameters and distinguish edits from local display and simulation', () => {
  const edit = { type: 'set_parameter', componentId: 'R1', parameter: 'resistance', value: 2500 };
  assert.equal(actionsApi.isEditingAction(edit), true);
  assert.match(actionsApi.describeAction(edit), /R1.*电阻.*2500 Ω/);
  assert.match(
    actionsApi.describeAction({
      type: 'set_parameter',
      componentId: 'H1',
      parameter: 'control',
      value: 'dc',
    }),
    /控制电流元件 dc/,
  );
  assert.equal(actionsApi.isEditingAction({ type: 'run_simulation' }), false);
  assert.equal(actionsApi.isEditingAction({ type: 'show_traces', traceIds: [] }), false);
  assert.equal(actionsApi.isEditingAction({ type: 'unknown' }), false);
});

function annotationFixture() {
  const input = fixture();
  input.analysis = { type: 'transient', stop: 0.01, step: 0.001, initial: 'zero' };
  input.display = engine.normalizeDisplay({
    mode: 'xt',
    traceIds: ['V:R1'],
    ch1: 'V:R1',
    ch2: 'I:R1',
  });
  return input;
}

function annotation(overrides = {}) {
  return {
    id: 'A1',
    traceId: 'V:R1',
    at: 0.005,
    text: '采样峰值',
    mode: 'xt',
    axis: 'value',
    xTraceId: null,
    analysisKey: 'transient',
    ...overrides,
  };
}

test('annotation actions create and change vertical, horizontal and point markers without changing electrical results', () => {
  const input = annotationFixture();
  const before = structuredClone(input);
  const add = { type: 'set_annotation', annotation: annotation({ marker: 'vertical' }) };
  const validated = validateActions([add], input, ['V:R1']);
  const added = applyActions(input, validated);
  assert.deepEqual(input, before);
  assert.deepEqual(added.display.annotations, [add.annotation]);
  assert.equal(actionsApi.isEditingAction(add), true);
  assert.equal(actionsApi.isElectricalAction(add), false);
  assert.deepEqual(engine.simulate(added), engine.simulate(input));
  assert.match(actionsApi.describeAction(add), /A1.*V:R1.*时间 0.005 s.*采样峰值/);
  const update = {
    type: 'set_annotation',
    annotation: annotation({ at: 0.006, text: '', marker: 'horizontal' }),
  };
  const updated = applyActions(added, validateActions([update], added, ['V:R1']));
  assert.equal(updated.display.annotations.length, 1);
  assert.equal(updated.display.annotations[0].text, '');
  assert.equal(updated.display.annotations[0].at, 0.006);
  assert.equal(updated.display.annotations[0].marker, 'horizontal');
  const textOnly = { type: 'set_annotation', annotation: annotation({ text: '仅修改说明' }) };
  const relabeled = applyActions(updated, validateActions([textOnly], updated, ['V:R1']));
  assert.deepEqual(relabeled.display.annotations, [
    { ...textOnly.annotation, marker: 'horizontal' },
  ]);
  const point = { type: 'set_annotation', annotation: annotation({ marker: 'point' }) };
  const pointed = applyActions(relabeled, validateActions([point], relabeled, ['V:R1']));
  assert.deepEqual(pointed.display.annotations, [point.annotation]);
  assert.deepEqual(engine.simulate(pointed), engine.simulate(input));
  const remove = { type: 'delete_annotation', annotationId: 'A1' };
  const removed = applyActions(pointed, validateActions([remove], pointed, []));
  assert.deepEqual(removed.display.annotations, []);
  assert.equal(actionsApi.isEditingAction(remove), true);
  assert.equal(actionsApi.isElectricalAction(remove), false);
  assert.match(actionsApi.describeAction(remove), /删除标记 A1/);
  for (const type of ['move_component', 'transform_component', 'show_traces', 'run_simulation'])
    assert.equal(actionsApi.isElectricalAction({ type }), false);
  assert.equal(actionsApi.isElectricalAction({ type: 'set_parameter' }), true);
});

test('annotation validation rejects unknown fields, missing traces and mismatched coordinates atomically', () => {
  const input = annotationFixture();
  const before = structuredClone(input);
  const invalid = [
    annotation({ text: 'x'.repeat(161) }),
    annotation({ id: 'A<script>' }),
    annotation({ traceId: 'V:Missing' }),
    annotation({ at: Infinity }),
    annotation({ at: -0.001 }),
    annotation({ at: 0.011 }),
    annotation({ analysisKey: 'ac' }),
    annotation({ mode: 'xy', xTraceId: 'I:R1' }),
    annotation({ axis: 'phase' }),
    annotation({ traceId: 'I:R1' }),
    ...[null, '', {}, [], ['vertical'], 'diagonal', 'Vertical', 0].map((marker) =>
      annotation({ marker }),
    ),
    { ...annotation(), value: 1000 },
    { ...annotation(), html: '<script>test</script>' },
  ];
  for (const value of invalid) {
    assert.throws(
      () =>
        validateActions([{ type: 'set_annotation', annotation: value }], input, ['V:R1', 'I:R1']),
      JSON.stringify(value),
    );
    if (Object.hasOwn(value, 'marker'))
      assert.throws(
        () => applyActions(input, [{ type: 'set_annotation', annotation: value }]),
        JSON.stringify(value),
      );
  }
  assert.throws(
    () =>
      validateActions(
        [{ type: 'set_annotation', annotation: annotation({ marker: 'horizontal' }) }],
        input,
        [],
      ),
    /先运行仿真/,
  );
  assert.throws(
    () => validateActions([{ type: 'delete_annotation', annotationId: 'Missing' }], input),
    /不存在/,
  );
  assert.throws(
    () =>
      validateActions(
        [
          { type: 'set_annotation', annotation: annotation() },
          { type: 'delete_annotation', annotationId: 'Missing' },
        ],
        input,
        ['V:R1'],
      ),
    /不存在/,
  );
  assert.deepEqual(input, before);
});

test('annotation batches may include geometry but cannot use results from electrical edits or queued simulations', () => {
  const input = annotationFixture();
  const add = { type: 'set_annotation', annotation: annotation({ marker: 'vertical' }) };
  const electrical = [
    { type: 'set_parameter', componentId: 'R1', parameter: 'resistance', value: 2000 },
    { type: 'set_analysis', analysis: { type: 'dc' } },
    { type: 'run_simulation' },
    { type: 'delete_component', componentId: 'R1' },
  ];
  for (const action of electrical) {
    assert.throws(
      () => validateActions([action, add], input, ['V:R1']),
      /先完成电路修改并运行仿真/,
    );
    assert.throws(
      () => validateActions([add, action], input, ['V:R1']),
      /先完成电路修改并运行仿真/,
    );
  }
  const visual = [
    { type: 'move_component', componentId: 'R1', x: 400, y: 200 },
    { type: 'transform_component', componentId: 'R1', rotation: 90 },
    add,
    { type: 'show_traces', traceIds: ['V:R1'] },
  ];
  assert.deepEqual(validateActions(visual, input, ['V:R1']), visual);
});

test('annotation cap permits updating existing entries and a rejected overflow does not modify the draft', () => {
  const input = annotationFixture();
  input.display.annotations = Array.from({ length: 32 }, (_, index) =>
    annotation({ id: `A${index + 1}` }),
  );
  const before = structuredClone(input);
  assert.equal(
    applyActions(input, [{ type: 'set_annotation', annotation: annotation({ text: '更新' }) }])
      .display.annotations.length,
    32,
  );
  assert.throws(
    () =>
      validateActions([{ type: 'set_annotation', annotation: annotation({ id: 'A33' }) }], input, [
        'V:R1',
      ]),
    /32/,
  );
  assert.deepEqual(input, before);
});

test('Max can show and annotate configured mathematics but cannot invent rows or deleted dependencies', () => {
  const input = annotationFixture();
  input.display.math = [{ id: 'M1', expression: 'CH1 * CH2', label: '功率', unit: 'W' }];
  input.display.traceIds = ['M:M1'];
  const actions = [
    { type: 'show_traces', traceIds: ['M:M1'] },
    { type: 'set_annotation', annotation: annotation({ traceId: 'M:M1', marker: 'horizontal' }) },
  ];
  assert.deepEqual(validateActions(actions, input, ['M:M1']), actions);
  assert.match(actionsApi.describeAction(actions[0]), /M1 数学曲线/);
  for (const traceId of ['M:M2', 'M:Missing'])
    assert.throws(
      () => validateActions([{ type: 'show_traces', traceIds: [traceId] }], input, [traceId]),
      /不存在/,
    );
  for (const expression of ['globalThis.x', 'CH1 + M1', 'CH1 + M2']) {
    const invalid = structuredClone(input);
    invalid.display.math[0].expression = expression;
    assert.throws(() => validateActions(actions, invalid, ['M:M1']), /不存在/);
  }
  const missing = structuredClone(input);
  missing.display.ch1 = 'V:Missing';
  assert.throws(() => validateActions(actions, missing, ['M:M1']), /不存在/);
  assert.throws(
    () =>
      validateActions(
        [
          { type: 'show_traces', traceIds: ['M:M1'] },
          { type: 'delete_component', componentId: 'R1' },
        ],
        input,
        ['M:M1'],
      ),
    /已被本次操作删除/,
  );
});

test('XY annotations retain the underlying time coordinate and phase markers require an AC phase plot', () => {
  const input = annotationFixture();
  input.display.mode = 'xy';
  input.display.xyX = 'I:R1';
  input.display.xyY = 'V:R1';
  const xy = {
    type: 'set_annotation',
    annotation: annotation({ mode: 'xy', xTraceId: 'I:R1', marker: 'vertical' }),
  };
  assert.deepEqual(validateActions([xy], input, ['V:R1', 'I:R1']), [xy]);
  assert.throws(() => validateActions([xy], input, ['V:R1']), /先运行仿真/);
  input.analysis = { type: 'ac', start: 10, stop: 10000, points: 101, scale: 'log' };
  input.display.mode = 'xt';
  input.display.phase = true;
  const phase = {
    type: 'set_annotation',
    annotation: annotation({ axis: 'phase', at: 100, analysisKey: 'ac', marker: 'horizontal' }),
  };
  assert.deepEqual(validateActions([phase], input, ['V:R1']), [phase]);
  const magnitude = {
    type: 'set_annotation',
    annotation: annotation({ at: 100, analysisKey: 'ac' }),
  };
  assert.deepEqual(validateActions([magnitude], input, ['V:R1']), [magnitude]);
  input.display.phase = false;
  assert.throws(() => validateActions([phase], input, ['V:R1']), /当前显示模式/);
});

test('Max can configure mathematical functions and XY mode before annotating a new result in one batch', () => {
  const input = annotationFixture();
  input.display.annotations = [annotation()];
  input.display.ranges = { xMin: null, xMax: null, yMin: -10, yMax: 10 };
  const before = structuredClone(input);
  const configure = {
    type: 'set_plot',
    display: {
      mode: 'xy',
      ch1: 'V:R1',
      ch2: 'I:R1',
      xyX: 'V:R1',
      xyY: 'M:M2',
      traceIds: ['M:M2'],
      math: [
        { id: 'M1', expression: 'CH1 * CH2', label: '功率', unit: 'W' },
        { id: 'M2', expression: 'integral(M1)', label: '能量', unit: 'J' },
      ],
      ranges: { xMax: 5 },
    },
  };
  const marker = {
    type: 'set_annotation',
    annotation: annotation({ id: 'A2', traceId: 'M:M2', mode: 'xy', xTraceId: 'V:R1' }),
  };
  const actions = [configure, marker];
  assert.deepEqual(validateActions(actions, input, ['V:R1', 'I:R1']), actions);
  const edited = applyActions(input, actions);
  assert.equal(edited.display.mode, 'xy');
  assert.deepEqual(edited.display.math, configure.display.math);
  assert.deepEqual(edited.display.ranges, { xMin: null, xMax: 5, yMin: -10, yMax: 10 });
  assert.deepEqual(edited.display.annotations, [input.display.annotations[0], marker.annotation]);
  assert.deepEqual(input, before);
  assert.equal(actionsApi.isEditingAction(configure), true);
  assert.equal(actionsApi.isElectricalAction(configure), false);
  assert.match(actionsApi.describeAction(configure), /X–Y 模式.*M2 = integral\(M1\)/);
  const toggle = {
    type: 'set_plot',
    display: { mode: 'xt', traceIds: ['V:R1'], ranges: { xMax: null } },
  };
  const toggled = applyActions(
    edited,
    validateActions([toggle], edited, ['V:R1', 'I:R1', 'M:M1', 'M:M2']),
  );
  assert.equal(toggled.display.mode, 'xt');
  assert.deepEqual(toggled.display.math, edited.display.math);
  assert.deepEqual(toggled.display.annotations, edited.display.annotations);
  assert.equal(toggled.display.ranges.xMax, null);
});

test('invalid or unavailable Max plot requests are rejected before any mutation', () => {
  const input = annotationFixture();
  const before = structuredClone(input);
  const invalid = [
    {},
    { html: '<script>run()</script>' },
    { annotations: [] },
    { mode: 'xz' },
    { phase: true },
    { mode: 'xy', xyX: 'V:R1', xyY: null },
    { traceIds: ['V:Missing'] },
    { ch1: 'M:M1' },
    { ch2: 'V:Missing' },
    { ranges: { xMin: 10, xMax: 1 } },
    { ranges: { xMin: '1' } },
    { ranges: { xMin: Infinity } },
    { math: [{ id: 'M1', expression: 'M1 + 1' }] },
    {
      math: [
        { id: 'M1', expression: 'M2 + 1' },
        { id: 'M2', expression: 'CH1' },
      ],
    },
    { math: [{ id: 'M1', expression: 'window.alert(1)' }] },
    { math: [{ id: 'M1', expression: 'CH1', code: 'run()' }] },
  ];
  for (const display of invalid)
    assert.throws(
      () => validateActions([{ type: 'set_plot', display }], input, ['V:R1', 'I:R1']),
      JSON.stringify(display),
    );
  const configure = { type: 'set_plot', display: { mode: 'xt' } };
  assert.throws(() => validateActions([configure], input, []), /先运行仿真/);
  assert.throws(() => validateActions([configure], input, ['V:R1']), /CH2.*物理通道/);
  for (const edit of [
    { type: 'run_simulation' },
    { type: 'set_parameter', componentId: 'R1', parameter: 'resistance', value: 10 },
  ])
    assert.throws(
      () => validateActions([configure, edit], input, ['V:R1', 'I:R1']),
      /先完成电路修改/,
    );
  const ac = structuredClone(input);
  ac.analysis = { type: 'ac', start: 10, stop: 10000, points: 101, scale: 'log' };
  for (const expression of ['integral(CH1)', 'diff(CH1)', 'min(CH1, CH2)', 'max(CH1, CH2)'])
    assert.throws(
      () =>
        validateActions([{ type: 'set_plot', display: { math: [{ id: 'M1', expression }] } }], ac, [
          'V:R1',
          'I:R1',
        ]),
      /不能计算/,
    );
  const phase = { type: 'set_plot', display: { phase: true } };
  assert.deepEqual(validateActions([phase], ac, ['V:R1', 'I:R1']), [phase]);
  assert.deepEqual(input, before);
});
