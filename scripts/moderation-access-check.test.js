const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const {
  settingsFromEnvironment,
  collectAccessReport,
  remoteProgram,
  runInspection,
} = require('./moderation-access-check');

const settings = settingsFromEnvironment({ DEPLOY_HOST: 'example.invalid', DEPLOY_USER: 'deploy' });
const identity = { uid: 1001, gid: 1001, groups: [1001, 1100] };
function fixture() {
  const calls = [];
  const fs = {
    async lstat(file) {
      if (file.endsWith('moderation-private'))
        throw Object.assign(new Error('not present'), { code: 'ENOENT' });
      return {
        uid: 1001,
        gid: 1100,
        mode: file.endsWith('.env') ? 0o100640 : 0o40750,
        isSymbolicLink: () => false,
        isDirectory: () => !file.endsWith('.env'),
        isFile: () => file.endsWith('.env'),
      };
    },
    async realpath(file) {
      return file;
    },
    async access(file, mode) {
      if (file.endsWith('.env') && mode === 2)
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
    },
  };
  const run = (binary, args, options) => {
    calls.push({ binary, args, options });
    return {
      status: 0,
      stdout: binary.endsWith('sudo')
        ? 'DO NOT LOG SUDO POLICY'
        : 'LoadState=loaded\nActiveState=active\nUser=freebbs-backend\nGroup=freebbs-agent-config\nWorkingDirectory=/data/www/free-BBS\nEnvironment=DO NOT LOG SECRET\nExecStart=DO NOT LOG COMMAND\n',
      stderr: 'DO NOT LOG STDERR',
    };
  };
  return { fs, run, identity, calls };
}

test('connection validation rejects shell/SSH option injection and invalid ports before SSH', () => {
  for (const env of [
    { DEPLOY_HOST: '-oProxyCommand=evil' },
    { DEPLOY_HOST: 'host;id' },
    { DEPLOY_USER: 'deploy\nid' },
    { DEPLOY_USER: '-lroot' },
    { DEPLOY_PORT: '0' },
    { DEPLOY_PORT: '65536' },
    { DEPLOY_PORT: '22;id' },
    { BACKEND_SERVICE_NAME: '--all' },
    { BACKEND_SERVICE_NAME: 'backend;id' },
    { DEPLOY_PATH: '/tmp/../etc' },
    { DEPLOY_PATH: '/tmp/$(id)' },
    { DEPLOY_PATH: '/tmp/\nsecret' },
    { DEPLOY_PATH: '/' },
  ])
    assert.throws(
      () =>
        settingsFromEnvironment({ DEPLOY_HOST: 'example.invalid', DEPLOY_USER: 'deploy', ...env }),
      /Invalid deployment/,
    );
  assert.deepEqual(
    settingsFromEnvironment({ DEPLOY_HOST: '127.0.0.1', DEPLOY_USER: 'cbdt', DEPLOY_PORT: '2222' }),
    { ...settings, host: '127.0.0.1', user: 'cbdt', port: '2222' },
  );
});

test('report reads only filesystem metadata and allowlisted service properties, never file contents', async () => {
  const f = fixture();
  const report = await collectAccessReport(settings, f);
  assert.equal(
    report.paths.find((p) => p.path.endsWith('.env')).writableByDeploymentAccount,
    false,
  );
  assert.equal(report.paths.find((p) => p.path.endsWith('.env')).mode, '0640');
  assert.equal(report.paths.find((p) => p.path.endsWith('moderation-private')).state, 'missing');
  assert.equal(report.service.properties.User, 'freebbs-backend');
  assert.equal(report.sudoPolicyQueries.restartBackend, 'query_allowed');
  assert.equal(report.sudoPolicyQueries.commandExecutionTested, false);
  assert.equal(report.backendPrivateStorageAccess, 'not_tested_as_service_user');
  assert.equal(report.actualModerationConfiguration, 'not_read');
  assert.equal(report.productionReadiness, 'not_evaluated');
  assert.doesNotMatch(JSON.stringify(report), /DO NOT LOG|example\.invalid|ExecStart/);
  assert.deepEqual(
    f.calls.map(({ binary, args }) => [binary, args]),
    [
      [
        '/usr/bin/systemctl',
        [
          'show',
          'free-bbs-backend',
          '--property=LoadState,ActiveState,User,Group,SupplementaryGroups,WorkingDirectory,EnvironmentFiles,ProtectSystem,ReadWritePaths,ReadOnlyPaths,InaccessiblePaths,StateDirectory,DynamicUser',
          '--no-pager',
        ],
      ],
      ['/usr/bin/sudo', ['-n', '-k', '-l', '/usr/bin/systemctl', 'restart', 'free-bbs-backend']],
      [
        '/usr/bin/sudo',
        [
          '-n',
          '-k',
          '-l',
          '/usr/bin/systemctl',
          '--no-pager',
          '--full',
          'status',
          'free-bbs-backend',
        ],
      ],
    ],
  );
});

test('unreadable paths and policy/tool failures remain unknown rather than falsely absent or allowed', async () => {
  const f = fixture();
  f.fs.lstat = async () => {
    throw Object.assign(new Error('SECRET exception'), { code: 'EACCES' });
  };
  f.run = () => ({ status: 1, stdout: 'SECRET output', stderr: 'SECRET error' });
  const report = await collectAccessReport(settings, f);
  assert.ok(report.paths.every((p) => p.state === 'unavailable'));
  assert.equal(report.service.query, 'unavailable');
  assert.equal(report.sudoPolicyQueries.restartBackend, 'not_confirmed');
  assert.doesNotMatch(JSON.stringify(report), /SECRET/);
});

test('symlinks and their resolved metadata remain visible rather than treated as plain directories', async () => {
  const f = fixture();
  f.fs.lstat = async () => ({
    uid: 0,
    gid: 0,
    mode: 0o120777,
    isSymbolicLink: () => true,
    isDirectory: () => false,
    isFile: () => false,
  });
  f.fs.realpath = async () => '/different-location';
  const report = await collectAccessReport(settings, f);
  assert.equal(report.paths[0].type, 'symlink');
  assert.equal(report.paths[0].resolvedPath, '/different-location');
  assert.equal(report.paths[0].ownedByDeploymentAccount, false);
});

test('SSH sends the self-contained inspector through stdin with fixed remote command and no upload', () => {
  const report = { reportVersion: 1, readOnly: true };
  let captured;
  assert.deepEqual(
    runInspection(settings, (binary, args, options) => {
      captured = { binary, args, options };
      return { status: 0, stdout: JSON.stringify(report) };
    }),
    report,
  );
  assert.equal(captured.binary, 'ssh');
  assert.ok(captured.args.includes('StrictHostKeyChecking=yes'));
  assert.ok(captured.args.includes('BatchMode=yes'));
  assert.deepEqual(captured.args.slice(-3), ['--', 'deploy@example.invalid', '/usr/bin/node -']);
  assert.equal(captured.options.input, remoteProgram(settings));
  assert.doesNotMatch(
    captured.options.input,
    /example\.invalid|DEPLOY_SSH_KEY|readFile|writeFile|mkdir|chmod|chown/,
  );
});

test('serialized remote code actually executes without importing application code or environment', async () => {
  const f = fixture();
  let output = '';
  const sandbox = {
    require(name) {
      if (name === 'node:fs/promises') return f.fs;
      if (name === 'node:fs') return require('node:fs');
      if (name === 'node:child_process') return { spawnSync: f.run };
      throw new Error(`Unexpected remote dependency: ${name}`);
    },
    process: {
      getuid: () => 1001,
      getgid: () => 1001,
      getgroups: () => [1001],
      versions: { node: '24.0.0' },
      stdout: {
        write: (value) => {
          output += value;
        },
      },
      stderr: { write: () => assert.fail('remote inspector failed') },
    },
  };
  await vm.runInNewContext(remoteProgram(settings), sandbox);
  const report = JSON.parse(output);
  assert.equal(report.reportVersion, 1);
  assert.equal(report.readOnly, true);
  assert.equal(f.calls.length, 3);
});

test('SSH failures and invalid JSON never echo raw server output or secrets', () => {
  for (const result of [
    { status: 255, stdout: 'SECRET', stderr: 'SECRET' },
    { status: 0, stdout: 'SECRET login banner' },
    { status: 0, stdout: '{}' },
    { status: 0, stdout: '{"readOnly":false,"reportVersion":1}' },
  ])
    assert.throws(
      () => runInspection(settings, () => result),
      (error) => !error.message.includes('SECRET'),
    );
});

test('workflow is manual, main-only, uses least token permissions and does not execute a deploy', () => {
  const workflow = readFileSync(
    path.join(__dirname, '../.github/workflows/moderation-access-check.yml'),
    'utf8',
  );
  assert.match(workflow, /on:\s+workflow_dispatch:/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /permissions:\s+contents: read/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /node --test scripts\/moderation-access-check\.test\.js/);
  assert.doesNotMatch(
    workflow,
    /pull_request_target|\n\s+(push|pull_request|schedule):|deploy\.sh|rsync|systemctl|sudo|secrets\.(?!DEPLOY_HOST|DEPLOY_USER|DEPLOY_SSH_KEY)/,
  );
});
