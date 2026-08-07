const assert = require('node:assert/strict');
const test = require('node:test');
const { createTsinghuaSyncStore } = require('./sync-store');

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
    async getConnection() {
      return connection;
    },
  };
}

function claimedRun() {
  return {
    public_id: 'csr_run',
    connector_id: 41,
    connector_generation: 3,
    user_id: 7,
    provider: 'tsinghua-learn',
  };
}

function queuedRow(overrides = {}) {
  return {
    run_id: 11,
    public_id: 'csr_run',
    connector_id: 41,
    connector_generation: 3,
    requested_by_user_id: 7,
    run_status: 'queued',
    user_id: 7,
    provider: 'tsinghua-learn',
    connector_status: 'active_verified',
    generation: 3,
    adapter_id: 'tsinghua_direct_cas',
    adapter_version: 'direct-cas-v1',
    credential_ciphertext: Buffer.from('ciphertext'),
    credential_iv: Buffer.alloc(12),
    credential_auth_tag: Buffer.alloc(16),
    credential_expires_at: null,
    ...overrides,
  };
}

function runningRow(overrides = {}) {
  return {
    run_id: 11,
    run_status: 'running',
    connector_generation: 3,
    connector_status: 'active_verified',
    generation: 3,
    user_id: 7,
    ...overrides,
  };
}

test('claimRun atomically records the attempt and heartbeat', async () => {
  const startedAt = new Date('2026-08-02T08:00:00.000Z');
  const row = queuedRow();
  const pool = createTransactionalPool(async (sql) => {
    if (sql.startsWith('SELECT r.id AS run_id')) return [[row], []];
    return [{ affectedRows: 1 }, []];
  });
  const store = createTsinghuaSyncStore(pool);

  assert.equal(await store.claimRun('csr_run', startedAt), row);

  const runUpdate = pool.calls.find(
    ({ sql }) =>
      sql.startsWith('UPDATE campus_connector_sync_runs') && sql.includes("status = 'running'"),
  );
  assert.ok(runUpdate);
  assert.match(runUpdate.sql, /heartbeat_at = \?/u);
  assert.match(runUpdate.sql, /attempt_count = attempt_count \+ 1/u);
  assert.deepEqual(runUpdate.parameters, [startedAt, startedAt, 11]);
  assert.deepEqual(pool.state, { begins: 1, commits: 1, releases: 1, rollbacks: 0 });
});

test('claimRun fails an expired credential and atomically requests authorization', async () => {
  const startedAt = new Date('2026-08-02T08:00:00.000Z');
  const pool = createTransactionalPool(async (sql) => {
    if (sql.startsWith('SELECT r.id AS run_id')) {
      return [[queuedRow({ credential_expires_at: startedAt })], []];
    }
    return [{ affectedRows: 1 }, []];
  });
  const store = createTsinghuaSyncStore(pool);

  assert.equal(await store.claimRun('csr_run', startedAt), null);

  const runUpdate = pool.calls.find(({ sql }) =>
    sql.startsWith('UPDATE campus_connector_sync_runs'),
  );
  assert.match(runUpdate.sql, /status = 'failed'/u);
  assert.match(runUpdate.sql, /error_code = 'authorization_required'/u);
  const connectorUpdate = pool.calls.find(({ sql }) =>
    sql.startsWith('UPDATE user_campus_connectors'),
  );
  assert.match(connectorUpdate.sql, /status = 'reauthorization_required'/u);
  assert.deepEqual(connectorUpdate.parameters, [startedAt, 41, 3]);
  assert.deepEqual(pool.state, { begins: 1, commits: 1, releases: 1, rollbacks: 0 });
});

test('claimRun cancels a queued run whose connection generation changed', async () => {
  const startedAt = new Date('2026-08-02T08:00:00.000Z');
  const pool = createTransactionalPool(async (sql) => {
    if (sql.startsWith('SELECT r.id AS run_id')) {
      return [[queuedRow({ generation: 4 })], []];
    }
    return [{ affectedRows: 1 }, []];
  });
  const store = createTsinghuaSyncStore(pool);

  assert.equal(await store.claimRun('csr_run', startedAt), null);

  const runUpdate = pool.calls.find(({ sql }) =>
    sql.startsWith('UPDATE campus_connector_sync_runs'),
  );
  assert.match(runUpdate.sql, /status = 'cancelled'/u);
  assert.match(runUpdate.sql, /error_code = 'connection_changed'/u);
  assert.equal(
    pool.calls.some(({ sql }) => sql.startsWith('UPDATE user_campus_connectors')),
    false,
  );
});

test('a complete snapshot reconciles untouched drafts and can revive auto-cancelled items', async () => {
  const finishedAt = new Date('2026-08-02T08:05:00.000Z');
  const pool = createTransactionalPool(async (sql) => {
    if (sql.startsWith('SELECT r.id AS run_id')) {
      return [[runningRow()], []];
    }
    return [{ affectedRows: 1 }, []];
  });
  const store = createTsinghuaSyncStore(pool);
  const snapshot = {
    status: 'succeeded',
    parserVersion: 'learn-v1',
    schemaVersion: 'snapshot-v1',
    evidence: { requestCount: 7 },
    importantItems: [
      {
        dedupeKey: 'homework:1',
        sourceReference: 'homework:1',
        title: '作业一',
        dueAt: '2026-08-03T08:00:00.000Z',
      },
      {
        dedupeKey: 'homework:1',
        sourceReference: 'homework:1',
        title: '重复项',
      },
    ],
    notifications: [],
  };

  assert.equal(await store.completeRun(claimedRun(), snapshot, finishedAt), true);

  const upsert = pool.calls.find(({ sql }) => sql.startsWith('INSERT INTO important_items'));
  assert.match(upsert.sql, /user_overridden_at IS NULL AND status = 'cancelled'.*'draft'/u);
  assert.match(upsert.sql, /deleted_at = IF\(user_overridden_at IS NULL, NULL, deleted_at\)/u);

  const reconciliation = pool.calls.find(({ sql }) =>
    sql.startsWith("UPDATE important_items SET status = 'cancelled'"),
  );
  assert.ok(reconciliation);
  assert.match(reconciliation.sql, /status = 'draft'/u);
  assert.match(reconciliation.sql, /user_overridden_at IS NULL/u);
  assert.match(reconciliation.sql, /dedupe_key IS NULL OR dedupe_key NOT IN \(\?\)/u);
  assert.deepEqual(reconciliation.parameters, [finishedAt, 7, 'homework:1']);

  assert.equal(
    pool.calls.some(({ sql }) => sql.startsWith('INSERT INTO campus_learn_semester_snapshots')),
    false,
  );

  const runUpdate = pool.calls.find(
    ({ sql }) =>
      sql.startsWith('UPDATE campus_connector_sync_runs') && sql.includes('schema_version = ?'),
  );
  assert.ok(runUpdate);
  assert.match(runUpdate.sql, /request_count = \?/u);
  assert.match(runUpdate.sql, /lease_expires_at = NULL, lease_owner = NULL/u);
  assert.deepEqual(runUpdate.parameters.slice(0, 4), ['succeeded', 'learn-v1', 'snapshot-v1', 7]);
});

test('completeRun stores normalized courses and notices by semester', async () => {
  const finishedAt = new Date('2026-08-02T08:05:00.000Z');
  const pool = createTransactionalPool(async (sql) => {
    if (sql.startsWith('SELECT r.id AS run_id')) return [[runningRow()], []];
    return [{ affectedRows: 1 }, []];
  });
  const store = createTsinghuaSyncStore(pool);
  await store.completeRun(
    claimedRun(),
    {
      status: 'complete',
      semesterId: '2026-2027-1',
      fetchedAt: finishedAt.toISOString(),
      courses: [{ sourceReference: 'course:a', title: '信号与系统' }],
      notifications: [
        {
          sourceReference: 'notice:a',
          courseReference: 'course:a',
          title: '[信号与系统] 第一讲',
        },
      ],
      importantItems: [],
    },
    finishedAt,
  );

  const upsert = pool.calls.find(({ sql }) =>
    sql.startsWith('INSERT INTO campus_learn_semester_snapshots'),
  );
  assert.ok(upsert);
  assert.equal(upsert.parameters[0], 7);
  assert.equal(upsert.parameters[1], '2026-2027-1');
  assert.equal(JSON.parse(upsert.parameters[2])[0].title, '信号与系统');
  assert.equal(JSON.parse(upsert.parameters[3])[0].courseReference, 'course:a');
});

test('a partial snapshot never cancels items omitted from that snapshot', async () => {
  const finishedAt = new Date('2026-08-02T08:05:00.000Z');
  const pool = createTransactionalPool(async (sql) => {
    if (sql.startsWith('SELECT r.id AS run_id')) {
      return [[runningRow()], []];
    }
    return [{ affectedRows: 1 }, []];
  });
  const store = createTsinghuaSyncStore(pool);

  await store.completeRun(
    claimedRun(),
    { status: 'partial', importantItems: [], notifications: [] },
    finishedAt,
  );

  assert.equal(
    pool.calls.some(({ sql }) => sql.startsWith("UPDATE important_items SET status = 'cancelled'")),
    false,
  );
});

test('completeRun fences a stale run generation before writing imported rows', async () => {
  const finishedAt = new Date('2026-08-02T08:05:00.000Z');
  const pool = createTransactionalPool(async (sql) => {
    if (sql.startsWith('SELECT r.id AS run_id')) {
      return [[runningRow({ connector_generation: 4 })], []];
    }
    return [{ affectedRows: 1 }, []];
  });
  const store = createTsinghuaSyncStore(pool);

  assert.equal(
    await store.completeRun(
      claimedRun(),
      { status: 'succeeded', importantItems: [], notifications: [] },
      finishedAt,
    ),
    false,
  );

  assert.ok(
    pool.calls.some(
      ({ sql }) => sql.includes("status = 'cancelled'") && sql.includes('connection_changed'),
    ),
  );
  assert.equal(
    pool.calls.some(({ sql }) => sql.startsWith('INSERT INTO notifications')),
    false,
  );
  assert.equal(
    pool.calls.some(({ sql }) => sql.startsWith('INSERT INTO important_items')),
    false,
  );
});

test('authorization failures update both a matching run and its connector', async () => {
  const failedAt = new Date('2026-08-02T08:05:00.000Z');
  const pool = createTransactionalPool(async (sql) => {
    if (sql.startsWith('SELECT r.id AS run_id')) {
      return [[runningRow()], []];
    }
    return [{ affectedRows: 1 }, []];
  });
  const store = createTsinghuaSyncStore(pool);

  assert.equal(
    await store.failRun(claimedRun(), 'authorization_required', failedAt, {
      requiresAuthorization: true,
    }),
    true,
  );

  const runUpdate = pool.calls.find(({ sql }) =>
    sql.startsWith('UPDATE campus_connector_sync_runs'),
  );
  assert.match(runUpdate.sql, /status = 'failed'/u);
  assert.deepEqual(runUpdate.parameters, [failedAt, failedAt, 'authorization_required', 11]);

  const connectorUpdate = pool.calls.find(({ sql }) =>
    sql.startsWith('UPDATE user_campus_connectors'),
  );
  assert.deepEqual(connectorUpdate.parameters, [failedAt, 'authorization_required', 41, 3]);
  assert.match(connectorUpdate.sql, /status IN \('active_unverified', 'active_verified'\)/u);
});

test('failRun cancels instead of poisoning a replacement connection generation', async () => {
  const failedAt = new Date('2026-08-02T08:05:00.000Z');
  const pool = createTransactionalPool(async (sql) => {
    if (sql.startsWith('SELECT r.id AS run_id')) {
      return [[runningRow({ generation: 4 })], []];
    }
    return [{ affectedRows: 1 }, []];
  });
  const store = createTsinghuaSyncStore(pool);

  assert.equal(
    await store.failRun(claimedRun(), 'authorization_required', failedAt, {
      requiresAuthorization: true,
    }),
    false,
  );

  const runUpdate = pool.calls.find(({ sql }) =>
    sql.startsWith('UPDATE campus_connector_sync_runs'),
  );
  assert.match(runUpdate.sql, /status = 'cancelled'/u);
  assert.match(runUpdate.sql, /error_code = 'connection_changed'/u);
  assert.equal(
    pool.calls.some(({ sql }) => sql.startsWith('UPDATE user_campus_connectors')),
    false,
  );
});
