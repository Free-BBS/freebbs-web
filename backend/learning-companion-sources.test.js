const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { fork } = require('node:child_process');
const { once } = require('node:events');

test(
  'source manifest routes survive authentication failures under strict unhandled rejections',
  { timeout: 15000 },
  async (t) => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    delete env.NODE_OPTIONS;
    const child = fork(path.join(__dirname, 'test-helpers/companion-sources-server.js'), [], {
      env,
      execArgv: ['--unhandled-rejections=strict'],
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    const exited = once(child, 'exit');
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await exited;
    });
    const [ready] = await Promise.race([
      once(child, 'message'),
      exited.then(([code]) => {
        throw new Error(`Fixture exited with ${code}: ${stderr}`);
      }),
    ]);
    const base = `http://127.0.0.1:${ready.port}`;
    const call = async (authorization, query = 'course=signals&point=SS-01-01') => {
      const res = await fetch(`${base}/api/sources?${query}`, {
        headers: { Authorization: authorization },
        signal: AbortSignal.timeout(3000),
      });
      return { status: res.status, body: await res.json(), headers: res.headers };
    };

    const denied = await call('denied');
    assert.equal(denied.status, 401);
    assert.match(denied.headers.get('cache-control'), /private, no-store/);
    assert.equal((await (await fetch(`${base}/health`)).json()).nodeReads, 0);
    const failed = await call('throw');
    assert.equal(failed.status, 503);
    assert.deepEqual(failed.body, { message: '参考资料暂时无法读取' });
    assert.match(failed.headers.get('cache-control'), /private, no-store/);
    assert.doesNotMatch(JSON.stringify(failed.body), /PRIVATE_|ECONNREFUSED/);
    assert.equal((await (await fetch(`${base}/health`)).json()).pid, ready.pid);
    assert.equal(child.exitCode, null);
    assert.equal((await call('owner', 'course=invalid!&point=SS-01-01')).status, 400);
    assert.equal((await call('owner', 'course=signals&point=SS-99-98')).status, 404);
    const nodeFailure = await call('owner', 'course=signals&point=SS-99-99');
    assert.equal(nodeFailure.status, 503);
    assert.doesNotMatch(JSON.stringify(nodeFailure.body), /PRIVATE_/);
    const recovered = await call('owner');
    assert.equal(recovered.status, 200);
    assert.equal(recovered.body.sources.scope, 'authenticated_owner_current_node');
    assert.equal(recovered.body.sources.knowledgePointId, 'SS-01-01');
    assert.deepEqual(recovered.body.sources.sources, []);
    assert.equal(stderr, '');
  },
);
