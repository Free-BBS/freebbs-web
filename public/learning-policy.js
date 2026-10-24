/* An experimental, versioned suggestion policy. Never a grade or a learner label. */
(function exposeLearningPolicy(root) {
  const POLICY_VERSION = 'purpose-level-v1';
  const LAB_SCHEMA_VERSION = 2;
  const STORAGE_BASE = `free_bbs_learning_policy_lab:${POLICY_VERSION}`;
  const PURPOSES = Object.freeze({
    learn: '理解知识',
    practice: '练习解题',
    review: '复习知识',
    explore: '探索研究',
  });
  const LEVELS = Object.freeze({
    new: '第一次学',
    familiar: '不甚熟悉',
    basic: '能独立做题',
    advanced: '完整掌握',
  });
  const CHAINS = Object.freeze({
    'learn:new': ['overview', 'origin', 'read', 'worked-example', 'practice', 'reflect'],
    'learn:familiar': ['retrieve', 'read', 'worked-example', 'practice', 'reflect'],
    'learn:basic': ['retrieve', 'read', 'practice', 'transfer', 'reflect'],
    'learn:advanced': ['retrieve', 'read', 'transfer', 'explore', 'reflect'],
    'practice:new': ['worked-example', 'practice', 'repair', 'reflect'],
    'practice:familiar': ['retrieve', 'practice', 'repair', 'reflect'],
    'practice:basic': ['practice', 'repair', 'transfer', 'reflect'],
    'practice:advanced': ['practice', 'transfer', 'repair', 'reflect'],
    'review:new': ['retrieve', 'repair', 'practice', 'worked-example', 'revisit'],
    'review:familiar': ['retrieve', 'repair', 'practice', 'reflect', 'revisit'],
    'review:basic': ['retrieve', 'practice', 'repair', 'transfer', 'revisit'],
    'review:advanced': ['retrieve', 'transfer', 'repair', 'reflect', 'revisit'],
    'explore:new': ['explore', 'overview', 'origin', 'read', 'reflect'],
    'explore:familiar': ['explore', 'retrieve', 'read', 'transfer', 'reflect'],
    'explore:basic': ['explore', 'read', 'transfer', 'reflect', 'revisit'],
    'explore:advanced': ['explore', 'transfer', 'reflect', 'revisit'],
  });
  Object.values(CHAINS).forEach(Object.freeze);
  const MODULES = Object.freeze({
    overview: {
      title: '先看要解决什么',
      action: '用概览确认问题、关键概念和已有材料；只查一个问题也可以。',
      output: '明确今天想弄清的一件事。',
      question: '这个知识点帮我解决什么问题？哪些前提值得先确认？',
      tool: 'content',
      view: 'overview',
    },
    origin: {
      title: '从知识起源建立直觉',
      action: '先看知识为何被引入，再把情境与一个熟悉的例子联系起来。',
      output: '说清问题背景，而不只记住结论。',
      question: '没有这个概念时会遇到什么困难？请从一个直观情境解释。',
      tool: 'content',
      view: 'origin',
    },
    read: {
      title: '定向阅读同一份正文',
      action: '只读与当前疑问有关的定义、条件和推导；可高亮、划线或批注。',
      output: '一处已理顺的条件，或一条明确的疑问。',
      question: '请结合课程原文解释这个条件为什么必要；先给必要术语，再逐步说明。',
      tool: 'content',
    },
    'worked-example': {
      title: '对照示例，解释每一步',
      action: '若课程提供完整示例，先解释步骤再尝试遮住部分过程；没有示例时不假装已有。',
      output: '能说明一步用了什么条件，标出仍需示范的地方。',
      question:
        '请依据当前课程材料示范一个最小例子，解释每一步；若为临时示例请明确标注并让我尝试下一步。',
      tool: 'content',
    },
    retrieve: {
      title: '先回忆，再对照',
      action: '暂不看答案，用自己的话回想一个关键概念或解题步骤；不会也只是定位起点。',
      output: '一条独立回忆，以及想核对的缺口；不在这里收集作答。',
      question: '先让我用自己的话解释，再帮我核对遗漏的条件；不要直接替我完成。',
      tool: 'content',
    },
    practice: {
      title: '尝试一道真实已有题',
      action: '先独立尝试，再按题目反馈核对理由；难度依据题目标签与已有题证据，不由自评直接决定。',
      output: '保留自己的步骤与一个需要订正的原因。',
      question: '我会先说明已做到哪一步，请只给能继续思考的下一层提示，不代做。',
      tool: 'feedback',
    },
    repair: {
      title: '针对不稳的一步查缺',
      action: '只针对已发现的卡点回看条件、解释或订正；没有可信错题证据时不声称你做错了。',
      output: '区分概念、条件或推导问题，并重新解释关键一步。',
      question: '请帮我找出我的说法依赖的条件；没有我的作答时不要推测我错在哪里。',
      tool: 'content',
    },
    transfer: {
      title: '换一个情境检验边界',
      action: '优先使用真实探索题或课程应用；没有时只提出一个变式问题，不当作正式迁移测量。',
      output: '说明改变了什么条件、原方法是否仍适用，以及依据。',
      question: '如果只改变一个条件，原结论还成立吗？请区分已有依据与需要验证的猜想。',
      tool: 'feedback',
    },
    explore: {
      title: '形成一个可检验的问题',
      action: '从真实知识关系或自己关心的应用出发，说明假设、依据与可能的验证办法。',
      output: '一个范围明确的问题，不把灵感或 AI 推测当作已证实结论。',
      question: '请帮助我澄清问题与可查证依据，提出验证方向；不要替我宣布发现或捏造文献。',
      tool: 'content',
      view: 'relations',
    },
    reflect: {
      title: '留下一点可回用的收获',
      action: '在原文做自己的批注，或只记住下次从哪里继续；不必写长总结。',
      output: '一个关键解释、一个边界，或下一步问题。',
      question: '请帮我把当前收获整理成一个关键条件和一个待查问题，不替我判断已掌握。',
      tool: 'notes',
    },
    revisit: {
      title: '隔一段时间再回看',
      action:
        '自行选一个合适时间重新回忆或尝试已有题；不会自动发送提醒，也不将回看当作新的测验结果。',
      output: '知道下次要复查的一个问题；可现在暂停。',
      question: '下次复查时可以用什么不依赖原答案的问题？临时题只作练习，不作为正式达标证据。',
      tool: 'content',
    },
  });
  Object.values(MODULES).forEach(Object.freeze);
  const SUPPORT = Object.freeze({
    new: '先明确必要术语、直观情境与基本原理；逐步示范后邀请尝试，避免连续反问。',
    familiar: '先请同学指出已知与不确定处，针对缺口解释；不要求从头重学。',
    basic: '减少重复讲授，优先独立解释、条件核对与变式；需要时补回具体支架。',
    advanced: '尊重直接查阅与跳步，聚焦边界、反例、联系与验证；自信不替代实际证据。',
  });
  const PURPOSE_SUPPORT = Object.freeze({
    learn: '以建立概念与可解释的方法为主，允许先看讲解再尝试。',
    practice: '以独立尝试、解释关键步骤与订正为主；必要时逐层提供示范和提示，不只给答案。',
    review:
      '先回忆或直接试一道，由同学判断是否发现缺口；顺利即可结束。只有发现缺口才定向查漏，不把复习等同刷题或从头重读，不强制做完后续步骤。',
    explore:
      '无论熟悉程度，先接住同学自己的问题、好奇或应用方向，也可直接浏览真实知识关系；概览、起源、正文和题目都只在需要时调用，不强制完成标准学习链。',
  });
  const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
  const identifier = (value) =>
    typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(value) ? value : '';
  const hash = (value) => (typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : '');
  // Course-authored quiz versions are bounded strings (for example "1.0"),
  // unlike the SHA-256 document version. Preserve exact version comparisons.
  const questionVersion = (value) =>
    typeof value === 'string' && value.length <= 64 && value.trim() ? value.trim() : '';
  function normalizeConfig(value) {
    return object(value) &&
      typeof value.purpose === 'string' &&
      typeof value.level === 'string' &&
      Object.hasOwn(PURPOSES, value.purpose) &&
      Object.hasOwn(LEVELS, value.level)
      ? { purpose: value.purpose, level: value.level }
      : null;
  }
  function normalizeContext(value) {
    if (!object(value)) return null;
    const version = value.policyVersion ?? value.policy;
    if (
      version !== POLICY_VERSION ||
      (value.policyVersion !== undefined &&
        value.policy !== undefined &&
        value.policyVersion !== value.policy)
    )
      return null;
    const config = normalizeConfig(value);
    if (
      !config ||
      (value.module !== undefined &&
        (typeof value.module !== 'string' || !Object.hasOwn(MODULES, value.module)))
    )
      return null;
    return {
      policyVersion: POLICY_VERSION,
      ...config,
      ...(value.module ? { module: value.module } : {}),
    };
  }
  function ownerKey(identity) {
    const uid = identity?.verified === true && identifier(identity.uid);
    return uid ? `${STORAGE_BASE}:schema:${LAB_SCHEMA_VERSION}:user:${uid}` : null;
  }
  function normalizeQuestions(value) {
    if (!Array.isArray(value)) return [];
    const used = new Set();
    return value.slice(0, 100).flatMap((entry) => {
      if (!object(entry) || !identifier(entry.id) || used.has(entry.id)) return [];
      used.add(entry.id);
      return [
        {
          id: entry.id,
          role: ['practice', 'selftest', 'exploration'].includes(entry.assessmentRole)
            ? entry.assessmentRole
            : entry.official === true
              ? 'selftest'
              : 'practice',
          difficulty: ['basic', 'standard', 'challenge'].includes(entry.difficulty)
            ? entry.difficulty
            : null,
          questionVersion: questionVersion(entry.questionVersion),
        },
      ];
    });
  }
  function currentEvidence(raw, questions, documentVersion) {
    // A caller must supply authenticated server evidence. Browser self-checks never qualify.
    if (!object(raw) || raw.source !== 'authenticated_current_version' || !hash(documentVersion))
      return [];
    const latest = new Map();
    for (const entry of Array.isArray(raw.attempts) ? raw.attempts.slice(0, 100) : []) {
      if (
        !object(entry) ||
        entry.official !== true ||
        !identifier(entry.questionId) ||
        latest.has(entry.questionId)
      )
        continue;
      // The server must supply newest first; selecting before versions prevents resurrecting old passes.
      latest.set(entry.questionId, entry);
    }
    return [...latest.values()].flatMap((entry) => {
      const question = questions.find((item) => item.id === entry.questionId);
      if (
        !question ||
        question.role !== 'selftest' ||
        !question.questionVersion ||
        entry.documentVersion !== documentVersion ||
        entry.questionVersion !== question.questionVersion
      )
        return [];
      const outcome =
        entry.status === 'pending_review'
          ? 'pending'
          : entry.status === 'graded' && ['pass', 'fail'].includes(entry.verdict)
            ? entry.verdict
            : '';
      return outcome ? [{ questionId: question.id, difficulty: question.difficulty, outcome }] : [];
    });
  }
  function selectQuestion(questions, purpose, evidence, moduleId) {
    const exploration = ['transfer', 'explore'].includes(moduleId);
    let candidates = questions.filter((question) =>
      exploration ? question.role === 'exploration' : question.role !== 'exploration',
    );
    if (!candidates.length) return null;
    const failure = evidence.find((entry) => entry.outcome === 'fail');
    const passed = evidence.find((entry) => entry.outcome === 'pass' && entry.difficulty);
    const target = failure
      ? { challenge: 'standard', standard: 'basic', basic: 'basic' }[failure.difficulty] || null
      : passed
        ? { basic: 'standard', standard: 'challenge', challenge: 'challenge' }[passed.difficulty]
        : null;
    if (moduleId === 'repair' && failure)
      candidates = [...candidates].sort(
        (a, b) => Number(b.id === failure.questionId) - Number(a.id === failure.questionId),
      );
    const selected =
      candidates.find((question) => target && question.difficulty === target) || candidates[0];
    return {
      ...selected,
      mode: 'practice',
      basis: target ? 'current_question_evidence' : 'published_role_available_order',
      explanation: target
        ? '参考当前版本、同题渠道的正式作答与题目标签；不是能力认证。'
        : '依据已发布题目用途与可用顺序；尚无校准证据，不由自评直接指定难度。',
      purpose,
    };
  }
  function buildPolicy(config, context = {}) {
    const selected = normalizeConfig(config);
    if (!selected) return null;
    const materials = object(context.materials)
      ? context.materials
      : {
          body: context.hasContent === true,
          origin: context.hasOrigin === true,
          relations: context.hasRelations === true,
          workedExample: context.hasWorkedExample === true,
        };
    const questions = normalizeQuestions(context.questions);
    const evidence = currentEvidence(context.trustedEvidence, questions, context.documentVersion);
    const strategyId = `${selected.purpose}:${selected.level}`;
    const steps = CHAINS[strategyId].map((moduleId, index) => {
      const definition = MODULES[moduleId];
      const result = {
        id: `${POLICY_VERSION}:${strategyId}:${moduleId}`,
        moduleId,
        order: index + 1,
        ...definition,
        available: true,
        note: '',
        question: null,
        optional:
          selected.purpose === 'review'
            ? moduleId !== 'retrieve'
            : selected.purpose === 'explore'
              ? moduleId !== 'explore'
              : ['reflect', 'revisit'].includes(moduleId),
        conditional:
          (selected.purpose === 'review' &&
            ['read', 'repair', 'worked-example'].includes(moduleId)) ||
          (selected.purpose === 'explore' && ['overview', 'origin', 'read'].includes(moduleId)) ||
          (selected.purpose === 'practice' && moduleId === 'repair'),
      };
      // Reflection prompts remain separate from a real selected course question.
      result.prompt = definition.question;
      if (['practice', 'transfer', 'repair'].includes(moduleId))
        result.question = selectQuestion(questions, selected.purpose, evidence, moduleId);
      if (moduleId === 'origin' && materials.origin !== true) {
        result.note = '当前未读取到知识起源；改从正文的问题背景入手，不补造材料。';
        result.view = 'reading';
      }
      if (moduleId === 'worked-example' && materials.workedExample !== true) {
        result.title = '需要时请求一步示范';
        result.note = '尚未单独标注完整示例。可核对已有讲解，再主动请 Max 给出明确标为临时的示范。';
      }
      if (moduleId === 'practice' && !result.question) {
        result.title = '先说明解题思路';
        result.tool = 'content';
        result.note =
          context.hasQuestions === true
            ? '已有题目入口，但当前策略未收到题目清单；可回原页面自行选择，Max 不指定不存在的题目或难度。'
            : '当前没有可确认的相关题目；可在原页面查看，或先口头说明思路，不生成假题或假评分。';
      }
      if (moduleId === 'transfer' && !result.question) {
        result.tool = 'content';
        result.note = '没有可确认的探索题；这里只形成变式问题，不声称完成迁移测验。';
      }
      if (moduleId === 'repair')
        result.note = evidence.some((entry) => entry.outcome === 'fail')
          ? '有当前版本正式题的未通过记录，可回原页面查看具体订正；学习建议不会修改测验结果。'
          : '未读取到可信的当前错题证据；由你选择疑点，不推断你做错了。';
      if (selected.purpose === 'review' && ['repair', 'read'].includes(moduleId)) {
        result.action =
          '只有回忆或尝试发现缺口时，才定点回看相关原理、条件或一步示范；顺利时可直接跳过，不需重读全文。';
        result.note +=
          '第一次接触或几乎忘光时，可先核对最小概念与示例，或由自己改选“理解知识”；不会自动降级。';
      }
      if (moduleId === 'explore' && materials.relations !== true) {
        result.view = 'reading';
        result.note = '未读取到真实知识关系，可先从自己的应用问题入手，不补画关系。';
      }
      if (
        materials.body !== true &&
        (['read', 'worked-example'].includes(moduleId) ||
          (moduleId === 'reflect' && materials.origin !== true))
      ) {
        result.note =
          '当前正文尚不可用。可看原页面已有资料，或主动向 Max 说明疑问；不要求在空正文上批注。';
        result.tool = 'content';
        result.available = false;
      }
      // Availability describes the named course resource, not a fallback route.
      // A learner may still ask for help or pose a question when it is absent.
      if (moduleId === 'origin') result.available = materials.origin === true;
      if (moduleId === 'worked-example')
        result.available = materials.workedExample === true && materials.body === true;
      if (moduleId === 'practice') result.available = Boolean(result.question);
      if (moduleId === 'repair')
        result.available =
          materials.body === true || materials.origin === true || Boolean(result.question);
      if (moduleId === 'reflect')
        result.available = materials.body === true || materials.origin === true;
      return result;
    });
    return {
      policyVersion: POLICY_VERSION,
      strategyId,
      ...selected,
      title: `${PURPOSES[selected.purpose]} · ${LEVELS[selected.level]}`,
      support: `${SUPPORT[selected.level]}${PURPOSE_SUPPORT[selected.purpose]}`,
      maxPrinciple:
        '同一份课程正文优先，区分材料与临时解释；先帮助理解，再提供可选下一步。不代做、不自动提问、不判正式成绩或授星。',
      evidenceStatus: evidence.length ? 'current_version_partial_evidence' : 'not_calibrated',
      evidenceSummary: {
        observed: evidence.length,
        pending: evidence.filter((entry) => entry.outcome === 'pending').length,
      },
      coreStepCount: selected.purpose === 'review' ? 3 : 4,
      pacing:
        selected.purpose === 'review'
          ? 'brief_recall_then_conditional_repair'
          : 'adjustable_fuller_support',
      steps,
      boundaries: [
        '熟悉程度是本次自述，不是固定人群或能力认证。',
        '所有资料入口开放；跳过、求助和暂停不算失败。',
        '这里的完成勾选只是本人记录，不表示掌握、正式达标或星级。',
      ],
    };
  }
  function buildPromptHint(raw, actualCapabilities = {}) {
    const normalized = normalizeContext(raw);
    if (!normalized) return '';
    const plan = buildPolicy(normalized, actualCapabilities);
    const focused = plan.steps.find((step) => step.moduleId === normalized.module);
    const generalModule = normalized.module ? MODULES[normalized.module] : null;
    return [
      `学习建议规则 ${POLICY_VERSION}，策略 ID ${plan.strategyId}。这是可调整的初始建议，不是能力诊断，也不代表效果已经得到验证。`,
      `本次目的：${PURPOSES[normalized.purpose]}；当前熟悉程度为本人自述“${LEVELS[normalized.level]}”，未知处不可补成掌握或未掌握。`,
      plan.support,
      plan.maxPrinciple,
      generalModule
        ? `从学习链选择的模块：${normalized.module}（${focused?.title || generalModule.title}）。建议产出：${generalModule.output}可选问题：${generalModule.question}${focused?.note || ''}URL 中的模块只是从链进入时的意图，不证明同学一直停留在这一步；当前实际工具与用户本次请求优先。`
        : '尚未指定学习模块；先回应同学实际提出的问题，不要求完成整条链。',
      '单一课程正文保持不变；不要把熟悉程度一一等同题目难度。先看真实题目用途与版本，再核对本人可信题证据；没有证据就保持未知。',
      '可以直接查阅、先试一道题、跳过回忆、求助或暂停；尤其第一次接触者跳过回忆不是失败。不要自动发送问题、代答、修改正式结果或授星。',
      '仅按服务器实际提供的课程资料与本人记录作答。没有完整示例、探索题、平行题、知识关系或延迟测证据时明确说明，不自行宣称已有。',
    ].join('\n');
  }
  function normalizeRecord(value) {
    if (
      !object(value) ||
      value.policyVersion !== POLICY_VERSION ||
      value.schemaVersion !== LAB_SCHEMA_VERSION ||
      !identifier(value.course) ||
      !identifier(value.point)
    )
      return null;
    const config = normalizeConfig(value);
    if (!config) return null;
    const strategyId = `${config.purpose}:${config.level}`;
    const statuses = {};
    if (object(value.statuses))
      CHAINS[strategyId].forEach((moduleId) => {
        if (['done', 'skipped'].includes(value.statuses[moduleId]))
          statuses[moduleId] = value.statuses[moduleId];
      });
    const timestamp =
      typeof value.updatedAt === 'string' && Number.isFinite(Date.parse(value.updatedAt))
        ? new Date(value.updatedAt).toISOString()
        : null;
    return {
      policyVersion: POLICY_VERSION,
      schemaVersion: LAB_SCHEMA_VERSION,
      strategyId,
      course: value.course,
      point: value.point,
      ...config,
      statuses,
      paused: value.paused === true,
      ...(timestamp ? { updatedAt: timestamp } : {}),
    };
  }
  function exportRecord(value) {
    const record = normalizeRecord(value);
    return record
      ? {
          format: 'freebbs-learning-policy-lab-v1',
          ...record,
          interpretation: '本人自述配置与操作记录，不是能力、成绩或平台效果证明。',
        }
      : null;
  }
  const api = {
    POLICY_VERSION,
    LAB_SCHEMA_VERSION,
    STORAGE_BASE,
    PURPOSES,
    LEVELS,
    CHAINS,
    MODULES,
    normalizeConfig,
    normalizeContext,
    ownerKey,
    normalizeQuestions,
    currentEvidence,
    selectQuestion,
    buildPolicy,
    buildPromptHint,
    normalizeRecord,
    exportRecord,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FreeBbsLearningPolicy = api;
})(typeof window !== 'undefined' ? window : globalThis);
