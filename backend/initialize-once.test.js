const test = require('node:test');
const assert = require('node:assert/strict');
const initializeOnce = require('./initialize-once');
test('concurrent and subsequent requests share successful schema initialization', async () => {
  let calls = 0;
  let resolve;
  const ready = initializeOnce(() => {
    calls += 1;
    return new Promise((done) => {
      resolve = done;
    });
  });
  const first = ready();
  const second = ready();
  await Promise.resolve();
  assert.equal(calls, 1);
  resolve();
  await Promise.all([first, second]);
  await ready();
  assert.equal(calls, 1);
});
test('failed initialization is retried, never permanently treated as ready', async () => {
  let calls = 0;
  const ready = initializeOnce(() => {
    if (++calls === 1) throw new Error('offline');
  });
  await assert.rejects(ready(), /offline/);
  await ready();
  await ready();
  assert.equal(calls, 2);
});
