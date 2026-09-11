/* Test fixtures intentionally mutate isolated candidate documents. */
/* eslint-disable no-param-reassign */
const assert = require('node:assert/strict');
const test = require('node:test');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const express = require('express');
const sharp = require('sharp');
const { buildNets, simulate, validateDocument } = require('../public/circuit-engine');
const { getWireRoute } = require('../public/circuit-renderer');
const {
  MAX_IMAGE_BYTES,
  MAX_RESPONSE_BYTES,
  prepareCircuitRecognitionInput,
  buildCircuitRecognitionPayload,
  parseCircuitRecognitionResponse,
  resolveVisionModel,
  createCircuitRecognitionRouter,
} = require('./circuit-recognition');

const imagePromise = sharp({ create: { width: 32, height: 32, channels: 3, background: 'white' } })
  .png()
  .toBuffer()
  .then((bytes) => `data:image/png;base64,${bytes.toString('base64')}`);

function recognizedCircuit() {
  return {
    recognized: true,
    circuit: {
      title: '分压电路',
      description: '6 V 电源，1 kΩ 与 2 kΩ 电阻分压。',
      document: {
        version: 1,
        components: [
          { id: 'V1', type: 'voltage', x: 160, y: 200, rotation: 90, params: { dc: 6 } },
          { id: 'R1', type: 'resistor', x: 320, y: 160, params: { resistance: 1000 } },
          {
            id: 'R2',
            type: 'resistor',
            x: 400,
            y: 240,
            rotation: 90,
            params: { resistance: 2000 },
          },
          { id: 'G1', type: 'ground', x: 400, y: 348, params: {} },
        ],
        wires: [
          { id: 'w1', from: { componentId: 'V1', pin: 0 }, to: { componentId: 'R1', pin: 0 } },
          { id: 'w2', from: { componentId: 'R1', pin: 1 }, to: { componentId: 'R2', pin: 0 } },
          { id: 'w3', from: { componentId: 'R2', pin: 1 }, to: { componentId: 'G1', pin: 0 } },
          { id: 'w4', from: { componentId: 'V1', pin: 1 }, to: { componentId: 'G1', pin: 0 } },
        ],
        analysis: { type: 'dc' },
      },
    },
    warnings: [],
  };
}

function completion(result = recognizedCircuit(), extra = {}) {
  return new Response(
    JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) }, ...extra }],
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

async function startServer(t, options = {}) {
  const app = express();
  app.use(express.json({ limit: '12mb' }));
  app.use(
    '/api/ai/circuit',
    createCircuitRecognitionRouter({
      requireAuth: async (request, response) => {
        if (!request.get('authorization')) {
          response.status(401).json({ message: '请登录' });
          return null;
        }
        return { id: request.get('authorization') };
      },
      readModelSettings: async () => ({
        apiKey: 'private-key',
        baseUrl: 'https://models.example/v1',
        model: 'vision-model',
      }),
      fetchImpl: async () => completion(),
      ...options,
    }),
  );
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => {
      server.close(resolve);
    });
  });
  const url = `http://127.0.0.1:${server.address().port}/api/ai/circuit/recognize`;
  return async (body = {}, { auth = 'user-1', signal } = {}) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
      body: JSON.stringify({ imageDataUrl: await imagePromise, ...body }),
      signal,
    });
}

test('image preparation fully decodes pixels, normalizes to bounded JPEG, and preserves instructions', async () => {
  const result = await prepareCircuitRecognitionInput({
    imageDataUrl: await imagePromise,
    instructions: ' R1=1kΩ ',
  });
  assert.equal(result.instructions, 'R1=1kΩ');
  assert.match(result.imageDataUrl, /^data:image\/jpeg;base64,/);
  const bytes = Buffer.from(result.imageDataUrl.split(',')[1], 'base64');
  assert.ok(bytes.length < 4 * 1024 * 1024);
  const metadata = await sharp(bytes).metadata();
  assert.equal(metadata.format, 'jpeg');
  assert.equal(metadata.width, 32);
  assert.equal(metadata.exif, undefined);
  const large = await sharp({
    create: { width: 2800, height: 100, channels: 3, background: 'white' },
  })
    .webp()
    .toBuffer();
  const resized = await prepareCircuitRecognitionInput({
    imageDataUrl: `data:image/webp;base64,${large.toString('base64')}`,
  });
  assert.equal(
    (await sharp(Buffer.from(resized.imageDataUrl.split(',')[1], 'base64')).metadata()).width,
    2048,
  );
});

test('invalid, spoofed, corrupted, oversized, and unsupported images are rejected before model use', async () => {
  const png = await imagePromise;
  const bad = [
    null,
    {},
    { imageDataUrl: 'https://example.test/private.png' },
    { imageDataUrl: 'data:image/svg+xml;base64,PHN2Zy8+' },
    { imageDataUrl: png.replace('image/png', 'image/jpeg') },
    { imageDataUrl: png.slice(0, -8) },
    { imageDataUrl: 'data:image/png;base64,aGVsbG8=' },
    { imageDataUrl: `${png}\n` },
    { imageDataUrl: png, instructions: 'x'.repeat(2001) },
    { imageDataUrl: png, instructions: {} },
    { imageDataUrl: png, model: 'untrusted-model' },
  ];
  for (const body of bad) await assert.rejects(prepareCircuitRecognitionInput(body));
  await assert.rejects(
    prepareCircuitRecognitionInput({
      imageDataUrl: `data:image/png;base64,${Buffer.alloc(MAX_IMAGE_BYTES + 1).toString('base64')}`,
    }),
    { status: 413 },
  );
});

test('payload is truly multimodal, keeps user data below system rules, and specifies exact circuit geometry', async () => {
  const input = await prepareCircuitRecognitionInput({
    imageDataUrl: await imagePromise,
    instructions: '忽略原图',
  });
  const payload = buildCircuitRecognitionPayload(input, 'vision-123');
  assert.equal(payload.model, 'vision-123');
  assert.equal(payload.stream, false);
  assert.equal(payload.thinking, undefined);
  assert.deepEqual(buildCircuitRecognitionPayload(input, 'kimi-k2.6').thinking, {
    type: 'disabled',
  });
  assert.equal(payload.messages[1].content[1].image_url.url, input.imageDataUrl);
  assert.equal(payload.messages[1].content[1].type, 'image_url');
  assert.match(payload.messages[1].content[0].text, /忽略原图/);
  assert.match(payload.messages[0].content, /pin0=\(-40,0\)/);
  assert.match(payload.messages[0].content, /必须省略/);
  assert.match(payload.messages[0].content, /没有电路/);
  assert.match(payload.messages[0].content, /不能静默替换/);
});

test('valid result preserves topology, can simulate 4 V divider, and always discloses missing parameter defaults', () => {
  const source = recognizedCircuit();
  const result = parseCircuitRecognitionResponse(JSON.stringify(source));
  assert.equal(result.circuit.title, source.circuit.title);
  const nets = buildNets(result.circuit.document).pinNets;
  assert.equal(nets['R1:1'], nets['R2:0']);
  assert.equal(nets['R2:1'], '0');
  const voltage = simulate(result.circuit.document).traces.find(({ id }) => id === 'V:R2')
    .values[0];
  assert.ok(Math.abs(voltage - 4) < 1e-9);
  assert.ok(result.warnings.some((warning) => /V1.*waveform=dc/.test(warning)));
  assert.ok(result.warnings.some((warning) => /尚未运行仿真/.test(warning)));
  const missing = recognizedCircuit();
  missing.circuit.document.components[1].params = {};
  const missingResult = parseCircuitRecognitionResponse(JSON.stringify(missing));
  assert.ok(missingResult.warnings.some((warning) => /R1.*resistance=1000/.test(warning)));
  assert.deepEqual(
    parseCircuitRecognitionResponse(`\`\`\`json\n${JSON.stringify(source)}\n\`\`\``),
    result,
  );
});

test('recognized diagonal wire geometry becomes orthogonal while electrical data stays identical', () => {
  const source = recognizedCircuit();
  source.circuit.document.components[0].x += 7;
  source.circuit.document.components[1].y -= 3;
  source.circuit.document.wires.forEach((wire) => {
    wire.points = [];
  });
  const original = validateDocument(source.circuit.document);
  const { circuit } = parseCircuitRecognitionResponse(JSON.stringify(source));
  const result = circuit.document;
  assert.deepEqual(buildNets(result).pinNets, buildNets(original).pinNets);
  assert.deepEqual(simulate(result).frames, simulate(original).frames);
  assert.deepEqual(
    result.components.map(({ x, y, ...component }) => component),
    original.components.map(({ x, y, ...component }) => component),
  );
  result.components.forEach(({ x, y }) => {
    assert.equal(x % 20, 0);
    assert.equal(y % 20, 0);
  });
  result.wires.forEach((wire, index) => {
    assert.deepEqual(wire.from, original.wires[index].from);
    assert.deepEqual(wire.to, original.wires[index].to);
    const route = getWireRoute(wire, result.components);
    assert.ok(route.length >= 2);
    route.slice(1).forEach((point, pointIndex) => {
      const previous = route[pointIndex];
      assert.ok(point.x === previous.x || point.y === previous.y, `${wire.id} contains a diagonal`);
    });
  });
});

test('model output enforces circuit metadata, strict editor fields, topology, bounds, and JSON safety', () => {
  const mutations = [
    (result) => {
      result.circuit.title = '';
    },
    (result) => {
      result.circuit.cid = 'injected';
    },
    (result) => {
      result.circuit.description = 'x'.repeat(2001);
    },
    (result) => {
      result.circuit.document.components[0].owner = 'injected';
    },
    (result) => {
      result.circuit.document.components[0].type = 'transformer';
    },
    (result) => {
      result.circuit.document.components[0].params.dc = '6V';
    },
    (result) => {
      result.circuit.document.wires[0].to.pin = 9;
    },
    (result) => {
      result.circuit.document.components[0].rotation = 1;
    },
    (result) => {
      result.circuit.document.components[0].x = 100001;
    },
    (result) => {
      result.circuit.document.components[0].params.extra = 1;
    },
    (result) => {
      result.circuit.document.wires[0].from.componentId = 'missing';
    },
    (result) => {
      result.circuit.document.wires[0].points = [{ x: 1, y: 2, code: 'run()' }];
    },
    (result) => {
      result.circuit.document.wires[0].points = Array(33).fill({ x: 1, y: 2 });
    },
    (result) => {
      result.warnings = Array(31).fill('提示');
    },
    (result) => {
      result.warnings = ['x'.repeat(501)];
    },
  ];
  for (const mutate of mutations) {
    const result = recognizedCircuit();
    mutate(result);
    assert.throws(() => parseCircuitRecognitionResponse(JSON.stringify(result)), {
      status: 502,
      code: 'invalid_circuit_recognition_result',
    });
  }
  assert.throws(() => parseCircuitRecognitionResponse('{"recognized":true,"__proto__":{"x":1}}'), {
    status: 502,
  });
  assert.throws(() => parseCircuitRecognitionResponse('x'.repeat(128 * 1024 + 1)), { status: 502 });
  assert.throws(() => parseCircuitRecognitionResponse('Here is the circuit: {}'), { status: 502 });
});

test('verified provider warning nesting is normalized without losing warnings or relaxing document validation', () => {
  const canonical = recognizedCircuit();
  canonical.warnings = ['R1 标值请核对。'];
  const nested = structuredClone(canonical);
  nested.circuit.warnings = nested.warnings;
  delete nested.warnings;
  assert.deepEqual(
    parseCircuitRecognitionResponse(JSON.stringify(nested)),
    parseCircuitRecognitionResponse(JSON.stringify(canonical)),
  );
  const variants = [
    (result) => {
      result.circuit.warnings = 'not an array';
    },
    (result) => {
      result.circuit.warnings = ['x'.repeat(501)];
    },
    (result) => {
      result.circuit.extra = 'unknown field';
    },
    (result) => {
      result.extra = 'unknown field';
    },
    (result) => {
      result.warnings = ['ambiguous duplicate'];
    },
    (result) => {
      result.circuit.document.components[0].params.injected = 1;
    },
    (result) => {
      result.circuit.document.wires[0].to.pin = 100;
    },
  ];
  for (const mutate of variants) {
    const candidate = structuredClone(nested);
    mutate(candidate);
    assert.throws(() => parseCircuitRecognitionResponse(JSON.stringify(candidate)), {
      status: 502,
      code: 'invalid_circuit_recognition_result',
    });
  }
});

test('non-circuit refusal and empty recognition never fabricate a starter circuit', () => {
  assert.throws(
    () => parseCircuitRecognitionResponse('{"recognized":false,"reason":"图片是风景，没有电路"}'),
    { status: 422, code: 'circuit_not_recognized', message: '图片是风景，没有电路' },
  );
  const empty = recognizedCircuit();
  empty.circuit.document.components = [];
  empty.circuit.document.wires = [];
  assert.throws(() => parseCircuitRecognitionResponse(JSON.stringify(empty)), { status: 422 });
});

test('model selection uses explicit override, documented Infini vision fallback, and other providers settings', () => {
  assert.equal(
    resolveVisionModel({ baseUrl: 'https://cloud.infini-ai.com/maas/v1', model: 'glm-5.1' }, ''),
    'kimi-k2.6',
  );
  assert.equal(
    resolveVisionModel({ baseUrl: 'https://cloud.infini-ai.com/maas/v1', model: 'kimi-k3' }, ''),
    'kimi-k3',
  );
  assert.equal(
    resolveVisionModel({ baseUrl: 'https://models.example/v1', model: 'configured-model' }, ''),
    'configured-model',
  );
  assert.equal(resolveVisionModel({}, 'explicit-vision'), 'explicit-vision');
});

test('HTTP authenticates and validates before accessing model configuration', async (t) => {
  let reads = 0;
  const post = await startServer(t, {
    readModelSettings: async () => {
      reads += 1;
      throw new Error('private database');
    },
  });
  assert.equal((await post({}, { auth: '' })).status, 401);
  assert.equal((await post({ imageDataUrl: 'bad' })).status, 400);
  assert.equal(reads, 0);
  const unavailable = await post();
  assert.equal(unavailable.status, 503);
  assert.doesNotMatch(JSON.stringify(await unavailable.json()), /private database/);
  const authFailure = await startServer(t, {
    requireAuth: async () => {
      throw new Error('secret auth failure');
    },
  });
  const authResponse = await authFailure();
  assert.equal(authResponse.status, 503);
  assert.equal((await authResponse.json()).code, 'circuit_recognition_auth_unavailable');
});

test('HTTP reads current secret model settings, passes actual image, and returns a validated editable circuit', async (t) => {
  let calls = 0;
  const post = await startServer(t, {
    fetchImpl: async (url, options) => {
      calls += 1;
      assert.equal(url, 'https://models.example/v1/chat/completions');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, 'Bearer private-key');
      assert.equal(options.signal.aborted, false);
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'vision-model');
      assert.match(body.messages[1].content[1].image_url.url, /^data:image\/jpeg;base64,/);
      return completion();
    },
  });
  const response = await post();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const result = await response.json();
  assert.equal(result.circuit.title, '分压电路');
  assert.equal(result.circuit.document.components.length, 4);
  result.circuit.document.wires.forEach((wire) => {
    assert.ok(Array.isArray(wire.points));
    const route = getWireRoute(wire, result.circuit.document.components);
    route.slice(1).forEach((point, index) => {
      assert.ok(point.x === route[index].x || point.y === route[index].y);
    });
  });
  assert.equal(calls, 1);
});

test('HTTP protects credentials on upstream errors and rejects redirects, missing settings, truncation and oversized responses', async (t) => {
  const cases = [
    { fetchImpl: async () => new Response('secret-token=abcdef', { status: 401 }), status: 503 },
    {
      fetchImpl: async () => new Response('image model unsupported', { status: 400 }),
      status: 502,
    },
    {
      fetchImpl: async () => completion(recognizedCircuit(), { finish_reason: 'length' }),
      status: 502,
    },
    { fetchImpl: async () => new Response('{"choices":'), status: 502 },
    { fetchImpl: async () => new Response('x'.repeat(MAX_RESPONSE_BYTES + 1)), status: 502 },
    {
      fetchImpl: async () =>
        new Response('small body', { headers: { 'content-length': MAX_RESPONSE_BYTES + 1 } }),
      status: 502,
    },
    { readModelSettings: async () => ({}), status: 503 },
    {
      readModelSettings: async () => ({
        apiKey: 'secret',
        baseUrl: 'https://user:pass@models.example/v1',
        model: 'vision',
      }),
      status: 503,
    },
    { fetchImpl: async () => completion({ recognized: false, reason: '没有电路' }), status: 422 },
  ];
  for (const { status, ...options } of cases) {
    const post = await startServer(t, options);
    const response = await post();
    assert.equal(response.status, status);
    const result = await response.json();
    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result), /abcdef|user:pass/);
  }
});

test('heartbeat JSON stays parseable, timeout aborts a stalled fetch and releases per-user capacity', async (t) => {
  let calls = 0;
  let upstreamSignal;
  const post = await startServer(t, {
    heartbeatMs: 5,
    requestTimeoutMs: 80,
    fetchImpl: async (_url, { signal }) => {
      calls += 1;
      upstreamSignal = signal;
      if (calls > 1) return completion();
      return new Promise(() => {});
    },
  });
  const response = await post();
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.match(text, /^\n/);
  assert.equal(JSON.parse(text).status, 504);
  assert.equal(upstreamSignal.aborted, true);
  assert.equal((await (await post()).json()).circuit.title, '分压电路');
});

test('timeout cancels stalled response readers even after upstream headers arrive', async (t) => {
  let cancelled = false;
  const post = await startServer(t, {
    heartbeatMs: 5,
    requestTimeoutMs: 50,
    fetchImpl: async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
      ),
  });
  const result = await (await post()).json();
  assert.equal(result.status, 504);
  assert.equal(cancelled, true);
});

test('client abort cancels upstream generation and duplicate active requests are rejected', async (t) => {
  let notifyStarted;
  const started = new Promise((resolve) => {
    notifyStarted = resolve;
  });
  let upstreamSignal;
  let calls = 0;
  const post = await startServer(t, {
    heartbeatMs: 5,
    maxConcurrent: 1,
    fetchImpl: async (_url, { signal }) => {
      calls += 1;
      if (calls > 1) return completion();
      upstreamSignal = signal;
      notifyStarted();
      return new Promise(() => {});
    },
  });
  const controller = new AbortController();
  const pending = post({}, { signal: controller.signal });
  await started;
  assert.equal((await post()).status, 429);
  assert.equal((await post({}, { auth: 'user-2' })).status, 429);
  const cancelled = new Promise((resolve) => {
    upstreamSignal.addEventListener('abort', resolve, { once: true });
  });
  controller.abort();
  await pending.then((response) => response.text()).catch(() => {});
  await cancelled;
  assert.equal(upstreamSignal.aborted, true);
  assert.equal((await (await post()).json()).circuit.title, '分压电路');
});

test('timeout during settings lookup never starts a late billed vision request', async (t) => {
  let finishSettings;
  let visionCalls = 0;
  const settings = new Promise((resolve) => {
    finishSettings = resolve;
  });
  const post = await startServer(t, {
    heartbeatMs: 5,
    requestTimeoutMs: 40,
    readModelSettings: () => settings,
    fetchImpl: async () => {
      visionCalls += 1;
      return completion();
    },
  });
  const response = await (await post()).json();
  assert.equal(response.status, 504);
  finishSettings({
    apiKey: 'private-key',
    baseUrl: 'https://models.example/v1',
    model: 'vision-model',
  });
  await settings;
  assert.equal(visionCalls, 0);
});

test('one invalid model document gets one repair with the same image and bounded validation feedback', async (t) => {
  const invalid = recognizedCircuit();
  invalid.circuit.document.components[0].rotation = -90;
  const calls = [];
  const signals = [];
  let settingsReads = 0;
  const post = await startServer(t, {
    readModelSettings: async () => {
      settingsReads += 1;
      return { apiKey: 'private-key', baseUrl: 'https://models.example/v1', model: 'vision-model' };
    },
    fetchImpl: async (_url, options) => {
      calls.push(JSON.parse(options.body));
      signals.push(options.signal);
      return completion(calls.length === 1 ? invalid : recognizedCircuit());
    },
  });
  const response = await post({ instructions: '仅识别原图' });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(settingsReads, 1);
  assert.equal(signals[0], signals[1]);
  assert.deepEqual(calls[1].messages.slice(0, 2), calls[0].messages);
  const correction = calls[1].messages[2];
  assert.equal(correction.role, 'user');
  assert.match(correction.content, /唯一一次/);
  assert.match(correction.content, /不得输出其他字段/);
  const feedback = JSON.parse(correction.content.split('\n').at(-1));
  assert.equal(feedback.previousResponse, JSON.stringify(invalid));
  assert.match(feedback.validationIssue, /旋转角度/);
  assert.ok(feedback.validationIssue.length <= 500);
  assert.ok(
    Math.abs(
      simulate(result.circuit.document).traces.find(({ id }) => id === 'V:R2').values[0] - 4,
    ) < 1e-9,
  );
  assert.doesNotMatch(JSON.stringify(result), /validationIssue|previousResponse|private-key/);
});

test('two invalid model contents stop after one repair without exposing raw data or accepting dangerous fields', async (t) => {
  let calls = 0;
  const post = await startServer(t, {
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return completion(null, { message: { content: '{broken-json raw-marker' } });
      const bad = recognizedCircuit();
      bad.circuit.document.components[0].execute = 'raw-marker-run()';
      return completion(bad);
    },
  });
  const response = await post();
  const result = await response.json();
  assert.equal(response.status, 502);
  assert.equal(result.code, 'invalid_circuit_recognition_result');
  assert.equal(calls, 2);
  assert.doesNotMatch(JSON.stringify(result), /raw-marker|previousResponse|validationIssue/);
});

test('refusal, upstream errors, output bounds, and truncated transport do not trigger repair calls', async (t) => {
  const responses = [
    () => completion({ recognized: false, reason: '图片没有电路' }),
    () => completion(null, { finish_reason: 'content_filter', message: { content: null } }),
    () => new Response('upstream error', { status: 500 }),
    () => new Response('bad credential', { status: 401 }),
    () => completion(recognizedCircuit(), { finish_reason: 'length' }),
    () => completion(null, { message: { content: 'x'.repeat(128 * 1024 + 1) } }),
    () => new Response('x'.repeat(MAX_RESPONSE_BYTES + 1)),
    () => new Response('{"choices":'),
  ];
  for (const makeResponse of responses) {
    let calls = 0;
    const post = await startServer(t, {
      fetchImpl: async () => {
        calls += 1;
        return makeResponse();
      },
    });
    assert.equal((await (await post()).json()).ok, false);
    assert.equal(calls, 1);
  }
});

test('cancelling during repair aborts its upstream request and keeps the concurrency lock until exit', async (t) => {
  let notifyRepair;
  const repairStarted = new Promise((resolve) => {
    notifyRepair = resolve;
  });
  const signals = [];
  let calls = 0;
  const post = await startServer(t, {
    heartbeatMs: 5,
    maxConcurrent: 1,
    fetchImpl: async (_url, { signal }) => {
      calls += 1;
      signals.push(signal);
      if (calls === 1) return completion({ recognized: true, circuit: {} });
      if (calls > 2) return completion();
      notifyRepair();
      return new Promise(() => {});
    },
  });
  const controller = new AbortController();
  const pending = post({}, { signal: controller.signal });
  await repairStarted;
  assert.equal((await post()).status, 429);
  assert.equal((await post({}, { auth: 'user-2' })).status, 429);
  assert.equal(signals[0], signals[1]);
  const stopped = new Promise((resolve) => {
    signals[1].addEventListener('abort', resolve, { once: true });
  });
  controller.abort();
  await pending.then((response) => response.text()).catch(() => {});
  await stopped;
  assert.equal(calls, 2);
  assert.equal(signals[1].aborted, true);
  assert.equal((await (await post()).json()).circuit.title, '分压电路');
});

test('repair consumes the original timeout budget instead of starting a fresh deadline', async (t) => {
  let calls = 0;
  const signals = [];
  const post = await startServer(t, {
    heartbeatMs: 5,
    requestTimeoutMs: 180,
    fetchImpl: async (_url, { signal }) => {
      calls += 1;
      signals.push(signal);
      if (calls === 1) {
        await delay(70, undefined, { signal });
        return completion({ recognized: true, circuit: {} });
      }
      await delay(140, undefined, { signal });
      return completion();
    },
  });
  const response = await post();
  const result = await response.json();
  assert.equal(response.status, 200, 'heartbeat already sent successful HTTP headers');
  assert.equal(result.status, 504);
  assert.equal(result.code, 'circuit_recognition_timeout');
  assert.equal(calls, 2);
  assert.equal(signals[0], signals[1]);
  assert.equal(signals[1].aborted, true);
});
