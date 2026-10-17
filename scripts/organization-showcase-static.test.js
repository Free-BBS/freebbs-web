const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');
const {
  SHOWCASE_PREFIX,
  createOrganizationShowcaseHandler,
} = require('../organization-showcase-static');

let fixture;
let publicRoot;
let server;
let port;
const html =
  '<!doctype html><html><head><title>部门原稿</title></head><body>原始内容</body></html>';
const media = Buffer.from(Array.from({ length: 64 }, (_, index) => index));

function request(filename, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = http.request(
      { hostname: '127.0.0.1', port, path: filename, method, headers },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    outgoing.on('error', reject);
    outgoing.end();
  });
}

before(async () => {
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-showcase-static-'));
  publicRoot = path.join(fixture, 'public');
  fs.mkdirSync(path.join(publicRoot, '层 次'), { recursive: true });
  fs.mkdirSync(path.join(publicRoot, 'department'));
  fs.mkdirSync(path.join(fixture, 'private'));
  fs.writeFileSync(path.join(publicRoot, 'index.html'), html);
  fs.writeFileSync(path.join(publicRoot, 'department', 'index.html'), html);
  fs.writeFileSync(path.join(publicRoot, '层 次', '作品 演示.html'), html);
  for (const extension of ['mp4', 'mp3', 'wav', 'webp', 'woff2', 'otf']) {
    fs.writeFileSync(path.join(publicRoot, `sample.${extension}`), media);
  }
  fs.writeFileSync(path.join(publicRoot, 'empty.mp4'), '');
  fs.writeFileSync(path.join(fixture, 'private', 'secret.txt'), 'outside the showcase root');
  const handler = createOrganizationShowcaseHandler(publicRoot);
  server = http.createServer((incoming, response) => {
    if (handler(incoming, response)) return;
    response.writeHead(418);
    response.end('not handled');
  });
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  port = server.address().port;
});

after(async () => {
  if (server) {
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }
  if (fixture) {
    const expectedParent = path.resolve(os.tmpdir());
    assert.equal(path.dirname(path.resolve(fixture)), expectedParent);
    assert.ok(path.basename(fixture).startsWith('freebbs-showcase-static-'));
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('submitted HTML is returned byte for byte without the main-site shell', async () => {
  const result = await request(`${SHOWCASE_PREFIX}index.html`);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, Buffer.from(html));
  assert.equal(Number(result.headers['content-length']), Buffer.byteLength(html));
  assert.match(result.headers['content-type'], /^text\/html/);
  assert.equal(result.headers['x-frame-options'], 'SAMEORIGIN');
  assert.equal(result.headers['x-content-type-options'], 'nosniff');
  assert.equal(result.headers['cache-control'], 'no-cache');
  assert.doesNotMatch(result.body.toString(), /site-search|desktop-shell|mobile-shell/);
});

test('UTF-8 percent-encoded folders and filenames resolve once within the public directory', async () => {
  const filename = ['层 次', '作品 演示.html'].map(encodeURIComponent).join('/');
  const result = await request(`${SHOWCASE_PREFIX}${filename}?from=directory`);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, Buffer.from(html));
});

test('media and font MIME types support opaque sandbox origins without credentials', async () => {
  for (const [extension, mime] of Object.entries({
    mp4: 'video/mp4',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    webp: 'image/webp',
    woff2: 'font/woff2',
    otf: 'font/otf',
  })) {
    const result = await request(`${SHOWCASE_PREFIX}sample.${extension}`, {
      headers: { Origin: 'null' },
    });
    assert.equal(result.status, 200);
    assert.equal(result.headers['content-type'], mime);
    assert.equal(result.headers['access-control-allow-origin'], '*');
    assert.equal(result.headers['access-control-allow-credentials'], undefined);
    assert.equal(result.headers['accept-ranges'], 'bytes');
    assert.deepEqual(result.body, media);
  }
});

test('byte ranges serve inclusive, open-ended, suffix and clamped media slices', async () => {
  for (const [range, start, end] of [
    ['bytes=2-7', 2, 7],
    ['bytes=60-', 60, 63],
    ['bytes=-3', 61, 63],
    ['bytes=-999', 0, 63],
    ['bytes=60-999999999999999999999999', 60, 63],
  ]) {
    const result = await request(`${SHOWCASE_PREFIX}sample.mp4`, { headers: { Range: range } });
    assert.equal(result.status, 206);
    assert.equal(result.headers['content-range'], `bytes ${start}-${end}/${media.length}`);
    assert.equal(Number(result.headers['content-length']), end - start + 1);
    assert.deepEqual(result.body, media.subarray(start, end + 1));
  }
});

test('unsatisfiable or malformed byte ranges return 416 with the complete media size', async () => {
  for (const range of ['bytes=64-', 'bytes=8-2', 'bytes=-0', 'bytes=-', 'bytes=0-1,4-5']) {
    const result = await request(`${SHOWCASE_PREFIX}sample.mp4`, { headers: { Range: range } });
    assert.equal(result.status, 416);
    assert.equal(result.headers['content-range'], 'bytes */64');
    assert.equal(Number(result.headers['content-length']), result.body.length);
  }
  const empty = await request(`${SHOWCASE_PREFIX}empty.mp4`, { headers: { Range: 'bytes=0-' } });
  assert.equal(empty.status, 416);
  assert.equal(empty.headers['content-range'], 'bytes */0');
});

test('HEAD returns full representation headers without a body and ignores a GET-only Range', async () => {
  const result = await request(`${SHOWCASE_PREFIX}sample.mp4`, {
    method: 'HEAD',
    headers: { Range: 'bytes=2-7' },
  });
  assert.equal(result.status, 200);
  assert.equal(Number(result.headers['content-length']), media.length);
  assert.equal(result.headers['content-range'], undefined);
  assert.equal(result.body.length, 0);
  const empty = await request(`${SHOWCASE_PREFIX}empty.mp4`);
  assert.equal(empty.status, 200);
  assert.equal(empty.headers['content-length'], '0');
  assert.equal(empty.body.length, 0);
});

test('ETag and Last-Modified requests revalidate and If-None-Match takes precedence', async () => {
  const original = await request(`${SHOWCASE_PREFIX}index.html`);
  const { etag } = original.headers;
  const modified = original.headers['last-modified'];
  assert.match(etag, /^W\/".+"$/);
  for (const headers of [
    { 'If-None-Match': etag },
    { 'If-None-Match': `"old", ${etag.replace(/^W\//, '')}` },
    { 'If-None-Match': '*' },
    { 'If-Modified-Since': modified },
  ]) {
    const result = await request(`${SHOWCASE_PREFIX}index.html`, { headers });
    assert.equal(result.status, 304);
    assert.equal(result.body.length, 0);
  }
  const changed = await request(`${SHOWCASE_PREFIX}index.html`, {
    headers: { 'If-None-Match': '"different"', 'If-Modified-Since': modified },
  });
  assert.equal(changed.status, 200);
});

test('If-Range uses a matching date and falls back to complete bytes for stale or weak validators', async () => {
  const original = await request(`${SHOWCASE_PREFIX}sample.mp4`);
  const current = await request(`${SHOWCASE_PREFIX}sample.mp4`, {
    headers: { Range: 'bytes=2-7', 'If-Range': original.headers['last-modified'] },
  });
  assert.equal(current.status, 206);
  for (const validator of ['Thu, 01 Jan 1970 00:00:00 GMT', original.headers.etag]) {
    const result = await request(`${SHOWCASE_PREFIX}sample.mp4`, {
      headers: { Range: 'bytes=2-7', 'If-Range': validator },
    });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, media);
  }
});

test('malformed encoding, traversal and Windows separator or stream paths cannot escape the root', async () => {
  for (const suffix of [
    '../private/secret.txt',
    '%2e%2e/private/secret.txt',
    '%2e%2e%2fprivate%2fsecret.txt',
    '%5c..%5cprivate%5csecret.txt',
    '%2fprivate/secret.txt',
    'sample.mp4:private',
    'sample%00.mp4',
  ]) {
    const result = await request(`${SHOWCASE_PREFIX}${suffix}`);
    assert.equal(result.status, 403, suffix);
    assert.doesNotMatch(result.body.toString(), /outside the showcase root/);
  }
  for (const suffix of ['%ZZ', '%E4%B8']) {
    assert.equal((await request(`${SHOWCASE_PREFIX}${suffix}`)).status, 400);
  }
});

test('symlinks or junctions cannot expose files outside the fixed public root', async (t) => {
  const junction = path.join(publicRoot, 'external');
  try {
    fs.symlinkSync(
      path.join(fixture, 'private'),
      junction,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) {
      t.skip('The environment does not permit creating the symlink fixture');
      return;
    }
    throw error;
  }
  assert.equal((await request(`${SHOWCASE_PREFIX}external/secret.txt`)).status, 403);
});

test('missing assets remain 404, other routes stay unclaimed and methods are read only', async () => {
  const missing = await request(`${SHOWCASE_PREFIX}missing.html`);
  assert.equal(missing.status, 404);
  assert.equal(missing.body.toString(), '404 Not Found');
  const headMissing = await request(`${SHOWCASE_PREFIX}missing.mp4`, { method: 'HEAD' });
  assert.equal(headMissing.status, 404);
  assert.equal(headMissing.body.length, 0);
  assert.equal((await request('/development/other/index.html')).status, 418);
  assert.equal((await request('/api/development/v1/health')).status, 418);
  const post = await request(`${SHOWCASE_PREFIX}index.html`, { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, 'GET, HEAD');
  const redirect = await request(`${SHOWCASE_PREFIX}department?view=photos`);
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.location, `${SHOWCASE_PREFIX}department/?view=photos`);
  assert.deepEqual((await request(`${SHOWCASE_PREFIX}department/`)).body, Buffer.from(html));
});

test('both nginx deployment forms preserve static responses, local fonts and same-origin embedding', () => {
  for (const filename of ['freebbs-development.conf', 'freebbs-development.locations.conf']) {
    const config = fs.readFileSync(
      path.join(__dirname, '..', 'development', 'deploy', 'nginx', filename),
      'utf8',
    );
    const start = config.indexOf('location ^~ /development/organization-showcase/');
    assert.ok(start >= 0);
    const location = config.slice(start, config.indexOf('location /development/', start));
    assert.match(location, /try_files \$uri \$uri\/ =404/);
    assert.match(location, /X-Frame-Options SAMEORIGIN always/);
    assert.match(location, /Access-Control-Allow-Origin "\*" always/);
    for (const header of ['X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy']) {
      assert.ok(location.includes(header));
    }
    assert.match(location, /video\/mp4 mp4/);
    assert.match(location, /font\/woff2 woff2/);
    assert.doesNotMatch(location, /Access-Control-Allow-Credentials|development\/index\.html/);
    assert.match(config, /location \/api\/development\/v1\/ \{/);
  }
});
