const express = require('express');
const crypto = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');

const MODULES = [
  'learning',
  'discussion',
  'workbench',
  'lab',
  'max',
  'creative',
  'pbl',
  'development',
];
const PURPOSES = ['understand', 'practice', 'explore', 'plan', 'collaborate', 'develop'];
const BARRIERS = ['content', 'navigation', 'feedback', 'technical', 'time', 'support', 'none'];
const OUTCOMES = ['clarity', 'independence', 'direction', 'exploration', 'collaboration', 'none'];
const PHASES = ['baseline', 'post', 'delayed', 'transfer'];
const ASSISTANCE = ['none', 'max', 'other'];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{1,64}$/;
const VERSION = /^[A-Za-z0-9._-]{1,64}$/;
const LIMIT = 10000;
const RETENTION_DAYS = 180;
const MIN_GROUP = 5;
const POLICY = Object.freeze({
  voluntary: true,
  retentionDays: RETENTION_DAYS,
  contentScope: 'structured_feedback_only',
  formalAssessment: false,
});

class ResearchError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
function keys(value, allowed) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    throw new ResearchError(400, '研究提交含有不支持的字段');
}
function string(value, max, required = true) {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (required && !value.trim()) ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 && ![9, 10, 13].includes(code);
    })
  )
    throw new ResearchError(400, '研究文字字段格式或长度无效');
  return value.trim();
}
function requestKey(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new ResearchError(400, '提交标识无效');
  return value.toLowerCase();
}
function list(value, allowed, max) {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > max ||
    new Set(value).size !== value.length ||
    value.some((item) => !allowed.includes(item))
  )
    throw new ResearchError(400, '研究选项无效');
  return [...value];
}
function validateFeedback(value) {
  keys(value, [
    'requestKey',
    'module',
    'purpose',
    'helpfulness',
    'barriers',
    'outcomes',
    'comment',
    'consent',
  ]);
  if (value.consent !== true) throw new ResearchError(400, '反馈研究需要本人自愿提交');
  if (
    !MODULES.includes(value.module) ||
    !PURPOSES.includes(value.purpose) ||
    !Number.isInteger(value.helpfulness) ||
    value.helpfulness < 0 ||
    value.helpfulness > 4
  )
    throw new ResearchError(400, '模块、目的或帮助程度无效');
  const barriers = list(value.barriers, BARRIERS, 3);
  if (barriers.includes('none') && barriers.length > 1)
    throw new ResearchError(400, '没有障碍不能与其他障碍同时选择');
  const outcomes = value.outcomes === undefined ? [] : value.outcomes;
  if (
    !Array.isArray(outcomes) ||
    outcomes.length > 3 ||
    new Set(outcomes).size !== outcomes.length ||
    outcomes.some((outcome) => !OUTCOMES.includes(outcome)) ||
    (outcomes.includes('none') && outcomes.length > 1)
  )
    throw new ResearchError(400, '学习发展反馈选项无效；尚未感到变化不能与其他变化同时选择');
  return {
    requestKey: requestKey(value.requestKey),
    module: value.module,
    purpose: value.purpose,
    helpfulness: value.helpfulness,
    barriers,
    outcomes: [...outcomes],
    comment: value.comment === undefined ? '' : string(value.comment, 1000, false),
  };
}
function validateStudy(value) {
  keys(value, [
    'requestKey',
    'title',
    'description',
    'knowledgeTarget',
    'comparability',
    'selectionNote',
    'questionVersion',
    'modules',
    'minDelayedHours',
    'phases',
  ]);
  if (
    typeof value.questionVersion !== 'string' ||
    !VERSION.test(value.questionVersion) ||
    !Number.isInteger(value.minDelayedHours) ||
    value.minDelayedHours < 24 ||
    value.minDelayedHours > 720
  )
    throw new ResearchError(400, '研究版本或延迟时间无效，延迟测至少等待 24 小时');
  keys(value.phases, PHASES);
  const phases = {};
  for (const phase of PHASES) {
    const questions = value.phases[phase];
    if (!Array.isArray(questions) || questions.length < 1 || questions.length > 8)
      throw new ResearchError(400, '每个研究阶段需要 1 至 8 道单选题');
    const ids = new Set();
    phases[phase] = questions.map((question) => {
      keys(question, ['id', 'prompt', 'options', 'correctOption']);
      if (typeof question.id !== 'string' || !TOKEN.test(question.id) || ids.has(question.id))
        throw new ResearchError(400, '阶段题目编号无效或重复');
      ids.add(question.id);
      if (
        !Array.isArray(question.options) ||
        question.options.length < 2 ||
        question.options.length > 6
      )
        throw new ResearchError(400, '研究题目需要 2 至 6 个选项');
      const options = question.options.map((option) => {
        keys(option, ['id', 'label']);
        if (typeof option.id !== 'string' || !TOKEN.test(option.id))
          throw new ResearchError(400, '题目选项编号无效');
        return { id: option.id, label: string(option.label, 1000) };
      });
      if (
        typeof question.correctOption !== 'string' ||
        new Set(options.map((option) => option.id)).size !== options.length ||
        !options.some((option) => option.id === question.correctOption)
      )
        throw new ResearchError(400, '题目选项重复或评分答案无效');
      return {
        id: question.id,
        prompt: string(question.prompt, 2400),
        options,
        correctOption: question.correctOption,
      };
    });
  }
  if (phases.baseline.length !== phases.post.length || phases.post.length !== phases.delayed.length)
    throw new ResearchError(400, '前测、后测与延迟测题数需要一致；题目等价性仍需课程部核查');
  return {
    requestKey: requestKey(value.requestKey),
    title: string(value.title, 120),
    description: string(value.description, 1200),
    knowledgeTarget: string(value.knowledgeTarget, 240),
    comparability: string(value.comparability, 600),
    selectionNote: string(value.selectionNote, 600),
    questionVersion: value.questionVersion,
    modules: list(value.modules, MODULES, MODULES.length),
    minDelayedHours: value.minDelayedHours,
    phases,
  };
}
function validateJoin(value) {
  keys(value, ['requestKey', 'consent', 'goal']);
  if (value.consent !== true || !PURPOSES.includes(value.goal))
    throw new ResearchError(400, '研究参与需要本人同意并说明学习目的');
  return { requestKey: requestKey(value.requestKey), goal: value.goal };
}
function validateAttempt(value) {
  keys(value, ['requestKey', 'phase', 'answers', 'assistance']);
  if (!PHASES.includes(value.phase) || !ASSISTANCE.includes(value.assistance))
    throw new ResearchError(400, '研究阶段或辅助方式无效');
  keys(value.answers, Object.keys(value.answers || {}));
  if (
    Object.keys(value.answers).length > 8 ||
    Object.entries(value.answers).some(
      ([id, answer]) => !TOKEN.test(id) || typeof answer !== 'string' || !TOKEN.test(answer),
    )
  )
    throw new ResearchError(400, '研究作答格式无效');
  return {
    requestKey: requestKey(value.requestKey),
    phase: value.phase,
    answers: { ...value.answers },
    assistance: value.assistance,
  };
}
function parse(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}
function iso(value) {
  if (!value) return null;
  const utc =
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2} /.test(value)
      ? `${value.replace(' ', 'T')}Z`
      : value;
  return new Date(utc).toISOString();
}
function sqlDate(value) {
  return new Date(value).toISOString().slice(0, -1).replace('T', ' ');
}
function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function studyMeta(study) {
  return Object.fromEntries(
    [
      'id',
      'title',
      'description',
      'knowledgeTarget',
      'comparability',
      'selectionNote',
      'questionVersion',
      'modules',
      'minDelayedHours',
      'createdAt',
    ].map((key) => [key, study[key]]),
  );
}
function availableStage(study, enrollment, attempts, now) {
  if (!enrollment) return { nextPhase: null, availableAt: null, questions: [] };
  const nextPhase =
    PHASES.find((phase) => !attempts.some((attempt) => attempt.phase === phase)) || null;
  let availableAt = null;
  if (['delayed', 'transfer'].includes(nextPhase)) {
    const post = attempts.find((attempt) => attempt.phase === 'post');
    if (!post) return { nextPhase, availableAt: null, questions: [] };
    availableAt = new Date(
      new Date(post.createdAt).getTime() + study.minDelayedHours * 3600000,
    ).toISOString();
  }
  const ready = nextPhase && (!availableAt || new Date(availableAt) <= now);
  return {
    nextPhase,
    availableAt,
    questions: ready
      ? study.phases[nextPhase].map(({ correctOption, ...question }) => question)
      : [],
  };
}
function scoreAttempt(study, enrollment, attempts, value, now) {
  const stage = availableStage(study, enrollment, attempts, now);
  if (!enrollment) throw new ResearchError(403, '请先自愿参加这项研究');
  if (stage.nextPhase !== value.phase)
    throw new ResearchError(409, '请按前测、后测、延迟测和迁移任务的顺序完成，每阶段只提交一次');
  if (!stage.questions.length) throw new ResearchError(409, '尚未到延迟测时间，请稍后回来');
  const questions = study.phases[value.phase];
  if (
    Object.keys(value.answers).length !== questions.length ||
    questions.some(
      (question) => !question.options.some((option) => option.id === value.answers[question.id]),
    )
  )
    throw new ResearchError(400, '请完成当前阶段所有题目，不支持额外题目或未知选项');
  return {
    phase: value.phase,
    score: questions.filter((question) => value.answers[question.id] === question.correctOption)
      .length,
    maxScore: questions.length,
    assistance: value.assistance,
    answers: value.answers,
    questionVersion: study.questionVersion,
  };
}
function ownerAttempt(attempt) {
  return Object.fromEntries(
    [
      'id',
      'studyId',
      'phase',
      'score',
      'maxScore',
      'assistance',
      'questionVersion',
      'createdAt',
    ].map((key) => [key, attempt[key]]),
  );
}
function publicFeedback(row) {
  return Object.fromEntries(
    ['id', 'module', 'purpose', 'helpfulness', 'barriers', 'outcomes', 'comment', 'createdAt'].map(
      (key) => [key, key === 'outcomes' ? row.outcomes || [] : row[key]],
    ),
  );
}
function normalizeStudy(row) {
  return { id: String(row.id), ...parse(row.definition_json), createdAt: iso(row.created_at) };
}
function normalizeFeedback(row) {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    ...parse(row.content_json),
    createdAt: iso(row.created_at),
  };
}
function normalizeEnrollment(row) {
  return {
    studyId: String(row.study_id),
    userId: String(row.user_id),
    goal: row.goal,
    joinedAt: iso(row.joined_at),
  };
}
function normalizeAttempt(row) {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    studyId: String(row.study_id),
    phase: row.phase,
    score: Number(row.score),
    maxScore: Number(row.max_score),
    assistance: row.assistance,
    questionVersion: row.question_version,
    createdAt: iso(row.created_at),
  };
}

async function ensureLearningResearchTables(pool) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS learning_research_feedback (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, user_id BIGINT NOT NULL, content_json JSON NOT NULL, created_at DATETIME(3) NOT NULL, INDEX idx_research_feedback_owner (user_id, id), INDEX idx_research_feedback_retention (created_at), CONSTRAINT fk_research_feedback_owner FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS learning_research_studies (id CHAR(36) NOT NULL PRIMARY KEY, creator_id BIGINT NULL, definition_json JSON NOT NULL, created_at DATETIME(3) NOT NULL, CONSTRAINT fk_research_study_creator FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE SET NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS learning_research_enrollments (study_id CHAR(36) NOT NULL, user_id BIGINT NOT NULL, goal VARCHAR(24) NOT NULL, joined_at DATETIME(3) NOT NULL, PRIMARY KEY (study_id, user_id), INDEX idx_research_enrollment_retention (joined_at), CONSTRAINT fk_research_enrollment_owner FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE, CONSTRAINT fk_research_enrollment_study FOREIGN KEY (study_id) REFERENCES learning_research_studies(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS learning_research_attempts (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, study_id CHAR(36) NOT NULL, user_id BIGINT NOT NULL, phase VARCHAR(16) NOT NULL, answers_json JSON NOT NULL, score SMALLINT UNSIGNED NOT NULL, max_score SMALLINT UNSIGNED NOT NULL, assistance VARCHAR(16) NOT NULL, question_version VARCHAR(64) NOT NULL, created_at DATETIME(3) NOT NULL, UNIQUE KEY uq_research_phase (study_id, user_id, phase), INDEX idx_research_attempt_retention (created_at), CONSTRAINT fk_research_attempt_participation FOREIGN KEY (study_id, user_id) REFERENCES learning_research_enrollments(study_id, user_id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS learning_research_requests (user_id BIGINT NOT NULL, request_key CHAR(36) NOT NULL, payload_hash CHAR(64) NOT NULL, result_json JSON NOT NULL, created_at DATETIME(3) NOT NULL, PRIMARY KEY (user_id, request_key), INDEX idx_research_request_retention (created_at), CONSTRAINT fk_research_request_owner FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS learning_research_limits (user_id BIGINT NOT NULL PRIMARY KEY, window_start DATETIME(3) NOT NULL, request_count SMALLINT UNSIGNED NOT NULL DEFAULT 0, CONSTRAINT fk_research_limit_owner FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  ];
  for (const statement of statements) await pool.execute(statement);
}
function createMysqlResearchStore(pool, { clock = () => new Date() } = {}) {
  async function transaction(work) {
    for (let attempt = 0; ; attempt += 1) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const result = await work(connection);
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        // Only a confirmed deadlock rolls back the whole transaction. Never
        // replay uncertain commits, disconnections or ordinary domain errors.
        if (error.code !== 'ER_LOCK_DEADLOCK' || attempt >= 2) throw error;
      } finally {
        connection.release();
      }
      await delay(10 * (attempt + 1));
    }
  }
  async function mutation(userId, value, type, work) {
    return transaction(async (connection) => {
      const now = clock();
      await connection.execute(
        // Take the exclusive row lock immediately, retaining the existing quota.
        'INSERT INTO learning_research_limits (user_id, window_start, request_count) VALUES (?, ?, 0) ON DUPLICATE KEY UPDATE user_id = user_id',
        [userId, sqlDate(now)],
      );
      const [limits] = await connection.execute(
        {
          sql: 'SELECT window_start, request_count FROM learning_research_limits WHERE user_id = ? FOR UPDATE',
          dateStrings: true,
        },
        [userId],
      );
      const fingerprint = hash({ type, value });
      const [requests] = await connection.execute(
        'SELECT payload_hash, result_json FROM learning_research_requests WHERE user_id = ? AND request_key = ?',
        [userId, value.requestKey],
      );
      if (requests[0]) {
        if (requests[0].payload_hash !== fingerprint)
          throw new ResearchError(409, '提交标识已用于另一项研究操作');
        const prior = parse(requests[0].result_json);
        if (prior.removed === true)
          throw new ResearchError(409, '对应研究内容已删除，旧请求不会恢复内容');
        return { ...prior, duplicate: true };
      }
      const expired = now.getTime() - new Date(iso(limits[0].window_start)).getTime() >= 60000;
      if (!expired && Number(limits[0].request_count) >= 20)
        throw new ResearchError(429, '研究提交过于频繁，请一分钟后再试');
      await connection.execute(
        'UPDATE learning_research_limits SET window_start = ?, request_count = ? WHERE user_id = ?',
        [
          expired ? sqlDate(now) : sqlDate(iso(limits[0].window_start)),
          expired ? 1 : Number(limits[0].request_count) + 1,
          userId,
        ],
      );
      const result = await work(connection, now);
      await connection.execute(
        'INSERT INTO learning_research_requests (user_id, request_key, payload_hash, result_json, created_at) VALUES (?, ?, ?, ?, ?)',
        [userId, value.requestKey, fingerprint, JSON.stringify(result), sqlDate(now)],
      );
      return { ...result, duplicate: false };
    });
  }
  async function rows(query, params = []) {
    // This pool defaults to the host timezone. Our DATETIME values are UTC wall
    // times, so keep them as strings until iso() explicitly adds the UTC suffix.
    const [result] = await pool.execute({ sql: query, dateStrings: true }, params);
    return result;
  }
  return {
    clock,
    async prune() {
      const cutoff = sqlDate(new Date(clock().getTime() - RETENTION_DAYS * 86400000));
      return transaction(async (connection) => {
        await connection.execute(
          'DELETE a FROM learning_research_attempts a JOIN learning_research_enrollments e ON a.study_id = e.study_id AND a.user_id = e.user_id WHERE e.joined_at < ?',
          [cutoff],
        );
        for (const [table, field] of [
          ['learning_research_feedback', 'created_at'],
          ['learning_research_attempts', 'created_at'],
          ['learning_research_enrollments', 'joined_at'],
          ['learning_research_requests', 'created_at'],
        ])
          await connection.execute(`DELETE FROM ${table} WHERE ${field} < ?`, [cutoff]);
        await connection.execute('DELETE FROM learning_research_limits WHERE window_start < ?', [
          cutoff,
        ]);
      });
    },
    async studies() {
      return (
        await rows('SELECT * FROM learning_research_studies ORDER BY created_at DESC LIMIT 101')
      ).map(normalizeStudy);
    },
    async study(id) {
      const result = await rows('SELECT * FROM learning_research_studies WHERE id = ?', [id]);
      return result[0] ? normalizeStudy(result[0]) : null;
    },
    async feedback(userId, since) {
      return (
        await rows(
          `SELECT * FROM learning_research_feedback WHERE 1 = 1 ${userId ? 'AND user_id = ?' : ''} ${since ? 'AND created_at >= ?' : ''} ORDER BY id DESC LIMIT ${LIMIT + 1}`,
          [...(userId ? [userId] : []), ...(since ? [sqlDate(since)] : [])],
        )
      ).map(normalizeFeedback);
    },
    async enrollments(userId) {
      return (
        await rows(
          `SELECT * FROM learning_research_enrollments ${userId ? 'WHERE user_id = ?' : ''} ORDER BY joined_at DESC LIMIT ${LIMIT + 1}`,
          userId ? [userId] : [],
        )
      ).map(normalizeEnrollment);
    },
    async attempts(userId) {
      return (
        await rows(
          `SELECT * FROM learning_research_attempts ${userId ? 'WHERE user_id = ?' : ''} ORDER BY created_at DESC LIMIT ${LIMIT + 1}`,
          userId ? [userId] : [],
        )
      ).map(normalizeAttempt);
    },
    async registeredUserCount() {
      const result = await rows('SELECT COUNT(*) AS total FROM users');
      return Number(result[0].total);
    },
    addFeedback(userId, value) {
      return mutation(userId, value, 'feedback', async (connection, now) => {
        const { requestKey: ignored, ...content } = value;
        const [result] = await connection.execute(
          'INSERT INTO learning_research_feedback (user_id, content_json, created_at) VALUES (?, ?, ?)',
          [userId, JSON.stringify(content), sqlDate(now)],
        );
        return {
          feedback: publicFeedback({
            id: String(result.insertId),
            ...content,
            createdAt: now.toISOString(),
          }),
        };
      });
    },
    async removeFeedback(userId, id) {
      return transaction(async (connection) => {
        await connection.execute(
          'SELECT user_id FROM learning_research_limits WHERE user_id = ? FOR UPDATE',
          [userId],
        );
        const [result] = await connection.execute(
          'DELETE FROM learning_research_feedback WHERE user_id = ? AND id = ?',
          [userId, id],
        );
        await connection.execute(
          "UPDATE learning_research_requests SET result_json = ? WHERE user_id = ? AND JSON_UNQUOTE(JSON_EXTRACT(result_json, '$.feedback.id')) = ?",
          [JSON.stringify({ removed: true }), userId, id],
        );
        return Boolean(result.affectedRows);
      });
    },
    addStudy(userId, value) {
      return mutation(userId, value, 'study', async (connection, now) => {
        const [count] = await connection.execute(
          'SELECT COUNT(*) AS total FROM learning_research_studies',
        );
        if (Number(count[0].total) >= 100)
          throw new ResearchError(409, '研究登记已达上限，请先整理既有研究');
        const { requestKey: ignored, ...definition } = value;
        const study = { id: crypto.randomUUID(), ...definition, createdAt: now.toISOString() };
        await connection.execute(
          'INSERT INTO learning_research_studies (id, creator_id, definition_json, created_at) VALUES (?, ?, ?, ?)',
          [study.id, userId, JSON.stringify(definition), sqlDate(now)],
        );
        return { study: studyMeta(study) };
      });
    },
    join(userId, studyId, value) {
      return mutation(userId, { ...value, studyId }, 'join', async (connection, now) => {
        const [study] = await connection.execute(
          'SELECT id FROM learning_research_studies WHERE id = ?',
          [studyId],
        );
        if (!study[0]) throw new ResearchError(404, '研究不存在');
        const [existing] = await connection.execute(
          {
            sql: 'SELECT * FROM learning_research_enrollments WHERE user_id = ? AND study_id = ? FOR UPDATE',
            dateStrings: true,
          },
          [userId, studyId],
        );
        if (existing[0]) throw new ResearchError(409, '已经参加这项研究');
        await connection.execute(
          'INSERT INTO learning_research_enrollments (study_id, user_id, goal, joined_at) VALUES (?, ?, ?, ?)',
          [studyId, userId, value.goal, sqlDate(now)],
        );
        return { joined: true, studyId };
      });
    },
    attempt(userId, studyId, value) {
      return mutation(userId, { ...value, studyId }, 'attempt', async (connection, now) => {
        const [studies] = await connection.execute(
          { sql: 'SELECT * FROM learning_research_studies WHERE id = ?', dateStrings: true },
          [studyId],
        );
        if (!studies[0]) throw new ResearchError(404, '研究不存在');
        const [enrollments] = await connection.execute(
          {
            sql: 'SELECT * FROM learning_research_enrollments WHERE user_id = ? AND study_id = ? FOR UPDATE',
            dateStrings: true,
          },
          [userId, studyId],
        );
        const [attempts] = await connection.execute(
          {
            sql: 'SELECT * FROM learning_research_attempts WHERE user_id = ? AND study_id = ?',
            dateStrings: true,
          },
          [userId, studyId],
        );
        const score = scoreAttempt(
          normalizeStudy(studies[0]),
          enrollments[0],
          attempts.map(normalizeAttempt),
          value,
          now,
        );
        const [result] = await connection.execute(
          'INSERT INTO learning_research_attempts (study_id, user_id, phase, answers_json, score, max_score, assistance, question_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            studyId,
            userId,
            score.phase,
            JSON.stringify(score.answers),
            score.score,
            score.maxScore,
            score.assistance,
            score.questionVersion,
            sqlDate(now),
          ],
        );
        return {
          attempt: ownerAttempt({
            id: String(result.insertId),
            studyId,
            ...score,
            createdAt: now.toISOString(),
          }),
        };
      });
    },
    async withdraw(userId, studyId) {
      return transaction(async (connection) => {
        await connection.execute(
          'SELECT user_id FROM learning_research_limits WHERE user_id = ? FOR UPDATE',
          [userId],
        );
        await connection.execute(
          'DELETE FROM learning_research_attempts WHERE user_id = ? AND study_id = ?',
          [userId, studyId],
        );
        const [result] = await connection.execute(
          'DELETE FROM learning_research_enrollments WHERE user_id = ? AND study_id = ?',
          [userId, studyId],
        );
        await connection.execute(
          "UPDATE learning_research_requests SET result_json = ? WHERE user_id = ? AND (JSON_UNQUOTE(JSON_EXTRACT(result_json, '$.studyId')) = ? OR JSON_UNQUOTE(JSON_EXTRACT(result_json, '$.attempt.studyId')) = ?)",
          [JSON.stringify({ removed: true }), userId, studyId, studyId],
        );
        return Boolean(result.affectedRows);
      });
    },
  };
}

function createMemoryResearchStore({
  users = [],
  studies = [],
  feedback = [],
  enrollments = [],
  attempts = [],
  clock = () => new Date(),
} = {}) {
  const state = structuredClone({ studies, feedback, enrollments, attempts });
  const requests = new Map();
  const limits = new Map();
  let nextId =
    Math.max(
      0,
      ...feedback.map((row) => Number(row.id) || 0),
      ...attempts.map((row) => Number(row.id) || 0),
    ) + 1;
  async function mutate(userId, value, type, work) {
    const user = String(userId);
    const key = `${user}:${value.requestKey}`;
    const fingerprint = hash({ type, value });
    const existing = requests.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        throw new ResearchError(409, '提交标识已用于另一项研究操作');
      if (existing.result.removed === true)
        throw new ResearchError(409, '对应研究内容已删除，旧请求不会恢复内容');
      return { ...structuredClone(existing.result), duplicate: true };
    }
    const now = clock();
    const limit = limits.get(user);
    if (limit && now - limit.started < 60000 && limit.count >= 20)
      throw new ResearchError(429, '研究提交过于频繁，请一分钟后再试');
    const result = work(now, user);
    limits.set(
      user,
      limit && now - limit.started < 60000
        ? { ...limit, count: limit.count + 1 }
        : { started: now.getTime(), count: 1 },
    );
    requests.set(key, {
      fingerprint,
      result: structuredClone(result),
      userId: user,
      createdAt: now.toISOString(),
    });
    return { ...structuredClone(result), duplicate: false };
  }
  return {
    clock,
    state,
    async prune() {
      const cutoff = clock().getTime() - RETENTION_DAYS * 86400000;
      state.feedback = state.feedback.filter((row) => new Date(row.createdAt).getTime() >= cutoff);
      const old = new Set(
        state.enrollments
          .filter((row) => new Date(row.joinedAt).getTime() < cutoff)
          .map((row) => `${row.userId}:${row.studyId}`),
      );
      state.enrollments = state.enrollments.filter(
        (row) => new Date(row.joinedAt).getTime() >= cutoff,
      );
      state.attempts = state.attempts.filter(
        (row) =>
          new Date(row.createdAt).getTime() >= cutoff && !old.has(`${row.userId}:${row.studyId}`),
      );
      for (const [key, value] of requests)
        if (new Date(value.createdAt).getTime() < cutoff) requests.delete(key);
      for (const [key, value] of limits) if (value.started < cutoff) limits.delete(key);
    },
    async studies() {
      return structuredClone(state.studies);
    },
    async study(id) {
      return structuredClone(state.studies.find((study) => study.id === id) || null);
    },
    async feedback(userId, since) {
      return structuredClone(
        state.feedback
          .filter(
            (row) =>
              (!userId || String(row.userId) === String(userId)) &&
              (!since || new Date(row.createdAt) >= since),
          )
          .slice(0, LIMIT + 1),
      );
    },
    async enrollments(userId) {
      return structuredClone(
        state.enrollments
          .filter((row) => !userId || String(row.userId) === String(userId))
          .slice(0, LIMIT + 1),
      );
    },
    async attempts(userId) {
      return structuredClone(
        state.attempts
          .filter((row) => !userId || String(row.userId) === String(userId))
          .slice(0, LIMIT + 1),
      );
    },
    async registeredUserCount() {
      return users.length;
    },
    addFeedback(userId, value) {
      return mutate(userId, value, 'feedback', (now, user) => {
        const { requestKey: ignored, ...content } = value;
        const row = {
          id: String(nextId),
          userId: user,
          ...content,
          createdAt: now.toISOString(),
        };
        nextId += 1;
        state.feedback.unshift(row);
        return { feedback: publicFeedback(row) };
      });
    },
    async removeFeedback(userId, id) {
      const before = state.feedback.length;
      state.feedback = state.feedback.filter(
        (row) => !(String(row.userId) === String(userId) && row.id === id),
      );
      for (const [key, value] of requests)
        if (value.userId === String(userId) && value.result.feedback?.id === id)
          requests.set(key, { ...value, result: { removed: true } });
      return before !== state.feedback.length;
    },
    addStudy(userId, value) {
      return mutate(userId, value, 'study', (now) => {
        if (state.studies.length >= 100) throw new ResearchError(409, '研究登记已达上限');
        const { requestKey: ignored, ...definition } = value;
        const study = { id: crypto.randomUUID(), ...definition, createdAt: now.toISOString() };
        state.studies.unshift(study);
        return { study: studyMeta(study) };
      });
    },
    join(userId, studyId, value) {
      return mutate(userId, { ...value, studyId }, 'join', (now, user) => {
        if (!state.studies.some((study) => study.id === studyId))
          throw new ResearchError(404, '研究不存在');
        if (state.enrollments.some((row) => String(row.userId) === user && row.studyId === studyId))
          throw new ResearchError(409, '已经参加这项研究');
        state.enrollments.unshift({
          studyId,
          userId: user,
          goal: value.goal,
          joinedAt: now.toISOString(),
        });
        return { joined: true, studyId };
      });
    },
    attempt(userId, studyId, value) {
      return mutate(userId, { ...value, studyId }, 'attempt', (now, user) => {
        const study = state.studies.find((entry) => entry.id === studyId);
        if (!study) throw new ResearchError(404, '研究不存在');
        const enrollment = state.enrollments.find(
          (row) => String(row.userId) === user && row.studyId === studyId,
        );
        const ownAttempts = state.attempts.filter(
          (row) => String(row.userId) === user && row.studyId === studyId,
        );
        const score = scoreAttempt(study, enrollment, ownAttempts, value, now);
        const row = {
          id: String(nextId),
          userId: user,
          studyId,
          ...score,
          createdAt: now.toISOString(),
        };
        nextId += 1;
        state.attempts.unshift(row);
        return { attempt: ownerAttempt(row) };
      });
    },
    async withdraw(userId, studyId) {
      const user = String(userId);
      const before = state.enrollments.length;
      state.enrollments = state.enrollments.filter(
        (row) => !(String(row.userId) === user && row.studyId === studyId),
      );
      state.attempts = state.attempts.filter(
        (row) => !(String(row.userId) === user && row.studyId === studyId),
      );
      for (const [key, value] of requests)
        if (
          value.userId === user &&
          (value.result.studyId === studyId || value.result.attempt?.studyId === studyId)
        )
          requests.set(key, { ...value, result: { removed: true } });
      return before !== state.enrollments.length;
    },
  };
}

function unique(rows) {
  return new Set(rows.map((row) => String(row.userId))).size;
}
function mean(values) {
  return values.length
    ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100
    : null;
}
function respondentMean(rows) {
  const people = new Map();
  for (const row of rows) {
    const values = people.get(String(row.userId)) || [];
    values.push(row.helpfulness);
    people.set(String(row.userId), values);
  }
  return mean([...people.values()].map((values) => mean(values)));
}
function stageEligibility(phase, cohort, ownByUser, study, now, complete) {
  if (!complete)
    return {
      available: false,
      eligibleCount: null,
      awaitingSubmissionCount: null,
      notYetDueCount: null,
      missingPrerequisiteCount: null,
    };
  let submittedCount = 0;
  let awaitingSubmissionCount = 0;
  let notYetDueCount = 0;
  let missingPrerequisiteCount = 0;
  for (const participant of cohort) {
    const own = ownByUser.get(String(participant.userId)) || [];
    if (own.some((attempt) => attempt.phase === phase)) {
      submittedCount += 1;
      continue;
    }
    const previousPhase = PHASES[PHASES.indexOf(phase) - 1];
    if (previousPhase && !own.some((attempt) => attempt.phase === previousPhase)) {
      missingPrerequisiteCount += 1;
      continue;
    }
    if (['delayed', 'transfer'].includes(phase)) {
      const post = own.find((attempt) => attempt.phase === 'post');
      if (!post) {
        missingPrerequisiteCount += 1;
        continue;
      }
      if (new Date(post.createdAt).getTime() + study.minDelayedHours * 3600000 > now.getTime()) {
        notYetDueCount += 1;
        continue;
      }
    }
    awaitingSubmissionCount += 1;
  }
  return {
    available: true,
    eligibleCount: submittedCount + awaitingSubmissionCount,
    awaitingSubmissionCount,
    notYetDueCount,
    missingPrerequisiteCount,
  };
}
function researchSummary({
  feedback: feedbackRows,
  studies,
  enrollments: enrollmentRows,
  attempts: attemptRows,
  registeredUserCount,
  since = null,
  window = '30',
  now = new Date(),
}) {
  const complete = [feedbackRows, enrollmentRows, attemptRows].every(
    (rows) => rows.length <= LIMIT,
  );
  const studyComplete = [enrollmentRows, attemptRows].every((rows) => rows.length <= LIMIT);
  const feedback = feedbackRows.slice(0, LIMIT);
  const enrollments = enrollmentRows.slice(0, LIMIT);
  const attempts = attemptRows.slice(0, LIMIT);
  const feedbackRespondents = unique(feedback);
  const enrollmentsByStudy = new Map();
  const attemptsByStudyUser = new Map();
  for (const enrollment of enrollments) {
    const rows = enrollmentsByStudy.get(enrollment.studyId) || [];
    rows.push(enrollment);
    enrollmentsByStudy.set(enrollment.studyId, rows);
  }
  for (const attempt of attempts) {
    const people = attemptsByStudyUser.get(attempt.studyId) || new Map();
    const own = people.get(String(attempt.userId)) || [];
    own.push(attempt);
    people.set(String(attempt.userId), own);
    attemptsByStudyUser.set(attempt.studyId, people);
  }
  const groups = (field, values) =>
    values.map((value) => {
      const rows = feedback.filter((row) =>
        ['barriers', 'outcomes'].includes(field)
          ? (row[field] || []).includes(value)
          : row[field] === value,
      );
      const respondentCount = unique(rows);
      const groupKey = { barriers: 'barrier', outcomes: 'outcome' }[field] || field;
      return {
        [groupKey]: value,
        responseCount: rows.length,
        respondentCount,
        ...(field === 'module'
          ? {
              meanHelpfulness: respondentCount >= MIN_GROUP ? respondentMean(rows) : null,
              suppressed: respondentCount < MIN_GROUP,
            }
          : {}),
      };
    });
  const studyResults = studies.map((study) => {
    const allParticipants = enrollmentsByStudy.get(study.id) || [];
    const ownByUser = attemptsByStudyUser.get(study.id) || new Map();
    // Select people with any research activity inside the window; retain their earlier
    // baseline for pairing instead of truncating it at the display-window boundary.
    const participants = allParticipants.filter(
      (row) =>
        !since ||
        new Date(row.joinedAt) >= since ||
        (ownByUser.get(String(row.userId)) || []).some(
          (attempt) => new Date(attempt.createdAt) >= since,
        ),
    );
    const selected = participants.flatMap((row) => ownByUser.get(String(row.userId)) || []);
    const pairSummary = (phase, cohort = participants) => {
      const values = cohort
        .map((participant) => {
          const own = ownByUser.get(String(participant.userId)) || [];
          const before = own.find((row) => row.phase === (phase === 'post' ? 'baseline' : 'post'));
          const after = own.find((row) => row.phase === phase);
          return before && after && before.questionVersion === after.questionVersion
            ? {
                change: 100 * (after.score / after.maxScore - before.score / before.maxScore),
                independent: before.assistance === 'none' && after.assistance === 'none',
              }
            : null;
        })
        .filter(Boolean);
      const independent = values.filter((row) => row.independent);
      const assisted = values.filter((row) => !row.independent);
      return {
        pairCount: values.length,
        meanChange: values.length >= MIN_GROUP ? mean(values.map((row) => row.change)) : null,
        independentPairCount: independent.length,
        assistedPairCount: assisted.length,
        independentMeanChange:
          independent.length >= MIN_GROUP ? mean(independent.map((row) => row.change)) : null,
        assistedMeanChange:
          assisted.length >= MIN_GROUP ? mean(assisted.map((row) => row.change)) : null,
        suppressed: values.length < MIN_GROUP,
      };
    };
    return {
      ...studyMeta(study),
      participantCount: participants.length,
      retainedCohort: {
        participantCount: allParticipants.length,
        stages: PHASES.map((phase) => {
          const submittedCount = allParticipants.filter((participant) =>
            (ownByUser.get(String(participant.userId)) || []).some(
              (attempt) => attempt.phase === phase,
            ),
          ).length;
          return {
            phase,
            submittedCount,
            missingCount: allParticipants.length - submittedCount,
            eligibility: stageEligibility(
              phase,
              allParticipants,
              ownByUser,
              study,
              now,
              studyComplete,
            ),
          };
        }),
      },
      goals: PURPOSES.map((goal) => ({
        goal,
        participantCount: participants.filter((row) => row.goal === goal).length,
      })),
      byGoal: PURPOSES.map((goal) => {
        const cohort = participants.filter((row) => row.goal === goal);
        return {
          goal,
          participantCount: cohort.length,
          paired: pairSummary('post', cohort),
          retention: pairSummary('delayed', cohort),
        };
      }),
      stages: PHASES.map((phase) => {
        const rows = selected.filter((row) => row.phase === phase);
        const independent = rows.filter((row) => row.assistance === 'none');
        const assisted = rows.filter((row) => row.assistance !== 'none');
        return {
          phase,
          submittedCount: rows.length,
          missingCount: participants.length - rows.length,
          independentCount: independent.length,
          assistedCount: assisted.length,
          meanPercent:
            rows.length >= MIN_GROUP
              ? mean(rows.map((row) => (100 * row.score) / row.maxScore))
              : null,
          independentMeanPercent:
            independent.length >= MIN_GROUP
              ? mean(independent.map((row) => (100 * row.score) / row.maxScore))
              : null,
          assistedMeanPercent:
            assisted.length >= MIN_GROUP
              ? mean(assisted.map((row) => (100 * row.score) / row.maxScore))
              : null,
          suppressed: rows.length < MIN_GROUP,
          eligibility: stageEligibility(phase, participants, ownByUser, study, now, studyComplete),
        };
      }),
      paired: pairSummary('post'),
      retention: pairSummary('delayed'),
      limitations: [
        '这是自愿参与的观察性研究，没有随机对照，不能证明平台造成了分数变化。',
        '题目由研究登记提供，服务端按固定答案评分；前后题等价性和知识目标需要课程部复核。',
        '无辅助仅为参与者自报，不是监考或独立能力认证。',
        '缺测不计为零分；延迟测与迁移任务仅代表本次任务证据。',
        '当前窗口缺测人数仅对应入选窗口的人，不是全体招募者的失访率；完整保留队列另列。未交延迟测还可能尚未到期。',
        '不同学习目的不能合并为同一能力评价。',
      ],
    };
  });
  return {
    window,
    retentionDays: RETENTION_DAYS,
    minGroupSize: MIN_GROUP,
    dataCoverage: { complete, limit: LIMIT },
    feedback: {
      responseCount: feedback.length,
      respondentCount: feedbackRespondents,
      registeredUserCount,
      responseCoverage:
        complete && registeredUserCount > 0 ? feedbackRespondents / registeredUserCount : null,
      helpfulness: {
        mean: feedbackRespondents >= MIN_GROUP ? respondentMean(feedback) : null,
        suppressed: feedbackRespondents < MIN_GROUP,
        basis: 'respondent_balanced_mean',
      },
      modules: groups('module', MODULES),
      purposes: groups('purpose', PURPOSES),
      barriers: groups('barriers', BARRIERS),
      byOutcome: groups('outcomes', OUTCOMES),
      outcomeResponseCount: feedback.filter((row) => row.outcomes?.length).length,
      outcomeRespondentCount: unique(feedback.filter((row) => row.outcomes?.length)),
      outcomesUnknownResponseCount: feedback.filter((row) => !row.outcomes?.length).length,
    },
    studies: studyResults,
    limitations: [
      '帮助程度是本人反馈，不是知识掌握测量；同一人可反馈多次，人数去重，均值先按每人求平均再合并。',
      '理解、独立推进、方向、探索与协作的变化均为本人自报，不是能力认证；未选择属于未知，不等于没有变化。',
      '自愿反馈可能存在选择偏差；没有参与或没有反馈不等于没有受益。',
      '反馈覆盖率分母为当前全部注册账号，不代表所有用户都看过反馈入口。',
      '管理员只能看到结构化汇总，不返回个人反馈原文、作答、身份或私人笔记。',
      '少于 5 人不展示平均结果；无数据与没有帮助是不同状态。',
      '研究窗口按参与或研究活动筛选人，配对保留这些人在保留期内的前测。',
      ...(complete ? [] : ['读取超过上限，仅显示有限样本；覆盖率不可据此推断。']),
    ],
  };
}

function createLearningResearchRouter({
  pool,
  requireAuth,
  requireAdmin,
  store = createMysqlResearchStore(pool),
}) {
  const router = express.Router();
  const now = () => (store.clock ? store.clock() : new Date());
  function route(handler, admin = false) {
    return async (req, res) => {
      res.set('Cache-Control', 'private, no-store');
      try {
        const authenticate = admin ? requireAdmin : requireAuth;
        if (typeof authenticate !== 'function')
          throw new ResearchError(admin ? 403 : 401, admin ? '需要管理员权限' : '需要登录');
        const user = await authenticate(req, res);
        if (!user) return;
        await store.prune();
        await handler(req, res, user);
      } catch (error) {
        if (error.status === 429) res.set('Retry-After', '60');
        if (!error.status)
          console.error('Learning research request failed:', error.code || error.name);
        res
          .status(error.status || 500)
          .json({ message: error.status ? error.message : '平台学习研究服务暂时不可用' });
      }
    };
  }
  function studyId(value) {
    if (typeof value !== 'string' || !UUID.test(value))
      throw new ResearchError(400, '研究编号无效');
    return value.toLowerCase();
  }
  router.get(
    '/me',
    route(async (req, res, user) => {
      const [feedback, enrollments, attempts] = await Promise.all([
        store.feedback(user.id),
        store.enrollments(user.id),
        store.attempts(user.id),
      ]);
      res.json({
        policy: POLICY,
        feedback: feedback.slice(0, LIMIT).map(publicFeedback),
        enrollments: enrollments.slice(0, LIMIT).map((row) => ({
          studyId: row.studyId,
          goal: row.goal,
          joinedAt: row.joinedAt,
          attempts: attempts.filter((attempt) => attempt.studyId === row.studyId).map(ownerAttempt),
        })),
        dataCoverage: {
          complete: [feedback, enrollments, attempts].every((rows) => rows.length <= LIMIT),
          limit: LIMIT,
        },
      });
    }),
  );
  router.post(
    '/feedback',
    route(async (req, res, user) => {
      const result = await store.addFeedback(user.id, validateFeedback(req.body));
      res.status(result.duplicate ? 200 : 201).json(result);
    }),
  );
  router.delete(
    '/feedback/:id',
    route(async (req, res, user) => {
      if (!/^[1-9]\d{0,18}$/.test(req.params.id)) throw new ResearchError(400, '反馈编号无效');
      if (!(await store.removeFeedback(user.id, req.params.id)))
        throw new ResearchError(404, '反馈不存在');
      res.json({ removed: true });
    }),
  );
  router.get(
    '/studies',
    route(async (req, res, user) => {
      const [studies, enrollments, attempts] = await Promise.all([
        store.studies(),
        store.enrollments(user.id),
        store.attempts(user.id),
      ]);
      res.json({
        policy: POLICY,
        studies: studies.slice(0, 100).map((study) => {
          const enrollment = enrollments.find((row) => row.studyId === study.id);
          const own = attempts.filter((row) => row.studyId === study.id);
          return {
            ...studyMeta(study),
            status: 'open',
            phaseOrder: PHASES,
            enrolled: Boolean(enrollment),
            goal: enrollment?.goal || null,
            ...availableStage(study, enrollment, own, now()),
          };
        }),
      });
    }),
  );
  router.post(
    '/studies',
    route(async (req, res, user) => {
      const result = await store.addStudy(user.id, validateStudy(req.body));
      res.status(result.duplicate ? 200 : 201).json(result);
    }, true),
  );
  router.post(
    '/studies/:id/join',
    route(async (req, res, user) => {
      const result = await store.join(user.id, studyId(req.params.id), validateJoin(req.body));
      res.status(result.duplicate ? 200 : 201).json(result);
    }),
  );
  router.post(
    '/studies/:id/attempts',
    route(async (req, res, user) => {
      const result = await store.attempt(
        user.id,
        studyId(req.params.id),
        validateAttempt(req.body),
      );
      res.status(result.duplicate ? 200 : 201).json(result);
    }),
  );
  router.delete(
    '/studies/:id/participation',
    route(async (req, res, user) => {
      if (!(await store.withdraw(user.id, studyId(req.params.id))))
        throw new ResearchError(404, '尚未参加这项研究');
      res.json({ withdrawn: true, attemptsRemoved: true });
    }),
  );
  router.get(
    '/admin',
    route(async (req, res) => {
      const window = req.query.window || '30';
      if (!['7', '30', 'all'].includes(window))
        throw new ResearchError(400, '研究统计范围只能为 7、30 或 all');
      const since = window === 'all' ? null : new Date(now().getTime() - Number(window) * 86400000);
      const [feedback, studies, enrollments, attempts, registeredUserCount] = await Promise.all([
        store.feedback(null, since),
        store.studies(),
        store.enrollments(),
        store.attempts(),
        store.registeredUserCount(),
      ]);
      res.json(
        researchSummary({
          feedback,
          studies,
          enrollments,
          attempts,
          registeredUserCount,
          since,
          window,
          now: now(),
        }),
      );
    }, true),
  );
  return router;
}

module.exports = {
  createLearningResearchRouter,
  createMysqlResearchStore,
  createMemoryResearchStore,
  ensureLearningResearchTables,
  validateFeedback,
  validateStudy,
  validateJoin,
  validateAttempt,
  researchSummary,
  availableStage,
  scoreAttempt,
  ResearchError,
  MODULES,
  PURPOSES,
  BARRIERS,
  OUTCOMES,
  PHASES,
  POLICY,
};
