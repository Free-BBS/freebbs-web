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
    assert.deepEqual(requests, ['/uploads/avatar-test.svg?v=1', '/api/surveys']);
  },
);
