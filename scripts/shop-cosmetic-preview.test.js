const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ranch = require('../public/max-ranch');

const root = path.join(__dirname, '../public');
const extrasSource = fs.readFileSync(path.join(root, 'profile-extras.js'), 'utf8');
function previews() {
  const context = vm.createContext({
    window: { addEventListener() {}, FreeBbsMaxRanch: ranch },
    document: { addEventListener() {} },
  });
  vm.runInContext(extrasSource, context);
  return context.window.FreeBbsProfileExtras;
}

test('frames, nameplates and themes reuse actual equipped markup without user content', () => {
  const extras = previews();
  for (const key of ['frame_orbit', 'frame_aurora']) {
    const html = extras.cosmeticPreview(key);
    assert.match(html, new RegExp(`data-frame="${key}"`));
    assert.match(html, new RegExp(`data-avatar-frame="${key}"`));
    assert.match(html, /class="public-profile-avatar-wrap"/);
    assert.doesNotMatch(html, /max-cartoon-v1/);
  }
  assert.ok(extras.cosmeticPreview('plate_observer').includes(extras.badge('plate_observer')));
  for (const key of ['card_blueprint', 'card_twilight']) {
    const html = extras.cosmeticPreview(key);
    assert.match(html, /class="public-profile-shell shop-preview-profile"/);
    assert.match(html, new RegExp(`data-profile-card="${key}"`));
    assert.match(html, /class="profile-ambience"/);
    assert.match(html, /class="profile-constellation"/);
  }
  assert.equal(extras.cosmeticPreview('<script>alert(1)</script>'), '');
  assert.equal(extras.cosmeticPreview('fish'), '');
});

test('Max shop sample shares the real sheep and all four static limbs without mounting an actor', () => {
  const html = previews().ranchPreview();
  assert.ok(html.includes(ranch.previewMarkup()));
  assert.equal([...html.matchAll(/data-leg="/g)].length, 4);
  assert.equal([...html.matchAll(/data-limb d="M/g)].length, 4);
  assert.equal([...html.matchAll(/data-hoof d="M/g)].length, 4);
  assert.match(html, /data-max-glasses/);
  assert.doesNotMatch(html, /data-extra-action|data-max-actor|data-ranch-greet|<button/);
  const body = extrasSource.slice(
    extrasSource.indexOf('function ranchPreview('),
    extrasSource.indexOf("document.addEventListener('DOMContentLoaded'"),
  );
  assert.doesNotMatch(body, /mount\(|setTimeout|requestAnimationFrame/);
});

test('shop, inventory and detail all use the same preview resolver and load the shared sheep first', () => {
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.equal([...app.matchAll(/renderShopItemMedia\(/g)].length, 5);
  for (const file of ['electromagnetic.html', 'inventory.html']) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(html.indexOf('src="/max-ranch.js"') < html.indexOf('src="/profile-extras.js"'));
  }
});
