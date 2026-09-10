const assert = require('node:assert/strict');
const test = require('node:test');
const engine = require('../public/circuit-engine');
const protocol = require('../public/circuit-ai-actions');
const agent = require('../public/circuit-agent');
const { validateCircuitAssistantInput } = require('../backend/circuit-assistant');

const copy = (value) => JSON.parse(JSON.stringify(value));
const setResistance = (value) => ({
  type: 'set_parameter',
  componentId: 'R1',
  parameter: 'resistance',
  value,
});
const simulate = { type: 'run_simulation' };
const tick = () =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function documentFixture() {
  return engine.validateDocument({
    version: 1,
    components: [
      { id: 'V1', type: 'voltage', x: 120, y: 160, params: { dc: 5 } },
      { id: 'R1', type: 'resistor', x: 320, y: 160, params: { resistance: 1000 } },
      { id: 'G1', type: 'ground', x: 320, y: 320 },
    ],
    wires: [
      { id: 'w1', from: { componentId: 'V1', pin: 0 }, to: { componentId: 'R1', pin: 0 } },
      { id: 'w2', from: { componentId: 'V1', pin: 1 }, to: { componentId: 'G1', pin: 0 } },
      { id: 'w3', from: { componentId: 'R1', pin: 1 }, to: { componentId: 'G1', pin: 0 } },
    ],
    analysis: { type: 'dc' },
  });
}

function measurement(document) {
  const value =
    5 / document.components.find((component) => component.id === 'R1').params.resistance;
  return {
    analysis: copy(document.analysis),
    sampleCount: 1,
    warnings: [],
    traces: [
      {
        id: 'I:R1',
        label: 'R1 电流',
        unit: 'A',
        min: value,
        max: value,
        latest: value,
        samples: [{ x: 0, value }],
      },
    ],
  };
}

function harness(overrides = {}) {
  const document = documentFixture();
  const h = {
    current: {
      document,
      editVersion: 1,
      cid: 'c_0123456789abcdef01234567',
      generation: 1,
      canEdit: true,
      selection: {},
      simulation: measurement(document),
    },
    requests: [],
    executions: [],
    events: [],
    beginnings: 0,
    endings: [],
  };
  h.execute = async (actions, options) => {
    h.executions.push({ actions: copy(actions), options });
    assert.equal(options.runId, 'run-1');
    assert.equal(options.expectedVersion, h.current.editVersion);
    h.current.document = protocol.applyActions(h.current.document, actions);
    if (actions.some(protocol.isEditingAction)) h.current.editVersion += 1;
    if (actions.some(protocol.isElectricalAction)) h.current.simulation = null;
    if (actions.some((action) => action.type === 'run_simulation'))
      h.current.simulation = measurement(h.current.document);
    return copy(h.current);
  };
  h.runner = agent.create({
    getSnapshot: () => copy(h.current),
    beginRun: () => {
      h.beginnings += 1;
      return { runId: 'run-1', snapshot: copy(h.current) };
    },
    endRun: (runId) => {
      h.endings.push(runId);
    },
    executeActions: (...args) => h.execute(...args),
    requestStep: (payload, options) => {
      h.requests.push(copy(payload));
      return overrides.requestStep
        ? overrides.requestStep(payload, options, h)
        : { answer: '完成', actions: [], done: true };
    },
    onEvent: (event) => h.events.push(copy(event)),
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== 'requestStep')),
  });
  return h;
}

test('agent decides subsequent edits from the freshly completed simulation, preserving original history', async () => {
  const history = [{ role: 'user', content: '原来的讨论' }];
  const h = harness({
    requestStep: async (payload) => {
      assert.deepEqual(payload.history, history);
      if (payload.agent.step === 1)
        return { answer: '先运行检查。', actions: [setResistance(2000), simulate] };
      if (payload.agent.step === 2) {
        assert.equal(payload.document.components[1].params.resistance, 2000);
        assert.equal(payload.simulation.traces[0].latest, 0.0025);
        assert.equal(payload.agent.observations[0].status, 'success');
        assert.match(payload.agent.observations[0].summary, /执行成功/);
        return { answer: '根据结果调整至 1 mA。', actions: [setResistance(5000), simulate] };
      }
      assert.equal(payload.simulation.traces[0].latest, 0.001);
      return { answer: '实测电流为 1 mA，任务完成。', actions: [], done: true };
    },
  });
  const result = await h.runner.run('把电流调整至 1 mA', { history });
  assert.equal(result.status, 'complete');
  assert.equal(result.step, 3);
  assert.equal(h.executions.length, 2);
  assert.equal(h.current.simulation.traces[0].latest, 0.001);
  assert.equal(result.observations.length, 2);
  h.requests.forEach((payload) => {
    assert.doesNotThrow(() => validateCircuitAssistantInput(payload));
  });
  assert.deepEqual(h.endings, ['run-1']);
  assert.equal(h.runner.isRunning(), false);
  assert.deepEqual(
    h.events.map((event) => event.type),
    [
      'step',
      'answer',
      'actions',
      'observation',
      'step',
      'answer',
      'actions',
      'observation',
      'step',
      'answer',
      'finish',
    ],
  );
});

test('invalid action batches and endpoint warnings are fed back before a corrected batch executes', async () => {
  const h = harness({
    requestStep: async (payload) => {
      if (payload.agent.step === 1)
        return { answer: '修改', actions: [setResistance(2000), { type: 'delete_everything' }] };
      if (payload.agent.step === 2) {
        assert.equal(payload.document.components[1].params.resistance, 1000);
        assert.equal(payload.agent.observations[0].status, 'error');
        assert.match(payload.agent.observations[0].summary, /delete_everything/);
        return {
          answer: '再次修改',
          actions: [setResistance(2000)],
          actionWarning: '操作格式未通过服务端校验',
          done: true,
        };
      }
      if (payload.agent.step === 3) {
        assert.equal(payload.agent.observations.length, 2);
        return { answer: '已纠正操作格式。', actions: [setResistance(3000)] };
      }
      return { answer: '操作完成。', actions: [], done: true };
    },
  });
  const result = await h.runner.run('调整电阻');
  assert.equal(result.status, 'complete');
  assert.equal(h.executions.length, 1);
  assert.equal(h.current.document.components[1].params.resistance, 3000);
  assert.deepEqual(
    result.observations.map((item) => item.status),
    ['error', 'error', 'success'],
  );
});

test('solver failures expose the actual partially changed draft and allow recovery from current state', async () => {
  const h = harness({
    requestStep: async (payload) => {
      if (payload.agent.step === 1)
        return { answer: '修改并仿真', actions: [setResistance(2000), simulate] };
      if (payload.agent.step === 3) return { answer: '操作完成。', actions: [], done: true };
      assert.equal(payload.document.components[1].params.resistance, 2000);
      assert.equal(payload.simulation, null);
      assert.match(payload.agent.observations[0].summary, /矩阵奇异/);
      return { answer: '重新仿真', actions: [simulate] };
    },
  });
  const { execute } = h;
  h.execute = async (actions, options) => {
    if (!h.executions.length) {
      await execute(actions, options);
      h.current.simulation = null;
      throw Object.assign(new Error('矩阵奇异'), { code: 'SIMULATION_FAILED' });
    }
    return execute(actions, options);
  };
  const result = await h.runner.run('调整并检查');
  assert.equal(result.status, 'complete');
  assert.equal(h.executions.length, 2);
  assert.equal(result.snapshot.simulation.traces[0].latest, 0.0025);
});

test('manual edits while awaiting Max terminate the stale run without executing returned actions', async () => {
  const pending = deferred();
  const started = deferred();
  const h = harness({
    requestStep: () => {
      started.resolve();
      return pending.promise;
    },
  });
  const running = h.runner.run('修改电阻');
  await started.promise;
  h.current.editVersion += 1;
  h.current.document.components[1].params.resistance = 500;
  pending.resolve({ answer: '修改', actions: [setResistance(2000)] });
  const result = await running;
  assert.equal(result.status, 'stale');
  assert.equal(h.executions.length, 0);
  assert.equal(h.requests.length, 1);
  assert.deepEqual(h.endings, ['run-1']);
});

test('nonversioned document, selection, identity or permission changes also stop stale decisions', async () => {
  for (const change of [
    (h) => {
      h.current.document.components[1].params.resistance = 500;
    },
    (h) => {
      h.current.selection.componentId = 'R1';
    },
    (h) => {
      h.current.cid = 'another';
    },
    (h) => {
      h.current.generation += 1;
    },
    (h) => {
      h.current.canEdit = false;
    },
  ]) {
    const h = harness({
      requestStep: (_payload, _options, fixture) => {
        change(fixture);
        return { answer: '修改', actions: [setResistance(2000)] };
      },
    });
    assert.equal((await h.runner.run('修改')).status, 'stale');
    assert.equal(h.executions.length, 0);
  }
});

test('stop aborts an ignored request signal and late answers cannot apply or start another round', async () => {
  const pending = deferred();
  const started = deferred();
  let requestSignal;
  const h = harness({
    requestStep: (_payload, { signal }) => {
      requestSignal = signal;
      started.resolve();
      return pending.promise;
    },
  });
  const running = h.runner.run('执行');
  await started.promise;
  assert.equal(h.runner.isRunning(), true);
  h.runner.stop('用户停止了本次执行。');
  h.runner.stop();
  const result = await running;
  assert.equal(result.status, 'stopped');
  assert.equal(requestSignal.aborted, true);
  assert.equal(h.runner.isRunning(), false);
  pending.resolve({ answer: '修改', actions: [setResistance(2000)] });
  await tick();
  assert.equal(h.executions.length, 0);
  assert.equal(h.requests.length, 1);
  assert.deepEqual(h.endings, ['run-1']);
});

test('stop during asynchronous simulation aborts execution and ignores its delayed completion', async () => {
  const pending = deferred();
  const started = deferred();
  let executionSignal;
  const h = harness({ requestStep: () => ({ answer: '运行', actions: [simulate] }) });
  h.execute = (_actions, { signal }) => {
    executionSignal = signal;
    started.resolve();
    return pending.promise;
  };
  const running = h.runner.run('执行');
  await started.promise;
  h.runner.stop();
  const result = await running;
  assert.equal(result.status, 'stopped');
  assert.equal(executionSignal.aborted, true);
  pending.resolve(copy(h.current));
  await tick();
  assert.equal(h.requests.length, 1);
  assert.equal(result.observations.length, 0);
  assert.deepEqual(h.endings, ['run-1']);
});

test('deadline exits hung requests distinctly and releases the editor lease', async () => {
  const h = harness({ timeoutMs: 15, requestStep: () => new Promise(() => {}) });
  const result = await h.runner.run('等待');
  assert.equal(result.status, 'timeout');
  assert.deepEqual(h.endings, ['run-1']);
  assert.equal(h.runner.isRunning(), false);
});

test('model step limits are enforced even when every operation changes the draft', async () => {
  const h = harness({
    maxSteps: 2,
    requestStep: (payload) => ({
      answer: '继续',
      actions: [setResistance(1000 + payload.agent.step)],
    }),
  });
  const result = await h.runner.run('不停调整');
  assert.equal(result.status, 'limit');
  assert.equal(result.step, 2);
  assert.equal(h.requests.length, 2);
  assert.equal(h.executions.length, 2);
});

test('the hard upper bound remains twelve model rounds even if a larger limit is configured', async () => {
  const h = harness({
    maxSteps: 100,
    requestStep: (payload) => ({
      answer: '继续',
      actions: [setResistance(1000 + payload.agent.step)],
    }),
  });
  const result = await h.runner.run('不停调整');
  assert.equal(result.status, 'limit');
  assert.equal(result.step, 12);
  assert.equal(h.requests.length, 12);
  assert.equal(
    result.observations.every((item) => item.summary.length <= 4000),
    true,
  );
});

test('a repeated unchanged simulation stops after allowing the first verification run', async () => {
  const h = harness({ requestStep: () => ({ answer: '再检查', actions: [simulate] }) });
  const result = await h.runner.run('检查');
  assert.equal(result.status, 'limit');
  assert.match(result.reason, /没有产生新结果/);
  assert.equal(h.executions.length, 2);
});

test('three consecutive errors stop the run and never become claimed successes', async () => {
  const h = harness({
    requestStep: () => ({ answer: '已经成功修改', actions: [{ type: 'invalid' }] }),
  });
  const result = await h.runner.run('执行');
  assert.equal(result.status, 'error');
  assert.equal(h.requests.length, 3);
  assert.equal(h.executions.length, 0);
  assert.equal(
    result.observations.every((item) => item.status === 'error'),
    true,
  );
  assert.equal(
    result.observations.some((item) => item.summary.includes('已经成功修改')),
    false,
  );
  assert.deepEqual(h.endings, ['run-1']);
});

test('read-only drafts reject autonomous editing while still allowing a simulation-only request', async () => {
  const h = harness({ requestStep: () => ({ answer: '修改', actions: [setResistance(2000)] }) });
  h.current.canEdit = false;
  assert.equal((await h.runner.run('修改')).status, 'error');
  assert.equal(h.executions.length, 0);
  assert.match(h.requests[1].agent.observations[0].summary, /只读/);
  const read = harness({
    requestStep: (payload) => {
      assert.equal(payload.agent.canEdit, false);
      return payload.agent.step === 1
        ? { answer: '只运行仿真', actions: [simulate] }
        : { answer: '仿真完成', actions: [], done: true };
    },
  });
  read.current.canEdit = false;
  assert.equal((await read.runner.run('仿真')).status, 'complete');
  assert.equal(read.executions.length, 1);
});

test('bridge stop and stale errors terminate immediately without correction requests', async () => {
  for (const code of ['AGENT_STOPPED', 'AGENT_STALE']) {
    const h = harness({ requestStep: () => ({ answer: '运行', actions: [simulate] }) });
    h.execute = async () => {
      throw Object.assign(new Error('执行已取消'), { code });
    };
    assert.equal((await h.runner.run('执行')).status, code === 'AGENT_STALE' ? 'stale' : 'stopped');
    assert.equal(h.requests.length, 1);
    assert.deepEqual(h.endings, ['run-1']);
  }
});

test('request payloads cannot mutate the editor or original conversation used in later rounds', async () => {
  const history = [{ role: 'user', content: '原始问题' }];
  const h = harness({
    requestStep: (payload) => {
      assert.equal(payload.history[0].content, '原始问题');
      assert.equal(
        payload.document.components[1].params.resistance,
        payload.agent.step === 1 ? 1000 : 2000,
      );
      payload.history[0].content = 'mutated';
      payload.document.components[1].params.resistance = 9999;
      return payload.agent.step === 1
        ? { answer: '修改', actions: [setResistance(2000)] }
        : { answer: '完成', done: true };
    },
  });
  assert.equal((await h.runner.run('执行', { history })).status, 'complete');
  assert.equal(h.current.document.components[1].params.resistance, 2000);
  assert.equal(history[0].content, '原始问题');
});

test('concurrent runs are rejected and observer failures do not retry already executed operations', async () => {
  const pending = deferred();
  const started = deferred();
  const h = harness({
    requestStep: (payload) => {
      if (payload.agent.step > 1) return { answer: '操作完成。', actions: [], done: true };
      started.resolve();
      return pending.promise;
    },
    onEvent: () => {
      throw new Error('view disposed');
    },
  });
  const running = h.runner.run('第一个任务');
  await started.promise;
  await assert.rejects(h.runner.run('第二个任务'), /已在执行/);
  pending.resolve({ answer: '修改', actions: [setResistance(2000)] });
  assert.equal((await running).status, 'complete');
  assert.equal(h.executions.length, 1);
});

test('stop while acquiring a delayed lease releases that lease once it eventually arrives', async () => {
  const pending = deferred();
  const started = deferred();
  const h = harness({
    beginRun: () => {
      started.resolve();
      return pending.promise;
    },
  });
  const running = h.runner.run('执行');
  await started.promise;
  h.runner.stop();
  assert.equal((await running).status, 'stopped');
  assert.deepEqual(h.endings, []);
  pending.resolve({ runId: 'late-run', snapshot: copy(h.current) });
  await tick();
  assert.deepEqual(h.endings, ['late-run']);
  assert.equal(h.requests.length, 0);
});

test('a rejected lease setup returns an error and does not release a lease that never existed', async () => {
  const h = harness({
    beginRun: async () => {
      throw new Error('输入参数无效');
    },
  });
  assert.equal((await h.runner.run('执行')).status, 'error');
  assert.deepEqual(h.endings, []);
  assert.equal(h.requests.length, 0);
  assert.equal(h.runner.isRunning(), false);
});

test('completed responses cannot include unobserved actions, and the next round can correct that format', async () => {
  const h = harness({
    requestStep: (payload) => {
      if (payload.agent.step === 1)
        return { answer: '已完成修改', actions: [setResistance(2000)], done: true };
      assert.equal(payload.document.components[1].params.resistance, 1000);
      assert.match(payload.agent.observations[0].summary, /不能同时要求执行操作/);
      return { answer: '未执行修改，保持原值。', actions: [], done: true };
    },
  });
  const result = await h.runner.run('执行');
  assert.equal(result.status, 'complete');
  assert.equal(h.executions.length, 0);
  assert.equal(result.observations[0].status, 'error');
});
