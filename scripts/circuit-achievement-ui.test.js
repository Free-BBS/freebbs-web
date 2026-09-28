const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/circuit-challenge.js'), 'utf8');

function harness({ unlocked = ['plate_circuit_master'], switchAccount = false } = {}) {
  const events = [];
  const balances = [];
  const nodes = new Map();
  const userState = { isLoggedIn: true, uid: 'u_reader', token: 'session-reader' };
  const context = vm.createContext({
    window: { dispatchEvent: (event) => events.push(event) },
    CustomEvent: class {
      constructor(type, init) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    state: { challenge: { id: 29, revision: 3 }, result: {}, busy: false, document: {} },
    app: {
      userState,
      async callApi(route, options) {
        assert.equal(route, '/circuit-challenges/29/submissions');
        assert.equal(JSON.parse(options.body).revision, 3);
        if (switchAccount) Object.assign(userState, { uid: 'u_other', token: 'session-other' });
        return {
          componentCount: 8,
          error: 0,
          rewards: { completion: 5 },
          unlocked,
          balance: { electrons: 10 },
        };
      },
      syncWallet: (balance, token) => balances.push({ balance, token }),
    },
    $(id) {
      if (!nodes.has(id)) nodes.set(id, {});
      return nodes.get(id);
    },
    updateControls() {},
    setStatus() {},
    async loadChallenges() {
      return undefined;
    },
    async loadLeaderboard() {
      return undefined;
    },
  });
  vm.runInContext(
    source.slice(
      source.indexOf('  function notifyAchievements('),
      source.indexOf('  async function loadChallenges('),
    ) +
      source.slice(
        source.indexOf('  async function submit('),
        source.indexOf('  function syncAdminSource('),
      ),
    context,
  );
  return { context, events, balances };
}

test('verified last-pass response dispatches award with the submitting account identity', async () => {
  const { context, events, balances } = harness();
  await context.submit();
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'freebbs:achievement-unlocked');
  assert.equal(events[0].detail.key, 'plate_circuit_master');
  assert.equal(events[0].detail.uid, 'u_reader');
  assert.equal(events[0].detail.token, 'session-reader');
  assert.equal(balances[0].token, 'session-reader');
  assert.equal(context.state.busy, false);
});

test('ordinary pass and stale account response cannot show a circuit achievement', async () => {
  for (const options of [{ unlocked: [] }, { switchAccount: true }]) {
    const { context, events, balances } = harness(options);
    await context.submit();
    assert.equal(events.length, 0);
    if (options.switchAccount) assert.equal(balances.length, 0);
    assert.equal(context.state.busy, false);
  }
});
