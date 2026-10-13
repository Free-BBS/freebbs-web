const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { spawnSync } = require('node:child_process');

const helperPath = path.join(__dirname, 'map-bridge-configure.js');
const filename = '.development-map-token.sha256';
const digest = 'a'.repeat(64);
const replacement = 'b'.repeat(64);
const stream = (value) => Readable.from([Buffer.from(value)]);

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(__dirname, '.map-config-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('the configuration helper exists', async () => {
  assert.equal(
    await fs.access(helperPath).then(
      () => true,
      () => false,
    ),
    true,
  );
});

test('first install and replacement only update the verifier file', async (t) => {
  const { installVerifier } = require('./map-bridge-configure');
  const directory = await fixture(t);
  await fs.writeFile(path.join(directory, 'existing.txt'), 'keep');
  await installVerifier(directory, stream(`${digest}\n`));
  assert.equal(await fs.readFile(path.join(directory, filename), 'utf8'), `${digest}\n`);
  if (process.platform !== 'win32') {
    // eslint-disable-next-line no-bitwise -- inspect native filesystem permission bits
    assert.equal((await fs.stat(path.join(directory, filename))).mode & 0o777, 0o644);
  }
  await installVerifier(directory, stream(replacement));
  assert.equal(await fs.readFile(path.join(directory, filename), 'utf8'), `${replacement}\n`);
  assert.deepEqual((await fs.readdir(directory)).sort(), [filename, 'existing.txt'].sort());
  assert.equal(await fs.readFile(path.join(directory, 'existing.txt'), 'utf8'), 'keep');
});

test('malformed and oversized input preserve an existing verifier without temporary files', async (t) => {
  const { installVerifier } = require('./map-bridge-configure');
  const directory = await fixture(t);
  await fs.writeFile(path.join(directory, filename), `${digest}\n`);
  for (const invalid of [
    '',
    'A'.repeat(64),
    'a'.repeat(63),
    `${digest}\nextra`,
    `${digest}\r\n`,
    'a'.repeat(100000),
  ]) {
    await assert.rejects(installVerifier(directory, stream(invalid)));
    assert.equal(await fs.readFile(path.join(directory, filename), 'utf8'), `${digest}\n`);
    assert.deepEqual(await fs.readdir(directory), [filename]);
  }
  let consumed = 0;
  async function* oversized() {
    consumed += 1;
    yield Buffer.alloc(66, 97);
    consumed += 1;
    yield Buffer.alloc(100000, 97);
  }
  await assert.rejects(installVerifier(directory, oversized()));
  assert.equal(consumed, 1, 'input must stop once the digest bound is exceeded');
});

test('failed atomic replacement preserves the old file and removes temporary data', async (t) => {
  const { installVerifier } = require('./map-bridge-configure');
  const directory = await fixture(t);
  await fs.writeFile(path.join(directory, filename), `${digest}\n`);
  const failingFs = {
    ...fs,
    rename: async () => {
      throw new Error('simulated rename failure');
    },
  };
  await assert.rejects(installVerifier(directory, stream(replacement), failingFs));
  assert.equal(await fs.readFile(path.join(directory, filename), 'utf8'), `${digest}\n`);
  assert.deepEqual(await fs.readdir(directory), [filename]);
});

test('an exclusive-open collision never removes a file the writer did not create', async (t) => {
  const { installVerifier } = require('./map-bridge-configure');
  const directory = await fixture(t);
  let collision;
  const collidingFs = {
    ...fs,
    open: async (candidate, ...args) => {
      if (args[0] !== 'wx') return fs.open(candidate, ...args);
      collision = candidate;
      await fs.writeFile(candidate, 'owned by another process');
      const error = new Error('exclusive open collision');
      error.code = 'EEXIST';
      throw error;
    },
  };
  await assert.rejects(installVerifier(directory, stream(digest), collidingFs));
  assert.equal(
    await fs.readFile(path.join(directory, path.basename(collision)), 'utf8'),
    'owned by another process',
  );
  assert.equal((await fs.readdir(directory)).length, 1);
});

test('relative, root, missing and non-directory destinations are rejected', async (t) => {
  const { installVerifier } = require('./map-bridge-configure');
  const directory = await fixture(t);
  const file = path.join(directory, 'ordinary-file');
  await fs.writeFile(file, 'keep');
  for (const invalid of [
    'relative',
    path.parse(directory).root,
    path.join(directory, 'missing'),
    file,
  ]) {
    await assert.rejects(installVerifier(invalid, stream(digest)));
  }
  assert.deepEqual(await fs.readdir(directory), ['ordinary-file']);
});

test('directory and verifier symlinks are rejected without modifying their targets', async (t) => {
  const { installVerifier } = require('./map-bridge-configure');
  const directory = await fixture(t);
  const target = path.join(directory, 'target');
  await fs.mkdir(target);
  const link = path.join(directory, 'directory-link');
  await fs.symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(installVerifier(link, stream(digest)));
  await assert.rejects(installVerifier(path.join(link, '.'), stream(digest)));
  assert.deepEqual(await fs.readdir(target), []);
  await fs.mkdir(path.join(target, 'nested'));
  await assert.rejects(installVerifier(path.join(link, 'nested'), stream(digest)));
  assert.deepEqual(await fs.readdir(path.join(target, 'nested')), []);
  const outside = path.join(directory, 'outside');
  await fs.writeFile(outside, 'keep');
  try {
    await fs.symlink(outside, path.join(target, filename), 'file');
  } catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') {
      t.diagnostic(
        'Windows does not permit file symlinks; directory junction protection was verified',
      );
      return;
    }
    throw error;
  }
  await assert.rejects(installVerifier(target, stream(digest)));
  assert.equal(await fs.readFile(outside, 'utf8'), 'keep');
});

test('an existing directory at the verifier filename remains untouched', async (t) => {
  const { installVerifier } = require('./map-bridge-configure');
  const directory = await fixture(t);
  await fs.mkdir(path.join(directory, filename));
  await fs.writeFile(path.join(directory, filename, 'existing.txt'), 'keep');
  await assert.rejects(installVerifier(directory, stream(digest)));
  assert.equal(await fs.readFile(path.join(directory, filename, 'existing.txt'), 'utf8'), 'keep');
  assert.deepEqual(await fs.readdir(directory), [filename]);
});

test('the runner requires main, explicit confirmation and a strict 256-bit token', () => {
  const { prepareConfiguration } = require('./map-bridge-configure');
  const env = {
    GITHUB_REF: 'refs/heads/main',
    MAP_CONFIRMATION: 'CONFIGURE MAP',
    DEVELOPMENT_MAP_INGEST_TOKEN: '0123456789abcdef'.repeat(4),
    DEPLOY_HOST: 'app.example.com',
    DEPLOY_PORT: '22',
    DEPLOY_USER: 'deploy',
    DEPLOY_PATH: '/data/www/free-BBS',
  };
  const prepared = prepareConfiguration(env);
  assert.equal(
    prepared.digest,
    crypto.createHash('sha256').update(env.DEVELOPMENT_MAP_INGEST_TOKEN).digest('hex'),
  );
  assert.equal(JSON.stringify(prepared).includes(env.DEVELOPMENT_MAP_INGEST_TOKEN), false);
  assert.equal(prepared.args.join(' ').includes(prepared.digest), false);
  for (const overrides of [
    { GITHUB_REF: 'refs/heads/feature' },
    { MAP_CONFIRMATION: 'configure map' },
    { DEVELOPMENT_MAP_INGEST_TOKEN: 'password' },
    { DEVELOPMENT_MAP_INGEST_TOKEN: `${'a'.repeat(64)}\n` },
    { DEPLOY_HOST: '-oProxyCommand=bad' },
    { DEPLOY_USER: 'deploy;bad' },
    { DEPLOY_PORT: '22;bad' },
    { DEPLOY_PORT: '0' },
    { DEPLOY_PORT: '65536' },
    { DEPLOY_PATH: '/' },
  ])
    assert.throws(() => prepareConfiguration({ ...env, ...overrides }));
});

test('SSH command quotes script and deployment path as distinct literal shell arguments', () => {
  const { prepareConfiguration, quoteShell } = require('./map-bridge-configure');
  const deploymentPath = "/data/www/space ' $() `ticks` ; directory";
  const prepared = prepareConfiguration({
    GITHUB_REF: 'refs/heads/main',
    MAP_CONFIRMATION: 'CONFIGURE MAP',
    DEVELOPMENT_MAP_INGEST_TOKEN: '0123456789abcdef'.repeat(4),
    DEPLOY_HOST: 'app.example.com',
    DEPLOY_PORT: '22',
    DEPLOY_USER: 'deploy',
    DEPLOY_PATH: deploymentPath,
  });
  assert.equal(quoteShell("a'b"), "'a'\\''b'");
  assert.equal(prepared.args.at(-1).endsWith(` ${quoteShell(deploymentPath)}`), true);
  assert.ok(prepared.args.includes('BatchMode=yes'));
  assert.ok(prepared.args.includes('StrictHostKeyChecking=yes'));
  assert.equal(prepared.args.at(-2), 'deploy@app.example.com');
});

test('serialized remote writer executes without a repository checkout or installed dependencies', async (t) => {
  const { remoteWriterSource } = require('./map-bridge-configure');
  const directory = await fixture(t);
  const result = spawnSync(process.execPath, ['-e', remoteWriterSource(), directory], {
    input: `${digest}\n`,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
  assert.equal(await fs.readFile(path.join(directory, filename), 'utf8'), `${digest}\n`);
  const invalid = spawnSync(process.execPath, ['-e', remoteWriterSource(), directory], {
    input: 'plaintext-secret',
    encoding: 'utf8',
  });
  assert.equal(invalid.status, 1);
  assert.equal(invalid.stdout, '');
  assert.equal(invalid.stderr.includes('plaintext-secret'), false);
  assert.equal(invalid.stderr.includes(digest), false);
  assert.equal(await fs.readFile(path.join(directory, filename), 'utf8'), `${digest}\n`);
});

test(
  'the generated remote command handles shell metacharacters literally',
  { skip: process.platform === 'win32' },
  async (t) => {
    const { prepareConfiguration, quoteShell } = require('./map-bridge-configure');
    const parent = await fixture(t);
    const directory = path.join(parent, "quoted ' $(printf INJECTION) ; directory");
    await fs.mkdir(directory);
    const prepared = prepareConfiguration({
      GITHUB_REF: 'refs/heads/main',
      MAP_CONFIRMATION: 'CONFIGURE MAP',
      DEVELOPMENT_MAP_INGEST_TOKEN: '0123456789abcdef'.repeat(4),
      DEPLOY_HOST: 'app.example.com',
      DEPLOY_PORT: '22',
      DEPLOY_USER: 'deploy',
      DEPLOY_PATH: directory,
    });
    // Exercise the remote shell locally; no SSH process or network connection is involved.
    const command = prepared.args.at(-1).replace(/^\/usr\/bin\/node/, quoteShell(process.execPath));
    const result = spawnSync('/bin/sh', ['-c', command], {
      input: `${digest}\n`,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
    assert.equal(await fs.readFile(path.join(directory, filename), 'utf8'), `${digest}\n`);
  },
);

test('runner errors never print token values or transport output', () => {
  const result = spawnSync(process.execPath, [helperPath], {
    env: {
      ...process.env,
      GITHUB_REF: 'refs/heads/main',
      MAP_CONFIRMATION: 'CONFIGURE MAP',
      DEVELOPMENT_MAP_INGEST_TOKEN: 'do-not-log-me',
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.includes('do-not-log-me'), false);
});

test('transport receives only a digest through stdin and no plaintext token in its environment', () => {
  const { configureFromEnvironment } = require('./map-bridge-configure');
  const env = {
    GITHUB_REF: 'refs/heads/main',
    MAP_CONFIRMATION: 'CONFIGURE MAP',
    DEVELOPMENT_MAP_INGEST_TOKEN: '0123456789abcdef'.repeat(4),
    DEPLOY_HOST: 'app.example.com',
    DEPLOY_PORT: '22',
    DEPLOY_USER: 'deploy',
    DEPLOY_PATH: '/data/www/free-BBS',
  };
  let calls = 0;
  const transport = (command, args, options) => {
    calls += 1;
    assert.equal(command, 'ssh');
    assert.equal(
      options.input,
      `${crypto.createHash('sha256').update(env.DEVELOPMENT_MAP_INGEST_TOKEN).digest('hex')}\n`,
    );
    assert.equal(options.env.DEVELOPMENT_MAP_INGEST_TOKEN, undefined);
    assert.equal(
      JSON.stringify({ args, options }).includes(env.DEVELOPMENT_MAP_INGEST_TOKEN),
      false,
    );
    assert.deepEqual(options.stdio, ['pipe', 'ignore', 'ignore']);
    assert.equal(options.timeout, 60000);
    return { status: 0 };
  };
  configureFromEnvironment(env, transport);
  assert.equal(calls, 1);
  assert.throws(() => configureFromEnvironment({ ...env, MAP_CONFIRMATION: '' }, transport));
  assert.equal(calls, 1);
  assert.throws(
    () =>
      configureFromEnvironment(env, () => ({
        status: 1,
        stderr: env.DEVELOPMENT_MAP_INGEST_TOKEN,
      })),
    /^Error: Map verifier configuration failed$/,
  );
});

test('validation-only CLI accepts approved inputs without invoking transport or printing credentials', () => {
  const token = '0123456789abcdef'.repeat(4);
  const result = spawnSync(process.execPath, [helperPath, '--validate-inputs'], {
    env: {
      ...process.env,
      GITHUB_REF: 'refs/heads/main',
      MAP_CONFIRMATION: 'CONFIGURE MAP',
      DEVELOPMENT_MAP_INGEST_TOKEN: token,
      DEPLOY_HOST: 'app.example.com',
      DEPLOY_PORT: '22',
      DEPLOY_USER: 'deploy',
      DEPLOY_PATH: '/data/www/free-BBS',
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'Map configuration inputs validated.\n');
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.includes(token), false);
  assert.equal(
    result.stdout.includes(crypto.createHash('sha256').update(token).digest('hex')),
    false,
  );
});
