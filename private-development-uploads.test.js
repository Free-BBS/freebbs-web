const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const express = require('express');
const {
  isPrivateDevelopmentUploadPath,
  guardPrivateDevelopmentUploads,
} = require('./private-development-uploads');

const photoBytes = Buffer.from('synthetic-ledger-photo-fixture\0not-a-real-photo');
const avatarBytes = Buffer.from('<svg><title>public avatar fixture</title></svg>');
const photoPath = '/uploads/development/collections/assets/ledger-photo.bin';
const stateName = createHash('sha256').update('finance-tracking').digest('hex');
const statePath = `/uploads/development/collections/finance-tracking/${stateName}.json`;
const stateBytes = Buffer.from(
  JSON.stringify({ id: 'finance-tracking', claims: [{ id: 'synthetic-private-claim' }] }),
);

// Send raw HTTP paths: fetch/URL would normalize the dot and backslash variants first.
const privatePaths = [
  photoPath,
  statePath,
  `${photoPath}?download=1`,
  '/uploads/development%2fcollections/assets/ledger-photo.bin',
  '/uploads/development%5ccollections%5cassets%5cledger-photo.bin',
  '/uploads\\development\\collections\\assets\\ledger-photo.bin',
  '//uploads//development///collections/assets/ledger-photo.bin',
  '/uploads/./development/collections/assets/ledger-photo.bin',
  '/uploads/public/../development/collections/assets/ledger-photo.bin',
  '/uploads/public/%2e%2e/development/collections/assets/ledger-photo.bin',
  '/uploads/%64evelopment/collections/assets/ledger-photo.bin',
  '/UPLOADS/DEVELOPMENT/COLLECTIONS/assets/ledger-photo.bin',
  '/uploads/development./collections/assets/ledger-photo.bin',
  '/uploads/development%20/collections/assets/ledger-photo.bin',
  '/uploads/development/collections./assets/ledger-photo.bin',
  '/uploads/development/collections%20/assets/ledger-photo.bin',
  '/uploads/DEVELO~1/COLLEC~1/assets/ledger-photo.bin',
  '/uploads%2fdevelopment%2fcollections/assets/ledger-photo.bin',
  '/uploads%5cdevelopment%5ccollections/assets/ledger-photo.bin',
];

function request(port, filename, { method = 'GET', headers = {} } = {}) {
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
        response.on('error', reject);
      },
    );
    outgoing.on('error', reject);
    outgoing.end();
  });
}

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

async function close(server) {
  server.closeAllConnections();
  await new Promise((resolve) => {
    server.close(resolve);
  });
}

function createFixture(t) {
  const temporaryRoot = path.resolve(process.env.CODEX_SECURITY_TEST_TEMP_DIR || os.tmpdir());
  const fixture = fs.mkdtempSync(path.join(temporaryRoot, 'freebbs-private-upload-'));
  const uploadRoot = path.join(fixture, 'uploads');
  for (const [filename, bytes] of [
    [photoPath, photoBytes],
    [statePath, stateBytes],
    ['/uploads/avatars/public-avatar.svg', avatarBytes],
    ['/uploads/development/sports/public.webp', avatarBytes],
    ['/uploads/development/collections-public/avatar.svg', avatarBytes],
  ]) {
    const target = path.join(fixture, filename.slice(1));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }
  t.after(() => {
    // Check the resolved target before removing only the generated fixture tree.
    assert.equal(path.dirname(path.resolve(fixture)), temporaryRoot);
    assert.ok(path.basename(fixture).startsWith('freebbs-private-upload-'));
    fs.rmSync(fixture, { recursive: true, force: true });
  });
  return uploadRoot;
}

function actualUploadsApp(uploadRoot, { protectedUploads = true } = {}) {
  const source = fs.readFileSync(path.join(__dirname, 'backend/server.js'), 'utf8');
  const guardMount = source.match(/app\.use\(guardPrivateDevelopmentUploads\);/);
  const staticMount = source.match(
    /app\.use\(\s*'\/uploads',[\s\S]*?express\.static\(config\.uploadDir\),?\s*\);/,
  );
  assert.ok(guardMount, 'the backend must install the private upload guard globally');
  assert.ok(staticMount, 'load the backend upload middleware rather than reproducing it');
  assert.ok(guardMount.index < staticMount.index, 'guard must run before public upload serving');
  const app = express();
  app.use((incoming, response, next) => {
    if (incoming.headers.authorization) {
      Object.assign(incoming, { user: { id: 1, uid: 'fixture-user' } });
    }
    next();
  });
  vm.runInNewContext(
    `${protectedUploads ? guardMount[0] : ''}\n${staticMount[0]}`,
    {
      app,
      express,
      config: { uploadDir: uploadRoot },
      path,
      guardPrivateDevelopmentUploads,
      // Existing Max image permissions are separate from these development files.
      maxImageAccess: { guardUploads: (incoming, response, next) => next() },
    },
    { filename: 'backend-upload-mount.fixture.js' },
  );
  app.use((incoming, response) => response.sendStatus(404));
  return http.createServer(app);
}

function assertBlocked(result, { method = 'GET', label = '' } = {}) {
  assert.equal(result.status, 404, label);
  assert.match(result.headers['cache-control'] || '', /(?:^|,)\s*private(?:,|$)/, label);
  assert.match(result.headers['cache-control'] || '', /(?:^|,)\s*no-store(?:,|$)/, label);
  assert.equal(result.headers['accept-ranges'], undefined, label);
  assert.equal(result.headers['content-range'], undefined, label);
  assert.equal(result.headers.etag, undefined, label);
  assert.equal(result.headers['last-modified'], undefined, label);
  if (method === 'HEAD') assert.equal(result.body.length, 0, label);
  else {
    assert.ok(result.body.length < 100, label);
    assert.doesNotMatch(result.body.toString(), /synthetic|finance-tracking|ledger-photo/, label);
  }
}

test('private upload classifier recognizes filesystem aliases without blocking public uploads', () => {
  for (const filename of privatePaths) {
    assert.equal(isPrivateDevelopmentUploadPath(filename), true, filename);
  }
  for (const filename of [
    '/uploads/avatars/public-avatar.svg',
    '/uploads/development-public/avatar.svg',
    '/uploads/development/sports/public.webp',
    '/uploads/development/collections-public/avatar.svg',
    '/uploads/public/development/avatar.svg',
    '/api/development/v1/collections/assets/fixture',
    '/development/collections',
    '/uploads/avatar.svg?next=/uploads/development/collections/state.json',
  ]) {
    assert.equal(isPrivateDevelopmentUploadPath(filename), false, filename);
  }
});

test('control: the original backend static mount exposes dummy photo and predictable state files', async (t) => {
  const server = actualUploadsApp(createFixture(t), { protectedUploads: false });
  const port = await listen(server);
  t.after(() => close(server));
  for (const [filename, bytes] of [
    [photoPath, photoBytes],
    [statePath, stateBytes],
  ]) {
    const result = await request(port, filename);
    assert.equal(result.status, 200, filename);
    assert.deepEqual(result.body, bytes, filename);
    const ranged = await request(port, filename, { headers: { Range: 'bytes=0-7' } });
    assert.equal(ranged.status, 206, filename);
    assert.deepEqual(ranged.body, bytes.subarray(0, 8), filename);
    const head = await request(port, filename, { method: 'HEAD' });
    assert.equal(head.status, 200, filename);
    assert.equal(Number(head.headers['content-length']), bytes.length, filename);
    assert.equal(head.body.length, 0, filename);
  }
});

test('actual backend mount blocks anonymous and authenticated private GET, HEAD and Range requests', async (t) => {
  const server = actualUploadsApp(createFixture(t));
  const port = await listen(server);
  t.after(() => close(server));
  for (const headers of [{}, { Authorization: 'Bearer synthetic-authenticated-user' }]) {
    for (const filename of privatePaths) {
      for (const options of [
        { method: 'GET', headers },
        { method: 'HEAD', headers },
        { method: 'GET', headers: { ...headers, Range: 'bytes=0-7' } },
      ]) {
        assertBlocked(await request(port, filename, options), {
          method: options.method,
          label: `${options.method} ${filename} ${headers.Authorization || 'anonymous'}`,
        });
      }
    }
    for (const filename of [
      '/uploads/avatars/public-avatar.svg',
      '/uploads/development/sports/public.webp',
      '/uploads/development/collections-public/avatar.svg',
    ]) {
      const avatar = await request(port, filename, { headers });
      assert.equal(avatar.status, 200, filename);
      assert.deepEqual(avatar.body, avatarBytes, filename);
    }
    const avatarRange = await request(port, '/uploads/avatars/public-avatar.svg', {
      headers: { ...headers, Range: 'bytes=0-7' },
    });
    assert.equal(avatarRange.status, 206);
    assert.deepEqual(avatarRange.body, avatarBytes.subarray(0, 8));
  }
});

test(
  'real frontend server rejects private uploads before forwarding to the upstream',
  { timeout: 15000 },
  async (t) => {
    const forwarded = [];
    const backend = http.createServer((incoming, response) => {
      forwarded.push(incoming.url);
      response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      response.end(incoming.url.startsWith('/uploads/') ? avatarBytes : 'fixture-api-ok');
    });
    const backendPort = await listen(backend);
    t.after(() => close(backend));
    const reservation = http.createServer();
    const port = await listen(reservation);
    await close(reservation);
    const frontend = spawn(process.execPath, ['server.js'], {
      cwd: __dirname,
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: String(port),
        API_HOST: '127.0.0.1',
        API_PORT: String(backendPort),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    t.after(async () => {
      if (frontend.exitCode === null) {
        frontend.kill('SIGTERM');
        await once(frontend, 'exit');
      }
    });
    let diagnostics = '';
    frontend.stderr.on('data', (chunk) => {
      diagnostics += chunk.toString();
    });
    await Promise.race([
      once(frontend.stdout, 'data'),
      once(frontend, 'exit').then(() => {
        throw new Error(`frontend exited before listening: ${diagnostics}`);
      }),
    ]);
    for (const headers of [{}, { Authorization: 'Bearer synthetic-authenticated-user' }]) {
      for (const filename of privatePaths) {
        for (const options of [
          { method: 'GET', headers },
          { method: 'HEAD', headers },
          { method: 'GET', headers: { ...headers, Range: 'bytes=0-7' } },
        ]) {
          assertBlocked(await request(port, filename, options), {
            method: options.method,
            label: `frontend ${options.method} ${filename}`,
          });
        }
      }
    }
    assert.deepEqual(forwarded, [], 'private requests must never reach even an unsafe upstream');
    const avatar = await request(port, '/uploads/avatars/public-avatar.svg?v=1');
    assert.equal(avatar.status, 200);
    assert.deepEqual(avatar.body, avatarBytes);
    const api = await request(port, '/api/fixture');
    assert.equal(api.status, 200);
    assert.equal(api.body.toString(), 'fixture-api-ok');
    assert.deepEqual(forwarded, ['/uploads/avatars/public-avatar.svg?v=1', '/api/fixture']);
  },
);
