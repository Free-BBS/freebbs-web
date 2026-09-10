const assert = require('node:assert/strict');
const test = require('node:test');
const { once } = require('node:events');
const express = require('express');
const engine = require('../public/circuit-engine');
const plot = require('../public/circuit-plot');
const actions = require('../public/circuit-ai-actions');
const { createCircuitsRouter, validateCircuitInput } = require('../backend/circuits');
const { enrichAgentCircuitContext } = require('../backend/agent-circuits');
const {
  validateCircuitAssistantInput,
  buildCircuitAssistantPayload,
  parseCircuitAssistantResponse,
} = require('../backend/circuit-assistant');

function document() {
  const components = [
    { id: 'V1', type: 'voltage', params: { dc: 0, waveform: 'sine', amplitude: 10, frequency: 1 } },
    {
      id: 'N1',
      type: 'twoport',
      params: { parameterSet: 'ABCD', m11: 2, m12: 0, m21: 0, m22: 0.5 },
    },
    { id: 'RL', type: 'resistor', params: { resistance: 1000 } },
    { id: 'S1', type: 'oscilloscope2' },
    { id: 'G1', type: 'ground' },
  ];
  const endpoint = (value) => ({
    componentId: value.split(':')[0],
    pin: Number(value.split(':')[1]),
  });
  const links = [
    ['V1:0', 'N1:0'],
    ['V1:1', 'G1:0'],
    ['N1:1', 'G1:0'],
    ['N1:3', 'G1:0'],
    ['N1:2', 'RL:0'],
    ['RL:1', 'G1:0'],
    ['S1:0', 'N1:0'],
    ['S1:1', 'G1:0'],
    ['S1:2', 'N1:2'],
    ['S1:3', 'G1:0'],
  ];
  return engine.validateDocument({
    version: 1,
    components,
    wires: links.map(([from, to], index) => ({
      id: `w${index}`,
      from: endpoint(from),
      to: endpoint(to),
    })),
    analysis: { type: 'transient', stop: 0.5, step: 0.25 },
    display: {
      version: 1,
      mode: 'xy',
      traceIds: ['V:S1', 'V:S1:CH2', 'M:M1'],
      ch1: 'V:S1',
      ch2: 'V:S1:CH2',
      xyX: 'V:S1',
      xyY: 'M:M1',
      math: [{ id: 'M1', label: '两端电压差', expression: 'CH1-CH2', unit: 'V' }],
      phase: false,
      ranges: { xMin: -10, xMax: 10, yMin: -5, yMax: 5 },
    },
  });
}

// Exercise the real HTTP save/read and JSON serialization path without requiring MySQL.
// This adapter preserves revision rows independently; it deliberately rejects unknown SQL.
function database() {
  let circuits = new Map();
  let revisions = new Map();
  let rollback;
  const connection = {
    async beginTransaction() {
      rollback = [structuredClone(circuits), structuredClone(revisions)];
    },
    async commit() {
      rollback = null;
    },
    async rollback() {
      [circuits, revisions] = rollback;
      rollback = null;
    },
    release() {},
    async execute(sql, values) {
      if (sql.startsWith('INSERT INTO circuits ')) {
        circuits.set(values[0], { cid: values[0], owner_id: values[1], current_revision: 1 });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('INSERT INTO circuit_revisions ')) {
        const [cid, revision, title, description, documentJson] = values;
        revisions.set(`${cid}:${revision}`, {
          revision,
          title,
          description,
          document_json: documentJson,
        });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('UPDATE circuits SET current_revision')) {
        const [revision, cid] = values;
        circuits.get(cid).current_revision = revision;
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('SELECT owner_id, current_revision'))
        return [[circuits.get(values[0])].filter(Boolean)];
      if (sql.includes('FROM circuits c') && sql.includes('JOIN circuit_revisions r')) {
        const item = circuits.get(values.at(-1));
        const revision = values.length === 2 ? values[0] : item?.current_revision;
        const row = revisions.get(`${values.at(-1)}:${revision}`);
        return [
          [
            row && {
              ...item,
              ...row,
              username: 'student',
              uid: 'student',
              created_at: '2026-09-10T00:00:00Z',
              revision_created_at: '2026-09-10T00:00:00Z',
            },
          ].filter(Boolean),
        ];
      }
      throw new Error(`Unexpected test SQL: ${sql}`);
    },
  };
  return {
    getConnection: async () => connection,
    execute: (...args) => connection.execute(...args),
  };
}

test('saved waveform settings survive HTTP creation, revision updates, public sharing, and Max reads of the pinned version', async (t) => {
  const pool = database();
  const app = express();
  app.use(express.json());
  app.use(
    '/api/circuits',
    createCircuitsRouter({
      pool,
      requireAuth: async (request, response) => {
        if (request.headers.authorization === 'Bearer owner') return { id: 1, username: 'student' };
        response.status(401).json({ message: '请先登录' });
        return null;
      },
    }),
  );
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
      }),
  );
  const origin = `http://127.0.0.1:${server.address().port}`;
  const send = (path, method, body) =>
    fetch(`${origin}/api/circuits${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
      body: JSON.stringify(body),
    });
  const original = document();
  const createdResponse = await send('/', 'POST', { title: '示波器 XY', document: original });
  assert.equal(createdResponse.status, 201);
  const { circuit: created } = await createdResponse.json();
  assert.deepEqual(created.document.display, original.display);
  const changed = structuredClone(original);
  changed.display.mode = 'xt';
  changed.display.math[0].expression = 'CH1+CH2';
  changed.display.ranges.xMax = 0.5;
  const updatedResponse = await send(`/${created.cid}`, 'PUT', {
    title: '示波器 XT',
    document: changed,
    expectedRevision: 1,
  });
  assert.equal(updatedResponse.status, 200);
  assert.equal((await updatedResponse.json()).circuit.revision, 2);
  const pinned = (await (await fetch(`${origin}/api/circuits/${created.cid}?revision=1`)).json())
    .circuit;
  const latest = (await (await fetch(`${origin}/api/circuits/${created.cid}`)).json()).circuit;
  assert.equal(pinned.canEdit, false);
  assert.equal(pinned.revision, 1);
  assert.equal(pinned.latestRevision, 2);
  assert.deepEqual(pinned.document.display, original.display);
  assert.deepEqual(latest.document.display, changed.display);
  for (const [saved, expected] of [
    [pinned, 5],
    [latest, 15],
  ]) {
    const base = engine.simulate(saved.document);
    const display = plot.resolveDisplay(base, saved.document);
    const { result, warnings } = plot.buildResult(base, display);
    assert.deepEqual(display, saved.document.display);
    assert.deepEqual(warnings, []);
    const middle = result.traces.find((trace) => trace.id === 'M:M1').values[1];
    assert.ok(Math.abs(middle - expected) < 1e-8);
  }
  const context = await enrichAgentCircuitContext(
    {
      messages: [
        {
          role: 'user',
          content: `分析这个图：[波形](/circuit?cid=${created.cid}&revision=1&view=waveform)`,
        },
      ],
    },
    { pool, publicWebUrl: origin },
  );
  assert.deepEqual(context.context.circuits[0].display, original.display);
  assert.equal(context.context.circuits[0].revision, 1);
  assert.equal(
    context.context.circuits[0].components.find((component) => component.id === 'S1').pins.length,
    4,
  );
  assert.match(context.messages.at(-1).content, /CH1-CH2/);
  assert.equal(
    (
      await send(`/${created.cid}`, 'PUT', {
        title: '过期保存',
        document: original,
        expectedRevision: 1,
      })
    ).status,
    409,
  );
  assert.equal((await fetch(`${origin}/api/circuits/${created.cid}?revision=99`)).status, 404);
});

test('AI accepts actual CH2/P2 measurements and complete display settings, and preserves settings through guarded edits', () => {
  const source = document();
  const traces = engine
    .simulate(source)
    .traces.filter((trace) => ['V:S1:CH2', 'V:N1:P2', 'I:N1:P2'].includes(trace.id));
  const input = validateCircuitAssistantInput({
    question: '解释 CH2，再把传输矩阵 A 改为 3，运行后高亮第二端口波形。',
    document: source,
    simulation: {
      sampleCount: 3,
      traces: traces.map((trace) => ({
        id: trace.id,
        samples: [{ x: 0.25, value: trace.values[1] }],
      })),
    },
  });
  const payload = buildCircuitAssistantPayload(input);
  assert.deepEqual(payload.context.circuitEditor.document.display, source.display);
  assert.deepEqual(
    payload.context.circuitEditor.simulation.traces.map((trace) => trace.id),
    traces.map((trace) => trace.id),
  );
  const proposed = [
    { type: 'set_parameter', componentId: 'N1', parameter: 'm11', value: 3 },
    { type: 'run_simulation' },
    { type: 'show_traces', traceIds: ['V:S1:CH2', 'I:N1:P2'] },
  ];
  const parsed = parseCircuitAssistantResponse(
    {
      answer: `已依据两个通道比较。\n\`\`\`circuit-actions\n${JSON.stringify({ actions: proposed })}\n\`\`\``,
    },
    input,
  );
  assert.deepEqual(parsed.actions, proposed);
  const edited = actions.applyActions(source, parsed.actions);
  assert.deepEqual(edited.display, source.display);
  assert.equal(edited.components.find((component) => component.id === 'N1').params.m11, 3);
  assert.equal(source.components.find((component) => component.id === 'N1').params.m11, 2);
  const longest = `S${'x'.repeat(39)}`;
  const longDocument = {
    version: 1,
    components: [{ id: longest, type: 'oscilloscope2' }],
    wires: [],
  };
  assert.doesNotThrow(() =>
    validateCircuitAssistantInput({
      question: '第二通道',
      document: longDocument,
      simulation: { traces: [{ id: `V:${longest}:CH2` }] },
    }),
  );
});

test('AI rejects invented physical channels, absent traces, stale targets, and nested display injection', () => {
  const source = document();
  const available = ['V:S1:CH2', 'I:N1:P2'];
  for (const id of ['I:S1:CH2', 'V:RL:P2', 'V:N1:CH2', 'V:Missing:P2', 'M:M2']) {
    assert.throws(() =>
      validateCircuitAssistantInput({
        question: '分析',
        document: source,
        simulation: { traces: [{ id }] },
      }),
    );
    assert.throws(() =>
      actions.validateActions([{ type: 'show_traces', traceIds: [id] }], source, [id]),
    );
  }
  assert.throws(() =>
    actions.validateActions([{ type: 'show_traces', traceIds: ['V:N1:P2'] }], source, available),
  );
  assert.throws(
    () =>
      actions.validateActions(
        [
          { type: 'show_traces', traceIds: ['V:S1:CH2'] },
          { type: 'delete_component', componentId: 'S1' },
          { type: 'run_simulation' },
        ],
        source,
        available,
      ),
    /删除/,
  );
  for (const display of [
    { ...source.display, math: [{ id: 'M1', expression: 'CH1', url: 'https://evil.example' }] },
    { ...source.display, ranges: { xMin: 10, xMax: 1 } },
    { ...source.display, ranges: JSON.parse('{"__proto__":{"polluted":true}}') },
  ]) {
    const invalid = { ...source, display };
    assert.throws(() => validateCircuitInput({ title: 'test', document: invalid }));
    assert.throws(() => actions.validateEditorDocument(invalid));
  }
  assert.equal({}.polluted, undefined);
});

test('AI accepts configured mathematical measurements and still rejects missing definitions', () => {
  const source = document();
  const result = plot.buildResult(engine.simulate(source), source.display).result;
  const mathematical = result.traces.find((trace) => trace.id === 'M:M1');
  const summary = {
    sampleCount: result.x.length,
    traces: [{ id: mathematical.id, samples: [{ x: result.x[1], value: mathematical.values[1] }] }],
  };
  const input = validateCircuitAssistantInput({
    question: '分析电压差',
    document: source,
    simulation: summary,
  });
  assert.equal(input.simulation.traces[0].id, 'M:M1');
  const show = [{ type: 'show_traces', traceIds: ['M:M1'] }];
  assert.deepEqual(actions.validateActions(show, source, ['M:M1']), show);
  const missing = structuredClone(source);
  missing.display.math = [];
  assert.throws(
    () =>
      validateCircuitAssistantInput({ question: '分析', document: missing, simulation: summary }),
    /不存在的波形/,
  );
  assert.throws(() => actions.validateActions(show, missing, ['M:M1']), /不存在/);
  assert.throws(() => actions.validateActions(show, source, []), /先运行仿真/);
});
