const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const COMMUNITY_AGREEMENT_VERSION = '2026-09-09';
const CHALLENGE_TTL_SECONDS = 300;
const RATE_WINDOW_SECONDS = 900;
const EMAIL_CHALLENGE_LIMIT = 12;
const IP_CHALLENGE_LIMIT = 60;
const ANSWER_TOLERANCE = 0.05;
const CANDIDATE_SPACING = 0.2;
const schemaPromises = new WeakMap();

class RegistrationGuardError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function assertCommunityAgreement(body = {}) {
  if (body.communityAgreementAccepted !== true) {
    throw new RegistrationGuardError('请阅读并同意社区公约', 'community_agreement_required');
  }
  if (body.communityAgreementVersion !== COMMUNITY_AGREEMENT_VERSION) {
    throw new RegistrationGuardError(
      '社区公约已更新，请刷新页面后阅读并重新同意',
      'community_agreement_version_mismatch',
    );
  }
}

function randomBetween(min, max) {
  return min + (crypto.randomInt(0, 1000000) / 1000000) * (max - min);
}

function shuffle(values) {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const other = crypto.randomInt(index + 1);
    [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
  }
  return shuffled;
}

function selectCandidates(buckets, selected = []) {
  if (selected.length === buckets.length) return selected;
  for (const candidate of buckets[selected.length]) {
    if (selected.some((item) => Math.abs(item.k - candidate.k) < CANDIDATE_SPACING)) continue;
    const result = selectCandidates(buckets, [...selected, candidate]);
    if (result) return result;
  }
  return null;
}

function generateBandChallenge() {
  const carrier = crypto.randomInt(2) ? 'electron' : 'hole';
  const objective = crypto.randomInt(2) ? 'maximum' : 'minimum';
  const sign = carrier === 'electron' ? 1 : -1;
  // Display two complete periods, with real energy maxima and minima. Curvature
  // changes sign on the full band; compare masses ONLY at the marked candidates.
  // m_e = hbar²/E'', m_h = -hbar²/E'': each candidate has the required sign and
  // stays well away from zero curvature, where effective mass would diverge.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const phase = randomBetween(-1, 1);
    const amplitude = randomBetween(0.9, 1.3);
    const harmonic = randomBetween(0.06, 0.12);
    const harmonicPhase = randomBetween(-Math.PI, Math.PI);
    const tilt = randomBetween(-0.08, 0.08);
    const offset = randomBetween(-0.3, 0.3);
    const omega = 2 * Math.PI;
    const samples = Array.from({ length: 161 }, (_, index) => {
      const k = Number((-1 + index / 80).toFixed(6));
      const angle = omega * (k - phase);
      const energy =
        amplitude * (Math.sin(angle) + harmonic * Math.sin(2 * angle + harmonicPhase)) +
        tilt * k +
        offset;
      const curvature =
        -sign *
        amplitude *
        omega ** 2 *
        (Math.sin(angle) + 4 * harmonic * Math.sin(2 * angle + harmonicPhase));
      return { k, energy: Number(energy.toFixed(9)), curvature };
    });
    const interior = samples.slice(3, -3);
    const largestCurvature = Math.max(...interior.map((point) => point.curvature));
    // Separate curvature tiers give unique mass extrema with a visible contrast.
    // Random selection and phase keep the answer's left-to-right position varied.
    const buckets = [
      [0.25, 0.34],
      [0.47, 0.56],
      [0.68, 0.77],
      [0.91, 1.001],
    ].map(([lower, upper]) =>
      shuffle(
        interior.filter(
          (point) =>
            point.curvature >= lower * largestCurvature &&
            point.curvature <= upper * largestCurvature,
        ),
      ),
    );
    const selected = selectCandidates(buckets);
    if (!selected) continue;
    const answerK = (objective === 'maximum' ? selected[0] : selected.at(-1)).k;
    const candidates = selected.map(({ k }) => ({ k })).sort((a, b) => a.k - b.k);
    const points = samples.map(({ k, energy }) => ({ k, energy }));
    return {
      publicChallenge: { carrier, objective, band: { points, candidates, kMin: -1, kMax: 1 } },
      answerK,
      tolerance: ANSWER_TOLERANCE,
    };
  }
  throw new Error('Could not generate separated positive-mass band candidates');
}

async function ensureRegistrationGuardTables(pool) {
  if (!schemaPromises.has(pool)) {
    schemaPromises.set(
      pool,
      (async () => {
        const migration = await fs.readFile(
          path.join(__dirname, '..', 'database', 'migrations', '030_registration_guard.sql'),
          'utf8',
        );
        for (const statement of migration
          .split(';')
          .map((item) => item.trim())
          .filter(Boolean)) {
          await pool.execute(statement);
        }
      })().catch((error) => {
        schemaPromises.delete(pool);
        throw error;
      }),
    );
  }
  await schemaPromises.get(pool);
}

async function issueBandChallenge(pool, { identity, purpose, ip }) {
  const normalizedIdentity = typeof identity === 'string' ? identity.trim().toLowerCase() : '';
  const prefix = purpose === 'login' ? 'login_captcha' : 'registration_captcha';
  if (
    !normalizedIdentity ||
    normalizedIdentity.length > 128 ||
    (purpose === 'register' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedIdentity))
  ) {
    throw new RegistrationGuardError(
      purpose === 'login' ? '请输入有效的用户名或邮箱' : '请输入有效邮箱地址',
      `${prefix}_invalid_identity`,
    );
  }
  const connection = await pool.getConnection();
  let result;
  try {
    await connection.beginTransaction();
    const [[clock]] = await connection.execute('SELECT UNIX_TIMESTAMP(NOW()) AS now_seconds');
    const nowSeconds = Number(clock.now_seconds);
    const windowStart = Math.floor(nowSeconds / RATE_WINDOW_SECONDS) * RATE_WINDOW_SECONDS;
    let limited = false;
    // Database counters and row locks enforce the limits across all API instances.
    for (const [scope, limit] of [
      [`${purpose}:${normalizedIdentity}`, EMAIL_CHALLENGE_LIMIT],
      [`ip:${ip || 'unknown'}`, IP_CHALLENGE_LIMIT],
    ]) {
      const scopeHash = crypto.createHash('sha256').update(scope).digest('hex');
      await connection.execute(
        `INSERT INTO registration_challenge_rates (scope_hash, window_start, issued_count)
         VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE issued_count = issued_count + 1`,
        [scopeHash, windowStart],
      );
      const [[rate]] = await connection.execute(
        `SELECT issued_count FROM registration_challenge_rates
         WHERE scope_hash = ? AND window_start = ?`,
        [scopeHash, windowStart],
      );
      if (Number(rate.issued_count) > limit) limited = true;
    }
    if (limited) {
      result = new RegistrationGuardError(
        '验证请求过于频繁，请稍后再试',
        `${prefix}_rate_limited`,
        429,
      );
    } else {
      const challengeId = crypto.randomBytes(32).toString('hex');
      const generated = generateBandChallenge();
      const expirySeconds = nowSeconds + CHALLENGE_TTL_SECONDS;
      await connection.execute(
        `INSERT INTO registration_challenges (id, email, purpose, answer_k, tolerance, expires_at)
         VALUES (?, ?, ?, ?, ?, FROM_UNIXTIME(?))`,
        [
          challengeId,
          normalizedIdentity,
          purpose,
          generated.answerK,
          generated.tolerance,
          expirySeconds,
        ],
      );
      result = {
        challengeId,
        expiresAt: new Date(expirySeconds * 1000).toISOString(),
        ...generated.publicChallenge,
        communityAgreementVersion: COMMUNITY_AGREEMENT_VERSION,
      };
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  if (result instanceof Error) throw result;
  // Bounded cleanup preserves current challenges and current rate-limit windows.
  await pool.execute(
    'DELETE FROM registration_challenges WHERE expires_at < NOW() - INTERVAL 1 DAY LIMIT 100',
  );
  await pool.execute(
    'DELETE FROM registration_challenge_rates WHERE window_start < UNIX_TIMESTAMP(NOW()) - 86400 LIMIT 100',
  );
  return result;
}

async function issueRegistrationChallenge(pool, { email, ip }) {
  return issueBandChallenge(pool, { identity: email, purpose: 'register', ip });
}

async function issueLoginChallenge(pool, { identifier, ip }) {
  return issueBandChallenge(pool, { identity: identifier, purpose: 'login', ip });
}

// The caller must hold a transaction. Errors are RETURNED so incorrect answers
// can commit consumption; successful answers commit atomically with user creation.
async function consumeBandChallenge(connection, identity, captcha, purpose) {
  const prefix = purpose === 'login' ? 'login_captcha' : 'registration_captcha';
  if (
    !captcha ||
    typeof captcha.challengeId !== 'string' ||
    !/^[a-f0-9]{64}$/.test(captcha.challengeId)
  ) {
    return new RegistrationGuardError('请完成能带验证', `${prefix}_required`);
  }
  const [[challenge]] = await connection.execute(
    `SELECT email, purpose, answer_k, tolerance, consumed_at, expires_at <= NOW() AS expired
     FROM registration_challenges WHERE id = ? FOR UPDATE`,
    [captcha.challengeId],
  );
  if (!challenge || challenge.email !== identity || challenge.purpose !== purpose) {
    return new RegistrationGuardError('能带验证无效，请重新验证', `${prefix}_invalid`);
  }
  if (challenge.consumed_at) {
    return new RegistrationGuardError('本题已使用，请换一道题重新验证', `${prefix}_used`);
  }
  if (Number(challenge.expired)) {
    return new RegistrationGuardError('能带验证已过期，请换一道题', `${prefix}_expired`);
  }
  await connection.execute('UPDATE registration_challenges SET consumed_at = NOW() WHERE id = ?', [
    captcha.challengeId,
  ]);
  if (
    typeof captcha.k !== 'number' ||
    !Number.isFinite(captcha.k) ||
    captcha.k < -1 ||
    captcha.k > 1 ||
    // k lies in [-1, 1]; allow only floating-point roundoff at the inclusive boundary.
    Math.abs(captcha.k - Number(challenge.answer_k)) > Number(challenge.tolerance) + Number.EPSILON
  ) {
    return new RegistrationGuardError(
      '位置还不准确：请在标记位置中比较有效质量，二阶导数绝对值越小，质量越大。请换一道题再试',
      `${prefix}_incorrect`,
    );
  }
  return null;
}

async function consumeRegistrationChallenge(connection, email, captcha) {
  return consumeBandChallenge(connection, email, captcha, 'register');
}

async function consumeLoginChallenge(connection, identifier, captcha) {
  return consumeBandChallenge(connection, identifier.trim().toLowerCase(), captcha, 'login');
}

async function recordCommunityAgreement(connection, userId) {
  await connection.execute(
    'INSERT INTO user_community_agreements (user_id, agreement_version, accepted_at) VALUES (?, ?, NOW())',
    [userId, COMMUNITY_AGREEMENT_VERSION],
  );
}

module.exports = {
  COMMUNITY_AGREEMENT_VERSION,
  CHALLENGE_TTL_SECONDS,
  EMAIL_CHALLENGE_LIMIT,
  IP_CHALLENGE_LIMIT,
  assertCommunityAgreement,
  generateBandChallenge,
  ensureRegistrationGuardTables,
  issueRegistrationChallenge,
  issueLoginChallenge,
  consumeRegistrationChallenge,
  consumeLoginChallenge,
  recordCommunityAgreement,
};
