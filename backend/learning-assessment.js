const express = require('express');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RECORD_ID = /^[1-9]\d{0,18}$/;
const QUESTION_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/;
const TYPES = ['single_choice', 'multiple_choice', 'numeric', 'short_answer'];
const DIFFICULTIES = ['basic', 'standard', 'challenge'];
const ASSESSMENT_ROLES = ['practice', 'selftest', 'exploration'];
const MAX_QUESTIONS = 40;

class AssessmentError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
function invalid(message) {
  throw new AssessmentError(400, message);
}
function object(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label}格式无效`);
  if (Object.keys(value).some((key) => !keys.includes(key))) invalid(`${label}含有未知字段`);
}
function text(value, max, label, required = true) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()))
    invalid(`${label}无效（最多 ${max} 字）`);
  return value.trim();
}
function finite(value, min, max, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    invalid(`${label}必须是范围内的有限数值`);
  return value;
}
function getAssessmentDocumentVersion(markdown) {
  return crypto
    .createHash('sha256')
    .update(String(markdown || ''))
    .digest('hex');
}

// This optional machine-readable block augments the existing course Markdown template.
// Strip every such block from student-facing course Markdown, including an unclosed block.
function assessmentBlocks(markdown) {
  const source = String(markdown || '').replace(/\r\n?/g, '\n');
  const lines = source.split('\n');
  const blocks = [];
  let start = -1;
  let fence = '';
  for (let index = 0; index < lines.length; index += 1) {
    if (start < 0) {
      const opening = lines[index].match(/^\s{0,3}(`{3,}|~{3,})\s*freebbs-quiz\s*$/i);
      if (opening) {
        start = index;
        fence = opening[1];
      }
    } else {
      const closing = lines[index].trim();
      if (
        closing.length >= fence.length &&
        closing[0] === fence[0] &&
        /^(?:`+|~+)$/.test(closing)
      ) {
        blocks.push({ start, end: index, content: lines.slice(start + 1, index).join('\n') });
        start = -1;
      }
    }
  }
  if (start >= 0) blocks.push({ start, end: lines.length - 1, content: null });
  return { lines, blocks };
}
function stripAssessmentBlocks(markdown) {
  const { lines, blocks } = assessmentBlocks(markdown);
  return lines
    .filter((line, index) => !blocks.some((block) => index >= block.start && index <= block.end))
    .join('\n');
}

function validateQuestion(raw, metadata) {
  object(
    raw,
    [
      'id',
      'type',
      'prompt',
      'options',
      'source',
      'scoring',
      'explanation',
      'difficulty',
      'assessmentRole',
      'learningObjective',
      'misconceptions',
    ],
    '题目',
  );
  const id = text(raw.id, 120, '题目编号');
  if (!QUESTION_ID.test(id) || !TYPES.includes(raw.type)) invalid('题目编号或题型无效');
  if (raw.difficulty !== undefined && !DIFFICULTIES.includes(raw.difficulty))
    invalid('题目难度须为 basic、standard 或 challenge');
  const defaultRole = metadata.official ? 'selftest' : 'practice';
  const assessmentRole = raw.assessmentRole === undefined ? defaultRole : raw.assessmentRole;
  if (!ASSESSMENT_ROLES.includes(assessmentRole)) invalid('题目用途无效');
  const question = {
    id,
    type: raw.type,
    prompt: text(raw.prompt, 12000, '题干'),
    source: text(raw.source, 1000, '题目来源', false) || metadata.source,
    explanation: text(raw.explanation, 12000, '解析', false),
    questionVersion: metadata.version,
    assessmentRole,
    ...(raw.difficulty ? { difficulty: raw.difficulty, difficultyBasis: 'teacher_estimate' } : {}),
    learningObjective: text(raw.learningObjective, 600, '学习目标', false),
    misconceptions: text(raw.misconceptions, 4000, '常见误区', false),
    reviewed: metadata.official,
    official: metadata.official && assessmentRole === 'selftest',
  };
  const objective = raw.type === 'single_choice' || raw.type === 'multiple_choice';
  if (objective) {
    if (!Array.isArray(raw.options) || raw.options.length < 2 || raw.options.length > 12)
      invalid('选择题需提供 2–12 个选项');
    question.options = raw.options.map((option) => {
      object(option, ['id', 'text'], '选项');
      const optionId = text(option.id, 24, '选项编号');
      if (!QUESTION_ID.test(optionId)) invalid('选项编号无效');
      return { id: optionId, text: text(option.text, 4000, '选项内容') };
    });
    if (new Set(question.options.map((option) => option.id)).size !== question.options.length)
      invalid('选项编号重复');
  } else if (raw.options !== undefined) invalid('此题型不支持选项');
  const allowedScoring = objective
    ? ['method', 'answer', 'maxScore', 'passScore']
    : raw.type === 'numeric'
      ? ['method', 'target', 'absoluteTolerance', 'relativeTolerance', 'maxScore', 'passScore']
      : ['method', 'rubric', 'maxScore', 'passScore'];
  object(raw.scoring, allowedScoring, '评分规则');
  const maxScore = finite(raw.scoring.maxScore, Number.MIN_VALUE, 1000, '满分');
  const passScore = finite(raw.scoring.passScore, Number.MIN_VALUE, maxScore, '通过分数');
  question.scoring = { method: raw.scoring.method, maxScore, passScore };
  if (objective) {
    if (raw.scoring.method !== 'exact') invalid('选择题必须使用完整匹配评分');
    const answer = raw.type === 'multiple_choice' ? raw.scoring.answer : [raw.scoring.answer];
    if (
      !Array.isArray(answer) ||
      !answer.length ||
      answer.some(
        (value) => typeof value !== 'string' || !question.options.some((o) => o.id === value),
      ) ||
      new Set(answer).size !== answer.length
    )
      invalid('标准答案须对应有效且不重复的选项');
    question.scoring.answer = raw.type === 'multiple_choice' ? [...answer].sort() : answer[0];
  } else if (raw.type === 'numeric') {
    if (raw.scoring.method !== 'numeric') invalid('数值题必须明确使用数值评分');
    question.scoring.target = finite(
      raw.scoring.target,
      -Number.MAX_VALUE,
      Number.MAX_VALUE,
      '目标值',
    );
    question.scoring.absoluteTolerance = finite(
      raw.scoring.absoluteTolerance,
      0,
      1e100,
      '绝对容差',
    );
    question.scoring.relativeTolerance = finite(raw.scoring.relativeTolerance, 0, 1, '相对容差');
  } else {
    if (raw.scoring.method !== 'manual') invalid('简答题须交由课程负责人复核');
    question.scoring.rubric = text(raw.scoring.rubric, 12000, '复核评分依据');
  }
  return question;
}

function validateQuiz(raw) {
  object(
    raw,
    ['schemaVersion', 'status', 'version', 'source', 'reviewedBy', 'reviewedAt', 'questions'],
    '题目数据',
  );
  if (raw.schemaVersion !== 1 || !['published', 'draft'].includes(raw.status))
    invalid('题目数据版本或发布状态无效');
  const version = text(raw.version, 64, '题目版本');
  const source = text(raw.source, 1000, '来源', false);
  const reviewedBy = text(raw.reviewedBy, 160, '审核人', false);
  const reviewedAt = text(raw.reviewedAt, 64, '审核时间', false);
  if (reviewedAt && !Number.isFinite(Date.parse(reviewedAt))) invalid('审核时间无效');
  const official = raw.status === 'published' && Boolean(source && reviewedBy);
  if (raw.status === 'published' && !official) invalid('正式题目必须提供来源与课程组审核人');
  if (
    !Array.isArray(raw.questions) ||
    !raw.questions.length ||
    raw.questions.length > MAX_QUESTIONS
  )
    invalid(`每个知识点需包含 1–${MAX_QUESTIONS} 道题`);
  const questions = raw.questions.map((question) =>
    validateQuestion(question, { version, source, official }),
  );
  if (new Set(questions.map((question) => question.id)).size !== questions.length)
    invalid('题目编号重复');
  return { version, source, reviewedBy, reviewedAt, official, questions };
}

function extractLegacyPractice(markdown) {
  const source = stripAssessmentBlocks(markdown);
  const lines = source.split('\n');
  const questions = [];
  for (let index = 0; index < lines.length && questions.length < MAX_QUESTIONS; index += 1) {
    const heading = lines[index].match(/^(#{3,6})\s+题目\s+([A-Za-z0-9][A-Za-z0-9_.-]{0,119})\s*$/);
    if (!heading) continue;
    let end = index + 1;
    while (end < lines.length && !/^#{1,6}\s/.test(lines[end])) end += 1;
    const body = lines
      .slice(index + 1, end)
      .join('\n')
      .trim();
    const details = body.match(/<details\b[^>]*>([\s\S]*?)<\/details>/i);
    const reference = details
      ? details[1].replace(/<summary\b[^>]*>[\s\S]*?<\/summary>/i, '').trim()
      : '';
    const prompt = body
      .replace(/<details\b[^>]*>[\s\S]*?<\/details>/gi, '')
      .split('\n')
      .filter((line) => !/^\s*(?:题型|目标|难度|来源与授权)\s*[:：]/.test(line))
      .join('\n')
      .trim();
    if (prompt)
      questions.push({
        id: heading[2],
        type: 'short_answer',
        prompt: prompt.slice(0, 12000),
        source:
          body.match(/来源与授权\s*[:：]\s*([^\n]+)/)?.[1]?.trim() ||
          '现有课程模板练习（未配置正式评分）',
        questionVersion: 'legacy-practice',
        assessmentRole: 'practice',
        reviewed: false,
        official: false,
        scoring: {
          method: 'manual',
          maxScore: 1,
          passScore: 1,
          rubric: '此题未配置正式评分规则，仅供练习与课程组复核。',
        },
        explanation: reference.slice(0, 12000),
      });
    index = end - 1;
  }
  return questions;
}

function parseAssessmentMarkdown(markdown) {
  const { lines, blocks } = assessmentBlocks(markdown);
  const warnings = [];
  let quiz = null;
  if (blocks.length) {
    const block = blocks[0];
    if (
      blocks.length !== 1 ||
      block.content === null ||
      lines.slice(block.end + 1).some((line) => line.trim())
    ) {
      warnings.push('评分扩展须是知识正文末尾唯一且完整的 freebbs-quiz 块；当前仅开放模板练习。');
    } else {
      let raw;
      try {
        if (block.content.length > 180000) invalid('题目数据过大');
        raw = JSON.parse(block.content);
        quiz = validateQuiz(raw);
      } catch (error) {
        warnings.push(
          error instanceof AssessmentError
            ? error.message
            : '评分扩展 JSON 格式无效；当前仅开放模板练习。',
        );
        // Missing review metadata can never publish a question, but valid old/draft
        // exercises can still be practiced. Invalid scoring and future schemas stay closed.
        if (
          raw &&
          [undefined, 1].includes(raw.schemaVersion) &&
          [undefined, 'published', 'draft'].includes(raw.status)
        ) {
          try {
            quiz = validateQuiz({
              ...raw,
              schemaVersion: 1,
              status: 'draft',
              version: raw.version || 'unreviewed-practice',
            });
          } catch {
            quiz = null;
          }
        }
      }
    }
  }
  const legacy = extractLegacyPractice(markdown);
  const knownIds = new Set(quiz?.questions.map((question) => question.id) || []);
  return {
    documentVersion: getAssessmentDocumentVersion(markdown),
    questionVersion: quiz?.version || null,
    reviewedBy: quiz?.official ? quiz.reviewedBy : '',
    source: quiz?.source || '',
    questions: (quiz?.questions || []).filter((question) => question.official),
    practiceQuestions: [
      ...(quiz?.questions || []).filter((question) => !question.official),
      ...legacy.filter((question) => !knownIds.has(question.id)),
    ],
    warnings,
  };
}
function toPublicQuestion(question) {
  const { method, maxScore, passScore, absoluteTolerance, relativeTolerance } = question.scoring;
  return {
    id: question.id,
    type: question.type,
    prompt: question.prompt,
    source: question.source,
    questionVersion: question.questionVersion,
    official: question.official,
    reviewed: question.reviewed === true,
    assessmentRole: question.assessmentRole || (question.official ? 'selftest' : 'practice'),
    ...(question.difficulty
      ? { difficulty: question.difficulty, difficultyBasis: 'teacher_estimate' }
      : {}),
    ...(question.learningObjective ? { learningObjective: question.learningObjective } : {}),
    ...(question.options ? { options: question.options } : {}),
    scoring: {
      method,
      maxScore,
      passScore,
      ...(question.type === 'numeric' ? { absoluteTolerance, relativeTolerance } : {}),
    },
  };
}
function canonicalAnswer(answer) {
  if (typeof answer === 'string') return text(answer, 8000, '作答');
  if (typeof answer === 'number' && Number.isFinite(answer)) return String(answer);
  if (
    Array.isArray(answer) &&
    answer.length &&
    answer.length <= 12 &&
    answer.every((part) => typeof part === 'string')
  ) {
    const values = answer.map((part) => text(part, 24, '选项编号'));
    if (new Set(values).size !== values.length) invalid('作答选项不能重复');
    return values.sort();
  }
  return invalid('请填写有效作答');
}
function parseFiniteNumber(answer) {
  if (
    typeof answer !== 'string' ||
    answer.length > 160 ||
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d{1,4})?$/.test(answer.trim())
  )
    invalid('数值题仅接受有限数值（可用科学记数法），请勿输入表达式或单位');
  const result = Number(answer);
  if (!Number.isFinite(result)) invalid('数值超出可处理范围');
  if (result === 0 && /[1-9]/.test(answer.trim().split(/[eE]/)[0]))
    invalid('数值过小，超出可处理精度');
  return result;
}
function gradeAnswer(question, rawAnswer) {
  const answer = canonicalAnswer(rawAnswer);
  const { maxScore, passScore } = question.scoring;
  const referenceMarkdown = [
    question.explanation || '',
    question.misconceptions ? `### 常见误区\n\n${question.misconceptions}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  if (question.type === 'short_answer') {
    if (typeof answer !== 'string') invalid('简答题须提交文字作答');
    return {
      answer,
      status: 'pending_review',
      verdict: null,
      score: null,
      maxScore,
      passScore,
      official: question.official,
      needsReview: true,
      gradingBasis: question.scoring.rubric,
      feedback: '作答已保存。复核前不计入正式通过或未通过。',
      referenceMarkdown,
    };
  }
  let correct = false;
  let gradingBasis = '';
  if (question.type === 'single_choice') {
    if (typeof answer !== 'string' || !question.options.some((option) => option.id === answer))
      invalid('请选择有效选项');
    correct = answer === question.scoring.answer;
    gradingBasis = `完整匹配标准选项 ${question.scoring.answer}；答对得 ${maxScore} 分，答错得 0 分。`;
  } else if (question.type === 'multiple_choice') {
    if (
      !Array.isArray(answer) ||
      answer.some((id) => !question.options.some((option) => option.id === id))
    )
      invalid('请选择有效选项');
    correct = JSON.stringify(answer) === JSON.stringify(question.scoring.answer);
    gradingBasis = `完整匹配标准选项 ${question.scoring.answer.join('、')}；漏选或多选均不得分，不设部分分。`;
  } else {
    const value = parseFiniteNumber(answer);
    const { target, absoluteTolerance, relativeTolerance } = question.scoring;
    const tolerance = Math.max(absoluteTolerance, Math.abs(target) * relativeTolerance);
    const difference = Math.abs(value - target);
    const roundingAllowance = tolerance
      ? Number.EPSILON * Math.max(Math.abs(value), Math.abs(target), tolerance) * 2
      : 0;
    correct = difference <= tolerance + roundingAllowance;
    gradingBasis = `标准值 ${target}；误差须不超过 max(${absoluteTolerance}, |标准值| × ${relativeTolerance}) = ${tolerance}。`;
  }
  const score = correct ? maxScore : 0;
  return {
    answer,
    status: 'graded',
    verdict: question.official ? (score >= passScore ? 'pass' : 'fail') : 'practice_only',
    score,
    maxScore,
    passScore,
    official: question.official,
    needsReview: false,
    gradingBasis,
    feedback: `${correct ? '本题作答正确。' : '本题作答尚未符合评分规则，可对照依据后订正。'}${question.official ? '' : '本次为练习作答，不计入正式通过或未通过。'}`,
    referenceMarkdown,
  };
}

function requestFingerprint(questionId, answer, mode, supersedesAttemptId) {
  return getAssessmentDocumentVersion(
    JSON.stringify({ questionId, answer, mode, supersedesAttemptId }),
  );
}
function toAttempt(row, review = false) {
  const parseJson = (value) => (typeof value === 'string' ? JSON.parse(value) : value);
  let snapshot = {};
  try {
    snapshot = parseJson(row.question_snapshot) || {};
  } catch {
    /* Legacy records can lack a readable snapshot. Never expose its scoring keys. */
  }
  let assessmentRole = 'practice';
  if (row.is_official) assessmentRole = 'selftest';
  else if (snapshot.assessmentRole === 'exploration') assessmentRole = 'exploration';
  return {
    id: String(row.id),
    questionId: row.question_id,
    questionVersion: row.question_version,
    documentVersion: row.document_version,
    answer: parseJson(row.answer_json),
    status: row.status,
    verdict: row.verdict || null,
    official: Boolean(row.is_official),
    assessmentRole,
    ...(DIFFICULTIES.includes(snapshot.difficulty)
      ? { difficulty: snapshot.difficulty, difficultyBasis: 'teacher_estimate' }
      : {}),
    score: row.score === null ? null : Number(row.score),
    maxScore: Number(row.max_score),
    passScore: Number(row.pass_score),
    needsReview: row.status === 'pending_review',
    feedback: row.feedback,
    gradingBasis: row.grading_basis,
    referenceMarkdown: row.reference_markdown || '',
    supersedesAttemptId: row.supersedes_attempt_id ? String(row.supersedes_attempt_id) : null,
    reviewedBy: row.reviewed_by ? String(row.reviewed_by) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(review ? { userId: String(row.user_id) } : {}),
  };
}
function assertReplay(row, user, context, fingerprint) {
  if (
    !row ||
    String(row.user_id) !== String(user.id) ||
    String(row.course_id) !== String(context.course_id) ||
    row.node_id !== context.node_id ||
    row.payload_hash !== fingerprint
  )
    throw new AssessmentError(409, '提交标识已用于另一份作答，请核对记录后重新提交');
  return toAttempt(row);
}
const ATTEMPT_COLUMNS =
  'id, user_id, course_id, node_id, question_id, question_version, document_version, question_snapshot, answer_json, status, verdict, is_official, score, max_score, pass_score, feedback, grading_basis, reference_markdown, supersedes_attempt_id, reviewed_by, created_at, updated_at';

async function ensureLearningAssessmentTables(pool) {
  const sql = fs.readFileSync(
    path.join(__dirname, '../database/migrations/063_learning_assessments.sql'),
    'utf8',
  );
  await pool.execute(sql.trim().replace(/;\s*$/, ''));
}
function createMysqlAssessmentStore(pool) {
  return {
    async context(slug, point) {
      const [rows] = await pool.execute(
        'SELECT c.id AS course_id, n.node_id, n.title, n.document_markdown FROM courses c JOIN course_map_nodes n ON n.course_id = c.id WHERE c.slug = ? AND c.is_active = 1 AND n.node_id = ? LIMIT 1',
        [slug, point],
      );
      return rows[0] || null;
    },
    canReview: (user, context) =>
      require('./course-maps').canManageCourse(pool, user, context.course_id),
    async findByKey(user, key) {
      const [rows] = await pool.execute(
        `SELECT ${ATTEMPT_COLUMNS}, payload_hash FROM learning_assessment_attempts WHERE user_id = ? AND request_key = ? LIMIT 1`,
        [user.id, key],
      );
      return rows[0] || null;
    },
    async findOwned(user, context, id) {
      const [rows] = await pool.execute(
        `SELECT ${ATTEMPT_COLUMNS} FROM learning_assessment_attempts WHERE id = ? AND user_id = ? AND course_id = ? AND node_id = ? LIMIT 1`,
        [id, user.id, context.course_id, context.node_id],
      );
      return rows[0] || null;
    },
    async list(user, context, before, review) {
      const [rows] = await pool.execute(
        `SELECT ${ATTEMPT_COLUMNS} FROM learning_assessment_attempts WHERE course_id = ? AND node_id = ? AND ${review ? "status = 'pending_review'" : 'user_id = ?'} ${before ? 'AND id < ?' : ''} ORDER BY id DESC LIMIT 51`,
        [
          context.course_id,
          context.node_id,
          ...(review ? [] : [user.id]),
          ...(before ? [before] : []),
        ],
      );
      return rows.map((row) => toAttempt(row, review));
    },
    async create(
      user,
      context,
      question,
      grade,
      key,
      fingerprint,
      documentVersion,
      supersedesAttemptId,
    ) {
      try {
        await pool.execute(
          'INSERT INTO learning_assessment_attempts (user_id, course_id, node_id, question_id, question_version, document_version, question_snapshot, answer_json, status, verdict, is_official, score, max_score, pass_score, feedback, grading_basis, reference_markdown, request_key, payload_hash, supersedes_attempt_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            user.id,
            context.course_id,
            context.node_id,
            question.id,
            question.questionVersion,
            documentVersion,
            JSON.stringify(question),
            JSON.stringify(grade.answer),
            grade.status,
            grade.verdict,
            grade.official ? 1 : 0,
            grade.score,
            grade.maxScore,
            grade.passScore,
            grade.feedback,
            grade.gradingBasis,
            grade.referenceMarkdown,
            key,
            fingerprint,
            supersedesAttemptId,
          ],
        );
      } catch (error) {
        if (error.code !== 'ER_DUP_ENTRY') throw error;
      }
      return assertReplay(await this.findByKey(user, key), user, context, fingerprint);
    },
    async review(user, context, id, score, feedback) {
      const [result] = await pool.execute(
        "UPDATE learning_assessment_attempts SET score = ?, feedback = ?, status = 'graded', verdict = IF(is_official = 1, IF(? >= pass_score, 'pass', 'fail'), 'practice_only'), reviewed_by = ? WHERE id = ? AND course_id = ? AND node_id = ? AND status = 'pending_review' AND ? <= max_score",
        [score, feedback, score, user.id, id, context.course_id, context.node_id, score],
      );
      if (!result.affectedRows) return null;
      const [rows] = await pool.execute(
        `SELECT ${ATTEMPT_COLUMNS} FROM learning_assessment_attempts WHERE id = ? AND course_id = ? AND node_id = ? LIMIT 1`,
        [id, context.course_id, context.node_id],
      );
      return rows[0] ? toAttempt(rows[0], true) : null;
    },
  };
}

// In-memory store is injectable for isolated previews and tests, never a production fallback.
function createMemoryAssessmentStore({ contexts = [], managers = [] } = {}) {
  const rows = [];
  const matches = (row, context) =>
    String(row.course_id) === String(context.course_id) && row.node_id === context.node_id;
  return {
    rows,
    contexts,
    async context(slug, point) {
      return (
        contexts.find(
          (item) =>
            item.slug === slug &&
            item.node_id === point &&
            item.is_active !== false &&
            item.is_active !== 0,
        ) || null
      );
    },
    async canReview(user, context) {
      return Boolean(
        user.is_admin ||
        managers.some(
          (item) =>
            String(item.userId) === String(user.id) &&
            String(item.courseId) === String(context.course_id),
        ),
      );
    },
    async findByKey(user, key) {
      return (
        rows.find((row) => String(row.user_id) === String(user.id) && row.request_key === key) ||
        null
      );
    },
    async findOwned(user, context, id) {
      return (
        rows.find(
          (row) =>
            String(row.id) === String(id) &&
            String(row.user_id) === String(user.id) &&
            matches(row, context),
        ) || null
      );
    },
    async list(user, context, before, review) {
      return rows
        .filter(
          (row) =>
            matches(row, context) &&
            (review ? row.status === 'pending_review' : String(row.user_id) === String(user.id)) &&
            (!before || BigInt(row.id) < BigInt(before)),
        )
        .slice()
        .reverse()
        .slice(0, 51)
        .map((row) => toAttempt(row, review));
    },
    async create(
      user,
      context,
      question,
      grade,
      key,
      fingerprint,
      documentVersion,
      supersedesAttemptId,
    ) {
      let row = await this.findByKey(user, key);
      if (!row) {
        // No await between the uniqueness check and push: concurrent retries share one record.
        row = rows.find(
          (item) => String(item.user_id) === String(user.id) && item.request_key === key,
        );
        if (!row) {
          row = {
            id: String(rows.length + 1),
            user_id: user.id,
            course_id: context.course_id,
            node_id: context.node_id,
            question_id: question.id,
            question_version: question.questionVersion,
            document_version: documentVersion,
            question_snapshot: JSON.stringify(question),
            answer_json: JSON.stringify(grade.answer),
            status: grade.status,
            verdict: grade.verdict,
            is_official: grade.official ? 1 : 0,
            score: grade.score,
            max_score: grade.maxScore,
            pass_score: grade.passScore,
            feedback: grade.feedback,
            grading_basis: grade.gradingBasis,
            reference_markdown: grade.referenceMarkdown,
            request_key: key,
            payload_hash: fingerprint,
            supersedes_attempt_id: supersedesAttemptId,
            reviewed_by: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          rows.push(row);
        }
      }
      return assertReplay(row, user, context, fingerprint);
    },
    async review(user, context, id, score, feedback) {
      const row = rows.find(
        (item) =>
          String(item.id) === String(id) &&
          matches(item, context) &&
          item.status === 'pending_review' &&
          score <= item.max_score,
      );
      if (!row) return null;
      Object.assign(row, {
        score,
        feedback,
        status: 'graded',
        verdict: row.is_official ? (score >= row.pass_score ? 'pass' : 'fail') : 'practice_only',
        reviewed_by: user.id,
        updated_at: new Date().toISOString(),
      });
      return toAttempt(row, true);
    },
  };
}

function createLearningAssessmentRouter({
  pool,
  requireAuth,
  store = createMysqlAssessmentStore(pool),
  onAssessmentEvent,
}) {
  const router = express.Router();
  function route(handler) {
    return async (req, res) => {
      res.set('Cache-Control', 'private, no-store');
      try {
        const user = await requireAuth(req, res);
        if (!user) return;
        const { slug, point, id } = req.params;
        if (
          !/^[a-z0-9][a-z0-9-]{0,119}$/.test(slug) ||
          !/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/.test(point) ||
          point.length > 64 ||
          (id !== undefined && !RECORD_ID.test(id))
        )
          invalid('课程、知识点或作答编号无效');
        const context = await store.context(slug, point);
        if (!context) throw new AssessmentError(404, '课程或知识点不存在');
        await handler(req, res, user, context);
      } catch (error) {
        if (!error.status)
          console.error('Learning assessment request failed:', error.code || error.name);
        if (!res.headersSent)
          res
            .status(error.status || 500)
            .json({ message: error.status ? error.message : '自测服务暂时不可用，请稍后重试' });
      }
    };
  }
  router.get(
    '/:slug/:point/questions',
    route(async (req, res, user, context) => {
      const assessment = parseAssessmentMarkdown(context.document_markdown);
      res.json({
        ...assessment,
        questions: assessment.questions.map(toPublicQuestion),
        practiceQuestions: assessment.practiceQuestions.map(toPublicQuestion),
        canReview: await store.canReview(user, context),
      });
    }),
  );
  router.get(
    '/:slug/:point/attempts',
    route(async (req, res, user, context) => {
      const before = req.query.before || '';
      if (typeof before !== 'string' || (before && !RECORD_ID.test(before)))
        invalid('分页位置无效');
      const review = req.query.review === 'pending';
      if (req.query.review !== undefined && !review) invalid('复核范围无效');
      if (review && !(await store.canReview(user, context)))
        throw new AssessmentError(403, '需要本课程负责人的权限');
      const records = await store.list(user, context, before, review);
      const attempts = records.slice(0, 50);
      res.json({
        attempts,
        nextCursor: records.length > 50 ? attempts.at(-1).id : null,
        documentVersion: getAssessmentDocumentVersion(context.document_markdown),
      });
    }),
  );
  router.post(
    '/:slug/:point/attempts',
    route(async (req, res, user, context) => {
      const { body } = req;
      if (!body || typeof body.requestKey !== 'string' || !UUID.test(body.requestKey))
        invalid('提交标识须为有效 UUID');
      const key = body.requestKey.toLowerCase();
      const questionId = text(body.questionId, 120, '题目编号');
      if (!QUESTION_ID.test(questionId)) invalid('题目编号无效');
      const answer = canonicalAnswer(body.answer);
      const mode = body.mode === undefined ? 'selftest' : body.mode;
      if (!['selftest', 'practice'].includes(mode)) invalid('作答模式无效');
      const supersedesAttemptId = body.supersedesAttemptId || null;
      if (
        supersedesAttemptId !== null &&
        (typeof supersedesAttemptId !== 'string' || !RECORD_ID.test(supersedesAttemptId))
      )
        invalid('订正记录编号无效');
      const fingerprint = requestFingerprint(questionId, answer, mode, supersedesAttemptId);
      const existing = await store.findByKey(user, key);
      if (existing) {
        res.json({ attempt: assertReplay(existing, user, context, fingerprint), replayed: true });
        return;
      }
      const assessment = parseAssessmentMarkdown(context.document_markdown);
      if (body.expectedDocumentVersion !== undefined) {
        if (
          typeof body.expectedDocumentVersion !== 'string' ||
          !/^[a-f0-9]{64}$/.test(body.expectedDocumentVersion)
        )
          invalid('题目正文版本无效');
        if (body.expectedDocumentVersion !== assessment.documentVersion)
          throw new AssessmentError(409, '课程正文已更新，请刷新题目后核对作答；当前输入已保留');
      }
      const question = (
        mode === 'selftest'
          ? assessment.questions
          : [...assessment.questions, ...assessment.practiceQuestions]
      ).find((item) => item.id === questionId);
      if (!question)
        throw new AssessmentError(
          404,
          mode === 'selftest'
            ? '没有可正式自测的已审核题目，请选择本文练习'
            : '练习不存在或题目版本已更新',
        );
      if (supersedesAttemptId) {
        const previous = await store.findOwned(user, context, supersedesAttemptId);
        if (!previous || previous.question_id !== questionId)
          throw new AssessmentError(404, '待订正的个人作答不存在');
      }
      const submittedQuestion = mode === 'practice' ? { ...question, official: false } : question;
      const grade = gradeAnswer(submittedQuestion, answer);
      const attempt = await store.create(
        user,
        context,
        submittedQuestion,
        grade,
        key,
        fingerprint,
        assessment.documentVersion,
        supersedesAttemptId,
      );
      if (typeof onAssessmentEvent === 'function') {
        try {
          await onAssessmentEvent({ user, context, attempt });
        } catch (error) {
          console.error('Assessment process event failed:', error.code || error.name);
        }
      }
      res.status(201).json({ attempt, documentVersion: assessment.documentVersion });
    }),
  );
  const review = route(async (req, res, user, context) => {
    if (!(await store.canReview(user, context)))
      throw new AssessmentError(403, '需要本课程负责人的权限');
    const score = finite(req.body?.score, 0, 1000, '复核分数');
    const feedback = text(req.body?.feedback, 4000, '复核说明');
    const attempt = await store.review(user, context, req.params.id, score, feedback);
    if (!attempt) throw new AssessmentError(409, '作答已复核、不存在或分数超过满分，请刷新后核对');
    if (typeof onAssessmentEvent === 'function') {
      try {
        await onAssessmentEvent({ user, context, attempt, reviewed: true });
      } catch (error) {
        console.error('Assessment review process event failed:', error.code || error.name);
      }
    }
    res.json({ attempt });
  });
  router.post('/:slug/:point/attempts/:id/review', review);
  router.patch('/:slug/:point/attempts/:id/review', review);
  return router;
}
module.exports = {
  AssessmentError,
  createLearningAssessmentRouter,
  createMysqlAssessmentStore,
  createMemoryAssessmentStore,
  ensureLearningAssessmentTables,
  parseAssessmentMarkdown,
  validateQuiz,
  gradeAnswer,
  parseFiniteNumber,
  toPublicQuestion,
  stripAssessmentBlocks,
  getAssessmentDocumentVersion,
};
