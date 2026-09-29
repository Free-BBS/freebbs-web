const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { parseFileInProcess } = require('./max-file-process');

function fixture(run) {
  const child = new EventEmitter();
  child.kills = 0;
  child.kill = () => {
    child.kills += 1;
  };
  child.send = (task, callback) => {
    setImmediate(() => run(child, task, callback));
  };
  return {
    child,
    forkImpl(file, args, options) {
      assert.match(file, /max-file-parser-child\.js$/);
      assert.deepEqual(args, []);
      assert.equal(options.windowsHide, true);
      assert.equal(options.serialization, 'advanced');
      assert.deepEqual(options.execArgv, ['--max-old-space-size=256']);
      return child;
    },
  };
}
const task = { name: 'example.pdf', buffer: Buffer.from('fixture'), visual: false };

test('process parsing waits for clean exit and preserves binary input and visual results', async () => {
  const parser = fixture((child, input, sent) => {
    assert.ok(Buffer.isBuffer(input.buffer));
    assert.equal(input.name, task.name);
    sent(null);
    child.emit('message', { document: { pageCount: 17, pdf: input.buffer } });
    child.emit('exit', 0);
  });
  const result = await parseFileInProcess({ ...task, visual: 'prepare' }, parser);
  assert.equal(result.pageCount, 17);
  assert.deepEqual(result.pdf, task.buffer);
  assert.equal(parser.child.kills, 0);
});

test('process parsing rejects a native crash even after receiving a result', async () => {
  const parser = fixture((child) => {
    child.emit('message', { text: 'not yet safe' });
    child.emit('exit', 3221225477);
  });
  await assert.rejects(parseFileInProcess(task, parser), /文件解析失败/);
});

test('process parsing returns parser errors and fails if no result arrives', async () => {
  const parser = fixture((child) => {
    child.emit('message', { error: '文件文字超过 6 万字' });
    child.emit('exit', 0);
  });
  await assert.rejects(parseFileInProcess(task, parser), /6 万字/);
  const empty = fixture((child) => child.emit('exit', 0));
  await assert.rejects(parseFileInProcess(task, empty), /文件解析失败/);
});

test('process parsing enforces timeout and terminates failed IPC/spawn jobs', async () => {
  const timed = fixture(() => {
    /* Simulate a hung native parser. */
  });
  await assert.rejects(parseFileInProcess(task, { ...timed, timeoutMs: 10 }), /超时/);
  assert.equal(timed.child.kills, 1);
  const broken = fixture((child, input, sent) => sent(new Error('IPC closed')));
  await assert.rejects(parseFileInProcess(task, broken), /IPC closed/);
  assert.equal(broken.child.kills, 1);
  const failed = fixture((child) => child.emit('error', new Error('spawn failed')));
  await assert.rejects(parseFileInProcess(task, failed), /spawn failed/);
  assert.equal(failed.child.kills, 1);
});
