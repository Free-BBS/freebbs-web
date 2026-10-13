const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/knowledge.js'), 'utf8');
const start = source.indexOf('  function readInteractionPreferences(');
const end = source.indexOf('  function getDiscussionBoardSlug(', start);
assert.ok(start > 0 && end > start);
const key = 'free_bbs_knowledge_interaction_preferences_v1';

function harness({ storage = new Map(), blocked = false, width = 1440 } = {}) {
  const writes = [];
  const calls = [];
  const state = { chatOpen: true, chatTab: 'max', chatMessages: ['private dialogue'] };
  const context = vm.createContext({
    state,
    window: { innerWidth: width },
    INTERACTION_PREFERENCES_STORAGE_KEY: key,
    localStorage: {
      getItem(name) {
        if (blocked) throw new Error('SecurityError');
        return storage.get(name) ?? null;
      },
      setItem(name, value) {
        if (blocked) throw new Error('QuotaExceededError');
        writes.push([name, value]);
        storage.set(name, value);
      },
    },
    setChatTab(tab, options) {
      state.chatTab = tab;
      calls.push({ action: 'tab', ...options });
    },
    setChatOpen(open, options) {
      state.chatOpen = open;
      calls.push({ action: 'open', ...options });
    },
  });
  vm.runInContext(source.slice(start, end), context);
  return { context, state, storage, writes, calls };
}

test('first desktop visit keeps the open-Max default without writing preferences', () => {
  const fixture = harness();
  fixture.context.restoreInteractionPreferences();
  assert.equal(fixture.state.chatOpen, true);
  assert.equal(fixture.state.chatTab, 'max');
  assert.equal(fixture.writes.length, 0);
  assert.deepEqual(fixture.calls, [
    { action: 'tab', persist: false },
    { action: 'open', focus: false, persist: false },
  ]);
});

test('first narrow visit keeps reading unobstructed without saving a forced choice', () => {
  for (const width of [320, 390, 910, 920]) {
    const fixture = harness({ width });
    fixture.context.restoreInteractionPreferences();
    assert.equal(fixture.state.chatOpen, false, `width ${width}`);
    assert.equal(fixture.state.chatTab, 'max');
    assert.equal(fixture.writes.length, 0);
  }
  const wide = harness({ width: 921 });
  wide.context.restoreInteractionPreferences();
  assert.equal(wide.state.chatOpen, true);
});

test('an explicit narrow-screen open preference takes priority over the initial default', () => {
  const storage = new Map([[key, '{"open":true,"tab":"max"}']]);
  const fixture = harness({ storage, width: 390 });
  fixture.context.restoreInteractionPreferences();
  assert.equal(fixture.state.chatOpen, true);
  assert.equal(fixture.writes.length, 0);
  const blocked = harness({ width: 390, blocked: true });
  blocked.context.restoreInteractionPreferences();
  assert.equal(blocked.state.chatOpen, false);
});

test('closed discussion layout is restored across knowledge points and courses', () => {
  const fixture = harness();
  Object.assign(fixture.state, { chatOpen: false, chatTab: 'discussion' });
  fixture.context.persistInteractionPreferences();
  const next = harness({ storage: fixture.storage });
  next.context.restoreInteractionPreferences();
  assert.equal(next.state.chatOpen, false);
  assert.equal(next.state.chatTab, 'discussion');
  assert.deepEqual(JSON.parse(fixture.storage.get(key)), { open: false, tab: 'discussion' });
  assert.equal(fixture.storage.get(key).includes('private dialogue'), false);
});

test('reopening and switching back to Max replaces the old layout preference', () => {
  const fixture = harness({ storage: new Map([[key, '{"open":false,"tab":"discussion"}']]) });
  fixture.context.restoreInteractionPreferences();
  Object.assign(fixture.state, { chatOpen: true, chatTab: 'max' });
  fixture.context.persistInteractionPreferences();
  const reloaded = harness({ storage: fixture.storage });
  reloaded.context.restoreInteractionPreferences();
  assert.equal(reloaded.state.chatOpen, true);
  assert.equal(reloaded.state.chatTab, 'max');
});

test('invalid values and blocked storage retain a usable default', () => {
  for (const value of ['broken', 'null', '[]', 'true', '{"open":"false","tab":"unknown"}']) {
    const fixture = harness({ storage: new Map([[key, value]]) });
    fixture.context.restoreInteractionPreferences();
    assert.equal(fixture.state.chatOpen, true, value);
    assert.equal(fixture.state.chatTab, 'max', value);
  }
  const blocked = harness({ blocked: true });
  assert.doesNotThrow(() => blocked.context.restoreInteractionPreferences());
  assert.doesNotThrow(() => blocked.context.persistInteractionPreferences());
});

test('page initialization restores the layout instead of forcing the companion open', () => {
  const initialize = source.slice(source.indexOf('  async function initialize('));
  assert.match(initialize, /restoreInteractionPreferences\(\)/);
  assert.doesNotMatch(initialize, /setChatOpen\(true/);
  assert.match(source, /function setChatOpen\(isOpen, \{ focus = true, persist = true \}/);
  assert.match(source, /function setChatTab\(rawTab, \{ persist = true \}/);
});
