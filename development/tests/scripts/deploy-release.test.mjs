import './deploy-release.behavior.test.mjs';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { URL } from 'node:url';
test('release tooling is repository-owned and exposes the documented CLIs', async () => {
  for (const name of [
    'scripts/create-release-archive.sh',
    'scripts/deploy-release.sh',
    'scripts/install-server.sh',
  ]) {
    await access(new URL(`../../${name}`, import.meta.url));
  }

  const archive = await readFile(
    new URL('../../scripts/create-release-archive.sh', import.meta.url),
    'utf8',
  );
  const deploy = await readFile(
    new URL('../../scripts/deploy-release.sh', import.meta.url),
    'utf8',
  );
  const installer = await readFile(
    new URL('../../scripts/install-server.sh', import.meta.url),
    'utf8',
  );

  assert.match(archive, /--sha/);
  assert.match(archive, /--output/);
  assert.match(archive, /\.release-sha/);
  assert.match(archive, /--sort=name/);
  assert.doesNotMatch(archive, /\.env(?:\s|["'])/);

  assert.match(deploy, /40-character hexadecimal/);
  assert.match(deploy, /--rollback-to/);
  assert.match(deploy, /\.release-sha/);
  assert.match(deploy, /\[\[:cntrl:\]\]/);
  assert.match(deploy, /realpath/);
  assert.match(deploy, /\.staging/);
  assert.match(deploy, /"\$npm_bin" ci/);
  assert.match(deploy, /"\$npm_bin" run build/);
  assert.match(deploy, /nginx/);
  assert.match(deploy, /ready_url=http:\/\/127\.0\.0\.1:3100\/api\/development\/v1\/ready/);
  assert.doesNotMatch(deploy, /ready_url=http:\/\/127\.0\.0\.1:3100\/ready/);
  assert.match(deploy, /--domain/);
  assert.match(deploy, /--resolve/);
  assert.match(deploy, /https:\/\/\$freebbs_domain\/development\//);
  assert.match(deploy, /--noproxy ['"]\*['"]/);
  assert.match(deploy, /"\$cmp_bin"/);
  assert.doesNotMatch(deploy, /web_url=http:\/\/127\.0\.0\.1/);
  assert.match(deploy, /rollback/);
  assert.doesNotMatch(deploy, /db:seed/);

  assert.match(installer, /freebbs-development/);
  assert.match(installer, /\/opt\/freebbs-development\/releases/);
  assert.match(installer, /\/etc\/freebbs-development/);
  assert.match(installer, /0755/);
  assert.match(installer, /0640/);
  assert.doesNotMatch(installer, /systemctl\s+(?:start|restart)/);
});

test('deployment hook keeps paths overrideable for isolated transactional tests', async () => {
  const deploy = await readFile(
    new URL('../../scripts/deploy-release.sh', import.meta.url),
    'utf8',
  );
  for (const variable of [
    'FREEBBS_APP_ROOT',
    'FREEBBS_WEB_PARENT',
    'FREEBBS_READY_URL',
    'FREEBBS_WEB_URL',
    'FREEBBS_READY_ATTEMPTS',
    'FREEBBS_READY_DELAY',
  ]) {
    assert.match(deploy, new RegExp(variable));
  }
});
