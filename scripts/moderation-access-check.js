const { spawnSync } = require('node:child_process');

function settingsFromEnvironment(env = process.env) {
  const settings = {
    host: env.DEPLOY_HOST || '',
    port: env.DEPLOY_PORT || '22',
    user: env.DEPLOY_USER || '',
    service: env.BACKEND_SERVICE_NAME || 'free-bbs-backend',
    deployPath: env.DEPLOY_PATH || '/data/www/free-BBS',
  };
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(settings.host) ||
    settings.host.length > 253 ||
    !/^[a-z_][a-z0-9_-]*\$?$/.test(settings.user) ||
    settings.user.length > 64 ||
    !/^\d{1,5}$/.test(settings.port) ||
    Number(settings.port) < 1 ||
    Number(settings.port) > 65535 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_.@:-]*$/.test(settings.service) ||
    settings.service.length > 128 ||
    !/^\/[a-zA-Z0-9_/ .-]+$/.test(settings.deployPath) ||
    settings.deployPath.length > 512 ||
    settings.deployPath.split('/').some((part) => part === '..' || part === '.')
  ) {
    throw new Error('Invalid deployment connection settings; values were not printed');
  }
  return settings;
}

// Sent over SSH stdin, not installed on the server. All remote operations are metadata reads.
// Keep this function self-contained: never load backend modules or read environment-file contents.
async function collectAccessReport(settings, dependencies = {}) {
  const fs = dependencies.fs || require('node:fs/promises');
  const { constants } = require('node:fs');
  const run = dependencies.run || require('node:child_process').spawnSync;
  const identity = dependencies.identity || {
    uid: process.getuid(),
    gid: process.getgid(),
    groups: process.getgroups(),
  };
  const checkedEnvironmentFile = '/etc/free-bbs/free-bbs.env';
  const plannedPrivateDirectory = '/var/lib/free-bbs/moderation-private';
  async function accessible(path, mode) {
    try {
      await fs.access(path, mode);
      return true;
    } catch {
      return false;
    }
  }
  async function inspectPath(path) {
    try {
      const stat = await fs.lstat(path);
      let resolvedPath = null;
      try {
        resolvedPath = await fs.realpath(path);
      } catch {
        /* Broken link or inaccessible ancestor. */
      }
      let type = 'other';
      if (stat.isSymbolicLink()) type = 'symlink';
      else if (stat.isDirectory()) type = 'directory';
      else if (stat.isFile()) type = 'file';
      return {
        path,
        state: 'present',
        type,
        ownerUid: stat.uid,
        groupGid: stat.gid,
        mode: (stat.mode % 4096).toString(8).padStart(4, '0'),
        ownedByDeploymentAccount: stat.uid === identity.uid,
        resolvedPath,
        readableByDeploymentAccount: await accessible(path, constants.R_OK),
        writableByDeploymentAccount: await accessible(path, constants.W_OK),
        searchableByDeploymentAccount: stat.isDirectory()
          ? await accessible(path, constants.X_OK)
          : null,
      };
    } catch (error) {
      return { path, state: error.code === 'ENOENT' ? 'missing' : 'unavailable' };
    }
  }
  const properties = [
    'LoadState',
    'ActiveState',
    'User',
    'Group',
    'SupplementaryGroups',
    'WorkingDirectory',
    'EnvironmentFiles',
    'ProtectSystem',
    'ReadWritePaths',
    'ReadOnlyPaths',
    'InaccessiblePaths',
    'StateDirectory',
    'DynamicUser',
  ];
  const serviceResult = run(
    '/usr/bin/systemctl',
    ['show', settings.service, `--property=${properties.join(',')}`, '--no-pager'],
    {
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 65536,
      env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
    },
  );
  const service = { name: settings.service, query: 'unavailable', properties: {} };
  if (serviceResult.status === 0 && !serviceResult.error) {
    service.query = 'completed';
    for (const line of String(serviceResult.stdout || '').split('\n')) {
      const separator = line.indexOf('=');
      const name = line.slice(0, separator);
      const value = line.slice(separator + 1);
      if (
        properties.includes(name) &&
        value.length <= 2048 &&
        !Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
      ) {
        service.properties[name] = value;
      }
    }
  }
  function querySudo(command) {
    // -k together with -l ignores a cached credential for this query. No command is executed.
    const result = run('/usr/bin/sudo', ['-n', '-k', '-l', '/usr/bin/systemctl', ...command], {
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 65536,
      env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
    });
    return result.status === 0 && !result.error ? 'query_allowed' : 'not_confirmed';
  }
  const paths = [];
  for (const path of [
    '/',
    '/etc',
    '/etc/free-bbs',
    checkedEnvironmentFile,
    '/var',
    '/var/lib',
    '/var/lib/free-bbs',
    plannedPrivateDirectory,
    settings.deployPath,
  ]) {
    paths.push(await inspectPath(path));
  }
  return {
    reportVersion: 1,
    readOnly: true,
    deploymentIdentity: identity,
    nodeVersion: process.versions.node,
    checkedEnvironmentFile,
    plannedPrivateDirectory,
    service,
    paths,
    sudoPolicyQueries: {
      restartBackend: querySudo(['restart', settings.service]),
      statusBackend: querySudo(['--no-pager', '--full', 'status', settings.service]),
      commandExecutionTested: false,
    },
    backendPrivateStorageAccess: 'not_tested_as_service_user',
    actualModerationConfiguration: 'not_read',
    productionReadiness: 'not_evaluated',
  };
}

function remoteProgram(settings) {
  const remoteSettings = { service: settings.service, deployPath: settings.deployPath };
  return (
    `(${collectAccessReport.toString()})(${JSON.stringify(remoteSettings)})\n` +
    '.then(report => process.stdout.write(JSON.stringify(report, null, 2) + "\\n"))\n' +
    '.catch(() => { process.stderr.write("Read-only inspection could not complete\\n"); process.exitCode = 1; });\n'
  );
}

function runInspection(settings, run = spawnSync) {
  const result = run(
    'ssh',
    [
      '-T',
      '-o',
      'BatchMode=yes',
      '-o',
      'StrictHostKeyChecking=yes',
      '-o',
      'ConnectTimeout=15',
      '-o',
      'ConnectionAttempts=1',
      '-o',
      'ServerAliveInterval=15',
      '-o',
      'ServerAliveCountMax=2',
      '-p',
      settings.port,
      '--',
      `${settings.user}@${settings.host}`,
      '/usr/bin/node -',
    ],
    { input: remoteProgram(settings), encoding: 'utf8', timeout: 90000, maxBuffer: 262144 },
  );
  if (result.status !== 0 || result.error) {
    throw new Error('Read-only SSH inspection failed; raw SSH output was withheld');
  }
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error('Read-only SSH inspection did not return a JSON report');
  }
  if (report.reportVersion !== 1 || report.readOnly !== true)
    throw new Error('Unexpected inspection report');
  return report;
}

if (require.main === module) {
  try {
    const settings = settingsFromEnvironment();
    if (process.argv.length === 3 && process.argv[2] === '--validate-inputs') {
      console.log('Deployment input validation passed');
    } else if (process.argv.length === 2) {
      console.log(JSON.stringify(runInspection(settings), null, 2));
    } else {
      throw new Error('Unsupported arguments');
    }
  } catch (error) {
    // Only the fixed messages above reach this handler; remote command output is never included.
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { settingsFromEnvironment, collectAccessReport, remoteProgram, runInspection };
