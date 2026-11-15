const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { provisionBannerStorage } = require('./provision-banner-storage');

const target = '/srv/free-BBS/database/banner-reactions-private';
const settings = { deployDir: '/srv/free-BBS' };
const basic = 'user::rwx\ngroup::---\nother::---';
const acl = `${basic}\nuser:2000:rwx\nmask::rwx`;

function fixture(options = {}) {
  const calls = [];
  const mutations = [];
  const directories = new Map(
    ['/', '/srv', '/srv/free-BBS', '/srv/free-BBS/database'].map((directory) => [
      directory,
      { uid: 1014, gid: 1014, mode: 0o40755, acl: 'user::rwx\ngroup::r-x\nother::r-x' },
    ]),
  );
  if (options.existing) directories.set(target, { gid: 2000, ...options.existing });
  const disk = {
    existsSync(file) {
      return options.tools !== false && ['/usr/bin/getfacl', '/usr/bin/setfacl'].includes(file);
    },
    lstatSync(file) {
      const info = directories.get(file);
      if (!info) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return { ...info, isDirectory: () => !info.file, isSymbolicLink: () => !!info.symlink };
    },
    realpathSync: (file) => directories.get(file).realpath || file,
    mkdirSync(file, flags) {
      assert.equal(file, target);
      assert.deepEqual(flags, { mode: 0o700 });
      assert.equal(directories.has(file), false);
      mutations.push(['mkdir', file]);
      directories.set(file, { uid: 1014, gid: 1014, mode: 0o40700, acl: basic });
    },
    chmodSync(file, mode) {
      mutations.push(['chmod', file, mode]);
      directories.get(file).mode = 0o40000 + mode;
    },
  };
  const run = (file, args) => {
    calls.push([file, args]);
    const ok = (stdout = '') => ({ status: 0, stdout });
    if (file === '/usr/bin/systemctl') {
      return ok(
        `LoadState=loaded\nUser=${options.user || 'freebbs-backend'}\nGroup=freebbs-agent-config\nSupplementaryGroups=freebbs-backend\nDynamicUser=no`,
      );
    }
    if (file === '/usr/bin/id') {
      return ok({ '-u': '2000', '-gn': 'freebbs-backend', '-G': '2000', '-g': '2000' }[args[0]]);
    }
    if (file === '/usr/bin/getent')
      return ok(`${args[1]}:x:${args[1] === 'freebbs-backend' ? 2000 : 3000}:`);
    if (file === '/usr/bin/getfacl') return ok(directories.get(args.at(-1)).acl);
    if (file === '/usr/bin/ls') {
      const info = directories.get(args.at(-1));
      return ok(
        `${info.uid === 2000 ? 'drwx------' : 'drwxr-xr-x'} 2 ${info.uid} ${info.gid} 4096 ...`,
      );
    }
    if (file === '/usr/bin/sudo') {
      if (args.includes('-l')) return { status: options.sudo ? 0 : 1 };
      assert.equal(options.sudo, true, 'install requires successful exact authorization query');
      mutations.push(['install', ...args]);
      directories.set(target, { uid: 2000, gid: 2000, mode: 0o40700, acl: basic });
      return ok();
    }
    if (file === '/usr/bin/setfacl') {
      mutations.push(['setfacl', ...args]);
      if (options.aclFailure) return { status: 1 };
      directories.get(target).acl = args[0].startsWith('--modify') ? acl : basic;
      if (args[0].startsWith('--modify')) directories.get(target).mode = 0o40770;
      return ok();
    }
    throw new Error(`Unexpected command ${file}`);
  };
  return { calls, mutations, directories, dependencies: { fs: disk, run, uid: 1014 } };
}

test('preserves a private service-owned directory without changing permissions or querying sudo', () => {
  const state = fixture({ existing: { uid: 2000, mode: 0o40700, acl: basic } });
  assert.equal(provisionBannerStorage(settings, state.dependencies).method, 'preserved');
  assert.deepEqual(state.mutations, []);
  assert.equal(
    state.calls.some(([file]) => file.includes('sudo')),
    false,
  );
});

test('preserves deployment-owned ACL storage despite mode0770 mask bits', () => {
  const state = fixture({ existing: { uid: 1014, gid: 1014, mode: 0o40770, acl } });
  assert.equal(provisionBannerStorage(settings, state.dependencies).method, 'preserved');
  assert.deepEqual(state.mutations, []);
});

test('queries the exact install command and executes only that bounded authorized command', () => {
  const state = fixture({ sudo: true });
  assert.equal(provisionBannerStorage(settings, state.dependencies).method, 'install');
  const install = [
    '/usr/bin/install',
    '-d',
    '-o',
    'freebbs-backend',
    '-g',
    'freebbs-backend',
    '-m',
    '0700',
    target,
  ];
  assert.deepEqual(
    state.calls.filter(([file]) => file.includes('sudo')),
    [
      ['/usr/bin/sudo', ['-n', '-k', '-l', ...install]],
      ['/usr/bin/sudo', ['-n', ...install]],
    ],
  );
  assert.equal(state.mutations.length, 1);
});

test('new-directory fallback clears inherited ACL then grants only the backend UID', () => {
  const state = fixture();
  assert.equal(provisionBannerStorage(settings, state.dependencies).method, 'acl');
  assert.deepEqual(state.mutations, [
    ['mkdir', target],
    ['setfacl', '--remove-all', '--remove-default', '--', target],
    ['chmod', target, 0o700],
    ['setfacl', '--modify=user:2000:rwx,mask::rwx', '--', target],
  ]);
});

test('without an exact install grant or ACL tools, fails before any directory creation', () => {
  const state = fixture({ tools: false });
  assert.throws(
    () => provisionBannerStorage(settings, state.dependencies),
    /Bounded setup: sudo \/usr\/bin\/install -d -o freebbs-backend -g freebbs-backend -m 0700 '\/srv\/free-BBS\/database\/banner-reactions-private'/,
  );
  assert.deepEqual(state.mutations, []);
});

test('basic private service ownership can be verified without ACL utilities', () => {
  const state = fixture({ tools: false, existing: { uid: 2000, mode: 0o40700, acl: basic } });
  assert.equal(provisionBannerStorage(settings, state.dependencies).method, 'preserved');
});

for (const bad of [
  { uid: 1014, mode: 0o40700, acl: basic },
  { uid: 2000, mode: 0o40775, acl: 'user::rwx\ngroup::rwx\nother::r-x' },
  { uid: 2000, mode: 0o40770, acl: `${acl}\nuser:9999:rwx` },
  {
    uid: 2000,
    mode: 0o40700,
    acl: `${basic}\ndefault:user::rwx\ndefault:group::---\ndefault:other::---`,
  },
]) {
  test(`rejects existing unknown, inaccessible, shared or inheriting storage (${JSON.stringify(bad)})`, () => {
    const state = fixture({ existing: bad });
    assert.throws(
      () => provisionBannerStorage(settings, state.dependencies),
      /Existing storage is not demonstrably private/,
    );
    assert.deepEqual(state.mutations, []);
  });
}

for (const directory of ['/srv/free-BBS', '/srv/free-BBS/database', target]) {
  test(`rejects symlink at ${directory} before mutation`, () => {
    const state = fixture({ existing: { uid: 2000, mode: 0o40700, acl: basic } });
    state.directories.get(directory).symlink = true;
    assert.throws(
      () => provisionBannerStorage(settings, state.dependencies),
      /unexpected directory or symlink/,
    );
    assert.deepEqual(state.mutations, []);
  });
}

test('backend ancestor traversal uses the effective named-user ACL, not misleading other bits', () => {
  const state = fixture();
  state.directories.get('/srv/free-BBS/database').acl += '\nuser:2000:---\nmask::r-x';
  assert.throws(
    () => provisionBannerStorage(settings, state.dependencies),
    /Backend cannot traverse/,
  );
  assert.deepEqual(state.mutations, []);
});

test('failed ACL provisioning stops instead of reporting storage ready', () => {
  const state = fixture({ aclFailure: true });
  assert.throws(
    () => provisionBannerStorage(settings, state.dependencies),
    /Cannot verify setfacl/,
  );
  assert.equal(
    state.mutations.some(([kind]) => kind === 'install'),
    false,
  );
});

test('rejects unsafe service accounts and noncanonical deployment roots before writes', () => {
  const state = fixture({ user: 'root' });
  assert.throws(() => provisionBannerStorage(settings, state.dependencies), /stable, non-root/);
  for (const deployDir of ['/', '/srv/../etc', 'relative', '/srv/\nother']) {
    assert.throws(
      () => provisionBannerStorage({ ...settings, deployDir }, state.dependencies),
      /Invalid deployment directory/,
    );
  }
  assert.deepEqual(state.mutations, []);
});

test('deployment preflight runs before rsync and its tests are executed in CI', () => {
  const deploy = fs.readFileSync(path.join(__dirname, 'deploy.sh'), 'utf8');
  const ci = fs.readFileSync(path.join(__dirname, 'ci-validate.sh'), 'utf8');
  const preflight = deploy.indexOf('"$ROOT_DIR/scripts/provision-banner-storage.js"');
  assert.ok(preflight >= 0 && preflight < deploy.indexOf('rsync -a --delete'));
  assert.match(ci, /node --test [^\r\n]*scripts\/provision-banner-storage\.test\.js/);
  const helper = fs.readFileSync(path.join(__dirname, 'provision-banner-storage.js'), 'utf8');
  assert.doesNotMatch(helper, /readFileSync|recursive\s*:|chmodSync\([^\n]*0o777|usermod|gpasswd/);
});
