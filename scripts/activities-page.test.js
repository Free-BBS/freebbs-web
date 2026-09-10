const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const common = fs.readFileSync('public/surveys-common.js', 'utf8');

test('activity requests use same-origin API on local, HTTPS and custom-port sites', async () => {
  for (const origin of [
    'http://127.0.0.1:3000',
    'http://localhost:4300',
    'https://freebbs.example',
    'https://preview.example:3000',
  ]) {
    const requests = [];
    const window = { location: new URL(origin) };
    vm.runInNewContext(common, {
      window,
      localStorage: { getItem: () => 'session-token' },
      fetch: async (url, options) => {
        requests.push({ url, options });
        return { ok: true, json: async () => ({ ok: true }) };
      },
    });
    await window.SurveyUI.api('/surveys');
    await window.SurveyUI.api('/surveys/test/entries', 'POST', { answers: {} });
    assert.equal(requests[0].url, '/api/surveys');
    assert.equal(requests[1].url, '/api/surveys/test/entries');
    assert.equal(requests[1].options.headers.Authorization, 'Bearer session-token');
    assert.equal(window.FREEBBS_API_BASE, '/api');
  }
});
test('activities are visible in shared navigation and both pages reuse the site shell', () => {
  const app = fs.readFileSync('public/app.js', 'utf8');
  assert.match(app, /\{ href: '\/surveys', icon: 'calendar', label: '活动报名' \}/);
  for (const file of ['public/surveys.html', 'public/system-settings-surveys.html']) {
    const html = fs.readFileSync(file, 'utf8');
    assert.match(html, /class="nav-actions"/);
    assert.match(html, /class="mobile-nav"/);
    assert.match(html, /\/app.js/);
    assert.match(html, /\/styles.css/);
    assert.match(html, /activities-main/);
  }
  assert.match(
    fs.readFileSync('public/system-settings-surveys.html', 'utf8'),
    /name="requiresLogin"/,
  );
});

test('activity typography follows shared font roles and rem scale', () => {
  const css = fs.readFileSync('public/surveys.css', 'utf8');
  assert.doesNotMatch(css, /font-size:\s*\d+px|font:\s*(?:\d+\s+)?\d+px/);
  assert.match(css, /var\(--font-zh-ui\)/);
  assert.match(css, /var\(--font-latin\)/);
  assert.match(css, /var\(--font-code\)/);
  for (const file of ['public/surveys.html', 'public/system-settings-surveys.html']) {
    assert.match(fs.readFileSync(file, 'utf8'), /src="\/typography.js"/);
  }
});
