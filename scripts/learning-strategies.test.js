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
  buildIntentStrategy,
} = require('../public/learning-strategies');
const policy = require('../public/learning-policy');
const { validateEntry } = require('../backend/learning-workspace');

test('four self-described starting points and four intentions share sixteen repeatable modular suggestions', () => {
  assert.deepEqual(Object.values(LEVELS), ['第一次学', '不甚熟悉', '能独立做题', '完整掌握']);
  assert.deepEqual(Object.values(GOALS), ['理解知识', '练习解题', '复习知识', '探索研究']);
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
      const purpose = goal === 'concepts' ? 'learn' : goal;
      assert.deepEqual(
        plan.modules.map((entry) => entry.moduleId),
        policy.CHAINS[`${purpose}:${level}`],
      );
      assert.equal(plan.policyVersion, policy.POLICY_VERSION);
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
  assert.equal(labels.size, 16);
  assert.equal(hints.size, 16);
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
    normalizePreference({ level: 'familiar', goal: 'unknown-goal', privateNotes: 'SECRET' }),
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
  assert.equal(
    question.steps[0].quizView,
    'practice',
    'A suggestion is never formal submission consent',
  );
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
  assert.match(uncertain.steps[0].description, /一个关键概念/);
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
      const reflection = origin.modules.find((entry) => entry.moduleId === 'reflect');
      if (reflection) {
        const action = origin.steps.find((step) => step.id === reflection.stepId);
        assert.equal(reflection.available, true);
        assert.equal(action.tool, 'content');
        assert.equal(action.view, 'origin');
        assert.equal(action.taskId, 'annotate-origin', `${level}:${goal}`);
        assert.match(action.description, /在知识起源中选中一处相关原文/);
      }
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
    fs.readFileSync(path.join(__dirname, '../public/learning-policy.js'), 'utf8'),
    { window: browser },
  );
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../public/learning-strategies.js'), 'utf8'),
    { window: browser },
  );
  assert.equal(typeof browser.FreeBbsLearningStrategies.buildStrategy, 'function');
  assert.equal(browser.FreeBbsLearningStrategies.buildStrategy(preference).goal, 'practice');
});

test('old intent IDs are retained and an unknown starting point is never silently a novice', () => {
  for (const goal of ['concepts', 'practice', 'explore', 'review']) {
    assert.equal(normalizePreference({ level: 'familiar', goal }).goal, goal);
    const plan = buildIntentStrategy(goal, { hasContent: true });
    assert.equal(plan.goal, goal);
    assert.equal(plan.level, '');
    assert.equal(plan.key, `unspecified:${goal}`);
    assert.match(plan.hint, /^学习起点未设置/);
    assert.doesNotMatch(plan.hint, /学生自述|第一次学|实验|16 类/);
  }
  assert.equal(buildIntentStrategy('unknown'), null);
});

test('review keeps three core modules, conditional repair and an optional stopping-friendly revisit', () => {
  for (const level of Object.keys(LEVELS)) {
    const plan = buildStrategy({ level, goal: 'review' }, { hasContent: true });
    assert.equal(plan.coreStepCount, 3);
    assert.equal(plan.modules[0].moduleId, 'retrieve');
    const repair = plan.modules.find((entry) => entry.moduleId === 'repair');
    assert.equal(repair.conditional, true);
    assert.equal(repair.optional, true);
    const repairStep = plan.steps.find((entry) => entry.id === repair.stepId);
    assert.match(repairStep.description, /只有.*发现缺口/);
    assert.match(repairStep.description, /顺利时可跳过/);
    assert.ok(plan.modules.filter((entry, index) => index >= 3).every((entry) => entry.optional));
    const revisit = plan.steps.find(
      (entry) => entry.id === plan.modules.find((item) => item.moduleId === 'revisit').stepId,
    );
    assert.match(revisit.title, /可以结束/);
    assert.doesNotMatch(JSON.stringify(plan.steps), /实验|原型|16 类|第.*类人/);
  }
});

test('exploration exposes question-first suggestions and optional, conditionally-needed lookup metadata', () => {
  for (const level of Object.keys(LEVELS)) {
    const plan = buildStrategy(
      { level, goal: 'explore' },
      {
        hasContent: true,
        hasRelations: true,
        hasOrigin: true,
        hasOverview: true,
      },
    );
    assert.equal(plan.modules[0].moduleId, 'explore');
    assert.equal(plan.steps[0].view, 'relations');
    assert.ok(plan.modules.slice(1).every((entry) => entry.optional));
    assert.ok(plan.modules.every((entry) => typeof entry.available === 'boolean'));
    const read = plan.modules.find((entry) => entry.moduleId === 'read');
    if (read) assert.equal(read.conditional, true);
  }
});

test('policy modules do not change the persisted path contract or fake available overview material', () => {
  for (const level of Object.keys(LEVELS))
    for (const goal of Object.keys(GOALS)) {
      const plan = buildStrategy(
        { level, goal },
        {
          hasContent: true,
          hasQuestions: true,
          questions: [{ id: 'real-q', assessmentRole: 'practice', difficulty: 'basic' }],
        },
      );
      assert.deepEqual(
        validateEntry({ kind: 'path', title: '我的学习路径', content: '', path: plan.steps }).path,
        plan.steps,
      );
      assert.equal(
        plan.steps.some((entry) => entry.taskId === 'view-overview'),
        false,
      );
    }
  assert.equal(
    buildStrategy({ level: 'new', goal: 'concepts' }, { hasOverview: true }).steps[0].taskId,
    'view-overview',
  );
});

test('the title carries the choice once while the reason offers an actionable next step', () => {
  for (const level of Object.keys(LEVELS))
    for (const goal of Object.keys(GOALS)) {
      const plan = buildStrategy({ level, goal }, { hasContent: true });
      assert.equal(plan.label, `${GOALS[goal]} · ${LEVELS[level]}`);
      assert.equal(plan.reason.includes(GOALS[goal]), false);
      assert.equal(plan.reason.includes(LEVELS[level]), false);
      assert.match(plan.reason, /先|从/);
    }
});
