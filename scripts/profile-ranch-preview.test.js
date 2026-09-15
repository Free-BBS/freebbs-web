const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createEconomyPreview } = require('./preview-economy');
const { beijingDay } = require('../backend/profile-extras');

test('preview fortune, check-in and feeding work across Beijing midnight without restarting', async () => {
  let clock = Date.parse('2026-09-16T15:59:00Z');
  const { server, store } = createEconomyPreview({ now: () => clock });
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (url, body) => {
    const response = await fetch(
      `${base}/api${url}`,
      body
        ? {
            method: 'POST',
            headers: {
              Authorization: 'Bearer economy-preview-only-not-a-real-session',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
          }
        : {},
    );
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  try {
    store.account().assets.fish = 3;
    store.account().assets.max_pet = 1;
    await api('/profile/extras', { action: 'adopt', requestKey: randomUUID() });
    for (const day of ['2026-09-16', '2026-09-17']) {
      const fortune = await api('/fortune');
      assert.equal(fortune.today.date, day);
      assert.equal(
        (await api('/fortune')).today.score,
        fortune.today.score,
        'same day does not reroll',
      );
      const summary = await api('/checkin');
      assert.equal(summary.todayFortune.date, day);
      assert.equal(summary.checkedInToday, false);
      const before = store.account().magnetic;
      const responses = await Promise.all([api('/checkin', {}), api('/checkin', {})]);
      assert.equal(responses.filter((x) => !x.alreadyCheckedIn).length, 1);
      assert.equal(store.account().magnetic - before, day.endsWith('16') ? 2 : 3);
      const requestKey = randomUUID();
      const fed = await api('/profile/extras', { action: 'feed', requestKey });
      assert.equal(fed.result.bone, 'golden_fishbone');
      const { fish } = store.account().assets;
      await api('/profile/extras', { action: 'feed', requestKey });
      assert.equal(store.account().assets.fish, fish, 'retry does not consume a second fish');
      clock = Date.parse('2026-09-16T16:01:00Z');
    }
    const extra = await api('/profile/extras', { action: 'feed', requestKey: randomUUID() });
    assert.equal(extra.result.bone, 'golden_fishbone');
    assert.equal(store.account().assets.golden_fishbone, 3);
    const settings = await fetch(`${base}/settings`);
    assert.equal(settings.status, 200);
    const html = await settings.text();
    for (const id of [
      'settings-avatar-input',
      'settings-full-name',
      'settings-website-url',
      'settings-bio',
      'settings-font-preset',
    ])
      assert.ok(html.includes(`id="${id}"`), id);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }
});

test('production fortune/checkin dates use Beijing, without changing the heat decay calendar', () => {
  const source = fs.readFileSync(path.join(__dirname, '../backend/server.js'), 'utf8');
  const section = source.slice(
    source.indexOf('function addDays('),
    source.indexOf('function generateFortuneScore('),
  );
  const context = { beijingDay };
  vm.createContext(context);
  vm.runInContext(section, context);
  assert.equal(context.fortuneDateKey(new Date('2026-09-14T16:01:00Z')), '2026-09-15');
  assert.equal(
    context.fortuneDateKey(context.addDays(new Date('2026-09-14T16:01:00Z'), -1)),
    '2026-09-14',
  );
  assert.match(source, /const todayKey = toDateKey\(referenceDate\)/);
  const fortuneSource = source.slice(
    source.indexOf('async function ensureUserFortuneWindow('),
    source.indexOf('async function performDailyCheckin('),
  );
  assert.doesNotMatch(fortuneSource, /\btoDateKey\(/);
  assert.ok(source.includes('const todayKey = fortuneDateKey(new Date());'));
});
