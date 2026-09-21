const ROOT = 'https://api.github.com/repos/Free-BBS/freebbs-web';
const WEB = 'https://github.com/Free-BBS/freebbs-web';
function wantsGithubUpdates(question) {
  return /github|更新日志|更新记录|版本变化|最近.{0,8}(?:更新|改动)|更新了什么|changelog|release/i.test(
    question,
  );
}
function createGithubUpdates({ fetchImpl = fetch, now = Date.now } = {}) {
  let cached;
  let pending;
  return async function read() {
    if (cached && now() - cached.time < 5 * 60 * 1000) return cached.value;
    if (pending) return pending;
    pending = (async () => {
      const get = async (path) => {
        const response = await fetchImpl(ROOT + path, {
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Free-BBS-Max' },
          signal: AbortSignal.timeout(7000),
          redirect: 'error',
        });
        if (!response.ok) throw new Error('GitHub 查询暂不可用');
        const data = await response.json();
        if (!Array.isArray(data)) throw new Error('GitHub 返回格式无效');
        return data;
      };
      const results = await Promise.allSettled([
        get('/commits?sha=main&per_page=12'),
        get('/releases?per_page=3'),
      ]);
      if (results.every((result) => result.status === 'rejected'))
        throw new Error('GitHub 查询暂不可用');
      const commits =
        results[0].status === 'fulfilled'
          ? results[0].value
              .filter((item) => /^[a-f0-9]{40}$/.test(item.sha))
              .map((item) => ({
                title: String(item.commit?.message || '').slice(0, 1800),
                date: item.commit?.committer?.date,
                url: WEB + '/commit/' + item.sha,
              }))
          : [];
      const releases =
        results[1].status === 'fulfilled'
          ? results[1].value
              .filter((item) => !item.draft)
              .map((item) => ({
                title: String(item.name || item.tag_name || '').slice(0, 160),
                date: item.published_at,
                text: String(item.body || '').slice(0, 5000),
                url: WEB + '/releases/tag/' + encodeURIComponent(item.tag_name),
                prerelease: Boolean(item.prerelease),
              }))
          : [];
      const value = {
        repository: WEB,
        branch: 'main',
        fetchedAt: new Date(now()).toISOString(),
        commits,
        releases,
        notices: results.some((result) => result.status === 'rejected')
          ? ['部分 GitHub 数据暂不可用。']
          : [],
      };
      cached = { time: now(), value };
      return value;
    })().finally(() => {
      pending = null;
    });
    return pending;
  };
}
const readGithubUpdates = createGithubUpdates();
module.exports = { wantsGithubUpdates, createGithubUpdates, readGithubUpdates };
