const express = require('express');
const { validateDocument, simulate, catalog, buildNets } = require('../public/circuit-engine');
const { walletLedgerCheckpoint, annotateWalletLedger } = require('./wallet-ledger');
const {
  circuitChallengeCatalog,
  legacyCircuitChallengeUpdates,
} = require('./circuit-challenge-catalog');

const FIXED_IDS = Object.freeze({
  source: 'V_IN',
  output: 'OUT',
  ground: 'GND',
  vcc: 'VCC',
  vee: 'VEE',
});
const ALLOWED_TYPES = new Set([
  'resistor',
  'capacitor',
  'inductor',
  'opamp',
  'diode',
  'bjt',
  'mosfet',
  'ground',
  'junction',
]);
const MAX_BODY_BYTES = 256 * 1024;
const MAX_REWARD_ELECTRIC = 1000000;

class CircuitChallengeError extends Error {
  constructor(message, status = 400, code = 'invalid_circuit_challenge') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function ensureCircuitChallengeTables(pool) {
  await pool.execute(`CREATE TABLE IF NOT EXISTS circuit_challenges (
    id INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    title VARCHAR(120) NOT NULL,
    description TEXT NOT NULL,
    document_json MEDIUMTEXT NOT NULL,
    target_json MEDIUMTEXT NOT NULL,
    tolerance DOUBLE NOT NULL DEFAULT 0.06,
    reward_electric INT UNSIGNED NOT NULL DEFAULT 0,
    revision INT UNSIGNED NOT NULL DEFAULT 1,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_by BIGINT NULL,
    updated_by BIGINT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_circuit_challenges_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT fk_circuit_challenges_editor FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL,
    INDEX idx_circuit_challenges_active (is_active, id)
  )`);
  await pool.execute(`CREATE TABLE IF NOT EXISTS circuit_challenge_submissions (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    challenge_id INT UNSIGNED NOT NULL,
    challenge_revision INT UNSIGNED NOT NULL,
    user_id BIGINT NOT NULL,
    component_count SMALLINT UNSIGNED NOT NULL,
    error_score DOUBLE NOT NULL,
    completion_reward INT UNSIGNED NOT NULL DEFAULT 0,
    record_reward INT UNSIGNED NOT NULL DEFAULT 0,
    document_json MEDIUMTEXT NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_circuit_challenge_submissions_challenge FOREIGN KEY (challenge_id) REFERENCES circuit_challenges (id) ON DELETE CASCADE,
    CONSTRAINT fk_circuit_challenge_submissions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    INDEX idx_circuit_challenge_rank (challenge_id, challenge_revision, component_count, error_score, created_at),
    INDEX idx_circuit_challenge_user (user_id, created_at)
  )`);
  await pool.execute(`CREATE TABLE IF NOT EXISTS circuit_challenge_catalog_seeds (
    seed_key VARCHAR(80) PRIMARY KEY,
    challenge_id INT UNSIGNED NOT NULL UNIQUE,
    seed_revision INT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_circuit_challenge_seed_challenge
      FOREIGN KEY (challenge_id) REFERENCES circuit_challenges (id) ON DELETE CASCADE
  )`);
  for (const [table, column, definition] of [
    ['circuit_challenges', 'reward_electric', 'INT UNSIGNED NOT NULL DEFAULT 0 AFTER tolerance'],
    [
      'circuit_challenge_catalog_seeds',
      'seed_revision',
      'INT UNSIGNED NOT NULL DEFAULT 1 AFTER challenge_id',
    ],
    [
      'circuit_challenge_submissions',
      'completion_reward',
      'INT UNSIGNED NOT NULL DEFAULT 0 AFTER error_score',
    ],
    [
      'circuit_challenge_submissions',
      'record_reward',
      'INT UNSIGNED NOT NULL DEFAULT 0 AFTER completion_reward',
    ],
  ]) {
    const [rows] = await pool.execute(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
      [table, column],
    );
    if (rows.length) continue;
    try {
      await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    } catch (error) {
      if (error.code !== 'ER_DUP_FIELDNAME') throw error;
    }
  }
}

function parseId(value, label = '题目') {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1 || id > 4294967295 || String(id) !== String(value)) {
    throw new CircuitChallengeError(`${label} ID 无效`);
  }
  return id;
}

function isAdmin(user) {
  return Boolean(user && (user.is_admin || user.role === 'admin'));
}

function requiredComponent(document, id, type) {
  const component = document.components.find((item) => item.id === id);
  if (!component || component.type !== type) {
    throw new CircuitChallengeError(`电路必须保留固定端口 ${id}`);
  }
  return component;
}

function validateChallengeDocument(input) {
  let document;
  try {
    document = validateDocument(input);
  } catch (error) {
    throw new CircuitChallengeError(error.message || '电路文档无效');
  }
  if (Buffer.byteLength(JSON.stringify(document), 'utf8') > MAX_BODY_BYTES) {
    throw new CircuitChallengeError('电路文档不能超过 256 KiB', 413, 'circuit_too_large');
  }
  const source = requiredComponent(document, FIXED_IDS.source, 'voltage');
  requiredComponent(document, FIXED_IDS.output, 'oscilloscope');
  requiredComponent(document, FIXED_IDS.ground, 'ground');
  const vcc = requiredComponent(document, FIXED_IDS.vcc, 'fixed_voltage');
  const vee = requiredComponent(document, FIXED_IDS.vee, 'fixed_voltage');
  if (!['sine', 'pulse'].includes(source.params.waveform)) {
    throw new CircuitChallengeError('输入端口只支持正弦波或方波');
  }
  if (document.analysis.type !== 'transient') {
    throw new CircuitChallengeError('闯关题目必须使用瞬态分析');
  }
  if (!(vcc.params.dc > 0) || !(vee.params.dc < 0)) {
    throw new CircuitChallengeError('公共电源必须保留正 VCC 与负 VEE');
  }
  const { pinNets } = buildNets(document);
  if (
    pinNets[`${FIXED_IDS.source}:1`] !== '0' ||
    pinNets[`${FIXED_IDS.output}:1`] !== '0' ||
    pinNets[`${FIXED_IDS.ground}:0`] !== '0'
  ) {
    throw new CircuitChallengeError('输入负端与输出负端必须连接固定参考地');
  }
  for (const component of document.components) {
    if (Object.values(FIXED_IDS).includes(component.id)) continue;
    if (!ALLOWED_TYPES.has(component.type)) {
      throw new CircuitChallengeError(
        `闯关模式不允许使用${catalog[component.type]?.label || component.type}`,
      );
    }
  }
  return document;
}

function fixedSignature(document) {
  return Object.values(FIXED_IDS).map((id) => {
    const component = document.components.find((item) => item.id === id);
    return {
      id,
      type: component.type,
      x: component.x,
      y: component.y,
      rotation: component.rotation,
      params: component.params,
    };
  });
}

function assertFixedPortsMatch(candidate, reference) {
  if (JSON.stringify(fixedSignature(candidate)) !== JSON.stringify(fixedSignature(reference))) {
    throw new CircuitChallengeError('固定输入、输出端口及其参数不能修改');
  }
  if (JSON.stringify(candidate.analysis) !== JSON.stringify(reference.analysis)) {
    throw new CircuitChallengeError('题目的仿真时间与采样设置不能修改');
  }
}

function outputFrom(document) {
  let result;
  try {
    result = simulate(document, document.analysis);
  } catch (error) {
    throw new CircuitChallengeError(`电路无法完成仿真：${error.message}`, 422, 'simulation_failed');
  }
  const trace = result.traces.find((item) => item.id === `V:${FIXED_IDS.output}`);
  if (!trace || trace.values.length < 2 || trace.values.some((value) => !Number.isFinite(value))) {
    throw new CircuitChallengeError('无法从输出端口取得有效波形', 422, 'missing_output');
  }
  return { x: result.x, values: trace.values };
}

function waveformError(actual, target) {
  if (!actual || !target || actual.values.length !== target.values.length) {
    throw new CircuitChallengeError('输出波形采样点与题目不一致');
  }
  let squaredError = 0;
  let squaredTarget = 0;
  let targetMean = 0;
  target.values.forEach((value) => {
    targetMean += value;
  });
  targetMean /= target.values.length;
  for (let index = 0; index < target.values.length; index += 1) {
    squaredError += (actual.values[index] - target.values[index]) ** 2;
    squaredTarget += (target.values[index] - targetMean) ** 2;
  }
  const scale = Math.sqrt(squaredTarget / target.values.length) || 1;
  return Math.sqrt(squaredError / target.values.length) / scale;
}

function rewardBreakdown({ rewardElectric, hasCompleted, bestCount, componentCount }) {
  const reward = Number(rewardElectric) || 0;
  const newRecord = bestCount === null || componentCount < bestCount;
  return {
    completion: hasCompleted ? 0 : reward,
    record: newRecord ? reward : 0,
    total: (hasCompleted ? 0 : reward) + (newRecord ? reward : 0),
    newRecord,
  };
}

function readChallengeInput(body, { updating = false } = {}) {
  if (!body || Array.isArray(body) || typeof body !== 'object') {
    throw new CircuitChallengeError('请提供题目名称、说明和电路');
  }
  const allowed = new Set([
    'title',
    'description',
    'document',
    'tolerance',
    'rewardElectric',
    'isActive',
  ]);
  if (updating) allowed.add('expectedRevision');
  if (Object.keys(body).some((key) => !allowed.has(key))) {
    throw new CircuitChallengeError('题目请求包含不支持的字段');
  }
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const tolerance = Number(body.tolerance ?? 0.06);
  const rewardElectric = Number(body.rewardElectric ?? 0);
  if (!title || title.length > 120) throw new CircuitChallengeError('题目名称须为 1 至 120 个字符');
  if (description.length > 2000) throw new CircuitChallengeError('题目说明不能超过 2000 个字符');
  if (!Number.isFinite(tolerance) || tolerance < 0.005 || tolerance > 0.25) {
    throw new CircuitChallengeError('允许误差须在 0.5% 至 25% 之间');
  }
  if (
    !Number.isSafeInteger(rewardElectric) ||
    rewardElectric < 0 ||
    rewardElectric > MAX_REWARD_ELECTRIC
  ) {
    throw new CircuitChallengeError('电元奖励须为 0 至 1000000 的整数');
  }
  if (updating && (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1)) {
    throw new CircuitChallengeError('修改题目时必须提供有效版本号');
  }
  const document = validateChallengeDocument(body.document);
  const target = outputFrom(document);
  return {
    title,
    description,
    tolerance,
    rewardElectric,
    document,
    target,
    isActive: body.isActive !== false,
    ...(updating ? { expectedRevision: body.expectedRevision } : {}),
  };
}

async function ensureCircuitChallengeCatalog(pool) {
  const connection = await pool.getConnection();
  let inserted = 0;
  try {
    await connection.beginTransaction();
    for (const legacy of legacyCircuitChallengeUpdates()) {
      const [[seeded]] = await connection.execute(
        'SELECT challenge_id FROM circuit_challenge_catalog_seeds WHERE seed_key = ? LIMIT 1',
        [legacy.key],
      );
      if (seeded) continue;
      const [[challenge]] = await connection.execute(
        `SELECT id FROM circuit_challenges
         WHERE title = ?
           AND NOT EXISTS (
             SELECT 1 FROM circuit_challenge_catalog_seeds seeds
             WHERE seeds.challenge_id = circuit_challenges.id
           )
         ORDER BY id ASC LIMIT 1`,
        [legacy.matchTitle],
      );
      if (!challenge) continue;
      await connection.execute(
        `UPDATE circuit_challenges
         SET title = ?, reward_electric = ?, updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [legacy.title, legacy.rewardElectric, challenge.id],
      );
      await connection.execute(
        `INSERT INTO circuit_challenge_catalog_seeds (seed_key, challenge_id, seed_revision)
         VALUES (?, ?, 2)`,
        [legacy.key, challenge.id],
      );
    }
    for (const seed of circuitChallengeCatalog()) {
      const [[existing]] = await connection.execute(
        `SELECT challenge_id, seed_revision
         FROM circuit_challenge_catalog_seeds WHERE seed_key = ? LIMIT 1`,
        [seed.key],
      );
      const seedRevision = Number(seed.revision) || 1;
      if (existing) {
        if (seedRevision > Number(existing.seed_revision || 1)) {
          await connection.execute(
            `UPDATE circuit_challenges
             SET title = ?, description = ?, reward_electric = ?, updated_at = CURRENT_TIMESTAMP(3)
             WHERE id = ?`,
            [seed.title, seed.description, seed.rewardElectric, existing.challenge_id],
          );
          await connection.execute(
            'UPDATE circuit_challenge_catalog_seeds SET seed_revision = ? WHERE seed_key = ?',
            [seedRevision, seed.key],
          );
        }
        continue;
      }
      const data = readChallengeInput({
        title: seed.title,
        description: seed.description,
        tolerance: seed.tolerance,
        rewardElectric: seed.rewardElectric,
        isActive: true,
        document: seed.document,
      });
      const [challenge] = await connection.execute(
        `INSERT INTO circuit_challenges
         (title, description, document_json, target_json, tolerance, reward_electric, is_active,
          created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, 1, NULL, NULL)`,
        [
          data.title,
          data.description,
          JSON.stringify(data.document),
          JSON.stringify(data.target),
          data.tolerance,
          data.rewardElectric,
        ],
      );
      await connection.execute(
        `INSERT INTO circuit_challenge_catalog_seeds (seed_key, challenge_id, seed_revision)
         VALUES (?, ?, ?)`,
        [seed.key, challenge.insertId, seedRevision],
      );
      inserted += 1;
    }
    await connection.commit();
    return inserted;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function starterDocument(document) {
  const fixed = document.components.filter((item) => Object.values(FIXED_IDS).includes(item.id));
  const fixedIds = new Set(fixed.map((item) => item.id));
  return {
    version: 1,
    components: fixed,
    wires: document.wires.filter(
      (wire) => fixedIds.has(wire.from.componentId) && fixedIds.has(wire.to.componentId),
    ),
    analysis: document.analysis,
  };
}

function challengeSummary(row) {
  const document = JSON.parse(row.document_json);
  const source = document.components.find((item) => item.id === FIXED_IDS.source);
  return {
    id: Number(row.id),
    title: row.title,
    description: row.description,
    revision: Number(row.revision),
    tolerance: Number(row.tolerance),
    rewardElectric: Number(row.reward_electric),
    isActive: Boolean(row.is_active),
    input: {
      waveform: source.params.waveform,
      amplitude: source.params.amplitude,
      frequency: source.params.frequency,
      dc: source.params.dc,
      duty: source.params.duty,
    },
  };
}

function challengeDetail(row, canManage) {
  const document = JSON.parse(row.document_json);
  return {
    ...challengeSummary(row),
    document: starterDocument(document),
    target: JSON.parse(row.target_json),
    ...(canManage ? { solution: document } : {}),
  };
}

async function readRow(pool, id, { includeInactive = false } = {}) {
  const [rows] = await pool.execute(
    `SELECT id, title, description, document_json, target_json, tolerance, reward_electric,
     revision, is_active
     FROM circuit_challenges WHERE id = ? ${includeInactive ? '' : 'AND is_active = 1'} LIMIT 1`,
    [id],
  );
  if (!rows[0]) throw new CircuitChallengeError('题目不存在或已下架', 404, 'challenge_not_found');
  return rows[0];
}

function progressionFor(levels, completions) {
  const completed = new Set(completions.map((entry) => Number(entry.challenge_id)));
  let unlocked = true;
  let cleared = 0;
  const challenges = levels
    .filter((row) => Number(row.is_active))
    .map((row, index) => {
      const passed = completed.has(Number(row.id));
      const locked = !unlocked;
      if (unlocked && passed) cleared += 1;
      if (!passed) unlocked = false;
      return { id: Number(row.id), level: index + 1, completed: passed, locked };
    });
  return {
    challenges,
    progress: {
      cleared,
      completedCount: challenges.filter((row) => row.completed).length,
      total: challenges.length,
      nextChallengeId: challenges.find((row) => !row.completed)?.id || null,
    },
  };
}

async function readProgress(database, userId, { lock = false } = {}) {
  const [levels] = await database.execute(
    `SELECT id, revision, is_active FROM circuit_challenges
     WHERE is_active = 1 ORDER BY id ASC${lock ? ' FOR UPDATE' : ''}`,
  );
  const [completed] = userId
    ? await database.execute(
        `SELECT DISTINCT s.challenge_id FROM circuit_challenge_submissions s
         JOIN circuit_challenges c ON c.id = s.challenge_id AND c.revision = s.challenge_revision
         WHERE s.user_id = ? AND c.is_active = 1`,
        [userId],
      )
    : [[]];
  return progressionFor(levels, completed);
}

function assertUnlocked(progression, id) {
  if (progression.challenges.find((row) => row.id === id)?.locked) {
    throw new CircuitChallengeError('请先通过前面的关卡，再挑战这一关', 403, 'challenge_locked');
  }
}

async function readOverallLeaderboard(pool, userId) {
  const [rows] = await pool.execute(
    `WITH levels AS (
       SELECT id, revision, ROW_NUMBER() OVER (ORDER BY id) AS level_number
       FROM circuit_challenges WHERE is_active = 1
     ), completions AS (
       SELECT s.user_id, l.level_number, MIN(s.created_at) AS passed_at
       FROM circuit_challenge_submissions s
       JOIN levels l ON l.id = s.challenge_id AND l.revision = s.challenge_revision
       GROUP BY s.user_id, l.level_number
     ), ordered AS (
       SELECT *, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY level_number) AS position
       FROM completions
     ), progress AS (
       SELECT user_id, COUNT(*) AS completed_count,
         MAX(CASE WHEN position = level_number THEN level_number ELSE 0 END) AS cleared,
         MAX(CASE WHEN position = level_number THEN passed_at ELSE NULL END) AS reached_at
       FROM ordered GROUP BY user_id
     ), ranked AS (
       SELECT *, ROW_NUMBER() OVER (ORDER BY cleared DESC, reached_at ASC, user_id ASC) AS ranking
       FROM progress WHERE cleared > 0
     )
     SELECT r.*, u.uid, u.username FROM ranked r JOIN users u ON u.id = r.user_id
     WHERE r.ranking <= 100 OR r.user_id = ? ORDER BY r.ranking`,
    [userId || 0],
  );
  const entries = rows.map((row) => ({
    rank: Number(row.ranking),
    uid: row.uid,
    username: row.username,
    cleared: Number(row.cleared),
    completedCount: Number(row.completed_count),
    reachedAt: new Date(row.reached_at).toISOString(),
    isMe: Number(row.user_id) === Number(userId),
  }));
  return {
    leaderboard: entries.filter((row) => row.rank <= 100),
    me: entries.find((row) => row.isMe) || null,
  };
}

function createCircuitChallengesRouter({ pool, requireAuth }) {
  const router = express.Router();
  const handle = (callback) => async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    try {
      await callback(request, response);
    } catch (error) {
      if (error instanceof CircuitChallengeError) {
        response.status(error.status).json({ message: error.message, code: error.code });
      } else {
        console.error('Circuit challenge request failed', error.code || error.message);
        response.status(500).json({ message: '闯关模式暂时不可用，请稍后重试' });
      }
    }
  };
  const optionalUser = async (request, response) => {
    if (!request.headers.authorization) return null;
    return requireAuth(request, response);
  };
  const requireChallengeAdmin = async (request, response) => {
    const user = await requireAuth(request, response);
    if (!user) return null;
    if (!isAdmin(user)) {
      response.status(403).json({ message: '只有管理员可以管理闯关题目' });
      return null;
    }
    return user;
  };

  router.get(
    '/',
    handle(async (request, response) => {
      const user = await optionalUser(request, response);
      if (request.headers.authorization && !user) return;
      const showAll = request.query.manage === '1' && isAdmin(user);
      const [rows] = await pool.execute(
        `SELECT id, title, description, document_json, target_json, tolerance, reward_electric,
        revision, is_active
       FROM circuit_challenges ${showAll ? '' : 'WHERE is_active = 1'} ORDER BY id ASC`,
      );
      const progression = await readProgress(pool, user?.id);
      response.json({
        challenges: rows.map((row) => ({
          ...challengeSummary(row),
          ...progression.challenges.find((entry) => entry.id === Number(row.id)),
        })),
        progress: progression.progress,
        canManage: isAdmin(user),
      });
    }),
  );

  router.get(
    '/leaderboard',
    handle(async (request, response) => {
      const user = await optionalUser(request, response);
      if (request.headers.authorization && !user) return;
      response.json(await readOverallLeaderboard(pool, user?.id));
    }),
  );

  router.get(
    '/:id',
    handle(async (request, response) => {
      const user = await optionalUser(request, response);
      if (request.headers.authorization && !user) return;
      const canManage = isAdmin(user);
      const row = await readRow(pool, parseId(request.params.id), { includeInactive: canManage });
      const progression = await readProgress(pool, user?.id);
      // Admins may inspect solutions for authoring; scored submissions never bypass the gate.
      if (!canManage) assertUnlocked(progression, Number(row.id));
      response.json({
        challenge: {
          ...challengeDetail(row, canManage),
          ...progression.challenges.find((entry) => entry.id === Number(row.id)),
        },
        progress: progression.progress,
        canManage,
      });
    }),
  );

  router.get(
    '/:id/leaderboard',
    handle(async (request, response) => {
      const id = parseId(request.params.id);
      const row = await readRow(pool, id);
      const [rows] = await pool.execute(
        `SELECT ranked.user_id, ranked.component_count, ranked.error_score, ranked.created_at,
        u.uid, u.username
       FROM circuit_challenge_submissions ranked
       JOIN (
         SELECT user_id, MIN(component_count) AS best_count
         FROM circuit_challenge_submissions
         WHERE challenge_id = ? AND challenge_revision = ?
         GROUP BY user_id
       ) best ON best.user_id = ranked.user_id AND best.best_count = ranked.component_count
       JOIN users u ON u.id = ranked.user_id
       WHERE ranked.challenge_id = ? AND ranked.challenge_revision = ?
       AND ranked.id = (
         SELECT s2.id FROM circuit_challenge_submissions s2
         WHERE s2.challenge_id = ranked.challenge_id AND s2.challenge_revision = ranked.challenge_revision
         AND s2.user_id = ranked.user_id AND s2.component_count = ranked.component_count
         ORDER BY s2.error_score ASC, s2.created_at ASC LIMIT 1
       )
       ORDER BY ranked.component_count ASC, ranked.error_score ASC, ranked.created_at ASC LIMIT 50`,
        [id, row.revision, id, row.revision],
      );
      response.json({
        leaderboard: rows.map((entry, index) => ({
          rank: index + 1,
          uid: entry.uid,
          username: entry.username,
          componentCount: Number(entry.component_count),
          error: Number(entry.error_score),
          createdAt: new Date(entry.created_at).toISOString(),
        })),
      });
    }),
  );

  router.post(
    '/:id/submissions',
    handle(async (request, response) => {
      const user = await requireAuth(request, response);
      if (!user) return;
      const id = parseId(request.params.id);
      const row = await readRow(pool, id);
      assertUnlocked(await readProgress(pool, user.id), id);
      if (
        !request.body ||
        Object.keys(request.body).some((key) => !['document', 'revision'].includes(key))
      ) {
        throw new CircuitChallengeError('提交内容无效');
      }
      if (request.body.revision !== Number(row.revision)) {
        throw new CircuitChallengeError('题目已更新，请重新载入后再提交', 409, 'revision_conflict');
      }
      const reference = JSON.parse(row.document_json);
      const document = validateChallengeDocument(request.body.document);
      assertFixedPortsMatch(document, reference);
      const target = JSON.parse(row.target_json);
      const errorScore = waveformError(outputFrom(document), target);
      if (errorScore > Number(row.tolerance)) {
        response.status(422).json({
          passed: false,
          error: errorScore,
          tolerance: Number(row.tolerance),
          message: `输出波形误差 ${(errorScore * 100).toFixed(2)}%，还没有达到题目要求`,
        });
        return;
      }
      const componentCount = document.components.filter(
        (component) =>
          !Object.values(FIXED_IDS).includes(component.id) && component.type !== 'junction',
      ).length;
      const connection = await pool.getConnection();
      let rewards;
      let balance;
      try {
        await connection.beginTransaction();
        // Lock the ordered active catalog before checking progress, so a concurrent
        // revision change or submission cannot grant access based on stale prerequisites.
        assertUnlocked(await readProgress(connection, user.id, { lock: true }), id);
        const [[lockedChallenge]] = await connection.execute(
          `SELECT id, title, revision, is_active, reward_electric
           FROM circuit_challenges WHERE id = ? FOR UPDATE`,
          [id],
        );
        if (!lockedChallenge || !lockedChallenge.is_active) {
          throw new CircuitChallengeError('题目不存在或已下架', 404, 'challenge_not_found');
        }
        if (Number(lockedChallenge.revision) !== Number(row.revision)) {
          throw new CircuitChallengeError(
            '题目已更新，请重新载入后再提交',
            409,
            'revision_conflict',
          );
        }
        const [[history]] = await connection.execute(
          `SELECT MIN(component_count) AS best_count,
           MAX(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS has_completed
           FROM circuit_challenge_submissions
           WHERE challenge_id = ? AND challenge_revision = ?`,
          [user.id, id, row.revision],
        );
        rewards = rewardBreakdown({
          rewardElectric: lockedChallenge.reward_electric,
          hasCompleted: Number(history?.has_completed) > 0,
          bestCount:
            history?.best_count === null || history?.best_count === undefined
              ? null
              : Number(history.best_count),
          componentCount,
        });
        const [submission] = await connection.execute(
          `INSERT INTO circuit_challenge_submissions
           (challenge_id, challenge_revision, user_id, component_count, error_score,
            completion_reward, record_reward, document_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            row.revision,
            user.id,
            componentCount,
            errorScore,
            rewards.completion,
            rewards.record,
            JSON.stringify(document),
          ],
        );
        if (rewards.total) {
          const [[account]] = await connection.execute(
            `SELECT uid, CAST(electrons AS CHAR) AS electrons,
             CAST(manetrons AS CHAR) AS manetrons, CAST(heat AS CHAR) AS heat
             FROM users WHERE id = ? FOR UPDATE`,
            [user.id],
          );
          const electricBefore = Number(account?.electrons);
          if (
            !account ||
            !Number.isSafeInteger(electricBefore) ||
            electricBefore < 0 ||
            electricBefore + rewards.total > Number.MAX_SAFE_INTEGER
          ) {
            throw new CircuitChallengeError('账户余额异常，奖励暂未发放', 409, 'wallet_invalid');
          }
          const checkpoint = await walletLedgerCheckpoint(connection, user.id);
          const [credit] = await connection.execute(
            'UPDATE users SET electrons = electrons + ? WHERE id = ? AND electrons <= ?',
            [rewards.total, user.id, Number.MAX_SAFE_INTEGER - rewards.total],
          );
          if (credit.affectedRows !== 1) {
            throw new CircuitChallengeError('账户余额异常，奖励暂未发放', 409, 'wallet_invalid');
          }
          const parts = [];
          if (rewards.completion) parts.push(`首次通关 ${rewards.completion} 电元`);
          if (rewards.record) parts.push(`刷新最低元件纪录 ${rewards.record} 电元`);
          await annotateWalletLedger(connection, user.id, checkpoint, {
            sourceKey: `circuit-challenge:${id}:${row.revision}:${submission.insertId}`,
            title: `电路闯关 · ${String(lockedChallenge.title).slice(0, 70)}`,
            reason: `${parts.join('；')}。使用 ${componentCount} 个元件，误差 ${(
              errorScore * 100
            ).toFixed(2)}%。`,
          });
          balance = {
            uid: account.uid,
            electrons: electricBefore + rewards.total,
            manetrons: Number(account.manetrons),
            heat: Number(account.heat),
          };
        }
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
      response.status(201).json({
        passed: true,
        componentCount,
        error: errorScore,
        rewards,
        ...(balance ? { balance } : {}),
      });
    }),
  );

  router.post(
    '/',
    handle(async (request, response) => {
      const user = await requireChallengeAdmin(request, response);
      if (!user) return;
      const data = readChallengeInput(request.body);
      const [result] = await pool.execute(
        `INSERT INTO circuit_challenges
       (title, description, document_json, target_json, tolerance, reward_electric, is_active,
        created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          data.title,
          data.description,
          JSON.stringify(data.document),
          JSON.stringify(data.target),
          data.tolerance,
          data.rewardElectric,
          data.isActive ? 1 : 0,
          user.id,
          user.id,
        ],
      );
      const row = await readRow(pool, result.insertId, { includeInactive: true });
      response.status(201).json({ challenge: challengeDetail(row, true) });
    }),
  );

  router.put(
    '/:id',
    handle(async (request, response) => {
      const user = await requireChallengeAdmin(request, response);
      if (!user) return;
      const id = parseId(request.params.id);
      const data = readChallengeInput(request.body, { updating: true });
      const [result] = await pool.execute(
        `UPDATE circuit_challenges SET title = ?, description = ?, document_json = ?, target_json = ?,
       tolerance = ?, reward_electric = ?, is_active = ?, revision = revision + 1, updated_by = ?,
       updated_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND revision = ?`,
        [
          data.title,
          data.description,
          JSON.stringify(data.document),
          JSON.stringify(data.target),
          data.tolerance,
          data.rewardElectric,
          data.isActive ? 1 : 0,
          user.id,
          id,
          data.expectedRevision,
        ],
      );
      if (!result.affectedRows) {
        await readRow(pool, id, { includeInactive: true });
        throw new CircuitChallengeError('题目已有新版本，请重新载入', 409, 'revision_conflict');
      }
      const row = await readRow(pool, id, { includeInactive: true });
      response.json({ challenge: challengeDetail(row, true) });
    }),
  );
  return router;
}

module.exports = {
  CircuitChallengeError,
  FIXED_IDS,
  createCircuitChallengesRouter,
  ensureCircuitChallengeCatalog,
  ensureCircuitChallengeTables,
  outputFrom,
  readChallengeInput,
  rewardBreakdown,
  starterDocument,
  validateChallengeDocument,
  waveformError,
  progressionFor,
  readProgress,
  readOverallLeaderboard,
};
