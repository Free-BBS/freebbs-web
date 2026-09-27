const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../public/ranch-page.js'), 'utf8');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const seasons = {
  spring: ['春', '桃花'],
  summer: ['夏', '草木'],
  autumn: ['秋', '红叶'],
  winter: ['冬', '薄雪'],
};
function functionSource(name, next) {
  return source.slice(source.indexOf(`function ${name}(`), source.indexOf(`function ${next}(`));
}

test('season selection follows Beijing months, validates stored choices, and tolerates unavailable storage', () => {
  const context = { seasons, storageKey: 'season', localStorage: { getItem: () => null } };
  for (const [date, expected] of [
    ['2026-02-28T15:59:59Z', 'winter'],
    ['2026-02-28T16:00:00Z', 'spring'],
    ['2026-06-01T00:00:00Z', 'summer'],
    ['2026-09-27T00:00:00Z', 'autumn'],
    ['2026-12-01T00:00:00Z', 'winter'],
  ]) {
    context.Date = class extends Date {
      static now() {
        return Date.parse(date);
      }
    };
    vm.runInNewContext(functionSource('initialSeason', 'applySeason'), context);
    assert.equal(context.initialSeason(), expected);
  }
  context.localStorage.getItem = () => 'spring';
  assert.equal(context.initialSeason(), 'spring');
  context.localStorage.getItem = () => '<script>';
  assert.equal(context.initialSeason(), 'winter');
  context.localStorage.getItem = () => {
    throw new Error('denied');
  };
  assert.equal(context.initialSeason(), 'winter');
});

test('season switching updates accessible selection without issuing any transaction', () => {
  const caption = {};
  const buttons = Object.keys(seasons).map((key) => ({
    dataset: { ranchSeasonChoice: key },
    setAttribute(name, value) {
      this[name] = value;
    },
  }));
  const root = { dataset: {}, querySelector: () => caption, querySelectorAll: () => buttons };
  const body = { classList: { contains: () => true }, dataset: {} };
  const context = { seasons, currentSeason: undefined, document: { body } };
  vm.runInNewContext(functionSource('applySeason', 'panel'), context);
  context.applySeason(root, 'summer');
  assert.equal(root.dataset.ranchSeason, 'summer');
  assert.equal(body.dataset.ranchSeason, 'summer');
  assert.equal(caption.textContent, '北京 · 草木');
  assert.deepEqual(
    buttons.map((button) => button['aria-pressed']),
    ['false', 'true', 'false', 'false'],
  );
  context.applySeason(root, 'invalid');
  assert.equal(root.dataset.ranchSeason, 'summer');
  body.classList.contains = () => false;
  context.applySeason(root, 'winter');
  assert.equal(root.dataset.ranchSeason, 'winter');
  assert.equal(body.dataset.ranchSeason, 'summer', 'profile preview must not theme shared chrome');
  assert.doesNotMatch(functionSource('applySeason', 'panel'), /fetch|callApi/);
});

test('mobile ranch locks only its viewport, keeps dialogs scrollable, and shortens visible labels without losing names', () => {
  const css = read('public/ranch-page.css');
  assert.match(
    css,
    /html:has\(body.ranch-page\)\s*\{[^}]*overflow: hidden;[^}]*overscroll-behavior: none;/,
  );
  assert.match(
    css,
    /body.ranch-page.public-profile-page:not\(\.auth-page-body\) \.main-content\s*\{[^}]*position: fixed;/,
  );
  assert.match(css, /\.ranch-drawer\s*\{[^}]*overflow-y: auto;/);
  assert.match(css, /\.ranch-scene-actions\s*\{[^}]*grid-auto-flow: column;/);
  assert.doesNotMatch(
    css,
    /\.ranch-scene-actions \[data-extra-action='feed'\]\s*\{\s*flex-basis: 100%/,
  );
  assert.match(css, /\.mobile-header-backdrop::before/);
  assert.match(css, /\.mobile-nav-compact::before/);
  assert.match(css, /filter: blur\(14px\)/);
  assert.match(source, /button.setAttribute\('aria-label', button.textContent\)/);
  assert.match(source, /button.dataset.compactLabel = label/);
});

test('standalone ranch preserves existing data and purchases while the profile is only a linked scene', () => {
  assert.match(read('server.js'), /\['\/ranch', '\/ranch.html'\]/);
  for (const html of ['public/profile.html', 'public/ranch.html']) {
    assert.match(read(html), /src="\/ranch-page.js"/);
    assert.match(read(html), /href="\/ranch-page.css"/);
  }
  assert.match(source, /link.href = `\/ranch\?uid=\$\{uid\}`/);
  assert.match(source, /root.replaceChildren\(link, message\)/);
  assert.match(source, /if \(isOwner\)/);
  assert.match(source, /dialog.isConnected && openPanel === id/);
  assert.match(source, /data-extra-action="feed"/);
  assert.match(source, /data-item-key="fish"/);
  assert.match(source, /data-item-key="rubber_rod"/);
  assert.match(source, /data-item-key="max_pet"/);
  assert.doesNotMatch(source, /\/purchase|POST/);
  const app = read('public/app.js');
  assert.match(app, /isCurrentPath\('\/profile'\) \|\| isCurrentPath\('\/ranch'\)/);
  assert.match(app, /\(!isElectromagneticPage\(\) && !isCurrentPath\('\/ranch'\)\)/);
});

test('four compressed local photos and supply imagery exist, with mobile and keyboard styles', () => {
  for (const season of Object.keys(seasons)) {
    const image = fs.readFileSync(path.join(__dirname, `../public/assets/ranch/${season}.webp`));
    assert.equal(image.toString('ascii', 8, 12), 'WEBP');
    assert.ok(image.length < 500000);
  }
  for (const match of source.matchAll(/src="(\/assets\/[^"$]+)"/g))
    assert.ok(fs.existsSync(path.join(__dirname, '../public', match[1])), match[1]);
  const css = read('public/ranch-page.css');
  assert.match(css, /html:has\(body.ranch-page\)[^{]*\{\s*overflow: hidden;/);
  assert.match(css, /ranch-preview-link:focus-visible/);
  assert.match(css, /ranch-drawer::backdrop/);
});

test('ranch supplies load the shared full-row purchase layout, including mobile styles', () => {
  const html = read('public/ranch.html');
  const economy = read('public/economy.css');
  assert.match(html, /<body class="[^"]*ranch-page[^"]*economy-page/);
  assert.match(html, /href="\/economy.css"/);
  assert.match(
    economy,
    /\.economy-page \.shop-inspect-actions\s*\{[^}]*grid-column: 1 \/ -1;[^}]*grid-template-columns: 1fr;/,
  );
  assert.match(
    economy,
    /@media \(max-width: 600px\)[\s\S]*?\.economy-page \.shop-inspect-layout\s*\{\s*grid-template-columns: 1fr;/,
  );
});

test('photo motion pauses with the actor, tab visibility and reduced-motion preferences', () => {
  const css = read('public/ranch-page.css');
  assert.match(
    source,
    /scene.classList.toggle\('is-paused', pause.getAttribute\('aria-pressed'\) === 'true'\)/,
  );
  assert.match(source, /document.addEventListener\('visibilitychange'/);
  assert.match(source, /scene.classList.toggle\('is-background-hidden', document.hidden\)/);
  assert.match(
    css,
    /\.ranch-scene:is\(\.is-paused, \.is-background-hidden\)[^{]*\{\s*animation-play-state: paused;/,
  );
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation: none;/);
  assert.match(
    css,
    /@media \(max-width: 600px\)[\s\S]*?\.ranch-page \[data-max-actor\]\s*\{\s*width: min\(180px, 100%\)/,
  );
});
