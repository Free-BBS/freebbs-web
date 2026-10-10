const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const cheerio = require('cheerio');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const pages = {
  'login.html': 1,
  'register.html': 2,
  'remake.html': 2,
  'settings.html': 12,
  'adminusers.html': 2,
  'aichat.html': 3,
  'discussion.html': 2,
  'guide.html': 4,
  'inventory.html': 7,
  'knowledge.html': 11,
  'markdown-editor.html': 1,
  'publish.html': 1,
  'staff.html': 1,
  'surveys.html': 1,
  'system-settings-course-materials.html': 1,
  'system-settings-model.html': 2,
  'system-settings-rewards.html': 9,
  'system-settings-surveys.html': 9,
  'tool-workshop.html': 8,
  'workbench.html': 27,
};

for (const [file, count] of Object.entries(pages)) {
  test(`${file} migrates only explicit ordinary action roles`, () => {
    const $ = cheerio.load(read(`public/${file}`));
    const roles = $('.bbs-action');
    assert.equal(roles.length, count);
    roles.each((_, element) => {
      assert.ok(['button', 'a'].includes(element.tagName));
      const node = $(element);
      assert.match(node.attr('data-action-tone') || '', /^(primary|secondary|quiet|danger)$/);
      assert.equal(
        node
          .attr('class')
          .split(/\s+/)
          .filter((value) => value === 'bbs-action').length,
        1,
      );
      assert.ok(node.text().trim(), 'ordinary controls must retain their accessible text');
    });
    $('[data-action-tone]').each((_, element) => assert.ok($(element).hasClass('bbs-action')));
  });
}

test('destructive operations and normal submits retain explicit distinct roles', () => {
  const cases = [
    ['settings', '#settings-logout-button', 'danger'],
    ['settings', '[data-avatar-action="confirm"]', 'primary'],
    ['settings', '[data-avatar-action="cancel"]', 'secondary'],
    ['knowledge', '#knowledge-editor-discard-confirm', 'danger'],
    ['system-settings-model', '#system-model-api-key-clear', 'danger'],
    ['system-settings-rewards', '#reward-confirm-send', 'primary'],
    ['workbench', '#workbench-campus-disconnect', 'danger'],
    ['workbench', '#workbench-schedule-delete', 'danger'],
    ['workbench', '#workbench-course-import-confirm', 'primary'],
  ];
  for (const [file, selector, tone] of cases) {
    const $ = cheerio.load(read(`public/${file}.html`));
    assert.equal($(selector).attr('data-action-tone'), tone, `${file} ${selector}`);
  }
  const workbench = cheerio.load(read('public/workbench.html'));
  assert.equal(
    workbench('.workbench-course-import-toolbar [type="submit"]').attr('data-action-tone'),
    'secondary',
  );
});

test('migration keeps native hiding, disabling, and delegated business selectors', () => {
  const settings = cheerio.load(read('public/settings.html'));
  for (const action of ['confirm', 'cancel']) {
    const button = settings(`[data-avatar-action="${action}"]`);
    assert.ok(button.is('[hidden]'));
    assert.equal(button.attr('type'), 'button');
  }
  const inventory = cheerio.load(read('public/inventory.html'));
  assert.ok(inventory('#wallet-ledger-more').is('[hidden]'));
  const surveys = cheerio.load(read('public/system-settings-surveys.html'));
  assert.ok(surveys('#previous-page').is('[disabled]'));
  assert.ok(surveys('#export').is('[disabled]'));
  const tool = cheerio.load(read('public/tool-workshop.html'));
  assert.ok(tool('#tool-cancel').is('[hidden]'));
});

test('icon toggles, tabs, scenic controls and editor tools are not ordinary actions', () => {
  const cases = [
    ['knowledge.html', '#knowledge-tools-toggle, #knowledge-chat-toggle, .knowledge-tag-button'],
    ['markdown-editor.html', '#markdown-upload-button'],
    ['system-settings-model.html', '#system-model-api-key-toggle'],
    [
      'workbench.html',
      '#workbench-companion-avatar, #workbench-week-previous, #workbench-view-toggle',
    ],
    ['discussion.html', '.discussion-filter-chip'],
  ];
  for (const [file, selector] of cases) {
    const $ = cheerio.load(read(`public/${file}`));
    assert.ok($(selector).length, `exception selector must remain current: ${file}`);
    assert.equal($(selector).filter('.bbs-action').length, 0);
  }
  for (const file of [
    'world.html',
    'circuit.html',
    'circuit-challenge.html',
    'course-map-editor.html',
  ]) {
    assert.equal(cheerio.load(read(`public/${file}`))('.bbs-action').length, 0, file);
  }
  for (const file of Object.keys(pages)) {
    const $ = cheerio.load(read(`public/${file}`));
    assert.equal($('.avatar, .user-name, .user-icon-button').filter('.bbs-action').length, 0);
  }
});

test('survey factory maps normal and destructive roles without changing its session guard', () => {
  const source = read('public/system-settings-surveys.js');
  const factory = source
    .match(/ {2}function button\([\s\S]*?\n {2}function entryRows/)[0]
    .replace(/\n {2}function entryRows$/, '');
  let allowed = true;
  let live = true;
  let invoked = 0;
  const context = {
    allowed,
    current: () => live,
    capture: () => ({}),
    message() {},
    report() {},
    el: () => ({ classList: { add() {} }, dataset: {} }),
  };
  vm.runInNewContext(`${factory}\nthis.makeButton = button;`, context);
  const secondary = context.makeButton('编辑', () => {
    invoked += 1;
  });
  const primary = context.makeButton('发布活动', () => {}, false);
  const danger = context.makeButton(
    '取消本期',
    () => {
      invoked += 1;
    },
    true,
    'danger',
  );
  assert.equal(secondary.dataset.actionTone, 'secondary');
  assert.equal(primary.dataset.actionTone, 'primary');
  assert.equal(danger.dataset.actionTone, 'danger');
  return (async () => {
    await secondary.onclick();
    assert.equal(invoked, 1);
    assert.equal(secondary.disabled, false);
    live = false;
    await danger.onclick();
    assert.equal(invoked, 1);
    allowed = false;
    context.allowed = allowed;
    await primary.onclick();
    assert.equal(primary.disabled, undefined);
  })();
});

test('dynamic DOM roles remain explicit and do not appropriate business data-action', () => {
  for (const file of [
    'surveys.js',
    'system-settings-surveys.js',
    'course-upload.js',
    'admin-rewards.js',
    'admin-account-credentials.js',
  ]) {
    const source = read(`public/${file}`);
    assert.match(source, /bbs-action/);
    assert.match(source, /actionTone|data-action-tone/);
    assert.doesNotMatch(
      source,
      /dataset\.action\s*=|data-action=["'](?:primary|secondary|quiet|danger)/,
    );
  }
  assert.match(
    read('public/surveys.js'),
    /link\.dataset\.actionTone = status\(survey\) === '报名中' \? 'primary' : 'secondary'/,
  );
  assert.match(read('public/course-upload.js'), /revoke\.dataset\.actionTone = 'danger'/);
  assert.match(
    read('public/admin-account-credentials.js'),
    /button\.dataset\.actionTone = action === 'approve' \? 'primary' : 'danger'/,
  );
});

test('legacy paint adapters keep their old fallbacks and cannot move ordinary role targets', () => {
  const actions = read('public/actions.css');
  assert.match(actions, /--action-target-transform:\s*none;/);
  assert.match(
    actions,
    /\.bbs-action:active:not\(:disabled, \[aria-disabled='true'\]\)\s*\{\s*--action-fill:\s*var\(--action-hover-fill\);/,
  );
  assert.match(
    actions,
    /\.bbs-action\[aria-disabled='true'\]\s*\{\s*--action-hover-fill:\s*var\(--action-fill\);/,
  );
  for (const file of [
    'surveys.css',
    'course-upload.css',
    'account-identity.css',
    'tool-workshop.css',
  ]) {
    const css = read(`public/${file}`);
    assert.match(css, /var\(--action-foreground, /, file);
    assert.match(css, /var\(--action-fill, /, file);
    assert.doesNotMatch(
      css,
      /--action-(?:fill|foreground|target-transform)\s*:/,
      'legacy adapters must not opt their entire page into a role',
    );
  }
  assert.match(
    read('public/page-transitions.css'),
    /\.settings-logout-button:active:where\(:not\(\.bbs-action\)\)/,
  );
  assert.match(
    read('public/adminusers.css'),
    /\.admin-button:not\(:disabled\):active:where\(:not\(\.bbs-action\)\)/,
  );
  assert.match(
    read('public/tool-workshop.css'),
    /transform:\s*var\(--action-target-transform, translateY\(1px\)\)/,
  );
  assert.match(
    read('public/tool-workshop.css'),
    /transform:\s*scale\(0\.25\)/,
    'embedded tool viewport transforms remain unchanged',
  );
});

module.exports = { pages };
