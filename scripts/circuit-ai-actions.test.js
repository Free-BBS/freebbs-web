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
