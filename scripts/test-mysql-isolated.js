const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const mysql = require('mysql2/promise');
const {
  isolatedMysqlConfig,
  assertIsolatedMysql,
} = require('../backend/test-helpers/isolated-mysql');

const TEST_FILES = [
  'backend/wallet-ledger.test.js',
  'backend/economy-rewards.mysql.test.js',
  'backend/admin-rewards.mysql.test.js',
  'backend/economy-sales.mysql.test.js',
  'backend/onboarding-reward.mysql.test.js',
  'backend/username-changes.test.js',
  'backend/login-rate-limit.test.js',
  'backend/notifications.test.js',
  'backend/registration-whitelist.test.js',
  'backend/surveys.test.js',
  'backend/community.integration.test.js',
  'backend/workbench-schedule-planner.mysql.test.js',
];

function testEnvironment(socketPath, original = process.env) {
  const env = { ...original };
  for (const key of Object.keys(env)) {
    if (
      /^(?:NODE_OPTIONS$|NODE_TEST_CONTEXT$|MYSQL_|DB_|DATABASE_|BACKEND_IP$|FREEBBS_TEST_MYSQL_|RUN_.*(?:MYSQL|INTEGRATION)$|.*_MYSQL_|WHITELIST_TEST_MYSQL$|NOTIFICATIONS_MYSQL_TEST$)/.test(
        key,
      )
    )
      delete env[key];
  }
  return {
    ...env,
    NODE_ENV: 'test',
    FREEBBS_TEST_MYSQL_SOCKET: socketPath,
    RUN_ADMIN_REWARDS_MYSQL: '1',
    RUN_ECONOMY_MYSQL: '1',
    RUN_BONE_SALES_MYSQL: '1',
    RUN_ONBOARDING_REWARD_MYSQL: '1',
    RUN_USERNAME_INTEGRATION: '1',
    RUN_LOGIN_RATE_MYSQL: '1',
    RUN_COMMUNITY_INTEGRATION: '1',
    RUN_WORKBENCH_MYSQL: '1',
    NOTIFICATIONS_MYSQL_TEST: '1',
    WHITELIST_TEST_MYSQL: '1',
    MYSQL_SOCKET: socketPath,
    BACKEND_IP: '127.0.0.1',
    MYSQL_USER: 'root',
    MYSQL_PASSWORD: '',
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
    AGENT_SERVICE_TOKEN: '',
    BOTMAIL_SMTP: '',
    BOTMAIL_USER: '',
    BOTMAIL_PASS: '',
    BOTMAIL_FROM: '',
  };
}

const REQUIRED_MYSQL_TESTS = [
  'MySQL: additive rewards,',
  'community features work together against the full existing MySQL schema',
  'REPEATABLE READ reward cap',
  'MySQL bone sales serialize inventory',
  'isolated MySQL atomically limits accounts',
  'MySQL: full existing schema',
  'isolated MySQL: permanent concurrent claim',
  'MySQL transactions preserve claims',
  'MySQL: public lifecycle',
  'isolated MySQL validates migration',
  'MySQL ledger captures',
  'isolated MySQL: planner preview',
];

function validateMysqlTestOutput(output) {
  assert.match(output, /^# skipped 0\s*$/m, 'the isolated suite must not skip any test');
  assert.match(output, /^# fail 0\s*$/m, 'the isolated suite must not fail any test');
  const successes = output.split('\n').filter((line) => /^ok \d+ - /.test(line));
  for (const name of REQUIRED_MYSQL_TESTS) {
    assert.ok(
      successes.some((line) => line.includes(` - ${name}`)),
      `required MySQL test did not run: ${name}`,
    );
  }
}

function stopChildTree(child) {
  if (!child.pid) return Promise.resolve();
  if (process.platform === 'win32') {
    return new Promise((resolve) => {
      // Only this runner's child PID and its descendants; never a process-name kill.
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.once('error', () => {
        child.kill();
        resolve();
      });
      killer.once('exit', resolve);
    });
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill();
  }
  return Promise.resolve();
}

function run(command, args, options = {}, verifyTests = false) {
  const { signal, ...spawnOptions } = options;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const child = spawn(command, args, {
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: verifyTests ? ['ignore', 'pipe', 'inherit'] : 'inherit',
      ...spawnOptions,
    });
    const cancel = () => {
      stopChildTree(child).finally(() => reject(signal.reason));
    };
    signal?.addEventListener('abort', cancel, { once: true });
    let output = '';
    if (verifyTests)
      child.stdout.on('data', (chunk) => {
        output += chunk.toString();
        process.stdout.write(chunk);
      });
    child.once('error', (error) => {
      signal?.removeEventListener('abort', cancel);
      reject(error);
    });
    child.once('exit', (code, exitSignal) => {
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      if (code !== 0) {
        reject(new Error(`${path.basename(command)} exited with ${code ?? exitSignal}`));
        return;
      }
      try {
        if (verifyTests) validateMysqlTestOutput(output);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
    child.once('exit', () => {
      signal?.removeEventListener('abort', cancel);
    });
  });
}

async function main() {
  const root = path.resolve(__dirname, '..');
  // Linux uses a deliberately short fixed parent so the Unix socket fits its length limit.
  const parent = process.platform === 'win32' ? os.tmpdir() : '/tmp';
  const temp = await fs.mkdtemp(path.join(parent, 'freebbs-mysql-qa-'));
  const data = path.join(temp, 'data');
  const log = path.join(temp, 'mysql.log');
  const socketPath =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\freebbs-mysql-qa-${randomUUID().replaceAll('-', '')}`
      : path.join(temp, 'mysql.sock');
  const binary = process.env.MYSQLD_BIN || 'mysqld';
  const env = testEnvironment(socketPath);
  const config = isolatedMysqlConfig(undefined, env);
  const baseArgs = ['--no-defaults', `--datadir=${data}`, `--log-error=${log}`, '--skip-log-bin'];
  if (process.platform !== 'win32' && process.getuid?.() === 0) baseArgs.push('--user=root');
  let server;
  let exited;
  let admin;
  let verifiedInstance = false;
  let success = false;
  const controller = new AbortController();
  const onInterrupt = () => controller.abort(new Error('MySQL QA interrupted'));
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onInterrupt);
  try {
    console.log('[mysql-qa] creating a fresh disposable socket-only MySQL instance');
    await run(binary, [...baseArgs, '--initialize-insecure'], {
      timeout: 120000,
      signal: controller.signal,
    });
    const transport =
      process.platform === 'win32'
        ? ['--enable-named-pipe', `--socket=${socketPath.split('\\').pop()}`]
        : [`--socket=${socketPath}`];
    server = spawn(binary, [...baseArgs, '--skip-networking', '--mysqlx=0', ...transport], {
      windowsHide: true,
      stdio: 'ignore',
    });
    let spawnError;
    server.once('error', (error) => {
      spawnError = error;
    });
    exited = new Promise((resolve) => {
      server.once('exit', resolve);
    });
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (controller.signal.aborted) throw controller.signal.reason;
      if (spawnError) throw spawnError;
      if (server.exitCode !== null)
        throw new Error(`MySQL stopped before readiness (${server.exitCode})`);
      try {
        admin = await mysql.createConnection({ ...config, connectTimeout: 1000 });
        break;
      } catch {
        await delay(250);
      }
    }
    if (!admin) throw new Error('Disposable MySQL did not become ready');
    await assertIsolatedMysql(admin);
    const [[version]] = await admin.query('SELECT VERSION() AS version, @@datadir AS data');
    assert.equal(
      path.resolve(version.data),
      path.resolve(data),
      'refuse any existing database instance',
    );
    verifiedInstance = true;
    console.log(
      `[mysql-qa] MySQL ${version.version}; networking disabled; ${TEST_FILES.length} test files`,
    );
    await run(
      process.execPath,
      ['--test', '--test-reporter=tap', '--test-concurrency=1', ...TEST_FILES],
      {
        cwd: root,
        env,
        signal: controller.signal,
      },
      true,
    );
    success = true;
  } finally {
    if (admin) {
      try {
        if (verifiedInstance) await admin.query('SHUTDOWN');
      } catch {
        /* shutdown can close the connection first */
      }
      await admin.end().catch(() => {});
    }
    if (server && server.exitCode === null && server.pid) {
      await Promise.race([exited, delay(5000)]);
      if (server.exitCode === null) server.kill();
      await Promise.race([exited, delay(5000)]);
    }
    if (success && (!server || server.exitCode !== null || server.signalCode !== null)) {
      assert.equal(path.dirname(temp), path.resolve(parent));
      assert.match(path.basename(temp), /^freebbs-mysql-qa-[A-Za-z0-9]+$/);
      await fs.rm(temp, { recursive: true, force: true });
      console.log('[mysql-qa] stopped MySQL and removed only its temporary test data');
    } else {
      console.error(`[mysql-qa] retained isolated diagnostic directory: ${temp}`);
      try {
        console.error((await fs.readFile(log, 'utf8')).split('\n').slice(-20).join('\n'));
      } catch {
        /* no log */
      }
    }
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onInterrupt);
  }
}

if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { TEST_FILES, testEnvironment, REQUIRED_MYSQL_TESTS, validateMysqlTestOutput };
