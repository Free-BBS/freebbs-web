const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const { anonymousAuthor, visibleComments } = require('./discussion-interactions');

const source = fs.readFileSync(require.resolve('./server'), 'utf8');
const serializer = source.slice(
  source.indexOf('function toDiscussionPostSummary'),
  source.indexOf('async function getDiscussionCommentById'),
);
const context = vm.createContext({
  anonymousAuthor,
  config: { publicWebUrl: '' },
  getDiscussionPreview: (body) => ({ body }),
});
vm.runInContext(serializer, context);
const plain = (value) => JSON.parse(JSON.stringify(value));

test('public anonymous summaries and details strip all identity fields while preserving admin permissions', () => {
  const row = {
    id: 2,
    pid: 'p_example',
    title: '标题',
    content_markdown: '正文',
    is_anonymous: 1,
    user_id: 123,
    uid: 'u_private',
    username: 'private_username',
    full_name: 'private_name',
    avatar_path: '/private-avatar',
    author_student_id: 'private_student',
    can_delete: 1,
  };
  for (const render of [context.toDiscussionPostSummary, context.toDiscussionPostDetail]) {
    const post = plain(render(row));
    assert.equal(post.isAnonymous, true);
    assert.equal(post.canDelete, true);
    assert.deepEqual(post.author, anonymousAuthor());
    assert.doesNotMatch(JSON.stringify(post), /private|123/);
  }
  assert.equal(context.toDiscussionPostDetail({ ...row, is_anonymous: 0 }).author.uid, 'u_private');
});
test('deleted posts require the server reveal flag for original content and retain the deletion marker', () => {
  const row = { id: 1, title: '原始标题', content_markdown: '原始正文', is_deleted: 1 };
  assert.equal(context.toDiscussionPostDetail(row).contentMarkdown, '这篇帖子已被删除。');
  const revealed = context.toDiscussionPostDetail({ ...row, reveal_deleted: true });
  assert.equal(revealed.isDeleted, true);
  assert.equal(revealed.title, '原始标题');
  assert.equal(revealed.contentMarkdown, '原始正文');
  assert.equal(revealed.canDelete, false);
});
test('deleted comments redact content and identity and only retain ancestors of live replies', () => {
  const hidden = context.toDiscussionComment({
    id: 1,
    is_deleted: 1,
    content_markdown: 'secret',
    user_id: 10,
    username: 'secret',
    uid: 'u_secret',
    avatar_path: 'secret',
    like_count: 8,
    liked_by_me: 1,
    can_delete: 1,
  });
  assert.equal(hidden.contentMarkdown, '该评论已删除');
  assert.equal(hidden.author.id, null);
  assert.equal(hidden.likeCount, 0);
  assert.equal(hidden.canDelete, false);
  assert.doesNotMatch(JSON.stringify(hidden), /secret/);
  const comments = [
    { id: 1, isDeleted: true },
    { id: 2, parentCommentId: 1, isDeleted: true },
    { id: 3, parentCommentId: 2, isDeleted: false },
    { id: 4, isDeleted: true },
  ];
  const before = structuredClone(comments);
  assert.deepEqual(
    visibleComments(comments).map((c) => c.id),
    [1, 2, 3],
  );
  assert.deepEqual(visibleComments(comments.map((c) => ({ ...c, isDeleted: true }))), []);
  assert.deepEqual(comments, before);
});

function interactionHarness({ hidden = 0, deleted = 0, user = { id: 8 }, raceHide = false } = {}) {
  const { registerDiscussionInteractions } = require('./discussion-interactions');
  const routes = new Map();
  const queries = [];
  const ledger = [];
  let notified = false;
  const post = {
    id: 1,
    pid: 'PUBLIC1',
    user_id: 7,
    board_id: 1,
    is_hidden: hidden,
    is_deleted: deleted,
  };
  const database = {
    async execute(sql, params) {
      queries.push({ sql, params });
      assert.equal((sql.match(/\?/g) || []).length, params.length);
      if (sql.startsWith('SELECT post_id')) return [[{ post_id: 1 }]];
      if (sql.includes('FROM discussion_posts') && sql.includes('FOR UPDATE')) {
        if (raceHide) post.is_hidden = 1;
        assert.match(sql, /is_hidden/);
        return [[post]];
      }
      if (sql.startsWith('SELECT id, user_id'))
        return [[{ id: 30, user_id: 8, is_deleted: 0, content_markdown: 'private comment' }]];
      if (sql.startsWith('SELECT user_id')) return [[]];
      if (sql.startsWith('SELECT COUNT')) return [[{ total: 1 }]];
      if (sql.startsWith('SELECT amount')) return [[]];
      if (sql.startsWith('SELECT CAST(id AS CHAR) AS id FROM wallet_ledger'))
        return [ledger.length ? [{ id: ledger.at(-1).id }] : []];
      if (sql.startsWith('UPDATE users')) {
        ledger.push({ id: String(ledger.length + 1), user_id: params[1], source_key: null });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('UPDATE wallet_ledger')) {
        const [sourceKey, title, reason, userId, afterId] = params;
        const row = ledger.findLast(
          (entry) =>
            entry.user_id === userId &&
            BigInt(entry.id) > BigInt(afterId) &&
            entry.source_key === null,
        );
        if (row) Object.assign(row, { source_key: sourceKey, title, reason });
        return [{ affectedRows: row ? 1 : 0 }];
      }
      if (sql.includes('SUM(amount)')) return [[{ total: 0 }]];
      if (sql.includes('FROM users')) return [[{ id: 7, username: 'author' }]];
      return [{ affectedRows: 1 }];
    },
  };
  registerDiscussionInteractions(
    Object.fromEntries(
      ['get', 'post', 'delete', 'patch'].map((method) => [
        method,
        (url, fn) => routes.set(`${method} ${url}`, fn),
      ]),
    ),
    {
      pool: database,
      requireAuth: async () => user,
      requireAdmin: async () => user,
      ensureDiscussionTables: async () => {},
      withDatabaseTransaction: (fn) => fn(database),
      canModerateBoard: async () => Boolean(user.is_admin),
      getDiscussionPostByPublicId: async () => post,
      notifications: {
        notifyCommentReaction: async () => {
          notified = true;
        },
      },
    },
  );
  return {
    queries,
    ledger,
    get notified() {
      return notified;
    },
    async request(method, route, body = {}) {
      const response = {
        statusCode: 200,
        status(code) {
          this.statusCode = code;
          return this;
        },
        set() {
          return this;
        },
        json(data) {
          this.data = data;
          return this;
        },
      };
      await routes.get(`${method} /api${route}`)({ params: { id: '30' }, body }, response);
      return response;
    },
  };
}

for (const user of [{ id: 7 }, { id: 8 }, { id: 9, is_admin: true }]) {
  for (const [method, route] of [
    ['post', '/discussion/comments/:id/like'],
    ['delete', '/discussion/comments/:id'],
  ]) {
    test(`hidden comment ${method} denies user ${user.id} under the post lock`, async () => {
      for (const options of [{ hidden: 1 }, { raceHide: true }, { deleted: 1 }]) {
        const h = interactionHarness({ ...options, user });
        assert.equal((await h.request(method, route)).statusCode, 404);
        assert.equal(h.notified, false);
        assert.equal(
          h.queries.some((q) => /^(INSERT|UPDATE|DELETE)/.test(q.sql)),
          false,
        );
      }
    });
  }
}

test('public comment likes and author deletion still work', async () => {
  for (const [method, route] of [
    ['post', '/discussion/comments/:id/like'],
    ['delete', '/discussion/comments/:id'],
  ]) {
    const h = interactionHarness();
    assert.equal((await h.request(method, route)).statusCode, 200);
    assert.equal(h.notified, method === 'post');
    assert.ok(h.queries.some((q) => /^(INSERT|UPDATE)/.test(q.sql)));
  }
});

test('administrator author inspection cannot bypass hidden posts, including deleted ones', async () => {
  for (const deleted of [0, 1]) {
    const h = interactionHarness({ hidden: 1, deleted, user: { id: 9, is_admin: true } });
    assert.equal((await h.request('get', '/admin/discussion/posts/:id/author')).statusCode, 404);
    assert.equal(h.queries.length, 0);
  }
});
test('feature replies is administrator-only, requires a boolean and cannot feature hidden content', async () => {
  for (const user of [{ id: 8 }, { id: 8, role: 'student' }]) {
    const h = interactionHarness({ user });
    const response = await h.request('patch', '/discussion/comments/:id/feature', {
      featured: true,
    });
    assert.equal(response.statusCode, 403);
    assert.ok(!h.queries.some((q) => q.sql.startsWith('UPDATE discussion_comments')));
  }
  const admin = interactionHarness({ user: { id: 9, is_admin: true } });
  assert.equal(
    (await admin.request('patch', '/discussion/comments/:id/feature', { featured: 'false' }))
      .statusCode,
    400,
  );
  const response = await admin.request('patch', '/discussion/comments/:id/feature', {
    featured: true,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.data.isFeatured, true);
  assert.equal(response.data.reward, 5);
  assert.equal(admin.ledger.length, 1);
  assert.equal(admin.ledger[0].source_key, 'reward:featured-comment:30');
  assert.equal(admin.ledger[0].title, '精华评论奖励');
  assert.match(admin.ledger[0].reason, /评论（编号 30）.*5 磁元/);
  const hidden = interactionHarness({ user: { id: 9, is_admin: true }, raceHide: true });
  assert.equal(
    (await hidden.request('patch', '/discussion/comments/:id/feature', { featured: true }))
      .statusCode,
    404,
  );
});

test('liking another account comment records the actual recipient and a readable reward reason', async () => {
  const h = interactionHarness({ user: { id: 9 } });
  const response = await h.request('post', '/discussion/comments/:id/like');
  assert.equal(response.statusCode, 200);
  assert.equal(h.ledger.length, 1);
  assert.equal(h.ledger[0].user_id, 8);
  assert.equal(h.ledger[0].source_key, 'reward:comment-like:30:9');
  assert.equal(h.ledger[0].title, '评论获赞奖励');
  assert.match(h.ledger[0].reason, /评论（编号 30）.*点赞.*1 磁元/);
});
