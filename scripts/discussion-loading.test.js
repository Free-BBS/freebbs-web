const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync('public/app.js', 'utf8');
const loader = source.slice(
  source.indexOf('async function loadDiscussionComments('),
  source.indexOf('function pollDiscussionCommentsForMax('),
);

function fixture() {
  const requests = [];
  const renders = [];
  const state = {
    sessionVersion: 0,
    postRequestId: 0,
    activePostId: 'P1',
    comments: [],
    commentsStatus: 'idle',
  };
  const context = {
    discussionState: state,
    renderDiscussionComments: () =>
      renders.push({ status: state.commentsStatus, comments: [...state.comments] }),
    callApi: () =>
      new Promise((resolve, reject) => {
        requests.push({ resolve, reject });
      }),
  };
  vm.runInNewContext(loader, context);
  return { state, requests, renders, load: () => context.loadDiscussionComments('P1') };
}

test('failed comment load has an error state rather than a fake successful empty list', async () => {
  const f = fixture();
  const pending = f.load();
  assert.equal(f.renders.at(-1).status, 'loading');
  f.requests[0].reject(new Error('network error'));
  await pending;
  assert.equal(f.state.commentsStatus, 'error');
  assert.equal(f.renders.at(-1).status, 'error');
  assert.equal(f.state.comments.length, 0);
});

test('an explicit retry can succeed empty without retaining the earlier error', async () => {
  const f = fixture();
  const initial = f.load();
  f.requests[0].reject(new Error('timeout'));
  await initial;
  const retry = f.load();
  f.requests[1].resolve({ comments: [] });
  await retry;
  assert.equal(f.state.commentsStatus, 'ready');
  assert.equal(f.renders.at(-1).status, 'ready');
});

test('older same-post errors cannot replace newer successful comments', async () => {
  const f = fixture();
  const old = f.load();
  const current = f.load();
  f.requests[1].resolve({ comments: [{ id: 2, contentMarkdown: 'new' }] });
  await current;
  const count = f.renders.length;
  f.requests[0].reject(new Error('old failure'));
  await old;
  assert.equal(f.state.commentsStatus, 'ready');
  assert.equal(f.state.comments[0].id, 2);
  assert.equal(f.renders.length, count);
});

for (const change of ['owner', 'post']) {
  test(`a stale ${change} response cannot change current comments or their error state`, async () => {
    const f = fixture();
    const pending = f.load();
    if (change === 'owner') f.state.sessionVersion += 1;
    else {
      f.state.activePostId = 'P2';
      f.state.postRequestId += 1;
    }
    f.state.commentsStatus = 'ready';
    const count = f.renders.length;
    f.requests[0].reject(new Error('late failure'));
    await pending;
    assert.equal(f.state.commentsStatus, 'ready');
    assert.equal(f.renders.length, count);
  });
}

test('polling already visible comments does not replace the list with a loading placeholder', async () => {
  const f = fixture();
  f.state.comments = [{ id: 1 }];
  const pending = f.load();
  assert.equal(f.renders.length, 0);
  f.requests[0].resolve({ comments: [{ id: 1 }, { id: 2 }] });
  await pending;
  assert.equal(f.renders.length, 1);
  assert.equal(f.state.comments.length, 2);
});
