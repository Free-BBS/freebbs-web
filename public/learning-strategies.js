/* Self-described preferences change optional support, never grades or measured mastery. */
(function exposeLearningStrategies(root) {
  const LEVELS = Object.freeze({
    new: '第一次学',
    familiar: '不甚熟悉',
    basic: '能独立做题',
    advanced: '完整掌握',
  });
  // Keep persisted IDs: practice means practice, not review.
  const GOALS = Object.freeze({
    concepts: '理解知识',
    practice: '练习解题',
    review: '复习知识',
    explore: '探索研究',
  });
  const RECOMMENDED = Object.freeze({
    new: 'concepts',
    familiar: 'concepts',
    basic: 'practice',
    advanced: 'explore',
  });
  const GUIDANCE = Object.freeze({
    concepts: '先理顺一个概念，再按需尝试；不必一次读完。',
    practice: '先独立尝试，再核对卡点；需要时再补提示。',
    review: '先回忆或试一道，只补缺口；顺利就可以结束。',
    explore: '从一个问题出发，核对联系与边界，再决定怎样检验。',
  });
  const MINUTES = Object.freeze({
    overview: 3,
    origin: 5,
    read: 8,
    'worked-example': 6,
    retrieve: 3,
    practice: 6,
    repair: 4,
    transfer: 6,
    explore: 8,
    reflect: 3,
    revisit: 2,
  });
  const GENERIC_CHAINS = Object.freeze({
    concepts: ['read', 'practice', 'reflect'],
    practice: ['practice', 'repair', 'reflect'],
    review: ['retrieve', 'repair', 'practice', 'revisit'],
    explore: ['explore', 'transfer', 'reflect'],
  });
  const object = (value) =>
    value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const safeId = (value) =>
    typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,120}$/.test(value) ? value : '';
  const policyApi = () =>
    root.FreeBbsLearningPolicy ||
    (typeof module !== 'undefined' && module.exports ? require('./learning-policy') : null);
  function normalizePreference(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (typeof value.level !== 'string' || !Object.hasOwn(LEVELS, value.level)) return null;
    const goal =
      typeof value.goal === 'string' && Object.hasOwn(GOALS, value.goal) ? value.goal : '';
    return { level: value.level, goal };
  }
  function recommendedGoal(level) {
    return typeof level === 'string' && Object.hasOwn(RECOMMENDED, level)
      ? RECOMMENDED[level]
      : null;
  }
  function buildPlan(selected, context, purposeOnly = false) {
    const policy = policyApi();
    if (!policy) return null;
    const options = object(context);
    const hasContent = options.hasContent === undefined ? true : options.hasContent === true;
    const hasOrigin = options.hasOrigin === true;
    const hasRelations = options.hasRelations === true;
    const purpose = selected.goal === 'concepts' ? 'learn' : selected.goal;
    const questions = Array.isArray(options.questions)
      ? options.questions
      : options.hasQuestions === true && safeId(options.questionId)
        ? [{ id: options.questionId, official: false, assessmentRole: 'practice' }]
        : [];
    const capabilities = {
      hasContent,
      hasOrigin,
      hasRelations,
      questions,
      hasWorkedExample: options.hasWorkedExample === true,
      hasQuestions: options.hasQuestions === true,
      documentVersion: options.documentVersion,
      trustedEvidence: options.trustedEvidence,
    };
    const normalizedQuestions = policy.normalizeQuestions(questions);
    const evidence = policy.currentEvidence(
      options.trustedEvidence,
      normalizedQuestions,
      options.documentVersion,
    );
    const plan = purposeOnly
      ? {
          policyVersion: policy.POLICY_VERSION,
          strategyId: `${purpose}:unspecified`,
          coreStepCount: 3,
          support: '熟悉程度尚未设置，不推断掌握程度；先回应这次目的，按需要提供解释或提示。',
          steps: GENERIC_CHAINS[selected.goal].map((moduleId) => ({
            moduleId,
            ...policy.MODULES[moduleId],
            prompt: policy.MODULES[moduleId].question,
            question: ['practice', 'transfer', 'repair'].includes(moduleId)
              ? policy.selectQuestion(normalizedQuestions, purpose, evidence, moduleId)
              : null,
            optional:
              purpose === 'review'
                ? moduleId !== 'retrieve'
                : purpose === 'explore'
                  ? moduleId !== 'explore'
                  : ['reflect', 'revisit'].includes(moduleId),
            conditional:
              (purpose === 'review' && moduleId === 'repair') ||
              (purpose === 'practice' && moduleId === 'repair'),
            available:
              moduleId === 'read'
                ? hasContent
                : moduleId === 'practice'
                  ? normalizedQuestions.some((question) => question.role !== 'exploration')
                  : moduleId === 'reflect'
                    ? hasContent || hasOrigin
                    : true,
          })),
        }
      : policy.buildPolicy({ purpose, level: selected.level }, capabilities);
    if (!plan) return null;
    const key = `${purposeOnly ? 'unspecified' : selected.level}:${selected.goal}`;
    const modules = [];
    const help = (minutes) => ({
      title: '带着一个问题求助',
      description: '当前对应材料尚未提供。可向 Max 说明想查清什么，或先暂停；不会自动发送问题。',
      tool: 'discussion',
      taskId: 'ask-max',
      minutes,
    });
    const steps = plan.steps.map((entry, index) => {
      const minutes = MINUTES[entry.moduleId] || 5;
      let action = {
        title: entry.title,
        description: [entry.action, entry.note].filter(Boolean).join(' '),
        tool: entry.tool,
        minutes,
      };
      if (entry.moduleId === 'overview') {
        if (options.hasOverview === true) action.taskId = 'view-overview';
        else {
          action.title = '先看已有材料的问题背景';
          action.description = '先确认这次想弄清的一件事，再按需要看正文；不必一次读完。';
        }
      } else if (entry.view === 'origin' && hasOrigin) action.view = 'origin';
      else if (entry.view === 'relations' && hasRelations) action.view = 'relations';
      if (entry.moduleId === 'repair' && purpose === 'review') {
        action.title = '有缺口再定点查漏';
        action.description =
          '只有回忆或尝试发现缺口时，才回看相关条件、解释或一步示范；顺利时可跳过，不需重读全文。';
      }
      if (entry.moduleId === 'revisit') {
        action.title = '可以结束，改天再复查';
        action.description =
          '这次已解释清楚或能独立做出来，就可以先结束；需要时自行选时间回忆或复查，不要求设置提醒。';
      }
      if (['practice', 'transfer'].includes(entry.moduleId)) {
        if (entry.question && safeId(entry.question.id)) {
          action.tool = 'feedback';
          action.quizView = 'practice';
          action.questionId = entry.question.id;
        } else {
          action.tool = 'content';
          action.title = entry.moduleId === 'practice' ? '先说明解题思路' : '提出一个待检验的变式';
          action.description =
            entry.moduleId === 'practice'
              ? '当前没有可确认的相关题目。可先说明条件与拟用方法，或主动求助；不生成假题或假评分。'
              : '当前没有可确认的探索题。这里只提出变式问题、核对条件，不视为完成正式测验。';
        }
      }
      if (action.tool === 'notes') {
        action.description = `选中一处相关原文，点击“批注”。${action.description}`;
        if (!hasContent && hasOrigin) {
          action.tool = 'content';
          action.view = 'origin';
          action.taskId = 'annotate-origin';
          action.description = `在知识起源中${action.description}`;
        } else if (!hasContent) action = help(minutes);
      }
      if (
        action.tool === 'content' &&
        !action.view &&
        action.taskId !== 'view-overview' &&
        !hasContent
      ) {
        if (hasOrigin) {
          action.view = 'origin';
          action.description = `正文尚未提供，可先查阅已有知识起源。${action.description}`;
        } else {
          const available = normalizedQuestions.find((question) => question.role !== 'exploration');
          if (available && safeId(available.id))
            action = {
              title: '先看一道已有题',
              description: '正文尚未提供，可先尝试已有题目，看看想核对哪一步；也可求助或暂停。',
              tool: 'feedback',
              quizView: 'practice',
              questionId: available.id,
              minutes,
            };
          else action = help(minutes);
        }
      }
      const result = {
        id: `${key}:${index + 1}`,
        title: action.title,
        description: action.description.slice(0, 600),
        tool: action.tool,
        minutes: action.minutes,
        completed: false,
        skipped: false,
        ...(action.view ? { view: action.view } : {}),
        ...(action.taskId ? { taskId: action.taskId } : {}),
        ...(action.quizView ? { quizView: action.quizView } : {}),
        ...(action.questionId ? { questionId: action.questionId } : {}),
      };
      modules.push({
        stepId: result.id,
        moduleId: entry.moduleId,
        optional: entry.optional === true,
        conditional: entry.conditional === true,
        available: entry.available !== false,
        ...(entry.question ? { questionBasis: entry.question.basis } : {}),
      });
      return result;
    });
    const nodeTitle =
      typeof options.nodeTitle === 'string'
        ? Array.from(options.nodeTitle, (character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? ' ' : character,
          )
            .join('')
            .trim()
            .slice(0, 80)
        : '';
    const node = nodeTitle ? `「${nodeTitle}」` : '这个知识点';
    const prompts = [
      ...new Set(
        plan.steps.map((entry) => entry.prompt || policy.MODULES[entry.moduleId].question),
      ),
    ]
      .slice(0, 3)
      .map((prompt) => `围绕${node}：${prompt}`);
    const reason = `${purposeOnly ? '起点未设置，可按需选择解释或提示。' : ''}${GUIDANCE[selected.goal]}${
      !purposeOnly && !selected.explicitGoal ? '也可更改。' : ''
    }`;
    const label = purposeOnly
      ? GOALS[selected.goal]
      : `${GOALS[selected.goal]} · ${LEVELS[selected.level]}`;
    const startHint = purposeOnly
      ? '学习起点未设置；不推断熟悉程度。'
      : `学习起点为学生自述“${LEVELS[selected.level]}”，非测评结论，不代表本知识点能力。`;
    const goalHint =
      selected.explicitGoal || purposeOnly ? '本次所选' : '尚未选目标，建议但不强制的';
    const hint = [
      `${startHint}${goalHint}目标是“${GOALS[selected.goal]}”。`,
      plan.support,
      `建议按“${steps.map((action) => action.title).join(' → ')}”；用户可自由跳步、换目标或结束。`,
      `可用以下反思问题引导：${prompts.join(' ')}`,
      '这些反思问题不是正式自测题，不作判分；熟悉程度只调整初始支架，不等于题目难度；不限制资料或判定星级，不替代正式错题和待复核记录。',
      'Max 应引导思考，不代做，不自动发问或替学生决定路径。求助、跳过或暂停不表示失败，也不自动标记完成。',
    ].join('');
    return {
      key,
      level: purposeOnly ? '' : selected.level,
      goal: selected.goal,
      recommendedGoal: purposeOnly ? null : recommendedGoal(selected.level),
      label,
      reason,
      steps,
      questions: prompts,
      hint,
      policyVersion: plan.policyVersion,
      strategyId: plan.strategyId,
      coreStepCount: plan.coreStepCount,
      modules,
    };
  }
  function buildStrategy(value, context = {}) {
    const selected = normalizePreference(value);
    if (!selected) return null;
    return buildPlan(
      {
        ...selected,
        explicitGoal: Boolean(selected.goal),
        goal: selected.goal || recommendedGoal(selected.level),
      },
      context,
    );
  }
  function buildIntentStrategy(goal, context = {}) {
    return typeof goal === 'string' && Object.hasOwn(GOALS, goal)
      ? buildPlan({ goal, explicitGoal: true }, context, true)
      : null;
  }
  const api = {
    LEVELS,
    GOALS,
    normalizePreference,
    recommendedGoal,
    buildStrategy,
    buildIntentStrategy,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, { FreeBbsLearningStrategies: api });
})(typeof window !== 'undefined' ? window : globalThis);
