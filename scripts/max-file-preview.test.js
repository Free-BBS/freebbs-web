const test = require('node:test');
const assert = require('node:assert/strict');
const { split } = require('../public/max-file-preview');
test('sent and restored file messages expose a short question and separate preview content', () => {
  const message =
    '帮我总结\n\n--- 附件：notes.md ---\n# 正文\n' + '长文字'.repeat(1000) + '\n--- 附件结束 ---';
  const result = split(message);
  assert.equal(result.text, '帮我总结');
  assert.equal(result.files[0].name, 'notes.md');
  assert.match(result.files[0].text, /长文字/);
  assert.deepEqual(split('普通问题'), { text: '普通问题', files: [] });
});
