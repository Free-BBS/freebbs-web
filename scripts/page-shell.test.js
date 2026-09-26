const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { preparePageShell, SITE_FOOTER } = require('../page-shell');

const root = path.join(__dirname, '../public');

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
      assert.equal(result.split('src="/typography.js"').length - 1, 1);
      assert.match(result, /<body[^>]*>\s*<script src="\/typography.js"><\/script>/);
    }
    assert.ok(preparePageShell(result) === result, 'shared transform is idempotent');
  });
}
