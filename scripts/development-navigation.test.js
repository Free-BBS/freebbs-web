const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(projectRoot, 'public', 'app.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');
const developmentPagePath = path.join(projectRoot, 'public', 'development.html');
const deploymentSource = fs.readFileSync(path.join(projectRoot, 'DEPLOYMENT.md'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));

async function reservePort() {
  const reservation = net.createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const { port } = reservation.address();
  reservation.close();
  await once(reservation, 'close');
  return port;
}

async function startStaticServer(port) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: projectRoot,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  await Promise.race([
    new Promise((resolve) => {
      child.stdout.on('data', (chunk) => {
        if (chunk.toString().includes('FREE-BBS homepage running')) resolve();
      });
    }),
    once(child, 'exit').then(([code]) => {
      throw new Error(`static server exited early with ${code}: ${stderr}`);
    }),
  ]);
  return child;
}

test('shared navigation places the canonical development entry immediately before settings', () => {
  const developmentItem = "{ href: '/development/', icon: 'star', label: '发展端' }";
  const settingsItem = "{ href: '/settings', icon: 'gear', label: '设置' }";
  const developmentIndex = appSource.indexOf(developmentItem);
  const settingsIndex = appSource.indexOf(settingsItem);

  assert.notEqual(developmentIndex, -1, 'development navigation item is missing');
  assert.notEqual(settingsIndex, -1, 'settings navigation item is missing');
  assert.ok(developmentIndex < settingsIndex, 'development must appear before settings');
  assert.match(appSource, /'\/development': '发展端'/);
});

test('static server enforces the canonical development slash and preserves query state', async (context) => {
  assert.ok(serverSource.includes("['/development.html', '/development/']"));
  const port = await reservePort();
  const child = await startStaticServer(port);
  context.after(() => child.kill());
  const baseUrl = `http://127.0.0.1:${port}`;

  const slashRedirect = await fetch(`${baseUrl}/development?from=nav`, {
    redirect: 'manual',
  });
  assert.equal(slashRedirect.status, 308);
  assert.equal(slashRedirect.headers.get('location'), '/development/?from=nav');

  const legacyRedirect = await fetch(`${baseUrl}/development.html?from=legacy`, {
    redirect: 'manual',
  });
  assert.equal(legacyRedirect.status, 301);
  assert.equal(legacyRedirect.headers.get('location'), '/development/?from=legacy');

  const canonicalPage = await fetch(`${baseUrl}/development/`);
  assert.equal(canonicalPage.status, 200);
  assert.match(await canonicalPage.text(), /data-local-development-placeholder/);
});

test('development page is an honest local placeholder for the Nginx-supplied app', () => {
  assert.equal(fs.existsSync(developmentPagePath), true, 'development page is missing');

  const pageSource = fs.readFileSync(developmentPagePath, 'utf8');
  assert.match(pageSource, /<title>FREE-BBS - 发展端<\/title>/);
  assert.match(pageSource, /data-local-development-placeholder/);
  assert.match(pageSource, /生产 Nginx/);
  assert.match(pageSource, /Free-BBS\/Free-bbs-Development/);
  assert.match(pageSource, /<link rel="stylesheet" href="\/styles\.css" \/>/);
  assert.match(pageSource, /<script src="\/app\.js"><\/script>/);
});

test('repository commands and production Nginx include are cross-platform and exact', () => {
  assert.equal(
    packageJson.scripts.test,
    'node --test scripts/return-to.test.js scripts/development-navigation.test.js',
  );
  assert.match(deploymentSource, /freebbs-development\.locations\.conf/);
  assert.doesNotMatch(deploymentSource, /`deploy\/nginx\/freebbs-development\.conf`/);
});
