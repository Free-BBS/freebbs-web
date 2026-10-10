const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync('public/workbench.js', 'utf8');
const loader = source.slice(
  source.indexOf('  async function loadWorkbenchData()'),
  source.indexOf('  function openDialog('),
);

function fixture() {
  const requests = [];
  const renders = [];
  const state = { requestVersion: 0, ownerKey: '', weekStart: 0 };
  let owner = 'user-a';
  let cleared = 0;
  const context = {
    AbortController,
    URLSearchParams,
    Date,
    DAY_MS: 86400000,
    state,
    elements: {
      importantList: 'important',
      notificationList: 'notifications',
      scheduleList: 'schedule',
      notificationMore: {},
      noticeHint: { textContent: 'current hint' },
      weekGrid: {},
    },
    getOwnerKey: () => owner,
    isLoggedIn: () => Boolean(owner),
    getWeekStart: () => 0,
    buildNotificationQuery: () => 'limit=50',
    renderState: () => {},
    renderImportantItems: () => renders.push(['important', state.importantItems]),
    renderScheduleItems: () => renders.push(['schedule', state.scheduleItems]),
    renderNotifications: () => renders.push(['notifications', state.notificationLoad]),
    renderDataFailure: (list, label, error) => renders.push(['error', list, error]),
    CustomEvent: class {
      constructor(type) {
        this.type = type;
      }
    },
    window: { dispatchEvent: (event) => renders.push(['event', event.type]) },
    app: {
      callApi: (path, options) =>
        new Promise((resolve, reject) => {
          requests.push({ path, options, resolve, reject });
        }),
      clearSession: () => {
        cleared += 1;
        owner = '';
        state.requestVersion += 1;
        state.loadAbortController?.abort();
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(loader, context);
  return {
    state,
    elements: context.elements,
    requests,
    renders,
    load: () => context.loadWorkbenchData(),
    loadMore: () => context.loadMoreCommunityNotifications(),
    setOwner: (next) => {
      owner = next;
    },
    cleared: () => cleared,
  };
}

const flush = () =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });
const finish = (requests) => requests.forEach((request) => request.resolve({}));

test('important items and schedule render while both notification sources are pending', async () => {
  const f = fixture();
  const loading = f.load();
  assert.equal(f.requests.length, 4);
  f.requests[0].resolve({ importantItems: [{ title: 'important' }] });
  f.requests[3].resolve({ scheduleItems: [{ title: 'schedule' }] });
  await flush();
  assert.deepEqual(
    f.renders.map(([kind]) => kind),
    ['important', 'schedule', 'event'],
  );
  assert.equal(f.state.notificationLoad.community.status, 'pending');
  finish(f.requests);
  await loading;
});

test('each notification source renders without waiting for the other source', async () => {
  const f = fixture();
  const loading = f.load();
  f.requests[2].resolve({ notifications: [{ id: 1 }], nextCursor: 'next', unreadCount: 1 });
  await flush();
  assert.equal(f.renders[0][0], 'notifications');
  assert.equal(f.state.notificationLoad.community.status, 'fulfilled');
  assert.equal(f.state.notificationLoad.workbench.status, 'pending');
  assert.equal(f.state.communityCursor, 'next');
  finish(f.requests);
  await loading;
});

test('a local request failure does not prevent successful sections rendering', async () => {
  const f = fixture();
  const loading = f.load();
  const error = Object.assign(new Error('timed out'), { code: 'request_timeout', status: 0 });
  f.requests[1].reject(error);
  f.requests[0].resolve({ importantItems: [] });
  f.requests[3].resolve({ scheduleItems: [] });
  await flush();
  assert.equal(f.state.notificationLoad.workbench.error, error);
  assert.equal(f.cleared(), 0);
  assert.ok(f.renders.some(([kind]) => kind === 'important'));
  assert.ok(f.renders.some(([kind]) => kind === 'schedule'));
  finish(f.requests);
  await loading;
});

test('a newer load cancels obsolete requests and ignores late success and unauthorized responses', async () => {
  const f = fixture();
  const oldLoading = f.load();
  const old = f.requests.slice();
  const nextLoading = f.load();
  assert.ok(old.every((request) => request.options.signal.aborted));
  old[0].resolve({ importantItems: [{ title: 'stale' }] });
  old[1].reject(Object.assign(new Error('stale auth'), { status: 401 }));
  finish(old.slice(2));
  await oldLoading;
  assert.equal(f.renders.length, 0);
  assert.equal(f.cleared(), 0);
  finish(f.requests.slice(4));
  await nextLoading;
});

test('late data from another owner is ignored', async () => {
  const f = fixture();
  const loading = f.load();
  f.setOwner('user-b');
  finish(f.requests);
  await loading;
  assert.equal(f.renders.length, 0);
});

test('only a current unauthorized response clears the session and prevents later renders', async () => {
  const f = fixture();
  const loading = f.load();
  f.requests[0].reject(Object.assign(new Error('unauthorized'), { status: 401 }));
  await flush();
  assert.equal(f.cleared(), 1);
  finish(f.requests.slice(1));
  await loading;
  assert.equal(f.renders.length, 0);
});

test('obsolete pagination failure cannot overwrite another owner hint or enable its busy control', async () => {
  const f = fixture();
  f.state.communityCursor = 'cursor-a';
  const loading = f.loadMore();
  f.setOwner('user-b');
  f.state.requestVersion += 1;
  f.requests[0].reject(Object.assign(new Error('old timeout'), { code: 'request_timeout' }));
  await loading;
  assert.equal(f.elements.noticeHint.textContent, 'current hint');
  assert.equal(f.elements.notificationMore.disabled, true);
});

test('current pagination failure remains retryable without clearing the session', async () => {
  const f = fixture();
  f.state.communityCursor = 'cursor-a';
  const loading = f.loadMore();
  f.requests[0].reject(Object.assign(new Error('current timeout'), { code: 'request_timeout' }));
  await loading;
  assert.equal(f.elements.noticeHint.textContent, 'current timeout');
  assert.equal(f.elements.notificationMore.disabled, false);
  assert.equal(f.cleared(), 0);
});

test('successful pagination releases its control after advancing the cursor', async () => {
  const f = fixture();
  f.state.communityCursor = 'cursor-a';
  f.state.communityNotifications = [];
  const loading = f.loadMore();
  f.requests[0].resolve({ notifications: [{ id: 1 }], nextCursor: 'cursor-b', unreadCount: 1 });
  await loading;
  assert.equal(f.state.communityCursor, 'cursor-b');
  assert.equal(f.elements.notificationMore.disabled, false);
});
