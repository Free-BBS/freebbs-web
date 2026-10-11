const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const {
  blockedPorts,
  isBlockedPort,
  listenAllowedLoopback,
} = require('./fixtures/allowed-loopback');

class FakeServer extends EventEmitter {
  constructor(ports, { bindError, closeError } = {}) {
    super();
    this.ports = [...ports];
    this.bindError = bindError;
    this.closeError = closeError;
    this.listening = false;
    this.operations = [];
  }

  listen(port, host, callback) {
    assert.equal(this.listening, false, 'Excluded listener closes before another bind');
    assert.equal(port, 0);
    assert.equal(host, '127.0.0.1');
    this.operations.push('listen');
    if (this.bindError) queueMicrotask(() => this.emit('error', this.bindError));
    else {
      this.currentPort = this.ports.shift();
      this.listening = true;
      queueMicrotask(callback);
    }
    return this;
  }

  address() {
    return this.listening ? { address: '127.0.0.1', port: this.currentPort } : null;
  }

  close(callback) {
    this.operations.push('close');
    if (!this.closeError) this.listening = false;
    queueMicrotask(() => callback(this.closeError));
  }
}

test('safe loopback closes blocked selections before rebinding and reports selected/skipped evidence', async () => {
  const server = new FakeServer([6000, 10080, 51234]);
  const diagnostics = [];
  const result = await listenAllowedLoopback(server, {
    diagnostic: (value) => diagnostics.push(value),
  });
  assert.deepEqual(result, {
    port: 51234,
    attemptedPorts: [6000, 10080, 51234],
    skippedPorts: [6000, 10080],
  });
  assert.deepEqual(server.operations, ['listen', 'close', 'listen', 'close', 'listen']);
  assert.equal(server.listening, true);
  assert.deepEqual(diagnostics, [
    'allowed-loopback selected=51234 attempted=[6000,10080,51234] skipped=[6000,10080]',
  ]);
  assert.equal(server.listenerCount('error'), 0);
});

test('safe first selection binds once and has no skips or hidden retries', async () => {
  const server = new FakeServer([40001]);
  assert.deepEqual(await listenAllowedLoopback(server), {
    port: 40001,
    attemptedPorts: [40001],
    skippedPorts: [],
  });
  assert.deepEqual(server.operations, ['listen']);
});

test('blocked-only exhaustion is bounded, closes every listener and preserves all ports in the error', async () => {
  const server = new FakeServer([6000, 6667, 10080]);
  await assert.rejects(listenAllowedLoopback(server, { maxAttempts: 2 }), (error) => {
    assert.match(
      error.message,
      /after 2 selections.*selected=none attempted=\[6000,6667\] skipped=\[6000,6667\]/,
    );
    assert.deepEqual(error.portSelection, {
      port: null,
      attemptedPorts: [6000, 6667],
      skippedPorts: [6000, 6667],
    });
    return true;
  });
  assert.equal(server.listening, false);
  assert.deepEqual(server.operations, ['listen', 'close', 'listen', 'close']);
  assert.equal(server.listenerCount('error'), 0);
});

test('bind errors are not silently retried and retain the original code plus selection metadata', async () => {
  const failure = Object.assign(new Error('fixture denied'), { code: 'EACCES' });
  const server = new FakeServer([40001], { bindError: failure });
  await assert.rejects(listenAllowedLoopback(server), (error) => {
    assert.equal(error, failure);
    assert.equal(error.code, 'EACCES');
    assert.match(error.message, /selected=none attempted=\[\] skipped=\[\]/);
    return true;
  });
  assert.deepEqual(server.operations, ['listen']);
  assert.equal(server.listenerCount('error'), 0);
});

test('a failed excluded-listener close prevents any subsequent bind', async () => {
  const failure = Object.assign(new Error('cannot close fixture'), { code: 'QA_CLOSE' });
  const server = new FakeServer([6000, 40001], { closeError: failure });
  await assert.rejects(listenAllowedLoopback(server), (error) => {
    assert.equal(error.code, 'QA_CLOSE');
    assert.match(error.message, /attempted=\[6000\] skipped=\[6000\]/);
    return true;
  });
  assert.deepEqual(server.operations, ['listen', 'close']);
});

test('invalid options and pre-existing listeners are rejected without closing or rebinding them', async () => {
  for (const maxAttempts of [0, -1, 33, 1.5, Infinity]) {
    const server = new FakeServer([40001]);
    await assert.rejects(listenAllowedLoopback(server, { maxAttempts }), TypeError);
    assert.deepEqual(server.operations, []);
  }
  const existing = new FakeServer([40001]);
  existing.listening = true;
  await assert.rejects(listenAllowedLoopback(existing), /already listening/);
  assert.deepEqual(existing.operations, []);
  await assert.rejects(listenAllowedLoopback(null), TypeError);
});

test('invalid numeric address is closed and cannot become a business request URL', async () => {
  const server = new FakeServer([0]);
  await assert.rejects(listenAllowedLoopback(server), /invalid numeric port.*selected=none/);
  assert.equal(server.listening, false);
  assert.deepEqual(server.operations, ['listen', 'close']);
});

test('current Node built-in Fetch rejects a known blocked port before network traffic', async () => {
  assert.ok(blockedPorts.includes(6000) && blockedPorts.includes(10080));
  assert.equal(isBlockedPort(6000), true);
  assert.equal(isBlockedPort(51234), false);
  await assert.rejects(
    fetch('http://127.0.0.1:6000/qa-no-listener'),
    (error) => error.cause?.message === 'bad port',
  );
});

test('real local HTTP fixture selects an allowed port before its one business request', async (t) => {
  let requests = 0;
  const server = http.createServer((req, res) => {
    requests += 1;
    res.end('isolated test only');
  });
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const selected = await listenAllowedLoopback(server, {
    diagnostic: (message) => t.diagnostic(message),
  });
  assert.equal(isBlockedPort(selected.port), false);
  assert.equal(requests, 0);
  const response = await fetch(`http://127.0.0.1:${selected.port}/`);
  assert.equal(await response.text(), 'isolated test only');
  assert.equal(requests, 1);
});
