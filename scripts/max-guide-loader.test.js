const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
function fixture() {
  const scripts = [];
  const timers = new Map();
  let counter = 0;
  const context = {
    document: {
      createElement: () => ({
        remove() {
          this.removed = true;
        },
      }),
      head: { append: (script) => scripts.push(script) },
    },
    setTimeout: (fn) => {
      counter += 1;
      timers.set(counter, fn);
      return counter;
    },
    clearTimeout: (id) => timers.delete(id),
  };
  vm.createContext(context);
  vm.runInContext(
    source.slice(
      source.indexOf('async function loadMaxGuide()'),
      source.indexOf('loadMaxGuide().catch('),
    ),
    context,
  );
  return { context, scripts, timers };
}
test('independent guide dependencies download in parallel before loading the controller', async () => {
  const { context, scripts, timers } = fixture();
  const complete = context.loadMaxGuide();
  assert.deepEqual(
    scripts.map((item) => item.src),
    ['/max-guide-releases.js', '/max-guide-stations.js', '/max-guide-geometry.js'],
  );
  scripts[2].onload();
  scripts[0].onload();
  await Promise.resolve();
  assert.equal(scripts.length, 3);
  scripts[1].onload();
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  assert.equal(scripts[3].src, '/max-guide.js');
  scripts[3].onload();
  await complete;
  assert.equal(timers.size, 0);
});
test('a failed guide dependency never starts a partially initialized controller', async () => {
  const { context, scripts } = fixture();
  const complete = context.loadMaxGuide();
  scripts[0].onerror();
  scripts[1].onload();
  scripts[2].onload();
  await assert.rejects(complete, /unavailable/);
  assert.equal(scripts.length, 3);
  assert.equal(scripts[0].removed, true);
});
test('a stalled guide dependency times out, allowing the ordinary page to remain usable', async () => {
  const { context, scripts, timers } = fixture();
  const complete = context.loadMaxGuide();
  const timeout = [...timers.values()][0];
  scripts[1].onload();
  scripts[2].onload();
  timeout();
  await assert.rejects(complete, /timed out/);
  assert.equal(scripts.length, 3);
  assert.equal(scripts[0].removed, true);
});
