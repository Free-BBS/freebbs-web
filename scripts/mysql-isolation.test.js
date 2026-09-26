const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  isolatedMysqlConfig,
  assertIsolatedMysql,
} = require('../backend/test-helpers/isolated-mysql');
const {
  TEST_FILES,
  testEnvironment,
  REQUIRED_MYSQL_TESTS,
  validateMysqlTestOutput,
} = require('./test-mysql-isolated');

const unixSocket = '/tmp/freebbs-mysql-qa-Ab1234/mysql.sock';
const windowsPipe = String.raw`\\.\pipe\freebbs-mysql-qa-0123456789abcdef0123456789abcdef`;
const legacyPipe = String.raw`\\.\pipe\freebbs-admin-rewards-qa`;

test('isolated MySQL accepts dedicated Unix, Windows and explicitly named legacy QA transports', () => {
  for (const socketPath of [unixSocket, windowsPipe]) {
    assert.deepEqual(
      isolatedMysqlConfig('LEGACY_SOCKET', {
        FREEBBS_TEST_MYSQL_SOCKET: socketPath,
        LEGACY_SOCKET: '/tmp/mysql.sock',
        MYSQL_HOST: 'production.example',
        MYSQL_USER: 'production-user',
        MYSQL_PASSWORD: 'production-password',
        MYSQL_DATABASE: 'production-database',
      }),
      { socketPath, user: 'root', password: '' },
    );
  }
  assert.deepEqual(
    isolatedMysqlConfig('ADMIN_TEST_MYSQL_SOCKET', {
      ADMIN_TEST_MYSQL_SOCKET: legacyPipe,
    }),
    { socketPath: legacyPipe, user: 'root', password: '' },
  );
});

test('isolated MySQL rejects ordinary sockets, relative paths, production pipes and TCP-only configuration', () => {
  for (const socketPath of [
    '/tmp/mysql.sock',
    'mysql.sock',
    '../mysql.sock',
    'freebbs-mysql-qa-Ab1234/mysql.sock',
    '/tmp/freebbs-mysql-qa-Ab1234/../mysql.sock',
    String.raw`\\.\pipe\freebbs-production`,
    String.raw`\\.\pipe\freebbs-mysql-qa-invalid`,
  ]) {
    assert.throws(
      () =>
        isolatedMysqlConfig('LEGACY_SOCKET', {
          FREEBBS_TEST_MYSQL_SOCKET: socketPath,
          LEGACY_SOCKET: legacyPipe,
        }),
      /dedicated FREE BBS QA socket/,
      'an invalid global transport must not fall back to a legacy socket',
    );
  }
  assert.throws(
    () =>
      isolatedMysqlConfig('LEGACY_SOCKET', {
        MYSQL_HOST: 'production.example',
        MYSQL_PORT: '3306',
        MYSQL_USER: 'production-user',
        MYSQL_PASSWORD: 'production-password',
        MYSQL_DATABASE: 'production-database',
        DB_HOST: 'production.example',
      }),
    /explicit isolated MySQL socket/,
  );
});

test('server isolation verification only reads skip_networking and rejects network-enabled servers', async () => {
  for (const isolated of [1, '1', 0, '0', null, false, undefined, 2]) {
    const queries = [];
    const connection = {
      async query(sql) {
        queries.push(sql);
        return [[{ isolated }]];
      },
    };
    if (isolated === 1 || isolated === '1') await assertIsolatedMysql(connection);
    else await assert.rejects(assertIsolatedMysql(connection), /must disable networking/);
    assert.equal(queries.length, 1);
    assert.match(queries[0], /^SELECT\s+@@skip_networking\s+AS\s+isolated\s*;?$/i);
  }
});

test('the isolated runner removes inherited database targets and Node hooks without mutating its environment', () => {
  const original = Object.freeze({
    PATH: 'preserved-tool-path',
    PYTHON: 'preserved-python',
    PYTHONUTF8: '0',
    PYTHONIOENCODING: 'ascii',
    MYSQL_HOST: 'production.example',
    MYSQL_PORT: '3306',
    MYSQL_SOCKET: '/tmp/mysql.sock',
    MYSQL_DATABASE: 'production-database',
    MYSQL_USER: 'production-user',
    MYSQL_PASSWORD: 'production-password',
    MYSQL_SSL_CA: '/production/ca.pem',
    DB_HOST: 'production.example',
    DB_PASSWORD: 'production-password',
    DATABASE_URL: 'mysql://production.example/database',
    BACKEND_IP: 'production.example',
    FREEBBS_TEST_MYSQL_SOCKET: '/tmp/mysql.sock',
    FREEBBS_TEST_MYSQL_PASSWORD: 'production-password',
    USERNAME_TEST_MYSQL_HOST: 'production.example',
    USERNAME_TEST_MYSQL_PORT: '3306',
    USERNAME_TEST_MYSQL_USER: 'production-user',
    USERNAME_TEST_MYSQL_PASSWORD: 'production-password',
    NOTIFICATIONS_MYSQL_HOST: 'production.example',
    NOTIFICATIONS_MYSQL_PORT: '3306',
    NOTIFICATIONS_MYSQL_USER: 'production-user',
    NOTIFICATIONS_MYSQL_PASSWORD: 'production-password',
    SURVEY_TEST_MYSQL_SOCKET: '/tmp/mysql.sock',
    SURVEY_TEST_MYSQL_PORT: '3306',
    SURVEY_TEST_MYSQL_USER: 'production-user',
    SURVEY_TEST_MYSQL_PASSWORD: 'production-password',
    NODE_OPTIONS: '--require /production/hook.js',
    NODE_TEST_CONTEXT: 'child-v8',
    RUN_UNRELATED_INTEGRATION: '1',
  });
  const snapshot = { ...original };
  const env = testEnvironment(unixSocket, original);
  assert.deepEqual(original, snapshot);
  assert.equal(env.PATH, original.PATH);
  assert.equal(env.PYTHON, original.PYTHON);
  assert.equal(env.PYTHONUTF8, '1');
  assert.equal(env.PYTHONIOENCODING, 'utf-8');
  assert.equal(env.NODE_ENV, 'test');
  assert.equal(env.FREEBBS_TEST_MYSQL_SOCKET, unixSocket);
  assert.equal(env.MYSQL_SOCKET, unixSocket);
  assert.equal(env.MYSQL_USER, 'root');
  assert.equal(env.MYSQL_PASSWORD, '');
  assert.equal(env.BACKEND_IP, '127.0.0.1');
  for (const key of Object.keys(original)) {
    if (
      ![
        'PATH',
        'PYTHON',
        'PYTHONUTF8',
        'PYTHONIOENCODING',
        'FREEBBS_TEST_MYSQL_SOCKET',
        'MYSQL_SOCKET',
        'MYSQL_USER',
        'MYSQL_PASSWORD',
        'BACKEND_IP',
      ].includes(key)
    )
      assert.equal(Object.hasOwn(env, key), false, `${key} must not leak into the test process`);
  }
});

test('the isolated runner enables its fourteen named test files with matching database opt-ins', () => {
  const expected = [
    'backend/circuit-progress.test.js',
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
    'backend/course-schedule.mysql.test.js',
  ];
  assert.deepEqual([...TEST_FILES].sort(), expected.sort());
  assert.equal(new Set(TEST_FILES).size, 14);
  for (const file of TEST_FILES)
    assert.equal(fs.existsSync(path.join(__dirname, '..', file)), true);
  const env = testEnvironment(windowsPipe, {});
  for (const key of [
    'RUN_ADMIN_REWARDS_MYSQL',
    'RUN_ECONOMY_MYSQL',
    'RUN_BONE_SALES_MYSQL',
    'RUN_ONBOARDING_REWARD_MYSQL',
    'RUN_USERNAME_INTEGRATION',
    'RUN_LOGIN_RATE_MYSQL',
    'RUN_COMMUNITY_INTEGRATION',
    'RUN_WORKBENCH_MYSQL',
    'NOTIFICATIONS_MYSQL_TEST',
    'WHITELIST_TEST_MYSQL',
  ])
    assert.equal(env[key], '1', `${key} must enable its integration tests`);
  assert.equal(env.FREEBBS_TEST_MYSQL_SOCKET, windowsPipe);
  assert.equal(env.MYSQL_SOCKET, windowsPipe);
});

test('the isolated runner requires successful top-level evidence for all fourteen live MySQL tests', () => {
  assert.equal(REQUIRED_MYSQL_TESTS.length, 14);
  const successes = REQUIRED_MYSQL_TESTS.map((name, index) => `ok ${index + 1} - ${name}`);
  const summary = '# fail 0\n# skipped 0\n';
  const complete = `${successes.join('\n')}\n${summary}`;
  assert.doesNotThrow(() => validateMysqlTestOutput(complete));
  assert.throws(
    () => validateMysqlTestOutput(`${successes.slice(1).join('\n')}\n${summary}`),
    /required MySQL test did not run/,
  );
  assert.throws(
    () => validateMysqlTestOutput(complete.replace('# skipped 0', '# skipped 1')),
    /must not skip any test/,
  );
  assert.throws(
    () => validateMysqlTestOutput(complete.replace('# fail 0', '# fail 1')),
    /must not fail any test/,
  );
  assert.throws(() => validateMysqlTestOutput(successes.join('\n')), /must not skip any test/);
  const nested = successes.map((line) => `    ${line}`).join('\n');
  assert.throws(
    () => validateMysqlTestOutput(`${nested}\n${summary}`),
    /required MySQL test did not run/,
  );
  const fileOnly = TEST_FILES.map((file, index) => `ok ${index + 1} - ${file}`).join('\n');
  assert.throws(
    () => validateMysqlTestOutput(`${fileOnly}\n${summary}`),
    /required MySQL test did not run/,
  );
});
