const fs = require('node:fs/promises');
const path = require('node:path');
const policy = require('../public/privacy-policy.json');

const PRIVACY_POLICY_VERSION = policy.version;
const schemaPromises = new WeakMap();

class PrivacyPolicyError extends Error {
  constructor(message, code, status = 428) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function assertPrivacyAcknowledgement(body = {}) {
  if (body.privacyAccepted !== true)
    throw new PrivacyPolicyError('请阅读并勾选同意隐私政策', 'privacy_policy_required');
  if (body.privacyPolicyVersion !== policy.version || body.privacyPolicyHash !== policy.contentHash)
    throw new PrivacyPolicyError(
      '隐私政策已更新，请刷新后阅读并重新确认',
      'privacy_policy_changed',
    );
}

function ensurePrivacyPolicySchema(pool) {
  if (!schemaPromises.has(pool)) {
    const pending = fs
      .readFile(
        path.join(__dirname, '../database/migrations/072_privacy_policy_acceptance.sql'),
        'utf8',
      )
      .then((sql) => pool.query(sql))
      .catch((error) => {
        schemaPromises.delete(pool);
        throw error;
      });
    schemaPromises.set(pool, pending);
  }
  return schemaPromises.get(pool);
}

function createPrivacyPolicyService({ pool }) {
  async function status(userId) {
    const [rows] = await pool.execute(
      'SELECT content_sha256, accepted_at, last_confirmed_at FROM privacy_policy_acceptances WHERE user_id = ? AND policy_version = ? LIMIT 1',
      [userId, policy.version],
    );
    const row = rows[0];
    const accepted = row?.content_sha256 === policy.contentHash;
    return {
      version: policy.version,
      contentHash: policy.contentHash,
      accepted,
      requiresFullPolicy: !accepted,
      acceptedAt: accepted ? row.accepted_at : null,
    };
  }

  async function accept(userId, body = {}) {
    assertPrivacyAcknowledgement(body);
    // The unique key makes replay harmless while preserving the first acceptance.
    await pool.execute(
      `INSERT INTO privacy_policy_acceptances (user_id, policy_version, content_sha256)
       VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE
       accepted_at = IF(content_sha256 = VALUES(content_sha256), accepted_at, CURRENT_TIMESTAMP(3)),
       last_confirmed_at = CURRENT_TIMESTAMP(3), content_sha256 = VALUES(content_sha256)`,
      [userId, policy.version, policy.contentHash],
    );
    return status(userId);
  }

  async function confirmLogin(userId, body = {}) {
    assertPrivacyAcknowledgement(body);
    const current = await status(userId);
    // Login's compact checkbox cannot create a first full-policy acceptance.
    if (current.accepted) return accept(userId, body);
    return current;
  }

  async function requireAccepted(userId) {
    const current = await status(userId);
    if (!current.accepted)
      throw new PrivacyPolicyError(
        '请先阅读并确认隐私政策后再使用此功能',
        'privacy_policy_required',
      );
    return current;
  }

  return { status, accept, confirmLogin, requireAccepted };
}

module.exports = {
  policy,
  PRIVACY_POLICY_VERSION,
  PrivacyPolicyError,
  assertPrivacyAcknowledgement,
  ensurePrivacyPolicySchema,
  createPrivacyPolicyService,
};
