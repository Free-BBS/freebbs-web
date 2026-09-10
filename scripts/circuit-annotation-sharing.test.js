const assert = require('node:assert/strict');
const test = require('node:test');
const { once } = require('node:events');
const express = require('express');
const engine = require('../public/circuit-engine');
const plot = require('../public/circuit-plot');
const annotations = require('../public/circuit-annotations');
const { createCircuitsRouter } = require('../backend/circuits');
const { enrichAgentCircuitContext } = require('../backend/agent-circuits');

function document() {
  const endpoint = (value) => ({
    componentId: value.split(':')[0],
    pin: Number(value.split(':')[1]),
  });
  const links = [
    ['V1:0', 'R1:0'],
    ['R1:1', 'R2:0'],
    ['R2:1', 'G1:0'],
    ['V1:1', 'G1:0'],
    ['S1:0', 'V1:0'],
    ['S1:1', 'G1:0'],
    ['S1:2', 'R2:0'],
    ['S1:3', 'G1:0'],
  ];
  return engine.validateDocument({
    version: 1,
    components: [
      {
        id: 'V1',
        type: 'voltage',
        params: { dc: 0, waveform: 'sine', amplitude: 10, frequency: 1 },
      },
      { id: 'R1', type: 'resistor', params: { resistance: 1000 } },
      { id: 'R2', type: 'resistor', params: { resistance: 1000 } },
      { id: 'S1', type: 'oscilloscope2' },
      { id: 'G1', type: 'ground' },
    ],
    wires: links.map(([from, to], index) => ({
      id: `w${index}`,
      from: endpoint(from),
      to: endpoint(to),
    })),
    analysis: { type: 'transient', stop: 1, step: 0.25 },
    display: {
      mode: 'xy',
      traceIds: ['V:S1', 'V:S1:CH2', 'M:M1'],
      ch1: 'V:S1',
      ch2: 'V:S1:CH2',
      xyX: 'V:S1',
      xyY: 'M:M1',
      math: [{ id: 'M1', label: '差值', expression: 'CH1-CH2', unit: 'V' }],
      ranges: { xMin: -11, xMax: 11, yMin: -6, yMax: 6 },
      annotations: [
        {
          id: 'A1',
          traceId: 'M:M1',
          at: 0.25,
          text: '差值采样峰值\n请检查放大倍数',
          marker: 'vertical',
          mode: 'xy',
          axis: 'value',
          xTraceId: 'V:S1',
          analysisKey: 'transient',
        },
        {
          id: 'A2',
          traceId: 'M:M1',
          at: 0.75,
          text: '差值采样谷值',
          marker: 'horizontal',
          mode: 'xy',
          axis: 'value',
          xTraceId: 'V:S1',
          analysisKey: 'transient',
        },
        {
          id: 'A3',
          traceId: 'M:M1',
          at: 0.5,
          text: '过零采样点',
          marker: 'point',
          mode: 'xy',
          axis: 'value',
          xTraceId: 'V:S1',
          analysisKey: 'transient',
        },
      ],
    },
  });
}

// Exercise the real HTTP and stored JSON paths using independent immutable
// revision rows; this intentionally rejects every SQL statement not under test.
function database() {
  let circuits = new Map();
  let revisions = new Map();
  let transaction;
  const connection = {
    async beginTransaction() {
      transaction = [structuredClone(circuits), structuredClone(revisions)];
    },
    async commit() {
      transaction = null;
    },
    async rollback() {
      [circuits, revisions] = transaction;
      transaction = null;
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
        const row = revisions.get(
          `${values.at(-1)}:${values.length === 2 ? values[0] : item?.current_revision}`,
        );
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

async function serverFor(t) {
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
  const get = async (cid, revision) =>
    (
      await (
        await fetch(`${origin}/api/circuits/${cid}${revision ? `?revision=${revision}` : ''}`)
      ).json()
    ).circuit;
  return { origin, pool, send, get };
}

function prepared(source) {
  const base = engine.simulate(source);
  const display = plot.resolveDisplay(base, source);
  return { result: plot.buildResult(base, display).result, display };
}

test('HTTP revisions and shared Max context retain original marker styles after note edits, deletion, mathematics and mode changes', async (t) => {
  const { origin, pool, send, get } = await serverFor(t);
  const original = document();
  const createdResponse = await send('/', 'POST', { title: '差值曲线标记', document: original });
  assert.equal(createdResponse.status, 201);
  const { circuit: created } = await createdResponse.json();
  assert.deepEqual(created.document.display.annotations, original.display.annotations);
  const changed = structuredClone(original);
  changed.display.mode = 'xt';
  changed.display.math[0].expression = 'CH1+CH2';
  changed.display.ranges = { xMin: 0, xMax: 1, yMin: -16, yMax: 16 };
  changed.display.annotations = [
    {
      ...changed.display.annotations[0],
      text: '相加后的采样峰值',
      marker: 'horizontal',
      mode: 'xt',
      xTraceId: null,
    },
  ];
  const updatedResponse = await send(`/${created.cid}`, 'PUT', {
    title: '相加曲线标记',
    document: changed,
    expectedRevision: 1,
  });
  assert.equal(updatedResponse.status, 200);
  assert.equal((await updatedResponse.json()).circuit.revision, 2);
  const pinned = await get(created.cid, 1);
  const latest = await get(created.cid);
  assert.equal(pinned.canEdit, false);
  assert.equal(pinned.latestRevision, 2);
  assert.deepEqual(pinned.document, original);
  assert.deepEqual(latest.document, changed);
  const oldChart = prepared(pinned.document);
  const oldPoint = annotations.resolve(
    pinned.document.display.annotations[0],
    oldChart.result,
    oldChart.display,
  );
  assert.equal(oldPoint.at, 0.25);
  assert.ok(Math.abs(oldPoint.x - 10) < 1e-9);
  assert.ok(Math.abs(oldPoint.y - 5) < 1e-9);
  const newChart = prepared(latest.document);
  const newPoint = annotations.resolve(
    latest.document.display.annotations[0],
    newChart.result,
    newChart.display,
  );
  assert.equal(newPoint.at, 0.25);
  assert.equal(newPoint.x, 0.25);
  assert.ok(Math.abs(newPoint.y - 15) < 1e-9);
  const imported = engine.validateDocument(JSON.parse(JSON.stringify(pinned.document)));
  assert.deepEqual(imported.display.annotations, original.display.annotations);
  const context = await enrichAgentCircuitContext(
    {
      messages: [
        {
          role: 'user',
          content: `看看标记 [波形](/circuit?cid=${created.cid}&revision=1&view=waveform)`,
        },
      ],
    },
    { pool, publicWebUrl: origin },
  );
  assert.deepEqual(context.context.circuits[0].display.annotations, original.display.annotations);
  assert.equal(context.context.circuits[0].revision, 1);
  assert.match(context.messages.at(-1).content, /差值采样峰值/);
  assert.doesNotMatch(context.messages.at(-1).content, /相加后的采样峰值/);
  assert.match(context.messages.at(-1).content, /未经过本次仿真验证/);
  const latestContext = await enrichAgentCircuitContext(
    { messages: [{ role: 'user', content: `/circuit?cid=${created.cid}` }] },
    { pool, publicWebUrl: origin },
  );
  assert.deepEqual(
    latestContext.context.circuits[0].display.annotations,
    changed.display.annotations,
  );
  const conflict = await send(`/${created.cid}`, 'PUT', {
    title: '冲突版本',
    document: original,
    expectedRevision: 1,
  });
  assert.equal(conflict.status, 409);
  assert.deepEqual((await get(created.cid)).document, changed);
});

test('saved anchors remain recoverable when hidden or resampled, and old documents do not acquire annotations', async (t) => {
  const { send, get } = await serverFor(t);
  const original = document();
  const hidden = structuredClone(original);
  hidden.display.mode = 'xt';
  hidden.analysis.step = 0.2;
  const response = await send('/', 'POST', { title: '暂时隐藏的标记', document: hidden });
  assert.equal(response.status, 201);
  const { circuit } = await response.json();
  const stored = (await get(circuit.cid, 1)).document;
  assert.deepEqual(stored.display.annotations, original.display.annotations);
  const chart = prepared(stored);
  assert.match(
    annotations.resolve(stored.display.annotations[0], chart.result, chart.display).error,
    /模式/,
  );
  const restoredDisplay = { ...chart.display, mode: 'xy' };
  const restored = annotations.resolve(
    stored.display.annotations[0],
    chart.result,
    restoredDisplay,
  );
  assert.equal(restored.at, 0.2);
  assert.ok(Number.isFinite(restored.x) && Number.isFinite(restored.y));
  assert.equal(stored.display.annotations[0].at, 0.25);
  const missingMath = structuredClone(stored);
  missingMath.display.math = [];
  const missingResponse = await send(`/${circuit.cid}`, 'PUT', {
    title: '已删除公式',
    document: missingMath,
    expectedRevision: 1,
  });
  assert.equal(missingResponse.status, 200);
  assert.deepEqual(
    (await get(circuit.cid)).document.display.annotations,
    original.display.annotations,
  );
  assert.deepEqual((await get(circuit.cid, 1)).document, stored);
  const legacyPoints = document();
  for (const annotation of legacyPoints.display.annotations) delete annotation.marker;
  const legacyPointsResponse = await send('/', 'POST', {
    title: '未指定样式的旧标记',
    document: legacyPoints,
  });
  assert.equal(legacyPointsResponse.status, 201);
  const { circuit: legacyPointsCircuit } = await legacyPointsResponse.json();
  assert.deepEqual(legacyPointsCircuit.document, legacyPoints);
  const importedPoints = engine.validateDocument(
    JSON.parse(JSON.stringify((await get(legacyPointsCircuit.cid)).document)),
  );
  assert.deepEqual(importedPoints, legacyPoints);
  assert.ok(
    importedPoints.display.annotations.every((annotation) => !Object.hasOwn(annotation, 'marker')),
  );
  const legacy = document();
  delete legacy.display.annotations;
  const legacyResponse = await send('/', 'POST', { title: '旧图像配置', document: legacy });
  assert.equal(legacyResponse.status, 201);
  const { circuit: legacyCircuit } = await legacyResponse.json();
  assert.equal(Object.hasOwn(legacyCircuit.document.display, 'annotations'), false);
  assert.equal(
    Object.hasOwn((await get(legacyCircuit.cid)).document.display, 'annotations'),
    false,
  );
});

test('HTTP annotation validation rejects injected fields, invalid coordinates and oversized batches without writing revisions', async (t) => {
  const { send, get } = await serverFor(t);
  const original = document();
  const createdResponse = await send('/', 'POST', { title: '边界测试', document: original });
  const { circuit } = await createdResponse.json();
  const base = original.display.annotations[0];
  const invalidAnnotations = [
    [{ ...base, url: 'https://example.invalid/collect' }],
    [{ ...base, y: 12345 }],
    [{ ...base, at: null }],
    [{ ...base, at: '0.25' }],
    [{ ...base, at: 1e16 }],
    ...[null, '', {}, [], ['vertical'], 'diagonal', 'Vertical', 0].map((marker) => [
      { ...base, marker },
    ]),
    [{ ...base, text: '字'.repeat(161) }],
    [{ ...base, mode: 'xy', axis: 'phase' }],
    [{ ...base, mode: 'xt', xTraceId: 'V:S1' }],
    [{ ...base, analysisKey: 'sweep:V1:dc;alert(1)' }],
    [{ ...base, traceId: '<script>' }],
    [{ ...base, id: '__proto__' }],
    [base, { ...base }],
    Array.from({ length: 33 }, (_, index) => ({ ...base, id: `A${index + 1}` })),
    [JSON.parse(JSON.stringify(base).replace('"text":', '"constructor": {}, "text":'))],
    [
      JSON.parse(
        JSON.stringify(base).replace('"text":', '"__proto__": {"polluted": true}, "text":'),
      ),
    ],
  ];
  for (const values of invalidAnnotations) {
    const source = structuredClone(original);
    source.display.annotations = values;
    const response = await send(`/${circuit.cid}`, 'PUT', {
      title: '无效更新',
      document: source,
      expectedRevision: 1,
    });
    assert.equal(response.status, 400, JSON.stringify(values));
    if (Object.hasOwn(values[0], 'marker') && values[0].marker !== 'vertical') {
      const createResponse = await send('/', 'POST', { title: '无效标记样式', document: source });
      assert.equal(createResponse.status, 400, JSON.stringify(values));
    }
  }
  const unchanged = await get(circuit.cid);
  assert.equal(unchanged.revision, 1);
  assert.deepEqual(unchanged.document, original);
  assert.equal({}.polluted, undefined);
  const boundary = structuredClone(original);
  boundary.display.annotations = Array.from({ length: 32 }, (_, index) => ({
    ...base,
    id: `A${index + 1}`,
    text: index ? '字'.repeat(160) : '<script>只作为文字</script>\n新行 & 注释',
  }));
  const accepted = await send(`/${circuit.cid}`, 'PUT', {
    title: '32 个合法标记',
    document: boundary,
    expectedRevision: 1,
  });
  assert.equal(accepted.status, 200);
  assert.deepEqual(
    (await get(circuit.cid)).document.display.annotations,
    boundary.display.annotations,
  );
  assert.deepEqual((await get(circuit.cid, 1)).document, original);
});
