const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const { createModerationFetch } = require('./moderation-endpoint');

function fixture({ addresses = [{ address: '8.8.8.8', family: 4 }], status = 200 } = {}) {
  let resolved;
  let options;
  let requests = 0;
  const fetch = createModerationFetch({
    lookup: async () => addresses,
    request(url, init, callback) {
      requests += 1;
      options = init;
      const outgoing = new EventEmitter();
      outgoing.end = () => {
        init.lookup(url.hostname, { all: true }, (error, pinned) => {
          if (error) {
            outgoing.emit('error', error);
            return;
          }
          resolved = pinned;
          const incoming = new PassThrough();
          incoming.statusCode = status;
          incoming.headers = { 'content-type': 'application/json' };
          callback(incoming);
          incoming.end('{"ok":true}');
        });
      };
      return outgoing;
    },
  });
  return { fetch, read: () => ({ resolved, options, requests }) };
}
const init = { method: 'POST', redirect: 'error', body: '{}', headers: {} };

test('pins validated DNS records to the TLS connection and streams the response', async () => {
  const { fetch, read } = fixture();
  const signal = new AbortController().signal;
  const response = await fetch('https://provider.example/v1/chat/completions', { ...init, signal });
  assert.equal(response.status, 200);
  assert.equal(response.url, 'https://provider.example/v1/chat/completions');
  assert.equal(response.headers.get('content-type'), 'application/json');
  assert.equal(await new Response(response.body).text(), '{"ok":true}');
  assert.deepEqual(read().resolved, [{ address: '8.8.8.8', family: 4 }]);
  assert.equal(read().options.agent, false);
  assert.equal(read().options.signal, signal);
});

for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '::1', '::ffff:127.0.0.1']) {
  test(`rejects DNS responses containing ${address} before connection`, async () => {
    const { fetch, read } = fixture({
      addresses: [
        { address: '8.8.8.8', family: 4 },
        { address, family: address.includes(':') ? 6 : 4 },
      ],
    });
    await assert.rejects(fetch('https://provider.example/v1/chat/completions', init), /公网/);
    assert.equal(read().resolved, undefined);
  });
}

test('rejects redirects without following them', async () => {
  const { fetch, read } = fixture({ status: 307 });
  await assert.rejects(fetch('https://provider.example/v1/chat/completions', init), /重定向/);
  assert.equal(read().requests, 1);
});

test('rejects local and non-HTTPS endpoints before issuing any request', async () => {
  const { fetch, read } = fixture();
  for (const url of ['http://provider.example/v1', 'https://127.0.0.1/v1', 'https://[::1]/v1'])
    await assert.rejects(fetch(url, init));
  assert.equal(read().requests, 0);
});
