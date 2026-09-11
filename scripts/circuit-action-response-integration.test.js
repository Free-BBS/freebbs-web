const assert = require('node:assert/strict');
const test = require('node:test');
const engine = require('../public/circuit-engine');
const plot = require('../public/circuit-plot');
const annotations = require('../public/circuit-annotations');
const protocol = require('../public/circuit-ai-actions');
const agent = require('../public/circuit-agent');
const {
  validateCircuitAssistantInput,
  parseCircuitAssistantResponse,
} = require('../backend/circuit-assistant');

const copy = (value) => JSON.parse(JSON.stringify(value));
const simulate = { type: 'run_simulation' };

function documentFixture() {
  const endpoint = (reference) => {
    const [componentId, pin] = reference.split(':');
    return { componentId, pin: Number(pin) };
  };
  return engine.validateDocument({
    version: 1,
    components: [
      { id: 'V1', type: 'voltage', params: { dc: 5 } },
      { id: 'R1', type: 'resistor', params: { resistance: 1000 } },
      { id: 'R2', type: 'resistor', params: { resistance: 100 } },
      { id: 'G1', type: 'ground' },
    ],
    wires: [
      ['V1:0', 'R1:0'],
      ['V1:0', 'R2:0'],
      ['V1:1', 'G1:0'],
      ['R1:1', 'G1:0'],
      ['R2:1', 'G1:0'],
    ].map(([from, to], index) => ({
      id: `w${index}`,
      from: endpoint(from),
      to: endpoint(to),
    })),
    analysis: {
      type: 'sweep',
      componentId: 'R2',
      parameter: 'resistance',
      start: 100,
      stop: 500,
      points: 3,
    },
  });
}

function summarize(result) {
  return {
    analysis: copy(result.analysis),
    sampleCount: result.x.length,
    warnings: result.warnings,
    traces: result.traces.map((trace) => {
      const samples = Array.from(result.x, (x, index) => ({ x, value: trace.values[index] }));
      const sorted = [...samples].sort((first, second) => first.value - second.value);
      return {
        id: trace.id,
        label: trace.label,
        unit: trace.unit,
        min: sorted[0].value,
        max: sorted.at(-1).value,
        latest: samples.at(-1).value,
        minPoint: sorted[0],
        maxPoint: sorted.at(-1),
        samples,
      };
    }),
  };
}

// The API receives upstream text rather than manufactured browser action arrays.
// Execute through the same runner/protocol and real numerical engine used by the editor.
function harness(respond) {
  const h = {
    current: {
      cid: 'c_0123456789abcdef01234567',
      generation: 1,
      canEdit: true,
      editVersion: 0,
      selection: {},
      document: documentFixture(),
      simulation: null,
    },
    baseResult: null,
    plotResult: null,
    requests: [],
    executions: [],
    answers: [],
    endings: [],
  };
  h.runner = agent.create({
    getSnapshot: () => copy(h.current),
    beginRun: () => ({ runId: 'raw-response-run', snapshot: copy(h.current) }),
    endRun: (runId) => h.endings.push(runId),
    executeActions: (actions, options) => {
      assert.equal(options.runId, 'raw-response-run');
      assert.equal(options.expectedVersion, h.current.editVersion);
      h.executions.push(copy(actions));
      h.current.document = protocol.applyActions(h.current.document, actions);
      if (actions.some(protocol.isEditingAction)) h.current.editVersion += 1;
      if (actions.some(protocol.isElectricalAction)) {
        h.baseResult = null;
        h.current.simulation = null;
      }
      if (actions.some((action) => action.type === 'run_simulation'))
        h.baseResult = engine.simulate(h.current.document);
      if (h.baseResult) {
        const display = plot.resolveDisplay(h.baseResult, h.current.document);
        const prepared = plot.buildResult(h.baseResult, display);
        assert.deepEqual(prepared.warnings, []);
        h.current.document.display = display;
        h.plotResult = prepared.result;
        h.current.simulation = summarize(h.plotResult);
        for (const annotation of display.annotations || [])
          assert.equal(annotations.resolve(annotation, h.plotResult, display).error, undefined);
      }
      return copy(h.current);
    },
    requestStep: async (payload) => {
      const input = validateCircuitAssistantInput(payload);
      h.requests.push(copy(input));
      return parseCircuitAssistantResponse({ answer: await respond(input, h) }, input);
    },
    onEvent: (event) => {
      if (event.type === 'answer') h.answers.push(event.answer);
    },
  });
  return h;
}

const formats = [
  ['JSON fence', (value) => `\`\`\`json\n${JSON.stringify(value)}\n\`\`\``],
  ['unlabeled fence', (value) => `\`\`\`\n${JSON.stringify(value)}\n\`\`\``],
  ['unfenced envelope', (value) => JSON.stringify(value)],
];

for (const [name, wrap] of formats) {
  test(`upstream ${name} executes simulation, reads the real ratio and marks its measured minimum`, async () => {
    const h = harness((input) => {
      const progress = (answer, actions) => `${answer}\n${wrap({ actions, done: false })}`;
      if (input.agent.step === 1) {
        assert.equal(input.simulation, null);
        return progress('先运行仿真获取实际数据，再设置比例曲线和标记。', [simulate]);
      }
      if (input.agent.step === 2) {
        assert.equal(input.agent.observations[0].status, 'success');
        assert.equal(input.simulation.sampleCount, 3);
        const reference = input.simulation.traces.find((trace) => trace.id === 'I:R1');
        const output = input.simulation.traces.find((trace) => trace.id === 'I:R2');
        assert.ok(Math.abs(reference.latest - 0.005) < 1e-10);
        assert.ok(Math.abs(output.latest - 0.01) < 1e-10);
        return progress('根据输出电流和参考电流设置比例曲线。', [
          {
            type: 'set_plot',
            display: {
              mode: 'xt',
              ch1: output.id,
              ch2: reference.id,
              traceIds: ['M:M1'],
              math: [{ id: 'M1', expression: 'CH1/CH2', label: '输出 / 参考', unit: '' }],
            },
          },
        ]);
      }
      if (input.agent.step === 3) {
        assert.equal(input.agent.observations[1].status, 'success');
        const ratio = input.simulation.traces.find((trace) => trace.id === 'M:M1');
        assert.ok(Math.abs(ratio.max - 10) < 1e-10);
        assert.ok(Math.abs(ratio.min - 2) < 1e-10);
        assert.equal(ratio.minPoint.x, 500);
        return progress('在实际计算得到的比例最小值处添加标记。', [
          {
            type: 'set_annotation',
            annotation: {
              id: 'A1',
              traceId: ratio.id,
              at: ratio.minPoint.x,
              text: '输出电流 / 参考电流 = 2',
              mode: 'xt',
              axis: 'value',
              xTraceId: null,
              analysisKey: 'sweep:R2:resistance',
            },
          },
        ]);
      }
      assert.equal(input.agent.step, 4);
      assert.equal(input.agent.observations[2].status, 'success');
      assert.equal(input.document.display.annotations[0].at, 500);
      return `已绘制比例曲线，并在最小值 2 处添加标记。\n${wrap({ actions: [], done: true })}`;
    });
    const outcome = await h.runner.run('仿真输出电流与参考电流的比例关系，并在比例最小处标记');
    assert.equal(outcome.status, 'complete');
    assert.equal(outcome.step, 4, 'printing an action envelope must not finish the agent early');
    assert.deepEqual(
      h.executions.map((actions) => actions.map((action) => action.type)),
      [['run_simulation'], ['set_plot'], ['set_annotation']],
    );
    assert.equal(h.current.document.display.math[0].expression, 'CH1/CH2');
    assert.equal(h.current.document.display.annotations[0].text, '输出电流 / 参考电流 = 2');
    const point = annotations.resolve(
      h.current.document.display.annotations[0],
      h.plotResult,
      h.current.document.display,
    );
    assert.equal(point.x, 500);
    assert.ok(Math.abs(point.y - 2) < 1e-10);
    assert.ok(h.answers.every((answer) => !answer.includes('"actions"')));
    assert.deepEqual(h.endings, ['raw-response-run']);
  });
}

for (const [name, broken] of [
  ['unknown action in JSON', '```json\n{"actions":[{"type":"invented_operation"}]}\n```'],
  ['truncated unfenced actions', '{"actions":[{"type":"run_simulation"'],
  ['truncated unlabeled fence', '```\n{"actions":[{"type":"run_simulation"'],
]) {
  test(`${name} sends repair feedback instead of falsely completing the autonomous task`, async () => {
    const h = harness((input) => {
      if (input.agent.step === 1) return `准备运行仿真。\n${broken}`;
      if (input.agent.step === 2) {
        assert.equal(input.simulation, null);
        assert.equal(input.agent.observations.length, 1);
        assert.equal(input.agent.observations[0].status, 'error');
        assert.match(input.agent.observations[0].summary, /未完成/);
        return `修正操作格式后重新运行。\n\`\`\`circuit-actions\n${JSON.stringify({ actions: [simulate], done: false })}\n\`\`\``;
      }
      assert.equal(input.agent.step, 3);
      assert.equal(input.simulation.sampleCount, 3);
      assert.equal(input.agent.observations[1].status, 'success');
      return '仿真已完成，已读取三个真实扫描点。';
    });
    const outcome = await h.runner.run('运行当前扫描并查看结果');
    assert.equal(outcome.status, 'complete');
    assert.equal(outcome.step, 3);
    assert.deepEqual(h.executions, [[simulate]]);
    assert.deepEqual(
      outcome.observations.map((item) => item.status),
      ['error', 'success'],
    );
  });
}

test('ordinary JSON examples remain readable and never become autonomous operations', async () => {
  const answer = '这个示例说明两个电流的比例：\n```json\n{"ratio":10,"unit":""}\n```';
  const h = harness(() => answer);
  const outcome = await h.runner.run('解释 JSON 中的比例数字，不需要操作电路');
  assert.equal(outcome.status, 'complete');
  assert.equal(outcome.step, 1);
  assert.equal(outcome.answer, answer);
  assert.deepEqual(h.executions, []);
  assert.deepEqual(outcome.observations, []);
});
