const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createOnboardingPreview } = require('./preview-onboarding');

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
  const origin = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${origin}/preview/ranch-states?theme=dark`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.match(response.headers.get('content-security-policy'), /connect-src 'none'/);
  const html = await response.text();
  assert.match(html, /仅本地视觉预览/);
  assert.match(html, /href="\/profile-extras.css"/);
  assert.match(html, /src="\/max-ranch.js"/);
  assert.doesNotMatch(
    html,
    /localStorage|sessionStorage|fetch\(|free_bbs_auth_token|src="\/app.js"/,
  );
  assert.equal((await fetch(`${origin}/preview/ranch-states`, { method: 'HEAD' })).status, 200);
  assert.equal((await fetch(`${origin}/preview/ranch-states`, { method: 'POST' })).status, 405);
  const foreignHostStatus = await new Promise((resolve, reject) => {
    http
      .get(`${origin}/preview/ranch-states`, { headers: { Host: 'www.free-bbs.cn' } }, (result) => {
        result.resume();
        resolve(result.statusCode);
      })
      .on('error', reject);
  });
  assert.equal(foreignHostStatus, 403);
  assert.ok((await fetch(`${origin}/scripts/fixtures/ranch-states.html`)).status >= 400);
  for (const file of ['max-ranch.js', 'profile-extras.css']) {
    const actual = await fetch(`${origin}/${file}`);
    assert.equal(actual.status, 200);
    assert.equal(
      await actual.text(),
      fs.readFileSync(path.join(__dirname, '../public', file), 'utf8'),
    );
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
