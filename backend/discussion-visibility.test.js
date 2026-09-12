const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const visibility = require('./discussion-visibility');

const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const author = { id: 7, username: 'author', student_id: 'student7' };
const peer = { id: 8, username: 'peer' };
const admin = { id: 9, username: 'admin', is_admin: true };
const post = (id, extra = {}) => ({
  id,
  pid: `PUBLIC${id}`,
  user_id: 7,
  board_id: 1,
  board_slug: 'signals',
  board_name: '信号',
  username: 'author',
  title: `Post ${id}`,
  content_markdown: 'Private-capable body',
  is_deleted: 0,
  is_hidden: 0,
  ...extra,
});

function harness(records = [post(1)]) {
  const routes = new Map();
  const queries = [];
  let viewer = null;
  let onLock = null;
  const app = Object.fromEntries(
    ['get', 'post', 'patch', 'delete'].map((method) => [
      method,
      (url, callback) => routes.set(`${method} ${url}`, callback),
    ]),
  );
  function filtered(sql, params) {
    return records.filter((row) => {
      if (row.is_deleted) return false;
      if (sql.includes('AND p.user_id = ?')) {
        if (row.user_id !== viewer?.id) return false;
      } else if (sql.includes('(p.is_hidden = 0 OR p.user_id = ?)')) {
        if (!visibility.canReadPost(row, viewer)) return false;
      } else if (sql.includes('p.is_hidden = 0') && row.is_hidden) return false;
      if (sql.includes('b.slug = ?') && row.board_slug !== 'signals') return false;
      if (sql.includes('WHERE p.id = ?') && row.id !== params.at(-2)) return false;
      if (sql.includes('AND p.id < ?') && row.id >= Number(params.at(-1))) return false;
      return true;
    });
  }
  const connection = {
    async execute(sql, params = []) {
      queries.push({ sql, params });
      assert.equal(
        (sql.match(/\?/g) || []).length,
        params.length + (sql.includes("LIKE '/discussion?post=%'") ? 1 : 0),
        'all SQL placeholders are bound',
      );
      if (sql.includes('FOR UPDATE')) {
        onLock?.();
        return [[records.find((row) => row.id === params[0])].filter(Boolean)];
      }
      if (sql.startsWith('UPDATE discussion_posts SET is_hidden')) {
        const row = records.find((item) => item.id === params[1]);
        row.is_hidden = params[0];
        row.is_pinned = 0;
        row.is_featured = 0;
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('UPDATE discussion_posts SET is_deleted')) {
        records.find((item) => item.id === params[1]).is_deleted = 1;
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('UPDATE community_notifications')) return [{ affectedRows: 1 }];
      if (sql.includes('AS newest_change'))
        return [
          [
            {
              post_count: filtered(sql, params).length,
              newest_change: 1,
            },
          ],
        ];
      if (sql.includes('FROM discussion_posts p')) {
        let selected = filtered(sql, params);
        if (/ORDER BY p.id DESC/.test(sql)) selected = selected.sort((a, b) => b.id - a.id);
        const limit = sql.match(/LIMIT (\d+)/);
        return [limit ? selected.slice(0, Number(limit[1])) : selected];
      }
      if (sql.includes('FROM discussion_comments c')) {
        return [
          visibility.canReadPost(
            records.find((row) => row.id === params[0]),
            viewer,
          )
            ? [{ id: 30, post_id: params[0], user_id: 8, content_markdown: 'Reply' }]
            : [],
        ];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const context = {
    app,
    pool: connection,
    ...visibility,
    ensureDiscussionTables: async () => {},
    ensureNotificationTables: async () => {},
    getOptionalAuthUser: async () => viewer,
    requireAuth: async (_request, response) => {
      if (!viewer) response.status(401).json({ message: '请登录' });
      return viewer;
    },
    requireAdmin: async (_request, response) => {
      if (!viewer?.is_admin) {
        response.status(403).json({ message: '无权访问' });
        return null;
      }
      return viewer;
    },
    getDiscussionPostByPublicId: async (id) =>
      records.find((row) => row.pid === id || String(row.id) === String(id)),
    getDiscussionBoardBySlug: async (slug) => (slug === 'signals' ? { id: 1 } : null),
    normalizeLimit: (value, fallback, max) => Math.min(max, Number(value) || fallback),
    getDiscussionPreview: () => null,
    config: { publicWebUrl: 'http://127.0.0.1' },
    canModerateBoard: async (user) => Boolean(user.is_admin),
    requireDiscussionBoardModerator: async (user, _board, response) => {
      if (!user.is_admin) response.status(403).json({ message: '无权访问' });
      return Boolean(user.is_admin);
    },
    withDatabaseTransaction: async (callback) => callback(connection),
    DISCUSSION_REACTION_TYPES: new Set(['smile', 'light', 'fireworks']),
    console: { error() {} },
  };
  const serializerStart = source.indexOf('function toDiscussionPostSummary(');
  const serializerEnd = source.indexOf('async function getDiscussionCommentById(', serializerStart);
  vm.runInNewContext(source.slice(serializerStart, serializerEnd), context);
  const routeStart = source.indexOf("app.get('/api/discussion/posts',");
  const routeEnd = source.indexOf("app.post('/api/auth/registration-challenge',", routeStart);
  vm.runInNewContext(source.slice(routeStart, routeEnd), context);
  return {
    queries,
    records,
    connection,
    race(callback) {
      onLock = callback;
    },
    async request(method, route, { user = null, id = 'PUBLIC1', query = {}, body = {} } = {}) {
      viewer = user;
      const response = {
        statusCode: 200,
        headers: {},
        payload: null,
        status(code) {
          this.statusCode = code;
          return this;
        },
        set(name, value) {
          this.headers[name] = value;
          return this;
        },
        json(payload) {
          this.payload = payload;
          return this;
        },
      };
      await routes.get(`${method} /api${route}`)({ query, body, params: { id } }, response);
      return response;
    },
  };
}

for (const user of [null, author, peer, admin]) {
  test(`public feed omits hidden and deleted posts for ${user?.username || 'guest'}`, async () => {
    const h = harness([post(1), post(2, { is_hidden: 1 }), post(3, { is_deleted: 1 })]);
    const response = await h.request('get', '/discussion/posts', { user });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(
      Array.from(response.payload.posts, (item) => item.pid),
      ['PUBLIC1'],
    );
    assert.equal(response.headers['Cache-Control'], 'private, no-store');
    for (const { sql } of h.queries) {
      assert.match(sql, /p\.is_deleted = 0 AND p\.is_hidden = 0/);
    }
  });
  for (const suffix of ['', '/comments']) {
    test(`hidden ${suffix || 'detail'} only readable by author, viewer=${user?.username || 'guest'}`, async () => {
      const h = harness([post(1, { is_hidden: 1 })]);
      const response = await h.request('get', `/discussion/posts/:id${suffix}`, { user });
      assert.equal(response.statusCode, user === author ? 200 : 404);
      if (user !== author)
        assert.equal(JSON.stringify(response.payload).includes('Private'), false);
    });
    test(`deleted ${suffix || 'detail'} is unavailable including administrator`, async () => {
      const h = harness([post(1, { is_deleted: 1 })]);
      assert.equal(
        (await h.request('get', `/discussion/posts/:id${suffix}`, { user })).statusCode,
        404,
      );
    });
  }
}

test('my posts requires authentication and includes only the viewer, even for administrators', async () => {
  const h = harness([
    post(1),
    post(2, { is_hidden: 1 }),
    post(3, { is_deleted: 1 }),
    post(4, { user_id: 9, is_hidden: 1 }),
  ]);
  assert.equal(
    (await h.request('get', '/discussion/posts', { query: { scope: 'mine' } })).statusCode,
    401,
  );
  for (const [user, ids] of [
    [author, ['PUBLIC2', 'PUBLIC1']],
    [admin, ['PUBLIC4']],
  ]) {
    const response = await h.request('get', '/discussion/posts', {
      user,
      query: { scope: 'mine', board: 'signals', userId: 7 },
    });
    assert.deepEqual(
      Array.from(response.payload.posts, (item) => item.pid),
      ids,
    );
    assert.ok(response.payload.posts.every((item) => item.canHide));
    assert.match(h.queries.at(-1).sql, /p\.is_deleted = 0 AND p\.user_id = \?/);
  }
});

test('hashes cannot be shared between my/public feeds or different authenticated users', async () => {
  const h = harness([post(1)]);
  const hashes = [];
  for (const user of [author, peer, admin]) {
    for (const scope of ['public', 'mine']) {
      const response = await h.request('get', '/discussion/posts', { user, query: { scope } });
      hashes.push(response.payload.hash);
    }
  }
  assert.equal(new Set(hashes).size, 6);
});

test('my posts uses a stable cursor so older hidden/public posts remain reachable', async () => {
  const h = harness(Array.from({ length: 55 }, (_, i) => post(i + 1, { is_hidden: i % 2 })));
  const first = await h.request('get', '/discussion/posts', {
    user: author,
    query: { scope: 'mine', limit: 50 },
  });
  assert.equal(first.payload.posts.length, 50);
  assert.equal(first.payload.nextCursor, '6');
  const second = await h.request('get', '/discussion/posts', {
    user: author,
    query: { scope: 'mine', cursor: first.payload.nextCursor, limit: 50 },
  });
  assert.equal(second.payload.posts.length, 5);
  assert.equal(second.payload.nextCursor, null);
  const ids = [...first.payload.posts, ...second.payload.posts].map((item) => item.pid);
  assert.equal(new Set(ids).size, 55);
  assert.equal(
    (
      await h.request('get', '/discussion/posts', {
        user: author,
        query: { scope: 'mine', cursor: '1 OR 1=1' },
      })
    ).statusCode,
    400,
  );
});

for (const user of [peer, admin, null]) {
  test(`non-owner cannot hide or publish posts: ${user?.username || 'guest'}`, async () => {
    for (const isHidden of [0, 1]) {
      const h = harness([post(1, { is_hidden: isHidden })]);
      const result = await h.request('patch', '/discussion/posts/:id/visibility', {
        user,
        body: { hidden: !isHidden },
      });
      assert.equal(result.statusCode, user ? 404 : 401);
      assert.equal(h.records[0].is_hidden, isHidden);
      assert.equal(
        h.queries.some(({ sql }) => sql.startsWith('UPDATE')),
        false,
      );
    }
  });
}

test('owner can hide and restore; hiding clears promotion and notification snapshots', async () => {
  const h = harness([post(1, { is_pinned: 1, is_featured: 1 })]);
  for (const hidden of [true, false]) {
    const result = await h.request('patch', '/discussion/posts/:id/visibility', {
      user: author,
      body: { hidden },
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.isHidden, hidden);
    assert.equal(h.records[0].is_hidden, Number(hidden));
    assert.equal(h.records[0].is_pinned, 0);
    assert.equal(h.records[0].is_featured, 0);
  }
  const redactions = h.queries.filter(({ sql }) =>
    sql.startsWith('UPDATE community_notifications'),
  );
  assert.equal(redactions.length, 1);
  assert.deepEqual(redactions[0].params, ['PUBLIC1', '1']);
});

for (const hidden of [undefined, null, 1, 'false', {}, []]) {
  test(`visibility rejects non-boolean ${JSON.stringify(hidden)}`, async () => {
    const h = harness();
    const result = await h.request('patch', '/discussion/posts/:id/visibility', {
      user: author,
      body: { hidden },
    });
    assert.equal(result.statusCode, 400);
    assert.equal(h.records[0].is_hidden, 0);
  });
}

test('deleted posts cannot be republished', async () => {
  const h = harness([post(1, { is_deleted: 1, is_hidden: 1 })]);
  assert.equal(
    (
      await h.request('patch', '/discussion/posts/:id/visibility', {
        user: author,
        body: { hidden: false },
      })
    ).statusCode,
    404,
  );
});

for (const action of ['like', 'comments']) {
  test(`${action} cannot race a hide/delete operation, checked under the post lock`, async () => {
    for (const field of ['is_hidden', 'is_deleted']) {
      const h = harness();
      h.race(() => {
        h.records[0][field] = 1;
      });
      const result = await h.request('post', `/discussion/posts/:id/${action}`, {
        user: peer,
        body: { contentMarkdown: 'Reply', reactionType: 'smile' },
      });
      assert.equal(result.statusCode, 404);
      assert.equal(
        h.queries.some(({ sql }) => sql.startsWith('INSERT')),
        false,
      );
    }
  });
}

test('normal deletion redacts notifications and removes access; author can delete own hidden post', async () => {
  const h = harness([post(1, { is_hidden: 1 })]);
  const result = await h.request('delete', '/discussion/posts/:id', { user: author });
  assert.equal(result.statusCode, 200);
  assert.equal(h.records[0].is_deleted, 1);
  assert.ok(h.queries.some(({ sql }) => sql.startsWith('UPDATE community_notifications')));
});

test('public counts and asynchronous Max reply use public-only visibility', () => {
  assert.match(source, /p\.board_id = b\.id AND p\.is_deleted = 0 AND p\.is_hidden = 0/);
  assert.match(source, /author_student_id = \? AND is_deleted = 0 AND is_hidden = 0/);
  const max = source.slice(
    source.indexOf('async function createMaxDiscussionReply('),
    source.indexOf('function toAiDialogSummary('),
  );
  assert.match(max, /WHERE p\.id = \? AND p\.is_deleted = 0 AND p\.is_hidden = 0/);
  assert.match(max, /await lockPublicPost\(connection, postId\)/);
  assert.ok(max.indexOf('await lockPublicPost(') < max.indexOf('INSERT INTO discussion_comments'));
});
