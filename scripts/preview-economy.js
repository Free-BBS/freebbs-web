const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { createEconomyShop } = require('../backend/economy-shop');
const { createEconomyMemoryStore } = require('./fixtures/economy-memory-store');
const { createProfileExtras, beijingDay } = require('../backend/profile-extras');
const { FISHBONE_MASTER } = require('../backend/economy-achievements');
const { effectiveFortune, checkinReward } = require('../backend/economy-policy');

const root = path.resolve(__dirname, '..', 'public');
const TOKEN = 'economy-preview-only-not-a-real-session';
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};
const pages = {
  '/': 'electromagnetic.html',
  '/electromagnetic': 'electromagnetic.html',
  '/inventory': 'inventory.html',
  '/discussion': 'discussion.html',
  '/profile': 'profile.html',
  '/settings': 'settings.html',
};
function createEconomyPreview({ now = Date.now, showcase = false, extraPages = {}, previewApiHandler = null } = {}) {
  const previewPages = { ...pages, ...extraPages };
  const isWorkbenchPreview = previewPages['/workbench'] === 'workbench.html';
  const store = createEconomyMemoryStore([
    { id: 1, assets: { fishbone: 2 }, counts: { fishbone: 2 }, checkins: {} },
    { id: 2 },
  ]);
  if (showcase) {
    // Demo-only assets: no purchase, reward or production account is involved.
    for (const id of [1, 2]) {
      const account = store.account(id);
      for (const key of [
        'frame_orbit',
        'frame_aurora',
        'plate_observer',
        'card_blueprint',
        'card_twilight',
        'max_pet',
      ]) {
        account.assets[key] = 1;
        account.counts[key] = 1;
      }
      account.assets.fish = 3;
      account.fedUntilMs = now() + 86400000;
      account.equipped = {
        frame: id === 1 ? 'frame_aurora' : 'frame_orbit',
        nameplate: 'plate_observer',
        card: id === 1 ? 'card_twilight' : 'card_blueprint',
      };
    }
  }
  const shop = createEconomyShop(store, { now });
  const extras = createProfileExtras(store, { now });
  function todayFortune() {
    const date = beijingDay(now());
    // A deterministic QA score, stored once per Beijing day, never a production override.
    const account = store.account();
    if (account.fortunes[date] === undefined) account.fortunes[date] = 90;
    account.fortunes[date] = effectiveFortune(account.fortunes[date], account.luckUntilMs, now());
    return { date, score: account.fortunes[date] };
  }
  function checkinSummary() {
    const fortune = todayFortune();
    const account = store.account();
    return {
      checkedInToday: Boolean(account.checkins[fortune.date]),
      today: account.checkins[fortune.date] || null,
      todayFortune: fortune,
      records: Object.values(account.checkins)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 14),
    };
  }
  const items = JSON.parse(fs.readFileSync(path.join(root, 'data/shop-items.json'))).items.map(
    (item) => ({ ...item, isGift: item.isgift !== false }),
  );
  const user = () => ({
    id: 1,
    uid: 'u_preview01',
    username: 'NotingSr_preview',
    fullName: '模拟体验账号',
    studentId: 'QA-ONLY',
    role: 'student',
    isAdmin: false,
    electrons: store.account().electric,
    manetrons: store.account().magnetic,
    heat: store.account().heat,
  });
  async function economy() {
    return {
      user: user(),
      shopItems: await shop.decorate(items, 1),
      assets: Object.entries(store.account().assets)
        .filter(([, quantity]) => quantity > 0)
        .map(([key, quantity]) => ({
          key,
          quantity,
          item: items.find((i) => i.assetKey === key),
          ...(key === FISHBONE_MASTER.key ? { metadata: FISHBONE_MASTER, isGift: false } : {}),
        })),
    };
  }
  async function posts() {
    const decorated = await shop.decoratePosts([
      { user_id: 1 },
      { user_id: 2 },
      { user_id: 1, is_anonymous: true },
    ]);
    return decorated.map((row, i) => ({
      id: String(i + 1),
      title: ['电生光：我的讨论区小实验', '另一位同学的普通帖子', '匿名帖不会携带激光器装饰'][i],
      contentMarkdown:
        '这里是本地模拟帖子。充值后观察卡片边缘的柔光；到期自动熄灭，不影响正文阅读。',
      board: { slug: 'daily', name: '日常' },
      createdAt: '2026-09-14T03:00:00.000Z',
      author:
        i === 2
          ? { displayName: '匿名用户', username: '匿名用户' }
          : {
              id: row.user_id,
              uid: `u_preview0${row.user_id}`,
              username: i === 0 ? 'NotingSr_preview' : 'another_student',
              cosmetics: row.cosmetics,
            },
      isAnonymous: Boolean(row.is_anonymous),
      laser: row.laser,
      commentCount: 0,
      likeCount: 0,
      lightCount: 0,
      fireworksCount: 0,
    }));
  }
  const server = http.createServer(async (req, res) => {
    const host = `127.0.0.1:${server.address().port}`;
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, {
        'Content-Type': type,
        'Cache-Control': 'no-store',
        'Content-Security-Policy':
          "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
      });
      res.end(typeof body === 'object' && !Buffer.isBuffer(body) ? JSON.stringify(body) : body);
    };
    try {
      if (req.headers.host !== host) return send(403, { message: 'Loopback preview only' });
      const url = new URL(req.url, `http://${host}`);
      const route = decodeURIComponent(url.pathname);
      if (
        previewApiHandler &&
        (route.startsWith('/api/workbench/') || route.startsWith('/api/notifications'))
      ) {
        if (
          req.headers.authorization !== `Bearer ${TOKEN}` ||
          (req.headers.origin && req.headers.origin !== `http://${host}`)
        ) return send(403, { message: '仅限本地模拟操作' });
        let raw = '';
        if (!['GET', 'HEAD'].includes(req.method)) {
          for await (const chunk of req) {
            raw += chunk;
            if (raw.length > 32768) throw new Error('请求过大');
          }
        }
        const result = await previewApiHandler({
          route,
          url,
          method: req.method,
          body: raw ? JSON.parse(raw) : {},
        });
        if (result) return send(result.status || 200, result.body);
        return send(404, { message: '该操作不在工作台预览范围内' });
      }
      if (!['GET', 'HEAD'].includes(req.method)) {
        if (
          req.method !== 'POST' ||
          req.headers.authorization !== `Bearer ${TOKEN}` ||
          (req.headers.origin && req.headers.origin !== `http://${host}`)
        )
          return send(403, { message: '仅限本地模拟操作' });
        let raw = '';
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 32768) throw new Error('请求过大');
        }
        const body = JSON.parse(raw || '{}');
        if (route === '/api/checkin') {
          const fortune = todayFortune();
          const account = store.account();
          const alreadyCheckedIn = Boolean(account.checkins[fortune.date]);
          if (!alreadyCheckedIn) {
            const previous = account.checkins[beijingDay(now() - 86400000)];
            const streak = (previous?.streak || 0) + 1;
            const reward = checkinReward(streak, fortune.score, fortune.date);
            const bonus = reward.luckBonus;
            const rewardMagnetic = reward.rewardMagnetic + bonus;
            account.checkins[fortune.date] = {
              date: fortune.date,
              streak,
              rewardMagnetic,
              rewardElectrons: reward.rewardElectrons,
              fortuneScore: fortune.score,
            };
            account.magnetic += rewardMagnetic;
            account.electric += reward.rewardElectrons;
            if (bonus) account.rewards[`luck:${fortune.date}`] = 1;
          }
          return send(200, { alreadyCheckedIn, summary: checkinSummary(), user: user() });
        }
        if (route === '/api/profile/extras') {
          const result = await extras.act({ ...body, userId: 1 });
          return send(200, { result, ...(await extras.ownState(1)), user: user() });
        }
        if (route === '/api/electromagnetic/convert') {
          const result = await extras.act({
            userId: 1,
            action: 'convert',
            itemKey: body.direction,
            requestKey: body.requestKey,
          });
          return send(200, { result, ...(await economy()) });
        }
        const match = route.match(/^\/api\/electromagnetic\/shop\/([a-z_]+)\/purchase$/);
        if (match || route === '/api/electromagnetic/laser/charge') {
          const item = items.find((i) => i.key === (match ? match[1] : 'laser'));
          const purchase = await shop.purchase({
            ...body,
            userId: 1,
            item,
            action: match ? 'purchase' : 'charge',
          });
          return send(200, { ...(await economy()), purchase });
        }
        if (route === '/__qa/expire') {
          store.account().expiresAtMs = now() + 10000;
          return send(200, { ok: true });
        }
        return send(405, { message: '预览未实现此写操作；没有连接真实系统' });
      }
      if (route === '/api/auth/me' || route === '/api/profile') return send(200, { user: user() });
      if (route === '/api/profile/username')
        return send(200, {
          policy: {
            username: user().username,
            freeAvailable: true,
            cost: 0,
            balance: store.account().magnetic,
            nextFreeAt: null,
          },
        });
      if (route === '/api/electromagnetic') return send(200, await economy());
      if (route === '/api/profile/extras') return send(200, await extras.ownState(1));
      if (route.startsWith('/api/users/') && route.endsWith('/public-profile')) {
        const uid = route.split('/')[3];
        let id = 0;
        if (uid === 'u_preview01') id = 1;
        if (uid === 'u_preview02') id = 2;
        if (!id) return send(404, { message: '未找到模拟用户' });
        return send(200, {
          profile: {
            id,
            uid,
            username: id === 1 ? 'NotingSr_preview' : 'another_student',
            bio: '本地展示用账号',
            collectibles: await shop.publicCollectibles(items, id),
            ...(await extras.publicProfile(id)),
          },
        });
      }
      if (route === '/api/discussion/posts')
        return send(200, { posts: await posts(), nextCursor: null });
      if (/^\/api\/discussion\/posts\/\d+\/comments$/.test(route)) {
        const rows = showcase
          ? await shop.decoratePosts([
              { id: 1001, user_id: 1, parentCommentId: null },
              { id: 1002, user_id: 2, parentCommentId: 1001 },
              { id: 1003, user_id: 1, parentCommentId: 1002 },
            ])
          : [];
        return send(200, {
          comments: rows.map((row) => ({
            id: row.id,
            parentCommentId: row.parentCommentId,
            author: {
              id: row.user_id,
              uid: `u_preview0${row.user_id}`,
              username: row.user_id === 1 ? 'NotingSr_preview' : 'another_student',
            },
            contentMarkdown:
              row.user_id === 1
                ? '这是我以前发布的回帖，柔光跟随我的激光器。'
                : '我的回帖保持自己的状态。',
            createdAt: '2020-01-01T08:00:00Z',
            laser: row.laser,
          })),
        });
      }
      if (/^\/api\/discussion\/posts\/\d+$/.test(route))
        return send(200, { post: (await posts()).find((p) => p.id === route.split('/').pop()) });
      if (route === '/api/discussion/boards')
        return send(200, { boards: [{ slug: 'daily', name: '日常', postCount: 3 }] });
      if (route === '/api/discussion/stats')
        return send(200, { boards: [], totalPosts: 3, totalComments: 0 });
      if (route.startsWith('/api/notifications')) return send(200, { items: [], unreadCount: 0 });
      if (route === '/api/fortune-config') return send(200, { fortuneBonusEnabled: false });
      if (route === '/api/checkin') return send(200, checkinSummary());
      if (route === '/api/rewards') return send(200, { rewards: [], nextCursor: null });
      if (route === '/api/wallet/ledger') return send(200, { entries: [], nextCursor: null });
      if (route === '/api/fortune') {
        const today = todayFortune();
        return send(200, {
          fortuneBonusEnabled: false,
          today,
          history: Object.entries(store.account().fortunes)
            .sort(([a], [b]) => a.localeCompare(b))
            .slice(-14)
            .map(([date, score]) => ({ date, score })),
        });
      }
      if (route.startsWith('/api/')) return send(404, { message: '该功能未接入本地模拟' });
      if (route.includes('\\') || route.includes('\0') || route.split('/').includes('..'))
        return send(400, { message: 'Invalid path' });
      const file = await fs.promises.realpath(path.join(root, previewPages[route] || route.slice(1)));
      const realRoot = await fs.promises.realpath(root);
      const relative = path.relative(realRoot, file);
      if (relative.startsWith('..') || path.isAbsolute(relative) || !mime[path.extname(file)])
        return send(403, { message: 'Preview static assets only' });
      let content = await fs.promises.readFile(file);
      if (path.extname(file) === '.html') {
        if (!previewPages[route]) return send(404, { message: '此页面不在本轮预览范围内' });
        content = content
          .toString()
          .replace(/<link\b[^>]*href=["']https?:\/\/[^>]*>/gi, '')
          .replace(
            '</head>',
            `<script>window.FREEBBS_API_BASE='/api';localStorage.setItem('free_bbs_auth_token','${TOKEN}');if(!localStorage.getItem('free_bbs_theme_mode'))localStorage.setItem('free_bbs_theme_mode','light');</script></head>`,
          )
          .replace(
            '</body>',
            `<details data-preview-notice style="position:relative;margin:12px;padding:12px;max-width:calc(100vw - 24px);border-radius:14px;background:#133c45;color:white;font:14px/1.6 system-ui">
            <summary>${isWorkbenchPreview ? '工作台交互预览 · 模拟日程与通知 · 未发布' : '商城实验 · 模拟余额 · 未发布'}</summary>
            ${isWorkbenchPreview ? '<p>个人计划、重要事项与通知使用内存模拟数据；常见时间表达可测试，但未连接真实 AI、数据库或校内系统。关闭预览后数据清空。</p>' : ''}
            ${showcase ? '<p>本预览已预置样例装扮、Max与小鱼，方便试穿；均为临时模拟数据。</p>' : ''}
            <p><a style="color:#b7f1f2" href="/electromagnetic">商城</a> · <a style="color:#b7f1f2" href="/inventory">仓库／充值</a> · <a style="color:#b7f1f2" href="/discussion">讨论区柔光</a> · <a style="color:#b7f1f2" href="/profile?uid=u_preview01">公开主页</a> · <a style="color:#b7f1f2" href="/settings">个人设置／牧场</a></p>
            <p>只使用内存中的 10000 电元＋10000 磁元，重启清空。<br>测试账号默认祥瑞，可验证喂养与福袋。<br>真实数据库、完整钱包账本仍需联验。</p>
            <button onclick="fetch('/__qa/expire',{method:'POST',headers:{Authorization:'Bearer ${TOKEN}'}}).then(()=>location.href='/discussion')">测试 10 秒后熄灭（须先买激光器）</button>
            <button data-preview-theme onclick="window.freeBbsApp.toggleThemeMode(event)">切换明暗</button>
          </details></body>`,
          );
      }
      if (route === '/notifications.js' || route === '/username-guard.js') {
        const variable = route === '/notifications.js' ? 'apiBase' : 'api';
        content = content
          .toString()
          .replace(
            new RegExp(`^  const ${variable} = local \\?[^;\\r\\n]+;`, 'm'),
            `  const ${variable} = '/api';`,
          );
      }
      return send(200, content, mime[path.extname(file)]);
    } catch (error) {
      return send(error.status || 400, { message: error.message, code: error.code });
    }
  });
  return { server, store, shop };
}
if (require.main === module) {
  const port = Number(process.env.ECONOMY_PREVIEW_PORT || 3112);
  createEconomyPreview({ showcase: process.env.ECONOMY_PREVIEW_SHOWCASE === '1' }).server.listen(
    port,
    '127.0.0.1',
    () =>
      console.log(
        `Economy memory preview: http://127.0.0.1:${port}/ (no database or external API)`,
      ),
  );
}
module.exports = { createEconomyPreview };
