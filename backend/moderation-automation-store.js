const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { buildPrivacyPreview, normalizePrivacyText } = require('./moderation-privacy');
const { normalizePolicyDecision, buildPolicyEvidence } = require('./moderation-policy-decision');
const { POLICY_VERSION } = require('./moderation-policy');
const { sanitizeDiagnostics } = require('./moderation-ai-diagnostics');
const { validateAssessment } = require('./moderation-ai-client');

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const schemas = new WeakMap();
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const parse = (value, fallback = null) =>
  value == null ? fallback : typeof value === 'string' ? JSON.parse(value) : value;
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function uuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw fail('审核记录编号无效。');
  return value;
}
function actor(value) {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value)))
    throw fail('需要审核负责人权限。', 403);
  return Number(value);
}

async function ensureModerationAutomationSchema(pool) {
  if (!schemas.has(pool))
    schemas.set(
      pool,
      (async () => {
        const sql = await fs.readFile(
          path.join(__dirname, '../database/migrations/069_moderation_automation.sql'),
          'utf8',
        );
        for (const statement of sql
          .split(';')
          .map((item) => item.trim())
          .filter(Boolean))
          await pool.execute(statement);
      })().catch((error) => {
        schemas.delete(pool);
        throw error;
      }),
    );
  return schemas.get(pool);
}

function privateSubmission(row) {
  return {
    id: row.id,
    kind: row.kind,
    authorId: row.author_id == null ? null : Number(row.author_id),
    payload: Number(row.expired) ? null : parse(row.payload_json),
    attachmentIds: Number(row.expired) ? [] : parse(row.attachment_ids_json, []),
    contentHash: row.content_hash,
    status: row.status,
    version: Number(row.version),
    title: Number(row.expired) ? '审核内容已到期' : parse(row.payload_json, {}).title || '评论',
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    author: { id: row.author_id == null ? null : String(row.author_id), username: '' },
    decidedBy: row.decided_by == null ? null : String(row.decided_by),
    decidedAt: row.decided_at,
    reason: Number(row.expired) ? '' : row.decision_reason || '',
    publishedId: row.published_id == null ? null : String(row.published_id),
    publishedUrl: row.published_url || '',
  };
}

function createModerationAutomationStore({
  pool,
  withDatabaseTransaction,
  publishSubmission,
  onPublished,
  notifications,
  isEnabled = () => false,
  logger = console,
  leaseMs = 60000,
}) {
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > 300000)
    throw fail('自动审核租约配置无效。');
  const enabled = async () => Boolean(await isEnabled());
  const transactOnce =
    withDatabaseTransaction ||
    (async (callback) => {
      const db = await pool.getConnection();
      try {
        await db.beginTransaction();
        const result = await callback(db);
        await db.commit();
        return result;
      } catch (error) {
        await db.rollback();
        throw error;
      } finally {
        db.release();
      }
    });
  async function transact(callback) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await transactOnce(callback);
      } catch (error) {
        if (!['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error.code) || attempt === 2)
          throw error;
      }
    }
    throw fail('自动审核事务暂不可用。', 503);
  }
  async function control(db = pool, lock = false) {
    const [[row]] = await db.execute(
      `SELECT paused, revision FROM moderation_auto_control WHERE id = 1${lock === 'exclusive' ? ' FOR UPDATE' : lock ? ' FOR SHARE' : ''}`,
    );
    if (!row) throw fail('自动审核控制配置暂不可用。', 503);
    return { paused: Boolean(Number(row.paused)), revision: Number(row.revision) };
  }
  async function setPaused({ actorId, paused }) {
    if (typeof paused !== 'boolean') throw fail('暂停状态无效。');
    const userId = actor(actorId);
    return transact(async (db) => {
      const [[admin]] = await db.execute(
        'SELECT id FROM users WHERE id = ? AND is_admin = 1 FOR SHARE',
        [userId],
      );
      if (!admin) throw fail('需要管理员权限。', 403);
      const [[row]] = await db.execute(
        'SELECT paused, revision FROM moderation_auto_control WHERE id = 1 FOR UPDATE',
      );
      if (!row) throw fail('自动审核控制配置暂不可用。', 503);
      if (Boolean(Number(row.paused)) !== paused)
        await db.execute(
          'UPDATE moderation_auto_control SET paused = ?, revision = revision + 1, changed_by = ? WHERE id = 1',
          [paused ? 1 : 0, userId],
        );
      return control(db);
    });
  }
  async function reviewer(db, reviewerId) {
    const id = actor(reviewerId);
    const [[row]] = await db.execute(
      'SELECT user_id FROM moderation_reviewers WHERE user_id = ? AND active = 1 FOR SHARE',
      [id],
    );
    if (!row) throw fail('需要审核负责人权限。', 403);
    return id;
  }
  async function readSubmission(db, id) {
    const [[row]] = await db.execute(
      'SELECT *, (expires_at <= NOW(3)) AS expired FROM moderation_submissions WHERE id = ? FOR UPDATE',
      [uuid(id)],
    );
    return row;
  }
  async function readJob(db, id) {
    const [[job]] = await db.execute(
      'SELECT *, (expires_at <= NOW(3)) AS expired, (lease_until <= NOW(3)) AS lease_expired FROM moderation_auto_jobs WHERE id = ? FOR UPDATE',
      [uuid(id)],
    );
    return job;
  }
  const current = (row, job) =>
    Boolean(
      row &&
      job &&
      row.status === 'pending' &&
      Number(row.version) === Number(job.submission_version) &&
      row.content_hash === job.content_hash &&
      !Number(row.expired) &&
      !row.evidence_purged_at &&
      row.payload_json &&
      !Number(job.expired) &&
      !job.purged_at,
    );
  const ownLease = (job, claimed) =>
    job &&
    job.state === 'running' &&
    job.lease_token === claimed.token &&
    Number(job.submission_version) === claimed.submissionVersion &&
    job.content_hash === claimed.contentHash;

  async function notify(db, row, job, state) {
    const [reviewers] = await db.execute(
      'SELECT user_id FROM moderation_reviewers WHERE active = 1 ORDER BY user_id FOR SHARE',
    );
    const recipients = [
      ...new Set([
        ...reviewers.map((item) => Number(item.user_id)),
        ...(row.author_id ? [Number(row.author_id)] : []),
      ]),
    ].sort((a, b) => a - b);
    const data = {
      submissionId: row.id,
      status: state,
      recipients,
      title:
        state === 'published'
          ? '讨论内容已自动发布，请负责人复核'
          : state === 'withdrawn'
            ? '讨论内容已由负责人撤回'
            : '讨论内容需要负责人复核',
      body:
        state === 'published'
          ? '请在审核工作台查看结果；负责人可在发现问题后撤回。'
          : '请打开审核工作台查看处理状态。',
      link: `/moderation?id=${encodeURIComponent(row.id)}`,
      eventKey: `moderation-auto:${job.id}:${state}`,
    };
    if (notifications?.notifyModeration) await notifications.notifyModeration(data, db);
    else
      for (const recipient of recipients)
        await db.execute(
          `INSERT INTO community_notifications (recipient_id, actor_id, kind, title, body, link, event_key) VALUES (?, NULL, 'moderation', ?, ?, ?, ?) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
          [recipient, data.title, data.body, data.link, data.eventKey],
        );
  }
  async function terminate(db, row, job, state, reason) {
    await db.execute(
      'UPDATE moderation_auto_jobs SET state = ?, reason_code = ?, lease_token = NULL, lease_until = NULL WHERE id = ?',
      [state, reason, job.id],
    );
    if (row && state === 'review') await notify(db, row, job, state);
    return { state, reasonCode: reason, submissionId: job.submission_id };
  }
  async function enqueue(db, submission) {
    if (!(await enabled()) || submission.replayed || submission.status !== 'pending') return false;
    const id = uuid(submission.id);
    if (
      !Number.isSafeInteger(submission.version) ||
      submission.version < 1 ||
      !/^[a-f0-9]{64}$/.test(submission.contentHash)
    )
      throw fail('自动审核稿件无效。');
    // Called only by the new submission transaction; there is deliberately no backfill scan.
    const [inserted] = await db.execute(
      `INSERT IGNORE INTO moderation_auto_jobs (id, submission_id, submission_version, content_hash, expires_at) SELECT ?, id, version, content_hash, expires_at FROM moderation_submissions WHERE id = ? AND status = 'pending' AND version = ? AND content_hash = ? AND expires_at > NOW(3)`,
      [crypto.randomUUID(), id, submission.version, submission.contentHash],
    );
    return Boolean(inserted.affectedRows);
  }
  async function claim() {
    if (!(await enabled())) return null;
    const [candidates] = await pool.execute(
      "SELECT id, submission_id FROM moderation_auto_jobs WHERE state = 'queued' ORDER BY created_at, id LIMIT 10",
    );
    for (const candidate of candidates) {
      const outcome = await transact(async (db) => {
        const state = await control(db, 'exclusive');
        if (state.paused || !(await enabled())) return null;
        const [[running]] = await db.execute(
          "SELECT id FROM moderation_auto_jobs WHERE state = 'running' LIMIT 1",
        );
        if (running) return null;
        const row = await readSubmission(db, candidate.submission_id);
        const job = await readJob(db, candidate.id);
        if (!job || job.state !== 'queued') return null;
        if (!current(row, job)) {
          await terminate(db, row, job, 'cancelled', 'submission_changed');
          return null;
        }
        const [reviewers] = await db.execute(
          'SELECT user_id FROM moderation_reviewers WHERE active = 1 ORDER BY user_id FOR SHARE',
        );
        if (!reviewers.length) {
          await terminate(db, row, job, 'review', 'no_reviewers');
          return null;
        }
        const token = crypto.randomUUID();
        await db.execute(
          "UPDATE moderation_auto_jobs SET state = 'running', lease_token = ?, lease_until = TIMESTAMPADD(MICROSECOND, ?, NOW(3)), attempts = attempts + 1, control_revision = ?, model = 'qwen3.6-27b', policy_version = ? WHERE id = ?",
          [token, leaseMs * 1000, state.revision, POLICY_VERSION, job.id],
        );
        return {
          id: job.id,
          submissionId: row.id,
          submissionVersion: Number(row.version),
          contentHash: row.content_hash,
          token,
          controlRevision: state.revision,
        };
      });
      if (outcome) return outcome;
    }
    return null;
  }
  async function localPreview(db, row) {
    const payload = parse(row.payload_json);
    const attachments = parse(row.attachment_ids_json, []);
    if (
      !payload ||
      typeof payload.content !== 'string' ||
      (payload.title !== undefined && typeof payload.title !== 'string') ||
      !Array.isArray(attachments)
    )
      throw fail('稿件数据暂不可用。', 503);
    const text = normalizePrivacyText(`${payload.title || ''}\n${payload.content}`);
    const [identities] = await db.execute(
      `SELECT full_name, student_id, email FROM users WHERE (CHAR_LENGTH(TRIM(full_name)) > 0 AND LOCATE(full_name, ?) > 0) OR (CHAR_LENGTH(TRIM(student_id)) > 0 AND LOCATE(student_id, ?) > 0) OR (CHAR_LENGTH(TRIM(email)) > 0 AND LOCATE(email, ?) > 0) LIMIT 501`,
      [text, text, text],
    );
    if (identities.length > 500) throw fail('目录命中数量过多，本次转人工审核。', 409);
    const preview = buildPrivacyPreview({
      title: payload.title || '',
      content: payload.content,
      identities,
      attachmentCount: attachments.length,
    });
    const meta = {
      counts: preview.counts,
      imageCount: preview.imageCount,
      redactorVersion: preview.redactorVersion,
      inputHash: hash({ title: preview.title, content: preview.content }),
    };
    return { preview, meta };
  }
  async function prepare(claimed) {
    return transact(async (db) => {
      const state = await control(db, true);
      const row = await readSubmission(db, claimed.submissionId);
      const job = await readJob(db, claimed.id);
      if (!ownLease(job, claimed)) return null;
      if (!current(row, job)) {
        await terminate(db, row, job, 'cancelled', 'submission_changed');
        return null;
      }
      if (
        state.paused ||
        state.revision !== Number(job.control_revision) ||
        !(await enabled()) ||
        Number(job.lease_expired)
      ) {
        await terminate(db, row, job, 'review', 'worker_paused');
        return null;
      }
      const { preview, meta } = await localPreview(db, row);
      const freshRow = await readSubmission(db, row.id);
      const freshJob = await readJob(db, job.id);
      if (!current(freshRow, freshJob)) {
        await terminate(db, row, job, 'cancelled', 'submission_changed');
        return null;
      }
      if (Number(freshJob.lease_expired) || !(await enabled())) {
        await terminate(
          db,
          row,
          job,
          'review',
          Number(freshJob.lease_expired) ? 'lease_expired' : 'worker_paused',
        );
        return null;
      }
      const [updated] = await db.execute(
        "UPDATE moderation_auto_jobs SET input_meta_json = ? WHERE id = ? AND state = 'running' AND lease_token = ? AND lease_until > NOW(3) AND expires_at > NOW(3)",
        [JSON.stringify(meta), job.id, claimed.token],
      );
      if (!updated.affectedRows) {
        await terminate(db, row, job, 'review', 'lease_expired');
        return null;
      }
      return {
        submissionId: row.id,
        version: Number(row.version),
        contentHash: row.content_hash,
        inputHash: meta.inputHash,
        ...preview,
      };
    });
  }

  function sanitizeResult(result, meta, row, job, preview) {
    let assessment = null;
    try {
      if (
        !result?.manualReview &&
        meta &&
        preview &&
        result?.inputHash === meta.inputHash &&
        result?.model === job.model &&
        result?.policyVersion === job.policy_version &&
        result?.policyVersion === POLICY_VERSION &&
        Number.isSafeInteger(result?.settingsRevision) &&
        result.settingsRevision >= 0
      )
        assessment = validateAssessment(result.assessment, preview);
    } catch {
      /* An invalid assessment stays manual; rejected free text is not retained. */
    }
    const decision = normalizePolicyDecision(assessment, {
      hasImages: !meta || meta.imageCount > 0,
      redactionCounts: meta?.counts || {},
    });
    const valid =
      !decision.reasons.includes('invalid_assessment') && result?.policyVersion === POLICY_VERSION;
    const safeAssessment = valid
      ? {
          decision: assessment.decision,
          categories: assessment.categories,
          supportPriority: assessment.supportPriority,
          uncertainties: assessment.uncertainties,
          ruleMatches: assessment.ruleMatches.map((match) => ({
            ruleId: match.ruleId,
            evidence: match.evidence,
            explanation: match.explanation,
          })),
          reason: assessment.reason,
          supportReason: assessment.supportReason,
        }
      : null;
    const stored = {
      submissionId: row.id,
      version: Number(job.submission_version),
      contentHash: job.content_hash,
      source: 'automatic',
      executor: 'moderation-agent',
      inputMode: 'redacted',
      model:
        typeof result?.model === 'string' &&
        /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(result.model)
          ? result.model
          : null,
      settingsRevision:
        Number.isSafeInteger(result?.settingsRevision) && result.settingsRevision >= 0
          ? result.settingsRevision
          : null,
      policyVersion: POLICY_VERSION,
      redactorVersion: meta?.redactorVersion || null,
      elapsedMs:
        Number.isSafeInteger(result?.elapsedMs) && result.elapsedMs >= 0 ? result.elapsedMs : null,
      imageCount: meta?.imageCount || 0,
      imagesReviewed: false,
      automaticPublication: false,
      assessment: safeAssessment,
      policyDecision: valid ? decision : normalizePolicyDecision(null),
      policyEvidence: valid ? buildPolicyEvidence(assessment) : [],
    };
    if (!valid || result?.manualReview)
      stored.manualReview = {
        required: true,
        validation:
          result?.manualReview?.validation === 'not_attempted' ? 'not_attempted' : 'failed',
        ...(sanitizeDiagnostics(result?.manualReview?.diagnostics)
          ? { diagnostics: sanitizeDiagnostics(result.manualReview.diagnostics) }
          : {}),
      };
    const codes = [
      'image_requires_review',
      'provider_failure',
      'configuration_invalid',
      'snapshot_invalid',
      'worker_stopped',
      'worker_paused',
      'assessment_invalid',
    ];
    if (codes.includes(result?.automationReason)) stored.automationReason = result.automationReason;
    return stored;
  }

  async function finish(claimed, result, { canApply = () => true } = {}) {
    const outcome = await transact(async (db) => {
      const state = await control(db, true);
      const row = await readSubmission(db, claimed.submissionId);
      const job = await readJob(db, claimed.id);
      if (!ownLease(job, claimed)) return { state: job?.state || 'cancelled', applied: false };
      if (!current(row, job))
        return {
          ...(await terminate(db, row, job, 'cancelled', 'submission_changed')),
          applied: false,
        };
      const meta = parse(job.input_meta_json);
      let preview = null;
      try {
        if (meta) {
          const rebuilt = await localPreview(db, row);
          if (
            rebuilt.meta.inputHash === meta.inputHash &&
            hash(Object.entries(rebuilt.meta.counts).sort()) ===
              hash(Object.entries(meta.counts || {}).sort()) &&
            rebuilt.meta.imageCount === meta.imageCount &&
            rebuilt.meta.redactorVersion === meta.redactorVersion
          )
            preview = rebuilt.preview;
        }
      } catch {
        /* Local snapshot failure must never permit publication. */
      }
      const stored = sanitizeResult(result, meta, row, job, preview);
      const [reviewers] = await db.execute(
        'SELECT user_id FROM moderation_reviewers WHERE active = 1 ORDER BY user_id FOR SHARE',
      );
      const paused =
        state.paused ||
        state.revision !== Number(job.control_revision) ||
        !(await enabled()) ||
        !canApply();
      let target = 'review';
      let reason = paused
        ? 'worker_paused'
        : Number(job.lease_expired)
          ? 'lease_expired'
          : !reviewers.length
            ? 'no_reviewers'
            : 'policy_review';
      if (!paused && !Number(job.lease_expired) && reviewers.length && meta && stored.assessment) {
        if (stored.policyDecision.recommendedAction === 'block') {
          target = 'blocked';
          reason = 'clear_rule_violation';
        }
        if (
          stored.policyDecision.recommendedAction === 'allow' &&
          stored.assessment.supportPriority === 'none'
        ) {
          target = 'published';
          reason = 'no_text_risk';
        }
        if (stored.assessment.supportPriority !== 'none') reason = 'support_requires_review';
      }
      let published;
      if (target === 'published') {
        const [attachments] = await db.execute(
          'SELECT id FROM moderation_attachments WHERE submission_id = ? ORDER BY id FOR UPDATE',
          [row.id],
        );
        if (
          attachments.length ||
          parse(row.attachment_ids_json, []).length ||
          meta.imageCount > 0
        ) {
          target = 'review';
          reason = 'images_not_reviewed';
        } else {
          if (typeof publishSubmission !== 'function') throw fail('发布服务暂不可用。', 503);
          published = await publishSubmission(db, privateSubmission(row));
          if (
            !published ||
            !Number.isSafeInteger(Number(published.publishedId)) ||
            Number(published.publishedId) < 1 ||
            typeof published.publishedUrl !== 'string' ||
            !/^\/(?!\/)[^\r\n\\]*$/.test(published.publishedUrl) ||
            published.publishedUrl.length > 512
          )
            throw fail('发布结果无效。', 500);
          // Publisher writes and this status change roll back together if the deadline is crossed.
          if (!canApply() || !(await enabled()))
            throw fail('自动审核已暂停，本次发布未生效。', 409);
          const [updated] = await db.execute(
            "UPDATE moderation_submissions SET status = 'approved', version = version + 1, decided_by = NULL, decided_at = NOW(3), decision_reason = '机器审核通过，负责人可复核撤回。', published_id = ?, published_url = ? WHERE id = ? AND status = 'pending' AND version = ? AND content_hash = ? AND expires_at > NOW(3) AND EXISTS (SELECT 1 FROM moderation_auto_jobs WHERE id = ? AND state = 'running' AND lease_token = ? AND lease_until > NOW(3) AND expires_at > NOW(3))",
            [
              published.publishedId,
              published.publishedUrl,
              row.id,
              job.submission_version,
              job.content_hash,
              job.id,
              claimed.token,
            ],
          );
          if (!updated.affectedRows) throw fail('审核记录已到期或状态已变化。', 409);
          stored.automaticPublication = true;
        }
      }
      await db.execute(
        'UPDATE moderation_auto_jobs SET state = ?, reason_code = ?, result_json = ?, model = ?, settings_revision = ?, policy_version = ?, published_version = ?, lease_token = NULL, lease_until = NULL WHERE id = ?',
        [
          target,
          reason,
          JSON.stringify(stored),
          stored.model,
          stored.settingsRevision,
          stored.policyVersion,
          target === 'published' ? Number(row.version) + 1 : null,
          job.id,
        ],
      );
      await notify(db, row, job, target);
      const submission = privateSubmission(await readSubmission(db, row.id));
      if (target === 'published' && !canApply())
        throw fail('自动审核已停止，本次发布未生效。', 409);
      return {
        state: target,
        reasonCode: reason,
        applied: true,
        result: stored,
        submission,
      };
    });
    if (outcome.state === 'published' && outcome.applied && onPublished)
      Promise.resolve()
        .then(() => onPublished(outcome.submission))
        .catch(() => logger.error('Automatic moderation follow-up failed'));
    return outcome;
  }

  async function recover() {
    const [candidates] = await pool.execute(
      "SELECT id, submission_id FROM moderation_auto_jobs WHERE state = 'running' AND lease_until <= NOW(3) ORDER BY lease_until LIMIT 100",
    );
    for (const item of candidates)
      await transact(async (db) => {
        const row = await readSubmission(db, item.submission_id);
        const job = await readJob(db, item.id);
        if (!job || job.state !== 'running' || !Number(job.lease_expired)) return;
        await terminate(db, row, job, current(row, job) ? 'review' : 'cancelled', 'lease_expired');
      });
    return candidates.length;
  }
  async function purge() {
    const [candidates] = await pool.execute(
      'SELECT id, submission_id FROM moderation_auto_jobs WHERE purged_at IS NULL AND expires_at <= NOW(3) ORDER BY expires_at LIMIT 100',
    );
    for (const item of candidates)
      await transact(async (db) => {
        await readSubmission(db, item.submission_id);
        const job = await readJob(db, item.id);
        if (!job || !Number(job.expired) || job.purged_at) return;
        await db.execute(
          "UPDATE moderation_auto_jobs SET result_json = NULL, input_meta_json = NULL, withdrawal_reason = NULL, lease_token = NULL, lease_until = NULL, state = IF(state IN ('queued', 'running'), 'cancelled', state), purged_at = NOW(3) WHERE id = ?",
          [job.id],
        );
      });
    return candidates.length;
  }
  async function get({ id, reviewerId }) {
    return transact(async (db) => {
      await reviewer(db, reviewerId);
      const row = await readSubmission(db, id);
      if (!row) throw fail('审核记录不存在。', 404);
      const [[job]] = await db.execute(
        'SELECT *, (expires_at <= NOW(3)) AS expired FROM moderation_auto_jobs WHERE submission_id = ? ORDER BY submission_version DESC LIMIT 1',
        [uuid(id)],
      );
      if (!job) return null;
      const expired = Boolean(Number(job.expired) || job.purged_at || Number(row.expired));
      return {
        id: job.id,
        submissionId: row.id,
        submissionVersion: Number(job.submission_version),
        state: job.state,
        attempts: Number(job.attempts),
        createdAt: job.created_at,
        updatedAt: job.updated_at,
        expiresAt: job.expires_at,
        model: job.model,
        settingsRevision: job.settings_revision == null ? null : Number(job.settings_revision),
        policyVersion: job.policy_version,
        reasonCode: job.reason_code,
        result: expired ? null : parse(job.result_json),
        expired,
        canWithdraw:
          !expired &&
          job.state === 'published' &&
          row.status === 'approved' &&
          row.decided_by == null &&
          Number(row.version) === Number(job.published_version),
        withdrawal:
          !expired && job.state === 'withdrawn'
            ? {
                reason: job.withdrawal_reason,
                reviewerId: job.withdrawn_by == null ? null : String(job.withdrawn_by),
              }
            : null,
      };
    });
  }
  async function withdraw({ id, reviewerId, expectedVersion, reason, requestId }) {
    uuid(id);
    if (
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 1 ||
      typeof reason !== 'string' ||
      !reason.trim() ||
      reason.length > 1000 ||
      typeof requestId !== 'string' ||
      !/^[A-Za-z0-9_-]{8,64}$/.test(requestId)
    )
      throw fail('请填写有效的撤回原因及版本。');
    const userId = actor(reviewerId);
    const signature = hash({ id, expectedVersion, reason: reason.trim() });
    return transact(async (db) => {
      await reviewer(db, userId);
      const row = await readSubmission(db, id);
      if (!row) throw fail('审核记录不存在。', 404);
      const [[candidate]] = await db.execute(
        'SELECT id FROM moderation_auto_jobs WHERE submission_id = ? ORDER BY submission_version DESC LIMIT 1',
        [id],
      );
      const job = candidate ? await readJob(db, candidate.id) : null;
      if (job?.withdrawal_request_id === requestId && Number(job.withdrawn_by) === userId) {
        if (job.withdrawal_hash !== signature) throw fail('相同请求编号对应不同撤回决定。', 409);
        return { ...privateSubmission(row), replayed: true };
      }
      if (
        !job ||
        job.state !== 'published' ||
        row.status !== 'approved' ||
        row.decided_by != null ||
        Number(row.version) !== expectedVersion ||
        Number(job.published_version) !== expectedVersion ||
        row.content_hash !== job.content_hash ||
        !row.published_id
      )
        throw fail('内容已变化，或并非自动发布稿件。', 409);
      if (Number(row.expired) || Number(job.expired) || row.evidence_purged_at || job.purged_at)
        throw fail('审核材料已到期，请通过讨论区管理功能处理。', 410);
      if (row.kind === 'post') {
        const [[post]] = await db.execute(
          'SELECT id, pid FROM discussion_posts WHERE id = ? FOR UPDATE',
          [row.published_id],
        );
        if (!post) throw fail('发布内容已不存在。', 409);
        await db.execute(
          'UPDATE discussion_posts SET is_deleted = 1, deleted_at = NOW(), deleted_by = ?, is_pinned = 0, pinned_at = NULL, pinned_by = NULL, is_featured = 0, featured_at = NULL, featured_by = NULL WHERE id = ?',
          [userId, post.id],
        );
        await db.execute(
          "UPDATE community_notifications SET title = '讨论状态已更新', body = '这篇讨论已删除或暂不可见。', link = '/discussion' WHERE link LIKE '/discussion?post=%' AND SUBSTRING_INDEX(SUBSTRING_INDEX(link, 'post=', -1), '#', 1) IN (?, ?)",
          [encodeURIComponent(post.pid || String(post.id)), String(post.id)],
        );
      } else {
        const [[comment]] = await db.execute(
          'SELECT id FROM discussion_comments WHERE id = ? FOR UPDATE',
          [row.published_id],
        );
        if (!comment) throw fail('发布内容已不存在。', 409);
        await db.execute(
          'UPDATE discussion_comments SET is_deleted = 1, deleted_at = NOW(), deleted_by = ?, is_featured = 0, featured_at = NULL, featured_by = NULL WHERE id = ?',
          [userId, comment.id],
        );
        await db.execute(
          "UPDATE community_notifications SET title = '讨论状态已更新', body = '这条评论已删除或暂不可见。', link = '/discussion' WHERE link LIKE '/discussion?post=%' AND SUBSTRING_INDEX(link, '#comment-', -1) = ?",
          [String(comment.id)],
        );
      }
      await db.execute(
        "UPDATE moderation_submissions SET status = 'rejected', version = version + 1, decided_by = ?, decided_at = NOW(3), decision_reason = ?, published_url = NULL WHERE id = ?",
        [userId, reason.trim(), id],
      );
      await db.execute(
        "UPDATE moderation_auto_jobs SET state = 'withdrawn', reason_code = 'reviewer_withdrawal', withdrawn_by = ?, withdrawal_request_id = ?, withdrawal_hash = ?, withdrawal_reason = ? WHERE id = ?",
        [userId, requestId, signature, reason.trim(), job.id],
      );
      await notify(db, row, job, 'withdrawn');
      return { ...privateSubmission(await readSubmission(db, id)), replayed: false };
    });
  }
  return {
    ensureSchema: () => ensureModerationAutomationSchema(pool),
    enqueue,
    claim,
    prepare,
    finish,
    recover,
    purge,
    get,
    withdraw,
    control: () => control(),
    setPaused,
  };
}

module.exports = { ensureModerationAutomationSchema, createModerationAutomationStore };
