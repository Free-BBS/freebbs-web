const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const accountPattern = /^[a-z_][a-z0-9_-]*[$]?$/i;
const servicePattern = /^[a-z0-9][a-z0-9_.@-]*$/i;
const quote = (value) => `'${value.replace(/'/g, "'\\''")}'`;
const permissions = (value) =>
  (value[0] === 'r' ? 4 : 0) + (value[1] === 'w' ? 2 : 0) + (value[2] === 'x' ? 1 : 0);
const maskedPermissions = (value, mask) =>
  [4, 2, 1]
    .filter((bit) => Math.floor(value / bit) % 2 && Math.floor(mask / bit) % 2)
    .reduce((sum, bit) => sum + bit, 0);

// Only this default directory is eligible. No environment file or storage override is read.
function provisionBannerStorage(settings, dependencies = {}) {
  const disk = dependencies.fs || fs;
  const run = dependencies.run || ((file, args) => spawnSync(file, args, { encoding: 'utf8' }));
  const deployerUid = dependencies.uid ?? process.getuid();
  const systemctl = settings.systemctl || '/usr/bin/systemctl';
  const sudo = settings.sudo || '/usr/bin/sudo';
  const { deployDir } = settings;
  const service = settings.service || 'free-bbs-backend';
  if (
    typeof deployDir !== 'string' ||
    !path.posix.isAbsolute(deployDir) ||
    path.posix.resolve(deployDir) !== deployDir ||
    deployDir === '/' ||
    [...deployDir].some((character) => character.charCodeAt(0) < 32) ||
    !servicePattern.test(service)
  ) {
    throw new Error('Invalid deployment directory or backend service name');
  }
  const target = path.posix.join(deployDir, 'database/banner-reactions-private');
  let manual = '';
  const command = (file, args) => {
    const result = run(file, args);
    if (result.status !== 0) {
      throw new Error(
        `Cannot verify ${path.posix.basename(file)}${manual ? `. No project synchronization performed. Bounded setup: ${manual}` : ''}`,
      );
    }
    return String(result.stdout || '').trim();
  };
  const properties = Object.fromEntries(
    command(systemctl, [
      'show',
      service,
      '--property=LoadState,User,Group,SupplementaryGroups,DynamicUser',
    ])
      .split('\n')
      .map((line) => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator), line.slice(separator + 1).trim()];
      }),
  );
  const user = properties.User;
  if (
    properties.LoadState !== 'loaded' ||
    properties.DynamicUser === 'yes' ||
    !accountPattern.test(user || '') ||
    user === 'root'
  ) {
    throw new Error('Backend must have a loaded, stable, non-root service account');
  }
  const uid = Number(command('/usr/bin/id', ['-u', '--', user]));
  const primaryGroup = command('/usr/bin/id', ['-gn', '--', user]);
  if (!Number.isSafeInteger(uid) || uid <= 0 || !accountPattern.test(primaryGroup)) {
    throw new Error('Cannot verify backend account identity');
  }
  manual = `sudo /usr/bin/install -d -o ${user} -g ${primaryGroup} -m 0700 ${quote(target)}`;
  const fail = (message) => {
    throw new Error(`${message}. No project synchronization performed. Bounded setup: ${manual}`);
  };
  const groupIds = new Set(command('/usr/bin/id', ['-G', '--', user]).split(/\s+/).map(Number));
  const accountGid = Number(command('/usr/bin/id', ['-g', '--', user]));
  if (properties.Group) groupIds.delete(accountGid);
  const configuredGroups = [
    properties.Group,
    ...(properties.SupplementaryGroups || '').split(/\s+/),
  ];
  for (const group of configuredGroups.filter(Boolean)) {
    if (!accountPattern.test(group)) fail('Unexpected backend group identity');
    const row = command('/usr/bin/getent', ['group', group]).split(':');
    const gid = Number(row[2]);
    if (row[0] !== group || !Number.isSafeInteger(gid) || gid < 0)
      fail('Cannot verify backend group');
    groupIds.add(gid);
  }
  if ([...groupIds].some((gid) => !Number.isSafeInteger(gid) || gid < 0)) {
    fail('Cannot verify backend group IDs');
  }
  const getfacl = ['/usr/bin/getfacl', '/bin/getfacl'].find((file) => disk.existsSync(file));
  const setfacl = ['/usr/bin/setfacl', '/bin/setfacl'].find((file) => disk.existsSync(file));
  const metadata = (directory, optional = false) => {
    let stat;
    try {
      stat = disk.lstatSync(directory);
    } catch (error) {
      if (optional && error.code === 'ENOENT') return null;
      fail(`Cannot inspect directory ${directory}`);
    }
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      disk.realpathSync(directory) !== directory
    ) {
      fail(`Refusing unexpected directory or symlink ${directory}`);
    }
    let entries;
    if (getfacl) {
      const acl = command(getfacl, ['--absolute-names', '--numeric', '--', directory]);
      entries = acl
        .split('\n')
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => {
          const fields = line.split(/\s+#/)[0].split(':');
          const isDefault = fields[0] === 'default';
          if (isDefault) fields.shift();
          if (
            fields.length !== 3 ||
            !['user', 'group', 'mask', 'other'].includes(fields[0]) ||
            !/^[r-][w-][x-]$/.test(fields[2]) ||
            (fields[1] && !/^\d+$/.test(fields[1]))
          ) {
            fail(`Unrecognized ACL on ${directory}`);
          }
          return { kind: fields[0], id: fields[1], bits: permissions(fields[2]), isDefault };
        });
    } else {
      // A '+' means an extended ACL: mode bits alone cannot establish effective access.
      const listing = command('/usr/bin/ls', ['-ldn', '--', directory]).split(/\s+/)[0];
      if (!/^d[rwxstST-]{9}[.]?$/.test(listing))
        fail(`ACL inspection is required for ${directory}`);
      entries = [
        { kind: 'user', id: '', bits: Math.floor(stat.mode / 64) % 8 },
        { kind: 'group', id: '', bits: Math.floor(stat.mode / 8) % 8 },
        { kind: 'other', id: '', bits: stat.mode % 8 },
      ];
    }
    return { stat, entries };
  };
  const access = ({ stat, entries }) => {
    const base = entries.filter((entry) => !entry.isDefault);
    const find = (kind, id = '') =>
      base.find((entry) => entry.kind === kind && entry.id === id)?.bits;
    const mask = find('mask') ?? 7;
    if (stat.uid === uid) return find('user') ?? 0;
    const named = find('user', String(uid));
    if (named !== undefined) return maskedPermissions(named, mask);
    const matches = base.filter(
      (entry) => entry.kind === 'group' && groupIds.has(entry.id ? Number(entry.id) : stat.gid),
    );
    if (matches.length)
      return maskedPermissions(
        matches.reduce((bits, entry) => bits + entry.bits - maskedPermissions(bits, entry.bits), 0),
        mask,
      );
    return find('other') ?? 0;
  };
  const isPrivateWritable = (info) => {
    const mask = info.entries.find((entry) => !entry.isDefault && entry.kind === 'mask')?.bits ?? 7;
    return (
      [uid, deployerUid].includes(info.stat.uid) &&
      access(info) === 7 &&
      !info.entries.some((entry) => {
        if (entry.isDefault) return true;
        if (entry.kind === 'other') return entry.bits !== 0;
        if (entry.kind === 'group') return maskedPermissions(entry.bits, mask) !== 0;
        return (
          entry.kind === 'user' &&
          entry.id &&
          ![uid, deployerUid].includes(Number(entry.id)) &&
          maskedPermissions(entry.bits, mask) !== 0
        );
      })
    );
  };
  // Inspect every ancestor before any creation. Never follow an alias into another tree.
  const segments = deployDir.split('/').filter(Boolean);
  let ancestor = '/';
  let deployment;
  for (const segment of ['', ...segments]) {
    ancestor = path.posix.join(ancestor, segment);
    deployment = metadata(ancestor);
    if (access(deployment) % 2 !== 1) fail(`Backend cannot traverse ${ancestor}`);
  }
  const sameDirectory = (left, right) =>
    left.stat.dev === right.stat.dev &&
    left.stat.ino === right.stat.ino &&
    left.stat.uid === right.stat.uid;
  const databaseDir = path.posix.dirname(target);
  let database = metadata(databaseDir, true);
  if (!database) {
    if (deployment.stat.uid !== deployerUid)
      fail('Deployment root is not owned by the deployment account');
    let created = false;
    try {
      disk.mkdirSync(databaseDir, { mode: 0o755 });
      created = true;
    } catch (error) {
      if (error.code !== 'EEXIST') fail('Cannot create the fixed database parent directory');
    }
    if (!sameDirectory(deployment, metadata(deployDir)))
      fail('Deployment root changed during parent creation');
    database = metadata(databaseDir);
    if (database.stat.uid !== deployerUid)
      fail('Database parent is not owned by the deployment account');
    if (created) {
      // Set the new SQL/source parent independently of umask. An open directory handle
      // prevents a path replacement from redirecting chmod onto another object.
      let descriptor;
      try {
        descriptor = disk.openSync(
          databaseDir,
          fs.constants.O_RDONLY + (fs.constants.O_DIRECTORY || 0) + (fs.constants.O_NOFOLLOW || 0),
        );
        const opened = disk.fstatSync(descriptor);
        if (!opened.isDirectory() || !sameDirectory(database, { stat: opened }))
          fail('Database parent changed before permission setup');
        disk.fchmodSync(descriptor, 0o755);
      } catch (error) {
        fail(`Cannot verify or set new database parent permissions: ${error.message}`);
      } finally {
        if (descriptor !== undefined) disk.closeSync(descriptor);
      }
      const verified = metadata(databaseDir);
      if (!sameDirectory(database, verified))
        fail('Database parent changed during permission setup');
      database = verified;
    }
  }
  if (access(database) % 2 !== 1) fail(`Backend cannot traverse ${databaseDir}`);
  const existing = metadata(target, true);
  if (existing) {
    if (!isPrivateWritable(existing))
      fail(`Existing storage is not demonstrably private and backend-writable: ${target}`);
    return { target, user, method: 'preserved' };
  }
  const installArgs = [
    '/usr/bin/install',
    '-d',
    '-o',
    user,
    '-g',
    primaryGroup,
    '-m',
    '0700',
    target,
  ];
  if (run(sudo, ['-n', '-k', '-l', ...installArgs]).status === 0) {
    command(sudo, ['-n', ...installArgs]);
    if (!isPrivateWritable(metadata(target)))
      fail('Provisioned storage permissions did not verify');
    return { target, user, method: 'install' };
  }
  if (!getfacl || !setfacl) fail('Exact install authorization or existing ACL tools are required');
  // ACL fallback is exclusively for a newly created, deployment-owned directory.
  try {
    disk.mkdirSync(target, { mode: 0o700 });
  } catch {
    fail('Cannot create the fixed private storage directory');
  }
  const created = metadata(target);
  if (created.stat.uid !== deployerUid) fail('New storage is not owned by the deployment account');
  command(setfacl, ['--remove-all', '--remove-default', '--', target]);
  try {
    disk.chmodSync(target, 0o700);
  } catch {
    fail('Cannot set permissions on the new private storage directory');
  }
  command(setfacl, [`--modify=user:${uid}:rwx,mask::rwx`, '--', target]);
  if (!isPrivateWritable(metadata(target))) fail('New storage ACL did not verify');
  return { target, user, method: 'acl' };
}

if (require.main === module) {
  try {
    const [deployDir, service, systemctl, sudo] = process.argv.slice(2);
    const result = provisionBannerStorage({ deployDir, service, systemctl, sudo });
    console.log(
      `[deploy] banner reaction storage ${result.method}: ${result.target} (backend ${result.user})`,
    );
  } catch (error) {
    console.error(`[deploy] banner storage preflight failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { provisionBannerStorage };
