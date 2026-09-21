const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  settingsProfileHref,
  createSettingsProfileLink,
} = require('../public/settings-profile-link');

function fixture(user = { isLoggedIn: true, uid: 'u_preview01' }) {
  const events = {};
  const clicks = {};
  const link = {
    hidden: true,
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
    addEventListener(name, handler) {
      clicks[name] = handler;
    },
  };
  const app = { userState: user, sessionReady: Promise.resolve() };
  createSettingsProfileLink(
    {
      addEventListener(name, handler) {
        events[name] = handler;
      },
    },
    { getElementById: () => link },
    app,
  );
  return { app, events, clicks, link };
}

test('settings profile link waits for the active account and follows its UID', async () => {
  const h = fixture();
  assert.equal(h.link.hidden, true);
  await h.app.sessionReady;
  assert.equal(h.link.hidden, false);
  assert.equal(h.link.attributes.href, '/profile?uid=u_preview01');
  h.app.userState = { isLoggedIn: true, uid: 'u_preview02' };
  h.events['freebbs:session-change']();
  assert.equal(h.link.attributes.href, '/profile?uid=u_preview02');
});

test('logout and cross-tab credential changes remove stale profile links without account writes', async () => {
  const h = fixture();
  await h.app.sessionReady;
  h.events.storage({ key: 'free_bbs_theme_mode' });
  assert.equal(h.link.hidden, false);
  h.events.storage({ key: 'free_bbs_auth_token' });
  assert.equal(h.link.hidden, true);
  assert.equal(h.link.attributes.href, undefined);
  let prevented = false;
  h.clicks.click({
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  h.app.userState = { isLoggedIn: true, uid: 'u_preview02' };
  h.events['freebbs:session-change']();
  assert.equal(h.link.attributes.href, '/profile?uid=u_preview02');
  h.app.userState = { isLoggedIn: false, uid: '' };
  h.events['freebbs:session-change']();
  assert.equal(h.link.hidden, true);
  assert.equal(h.link.attributes.href, undefined);
});

test('profile destinations stay on the profile route and accept the existing UID formats', () => {
  for (const uid of ['u_preview01', 'uabcdef12', 'u_abcdef12', '2025012345'])
    assert.equal(settingsProfileHref({ isLoggedIn: true, uid }), `/profile?uid=${uid}`);
  for (const uid of ['', '../admin', 'https://other.example/u_preview01', 'u_abc&admin=true'])
    assert.equal(settingsProfileHref({ isLoggedIn: true, uid }), '');
  assert.equal(settingsProfileHref({ isLoggedIn: false, uid: 'u_preview01' }), '');
});

test('settings keeps its real editors and account controls while exposing one single-column profile entry', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/settings.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../public/settings-guide.css'), 'utf8');
  assert.match(html, /<body class="settings-page">/);
  assert.equal((html.match(/id="settings-profile-link"/g) || []).length, 1);
  assert.match(html, /前往我的主页/);
  for (const id of [
    'settings-form',
    'settings-avatar-editor',
    'settings-full-name',
    'settings-bio',
    'settings-website-url',
    'settings-font-preset',
    'settings-type-scale',
    'settings-username-form',
    'settings-password-form',
  ])
    assert.ok(html.includes(`id="${id}"`), `preserves ${id}`);
  assert.ok(html.indexOf('/settings-profile-link.js') > html.indexOf('/app.js'));
  assert.match(
    css,
    /body\.settings-page \.settings-shell\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\)/,
  );
  assert.match(css, /body\.settings-page \.settings-profile-link\s*\{[^}]*margin-left: auto/);
  assert.doesNotMatch(css, /font-family:|body\.public-profile-page/);
});
