const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { parse, prepare } = require('../docs/course-authoring/tools/整理知识点.cjs');
const { check, relations, layout } = require('../docs/course-authoring/tools/检查课程包.cjs');
const { validateNodePatch } = require('../backend/course-upload');
const { splitLegacyKnowledgeDocument } = require('../backend/course-maps');
const { parseAssessmentMarkdown, gradeAnswer } = require('../backend/learning-assessment');
const content = require('../public/learning-content');
const overview = require('../public/knowledge-overview');

const base = path.join(__dirname, '../docs/course-authoring');
const source = fs.readFileSync(path.join(base, 'examples/知识点/SS-01-01.md'), 'utf8');
const unscoredSource = content.stripQuizSource(source).trim();
const parseDemo = (markdown = source) => parse(markdown, { allowDemo: true });

test('portable converter exports publishable sections without overwriting files or changing the source', (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-course-authoring-'));
  t.after(() => {
    fs.rmSync(output, { recursive: true, force: true });
  });
  const file = path.join(base, 'examples/知识点/SS-01-01.md');
  const options = { allowDemo: true, out: output, revision: 'new', x: '200', y: '180' };
  const result = prepare(file, options);
  const payload = JSON.parse(fs.readFileSync(path.join(result.output, '发布数据.json'), 'utf8'));
  assert.deepEqual(validateNodePatch(payload, null).sections, parseDemo().sections);
  assert.equal(fs.readFileSync(file, 'utf8'), source);
  assert.throws(() => prepare(file, options), /已存在/);
  assert.throws(() => prepare(file, { ...options, revision: 'invalid' }), /revision/);
  assert.throws(() => prepare(file, { ...options, x: undefined }), /同时提供/);
});

test('README publishing command matches the current upload client', () => {
  const readme = fs.readFileSync(path.join(base, 'README.md'), 'utf8');
  const client = fs.readFileSync(
    path.join(__dirname, '../skills/freebbs-course-upload/scripts/freebbs_course_upload.py'),
    'utf8',
  );
  assert.match(
    readme,
    /freebbs_course_upload\.py connect signals SS-01-01 SS-01-02 --type ordered/,
  );
  assert.match(client, /add_parser\("connect"/);
  assert.doesNotMatch(readme, /put-edge/);
});

test('complete authoring documents map to existing upload contract without a fourth storage section', () => {
  const node = parseDemo();
  assert.deepEqual(node.sections, splitLegacyKnowledgeDocument(source, node.title));
  const patch = {
    title: node.title,
    summary: node.summary,
    sections: node.sections,
    expectedRevision: 'new',
  };
  assert.deepEqual(validateNodePatch(patch, null).sections, node.sections);
  const info = overview.model(node);
  assert.equal(info.chapter, '线性时不变系统的时域分析');
  assert.deepEqual(info.participants, ['示例编写者', '示例复核者']);
  assert.match(content.originMarkdown(node.sections), /不必为每一种输入/);
  assert.match(node.sections.knowledgeMarkdown, /练习与思考/);
  assert.match(node.sections.knowledgeMarkdown, /<details>/);
});
test('examples are blocked for publication and unfilled templates fail closed', () => {
  assert.throws(() => parse(source), /示例/);
  assert.throws(
    () => parseDemo(fs.readFileSync(path.join(base, 'templates/知识点.md'), 'utf8')),
    /占位符/,
  );
});

test('converter validates optional quizzes before exporting existing three sections', () => {
  const value = {
    schemaVersion: 1,
    status: 'draft',
    version: '1',
    questions: [
      {
        id: 'SS-01-01-Q01',
        type: 'numeric',
        prompt: '计算单位冲激响应的幅值。',
        scoring: {
          method: 'numeric',
          target: 1,
          absoluteTolerance: 0,
          relativeTolerance: 0,
          maxScore: 1,
          passScore: 1,
        },
      },
    ],
  };
  const block = `\n\n\`\`\`freebbs-quiz\n${JSON.stringify(value)}\n\`\`\``;
  assert.match(parseDemo(`${unscoredSource}${block}`).sections.knowledgeMarkdown, /freebbs-quiz/);
  assert.throws(() => parseDemo(`${unscoredSource}\n\`\`\`freebbs-quiz\n{}\n\`\`\``), /数据版本/);
  assert.throws(() => parseDemo(`${unscoredSource}${block}${block}`), /唯一/);
  assert.throws(
    () => parseDemo(unscoredSource.replace('## 2. 知识点正文', `${block}\n\n## 2. 知识点正文`)),
    /只能放/,
  );
});
test('local demonstration exercises use the real runtime contract for all four scoring types', () => {
  const assessment = parseAssessmentMarkdown(parseDemo().sections.knowledgeMarkdown);
  assert.deepEqual(assessment.warnings, []);
  assert.deepEqual(assessment.questions, []);
  assert.equal(assessment.questionVersion, 'demo-1.0');
  assert.equal(assessment.practiceQuestions.length, 5);
  assert.equal(new Set(assessment.practiceQuestions.map((question) => question.id)).size, 5);
  const questions = assessment.practiceQuestions.filter(
    (question) => question.questionVersion === 'demo-1.0',
  );
  assert.deepEqual(
    questions.map((question) => question.type),
    ['single_choice', 'multiple_choice', 'numeric', 'short_answer'],
  );
  assert.ok(questions.every((question) => !question.official));
  assert.equal(gradeAnswer(questions[0], 'A').score, 1);
  assert.equal(gradeAnswer(questions[0], 'B').score, 0);
  assert.equal(gradeAnswer(questions[1], ['C', 'A']).score, 2);
  assert.equal(gradeAnswer(questions[1], ['A']).score, 0);
  assert.equal(gradeAnswer(questions[1], ['A', 'B', 'C']).score, 0);
  assert.equal(gradeAnswer(questions[2], '2e0').score, 1);
  assert.equal(gradeAnswer(questions[2], '2.01').score, 1);
  assert.equal(gradeAnswer(questions[2], '2.02').score, 0);
  assert.equal(gradeAnswer(questions[0], 'A').verdict, 'practice_only');
  const subjective = gradeAnswer(questions[3], '通过计数核对，结论为2。');
  assert.equal(subjective.status, 'pending_review');
  assert.equal(subjective.score, null);
  assert.equal(subjective.verdict, null);
  assert.match(subjective.gradingBasis, /核对步骤.*2分.*结论.*3分/);
});

test('complete layered course example includes real chapter name, origin, worked example and fixed selftest set', () => {
  const manuscript = fs.readFileSync(path.join(base, 'examples/知识点/SS-02-01.md'), 'utf8');
  const node = parseDemo(manuscript);
  assert.equal(node.metadata['章节/单元'], '线性时不变系统的变换域分析');
  assert.match(content.originMarkdown(node.sections), /卷积积分/);
  assert.match(node.sections.knowledgeMarkdown, /### 例题/);
  assert.deepEqual(overview.model(node).participants, ['示例编写者', '示例复核者']);
  const draft = parseAssessmentMarkdown(node.sections.knowledgeMarkdown);
  assert.deepEqual(draft.questions, []);
  assert.equal(draft.practiceQuestions.length, 6);
  const publishedSource = node.sections.knowledgeMarkdown
    .replace('"status": "draft"', '"status": "published"')
    .replace('"reviewedBy": ""', '"reviewedBy": "本地测试复核人"');
  const published = parseAssessmentMarkdown(publishedSource);
  assert.equal(published.questions.length, 4);
  assert.deepEqual(
    published.questions.map((question) => question.difficulty),
    ['basic', 'standard', 'standard', 'challenge'],
  );
  assert.deepEqual(
    published.practiceQuestions.map((question) => question.assessmentRole),
    ['practice', 'exploration'],
  );
  assert.ok(published.questions.every((question) => question.official));
  const subjective = gradeAnswer(published.questions.at(-1), '独立说明积分范围与过程');
  assert.equal(subjective.status, 'pending_review');
  assert.equal(subjective.verdict, null);
  assert.throws(() => parse(manuscript), /示例/);
});
test('chapter nodes provide real names and are not counted as individual topics', () => {
  const chapter = parseDemo(fs.readFileSync(path.join(base, 'examples/章节/SS-01-00.md'), 'utf8'));
  const node = parseDemo();
  const sibling = parseDemo(
    fs.readFileSync(path.join(base, 'examples/知识点/SS-01-02.md'), 'utf8'),
  );
  const foreign = { id: 'SS-02-01', title: '本地跨章测试节点' };
  const internalEdge = { source: node.id, target: sibling.id, type: 'ordered' };
  assert.equal(content.isChapterNode(chapter), true);
  assert.equal(content.chapterName([node, chapter], 'SS-01'), chapter.title);
  assert.equal(content.chapterName([{ ...node, chapterTitle: '真实章名' }], 'SS-01'), '真实章名');
  const network = content.chapterNetwork(
    {
      nodes: [chapter, node, sibling, foreign],
      edges: [internalEdge, { source: node.id, target: foreign.id, type: 'related' }],
    },
    'SS-01',
  );
  assert.deepEqual(
    network.nodes.map((item) => item.id),
    [node.id, sibling.id],
  );
  assert.deepEqual(network.edges, [internalEdge]);
});
test('origin parsing ignores headings inside code and ends before applications', () => {
  assert.equal(
    content.originMarkdown({
      applicationsMarkdown:
        '~~~md\n### 知识起源\n假的\n~~~\n### 知识起源\n真实起源\n### 应用场景\n用途',
    }),
    '真实起源',
  );
  assert.equal(content.originMarkdown({ applicationsMarkdown: '只有简介' }), '');
});
test('course bundle validates chapters and reviewed relationships', () => {
  const result = check(path.join(base, 'examples'), { allowDemo: true });
  assert.equal(result.nodes.length, 5);
  assert.equal(result.edges.length, 3);
  assert.equal(result.edges[0].type, 'ordered');
  assert.deepEqual(result.positions['SS-01-01'], { x: 200, y: 180 });
});
test('layout rejects missing, duplicate and out-of-bounds coordinates', () => {
  const nodes = [{ id: 'SS-01-01' }];
  assert.throws(() => layout('', nodes), /未覆盖/);
  assert.throws(() => layout('| SS-01-01 | 0 | -1 |', nodes), /整数/);
  assert.throws(() => layout('| SS-01-01 | 10001 | 0 |', nodes), /整数/);
  assert.throws(() => layout('| SS-01-01 | 0 | 0 |\n| SS-01-01 | 0 | 0 |', nodes), /重复/);
  assert.deepEqual(layout('| SS-01-01 | 0 | 0 |', nodes), { 'SS-01-01': { x: 0, y: 0 } });
});
test('unsupported, duplicate, dangling and cyclic relationships are rejected', () => {
  const nodes = [{ id: 'SS-01-01' }, { id: 'SS-01-02' }];
  const row = (a, b, type = 'ordered') =>
    `| ${[a, b, type, '前置', '已经核对', '通过'].join(' | ')} |`;
  assert.throws(() => relations(row('SS-01-01', 'SS-01-02', 'prerequisite'), nodes), /仅支持/);
  assert.throws(() => relations(row('SS-01-01', 'SS-01-03'), nodes), /未提供/);
  assert.throws(
    () => relations(`${row('SS-01-01', 'SS-01-02')}\n${row('SS-01-02', 'SS-01-01')}`, nodes),
    /存在环/,
  );
  assert.throws(
    () =>
      relations(
        `${row('SS-01-01', 'SS-01-02', 'related')}\n${row('SS-01-02', 'SS-01-01', 'related')}`,
        nodes,
      ),
    /重复/,
  );
});
