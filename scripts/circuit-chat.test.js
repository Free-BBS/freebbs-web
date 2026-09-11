const assert = require('node:assert/strict');
const test = require('node:test');
const chat = require('../public/circuit-chat');
const agent = require('../public/circuit-agent');

const encoder = new TextEncoder();
const final = { answer: '仿真已完成。', actions: [], done: true };
const frame = (event, value) => `event: ${event}\ndata: ${JSON.stringify(value)}\n\n`;
function response(text, { size = 1, status = 200, type = 'text/event-stream' } = {}) {
  const bytes = encoder.encode(text);
  let position = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (position >= bytes.length) {
          controller.close();
          return;
        }
        controller.enqueue(bytes.slice(position, position + size));
        position += size;
      },
    }),
    { status, headers: { 'Content-Type': type } },
  );
}
const request = (fetchImpl, options = {}) =>
  chat.request({
    url: 'https://example.test/api/ai/circuit/chat',
    token: 'test-token',
    payload: { question: '运行仿真' },
    fetchImpl,
    ...options,
  });

test('SSE handles split UTF-8, CRLF, multiline data, comments and unknown events before its final result', async () => {
  const events = [];
  const raw =
    `\ufeff:keepalive\r\n\r\n` +
    `event: status\r\ndata: {"phase":"thinking",\r\ndata: "message":"正在分析电路"}\r\n\r\n` +
    `event: custom\r\ndata: ignored extension\r\n\r\n${frame('answer', {
      answer: '实测电流为 1 毫安。',
    }).replaceAll('\n', '\r\n')}${frame('result', final).replaceAll('\n', '\r\n')}`;
  const result = await request(
    async (url, options) => {
      assert.equal(url, 'https://example.test/api/ai/circuit/chat');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Accept, 'text/event-stream');
      assert.equal(options.headers.Authorization, 'Bearer test-token');
      assert.equal(JSON.parse(options.body).question, '运行仿真');
      return response(raw);
    },
    { onProgress: (progress) => events.push(progress) },
  );
  assert.deepEqual(result, final);
  assert.deepEqual(events, [
    { type: 'status', phase: 'thinking', message: '正在分析电路' },
    { type: 'answer', answer: '实测电流为 1 毫安。' },
  ]);
});

test('SSE also accepts bare CR lines and an immediately completed result closes the body', async () => {
  let cancelled = false;
  const result = await request(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(frame('result', final).replaceAll('\n', '\r')));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      ),
  );
  assert.deepEqual(result, final);
  assert.equal(cancelled, true);
});

test('JSON fallback preserves results and reports JSON envelopes or non-JSON HTTP errors', async () => {
  assert.deepEqual(
    await request(async () => response(JSON.stringify(final), { type: 'application/json' })),
    final,
  );
  await assert.rejects(
    request(async () =>
      response(
        JSON.stringify({ ok: false, status: 504, message: '上游超时', code: 'agent_timeout' }),
        { type: 'application/json' },
      ),
    ),
    (error) =>
      error.status === 504 && error.code === 'agent_timeout' && error.message === '上游超时',
  );
  await assert.rejects(
    request(async () => response('<html>Bad Gateway</html>', { type: 'text/html', status: 502 })),
    (error) => error.status === 502 && /服务连接失败/.test(error.message),
  );
  await assert.rejects(
    request(async () =>
      response(JSON.stringify({ message: '需要登录' }), { type: 'application/json', status: 401 }),
    ),
    (error) => error.status === 401 && error.message === '需要登录',
  );
});

test('error events reject a partial answer, and malformed or absent result events never succeed', async () => {
  await assert.rejects(
    request(async () =>
      response(
        frame('answer', { answer: '正在处理。' }) +
          frame('error', {
            ok: false,
            status: 504,
            message: '模型无响应',
            detail: '请重试',
            code: 'model_idle',
          }),
      ),
    ),
    (error) =>
      error.status === 504 && error.code === 'model_idle' && error.message === '模型无响应：请重试',
  );
  for (const raw of [
    frame('answer', { answer: '{"actions":[{"type":"run_simulation"}]}' }),
    'event: result\ndata: {"answer":"未完成", "actions":[',
    `event: result\ndata: ${JSON.stringify(final)}`,
    `event: result\ndata: ${JSON.stringify(final)}\n`,
    ':keepalive\n\n',
    frame('result', { answer: '错误', actions: {} }),
    frame('result', []),
    'event: result\ndata: invalid\n\n',
  ])
    await assert.rejects(
      request(async () => response(raw)),
      /完整|无效|格式/,
    );
});

test('external cancellation interrupts a stalled body, cancels the stream and silences later data', async () => {
  const controller = new AbortController();
  let cancelCount = 0;
  let streamController;
  const updates = [];
  const failure = Object.assign(new Error('用户停止'), { code: 'AGENT_STOPPED' });
  const result = request(
    async () =>
      new Response(
        new ReadableStream({
          start(value) {
            streamController = value;
            value.enqueue(encoder.encode(frame('answer', { answer: '准备开始。' })));
          },
          cancel() {
            cancelCount += 1;
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      ),
    {
      signal: controller.signal,
      onProgress(progress) {
        updates.push(progress);
        controller.abort(failure);
      },
    },
  );
  await assert.rejects(result, (error) => error === failure);
  assert.equal(cancelCount, 1);
  assert.equal(updates.length, 1);
  assert.throws(() => streamController.enqueue(encoder.encode(frame('result', final))));
});

test('an already aborted request never fetches, and fetch implementations ignoring abort still stop', async () => {
  const controller = new AbortController();
  const reason = new Error('取消');
  controller.abort(reason);
  await assert.rejects(
    request(() => assert.fail('fetch must not start'), { signal: controller.signal }),
    (error) => error === reason,
  );
  await assert.rejects(
    request(() => new Promise(() => {}), { idleTimeoutMs: 15, timeoutMs: 200 }),
    (error) => error.code === 'stream_idle',
  );
});

test('heartbeats keep a slow model connected, while the total deadline still bounds its wait', async () => {
  let timer;
  const streamed = (finish) => async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          let beats = 0;
          timer = setInterval(() => {
            beats += 1;
            controller.enqueue(encoder.encode(':keepalive\n\n'));
            if (finish && beats === 6) {
              clearInterval(timer);
              controller.enqueue(encoder.encode(frame('result', final)));
              controller.close();
            }
          }, 15);
        },
        cancel() {
          clearInterval(timer);
        },
      }),
      { headers: { 'Content-Type': 'text/event-stream' } },
    );
  assert.deepEqual(await request(streamed(true), { idleTimeoutMs: 60, timeoutMs: 1000 }), final);
  await assert.rejects(
    request(streamed(false), { idleTimeoutMs: 200, timeoutMs: 70 }),
    (error) => error.code === 'request_timeout',
  );
});

test('the runner never executes actions from streamed text or a result truncated at EOF', async () => {
  for (const raw of [
    frame('answer', { answer: '{"actions":[{"type":"run_simulation"}]}' }),
    `event: result\ndata: ${JSON.stringify({ answer: '开始仿真', actions: [{ type: 'run_simulation' }], done: false })}`,
  ]) {
    const snapshot = {
      document: { version: 1, components: [], wires: [], analysis: { type: 'dc' } },
      cid: 'test',
      generation: 1,
      editVersion: 1,
      canEdit: true,
    };
    let executed = 0;
    let requests = 0;
    const runner = agent.create({
      getSnapshot: () => snapshot,
      beginRun: () => ({ runId: 1, snapshot }),
      endRun: () => {},
      executeActions: () => {
        executed += 1;
      },
      requestStep: (payload, options) => {
        requests += 1;
        return request(async () => response(raw), options);
      },
    });
    const result = await runner.run('运行仿真');
    assert.equal(result.status, 'error');
    assert.equal(executed, 0);
    assert.equal(requests, 3);
    assert.ok(result.observations.every((item) => /未收到完整结果/.test(item.summary)));
  }
});
