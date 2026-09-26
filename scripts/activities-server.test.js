const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const test = require('node:test');

test(
  'local frontend proxies custom avatar uploads and activity APIs to the configured backend',
  { timeout: 15000 },
  async (t) => {
    const requests = [];
    const backend = http.createServer((request, response) => {
      requests.push(request.url);
      if (request.url.startsWith('/uploads/')) {
        response.writeHead(200, { 'Content-Type': 'image/svg+xml' });
        response.end('<svg xmlns="http://www.w3.org/2000/svg"><title>avatar fixture</title></svg>');
      } else {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end('{"surveys":[]}');
      }
    });
    backend.listen(0, '127.0.0.1');
    await once(backend, 'listening');
    let frontend;
    t.after(async () => {
      if (frontend && frontend.exitCode === null) {
        frontend.kill('SIGTERM');
        await once(frontend, 'exit');
      }
      backend.closeAllConnections();
      await new Promise((resolve) => {
        backend.close(resolve);
      });
    });
    const reservation = http.createServer();
    reservation.listen(0, '127.0.0.1');
    await once(reservation, 'listening');
    const { port } = reservation.address();
    await new Promise((resolve) => {
      reservation.close(resolve);
    });
    frontend = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: String(port),
        API_HOST: '127.0.0.1',
        API_PORT: String(backend.address().port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await Promise.race([
      once(frontend.stdout, 'data'),
      once(frontend, 'exit').then(() => {
        throw new Error('frontend exited before listening');
      }),
    ]);
    const origin = `http://127.0.0.1:${port}`;
    const avatar = await fetch(`${origin}/uploads/avatar-test.svg?v=1`);
    assert.equal(avatar.status, 200);
    assert.match(avatar.headers.get('content-type'), /image\/svg\+xml/);
    assert.match(await avatar.text(), /avatar fixture/);
    const activities = await fetch(`${origin}/api/surveys`);
    assert.deepEqual(await activities.json(), { surveys: [] });
    const page = await fetch(`${origin}/surveys`);
    assert.match(await page.text(), /活动报名/);
    for (const route of [
      '/laboratory',
      '/code-lab',
      '/pbl',
      '/tool-workshop',
      '/creative-workshop',
      '/aichat',
      '/settings',
      '/profile',
    ]) {
      const response = await fetch(origin + route);
      assert.equal(response.status, 200, route);
      const html = await response.text();
      assert.equal(html.split('data-shared-footer').length - 1, 1, route);
      assert.match(html, /<body[^>]*>\s*<script src="\/typography.js"><\/script>/);
      assert.equal((await fetch(`${origin}/site-footer.css`)).status, 200);
      for (const asset of ['desktop-shell.css', 'personal-polish.css', 'desktop-shell.js']) {
        assert.equal(html.split(`/${asset}`).length - 1, 1, `${route}: ${asset} loaded once`);
        assert.equal((await fetch(`${origin}/${asset}`)).status, 200);
      }
      if (route === '/laboratory') {
        assert.match(html, /C \/ C\+\+/);
        assert.match(html, /href="\/circuits"/);
      }
    }
    const canonical = await fetch(`${origin}/laboratory.html?from=test`, { redirect: 'manual' });
    const codeCanonical = await fetch(`${origin}/code-lab.html?from=test`, { redirect: 'manual' });
    assert.equal(codeCanonical.headers.get('location'), '/code-lab?from=test');
    const planned = await (await fetch(`${origin}/code-lab`)).text();
    assert.match(planned, /规划中 · 暂未开放/);
    assert.doesNotMatch(planned, /code-lab(?:-worker)?\.js|id="code-run"/);
    for (const retired of [
      '/code-lab-worker.js',
      '/code-lab.js',
      '/code-lab.css',
      '/code-lab-assets/0.3.0/runtime-manifest.v1.json',
      '/code-lab-assets/0.3.0/bin/clang.wasm.gz',
      '/vendor/@live-codes/clang-wasm/dist/clang-wasm-toolchain.global.js',
      '/vendor/@wasm-idle/llvm-core/dist/index.js',
    ]) {
      for (const method of ['GET', 'HEAD']) {
        const response = await fetch(origin + retired, { method });
        assert.equal(response.status, 410, retired);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        if (method === 'HEAD') assert.equal(await response.text(), '');
      }
    }
    assert.equal(canonical.status, 301);
    assert.equal(canonical.headers.get('location'), '/laboratory?from=test');
    const pblCanonical = await fetch(`${origin}/pbl.html?from=menu`, { redirect: 'manual' });
    assert.equal(pblCanonical.status, 301);
    assert.equal(pblCanonical.headers.get('location'), '/pbl?from=menu');
    const embed = await (await fetch(`${origin}/circuit-embed`)).text();
    assert.doesNotMatch(embed, /desktop-shell/);
    assert.deepEqual(requests, ['/uploads/avatar-test.svg?v=1', '/api/surveys']);
  },
);
