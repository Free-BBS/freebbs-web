const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const cheerio = require('cheerio');
const uiState = require('../public/ui-state');

const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

function extract(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Actual function is present: ${start}`);
  return source.slice(from, to);
}

// A small DOM adapter over the existing HTML parser, not another UI implementation.
// It lets the actual page renderers and shared module keep their real selectors/markup.
function documentFixture(html) {
  const $ = cheerio.load(html);
  const wrappers = new WeakMap();
  const dataAttribute = (key) =>
    `data-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
  let doc;
  function wrap(selection) {
    const node = selection[0];
    if (!node) return null;
    if (wrappers.has(node)) return wrappers.get(node);
    const element = {
      selection,
      ownerDocument: doc,
      tagName: String(node.name || '').toUpperCase(),
      dataset: new Proxy(
        {},
        {
          get: (_, key) => selection.attr(dataAttribute(key)),
          set: (_, key, value) => {
            selection.attr(dataAttribute(key), String(value));
            return true;
          },
        },
      ),
      setAttribute: (key, value) => selection.attr(key, String(value)),
      getAttribute: (key) => selection.attr(key),
      removeAttribute: (key) => selection.removeAttr(key),
      append: (...children) => children.forEach((child) => selection.append(child.selection)),
      replaceChildren: (...children) => {
        selection.empty();
        element.append(...children);
      },
      querySelector: (selector) => wrap(selection.find(selector).first()),
      querySelectorAll: (selector) =>
        selection
          .find(selector)
          .toArray()
          .map((child) => wrap($(child))),
      closest: (selector) => wrap(selection.closest(selector).first()),
      remove: () => selection.remove(),
      addEventListener() {},
      focus() {},
      scrollIntoView() {},
      classList: {
        contains: (name) => selection.hasClass(name),
        add: (name) => selection.addClass(name),
        remove: (name) => selection.removeClass(name),
        toggle(name, force) {
          selection.toggleClass(name, force === undefined ? !selection.hasClass(name) : force);
        },
      },
    };
    for (const [key, get, set] of [
      ['innerHTML', () => selection.html(), (value) => selection.html(value)],
      ['textContent', () => selection.text(), (value) => selection.text(value)],
      ['className', () => selection.attr('class') || '', (value) => selection.attr('class', value)],
      ['value', () => selection.val(), (value) => selection.val(value)],
      [
        'hidden',
        () => selection.attr('hidden') !== undefined,
        (value) => (value ? selection.attr('hidden', '') : selection.removeAttr('hidden')),
      ],
    ])
      Object.defineProperty(element, key, { get, set });
    Object.defineProperty(element, 'firstElementChild', {
      get: () => wrap(selection.children().first()),
    });
    wrappers.set(node, element);
    return element;
  }
  doc = {
    createElement: (tag) => wrap($(`<${tag}></${tag}>`)),
    getElementById: (id) => wrap($(`#${id}`).first()),
    querySelectorAll: (selector) =>
      $(selector)
        .toArray()
        .map((node) => wrap($(node))),
  };
  return doc;
}

function requestQueue() {
  const requests = [];
  return {
    requests,
    callApi: (url, options) =>
      new Promise((resolve, reject) => {
        requests.push({ url, options, resolve, reject });
      }),
  };
}

const post = (id, extra = {}) => ({ id, title: `帖子 ${id}`, board: { name: '日常' }, ...extra });

function discussionFixture() {
  const document = documentFixture(
    '<div id="posts" role="list"></div><div id="boards"></div><p id="filter"></p><button id="discussion-my-more" hidden>加载更多</button>',
  );
  const state = {
    scope: 'public',
    sessionVersion: 0,
    sessionStale: false,
    activeBoard: 'all',
    activePostId: '',
    activePost: null,
    posts: [],
    postsStatus: 'idle',
    postsErrorMessage: '',
    postsRequestId: 0,
    postsByBoard: new Map(),
    postsHashByBoard: {},
    postCache: new Map(),
    postRequestId: 0,
    comments: [],
    nextMyCursor: '',
    viewMode: 'latest',
    boards: [],
    boardsRequestId: 0,
    isFallback: false,
  };
  const queue = requestQueue();
  const alerts = [];
  const context = {
    ...queue,
    document,
    discussionState: state,
    discussionPostList: document.getElementById('posts'),
    discussionBoardList: document.getElementById('boards'),
    discussionFilterStatus: document.getElementById('filter'),
    discussionFilterControls: [],
    discussionCommentDrafts: new Map(),
    discussionOpenReplyByPost: new Map(),
    userState: { uid: 'U1', token: 'T1', isLoggedIn: true, isAdmin: false },
    window: {
      document,
      freeBbsUiState: uiState,
      confirm: () => true,
      alert: (value) => alerts.push(value),
    },
    URLSearchParams,
    API_BASE_URL: '/api',
    FALLBACK_DISCUSSION_BOARDS: [{ slug: 'daily', name: '日常', canPublish: false }],
    createDiscussionRequestSignal: () => undefined,
    renderDiscussionDetail: (value) => {
      state.activePost = value;
    },
    renderDiscussionBoards() {},
    renderDiscussionBoardAbout() {},
    renderDiscussionComposeBoards() {},
    renderDiscussionComposerState() {},
    updateDiscussionQuery() {},
    renderAuthorProfileLink: () => '',
    renderDiscussionReactionButton: () => '',
    createDiscussionPostExcerpt: () => '',
    formatDateOnly: () => '',
    escapeHtml: (value) => String(value || '').replace(/[&<>"']/g, '_'),
  };
  vm.runInNewContext(
    [
      extract('function renderDiscussionBoards()', 'function getActiveDiscussionBoard('),
      extract('function getDiscussionPostEngagement(', 'function restoreDiscussionBoardPosts('),
      extract('function restoreDiscussionBoardPosts(', 'function updateCachedDiscussionPost('),
      extract('function getDiscussionVisiblePosts(', 'function createDiscussionPostExcerpt('),
      extract('function renderDiscussionPosts()', 'function handleDiscussionFilterClick('),
      extract('async function loadDiscussionBoards()', 'async function loadDiscussionComments('),
      extract('function renderDiscussionPostsState(', 'async function initializeDiscussionPage('),
      extract('function resetDiscussionData()', 'async function changeDiscussionScope('),
      extract('async function handleDiscussionBoardClick(', 'async function deleteDiscussionPost('),
      extract('async function deleteDiscussionPost(', 'async function toggleDiscussionPin('),
    ].join('\n'),
    context,
  );
  return { state, context, alerts, ...queue, list: context.discussionPostList };
}

async function loadPosts(f, posts = [post('P1')]) {
  const pending = f.context.loadDiscussionPosts();
  f.requests.at(-1).resolve({ posts, nextCursor: 'OLDER', hash: 'HASH' });
  await pending;
}

test('discussion loading, successful empty and initial failure retain legacy cards but have distinct semantics', async () => {
  const f = discussionFixture();
  const pending = f.context.loadDiscussionPosts();
  assert.equal(f.list.dataset.uiState, 'loading');
  assert.equal(f.list.getAttribute('aria-busy'), 'true');
  assert.equal(f.list.firstElementChild.className, 'discussion-empty');
  assert.doesNotMatch(f.list.textContent, /还没有/);
  f.context.renderDiscussionPosts();
  assert.equal(f.list.dataset.uiState, 'loading');
  f.requests[0].resolve({ posts: [] });
  await pending;
  assert.equal(f.list.dataset.uiState, 'empty');
  assert.equal(f.list.firstElementChild.getAttribute('role'), 'status');
  assert.match(f.list.textContent, /还没有帖子/);
  const failed = f.context.loadDiscussionPosts();
  f.requests[1].reject(new Error('network'));
  await failed;
  assert.equal(f.list.dataset.uiState, 'error');
  assert.equal(f.list.firstElementChild.getAttribute('role'), 'alert');
  assert.ok(f.list.querySelector('.bbs-action[data-action="retry-discussion-posts"]'));
  f.context.renderDiscussionPosts();
  assert.match(f.list.textContent, /加载失败/);
  assert.doesNotMatch(f.list.textContent, /还没有/);
});

test('discussion retry is a single explicit GET and restores real cards', async () => {
  const f = discussionFixture();
  const first = f.context.loadDiscussionPosts();
  f.requests[0].reject(new Error('network'));
  await first;
  assert.equal(f.requests.length, 1);
  const retry = f.list.querySelector('[data-action="retry-discussion-posts"]');
  const pending = f.context.handleDiscussionPostClick({ target: retry });
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].options.method, 'GET');
  f.requests[1].resolve({ posts: [post('P2')] });
  await pending;
  assert.equal(f.list.dataset.uiState, 'ready');
  assert.ok(f.list.querySelector('.discussion-post-card[data-post-id="P2"]'));
  assert.equal(f.list.getAttribute('aria-busy'), 'false');
});

for (const status of [undefined, 503]) {
  test(`discussion first-page ${status || 'network'} refresh keeps data and clears pagination cursor`, async () => {
    const f = discussionFixture();
    f.state.scope = 'mine';
    await loadPosts(f, [post('PRIVATE', { isHidden: true })]);
    const card = f.list.firstElementChild;
    const pending = f.context.loadDiscussionPosts();
    assert.equal(f.list.firstElementChild, card);
    assert.equal(f.list.getAttribute('aria-busy'), 'true');
    f.requests.at(-1).reject(Object.assign(new Error('refresh failed'), { status }));
    await pending;
    assert.equal(f.list.firstElementChild, card);
    assert.equal(f.state.posts[0].id, 'PRIVATE');
    assert.equal(f.state.nextMyCursor, '');
    assert.equal(f.context.document.getElementById('discussion-my-more').hidden, true);
    assert.equal(f.list.dataset.uiState, 'error');
    assert.match(f.context.discussionFilterStatus.textContent, /已保留/);
    f.context.renderDiscussionPosts();
    assert.match(f.list.textContent, /帖子 PRIVATE/);
    assert.doesNotMatch(f.list.textContent, /还没有/);
  });
}

for (const status of [401, 403, 404]) {
  test(`discussion ${status} clears private list, cached posts and open detail`, async () => {
    const f = discussionFixture();
    f.state.scope = 'mine';
    await loadPosts(f, [post('PRIVATE', { isHidden: true })]);
    f.state.activePost = f.state.posts[0];
    f.state.activePostId = 'PRIVATE';
    f.state.comments = [{ contentMarkdown: 'private reply' }];
    const pending = f.context.loadDiscussionPosts();
    f.requests.at(-1).reject(Object.assign(new Error('not permitted'), { status }));
    await pending;
    assert.equal(f.state.posts.length, 0);
    assert.equal(f.state.postsByBoard.size, 0);
    assert.equal(f.state.postCache.size, 0);
    assert.equal(f.state.activePost, null);
    assert.equal(f.state.comments.length, 0);
    assert.equal(f.list.dataset.uiState, 'error');
    assert.doesNotMatch(f.list.textContent, /PRIVATE|还没有/);
  });
}

test('filtered-empty text does not release a pending refresh busy state', async () => {
  const f = discussionFixture();
  await loadPosts(f, [post('P1', { commentCount: 1 })]);
  f.state.viewMode = 'unanswered';
  const pending = f.context.loadDiscussionPosts();
  f.context.renderDiscussionPosts();
  assert.match(f.list.textContent, /当前筛选/);
  assert.equal(f.list.dataset.uiState, 'loading');
  assert.equal(f.list.getAttribute('aria-busy'), 'true');
  f.requests.at(-1).resolve({ posts: [post('P1', { commentCount: 1 })] });
  await pending;
  assert.equal(f.list.dataset.uiState, 'empty');
  assert.equal(f.list.getAttribute('aria-busy'), 'false');
});

for (const change of ['session', 'board', 'scope']) {
  test(`late discussion success after ${change} change cannot replace the current feed`, async () => {
    const f = discussionFixture();
    const old = f.context.loadDiscussionPosts();
    if (change === 'session') f.context.resetDiscussionData();
    if (change === 'board') f.state.activeBoard = 'math';
    if (change === 'scope') f.state.scope = 'mine';
    const current = f.context.loadDiscussionPosts();
    f.requests[0].resolve({ posts: [post('OLD_PRIVATE')] });
    await old;
    assert.equal(f.list.dataset.uiState, 'loading');
    assert.doesNotMatch(f.list.textContent, /OLD_PRIVATE/);
    f.requests[1].resolve({ posts: [post('CURRENT')] });
    await current;
    assert.equal(f.list.dataset.uiState, 'ready');
    assert.match(f.list.textContent, /CURRENT/);
  });
}

test('a failed DELETE leaves ready feed data alone and does not trigger an automatic read retry', async () => {
  const f = discussionFixture();
  await loadPosts(f);
  const card = f.list.firstElementChild;
  const pending = f.context.deleteDiscussionPost('P1');
  assert.equal(f.requests.at(-1).options.method, 'DELETE');
  f.requests.at(-1).reject(new Error('delete failed'));
  await pending;
  assert.equal(f.list.firstElementChild, card);
  assert.equal(f.list.dataset.uiState, 'ready');
  assert.equal(f.state.postsStatus, 'ready');
  assert.equal(f.requests.length, 2);
  assert.deepEqual(f.alerts, ['delete failed']);
});

test('board refresh retains real metadata only on a transient failure and ignores older responses', async () => {
  const f = discussionFixture();
  const initial = f.context.loadDiscussionBoards();
  f.requests[0].resolve({ boards: [{ slug: 'math', name: '数学' }] });
  await initial;
  const refresh = f.context.loadDiscussionBoards();
  f.requests[1].reject(new Error('network'));
  await refresh;
  assert.equal(f.state.boards[0].slug, 'math');
  assert.equal(f.state.isFallback, true);
  f.context.renderDiscussionPosts();
  assert.doesNotMatch(f.context.discussionFilterStatus.textContent, /本地演示/);
  const old = f.context.loadDiscussionBoards();
  const current = f.context.loadDiscussionBoards();
  f.requests[2].resolve({ boards: [{ slug: 'OLD' }] });
  await old;
  assert.equal(f.context.discussionBoardList.dataset.uiState, 'loading');
  f.requests[3].resolve({ boards: [{ slug: 'CURRENT' }] });
  await current;
  assert.equal(f.state.boards[0].slug, 'CURRENT');
  assert.equal(f.context.discussionBoardList.dataset.uiState, 'ready');
});

test('invalidated board metadata does not overwrite the new session or leave its busy marker behind', async () => {
  const f = discussionFixture();
  const old = f.context.loadDiscussionBoards();
  f.state.sessionVersion += 1;
  f.state.boards = [{ slug: 'CURRENT' }];
  f.requests[0].resolve({ boards: [{ slug: 'OLD' }] });
  await old;
  assert.equal(f.state.boards[0].slug, 'CURRENT');
  assert.equal(f.context.discussionBoardList.getAttribute('aria-busy'), 'false');
});

test('fallback board navigation exposes an explicit GET recovery without retrying any write', async () => {
  const f = discussionFixture();
  const initial = f.context.loadDiscussionBoards();
  f.requests[0].reject(new Error('network'));
  await initial;
  assert.equal(f.state.isFallback, true);
  const retry = f.context.discussionBoardList.querySelector(
    '[data-action="retry-discussion-boards"]',
  );
  assert.ok(retry);
  assert.equal(f.requests.length, 1);
  const recovery = f.context.handleDiscussionBoardClick({ target: retry });
  assert.equal(f.requests[1].url, '/discussion/boards');
  assert.equal(f.requests[1].options.method, 'GET');
  f.requests[1].resolve({ boards: [{ slug: 'math', name: '数学' }] });
  await recovery;
  assert.equal(f.state.isFallback, false);
  assert.equal(
    f.context.discussionBoardList.querySelector('[data-action="retry-discussion-boards"]'),
    null,
  );
  assert.equal(f.requests.length, 2);
});

test('post-list retry also revalidates unavailable board metadata and never submits a post', async () => {
  const f = discussionFixture();
  const metadata = f.context.loadDiscussionBoards();
  f.requests[0].reject(new Error('network'));
  await metadata;
  const posts = f.context.loadDiscussionPosts();
  f.requests[1].reject(new Error('network'));
  await posts;
  const recovery = f.context.handleDiscussionPostClick({
    target: f.list.querySelector('[data-action="retry-discussion-posts"]'),
  });
  assert.equal(f.requests[2].url, '/discussion/boards');
  assert.match(f.requests[3].url, /^\/discussion\/posts\?/);
  assert.ok(f.requests.every((request) => request.options.method === 'GET'));
  f.requests[2].resolve({ boards: [{ slug: 'math', name: '数学' }] });
  f.requests[3].resolve({ posts: [post('CURRENT')] });
  await recovery;
  assert.equal(f.state.isFallback, false);
  assert.equal(f.list.dataset.uiState, 'ready');
  assert.match(f.list.textContent, /CURRENT/);
  assert.equal(f.requests.length, 4);
});

function adminFixture() {
  const document = documentFixture(
    '<section id="section"><div id="users" role="list"></div><div id="empty" class="hidden">没有符合条件的用户</div><span id="count"></span></section>',
  );
  const queue = requestQueue();
  const state = { owner: '', requestId: 0, status: 'idle' };
  const context = {
    ...queue,
    document,
    window: { freeBbsUiState: uiState },
    userState: { uid: 'A1', token: 'TOKEN1', isLoggedIn: true, isAdmin: true },
    adminUsersLoadState: state,
    adminPermissionCatalog: { boards: [], courses: [] },
    adminExpandedUserId: '',
    adminSection: document.getElementById('section'),
    adminUsers: document.getElementById('users'),
    adminUserEmpty: document.getElementById('empty'),
    adminUserVisibleCount: document.getElementById('count'),
    adminUserCountLabel: null,
    adminUserSearch: null,
    adminUserRoleFilter: null,
    adminUserScopeFilter: null,
    isAdminUsersPage: () => true,
    isPublicProfilePage: () => false,
    API_BASE_URL: '/api',
    manageLinks: [],
    fortuneLinks: [],
    electromagneticLinks: [],
    inventoryLinks: [],
    fortuneBonusToggle: null,
    centerActiveMobileNavigation() {},
    setAdminUserCardExpanded() {},
    renderAdminUserCard: (user) =>
      `<article class="admin-user-row" data-user-id="${user.id}" role="listitem">用户 ${user.id}</article>`,
  };
  vm.runInNewContext(
    [
      extract('function updateAdminUserListFilters()', 'function renderAdminDraftEditor('),
      extract('function resetAdminUsersLoadState(', 'async function handleAdminAiDialogExport('),
      extract('function renderAdminSection()', 'function renderSettingsForm('),
      extract('async function handleAdminUsersClick(', 'async function handleFortuneBonusToggle('),
    ].join('\n'),
    context,
  );
  return { state, context, ...queue, list: context.adminUsers, empty: context.adminUserEmpty };
}

async function loadUsers(f, users = [{ id: 'U1' }]) {
  const pending = f.context.loadAdminUsers();
  f.requests.at(-1).resolve({ users });
  await pending;
}

test('admin initial loading/error does not expose empty results until a successful empty response', async () => {
  const f = adminFixture();
  const pending = f.context.loadAdminUsers();
  f.context.updateAdminUserListFilters();
  assert.equal(f.empty.classList.contains('hidden'), true);
  assert.equal(f.list.dataset.uiState, 'loading');
  f.requests[0].reject(new Error('network'));
  await pending;
  assert.equal(f.list.dataset.uiState, 'error');
  assert.equal(f.list.firstElementChild.getAttribute('role'), 'alert');
  assert.equal(f.empty.classList.contains('hidden'), true);
  assert.equal(f.requests.length, 1);
  const retry = f.list.querySelector('[data-action="retry-admin-users"]');
  const recovery = f.context.handleAdminUsersClick({ target: retry });
  assert.equal(f.requests[1].options.method, 'GET');
  f.requests[1].resolve({ users: [] });
  await recovery;
  assert.equal(f.list.dataset.uiState, 'empty');
  assert.equal(f.empty.classList.contains('hidden'), false);
  assert.equal(f.empty.getAttribute('role'), 'status');
  assert.equal(f.list.querySelector('[role="alert"]'), null);
});

for (const status of [undefined, 503]) {
  test(`admin ${status || 'network'} refresh failure retains row DOM and exposes only manual retry`, async () => {
    const f = adminFixture();
    await loadUsers(f);
    const row = f.list.firstElementChild;
    const pending = f.context.loadAdminUsers();
    assert.equal(f.list.firstElementChild, row);
    f.requests.at(-1).reject(Object.assign(new Error('failure'), { status }));
    await pending;
    assert.equal(f.list.firstElementChild, row);
    assert.equal(f.list.dataset.uiState, 'error');
    assert.ok(f.list.querySelector('[data-admin-list-state] [data-action="retry-admin-users"]'));
    assert.equal(f.empty.classList.contains('hidden'), true);
    assert.equal(f.requests.length, 2);
    await loadUsers(f, [{ id: 'U2' }]);
    assert.equal(f.list.querySelector('[data-admin-list-state]'), null);
    assert.equal(f.list.dataset.uiState, 'ready');
    assert.match(f.list.textContent, /U2/);
  });
}

for (const status of [401, 403]) {
  test(`admin ${status} removes retained private user rows and permission catalogs`, async () => {
    const f = adminFixture();
    await loadUsers(f, [{ id: 'PRIVATE' }]);
    f.context.adminPermissionCatalog = { boards: ['PRIVATE'], courses: ['PRIVATE'] };
    const pending = f.context.loadAdminUsers();
    f.requests.at(-1).reject(Object.assign(new Error('denied'), { status }));
    await pending;
    assert.equal(f.list.querySelector('.admin-user-row'), null);
    assert.doesNotMatch(f.list.textContent, /PRIVATE/);
    assert.equal(f.context.adminPermissionCatalog.boards.length, 0);
    assert.equal(f.list.dataset.uiState, 'error');
    assert.equal(f.empty.classList.contains('hidden'), true);
  });
}

for (const change of ['account', 'token', 'logout', 'permission']) {
  for (const failure of [false, true]) {
    test(`late admin ${failure ? 'failure' : 'success'} after ${change} cannot revive a private list`, async () => {
      const f = adminFixture();
      const old = f.context.loadAdminUsers();
      if (change === 'account') f.context.userState.uid = 'A2';
      if (change === 'token') f.context.userState.token = 'TOKEN2';
      if (change === 'logout') f.context.userState.isLoggedIn = false;
      if (change === 'permission') f.context.userState.isAdmin = false;
      f.context.renderAdminSection();
      const currentMarkup = f.list.innerHTML;
      if (failure) f.requests[0].reject(new Error('old failure'));
      else f.requests[0].resolve({ users: [{ id: 'OLD_PRIVATE' }] });
      await old;
      assert.equal(f.list.innerHTML, currentMarkup);
      assert.doesNotMatch(f.list.textContent, /OLD_PRIVATE|加载失败/);
      if (f.requests[1]) {
        f.requests[1].resolve({ users: [{ id: 'CURRENT' }] });
        await new Promise((resolve) => {
          setImmediate(resolve);
        });
        assert.equal(f.list.dataset.uiState, 'ready');
      }
    });
  }
}

test('admin routine section rendering and successful refresh do not discard unsaved edits', async () => {
  const f = adminFixture();
  await loadUsers(f);
  const row = f.list.firstElementChild;
  row.classList.add('is-dirty');
  row.textContent = '未保存的编辑';
  f.context.renderAdminSection();
  assert.equal(f.requests.length, 1);
  const pending = f.context.loadAdminUsers();
  f.requests[1].resolve({ users: [{ id: 'NEW_FROM_SERVER' }] });
  await pending;
  assert.equal(f.list.firstElementChild, row);
  assert.equal(row.textContent, '未保存的编辑');
  assert.equal(f.list.dataset.uiState, 'ready');
  assert.equal(f.list.getAttribute('aria-busy'), 'false');
});

for (const failure of [false, true]) {
  test(`a draft added during the first admin read survives its ${failure ? 'failure' : 'success'}`, async () => {
    const f = adminFixture();
    const pending = f.context.loadAdminUsers();
    const draft = f.context.document.createElement('article');
    draft.className = 'admin-user-row admin-user-row-draft';
    draft.textContent = '未提交的新用户';
    f.list.append(draft);
    if (failure) f.requests[0].reject(new Error('network'));
    else f.requests[0].resolve({ users: [{ id: 'SERVER' }] });
    await pending;
    assert.equal(f.list.querySelector('.admin-user-row-draft'), draft);
    assert.doesNotMatch(f.list.textContent, /正在加载/);
    assert.equal(f.list.getAttribute('aria-busy'), 'false');
    assert.equal(f.list.dataset.uiState, failure ? 'error' : 'ready');
  });
}

test('an older administrator refresh cannot replace a newer successful directory', async () => {
  const f = adminFixture();
  const old = f.context.loadAdminUsers();
  const current = f.context.loadAdminUsers();
  f.requests[1].resolve({ users: [{ id: 'CURRENT' }] });
  await current;
  f.requests[0].reject(new Error('old failure'));
  await old;
  assert.equal(f.list.dataset.uiState, 'ready');
  assert.match(f.list.textContent, /CURRENT/);
  assert.doesNotMatch(f.list.textContent, /加载失败/);
});
