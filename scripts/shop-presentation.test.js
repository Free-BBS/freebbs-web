const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const publicDir = path.join(__dirname, '../public');
const html = fs.readFileSync(path.join(publicDir, 'electromagnetic.html'), 'utf8');
const css = fs.readFileSync(path.join(publicDir, 'shop-presentation.css'), 'utf8');
const app = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
const hero = html.match(/<header class="economy-header shop-hero">([\s\S]*?)<\/header>/)[1];
const navigation = html.match(/<nav class="shop-category-nav"[^>]*>([\s\S]*?)<\/nav>/)[1];

test('storefront category links follow the real catalog groups and existing guide targets', () => {
  const context = vm.createContext({});
  vm.runInContext(
    app.slice(
      app.indexOf('function groupShopItems('),
      app.indexOf('async function loadElectromagneticPage('),
    ),
    context,
  );
  const catalog = JSON.parse(fs.readFileSync(path.join(publicDir, 'data/shop-items.json')));
  const groups = context.groupShopItems(catalog.items);
  const links = [...navigation.matchAll(/<a href="([^"]+)">[\s\S]*?<span>([^<]+)<\/span>/g)];
  assert.equal(links.length, groups.length);
  groups.forEach((group, index) => {
    assert.equal(links[index][1], `#shop-section-${group.key}`);
    assert.equal(links[index][2], group.title);
  });
  ['shop-grid', 'economy-balance-row', 'economy-message'].forEach((id) => {
    assert.equal([...html.matchAll(new RegExp(`id="${id}"`, 'g'))].length, 1);
  });
  assert.match(hero, /class="economy-inventory-link" href="\/inventory"/);
  assert.match(hero, /<h1>电磁场商城<\/h1>/);
  const message = html.match(/<p\s[^>]*id="economy-message"[^>]*>/)[0];
  assert.match(message, /role="status"/);
  assert.match(message, /aria-live="polite"/);
});

test('storefront art uses available local assets and stays decorative', () => {
  [...`${hero}${navigation}`.matchAll(/<img src="([^"]+)"[^>]*>/g)].forEach(([tag, src]) => {
    assert.ok(src.startsWith('/assets/'));
    assert.ok(fs.existsSync(path.join(publicDir, src)));
    assert.match(tag, /alt=""/);
  });
  assert.match(hero, /class="shop-hero-art" aria-hidden="true"/);
  assert.equal([...html.matchAll(/href="\/shop-presentation.css"/g)].length, 1);
  assert.doesNotMatch(html, /src="\/shop-presentation.js"/);
});

test('category signs keep real labels and artwork uses the entire square display area', () => {
  assert.equal([...navigation.matchAll(/<small>[^<]+<\/small>/g)].length, 4);
  assert.match(
    css,
    /\.shop-section-heading h2\s*\{[^}]*border: 1\.5px solid var\(--shop-sign-line\)/,
  );
  assert.match(css, /\.shop-item-card \.shop-item-image\s*\{[^}]*aspect-ratio: 1/);
  assert.match(
    css,
    /\.shop-item-card \.shop-item-image img\s*\{[^}]*width: 100%;[^}]*height: 100%;[^}]*object-fit: contain/,
  );
  assert.doesNotMatch(css, /content:\s*['"][^'"]+['"]/);
});

test('storefront visual overrides stay page scoped and preserve responsive access', () => {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const selectorBlocks = [...withoutComments.matchAll(/(?:^|[{}])\s*([^{}]+)\{/g)];
  selectorBlocks.forEach(([, selector]) => {
    if (selector.trim().startsWith('@')) return;
    selector.split(',').forEach((part) => {
      assert.ok(part.trim().startsWith('body.electromagnetic-page'), part);
    });
  });
  assert.match(css, /\.shop-section-heading h2\s*\{[^}]*scroll-margin-top:/);
  assert.match(css, /\.shop-category-nav a:focus-visible/);
  assert.match(css, /body\.electromagnetic-page\.theme-dark/);
  assert.match(css, /repeat\(auto-fill, minmax\(min\(100%, 214px\), 1fr\)\)/);
  assert.match(css, /@media \(max-width: 600px\)/);
  assert.match(css, /@media \(max-width: 359px\)/);
  assert.doesNotMatch(css, /\.shop-inspect|data-action|linear-gradient/);
});

test('appearance has a richer real-preview stage while objects stay visually restrained', () => {
  assert.match(css, /\.shop-section\[data-shop-section='appearance'\]/);
  assert.match(css, /\.shop-item-image::before\s*\{[^}]*pointer-events: none/);
  for (const productClass of [
    'device',
    'collectible',
    'scholar_relic',
    'converter',
    'consumable',
  ]) {
    assert.match(css, new RegExp(`data-product-class='${productClass}'`));
  }
  assert.match(css, /filter: saturate\(0\.82\) contrast\(0\.97\)/);
});
