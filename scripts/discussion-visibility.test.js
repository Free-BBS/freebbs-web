const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../public/discussion.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../public/discussion.css'), 'utf8');

function extract(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from > 0 && to > from, start);
  return source.slice(from, to);
}
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function harness() {
  const state = {
    scope: 'public',
    sessionVersion: 0,
    sessionStale: false,
    postsRequestId: 0,
    postRequestId: 0,
    activeBoard: 'all',
    activePostId: 'P1',
    activePost: null,
    nextMyCursor: '',
    comments: [],
    posts: [],
    postCache: new Map(),
    postsByBoard: new Map(),
    postsHashByBoard: {},
  };
  const requests = [];
  const rendered = [];
  const listAttributes = {};
  const context = {
    discussionState: state,
    discussionDetail: { innerHTML: '', classList: { remove() {} }, scrollIntoView() {} },
    discussionPostList: {
      innerHTML: '',
      setAttribute(name, value) {
        listAttributes[name] = value;
      },
    },
    discussionFilterStatus: { textContent: '' },
    discussionCommentDrafts: new Map(),
    discussionOpenReplyByPost: new Map(),
    renderDiscussionDetail: (post) => {
      rendered.push(post);
      state.activePost = post;
    },
    renderDiscussionPosts() {},
    renderDiscussionComments() {
      rendered.push([...state.comments]);
    },
    setDiscussionDetailView() {},
    updateDiscussionQuery() {},
    renderDiscussionBoards() {},
    renderDiscussionComposeBoards() {},
    loadDiscussionStats() {},
    createDiscussionRequestSignal: () => undefined,
    callApi: (url) => {
      const wait = deferred();
      requests.push({ url, ...wait });
      return wait.promise;
    },
    URLSearchParams,
    userState: { uid: 'USER1', isLoggedIn: true },
    window: { confirm: () => true, alert() {} },
    openModal() {},
    showDiscussionLoginDialog() {},
  };
  const snippets = [
    extract('function applyDiscussionPostsPayload(', 'function restoreDiscussionBoardPosts('),
    extract('async function loadDiscussionComments(', 'function pollDiscussionCommentsForMax('),
    extract('async function loadDiscussionDetail(', 'async function initializeDiscussionPage('),
    extract('function resetDiscussionData(', 'async function loadPublicProfile('),
  ].join('\n');
  vm.runInNewContext(snippets, context);
  return { state, context, requests, rendered, listAttributes };
}

test('author metadata is centered and my posts is a keyboard-accessible scope control', () => {
  assert.match(css, /\.discussion-detail-meta\s*\{\s*align-items: center/);
  assert.match(html, /type="button"\s+data-discussion-scope="mine"/);
  assert.match(html, /aria-label="帖子范围"/);
  assert.match(source, /data-action="toggle-visibility"/);
  assert.match(source, /已隐藏 · 仅自己可见/);
});

test('reset invalidates requests and removes every private cache, reply and draft', () => {
  const h = harness();
  h.state.posts = [{ id: 'PRIVATE', isHidden: true }];
  h.state.postCache.set('PRIVATE', h.state.posts[0]);
  h.state.postsByBoard.set('all', h.state.posts);
  h.state.postsHashByBoard.all = 'OLD';
  h.context.discussionCommentDrafts.set('PRIVATE', 'secret draft');
  h.context.discussionOpenReplyByPost.set('PRIVATE', 'reply');
  h.context.resetDiscussionData();
  assert.equal(h.state.posts.length, 0);
  assert.equal(h.state.postCache.size, 0);
  assert.equal(h.state.postsByBoard.size, 0);
  assert.equal(Object.keys(h.state.postsHashByBoard).length, 0);
  assert.equal(h.context.discussionCommentDrafts.size, 0);
  assert.equal(h.context.discussionOpenReplyByPost.size, 0);
  assert.equal(h.state.sessionVersion, 1);
  assert.equal(h.state.postRequestId, 1);
  assert.equal(h.state.postsRequestId, 1);
});

test('detail is not rendered from cached content before visibility is revalidated', async () => {
  const h = harness();
  h.state.postCache.set('P1', { id: 'P1', title: 'old private title' });
  const pending = h.context.loadDiscussionDetail('P1');
  assert.equal(h.rendered.length, 0);
  assert.ok(!h.context.discussionDetail.innerHTML.includes('old private'));
  h.requests[0].resolve({ post: { id: 'P1', title: 'verified' } });
  await pending;
  assert.equal(h.rendered.at(-1).title, 'verified');
});

for (const change of ['account', 'post']) {
  test(`late detail/comment responses cannot overwrite after ${change} change`, async () => {
    const h = harness();
    const detail = h.context.loadDiscussionDetail('P1');
    const comments = h.context.loadDiscussionComments('P1');
    if (change === 'account') h.context.resetDiscussionData();
    else {
      h.state.postRequestId += 1;
      h.state.activePostId = 'P2';
    }
    const length = h.rendered.length;
    h.requests[0].resolve({ post: { id: 'P1', title: 'PRIVATE' } });
    h.requests[1].resolve({ comments: [{ contentMarkdown: 'PRIVATE REPLY' }] });
    await Promise.all([detail, comments]);
    assert.equal(h.rendered.length, length);
    assert.equal(h.state.comments.length, 0);
  });
}

test('scope change clears old board hashes and stale my-posts response is ignored', async () => {
  const h = harness();
  h.state.scope = 'mine';
  h.state.postsByBoard.set('all', [{ id: 'PRIVATE' }]);
  h.state.postsHashByBoard.all = 'mine-hash';
  const old = h.context.loadDiscussionPosts();
  assert.ok(h.requests[0].url.includes('scope=mine'));
  const current = h.context.changeDiscussionScope('public');
  assert.ok(h.requests[1].url.includes('scope=public'));
  assert.ok(!h.requests[1].url.includes('hash='));
  h.requests[1].resolve({ posts: [{ id: 'PUBLIC' }], hash: 'public-hash' });
  await current;
  h.requests[0].resolve({ posts: [{ id: 'PRIVATE', isHidden: true }], hash: 'private-hash' });
  await old;
  assert.deepEqual(
    Array.from(h.state.posts, (post) => post.id),
    ['PUBLIC'],
  );
});

test('deleted records never enter cache even from an old backend payload', () => {
  const h = harness();
  h.context.applyDiscussionPostsPayload('all', {
    posts: [{ id: '1' }, { id: '2', isDeleted: true }],
  });
  assert.deepEqual(
    Array.from(h.state.posts, (post) => post.id),
    ['1'],
  );
  assert.equal(h.state.postCache.has('2'), false);
});

test('my-posts pagination appends without duplicates and retains server cursor', async () => {
  const h = harness();
  h.state.scope = 'mine';
  h.state.nextMyCursor = '5';
  h.state.posts = [{ id: 'FIRST' }];
  const pending = h.context.loadDiscussionPosts({ more: true });
  assert.ok(h.requests[0].url.includes('cursor=5'));
  h.requests[0].resolve({ posts: [{ id: 'OLDER', isHidden: true }], nextCursor: '3' });
  await pending;
  assert.deepEqual(
    Array.from(h.state.posts, (post) => post.id),
    ['FIRST', 'OLDER'],
  );
  assert.equal(h.state.nextMyCursor, '3');
  h.context.resetDiscussionData();
  assert.equal(h.state.nextMyCursor, '');
});

test('stale session after another tab changes login cannot fetch private content again', async () => {
  const h = harness();
  h.state.sessionStale = true;
  await h.context.loadDiscussionPosts();
  await h.context.loadDiscussionDetail('P1');
  await h.context.loadDiscussionComments('P1');
  await h.context.changeDiscussionScope('mine');
  assert.equal(h.requests.length, 0);
  assert.match(source, /event\.persisted && isDiscussionPage\(\)/);
});

async function loadFirstMyPage(h) {
  const { state } = h;
  state.scope = 'mine';
  const posts = Array.from({ length: 50 }, (_, index) => ({
    id: String(55 - index),
    isHidden: index === 0,
  }));
  const pending = h.context.loadDiscussionPosts();
  h.requests.at(-1).resolve({ posts, nextCursor: '6', hash: '' });
  await pending;
  return posts;
}

for (const failure of ['network', 'server']) {
  test(`second my-posts page ${failure} failure preserves 50 posts and retry yields all 55`, async () => {
    const h = harness();
    const firstPage = await loadFirstMyPage(h);
    const cached = h.state.postsByBoard.get('all');
    const hashes = { ...h.state.postsHashByBoard };
    const [firstPost] = firstPage;
    h.state.activePost = firstPost;
    h.state.activePostId = firstPost.id;
    h.state.comments = [{ contentMarkdown: 'keep the open detail' }];
    const renderedBefore = h.rendered.length;
    // Two consecutive failures must not consume the cursor or remove existing content.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const pending = h.context.loadDiscussionPosts({ more: true });
      assert.equal(new URL(h.requests.at(-1).url, 'http://local').searchParams.get('cursor'), '6');
      assert.equal(h.listAttributes['aria-busy'], 'true');
      h.requests
        .at(-1)
        .reject(
          failure === 'network'
            ? new TypeError('Failed to fetch')
            : Object.assign(new Error('Unavailable'), { status: 503 }),
        );
      await pending;
      assert.deepEqual(
        Array.from(h.state.posts, (post) => post.id),
        firstPage.map((post) => post.id),
      );
      assert.equal(h.state.postsByBoard.get('all'), cached);
      assert.deepEqual({ ...h.state.postsHashByBoard }, hashes);
      assert.equal(h.state.postCache.size, 50);
      assert.equal(h.state.nextMyCursor, '6');
      assert.equal(h.state.activePost, firstPage[0]);
      assert.equal(h.state.comments.length, 1);
      assert.equal(h.rendered.length, renderedBefore);
      assert.equal(h.listAttributes['aria-busy'], 'false');
      assert.match(h.context.discussionFilterStatus.textContent, /加载更多.*重试/);
    }
    const retry = h.context.loadDiscussionPosts({ more: true });
    assert.equal(new URL(h.requests.at(-1).url, 'http://local').searchParams.get('cursor'), '6');
    h.requests.at(-1).resolve({
      posts: Array.from({ length: 5 }, (_, index) => ({ id: String(5 - index) })),
      nextCursor: '',
    });
    await retry;
    const ids = Array.from(h.state.posts, (post) => post.id);
    assert.deepEqual(
      ids,
      Array.from({ length: 55 }, (_, index) => String(55 - index)),
    );
    assert.equal(h.state.postCache.size, 55);
    assert.equal(h.state.postsByBoard.get('all').length, 55);
    assert.equal(h.state.nextMyCursor, '');
    assert.equal(h.listAttributes['aria-busy'], 'false');
  });
}

test('a failed first-page refresh clears its old cursor and the next request starts at page one', async () => {
  const h = harness();
  await loadFirstMyPage(h);
  const pending = h.context.loadDiscussionPosts();
  assert.equal(new URL(h.requests.at(-1).url, 'http://local').searchParams.has('cursor'), false);
  h.requests.at(-1).reject(new Error('Failed to fetch'));
  await pending;
  assert.equal(h.state.posts.length, 0);
  assert.equal(h.state.postsByBoard.size, 0);
  assert.equal(h.state.postCache.size, 0);
  assert.equal(h.state.nextMyCursor, '');
  assert.equal(h.listAttributes['aria-busy'], 'false');
  const retry = h.context.loadDiscussionPosts({ more: true });
  assert.equal(new URL(h.requests.at(-1).url, 'http://local').searchParams.has('cursor'), false);
  h.requests.at(-1).resolve({ posts: [{ id: '55' }], nextCursor: '55' });
  await retry;
  assert.deepEqual(
    Array.from(h.state.posts, (post) => post.id),
    ['55'],
  );
});

for (const status of [401, 403]) {
  test(`my-posts pagination ${status} does not retain private posts or an old cursor`, async () => {
    const h = harness();
    await loadFirstMyPage(h);
    const pending = h.context.loadDiscussionPosts({ more: true });
    h.requests.at(-1).reject(Object.assign(new Error('Access denied'), { status }));
    await pending;
    assert.equal(h.state.posts.length, 0);
    assert.equal(h.state.postCache.size, 0);
    assert.equal(h.state.postsByBoard.size, 0);
    assert.equal(h.state.nextMyCursor, '');
    assert.match(h.context.discussionPostList.innerHTML, /加载失败/);
  });
}

for (const change of ['account', 'scope']) {
  test(`late pagination failure cannot restore private posts after ${change} change`, async () => {
    const h = harness();
    await loadFirstMyPage(h);
    const pending = h.context.loadDiscussionPosts({ more: true });
    const oldRequest = h.requests.at(-1);
    if (change === 'account') h.context.resetDiscussionData();
    else {
      const current = h.context.changeDiscussionScope('public');
      h.requests.at(-1).resolve({ posts: [{ id: 'PUBLIC' }], hash: 'public' });
      await current;
    }
    const before = Array.from(h.state.posts, (post) => post.id);
    h.context.discussionFilterStatus.textContent = 'current view';
    oldRequest.reject(new Error('Late network error'));
    await pending;
    assert.deepEqual(
      Array.from(h.state.posts, (post) => post.id),
      before,
    );
    assert.equal(h.state.postCache.has('55'), false);
    assert.equal(h.state.nextMyCursor, '');
    assert.equal(h.context.discussionFilterStatus.textContent, 'current view');
  });
}

test('administrator deleted-post inspection survives list caching and detail revalidation', async () => {
  const h = harness();
  h.context.userState.isAdmin = true;
  h.state.showDeleted = true;
  const pending = h.context.loadDiscussionPosts();
  assert.equal(
    new URL(h.requests.at(-1).url, 'http://local').searchParams.get('includeDeleted'),
    '1',
  );
  h.requests.at(-1).resolve({ posts: [{ id: 'DELETED', isDeleted: true }], hash: 'admin' });
  await pending;
  assert.equal(h.state.postCache.has('DELETED'), true);
  const detail = h.context.loadDiscussionDetail('DELETED');
  assert.equal(
    new URL(h.requests.at(-1).url, 'http://local').searchParams.get('includeDeleted'),
    '1',
  );
  h.requests
    .at(-1)
    .resolve({ post: { id: 'DELETED', isDeleted: true, contentMarkdown: 'original' } });
  await detail;
  assert.equal(h.state.activePost.contentMarkdown, 'original');
  h.state.scope = 'mine';
  const mine = h.context.loadDiscussionPosts();
  assert.equal(
    new URL(h.requests.at(-1).url, 'http://local').searchParams.has('includeDeleted'),
    false,
  );
  h.requests.at(-1).resolve({ posts: [{ id: 'DELETED', isDeleted: true }] });
  await mine;
  assert.equal(h.state.posts.length, 0);
});

test('login-only link clears detail and opens login without exposing cached content', async () => {
  const h = harness();
  let opened = '';
  h.context.showDiscussionLoginDialog = (name) => {
    opened = name;
  };
  h.state.postCache.set('PRIVATE', { contentMarkdown: 'stale secret' });
  const pending = h.context.loadDiscussionDetail('PRIVATE');
  h.requests[0].reject(
    Object.assign(new Error('login'), { status: 401, code: 'post_login_required' }),
  );
  await pending;
  assert.equal(opened, 'PRIVATE');
  assert.equal(h.state.postCache.has('PRIVATE'), false);
  assert.equal(h.state.activePostId, 'PRIVATE');
  assert.match(h.context.discussionDetail.innerHTML, /登录后可见/);
  assert.doesNotMatch(h.context.discussionDetail.innerHTML, /stale secret/);
});

test('login return path accepts a post link but rejects external or arbitrary destinations', () => {
  const auth = fs.readFileSync(path.join(__dirname, '../public/auth.js'), 'utf8');
  const fn = auth.slice(
    auth.indexOf('function activityReturnPath()'),
    auth.indexOf('function initializeAuthReturnLinks()'),
  );
  for (const [next, expected] of [
    ['/discussion?post=PRIVATE#comment-1', '/discussion?post=PRIVATE#comment-1'],
    ['/surveys?survey=abc', '/surveys?survey=abc'],
    ['https://evil.test/discussion?post=PRIVATE', ''],
    ['//evil.test/discussion?post=PRIVATE', ''],
    ['/settings', ''],
    ['/discussion', ''],
  ]) {
    const context = {
      URL,
      URLSearchParams,
      window: {
        location: {
          origin: 'https://www.free-bbs.cn',
          search: `?${new URLSearchParams({ next })}`,
        },
      },
    };
    vm.runInNewContext(fn, context);
    assert.equal(context.activityReturnPath(), expected);
  }
});
