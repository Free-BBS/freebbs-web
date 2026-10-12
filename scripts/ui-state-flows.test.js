const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const uiState = require('../public/ui-state');

const appSource = fs.readFileSync('public/app.js', 'utf8');
const workbenchSource = fs.readFileSync('public/workbench.js', 'utf8');

function extract(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `Missing actual function: ${start}`);
  return source.slice(startIndex, endIndex);
}

const commentsSource = extract(
  appSource,
  'async function loadDiscussionComments(',
  'function updatePostReactionState(',
);
const submitSource = extract(
  appSource,
  'async function handleDiscussionCommentSubmit(',
  'async function handleDiscussionCreateToggle(',
);
const listsSource = extract(
  workbenchSource,
  '  function renderImportantItems(',
  '  function buildNotificationQuery(',
);
const flush = () =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

function commentsFixture() {
  const requests = [];
  const renders = [];
  const state = {
    sessionVersion: 0,
    postRequestId: 0,
    commentsRequestId: 0,
    activePostId: 'P1',
    activePost: { id: 'P1', commentCount: 0 },
    posts: [{ id: 'P1', commentCount: 0 }],
    comments: [],
    commentsStatus: 'ready',
    maxProgress: [],
  };
  let clock = 0;
  let tick;
  let stopped = false;
  const message = { textContent: '' };
  const context = {
    discussionState: state,
    Date: { now: () => clock },
    renderDiscussionComments: () =>
      renders.push({ status: state.commentsStatus, ids: state.comments.map((item) => item.id) }),
    callApi: (path, options) =>
      new Promise((resolve, reject) => {
        requests.push({ path, options, resolve, reject });
      }),
    document: { getElementById: () => null },
    window: {
      setInterval(callback) {
        tick = callback;
        return 1;
      },
      clearInterval() {
        stopped = true;
      },
      FreeBbsMaxImageResults: { isGenerationPhase: () => false },
    },
  };
  vm.createContext(context);
  vm.runInContext(commentsSource, context);
  return {
    state,
    requests,
    renders,
    context,
    message,
    start: () => context.pollDiscussionCommentsForMax('P1', 1, message),
    tick: (elapsed = 2500) => {
      clock += elapsed;
      return tick();
    },
    stopped: () => stopped,
  };
}

test('slow Max polling is single-flight and displays the successful reply without starvation', async () => {
  const f = commentsFixture();
  f.start();
  const first = f.tick();
  await f.tick();
  await f.tick();
  assert.equal(f.requests.length, 1);
  f.requests[0].resolve({
    comments: [{ id: 2, author: { username: 'max_the_agent' }, contentMarkdown: '回答' }],
  });
  await first;
  assert.equal(f.state.commentsStatus, 'ready');
  assert.equal(f.state.comments[0].id, 2);
  assert.equal(f.message.textContent, 'Max 已回复');
  assert.equal(f.stopped(), true);
});

test('Max polling does not overlap an independent comment refresh', async () => {
  const f = commentsFixture();
  f.start();
  f.state.commentsStatus = 'loading';
  await f.tick();
  assert.equal(f.requests.length, 0);
  f.state.commentsStatus = 'ready';
  const pending = f.tick();
  assert.equal(f.requests.length, 1);
  f.requests[0].resolve({ comments: [] });
  await pending;
});

for (const change of ['owner', 'post']) {
  test(`Max polling stops without changing messages after a pending ${change} change`, async () => {
    const f = commentsFixture();
    f.start();
    const pending = f.tick();
    if (change === 'owner') f.state.sessionVersion += 1;
    else {
      f.state.activePostId = 'P2';
      f.state.postRequestId += 1;
    }
    f.state.comments = [{ id: 99, contentMarkdown: '当前评论' }];
    f.state.commentsStatus = 'ready';
    f.message.textContent = '当前提示';
    const renderCount = f.renders.length;
    f.requests[0].resolve({
      comments: [{ id: 2, author: { username: 'max_the_agent' }, contentMarkdown: '旧回答' }],
    });
    await pending;
    assert.equal(f.state.comments[0].id, 99);
    assert.equal(f.message.textContent, '当前提示');
    assert.equal(f.renders.length, renderCount);
    assert.equal(f.stopped(), true);
  });
}

test('Max polling retains its wall-clock limit while an earlier request is still pending', async () => {
  const f = commentsFixture();
  f.start();
  const pending = f.tick();
  await f.tick(120_000);
  assert.equal(f.requests.length, 1);
  assert.equal(f.stopped(), true);
  assert.match(f.message.textContent, /Max 可能稍后回复/);
  f.requests[0].resolve({ comments: [] });
  await pending;
});

function submitFixture(status = 'ready') {
  const f = commentsFixture();
  f.state.commentsStatus = status;
  f.state.comments = status === 'ready' ? [{ id: 1 }] : [];
  const user = { isLoggedIn: true, uid: 'user-a' };
  const input = { value: '一条评论', focus() {} };
  const button = { disabled: false };
  const attributes = {};
  let clears = 0;
  let postRenders = 0;
  const form = {
    dataset: { postId: 'P1', parentCommentId: '' },
    querySelector(selector) {
      if (selector === '.discussion-comment-input') return input;
      if (selector === '.discussion-comment-message') return f.message;
      if (selector === '[type="submit"]') return button;
      return null;
    },
    setAttribute(name, value) {
      attributes[name] = value;
    },
    removeAttribute(name) {
      delete attributes[name];
    },
    dispatchEvent() {},
  };
  Object.assign(f.context, {
    userState: user,
    rememberDiscussionCommentDraft: () => {},
    clearDiscussionCommentComposer: () => {
      clears += 1;
    },
    renderDiscussionPosts: () => {
      postRenders += 1;
    },
    shouldWaitForMaxReply: () => false,
    discussionOpenReplyByPost: new Map(),
    expandDiscussionReplyThreadForComment: () => {},
    CustomEvent: function CustomEvent(type) {
      this.type = type;
    },
  });
  vm.runInContext(submitSource, f.context);
  return {
    ...f,
    user,
    form,
    button,
    clears: () => clears,
    postRenders: () => postRenders,
    submit: () =>
      f.context.handleDiscussionCommentSubmit({
        target: { closest: () => form },
        preventDefault() {},
      }),
  };
}

for (const status of ['error', 'loading']) {
  test(`a successful comment posted from ${status} reloads the full list instead of hiding the new comment`, async () => {
    const f = submitFixture(status);
    const pending = f.submit();
    assert.equal(f.requests[0].options.method, 'POST');
    assert.equal(f.requests[0].path, '/discussion/posts/P1/comments');
    f.requests[0].resolve({ comment: { id: 3, contentMarkdown: '已发表' } });
    await flush();
    assert.equal(f.requests.length, 2);
    assert.equal(f.requests[1].options.method, 'GET');
    f.requests[1].resolve({ comments: [{ id: 1 }, { id: 3, contentMarkdown: '已发表' }] });
    await pending;
    assert.equal(f.state.commentsStatus, 'ready');
    assert.equal(f.state.comments.length, 2);
    assert.equal(f.state.comments[1].id, 3);
    assert.equal(f.renders.at(-1).status, 'ready');
    assert.equal(f.button.disabled, false);
  });
}

test('a successful post to a ready comment list appends without another request', async () => {
  const f = submitFixture();
  const pending = f.submit();
  f.requests[0].resolve({ comment: { id: 3 } });
  await pending;
  assert.equal(f.requests.length, 1);
  assert.equal(f.state.commentsStatus, 'ready');
  assert.equal(f.state.comments.length, 2);
  assert.equal(f.state.comments[1].id, 3);
});

for (const change of ['uid', 'session', 'post', 'detail']) {
  for (const outcome of ['success', 'failure']) {
    test(`a late comment POST ${outcome} after ${change} change cannot mutate current comments or messages`, async () => {
      const f = submitFixture('error');
      const pending = f.submit();
      if (change === 'uid') f.user.uid = 'user-b';
      else if (change === 'session') f.state.sessionVersion += 1;
      else if (change === 'detail') f.state.postRequestId += 1;
      else f.state.activePostId = 'P2';
      f.state.activePost = { id: f.state.activePostId, commentCount: 8 };
      f.state.posts = [{ id: f.state.activePostId, commentCount: 8 }];
      f.state.comments = [{ id: 99 }];
      f.state.commentsStatus = 'ready';
      f.message.textContent = '当前提示';
      if (outcome === 'success') f.requests[0].resolve({ comment: { id: 3 } });
      else f.requests[0].reject(new Error('旧错误'));
      await pending;
      assert.equal(f.state.comments[0].id, 99);
      assert.equal(f.state.commentsStatus, 'ready');
      assert.equal(f.state.activePost.commentCount, 8);
      assert.equal(f.state.posts[0].commentCount, 8);
      assert.equal(f.message.textContent, '当前提示');
      assert.equal(f.requests.length, 1);
      assert.equal(f.clears(), 0);
      assert.equal(f.renders.length, 0);
      assert.equal(f.postRenders(), 0);
    });
  }
}

class List {
  constructor() {
    this.dataset = { uiState: 'error' };
    this.attributes = { 'aria-busy': 'true' };
    this.children = [];
  }

  setAttribute(key, value) {
    this.attributes[key] = value;
  }

  replaceChildren(...children) {
    this.children = children;
  }
}

function listsFixture() {
  const importantList = new List();
  const notificationList = new List();
  const scheduleList = new List();
  const state = {
    importantItems: [{ publicId: 'i_1', status: 'confirmed', title: '重要事项' }],
    scheduleItems: [{ publicId: 's_1', status: 'confirmed', title: '日程' }],
    notifications: [{ publicId: 'n_1', title: '通知', category: 'system' }],
    communityNotifications: [],
    communityUnreadCount: 0,
    notificationFilters: { search: '', category: '', unread: false, favorite: false },
    noticeView: 'all',
    notificationLoad: { workbench: { status: 'fulfilled' }, community: { status: 'fulfilled' } },
  };
  const elements = {
    importantList,
    notificationList,
    scheduleList,
    notificationCount: {},
    noticeHint: { textContent: '' },
  };
  const context = {
    state,
    elements,
    PRIORITY_LABELS: {},
    CATEGORY_LABELS: {},
    currentConflicts: [],
    window: { freeBbsUiState: uiState },
    makeDataItem: (item) => item,
    makeAction: (label) => ({ label }),
    formatImportantDue: () => '',
    formatMoment: (value) => String(value || ''),
    truncate: (value) => String(value || ''),
    paintCalendarItem: () => {},
    renderWeekGrid: () => {},
  };
  vm.createContext(context);
  vm.runInContext(listsSource, context);
  return { state, elements, context };
}

for (const [method, key] of [
  ['renderImportantItems', 'importantList'],
  ['renderScheduleItems', 'scheduleList'],
]) {
  test(`${method} resets successful actual data to ready after an error or loading state`, () => {
    const f = listsFixture();
    f.context[method]();
    assert.equal(f.elements[key].dataset.uiState, 'ready');
    assert.equal(f.elements[key].attributes['aria-busy'], 'false');
    assert.equal(f.elements[key].children.length, 1);
    assert.ok(f.elements[key].children[0].title);
  });
}

test('notifications retain their actual data while a remaining source is loading, then become ready', () => {
  const f = listsFixture();
  f.state.notificationLoad.community.status = 'pending';
  f.context.renderNotifications();
  assert.equal(f.elements.notificationList.dataset.uiState, 'loading');
  assert.equal(f.elements.notificationList.attributes['aria-busy'], 'true');
  assert.equal(f.elements.notificationList.children[0].title, '通知');
  f.state.notificationLoad.community.status = 'fulfilled';
  f.context.renderNotifications();
  assert.equal(f.elements.notificationList.dataset.uiState, 'ready');
  assert.equal(f.elements.notificationList.attributes['aria-busy'], 'false');
  assert.equal(f.elements.notificationList.children[0].title, '通知');
});

test('partially failed notifications keep successful data rather than the previous global error state', () => {
  const f = listsFixture();
  f.state.notificationLoad.community = { status: 'rejected', error: new Error('离线') };
  f.context.renderNotifications();
  assert.equal(f.elements.notificationList.dataset.uiState, 'ready');
  assert.equal(f.elements.notificationList.attributes['aria-busy'], 'false');
  assert.equal(f.elements.notificationList.children[0].title, '通知');
  assert.match(f.elements.noticeHint.textContent, /部分通知暂时无法加载/);
});
