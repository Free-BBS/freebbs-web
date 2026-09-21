const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createOnboardingPreview } = require('./preview-onboarding');

function requestPreview(server, pathname, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { hostname: '127.0.0.1', port: server.address().port, path: pathname, method, headers },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          resolve({ status: response.statusCode, headers: response.headers, body });
        });
        response.on('error', reject);
      },
    );
    request.on('error', reject);
    request.end();
  });
}

test('ranch state showcase is loopback-only, read-only, and leaves all demo accounts untouched', async (t) => {
  const { server, store, progress } = createOnboardingPreview();
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => {
      server.close(resolve);
    });
  });
  const before = [1, 2].map((id) => structuredClone(store.account(id)));
  const guideBefore = progress();
  const response = await requestPreview(server, '/preview/ranch-states?theme=dark');
  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['set-cookie'], undefined);
  assert.match(response.headers['content-security-policy'], /connect-src 'none'/);
  const html = response.body;
  assert.match(html, /仅本地视觉预览/);
  assert.match(html, /href="\/profile-extras.css"/);
  assert.match(html, /src="\/max-ranch.js"/);
  assert.doesNotMatch(
    html,
    /localStorage|sessionStorage|fetch\(|free_bbs_auth_token|src="\/app.js"/,
  );
  assert.equal(
    (await requestPreview(server, '/preview/ranch-states', { method: 'HEAD' })).status,
    200,
  );
  assert.equal(
    (await requestPreview(server, '/preview/ranch-states', { method: 'POST' })).status,
    405,
  );
  const foreignHost = await requestPreview(server, '/preview/ranch-states', {
    headers: { Host: 'www.free-bbs.cn' },
  });
  assert.equal(foreignHost.status, 403);
  assert.ok((await requestPreview(server, '/scripts/fixtures/ranch-states.html')).status >= 400);
  for (const file of ['max-ranch.js', 'profile-extras.css']) {
    const actual = await requestPreview(server, `/${file}`);
    assert.equal(actual.status, 200);
    assert.equal(actual.body, fs.readFileSync(path.join(__dirname, '../public', file), 'utf8'));
  }
  assert.deepEqual(
    [1, 2].map((id) => structuredClone(store.account(id))),
    before,
  );
  assert.deepEqual(progress(), guideBefore);
});

test('fixture uses three real component states, a 320px actor, safe local themes and cleanup', () => {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures/ranch-states.html'), 'utf8');
  assert.equal([...html.matchAll(/class="state-card" data-state=/g)].length, 3);
  assert.match(html, /normal: \{ hungry: false, woolReady: 0, shearedToday: true \}/);
  assert.match(html, /fluffy: \{ hungry: false, woolReady: 1, shearedToday: false \}/);
  assert.match(html, /hungry: \{ hungry: true, woolReady: 0, shearedToday: false \}/);
  assert.match(html, /window.FreeBbsMaxRanch.mount/);
  assert.match(html, /paused: true/);
  assert.match(html, /width: min\(320px, 100%\)/);
  assert.match(html, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(html, /真实的静态饥饿姿势/);
  assert.match(html, /actor.greet\(\)/);
  assert.match(html, /actor.destroy\(\)/);
  assert.match(html, /window.clearTimeout\(timer\)/);
});
