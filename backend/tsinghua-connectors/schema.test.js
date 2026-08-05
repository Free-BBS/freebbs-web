const assert = require('node:assert/strict');
const test = require('node:test');
const { ensureCampusConnectorTables } = require('./schema');

function compactSql(statement) {
  return statement.replace(/\s+/gu, ' ').trim();
}

function createFakePool({ columns = [], indexes = [] } = {}) {
  const existingColumns = new Set(columns);
  const existingIndexes = new Set(indexes);
  const calls = [];

  return {
    calls,
    async execute(statement, parameters = []) {
      const sql = compactSql(statement);
      calls.push({ sql, parameters });

      if (sql.includes('FROM information_schema.COLUMNS')) {
        const key = `${parameters[0]}.${parameters[1]}`;
        return [existingColumns.has(key) ? [{ present: 1 }] : [], []];
      }
      if (sql.includes('FROM information_schema.STATISTICS')) {
        const key = `${parameters[0]}.${parameters[1]}`;
        return [existingIndexes.has(key) ? [{ present: 1 }] : [], []];
      }
      return [{ affectedRows: 0 }, []];
    },
  };
}

function describeCall(call) {
  const createMatch = call.sql.match(/^CREATE TABLE IF NOT EXISTS ([a-z_]+)/u);
  if (createMatch) return `create:${createMatch[1]}`;

  if (call.sql.includes('FROM information_schema.COLUMNS')) {
    return `check-column:${call.parameters.join('.')}`;
  }
  if (call.sql.includes('FROM information_schema.STATISTICS')) {
    return `check-index:${call.parameters.join('.')}`;
  }
  if (call.sql.startsWith('ALTER TABLE notifications ADD COLUMN')) {
    return 'alter:notifications.dedupe_key';
  }
  if (call.sql.startsWith('ALTER TABLE notifications ADD UNIQUE KEY')) {
    return 'alter:notifications.uq_notifications_recipient_dedupe';
  }
  if (call.sql.startsWith('ALTER TABLE important_items ADD COLUMN')) {
    return 'alter:important_items.action_url';
  }
  return call.sql;
}

const CREATE_SEQUENCE = [
  'create:user_campus_connectors',
  'create:campus_connector_auth_flows',
  'create:campus_connector_sync_runs',
];

test('does not ALTER core tables when every additive field and index already exists', async () => {
  const pool = createFakePool({
    columns: ['notifications.dedupe_key', 'important_items.action_url'],
    indexes: ['notifications.uq_notifications_recipient_dedupe'],
  });

  await ensureCampusConnectorTables(pool);

  assert.deepEqual(pool.calls.map(describeCall), [
    ...CREATE_SEQUENCE,
    'check-column:notifications.dedupe_key',
    'check-index:notifications.uq_notifications_recipient_dedupe',
    'check-column:important_items.action_url',
  ]);
  assert.equal(
    pool.calls.some(({ sql }) => sql.startsWith('ALTER TABLE')),
    false,
  );
});

test('adds missing core fields and the unique index in dependency order', async () => {
  const pool = createFakePool();

  await ensureCampusConnectorTables(pool);

  assert.deepEqual(pool.calls.map(describeCall), [
    ...CREATE_SEQUENCE,
    'check-column:notifications.dedupe_key',
    'alter:notifications.dedupe_key',
    'check-index:notifications.uq_notifications_recipient_dedupe',
    'alter:notifications.uq_notifications_recipient_dedupe',
    'check-column:important_items.action_url',
    'alter:important_items.action_url',
  ]);
});

test('runtime CREATE statements retain the connector concurrency and credential constraints', async () => {
  const pool = createFakePool({
    columns: ['notifications.dedupe_key', 'important_items.action_url'],
    indexes: ['notifications.uq_notifications_recipient_dedupe'],
  });

  await ensureCampusConnectorTables(pool);

  const [connectorSql, authFlowSql, syncRunSql] = pool.calls.slice(0, 3).map(({ sql }) => sql);
  assert.match(connectorSql, /credential_ciphertext MEDIUMBLOB NULL/u);
  assert.match(connectorSql, /credential_iv BINARY\(12\) NULL/u);
  assert.match(connectorSql, /credential_auth_tag BINARY\(16\) NULL/u);
  assert.match(
    authFlowSql,
    /CASE WHEN status = 'redirect_issued' AND consumed_at IS NULL THEN 1 ELSE NULL END/u,
  );
  assert.match(
    authFlowSql,
    /UNIQUE KEY uq_campus_connector_auth_flows_active \(user_id, provider, active_slot\)/u,
  );
  assert.match(
    syncRunSql,
    /trace_id CHAR\(36\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE/u,
  );
  assert.match(
    syncRunSql,
    /UNIQUE KEY uq_campus_connector_sync_runs_active \(connector_id, active_slot\)/u,
  );
});

test('tolerates a duplicate-field race while applying an additive ALTER', async () => {
  const pool = createFakePool();
  const execute = pool.execute.bind(pool);
  let duplicateRaised = false;
  pool.execute = async (statement, parameters = []) => {
    const result = await execute(statement, parameters);
    if (
      !duplicateRaised &&
      compactSql(statement).startsWith('ALTER TABLE notifications ADD COLUMN')
    ) {
      duplicateRaised = true;
      const error = new Error('duplicate column from a concurrent initializer');
      error.code = 'ER_DUP_FIELDNAME';
      throw error;
    }
    return result;
  };

  await ensureCampusConnectorTables(pool);

  assert.equal(duplicateRaised, true);
  assert.equal(
    pool.calls.some(({ sql }) => sql.startsWith('ALTER TABLE important_items ADD COLUMN')),
    true,
  );
});

test('does not hide an unexpected additive ALTER failure', async () => {
  const pool = createFakePool();
  const execute = pool.execute.bind(pool);
  pool.execute = async (statement, parameters = []) => {
    const result = await execute(statement, parameters);
    if (compactSql(statement).startsWith('ALTER TABLE notifications ADD COLUMN')) {
      const error = new Error('database unavailable');
      error.code = 'ECONNRESET';
      throw error;
    }
    return result;
  };

  await assert.rejects(() => ensureCampusConnectorTables(pool), {
    code: 'ECONNRESET',
  });
});

test('rejects a value that is not a mysql2 pool', async () => {
  await assert.rejects(() => ensureCampusConnectorTables({}), {
    name: 'TypeError',
    message: 'A mysql2 pool is required',
  });
});
