const CREATE_TABLE_STATEMENTS = Object.freeze([
  `CREATE TABLE IF NOT EXISTS user_campus_connectors (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    public_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
    user_id BIGINT NOT NULL,
    provider VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    adapter_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    adapter_version VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    status ENUM(
        'active_unverified',
        'active_verified',
        'reauthorization_required',
        'revoked',
        'error'
    ) NOT NULL DEFAULT 'active_unverified',
    generation INT UNSIGNED NOT NULL DEFAULT 1,
    identity_fingerprint BINARY(32) NULL,
    granted_scopes JSON NULL,
    credential_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
    credential_ciphertext MEDIUMBLOB NULL,
    credential_iv BINARY(12) NULL,
    credential_auth_tag BINARY(16) NULL,
    credential_key_version INT UNSIGNED NOT NULL DEFAULT 1,
    credential_expires_at DATETIME NULL,
    connected_at DATETIME NULL,
    reauthorization_required_at DATETIME NULL,
    revoked_at DATETIME NULL,
    last_successful_sync_at DATETIME NULL,
    last_error_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_user_campus_connectors_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    UNIQUE KEY uq_user_campus_connectors_user_provider (user_id, provider),
    UNIQUE KEY uq_user_campus_connectors_provider_identity
        (provider, identity_fingerprint),
    INDEX idx_user_campus_connectors_user_status (user_id, status),
    INDEX idx_user_campus_connectors_status_expiry (status, credential_expires_at)
)`,
  `CREATE TABLE IF NOT EXISTS campus_connector_auth_flows (
    state_hash BINARY(32) PRIMARY KEY,
    public_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
    user_id BIGINT NOT NULL,
    provider VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    adapter_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    adapter_version VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    status ENUM(
        'redirect_issued',
        'callback_received',
        'succeeded',
        'failed',
        'expired',
        'invalidated'
    ) NOT NULL DEFAULT 'redirect_issued',
    return_path VARCHAR(255) NOT NULL DEFAULT '/workbench',
    flow_secret_ciphertext MEDIUMBLOB NULL,
    flow_secret_iv BINARY(12) NULL,
    flow_secret_auth_tag BINARY(16) NULL,
    flow_secret_key_version INT UNSIGNED NOT NULL DEFAULT 1,
    expires_at DATETIME NOT NULL,
    claimed_at DATETIME NULL,
    consumed_at DATETIME NULL,
    active_slot TINYINT
        GENERATED ALWAYS AS (
            CASE
                WHEN status = 'redirect_issued' AND consumed_at IS NULL THEN 1
                ELSE NULL
            END
        ) STORED,
    safe_error_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_campus_connector_auth_flows_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    UNIQUE KEY uq_campus_connector_auth_flows_active (user_id, provider, active_slot),
    INDEX idx_campus_connector_auth_flows_user_provider
        (user_id, provider, created_at DESC),
    INDEX idx_campus_connector_auth_flows_consumed_expiry (consumed_at, expires_at)
)`,
  `CREATE TABLE IF NOT EXISTS campus_connector_sync_runs (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    public_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
    trace_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
    connector_id BIGINT NOT NULL,
    connector_generation INT UNSIGNED NOT NULL,
    requested_by_user_id BIGINT NULL,
    trigger_type ENUM('manual', 'scheduled', 'retry') NOT NULL DEFAULT 'manual',
    status ENUM('queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled')
        NOT NULL DEFAULT 'queued',
    active_slot TINYINT
        GENERATED ALWAYS AS (
            CASE WHEN status IN ('queued', 'running') THEN 1 ELSE NULL END
        ) STORED,
    attempt_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    started_at DATETIME NULL,
    finished_at DATETIME NULL,
    heartbeat_at DATETIME NULL,
    lease_expires_at DATETIME NULL,
    lease_owner VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    parser_version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    schema_version VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
    request_count INT UNSIGNED NOT NULL DEFAULT 0,
    result_counts JSON NULL,
    evidence_json JSON NULL,
    error_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    error_context JSON NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_campus_connector_sync_runs_connector
        FOREIGN KEY (connector_id) REFERENCES user_campus_connectors (id) ON DELETE CASCADE,
    CONSTRAINT fk_campus_connector_sync_runs_requested_by
        FOREIGN KEY (requested_by_user_id) REFERENCES users (id) ON DELETE SET NULL,
    UNIQUE KEY uq_campus_connector_sync_runs_active (connector_id, active_slot),
    INDEX idx_campus_connector_sync_runs_connector_created (connector_id, created_at DESC),
    INDEX idx_campus_connector_sync_runs_connector_status
        (connector_id, status, created_at DESC),
    INDEX idx_campus_connector_sync_runs_queue_lease (status, lease_expires_at),
    INDEX idx_campus_connector_sync_runs_requested_by
        (requested_by_user_id, created_at DESC)
)`,
]);

const COLUMN_EXISTS_SQL = `SELECT 1 AS present
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = ?
  AND COLUMN_NAME = ?
LIMIT 1`;

const INDEX_EXISTS_SQL = `SELECT 1 AS present
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = ?
  AND INDEX_NAME = ?
  AND NON_UNIQUE = 0
LIMIT 1`;

async function informationSchemaEntryExists(pool, statement, tableName, entryName) {
  const [rows] = await pool.execute(statement, [tableName, entryName]);
  return Array.isArray(rows) && rows.length > 0;
}

async function executeAdditiveAlter(pool, statement) {
  try {
    await pool.execute(statement);
  } catch (error) {
    if (!['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME'].includes(error?.code)) {
      throw error;
    }
  }
}

async function ensureCampusConnectorTables(pool) {
  if (!pool || typeof pool.execute !== 'function') {
    throw new TypeError('A mysql2 pool is required');
  }

  for (const statement of CREATE_TABLE_STATEMENTS) {
    await pool.execute(statement);
  }

  const notificationDedupeColumnExists = await informationSchemaEntryExists(
    pool,
    COLUMN_EXISTS_SQL,
    'notifications',
    'dedupe_key',
  );
  if (!notificationDedupeColumnExists) {
    await executeAdditiveAlter(
      pool,
      `ALTER TABLE notifications
       ADD COLUMN dedupe_key VARCHAR(128) NULL AFTER source_reference`,
    );
  }

  const notificationDedupeIndexExists = await informationSchemaEntryExists(
    pool,
    INDEX_EXISTS_SQL,
    'notifications',
    'uq_notifications_recipient_dedupe',
  );
  if (!notificationDedupeIndexExists) {
    await executeAdditiveAlter(
      pool,
      `ALTER TABLE notifications
       ADD UNIQUE KEY uq_notifications_recipient_dedupe
         (recipient_user_id, dedupe_key)`,
    );
  }

  const importantItemActionUrlExists = await informationSchemaEntryExists(
    pool,
    COLUMN_EXISTS_SQL,
    'important_items',
    'action_url',
  );
  if (!importantItemActionUrlExists) {
    await executeAdditiveAlter(
      pool,
      `ALTER TABLE important_items
       ADD COLUMN action_url VARCHAR(512) NULL AFTER description`,
    );
  }
}

module.exports = { ensureCampusConnectorTables };
