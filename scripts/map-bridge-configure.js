const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

// This function is also sent inline to the existing server Node runtime. Keep it self-contained.
async function installVerifier(directory, input, fileSystem = require('node:fs/promises')) {
  const path = require('node:path');
  const { constants } = require('node:fs');
  const { randomUUID } = require('node:crypto');
  const filename = '.development-map-token.sha256';
  const fail = () => {
    throw new Error('Map verifier configuration rejected');
  };
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) fail();
  const canonical = path.resolve(directory);
  if (canonical === path.parse(canonical).root) fail();
  const original = await fileSystem.lstat(canonical);
  if (!original.isDirectory() || original.isSymbolicLink()) fail();
  if ((await fileSystem.realpath(canonical)) !== canonical) fail();

  const chunks = [];
  let length = 0;
  for await (const chunk of input) {
    const buffer = Buffer.from(chunk);
    length += buffer.length;
    if (length > 65) fail();
    chunks.push(buffer);
  }
  const bytes = Buffer.concat(chunks);
  const value = bytes.toString('ascii');
  if (!/^[a-f0-9]{64}\n?$/.test(value) || !bytes.equals(Buffer.from(value, 'ascii'))) fail();

  let directoryHandle;
  let temporaryHandle;
  let temporary;
  try {
    // Linux anchors all writes to an open directory, so a renamed/symlink-swapped parent
    // cannot redirect the temporary file or replacement into another directory.
    if (process.platform === 'linux') {
      directoryHandle = await fileSystem.open(
        canonical,
        // eslint-disable-next-line no-bitwise -- combine native filesystem open flags
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      const opened = await directoryHandle.stat();
      if (opened.dev !== original.dev || opened.ino !== original.ino) fail();
    }
    const base = directoryHandle ? `/proc/self/fd/${directoryHandle.fd}` : canonical;
    const destination = path.join(base, filename);
    const checkTarget = async () => {
      const current = await fileSystem.lstat(canonical);
      if (
        !current.isDirectory() ||
        current.isSymbolicLink() ||
        current.dev !== original.dev ||
        current.ino !== original.ino
      )
        fail();
      if ((await fileSystem.realpath(canonical)) !== canonical) fail();
      try {
        const existing = await fileSystem.lstat(destination);
        if (!existing.isFile() || existing.isSymbolicLink()) fail();
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    };
    await checkTarget();
    const candidate = path.join(base, `${filename}.${randomUUID()}.tmp`);
    temporaryHandle = await fileSystem.open(candidate, 'wx', 0o600);
    temporary = candidate;
    await temporaryHandle.writeFile(`${value.slice(0, 64)}\n`, 'ascii');
    await temporaryHandle.chmod(0o644);
    await temporaryHandle.sync();
    await temporaryHandle.close();
    temporaryHandle = undefined;
    await checkTarget();
    await fileSystem.rename(temporary, destination);
    temporary = undefined;
  } finally {
    if (temporaryHandle) await temporaryHandle.close().catch(() => {});
    if (temporary) await fileSystem.unlink(temporary).catch(() => {});
    if (directoryHandle) await directoryHandle.close().catch(() => {});
  }
}

function quoteShell(value) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function remoteWriterSource() {
  return `(${installVerifier.toString()})(process.argv[1], process.stdin).catch(() => { process.stderr.write('Map verifier configuration failed\\n'); process.exitCode = 1; });`;
}

function prepareConfiguration(env) {
  const fail = () => {
    throw new Error('Map configuration inputs rejected');
  };
  if (env.GITHUB_REF !== 'refs/heads/main' || env.MAP_CONFIRMATION !== 'CONFIGURE MAP') fail();
  const token = env.DEVELOPMENT_MAP_INGEST_TOKEN;
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) fail();
  const { DEPLOY_HOST: host, DEPLOY_USER: user, DEPLOY_PORT: port, DEPLOY_PATH: directory } = env;
  if (typeof host !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9.:-]*$/.test(host)) fail();
  if (typeof user !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(user)) fail();
  if (
    typeof port !== 'string' ||
    !/^[0-9]{1,5}$/.test(port) ||
    Number(port) < 1 ||
    Number(port) > 65535
  )
    fail();
  const { posix } = require('node:path');
  if (
    typeof directory !== 'string' ||
    !directory.startsWith('/') ||
    // eslint-disable-next-line no-control-regex -- reject shell/path control characters
    /[\x00-\x1f\x7f]/.test(directory) ||
    posix.resolve(directory) === '/'
  )
    fail();
  const args = [
    '-p',
    port,
    '-o',
    'BatchMode=yes',
    '-o',
    'StrictHostKeyChecking=yes',
    '-o',
    'ConnectTimeout=15',
    '--',
    `${user}@${host}`,
    `/usr/bin/node -e ${quoteShell(remoteWriterSource())} ${quoteShell(directory)}`,
  ];
  return { args, digest: crypto.createHash('sha256').update(token, 'utf8').digest('hex') };
}

function configureFromEnvironment(env = process.env, transport = spawnSync) {
  const { args, digest } = prepareConfiguration(env);
  // Do not propagate the plaintext credential to SSH or expose remote output on errors.
  const transportEnv = { ...env };
  delete transportEnv.DEVELOPMENT_MAP_INGEST_TOKEN;
  const result = transport('ssh', args, {
    input: `${digest}\n`,
    env: transportEnv,
    stdio: ['pipe', 'ignore', 'ignore'],
    timeout: 60000,
  });
  if (result.error || result.status !== 0) throw new Error('Map verifier configuration failed');
}

module.exports = {
  installVerifier,
  quoteShell,
  remoteWriterSource,
  prepareConfiguration,
  configureFromEnvironment,
};

if (require.main === module) {
  try {
    if (process.argv[2] === '--validate-inputs' && process.argv.length === 3) {
      prepareConfiguration(process.env);
      process.stdout.write('Map configuration inputs validated.\n');
    } else if (process.argv.length === 2) {
      configureFromEnvironment();
      process.stdout.write('Map verifier installed; normal deployment loads the configuration.\n');
    } else {
      throw new Error('Map configuration inputs rejected');
    }
  } catch {
    process.stderr.write(
      'Map verifier configuration failed; check the approved inputs and deployment access.\n',
    );
    process.exitCode = 1;
  }
}
