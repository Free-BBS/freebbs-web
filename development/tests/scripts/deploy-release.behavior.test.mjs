/* eslint-disable no-useless-escape */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, URL } from 'node:url';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const deployScript = fileURLToPath(new URL('../../scripts/deploy-release.sh', import.meta.url));
const releaseInputPaths = [
  'package.json',
  'package-lock.json',
  'tsconfig.base.json',
  'eslint.config.mjs',
  'apps/api/package.json',
  'apps/api/tsconfig.json',
  'apps/api/src',
  'apps/web/package.json',
  'apps/web/tsconfig.json',
  'apps/web/vite.config.ts',
  'apps/web/index.html',
  'apps/web/public',
  'apps/web/src',
  'packages/contracts/package.json',
  'packages/contracts/tsconfig.json',
  'packages/contracts/src',
  'database/migrations',
  'deploy',
  'scripts',
];

function run(command, arguments_, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      ...options,
      env: { ...process.env, ...options.env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function executable(path, source) {
  await writeFile(path, source, 'utf8');
  await chmod(path, 0o755);
}

async function committedReleaseFixture(directory) {
  const repository = join(directory, 'repository');
  await mkdir(repository, { recursive: true });
  for (const path of releaseInputPaths) {
    const target = join(repository, path);
    await mkdir(dirname(target), { recursive: true });
    await cp(join(projectRoot, path), target, { recursive: true });
  }
  assert.equal((await run('git', ['init', '-q'], { cwd: repository })).code, 0);
  assert.equal((await run('git', ['add', '.'], { cwd: repository })).code, 0);
  const committed = await run(
    'git',
    [
      '-c',
      'user.name=Release Test',
      '-c',
      'user.email=release@example.test',
      'commit',
      '-qm',
      'fixture',
    ],
    { cwd: repository },
  );
  assert.equal(committed.code, 0, committed.stderr);
  const revision = await run('git', ['rev-parse', 'HEAD'], { cwd: repository });
  assert.equal(revision.code, 0, revision.stderr);
  return {
    repository,
    script: join(repository, 'scripts/create-release-archive.sh'),
    sha: revision.stdout.trim(),
  };
}

async function fixtureArchive(directory, sha, embeddedSha = sha, escapingLink = false) {
  const source = join(directory, `archive-source-${Math.random()}`);
  const archive = join(directory, `${sha}-${Math.random()}.tar.gz`);
  await mkdir(join(source, 'apps/api'), { recursive: true });
  await mkdir(join(source, 'apps/web'), { recursive: true });
  await writeFile(join(source, '.release-sha'), `${embeddedSha}\n`);
  if (escapingLink) await symlink('../../outside', join(source, 'escape'));
  const result = await run('tar', ['-czf', archive, '-C', source, '.']);
  assert.equal(result.code, 0, result.stderr);
  return archive;
}

async function deploymentFixture(failPhase = '') {
  const directory = await mkdtemp(join(tmpdir(), 'freebbs-deploy-test-'));
  const appRoot = join(directory, 'app');
  const webParent = join(directory, 'web');
  const oldRelease = join(appRoot, 'releases', 'old');
  const bin = join(directory, 'bin');
  await mkdir(join(oldRelease, 'apps/web/dist'), { recursive: true });
  await mkdir(join(oldRelease, 'apps/api/dist'), { recursive: true });
  await mkdir(webParent, { recursive: true });
  await mkdir(bin, { recursive: true });
  await writeFile(join(oldRelease, 'apps/web/dist/index.html'), 'old');
  await writeFile(join(oldRelease, 'apps/api/dist/server.js'), 'old');
  await symlink(oldRelease, join(appRoot, 'current'));
  await symlink(join(oldRelease, 'apps/web/dist'), join(webParent, 'development'));

  await executable(
    join(bin, 'npm'),
    `#!/bin/sh
case "\${FREEBBS_FAIL_PHASE:-}:\$*" in
  install:ci*) exit 41 ;;
  build:"run build") exit 42 ;;
esac
if [ "\$1 \$2" = "run build" ]; then
  mkdir -p apps/api/dist apps/web/dist
  printf 'new' > apps/api/dist/server.js
  printf 'new' > apps/web/dist/index.html
fi
exit 0
`,
  );
  await executable(join(bin, 'nginx'), '#!/bin/sh\n[ "${FREEBBS_FAIL_PHASE:-}" != nginx ]\n');
  await executable(
    join(bin, 'systemctl'),
    `#!/bin/sh
if [ "\${FREEBBS_FAIL_PHASE:-}" = restart ] && [ "\$1" = restart ]; then exit 43; fi
exit 0
`,
  );
  await executable(
    join(bin, 'curl'),
    `#!/bin/sh
if [ "\${FREEBBS_FAIL_PHASE:-}" = readiness ]; then exit 44; fi
output=
while [ "\$#" -gt 0 ]; do
  if [ "\$1" = --output ]; then output=\$2; shift 2; else shift; fi
done
if [ -n "\$output" ]; then printf 'web-response' >"\$output"; fi
exit 0
`,
  );
  await executable(join(bin, 'cmp'), '#!/bin/sh\n[ "${FREEBBS_FAIL_PHASE:-}" != web ]\n');

  return {
    directory,
    appRoot,
    webParent,
    oldRelease,
    env: {
      FREEBBS_TEST_MODE: '1',
      FREEBBS_APP_ROOT: appRoot,
      FREEBBS_WEB_PARENT: webParent,
      FREEBBS_READY_URL: 'http://127.0.0.1/api/development/v1/ready',
      FREEBBS_WEB_URL: 'https://development.example.test/development/',
      FREEBBS_READY_ATTEMPTS: '1',
      FREEBBS_READY_DELAY: '0',
      FREEBBS_NPM_BIN: join(bin, 'npm'),
      FREEBBS_NGINX_BIN: join(bin, 'nginx'),
      FREEBBS_SYSTEMCTL_BIN: join(bin, 'systemctl'),
      FREEBBS_CURL_BIN: join(bin, 'curl'),
      FREEBBS_CMP_BIN: join(bin, 'cmp'),
      FREEBBS_FAIL_PHASE: failPhase,
      MYSQL_PASSWORD: 'SENTINEL_DATABASE_SECRET',
      DEPLOY_SSH_KEY: 'SENTINEL_SSH_SECRET',
    },
  };
}

test(
  'archive generator binds evidence to immutable Git bytes and excludes secrets',
  { skip: process.platform !== 'linux' },
  async (context) => {
    let gitAvailable;
    try {
      gitAvailable = await run('git', ['--version']);
    } catch {
      context.skip('git is unavailable');
      return;
    }
    if (gitAvailable.code !== 0) {
      context.skip('git is unavailable');
      return;
    }

    const directory = await mkdtemp(join(tmpdir(), 'freebbs-archive-test-'));
    context.after(() => rm(directory, { recursive: true, force: true }));
    const fixture = await committedReleaseFixture(directory);
    const invalid = await run(fixture.script, [
      '--sha',
      'not-a-sha',
      '--output',
      join(directory, 'invalid.tar.gz'),
    ]);
    assert.notEqual(invalid.code, 0);
    const falseCommit = await run(fixture.script, [
      '--sha',
      'ffffffffffffffffffffffffffffffffffffffff',
      '--output',
      join(directory, 'false.tar.gz'),
    ]);
    assert.notEqual(falseCommit.code, 0);

    await writeFile(join(fixture.repository, 'package.json'), '{"dirty":true}\n');
    await writeFile(join(fixture.repository, 'scripts/.env'), 'SENTINEL_ARCHIVE_SECRET\n');
    const output = join(directory, 'release.tar.gz');
    const created = await run(fixture.script, ['--sha', fixture.sha, '--output', output]);
    assert.equal(created.code, 0, created.stderr);
    const overwrite = await run(fixture.script, ['--sha', fixture.sha, '--output', output]);
    assert.notEqual(overwrite.code, 0);
    const listing = await run('tar', ['-tzf', output]);
    assert.equal(listing.code, 0, listing.stderr);
    for (const entry of [
      './.release-sha',
      './package-lock.json',
      './apps/api/src/',
      './apps/web/index.html',
      './packages/contracts/src/',
      './database/migrations/',
      './deploy/',
      './scripts/deploy-release.sh',
    ]) {
      assert.ok(listing.stdout.includes(entry), `missing ${entry}`);
    }
    assert.doesNotMatch(listing.stdout, /(?:^|\/)\.env(?:$|\n)/m);
    const embedded = await run('tar', ['-xOzf', output, './.release-sha']);
    assert.equal(embedded.stdout.trim(), fixture.sha);
    const committedPackage = await run('tar', ['-xOzf', output, './package.json']);
    assert.doesNotMatch(committedPackage.stdout, /dirty/);
  },
);
test(
  'deployment rejects mismatched evidence, unsafe members, and escaping links',
  { skip: process.platform !== 'linux' },
  async (context) => {
    const sha = '1123456789abcdef0123456789abcdef01234567';
    for (const entry of ['/absolute', '../traversal', 'control\tmember']) {
      const fixture = await deploymentFixture();
      context.after(() => rm(fixture.directory, { recursive: true, force: true }));
      const fakeTar = join(fixture.directory, 'unsafe-tar');
      await executable(
        fakeTar,
        `#!/bin/sh
if [ "\$1" = -tzf ]; then printf '%s\\n' '${entry}'; exit 0; fi
exit 99
`,
      );
      const placeholder = join(fixture.directory, 'archive.tar.gz');
      await writeFile(placeholder, 'placeholder');
      const result = await run(
        deployScript,
        ['--archive', placeholder, '--sha', sha, '--domain', 'development.example.test'],
        {
          env: { ...fixture.env, FREEBBS_TAR_BIN: fakeTar },
        },
      );
      assert.notEqual(result.code, 0);
    }

    const mismatch = await deploymentFixture();
    context.after(() => rm(mismatch.directory, { recursive: true, force: true }));
    const mismatchArchive = await fixtureArchive(
      mismatch.directory,
      sha,
      'ffffffffffffffffffffffffffffffffffffffff',
    );
    const mismatchResult = await run(
      deployScript,
      ['--archive', mismatchArchive, '--sha', sha, '--domain', 'development.example.test'],
      {
        env: mismatch.env,
      },
    );
    assert.notEqual(mismatchResult.code, 0);

    const escaping = await deploymentFixture();
    context.after(() => rm(escaping.directory, { recursive: true, force: true }));
    const escapingArchive = await fixtureArchive(escaping.directory, sha, sha, true);
    const escapingResult = await run(
      deployScript,
      ['--archive', escapingArchive, '--sha', sha, '--domain', 'development.example.test'],
      {
        env: escaping.env,
      },
    );
    assert.notEqual(escapingResult.code, 0);
    assert.match(escapingResult.stderr, /escaping symbolic link/);
  },
);

test(
  'deployment switches atomically and every operational failure restores both old links',
  { skip: process.platform !== 'linux' },
  async (context) => {
    const sha = '2123456789abcdef0123456789abcdef01234567';
    const success = await deploymentFixture();
    context.after(() => rm(success.directory, { recursive: true, force: true }));
    const archive = await fixtureArchive(success.directory, sha);
    const deployed = await run(
      deployScript,
      ['--archive', archive, '--sha', sha, '--domain', 'development.example.test'],
      {
        env: success.env,
      },
    );
    assert.equal(deployed.code, 0, deployed.stderr);
    assert.equal(
      await readlink(join(success.appRoot, 'current')),
      join(success.appRoot, 'releases', sha),
    );
    assert.equal(
      await readlink(join(success.webParent, 'development')),
      join(success.appRoot, 'releases', sha, 'apps/web/dist'),
    );
    const selectedRelease = join(success.appRoot, 'releases', sha);
    assert.equal((await stat(selectedRelease)).mode & 0o777, 0o755);
    assert.equal((await stat(join(selectedRelease, 'apps/web/dist'))).mode & 0o005, 0o005);
    assert.equal(
      (await stat(join(selectedRelease, 'apps/api/dist/server.js'))).mode & 0o004,
      0o004,
    );
    assert.doesNotMatch(deployed.stdout + deployed.stderr, /SENTINEL_/);

    for (const phase of [
      'install',
      'build',
      'static-link',
      'nginx',
      'restart',
      'readiness',
      'web',
    ]) {
      const fixture = await deploymentFixture(phase);
      context.after(() => rm(fixture.directory, { recursive: true, force: true }));
      const phaseSha = `${phase.length}`.padStart(40, '3');
      const phaseArchive = await fixtureArchive(fixture.directory, phaseSha);
      const result = await run(
        deployScript,
        ['--archive', phaseArchive, '--sha', phaseSha, '--domain', 'development.example.test'],
        {
          env: fixture.env,
        },
      );
      assert.notEqual(result.code, 0, `${phase} unexpectedly succeeded`);
      assert.equal(await readlink(join(fixture.appRoot, 'current')), fixture.oldRelease);
      assert.equal(
        await readlink(join(fixture.webParent, 'development')),
        join(fixture.oldRelease, 'apps/web/dist'),
      );
      assert.doesNotMatch(result.stdout + result.stderr, /SENTINEL_/);
    }
  },
);
test(
  'audited post-release rollback switches both links and restores the selected release on failure',
  { skip: process.platform !== 'linux' },
  async (context) => {
    const createRollbackTarget = async (fixture, sha) => {
      const target = join(fixture.appRoot, 'releases', sha);
      await mkdir(join(target, 'apps/api/dist'), { recursive: true });
      await mkdir(join(target, 'apps/web/dist'), { recursive: true });
      await writeFile(join(target, '.release-sha'), `${sha}\n`);
      await writeFile(join(target, 'apps/api/dist/server.js'), 'rollback-api');
      await writeFile(join(target, 'apps/web/dist/index.html'), 'rollback-web');
      return target;
    };

    const targetSha = '4123456789abcdef0123456789abcdef01234567';
    const success = await deploymentFixture();
    context.after(() => rm(success.directory, { recursive: true, force: true }));
    const target = await createRollbackTarget(success, targetSha);
    const rolledBack = await run(
      deployScript,
      ['--rollback-to', targetSha, '--domain', 'development.example.test'],
      {
        env: success.env,
      },
    );
    assert.equal(rolledBack.code, 0, rolledBack.stderr);
    assert.equal(await readlink(join(success.appRoot, 'current')), target);
    assert.equal(
      await readlink(join(success.webParent, 'development')),
      join(target, 'apps/web/dist'),
    );

    for (const phase of ['static-link', 'nginx', 'restart', 'readiness', 'web']) {
      const fixture = await deploymentFixture(phase);
      context.after(() => rm(fixture.directory, { recursive: true, force: true }));
      const phaseSha = `${phase.length}`.padStart(40, '5');
      await createRollbackTarget(fixture, phaseSha);
      const result = await run(
        deployScript,
        ['--rollback-to', phaseSha, '--domain', 'development.example.test'],
        {
          env: fixture.env,
        },
      );
      assert.notEqual(result.code, 0, `${phase} rollback unexpectedly succeeded`);
      assert.equal(await readlink(join(fixture.appRoot, 'current')), fixture.oldRelease);
      assert.equal(
        await readlink(join(fixture.webParent, 'development')),
        join(fixture.oldRelease, 'apps/web/dist'),
      );
    }
  },
);
