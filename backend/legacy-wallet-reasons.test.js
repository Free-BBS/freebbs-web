const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const { walletLedgerCheckpoint, annotateWalletLedger } = require('./wallet-ledger');

const source = fs.readFileSync(require.resolve('./server'), 'utf8');
function fragment(start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, `Cannot find ${start}`);
  return source.slice(first, last);
}

// Executes the production route bodies and ledger helpers. Only the SQL transport is simulated.
function harness({ authorized = true, failAnnotation = false } = {}) {
  let state = {
    users: {
      8: { id: 8, username: 'student', electrons: 20, manetrons: 30, heat: 2 },
    },
    ledger: [{ id: '1', user_id: 8, source_key: null, title: null, reason: null }],
  };
  let backup;
  const events = [];
  const recordBalance = (userId, oldElectric, oldMagnetic) => {
    const current = state.users[userId];
    if (current.electrons === oldElectric && current.manetrons === oldMagnetic) return;
    state.ledger.push({
      id: String(state.ledger.length + 1),
      user_id: userId,
      source_key: null,
      electric_before: oldElectric,
      electric_after: current.electrons,
      magnetic_before: oldMagnetic,
      magnetic_after: current.manetrons,
    });
  };
  const connection = {
    async beginTransaction() {
      backup = structuredClone(state);
      events.push('begin');
    },
    async commit() {
      events.push('commit');
    },
    async rollback() {
      state = backup;
      events.push('rollback');
    },
    release() {
      events.push('release');
    },
    async execute(sql, args) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.startsWith('SELECT id FROM users')) {
        assert.match(normalized, /FOR UPDATE/);
        events.push('lock');
        return [[{ ...state.users[args[0]] }]];
      }
      if (normalized.startsWith('SELECT CAST(id AS CHAR) AS id FROM wallet_ledger')) {
        assert.ok(events.includes('lock'));
        assert.match(normalized, /FOR UPDATE/);
        const rows = state.ledger.filter((row) => row.user_id === args[0]);
        return [rows.slice(-1).map((row) => ({ id: row.id }))];
      }
      if (normalized.startsWith('UPDATE wallet_ledger')) {
        if (failAnnotation) throw new Error('ledger annotation failed');
        const rows = state.ledger.filter(
          (row) => row.user_id === args[3] && BigInt(row.id) > BigInt(args[4]) && !row.source_key,
        );
        for (const row of rows) {
          Object.assign(row, { source_key: args[0], title: args[1], reason: args[2] });
        }
        events.push('annotate');
        return [{ affectedRows: rows.length }];
      }
      if (normalized.startsWith('INSERT INTO users')) {
        state.users[9] = {
          id: 9,
          username: args[1],
          electrons: args[8],
          manetrons: args[9],
          heat: args[10],
        };
        recordBalance(9, 0, 0);
        return [{ insertId: 9, affectedRows: 1 }];
      }
      if (normalized.startsWith('UPDATE users SET uid')) {
        const id = args[7];
        const user = state.users[id];
        const oldElectric = user.electrons;
        const oldMagnetic = user.manetrons;
        Object.assign(user, { electrons: args[4], manetrons: args[5], heat: args[6] });
        recordBalance(id, oldElectric, oldMagnetic);
        return [{ affectedRows: 1 }];
      }
      if (/^UPDATE users SET (electrons|manetrons) = .* - 1,/.test(normalized)) {
        const column = normalized.includes('SET electrons') ? 'electrons' : 'manetrons';
        const id = args[0];
        const user = state.users[id];
        if (user[column] < 1) return [{ affectedRows: 0 }];
        const oldElectric = user.electrons;
        const oldMagnetic = user.manetrons;
        user[column] -= 1;
        user.heat += 1;
        recordBalance(id, oldElectric, oldMagnetic);
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const routes = new Map();
  const auth = (user) => async (_request, response) => {
    if (authorized) return user;
    response.status(403).json({ message: '请登录' });
    return null;
  };
  const context = vm.createContext({
    app: {
      post: (route, handler) => routes.set(route, handler),
      patch: (route, handler) => routes.set(route, handler),
    },
    pool: { getConnection: async () => connection },
    crypto,
    walletLedgerCheckpoint,
    annotateWalletLedger,
    requireAuth: auth({ id: 8 }),
    requireAdmin: auth({ id: 7, username: 'NotingSr' }),
    normalizeCurrencyType: (value) => value,
    currencyColumn: (value) => (value === 'electric' ? 'electrons' : 'manetrons'),
    decayHeatIfNeeded: async () => {},
    getUserById: async (id) => ({ ...state.users[id] }),
    toUserProfile: (user) => user,
    isValidUsername: (value) => /^[A-Za-z0-9_]{3,64}$/.test(value),
    USERNAME_MESSAGE: 'invalid username',
    USER_ROLES: new Set(['student', 'admin']),
    createUniqueUserUid: async () => 'u_new',
    hashPassword: () => 'hashed-test-password',
    normalizeResponsibilitySlugs: () => [],
    ensureDiscussionTables: async () => {},
    ensureCourseMapTables: async () => {},
    lockAndValidateRoleChange: async (_connection, _admin, id) => {
      assert.ok(events.includes('begin'));
      events.push('lock');
      return { ...state.users[id] };
    },
    replaceUserResponsibilities: async () => {},
    sendAdminUserUpdateError: (response, error) =>
      response.status(500).json({ message: error.message }),
  });
  vm.runInContext(
    fragment('async function withDatabaseTransaction(', 'async function sendVerificationCode('),
    context,
  );
  for (const [start, end] of [
    ["app.post('/api/electromagnetic/heat',", 'async function purchaseShopItem('],
    ["app.post('/api/admin/users',", "app.patch('/api/admin/users/:id',"],
    ["app.patch('/api/admin/users/:id',", "app.patch('/api/admin/users/:id/role',"],
  ]) {
    vm.runInContext(fragment(start, end), context);
  }
  return {
    state: () => state,
    events,
    async call(route, body) {
      const response = {
        code: 200,
        status(code) {
          this.code = code;
          return this;
        },
        json(payload) {
          this.body = payload;
        },
      };
      await routes.get(route)({ body, params: { id: '8' } }, response);
      return response;
    },
  };
}

for (const [currency, column, label] of [
  ['electric', 'electrons', '电元'],
  ['magnetic', 'manetrons', '磁元'],
]) {
  test(`legacy heat exchange explains its ${currency} debit and preserves older ledger rows`, async () => {
    const f = harness();
    const initial = f.state().users[8][column];
    const result = await f.call('/api/electromagnetic/heat', { currency });
    assert.equal(result.code, 200);
    assert.equal(f.state().users[8][column], initial - 1);
    assert.equal(f.state().users[8].heat, 3);
    assert.equal(f.state().ledger[0].reason, null);
    assert.match(f.state().ledger[1].source_key, /^heat-exchange:/);
    assert.equal(f.state().ledger[1].reason, `花费 1 ${label}，获得 1 热力`);
    assert.ok(f.events.indexOf('annotate') < f.events.indexOf('commit'));
  });
}

test('heat exchange cannot charge or overwrite an old reason when the balance is empty', async () => {
  const f = harness();
  f.state().users[8].electrons = 0;
  assert.equal((await f.call('/api/electromagnetic/heat', { currency: 'electric' })).code, 400);
  assert.equal(f.state().users[8].heat, 2);
  assert.equal(f.state().ledger.length, 1);
  assert.ok(!f.events.includes('annotate'));
});

const createUser = {
  username: 'new_student',
  fullName: '新同学',
  studentId: '2026010001',
  email: 'student@example.test',
  password: 'test-password',
  role: 'student',
};
const editUser = { fullName: '同学', role: 'student', electrons: 18, manetrons: 42, heat: 2 };

test('admin creation describes a single initial balance entry; zero balances create no entry', async () => {
  for (const [electric, magnetic] of [
    [5, 9],
    [0, 0],
  ]) {
    const f = harness();
    const response = await f.call('/api/admin/users', {
      ...createUser,
      electrons: electric,
      manetrons: magnetic,
    });
    assert.equal(response.code, 201);
    const entries = f.state().ledger.filter((row) => row.user_id === 9);
    assert.equal(entries.length, electric || magnetic ? 1 : 0);
    if (entries.length) {
      assert.equal(entries[0].title, '账户初始余额');
      assert.match(entries[0].reason, /NotingSr.*5 电元、9 磁元/);
      assert.match(entries[0].source_key, /^admin-create:/);
    }
  }
});

test('admin edits explain both balances once and repeat saves do not create empty entries', async () => {
  const f = harness();
  assert.equal((await f.call('/api/admin/users/:id', editUser)).code, 200);
  assert.equal(f.state().ledger.length, 2);
  const row = f.state().ledger[1];
  assert.equal(row.title, '管理员调整余额');
  assert.match(row.reason, /NotingSr.*20 电元、30 磁元.*18 电元、42 磁元/);
  assert.equal(row.electric_after, 18);
  assert.equal(row.magnetic_after, 42);
  assert.equal((await f.call('/api/admin/users/:id', editUser)).code, 200);
  assert.equal(f.state().ledger.length, 2);
});

for (const [route, body] of [
  ['/api/electromagnetic/heat', { currency: 'electric' }],
  ['/api/admin/users', { ...createUser, electrons: 5, manetrons: 9 }],
  ['/api/admin/users/:id', editUser],
]) {
  test(`${route} rolls back all balance and account changes if the ledger reason fails`, async () => {
    const f = harness({ failAnnotation: true });
    const initial = structuredClone(f.state());
    const response = await f.call(route, body);
    assert.equal(response.code, 500);
    assert.deepEqual(f.state(), initial);
    assert.ok(f.events.includes('rollback'));
    assert.ok(!f.events.includes('commit'));
  });
  test(`${route} authenticates before changing balance or ledger`, async () => {
    const f = harness({ authorized: false });
    assert.equal((await f.call(route, body)).code, 403);
    assert.equal(f.events.length, 0);
  });
}
