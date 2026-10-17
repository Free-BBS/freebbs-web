/* Small, deterministic learning paths. Personal notes and conversations are not inputs. */
(function exposeNextSteps(root) {
  const VERSION = 1;
  const TOOLS = new Set([
    'content',
    'resources',
    'feedback',
    'continue',
    'notes',
    'contribute',
    'discussion',
  ]);
  const list = (value) => (Array.isArray(value) ? value : []);
  const object = (value) =>
    value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const string = (value, limit = 220) =>
    typeof value === 'string' ? value.trim().slice(0, limit) : '';
  const identifier = (value) =>
    typeof value === 'number' && Number.isFinite(value) ? String(value) : string(value, 100);

  function hasReadableContent(node) {
    const content =
      root.FreeBbsLearningContent ||
      (typeof module !== 'undefined' && module.exports ? require('./learning-content') : null);
    const source = object(node.sections).knowledgeMarkdown ?? node.markdown ?? '';
    return typeof source === 'string' && Boolean(content?.stripQuizSource(source).trim());
  }

  function availableResource(entry) {
    const resource = object(entry);
    if (resource.available === false) return false;
    const url = typeof entry === 'string' ? entry : resource.url;
    if (typeof url !== 'string' || !url.trim()) return false;
    try {
      const target = new URL(url, 'https://freebbs.invalid');
      return ['http:', 'https:'].includes(target.protocol) && !target.username && !target.password;
    } catch {
      return false;
    }
  }

  // These are optional shortcuts for the task at hand, not another learner questionnaire.
  function taskEntries(value) {
    const input = object(value);
    const node = object(input.node);
    const entries = [];
    const add = (id, title, tool, detail = {}) =>
      entries.push({ id, title, tool, minutes: 5, completed: false, skipped: false, ...detail });
    if (hasReadableContent(node)) add('task-read', '查阅正文', 'content', { view: 'reading' });
    if (input.hasOrigin === true) add('task-origin', '理解为什么', 'content', { view: 'origin' });
    if (list(input.questions).some((question) => object(question).official === true))
      add('task-selftest', '正式自测', 'feedback', { quizView: 'quick' });
    const practice = list(input.practiceQuestions).filter((question) =>
      identifier(object(question).id),
    );
    if (
      practice.some((question) => object(question).assessmentRole !== 'exploration') ||
      list(input.questions).some((question) => object(question).official === true)
    )
      add('task-practice', '练习解题', 'feedback', { quizView: 'practice' });
    if (practice.some((question) => object(question).assessmentRole === 'exploration')) {
      const question = practice.find((entry) => entry.assessmentRole === 'exploration');
      add('task-explore', '探索与检验', 'feedback', {
        quizView: 'practice',
        questionId: identifier(question.id),
      });
    }
    if (hasReadableContent(node)) add('task-note', '在原文上批注', 'notes');
    else if (input.hasOrigin === true)
      add('task-note', '在知识起源上批注', 'content', {
        view: 'origin',
        taskId: 'annotate-origin',
      });
    add('task-help', '向 Max 求助', 'discussion', { taskId: 'ask-max' });
    add('task-discuss', '和同学讨论', 'discussion');
    return entries;
  }

  function normalizePath(value) {
    const saved = object(value);
    if (saved.version != null && saved.version !== VERSION) return [];
    const seen = new Set();
    return list(Array.isArray(value) ? value : saved.steps)
      .map((entry, index) => {
        const step = object(entry);
        if (!TOOLS.has(step.tool) || !string(step.title, 120)) return null;
        const id = string(identifier(step.id), 80) || `saved-${index}`;
        if (seen.has(id)) return null;
        seen.add(id);
        const minutes =
          typeof step.minutes === 'number' || typeof step.minutes === 'string'
            ? Number(step.minutes)
            : NaN;
        const result = {
          id,
          title: string(step.title, 120),
          description: string(step.description, 600),
          tool: step.tool,
          minutes: Number.isFinite(minutes) ? Math.max(1, Math.min(240, Math.round(minutes))) : 5,
          completed: typeof step.completed === 'boolean' ? step.completed : step.done === true,
          skipped: step.skipped === true,
        };
        const point = string(step.point, 120);
        if (point) result.point = point;
        if (['reading', 'origin', 'relations'].includes(step.view)) result.view = step.view;
        if (['practice', 'quick', 'mistakes'].includes(step.quizView))
          result.quizView = step.quizView;
        for (const field of ['questionId', 'taskId']) {
          const target = string(step[field], 120);
          if (/^[a-zA-Z0-9:_-]{1,120}$/.test(target)) result[field] = target;
        }
        if (result.completed) result.skipped = false;
        return result;
      })
      .filter(Boolean)
      .slice(0, 20);
  }

  function reorderStep(steps, id, delta) {
    const result = normalizePath(steps);
    const index = result.findIndex((step) => step.id === identifier(id));
    if (index < 0 || !Number.isFinite(delta)) return result;
    const target = Math.max(0, Math.min(result.length - 1, index + Math.trunc(delta)));
    const [step] = result.splice(index, 1);
    result.splice(target, 0, step);
    return result;
  }

  function toggleStep(steps, id, field = 'completed') {
    const result = normalizePath(steps);
    if (!['completed', 'skipped'].includes(field)) return result;
    return result.map((step) => {
      if (step.id !== identifier(id)) return step;
      const next = { ...step, [field]: !step[field] };
      if (next[field]) next[field === 'completed' ? 'skipped' : 'completed'] = false;
      return next;
    });
  }

  function connectedNode(map, node, direction, types) {
    const graph = object(map);
    const currentId = identifier(node.id);
    if (!currentId) return null;
    const nodes = list(graph.nodes);
    for (const raw of list(graph.edges)) {
      const edge = object(raw);
      if (!types.includes(edge.type)) continue;
      const current = direction === 'next' ? edge.source : edge.target;
      const target = direction === 'next' ? edge.target : edge.source;
      if (identifier(current) !== currentId || identifier(target) === currentId) continue;
      const match = nodes.find((entry) => identifier(object(entry).id) === identifier(target));
      if (match) return object(match);
    }
    return null;
  }

  // The course owns one teaching sequence in its IDs; academic edges are separate.
  function sequenceNode(map, node, direction = 'next') {
    const parse = (entry) => {
      const id = string(object(entry).id, 120);
      const tokens = id.length <= 64 && id.match(/^([A-Z][A-Z0-9]*)-(\d+)-(\d+)$/);
      if (!tokens || /^0+$/.test(tokens[3])) return null;
      return {
        entry: object(entry),
        id,
        course: tokens[1],
        chapter: BigInt(tokens[2]),
        point: BigInt(tokens[3]),
      };
    };
    const current = parse(node);
    if (!current || !['next', 'previous'].includes(direction)) return null;
    const candidates = list(object(map).nodes)
      .map(parse)
      .filter((entry) => entry?.course === current.course);
    const ids = new Set();
    const positions = new Set();
    for (const entry of candidates) {
      const position = `${entry.chapter}:${entry.point}`;
      if (ids.has(entry.id) || positions.has(position)) return null;
      ids.add(entry.id);
      positions.add(position);
    }
    candidates.sort((left, right) => {
      if (left.chapter !== right.chapter) return left.chapter < right.chapter ? -1 : 1;
      if (left.point !== right.point) return left.point < right.point ? -1 : 1;
      return 0;
    });
    const index = candidates.findIndex((entry) => entry.id === current.id);
    if (index < 0) return null;
    return candidates[index + (direction === 'next' ? 1 : -1)]?.entry || null;
  }

  function latestAttempts(value) {
    const latest = new Map();
    list(value).forEach((raw, index) => {
      const attempt = object(raw);
      const id = identifier(attempt.questionId);
      if (!id) return;
      const date = Date.parse(string(attempt.createdAt || attempt.updatedAt));
      const order = Number.isFinite(date) ? date : -index;
      const serial = /^[1-9]\d{0,18}$/.test(identifier(attempt.id)) ? BigInt(attempt.id) : null;
      const previous = latest.get(id);
      const newer =
        previous && serial !== null && previous.serial !== null
          ? serial > previous.serial
          : previous && order > previous.order;
      if (!previous || newer) latest.set(id, { attempt, order, serial });
    });
    return [...latest.values()].map(({ attempt }) => attempt);
  }

  function currentAttempts(input, node) {
    const version = identifier(input.documentVersion ?? node.documentVersion ?? node.revision);
    if (!version) return [];
    // Practice submissions cannot replace the latest formal assessment evidence.
    // Version checks stay after deduplication so stale official results cannot resurface.
    const formal = list(
      Array.isArray(input.currentAttempts) ? input.currentAttempts : input.recentAttempts,
    ).filter((attempt) => object(attempt).official === true);
    return latestAttempts(formal).filter((attempt) => {
      const snapshot = object(attempt.snapshot);
      const recordedVersion = identifier(attempt.documentVersion ?? snapshot.documentVersion);
      if (!recordedVersion || recordedVersion !== version) return false;
      if (Array.isArray(input.questions)) {
        const question = input.questions.find(
          (entry) => identifier(object(entry).id) === identifier(attempt.questionId),
        );
        if (!question) return false;
        const questionVersion = identifier(object(question).questionVersion);
        if (
          !questionVersion ||
          identifier(attempt.questionVersion) !== questionVersion ||
          (attempt.official === true && object(question).official !== true)
        )
          return false;
      }
      return true;
    });
  }

  function presentation(plan, { primary = null, alternatives = [] } = {}) {
    const steps = normalizePath(plan?.steps);
    const first = primary || steps.find((entry) => !entry.completed && !entry.skipped) || null;
    const signature = (entry) =>
      JSON.stringify([
        entry.tool,
        entry.point || '',
        entry.view || '',
        entry.quizView || '',
        entry.questionId || '',
        entry.taskId || '',
        entry.goal || '',
      ]);
    const seen = new Set(first ? [signature(first)] : []);
    const choices = [];
    for (const entry of [
      ...alternatives,
      ...steps.filter((candidate) => candidate.id !== first?.id),
    ]) {
      if (!entry || entry.completed || entry.skipped || seen.has(signature(entry))) continue;
      seen.add(signature(entry));
      choices.push({ ...entry });
      if (choices.length === 2) break;
    }
    return {
      primary: first ? { ...first } : null,
      alternatives: choices,
      chain: steps.map(({ id, title, tool, completed, skipped }) => ({
        id,
        title,
        tool,
        completed,
        skipped,
      })),
    };
  }

  function recommend(value) {
    const input = object(value);
    const node = object(input.node);
    const path = normalizePath(input.existingPath);
    const status = ['unlearned', 'learning', 'completed'].includes(input.status)
      ? input.status
      : '';
    const important = input.important === true;
    const attempts = currentAttempts(input, node);
    const officialAttempts = attempts.filter((attempt) => attempt.official === true);
    const failed = officialAttempts.some(
      (attempt) => attempt.status === 'graded' && attempt.verdict === 'fail',
    );
    const pending = attempts.some((attempt) => attempt.status === 'pending_review');
    const officialQuestions = list(input.questions).filter(
      (question) => object(question).official === true,
    );
    const passed =
      officialAttempts.length > 0 &&
      officialAttempts.every(
        (attempt) => attempt.status === 'graded' && attempt.verdict === 'pass',
      ) &&
      officialQuestions.length > 0 &&
      officialQuestions.every((question) =>
        officialAttempts.some(
          (attempt) => identifier(attempt.questionId) === identifier(question.id),
        ),
      );
    const hasContent = hasReadableContent(node);
    const hasOrigin = input.hasOrigin === true;
    const graph = object(input.map);
    const hasRelations = list(graph.edges).some(
      (edge) =>
        [identifier(object(edge).source), identifier(object(edge).target)].includes(
          identifier(node.id),
        ) &&
        identifier(object(edge).source) !== identifier(object(edge).target) &&
        list(graph.nodes).some(
          (entry) => identifier(object(entry).id) === identifier(object(edge).source),
        ) &&
        list(graph.nodes).some(
          (entry) => identifier(object(entry).id) === identifier(object(edge).target),
        ),
    );
    const practiceQuestions = list(input.practiceQuestions).filter((entry) =>
      identifier(object(entry).id),
    );
    const selectedGoal = ['concepts', 'practice', 'explore'].includes(input.activeGoal)
      ? input.activeGoal
      : '';
    const preference = object(input.learningStartPreference);
    const strategies =
      root.FreeBbsLearningStrategies ||
      (typeof module !== 'undefined' && module.exports ? require('./learning-strategies') : null);
    const validPreference = strategies?.normalizePreference(preference);
    const build = (goal = '') => {
      const effectiveGoal =
        goal ||
        validPreference?.goal ||
        strategies?.recommendedGoal(validPreference?.level || 'new');
      const practice = practiceQuestions.filter((entry) => entry.assessmentRole !== 'exploration');
      const candidates =
        effectiveGoal === 'explore'
          ? practiceQuestions.filter((entry) => entry.assessmentRole === 'exploration')
          : [...practice, ...officialQuestions];
      const suggestedDifficulty = {
        new: 'basic',
        familiar: 'basic',
        basic: 'standard',
        advanced: 'challenge',
      }[validPreference?.level || 'new'];
      const question =
        candidates.find((entry) => entry.difficulty === suggestedDifficulty) || candidates[0];
      const strategy =
        strategies?.buildStrategy(
          {
            level: validPreference?.level || 'new',
            goal: goal || validPreference?.goal || '',
          },
          {
            nodeTitle: string(node.title, 120),
            hasContent,
            hasOrigin,
            hasRelations,
            hasQuestions: Boolean(question),
            questionId: identifier(question?.id),
            // A learning goal is practice intent, not consent to a formal submission.
            // Published selftest items can also be attempted in nonofficial practice mode.
            quizView: 'practice',
          },
        ) || null;
      if (!strategy || validPreference) return strategy;
      // The conservative default chooses scaffolding, not a student's self-report.
      // Keep its plan/key/difficulty intact and only correct the explanatory copy.
      return {
        ...strategy,
        reason: `${strategies.GOALS[strategy.goal]} · 起点未设置`,
        hint: strategy.hint.replace(
          `学习起点为学生自述“${strategies.LEVELS[strategy.level]}”，非测评结论，不代表本知识点能力。`,
          '学习起点未设置；采用保守默认支架，不推断熟悉程度。',
        ),
      };
    };
    // A saved, deliberately chosen goal is still the learner's choice after a
    // reload. A recommended goal inferred only from familiarity is not one.
    const explicitGoal = selectedGoal || validPreference?.goal || '';
    const explicitStrategy = explicitGoal ? build(explicitGoal) : null;
    const strategy = explicitStrategy || (validPreference ? build() : null);
    const failedAttempt = officialAttempts.find(
      (entry) => entry.status === 'graded' && entry.verdict === 'fail',
    );
    const pendingAttempt = officialAttempts.find((entry) => entry.status === 'pending_review');
    const result = (mode, label, reason, steps) => {
      const plan = {
        version: VERSION,
        mode,
        label,
        reason,
        steps: normalizePath(steps),
        tip: '可换个任务，也可以先停一下。',
        evidence: { failed, pending },
        intentGoal: explicitGoal,
      };
      const alternatives = [];
      if (failed) alternatives.push({ ...repair });
      if (pending && pendingAttempt)
        alternatives.push({
          id: 'review-pending',
          title: '查看待复核作答',
          description: '复核尚未完成，也可先查阅或探索。',
          tool: 'feedback',
          quizView: 'quick',
          questionId: identifier(pendingAttempt.questionId),
          minutes: 3,
          completed: false,
          skipped: false,
        });
      const next = passed && !pending && !path.length ? sequenceNode(input.map, node) : null;
      if (next)
        alternatives.push({
          id: 'alternative-next',
          title: '开始下一知识点',
          description: string(next.title, 80),
          tool: 'content',
          point: identifier(next.id),
          minutes: 10,
          completed: false,
          skipped: false,
        });
      const exploratory = build('explore');
      if (exploratory && explicitGoal !== 'explore')
        alternatives.push({
          ...exploratory.steps[0],
          id: 'alternative-explore',
          title: '探索研究',
          goal: 'explore',
        });
      if (officialQuestions.length)
        alternatives.push({
          id: 'direct-selftest',
          title: '直接自测',
          description: '按当前正式自测要求作答。',
          tool: 'feedback',
          quizView: 'quick',
          minutes: 8,
          completed: false,
          skipped: false,
        });
      else if (practiceQuestions.length)
        alternatives.push({
          id: 'direct-practice',
          title: '练习解题',
          description: '练习不改变正式自测要求。',
          tool: 'feedback',
          quizView: 'practice',
          questionId: identifier(practiceQuestions[0].id),
          minutes: 8,
          completed: false,
          skipped: false,
        });
      // An existing path is a more specific commitment than the course default.
      // Only a task explicitly switched on this page may sit alongside it.
      let primary = (!path.length || selectedGoal ? explicitStrategy?.steps[0] : null) || null;
      if (!primary && failed) primary = { ...repair };
      else if (!primary && pending)
        primary = {
          id: 'review-pending',
          title: '查看待复核作答',
          description: '复核尚未完成，也可先查阅或探索。',
          tool: 'feedback',
          quizView: 'quick',
          questionId: identifier(pendingAttempt?.questionId),
          minutes: 3,
          completed: false,
          skipped: false,
        };
      plan.presentation = presentation(plan, { primary, alternatives });
      return plan;
    };
    const step = (id, title, description, tool, minutes, point) => ({
      id,
      title,
      description,
      tool,
      minutes,
      ...(point ? { point: identifier(point) } : {}),
      completed: false,
      skipped: false,
    });
    let repairId = 'correct-attempt';
    let suffix = 1;
    const nonFeedbackIds = new Set(
      path.filter((entry) => entry.tool !== 'feedback').map((entry) => entry.id),
    );
    while (nonFeedbackIds.has(repairId)) {
      repairId = `correct-attempt-${suffix}`;
      suffix += 1;
    }
    const repair = {
      ...step(repairId, '订正自测', '回看作答反馈，解释错因后再尝试。', 'feedback', 8),
      quizView: 'mistakes',
      ...(failedAttempt ? { questionId: identifier(failedAttempt.questionId) } : {}),
    };
    if (path.length) {
      const allCompleted = path.every((entry) => entry.completed);
      return result(
        failed ? 'repair' : 'resume',
        failed ? '先订正，或继续你的路径' : allCompleted ? '已完成这条路径' : '接着上次的路径',
        failed
          ? pending
            ? '当前版本有待订正和待复核的作答，已保存路径保持原顺序。'
            : '当前版本有待订正的作答，已保存路径保持原顺序。'
          : pending
            ? '有作答待批阅，已保存路径保持不变。'
            : allCompleted
              ? '步骤均已标记完成，可回看或调整。'
              : '保留你安排的步骤和顺序。',
        path,
      );
    }

    const reading = hasContent
      ? step(
          'read-current',
          '先读一小段',
          '选择一个概念或例子，记下还需解释的地方；不必一次读完。',
          'content',
          10,
        )
      : null;
    const prerequisite = connectedNode(input.map, node, 'previous', ['prerequisite']);
    const previous = prerequisite || sequenceNode(input.map, node, 'previous');
    const recall = previous
      ? step(
          'recall-related',
          prerequisite ? '回看前置知识' : '回看上一知识点',
          string(previous.title, 80) || '回看课程图谱中连接本节的知识点。',
          'content',
          5,
          previous.id,
        )
      : null;
    const hasResources = list(input.resources ?? node.resources).some(availableResource);
    const resources = hasResources
      ? step('use-resource', '选一份学习资料', '对照已有资料，补充一个概念或例子。', 'resources', 8)
      : null;
    const help = (id, minutes) => ({
      ...step(
        id,
        '带着一个问题求助',
        '可向 Max 说明想查清什么，或先停一下；不会自动发送问题。',
        'discussion',
        minutes,
      ),
      taskId: 'ask-max',
    });
    const annotation = (id, title, description, minutes) => {
      if (hasContent)
        return step(id, title, `选中一处相关原文，点击“批注”。${description}`, 'notes', minutes);
      if (hasOrigin)
        return {
          ...step(
            id,
            title,
            `在知识起源中选中一处文字，点击“批注”。${description}`,
            'content',
            minutes,
          ),
          view: 'origin',
          taskId: 'annotate-origin',
        };
      return help(id, minutes);
    };
    const check =
      officialQuestions.length || practiceQuestions.length
        ? {
            ...step(
              'check-understanding',
              officialQuestions.length ? '做个小自测' : '尝试一道已有题',
              '独立尝试一题，再回看作答反馈。',
              'feedback',
              5,
            ),
            quizView: officialQuestions.length ? 'quick' : 'practice',
          }
        : annotation(
            'check-understanding',
            '批注自己的理解',
            '用自己的话解释这一处，或只记一个疑点。',
            5,
          );
    const review = annotation('reflect', '留一条回看批注', '记一个收获或下次想核对的问题。', 3);
    const discuss = step(
      'ask-specific-question',
      '带着问题讨论',
      '写清已尝试的思路，和同学讨论一个具体问题。',
      'discussion',
      5,
    );
    const available = (...steps) => steps.filter(Boolean).slice(0, 4);

    const withStrategy = (recommendation) =>
      strategy ? { ...recommendation, strategy, questions: strategy.questions } : recommendation;
    if (
      !hasContent &&
      !hasOrigin &&
      !hasRelations &&
      !officialQuestions.length &&
      !practiceQuestions.length
    )
      return withStrategy(
        result(
          strategy ? 'strategy' : 'start',
          '先选一个能帮到你的入口',
          '学习材料尚未补齐，可提问，也可以先暂停。',
          [help('ask-about-missing-material', 3)],
        ),
      );
    if (explicitStrategy) {
      const recommendation = result(
        'strategy',
        explicitStrategy.label,
        failed
          ? pending
            ? '当前版本有待订正和待复核的作答，也可按你的目标继续。'
            : '当前版本有待订正的作答，可订正，也可按你的目标继续。'
          : pending
            ? '有作答待批阅，先按你的目标继续。'
            : passed
              ? sequenceNode(input.map, node)
                ? '当前正式自测已通过，可继续下一知识点或按你的目标深入。'
                : '当前正式自测已通过，可按你的目标回看与拓展。'
              : explicitStrategy.reason,
        explicitStrategy.steps,
      );
      recommendation.tip = '可换方向或暂停，不影响正式自测与星标。';
      return withStrategy(recommendation);
    }
    if (failed)
      return withStrategy(
        result(
          'repair',
          '先订正，再巩固',
          '当前版本有待订正的作答。',
          available(repair, reading, recall || resources, review),
        ),
      );
    if (strategy) {
      const recommendation = result(
        'strategy',
        strategy.label,
        pending ? '有作答待批阅，先按你的目标继续。' : strategy.reason,
        strategy.steps,
      );
      recommendation.tip = '可换方向或暂停，不影响正式自测与星标。';
      return withStrategy(recommendation);
    }
    if (!pending && (passed || status === 'completed')) {
      const next = sequenceNode(input.map, node);
      const advance = next
        ? step(
            'read-next',
            '开始下一知识点',
            string(next.title, 80) || '沿课程图谱的学习顺序继续。',
            'content',
            10,
            next.id,
          )
        : null;
      return result(
        advance ? 'advance' : 'review',
        advance ? '继续或回看' : '回看与拓展',
        passed ? '当前版本已作答的正式自测题均已通过。' : '你已标记学过，可选择继续或回看。',
        available(advance || reading, review, resources, discuss),
      );
    }
    if (important)
      return result(
        'consolidate',
        '把关键概念理顺',
        pending ? '有作答待批阅，可先回看这个重要知识点。' : '你已标记为重要，先把关键概念理顺。',
        available(recall, reading, check, resources || discuss),
      );
    let reason = '从阅读和复述开始，按需调整步骤。';
    if (pending) reason = '有作答待批阅，可先阅读或记录问题。';
    else if (status === 'learning') reason = '先接着读，再检查自己的理解。';
    return result(
      status === 'learning' ? 'resume' : 'start',
      status === 'learning' ? '继续当前知识点' : '从这一小步开始',
      reason,
      available(reading, resources || recall, check, review),
    );
  }

  const api = {
    VERSION,
    recommend,
    presentation,
    normalizePath,
    reorderStep,
    toggleStep,
    sequenceNode,
    availableResource,
    hasReadableContent,
    taskEntries,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, { FreeBbsLearningNextSteps: api });
})(typeof globalThis !== 'undefined' ? globalThis : this);
