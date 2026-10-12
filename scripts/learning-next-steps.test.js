const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  recommend,
  normalizePath,
  reorderStep,
  toggleStep,
  sequenceNode,
  presentation,
} = require('../public/learning-next-steps');

const node = {
  id: 'S-1-2',
  title: '卷积',
  documentVersion: 'document-v2',
  sections: { knowledgeMarkdown: '## 卷积\n通过积分计算。' },
};
const previous = { id: 'S-1-1', title: '信号' };
const next = { id: 'S-1-4', title: '系统响应' };
const unrelated = { id: 'S-1-3', title: '课程编号中的下一知识点' };
const map = {
  nodes: [previous, node, unrelated, next],
  edges: [
    { type: 'ordered', source: previous.id, target: node.id },
    { type: 'related', source: node.id, target: unrelated.id },
    { type: 'ordered', source: node.id, target: next.id },
  ],
};
const question = { id: 'q1', questionVersion: 'question-v2', official: true };
const attempt = (overrides = {}) => ({
  questionId: question.id,
  status: 'graded',
  verdict: 'pass',
  official: true,
  questionVersion: question.questionVersion,
  documentVersion: node.documentVersion,
  updatedAt: '2026-10-01T12:00:00Z',
  ...overrides,
});
const context = (overrides = {}) => ({ node, map, questions: [question], ...overrides });

test('missing or malformed data produces a small actionable path without invented material', () => {
  for (const value of [undefined, null, false, [], 'bad', { node: null, map: false }]) {
    const result = recommend(value);
    assert.equal(result.mode, 'start');
    assert.ok(result.steps.length > 0 && result.steps.length <= 4);
    assert.ok(result.steps.every((step) => ['notes', 'discussion'].includes(step.tool)));
    assert.equal(
      result.steps.some((step) => step.point),
      false,
    );
    assert.equal(
      result.steps.some((step) => /掌握|通过|不及格|基础差/.test(step.description)),
      false,
    );
  }
});

test('a normal new path includes reading and only real resources', () => {
  const result = recommend(context({ status: 'unlearned' }));
  assert.equal(result.mode, 'start');
  assert.equal(result.steps[0].tool, 'content');
  assert.equal(
    result.steps.some((step) => step.tool === 'resources'),
    false,
  );
  assert.equal(
    result.steps.some((step) => /先修|前置/.test(step.title)),
    false,
  );
  assert.ok(result.steps.every((step) => typeof step.completed === 'boolean' && step.minutes > 0));
  assert.equal(
    recommend(context({ resources: [{ id: 'r1', title: '讲义' }] })).steps.some(
      (step) => step.tool === 'resources',
    ),
    true,
  );
});

test('unknown lifecycle and authoring tags do not imply learning completion', () => {
  const result = recommend({
    node: { ...node, lifecycle: 'published', tags: ['learned'], status: 'passed' },
    map,
    status: 'published',
  });
  assert.equal(result.mode, 'start');
  assert.equal(
    result.steps.some((step) => step.id === 'read-next'),
    false,
  );
});

test('a manually completed status is described as the student own marking', () => {
  const result = recommend(context({ status: 'completed' }));
  assert.equal(result.mode, 'advance');
  assert.match(result.reason, /已标记学过/);
  assert.doesNotMatch(JSON.stringify(result), /授星|能力|全都通过|正式自测题均已通过/);
});

test('learning state continues current work, while important state adds grounded recall', () => {
  assert.equal(recommend(context({ status: 'learning' })).mode, 'resume');
  const result = recommend(context({ status: 'unlearned', important: true }));
  assert.equal(result.mode, 'consolidate');
  assert.equal(result.steps[0].point, previous.id);
  assert.equal(result.steps[0].title, '回看上一知识点');
  assert.doesNotMatch(JSON.stringify(result), /先修|前置/);
});

test('prerequisite copy requires an explicit prerequisite edge', () => {
  const result = recommend(
    context({
      important: true,
      map: {
        nodes: [previous, node],
        edges: [{ type: 'prerequisite', source: previous.id, target: node.id }],
      },
    }),
  );
  assert.equal(result.steps[0].title, '回看前置知识');
  assert.equal(result.steps[0].point, previous.id);
});

test('pending review is never interpreted as failure, including zero scores', () => {
  const result = recommend(
    context({ recentAttempts: [attempt({ status: 'pending_review', verdict: null, score: 0 })] }),
  );
  assert.equal(result.mode, 'start');
  assert.match(result.reason, /待批阅/);
  assert.equal(
    result.steps.some((step) => step.id === 'correct-attempt'),
    false,
  );
});

test('a current official failed attempt prioritizes correction over reading', () => {
  const result = recommend(context({ recentAttempts: [attempt({ verdict: 'fail' })] }));
  assert.equal(result.mode, 'repair');
  assert.equal(result.steps[0].id, 'correct-attempt');
  assert.equal(result.steps[0].tool, 'feedback');
  assert.equal(result.steps[1].tool, 'content');
});

test('all matching latest official answers pass before proposing the course ID successor', () => {
  const result = recommend(context({ recentAttempts: [attempt()] }));
  assert.equal(result.mode, 'advance');
  assert.equal(result.steps[0].point, unrelated.id);
  assert.notEqual(result.steps[0].point, next.id);
  const partial = recommend(
    context({
      questions: [question, { ...question, id: 'q2' }],
      recentAttempts: [attempt()],
    }),
  );
  assert.equal(partial.mode, 'start');
});

test('academic edges and node array position do not override the course ID sequence', () => {
  const result = recommend(
    context({
      recentAttempts: [attempt()],
      map: {
        nodes: [next, node, unrelated],
        edges: [{ type: 'related', source: node.id, target: next.id }],
      },
    }),
  );
  assert.equal(result.mode, 'advance');
  assert.equal(result.steps[0].point, unrelated.id);
});

test('latest attempt per question replaces earlier failure and can represent a correction', () => {
  const old = attempt({ verdict: 'fail', updatedAt: '2026-09-30T12:00:00Z' });
  const current = attempt({ supersedesAttemptId: 'old' });
  for (const records of [
    [old, current],
    [current, old],
  ]) {
    assert.equal(recommend(context({ recentAttempts: records })).mode, 'advance');
  }
  assert.equal(
    recommend(
      context({ recentAttempts: [old, attempt({ status: 'pending_review', verdict: null })] }),
    ).mode,
    'start',
  );
});

test('old document and question snapshots cannot trigger correction or advancement', () => {
  for (const record of [
    attempt({ documentVersion: 'document-v1', verdict: 'fail' }),
    attempt({ documentVersion: undefined, verdict: 'fail' }),
    attempt({ questionVersion: 'question-v1', verdict: 'fail' }),
    attempt({ questionVersion: undefined }),
    attempt({ documentVersion: 'document-v1' }),
  ]) {
    assert.equal(recommend(context({ recentAttempts: [record] })).mode, 'start');
  }
  assert.equal(
    recommend(context({ documentVersion: 'document-v3', recentAttempts: [attempt()] })).mode,
    'start',
  );
});

test('a newer incompatible snapshot does not resurrect an older current-version result', () => {
  const records = [
    attempt({ verdict: 'fail', updatedAt: '2026-09-30T12:00:00Z' }),
    attempt({ documentVersion: 'document-v3' }),
  ];
  assert.equal(recommend(context({ recentAttempts: records })).mode, 'start');
});

test('practice, missing official flag and unknown verdict do not establish objective success', () => {
  for (const record of [
    attempt({ official: false }),
    attempt({ official: undefined, verdict: 'fail' }),
    attempt({ verdict: 'practice_only' }),
    attempt({ verdict: null }),
    attempt({ status: 'passed' }),
  ]) {
    assert.equal(recommend(context({ recentAttempts: [record] })).mode, 'start');
  }
});

test('newer practice submissions cannot hide the latest formal failure', () => {
  const formal = attempt({ id: '1', verdict: 'fail' });
  const practice = attempt({ id: '2', official: false, verdict: 'practice_only' });
  for (const recentAttempts of [
    [formal, practice],
    [practice, formal],
  ]) {
    const result = recommend(context({ recentAttempts }));
    assert.equal(result.mode, 'repair');
    assert.equal(result.steps[0].tool, 'feedback');
  }
});

test('newer practice submissions cannot replace current formal pass evidence', () => {
  const formal = attempt({ id: '1' });
  const practice = attempt({ id: '2', official: false, verdict: 'practice_only' });
  for (const recentAttempts of [
    [formal, practice],
    [practice, formal],
  ]) {
    const result = recommend(context({ recentAttempts }));
    assert.equal(result.mode, 'advance');
    assert.equal(result.steps[0].point, unrelated.id);
  }
});

test('a newer official snapshot still blocks resurrecting an older result despite later practice', () => {
  for (const verdict of ['pass', 'fail']) {
    const recentAttempts = [
      attempt({ id: '1', verdict }),
      attempt({ id: '2', documentVersion: 'document-v3' }),
      attempt({ id: '3', official: false, verdict: 'practice_only' }),
    ];
    assert.equal(recommend(context({ recentAttempts })).mode, 'start');
  }
});

test('saved paths retain the student order, completion and skip choices without mutation', () => {
  const existingPath = [
    { id: 'discuss', title: '先去讨论', tool: 'discussion', minutes: 5, skipped: true },
    { id: 'read', title: '再读正文', tool: 'content', minutes: 10, completed: true },
    { id: 'check', title: '最后自测', tool: 'feedback', minutes: 3, completed: false },
  ];
  const snapshot = JSON.stringify(existingPath);
  const result = recommend(context({ existingPath }));
  assert.equal(result.mode, 'resume');
  assert.deepEqual(
    result.steps.map((step) => step.id),
    ['discuss', 'read', 'check'],
  );
  assert.equal(result.steps[0].skipped, true);
  assert.equal(result.steps[1].completed, true);
  assert.equal(JSON.stringify(existingPath), snapshot);
  assert.equal(
    recommend(context({ existingPath: existingPath.map((step) => ({ ...step, completed: true })) }))
      .mode,
    'resume',
  );
});

test('objective failure prioritizes a separate correction without changing the saved path', () => {
  const existingPath = [{ id: 'read', title: '读正文', tool: 'content', completed: false }];
  const result = recommend(
    context({ existingPath, recentAttempts: [attempt({ verdict: 'fail' })] }),
  );
  assert.equal(result.mode, 'repair');
  assert.equal(result.presentation.primary.id, 'correct-attempt');
  assert.deepEqual(result.steps, normalizePath(existingPath));
});

test('an unchanged failed record does not reset a saved correction completion or skip choice', () => {
  for (const preference of [{ completed: true }, { skipped: true }]) {
    const existingPath = [
      { id: 'correct-attempt', title: '订正自测', tool: 'feedback', ...preference },
      { id: 'read', title: '读正文', tool: 'content', completed: false },
    ];
    const result = recommend(
      context({ existingPath, recentAttempts: [attempt({ verdict: 'fail' })] }),
    );
    assert.equal(result.steps[0].completed, preference.completed === true);
    assert.equal(result.steps[0].skipped, preference.skipped === true);
  }
});

test('a saved path stays in its original order while correction is recommended separately', () => {
  const existingPath = [
    { id: 'read', title: '读正文', tool: 'content', completed: true },
    { id: 'resource', title: '看资料', tool: 'resources' },
    { id: 'check', title: '小自测', tool: 'feedback', skipped: true },
    { id: 'discuss', title: '去讨论', tool: 'discussion' },
  ];
  const result = recommend(
    context({ existingPath, recentAttempts: [attempt({ verdict: 'fail' })] }),
  );
  assert.deepEqual(
    result.steps.map((step) => step.id),
    ['read', 'resource', 'check', 'discuss'],
  );
  assert.equal(result.presentation.primary.quizView, 'mistakes');
  assert.equal(result.steps[2].skipped, true);
  assert.equal(result.steps[0].completed, true);
});

test('independent correction preserves both completed and skipped custom steps', () => {
  for (const preference of [{ completed: true }, { skipped: true }]) {
    const existingPath = [
      { id: 'read', title: '读正文', tool: 'content' },
      { id: 'old', title: '已处理的一步', tool: 'content', ...preference },
      { id: 'resource', title: '看资料', tool: 'resources' },
      { id: 'discuss', title: '去讨论', tool: 'discussion' },
    ];
    const result = recommend(
      context({ existingPath, recentAttempts: [attempt({ verdict: 'fail' })] }),
    );
    assert.deepEqual(
      result.steps.map((step) => step.id),
      ['read', 'old', 'resource', 'discuss'],
    );
    assert.equal(result.steps[1].completed, preference.completed === true);
    assert.equal(result.steps[1].skipped, preference.skipped === true);
    assert.equal(result.presentation.primary.quizView, 'mistakes');
  }
});

test('a full twenty-step unfinished path is preserved and correction is explained in the reason', () => {
  const existingPath = Array.from({ length: 20 }, (_, index) => ({
    id: `saved-${index}`,
    title: `步骤${index}`,
    tool: ['content', 'resources', 'discussion', 'notes'][index % 4],
    completed: false,
  }));
  const result = recommend(
    context({ existingPath, recentAttempts: [attempt({ verdict: 'fail' })] }),
  );
  assert.equal(result.mode, 'repair');
  assert.deepEqual(result.steps, normalizePath(existingPath));
  assert.match(result.reason, /待订正/);
  assert.equal(result.presentation.primary.id, 'correct-attempt');
});

test('saved paths preserve the complete twenty-step backend contract and all seven tools', () => {
  const tools = [
    'content',
    'resources',
    'feedback',
    'continue',
    'notes',
    'contribute',
    'discussion',
  ];
  const existingPath = Array.from({ length: 20 }, (_, index) => ({
    id: `saved-${index}`,
    title: '题'.repeat(120),
    description: '目标'.repeat(300),
    tool: tools[index % tools.length],
    minutes: 240,
    completed: index % 2 === 0,
    point: node.id,
  }));
  const result = recommend(context({ existingPath }));
  assert.equal(result.mode, 'resume');
  assert.equal(result.steps.length, 20);
  assert.deepEqual(
    result.steps.map(({ skipped, ...step }) => step),
    existingPath,
  );
  assert.equal(reorderStep(result.steps, 'saved-19', -19)[0].id, 'saved-19');
  assert.equal(toggleStep(result.steps, 'saved-19').length, 20);
  assert.equal(toggleStep(result.steps, 'saved-19')[19].completed, true);
});

test('an entirely completed saved path remains intact even with an official pass or manual completion', () => {
  const existingPath = [
    { id: 'read', title: '阅读', tool: 'content', minutes: 10, completed: true },
    { id: 'note', title: '记下理解', tool: 'notes', minutes: 5, completed: true },
  ];
  for (const extra of [
    { status: 'completed' },
    { recentAttempts: [attempt()] },
    { status: 'learning' },
  ]) {
    const result = recommend(context({ existingPath, ...extra }));
    assert.equal(result.mode, 'resume');
    assert.deepEqual(result.steps, normalizePath(existingPath));
    assert.match(result.reason, /步骤均已标记完成/);
    assert.equal(
      result.steps.some((step) => step.id === 'read-next'),
      false,
    );
  }
});

test('only a new default path is limited to four steps', () => {
  for (const extra of [
    {},
    { important: true },
    { status: 'completed' },
    { recentAttempts: [attempt()] },
    { recentAttempts: [attempt({ verdict: 'fail' })] },
  ]) {
    assert.ok(recommend(context(extra)).steps.length <= 4);
  }
});

test('course ID sequence uses natural numeric chapter and point tokens and excludes zero-level nodes', () => {
  const current = { id: 'SS-2-9' };
  const graph = {
    nodes: [
      { id: 'SS-10-1' },
      { id: 'SS-2-10' },
      { id: 'SS-2-0' },
      { id: 'SS-2-8' },
      { id: 'SS-3-00' },
      { id: 'SS-3-1' },
      { id: 'ZZ-2-10' },
      current,
    ],
  };
  assert.equal(sequenceNode(graph, current).id, 'SS-2-10');
  assert.equal(sequenceNode(graph, current, 'previous').id, 'SS-2-8');
  assert.equal(sequenceNode(graph, { id: 'SS-2-10' }).id, 'SS-3-1');
  assert.equal(sequenceNode(graph, { id: 'SS-3-1' }).id, 'SS-10-1');
  assert.equal(sequenceNode(graph, { id: 'SS-10-1' }), null);
  const large = { id: 'SS-10-9007199254740993' };
  assert.equal(
    sequenceNode({ nodes: [large, { id: 'SS-10-9007199254740994' }] }, large).id,
    'SS-10-9007199254740994',
  );
});

test('unknown current IDs and ambiguous duplicate teaching positions cannot advance', () => {
  const graph = { nodes: [node, unrelated, { id: 'S-1-00' }, { id: 'S-1-X' }] };
  for (const current of [{ id: 'unknown' }, { id: 'S-1-X' }, { id: 'S-1-0' }, { id: 'S-9-9' }, {}])
    assert.equal(sequenceNode(graph, current), null);
  assert.equal(sequenceNode({ nodes: [node, node, unrelated] }, node), null);
  assert.equal(sequenceNode({ nodes: [node, { id: 'S-01-02' }, unrelated] }, node), null);
  const result = recommend(context({ map: { nodes: [] }, recentAttempts: [attempt()] }));
  assert.equal(result.mode, 'review');
  assert.equal(
    result.steps.some((step) => step.id === 'read-next'),
    false,
  );
});

test('chapter 00 may contain ordinary points while point suffix 00 remains a heading', () => {
  const intro = { id: 'SS-00-01' };
  const first = { id: 'SS-01-01' };
  const graph = { nodes: [first, { id: 'SS-00-00' }, intro, { id: 'SS-01-00' }] };
  assert.equal(sequenceNode(graph, intro).id, first.id);
  assert.equal(sequenceNode(graph, first, 'previous').id, intro.id);
  assert.equal(sequenceNode(graph, { id: 'SS-00-00' }), null);
});

test('formal advancement requires a current matching official question, not only an attempt claim', () => {
  for (const questions of [
    undefined,
    [],
    [{ ...question, official: false }],
    [{ ...question, questionVersion: undefined }],
    [{ ...question, questionVersion: 'new' }],
  ]) {
    assert.equal(recommend(context({ questions, recentAttempts: [attempt()] })).mode, 'start');
  }
});

test('later grading of an old attempt does not override a newer submitted answer', () => {
  const old = attempt({
    id: '1',
    createdAt: '2026-09-29T12:00:00Z',
    updatedAt: '2026-10-02T12:00:00Z',
  });
  const current = attempt({ id: '2', verdict: 'fail', createdAt: '2026-10-01T12:00:00Z' });
  for (const recentAttempts of [
    [old, current],
    [current, old],
  ])
    assert.equal(recommend(context({ recentAttempts })).mode, 'repair');
});

test('path normalization handles invalid steps, duplicate ids and unsupported path versions', () => {
  const steps = [
    null,
    { id: 'a', title: '读正文', tool: 'content', minutes: Infinity, done: true },
    { id: 'a', title: '重复', tool: 'content' },
    { id: 'b', title: '不可执行', tool: 'unknown' },
    { id: 'c', title: '交流', tool: 'discussion', minutes: -8 },
  ];
  assert.deepEqual(
    normalizePath(steps).map((step) => step.id),
    ['a', 'c'],
  );
  assert.equal(normalizePath(steps)[0].completed, true);
  assert.equal(normalizePath(steps)[1].minutes, 1);
  assert.equal(
    normalizePath([{ id: 'x', title: '阅读', tool: 'content', completed: false, done: true }])[0]
      .completed,
    false,
  );
  assert.equal(
    normalizePath([{ id: 'x', title: '阅读', tool: 'content', minutes: Symbol('bad') }])[0].minutes,
    5,
  );
  assert.deepEqual(normalizePath({ version: 99, steps }), []);
});

test('reorder and toggle helpers are immutable and enforce completed/skip exclusivity', () => {
  const steps = normalizePath([
    { id: 'a', title: '阅读', tool: 'content' },
    { id: 'b', title: '复盘', tool: 'feedback' },
  ]);
  const snapshot = JSON.stringify(steps);
  assert.deepEqual(
    reorderStep(steps, 'b', -1).map((step) => step.id),
    ['b', 'a'],
  );
  assert.deepEqual(reorderStep(steps, 'a', -1), steps);
  assert.deepEqual(reorderStep(steps, 'missing', 1), steps);
  assert.deepEqual(reorderStep(steps, 'a', Infinity), steps);
  const skipped = toggleStep(steps, 'a', 'skipped');
  assert.equal(skipped[0].skipped, true);
  const completed = toggleStep(skipped, 'a');
  assert.equal(completed[0].completed, true);
  assert.equal(completed[0].skipped, false);
  assert.equal(toggleStep(completed, 'a', 'skipped')[0].completed, false);
  assert.equal(JSON.stringify(steps), snapshot);
});

test('private notes, reflections and chat contents are neither read nor returned', () => {
  const input = context();
  for (const name of ['personalNotes', 'reflections', 'history', 'chat']) {
    Object.defineProperty(input, name, {
      get() {
        throw new Error('private input was accessed');
      },
    });
  }
  assert.doesNotThrow(() => recommend(input));
  assert.doesNotMatch(JSON.stringify(recommend(input)), /personalNotes|reflections|history|chat/);
});

test('the standalone browser export does not depend on DOM, storage or a chat client', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/learning-next-steps.js'), 'utf8');
  const sandbox = {};
  vm.runInNewContext(source, sandbox);
  assert.equal(typeof sandbox.FreeBbsLearningNextSteps.recommend, 'function');
  assert.equal(sandbox.FreeBbsLearningNextSteps.recommend({}).mode, 'start');
  assert.doesNotMatch(
    source,
    /fetch\(|localStorage|sessionStorage|document\.|sendMessage|requestAdvice/,
  );
});

test('all twelve familiarity and goal combinations produce the shared strategy without implying assessment success', () => {
  const { buildStrategy } = require('../public/learning-strategies');
  for (const level of ['new', 'familiar', 'basic', 'advanced']) {
    for (const goal of ['concepts', 'practice', 'explore']) {
      const learningStartPreference = { level, goal };
      const result = recommend(context({ learningStartPreference }));
      const strategy = buildStrategy(learningStartPreference, {
        nodeTitle: node.title,
        hasContent: true,
        hasQuestions: true,
        hasRelations: true,
        quizView: 'quick',
        questionId: question.id,
      });
      assert.equal(result.mode, 'strategy');
      assert.equal(result.strategy.key, `${level}:${goal}`);
      assert.deepEqual(result.steps, normalizePath(strategy.steps));
      assert.deepEqual(result.questions, strategy.questions);
      assert.equal(result.questions.length, 3);
      assert.ok(result.steps.every((step) => !step.point && !step.completed));
      assert.doesNotMatch(JSON.stringify(result), /已通过|授星|正式自测题均已通过/);
    }
  }
});

test('default goal follows self-described familiarity, while unknown preferences retain the previous recommendation', () => {
  for (const [level, goal] of Object.entries({
    new: 'concepts',
    familiar: 'concepts',
    basic: 'practice',
    advanced: 'explore',
  })) {
    assert.equal(
      recommend(context({ learningStartPreference: { level, goal: '' } })).strategy.goal,
      goal,
    );
  }
  const previousResult = recommend(context());
  for (const learningStartPreference of [
    undefined,
    null,
    {},
    { level: 'unknown', goal: 'practice' },
  ]) {
    assert.deepEqual(recommend(context({ learningStartPreference })), previousResult);
  }
});

test('formal failure and pending review override every self-described familiarity and goal', () => {
  for (const level of ['new', 'familiar', 'basic', 'advanced']) {
    for (const goal of ['concepts', 'practice', 'explore']) {
      const learningStartPreference = { level, goal };
      const failed = recommend(
        context({ learningStartPreference, recentAttempts: [attempt({ verdict: 'fail' })] }),
      );
      assert.equal(failed.mode, 'repair');
      assert.equal(failed.steps[0].tool, 'feedback');
      assert.equal(failed.steps[0].id, 'correct-attempt');
      const pending = recommend(
        context({
          learningStartPreference,
          status: 'completed',
          recentAttempts: [attempt({ status: 'pending_review', verdict: null })],
        }),
      );
      assert.notEqual(pending.mode, 'advance');
      assert.match(pending.reason, /待批阅/);
      assert.ok(pending.steps.every((step) => !step.point));
      assert.doesNotMatch(JSON.stringify(pending), /已通过|正式自测题均已通过/);
    }
  }
  const withoutPreference = recommend(
    context({
      status: 'completed',
      recentAttempts: [attempt({ status: 'pending_review', verdict: null })],
    }),
  );
  assert.notEqual(withoutPreference.mode, 'advance');
});

test('changing start preferences does not replace a saved path or its completion and skip choices', () => {
  const existingPath = [
    { id: 'notes', title: '我的总结', tool: 'notes', minutes: 3, completed: true },
    { id: 'read', title: '原来的阅读', tool: 'content', minutes: 8, skipped: true },
  ];
  const snapshot = JSON.stringify(existingPath);
  for (const level of ['new', 'familiar', 'basic', 'advanced']) {
    const result = recommend(
      context({ existingPath, learningStartPreference: { level, goal: 'explore' } }),
    );
    assert.equal(result.mode, 'resume');
    assert.deepEqual(result.steps, normalizePath(existingPath));
    assert.equal(result.strategy, undefined);
  }
  assert.equal(JSON.stringify(existingPath), snapshot);
});

test('strategy does not invent formal selftests or reading when the course provides neither', () => {
  const result = recommend({
    node: { title: '待补充知识点' },
    questions: [{ ...question, official: false }],
    learningStartPreference: { level: 'basic', goal: 'practice' },
  });
  assert.equal(result.mode, 'strategy');
  assert.ok(result.steps.every((step) => step.tool !== 'content' && step.tool !== 'feedback'));
});

test('presentation has one next step and at most two alternatives while preserving the complete chain', () => {
  const steps = Array.from({ length: 20 }, (_, index) => ({
    id: `s-${index}`,
    title: `步骤${index}`,
    tool: 'notes',
    minutes: 3,
    completed: index === 0,
    skipped: index === 1,
  }));
  const result = presentation(
    { steps },
    {
      alternatives: [
        { id: 'read', title: '查阅', tool: 'content', minutes: 4 },
        { id: 'test', title: '自测', tool: 'feedback', quizView: 'quick', minutes: 5 },
        { id: 'extra', title: '交流', tool: 'discussion', minutes: 3 },
      ],
    },
  );
  assert.equal(result.primary.id, 's-2');
  assert.equal(result.alternatives.length, 2);
  assert.equal(result.chain.length, 20);
  assert.deepEqual(
    result.chain.map((entry) => entry.id),
    steps.map((entry) => entry.id),
  );
  assert.equal(
    presentation({ steps: steps.map((entry) => ({ ...entry, completed: true })) }).primary,
    null,
  );
});

test('formal failure or pending review is prioritized but an explicit exploration choice never hides evidence', () => {
  for (const record of [
    attempt({ verdict: 'fail' }),
    attempt({ status: 'pending_review', verdict: null }),
  ]) {
    const input = context({
      recentAttempts: [record],
      learningStartPreference: { level: 'advanced', goal: 'practice' },
      hasOrigin: true,
    });
    const initial = recommend(input);
    assert.equal(initial.presentation.primary.tool, 'feedback');
    assert.ok(initial.presentation.alternatives.some((entry) => entry.goal === 'explore'));
    const chosen = recommend({ ...input, activeGoal: 'explore' });
    assert.notEqual(chosen.presentation.primary.tool, 'feedback');
    assert.deepEqual(chosen.evidence, initial.evidence);
    assert.notEqual(chosen.mode, 'advance');
    assert.doesNotMatch(chosen.reason, /已通过/);
  }
});

test('explicit exploration leaves a saved twenty-step chain and its completion marks untouched', () => {
  const existingPath = Array.from({ length: 20 }, (_, index) => ({
    id: `my-${index}`,
    title: `我的${index}`,
    tool: 'notes',
    minutes: 4,
    completed: index % 2 === 0,
  }));
  const result = recommend(
    context({
      existingPath,
      activeGoal: 'explore',
      learningStartPreference: { level: 'familiar', goal: 'concepts' },
      recentAttempts: [attempt({ verdict: 'fail' })],
    }),
  );
  assert.deepEqual(result.steps, normalizePath(existingPath));
  assert.equal(result.presentation.primary.view, 'relations');
  assert.equal(result.evidence.failed, true);
  assert.equal(result.presentation.chain.length, 20);
});

test('practice routes and real question anchors do not alter official evidence or the formal denominator', () => {
  const practiceQuestions = [
    { id: 'p1', official: false, assessmentRole: 'practice', difficulty: 'basic' },
  ];
  const result = recommend(
    context({
      practiceQuestions,
      learningStartPreference: { level: 'advanced', goal: 'practice' },
    }),
  );
  assert.equal(result.steps[0].quizView, 'practice');
  assert.equal(result.steps[0].questionId, 'p1');
  assert.equal(
    result.presentation.alternatives.find((entry) => entry.id === 'direct-selftest').quizView,
    'quick',
  );
  assert.equal(result.evidence.failed, false);
  assert.notEqual(result.mode, 'advance');
});

test('saved paths retain valid navigation anchors and discard unknown views or unsafe IDs', () => {
  const [safe, unsafe] = normalizePath([
    {
      id: 'safe',
      title: '定位题目',
      tool: 'feedback',
      quizView: 'quick',
      questionId: 'q-1',
      taskId: 'task:1',
      view: 'origin',
    },
    {
      id: 'unsafe',
      title: '无效锚点',
      tool: 'content',
      quizView: 'evil',
      questionId: '../secret',
      view: 'http://evil',
    },
  ]);
  assert.equal(safe.questionId, 'q-1');
  assert.equal(safe.taskId, 'task:1');
  assert.equal(safe.quizView, 'quick');
  assert.equal(safe.view, 'origin');
  assert.equal(unsafe.questionId, undefined);
  assert.equal(unsafe.quizView, undefined);
  assert.equal(unsafe.view, undefined);
});

test('real suggested tasks consider estimated difficulty without inserting exploration into ordinary practice or shrinking selftests', () => {
  const questions = [
    { ...question, id: 'formal-standard', difficulty: 'standard' },
    { ...question, id: 'formal-challenge', difficulty: 'challenge' },
  ];
  const practiceQuestions = [
    {
      id: 'explore-first',
      official: false,
      assessmentRole: 'exploration',
      difficulty: 'challenge',
    },
    { id: 'practice-basic', official: false, assessmentRole: 'practice', difficulty: 'basic' },
  ];
  for (const [level, id, quizView] of [
    ['new', 'practice-basic', 'practice'],
    ['familiar', 'practice-basic', 'practice'],
    ['basic', 'formal-standard', 'quick'],
    ['advanced', 'formal-challenge', 'quick'],
  ]) {
    const result = recommend(
      context({
        questions,
        practiceQuestions,
        learningStartPreference: { level, goal: 'practice' },
      }),
    );
    const task = result.steps.find((step) => step.tool === 'feedback');
    assert.equal(task.questionId, id);
    assert.equal(task.quizView, quizView);
    assert.equal(
      result.presentation.alternatives.find((step) => step.id === 'direct-selftest').quizView,
      'quick',
    );
  }
  const fallback = recommend(
    context({
      questions: [],
      practiceQuestions: [practiceQuestions[1]],
      learningStartPreference: { level: 'advanced', goal: 'practice' },
    }),
  );
  assert.equal(fallback.steps[0].questionId, 'practice-basic');
  assert.doesNotMatch(fallback.steps[0].title, /挑战|高阶|等价/);
});
