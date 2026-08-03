const crypto = require('crypto');
const { CampusConnectorError } = require('./errors');

function parseJsonColumn(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeSyncRun(row) {
  if (!row) return null;
  return {
    ...row,
    result_counts: parseJsonColumn(row.result_counts),
    evidence_json: parseJsonColumn(row.evidence_json),
  };
}

function connectorPublicId() {
  return `ucc_${crypto.randomBytes(12).toString('hex')}`;
}

function identityAlreadyBoundError() {
  return new CampusConnectorError(
    'connector_identity_already_bound',
    '该清华身份已经绑定其他 FREE BBS 账号，请联系管理员。',
    { status: 409 },
  );
}

function authorizationConflictError() {
  return new CampusConnectorError('authorization_conflict', '另一个授权正在完成，请重新连接。', {
    status: 409,
  });
}

function createMysqlCampusConnectorStore(pool) {
  if (!pool || typeof pool.execute !== 'function') {
    throw new TypeError('A mysql2 pool is required');
  }

  async function getConnection(userId, provider) {
    const [rows] = await pool.execute(
      `SELECT id, public_id, user_id, provider, status, generation,
              adapter_id, adapter_version, identity_fingerprint, granted_scopes,
              credential_type, credential_ciphertext, credential_iv,
              credential_auth_tag, credential_key_version, credential_expires_at,
              connected_at, reauthorization_required_at, revoked_at,
              last_successful_sync_at, last_error_code, created_at, updated_at
       FROM user_campus_connectors
       WHERE user_id = ? AND provider = ?
       LIMIT 1`,
      [userId, provider],
    );
    const row = rows[0] || null;
    if (row) row.granted_scopes = parseJsonColumn(row.granted_scopes, []);
    return row;
  }

  async function getPendingAuthorizationFlow(userId, provider, currentTime) {
    const [rows] = await pool.execute(
      `SELECT public_id, expires_at
       FROM campus_connector_auth_flows
       WHERE user_id = ?
         AND provider = ?
         AND status = 'redirect_issued'
         AND consumed_at IS NULL
         AND expires_at > ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId, provider, currentTime],
    );
    return rows[0] || null;
  }

  async function getLatestSyncRun(userId, provider) {
    const [rows] = await pool.execute(
      `SELECT r.public_id, r.trace_id, r.status, r.result_counts, r.error_code,
              r.created_at, r.started_at, r.finished_at
       FROM campus_connector_sync_runs r
       INNER JOIN user_campus_connectors c ON c.id = r.connector_id
       WHERE c.user_id = ? AND c.provider = ?
         AND r.connector_generation = c.generation
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT 1`,
      [userId, provider],
    );
    return normalizeSyncRun(rows[0]);
  }

  async function expireConnection({ userId, provider, expectedGeneration, expiredAt }) {
    const cutoff = expiredAt instanceof Date ? expiredAt : new Date(expiredAt);
    if (!Number.isSafeInteger(Number(expectedGeneration)) || Number.isNaN(cutoff.getTime())) {
      throw new TypeError('A valid connector generation and expiry cutoff are required');
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        `SELECT id, generation
         FROM user_campus_connectors
         WHERE user_id = ? AND provider = ? AND generation = ?
           AND status IN ('active_unverified', 'active_verified')
           AND credential_expires_at IS NOT NULL
           AND credential_expires_at <= ?
         LIMIT 1
         FOR UPDATE`,
        [userId, provider, expectedGeneration, cutoff],
      );
      const current = rows[0] || null;
      if (!current) {
        await connection.commit();
        return false;
      }

      const [result] = await connection.execute(
        `UPDATE user_campus_connectors
         SET status = 'reauthorization_required',
             generation = generation + 1,
             identity_fingerprint = NULL, granted_scopes = NULL,
             credential_type = NULL, credential_ciphertext = NULL,
             credential_iv = NULL, credential_auth_tag = NULL,
             credential_expires_at = NULL,
             reauthorization_required_at = ?,
             last_successful_sync_at = NULL,
             last_error_code = 'authorization_required'
         WHERE id = ? AND generation = ?
           AND status IN ('active_unverified', 'active_verified')`,
        [cutoff, current.id, expectedGeneration],
      );
      if (result.affectedRows !== 1) {
        await connection.commit();
        return false;
      }

      await connection.execute(
        `UPDATE campus_connector_sync_runs
         SET status = 'cancelled', finished_at = ?, heartbeat_at = ?,
             lease_expires_at = NULL, lease_owner = NULL,
             error_code = 'authorization_required'
         WHERE connector_id = ? AND status IN ('queued', 'running')`,
        [cutoff, cutoff, current.id],
      );
      await connection.commit();
      return true;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async function invalidatePendingAuthorizationFlows(userId, provider, invalidatedAt) {
    await pool.execute(
      `UPDATE campus_connector_auth_flows
       SET status = 'invalidated', consumed_at = COALESCE(consumed_at, ?)
       WHERE user_id = ?
         AND provider = ?
         AND status = 'redirect_issued'
         AND consumed_at IS NULL`,
      [invalidatedAt, userId, provider],
    );
  }

  async function replaceAuthorizationFlow(flow) {
    const encrypted = flow.encryptedFlowSecret;
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        `UPDATE campus_connector_auth_flows
         SET status = 'invalidated', consumed_at = COALESCE(consumed_at, ?)
         WHERE user_id = ? AND provider = ?
           AND status = 'redirect_issued' AND consumed_at IS NULL`,
        [flow.createdAt, flow.userId, flow.provider],
      );
      await connection.execute(
        `INSERT INTO campus_connector_auth_flows (
          state_hash, public_id, user_id, provider, adapter_id, adapter_version,
          return_path, flow_secret_ciphertext, flow_secret_iv, flow_secret_auth_tag,
          status, expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          flow.stateHash,
          flow.publicId,
          flow.userId,
          flow.provider,
          flow.adapterId,
          flow.adapterVersion,
          flow.returnPath,
          encrypted?.ciphertext || null,
          encrypted?.iv || null,
          encrypted?.authTag || null,
          flow.status,
          flow.expiresAt,
          flow.createdAt,
        ],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      if (error?.code === 'ER_DUP_ENTRY') {
        throw new CampusConnectorError(
          'authorization_start_in_progress',
          '另一个授权会话刚刚启动，请稍后重试。',
          { status: 409 },
        );
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  async function claimAuthorizationFlow(stateHash, provider, claimedAt) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        `SELECT state_hash, public_id, user_id, provider, adapter_id, adapter_version,
                return_path, flow_secret_ciphertext, flow_secret_iv,
                flow_secret_auth_tag, status, expires_at, consumed_at
         FROM campus_connector_auth_flows
         WHERE state_hash = ? AND provider = ?
         LIMIT 1
         FOR UPDATE`,
        [stateHash, provider],
      );
      const row = rows[0];
      const valid = Boolean(
        row &&
        row.status === 'redirect_issued' &&
        !row.consumed_at &&
        new Date(row.expires_at) > claimedAt,
      );
      if (!valid) {
        if (row && row.status === 'redirect_issued' && !row.consumed_at) {
          await connection.execute(
            `UPDATE campus_connector_auth_flows
             SET status = 'expired', consumed_at = ?
             WHERE state_hash = ?`,
            [claimedAt, stateHash],
          );
        }
        await connection.commit();
        return null;
      }

      const [result] = await connection.execute(
        `UPDATE campus_connector_auth_flows
         SET status = 'callback_received', claimed_at = ?, consumed_at = ?
         WHERE state_hash = ?
           AND status = 'redirect_issued'
           AND consumed_at IS NULL
           AND expires_at > ?`,
        [claimedAt, claimedAt, stateHash, claimedAt],
      );
      await connection.commit();
      return result.affectedRows === 1 ? row : null;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async function failAuthorizationFlow(stateHash, errorCode, failedAt) {
    await pool.execute(
      `UPDATE campus_connector_auth_flows
       SET status = 'failed', safe_error_code = ?, consumed_at = COALESCE(consumed_at, ?)
       WHERE state_hash = ?`,
      [String(errorCode || 'authorization_failed').slice(0, 64), failedAt, stateHash],
    );
  }

  async function completeAuthorization({
    flow,
    stateHash,
    provider,
    adapterId,
    adapterVersion,
    identityFingerprint,
    encryptedGrant,
    scopes,
    credentialType,
    credentialExpiresAt,
    completedAt,
  }) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [flowRows] = await connection.execute(
        `SELECT status, user_id
         FROM campus_connector_auth_flows
         WHERE state_hash = ?
         LIMIT 1
         FOR UPDATE`,
        [stateHash],
      );
      if (
        !flowRows[0] ||
        flowRows[0].status !== 'callback_received' ||
        Number(flowRows[0].user_id) !== Number(flow.user_id)
      ) {
        throw new CampusConnectorError(
          'authorization_state_invalid',
          '授权状态无效或已使用，请重新连接。',
          { status: 400 },
        );
      }

      const [identityRows] = await connection.execute(
        `SELECT id, user_id
         FROM user_campus_connectors
         WHERE provider = ? AND identity_fingerprint = ?
         LIMIT 1
         FOR UPDATE`,
        [provider, identityFingerprint],
      );
      if (identityRows[0] && Number(identityRows[0].user_id) !== Number(flow.user_id)) {
        throw identityAlreadyBoundError();
      }

      const [connectorRows] = await connection.execute(
        `SELECT id
         FROM user_campus_connectors
         WHERE user_id = ? AND provider = ?
         LIMIT 1
         FOR UPDATE`,
        [flow.user_id, provider],
      );
      const serializedScopes = JSON.stringify(scopes || []);
      if (connectorRows[0]) {
        await connection.execute(
          `UPDATE user_campus_connectors
           SET status = 'active_unverified', generation = generation + 1,
               adapter_id = ?, adapter_version = ?, identity_fingerprint = ?,
               granted_scopes = ?, credential_type = ?, credential_ciphertext = ?,
               credential_iv = ?, credential_auth_tag = ?, credential_expires_at = ?,
               connected_at = ?, reauthorization_required_at = NULL,
               revoked_at = NULL, last_successful_sync_at = NULL,
               last_error_code = NULL
           WHERE id = ? AND user_id = ? AND provider = ?`,
          [
            adapterId,
            adapterVersion,
            identityFingerprint,
            serializedScopes,
            credentialType,
            encryptedGrant.ciphertext,
            encryptedGrant.iv,
            encryptedGrant.authTag,
            credentialExpiresAt,
            completedAt,
            connectorRows[0].id,
            flow.user_id,
            provider,
          ],
        );
        await connection.execute(
          `UPDATE campus_connector_sync_runs
           SET status = 'cancelled', finished_at = ?, heartbeat_at = ?,
               lease_expires_at = NULL, lease_owner = NULL,
               error_code = 'connection_changed'
           WHERE connector_id = ? AND status IN ('queued', 'running')`,
          [completedAt, completedAt, connectorRows[0].id],
        );
      } else {
        await connection.execute(
          `INSERT INTO user_campus_connectors (
            public_id, user_id, provider, status, generation, adapter_id, adapter_version,
            identity_fingerprint, granted_scopes, credential_type, credential_ciphertext,
            credential_iv, credential_auth_tag, credential_expires_at, connected_at,
            reauthorization_required_at, revoked_at, last_error_code
          ) VALUES (
            ?, ?, ?, 'active_unverified', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL
          )`,
          [
            connectorPublicId(),
            flow.user_id,
            provider,
            adapterId,
            adapterVersion,
            identityFingerprint,
            serializedScopes,
            credentialType,
            encryptedGrant.ciphertext,
            encryptedGrant.iv,
            encryptedGrant.authTag,
            credentialExpiresAt,
            completedAt,
          ],
        );
      }
      await connection.execute(
        `UPDATE campus_connector_auth_flows
         SET status = 'succeeded', safe_error_code = NULL
         WHERE state_hash = ? AND status = 'callback_received'`,
        [stateHash],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      if (error?.code === 'ER_DUP_ENTRY') {
        throw identityAlreadyBoundError();
      }
      if (['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error?.code)) {
        throw authorizationConflictError();
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  async function completeDirectConnection({
    userId,
    provider,
    adapterId,
    adapterVersion,
    identityFingerprint,
    encryptedGrant,
    scopes,
    credentialType,
    credentialExpiresAt,
    completedAt,
  }) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [identityRows] = await connection.execute(
        `SELECT id, user_id
         FROM user_campus_connectors
         WHERE provider = ? AND identity_fingerprint = ?
         LIMIT 1
         FOR UPDATE`,
        [provider, identityFingerprint],
      );
      if (identityRows[0] && Number(identityRows[0].user_id) !== Number(userId)) {
        throw identityAlreadyBoundError();
      }

      const [connectorRows] = await connection.execute(
        `SELECT id
         FROM user_campus_connectors
         WHERE user_id = ? AND provider = ?
         LIMIT 1
         FOR UPDATE`,
        [userId, provider],
      );
      const serializedScopes = JSON.stringify(scopes || []);
      if (connectorRows[0]) {
        await connection.execute(
          `UPDATE user_campus_connectors
           SET status = 'active_unverified', generation = generation + 1,
               adapter_id = ?, adapter_version = ?, identity_fingerprint = ?,
               granted_scopes = ?, credential_type = ?, credential_ciphertext = ?,
               credential_iv = ?, credential_auth_tag = ?, credential_expires_at = ?,
               connected_at = ?, reauthorization_required_at = NULL,
               revoked_at = NULL, last_successful_sync_at = NULL,
               last_error_code = NULL
           WHERE id = ? AND user_id = ? AND provider = ?`,
          [
            adapterId,
            adapterVersion,
            identityFingerprint,
            serializedScopes,
            credentialType,
            encryptedGrant.ciphertext,
            encryptedGrant.iv,
            encryptedGrant.authTag,
            credentialExpiresAt,
            completedAt,
            connectorRows[0].id,
            userId,
            provider,
          ],
        );
        await connection.execute(
          `UPDATE campus_connector_sync_runs
           SET status = 'cancelled', finished_at = ?, heartbeat_at = ?,
               lease_expires_at = NULL, lease_owner = NULL,
               error_code = 'connection_changed'
           WHERE connector_id = ? AND status IN ('queued', 'running')`,
          [completedAt, completedAt, connectorRows[0].id],
        );
      } else {
        await connection.execute(
          `INSERT INTO user_campus_connectors (
            public_id, user_id, provider, status, generation, adapter_id, adapter_version,
            identity_fingerprint, granted_scopes, credential_type, credential_ciphertext,
            credential_iv, credential_auth_tag, credential_expires_at, connected_at,
            reauthorization_required_at, revoked_at, last_error_code
          ) VALUES (
            ?, ?, ?, 'active_unverified', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL
          )`,
          [
            connectorPublicId(),
            userId,
            provider,
            adapterId,
            adapterVersion,
            identityFingerprint,
            serializedScopes,
            credentialType,
            encryptedGrant.ciphertext,
            encryptedGrant.iv,
            encryptedGrant.authTag,
            credentialExpiresAt,
            completedAt,
          ],
        );
      }

      await connection.execute(
        `UPDATE campus_connector_auth_flows
         SET status = 'invalidated', consumed_at = COALESCE(consumed_at, ?)
         WHERE user_id = ? AND provider = ?
           AND status = 'redirect_issued' AND consumed_at IS NULL`,
        [completedAt, userId, provider],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      if (error?.code === 'ER_DUP_ENTRY') {
        throw identityAlreadyBoundError();
      }
      if (['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error?.code)) {
        throw authorizationConflictError();
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  async function revokeConnection(userId, provider, revokedAt) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        `SELECT id, adapter_id, adapter_version, credential_ciphertext,
                credential_iv, credential_auth_tag
         FROM user_campus_connectors
         WHERE user_id = ? AND provider = ?
         LIMIT 1
         FOR UPDATE`,
        [userId, provider],
      );
      const existing = rows[0] || null;
      if (existing) {
        await connection.execute(
          `UPDATE user_campus_connectors
           SET status = 'revoked', generation = generation + 1,
               identity_fingerprint = NULL, granted_scopes = NULL,
               credential_type = NULL, credential_ciphertext = NULL,
               credential_iv = NULL, credential_auth_tag = NULL,
               credential_expires_at = NULL, revoked_at = ?,
               reauthorization_required_at = NULL, last_error_code = NULL
           WHERE id = ?`,
          [revokedAt, existing.id],
        );
        await connection.execute(
          `UPDATE campus_connector_sync_runs
           SET status = 'cancelled', finished_at = ?, error_code = 'connection_revoked'
           WHERE connector_id = ? AND status IN ('queued', 'running')`,
          [revokedAt, existing.id],
        );
      }
      await connection.execute(
        `UPDATE campus_connector_auth_flows
         SET status = 'invalidated', consumed_at = COALESCE(consumed_at, ?)
         WHERE user_id = ? AND provider = ?
           AND status = 'redirect_issued' AND consumed_at IS NULL`,
        [revokedAt, userId, provider],
      );
      await connection.commit();
      return existing;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async function createSyncRun(run) {
    try {
      await pool.execute(
        `INSERT INTO campus_connector_sync_runs (
          public_id, trace_id, connector_id, connector_generation,
          requested_by_user_id, trigger_type, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?)`,
        [
          run.publicId,
          run.traceId,
          run.connectorId,
          run.connectorGeneration,
          run.requestedByUserId,
          run.triggerType,
          run.createdAt,
        ],
      );
      return {
        public_id: run.publicId,
        trace_id: run.traceId,
        connector_id: run.connectorId,
        connector_generation: run.connectorGeneration,
        status: 'queued',
      };
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') {
        const conflict = new Error('sync already in progress');
        conflict.code = 'sync_in_progress';
        throw conflict;
      }
      throw error;
    }
  }

  async function failSyncRun(publicId, errorCode, failedAt) {
    await pool.execute(
      `UPDATE campus_connector_sync_runs
       SET status = 'failed', finished_at = ?, error_code = ?
       WHERE public_id = ? AND status IN ('queued', 'running')`,
      [failedAt, String(errorCode || 'sync_failed').slice(0, 64), publicId],
    );
  }

  async function getSyncRun(userId, provider, publicId) {
    const [rows] = await pool.execute(
      `SELECT r.public_id, r.trace_id, r.status, r.result_counts, r.error_code,
              r.created_at, r.started_at, r.finished_at
       FROM campus_connector_sync_runs r
       INNER JOIN user_campus_connectors c ON c.id = r.connector_id
       WHERE r.public_id = ? AND c.user_id = ? AND c.provider = ?
       LIMIT 1`,
      [publicId, userId, provider],
    );
    return normalizeSyncRun(rows[0]);
  }

  return {
    claimAuthorizationFlow,
    completeAuthorization,
    completeDirectConnection,
    expireConnection,
    replaceAuthorizationFlow,
    createSyncRun,
    failAuthorizationFlow,
    failSyncRun,
    getConnection,
    getLatestSyncRun,
    getPendingAuthorizationFlow,
    getSyncRun,
    invalidatePendingAuthorizationFlows,
    revokeConnection,
  };
}

module.exports = {
  createMysqlCampusConnectorStore,
  normalizeSyncRun,
  parseJsonColumn,
};
