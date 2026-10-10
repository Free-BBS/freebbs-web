const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const {
  PAGES,
  keywords,
  excerpt,
  createSiteSearch,
  createSiteSearchRouter,
} = require('./site-search');

test('Chinese keywords support conversational requests and literal wildcard characters stay parameters', async () => {
  assert.ok(keywords('推荐一些关于滤波器的帖子', true).includes('滤波'));
  assert.ok(!keywords('推荐一些关于滤波器的帖子', true).includes('推荐'));
  const calls = [];
  const service = createSiteSearch({
    execute: async (options, params) => {
      calls.push({ options, params });
      return [[]];
    },
  });
  await service.search({ q: "电路 x' OR 1=1", type: 'post' });
  assert.equal(calls.length, 1);
  assert.match(calls[0].options.sql, /p\.is_deleted = 0 AND p\.is_hidden = 0 AND b\.is_active = 1/);
  assert.doesNotMatch(calls[0].options.sql, /x' OR 1=1/);
  assert.ok(calls[0].params.includes('%电路%'));
  assert.equal(calls[0].options.timeout, 3500);
});

test('search ranks across categories, paginates without duplicates and excludes private fields', async () => {
  const service = createSiteSearch({
    execute: async ({ sql }) => [
      [
        {
          id: sql.includes('discussion_posts')
            ? 'p_one'
            : sql.includes('course_map_nodes')
              ? 'signals/SS-01'
              : sql.includes('circuit_revisions')
                ? 'c_one'
                : 'signals',
          title: '滤波器',
          body: '这是滤波器实验',
          section: '信号系统',
          score: sql.includes('discussion_posts') ? 9 : 1,
          featured: 0,
        },
      ],
    ],
  });
  const first = await service.search({ q: '滤波器', limit: 2 });
  const next = await service.search({ q: '滤波器', limit: 2, offset: 2 });
  assert.equal(first.results[0].type, 'post');
  assert.equal(first.results[0].url, '/discussion?post=p_one');
  assert.equal(first.results[0].featured, false);
  assert.equal(first.hasMore, true);
  assert.equal(new Set([...first.results, ...next.results].map((item) => item.url)).size, 4);
  assert.ok(!JSON.stringify(first).includes('student_id'));
});

test('page-only search does not access the database and knows real UI entries', async () => {
  const service = createSiteSearch({
    execute: () => assert.fail('page-only search must not query DB'),
  });
  const result = await service.search({ q: '电路', type: 'page' });
  assert.ok(result.results.some((item) => item.url === '/circuit'));
  assert.ok(PAGES.some((page) => page.url === '/search'));
  await assert.rejects(service.search({ q: 'x'.repeat(121) }), { status: 400 });
  await assert.rejects(service.search({ type: 'users' }), { status: 400 });
  await assert.rejects(service.search({ offset: -1 }), { status: 400 });
});

test('direct post reads recheck visibility and do not expose author identity or deleted comments', async () => {
  const calls = [];
  const service = createSiteSearch({
    execute: async (options, params) => {
      calls.push({ options, params });
      return options.sql.includes('FROM discussion_posts')
        ? [[{ id: 1, pid: 'p_one', title: '正文', body: '公开正文', section: '讨论' }]]
        : [[{ text: '公开评论' }]];
    },
  });
  const post = await service.read('/discussion?post=p_one', 'https://www.free-bbs.cn');
  assert.equal(post.text, '公开正文');
  assert.deepEqual(post.recentComments, ['公开评论']);
  assert.match(calls[0].options.sql, /p.is_hidden = 0/);
  assert.match(calls[1].options.sql, /is_deleted = 0/);
  assert.doesNotMatch(calls[0].options.sql, /user_id|student_id|username/);
  await assert.rejects(
    service.read('https://evil.test/discussion?post=p_one', 'https://www.free-bbs.cn'),
    /本站/,
  );
  const absent = createSiteSearch({ execute: async () => [[]] });
  await assert.rejects(absent.read('/discussion?post=hidden', 'https://www.free-bbs.cn'), /不可见/);
});

test('snippets strip markup and keep matching text', () => {
  assert.match(
    excerpt(`${'很长'.repeat(80)}滤波器 **正文** <script>bad</script>`, ['滤波器'], 80),
    /滤波器 正文/,
  );
  assert.doesNotMatch(excerpt('<img src=x onerror=alert(1)>正文', []), /<img/);
});

test('HTTP search validates arguments, returns no-store, and gives an explicit failure', async (t) => {
  const app = express();
  app.use(
    '/api/search',
    createSiteSearchRouter(
      createSiteSearch({
        execute: async () => {
          throw new Error('private database details');
        },
      }),
    ),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => {
    server.once('listening', resolve);
  });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/search`;
  const pages = await fetch(`${base}?q=搜索&type=page`);
  assert.equal(pages.status, 200);
  assert.equal(pages.headers.get('cache-control'), 'no-store');
  assert.equal((await fetch(`${base}?type=private`)).status, 400);
  const fail = await fetch(`${base}?type=post`);
  assert.equal(fail.status, 503);
  assert.doesNotMatch(await fail.text(), /private database details/);
});

test('post search and direct reads use only server-authenticated visibility', async () => {
  const queries = [];
  const service = createSiteSearch({
    execute: async ({ sql }) => {
      queries.push(sql);
      if (sql.includes('p.login_required = 0')) return [[]];
      if (sql.includes('discussion_comments')) return [[{ text: 'private comment' }]];
      return [[{ id: 1, pid: 'private', title: 'private title', body: 'private body', score: 1 }]];
    },
  });
  assert.equal((await service.search({ type: 'post' })).results.length, 0);
  await assert.rejects(service.read('/discussion?post=private', 'https://www.free-bbs.cn'));
  assert.equal((await service.search({ type: 'post', user: { id: 7 } })).results.length, 1);
  assert.equal(
    (await service.read('/discussion?post=private', 'https://www.free-bbs.cn', { id: 7 })).text,
    'private body',
  );
  assert.ok(queries.every((sql) => sql.includes('p.is_hidden = 0')));
});

test('knowledge search and reads never expose or rank private assessment source', async () => {
  const privateBlock =
    '\n```freebbs-quiz\n{"scoring":{"answer":"private-answer","target":12345,"rubric":"private-rubric"}}\n```';
  const rows = [
    {
      id: 'signals/SS-01',
      title: '卷积',
      section: '信号系统',
      score: 999,
      knowledge_markdown: `公开卷积正文${privateBlock}`,
      basic_info_markdown: `课程概览${privateBlock}`,
      applications_markdown: `公开应用${privateBlock}`,
      body: `公开卷积正文${privateBlock}`,
    },
  ];
  const service = createSiteSearch({ execute: async () => [rows] });
  const hidden = await service.search({ q: 'private-answer', type: 'knowledge' });
  assert.deepEqual(hidden.results, [], 'private keys must not be a search oracle');
  const publicResult = await service.search({ q: '卷积', type: 'knowledge' });
  assert.equal(publicResult.results.length, 1);
  assert.equal(
    publicResult.results[0].score,
    keywords('卷积').length * 9,
    'rank only the public title and text',
  );
  assert.match(publicResult.results[0].excerpt, /公开卷积正文/);
  assert.doesNotMatch(
    JSON.stringify(publicResult),
    /freebbs-quiz|private-answer|private-rubric|12345/,
  );
  const document = await service.read(
    '/knowledge?course=signals&point=SS-01',
    'https://www.free-bbs.cn',
  );
  assert.match(document.text, /公开卷积正文/);
  assert.match(document.text, /公开应用/);
  assert.doesNotMatch(JSON.stringify(document), /freebbs-quiz|private-answer|private-rubric|12345/);
  assert.equal(document.truncated, false);
});

test('knowledge public text strips each section before legacy splitting, joining and truncation', async () => {
  const service = createSiteSearch({
    execute: async () => [
      [
        {
          id: 'signals/SS-01',
          title: '信号',
          knowledge_markdown:
            '公开正文\r\n~~~FREEBBS-QUIZ\r\n## 基本信息\r\n章节/单元: hidden-chapter\r\n~~~~\r\n正文结束',
          basic_info_markdown: '公开概览\n```freebbs-quiz\nhidden-unclosed',
          applications_markdown: '公开应用',
          body: '公开正文\n```freebbs-quiz\nhidden-unclosed',
        },
      ],
    ],
  });
  const result = await service.read(
    '/knowledge?course=signals&point=SS-01',
    'https://www.free-bbs.cn',
  );
  assert.match(result.text, /公开正文/);
  assert.match(result.text, /正文结束/);
  assert.match(result.text, /公开概览/);
  assert.match(result.text, /公开应用/);
  assert.doesNotMatch(result.text, /hidden|freebbs-quiz/i);
});

test('private-only matches cannot displace public results or influence pagination', async () => {
  const privateRows = Array.from({ length: 30 }, (_, index) => ({
    id: `signals/SS-${index}`,
    title: '其他知识',
    knowledge_markdown: '\x60\x60\x60freebbs-quiz\nhiddenassessmenttoken\n\x60\x60\x60',
  }));
  const rows = [
    ...privateRows,
    ...Array.from({ length: 3 }, (_, index) => ({
      id: `signals/SS-public-${index}`,
      title: `visiblecourseterm ${index}`,
      knowledge_markdown: `正文\n\x60\x60\x60freebbs-quiz\n${'hiddenassessmenttoken'.repeat(3000)}\n\x60\x60\x60\nvisiblecourseterm 保留后续内容`,
    })),
  ];
  const calls = [];
  const service = createSiteSearch({
    execute: async ({ sql }) => {
      calls.push(sql);
      const [, count, offset] = sql.match(/LIMIT (\d+) OFFSET (\d+)/);
      return [rows.slice(Number(offset), Number(offset) + Number(count))];
    },
  });
  const hidden = await service.search({ q: 'hiddenassessmenttoken', type: 'knowledge', limit: 2 });
  assert.deepEqual(hidden.results, []);
  assert.equal(hidden.hasMore, false);
  const first = await service.search({ q: 'visiblecourseterm', type: 'knowledge', limit: 2 });
  const second = await service.search({
    q: 'visiblecourseterm',
    type: 'knowledge',
    limit: 2,
    offset: 2,
  });
  assert.equal(first.results.length, 2);
  assert.equal(first.hasMore, true);
  assert.equal(second.results.length, 1);
  assert.equal(second.hasMore, false);
  assert.equal(new Set([...first.results, ...second.results].map((item) => item.id)).size, 3);
  assert.doesNotMatch(JSON.stringify(first), /hiddenassessmenttoken/);
  assert.match(first.results[0].excerpt, /保留后续内容/);
  assert.ok(
    calls.every((sql) => !/LEFT\(| LIKE | AS score/.test(sql)),
    'private source is never clipped, matched or ranked by SQL',
  );
});

test('public knowledge matching retains case and accent-insensitive search without private scoring', async () => {
  const service = createSiteSearch({
    execute: async () => [
      [
        {
          id: 'signals/SS-01',
          title: 'Schrödinger 方程',
          knowledge_markdown: '公開 Straße 与 Æther。\n```freebbs-quiz\nprivate-café-answer\n```',
        },
      ],
    ],
  });
  for (const query of ['schrodinger', 'SCHRÖDINGER', 'straße', 'strasse', 'aether']) {
    const result = await service.search({ q: query, type: 'knowledge' });
    assert.equal(result.results.length, 1, query);
    assert.doesNotMatch(JSON.stringify(result), /private-café-answer/);
  }
  assert.equal((await service.search({ q: 'cafe', type: 'knowledge' })).results.length, 0);
});
