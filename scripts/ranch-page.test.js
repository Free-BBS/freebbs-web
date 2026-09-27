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
  const context = { seasons, currentSeason: undefined };
  vm.runInNewContext(functionSource('applySeason', 'panel'), context);
  context.applySeason(root, 'summer');
  assert.equal(root.dataset.ranchSeason, 'summer');
  assert.equal(caption.textContent, '北京 · 草木');
  assert.deepEqual(
    buttons.map((button) => button['aria-pressed']),
    ['false', 'true', 'false', 'false'],
  );
  context.applySeason(root, 'invalid');
  assert.equal(root.dataset.ranchSeason, 'summer');
  assert.doesNotMatch(functionSource('applySeason', 'panel'), /fetch|callApi/);
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
  assert.match(css, /100svh - 216px/);
  assert.match(css, /ranch-preview-link:focus-visible/);
  assert.match(css, /ranch-drawer::backdrop/);
});
