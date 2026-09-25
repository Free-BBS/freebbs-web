import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

import {
  databaseLockName,
  parseMigrationArguments,
  runMigrationCli,
} from '../../scripts/migrate.mjs';
import {
  makeSeedStatementIdempotent,
  parseSeedArguments,
  runSeedCli,
} from '../../scripts/seed.mjs';

function mysqlEnvironment(overrides = {}) {
  return {
    DATA_MODE: 'mysql',
    MYSQL_HOST: '127.0.0.1',
    MYSQL_PORT: '3306',
    MYSQL_USER: 'development',
    MYSQL_PASSWORD: 'secret',
    MYSQL_DATABASE: 'free_bbs_development',
    ...overrides,
  };
}

function fakeLockConnection({ acquired = 1 } = {}) {
  const calls = [];
  return {
    calls,
    connection: {
      async execute(sql, values) {
        calls.push([sql, values]);
        if (sql.includes('GET_LOCK')) return [[{ acquired }], []];
        if (sql.includes('RELEASE_LOCK')) return [[{ released: 1 }], []];
        return [[], []];
      },
      release() {
        calls.push(['release']);
      },
    },
  };
}

test('migration arguments are strict and bounded', () => {
  assert.deepEqual(
    parseMigrationArguments(['--directory', 'db/migrations', '--lock-timeout', '9']),
    {
      directory: 'db/migrations',
      help: false,
      lockTimeoutSeconds: 9,
    },
  );
  assert.throws(() => parseMigrationArguments(['--lock-timeout', '301']), /between 0 and 300/);
  assert.throws(() => parseMigrationArguments(['--unknown']), /Unknown argument/);
});

test('database lock names are deterministic, database-specific and within MySQL limits', () => {
  const first = databaseLockName('free_bbs_development');
  assert.equal(first, databaseLockName('free_bbs_development'));
  assert.notEqual(first, databaseLockName('another_database'));
  assert.ok(Buffer.byteLength(first, 'utf8') <= 64);
});

test('migration CLI requires mysql mode before opening a pool', async () => {
  let poolOpened = false;
  await assert.rejects(
    runMigrationCli({
      argv: [],
      environment: mysqlEnvironment({ DATA_MODE: 'memory' }),
      createPoolImpl() {
        poolOpened = true;
        throw new Error('must not open');
      },
      runMigrationsImpl: async () => ['001_core.sql'],
    }),
    /DATA_MODE=mysql/,
  );
  assert.equal(poolOpened, false);
});

test('migration CLI holds and releases a database lock around the existing migrator', async () => {
  const { calls, connection } = fakeLockConnection();
  const pool = {
    async getConnection() {
      return connection;
    },
    async end() {
      calls.push(['end']);
    },
  };
  let receivedOptions;
  const output = [];

  const names = await runMigrationCli({
    argv: ['--directory', 'database/migrations', '--lock-timeout', '7'],
    environment: mysqlEnvironment(),
    rootDirectory: 'C:/repo',
    createPoolImpl: () => pool,
    async runMigrationsImpl(options) {
      receivedOptions = options;
      return ['001_core.sql', '002_domains.sql'];
    },
    writeOutput: (message) => output.push(message),
  });

  assert.deepEqual(names, ['001_core.sql', '002_domains.sql']);
  assert.equal(receivedOptions.pool, pool);
  assert.match(receivedOptions.directory.replaceAll('\\', '/'), /C:\/repo\/database\/migrations$/i);
  assert.deepEqual(calls[0][1][1], 7);
  assert.match(calls[0][0], /GET_LOCK/);
  assert.match(calls.at(-3)[0], /RELEASE_LOCK/);
  assert.deepEqual(calls.at(-2), ['release']);
  assert.deepEqual(calls.at(-1), ['end']);
  assert.match(output.join(''), /001_core\.sql, 002_domains\.sql/);
});

test('migration CLI releases the lock and pool when migration fails', async () => {
  const { calls, connection } = fakeLockConnection();
  const pool = {
    async getConnection() {
      return connection;
    },
    async end() {
      calls.push(['end']);
    },
  };

  await assert.rejects(
    runMigrationCli({
      argv: [],
      environment: mysqlEnvironment(),
      createPoolImpl: () => pool,
      runMigrationsImpl: async () => {
        throw new Error('migration broke');
      },
    }),
    /migration broke/,
  );

  assert.ok(calls.some(([sql]) => typeof sql === 'string' && sql.includes('RELEASE_LOCK')));
  assert.deepEqual(calls.at(-1), ['end']);
});

test('seed arguments are strict', () => {
  assert.deepEqual(parseSeedArguments(['--file', 'database/seeds/001_demo.sql']), {
    file: 'database/seeds/001_demo.sql',
    help: false,
    lockTimeoutSeconds: 60,
  });
  assert.throws(() => parseSeedArguments(['extra.sql']), /Unknown argument/);
});

test('seed inserts become repeatable no-op upserts and non-inserts are rejected', () => {
  assert.equal(
    makeSeedStatementIdempotent("INSERT INTO subjects (id, uid) VALUES ('1', 'demo')"),
    "INSERT INTO subjects (id, uid) VALUES ('1', 'demo')\nON DUPLICATE KEY UPDATE id = id",
  );
  assert.throws(() => makeSeedStatementIdempotent('DELETE FROM subjects'), /INSERT statements/);
});

test('seed CLI refuses mutation unless explicitly enabled', async () => {
  let poolOpened = false;
  await assert.rejects(
    runSeedCli({
      argv: [],
      environment: mysqlEnvironment(),
      createPoolImpl() {
        poolOpened = true;
        throw new Error('must not open');
      },
    }),
    /ALLOW_DEMO_SEED=true/,
  );
  assert.equal(poolOpened, false);
});

test('production seed requires an additional production-specific gate', async () => {
  await assert.rejects(
    runSeedCli({
      argv: [],
      environment: mysqlEnvironment({ NODE_ENV: 'production', ALLOW_DEMO_SEED: 'true' }),
    }),
    /ALLOW_PRODUCTION_DEMO_SEED=true/,
  );
});

test('seed fails closed when NODE_ENV is missing or unknown', async () => {
  for (const nodeEnvironment of [undefined, 'staging']) {
    await assert.rejects(
      runSeedCli({
        argv: [],
        environment: mysqlEnvironment({
          NODE_ENV: nodeEnvironment,
          ALLOW_DEMO_SEED: 'true',
        }),
      }),
      /ALLOW_PRODUCTION_DEMO_SEED=true/,
    );
  }
});

test('seed CLI transforms all statements in one transaction while holding the shared lock', async () => {
  const executed = [];
  let committed = false;
  const connection = {
    async execute(sql, values) {
      executed.push([sql, values]);
      if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }], []];
      if (sql.includes('RELEASE_LOCK')) return [[{ released: 1 }], []];
      return [[], []];
    },
    async beginTransaction() {
      executed.push(['begin']);
    },
    async commit() {
      committed = true;
      executed.push(['commit']);
    },
    async rollback() {
      executed.push(['rollback']);
    },
    release() {
      executed.push(['release']);
    },
  };
  const pool = {
    async getConnection() {
      return connection;
    },
    async end() {
      executed.push(['end']);
    },
  };

  const count = await runSeedCli({
    argv: [],
    environment: mysqlEnvironment({ NODE_ENV: 'development', ALLOW_DEMO_SEED: 'true' }),
    createPoolImpl: () => pool,
    readFileImpl: async () =>
      "INSERT INTO subjects (id, uid) VALUES ('1', 'demo'); INSERT INTO roles (id, role_key) VALUES ('2', 'role');",
    splitSqlStatementsImpl: (sql) => sql.split(';').filter((part) => part.trim()),
    writeOutput: () => {},
  });

  assert.equal(count, 2);
  assert.equal(committed, true);
  const upserts = executed.filter(([sql]) =>
    typeof sql === 'string' ? sql.includes('ON DUPLICATE KEY UPDATE') : false,
  );
  assert.equal(upserts.length, 2);
  assert.equal(executed[0][1][0], databaseLockName('free_bbs_development'));
  assert.match(executed.at(-3)[0], /RELEASE_LOCK/);
  assert.deepEqual(executed.at(-1), ['end']);
});

test('backup script requires an explicit target and keeps passwords off mysqldump argv', async () => {
  const script = await readFile(new URL('../../scripts/backup.sh', import.meta.url), 'utf8');
  assert.match(script, /Usage:/);
  assert.match(script, /--defaults-extra-file=/);
  assert.doesNotMatch(script, /--password(?:=|\s)/);
  assert.match(script, /umask 077/);
  assert.match(script, /single-transaction/);
  assert.match(script, /case \$MYSQL_DATABASE in/);
  assert.match(script, /trap cleanup 0 HUP INT TERM/);
  assert.match(script, /Refusing to overwrite/);
});

test('server installer is non-starting, non-overwriting, and installs the audited hook', async () => {
  const installer = await readFile(
    new URL('../../scripts/install-server.sh', import.meta.url),
    'utf8',
  );
  const backupService = await readFile(
    new URL('../../deploy/systemd/freebbs-development-backup.service', import.meta.url),
    'utf8',
  );
  const backupTimer = await readFile(
    new URL('../../deploy/systemd/freebbs-development-backup.timer', import.meta.url),
    'utf8',
  );
  const environment = await readFile(
    new URL('../../deploy/env/development.env.example', import.meta.url),
    'utf8',
  );
  const backupEnvironment = await readFile(
    new URL('../../deploy/env/backup.env.example', import.meta.url),
    'utf8',
  );

  assert.match(installer, /install[\s\S]*-m 0755[\s\S]*deploy-release\.sh/);
  assert.match(installer, /if \[\[ ! -e \$target \]\]/);
  assert.match(installer, /root -g root -m 0755 \/opt\/freebbs-development/);
  assert.match(installer, /-m 0640/);
  assert.doesNotMatch(installer, /systemctl\s+(?:start|restart)/);
  assert.match(backupService, /scripts\/backup\.sh/);
  assert.match(backupService, /sha256sum/);
  assert.match(backupTimer, /Persistent=true/);
  assert.match(environment, /DATA_MODE=mysql/);
  assert.match(backupEnvironment, /MYSQL_USER=freebbs_development_backup/);
  assert.doesNotMatch(environment, /ALLOW_(?:DEMO|PRODUCTION)_DEMO_SEED/);
});

test('production data runbook keeps accounts, backups, restore, and Adminer private', async () => {
  const checklist = await readFile(
    new URL('../../docs/production-release-checklist.md', import.meta.url),
    'utf8',
  );
  const data = await readFile(
    new URL('../../docs/data-administration.md', import.meta.url),
    'utf8',
  );
  const server = await readFile(
    new URL('../../docs/server-deployment.md', import.meta.url),
    'utf8',
  );
  const local = await readFile(new URL('../../docs/local-development.md', import.meta.url), 'utf8');
  const combined = `${checklist}\n${data}\n${server}`;

  for (const account of [
    'freebbs_development_app',
    'freebbs_development_migration',
    'freebbs_development_backup',
  ]) {
    assert.match(combined, new RegExp(account));
  }
  for (const migrationPrivilege of [
    'CREATE TEMPORARY TABLES',
    'CREATE ROUTINE',
    'ALTER ROUTINE',
    'EXECUTE',
  ]) {
    assert.ok(
      data.includes(migrationPrivilege),
      `missing migration privilege: ${migrationPrivilege}`,
    );
  }
  for (const command of [
    'systemctl enable --now freebbs-development-backup.timer',
    'sha256sum --check',
    'age -r "$BACKUP_RECIPIENT"',
    'http://127.0.0.1:3100/api/development/v1/health',
    'http://127.0.0.1:3100/api/development/v1/ready',
    'npm run db:migrate',
    '--setenv=NODE_ENV=production',
    'npm run admin:bootstrap --',
    'ssh -N -L 127.0.0.1:18081:127.0.0.1:8081',
  ]) {
    assert.ok(combined.includes(command), `missing production command: ${command}`);
  }
  assert.match(combined, /encrypted[\s\S]*off-host/i);
  assert.match(combined, /restore drill/i);
  assert.match(combined, /Adminer[\s\S]*127\.0\.0\.1/);
  assert.match(checklist, /expand\/contract[\s\S]*当前运行版本/);
  assert.match(checklist, /断网隔离[\s\S]*mysqldump --databases/);
  assert.doesNotMatch(checklist, /free_bbs_development_restore/);
  assert.doesNotMatch(checklist, /docker compose --profile adminer/);
  assert.match(checklist, /--network host[\s\S]*php -S 127\.0\.0\.1:8081/);
  assert.match(checklist, /\.release-sha[\s\S]*PREVIOUS_RELEASE_SHA/);
  assert.match(checklist, /FIRST_RELEASE_EMPTY_DB/);
  assert.match(checklist, /sudo -i[\s\S]*umask 077[\s\S]*age -r/);
  assert.match(checklist, /release approval[\s\S]*待审批/);
  assert.ok(
    checklist.indexOf('## 8. 发布后冒烟与首次管理员初始化') <
      checklist.indexOf('npm run admin:bootstrap --'),
    'bootstrap must occur only after the release and initial smoke section',
  );
  assert.match(checklist, /--rollback-to "\$PREVIOUS_RELEASE_SHA"/);
  assert.doesNotMatch(server, /install[^\n]*\/dev\/null[\s\S]{0,120}development\.env/);
  assert.doesNotMatch(server, /rsync[^\n]*--delete/);
  assert.doesNotMatch(`${server}\n${data}`, /docker compose --profile adminer/);
  assert.match(local, /memory \+ demo[\s\S]*(?:only|仅)[\s\S]*(?:local|本地)/i);
  assert.match(local, /production[\s\S]*(?:never|不得)[\s\S]*db:seed/i);
});

test('demo seed leaves highest authority to the guarded bootstrap workflow', async () => {
  const seed = await readFile(
    new URL('../../database/seeds/001_demo.sql', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(seed, /'demo-admin'\s*,\s*'platform\.super_admin'/);
});
