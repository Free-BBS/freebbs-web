const assert = require('node:assert/strict');
const test = require('node:test');
const { once } = require('node:events');
const express = require('express');
const { createCircuitAssistantRouter } = require('./circuit-assistant');

function body() {
  return {
    question: '运行仿真后解释电阻电流。',
    document: {
      version: 1,
      components: [{ id: 'R1', type: 'resistor', x: 100, y: 100, params: { resistance: 1000 } }],
      wires: [],
      analysis: { type: 'dc' },
    },
    agent: { step: 1, canEdit: true, observations: [] },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

function upstreamStream() {
  let controller;
  let cancelled = false;
  const stream = new ReadableStream({
    start(value) {
      controller = value;
    },
    cancel() {
      cancelled = true;
    },
  });
  return {
    response: new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }),
    bytes(value) {
      controller.enqueue(Buffer.from(value));
    },
    event(value) {
      controller.enqueue(Buffer.from(`data: ${JSON.stringify(value)}\n\n`));
    },
    close() {
      controller.close();
    },
    get cancelled() {
      return cancelled;
    },
  };
}

async function openRoute(t, options = {}) {
  const app = express();
  app.use(express.json());
  app.use(
    createCircuitAssistantRouter({
      requireAuth: async () => ({ id: 7, uid: 'stream-test-user' }),
      buildAgentChatPayload: (_user, payload) => payload,
      heartbeatMs: 10,
      requestTimeoutMs: 2000,
      idleTimeoutMs: 1000,
      ...options,
    }),
  );
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => {
      server.close(resolve);
    });
  });
  return (requestOptions = {}) =>
    fetch(`http://127.0.0.1:${server.address().port}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(body()),
      ...requestOptions,
    });
}

// Read the actual HTTP body continuously so the tests can assert what reached the
// client before the upstream response completed, rather than inspecting a buffer
// only after EOF.
function receiveEvents(response) {
  const state = { events: [], comments: [], raw: '', ended: false, error: null };
  const changes = new Set();
  const notify = () => {
    [...changes].forEach((callback) => callback());
  };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  function consume(text) {
    state.raw += text;
    buffer += text;
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const lines = block.split('\n');
      const event = lines.find((line) => line.startsWith('event:'));
      const data = lines.filter((line) => line.startsWith('data:'));
      if (data.length) {
        state.events.push({
          event: event ? event.slice(6).trim() : 'message',
          data: JSON.parse(data.map((line) => line.slice(5).trimStart()).join('\n')),
        });
      } else if (lines.some((line) => line.startsWith(':'))) {
        state.comments.push(block);
      }
      boundary = buffer.indexOf('\n\n');
    }
    notify();
  }
  const completion = (async () => {
    try {
      let chunk = await reader.read();
      while (!chunk.done) {
        consume(decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, '\n'));
        chunk = await reader.read();
      }
      consume(decoder.decode());
      state.ended = true;
    } catch (error) {
      state.error = error;
    } finally {
      notify();
    }
  })();
  function until(predicate, timeoutMs = 1000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        changes.delete(check);
        reject(new Error(`Timed out waiting for SSE condition: ${state.raw}`));
      }, timeoutMs);
      function check() {
        if (predicate(state)) {
          clearTimeout(timer);
          changes.delete(check);
          resolve(state);
        } else if (state.error || state.ended) {
          clearTimeout(timer);
          changes.delete(check);
          reject(state.error || new Error(`Stream ended before condition: ${state.raw}`));
        }
      }
      changes.add(check);
      check();
    });
  }
  return { state, completion, until };
}

function resultEvents(state) {
  return state.events.filter((event) => event.event === 'result');
}

function assertNoPrematureActions(state) {
  assert.equal(resultEvents(state).length, 0);
  state.events.forEach((event) => {
    assert.notEqual(event.event, 'actions');
    assert.equal(Object.hasOwn(event.data, 'actions'), false);
    if (event.event === 'answer') {
      assert.doesNotMatch(event.data.answer, /actions|run_simulation|```|~~~/);
    }
  });
}

test(
  'SSE sends status before upstream headers, streams safe prose before done and validates actions only once',
  { timeout: 5000 },
  async (t) => {
    const pending = deferred();
    const started = deferred();
    const upstream = upstreamStream();
    const send = await openRoute(t, {
      postAgentChat: async (payload) => {
        assert.equal(payload.stream, true);
        started.resolve();
        return pending.promise;
      },
    });
    const response = await send();
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/event-stream/);
    assert.match(response.headers.get('cache-control'), /(?:^|,\s*)no-store(?:,|$)/);
    assert.equal(response.headers.get('x-accel-buffering'), 'no');
    const received = receiveEvents(response);
    await started.promise;
    await received.until((state) => state.events.length > 0);
    assert.equal(received.state.events[0].event, 'status');
    assert.equal(received.state.events[0].data.phase, 'thinking');
    assert.ok(received.state.events[0].data.message);
    assertNoPrematureActions(received.state);
    await received.until((state) => state.comments.length > 0);
    pending.resolve(upstream.response);

    upstream.event({ delta: '先运行仿真，' });
    await received.until((state) => state.events.some((event) => event.event === 'answer'));
    assert.equal(
      received.state.events.find((event) => event.event === 'answer').data.answer,
      '先运行仿真，',
    );
    upstream.event({ delta: '再读取实际结果。\n' });
    await received.until((state) =>
      state.events.some((event) => event.data.answer === '先运行仿真，再读取实际结果。'),
    );
    assertNoPrematureActions(received.state);
    // A generic fence can itself be split across deltas. Neither its prefix nor
    // the complete operation may reach a user-visible answer before validation.
    for (const delta of ['`', '``j', 'son\n{"act', 'ions":[{"type":"run_', 'simulation"}]}\n```']) {
      upstream.event({ delta });
    }
    upstream.event({ done: true });
    // Deliberately leave the upstream connection open: done is the terminal event.
    await received.completion;
    const results = resultEvents(received.state);
    assert.equal(results.length, 1);
    assert.deepEqual(results[0].data, {
      answer: '先运行仿真，再读取实际结果。',
      actions: [{ type: 'run_simulation' }],
      done: false,
    });
    const phases = received.state.events
      .filter((event) => event.event === 'status')
      .map((event) => event.data.phase);
    assert.ok(phases.includes('generating'));
    assert.ok(phases.includes('validating'));
    assertNoPrematureActions({
      ...received.state,
      events: received.state.events.filter((event) => event.event !== 'result'),
    });
  },
);

test(
  'upstream SSE decoding preserves split UTF-8, CRLF, bare CR and multiline data fields',
  { timeout: 5000 },
  async (t) => {
    for (const newline of ['\r\n', '\r']) {
      const upstream = upstreamStream();
      const send = await openRoute(t, { postAgentChat: async () => upstream.response });
      const received = receiveEvents(await send());
      const source = [
        ': upstream heartbeat',
        '',
        'data: {',
        'data: "delta": "测量电流为 2 毫安。"',
        'data: }',
        '',
        'data: {"done":true}',
        '',
        '',
      ].join(newline);
      // Byte-sized chunks split every Chinese character and every CRLF pair.
      // Keep the stream open: terminal bare CR must dispatch done without EOF.
      for (const byte of Buffer.from(source)) upstream.bytes(Uint8Array.of(byte));
      await received.completion;
      assert.deepEqual(
        resultEvents(received.state).map((event) => event.data),
        [{ answer: '测量电流为 2 毫安。', actions: [], done: true }],
      );
      assert.doesNotMatch(received.state.raw, /�/);
      assert.equal(
        received.state.events.some((event) => event.event === 'error'),
        false,
      );
      assert.equal(upstream.cancelled, true, 'done releases the upstream without waiting for EOF');
    }
  },
);

test(
  'partial fences and standalone action JSON never leak through incremental answer events',
  { timeout: 10000 },
  async (t) => {
    const action = '{"actions":[{"type":"run_simulation"}]}';
    const endings = [
      `\n\n\`\`\`circuit-actions\n${action}\n\`\`\``,
      `\n\n~~~json\n${action}\n~~~`,
      `\n\n${action}`,
      `\n\n\`\`\`json ${action}\`\`\``,
    ];
    for (const ending of endings) {
      const upstream = upstreamStream();
      const send = await openRoute(t, { postAgentChat: async () => upstream.response });
      const received = receiveEvents(await send());
      upstream.event({ delta: '接下来运行仿真。' });
      await received.until((state) => state.events.some((event) => event.event === 'answer'));
      for (const character of ending) upstream.event({ delta: character });
      upstream.event({ done: true });
      await received.completion;
      assert.deepEqual(resultEvents(received.state)[0].data.actions, [{ type: 'run_simulation' }]);
      const interim = received.state.events.filter((event) => event.event === 'answer');
      interim.forEach((event) => {
        assert.doesNotMatch(event.data.answer, /[`~{}]|actions|run_simulation/);
      });
    }
  },
);

test(
  'EOF, malformed SSE data and mid-stream upstream errors never turn buffered actions into a result',
  { timeout: 10000 },
  async (t) => {
    for (const failure of ['eof', 'invalid-json', 'error']) {
      const upstream = upstreamStream();
      const send = await openRoute(t, { postAgentChat: async () => upstream.response });
      const received = receiveEvents(await send());
      upstream.event({
        delta: '马上运行。\n```json\n{"actions":[{"type":"run_simulation"}]}\n```',
      });
      if (failure === 'invalid-json') upstream.bytes('data: {not json}\n\n');
      if (failure === 'error')
        upstream.event({ error: { code: 'model_failed', message: '模型服务中断' } });
      upstream.close();
      await received.completion;
      assertNoPrematureActions(received.state);
      const errors = received.state.events.filter((event) => event.event === 'error');
      assert.equal(errors.length, 1, failure);
      assert.equal(errors[0].data.ok, false, failure);
      assert.equal(errors[0].data.status, 502, failure);
      assert.ok(errors[0].data.message, failure);
    }
  },
);

test(
  'a completed but invalid action batch remains a repairable nonterminal result',
  { timeout: 5000 },
  async (t) => {
    const upstream = upstreamStream();
    const send = await openRoute(t, { postAgentChat: async () => upstream.response });
    const received = receiveEvents(await send());
    upstream.event({ delta: '准备运行。\n```json\n{"actions":[{"type":"run_script"}]}\n```' });
    upstream.event({ done: true });
    await received.completion;
    const results = resultEvents(received.state);
    assert.equal(results.length, 1);
    assert.equal(results[0].data.done, false);
    assert.deepEqual(results[0].data.actions, []);
    assert.match(results[0].data.actionWarning, /未执行/);
  },
);

test(
  'SSE clients support JSON upstream responses and receive structured upstream HTTP errors',
  { timeout: 5000 },
  async (t) => {
    for (const status of [200, 503]) {
      const send = await openRoute(t, {
        postAgentChat: async (payload) => {
          assert.equal(payload.stream, true);
          return new Response(JSON.stringify({ answer: '需要先将电路接地。' }), {
            status,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      });
      const received = receiveEvents(await send());
      await received.completion;
      assert.equal(received.state.events[0].data.phase, 'thinking');
      if (status === 200) {
        assert.deepEqual(
          resultEvents(received.state).map((event) => event.data),
          [{ answer: '需要先将电路接地。', actions: [], done: true }],
        );
      } else {
        assert.equal(resultEvents(received.state).length, 0);
        const error = received.state.events.find((event) => event.event === 'error');
        assert.equal(error.data.status, 502);
        assert.equal(error.data.ok, false);
      }
    }
  },
);

test(
  'legacy JSON clients retain whitespace heartbeats and the validated final response with an SSE upstream',
  { timeout: 5000 },
  async (t) => {
    const pending = deferred();
    const upstream = upstreamStream();
    const send = await openRoute(t, { postAgentChat: async () => pending.promise });
    const response = await send({ headers: { 'Content-Type': 'application/json' } });
    assert.match(response.headers.get('content-type'), /^application\/json/);
    const reader = response.body.getReader();
    const first = await reader.read();
    let text = Buffer.from(first.value).toString('utf8');
    assert.match(text, /^\s+$/);
    pending.resolve(upstream.response);
    upstream.event({
      delta: '先运行仿真。\n```json\n{"actions":[{"type":"run_simulation"}]}\n```',
    });
    upstream.event({ done: true });
    let chunk = await reader.read();
    while (!chunk.done) {
      text += Buffer.from(chunk.value).toString('utf8');
      chunk = await reader.read();
    }
    assert.deepEqual(JSON.parse(text), {
      answer: '先运行仿真。',
      actions: [{ type: 'run_simulation' }],
      done: false,
    });
  },
);

test(
  'client disconnect while reading deltas aborts the upstream request',
  { timeout: 5000 },
  async (t) => {
    const upstream = upstreamStream();
    const aborted = deferred();
    let signal;
    const send = await openRoute(t, {
      postAgentChat: async (_payload, _user, options) => {
        signal = options.signal;
        signal.addEventListener('abort', aborted.resolve, { once: true });
        return upstream.response;
      },
    });
    const controller = new AbortController();
    const received = receiveEvents(await send({ signal: controller.signal }));
    upstream.event({ delta: '正在检查电路。' });
    await received.until((state) => state.events.some((event) => event.event === 'answer'));
    controller.abort();
    await aborted.promise;
    await received.completion;
    assert.equal(signal.aborted, true);
    assert.equal(upstream.cancelled, true, 'disconnect releases a pending upstream body reader');
    assert.equal(received.state.error.name, 'AbortError');
    assert.equal(resultEvents(received.state).length, 0);
  },
);

test(
  'idle timeout ignores comments, empty deltas and unknown frames while total timeout bounds active generation',
  { timeout: 10000 },
  async (t) => {
    for (const active of [false, true]) {
      const upstream = upstreamStream();
      let signal;
      let aborts = 0;
      const started = Date.now();
      const send = await openRoute(t, {
        requestTimeoutMs: active ? 240 : 1000,
        idleTimeoutMs: 100,
        postAgentChat: async (_payload, _user, options) => {
          signal = options.signal;
          signal.addEventListener(
            'abort',
            () => {
              aborts += 1;
            },
            { once: true },
          );
          return upstream.response;
        },
      });
      const received = receiveEvents(await send());
      const interval = setInterval(() => {
        if (signal.aborted) return;
        if (active) upstream.event({ delta: '继续分析。' });
        else {
          upstream.bytes(': keep-alive\n\n');
          upstream.event({ delta: '' });
          upstream.event({ progress: 'still waiting' });
        }
      }, 20);
      t.after(() => clearInterval(interval));
      await received.completion;
      clearInterval(interval);
      const elapsed = Date.now() - started;
      assert.equal(signal.aborted, true);
      assert.equal(aborts, 1);
      assert.equal(upstream.cancelled, true, 'timeout releases a pending upstream body reader');
      assert.equal(resultEvents(received.state).length, 0);
      const errors = received.state.events.filter((event) => event.event === 'error');
      assert.equal(errors.length, 1);
      assert.equal(errors[0].data.status, 504);
      if (active) {
        assert.equal(errors[0].data.code, 'circuit_assistant_timeout');
        assert.ok(elapsed >= 200, `effective deltas should reset the idle deadline: ${elapsed} ms`);
      } else {
        assert.ok(
          elapsed < 850,
          `heartbeats must not defer idle timeout to the total limit: ${elapsed} ms`,
        );
      }
    }
  },
);

test(
  'successful completion clears idle and total deadlines without later aborting the upstream signal',
  { timeout: 5000 },
  async (t) => {
    const upstream = upstreamStream();
    let signal;
    const send = await openRoute(t, {
      requestTimeoutMs: 180,
      idleTimeoutMs: 80,
      postAgentChat: async (_payload, _user, options) => {
        signal = options.signal;
        return upstream.response;
      },
    });
    const received = receiveEvents(await send());
    upstream.event({ delta: '已完成分析。' });
    upstream.event({ done: true });
    await received.completion;
    assert.equal(resultEvents(received.state).length, 1);
    await new Promise((resolve) => {
      setTimeout(resolve, 220);
    });
    assert.equal(signal.aborted, false);
  },
);
