const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

for (const file of ['auth.js', 'app.js']) {
  const source = fs.readFileSync(path.join(__dirname, '../public', file), 'utf8');
  const declaration = source.slice(0, source.indexOf('})();') + 5);
  const resolve = (location, override) =>
    vm.runInNewContext(`${declaration}\nAPI_BASE_URL`, {
      window: { location, FREEBBS_API_BASE: override },
    });
  test(`${file}: browser API requests stay on the page origin, including forwarded local ports`, () => {
    for (const origin of [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:3100',
      'https://free-bbs.cn',
    ]) {
      const url = new URL(origin);
      assert.equal(
        resolve({ origin, protocol: url.protocol, hostname: url.hostname, port: url.port }),
        `${origin}/api`,
      );
    }
    assert.equal(resolve({ protocol: 'file:' }), 'http://127.0.0.1:3001/api');
    assert.equal(
      resolve({ protocol: 'http:', origin: 'http://localhost:3000' }, '/test-api'),
      '/test-api',
    );
  });
}
