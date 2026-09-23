const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const { createBoneSales, createBoneSalesRouter } = require('../backend/economy-sales');
const { createOnboardingPreview } = require('./preview-onboarding');
const { TOKEN } = require('./preview-economy');
const {
  GUIDE_VERSION,
  LEGACY_GUIDE_VERSIONS,
  LATEST_RELEASE,
} = require('../public/max-guide-releases');
const { STEPS, STATIONS, RELEASE_STEP_IDS } = require('../public/max-guide-stations');

test('onboarding preview uses real local pages, account progress and transactional wallet data', async (t) => {
  const { server, store } = createOnboardingPreview({
    now: () => Date.parse('2026-09-20T10:00:00Z'),
  });
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => {
      server.close(resolve);
    });
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const api = async (route, body, method = body ? 'POST' : 'GET') => {
    const response = await fetch(`${origin}${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        Origin: origin,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };

  await t.test(
    'pages and required renderers stay local; APIs reject other origins and unauthenticated calls',
    async () => {
      for (const route of [
        '/',
        '/guide',
        '/world',
        '/course',
        '/knowledge',
        '/aichat',
        '/workbench',
        '/inventory',
        '/settings',
        '/profile?uid=u_preview01',
        '/discussion',
        '/publish?board=daily',
        '/electromagnetic',
        '/circuit',
        '/circuits',
        '/surveys',
        '/development',
      ]) {
        const response = await fetch(`${origin}${route}`);
        assert.equal(response.status, 200, route);
        assert.match(response.headers.get('content-security-policy'), /connect-src 'self'/);
        const html = await response.text();
        assert.match(html, /window.FREEBBS_API_BASE='\/api'/);
        assert.doesNotMatch(html, /<link\b[^>]*href=["']https?:\/\//i);
      }
      for (const route of [
        '/vendor/marked/lib/marked.umd.js',
        '/vendor/katex/dist/katex.min.js',
        '/vendor/@highlightjs/cdn-assets/highlight.min.js',
      ]) {
        assert.equal((await fetch(`${origin}${route}`)).status, 200, route);
      }
      assert.equal((await fetch(`${origin}/api/onboarding`)).status, 403);
      assert.equal(
        (
          await fetch(`${origin}/api/onboarding`, {
            headers: { Authorization: `Bearer ${TOKEN}`, Origin: 'https://www.free-bbs.cn' },
          })
        ).status,
        403,
      );
      assert.equal((await fetch(`${origin}/backend/config.js`)).status >= 400, true);
      assert.equal((await fetch(`${origin}/vendor/express/index.js`)).status >= 400, true);
    },
  );

  await t.test(
    'preview loads the production shell in the same order for responsive guide QA',
    async () => {
      const production = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
      const styles = ['site-search', 'mobile-shell', 'desktop-elegant', 'page-transitions'];
      const scripts = ['site-search', 'mobile-shell', 'page-transitions'];
      const head = styles.map((name) => `<link rel="stylesheet" href="/${name}.css">`).join('');
      const body = scripts.map((name) => `<script src="/${name}.js" defer></script>`).join('');
      assert.ok(
        production.includes(head),
        'Keep the preview aligned with the production CSS order',
      );
      assert.ok(
        production.includes(body),
        'Keep the preview aligned with the production shell scripts',
      );
      for (const route of ['/settings', '/guide', '/world', '/discussion', '/aichat']) {
        const html = await (await fetch(origin + route)).text();
        assert.ok(html.includes(`${head}</head>`), `${route}: shell CSS must follow page CSS`);
        assert.ok(
          html.includes(`${body}</body>`),
          `${route}: shell scripts must follow page scripts`,
        );
        assert.equal(html.split('href="/desktop-elegant.css"').length - 1, 1, route);
      }
      for (const asset of [
        ...styles.map((name) => `/${name}.css`),
        ...scripts.map((name) => `/${name}.js`),
      ]) {
        assert.equal((await fetch(origin + asset)).status, 200, asset);
      }
    },
  );

  await t.test('Max guide anchors match the actual local conversation page', async () => {
    const html = await (await fetch(`${origin}/aichat`)).text();
    for (const id of ['max-conversation', 'max-composer', 'max-history']) {
      const step = STEPS.find((entry) => entry.id === id);
      assert.match(step.target, /^#[a-z][a-z0-9-]*$/);
      assert.ok(html.includes(`id="${step.target.slice(1)}"`), `${id}: ${step.target}`);
    }
    assert.ok(html.includes('class="aichat-auth-required"'));
    assert.ok(html.includes('id="aichat-dialog-toggle"'));
    assert.ok(html.includes('src="/max-composer.js"'), 'The dynamic options menu must be loaded');
  });

  await t.test(
    'discussion browsing reaches the real local editor without publishing content',
    async () => {
      const { boards } = await api('/api/discussion/boards');
      assert.ok(boards.some((board) => board.slug === 'daily'));
      const { posts } = await api('/api/discussion/posts?board=daily');
      const pinned = posts.find((post) => post.isPinned);
      assert.ok(pinned, 'The guide can open an actual pinned fixture');
      const { post } = await api(`/api/discussion/posts/${pinned.id}`);
      assert.match(post.contentMarkdown, /@Max/);
      const { comments } = await api(`/api/discussion/posts/${pinned.id}/comments`);
      assert.ok(comments.length > 0);

      // Follow the URL used by the real discussion create button, whose editor
      // now lives on a separate page rather than inside the discussion list.
      const client = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
      const editorRoute = client.match(/location\.href = '(\/publish\?board=)'/);
      assert.ok(editorRoute, 'The discussion button must expose its editor URL');
      const response = await fetch(origin + editorRoute[1] + encodeURIComponent(post.board.slug));
      assert.equal(response.status, 200);
      const html = await response.text();
      assert.match(html, /id="discussion-compose-form"/);
      assert.match(html, /src="\/publish\.js"/);
      assert.match(html, /window\.FREEBBS_API_BASE='\/api'/);
      assert.equal((await fetch(`${origin}/publish.js`)).status, 200);
      assert.equal((await fetch(`${origin}/publish.css`)).status, 200);

      const rejected = await fetch(`${origin}/api/discussion/posts`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          'Content-Type': 'application/json',
          Origin: origin,
        },
        body: JSON.stringify({
          boardSlug: 'daily',
          title: 'Preview only',
          contentMarkdown: '@Max',
        }),
      });
      assert.equal(rejected.status, 405);
      assert.match((await rejected.json()).message, /没有连接真实系统/);
      assert.deepEqual((await api('/api/discussion/posts?board=daily')).posts, posts);
    },
  );

  await t.test(
    'base, legacy and release receipts are isolated with read-only legacy task inheritance',
    async () => {
      const legacy = LEGACY_GUIDE_VERSIONS[0];
      const release = LATEST_RELEASE.id;
      await api(
        '/api/onboarding',
        { version: legacy, status: 'completed', step: 9, completedTasks: ['explore_world'] },
        'PATCH',
      );
      const base = await api('/api/onboarding');
      assert.equal(base.version, GUIDE_VERSION);
      assert.equal(base.status, 'not_started');
      assert.equal(base.seenAt, null);
      assert.equal(base.step, 0);
      assert.deepEqual(base.completedTasks, ['explore_world']);
      const beforeRelease = await api(`/api/onboarding?version=${release}`);
      assert.equal(beforeRelease.status, 'not_started');
      assert.deepEqual(beforeRelease.completedTasks, []);
      await api('/api/onboarding', { version: release, status: 'completed', step: 6 }, 'PATCH');
      assert.equal((await api(`/api/onboarding?version=${release}`)).status, 'completed');
      assert.deepEqual(await api('/api/onboarding'), base);
      assert.equal((await api(`/api/onboarding?version=${legacy}`)).status, 'completed');
      for (const [route, body, status] of [
        ['/api/onboarding?version=unknown-version', null, 409],
        ['/api/onboarding', { version: 'unknown-version' }, 409],
        ['/api/onboarding', { version: release, completedTasks: ['meet_max'] }, 400],
      ]) {
        const response = await fetch(origin + route, {
          method: body ? 'PATCH' : 'GET',
          headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        assert.equal(response.status, status, await response.text());
      }
    },
  );

  await t.test('guide progress, course map and workbench use their real UI contracts', async () => {
    assert.equal((await api('/api/onboarding')).status, 'not_started');
    await api(
      '/api/onboarding',
      { status: 'in_progress', step: 2, completedTasks: ['explore_world'] },
      'PATCH',
    );
    await api('/api/onboarding', { completedTasks: ['meet_max'] });
    assert.deepEqual((await api('/api/onboarding')).completedTasks, ['explore_world', 'meet_max']);
    const course = await api('/api/courses/signals/map');
    assert.equal(course.nodes.length, 4);
    const detail = await api(`/api/courses/signals/map/nodes/${course.nodes[0].id}`);
    assert.match(detail.node.markdown, /本地预览/);
    assert.equal((await api('/api/workbench/summary')).scheduleItems.length, 1);
    const event = await api(
      '/api/workbench/schedule-items/ws_existing',
      { title: '模拟修改' },
      'PATCH',
    );
    assert.equal(event.scheduleItem.title, '模拟修改');
    const response = await fetch(`${origin}/api/ai/chat`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hi' }),
    });
    assert.equal(response.status, 503);
    assert.match((await response.json()).message, /没有连接真实 AI/);
  });

  await t.test(
    'world courses lead to real local maps, readable sections and their course discussion boards',
    async () => {
      const world = fs.readFileSync(path.join(__dirname, '../public/world.js'), 'utf8');
      const knowledgeRenderer = fs.readFileSync(
        path.join(__dirname, '../public/knowledge.js'),
        'utf8',
      );
      for (const slug of ['math', 'signals', 'circuits']) {
        assert.match(world, new RegExp(`slug: '${slug}'`));
        const map = await api(`/api/courses/${slug}/map`);
        assert.equal(map.course.slug, slug);
        assert.equal(map.course.canEditMap, false);
        assert.ok(map.edges.every((edge) => edge.type === 'ordered'));
        const ids = new Set(map.nodes.map((node) => node.id));
        assert.ok(map.edges.every((edge) => ids.has(edge.source) && ids.has(edge.target)));
        for (const node of map.nodes) {
          const { node: detail } = await api(`/api/courses/${slug}/map/nodes/${node.id}`);
          for (const key of ['knowledgeMarkdown', 'basicInfoMarkdown', 'applicationsMarkdown']) {
            assert.match(knowledgeRenderer, new RegExp(`sections\\.${key}`));
            assert.match(detail.sections[key], /本地.*演示|本地预览/);
          }
          assert.equal(detail.markdown, detail.sections.knowledgeMarkdown);
          assert.match(detail.markdown, new RegExp(`/course\\?course=${slug}`));
          assert.doesNotMatch(detail.markdown, /https?:\/\//);
          assert.equal(
            (await fetch(`${origin}/knowledge?course=${slug}&point=${node.id}`)).status,
            200,
          );
        }
        const discussion = await api(`/api/discussion/posts?board=${map.course.boardSlug}`);
        assert.equal(discussion.posts.length, 1);
        assert.equal(discussion.posts[0].board.slug, map.course.boardSlug);
        assert.match(discussion.posts[0].title, /演示/);
      }
      const headers = { Authorization: `Bearer ${TOKEN}` };
      assert.equal((await fetch(`${origin}/api/courses/absent/map`, { headers })).status, 404);
      assert.equal(
        (await fetch(`${origin}/api/courses/math/map/nodes/absent`, { headers })).status,
        404,
      );
      const { posts } = await api('/api/discussion/posts?board=all');
      const pinned = posts.find((post) => post.isPinned);
      assert.ok(pinned);
      const { post } = await api(`/api/discussion/posts/${pinned.id}`);
      assert.match(post.contentMarkdown, /@Max/);
      const { comments } = await api(`/api/discussion/posts/${pinned.id}/comments`);
      assert.match(comments[0].contentMarkdown, /演示/);
      assert.deepEqual((await api('/api/discussion/posts?sort=unanswered')).posts, []);
      const attemptedPublish = await fetch(`${origin}/api/discussion/posts/${pinned.id}/comments`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentMarkdown: '@Max this must not be sent' }),
      });
      assert.ok(attemptedPublish.status >= 400);
      assert.deepEqual(
        (await api(`/api/discussion/posts/${pinned.id}/comments`)).comments,
        comments,
      );
    },
  );

  await t.test(
    'purchases, sales and retries update one inventory and ledger without duplicate money',
    async () => {
      assert.equal(store.account().magnetic, 86);
      assert.equal(store.account().assets.ordinary_fishbone, 12);
      const purchase = {
        currency: 'magnetic',
        expectedPurchaseCount: 0,
        quotedCost: { magnetic: 2 },
        requestKey: randomUUID(),
      };
      await api('/api/electromagnetic/shop/fish/purchase', purchase);
      assert.equal(store.account().magnetic, 84);
      assert.equal(store.account().assets.fish, 11);
      const sale = { itemKey: 'golden_fishbone', quantity: 2, requestKey: randomUUID() };
      const receipts = await Promise.all([
        api('/api/shop/sell', sale),
        api('/api/shop/sell', sale),
      ]);
      assert.equal(receipts.filter((receipt) => receipt.receipt.replayed).length, 1);
      assert.equal(store.account().magnetic, 104);
      assert.equal(store.account().assets.golden_fishbone, 1);
      const ledger = await api('/api/wallet/ledger');
      assert.equal(ledger.entries[0].magnetic_before, '84');
      assert.equal(ledger.entries[0].magnetic_after, '104');
      assert.match(ledger.entries[0].reason, /黄金鱼骨 × 2/);
      assert.match(ledger.entries[1].reason, /购买「小鱼」/);
      assert.equal(store.account().ledger.length, 38);
      assert.equal(ledger.entries.length, 30);
      assert.ok(ledger.nextCursor);
      assert.equal((await api(`/api/wallet/ledger?before=${ledger.nextCursor}`)).entries.length, 8);
      assert.equal((await api('/api/wallet/ledger?currency=electric')).entries.length, 0);
      const rejected = await fetch(`${origin}/api/shop/sell`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemKey: 'golden_fishbone',
          quantity: 10,
          requestKey: randomUUID(),
        }),
      });
      assert.equal(rejected.status, 409);
      assert.equal(store.account().magnetic, 104);
      assert.equal(store.account().ledger.length, 38);
    },
  );

  await t.test('checkin appears in the same ledger and filters validate input', async () => {
    const before = store.account().magnetic;
    await api('/api/checkin', {});
    assert.ok(store.account().magnetic > before);
    const ledger = await api('/api/wallet/ledger');
    assert.equal(ledger.entries[0].magnetic_before, String(before));
    assert.equal(ledger.entries[0].magnetic_after, String(store.account().magnetic));
    const response = await fetch(`${origin}/api/wallet/ledger?before=0`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(response.status, 400);
  });
});

test('station catalogue is browser/CommonJS compatible, version-independent, and has only audited read actions', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/max-guide-stations.js'), 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox);
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.window.FreeBbsGuideStations.STEPS)), STEPS);
  assert.ok(STEPS.length >= 30 && STEPS.length <= 201);
  assert.equal(new Set(STEPS.map((step) => step.id)).size, STEPS.length);
  assert.equal(new Set(STATIONS.map((station) => station.id)).size, STATIONS.length);
  const routes = new Map(STATIONS.map((station) => [station.id, station.route]));
  for (const station of STATIONS) {
    assert.match(station.route, /^\/[a-z]*$/);
    assert.match(station.fallbackRoute, /^\/[a-z]*$/);
  }
  const auditedControls = new Set([
    '.island-orbit-item[data-world-id="mathematics"]',
    '#world-enter-island',
    '#world-modal[open] [data-close-modal]',
    '#island-course-back',
    '#world-orbit',
    'a.island-course-planet[data-course-slug="math"]',
    '#course-map-reset-view',
    '[data-reader-node-id]',
    '[data-course-map-arrow-help-toggle]',
    '.course-reader-study-link',
    '#knowledge-return-overview',
    '#knowledge-start-reading',
    '#knowledge-chat-tab-discussion',
    '#knowledge-chat-close',
    '#knowledge-chat-toggle',
    '[data-action="close-detail"]',
    '#discussion-create-toggle',
    '.max-composer-tools > summary',
    '#aichat-dialog-toggle',
    '#workbench-plan-tab',
    '#workbench-notifications-tab',
    '#shop-grid [data-action="inspect-item"]',
    '#wallet-ledger-open',
    '#settings-profile-link',
    '#discussion-post-list .discussion-post-card:has(.discussion-pin-badge) [data-action="open-post"], #discussion-post-list:not(:has(.discussion-pin-badge)) [data-action="open-post"]',
  ]);
  for (const step of STEPS) {
    assert.equal(step.route, routes.get(step.station));
    for (const field of ['id', 'target', 'label', 'title', 'body', 'caption'])
      assert.ok(step[field], `${step.id}: ${field}`);
    assert.ok(Object.isFrozen(step));
    for (const view of [step, step.reveal].filter(Boolean)) {
      for (const control of [...(view.prepare || []), ...(view.action ? [view.action] : [])]) {
        assert.ok(
          auditedControls.has(control.selector),
          `New auto-click needs review: ${control.selector}`,
        );
        assert.ok(Object.isFrozen(control));
        if (control.alternateSelector) assert.ok(auditedControls.has(control.alternateSelector));
      }
      if (view.action) assert.ok(['click', 'link'].includes(view.action.kind));
    }
  }
  assert.equal(STEPS.length, 48);
  assert.equal(STATIONS.length, 14);
  assert.equal(RELEASE_STEP_IDS.length, 5);
  assert.deepEqual(LATEST_RELEASE.stepIds, RELEASE_STEP_IDS);
  for (const id of RELEASE_STEP_IDS) {
    const step = STEPS.find((entry) => entry.id === id);
    assert.ok(step, id);
    assert.ok(
      !['course', 'knowledge'].includes(step.station),
      'Short replay must not require a previously selected course or knowledge node',
    );
  }
  const step = (id) => STEPS.find((entry) => entry.id === id);
  assert.equal(step('world-atlas').target, '.world-orbit-shell');
  assert.equal(step('world-atlas').focus.fit, 'overview');
  assert.equal(step('course-directory').focus.fit, 'overview');
  assert.equal(step('knowledge-companions').target, '#knowledge-chat-toggle');
  assert.equal(step('knowledge-companions').reveal.target, '#knowledge-chat-panel');
  assert.equal(step('discussion-composer').target, '#discussion-create-toggle, .mobile-publish');
  assert.equal(step('discussion-composer').prepare, undefined);
  assert.equal(step('discussion-composer').action, undefined);
  assert.equal(step('inventory-ledger-filters').target, '#wallet-ledger[open] .wallet-toolbar');
  assert.equal(
    step('inventory-ledger').target,
    '#wallet-ledger[open] .wallet-ledger-entry:first-child',
  );
  assert.match(step('world-coming-islands').body, /没有开放课程/);
  assert.match(step('knowledge-tools-status').body, /只预留了入口/);
  assert.match(step('discussion-reply-max').body, /「@Max」的评论或回复/);
  assert.doesNotMatch(step('discussion-reply-max').body, /仅在发帖正文写/);
  assert.match(
    step('discussion-open-post').action.selector,
    /:not\(:has\(\.discussion-pin-badge\)\)/,
  );
  assert.match(step('inventory-recycling').body, /1 磁元.*10 磁元/);
  assert.match(step('inventory-ledger').body, /这笔交易之后/);
  assert.equal(step('profile-ranch').target, '#public-profile-ranch .ranch-scene');
  assert.equal(step('profile-ranch').emptyTarget, '#public-profile-ranch');
  assert.equal(step('profile-wool').target, '.ranch-wool-stages');
  assert.equal(step('profile-wool').emptyTarget, '#public-profile-ranch');
  assert.equal(step('profile-wool').action, undefined);
  assert.equal(step('profile-wool').prepare, undefined);
  assert.match(step('profile-wool').body, /5次.*5条.*1份.*7磁元.*2电元/);
  assert.match(step('profile-wool').body, /羊毛只在牧场保存/);
  assert.match(step('profile-wool').body, /北京时间每天最多剪1份.*待剪量.*保留/);
  assert.equal(step('max-history').prepare[0].whenMissing, '#aichat-dialogs');
});

test('the actual inventory client sale URL reaches both production router and local preview', async (t) => {
  const client = fs.readFileSync(path.join(__dirname, '../public/inventory-sales.js'), 'utf8');
  const clientCall = client.match(/app\.callApi\(['"]([^'"]+)['"]/);
  assert.ok(clientCall, 'inventory sale must call the application API');
  const clientRoute = `/api${clientCall[1]}`;
  const preview = createOnboardingPreview();
  const app = express();
  app.use(express.json());
  app.use(
    '/api',
    createBoneSalesRouter({
      sales: createBoneSales(preview.store),
      requireAuth: async () => ({ id: 1 }),
    }),
  );
  const productionRouterServer = app.listen(0, '127.0.0.1');
  const servers = [preview.server, productionRouterServer];
  t.after(async () => {
    for (const server of servers) {
      server.closeAllConnections();
      await new Promise((resolve) => {
        server.close(resolve);
      });
    }
  });
  await Promise.all([
    new Promise((resolve) => {
      preview.server.listen(0, '127.0.0.1', resolve);
    }),
    new Promise((resolve) => {
      productionRouterServer.once('listening', resolve);
    }),
  ]);
  const requestKey = randomUUID();
  const receipts = [];
  for (const server of servers) {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(origin + clientRoute, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        Origin: origin,
      },
      body: JSON.stringify({ itemKey: 'ordinary_fishbone', quantity: 1, requestKey }),
    });
    assert.equal(response.status, 200, `${clientRoute}: ${await response.clone().text()}`);
    receipts.push((await response.json()).receipt);
  }
  assert.equal(receipts[0].amount, 1);
  assert.equal(receipts[0].remainingQuantity, '11');
  assert.equal(receipts[0].replayed, false);
  assert.equal(receipts[1].replayed, true);
  assert.deepEqual(receipts[1], { ...receipts[0], replayed: true });
  assert.equal(preview.store.account().magnetic, 87);
});

test('rubber rod catalogue preserves permanent ownership, partner classification and native artwork', () => {
  const { items } = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../public/data/shop-items.json'), 'utf8'),
  );
  const rod = items.find((item) => item.key === 'rubber_rod');
  assert.equal(
    new Set(items.map((item) => item.key)).size,
    items.length,
    'Catalogue keys must be unique',
  );
  assert.ok(rod);
  assert.equal(rod.assetKey, 'rubber_rod');
  assert.equal(rod.name, '橡胶棒');
  assert.equal(rod.class, 'pet_tool');
  assert.deepEqual(rod.cost, { magnetic: 7 });
  assert.equal(rod.purchaseLimit, 1);
  assert.equal(rod.requiresPersonalPrice, true);
  assert.equal(rod.isgift, false);
  assert.match(rod.rules, /永久.*重复使用.*仍保留/);
  assert.match(rod.rules, /带负电.*每份羊毛.*2电元/);
  for (const key of ['rubber_rod', 'fish', 'max_pet'])
    assert.match(items.find((item) => item.key === key).rules, /北京时间每天最多剪1份/);
  assert.equal(
    items.some((item) => /wool|羊毛/.test(`${item.key} ${item.assetKey} ${item.name}`)),
    false,
  );
  const svg = fs.readFileSync(path.join(__dirname, '../public', rod.image), 'utf8');
  assert.match(svg, /<svg[^>]+viewBox="0 0 128 128"/);
  assert.match(svg, /<title[^>]*>橡胶棒<\/title>/);
  assert.doesNotMatch(svg, /<script|<foreignObject|\b(?:href|onload)\s*=/i);
  const twilight = items.find((item) => item.key === 'card_twilight');
  assert.match(twilight.desc, /现象、误差与灵光，或许会在一次安静的回望中，显出彼此的联系/);
});

test('preview rubber rod purchase uses the real price, one-item limit and idempotent receipt', async (t) => {
  const { server, store } = createOnboardingPreview();
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => {
      server.close(resolve);
    });
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const headers = {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
    Origin: origin,
  };
  const purchase = async (body, expectedStatus = 200) => {
    const response = await fetch(`${origin}/api/electromagnetic/shop/rubber_rod/purchase`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    assert.equal(response.status, expectedStatus, await response.clone().text());
    return response.json();
  };
  assert.equal(
    store.account().assets.rubber_rod || 0,
    0,
    'The preview must not grant the tool for free',
  );
  assert.equal(store.account().assets.fish, 10);
  const body = {
    currency: 'magnetic',
    expectedPurchaseCount: 0,
    quotedCost: { magnetic: 7 },
    requestKey: randomUUID(),
  };
  await purchase({ ...body, quotedCost: { magnetic: 6 } }, 409);
  assert.equal(store.account().magnetic, 86);
  const success = await purchase(body);
  assert.equal(success.purchase.replayed, false);
  assert.deepEqual(success.purchase.cost, { magnetic: 7 });
  assert.equal(store.account().magnetic, 79);
  assert.equal(store.account().electric, 120);
  assert.equal(store.account().assets.rubber_rod, 1);
  assert.equal(store.account().counts.rubber_rod, 1);
  const replay = await purchase(body);
  assert.equal(replay.purchase.replayed, true);
  await purchase({ ...body, expectedPurchaseCount: 1, requestKey: randomUUID() }, 409);
  assert.equal(store.account().magnetic, 79);
  assert.equal(store.account().assets.rubber_rod, 1);
  const ledger = await (await fetch(`${origin}/api/wallet/ledger`, { headers })).json();
  assert.match(ledger.entries[0].reason, /购买「橡胶棒」/);
  assert.equal(ledger.entries[0].magnetic_after, '79');
  const icon = await fetch(`${origin}/assets/icons/rubber-rod.svg`);
  assert.equal(icon.status, 200);
  assert.match(icon.headers.get('content-type'), /image\/svg\+xml/);
});

test('preview preserves same-day wool and permits a second shear after Beijing midnight without consuming the rod', async (t) => {
  let previewNow = Date.parse('2026-09-21T10:00:00Z');
  const { server, store } = createOnboardingPreview({
    now: () => previewNow,
  });
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => {
      server.close(resolve);
    });
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const headers = {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
    Origin: origin,
  };
  const api = async (route, body, expectedStatus = 200) => {
    const response = await fetch(origin + route, {
      method: body ? 'POST' : 'GET',
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(response.status, expectedStatus, await response.clone().text());
    return response.json();
  };
  const initial = await api('/api/profile/extras');
  assert.equal(initial.ranch.adopted, true);
  assert.equal(initial.fish, 10);
  assert.equal(initial.rubberRod, false);
  assert.equal(initial.ranch.shearedToday, false);
  assert.equal(initial.ranch.nextShearAtMs, 0);
  assert.deepEqual(
    [initial.ranch.feedProgress, initial.ranch.woolReady, initial.ranch.woolStored],
    [0, 0, 0],
  );
  await api('/api/electromagnetic/shop/rubber_rod/purchase', {
    currency: 'magnetic',
    expectedPurchaseCount: 0,
    quotedCost: { magnetic: 7 },
    requestKey: randomUUID(),
  });
  const heatAfterPurchase = store.account().heat;
  await api('/api/fortune');
  let firstShearRequest;
  for (let cycle = 1; cycle <= 2; cycle += 1) {
    for (let feeding = 1; feeding <= 5; feeding += 1) {
      const fed = await api('/api/profile/extras', { action: 'feed', requestKey: randomUUID() });
      assert.equal(fed.ranch.feedProgress, feeding % 5);
      assert.equal(fed.ranch.woolReady, feeding === 5 ? 1 : 0);
      assert.equal(fed.ranch.woolStored, 0);
    }
    await api('/api/profile/extras', { action: 'rub_wool', requestKey: randomUUID() }, 400);
    const shearRequest = { action: 'shear', requestKey: randomUUID() };
    if (cycle === 2) {
      const midnight = Date.parse('2026-09-21T16:00:00Z');
      previewNow = midnight - 1;
      const waiting = await api('/api/profile/extras');
      assert.equal(waiting.ranch.shearedToday, true);
      assert.equal(waiting.ranch.nextShearAtMs, midnight);
      assert.equal(waiting.ranch.woolReady, 1);
      const beforeDenied = structuredClone(store.account());
      const denied = await api('/api/profile/extras', shearRequest, 400);
      assert.equal(denied.message, 'Max 被薅秃了，明天再来吧。');
      assert.deepEqual(
        store.account(),
        beforeDenied,
        'A daily-limit error must preserve wool, fish, money and action receipts',
      );
      previewNow = midnight;
      const nextDay = await api('/api/profile/extras');
      assert.equal(nextDay.ranch.shearedToday, false);
      assert.equal(nextDay.ranch.nextShearAtMs, 0);
      assert.equal(nextDay.ranch.woolReady, 1);
      const oldReplay = await api('/api/profile/extras', firstShearRequest);
      assert.equal(oldReplay.result.replayed, true);
      assert.equal(
        oldReplay.ranch.shearedToday,
        false,
        'Replaying yesterday must not use today’s shear allowance',
      );
    }
    const sheared = await api('/api/profile/extras', shearRequest);
    if (cycle === 1) firstShearRequest = shearRequest;
    assert.deepEqual([sheared.ranch.woolReady, sheared.ranch.woolStored], [0, 1]);
    assert.equal(sheared.ranch.shearedToday, true);
    assert.equal((await api('/api/profile/extras', shearRequest)).result.replayed, true);
    const rubRequest = { action: 'rub_wool', requestKey: randomUUID() };
    const rubbed = await api('/api/profile/extras', rubRequest);
    assert.equal(rubbed.result.electricReward, 2);
    assert.equal(rubbed.ranch.woolStored, 0);
    assert.equal(rubbed.rubberRod, true);
    assert.equal(rubbed.user.electrons, 120 + 2 * cycle);
    assert.equal((await api('/api/profile/extras', rubRequest)).result.replayed, true);
    assert.equal(store.account().electric, 120 + 2 * cycle);
    assert.equal(store.account().magnetic, 79);
    assert.equal(store.account().heat, heatAfterPurchase, 'Farming income is not spending heat');
    assert.equal(store.account().assets.rubber_rod, 1);
    assert.equal(store.account().counts.rubber_rod, 1);
  }
  const finalState = await api('/api/profile/extras');
  const { profile } = await api('/api/users/u_preview01/public-profile');
  assert.deepEqual(
    profile.ranch,
    finalState.ranch,
    'Public profile reads the same updated in-memory ranch',
  );
  assert.equal(finalState.fish, 0);
  assert.equal(
    Object.keys(store.account().assets).some((key) => /wool/.test(key)),
    false,
  );
  const ledger = await api('/api/wallet/ledger');
  assert.equal(ledger.entries[0].electric_after, '124');
  assert.equal(ledger.entries[1].electric_after, '122');
  assert.match(ledger.entries[0].reason, /羊毛/);
});
