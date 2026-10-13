const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { NOTICE_VERSION, noticeFor } = require('../backend/moderation-production');

const source = fs.readFileSync(path.join(__dirname, '../public/moderation-notice.js'), 'utf8');
function confirm(status, isCurrent = () => true) {
  const window = {};
  vm.runInNewContext(source, { window }); // No DOM: submitting never opens a dialog.
  return window.FreeBbsModerationNotice.confirm({
    callApi: async (url) => {
      assert.equal(url, '/privacy-policy/status');
      return status;
    },
    isCurrent,
  });
}
test('post submission reuses persisted policy acknowledgement without a popup', async () => {
  assert.equal(await confirm({ accepted: true, version: NOTICE_VERSION }), NOTICE_VERSION);
  assert.equal(noticeFor().required, false);
  assert.equal(noticeFor().policyUrl, '/privacy');
});
test('absent or malformed confirmation cannot continue upload or submission', async () => {
  for (const status of [
    undefined,
    {},
    { accepted: false },
    { accepted: true },
    { accepted: true, version: '' },
  ])
    await assert.rejects(confirm(status), /请先登录并确认隐私政策/);
});
test('changing account while checking policy cannot reuse the previous account status', async () => {
  await assert.rejects(
    confirm({ accepted: true, version: NOTICE_VERSION }, () => false),
    /登录状态/,
  );
});
