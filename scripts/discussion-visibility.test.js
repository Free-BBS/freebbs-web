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
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
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
    comments: [],
    posts: [],
    postCache: new Map(),
    postsByBoard: new Map(),
    postsHashByBoard: {},
  };
  const requests = [];
  const rendered = [];
  const context = {
    discussionState: state,
    discussionDetail: { innerHTML: '', classList: { remove() {} }, scrollIntoView() {} },
    discussionPostList: { innerHTML: '', setAttribute() {} },
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
  };
  const snippets = [
    extract('function applyDiscussionPostsPayload(', 'function restoreDiscussionBoardPosts('),
    extract('async function loadDiscussionComments(', 'function pollDiscussionCommentsForMax('),
    extract('async function loadDiscussionDetail(', 'async function initializeDiscussionPage('),
    extract('function resetDiscussionData(', 'async function loadPublicProfile('),
  ].join('\n');
  vm.runInNewContext(snippets, context);
  return { state, context, requests, rendered };
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
