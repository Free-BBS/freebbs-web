const test = require('node:test');
const assert = require('node:assert/strict');
const { createGithubUpdates, wantsGithubUpdates } = require('./github-updates');
const { enrichAgentSiteContext } = require('./agent-site');
test('GitHub updates use fixed public URLs, bounded content and shared cache', async () => {
  const calls = [];
  const read = createGithubUpdates({
    fetchImpl: async (url, options) => {
      calls.push(url);
      assert.equal(options.headers.Authorization, undefined);
      return {
        ok: true,
        json: async () =>
          url.includes('/commits')
            ? [{ sha: 'a'.repeat(40), commit: { message: '更新'.repeat(2000) } }]
            : [{ name: 'v1', tag_name: 'v1', body: 'x'.repeat(9000), draft: false }],
      };
    },
  });
  const [a, b] = await Promise.all([read(), read()]);
  assert.equal(calls.length, 2);
  assert.equal(a, b);
  assert.equal(await read(), a);
  assert.equal(a.commits[0].title.length, 1800);
  assert.equal(a.releases[0].text.length, 5000);
  assert.match(a.commits[0].url, /github.com\/Free-BBS\/freebbs-web\/commit/);
});
test('ordinary questions do not fetch GitHub; update questions receive citations and failure is explicit', async () => {
  assert.equal(wantsGithubUpdates('解释电场'), false);
  const options = {
    githubCodeReader: async () => ({ files: [] }),
    publicWebUrl: 'https://www.free-bbs.cn',
    service: {},
    githubReader: async () => ({
      commits: [{ title: '修复评论', url: 'https://github.com/Free-BBS/freebbs-web/commit/abc' }],
    }),
  };
  const result = await enrichAgentSiteContext({ message: '最近更新了什么' }, options);
  assert.match(result.message, /修复评论/);
  assert.match(result.message, /不代表这些改动已经部署/);
  assert.match(result.message, /\[【1】\]/);
  const failed = await enrichAgentSiteContext(
    { message: '更新日志' },
    {
      ...options,
      githubReader: async () => {
        throw Error('offline');
      },
    },
  );
  assert.match(failed.message, /读取失败/);
  await enrichAgentSiteContext(
    { message: '你好' },
    { ...options, githubReader: () => assert.fail('unexpected fetch') },
  );
});
