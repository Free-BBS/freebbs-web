const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const {
  parse,
  prepare,
  extractHeading,
  authoredChapterName,
} = require('../docs/course-authoring/tools/整理知识点.cjs');
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

test('converter runs outside the repository using only its bundled Node tools', (t) => {
  const detached = fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-authoring-detached-'));
  t.after(() => fs.rmSync(detached, { recursive: true, force: true }));
  for (const file of ['整理知识点.cjs', '检查自测.cjs'])
    fs.copyFileSync(path.join(base, 'tools', file), path.join(detached, file));
  const result = JSON.parse(
    execFileSync(
      process.execPath,
      [
        path.join(detached, '整理知识点.cjs'),
        path.join(base, 'examples/知识点/SS-01-01.md'),
        '--allow-demo',
      ],
      { cwd: detached, encoding: 'utf8' },
    ),
  );
  assert.equal(result.checked, true);
  assert.equal(result.id, 'SS-01-01');
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
test('scored question IDs require one matching Markdown title and report the exact mismatch', () => {
  for (const manuscript of [
    source,
    source
      .replace('"status": "draft"', '"status": "published"')
      .replace('"reviewedBy": ""', '"reviewedBy": "本地测试复核人"'),
  ])
    assert.throws(
      () => parseDemo(manuscript.replace('#### 题目 SS-01-01-Q02', '#### 题目 OTHER-Q02')),
      /题号与Markdown正文不一致：SS-01-01-Q02.*缺少对应/,
    );
  assert.throws(
    () => parseDemo(source.replace('"id": "SS-01-01-Q02"', '"id": "OTHER-Q02"')),
    /题号与Markdown正文不一致：OTHER-Q02.*缺少对应/,
  );
  assert.throws(
    () =>
      parseDemo(
        source.replace(
          '#### 题目 SS-01-01-Q02',
          '#### 题目 SS-01-01-Q02\n\n#### 题目 SS-01-01-Q02',
        ),
      ),
    /SS-01-01-Q02.*重复出现2次/,
  );
});
test('mismatched scored IDs stop conversion before creating any publishable output', (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-authoring-mismatch-'));
  t.after(() => {
    fs.rmSync(output, { recursive: true, force: true });
  });
  const invalidSource = source.replace('#### 题目 SS-01-01-Q02', '#### 题目 OTHER-Q02');
  const file = path.join(output, 'manuscript.md');
  fs.writeFileSync(file, invalidSource, 'utf8');
  const exportDirectory = path.join(output, 'export');
  assert.throws(
    () => prepare(file, { allowDemo: true, out: exportDirectory, revision: 'new', x: 200, y: 180 }),
    /SS-01-01-Q02.*缺少对应/,
  );
  assert.equal(fs.existsSync(exportDirectory), false);
  assert.equal(fs.readFileSync(file, 'utf8'), invalidSource);
});
test('code examples cannot supply or duplicate scored Markdown question titles', () => {
  for (const fence of ['```', '~~~~']) {
    const example = `${fence}md\n#### 题目 SS-01-01-Q02\n${fence}`;
    const inserted = source.replace('### 练习与思考', `### 练习与思考\n\n${example}`);
    assert.equal(parseDemo(inserted).id, 'SS-01-01');
    assert.throws(
      () =>
        parseDemo(
          inserted.replace(/#### 题目 SS-01-01-Q02(?=\r?\n\r?\n题型)/, '#### 题目 OTHER-Q02'),
        ),
      /SS-01-01-Q02.*缺少对应/,
    );
  }
});
test('unconfigured Markdown exercises remain compatible and extra practice titles are allowed', () => {
  const unchanged = parseDemo(unscoredSource);
  const oldTitles = parseDemo(
    unscoredSource.replace('#### 题目 SS-01-01-Q02', '#### 题目 OTHER-Q02'),
  );
  assert.equal(unchanged.id, 'SS-01-01');
  assert.equal(oldTitles.id, 'SS-01-01');
  assert.deepEqual(parseAssessmentMarkdown(oldTitles.sections.knowledgeMarkdown).questions, []);
  const scored = parseAssessmentMarkdown(parseDemo().sections.knowledgeMarkdown);
  assert.equal(
    scored.practiceQuestions.find((question) => question.id === 'SS-01-01-Q01').questionVersion,
    'legacy-practice',
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

test('portable origin reader has runtime parity for real, empty and fenced headings', () => {
  for (const markdown of [
    '只有简介',
    '### 知识起源\n\n### 应用场景\n这个用途不属于起源。',
    '```md\n### 知识起源\n假的起源。\n```\n### 应用场景\n用途。',
    '~~~md\n### 知识起源\n假的起源。\n~~~\n### 知识起源\n真实起源。\n### 应用场景\n用途。',
    '### 知识起源\r\n真实起源。\r\n#### 子问题\r\n细节。\r\n### 应用场景\r\n用途。',
    '### 知识起源 ###\n真实起源。\n```md\n### 这是起源内的代码，不终止小节\n```\n### 应用场景\n用途。',
  ]) {
    assert.equal(
      extractHeading(markdown, ['知识起源']),
      content.extractHeading(markdown, ['知识起源']),
    );
    assert.equal(
      extractHeading(markdown, ['知识起源']),
      content.originMarkdown({ applicationsMarkdown: markdown }),
    );
  }
});

test('submission requires nonempty origin in its actual applications section, not a code title or following section', () => {
  const emptyOrigin = source.replace(/(### 知识起源\r?\n)[\s\S]*?(?=### 应用场景)/, '$1\n');
  assert.throws(() => parseDemo(emptyOrigin), /非空.*知识起源/);
  for (const fence of ['```', '~~~~']) {
    const fencedOrigin = source
      .replace('### 知识起源', `${fence}md\n### 知识起源`)
      .replace('### 应用场景', `${fence}\n\n### 应用场景`);
    assert.throws(() => parseDemo(fencedOrigin), /非空.*知识起源/);
  }
  const bodyOnlyOrigin = emptyOrigin
    .replace(/### 知识起源\r?\n/, '### 起源待编写\n')
    .replace(
      '### 定义与适用条件',
      '### 知识起源\n正文里的起源不能代替背景分区。\n\n### 定义与适用条件',
    );
  assert.throws(() => parseDemo(bodyOnlyOrigin), /非空.*知识起源/);
  const valid = source.replace('### 知识起源', '### 知识起源 ###');
  assert.equal(parseDemo(valid).id, 'SS-01-01');
  assert.match(content.originMarkdown(parseDemo(valid).sections), /不必为每一种输入/);
});

test('portable actual-chapter-name predicate matches map display and rejects ordinals for both levels', () => {
  const chapter = fs.readFileSync(path.join(base, 'examples/章节/SS-01-00.md'), 'utf8');
  const originalName = '线性时不变系统的时域分析';
  const invalidNames = [
    '第1章',
    '第 X 章',
    '第一章：',
    'Chapter 1',
    'Chapter IV',
    'Chapter N',
    'Unit N',
    '1',
    'SS-01',
    'SS-01-00',
  ];
  const validNames = [
    originalName,
    '第1章 线性时不变系统',
    'Chapter 1: Linear Systems',
    '第 X 章：极限与连续',
  ];
  for (const name of [...invalidNames, ...validNames]) {
    const expected = content.chapterName([{ id: 'SS-01-01', chapterTitle: name }], 'SS-01');
    assert.equal(authoredChapterName(name, 'SS-01') || 'SS-01', expected);
    const pointManuscript = source.replace(`章节/单元：${originalName}`, `章节/单元：${name}`);
    const chapterManuscript = chapter.replaceAll(originalName, name);
    if (invalidNames.includes(name)) {
      assert.throws(() => parseDemo(pointManuscript), /实际章名/);
      assert.throws(() => parseDemo(chapterManuscript), /实际章名/);
    } else {
      assert.equal(parseDemo(pointManuscript).metadata['章节/单元'], name);
      assert.equal(parseDemo(chapterManuscript).title, name);
    }
  }
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
