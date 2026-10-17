const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../public/notifications'), 'utf8');
const start = source.indexOf('  async function refreshCount()');
const end = source.indexOf('  function removeSelectedUser(', start);
assert.ok(start >= 0 && end > start);

test('an open inbox refreshes a changed waiting notice even when the unread count is unchanged', async () => {
  for (const hidden of [false, true]) {
    const state = { unreadCount: 0, sessionVersion: 1 };
    let inboxRefreshes = 0;
    let countUpdates = 0;
    const context = {
      state,
      canLoad: () => true,
      document: { hidden: false },
      panel: { hidden },
      message: {},
      widget: {},
      api: async (path) => {
        assert.equal(path, '/notifications/unread-count');
        return { unreadCount: 0 };
      },
      updateCount: () => {
        countUpdates += 1;
      },
      loadInbox: async () => {
        inboxRefreshes += 1;
      },
    };
    vm.runInNewContext(source.slice(start, end), context);
    await context.refreshCount();
    assert.equal(countUpdates, 1);
    assert.equal(inboxRefreshes, hidden ? 0 : 1);
  }
});

test('a stale account count response cannot refresh or restore the previous inbox', async () => {
  const state = { unreadCount: 0, sessionVersion: 1 };
  let inboxRefreshes = 0;
  const context = {
    state,
    canLoad: () => true,
    document: { hidden: false },
    panel: { hidden: false },
    message: {},
    widget: {},
    api: async () => {
      state.sessionVersion += 1;
      return { unreadCount: 0 };
    },
    updateCount: () => {
      throw new Error('stale count');
    },
    loadInbox: async () => {
      inboxRefreshes += 1;
    },
  };
  vm.runInNewContext(source.slice(start, end), context);
  await context.refreshCount();
  assert.equal(inboxRefreshes, 0);
});
