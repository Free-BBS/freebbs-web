const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const publicDir = path.join(__dirname, '..', 'public');
const source = fs.readFileSync(path.join(publicDir, 'knowledge.js'), 'utf8');
const html = fs.readFileSync(path.join(publicDir, 'knowledge.html'), 'utf8');
const start = source.indexOf('  function setHidden(');
const end = source.indexOf('  function bindChatControls(', start);
assert.ok(start > 0 && end > start, 'discussion controller is present');

function element() {
  const listeners = new Map();
  return {
    value: '',
    textContent: '',
    innerHTML: '',
    disabled: false,
    hidden: false,
    dataset: {},
    classList: { toggle() {} },
    querySelectorAll: () => [],
    setAttribute() {},
    removeAttribute() {},
    toggleAttribute(name, enabled) {
      if (name === 'hidden') this.hidden = enabled;
    },
    focus() {},
    replaceChildren() {
      this.innerHTML = '';
    },
    addEventListener(type, callback) {
      listeners.set(type, [...(listeners.get(type) || []), callback]);
    },
    emit(type, event = {}) {
      for (const callback of listeners.get(type) || []) callback(event);
    },
  };
}

function harness({ loggedIn = true, storage = new Map() } = {}) {
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => [id, element()]));
  const get = (suffix) => elements.get(`knowledge-discussion-${suffix}`);
  const window = element();
  const calls = [];
  const api = {
    postError: null,
    postWait: null,
    commentError: null,
    commentWait: null,
    detailWait: null,
  };
  const post = {
    id: 'PUBLIC01',
    title: 'Course question',
    contentMarkdown: 'Question body',
    board: { slug: 'signal', name: 'Signal discussion' },
    author: { username: 'classmate' },
    commentCount: 1,
  };
  const comment = {
    id: 17,
    author: { username: 'classmate' },
    contentMarkdown: 'Original comment',
  };
  const state = {
    course: { slug: 'signals', boardSlug: 'signal', name: 'Signals' },
    discussionPosts: [post],
    discussionPost: null,
    discussionComments: [],
    discussionCommentDrafts: new Map(),
    discussionCommentParentId: 0,
    discussionCommentSending: false,
    discussionPostSending: false,
    discussionComposeMode: 'edit',
    discussionSessionUid: '',
    discussionSessionVersion: 0,
    discussionActivePostId: '',
    discussionDetailRequest: 0,
    discussionListRequest: 0,
    discussionLoading: false,
    discussionLoaded: false,
  };
  const app = {
    userState: { uid: loggedIn ? 'student-one' : '', isLoggedIn: loggedIn },
    renderMarkdownContent: (markdown) => `<p>${markdown}</p>`,
    enhanceMarkdownContent() {},
    async callApi(url, options) {
      calls.push({ url, options });
      if (options.method === 'POST' && url === '/discussion/posts') {
        if (api.postError) throw api.postError;
        if (api.postWait) await api.postWait;
        return { post };
      }
      if (options.method === 'POST') {
        if (api.commentError) throw api.commentError;
        if (api.commentWait) await api.commentWait;
        return {
          message: '回复已发布',
          comment: { ...comment, id: 18, ...JSON.parse(options.body) },
        };
      }
      if (url.includes('/comments')) return { comments: [comment] };
      if (url.includes('?')) return { posts: [post] };
      if (api.detailWait) await api.detailWait;
      return { post: { ...post, id: url.split('/').at(-1) } };
    },
  };
  const context = vm.createContext({
    app,
    state,
    window,
    document: {
      getElementById: (id) => elements.get(id),
      querySelectorAll: () => [],
    },
    URLSearchParams,
    courseSlug: 'signals',
    nodeId: 'A1',
    sessionStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    discussionDateFormatter: new Intl.DateTimeFormat('zh-CN'),
    escapeHtml: (value) => String(value || '').replaceAll('<', '&lt;'),
  });
  vm.runInContext(source.slice(start, end), context, { filename: 'knowledge.js discussion' });
  context.bindDiscussionComposer();
  return { context, app, state, get, calls, api, window, storage };
}

test('anonymous post drafts survive tab changes and login, then use the course board', async () => {
  const fixture = harness({ loggedIn: false });
  fixture.context.showDiscussionComposer();
  fixture.get('compose-title').value = 'Question draft';
  fixture.get('compose-content').value = '**Markdown draft**';
  fixture.context.setDiscussionComposeMode('preview');
  assert.match(fixture.get('compose-preview').innerHTML, /Markdown draft/);
  fixture.context.setChatTab('max');
  fixture.context.setChatTab('discussion');
  await fixture.context.submitDiscussionPost();
  assert.equal(fixture.calls.filter((call) => call.options.method === 'POST').length, 0);
  assert.equal(fixture.get('compose-content').value, '**Markdown draft**');
  Object.assign(fixture.app.userState, { uid: 'student-one', isLoggedIn: true });
  fixture.window.emit('freebbs:session-change');
  assert.equal(fixture.get('compose-title').value, 'Question draft');
  await fixture.context.submitDiscussionPost();
  const request = fixture.calls.find((call) => call.options.method === 'POST');
  assert.deepEqual(JSON.parse(request.options.body), {
    boardSlug: 'signal',
    title: 'Question draft',
    contentMarkdown: '**Markdown draft**',
  });
  assert.equal(fixture.state.discussionActivePostId, 'PUBLIC01');
  assert.equal(fixture.get('compose-title').value, '');
  assert.equal(fixture.get('compose').hidden, true);
  assert.match(fixture.get('comments').innerHTML, /Original comment/);
});

test('posting twice during the same request creates only one post', async () => {
  const fixture = harness();
  fixture.get('compose-title').value = 'Question';
  fixture.get('compose-content').value = 'Content';
  let finish;
  fixture.api.postWait = new Promise((resolve) => {
    finish = resolve;
  });
  const first = fixture.context.submitDiscussionPost();
  await fixture.context.submitDiscussionPost();
  assert.equal(fixture.calls.filter((call) => call.options.method === 'POST').length, 1);
  finish();
  await first;
  assert.equal(fixture.state.discussionPostSending, false);
  assert.equal(fixture.state.discussionActivePostId, 'PUBLIC01');
});

test('failed publishing retains drafts, while account changes clear private content', async () => {
  const fixture = harness();
  fixture.get('compose-title').value = 'Draft title';
  fixture.get('compose-content').value = 'Private content';
  fixture.api.postError = new Error('Temporary failure');
  await fixture.context.submitDiscussionPost();
  assert.equal(fixture.get('compose-content').value, 'Private content');
  assert.match(fixture.get('compose-status').textContent, /草稿已保留/);
  fixture.window.emit('freebbs:session-change');
  assert.equal(fixture.get('compose-content').value, 'Private content');
  fixture.state.discussionCommentDrafts.set('PUBLIC01:17', 'Private reply');
  fixture.get('compose-preview').innerHTML = 'Private preview';
  fixture.app.userState.uid = 'student-two';
  fixture.window.emit('freebbs:session-change');
  assert.equal(fixture.get('compose-title').value, '');
  assert.equal(fixture.get('compose-content').value, '');
  assert.equal(fixture.get('compose-preview').innerHTML, '');
  assert.equal(fixture.state.discussionCommentDrafts.size, 0);
});

test('inline targeted replies use the parent comment and retain failed drafts', async () => {
  const fixture = harness();
  await fixture.context.openDiscussionPost('PUBLIC01');
  fixture.context.selectDiscussionCommentTarget(17);
  fixture.get('comment-content').value = 'Reply to classmate';
  fixture.get('comment-content').emit('input', { target: fixture.get('comment-content') });
  fixture.api.commentError = new Error('Temporary failure');
  await fixture.context.submitDiscussionComment();
  assert.equal(fixture.get('comment-content').value, 'Reply to classmate');
  fixture.context.selectDiscussionCommentTarget(0);
  assert.equal(fixture.get('comment-content').value, '');
  fixture.context.selectDiscussionCommentTarget(17);
  assert.equal(fixture.get('comment-content').value, 'Reply to classmate');
  fixture.api.commentError = null;
  await fixture.context.submitDiscussionComment();
  const request = fixture.calls.filter((call) => call.options.method === 'POST').at(-1);
  assert.equal(request.url, '/discussion/posts/PUBLIC01/comments');
  assert.deepEqual(JSON.parse(request.options.body), {
    contentMarkdown: 'Reply to classmate',
    parentCommentId: 17,
  });
  assert.match(fixture.get('comments').innerHTML, /Reply to classmate/);
  assert.equal(fixture.get('comment-content').value, '');
  assert.equal(fixture.state.discussionCommentDrafts.size, 0);
});

test('navigating during a pending reply does not transfer its draft into another post', async () => {
  const fixture = harness();
  await fixture.context.openDiscussionPost('PUBLIC01');
  fixture.get('comment-content').value = 'Reply only for first post';
  let finish;
  fixture.api.commentWait = new Promise((resolve) => {
    finish = resolve;
  });
  const pending = fixture.context.submitDiscussionComment();
  await fixture.context.submitDiscussionComment();
  assert.equal(fixture.calls.filter((call) => call.options.method === 'POST').length, 1);
  await fixture.context.openDiscussionPost('PUBLIC02');
  assert.equal(fixture.get('comment-content').value, '');
  finish();
  await pending;
  assert.equal(fixture.state.discussionActivePostId, 'PUBLIC02');
  assert.equal(fixture.get('comment-content').value, '');
  assert.doesNotMatch(fixture.get('comments').innerHTML, /Reply only for first post/);
});

test('a course without a board cannot publish into an unrelated board', async () => {
  const fixture = harness();
  fixture.state.course.boardSlug = '';
  await fixture.context.loadDiscussionPosts();
  fixture.get('compose-title').value = 'Question';
  fixture.get('compose-content').value = 'Content';
  await fixture.context.submitDiscussionPost();
  assert.equal(fixture.calls.length, 0);
  assert.match(fixture.get('compose-status').textContent, /尚未关联讨论区/);
});

test('refreshing the same post during a targeted reply preserves its top-level draft', async () => {
  const fixture = harness();
  await fixture.context.openDiscussionPost('PUBLIC01');
  fixture.get('comment-content').value = 'Top-level draft';
  fixture.get('comment-content').emit('input', { target: fixture.get('comment-content') });
  fixture.context.selectDiscussionCommentTarget(17);
  fixture.get('comment-content').value = 'Targeted reply';
  let finish;
  fixture.api.commentWait = new Promise((resolve) => {
    finish = resolve;
  });
  const pending = fixture.context.submitDiscussionComment();
  await fixture.context.openDiscussionPost('PUBLIC01');
  assert.equal(fixture.get('comment-content').value, 'Top-level draft');
  const count = fixture.state.discussionPost.commentCount;
  finish();
  await pending;
  assert.equal(fixture.get('comment-content').value, 'Top-level draft');
  assert.equal(fixture.state.discussionPost.commentCount, count);
  assert.equal(fixture.state.discussionCommentDrafts.get('PUBLIC01:0'), 'Top-level draft');
  assert.equal(fixture.state.discussionCommentDrafts.has('PUBLIC01:17'), false);
});

test('a tab restores its anonymous post draft after login and clears it after publication', async () => {
  const storage = new Map();
  const guest = harness({ loggedIn: false, storage });
  guest.get('compose-title').value = 'Draft before login';
  guest.get('compose-content').value = 'Preserved across the login page';
  guest.get('compose-content').emit('input');
  assert.equal(storage.size, 1);
  const loggedIn = harness({ storage });
  loggedIn.context.showDiscussionComposer();
  assert.equal(loggedIn.get('compose-title').value, 'Draft before login');
  assert.equal(loggedIn.get('compose-content').value, 'Preserved across the login page');
  await loggedIn.context.submitDiscussionPost();
  assert.equal(storage.size, 0);
});

test('a stored account draft is not restored for another account', () => {
  const storage = new Map();
  const original = harness({ storage });
  original.get('compose-title').value = 'Private draft';
  original.get('compose-title').emit('input');
  const other = harness({ storage });
  other.app.userState.uid = 'student-two';
  other.context.showDiscussionComposer();
  assert.equal(other.get('compose-title').value, '');
  assert.equal(storage.size, 0);
});

test('logging out invalidates pending detail requests and clears the previous view', async () => {
  const fixture = harness();
  let finish;
  fixture.api.detailWait = new Promise((resolve) => {
    finish = resolve;
  });
  const pending = fixture.context.openDiscussionPost('ADMINONLY');
  Object.assign(fixture.app.userState, { uid: '', isLoggedIn: false });
  fixture.window.emit('freebbs:session-change');
  finish();
  await pending;
  assert.equal(fixture.state.discussionActivePostId, '');
  assert.equal(fixture.state.discussionPost, null);
  assert.equal(fixture.get('detail').hidden, true);
  assert.equal(
    fixture.calls.filter((call) => call.url === '/discussion/posts/ADMINONLY/comments').length,
    0,
  );
});

test('returning to the list invalidates a long-post request without clearing the list scroll', async () => {
  const fixture = harness();
  fixture.get('list-view').scrollTop = 480;
  let finish;
  fixture.api.detailWait = new Promise((resolve) => {
    finish = resolve;
  });
  const pending = fixture.context.openDiscussionPost('PUBLIC01');
  fixture.context.showDiscussionList({ focus: true });
  finish();
  await pending;
  assert.equal(fixture.get('detail').hidden, true);
  assert.equal(fixture.get('list-view').scrollTop, 480);
  assert.equal(fixture.state.discussionActivePostId, '');
});

test('knowledge origins is a fixed development placeholder outside editable course Markdown', () => {
  assert.match(html, /id="knowledge-history"/);
  assert.match(html, /为了解决什么问题，出现了这个知识？/);
  assert.match(html, /class="knowledge-history-placeholder"[^>]*>正在开发<\/div>/);
  assert.ok(html.indexOf('id="knowledge-history"') < html.indexOf('id="knowledge-reading"'));
  const css = fs.readFileSync(path.join(publicDir, 'course.css'), 'utf8');
  assert.match(css, /\.knowledge-discussion-detail-actions\s*\{[^}]*position: sticky/);
  assert.match(css, /\.knowledge-chat-fab\.is-active\s*\{[^}]*visibility: hidden/);
});
