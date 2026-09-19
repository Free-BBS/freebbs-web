const test = require('node:test');
const assert = require('node:assert/strict');
const { gunzipSync } = require('node:zlib');
const { sendStatic } = require('../static-response');
function request(body, { method = 'GET', headers = {} } = {}) {
  const response = {
    req: { method, headers },
    writeHead(status, values) {
      this.status = status;
      this.headers = values;
    },
    end(data) {
      this.body = data;
    },
  };
  sendStatic(response, body, {
    'Content-Type': 'application/javascript',
    'Cache-Control': 'no-cache',
  });
  return response;
}
test('assets compress losslessly and cached bytes revalidate without downloading again', () => {
  const body = 'const example = 1;\n'.repeat(1000);
  const result = request(body, { headers: { 'accept-encoding': 'gzip, br' } });
  assert.equal(result.headers['Content-Encoding'], 'gzip');
  assert.equal(gunzipSync(result.body).toString(), body);
  assert.ok(result.body.length < body.length / 5);
  const unchanged = request(body, { headers: { 'if-none-match': result.headers.ETag } });
  assert.equal(unchanged.status, 304);
  assert.equal(unchanged.body, undefined);
  const changed = request(body + 'changed', { headers: { 'if-none-match': result.headers.ETag } });
  assert.equal(changed.status, 200);
  assert.notEqual(changed.headers.ETag, result.headers.ETag);
});
test('HEAD has no body and gzip exclusion is honored', () => {
  const body = 'x'.repeat(2000);
  assert.equal(request(body, { method: 'HEAD' }).body, undefined);
  for (const value of ['', 'gzip;q=0', 'gzip;q=0.0,br']) {
    const result = request(body, { headers: { 'accept-encoding': value } });
    assert.equal(result.headers['Content-Encoding'], undefined);
    assert.equal(result.body.toString(), body);
  }
});
