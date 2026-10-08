const fs = require('node:fs');

const QUESTION_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/;
const TYPES = ['single_choice', 'multiple_choice', 'numeric', 'short_answer'];
const DIFFICULTIES = ['basic', 'standard', 'challenge'];
const ASSESSMENT_ROLES = ['practice', 'selftest', 'exploration'];
const MAX_QUESTIONS = 40;

class QuizValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'QuizValidationError';
  }
}
function invalid(message) {
  throw new QuizValidationError(message);
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

// Keep this offline contract in parity with backend/learning-assessment.js.
// It validates configuration, not the factual correctness of answers or a reviewer's identity.
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
  let allowedScoring = ['method', 'rubric', 'maxScore', 'passScore'];
  if (objective) allowedScoring = ['method', 'answer', 'maxScore', 'passScore'];
  if (raw.type === 'numeric')
    allowedScoring = [
      'method',
      'target',
      'absoluteTolerance',
      'relativeTolerance',
      'maxScore',
      'passScore',
    ];
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
        (value) =>
          typeof value !== 'string' || !question.options.some((option) => option.id === value),
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

function validateOptionalQuiz(markdown) {
  if (typeof markdown !== 'string') invalid('知识正文须为 Markdown 文字');
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let start = -1;
  let fence = '';
  for (let index = 0; index < lines.length; index += 1) {
    if (start < 0) {
      const opening = lines[index].match(/^\s{0,3}(`{3,}|~{3,})\s*freebbs-quiz\s*$/i);
      if (opening) {
        start = index;
        [fence] = opening.slice(1);
      }
    } else {
      const closing = lines[index].trim();
      if (
        closing.length >= fence.length &&
        closing[0] === fence[0] &&
        /^(?:`+|~+)$/.test(closing)
      ) {
        blocks.push({ end: index, content: lines.slice(start + 1, index).join('\n') });
        start = -1;
      }
    }
  }
  if (!blocks.length && start < 0) return null;
  if (
    start >= 0 ||
    blocks.length !== 1 ||
    lines.slice(blocks[0].end + 1).some((line) => line.trim())
  )
    invalid('评分扩展须是知识正文末尾唯一且完整的 freebbs-quiz 块');
  if (blocks[0].content.length > 180000) invalid('题目数据过大');
  let raw;
  try {
    raw = JSON.parse(blocks[0].content);
  } catch {
    invalid('评分扩展 JSON 格式无效');
  }
  return validateQuiz(raw);
}

if (require.main === module) {
  try {
    const [input, ...extra] = process.argv.slice(2);
    if (!input || extra.length)
      invalid('用法：node 检查自测.cjs <知识正文.md>，或 node 检查自测.cjs --stdin');
    const markdown = fs.readFileSync(input === '--stdin' ? 0 : input, 'utf8');
    const quiz = validateOptionalQuiz(markdown);
    console.log(
      quiz
        ? `自测配置有效：${quiz.questions.length} 题，${quiz.official ? '正式发布' : '草稿练习'}，版本 ${quiz.version}`
        : '未包含可选自测评分扩展。',
    );
  } catch (error) {
    console.error(
      `自测配置检查失败：${error instanceof QuizValidationError ? error.message : '无法读取知识正文'}`,
    );
    process.exitCode = 1;
  }
}
module.exports = { QuizValidationError, validateQuiz, validateOptionalQuiz };
