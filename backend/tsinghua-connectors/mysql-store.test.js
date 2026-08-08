const assert = require('node:assert/strict');
const test = require('node:test');
const { createMysqlCampusConnectorStore } = require('./mysql-store');

function compactSql(statement) {
  return statement.replace(/\s+/gu, ' ').trim();
}

function createTransactionalPool(handler) {
  const calls = [];
  const state = { begins: 0, commits: 0, releases: 0, rollbacks: 0 };
  const connection = {
    async beginTransaction() {
      state.begins += 1;
    },
    async commit() {
      state.commits += 1;
    },
    async execute(statement, parameters = []) {
      const sql = compactSql(statement);
      calls.push({ parameters, sql });
      return (await handler(sql, parameters)) || [{ affectedRows: 1 }, []];
    },
    release() {
      state.releases += 1;
    },
    async rollback() {
      state.rollbacks += 1;
    },
  };

  return {
    calls,
    state,
    async execute() {
      return [[], []];
    },
    async getConnection() {
      return connection;
    },
  };
}

function completionInput(userId = 7) {
  return {
    flow: { user_id: userId },
    stateHash: Buffer.alloc(32, 1),
    provider: 'tsinghua-learn',
    adapterId: 'fixture-adapter',
    adapterVersion: 'v1',
    identityFingerprint: Buffer.alloc(32, 2),
    encryptedGrant: {
      ciphertext: Buffer.from('encrypted-grant'),
      iv: Buffer.alloc(12, 3),
      authTag: Buffer.alloc(16, 4),
    },
    scopes: ['courses'],
    credentialType: 'broker_handle',
    credentialExpiresAt: new Date('2026-08-02T12:00:00.000Z'),
    completedAt: new Date('2026-08-02T08:00:00.000Z'),
  };
}

function directCompletionInput(userId = 7) {
  const input = completionInput(userId);
  return {
    userId,
    provider: input.provider,
    adapterId: 'tsinghua_direct_cas',
    adapterVersion: input.adapterVersion,
    identityFingerprint: input.identityFingerprint,
    encryptedGrant: input.encryptedGrant,
    scopes: ['semesters', 'courses'],
    credentialType: 'encrypted_cookie_jar',
    credentialExpiresAt: null,
    completedAt: input.completedAt,
  };
}

function flowRowSql(sql) {
  return sql.startsWith('SELECT status, user_id FROM campus_connector_auth_flows');
}

function identityOwnerSql(sql) {
  return sql.startsWith('SELECT id, user_id FROM user_campus_connectors');
}

function userConnectorSql(sql) {
  return sql.startsWith('SELECT id FROM user_campus_connectors');
}

test('rejects an identity owned by another FREE BBS user without mutating that row', async () => {
  const pool = createTransactionalPool(async (sql) => {
    if (flowRowSql(sql)) return [[{ status: 'callback_received', user_id: 7 }], []];
    if (identityOwnerSql(sql)) return [[{ id: 91, user_id: 8 }], []];
    return [{ affectedRows: 1 }, []];
  });
  const store = createMysqlCampusConnectorStore(pool);

  await assert.rejects(
    store.completeAuthorization(completionInput()),
    (error) => error.code === 'connector_identity_already_bound' && error.status === 409,
  );

  assert.deepEqual(pool.state, { begins: 1, commits: 0, releases: 1, rollbacks: 1 });
  assert.equal(
    pool.calls.some(({ sql }) => /^(INSERT INTO|UPDATE) user_campus_connectors/u.test(sql)),
    false,
  );
  assert.equal(
    pool.calls.some(({ sql }) => sql.startsWith('UPDATE campus_connector_auth_flows')),
    false,
  );
});

test('re-authorizing the same user updates only the explicitly locked connector row', async () => {
  const pool = createTransactionalPool(async (sql) => {
    if (flowRowSql(sql)) return [[{ status: 'callback_received', user_id: 7 }], []];
    if (identityOwnerSql(sql)) return [[{ id: 41, user_id: 7 }], []];
    if (userConnectorSql(sql)) return [[{ id: 41 }], []];
    return [{ affectedRows: 1 }, []];
  });
  const store = createMysqlCampusConnectorStore(pool);

  await store.completeAuthorization(completionInput());

  assert.deepEqual(pool.state, { begins: 1, commits: 1, releases: 1, rollbacks: 0 });
  const connectorUpdate = pool.calls.find(({ sql }) =>
    sql.startsWith('UPDATE user_campus_connectors'),
  );
  assert.ok(connectorUpdate);
  assert.match(connectorUpdate.sql, /WHERE id = \? AND user_id = \? AND provider = \?$/u);
  assert.deepEqual(connectorUpdate.parameters.slice(-3), [41, 7, 'tsinghua-learn']);
  assert.equal(
    pool.calls.some(({ sql }) => /ON DUPLICATE KEY UPDATE/u.test(sql)),
    false,
  );
});

test('a new binding uses a plain insert so concurrent identity conflicts fail closed', async () => {
  const pool = createTransactionalPool(async (sql) => {
    if (flowRowSql(sql)) return [[{ status: 'callback_received', user_id: 7 }], []];
    if (identityOwnerSql(sql) || userConnectorSql(sql)) return [[], []];
    return [{ affectedRows: 1 }, []];
  });
  const store = createMysqlCampusConnectorStore(pool);

  await store.completeAuthorization(completionInput());

  const insert = pool.calls.find(({ sql }) => sql.startsWith('INSERT INTO user_campus_connectors'));
  assert.ok(insert);
  assert.doesNotMatch(insert.sql, /ON DUPLICATE KEY UPDATE/u);
  assert.deepEqual(pool.state, { begins: 1, commits: 1, releases: 1, rollbacks: 0 });
});

test('a uniqueness race during insert is returned as an explicit binding conflict', async () => {
  const pool = createTransactionalPool(async (sql) => {
    if (flowRowSql(sql)) return [[{ status: 'callback_received', user_id: 7 }], []];
    if (identityOwnerSql(sql) || userConnectorSql(sql)) return [[], []];
    if (sql.startsWith('INSERT INTO user_campus_connectors')) {
      const error = new Error('duplicate identity');
      error.code = 'ER_DUP_ENTRY';
      throw error;
    }
    return [{ affectedRows: 1 }, []];
  });
  const store = createMysqlCampusConnectorStore(pool);

  await assert.rejects(
    store.completeAuthorization(completionInput()),
    (error) => error.code === 'connector_identity_already_bound' && error.status === 409,
  );
  assert.deepEqual(pool.state, { begins: 1, commits: 0, releases: 1, rollbacks: 1 });
});

test('database lock conflicts fail closed with a retryable authorization conflict', async (t) => {
  for (const code of ['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']) {
    await t.test(code, async () => {
      const pool = createTransactionalPool(async (sql) => {
        if (flowRowSql(sql)) return [[{ status: 'callback_received', user_id: 7 }], []];
        if (identityOwnerSql(sql) || userConnectorSql(sql)) return [[], []];
        if (sql.startsWith('INSERT INTO user_campus_connectors')) {
          const error = new Error('database lock conflict');
          error.code = code;
          throw error;
        }
        return [{ affectedRows: 1 }, []];
      });
      const store = createMysqlCampusConnectorStore(pool);

      await assert.rejects(
        store.completeAuthorization(completionInput()),
        (error) => error.code === 'authorization_conflict' && error.status === 409,
      );
      assert.deepEqual(pool.state, { begins: 1, commits: 0, releases: 1, rollbacks: 1 });
    });
  }
});

test('direct connection inserts an unverified encrypted session without an auth flow', async () => {
  const pool = createTransactionalPool(async (sql) => {
    if (identityOwnerSql(sql) || userConnectorSql(sql)) return [[], []];
    return [{ affectedRows: 1 }, []];
  });
  const store = createMysqlCampusConnectorStore(pool);

  await store.completeDirectConnection(directCompletionInput());

  const insert = pool.calls.find(({ sql }) => sql.startsWith('INSERT INTO user_campus_connectors'));
  assert.ok(insert);
  assert.match(insert.sql, /'active_unverified'/u);
  assert.doesNotMatch(insert.sql, /ON DUPLICATE KEY UPDATE/u);
  assert.equal(
    pool.calls.some(({ sql }) =>
      sql.startsWith('SELECT status, user_id FROM campus_connector_auth_flows'),
    ),
    false,
  );
  assert.equal(
    pool.calls.some(({ sql }) => sql.startsWith('UPDATE campus_connector_auth_flows')),
    true,
  );
  assert.deepEqual(pool.state, { begins: 1, commits: 1, releases: 1, rollbacks: 0 });
});

test('direct connection rejects an identity already bound to another user', async () => {
  const pool = createTransactionalPool(async (sql) => {
    if (identityOwnerSql(sql)) return [[{ id: 91, user_id: 8 }], []];
    return [{ affectedRows: 1 }, []];
  });
  const store = createMysqlCampusConnectorStore(pool);

  await assert.rejects(
    store.completeDirectConnection(directCompletionInput()),
    (error) => error.code === 'connector_identity_already_bound' && error.status === 409,
  );
  assert.equal(
    pool.calls.some(({ sql }) => /^(INSERT INTO|UPDATE) user_campus_connectors/u.test(sql)),
    false,
  );
  assert.deepEqual(pool.state, { begins: 1, commits: 0, releases: 1, rollbacks: 1 });
});

test('natural expiry is a transactional generation-fenced credential purge', async () => {
  const pool = createTransactionalPool(async (sql) => {
    if (sql.startsWith('SELECT id, generation FROM user_campus_connectors')) {
      return [[{ id: 41, generation: 3 }], []];
    }
    return [{ affectedRows: 1 }, []];
  });
  const store = createMysqlCampusConnectorStore(pool);
  const expiredAt = new Date('2026-08-02T12:00:00.000Z');

  assert.equal(
    await store.expireConnection({
      userId: 7,
      provider: 'tsinghua-learn',
      expectedGeneration: 3,
      expiredAt,
    }),
    true,
  );

  const connectorUpdate = pool.calls.find(({ sql }) =>
    sql.startsWith('UPDATE user_campus_connectors'),
  );
  assert.ok(connectorUpdate);
  assert.match(connectorUpdate.sql, /status = 'reauthorization_required'/u);
  assert.match(connectorUpdate.sql, /generation = generation \+ 1/u);
  assert.match(connectorUpdate.sql, /identity_fingerprint = NULL, granted_scopes = NULL/u);
  assert.match(connectorUpdate.sql, /credential_ciphertext = NULL/u);
  assert.match(connectorUpdate.sql, /last_successful_sync_at = NULL/u);
  assert.deepEqual(connectorUpdate.parameters, [expiredAt, 41, 3]);
  const runUpdate = pool.calls.find(({ sql }) =>
    sql.startsWith('UPDATE campus_connector_sync_runs'),
  );
  assert.ok(runUpdate);
  assert.match(runUpdate.sql, /status = 'cancelled'/u);
  assert.deepEqual(runUpdate.parameters, [expiredAt, expiredAt, 41]);
  assert.deepEqual(pool.state, { begins: 1, commits: 1, releases: 1, rollbacks: 0 });
});

test('natural expiry is idempotent when the generation no longer matches', async () => {
  const pool = createTransactionalPool(async (sql) => {
    if (sql.startsWith('SELECT id, generation FROM user_campus_connectors')) return [[], []];
    return [{ affectedRows: 1 }, []];
  });
  const store = createMysqlCampusConnectorStore(pool);

  assert.equal(
    await store.expireConnection({
      userId: 7,
      provider: 'tsinghua-learn',
      expectedGeneration: 3,
      expiredAt: new Date('2026-08-02T12:00:00.000Z'),
    }),
    false,
  );
  assert.equal(
    pool.calls.some(({ sql }) => sql.startsWith('UPDATE ')),
    false,
  );
  assert.deepEqual(pool.state, { begins: 1, commits: 1, releases: 1, rollbacks: 0 });
});

test('latest sync run parses aggregate diagnostics from error_context', async () => {
  let observedSql = '';
  const store = createMysqlCampusConnectorStore({
    async execute(statement) {
      observedSql = compactSql(statement);
      return [
        [
          {
            public_id: 'csr_partial',
            status: 'partial',
            result_counts: '{"notifications":16}',
            evidence_json: '{"requestCount":22}',
            error_context:
              '{"version":1,"warnings":[{"resource":"homework:unsubmitted","code":"parser_record_rejected","count":2}],"errors":[]}',
          },
        ],
        [],
      ];
    },
  });

  const run = await store.getLatestSyncRun(7, 'tsinghua-learn');

  assert.match(observedSql, /r\.error_context/u);
  assert.deepEqual(run.result_counts, { notifications: 16 });
  assert.equal(run.evidence_json.requestCount, 22);
  assert.equal(run.error_context.warnings[0].count, 2);
});
