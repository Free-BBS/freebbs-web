// Loopback-only experience lab. All account data is memory-only; no production services.
const fs = require('node:fs');
const path = require('node:path');
const { preparePageShell } = require('../page-shell');
const { createEconomyPreview } = require('./preview-economy');
const { createWorkbenchPreviewApi } = require('./workbench-preview-api');
const { createBoneSales } = require('../backend/economy-sales');
const {
  GUIDE_VERSION,
  LEGACY_GUIDE_VERSIONS,
  emptyProgress,
  resolveGuideVersion,
  createOnboardingService,
} = require('../backend/onboarding');
const { ONBOARDING_REWARD_AMOUNTS } = require('../backend/onboarding-reward');
const catalog = require('../public/data/shop-items.json');

const PREVIEW_PAGES = {
  '/': 'index.html',
  '/about': 'about.html',
  '/staff': 'staff.html',
  '/laboratory': 'laboratory.html',
  '/pbl': 'pbl.html',
  '/creative-workshop': 'creative-workshop.html',
  '/tool-workshop': 'tool-workshop.html',
  '/circuit-challenge': 'circuit-challenge.html',
  '/guide': 'guide.html',
  '/world': 'world.html',
  '/course': 'course.html',
  '/knowledge': 'knowledge.html',
  '/publish': 'publish.html',
  '/aichat': 'aichat.html',
  '/workbench': 'workbench.html',
  '/circuit': 'circuit.html',
  '/circuits': 'circuit.html',
  '/surveys': 'surveys.html',
  '/development': 'development.html',
  '/activities': 'activities.html',
};

function courseFixture(slug) {
  const definitions = {
    signals: {
      name: '信号与系统',
      prefix: 'SS',
      boardSlug: 'signal',
      titles: ['信号的表示', '系统的基本性质', '卷积', '频域的第一步'],
      example:
        '例如 $x(t)=\\sin(t)$ 表示一个连续时间信号。先分清自变量、幅值与变化规律，再讨论系统怎样改变它。',
    },
    circuits: {
      name: '电子电路与系统基础',
      prefix: 'EC',
      boardSlug: 'circuit',
      titles: ['电压与电流', '基本电路定律', '一阶电路', '频率响应'],
      example:
        '对于理想电阻，电压与电流满足 $u=Ri$。分析前先约定电压参考方向和电流方向，再检查单位。',
    },
    math: {
      name: '高等微积分',
      prefix: 'MA',
      boardSlug: 'math',
      titles: ['极限与连续', '导数的意义', '积分的意义', '微积分基本定理'],
      example:
        '以 $f(x)=x^2$ 为例，当 $x$ 越来越接近 $1$ 时，函数值越来越接近 $1$。极限关注的是靠近过程，不是只代入一个点。',
    },
  };
  const definition = definitions[slug];
  if (!definition) return null;
  const nodes = definition.titles.map((title, index) => {
    const markdown = `> 本地预览 · 演示资料，不是正式课程讲义。\n\n## ${title}\n\n这份简短内容用于体验真实的知识点阅读界面，示范公式、段落和已有导航入口。\n\n### 一个直观例子\n\n${definition.example}\n\n### 试着带着问题阅读\n\n- 这个知识点试图解释什么？\n- 结论依赖哪些条件？\n- 它与课程图谱里的前后知识点有什么联系？\n\n### 接着探索\n\n[返回课程地图](/course?course=${slug}) · [查看课程讨论](/discussion?board=${definition.boardSlug})\n\n这些链接通向现有页面；学习资源工具、个人笔记和知识起源正文仍在建设。本地预览未连接 AI，不包含额外的虚构资源库。`;
    return {
      id: `${definition.prefix}-0${Math.floor(index / 2) + 1}-${index + 1}`,
      title,
      summary: '本地演示知识点，用于体验导航与导览；非正式课程内容。',
      position: { x: 150 + index * 180, y: 150 + (index % 2) * 150 },
      hasDocument: true,
      markdown,
      sections: {
        knowledgeMarkdown: markdown,
        basicInfoMarkdown: `**本地演示资料。**\n\n这是「${definition.name}」中的「${title}」示例概览，用于核验课程地图到知识点的真实阅读流程。正式课程以实际发布内容为准。`,
        applicationsMarkdown:
          '**本地演示资料。**\n\n课程作者可以在这里介绍知识点的使用情境。本示例仅说明这一现有栏目如何呈现，不代表完整教学案例或已开放资料库。',
      },
    };
  });
  return {
    course: {
      slug,
      name: definition.name,
      summary: '本地演示课程地图',
      canEditMap: false,
      boardSlug: definition.boardSlug,
    },
    nodes,
    edges: nodes.slice(1).map((node, index) => ({
      id: `demo-edge-${index}`,
      source: nodes[index].id,
      target: node.id,
      type: 'ordered',
      label: '接着探索',
    })),
    backgroundUrl: '',
  };
}

function discussionFixture() {
  const boards = [
    { slug: 'daily', name: '日常', description: '本地演示：社区交流与使用说明。' },
    { slug: 'math', name: '数学', description: '本地演示：数学课程相关讨论。' },
    { slug: 'signal', name: '信号', description: '本地演示：信号与系统课程相关讨论。' },
    { slug: 'circuit', name: '电路', description: '本地演示：电路课程相关讨论。' },
  ].map((board) => ({ ...board, postCount: 1 }));
  const posts = boards.map((board, index) => ({
    id: String(101 + index),
    title: `【演示${index === 0 ? '置顶' : ''}】${index === 0 ? '欢迎来到 FREE BBS：提问之前的小提示' : `${board.name}课程的讨论入口`}`,
    contentMarkdown: `> 本地预览演示帖，不是线上用户发布的内容。\n\n## 怎样提出一个容易一起讨论的问题？\n\n说明背景、你尝试过的过程，以及具体卡住的位置。公式与代码可以用 Markdown 整理。\n\n## 想请 Max 帮忙？\n\n在评论或回复中使用独立的 **@Max**，发表后才会触发真实站点的答疑流程。本地预览不会发表评论，也不连接 AI。\n\n不要贴出账号凭据、他人的隐私或未经授权的资料。`,
    board,
    createdAt: '2026-09-21T03:00:00.000Z',
    author: { id: 1, uid: 'u_preview01', username: 'NotingSr_preview' },
    isPinned: index === 0,
    isFeatured: false,
    isAnonymous: false,
    commentCount: 1,
    likeCount: 0,
    lightCount: 0,
    fireworksCount: 0,
  }));
  const comments = (postId) => [
    {
      id: Number(postId) * 10,
      parentCommentId: null,
      author: { id: 2, uid: 'u_preview02', username: '演示同学' },
      contentMarkdown:
        '这是一条本地预置的演示回复，帮助检查正文、评论和回复入口；并没有真实发给任何用户。',
      createdAt: '2026-09-21T04:00:00.000Z',
      likeCount: 0,
    },
  ];
  return { boards, posts, comments };
}

function initialLedger(now) {
  let magnetic = 50;
  return Array.from({ length: 36 }, (_, index) => {
    const before = magnetic;
    magnetic += [-2, 2, 3][index % 3];
    return {
      id: index + 1,
      electric_before: '120',
      electric_after: '120',
      magnetic_before: String(before),
      magnetic_after: String(magnetic),
      title: index % 3 === 0 ? '示例支出' : '示例收入',
      reason: index % 3 === 0 ? '预置演示记录：兑换一份小礼物' : '预置演示记录：社区交流与日常参与',
      created_at: new Date(now - (36 - index) * 3600000).toISOString(),
    };
  });
}

function createOnboardingPreview({ now = Date.now, growthRandom } = {}) {
  const progressByVersion = new Map();
  const readProgress = (version = GUIDE_VERSION) =>
    structuredClone(progressByVersion.get(resolveGuideVersion(version)) || emptyProgress(version));
  // Reuse the production version/legacy-task semantics with an in-memory store.
  // update is synchronous until the new receipt is stored, so requests cannot
  // erase another request's merged task receipts in this single-process lab.
  const onboarding = createOnboardingService(
    {
      async read(_userId, version) {
        return readProgress(version);
      },
      async update(_userId, change, _stamp, version) {
        const next = change(readProgress(version));
        progressByVersion.set(version, structuredClone(next));
        return structuredClone(next);
      },
    },
    { now },
  );
  const discussion = discussionFixture();
  const workbench = createWorkbenchPreviewApi({
    now,
    campusCourses: [
      {
        sourceReference: 'learn:course:demo-math',
        title: '模拟课程 · 数学分析',
        teacher: '演示教师',
        scheduleText: '第1-16周 星期一第1大节；第1-16周 星期四第3大节',
        locationText: '六教 6A201（模拟）',
      },
      {
        sourceReference: 'learn:course:demo-circuit',
        title: '模拟课程 · 电路实验',
        teacher: '演示教师',
        scheduleText: '第1-16周(单周) 星期三15:20-16:55',
        locationText: '实验室 301（模拟）',
      },
      {
        sourceReference: 'learn:course:demo-pending',
        title: '模拟课程 · 待定研讨课',
        scheduleText: '时间待定',
        locationText: '',
      },
    ],
  });
  const result = (body, status = 200) => ({ body, status });
  const preview = createEconomyPreview({
    now,
    profileOptions: { random: growthRandom },
    allowVendor: true,
    extraPages: PREVIEW_PAGES,
    accounts: [
      {
        id: 1,
        electric: 120,
        magnetic: 86,
        heat: 24,
        assets: {
          ordinary_fishbone: 12,
          golden_fishbone: 3,
          fishbone: 2,
          fish: 10,
          max_pet: 1,
          frame_aurora: 1,
          plate_observer: 1,
          card_twilight: 1,
        },
        counts: { fishbone: 2, max_pet: 1, frame_aurora: 1, plate_observer: 1, card_twilight: 1 },
        adopted: true,
        fedUntilMs: now() + 86400000,
        equipped: { frame: 'frame_aurora', nameplate: 'plate_observer', card: 'card_twilight' },
        checkins: {},
        ledger: initialLedger(now()),
      },
      { id: 2, checkins: {} },
    ],
    storeOptions: {
      recordLedger: true,
      now,
      itemNames: Object.fromEntries(catalog.items.map((item) => [item.key, item.name])),
    },
    previewNotice:
      '从首页开始认识 FREE BBS，跟着 Max 逐站探索。预置 120 电元、86 磁元、10 条小鱼、12 根普通鱼骨与 3 根黄金鱼骨；Max 已入住，可自行购买橡胶棒体验羊毛摩擦。所有变化只在本地模拟账本中保存。',
    transformHtml(html, route) {
      // Match the shared shell appended by the production static server. Missing
      // these layers makes guide geometry and responsive QA differ from the site.
      const page = preparePageShell(html)
        .replace(
          '</head>',
          '<link rel="stylesheet" href="/site-search.css"><link rel="stylesheet" href="/mobile-shell.css"><link rel="stylesheet" href="/desktop-elegant.css"><link rel="stylesheet" href="/page-transitions.css"><link rel="stylesheet" href="/desktop-shell.css"><link rel="stylesheet" href="/personal-polish.css"></head>',
        )
        .replace(
          '</body>',
          '<script src="/site-search.js" defer></script><script src="/mobile-shell.js" defer></script><script src="/page-transitions.js" defer></script><script src="/desktop-shell.js" defer></script></body>',
        );
      if (route !== '/aichat') return page;
      return page
        .replace('<p>课程答疑、推导与电路分析</p>', '<p>本地仅演示界面 · 未连接真实 AI</p>')
        .replace(
          'placeholder="输入问题，或粘贴本站电路链接…"',
          'placeholder="本地预览：只演示界面，不会发送给真实 AI"',
        );
    },
    async extraApi(context) {
      const { route, method, body, url, store } = context;
      if (route === '/api/tools' && method === 'GET') return result({ tools: [] });
      if (route.startsWith('/api/tools'))
        return result({ message: '本地预览不调用真实 AI，也不生成或发布小工具' }, 503);
      if (route === '/api/onboarding/reward') {
        const rewardState = () => {
          const claimedAt = store.account().onboardingRewardClaimedAt || null;
          return {
            eligible:
              Boolean(claimedAt) ||
              [GUIDE_VERSION, ...LEGACY_GUIDE_VERSIONS].some((version) =>
                Boolean(readProgress(version).completedAt),
              ),
            claimed: Boolean(claimedAt),
            claimedAt,
            amounts: { ...ONBOARDING_REWARD_AMOUNTS },
          };
        };
        if (method === 'GET') return result(rewardState());
        if (method !== 'POST') return result({ message: '仅支持读取或领取导引奖励' }, 405);
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length)
          return result({ message: '领取奖励不接受自定义金额或账号' }, 400);
        return store.transaction(async () => {
          const state = rewardState();
          if (state.claimed) return result({ ...state, awarded: false });
          if (!state.eligible) return result({ message: '完成完整新手导引后才能领取奖励' }, 403);
          const account = store.account();
          const before = { electric: account.electric, magnetic: account.magnetic };
          account.electric += ONBOARDING_REWARD_AMOUNTS.electric;
          account.magnetic += ONBOARDING_REWARD_AMOUNTS.magnetic;
          store.recordLedger(1, before, {
            sourceKey: 'onboarding-reward',
            title: '新手导引完成奖励',
            reason: '完成完整新手导引，获得 10 电元和 10 磁元；每个账号仅限一次，新老用户同享。',
          });
          account.onboardingRewardClaimedAt = new Date(now()).toISOString();
          return result({ ...rewardState(), awarded: true });
        });
      }
      if (route === '/api/onboarding') {
        if (method === 'GET')
          return result(await onboarding.read(1, url.searchParams.get('version') ?? undefined));
        if (method === 'PATCH' || method === 'POST') {
          return result(await onboarding.update(1, body));
        }
        return result({ message: '仅支持读取或更新导览进度' }, 405);
      }
      if (method === 'GET' && route.startsWith('/api/discussion/')) {
        if (route === '/api/discussion/boards') return result({ boards: discussion.boards });
        if (route === '/api/discussion/stats')
          return result({
            boards: discussion.boards,
            totalPosts: discussion.posts.length,
            totalComments: discussion.posts.length,
          });
        if (route === '/api/discussion/posts') {
          const board = url.searchParams.get('board');
          const sort = url.searchParams.get('sort');
          const posts = discussion.posts.filter(
            (post) =>
              (!board || board === 'all' || post.board.slug === board) &&
              (sort !== 'unanswered' || post.commentCount === 0),
          );
          return result({ posts, nextCursor: null });
        }
        const postMatch = /^\/api\/discussion\/posts\/(\d+)(\/comments)?$/.exec(route);
        if (postMatch) {
          const post = discussion.posts.find((entry) => entry.id === postMatch[1]);
          if (!post) return result({ message: '未找到本地演示帖子' }, 404);
          return result(postMatch[2] ? { comments: discussion.comments(post.id) } : { post });
        }
      }
      if (route === '/api/shop/sell' && method === 'POST') {
        const receipt = await createBoneSales(store).sell({
          userId: 1,
          itemKey: body.itemKey,
          quantity: body.quantity,
          requestKey: body.requestKey,
        });
        return result({ receipt, message: `本地模拟出售完成，收入 ${receipt.amount} 磁元` });
      }
      if (route === '/api/wallet/ledger' && method === 'GET') {
        const before = url.searchParams.get('before');
        const currency = url.searchParams.get('currency') || 'all';
        if (
          (before !== null &&
            (!/^[1-9][0-9]*$/.test(before) || !Number.isSafeInteger(Number(before)))) ||
          !['all', 'electric', 'magnetic'].includes(currency)
        )
          return result({ message: '账本筛选或分页参数无效' }, 400);
        const rows = store
          .account()
          .ledger.filter(
            (row) =>
              (!before || row.id < Number(before)) &&
              (currency === 'all' || row[`${currency}_before`] !== row[`${currency}_after`]),
          )
          .slice()
          .reverse();
        return result({
          entries: rows.slice(0, 30),
          nextCursor: rows.length > 30 ? String(rows[29].id) : null,
        });
      }
      if (route.startsWith('/api/workbench/') || route.startsWith('/api/notifications')) {
        if (route === '/api/notifications/email-preferences' && method === 'GET')
          return result({
            preferences: {
              reply: true,
              reaction: true,
              commentLike: true,
              announcement: true,
              weeklyDigest: false,
              aiTask: true,
            },
          });
        if (route === '/api/notifications/unread-count')
          return result({
            unreadCount: workbench.communityNotices.filter((entry) => !entry.readAt).length,
          });
        const answer = await workbench.handle(context);
        if (answer) return answer;
        if (route === '/api/workbench/campus/status')
          return result({
            state: 'not_connected',
            connected: false,
            message: '本地演示未连接校内服务',
          });
        return result({ message: '此功能未接入本地演示' }, 404);
      }
      const mapMatch = /^\/api\/courses\/([^/]+)\/map(?:\/nodes\/([^/]+))?$/.exec(route);
      if (mapMatch && method === 'GET') {
        const map = courseFixture(mapMatch[1]);
        if (!map) return result({ message: '未找到本地示例课程' }, 404);
        if (!mapMatch[2]) return result(map);
        const node = map.nodes.find((entry) => entry.id === mapMatch[2]);
        return node
          ? result({ course: map.course, node })
          : result({ message: '未找到示例知识点' }, 404);
      }
      if (route === '/api/course-upload/tokens' && method === 'GET') return result({ tokens: [] });
      if (route === '/api/leaderboard/heat' && method === 'GET')
        return result({
          users: [
            {
              uid: 'u_preview01',
              username: 'NotingSr_preview',
              heat: store.account().heat,
              avatarPath: '/assets/avatar_placeholder.webp',
            },
          ],
        });
      if (route === '/api/ai/models' && method === 'GET')
        return result({
          defaultModel: 'local-preview',
          models: [
            {
              id: 'local-preview',
              label: '本地界面预览（未连接 AI）',
              efforts: ['off'],
              defaultEffort: 'off',
              vision: false,
              note: '仅演示界面，不会生成回答',
            },
          ],
        });
      if (route === '/api/ai/dialogs' && method === 'GET') return result({ dialogs: [] });
      if (route.startsWith('/api/ai/'))
        return result(
          { message: '本地预览只演示 Max 界面，没有连接真实 AI，也不会生成模拟答案。' },
          503,
        );
      if (route === '/api/surveys' && method === 'GET') return result({ surveys: [] });
      if (route === '/api/circuits' && method === 'GET') return result({ circuits: [] });
      return null;
    },
  });
  // A fixed, account-free visual fixture lives outside public and production routes.
  const [handlePreviewRequest] = preview.server.listeners('request');
  preview.server.removeListener('request', handlePreviewRequest);
  preview.server.on('request', async (req, res) => {
    if (req.url.split('?')[0] !== '/preview/ranch-states') return handlePreviewRequest(req, res);
    const host = `127.0.0.1:${preview.server.address().port}`;
    const headers = {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; frame-ancestors 'none'; form-action 'none'",
    };
    if (req.headers.host !== host) {
      res.writeHead(403, headers);
      return res.end('Loopback preview only');
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { ...headers, Allow: 'GET, HEAD' });
      return res.end('Visual preview is read-only');
    }
    try {
      const html = await fs.promises.readFile(path.join(__dirname, 'fixtures/ranch-states.html'));
      res.writeHead(200, headers);
      return res.end(req.method === 'HEAD' ? undefined : html);
    } catch {
      res.writeHead(500, headers);
      return res.end('Visual preview fixture unavailable');
    }
  });
  return { ...preview, workbench, progress: readProgress };
}

if (require.main === module) {
  const port = Number(process.env.ONBOARDING_PREVIEW_PORT || 3120);
  const { server } = createOnboardingPreview();
  server.listen(port, '127.0.0.1', () => {
    console.log(`Max onboarding preview: http://127.0.0.1:${server.address().port}/`);
    console.log('Memory-only demo; no production API, database, real AI or campus service.');
  });
}

module.exports = { createOnboardingPreview, courseFixture };
