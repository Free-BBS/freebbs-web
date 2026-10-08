const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { preparePageShell, SITE_FOOTER } = require('../page-shell');

const root = path.join(__dirname, '../public');

test('remote font CSS never blocks first paint, while local styles stay render-blocking', () => {
  const html = preparePageShell(fs.readFileSync(path.join(root, 'settings.html'), 'utf8'));
  const font = html.match(/<link\b[^>]*href="https:\/\/fonts.googleapis.com\/css[^>]*>/)[0];
  assert.match(font, /media="print"/);
  assert.match(font, /this.media='all'/);
  assert.match(font, /display=optional/);
  assert.match(html, /<link rel="stylesheet" href="\/styles.css" \/>/);
  assert.equal(preparePageShell(html), html);
});

test('ranch paints theme and public scenery before its loading placeholder, without account data', () => {
  const html = preparePageShell(fs.readFileSync(path.join(root, 'ranch.html'), 'utf8'));
  const theme = html.indexOf('<script src="/typography.js"');
  const scenery = html.indexOf('<script src="/ranch-environment.js"');
  assert.ok(theme < scenery && scenery < html.indexOf('<div class="page-shell'));
  assert.equal(html.split('src="/ranch-environment.js"').length - 1, 1);
  assert.match(html, /class="ranch-loading"/);
});

test('versioned request consumers receive the shared runtime once and in order', () => {
  const source =
    '<html><head></head><body><script src="/app.js?v=calendar-1"></script><script src="/notifications.js?v=2"></script></body></html>';
  const result = preparePageShell(source);
  assert.equal(result.split('src="/request-runtime.js"').length - 1, 1);
  assert.ok(
    result.indexOf('src="/request-runtime.js"') < result.indexOf('src="/app.js?v=calendar-1"'),
  );
  assert.equal(preparePageShell(result), result);
  assert.equal(result.split('src="/ui-state.js"').length - 1, 1);
  assert.ok(result.indexOf('src="/ui-state.js"') < result.indexOf('src="/app.js?v=calendar-1"'));
});

test('generated appearance entries load the shared preference data before the early theme', () => {
  for (const preferences of ['', '<script src="/typography-preferences.js"></script>']) {
    const source = `<html><head></head><body><main></main><script src="/typography.js"></script>${preferences}</body></html>`;
    const result = preparePageShell(source);
    assert.equal(result.split('src="/typography-preferences.js"').length - 1, 1);
    assert.ok(
      result.indexOf('src="/typography-preferences.js"') < result.indexOf('src="/typography.js"'),
    );
    assert.ok(result.indexOf('src="/typography-preferences.js"') < result.indexOf('</head>'));
    assert.match(result, /<body[^>]*>\s*<script src="\/typography.js"><\/script>/);
    assert.equal(preparePageShell(result), result);
  }
});

for (const filename of fs
  .readdirSync(root)
  .filter((name) => name.endsWith('.html') && !['404.html', 'circuit-embed.html'].includes(name))) {
  test(`${filename} has one shared footer and early, single appearance initialization`, () => {
    const source = fs.readFileSync(path.join(root, filename), 'utf8');
    const result = preparePageShell(source);
    assert.equal(result.split(SITE_FOOTER).length - 1, 1);
    assert.equal(result.split('href="/site-footer.css"').length - 1, 1);
    for (const label of [
      '关于 FREE BBS',
      'FREE BBS 工作人员名单',
      '清华大学电子系',
      '电子系学生科协',
    ])
      assert.ok(result.includes(label));
    const actionFooters = (source.match(/<footer\b(?![^>]*\bsite-footer)/g) || []).length;
    assert.equal((result.match(/<footer\b(?![^>]*\bsite-footer)/g) || []).length, actionFooters);
    if (source.includes('src="/typography.js"')) {
      assert.equal(source.split('src="/typography-preferences.js"').length - 1, 1);
      assert.ok(
        source.indexOf('src="/typography-preferences.js"') < source.indexOf('src="/typography.js"'),
      );
      assert.equal(result.split('src="/typography.js"').length - 1, 1);
      assert.equal(result.split('src="/typography-preferences.js"').length - 1, 1);
      assert.ok(
        result.indexOf('src="/typography-preferences.js"') < result.indexOf('src="/typography.js"'),
      );
      assert.match(result, /<body[^>]*>\s*<script src="\/typography.js"><\/script>/);
    }
    if (/src="\/app\.js(?:\?[^"']*)?"/.test(source)) {
      assert.equal(source.split('src="/ui-state.js"').length - 1, 1);
      assert.equal(result.split('src="/ui-state.js"').length - 1, 1);
      assert.ok(source.indexOf('src="/ui-state.js"') < source.indexOf('src="/app.js'));
      assert.ok(result.indexOf('src="/ui-state.js"') < result.indexOf('src="/app.js'));
    }
    if (/src="\/(app|notifications)\.js(?:\?[^"']*)?"/.test(source)) {
      // Raw/static previews must work before the server shell transform runs.
      const rawRuntime = source.indexOf('src="/request-runtime.js"');
      assert.equal(source.split('src="/request-runtime.js"').length - 1, 1);
      assert.ok(source.indexOf('src="/typography.js"') < rawRuntime);
      const runtime = result.indexOf('src="/request-runtime.js"');
      assert.equal(result.split('src="/request-runtime.js"').length - 1, 1);
      for (const consumer of ['/app.js', '/notifications.js']) {
        const script = result.indexOf(`src="${consumer}`);
        if (script >= 0) assert.ok(runtime < script);
        const rawScript = source.indexOf(`src="${consumer}`);
        if (rawScript >= 0) assert.ok(rawRuntime < rawScript);
      }
    }
    assert.ok(preparePageShell(result) === result, 'shared transform is idempotent');
  });
}
