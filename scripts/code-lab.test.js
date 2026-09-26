const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { servePausedCodeLab } = require('../code-lab-availability');
const { createPersonalPreview } = require('./preview-personal');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('C/C++ is planned; the direct URL has no editor, worker or run action', () => {
  const lab = read('public/laboratory.html');
  const card = lab.match(/<p class="laboratory-eyebrow">C \/ C\+\+<\/p>[\s\S]*?<\/article>/)[0];
  assert.match(card, /稳定服务器/);
  assert.match(card, /暂未开放/);
  assert.doesNotMatch(card, /<a\b|开放试用|开始编程/);
  const page = read('public/code-lab.html');
  assert.match(page, /规划中 · 暂未开放/);
  assert.match(page, /href="\/laboratory"/);
  assert.doesNotMatch(page, /code-lab(?:-worker)?\.js|code-lab\.css|id="code-run"|<textarea/);
  assert.match(
    read('public/max-guide-stations.js'),
    /C\/C\+\+、Python、MATLAB 与 Verilog 独立运行环境仍在规划中/,
  );
});

test('no compiler package, executable client or WASM CSP ships in the paused release', () => {
  for (const file of ['package.json', 'package-lock.json']) {
    assert.doesNotMatch(
      read(file),
      /@live-codes\/clang-wasm|@wasm-idle\/llvm-core|@bjorn3\/browser_wasi_shim/,
    );
  }
  for (const file of [
    'public/code-lab.js',
    'public/code-lab-worker.js',
    'public/code-lab.css',
    'code-lab-assets.js',
  ]) {
    assert.equal(fs.existsSync(path.join(__dirname, '..', file)), false, file);
  }
  for (const file of ['server.js', 'scripts/preview-economy.js']) {
    assert.doesNotMatch(read(file), /wasm-unsafe-eval|WORKER_CSP|serveCodeLabAsset/);
    assert.match(read(file), /servePausedCodeLab/);
  }
});

test('retired assets are closed for all methods, versions and vendor aliases', () => {
  for (const pathname of [
    '/code-lab.js',
    '/code-lab-worker.js',
    '/code-lab.css',
    '/code-lab-assets',
    '/code-lab-assets/0.3.0/toolchain.js',
    '/code-lab-assets/future/bin/clang.wasm.gz',
    '/vendor/@live-codes/clang-wasm/assets/bin/clang.wasm.gz',
    '/vendor/%40live-codes/clang-wasm/assets/bin/clang.wasm.gz',
    '/vendor//@live-codes/clang-wasm/assets/bin/clang.wasm.gz',
    '/vendor/unused/../@live-codes/clang-wasm/assets/bin/clang.wasm.gz',
    '/vendor/@wasm-idle/llvm-core/index.js',
    '/CODE-LAB-WORKER.JS',
  ]) {
    for (const method of ['GET', 'HEAD', 'POST']) {
      const response = {
        writeHead(status, headers) {
          this.status = status;
          this.headers = headers;
        },
        end(body) {
          this.body = body;
        },
      };
      assert.equal(servePausedCodeLab({ method }, response, pathname), true);
      assert.equal(response.status, 410);
      assert.equal(response.headers['Cache-Control'], 'no-store');
      assert.equal(response.body === undefined, method === 'HEAD');
    }
  }
  for (const pathname of [
    '/code-lab',
    '/code-lab.html',
    '/api/code/run',
    '/vendor/marked/lib/marked.umd.js',
    '/%zz',
  ]) {
    assert.equal(servePausedCodeLab({}, {}, pathname), false, pathname);
  }
});

test('personal preview shows the planned page and blocks old compiler resources', async (t) => {
  const { server } = createPersonalPreview();
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(`${base}/code-lab`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /规划中 · 暂未开放/);
  for (const route of [
    '/code-lab-worker.js',
    '/code-lab.js',
    '/code-lab-assets/0.3.0/toolchain.js',
    '/vendor/@live-codes/clang-wasm/assets/bin/clang.wasm.gz',
  ]) {
    assert.equal((await fetch(base + route)).status, 410, route);
  }
});

test('the existing authenticated Max sandbox route is not redirected to the paused lab', () => {
  const app = read('public/app.js');
  assert.match(app, /callApi\('\/code\/run'/);
  const backend = read('backend/server.js');
  assert.match(backend, /app.post\('\/api\/code\/run'/);
  assert.match(backend, /sandboxBaseUrl/);
  assert.doesNotMatch(backend, /code-lab-assets|clang-wasm/);
});
