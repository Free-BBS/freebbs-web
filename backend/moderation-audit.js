const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { POLICY_VERSION, CATEGORIES, getPolicyRule } = require('./moderation-policy');

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const DECISIONS = ['no_risk_detected', 'needs_review', 'high_risk'];
const SUPPORT = ['none', 'attention', 'urgent'];
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const parse = (value) => (typeof value === 'string' ? JSON.parse(value) : value);
const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const schemaPromises = new WeakMap();

function uuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw fail('审核记录编号无效。', 400);
  return value;
}

function actor(value) {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value)))
    throw fail('需要审核负责人权限。', 403);
  return Number(value);
}

function text(value, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()))
    throw fail('填写内容为空或超过长度限制。');
  return value.trim();
}

function uniqueList(value, max, predicate) {
  if (
    !Array.isArray(value) ||
    value.length > max ||
    new Set(value).size !== value.length ||
    value.some((item) => typeof item !== 'string' || !predicate(item))
  )
    throw fail('风险类别或规则编号无效。');
  return [...value].sort();
}

function validateLabel({ decision, categories, ruleIds, supportPriority }) {
  if (!DECISIONS.includes(decision) || !SUPPORT.includes(supportPriority))
    throw fail('审核结论或关怀优先级无效。');
  const result = {
    decision,
    categories: uniqueList(categories, CATEGORIES.length, (item) => CATEGORIES.includes(item)),
    ruleIds: uniqueList(ruleIds, 6, (item) => Boolean(getPolicyRule(item))),
    supportPriority,
  };
  if ((decision === 'no_risk_detected') !== (result.categories.length === 0))
    throw fail('审核结论与风险类别不一致。');
  const violations = result.ruleIds
    .map(getPolicyRule)
    .filter((rule) => !rule.supportOnly && rule.recommendedAction !== 'allow');
  const expectedCategories = [...new Set(violations.map((rule) => rule.category))].sort();
  if (JSON.stringify(expectedCategories) !== JSON.stringify(result.categories))
    throw fail('所选规则与风险类别不一致。');
  const expectedSupport = result.ruleIds
    .map(getPolicyRule)
    .reduce(
      (priority, rule) =>
        SUPPORT.indexOf(rule.supportPriority) > SUPPORT.indexOf(priority)
          ? rule.supportPriority
          : priority,
      'none',
    );
  if (expectedSupport !== supportPriority) throw fail('关怀优先级与所选规则不一致。');
  if (decision === 'high_risk' && !violations.some((rule) => rule.recommendedAction === 'block'))
    throw fail('高风险结论需要明确的拦截规则依据。');
  return result;
}

async function ensureModerationAuditSchema(pool) {
  if (!schemaPromises.has(pool)) {
    const pending = (async () => {
      const sql = await fs.readFile(
        path.join(__dirname, '../database/migrations/068_moderation_policy_audit.sql'),
        'utf8',
      );
      for (const statement of sql
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean))
        await pool.execute(statement);
    })().catch((error) => {
      schemaPromises.delete(pool);
      throw error;
    });
    schemaPromises.set(pool, pending);
  }
  return schemaPromises.get(pool);
}

function createModerationAudit({ pool }) {
  async function transaction(callback) {
    const db = await pool.getConnection();
    try {
      await db.beginTransaction();
      const result = await callback(db);
      await db.commit();
      return result;
    } catch (error) {
      await db.rollback();
      if (error.code === 'ER_DUP_ENTRY')
        throw fail('请求已提交或编号冲突，请刷新记录后核对。', 409);
      throw error;
    } finally {
      db.release();
    }
  }

  async function reviewer(db, reviewerId) {
    const userId = actor(reviewerId);
    const [rows] = await db.execute(
      'SELECT user_id FROM moderation_reviewers WHERE user_id = ? AND active = 1 FOR SHARE',
      [userId],
    );
    if (!rows.length) throw fail('需要审核负责人权限。', 403);
    return userId;
  }

  async function submission(db, id, expected) {
    const [rows] = await db.execute(
      'SELECT *, (expires_at <= NOW(3)) AS expired FROM moderation_submissions WHERE id = ? FOR UPDATE',
      [uuid(id)],
    );
    const row = rows[0];
    if (!row) throw fail('审核记录不存在。', 404);
    if (Number(row.expired) || row.evidence_purged_at || !row.payload_json)
      throw fail('审核材料已到期。', 410);
    if (
      expected &&
      (row.status !== 'pending' ||
        Number(row.version) !== expected.version ||
        row.content_hash !== expected.contentHash)
    )
      throw fail('稿件已处理或版本变化，本次结果不再适用。', 409);
    return row;
  }

  async function runRow(db, id, runId) {
    const [rows] = await db.execute(
      'SELECT *, (expires_at <= NOW(3)) AS expired FROM moderation_ai_runs WHERE id = ? AND submission_id = ? FOR UPDATE',
      [uuid(runId), uuid(id)],
    );
    if (!rows[0] || Number(rows[0].expired)) throw fail('试审记录不存在或已到期。', 404);
    return rows[0];
  }

  async function prepare({ id, reviewerId, snapshot }) {
    return transaction(async (db) => {
      await reviewer(db, reviewerId);
      await submission(db, id, snapshot);
      const [[row]] = await db.execute(
        'SELECT COUNT(*) AS total FROM moderation_ai_runs WHERE submission_id = ?',
        [id],
      );
      if (Number(row.total) >= 50) throw fail('本稿件已达到 50 次试审记录上限。', 429);
    });
  }

  async function record({ id, reviewerId, snapshot, input, result }) {
    // Only this server's validated DTO is persisted; no provider envelope, secret,
    // identity dictionary, extra redaction terms or raw reasoning is recorded.
    const runId = crypto.randomUUID();
    const stored = {
      submissionId: id,
      version: result.version,
      contentHash: result.contentHash,
      inputMode: result.inputMode,
      assessment: result.assessment,
      model: result.model,
      settingsRevision: result.settingsRevision,
      policyVersion: result.policyVersion,
      redactorVersion: result.redactorVersion,
      elapsedMs: result.elapsedMs,
      imageCount: result.imageCount,
      imagesReviewed: false,
      automaticPublication: false,
      policyDecision: result.policyDecision,
      policyEvidence: result.policyEvidence,
    };
    const serialized = JSON.stringify(stored);
    if (Buffer.byteLength(serialized, 'utf8') > 192 * 1024)
      throw fail('审核结果过大，未保存。', 502);
    return transaction(async (db) => {
      const reviewerIdValue = await reviewer(db, reviewerId);
      const row = await submission(db, id, snapshot);
      const [[count]] = await db.execute(
        'SELECT COUNT(*) AS total FROM moderation_ai_runs WHERE submission_id = ?',
        [id],
      );
      if (Number(count.total) >= 50) throw fail('本稿件已达到试审记录上限。', 429);
      await db.execute(
        `INSERT INTO moderation_ai_runs
        (id, submission_id, reviewer_id, submission_version, content_hash, input_hash, result_json, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          runId,
          id,
          reviewerIdValue,
          snapshot.version,
          snapshot.contentHash,
          digest(input),
          serialized,
          row.expires_at,
        ],
      );
      return runId;
    });
  }

  async function history({ id, reviewerId }) {
    return transaction(async (db) => {
      await reviewer(db, reviewerId);
      const row = await submission(db, id);
      const [runs] = await db.execute(
        'SELECT * FROM moderation_ai_runs WHERE submission_id = ? AND expires_at > NOW(3) ORDER BY created_at DESC, id DESC LIMIT 50',
        [id],
      );
      const [feedbackRows] = await db.execute(
        `SELECT f.* FROM moderation_ai_feedback f
        JOIN moderation_ai_runs r ON r.id = f.run_id WHERE r.submission_id = ? AND r.expires_at > NOW(3) ORDER BY f.id DESC`,
        [id],
      );
      return {
        runs: runs.map((run) => {
          const items = feedbackRows
            .filter((item) => item.run_id === run.id)
            .map((item) => ({
              ...parse(item.feedback_json),
              id: String(item.id),
              reviewerId: item.reviewer_id == null ? null : String(item.reviewer_id),
              createdAt: item.created_at,
            }));
          return {
            ...parse(run.result_json),
            id: run.id,
            createdAt: run.created_at,
            expiresAt: run.expires_at,
            feedback: items[0] || null,
            feedbackHistory: items,
            publicationDecision: {
              status: row.status,
              reviewerId: row.decided_by == null ? null : String(row.decided_by),
              reason: row.decision_reason || '',
              decidedAt: row.decided_at,
            },
          };
        }),
      };
    });
  }

  async function feedback({ id, runId, reviewerId, body }) {
    const label = validateLabel(body);
    if (!['agree', 'correct', 'escalate'].includes(body.verdict)) throw fail('复核方式无效。');
    const value = {
      verdict: body.verdict,
      ...label,
      note: text(body.note, 1000, body.verdict !== 'agree'),
    };
    const requestId = uuid(body.requestId);
    const hash = digest({ id, runId, value });
    return transaction(async (db) => {
      const userId = await reviewer(db, reviewerId);
      await submission(db, id);
      const run = await runRow(db, id, runId);
      const [existing] = await db.execute(
        'SELECT * FROM moderation_ai_feedback WHERE reviewer_id = ? AND request_id = ?',
        [userId, requestId],
      );
      if (existing.length) {
        if (existing[0].request_hash !== hash) throw fail('同一请求编号对应不同复核内容。', 409);
        return { id: String(existing[0].id), replayed: true };
      }
      const original = parse(run.result_json).assessment;
      if (
        value.verdict === 'agree' &&
        digest(label) !==
          digest({
            decision: original.decision,
            categories: [...original.categories].sort(),
            ruleIds: [...new Set(original.ruleMatches.map((match) => match.ruleId))].sort(),
            supportPriority: original.supportPriority,
          })
      )
        throw fail('同意机器结论时标签必须一致；修改结论请选择纠正。');
      const [[count]] = await db.execute(
        'SELECT COUNT(*) AS total FROM moderation_ai_feedback WHERE run_id = ?',
        [runId],
      );
      if (Number(count.total) >= 20) throw fail('本次试审的复核记录已达到上限。', 429);
      // The request fingerprint remains based on the submitted label and note.
      // A retry replays its original record rather than relabeling that record
      // with the policy version installed after the original review.
      const [insert] = await db.execute(
        'INSERT INTO moderation_ai_feedback (run_id, reviewer_id, request_id, request_hash, feedback_json) VALUES (?, ?, ?, ?, ?)',
        [
          runId,
          userId,
          requestId,
          hash,
          JSON.stringify({ ...value, policyVersion: POLICY_VERSION }),
        ],
      );
      return { id: String(insert.insertId), replayed: false };
    });
  }

  async function regression({ id, runId, reviewerId, body }) {
    if (body.syntheticConfirmed !== true) throw fail('请确认样例已改写为虚构内容。');
    const label = validateLabel({ ...body, decision: body.expectedDecision });
    const value = {
      title: text(body.title, 120),
      content: text(body.content, 6000, true),
      expectedDecision: label.decision,
      categories: label.categories,
      ruleIds: label.ruleIds,
      supportPriority: label.supportPriority,
      reason: text(body.reason, 1000, true),
      syntheticConfirmed: true,
      policyVersion: POLICY_VERSION,
    };
    const requestId = uuid(body.requestId);
    const hash = digest({ id, runId, value });
    return transaction(async (db) => {
      const userId = await reviewer(db, reviewerId);
      const parent = await submission(db, id);
      await runRow(db, id, runId);
      const [existing] = await db.execute(
        'SELECT * FROM moderation_regression_cases WHERE reviewer_id = ? AND request_id = ?',
        [userId, requestId],
      );
      if (existing.length) {
        if (existing[0].request_hash !== hash) throw fail('同一请求编号对应不同样例。', 409);
        return { id: existing[0].id, replayed: true };
      }
      const [reviews] = await db.execute(
        'SELECT * FROM moderation_ai_feedback WHERE run_id = ? ORDER BY id DESC LIMIT 1',
        [runId],
      );
      if (!reviews.length || parse(reviews[0].feedback_json).verdict === 'escalate')
        throw fail('请先完成明确的人工复核，再建立回归样例。', 409);
      const review = parse(reviews[0].feedback_json);
      if (review.policyVersion !== POLICY_VERSION)
        throw fail(
          '最新人工复核未注明当前规则版本，或规则已经更新。请按当前规则重新保存人工复核，再建立回归样例。',
          409,
        );
      if (
        digest(label) !==
        digest({
          decision: review.decision,
          categories: review.categories,
          ruleIds: review.ruleIds,
          supportPriority: review.supportPriority,
        })
      )
        throw fail('样例预期与最新人工复核不一致，请先更新复核结论。', 409);
      const original = parse(parent.payload_json);
      if (value.content === String(original.content || '').trim())
        throw fail('请手动改写为虚构样例，不要直接复制稿件原文。');
      const [[count]] = await db.execute(
        'SELECT COUNT(*) AS total FROM moderation_regression_cases WHERE run_id = ?',
        [runId],
      );
      if (Number(count.total) >= 10) throw fail('本次试审的回归样例已达到上限。', 429);
      const caseId = crypto.randomUUID();
      await db.execute(
        `INSERT INTO moderation_regression_cases
        (id, run_id, feedback_id, reviewer_id, request_id, request_hash, case_json, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          caseId,
          runId,
          reviews[0].id,
          userId,
          requestId,
          hash,
          JSON.stringify(value),
          parent.expires_at,
        ],
      );
      return { id: caseId, replayed: false };
    });
  }

  async function exportRegressions({ reviewerId }) {
    return transaction(async (db) => {
      await reviewer(db, reviewerId);
      // Evidence expires independently of whether the cleanup worker has run.
      const [rows] = await db.execute(`SELECT c.id, c.case_json FROM moderation_regression_cases c
        JOIN moderation_ai_runs r ON r.id = c.run_id JOIN moderation_submissions s ON s.id = r.submission_id
        WHERE c.expires_at > NOW(3) AND r.expires_at > NOW(3) AND s.expires_at > NOW(3)
        AND s.evidence_purged_at IS NULL ORDER BY c.created_at, c.id LIMIT 101`);
      if (rows.length > 100) throw fail('样例超过单次 100 条导出上限，请联系管理员分批处理。', 413);
      return {
        format: 'freebbs-moderation-regression-v1',
        policyVersion: POLICY_VERSION,
        exportedAt: new Date().toISOString(),
        cases: rows.map((row) => ({ id: row.id, ...parse(row.case_json) })),
      };
    });
  }

  async function purge() {
    // FK cascades remove feedback and derived case copies in the same statement.
    const [result] = await pool.execute(
      'DELETE FROM moderation_ai_runs WHERE expires_at <= NOW(3) LIMIT 100',
    );
    return Number(result.affectedRows);
  }

  return { prepare, record, history, feedback, regression, exportRegressions, purge };
}

module.exports = { createModerationAudit, ensureModerationAuditSchema, validateLabel };
