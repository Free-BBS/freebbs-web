import assert from 'node:assert/strict';
import test from 'node:test';

import { parseBootstrapArguments, runBootstrapCli } from '../../scripts/admin-bootstrap.mjs';
import { databaseLockName } from '../../scripts/migrate.mjs';

const productionEnvironment = {
  NODE_ENV: 'production',
  DATA_MODE: 'mysql',
  MYSQL_HOST: '127.0.0.1',
  MYSQL_PORT: '3306',
  MYSQL_USER: 'development',
  MYSQL_PASSWORD: 'secret',
  MYSQL_DATABASE: 'free_bbs_development',
};

function fakeDependencies({ appliedMigrations, bootstrapError } = {}) {
  const events = [];
  const migrations = [
    { name: '001_core.sql', checksum: 'a'.repeat(64) },
    { name: '002_domains.sql', checksum: 'b'.repeat(64) },
  ];
  const rows =
    appliedMigrations ??
    migrations.map(({ name, checksum }) => ({
      name,
      checksum,
    }));
  const store = { kind: 'store' };
  const connection = {
    async execute(sql, values) {
      events.push(['execute', sql, values]);
      if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }], []];
      if (sql.includes('development_schema_migrations')) return [rows, []];
      if (sql.includes('RELEASE_LOCK')) return [[{ released: 1 }], []];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release() {
      events.push(['connection-release']);
    },
  };
  const pool = {
    async getConnection() {
      events.push(['get-connection']);
      return connection;
    },
    async end() {
      events.push(['pool-end']);
    },
  };
  return {
    events,
    migrations,
    store,
    options: {
      createPoolImpl(config) {
        events.push(['create-pool', config]);
        return pool;
      },
      async discoverMigrationsImpl(directory) {
        events.push(['discover-migrations', directory]);
        return migrations;
      },
      createStoreImpl(environment) {
        events.push(['create-store', environment]);
        return {
          mode: 'mysql',
          store,
          async close() {
            events.push(['store-close']);
          },
        };
      },
      async bootstrapPlatformImpl(receivedStore, input) {
        events.push(['bootstrap', receivedStore, input]);
        if (bootstrapError) throw bootstrapError;
        return {
          uid: input.uid,
          subjectId: 'subject-1',
          roleAssignmentId: 'assignment-1',
          recovered: input.recovery,
        };
      },
      now: () => new Date('2026-07-27T08:30:00.000Z'),
      version: 'test-version',
      writeOutput(message) {
        events.push(['output', message]);
      },
    },
  };
}

test('bootstrap arguments parse the exact normal confirmation', () => {
  assert.deepEqual(
    parseBootstrapArguments([
      '--uid',
      'u_20260727_admin',
      '--confirm',
      'BOOTSTRAP_SUPER_ADMIN:u_20260727_admin',
    ]),
    {
      uid: 'u_20260727_admin',
      confirm: 'BOOTSTRAP_SUPER_ADMIN:u_20260727_admin',
      recovery: false,
      help: false,
    },
  );
});

test('bootstrap arguments parse recovery mode', () => {
  assert.deepEqual(
    parseBootstrapArguments([
      '--uid',
      'u_recovery',
      '--recovery',
      '--confirm',
      'RECOVER_SUPER_ADMIN:u_recovery',
    ]),
    {
      uid: 'u_recovery',
      confirm: 'RECOVER_SUPER_ADMIN:u_recovery',
      recovery: true,
      help: false,
    },
  );
});

test('bootstrap arguments reject unknown, duplicate, positional and missing-value input', () => {
  assert.throws(() => parseBootstrapArguments(['--unknown']), /Unknown argument/);
  assert.throws(
    () => parseBootstrapArguments(['--flag=sentinel-secret']),
    (error) => {
      assert.match(error.message, /Unknown argument: --flag/);
      assert.doesNotMatch(error.message, /sentinel-secret/);
      return true;
    },
  );
  assert.throws(() => parseBootstrapArguments(['u_admin']), /Unknown argument/);
  assert.throws(
    () => parseBootstrapArguments(['--uid', 'u_one', '--uid', 'u_two']),
    /specified once/,
  );
  assert.throws(() => parseBootstrapArguments(['--uid']), /requires a value/);
  assert.throws(() => parseBootstrapArguments(['--confirm', '--recovery']), /requires a value/);
});

test('bootstrap arguments reject password, token and SQL flags without echoing values', () => {
  for (const argument of [
    '--password=do-not-print',
    '--mysql-password',
    '--access-token',
    '--sql',
  ]) {
    assert.throws(
      () => parseBootstrapArguments([argument, 'do-not-print']),
      (error) => {
        assert.match(error.message, /not accepted as CLI arguments/);
        assert.doesNotMatch(error.message, /do-not-print/);
        return true;
      },
    );
  }
});

test('bootstrap CLI rejects unsafe UIDs before opening MySQL', async () => {
  for (const uid of ['   ', ' u_admin', 'u_admin ', 'u\nadmin', 'u\u001badmin', 'u'.repeat(129)]) {
    let poolOpened = false;
    await assert.rejects(
      runBootstrapCli({
        environment: productionEnvironment,
        argv: ['--uid', uid, '--confirm', `BOOTSTRAP_SUPER_ADMIN:${uid}`],
        createPoolImpl() {
          poolOpened = true;
          throw new Error('must not open');
        },
      }),
      /UID/,
    );
    assert.equal(poolOpened, false);
  }
});

test('executable failure formatting never exposes downstream messages', async () => {
  const module = await import('../../scripts/admin-bootstrap.mjs');
  const message = module.formatBootstrapCliFailure(
    new Error('sentinel-secret password=do-not-print SELECT * FROM private_data'),
  );
  assert.match(message, /Administrator bootstrap failed/);
  assert.doesNotMatch(message, /sentinel-secret|do-not-print|SELECT/i);
});
test('bootstrap CLI is production-only', async () => {
  await assert.rejects(runBootstrapCli({ environment: { NODE_ENV: 'development' } }), /production/);
});

test('bootstrap CLI requires mysql mode before opening a pool', async () => {
  let poolOpened = false;
  await assert.rejects(
    runBootstrapCli({
      environment: { ...productionEnvironment, DATA_MODE: 'memory' },
      argv: ['--uid', 'u_x', '--confirm', 'BOOTSTRAP_SUPER_ADMIN:u_x'],
      createPoolImpl() {
        poolOpened = true;
        throw new Error('must not open');
      },
    }),
    /DATA_MODE=mysql/,
  );
  assert.equal(poolOpened, false);
});

test('bootstrap CLI requires the exact confirmation', async () => {
  await assert.rejects(
    runBootstrapCli({
      environment: productionEnvironment,
      argv: ['--uid', 'u_x', '--confirm', 'wrong'],
    }),
    /confirmation/,
  );
});

test('bootstrap CLI requires the recovery-specific confirmation', async () => {
  await assert.rejects(
    runBootstrapCli({
      environment: productionEnvironment,
      argv: ['--uid', 'u_x', '--recovery', '--confirm', 'BOOTSTRAP_SUPER_ADMIN:u_x'],
    }),
    /RECOVER_SUPER_ADMIN:u_x/,
  );
});

test('bootstrap help exits without validating environment or opening MySQL', async () => {
  let databaseOpened = false;
  const output = [];
  const exitCode = await runBootstrapCli({
    argv: ['--help'],
    environment: {},
    createPoolImpl() {
      databaseOpened = true;
      throw new Error('must not open');
    },
    createStoreImpl() {
      databaseOpened = true;
      throw new Error('must not open');
    },
    writeOutput: (message) => output.push(message),
  });

  assert.equal(exitCode, 0);
  assert.equal(databaseOpened, false);
  assert.match(output.join(''), /BOOTSTRAP_SUPER_ADMIN:<uid>/);
  assert.match(output.join(''), /RECOVER_SUPER_ADMIN:<uid>/);
  assert.doesNotMatch(output.join(''), /--password|--token|--sql/);
});

test('bootstrap CLI rejects migration filename and checksum drift before opening the store', async () => {
  for (const appliedMigrations of [
    [{ name: '001_core.sql', checksum: 'a'.repeat(64) }],
    [
      { name: '001_core.sql', checksum: 'a'.repeat(64) },
      { name: '002_domains.sql', checksum: 'c'.repeat(64) },
    ],
    [
      { name: '001_core.sql', checksum: 'a'.repeat(64) },
      { name: '002_domains.sql', checksum: 'b'.repeat(64) },
      { name: '999_extra.sql', checksum: 'd'.repeat(64) },
    ],
  ]) {
    const dependencies = fakeDependencies({ appliedMigrations });
    await assert.rejects(
      runBootstrapCli({
        ...dependencies.options,
        environment: productionEnvironment,
        argv: ['--uid', 'u_admin', '--confirm', 'BOOTSTRAP_SUPER_ADMIN:u_admin'],
      }),
      /migration (?:history|checksum)/i,
    );
    assert.equal(
      dependencies.events.some(([event]) => event === 'create-store'),
      false,
    );
    assert.ok(
      dependencies.events.some(
        ([event, sql]) => event === 'execute' && sql.includes('RELEASE_LOCK'),
      ),
    );
    assert.deepEqual(dependencies.events.at(-1), ['pool-end']);
  }
});

test('bootstrap CLI holds the database lock through verification and bootstrap', async () => {
  const dependencies = fakeDependencies();

  const result = await runBootstrapCli({
    ...dependencies.options,
    environment: productionEnvironment,
    argv: ['--uid', 'u_admin', '--confirm', 'BOOTSTRAP_SUPER_ADMIN:u_admin'],
  });

  assert.deepEqual(result, {
    uid: 'u_admin',
    subjectId: 'subject-1',
    roleAssignmentId: 'assignment-1',
    recovered: false,
  });
  const eventNames = dependencies.events.map(([event, sql]) =>
    event === 'execute' && sql.includes('GET_LOCK')
      ? 'lock'
      : event === 'execute' && sql.includes('development_schema_migrations')
        ? 'verify'
        : event === 'execute' && sql.includes('RELEASE_LOCK')
          ? 'unlock'
          : event,
  );
  assert.ok(eventNames.indexOf('lock') < eventNames.indexOf('discover-migrations'));
  assert.ok(eventNames.indexOf('discover-migrations') < eventNames.indexOf('verify'));
  assert.ok(eventNames.indexOf('verify') < eventNames.indexOf('bootstrap'));
  assert.ok(eventNames.indexOf('bootstrap') < eventNames.indexOf('store-close'));
  assert.ok(eventNames.indexOf('store-close') < eventNames.indexOf('unlock'));
  assert.deepEqual(eventNames.slice(-4), ['unlock', 'connection-release', 'pool-end', 'output']);

  const lockCall = dependencies.events.find(
    ([event, sql]) => event === 'execute' && sql.includes('GET_LOCK'),
  );
  assert.equal(lockCall[2][0], databaseLockName(productionEnvironment.MYSQL_DATABASE));
  const bootstrapCall = dependencies.events.find(([event]) => event === 'bootstrap');
  assert.equal(bootstrapCall[1], dependencies.store);
  assert.deepEqual(bootstrapCall[2], {
    uid: 'u_admin',
    recovery: false,
    version: 'test-version',
    now: new Date('2026-07-27T08:30:00.000Z'),
  });
});

test('bootstrap CLI closes the store, releases the lock and closes the pool on failure', async () => {
  const dependencies = fakeDependencies({
    bootstrapError: new Error('bootstrap failed'),
  });

  await assert.rejects(
    runBootstrapCli({
      ...dependencies.options,
      environment: productionEnvironment,
      argv: ['--uid', 'u_admin', '--confirm', 'BOOTSTRAP_SUPER_ADMIN:u_admin'],
    }),
    /bootstrap failed/,
  );

  const eventNames = dependencies.events.map(([event, sql]) =>
    event === 'execute' && sql.includes('RELEASE_LOCK') ? 'unlock' : event,
  );
  assert.ok(eventNames.includes('store-close'));
  assert.deepEqual(eventNames.slice(-3), ['unlock', 'connection-release', 'pool-end']);
});
