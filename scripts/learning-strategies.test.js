const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  LEVELS,
  GOALS,
  normalizePreference,
  recommendedGoal,
  buildStrategy,
} = require('../public/learning-strategies');
const { validateEntry } = require('../backend/learning-workspace');

test('four self-described starting points and three intentions define twelve repeatable suggestions', () => {
  assert.deepEqual(Object.values(LEVELS), ['第一次学', '不甚熟悉', '能独立做题', '完整掌握']);
  assert.deepEqual(Object.values(GOALS), ['理解知识', '练习解题', '探索研究']);
  const labels = new Set();
  const hints = new Set();
  for (const level of Object.keys(LEVELS))
    for (const goal of Object.keys(GOALS)) {
      const preference = { level, goal };
      const options = {
        nodeTitle: '卷积',
        hasContent: true,
        hasQuestions: true,
        hasOrigin: true,
        hasRelations: true,
      };
      const plan = buildStrategy(preference, options);
      assert.equal(plan.key, `${level}:${goal}`);
      assert.equal(plan.steps.length, 3);
      assert.equal(plan.questions.length, 3);
      assert.ok(plan.steps.every((step) => !step.completed && !step.skipped && step.minutes > 0));
      assert.ok(plan.questions.some((question) => question.includes('「卷积」')));
      assert.ok(plan.questions.every((question) => !question.includes('{node}')));
      assert.deepEqual(plan, buildStrategy(preference, options));
      assert.match(plan.hint, /非测评结论/);
      assert.match(plan.hint, /不等于题目难度/);
      assert.match(plan.hint, /不限制资料或判定星级/);
      assert.match(plan.hint, /Max 应引导思考，不代做/);
      assert.doesNotMatch(plan.hint, /已通过|授星|高能力|低能力/);
      labels.add(plan.label);
      hints.add(plan.hint);
    }
  assert.equal(labels.size, 12);
  assert.equal(hints.size, 12);
});

test('the suggested intention is a fallback, never a replacement for an explicit intention', () => {
  for (const [level, goal] of Object.entries({
    new: 'concepts',
    familiar: 'concepts',
    basic: 'practice',
    advanced: 'explore',
  })) {
    assert.equal(recommendedGoal(level), goal);
    assert.equal(buildStrategy({ level, goal: '' }).goal, goal);
    assert.match(buildStrategy({ level }).reason, /也可更改/);
    for (const selected of Object.keys(GOALS))
      assert.equal(buildStrategy({ level, goal: selected }).goal, selected);
  }
});

test('invalid or legacy goals are not learner categories or new mastery claims', () => {
  for (const value of [null, false, [], {}, { level: 'expert' }])
    assert.equal(normalizePreference(value), null);
  assert.deepEqual(
    normalizePreference({ level: 'familiar', goal: 'review', privateNotes: 'SECRET' }),
    { level: 'familiar', goal: '' },
  );
  assert.equal(recommendedGoal('expert'), null);
  assert.equal(buildStrategy({ level: 'expert', goal: 'practice' }), null);
  assert.doesNotMatch(
    JSON.stringify(buildStrategy({ level: 'new', goal: 'practice', prompt: 'SECRET' })),
    /SECRET/,
  );
});

test('no existing questions or text means no invented selftest, reading, relation or origin entry', () => {
  for (const level of Object.keys(LEVELS))
    for (const goal of Object.keys(GOALS)) {
      const plan = buildStrategy(
        { level, goal },
        { hasContent: false, hasQuestions: false, hasOrigin: false, hasRelations: false },
      );
      assert.ok(plan.steps.every((step) => ['notes', 'discussion'].includes(step.tool)));
      assert.ok(plan.steps.every((step) => !step.view && !step.questionId && !step.quizView));
      assert.doesNotMatch(JSON.stringify(plan.steps), /完成已有|阅读正文|通过正式/);
    }
});

test('origin and relations are real optional routes, independent of a missing body', () => {
  const origin = buildStrategy(
    { level: 'new', goal: 'explore' },
    { hasContent: false, hasOrigin: true },
  );
  assert.equal(origin.steps[0].view, 'origin');
  const relations = buildStrategy(
    { level: 'advanced', goal: 'explore' },
    { hasContent: false, hasRelations: true },
  );
  assert.equal(relations.steps[0].view, 'relations');
  const question = buildStrategy(
    { level: 'basic', goal: 'practice' },
    { hasQuestions: true, questionId: 'q-basic', quizView: 'quick' },
  );
  assert.equal(question.steps[0].questionId, 'q-basic');
  assert.equal(question.steps[0].quizView, 'quick');
  assert.equal(
    buildStrategy(
      { level: 'basic', goal: 'practice' },
      { hasQuestions: true, questionId: '../unsafe' },
    ).steps[0].questionId,
    undefined,
  );
});

test('annotation suggestions name a real selected-passage action instead of an absent notebook', () => {
  for (const level of Object.keys(LEVELS))
    for (const goal of Object.keys(GOALS)) {
      const plan = buildStrategy({ level, goal }, { hasContent: true, hasQuestions: false });
      for (const action of plan.steps.filter((entry) => entry.tool === 'notes')) {
        assert.match(action.description, /选中/);
        assert.match(action.description, /批注|高亮/);
      }
      assert.match(plan.hint, /求助、跳过或暂停不表示失败/);
    }
  const uncertain = buildStrategy({ level: 'familiar', goal: 'concepts' });
  assert.match(uncertain.steps[0].description, /一处/);
  assert.doesNotMatch(uncertain.steps[0].description, /先写能解释和不能解释/);
});

test('missing annotation material opens optional help, or real origin text, never an empty notes tool', () => {
  for (const level of Object.keys(LEVELS))
    for (const goal of Object.keys(GOALS)) {
      const missing = buildStrategy({ level, goal }, { hasContent: false, hasQuestions: false });
      assert.equal(
        missing.steps.some((action) => action.tool === 'notes'),
        false,
      );
      assert.ok(missing.steps.some((action) => action.taskId === 'ask-max'));
      for (const action of missing.steps.filter((entry) => entry.taskId === 'ask-max'))
        assert.equal(
          action.tool,
          'discussion',
          'Uses an existing persisted tool, not a new grading mode',
        );
      const origin = buildStrategy({ level, goal }, { hasContent: false, hasOrigin: true });
      assert.equal(
        origin.steps.some((action) => action.tool === 'notes'),
        false,
      );
      for (const action of origin.steps.filter((entry) => entry.description.includes('批注')))
        assert.equal(action.view, 'origin');
    }
});

test('all help and origin-only paths round-trip the existing server contract without new metadata types', () => {
  for (const level of Object.keys(LEVELS))
    for (const goal of Object.keys(GOALS))
      for (const options of [
        { hasContent: false, hasQuestions: false },
        { hasContent: false, hasOrigin: true },
      ]) {
        const plan = buildStrategy({ level, goal }, options);
        const entry = validateEntry({
          kind: 'path',
          title: '我的学习路径',
          content: '自己选的步骤',
          path: plan.steps,
        });
        assert.deepEqual(entry.path, plan.steps);
      }
});

test('the model is pure and exports in a browser without network, storage or DOM', () => {
  const preference = { level: 'advanced', goal: 'practice' };
  const options = { nodeTitle: '卷积', hasContent: true, hasQuestions: true };
  const before = JSON.stringify([preference, options]);
  buildStrategy(preference, options);
  assert.equal(JSON.stringify([preference, options]), before);
  const browser = {};
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../public/learning-strategies.js'), 'utf8'),
    { window: browser },
  );
  assert.equal(typeof browser.FreeBbsLearningStrategies.buildStrategy, 'function');
  assert.equal(browser.FreeBbsLearningStrategies.buildStrategy(preference).goal, 'practice');
});
