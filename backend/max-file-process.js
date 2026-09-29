const { fork } = require('node:child_process');
const path = require('node:path');

// Native canvas teardown can crash a Windows worker thread's entire host.
// An isolated Node process keeps the same bounded task contract without loading
// that addon into the API server. This is crash isolation, not a security sandbox.
function parseFileInProcess(
  task,
  { forkImpl = fork, timeoutMs = task.visual ? 70000 : 15000 } = {},
) {
  return new Promise((resolve, reject) => {
    const child = forkImpl(path.join(__dirname, 'max-file-parser-child.js'), [], {
      windowsHide: true,
      serialization: 'advanced',
      execArgv: ['--max-old-space-size=256'],
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    let result;
    let received = false;
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else if (result?.error) reject(new Error(result.error));
      else resolve(task.visual ? result?.document : result?.text);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error('文件解析超时，请拆分后重试。'));
    }, timeoutMs);
    child.once('message', (value) => {
      result = value;
      received = true;
    });
    child.once('error', (error) => {
      child.kill();
      finish(error);
    });
    // Do not report success before native resources have actually shut down.
    child.once('exit', (code) =>
      finish(code === 0 && received ? null : new Error('文件解析失败，请检查文件格式。')),
    );
    child.send(task, (error) => {
      if (error) {
        child.kill();
        finish(error);
      }
    });
  });
}

module.exports = { parseFileInProcess };
