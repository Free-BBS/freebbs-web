const API = 'https://api.github.com/repos/Free-BBS/freebbs-web';
const WEB = 'https://github.com/Free-BBS/freebbs-web';
const TOPICS = [
  [
    /登录|注册|密码|掉线|账号|认证/,
    ['auth', 'session', 'login', 'registration'],
    ['public/auth.js', 'public/app.js', 'backend/server.js'],
  ],
  [
    /发帖|评论|回复|讨论|帖子|匿名/,
    ['discussion', 'comment', 'publish'],
    ['public/app.js', 'backend/server.js'],
  ],
  [
    /max|助手|模型|rag|知识库|对话/i,
    ['agent', 'aichat', 'rag', 'max'],
    ['backend/agent-routing.js', 'backend/agent-site.js'],
  ],
  [/上传|文件|pdf|ppt|附件|图片/i, ['max-files', 'document', 'upload', 'preview'], []],
  [
    /手机|导航|菜单|底栏|主题|明亮|黑暗/,
    ['mobile-shell', 'theme', 'layout'],
    ['public/mobile-shell.js', 'public/mobile-shell.css'],
  ],
  [/通知|公告|消息/, ['notification', 'announcement'], []],
  [/课程|学习世界|知识点|地图/, ['course', 'knowledge', 'world'], []],
  [/电路|仿真|元件|波形/, ['circuit', 'simulator'], []],
  [/工作台|课表/, ['workbench', 'schedule'], []],
  [/搜索|查找/, ['site-search', 'search'], []],
  [/头像|个人设置|商店|签到/, ['profile', 'cosmetic', 'inventory', 'checkin'], []],
];
function wantsWebsiteCode(question) {
  return /本站|网站|站内|free.?bbs|github|更新日志|问问\s*max|登录|注册|发帖|评论|讨论区|帖子|手机端|页面|导航|菜单|通知|头像|个人设置|学习世界|工作台|仿真器|上传文件|模型选择|暗色|黑暗|明亮/i.test(
    question,
  );
}
function safePath(path) {
  return (
    typeof path === 'string' &&
    path.length < 240 &&
    !path.split('/').some((p) => p === '..' || p.startsWith('.')) &&
    /\.(?:js|ts|py|html|css|md)$/.test(path) &&
    !/(?:^|\/)(?:node_modules|vendor|uploads|database|secrets?|credentials?|private|output|test|tests)(?:\/|\.)|\.test\./i.test(
      path,
    )
  );
}
function searchTerms(question) {
  const topics = TOPICS.filter(([pattern]) => pattern.test(question));
  const words = [
    ...new Set([
      ...(question.match(/[a-z][a-z0-9_-]{2,40}/gi) || []).map((w) => w.toLowerCase()),
      ...topics.flatMap((t) => t[1]),
    ]),
  ];
  return { words, preferred: topics.flatMap((t) => t[2]) };
}
function selectFiles(tree, question) {
  const { words, preferred } = searchTerms(question);
  return tree
    .filter(
      (item) =>
        item.type === 'blob' &&
        item.mode !== '120000' &&
        safePath(item.path) &&
        item.size <= 1500000,
    )
    .map((item) => ({
      ...item,
      score:
        words.reduce((score, word) => score + (item.path.toLowerCase().includes(word) ? 5 : 0), 0) +
        (preferred.includes(item.path) ? 20 : 0) +
        (item.path === 'README.md' ? 6 : 0),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, 4);
}
function excerpt(text, question) {
  const lines = text.split('\n');
  const { words } = searchTerms(question);
  const symbols = /登录|掉线|密码|认证/.test(question)
    ? ['restoreSession', 'clearSession', 'handleAuthSubmit', '/auth/me', '/auth/login']
    : /评论|发帖|回复/.test(question)
      ? ['handleDiscussionCommentSubmit', 'handleDiscussionComposeSubmit', 'renderDiscussionDetail']
      : /max|模型|rag/i.test(question)
        ? ['enrichAgentSiteContext', 'resolveAgentRoute', 'requestMaxNavigation']
        : [];
  const hits = lines
    .map((line, index) => ({
      index,
      score:
        words.reduce((score, word) => score + (line.toLowerCase().includes(word) ? 1 : 0), 0) +
        symbols.reduce(
          (score, symbol) =>
            score + (line.includes(symbol) ? (/function |app\.(get|post)/.test(line) ? 12 : 3) : 0),
          0,
        ),
    }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const anchors = [];
  for (const hit of hits) {
    if (anchors.every((index) => Math.abs(index - hit.index) > 24)) anchors.push(hit.index);
    if (anchors.length === 2) break;
  }
  if (!anchors.length) anchors.push(0);
  return anchors
    .sort((a, b) => a - b)
    .map((index) => {
      const start = Math.max(0, index - 8),
        end = Math.min(lines.length, index + 48);
      const text = lines
        .slice(start, end)
        .map((line, i) => String(start + i + 1) + ': ' + line.slice(0, 500))
        .join('\n');
      return { startLine: start + 1, endLine: end, text: text.slice(0, 3200), truncated: true };
    });
}
function createGithubCode({ fetchImpl = fetch, now = Date.now } = {}) {
  let cached, pending;
  const files = new Map();
  async function request(url, json = true) {
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Free-BBS-Max' },
      redirect: 'error',
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) throw Error('GitHub 代码读取暂不可用');
    return json ? response.json() : response.text();
  }
  async function snapshot() {
    if (cached && now() - cached.time < 300000) return cached;
    if (pending) return pending;
    pending = (async () => {
      const commit = await request(API + '/commits/main');
      if (!/^[a-f0-9]{40}$/.test(commit.sha)) throw Error('GitHub 版本无效');
      const tree = await request(API + '/git/trees/' + commit.sha + '?recursive=1');
      if (!Array.isArray(tree.tree)) throw Error('GitHub 文件目录无效');
      cached = {
        time: now(),
        sha: commit.sha,
        tree: tree.tree,
        truncated: Boolean(tree.truncated),
      };
      return cached;
    })().finally(() => {
      pending = null;
    });
    return pending;
  }
  return async function read(question) {
    const repo = await snapshot();
    const selected = selectFiles(repo.tree, question);
    const results = await Promise.allSettled(
      selected.map(async (file) => {
        const key = repo.sha + '/' + file.path;
        let text = files.get(key);
        if (text === undefined) {
          text = await request(
            'https://raw.githubusercontent.com/Free-BBS/freebbs-web/' +
              repo.sha +
              '/' +
              file.path.split('/').map(encodeURIComponent).join('/'),
            false,
          );
          if (text.length > 1500000) throw Error('文件过大');
          if (files.size >= 48) files.delete(files.keys().next().value);
          files.set(key, text);
        }
        return {
          path: file.path,
          url: WEB + '/blob/' + repo.sha + '/' + file.path,
          excerpts: excerpt(text, question),
        };
      }),
    );
    return {
      repository: WEB,
      branch: 'main',
      commit: repo.sha,
      fetchedAt: new Date(now()).toISOString(),
      files: results.filter((r) => r.status === 'fulfilled').map((r) => r.value),
      notices: [
        ...(repo.truncated ? ['GitHub 文件目录不完整。'] : []),
        ...(results.some((r) => r.status === 'rejected') ? ['部分源文件未能读取。'] : []),
        '只读取按问题匹配的最多 4 个文件片段，不代表完整审阅仓库。代码与 Git 提交记录不等于线上运行状态；不包含服务器运行日志或用户私人数据。',
      ],
    };
  };
}
const readGithubCode = createGithubCode();
module.exports = {
  wantsWebsiteCode,
  createGithubCode,
  selectFiles,
  excerpt,
  safePath,
  readGithubCode,
};
