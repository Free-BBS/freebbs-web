const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { buildPrivacyPreview, normalizePrivacyText } = require('./moderation-privacy');
const { normalizePolicyDecision, buildPolicyEvidence } = require('./moderation-policy-decision');
const { POLICY_VERSION } = require('./moderation-policy');
const { sanitizeDiagnostics } = require('./moderation-ai-diagnostics');
const { validateAssessment } = require('./moderation-ai-client');
const { getReviewFocus, mergeReviewFocus } = require('./moderation-review-focus');
const {
  sendModerationNotice,
  notifyAuthor,
  FOCUSED_REVIEW_NOTICE,
  purgeLegacyModerationNotificationTopics,
} = require('./moderation-notifications');

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
        for (const name of ['069_moderation_automation.sql', '070_moderation_image_reviews.sql']) {
          const sql = await fs.readFile(
            path.join(__dirname, '../database/migrations', name),
            'utf8',
          );
          for (const statement of sql
            .split(';')
            .map((item) => item.trim())
            .filter(Boolean))
            await pool.execute(statement);
        }
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
  readImages,
  requiredNoticeVersion = null,
  isEnabled = () => false,
  logger = console,
  leaseMs = 300000,
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

  async function notify(db, row, job, state, result = null) {
    const [reviewers] = await db.execute(
      'SELECT user_id FROM moderation_reviewers WHERE active = 1 ORDER BY user_id FOR SHARE',
    );
    const recipients = reviewers.map((item) => Number(item.user_id));
    const imagePublished = state === 'published' && result?.imagesReviewed && result.imageCount > 0;
    const focus = result?.reviewFocus?.political || result?.reviewFocus?.psychological;
    const data = {
      submissionId: row.id,
      status: state,
      recipients,
      title: imagePublished
        ? '含图内容已自动发布，请负责人单独复核图片'
        : focus && state !== 'published' && state !== 'withdrawn'
          ? FOCUSED_REVIEW_NOTICE.title
          : state === 'published'
            ? '讨论内容已自动发布，请负责人复核'
            : state === 'withdrawn'
              ? '讨论内容已由负责人撤回'
              : '讨论内容需要负责人复核',
      body: imagePublished
        ? '请逐张检查图片，确认后标记已复核；发现问题可撤回整份内容。'
        : focus && state !== 'published' && state !== 'withdrawn'
          ? FOCUSED_REVIEW_NOTICE.body
          : state === 'published'
            ? '请在审核工作台查看结果；负责人可在发现问题后撤回。'
            : '请打开审核工作台查看处理状态。',
      link: `/moderation?id=${encodeURIComponent(row.id)}`,
      eventKey: `moderation-auto:${job.id}:${state}`,
    };
    await sendModerationNotice(db, notifications, data);
    if (['review', 'blocked', 'withdrawn'].includes(state))
      await notifyAuthor(db, notifications, {
        id: row.id,
        authorId: row.author_id,
        // A machine block is still waiting for a human decision, never a final rejection.
        status: state === 'withdrawn' ? 'withdrawn' : 'pending',
      });
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
    // Serialize admission against pause changes. Paused submissions enter the
    // manual queue directly and never get backfilled when automation resumes.
    if ((await control(db, true)).paused) return false;
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
  async function loadBoundImages(db, row, attachmentIds) {
    if (
      !Array.isArray(attachmentIds) ||
      attachmentIds.length > 12 ||
      attachmentIds.some((id) => typeof id !== 'string' || !UUID.test(id)) ||
      new Set(attachmentIds).size !== attachmentIds.length
    )
      throw fail('审核附件编号不符合预期。', 409);
    const [bound] = await db.execute(
      'SELECT *, (expires_at <= NOW(3)) AS expired FROM moderation_attachments WHERE submission_id = ? ORDER BY id FOR UPDATE',
      [row.id],
    );
    if (
      bound.length !== attachmentIds.length ||
      bound.some((item) => !attachmentIds.includes(item.id))
    )
      throw fail('审核附件绑定已变化。', 409);
    const ordered = attachmentIds.map((id) => bound.find((item) => item.id === id));
    for (const item of ordered) {
      if (
        !item ||
        item.author_id == null ||
        Number(item.author_id) !== Number(row.author_id) ||
        item.submission_id !== row.id ||
        item.bound_content_hash !== row.content_hash ||
        item.published_id != null ||
        item.purged_at ||
        Number(item.expired) ||
        item.file_name !== `${item.id}.webp` ||
        item.mime_type !== 'image/webp' ||
        !Number.isSafeInteger(Number(item.byte_size)) ||
        Number(item.byte_size) < 1 ||
        Number(item.byte_size) > 4 * 1024 * 1024 ||
        !/^[a-f0-9]{64}$/.test(item.sha256)
      )
        throw fail('审核附件状态已变化。', 409);
    }
    if (!ordered.length) return { images: [], descriptors: [] };
    if (typeof readImages !== 'function') throw fail('图片读取服务暂不可用。', 503);
    const loaded = await readImages(ordered.map((item) => ({ ...item })));
    if (
      !Array.isArray(loaded) ||
      loaded.length !== ordered.length ||
      new Set(loaded.map((item) => item?.id)).size !== ordered.length
    )
      throw fail('未取得完整审核图片。', 409);
    const images = ordered.map((item) => {
      const image = loaded.find((candidate) => candidate?.id === item.id);
      if (
        !image ||
        image.sha256 !== item.sha256 ||
        image.mimeType !== item.mime_type ||
        typeof image.dataBase64 !== 'string' ||
        !image.dataBase64 ||
        image.dataBase64.length > 6 * 1024 * 1024 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(image.dataBase64)
      )
        throw fail('审核图片内容无法验证。', 409);
      const bytes = Buffer.from(image.dataBase64, 'base64');
      if (
        bytes.length !== Number(item.byte_size) ||
        bytes.toString('base64') !== image.dataBase64 ||
        crypto.createHash('sha256').update(bytes).digest('hex') !== item.sha256 ||
        bytes.toString('ascii', 0, 4) !== 'RIFF' ||
        bytes.toString('ascii', 8, 12) !== 'WEBP'
      )
        throw fail('审核图片内容已变化。', 409);
      return {
        id: item.id,
        sha256: item.sha256,
        mimeType: item.mime_type,
        dataBase64: image.dataBase64,
      };
    });
    const descriptors = ordered.map((item) => ({
      id: item.id,
      sha256: item.sha256,
      mimeType: item.mime_type,
      byteSize: Number(item.byte_size),
      fileName: item.file_name,
    }));
    return { images, descriptors };
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
    const { images, descriptors } = await loadBoundImages(db, row, attachments);
    // These are already verified local pixels, not user-provided external links.
    // Keep captions while removing opaque attachment locations from the text copy.
    const reviewContent = attachments.reduce(
      (content, id, index) =>
        content.replaceAll(`/api/moderation/attachments/${id}`, `【本帖图片_${index + 1}】`),
      payload.content,
    );
    const text = normalizePrivacyText(`${payload.title || ''}\n${reviewContent}`);
    const [identities] = await db.execute(
      `SELECT full_name, student_id, email FROM users WHERE (CHAR_LENGTH(TRIM(full_name)) > 0 AND LOCATE(full_name, ?) > 0) OR (CHAR_LENGTH(TRIM(student_id)) > 0 AND LOCATE(student_id, ?) > 0) OR (CHAR_LENGTH(TRIM(email)) > 0 AND LOCATE(email, ?) > 0) LIMIT 501`,
      [text, text, text],
    );
    if (identities.length > 500) throw fail('目录命中数量过多，本次转人工审核。', 409);
    const preview = buildPrivacyPreview({
      title: payload.title || '',
      content: reviewContent,
      identities,
      attachmentCount: attachments.length,
    });
    // Capture routing signals before privacy redaction can replace a name.
    // Only fixed dictionary matches travel with the worker snapshot, not an
    // additional copy of the unredacted source or the student's identity.
    const reviewFocus = getReviewFocus({ title: payload.title || '', content: reviewContent });
    const meta = {
      counts: preview.counts,
      imageCount: preview.imageCount,
      redactorVersion: preview.redactorVersion,
      images: descriptors,
      inputHash: hash({ title: preview.title, content: preview.content, images: descriptors }),
    };
    return { preview: { ...preview, images, reviewFocus }, meta };
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
        requiredNoticeVersion &&
        parse(row.payload_json, {}).moderationNoticeVersion !== requiredNoticeVersion
      ) {
        await terminate(db, row, job, 'review', 'notice_required');
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
    // Re-evaluate the locked original row. Neither redaction nor a worker's
    // supplied reviewFocus=false can waive a mandatory human-review route.
    const original = parse(row.payload_json, {});
    const originalFocus = getReviewFocus({
      title: original.title || '',
      content: original.content || '',
    });
    if (
      !result?.manualReview &&
      preview &&
      meta &&
      result?.textResult &&
      result?.inputHash === meta.inputHash &&
      result?.model === job.model &&
      result?.policyVersion === job.policy_version &&
      result.policyVersion === POLICY_VERSION
    ) {
      try {
        const { buildAutomaticResult } = require('./moderation-automation-result');
        const rebuilt = buildAutomaticResult({
          textResult: result.textResult,
          imageResults: result.imageResults || [],
          snapshot: {
            ...preview,
            reviewFocus: originalFocus,
            submissionId: row.id,
            version: Number(job.submission_version),
            contentHash: job.content_hash,
            inputHash: meta.inputHash,
          },
          elapsedMs: result.elapsedMs,
        });
        if (
          rebuilt.model !== job.model ||
          rebuilt.policyVersion !== POLICY_VERSION ||
          rebuilt.inputHash !== meta.inputHash ||
          !Number.isSafeInteger(rebuilt.settingsRevision) ||
          rebuilt.settingsRevision < 0 ||
          (meta.imageCount > 0 &&
            rebuilt.policyDecision?.recommendedAction === 'allow' &&
            !rebuilt.imagesReviewed)
        )
          throw fail('机器图片审核结果无效。', 409);
        return {
          ...rebuilt,
          submissionId: row.id,
          version: Number(job.submission_version),
          contentHash: job.content_hash,
          source: 'automatic',
          executor: 'moderation-agent',
          inputMode: 'redacted',
          redactorVersion: meta.redactorVersion,
          imageCount: meta.imageCount,
          automaticPublication: false,
        };
      } catch {
        // Keep an invalid combined assessment manual; never fall back to its text-only allow.
        result = {
          ...result,
          assessment: null,
          manualReview: { required: true, validation: 'failed' },
        };
      }
    }
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
        assessment = validateAssessment(result.assessment, preview, { requireReviewTopics: true });
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
          reviewTopics: assessment.reviewTopics,
        }
      : null;
    const diagnostics = sanitizeDiagnostics(result?.manualReview?.diagnostics);
    const reviewSignal = diagnostics?.reviewSignal;
    const reviewFocus = mergeReviewFocus(
      originalFocus,
      getReviewFocus({
        title: preview?.title || '',
        content: preview?.content || '',
        assessments: valid
          ? [assessment]
          : reviewSignal
            ? [
                {
                  categories: reviewSignal.reportedCategories,
                  ruleMatches: reviewSignal.reportedRuleIds.map((ruleId) => ({ ruleId })),
                  supportPriority: reviewSignal.reportedSupportPriority,
                },
              ]
            : [],
      }),
    );
    if (reviewFocus.political || reviewFocus.psychological) {
      if (decision.recommendedAction === 'allow') decision.recommendedAction = 'hold';
      decision.canAutomaticallyPublish = false;
      if (
        result?.automationReason === 'focus_requires_review' &&
        result?.manualReview?.validation === 'not_attempted'
      ) {
        decision.reasons = [];
        decision.reasonLabels = [];
      }
      decision.reasons.push('focus_requires_review');
      if (reviewFocus.political)
        decision.reasonLabels.push('政治相关关键词或信号触发人工审核，负责人通过前不发布。');
      if (reviewFocus.psychological)
        decision.reasonLabels.push(
          '心理相关关键词或信号触发人工审核，负责人通过前不发布；不等于诊断或违规。',
        );
    }
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
      reviewFocus,
      assessment: safeAssessment,
      policyDecision: decision,
      policyEvidence: valid ? buildPolicyEvidence(assessment) : [],
    };
    if (!valid || result?.manualReview)
      stored.manualReview = {
        required: true,
        validation:
          result?.manualReview?.validation === 'not_attempted' ? 'not_attempted' : 'failed',
        ...(diagnostics ? { diagnostics } : {}),
      };
    if (stored.manualReview && result?.manualReview?.imageDiagnostics) {
      const { sanitizeImageDiagnostics } = require('./moderation-image-client');
      const imageDiagnostics = sanitizeImageDiagnostics(result.manualReview.imageDiagnostics);
      if (imageDiagnostics) stored.manualReview.imageDiagnostics = imageDiagnostics;
    }
    const codes = [
      'focus_requires_review',
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
      if (
        requiredNoticeVersion &&
        parse(row.payload_json, {}).moderationNoticeVersion !== requiredNoticeVersion
      )
        return { ...(await terminate(db, row, job, 'review', 'notice_required')), applied: false };
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
      const freshJob = await readJob(db, job.id);
      const freshRow = await readSubmission(db, row.id);
      if (!current(freshRow, freshJob))
        return {
          ...(await terminate(db, freshRow, freshJob, 'cancelled', 'submission_changed')),
          applied: false,
        };
      job.lease_expired = freshJob.lease_expired;
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
          reason = meta.imageCount > 0 ? 'no_image_risk' : 'no_text_risk';
        }
        if (stored.assessment.supportPriority !== 'none') reason = 'support_requires_review';
      }
      if (
        !paused &&
        !Number(job.lease_expired) &&
        reviewers.length &&
        (stored.reviewFocus?.political || stored.reviewFocus?.psychological)
      ) {
        target = 'review';
        reason = 'focus_requires_review';
      }
      let published;
      if (target === 'published') {
        const [attachments] = await db.execute(
          'SELECT id FROM moderation_attachments WHERE submission_id = ? ORDER BY id FOR UPDATE',
          [row.id],
        );
        const expectedIds = parse(row.attachment_ids_json, []);
        const hasImages = attachments.length || expectedIds.length || meta.imageCount > 0;
        if (
          hasImages &&
          (!stored.imagesReviewed ||
            !preview ||
            attachments.length !== meta.imageCount ||
            expectedIds.length !== meta.imageCount ||
            attachments.some((item) => !expectedIds.includes(item.id)))
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
          if (hasImages) {
            const [bound] = await db.execute(
              `UPDATE moderation_attachments SET published_id = ? WHERE submission_id = ? AND id IN (${expectedIds.map(() => '?').join(',')}) AND bound_content_hash = ? AND published_id IS NULL AND purged_at IS NULL AND expires_at > NOW(3)`,
              [published.publishedId, row.id, ...expectedIds, row.content_hash],
            );
            if (bound.affectedRows !== expectedIds.length) throw fail('发布附件状态已变化。', 409);
            await db.execute(
              'INSERT INTO moderation_image_reviews (job_id, submission_id, published_version, expires_at) VALUES (?, ?, ?, ?)',
              [job.id, row.id, Number(row.version) + 1, row.expires_at],
            );
          }
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
      await notify(db, row, job, target, stored);
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
    await purgeLegacyModerationNotificationTopics(pool);
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
        await db.execute('DELETE FROM moderation_image_reviews WHERE job_id = ?', [job.id]);
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
      const [[imageReview]] = await db.execute(
        'SELECT *, (expires_at <= NOW(3)) AS expired FROM moderation_image_reviews WHERE job_id = ?',
        [job.id],
      );
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
        imageReview: imageReviewState(row, job, imageReview),
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
      await db.execute("UPDATE moderation_image_reviews SET state = 'withdrawn' WHERE job_id = ?", [
        job.id,
      ]);
      await notify(db, row, job, 'withdrawn');
      return { ...privateSubmission(await readSubmission(db, id)), replayed: false };
    });
  }
  function imageReviewState(row, job, record) {
    const expired = Boolean(
      Number(row?.expired) ||
      row?.evidence_purged_at ||
      Number(job?.expired) ||
      job?.purged_at ||
      Number(record?.expired),
    );
    const currentPublication =
      !expired &&
      record &&
      job?.state === 'published' &&
      row?.status === 'approved' &&
      row.decided_by == null &&
      row.published_id != null &&
      row.content_hash === job.content_hash &&
      Number(row.version) === Number(job.published_version) &&
      Number(record.published_version) === Number(job.published_version);
    return {
      required: Boolean(record),
      state: record?.state || null,
      reviewedBy: expired || record?.reviewed_by == null ? null : String(record.reviewed_by),
      reviewedAt: expired ? null : record?.reviewed_at || null,
      canConfirm: Boolean(currentPublication && record.state === 'pending'),
    };
  }
  async function listImageReviews({ reviewerId, limit = 50 }) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw fail('图片复核列表数量无效。');
    return transact(async (db) => {
      await reviewer(db, reviewerId);
      const [records] = await db.execute(
        `SELECT s.*, r.job_id, r.state AS image_review_state, r.reviewed_by, r.reviewed_at,
          r.published_version AS image_published_version, j.published_version AS job_published_version
         FROM moderation_image_reviews r JOIN moderation_auto_jobs j ON j.id = r.job_id
         JOIN moderation_submissions s ON s.id = r.submission_id
         WHERE r.state = 'pending' AND j.state = 'published' AND s.status = 'approved'
           AND s.decided_by IS NULL AND s.published_id IS NOT NULL AND s.version = j.published_version
           AND s.version = r.published_version AND s.content_hash = j.content_hash
           AND s.expires_at > NOW(3) AND j.expires_at > NOW(3) AND r.expires_at > NOW(3)
           AND s.evidence_purged_at IS NULL AND j.purged_at IS NULL
         ORDER BY r.created_at, r.job_id LIMIT ${limit}`,
      );
      return {
        items: records.map((row) => ({
          id: row.id,
          submissionId: row.id,
          version: Number(row.version),
          kind: row.kind,
          title: parse(row.payload_json, {}).title || '评论',
          authorId: row.author_id == null ? null : Number(row.author_id),
          publishedUrl: row.published_url || '',
          createdAt: row.created_at,
          expiresAt: row.expires_at,
          imageReview: {
            required: true,
            state: 'pending',
            reviewedBy: null,
            reviewedAt: null,
            canConfirm: true,
          },
        })),
      };
    });
  }
  async function confirmImageReview({ id, reviewerId, expectedVersion, requestId }) {
    uuid(id);
    if (
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 1 ||
      typeof requestId !== 'string' ||
      !/^[A-Za-z0-9_-]{8,64}$/.test(requestId)
    )
      throw fail('图片复核请求或版本无效。');
    const userId = actor(reviewerId);
    const signature = hash({ id, expectedVersion, action: 'confirm_image_review' });
    try {
      return await transact(async (db) => {
        await reviewer(db, userId);
        const row = await readSubmission(db, id);
        if (!row) throw fail('审核记录不存在。', 404);
        const [[candidate]] = await db.execute(
          'SELECT id FROM moderation_auto_jobs WHERE submission_id = ? ORDER BY submission_version DESC LIMIT 1',
          [id],
        );
        const job = candidate ? await readJob(db, candidate.id) : null;
        const [[record]] = job
          ? await db.execute(
              'SELECT *, (expires_at <= NOW(3)) AS expired FROM moderation_image_reviews WHERE job_id = ? FOR UPDATE',
              [job.id],
            )
          : [[null]];
        if (
          Number(row.expired) ||
          row.evidence_purged_at ||
          Number(job?.expired) ||
          job?.purged_at ||
          Number(record?.expired)
        )
          throw fail('图片复核材料已到期，请通过讨论区管理功能处理。', 410);
        if (
          !record ||
          !job ||
          record.submission_id !== row.id ||
          job.state !== 'published' ||
          row.status !== 'approved' ||
          row.decided_by != null ||
          !row.published_id ||
          row.content_hash !== job.content_hash ||
          Number(row.version) !== expectedVersion ||
          Number(job.published_version) !== expectedVersion ||
          Number(record.published_version) !== expectedVersion ||
          record.state === 'withdrawn'
        )
          throw fail('内容已变化，或不是待复核的自动发布图片。', 409);
        if (record.review_request_id === requestId && Number(record.reviewed_by) === userId) {
          if (record.review_hash !== signature) throw fail('相同请求编号对应不同图片复核。', 409);
          return {
            id,
            submissionId: id,
            version: expectedVersion,
            imageReview: imageReviewState(row, job, record),
            replayed: true,
          };
        }
        if (record.state !== 'pending') throw fail('图片已由负责人复核，请刷新记录。', 409);
        await db
          .execute(
            "UPDATE moderation_image_reviews SET state = 'confirmed', reviewed_by = ?, reviewed_at = NOW(3), review_request_id = ?, review_hash = ? WHERE job_id = ? AND state = 'pending' AND expires_at > NOW(3) AND EXISTS (SELECT 1 FROM moderation_submissions WHERE id = ? AND status = 'approved' AND version = ? AND expires_at > NOW(3) AND evidence_purged_at IS NULL) AND EXISTS (SELECT 1 FROM moderation_auto_jobs WHERE id = ? AND state = 'published' AND expires_at > NOW(3) AND purged_at IS NULL)",
            [userId, requestId, signature, job.id, row.id, expectedVersion, job.id],
          )
          .then(([updated]) => {
            if (updated.affectedRows !== 1) throw fail('图片复核状态已变化。', 409);
          });
        const [[confirmed]] = await db.execute(
          'SELECT * FROM moderation_image_reviews WHERE job_id = ?',
          [job.id],
        );
        return {
          id,
          submissionId: id,
          version: expectedVersion,
          imageReview: imageReviewState(row, job, confirmed),
          replayed: false,
        };
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') throw fail('相同请求编号已用于其他图片复核。', 409);
      throw error;
    }
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
    listImageReviews,
    confirmImageReview,
    control: () => control(),
    setPaused,
  };
}

module.exports = { ensureModerationAutomationSchema, createModerationAutomationStore };
