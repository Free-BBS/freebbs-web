const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../public/ranch-page.js'), 'utf8');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const environment = require('../public/ranch-environment');

const { seasons } = environment;
function functionSource(name, next) {
  return source.slice(source.indexOf(`function ${name}(`), source.indexOf(`function ${next}(`));
}

test('automatic seasons follow Beijing boundaries, independent of stored preferences', () => {
  for (const [date, expected] of [
    ['2026-02-28T15:59:59Z', 'winter'],
    ['2026-02-28T16:00:00Z', 'spring'],
    ['2026-06-01T00:00:00Z', 'summer'],
    ['2026-09-27T00:00:00Z', 'autumn'],
    ['2026-12-01T00:00:00Z', 'winter'],
  ]) {
    assert.equal(environment.seasonAt(Date.parse(date)), expected);
  }
  assert.equal(environment.nextMidnight(Date.parse('2026-02-28T15:59:59Z')), 1000);
  assert.equal(environment.nextMidnight(Date.parse('2026-02-28T16:00:00Z')), 86400000);
  for (const choice of ['lake', 'courtyard', 'wall', 'meadow', '<script>', 'toString', null]) {
    assert.equal(
      environment.readScene({ getItem: () => choice }),
      ['lake', 'courtyard', 'wall'].includes(choice) ? choice : 'meadow',
    );
  }
  assert.equal(
    environment.readScene({
      getItem() {
        throw new Error('denied');
      },
    }),
    'meadow',
  );
  assert.doesNotMatch(source, /freebbs_ranch_season|data-ranch-season-choice/);
});

test('scene selection and theme update the photo and chrome without transactions', () => {
  const caption = {};
  const buttons = Object.keys(environment.scenes).map((key) => ({
    dataset: { ranchSceneChoice: key },
    setAttribute(name, value) {
      this[name] = value;
    },
  }));
  const style = {
    setProperty(key, value) {
      this[key] = value;
    },
  };
  const root = {
    dataset: {},
    style: { ...style },
    querySelector: () => caption,
    querySelectorAll: () => buttons,
  };
  const body = { classList: { contains: () => true }, dataset: {}, style: { ...style } };
  const context = {
    environment: { ...environment, seasonAt: () => 'summer' },
    currentScene: 'lake',
    document: { body },
  };
  vm.runInNewContext(functionSource('syncEnvironment', 'refreshEnvironment'), context);
  context.syncEnvironment(root);
  assert.equal(root.dataset.ranchSeason, 'summer');
  assert.equal(body.dataset.ranchSeason, 'summer');
  assert.equal(caption.textContent, '北京 · 夏 · 白天');
  assert.equal(root.style['--ranch-photo'], 'url("/assets/ranch/lake/summer.webp")');
  assert.deepEqual(
    buttons.map((button) => button['aria-pressed']),
    ['false', 'true', 'false', 'false'],
  );
  body.classList.contains = () => false;
  context.currentScene = 'wall';
  context.syncEnvironment(root);
  assert.equal(root.dataset.ranchPeriod, 'night');
  assert.equal(body.dataset.ranchScene, 'lake', 'profile preview must not theme shared chrome');
  assert.doesNotMatch(functionSource('syncEnvironment', 'panel'), /fetch|callApi/);
  assert.match(source, /attributeFilter: \['class'\]/);
  assert.match(source, /environment.nextMidnight\(\)/);
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
  assert.match(css, /body.ranch-page \.ranch-sidebar-backdrop::before/);
  assert.match(css, /inset: 0 0 0 var\(--bbs-shell-width, 240px\)/);
  assert.match(css, /\[data-ranch-period='night'\] \.ranch-scenery/);
  assert.match(source, /button.setAttribute\('aria-label', button.textContent\)/);
  assert.match(source, /button.dataset.compactLabel = label/);
});

test('blurred sidebar scenery cannot expand or isolate the navigation scroll container', () => {
  const css = read('public/ranch-page.css');
  assert.match(source, /document.body.append\(sidebarBackdrop\)/);
  assert.match(css, /\.ranch-sidebar-backdrop\s*\{[^}]*position: fixed;[^}]*overflow: hidden;/);
  assert.doesNotMatch(css, /\.topbar::before/);
  assert.match(css, /\.topbar\s*\{[^}]*isolation: auto;[^}]*scrollbar-width: none;/);
});

test('standalone ranch preserves existing data and purchases while the profile is only a linked scene', () => {
  assert.match(read('server.js'), /\['\/ranch', '\/ranch.html'\]/);
  for (const html of ['public/profile.html', 'public/ranch.html']) {
    assert.ok(read(html).indexOf('/ranch-environment.js') < read(html).indexOf('/ranch-page.js'));
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

test('all four scenes have four compressed local seasonal photos', () => {
  for (const scene of Object.keys(environment.scenes))
    for (const season of Object.keys(seasons)) {
      const image = fs.readFileSync(
        path.join(__dirname, '../public', environment.photo(scene, season)),
      );
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
