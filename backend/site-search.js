const express = require('express');

// Human-maintained descriptions of real entry points, shared by search and Max.
const PAGES = [
  [
    '/',
    '首页',
    '网站公告、学习入口与站点动态。顶部可签到、查看仓库和商店；侧栏或手机底部导航切换页面。',
  ],
  ['/world', '学习世界', '选择课程，进入课程知识地图；从知识点继续学习。'],
  [
    '/course',
    '课程地图',
    '按课程浏览知识点及先后关系。点击地图节点打开知识点；课程管理者可编辑地图。',
  ],
  [
    '/knowledge',
    '知识点',
    '阅读知识正文、基本信息和应用，查看相关讨论，向 Max 提问。需要从课程地图选择具体知识点。',
  ],
  [
    '/discussion',
    '讨论区',
    '按版块浏览最新、热门和精华帖子；打开帖子阅读正文与评论，登录后发帖、回复或在评论中 @Max。',
  ],
  [
    '/circuit',
    '电路实验室',
    '绘制电路、运行 DC/AC/瞬态仿真、查看波形。点击添加或按 I 打开分类元件菜单；选择元件后编辑参数，支持 m/u/n/p/k/M。可保存、分享电路链接并向 Max 提问。',
  ],
  [
    '/workbench',
    '我的工作台',
    '登录后查看自己的学习工作台及已授权的校园信息；校园数据需要本人授权。',
  ],
  [
    '/aichat',
    '问问 Max',
    '和 Max 对话，询问站内入口、检索课程与帖子。输入区可上传文档、粘贴图片，图片自动启用视觉模型；标题栏的对话记录打开历史。',
  ],
  ['/surveys', '活动报名', '查看活动、问卷与报名入口，登录后填写并查看自己的回执。'],
  ['/development', '发展端', '查看网站的发展与建设内容。'],
  ['/inventory', '仓库与商店', '查看自己持有的道具、余额和可购买的商品。需要登录。'],
  ['/profile', '个人主页', '查看用户公开资料与公开内容；从头像或作者链接打开具体用户主页。'],
  ['/settings', '设置', '登录后修改自己的资料、头像、界面和账号设置。'],
  ['/electromagnetic', '电磁学可视化', '探索电磁学相关的可视化内容。'],
  [
    '/search',
    '全站搜索',
    '按关键词搜索页面入口、讨论帖子、课程、知识点和已保存电路，可筛选分类。点击顶部放大镜，或按 Ctrl/⌘ K 打开搜索。',
  ],
].map(([url, title, description]) => ({ type: 'page', id: url, url, title, description }));
const TYPES = ['all', 'page', 'post', 'course', 'knowledge', 'circuit'];
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
const STOP_WORDS = new Set(
  '的 了 呢 吗 吧 我 你 他 她 它 我们 可以 有没有 什么 怎么 如何 哪里 哪个 帮 帮我 请 给 给我 看 看看 找 查找 搜索 推荐 一些 相关 关于 这个 那个 网站 本站 页面 帖子 讨论 讨论区 内容 最新 热门 最近 有哪些 哪些 还有 有 能 能够 一下 几篇 几个 有关 请问 这里 那里 这篇 详细 讲讲 max'.split(
    ' ',
  ),
);
function keywords(value, conversational = false) {
  const text = String(value || '')
    .normalize('NFKC')
    .trim()
    .slice(0, 120)
    .toLowerCase();
  const words = [...segmenter.segment(text)]
    .filter((item) => item.isWordLike)
    .map((item) => item.segment)
    .filter((word) => !conversational || !STOP_WORDS.has(word));
  const meaningful = words.filter(
    (word) => word.length > 1 || words.every((item) => item.length === 1),
  );
  return [...new Set(meaningful)].slice(0, 8);
}
function plain(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#*`>|_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function excerpt(value, terms, length = 220) {
  const text = plain(value);
  const positions = terms.map((term) => text.toLowerCase().indexOf(term)).filter((at) => at >= 0);
  const start = positions.length ? Math.max(0, Math.min(...positions) - 45) : 0;
  return `${start ? '…' : ''}${text.slice(start, start + length)}${text.length > start + length ? '…' : ''}`;
}
function like(term) {
  return `%${term.replace(/[!%_]/g, '!$&')}%`;
}
const SOURCES = {
  post: {
    from: 'discussion_posts p JOIN discussion_boards b ON b.id = p.board_id',
    where: 'p.is_deleted = 0 AND p.is_hidden = 0 AND b.is_active = 1',
    id: 'COALESCE(p.pid, CAST(p.id AS CHAR))',
    title: 'p.title',
    body: 'p.content_markdown',
    section: 'b.name',
    updated: 'p.created_at',
    featured: 'p.is_featured',
    url: (row) => `/discussion?post=${encodeURIComponent(row.id)}`,
  },
  course: {
    from: 'courses c',
    where: 'c.is_active = 1',
    id: 'c.slug',
    title: 'c.name',
    body: "CONCAT_WS(' ', c.code, c.summary, c.description)",
    section: "'课程'",
    updated: 'NULL',
    featured: '0',
    url: (row) => `/course?course=${encodeURIComponent(row.id)}`,
  },
  knowledge: {
    from: 'course_map_nodes n JOIN courses c ON c.id = n.course_id LEFT JOIN course_map_node_sections s ON s.course_id = n.course_id AND s.node_id = n.node_id',
    where: 'c.is_active = 1',
    id: "CONCAT(c.slug, '/', n.node_id)",
    title: 'n.title',
    body: "CONCAT_WS(' ', n.summary, COALESCE(NULLIF(s.knowledge_markdown, ''), n.document_markdown), s.basic_info_markdown, s.applications_markdown)",
    section: 'c.name',
    updated: 'n.updated_at',
    featured: '0',
    url: (row) => {
      const [course, point] = row.id.split('/');
      return `/knowledge?course=${encodeURIComponent(course)}&point=${encodeURIComponent(point)}`;
    },
  },
  circuit: {
    from: 'circuits c JOIN circuit_revisions r ON r.cid = c.cid AND r.revision = c.current_revision',
    where: '1 = 1',
    id: 'c.cid',
    title: 'r.title',
    body: 'r.description',
    section: "'电路'",
    updated: 'c.updated_at',
    featured: '0',
    url: (row) => `/circuit?cid=${encodeURIComponent(row.id)}`,
  },
};
function createSiteSearch(pool) {
  async function querySource(type, terms, count, sort, user) {
    const source = SOURCES[type];
    const params = [];
    const score = terms.length
      ? terms
          .map((term) => {
            params.push(like(term), like(term));
            return `(CASE WHEN ${source.title} LIKE ? ESCAPE '!' THEN 8 ELSE 0 END + CASE WHEN ${source.body} LIKE ? ESCAPE '!' THEN 1 ELSE 0 END)`;
          })
          .join(' + ')
      : '0';
    const match = terms.length
      ? ` AND (${terms
          .map((term) => {
            params.push(like(term), like(term));
            return `(${source.title} LIKE ? ESCAPE '!' OR ${source.body} LIKE ? ESCAPE '!')`;
          })
          .join(' OR ')})`
      : '';
    const [rows] = await pool.execute(
      {
        sql: `SELECT /*+ MAX_EXECUTION_TIME(2500) */ ${source.id} AS id, ${source.title} AS title, LEFT(${source.body}, 16000) AS body,
        ${source.section} AS section, ${source.updated} AS updatedAt, ${source.featured} AS featured, (${score}) AS score
        FROM ${source.from} WHERE ${source.where}${type === 'post' && !user?.id ? ' AND p.login_required = 0' : ''}${match}
        ORDER BY score DESC, ${sort === 'recommended' ? 'featured DESC,' : ''} updatedAt DESC, id ASC LIMIT ${count}`,
        timeout: 3500,
      },
      params,
    );
    return rows.map((row) => ({
      type,
      id: String(row.id),
      title: String(row.title),
      url: source.url(row),
      excerpt: excerpt(row.body, terms),
      section: row.section,
      updatedAt: row.updatedAt,
      featured: Boolean(Number(row.featured)),
      score: Number(row.score),
    }));
  }
  async function search({
    q = '',
    type = 'all',
    offset = 0,
    limit = 20,
    conversational = false,
    sort = 'relevance',
    user = null,
  } = {}) {
    if (
      typeof q !== 'string' ||
      q.length > 120 ||
      !TYPES.includes(type) ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > 480 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 30
    )
      throw Object.assign(new Error('关键词最多 120 字，分类或分页参数无效。'), { status: 400 });
    const terms = keywords(q, conversational);
    if (q.trim() && !terms.length && !conversational)
      return { query: q, type, results: [], hasMore: false, nextOffset: 0 };
    const results = [];
    if (type === 'all' || type === 'page') {
      PAGES.forEach((page) => {
        const score = terms.reduce(
          (sum, term) =>
            sum +
            (page.title.toLowerCase().includes(term) ? 8 : 0) +
            (page.description.toLowerCase().includes(term) ? 1 : 0),
          0,
        );
        if (!terms.length || score)
          results.push({ ...page, excerpt: page.description, section: '页面入口', score });
      });
    }
    const types = type === 'all' ? Object.keys(SOURCES) : SOURCES[type] ? [type] : [];
    const batches = await Promise.all(
      types.map((kind) => querySource(kind, terms, offset + limit + 1, sort, user)),
    );
    results.push(...batches.flat());
    results.sort(
      (a, b) =>
        b.score - a.score ||
        (sort === 'recommended' ? Number(b.featured || 0) - Number(a.featured || 0) : 0) ||
        new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0) ||
        `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`),
    );
    return {
      query: q,
      type,
      results: results.slice(offset, offset + limit),
      hasMore: results.length > offset + limit && offset + limit <= 480,
      nextOffset: offset + limit,
      limited: offset + limit > 480,
    };
  }
  async function read(value, publicWebUrl, user = null) {
    const url = new URL(value, publicWebUrl);
    if (url.origin !== new URL(publicWebUrl).origin || url.username || url.password)
      throw new Error('仅能读取本站链接。');
    if (url.pathname === '/discussion' && url.searchParams.has('post')) {
      const id = url.searchParams.get('post');
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error('帖子链接无效。');
      const [rows] = await pool.execute(
        {
          sql: `SELECT p.id, p.pid, p.title, LEFT(p.content_markdown, 14000) AS body, b.name AS section
        FROM discussion_posts p JOIN discussion_boards b ON b.id = p.board_id
        WHERE (p.pid = ? OR CAST(p.id AS CHAR) = ?) AND p.is_deleted = 0 AND p.is_hidden = 0 AND b.is_active = 1 ${!user?.id ? 'AND p.login_required = 0' : ''} LIMIT 1`,
          timeout: 3500,
        },
        [id, id],
      );
      if (!rows[0]) throw new Error('帖子不存在或不可见。');
      const post = rows[0];
      const [comments] = await pool.execute(
        {
          sql: `SELECT LEFT(c.content_markdown, 1200) AS text FROM discussion_comments c JOIN discussion_posts p ON p.id = c.post_id WHERE c.post_id = ? AND c.is_deleted = 0 AND p.is_deleted = 0 AND p.is_hidden = 0 ${!user?.id ? 'AND p.login_required = 0' : ''} ORDER BY c.created_at DESC, c.id DESC LIMIT 5`,
          timeout: 3500,
        },
        [post.id],
      );
      return {
        type: 'post',
        title: post.title,
        url: `/discussion?post=${encodeURIComponent(post.pid || post.id)}`,
        text: post.body,
        section: post.section,
        recentComments: comments.map((row) => row.text),
        truncated: post.body.length >= 14000,
      };
    }
    if (url.pathname === '/knowledge' && url.searchParams.has('point')) {
      const [rows] = await pool.execute(
        {
          sql: `SELECT n.title, LEFT(CONCAT_WS('\n', COALESCE(NULLIF(s.knowledge_markdown, ''), n.document_markdown), s.basic_info_markdown, s.applications_markdown), 14000) AS body
        FROM course_map_nodes n JOIN courses c ON c.id = n.course_id LEFT JOIN course_map_node_sections s ON s.course_id = n.course_id AND s.node_id = n.node_id
        WHERE c.slug = ? AND n.node_id = ? AND c.is_active = 1 LIMIT 1`,
          timeout: 3500,
        },
        [url.searchParams.get('course') || 'signals', url.searchParams.get('point')],
      );
      if (!rows[0]) throw new Error('知识点不存在或不可见。');
      return {
        type: 'knowledge',
        title: rows[0].title,
        url: `/knowledge?${new URLSearchParams({ course: url.searchParams.get('course') || 'signals', point: url.searchParams.get('point') })}`,
        text: rows[0].body,
        truncated: rows[0].body.length >= 14000,
      };
    }
    const page = PAGES.find((item) => item.url === url.pathname);
    if (!page) throw new Error('没有此页面的导览信息。');
    return page;
  }
  return { search, read };
}
function createSiteSearchRouter(service, getOptionalAuthUser = async () => null) {
  const router = express.Router();
  router.get('/', async (request, response) => {
    response.set('Cache-Control', 'no-store');
    try {
      response.json(
        await service.search({
          q: request.query.q || '',
          type: request.query.type || 'all',
          offset: Number(request.query.offset || 0),
          limit: 20,
          user: await getOptionalAuthUser(request),
        }),
      );
    } catch (error) {
      response
        .status(error.status || 503)
        .json({ message: error.status ? error.message : '搜索暂时不可用，请稍后重试。' });
    }
  });
  return router;
}
module.exports = { PAGES, TYPES, keywords, excerpt, createSiteSearch, createSiteSearchRouter };
