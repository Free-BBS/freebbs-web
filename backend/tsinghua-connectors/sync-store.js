const crypto = require('crypto');

function publicId(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
}

function safeJson(value, maximumLength = 64_000) {
  const serialized = JSON.stringify(value ?? null);
  return serialized.length <= maximumLength ? serialized : JSON.stringify({ truncated: true });
}

function normalizeDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeCount(value) {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

function normalizeDiagnosticToken(value, fallback) {
  const token = String(value || '').trim();
  return /^[a-z][a-z0-9:_-]{0,63}$/u.test(token) ? token : fallback;
}

function summarizeDiagnostics(entries) {
  const totals = new Map();
  for (const entry of Array.isArray(entries) ? entries.slice(0, 1_000) : []) {
    const resource = normalizeDiagnosticToken(entry?.resource, 'unknown');
    const code = normalizeDiagnosticToken(entry?.code, 'unknown');
    const key = `${resource}\u0000${code}`;
    const current = totals.get(key) || { resource, code, count: 0 };
    current.count += 1;
    totals.set(key, current);
  }
  return [...totals.values()]
    .sort((left, right) =>
      `${left.resource}:${left.code}`.localeCompare(`${right.resource}:${right.code}`),
    )
    .slice(0, 64);
}

function buildDiagnosticContext(snapshot) {
  return {
    version: 1,
    warnings: summarizeDiagnostics(snapshot?.warnings),
    errors: summarizeDiagnostics(snapshot?.errors),
  };
}

function createTsinghuaSyncStore(pool) {
  if (!pool || typeof pool.getConnection !== 'function') {
    throw new TypeError('A mysql2 pool is required');
  }

  async function claimRun(runPublicId, startedAt) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        `SELECT r.id AS run_id, r.public_id, r.connector_id, r.connector_generation,
                r.target_semester_id,
                r.requested_by_user_id, r.status AS run_status,
                c.user_id, c.provider, c.status AS connector_status, c.generation,
                c.adapter_id, c.adapter_version, c.credential_type, c.credential_ciphertext,
                c.credential_iv, c.credential_auth_tag, c.credential_expires_at
         FROM campus_connector_sync_runs r
         INNER JOIN user_campus_connectors c ON c.id = r.connector_id
         WHERE r.public_id = ?
         LIMIT 1
         FOR UPDATE`,
        [runPublicId],
      );
      const row = rows[0] || null;
      const active = ['active_unverified', 'active_verified'].includes(row?.connector_status);
      const credentialExpiresAt = normalizeDate(row?.credential_expires_at);
      const generationMatches = Boolean(
        row && Number(row.connector_generation) === Number(row.generation),
      );
      const credentialExpired = Boolean(
        credentialExpiresAt && credentialExpiresAt.getTime() <= startedAt.getTime(),
      );
      const credentialMissingExpiry = Boolean(
        row?.credential_type === 'encrypted_cookie_jar' && !credentialExpiresAt,
      );
      const authorizationInvalid = Boolean(
        credentialExpired ||
        credentialMissingExpiry ||
        row?.connector_status === 'reauthorization_required',
      );
      if (row?.run_status === 'queued' && generationMatches && authorizationInvalid) {
        await connection.execute(
          `UPDATE campus_connector_sync_runs
           SET status = 'failed', finished_at = ?, error_code = 'authorization_required'
           WHERE id = ? AND status = 'queued'`,
          [startedAt, row.run_id],
        );
        await connection.execute(
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
             AND status IN ('active_unverified', 'active_verified', 'reauthorization_required')`,
          [startedAt, row.connector_id, row.connector_generation],
        );
        await connection.execute(
          `UPDATE campus_connector_sync_runs
           SET status = 'cancelled', finished_at = ?, heartbeat_at = ?,
               lease_expires_at = NULL, lease_owner = NULL,
               error_code = 'connection_changed'
           WHERE connector_id = ? AND id <> ?
             AND status IN ('queued', 'running')`,
          [startedAt, startedAt, row.connector_id, row.run_id],
        );
        await connection.commit();
        return null;
      }
      const valid = Boolean(
        row && row.run_status === 'queued' && active && generationMatches && !authorizationInvalid,
      );
      if (!valid) {
        if (row?.run_status === 'queued') {
          await connection.execute(
            `UPDATE campus_connector_sync_runs
             SET status = 'cancelled', finished_at = ?, error_code = 'connection_changed'
             WHERE id = ? AND status = 'queued'`,
            [startedAt, row.run_id],
          );
        }
        await connection.commit();
        return null;
      }
      const [result] = await connection.execute(
        `UPDATE campus_connector_sync_runs
         SET status = 'running', started_at = ?, heartbeat_at = ?,
             attempt_count = attempt_count + 1
         WHERE id = ? AND status = 'queued'`,
        [startedAt, startedAt, row.run_id],
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

  async function upsertNotification(connection, userId, notification, syncedAt) {
    await connection.execute(
      `INSERT INTO notifications (
        public_id, recipient_user_id, category, source_type, source_reference,
        dedupe_key, title, body, action_url, importance, status,
        deadline_at, published_at
      ) VALUES (?, ?, ?, 'network_classroom', ?, ?, ?, NULLIF(?, ''), ?, ?,
                'published', ?, ?)
      ON DUPLICATE KEY UPDATE
        category = VALUES(category), source_reference = VALUES(source_reference),
        title = VALUES(title), body = VALUES(body), action_url = VALUES(action_url),
        importance = VALUES(importance), status = 'published',
        deadline_at = VALUES(deadline_at), published_at = VALUES(published_at),
        deleted_at = NULL`,
      [
        publicId('wn'),
        userId,
        notification.category || 'course',
        notification.sourceReference,
        notification.sourceReference,
        String(notification.title || '').slice(0, 200),
        String(notification.body || '').slice(0, 20_000),
        String(notification.actionUrl || '').slice(0, 512) || null,
        ['important', 'urgent'].includes(notification.importance)
          ? notification.importance
          : 'normal',
        normalizeDate(notification.deadlineAt),
        normalizeDate(notification.publishedAt) || syncedAt,
      ],
    );
  }

  async function upsertImportantItem(connection, userId, item) {
    const priority = ['low', 'normal', 'high', 'urgent'].includes(item.priority)
      ? item.priority
      : 'normal';
    await connection.execute(
      `INSERT INTO important_items (
        public_id, user_id, dedupe_key, source_type, source_reference,
        title, description, action_url, due_at, priority, status
      ) VALUES (?, ?, ?, 'network_classroom', ?, ?, NULLIF(?, ''), ?, ?, ?, 'draft')
      ON DUPLICATE KEY UPDATE
        source_reference = VALUES(source_reference),
        title = IF(user_overridden_at IS NULL, VALUES(title), title),
        description = IF(user_overridden_at IS NULL, VALUES(description), description),
        action_url = IF(user_overridden_at IS NULL, VALUES(action_url), action_url),
        due_at = IF(user_overridden_at IS NULL, VALUES(due_at), due_at),
        priority = IF(user_overridden_at IS NULL, VALUES(priority), priority),
        cancelled_at = IF(
          user_overridden_at IS NULL AND status = 'cancelled',
          NULL,
          cancelled_at
        ),
        status = IF(
          user_overridden_at IS NULL AND status = 'cancelled',
          'draft',
          status
        ),
        deleted_at = IF(user_overridden_at IS NULL, NULL, deleted_at)`,
      [
        publicId('wi'),
        userId,
        importantItemDedupeKey(item) || null,
        String(item.sourceReference || '').slice(0, 128) || null,
        String(item.title || '').slice(0, 200),
        String(item.description || '').slice(0, 4_000),
        String(item.actionUrl || '').slice(0, 512) || null,
        normalizeDate(item.dueAt),
        priority,
      ],
    );
  }

  async function upsertSemesterSnapshot(connection, userId, snapshot, syncedAt) {
    const semesterId = String(snapshot.semesterId || '')
      .trim()
      .slice(0, 32);
    if (!semesterId) return;

    const courses = Array.isArray(snapshot.courses) ? snapshot.courses : [];
    const courseReferences = new Set(courses.map((course) => course.sourceReference));
    const notifications = (Array.isArray(snapshot.notifications) ? snapshot.notifications : [])
      .filter((notification) => courseReferences.has(notification.courseReference))
      .map((notification) => ({
        sourceReference: notification.sourceReference,
        courseReference: notification.courseReference,
        title: notification.title,
        body: notification.body || '',
        actionUrl: notification.actionUrl || '',
        importance: notification.importance || 'normal',
        publishedAt: notification.publishedAt || null,
        publisher: notification.publisher || '',
      }));

    await connection.execute(
      `INSERT INTO campus_learn_semester_snapshots (
        user_id, semester_id, courses_json, notifications_json, sync_status, fetched_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        courses_json = VALUES(courses_json),
        notifications_json = VALUES(notifications_json),
        sync_status = VALUES(sync_status),
        fetched_at = VALUES(fetched_at)`,
      [
        userId,
        semesterId,
        JSON.stringify(courses),
        JSON.stringify(notifications),
        snapshot.status === 'partial' ? 'partial' : 'complete',
        normalizeDate(snapshot.fetchedAt) || syncedAt,
      ],
    );
  }

  async function upsertSemesterCatalog(connection, userId, snapshot, syncedAt) {
    if (!Array.isArray(snapshot.availableSemesters)) return;
    await connection.execute(
      `INSERT INTO campus_learn_semester_catalogs (
        user_id, current_semester_id, semesters_json, fetched_at
      ) VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        current_semester_id = VALUES(current_semester_id),
        semesters_json = VALUES(semesters_json),
        fetched_at = VALUES(fetched_at)`,
      [
        userId,
        String(snapshot.currentSemesterId || '').slice(0, 32) || null,
        JSON.stringify(snapshot.availableSemesters),
        normalizeDate(snapshot.fetchedAt) || syncedAt,
      ],
    );
  }

  function importantItemDedupeKey(item) {
    const value = item?.dedupeKey || item?.sourceReference;
    return String(value || '')
      .trim()
      .slice(0, 128);
  }

  async function cancelMissingImportantItems(connection, userId, items, syncedAt) {
    const currentKeys = [...new Set((items || []).map(importantItemDedupeKey).filter(Boolean))];
    const missingClause = currentKeys.length
      ? `AND (dedupe_key IS NULL OR dedupe_key NOT IN (${currentKeys.map(() => '?').join(', ')}))`
      : '';
    await connection.execute(
      `UPDATE important_items
       SET status = 'cancelled', cancelled_at = ?
       WHERE user_id = ?
         AND source_type = 'network_classroom'
         AND status = 'draft'
         AND user_overridden_at IS NULL
         AND deleted_at IS NULL
         ${missingClause}`,
      [syncedAt, userId, ...currentKeys],
    );
  }

  async function completeRun(claimed, snapshot, finishedAt) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        `SELECT r.id AS run_id, r.status AS run_status, r.connector_generation,
                c.status AS connector_status,
                c.generation, c.user_id
         FROM campus_connector_sync_runs r
         INNER JOIN user_campus_connectors c ON c.id = r.connector_id
         WHERE r.public_id = ? AND r.connector_id = ?
         LIMIT 1
         FOR UPDATE`,
        [claimed.public_id, claimed.connector_id],
      );
      const current = rows[0] || null;
      const active = ['active_unverified', 'active_verified'].includes(current?.connector_status);
      if (
        !current ||
        current.run_status !== 'running' ||
        !active ||
        Number(current.connector_generation) !== Number(claimed.connector_generation) ||
        Number(current.generation) !== Number(claimed.connector_generation)
      ) {
        if (current?.run_status === 'running') {
          await connection.execute(
            `UPDATE campus_connector_sync_runs
             SET status = 'cancelled', finished_at = ?, error_code = 'connection_changed'
             WHERE id = ? AND status = 'running'`,
            [finishedAt, current.run_id],
          );
        }
        await connection.commit();
        return false;
      }

      for (const notification of snapshot.notifications || []) {
        await upsertNotification(connection, current.user_id, notification, finishedAt);
      }
      await upsertSemesterSnapshot(connection, current.user_id, snapshot, finishedAt);
      await upsertSemesterCatalog(connection, current.user_id, snapshot, finishedAt);
      for (const item of snapshot.importantItems || []) {
        await upsertImportantItem(connection, current.user_id, item);
      }
      if (snapshot.status !== 'partial') {
        await cancelMissingImportantItems(
          connection,
          current.user_id,
          snapshot.importantItems,
          finishedAt,
        );
      }
      const status = snapshot.status === 'partial' ? 'partial' : 'succeeded';
      const counts = {
        courses: snapshot.courses?.length || 0,
        homework: snapshot.homework?.length || 0,
        importantItems: snapshot.importantItems?.length || 0,
        notifications: snapshot.notifications?.length || 0,
      };
      const requestCount = normalizeCount(snapshot.evidence?.requestCount);
      const diagnosticContext = buildDiagnosticContext(snapshot);
      await connection.execute(
        `UPDATE campus_connector_sync_runs
         SET status = ?, parser_version = ?, schema_version = ?, request_count = ?,
             result_counts = ?, evidence_json = ?, error_context = ?,
             finished_at = ?, heartbeat_at = ?,
             lease_expires_at = NULL, lease_owner = NULL, error_code = NULL
         WHERE id = ? AND status = 'running'`,
        [
          status,
          String(snapshot.parserVersion || '').slice(0, 64) || null,
          String(snapshot.schemaVersion || '').slice(0, 128) || null,
          requestCount,
          safeJson(counts),
          safeJson(snapshot.evidence),
          safeJson(diagnosticContext),
          finishedAt,
          finishedAt,
          current.run_id,
        ],
      );
      if (status === 'succeeded') {
        await connection.execute(
          `UPDATE user_campus_connectors
           SET status = 'active_verified', last_successful_sync_at = ?,
               last_error_code = NULL
           WHERE id = ? AND generation = ?
             AND status IN ('active_unverified', 'active_verified')`,
          [finishedAt, claimed.connector_id, claimed.connector_generation],
        );
      } else {
        await connection.execute(
          `UPDATE user_campus_connectors
           SET status = 'active_verified', last_error_code = NULL
           WHERE id = ? AND generation = ?
             AND status IN ('active_unverified', 'active_verified')`,
          [claimed.connector_id, claimed.connector_generation],
        );
      }
      await connection.commit();
      return true;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async function failRun(claimed, errorCode, failedAt, { requiresAuthorization = false } = {}) {
    const connection = await pool.getConnection();
    const safeCode = String(errorCode || 'sync_failed').slice(0, 64);
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        `SELECT r.id AS run_id, r.status AS run_status, r.connector_generation,
                c.status AS connector_status, c.generation
         FROM campus_connector_sync_runs r
         INNER JOIN user_campus_connectors c ON c.id = r.connector_id
         WHERE r.public_id = ? AND r.connector_id = ?
         LIMIT 1
         FOR UPDATE`,
        [claimed.public_id, claimed.connector_id],
      );
      const current = rows[0] || null;
      const active = ['active_unverified', 'active_verified'].includes(current?.connector_status);
      const connectionMatches = Boolean(
        current &&
        current.run_status === 'running' &&
        active &&
        Number(current.connector_generation) === Number(claimed.connector_generation) &&
        Number(current.generation) === Number(claimed.connector_generation),
      );
      if (!connectionMatches) {
        if (current?.run_status === 'running') {
          await connection.execute(
            `UPDATE campus_connector_sync_runs
             SET status = 'cancelled', finished_at = ?, heartbeat_at = ?,
                 lease_expires_at = NULL, lease_owner = NULL,
                 error_code = 'connection_changed'
             WHERE id = ? AND status = 'running'`,
            [failedAt, failedAt, current.run_id],
          );
        }
        await connection.commit();
        return false;
      }
      await connection.execute(
        `UPDATE campus_connector_sync_runs
         SET status = 'failed', finished_at = ?, heartbeat_at = ?,
             lease_expires_at = NULL, lease_owner = NULL, error_code = ?
         WHERE id = ? AND status = 'running'`,
        [failedAt, failedAt, safeCode, current.run_id],
      );
      if (requiresAuthorization) {
        await connection.execute(
          `UPDATE user_campus_connectors
           SET status = 'reauthorization_required',
               generation = generation + 1,
               identity_fingerprint = NULL, granted_scopes = NULL,
               credential_type = NULL, credential_ciphertext = NULL,
               credential_iv = NULL, credential_auth_tag = NULL,
               credential_expires_at = NULL,
               reauthorization_required_at = ?,
               last_successful_sync_at = NULL,
               last_error_code = ?
           WHERE id = ? AND generation = ?
             AND status IN ('active_unverified', 'active_verified')`,
          [failedAt, safeCode, claimed.connector_id, claimed.connector_generation],
        );
        await connection.execute(
          `UPDATE campus_connector_sync_runs
           SET status = 'cancelled', finished_at = ?, heartbeat_at = ?,
               lease_expires_at = NULL, lease_owner = NULL,
               error_code = 'connection_changed'
           WHERE connector_id = ? AND id <> ?
             AND status IN ('queued', 'running')`,
          [failedAt, failedAt, claimed.connector_id, current.run_id],
        );
      } else {
        await connection.execute(
          `UPDATE user_campus_connectors
           SET last_error_code = ?
           WHERE id = ? AND generation = ?
             AND status IN ('active_unverified', 'active_verified')`,
          [safeCode, claimed.connector_id, claimed.connector_generation],
        );
      }
      await connection.commit();
      return true;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  return { claimRun, completeRun, failRun };
}

module.exports = { createTsinghuaSyncStore, normalizeDate, safeJson };
