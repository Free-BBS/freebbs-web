const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const {
  loadCompanionContext,
  normalizeTask,
  summarizeEvidence,
  companionHint,
  createMysqlCompanionNodeLoader,
} = require('./learning-companion');
const { parse } = require('../docs/course-authoring/tools/整理知识点.cjs');
const {
  parseAssessmentMarkdown,
  createMemoryAssessmentStore,
  gradeAnswer,
} = require('./learning-assessment');

const parsed = parse(
  fs.readFileSync(
    path.join(__dirname, '../docs/course-authoring/examples/知识点/SS-02-01.md'),
    'utf8',
  ),
  { allowDemo: true },
);
const markdown = parsed.sections.knowledgeMarkdown
  .replace('"status": "draft"', '"status": "published"')
  .replace('"reviewedBy": ""', '"reviewedBy": "本地测试复核"');
const assessment = parseAssessmentMarkdown(markdown);
const node = {
  course_id: 1,
  node_id: 'SS-02-01',
  title: '真实题目',
  course_name: '信号与系统',
  document_markdown: markdown,
  knowledge_markdown: markdown,
  applications_markdown: parsed.sections.applicationsMarkdown,
};
const rawContext = {
  courseSlug: 'signals',
  knowledgePointId: 'SS-02-01',
  knowledgePointMarkdown: 'FORGED_DOCUMENT',
  learningStartPreference: { level: 'new', goal: 'concepts' },
  learningEvidence: { passed: 999 },
  learningTask: {
    tool: 'feedback',
    quizView: 'practice',
    questionId: assessment.practiceQuestions[0]?.id,
    privateNotes: 'PRIVATE_NOTE',
  },
};

test('production companion query uses the real section table and parameterized active-course lookup', async () => {
  let query;
  let parameters;
  const loadNode = createMysqlCompanionNodeLoader({
    execute: async (sql, values) => {
      query = sql;
      parameters = values;
      return [[node]];
    },
  });
  assert.equal(await loadNode('signals', 'SS-02-01'), node);
  assert.deepEqual(parameters, ['signals', 'SS-02-01']);
  assert.match(query, /s\.applications_markdown/);
  assert.doesNotMatch(query, /n\.applications_markdown/);
  assert.match(query, /LEFT JOIN course_map_node_sections s/);
  assert.match(query, /s\.course_id = n\.course_id AND s\.node_id = n\.node_id/);
  assert.match(query, /c\.is_active = 1/);
  assert.match(query, /e\.source_node_id = n\.node_id OR e\.target_node_id = n\.node_id/);
});

test('Max loads canonical course text and only the authenticated learner records, not client evidence', async () => {
  let receivedUser;
  const context = await loadCompanionContext({
    user: { id: 7 },
    rawContext,
    store: {
      context: async () => node,
      list: async (user, value, before, review) => {
        receivedUser = user;
        assert.equal(value.node_id, 'SS-02-01');
        assert.equal(review, false);
        return [];
      },
    },
  });
  assert.equal(receivedUser.id, 7);
  assert.equal(context.knowledgePointTitle, '真实题目');
  assert.doesNotMatch(JSON.stringify(context), /FORGED_DOCUMENT|PRIVATE_NOTE|"passed":999/);
  assert.doesNotMatch(context.knowledgePointMarkdown, /freebbs-quiz/);
  assert.equal(context.resources.hasOrigin, true);
  assert.equal(context.resources.hasQuestions, true);
  assert.deepEqual(context.learningStartPreference, { level: 'new', goal: 'concepts' });
});

test('Max task context preserves only known question identity, never hidden scoring or personal notes', () => {
  const question = assessment.practiceQuestions[0];
  assert.ok(question);
  const task = normalizeTask(
    {
      tool: 'feedback',
      quizView: 'practice',
      questionId: question.id,
      scoring: { answer: 'SECRET' },
      notes: 'SECRET',
    },
    [question],
  );
  assert.equal(task.questionId, question.id);
  assert.doesNotMatch(JSON.stringify(task), /SECRET|explanation|misconceptions|scoring/);
  assert.equal(normalizeTask({ questionId: 'UNKNOWN' }, [question]).questionId, undefined);
  assert.equal(normalizeTask({ tool: 'content', quizView: 'quick' }).quizView, undefined);
});

test('self-report and practice never enter the formal current-version evidence summary', () => {
  const question = assessment.questions[0];
  assert.ok(question, 'test fixture has reviewed official questions');
  const base = {
    questionId: question.id,
    questionVersion: question.questionVersion,
    documentVersion: assessment.documentVersion,
    official: true,
    status: 'graded',
    verdict: 'pass',
  };
  const summary = summarizeEvidence(assessment, [
    { ...base, official: false },
    { ...base, status: 'pending_review', verdict: null },
    { ...base, documentVersion: 'old' },
    { ...base, questionVersion: 'old' },
    base,
  ]);
  assert.equal(summary.observed, 1);
  assert.equal(summary.passed, 0);
  assert.equal(summary.pending, 1);
  assert.equal(summary.officialTotal, assessment.questions.length);
});

test('Max consumes real parsed question versions and authenticated persisted pass, fail and pending evidence', async () => {
  const store = createMemoryAssessmentStore({ contexts: [node] });
  const user = { id: 7 };
  const submit = async (owner, question, answer) => {
    const key = randomUUID();
    return store.create(
      owner,
      node,
      question,
      gradeAnswer(question, answer),
      key,
      key,
      assessment.documentVersion,
      null,
    );
  };
  const [single, numeric, , manual] = assessment.questions;
  assert.ok(single.questionVersion, 'use the real parser version field, never an undefined alias');
  assert.equal(single.version, undefined);
  const passed = await submit(user, single, 'A');
  const failed = await submit(user, numeric, 1);
  const pending = await submit(user, manual, '独立推导的待复核过程');
  await submit(user, assessment.practiceQuestions[0], 'A');
  await submit({ id: 8 }, numeric, 0);
  assert.equal(passed.verdict, 'pass');
  assert.equal(failed.verdict, 'fail');
  assert.equal(pending.status, 'pending_review');
  const context = await loadCompanionContext({
    store,
    user,
    rawContext,
    loadNode: async () => node,
  });
  assert.equal(context.learningEvidence.officialTotal, 4);
  assert.equal(context.learningEvidence.observed, 3);
  assert.equal(context.learningEvidence.passed, 1);
  assert.equal(context.learningEvidence.failed, 1);
  assert.equal(context.learningEvidence.pending, 1);
  await submit(user, numeric, 0);
  const corrected = await loadCompanionContext({
    store,
    user,
    rawContext,
    loadNode: async () => node,
  });
  assert.equal(corrected.learningEvidence.passed, 2);
  assert.equal(corrected.learningEvidence.failed, 0);
  assert.equal(corrected.learningEvidence.pending, 1);
});

test('Max selects latest formal evidence before versions so rollback cannot revive an old pass', () => {
  const question = assessment.questions[0];
  const oldPass = {
    questionId: question.id,
    questionVersion: question.questionVersion,
    documentVersion: assessment.documentVersion,
    official: true,
    status: 'graded',
    verdict: 'pass',
  };
  for (const incompatible of [
    { documentVersion: 'newer-document', status: 'graded', verdict: 'fail' },
    { questionVersion: 'newer-question', status: 'pending_review', verdict: null },
  ]) {
    const summary = summarizeEvidence(assessment, [{ ...oldPass, ...incompatible }, oldPass]);
    assert.equal(summary.observed, 0);
    assert.equal(summary.passed, 0);
    assert.equal(summary.failed, 0);
    assert.equal(summary.pending, 0);
  }
  const newerPractice = { ...oldPass, official: false, verdict: 'practice_only' };
  assert.equal(summarizeEvidence(assessment, [newerPractice, oldPass]).passed, 1);
});

test('recent evidence is bounded and labelled as a partial view rather than complete mastery', () => {
  const summary = summarizeEvidence(
    assessment,
    Array.from({ length: 51 }, () => ({ official: false })),
  );
  assert.equal(summary.limited, true);
  const hint = companionHint({ learningEvidence: summary });
  assert.match(hint, /只读取最近51条/);
  assert.match(hint, /缺失不代表未做/);
  assert.match(hint, /不据此认定全部通过/);
  assert.match(hint, /私人批注不自动读取/);
});

test('invalid course identifiers and absent nodes fail before generating an AI request', async () => {
  const store = {
    context: async () => null,
    list: async () => {
      throw new Error('must not read');
    },
  };
  await assert.rejects(
    loadCompanionContext({
      store,
      user: { id: 1 },
      rawContext: { ...rawContext, courseSlug: '../secrets' },
    }),
    (error) => error.status === 400,
  );
  await assert.rejects(
    loadCompanionContext({ store, user: { id: 1 }, rawContext }),
    (error) => error.status === 404,
  );
});

test('Max resolves the same origin and canonical body as the page for a legacy unsplit course', async () => {
  const legacy = {
    ...node,
    knowledge_markdown: null,
    applications_markdown: null,
    document_markdown:
      '# 真实题目\n\n## 基本信息\n作者：课程组\n\n## 知识背景与应用\n### 知识起源\n为何要学习。\n\n## 知识点正文\n唯一正文。',
    has_relations: '0',
  };
  const context = await loadCompanionContext({
    user: { id: 7 },
    rawContext,
    store: { context: async () => legacy, list: async () => [] },
  });
  assert.equal(context.resources.hasOrigin, true);
  assert.equal(context.resources.hasRelations, false);
  assert.match(context.knowledgePointMarkdown, /唯一正文/);
  assert.doesNotMatch(context.knowledgePointMarkdown, /为何要学习|作者：/);
});
