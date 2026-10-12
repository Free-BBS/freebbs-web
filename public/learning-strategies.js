/* Self-described learning preferences offer suggestions, not measured mastery. */
(function exposeLearningStrategies(root) {
  const LEVELS = Object.freeze({
    new: '第一次学',
    familiar: '不甚熟悉',
    basic: '能独立做题',
    advanced: '完整掌握',
  });
  const GOALS = Object.freeze({
    concepts: '理解知识',
    practice: '练习解题',
    explore: '探索研究',
  });
  const RECOMMENDED = Object.freeze({
    new: 'concepts',
    familiar: 'concepts',
    basic: 'practice',
    advanced: 'explore',
  });
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
  const step = (title, description, tool, minutes, withoutQuestions) => ({
    title,
    description,
    tool,
    minutes,
    ...(withoutQuestions ? { withoutQuestions } : {}),
  });
  const check = (title, description, minutes, fallbackTitle, fallbackDescription) =>
    step(title, description, 'feedback', minutes, {
      title: fallbackTitle,
      description: fallbackDescription,
      tool: 'notes',
      minutes,
    });
  const PLANS = {
    'new:concepts': {
      label: '从直觉建立概念',
      steps: [
        step('用例子建立直觉', '先找一个直观情境，再核对定义中的必要术语。', 'content', 8),
        step('换一种说法', '用自己的话解释核心含义，记录一个还不清楚的地方。', 'notes', 4),
        check(
          '用已有题目核对概念',
          '选择与当前概念相关的已有题目，核对条件和解释。',
          5,
          '用自己的解释核对概念',
          '写出一个例子和适用条件，标记仍需核对的说法。',
        ),
      ],
      questions: [
        '我能用什么熟悉的例子解释{node}？',
        '{node}中哪一个术语还需要说明？',
        '如果条件改变，{node}的说法还成立吗？',
      ],
    },
    'new:practice': {
      label: '先示范，再尝试',
      steps: [
        step('看懂一种基本做法', '对照正文里的说明，列出解题时先确认的条件与步骤。', 'content', 8),
        check(
          '尝试已有题目',
          '先独立尝试，卡住时写下已做到哪一步，再看作答反馈。',
          8,
          '写一遍解题思路',
          '当前没有相关题目时，先写条件、拟用方法和需要说明的步骤。',
        ),
        step('记录第一轮解题步骤', '区分自己能解释的步骤与仍需要示范的步骤。', 'notes', 5),
      ],
      questions: [
        '做与{node}有关的题时，第一步要确认什么？',
        '我能解释示范中的每一步为什么成立吗？',
        '独立尝试时，我卡住的最小一步是什么？',
      ],
    },
    'new:explore': {
      label: '找入口，再问为什么',
      steps: [
        step('看看知识为何被引入', '从知识起源找到问题背景，再核对必要术语。', 'origin', 8),
        step('提出一个为什么', '写下这个知识点为何被引入，以及自己想追问的原因。', 'notes', 5),
        step(
          '带着一个问题交流',
          '把已理解的部分和具体疑问整理成一个可讨论的问题。',
          'discussion',
          6,
        ),
      ],
      questions: [
        '为什么课程需要引入{node}？',
        '{node}可能解决什么我关心的问题？',
        '继续探究前，我需要补哪一个前提？',
      ],
    },
    'familiar:concepts': {
      label: '把模糊处解释清楚',
      steps: [
        step('圈出不确定之处', '先写能解释和不能解释的部分，避免把见过当作理解。', 'notes', 4),
        step('回看关键条件', '只核对模糊的定义、条件和结论之间的区别。', 'content', 7),
        check(
          '用已有题目核对疑点',
          '选择相关已有题目，对照依据检查先前不确定的说法。',
          5,
          '对照两个说法',
          '用自己的解释区分一个易混淆的概念或条件，并记下待核对处。',
        ),
      ],
      questions: [
        '我对{node}的哪一部分不能稳定解释？',
        '我是否混淆了定义、条件和结论？',
        '哪个例子能帮助区分这些概念？',
      ],
    },
    'familiar:practice': {
      label: '定位卡点，再独立尝试',
      steps: [
        step('对照一种解题思路', '针对自己卡住的步骤核对正文说明，不重抄整份解法。', 'content', 6),
        check(
          '尝试已有题目并订正',
          '先写思路，再结合已有题目反馈定位错误或遗漏。',
          8,
          '解释一处解题卡点',
          '写清已经尝试的步骤、卡点和还需要核对的条件。',
        ),
        step('写清最薄弱的一步', '把订正理由写成能独立复述的一句话，而不只记答案。', 'notes', 4),
      ],
      questions: [
        '我对{node}的做题思路卡在哪一步？',
        '错因更接近概念不清、条件漏看，还是计算问题？',
        '订正以后，我能不看提示重新说明解法吗？',
      ],
    },
    'familiar:explore': {
      label: '核对前提，再建立联系',
      steps: [
        step('查看已有知识联系', '选择一条实际存在的关系，分清前提与可能的类比。', 'relations', 6),
        step(
          '整理一个可能的联系',
          '写出想到的知识联系；没有具体联系时，记录想了解的方向。',
          'notes',
          6,
        ),
        step(
          '请同学检视一个猜想',
          '说明猜想依赖的前提和已有依据，不把猜想当成结论。',
          'discussion',
          6,
        ),
      ],
      questions: [
        '关于{node}，我的猜想依赖哪些前提？',
        '哪一条知识联系需要证据，而不只是直觉？',
        '我想请同学检视的具体问题是什么？',
      ],
    },
    'basic:concepts': {
      label: '从会用走向能解释',
      steps: [
        step('先写自己的解释', '不用套话说明核心概念，并指出它与解题方法的关系。', 'notes', 4),
        step('查验条件与例外', '用正文核对哪些条件必要、哪些只是常见情境。', 'content', 5),
        step(
          '对照一条知识联系',
          '检查两个知识点联系的依据，不把会做题等同于概念完备。',
          'relations',
          4,
        ),
      ],
      questions: [
        '我能不用套话清楚解释{node}吗？',
        '哪些条件是必要的，哪些只是常见情境？',
        '我如何区分“会做题”与“理解为什么”？',
      ],
    },
    'basic:practice': {
      label: '独立作答，检查依据',
      steps: [
        check(
          '独立尝试已有题目',
          '尽量不看提示先完成相关已有题目，保留自己的关键步骤。',
          8,
          '写独立检查框架',
          '当前没有相关题目时，列出要确认的条件、拟用方法和结果检查步骤。',
        ),
        step('检查假设与关键步骤', '指出每一步用了什么条件，找出可能遗漏的论证。', 'notes', 5),
        step(
          '核对最薄弱的一步',
          '只针对不够可靠的一步回看正文说明，再修正自己的解释。',
          'content',
          5,
        ),
      ],
      questions: [
        '在与{node}有关的任务中，我为何选择这种方法？',
        '是否有遗漏的假设或未经说明的步骤？',
        '另一种解法会在哪一步更有效？',
      ],
    },
    'basic:explore': {
      label: '提出联系，设计检验',
      steps: [
        step('查看可延伸的联系', '从已有关系选择一个新情境，核对共同条件与差别。', 'relations', 5),
        step('核对推导与边界', '用正文检查探索时用到的前提，避免超出适用条件。', 'content', 6),
        step('讨论一个变式思路', '说明改变一个条件后的想法，与同学讨论检验方法。', 'discussion', 6),
      ],
      questions: [
        '{node}与另一个知识点之间的联系是什么？',
        '改变一个条件后，原方法还能怎样使用？',
        '我准备怎样检验这条联系？',
      ],
    },
    'advanced:concepts': {
      label: '精确说明，审视边界',
      steps: [
        step('给出精确说明', '用清楚的定义与条件表述自己的理解，不把自述掌握当证明。', 'notes', 5),
        step(
          '写出边界与反例',
          '尝试提出边界情形或反例；不能构造时，写明需要核对的原因。',
          'notes',
          6,
        ),
        step('反向核对概念关系', '检查已有知识联系的条件，保留尚未证实的部分。', 'relations', 5),
      ],
      questions: [
        '我能精确描述{node}的适用边界吗？',
        '我能给出反例，或说明为何不易构造吗？',
        '我的自信还需要哪一种证据支持？',
      ],
    },
    'advanced:practice': {
      label: '少提示作答，复核严密性',
      steps: [
        check(
          '少提示完成已有题目',
          '独立尝试相关已有题目，并说明特殊情形和结果检查方法。',
          10,
          '写出可检验的推导',
          '当前没有相关题目时，写出一段自己的推导、前提和结果检查方法。',
        ),
        step('审视推导的严密性', '检查关键论证能否逐步复核，而不只依赖对结论的熟悉。', 'notes', 6),
        step(
          '交流可替代的方法',
          '说明所用方法与可能的替代思路，请同学检视不确定之处。',
          'discussion',
          6,
        ),
      ],
      questions: [
        '我对{node}的推导是否覆盖了特殊与边界情形？',
        '别人是否可以逐步复核我的解法？',
        '如果不看提示，我会用什么方法检查结果？',
      ],
    },
    'advanced:explore': {
      label: '提出探究，区分证据与猜想',
      steps: [
        step(
          '审视知识联系与边界',
          '从已有关系查阅所需前提，不要求按课程顺序浏览。',
          'relations',
          5,
        ),
        step(
          '形成一个探究问题',
          '明确新问题的假设、验证方法和可能限制，不把自信当证据。',
          'notes',
          8,
        ),
        step(
          '交换推导或应用猜想',
          '向同学说明已证实和待验证的部分，讨论下一步如何检验。',
          'discussion',
          8,
        ),
      ],
      questions: [
        '{node}可以迁移到哪一个新的问题中？',
        '这次探索的假设、验证方法和限制分别是什么？',
        '哪些发现是已证实的，哪些仍是猜想？',
      ],
    },
  };
  function buildStrategy(value, context = {}) {
    const selected = normalizePreference(value);
    if (!selected) return null;
    const options =
      context && typeof context === 'object' && !Array.isArray(context) ? context : {};
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
    const hasContent = options.hasContent === undefined ? true : options.hasContent === true;
    const hasQuestions = options.hasQuestions === true;
    const suggested = recommendedGoal(selected.level);
    const goal = selected.goal || suggested;
    const key = `${selected.level}:${goal}`;
    const plan = PLANS[key];
    const steps = plan.steps.map((original, index) => {
      let action = original;
      let view;
      if (action.tool === 'feedback' && !hasQuestions) action = action.withoutQuestions;
      if (action.tool === 'origin' || action.tool === 'relations') {
        const available =
          action.tool === 'origin' ? options.hasOrigin === true : options.hasRelations === true;
        if (available) {
          view = action.tool;
          action = { ...action, tool: 'content' };
        } else
          action = {
            title: hasContent ? '查阅探索所需的前提' : '记录想查证的问题',
            description: hasContent
              ? '尚无对应起源或关系材料，先核对正文中的定义与条件。'
              : '当前没有对应材料，先写问题与需要查证之处。',
            tool: hasContent ? 'content' : 'notes',
            minutes: action.minutes,
          };
      }
      if (action.tool === 'content' && !view && !hasContent)
        action = {
          title: `记录“${action.title}”的资料缺口`,
          description: '当前没有正文。先写自己的理解和需要查证之处，不把猜想当作课程结论。',
          tool: 'notes',
          minutes: action.minutes,
        };
      const result = {
        id: `${key}:${index + 1}`,
        title: action.title,
        description: action.description,
        tool: action.tool,
        minutes: action.minutes,
        completed: false,
        skipped: false,
        ...(view ? { view } : {}),
      };
      if (action.tool === 'feedback') {
        result.quizView = options.quizView === 'quick' ? 'quick' : 'practice';
        if (
          typeof options.questionId === 'string' &&
          /^[a-zA-Z0-9:_-]{1,120}$/.test(options.questionId)
        )
          result.questionId = options.questionId;
      }
      return result;
    });
    const questions = plan.questions.map((question) => question.replaceAll('{node}', node));
    const reason = selected.goal
      ? `${LEVELS[selected.level]} · ${GOALS[goal]}`
      : `${LEVELS[selected.level]} · 建议先${GOALS[suggested]}，也可更改。`;
    const hint = `学习起点为学生自述“${LEVELS[selected.level]}”，非测评结论，不代表本知识点能力。${selected.goal ? '本次所选' : '尚未选目标，建议但不强制的'}目标是“${GOALS[goal]}”。建议按“${plan.label}”：${steps.map((action) => action.title).join(' → ')}。可用以下反思问题引导：${questions.join(' ')}这些反思问题不是正式自测题，不作判分；熟悉程度只调整初始支架，不等于题目难度；本策略不替代正式错题和待复核记录，不限制资料或判定星级，用户可自由切换目标。Max应引导思考，不代做，不自动发问或替学生决定路径。`;
    return {
      key,
      level: selected.level,
      goal,
      recommendedGoal: suggested,
      label: plan.label,
      reason,
      steps,
      questions,
      hint,
    };
  }
  const api = { LEVELS, GOALS, normalizePreference, recommendedGoal, buildStrategy };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, { FreeBbsLearningStrategies: api });
})(typeof window !== 'undefined' ? window : globalThis);
