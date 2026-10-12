/* eslint-disable no-param-reassign -- Tests deliberately mutate their own throwaway fixture objects. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const {
  validateQuiz,
  validateOptionalQuiz,
  QuizValidationError,
} = require('../docs/course-authoring/tools/检查自测.cjs');

const tool = path.resolve(__dirname, '../docs/course-authoring/tools/检查自测.cjs');
const authoringBase = path.resolve(__dirname, '../docs/course-authoring');

function quiz(overrides = {}) {
  return {
    schemaVersion: 1,
    status: 'published',
    version: '1.2',
    source: '课程组自编，已核对本章定义',
    reviewedBy: '课程组复核人',
    reviewedAt: '2026-10-01T00:00:00Z',
    questions: [
      {
        id: 'SS-01-01-Q01',
        type: 'single_choice',
        prompt: '以下哪个条件成立？',
        options: [
          { id: 'A', text: '条件一' },
          { id: 'B', text: '条件二' },
        ],
        scoring: { method: 'exact', answer: 'A', maxScore: 1, passScore: 1 },
        explanation: '根据定义核对条件。',
      },
      {
        id: 'SS-01-01-Q02',
        type: 'multiple_choice',
        prompt: '选择所有成立的条件。',
        options: [
          { id: 'A', text: '条件一' },
          { id: 'B', text: '条件二' },
        ],
        scoring: { method: 'exact', answer: ['B', 'A'], maxScore: 2, passScore: 2 },
      },
      {
        id: 'SS-01-01-Q03',
        type: 'numeric',
        prompt: '按给定单位计算结果。',
        source: '习题课自编',
        scoring: {
          method: 'numeric',
          target: -2,
          absoluteTolerance: 0.01,
          relativeTolerance: 0,
          maxScore: 1,
          passScore: 1,
        },
      },
      {
        id: 'SS-01-01-Q04',
        type: 'short_answer',
        prompt: '说明条件成立所需的假设。',
        scoring: {
          method: 'manual',
          rubric: '假设完整 2 分，论证正确 3 分。',
          maxScore: 5,
          passScore: 3,
        },
      },
    ],
    ...overrides,
  };
}
const markdown = (value = quiz(), fence = '```') =>
  `# 知识正文\n\n定义与例题。\n\n${fence}freebbs-quiz\n${JSON.stringify(value)}\n${fence}\n`;
function invalidQuestion(index, mutate) {
  const value = quiz();
  mutate(value.questions[index]);
  assert.throws(() => validateQuiz(value), QuizValidationError);
}

test('the copyable scoring template includes four supported types and requires review before publishing', () => {
  const template = fs.readFileSync(
    path.join(authoringBase, 'templates/自测题-评分扩展.md'),
    'utf8',
  );
  const block = template.match(/^```freebbs-quiz\r?\n([\s\S]*?)\r?\n```/m);
  assert.ok(block);
  const filled = block[1].replace(/\{\{([^}]+)\}\}/g, (_match, label) =>
    label === '知识点ID' ? 'SS-01-01' : '本地模板填充演示',
  );
  const value = JSON.parse(filled);
  const result = validateOptionalQuiz(`\`\`\`freebbs-quiz\n${filled}\n\`\`\``);
  assert.equal(result.official, false);
  assert.deepEqual(
    result.questions.map((question) => question.type),
    ['single_choice', 'multiple_choice', 'numeric', 'short_answer'],
  );
  assert.deepEqual(result.questions[1].scoring.answer, ['A', 'C']);
  assert.equal(result.questions[3].scoring.method, 'manual');
  assert.throws(() => validateQuiz({ ...value, status: 'published' }), /审核人/);
  assert.equal(
    validateQuiz({ ...value, status: 'published', reviewedBy: '本地测试复核人' }).official,
    true,
  );
});

test('the runnable local example passes the offline validator and remains a draft', () => {
  const result = validateOptionalQuiz(
    fs.readFileSync(path.join(authoringBase, 'examples/知识点/SS-01-01.md'), 'utf8'),
  );
  assert.equal(result.official, false);
  assert.equal(result.version, 'demo-1.0');
  assert.deepEqual(
    result.questions.map((question) => question.type),
    ['single_choice', 'multiple_choice', 'numeric', 'short_answer'],
  );
  assert.deepEqual(result.questions[1].scoring.answer, ['A', 'C']);
});

test('optional scoring is absent in legacy Markdown and is never inferred from prose answers', () => {
  assert.equal(validateOptionalQuiz(''), null);
  assert.equal(validateOptionalQuiz('# 题目\n答案是 A。\n```json\n{"score":100}\n```'), null);
  assert.throws(() => validateOptionalQuiz(null), QuizValidationError);
});

test('all four question types normalize the documented scoring contract without mutation', () => {
  const input = quiz();
  const snapshot = structuredClone(input);
  const result = validateQuiz(input);
  assert.equal(result.official, true);
  assert.equal(result.version, '1.2');
  assert.deepEqual(
    result.questions.map((question) => question.type),
    ['single_choice', 'multiple_choice', 'numeric', 'short_answer'],
  );
  assert.deepEqual(result.questions[1].scoring.answer, ['A', 'B']);
  assert.equal(result.questions[0].source, input.source);
  assert.equal(result.questions[2].source, '习题课自编');
  assert.equal(result.questions[3].scoring.method, 'manual');
  assert.ok(
    result.questions.every(
      (question) => question.questionVersion === input.version && question.official,
    ),
  );
  assert.deepEqual(input, snapshot);
  assert.deepEqual(validateOptionalQuiz(markdown(input)), result);
});

test('draft exercises stay nonofficial even when review metadata is supplied', () => {
  const result = validateQuiz(
    quiz({ status: 'draft', source: undefined, reviewedBy: undefined, reviewedAt: undefined }),
  );
  assert.equal(result.official, false);
  assert.equal(result.reviewedBy, '');
  assert.ok(result.questions.every((question) => !question.official));
  assert.equal(validateQuiz(quiz({ status: 'draft' })).official, false);
});

test('offline layers normalize exactly like the runtime and exclude optional roles from formal evidence', () => {
  const input = quiz();
  Object.assign(input.questions[0], {
    difficulty: 'basic',
    assessmentRole: 'practice',
    learningObjective: '说明边界',
    misconceptions: '不要省略边界条件。',
  });
  Object.assign(input.questions[1], { difficulty: 'challenge', assessmentRole: 'exploration' });
  Object.assign(input.questions[2], { difficulty: 'standard', assessmentRole: 'selftest' });
  const offline = validateQuiz(input);
  const runtime = require('../backend/learning-assessment').validateQuiz(input);
  assert.deepEqual(offline, runtime);
  assert.deepEqual(
    offline.questions.map((question) => question.official),
    [false, false, true, true],
  );
  assert.equal(offline.questions[0].difficultyBasis, 'teacher_estimate');
  for (const update of [
    { difficulty: 1 },
    { difficulty: 'calibrated' },
    { assessmentRole: 'optional' },
    { assessmentRole: null },
    { learningObjective: 'x'.repeat(601) },
    { misconceptions: 'x'.repeat(4001) },
    { difficultyBasis: 'measured' },
  ])
    assert.throws(
      () =>
        validateQuiz(
          quiz({
            questions: [{ ...quiz().questions[0], ...update }],
          }),
        ),
      QuizValidationError,
    );
});

test('schema, status, version, sources and review fields fail closed', () => {
  for (const overrides of [
    { schemaVersion: undefined },
    { schemaVersion: 2 },
    { schemaVersion: '1' },
    { status: undefined },
    { status: 'approved' },
    { status: true },
    { version: undefined },
    { version: '' },
    { version: ' '.repeat(3) },
    { version: 'x'.repeat(65) },
    { source: undefined },
    { source: '' },
    { source: 4 },
    { source: 'x'.repeat(1001) },
    { reviewedBy: undefined },
    { reviewedBy: '' },
    { reviewedBy: 'x'.repeat(161) },
    { reviewedAt: 'not-a-date' },
    { reviewedAt: 123 },
    { reviewedAt: 'x'.repeat(65) },
    { official: true },
    { published: true },
    { documentVersion: 'forged' },
  ])
    assert.throws(() => validateQuiz(quiz(overrides)), QuizValidationError);
  // A review date is optional in schema v1; reviewer and source are not.
  assert.equal(validateQuiz(quiz({ reviewedAt: undefined })).official, true);
  for (const value of [null, [], 'quiz'])
    assert.throws(() => validateQuiz(value), QuizValidationError);
});

test('question bounds, unique IDs, fields and text limits are validated', () => {
  for (const questions of [
    undefined,
    null,
    [],
    Array.from({ length: 41 }, (_, index) => ({ ...quiz().questions[0], id: `Q${index}` })),
  ])
    assert.throws(() => validateQuiz(quiz({ questions })), QuizValidationError);
  const duplicate = quiz();
  duplicate.questions[1].id = duplicate.questions[0].id;
  assert.throws(() => validateQuiz(duplicate), /题目编号重复/);
  for (const update of [
    { id: '含空格 ID' },
    { id: 'Q'.repeat(121) },
    { type: 'essay' },
    { prompt: '' },
    { prompt: 'x'.repeat(12001) },
    { source: null },
    { explanation: 'x'.repeat(12001) },
    { answer: 'A' },
    { official: true },
    { questionVersion: 'old' },
  ])
    invalidQuestion(0, (question) => Object.assign(question, update));
  invalidQuestion(2, (question) => {
    question.options = [];
  });
});

test('choice questions require unique valid options and full-match answers', () => {
  for (const options of [
    undefined,
    [],
    [{ id: 'A', text: 'one' }],
    Array.from({ length: 13 }, (_, index) => ({ id: `A${index}`, text: 'one' })),
    [
      { id: 'A', text: 'one' },
      { id: 'A', text: 'two' },
    ],
    [
      { id: 'A', text: '' },
      { id: 'B', text: 'two' },
    ],
    [
      { id: 'a'.repeat(25), text: 'one' },
      { id: 'B', text: 'two' },
    ],
    [
      { id: 'A', text: 'one', correct: true },
      { id: 'B', text: 'two' },
    ],
  ])
    invalidQuestion(0, (question) => {
      question.options = options;
    });
  for (const answer of [undefined, null, [], ['A'], 'C', true])
    invalidQuestion(0, (question) => {
      question.scoring.answer = answer;
    });
  for (const answer of [undefined, null, [], ['A', 'A'], ['A', 'C'], 'A', [1]])
    invalidQuestion(1, (question) => {
      question.scoring.answer = answer;
    });
  invalidQuestion(0, (question) => {
    question.scoring.method = 'partial';
  });
  invalidQuestion(1, (question) => {
    question.scoring.partialCredit = true;
  });
});

test('numeric grading requires finite target and explicit bounded absolute and relative tolerances', () => {
  for (const target of [undefined, '2', null, NaN, Infinity, -Infinity])
    invalidQuestion(2, (question) => {
      question.scoring.target = target;
    });
  for (const absoluteTolerance of [undefined, -1, Infinity, '0.01', 1e101])
    invalidQuestion(2, (question) => {
      question.scoring.absoluteTolerance = absoluteTolerance;
    });
  for (const relativeTolerance of [undefined, -0.01, 1.01, '0', Infinity])
    invalidQuestion(2, (question) => {
      question.scoring.relativeTolerance = relativeTolerance;
    });
  invalidQuestion(2, (question) => {
    question.scoring.method = 'exact';
  });
  invalidQuestion(2, (question) => {
    question.scoring.answer = -2;
  });
  const value = quiz();
  value.questions[2].scoring.target = 0;
  value.questions[2].scoring.absoluteTolerance = 0;
  assert.equal(validateQuiz(value).questions[2].scoring.absoluteTolerance, 0);
});

test('manual short-answer review requires a rubric and cannot use keyword or AI pass rules', () => {
  for (const rubric of [undefined, '', '   ', null, 'x'.repeat(12001)])
    invalidQuestion(3, (question) => {
      question.scoring.rubric = rubric;
    });
  for (const method of ['exact', 'keyword', 'ai', 'numeric'])
    invalidQuestion(3, (question) => {
      question.scoring.method = method;
    });
  invalidQuestion(3, (question) => {
    question.scoring.answer = '文本';
  });
});

test('score ranges apply equally to every question type and do not coerce numbers', () => {
  for (let index = 0; index < 4; index += 1) {
    for (const maxScore of [undefined, 0, -1, 1001, Infinity, '5'])
      invalidQuestion(index, (question) => {
        question.scoring.maxScore = maxScore;
      });
    for (const passScore of [undefined, 0, -1, 1001, Infinity, '1'])
      invalidQuestion(index, (question) => {
        question.scoring.passScore = passScore;
      });
    invalidQuestion(index, (question) => {
      question.scoring = [];
    });
  }
});

test('the Markdown block must be unique, complete, valid JSON and at the document end', () => {
  const valid = markdown();
  for (const value of [
    `${valid}\n后续正文`,
    `${valid}\n${valid}`,
    valid.replace(/```\n$/, ''),
    '# 知识\n```freebbs-quiz\n{"schemaVersion":1,}\n```',
    `${valid}\n~~~freebbs-quiz\n`,
    `\`\`\`freebbs-quiz\n${' '.repeat(180001)}\n\`\`\``,
    '# 知识\n````freebbs-quiz\n{}\n```',
  ])
    assert.throws(() => validateOptionalQuiz(value), QuizValidationError);
  assert.equal(validateOptionalQuiz(valid.replace(/\n/g, '\r\n')).questions.length, 4);
  assert.equal(validateOptionalQuiz(markdown(quiz(), '~~~')).questions.length, 4);
  assert.equal(
    validateOptionalQuiz(valid.replace('```freebbs-quiz', '```FREEBBS-QUIZ')).official,
    true,
  );
  assert.equal(validateOptionalQuiz(`${valid}\n  \n`).official, true);
});

test('offline library uses only Node built-ins and does not load application or Express dependencies', () => {
  const required = [];
  const context = {
    module: { exports: {} },
    require(name) {
      required.push(name);
      assert.equal(name, 'node:fs');
      return fs;
    },
  };
  vm.runInNewContext(fs.readFileSync(tool, 'utf8'), context, { filename: tool });
  const result = context.module.exports.validateOptionalQuiz(markdown());
  assert.equal(result.questions.length, 4);
  assert.deepEqual(required, ['node:fs']);
});

test('CLI accepts stdin and reports only a summary, with nonzero exit for invalid inputs', () => {
  const valid = spawnSync(process.execPath, [tool, '--stdin'], {
    input: markdown(),
    encoding: 'utf8',
  });
  assert.equal(valid.status, 0);
  assert.match(valid.stdout, /4 题，正式发布，版本 1.2/);
  assert.doesNotMatch(valid.stdout, /rubric|target|answer|根据定义/);
  const absent = spawnSync(process.execPath, [tool, '--stdin'], {
    input: '# 无扩展',
    encoding: 'utf8',
  });
  assert.equal(absent.status, 0);
  assert.match(absent.stdout, /未包含/);
  for (const [args, input] of [
    [[tool], ''],
    [[tool, '--stdin', 'extra'], markdown()],
    [[tool, '--stdin'], markdown(quiz({ reviewedBy: '' }))],
    [[tool, '--stdin'], '```freebbs-quiz\nINVALID\n```'],
  ]) {
    const result = spawnSync(process.execPath, args, { input, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /自测配置检查失败/);
  }
});
