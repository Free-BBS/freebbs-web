const test = require('node:test');
const assert = require('node:assert/strict');
const {
  safePath,
  selectFiles,
  excerpt,
  createGithubCode,
  wantsWebsiteCode,
} = require('./github-code');
const { enrichAgentSiteContext } = require('./agent-site');
test('repository retrieval selects safe relevant source and excludes secrets and symlinks', () => {
  const tree = [
    'public/auth.js',
    'backend/server.js',
    'public/app.js',
    'README.md',
    '.env',
    'uploads/private.js',
    '../secret.js',
    'backend/secrets.js',
    'backend/auth.test.js',
  ].map((path) => ({ path, type: 'blob', mode: '100644', size: 10 }));
  tree.push({ path: 'public/login.js', type: 'blob', mode: '120000', size: 10 });
  assert.deepEqual(
    selectFiles(tree, '网站登录失败')
      .map((x) => x.path)
      .sort(),
    ['README.md', 'backend/server.js', 'public/app.js', 'public/auth.js'].sort(),
  );
  assert.equal(safePath('.env'), false);
  assert.equal(wantsWebsiteCode('讲解牛顿第二定律'), false);
  assert.equal(wantsWebsiteCode('网站为什么无法登录'), true);
});
test('excerpts find the implementation and preserve source line numbers', () => {
  const lines = Array.from({ length: 150 }, (_, i) => '// filler ' + i);
  lines[70] = 'async function restoreSession() {';
  lines[71] = '  await callApi("/auth/me");';
  const result = excerpt(lines.join('\n'), '手机登录后又掉线');
  assert.ok(result.some((part) => part.text.includes('71: async function restoreSession')));
});
test('code retrieval pins content to commit and caches tree and files', async () => {
  const sha = 'a'.repeat(40);
  let count = 0;
  const read = createGithubCode({
    fetchImpl: async (url) => {
      count++;
      assert.ok(
        url.startsWith('https://api.github.com/repos/Free-BBS/freebbs-web/') ||
          url.startsWith('https://raw.githubusercontent.com/Free-BBS/freebbs-web/' + sha + '/'),
      );
      return {
        ok: true,
        json: async () =>
          url.includes('/commits/')
            ? { sha }
            : { tree: [{ path: 'public/auth.js', mode: '100644', type: 'blob', size: 100 }] },
        text: async () => 'function restoreSession() { return "fixture"; }',
      };
    },
  });
  const result = await read('网站登录');
  assert.equal(result.files.length, 1);
  assert.match(result.files[0].url, new RegExp(sha));
  await read('网站登录');
  assert.equal(count, 3);
});
test('website questions and followups proactively read code and logs, learning questions do not', async () => {
  let code = 0,
    logs = 0;
  const options = {
    publicWebUrl: 'https://www.free-bbs.cn',
    service: { search: async () => ({ results: [], query: '', type: 'all' }) },
    githubReader: async () => {
      logs++;
      return { commits: [] };
    },
    githubCodeReader: async () => {
      code++;
      return {
        files: [{ path: 'public/auth.js', excerpts: [{ text: 'function restoreSession() {}' }] }],
      };
    },
  };
  const answer = await enrichAgentSiteContext({ message: '网站登录怎么实现' }, options);
  assert.match(answer.message, /restoreSession/);
  assert.equal(code, 1);
  assert.equal(logs, 1);
  await enrichAgentSiteContext(
    {
      messages: [
        { role: 'user', content: '网站登录怎么实现' },
        { role: 'assistant', content: '会恢复会话' },
        { role: 'user', content: '为什么这样做' },
      ],
    },
    options,
  );
  assert.equal(code, 2);
  await enrichAgentSiteContext({ message: '牛顿第二定律是什么' }, options);
  assert.equal(code, 2);
  const failed = await enrichAgentSiteContext(
    { message: '网站登录' },
    {
      ...options,
      githubCodeReader: async () => {
        throw Error('offline');
      },
    },
  );
  assert.match(failed.message, /代码读取失败/);
});
