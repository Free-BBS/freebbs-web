/* Optional process records are descriptive, never grades or ability scores. */
(() => {
  const LEVEL_LABELS = {
    new: '刚开始了解',
    familiar: '接触过一些',
    basic: '有基础',
    advanced: '比较熟悉',
  };
  const GOAL_LABELS = { concepts: '理解知识', practice: '练习解题', explore: '探索研究' };
  const PATH_TYPES = ['recommended', 'alternative', 'custom'];
  function normalizeLearningChoice(value) {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).some(
        (key) =>
          ![
            'courseSlug',
            'nodeId',
            'action',
            'level',
            'goal',
            'pathType',
            'documentVersion',
          ].includes(key),
      ) ||
      typeof value.courseSlug !== 'string' ||
      !/^[a-z0-9][a-z0-9-]{0,119}$/.test(value.courseSlug) ||
      typeof value.nodeId !== 'string' ||
      value.nodeId.length < 4 ||
      value.nodeId.length > 64 ||
      !/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/.test(value.nodeId) ||
      !['learning_start_set', 'recommendation_choose'].includes(value.action) ||
      (value.level !== undefined && !Object.hasOwn(LEVEL_LABELS, value.level)) ||
      (value.goal !== undefined &&
        value.goal !== null &&
        value.goal !== '' &&
        !Object.hasOwn(GOAL_LABELS, value.goal)) ||
      (value.pathType !== undefined && !PATH_TYPES.includes(value.pathType)) ||
      (value.documentVersion !== undefined && !/^[a-f0-9]{64}$/.test(value.documentVersion)) ||
      (value.action === 'learning_start_set' &&
        (!Object.hasOwn(LEVEL_LABELS, value.level) || value.pathType !== undefined)) ||
      (value.action === 'recommendation_choose' && !PATH_TYPES.includes(value.pathType))
    )
      return null;
    const metadata = { action: value.action };
    if (value.level !== undefined) metadata.level = value.level;
    if (value.goal !== undefined) metadata.goal = value.goal || null;
    if (value.pathType !== undefined) metadata.pathType = value.pathType;
    if (value.documentVersion !== undefined) metadata.documentVersion = value.documentVersion;
    return { courseSlug: value.courseSlug, nodeId: value.nodeId, metadata };
  }
  function activeDelta({ start, end, lastInteraction, visible, focused, idleMs = 60000 }) {
    if (!visible || !focused || !Number.isFinite(start) || end <= start) return 0;
    return Math.min(30, Math.max(0, Math.min(end, lastInteraction + idleMs) - start) / 1000);
  }
  function canViewOwnProfile(uid, state) {
    return Boolean(state?.isLoggedIn && state.uid && (!uid || String(uid) === String(state.uid)));
  }
  function minutes(seconds) {
    return `${Math.round(Math.max(0, Number(seconds) || 0) / 60)} 分钟`;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { activeDelta, canViewOwnProfile, minutes, normalizeLearningChoice };
    return;
  }
  const app = window.freeBbsApp;
  if (!app) return;
  const page = document.querySelector('[data-knowledge-page]');
  const personal = document.getElementById('personal-learning-data');
  const admin = document.getElementById('admin-learning-data');
  const state = {
    generation: 0,
    preferenceRevision: 0,
    enabled: false,
    preferencesReady: false,
    context: null,
    documentVersion: null,
    tool: 'content',
    busy: false,
  };
  let preferencesRequest = null;
  let sessionId = crypto.randomUUID();
  let lastTick = performance.now();
  let lastInteraction = lastTick;
  let sessionUid = String(app.userState?.uid || '');
  let sessionToken = app.userState?.token || '';
  let sessionIsAdmin = Boolean(app.userState?.isAdmin);
  let sessionLoggedIn = Boolean(app.userState?.isLoggedIn);
  let staleSession = false;
  let posting = false;
  const endpoint = '/learning-analytics';
  const identityChanged = () =>
    sessionUid !== String(app.userState?.uid || '') ||
    sessionToken !== (app.userState?.token || '');
  const current = () =>
    Boolean(
      !staleSession &&
      app.userState?.isLoggedIn &&
      sessionUid &&
      sessionToken &&
      !identityChanged(),
    );
  const element = (tag, value, className) => {
    const item = document.createElement(tag);
    if (value !== undefined) item.textContent = value;
    if (className) item.className = className;
    return item;
  };
  function message(host, value) {
    const item = host.querySelector('[data-learning-data-status]');
    if (item) item.textContent = value;
  }
  function metric(host, label, value, note) {
    const card = element('article', undefined, 'learning-data-metric');
    card.append(element('span', label), element('strong', String(value ?? 0)));
    if (note) card.append(element('small', note));
    host.append(card);
  }
  function renderEvidence(host, data) {
    const section = element('section', undefined, 'learning-data-evidence');
    if (!data.effectiveness) {
      section.append(
        element('h4', '学习变化证据'),
        element('p', '学习变化证据暂不可用，不能由使用统计推断学习效果。', 'learning-data-caption'),
      );
      host.append(section);
      return;
    }
    const evidence = data.effectiveness;
    section.append(
      element('h4', '学习变化证据'),
      element('p', '观察平台是否提供学习支持，不以访问量或时长评定能力。', 'learning-data-caption'),
    );
    const stats = element('div', undefined, 'learning-data-metrics');
    const comparable = Number(evidence.comparableSequences) || 0;
    const failed = Number(evidence.failedComparableSequences) || 0;
    metric(stats, '本期正式自测参与', `${evidence.officialLearners || 0} 人`);
    metric(
      stats,
      '可比较的同题复测',
      `${comparable} 组`,
      `${evidence.comparableLearners || 0} 人；每组至少两次正式已判定作答。`,
    );
    metric(
      stats,
      '未通过后再次通过',
      failed ? `${evidence.improvedSequences || 0} / ${failed} 组` : '暂无样本',
      failed
        ? `本期首个结果未通过且有复测；${evidence.improvedLearners || 0} / ${evidence.failedComparableLearners || 0} 人至少一组再次通过。`
        : '仅比较本期首个已判定结果为未通过、且有复测的组。',
    );
    metric(
      stats,
      '未通过后暂无已判定复测',
      `${evidence.notRetriedFailedSequences || 0} 组`,
      `${evidence.notRetriedFailedLearners || 0} 人；缺少后续证据，不计为失败。`,
    );
    metric(
      stats,
      '通过后再次未通过',
      `${evidence.regressedSequences || 0} 组`,
      `${evidence.regressedLearners || 0} 人；可进一步了解困难。`,
    );
    section.append(stats);
    if (!comparable)
      section.append(
        element('p', '尚无可比较的复测样本，暂不能判断本期作答变化。', 'learning-data-caption'),
      );
    else if (evidence.limitedSample)
      section.append(
        element('p', '可比较样本少于5人，仅呈现计数，不作群体结论。', 'learning-data-caption'),
      );
    if (evidence.courses?.length)
      table(
        section,
        ['课程', '可比较复测', '未通过后再次通过', '暂无已判定复测'],
        evidence.courses.map((course) => [
          course.name || course.courseSlug || course.courseId,
          `${course.comparableSequences || 0} 组 · ${course.comparableLearners || 0} 人`,
          course.failedComparableSequences
            ? `${course.improvedSequences || 0} / ${course.failedComparableSequences} 组`
            : '暂无样本',
          `${course.notRetriedFailedSequences || 0} 组`,
        ]),
      );
    const limits = element('details', undefined, 'learning-data-evidence-scope');
    limits.append(
      element('summary', '统计口径与边界'),
      element(
        'p',
        '仅纳入版本字段齐全的作答。每组为同一学生、课程、知识点、题目及完整正文和题目版本；比较统计期内首末次已判定作答，不跨版本，练习和待复核不计入。复核结果按原提交日期纳入。',
        'learning-data-caption',
      ),
      element(
        'p',
        '行为与结果证据不能单独证明平台因果效果；同题复测不等于长期掌握或迁移，也不是能力排名。',
        'learning-data-caption',
      ),
      element(
        'p',
        '理解知识联系、起源与边界，以及自主规划的帮助目前尚未测量，需结合自愿反馈、延迟或新题验证。',
        'learning-data-caption',
      ),
    );
    section.append(
      element(
        'p',
        '同题变化是初步证据，不等于掌握，也不能单独归因于平台。',
        'learning-data-caption',
      ),
      limits,
    );
    host.append(section);
  }
  function renderParticipation(host, evidence) {
    if (!evidence) return;
    const labels = {
      content: '学习内容',
      resources: '学习资源',
      feedback: '学习反馈',
      continue: '继续学习',
      notes: '个人笔记',
      contribute: '参与共建',
      path_save: '保存学习路径',
      annotation_save: '保存原文评注',
      contribution_submit: '提交共建建议',
    };
    const records = [...(evidence.tools || []), ...(evidence.actions || [])];
    if (!records.length) return;
    const details = element('details', undefined, 'learning-data-evidence-scope');
    details.append(
      element('summary', '学习工具参与'),
      element(
        'p',
        '仅统计授权记录期间的工具打开与操作，不读取笔记或聊天内容；使用不代表已经受益。',
        'learning-data-caption',
      ),
    );
    table(
      details,
      ['工具 / 操作', '人数', '次数'],
      records.map((record) => [
        labels[record.tool || record.action] || record.tool || record.action,
        record.users,
        record.events,
      ]),
    );
    host.append(details);
  }
  function renderJourney(host, journey, personalView = false) {
    if (!journey) return;
    const section = element('section', undefined, 'learning-data-evidence learning-data-journey');
    section.append(element('h4', personalView ? '我的学习证据' : '不同起点的学习参与'));
    if (personalView) {
      const list = element('div', undefined, 'learning-data-unit-list');
      (journey.units || []).forEach((unit) => {
        const card = element('article', undefined, 'learning-data-unit');
        const course = window.freeBbsCourseCatalog?.courses?.find(
          (item) => item.slug === unit.courseSlug,
        );
        const point = course?.knowledgePoints?.find((item) => item.id === unit.nodeId);
        const heading = element('div', undefined, 'learning-data-unit-heading');
        heading.append(element('strong', point?.name || point?.title || unit.nodeId));
        const link = element('a', '查看并调整起点');
        link.href = `/knowledge?${new URLSearchParams({ course: unit.courseSlug, point: unit.nodeId })}`;
        heading.append(link);
        const choice = unit.currentChoice;
        card.append(
          heading,
          element(
            'p',
            choice
              ? `最近记录：${LEVEL_LABELS[choice.level]} · ${GOAL_LABELS[choice.goal] || '目的未选择'}`
              : '起点尚无记录',
            'learning-data-caption',
          ),
        );
        const facts = element('div', undefined, 'learning-data-unit-facts');
        [
          ['练习', unit.practiceAttempts],
          ['正式自测', unit.officialAttempts],
          ['同题复测', unit.repeatedQuestions],
          ['订正后通过', unit.correctedQuestions],
          ['待复核', unit.pendingReview],
          ['探索作答', unit.explorationAttempts],
        ].forEach(([label, count]) => facts.append(element('span', `${label} ${count || 0}`)));
        card.append(facts);
        if (unit.revisions)
          card.append(
            element(
              'small',
              `本期已调整起点或目的 ${unit.revisions} 次；之前的作答不倒归入新起点。`,
              'learning-data-caption',
            ),
          );
        list.append(card);
      });
      section.append(list);
      if (!(journey.units || []).length)
        section.append(element('p', '尚无学习证据。', 'learning-data-caption'));
      if (journey.omittedUnits)
        section.append(
          element(
            'p',
            `这里只显示最近200个单元，另有 ${journey.omittedUnits} 个未展开。`,
            'learning-data-caption',
          ),
        );
    } else {
      const stats = element('div', undefined, 'learning-data-metrics');
      metric(
        stats,
        '有记录的学习单元',
        journey.observedUnits,
        `${journey.learners || 0} 人；每名学生的每个知识点计一个单元。`,
      );
      metric(
        stats,
        '起点已明确',
        `${journey.classifiedUnits || 0} / ${journey.observedUnits || 0}`,
        `起点缺失 ${journey.missingStartUnits || 0} 个，不推断为初学者。`,
      );
      metric(
        stats,
        '目的未选择',
        `${journey.missingGoalUnits || 0} / ${journey.classifiedUnits || 0}`,
        '以起点已明确的单元为分母。',
      );
      metric(stats, '后来更正起点或目的', journey.revisedUnits, '不改写更正之前的记录。');
      section.append(stats);
      if (journey.cohorts?.length)
        table(
          section,
          [
            '起点 / 目的',
            '单元（人数）',
            '选路径',
            '作答',
            '正式已判定',
            '同题复测',
            '订正通过',
            '探索作答',
          ],
          journey.cohorts.map((cohort) => [
            `${LEVEL_LABELS[cohort.level] || '未知'} / ${GOAL_LABELS[cohort.goal] || '未选择'}`,
            `${cohort.units}（${cohort.learners}人${cohort.limitedSample ? '，少于5人' : ''}）`,
            `${cohort.selectedPathUnits} / ${cohort.units}`,
            `${cohort.attemptedUnits} / ${cohort.units}`,
            `${cohort.gradedOfficialUnits} / ${cohort.units}`,
            `${cohort.retryUnits} / ${cohort.units}`,
            `${cohort.correctedUnits} / ${cohort.units}`,
            `${cohort.explorationAttemptUnits} / ${cohort.units}`,
          ]),
        );
      else section.append(element('p', '尚无已授权的明确起点记录。', 'learning-data-caption'));
    }
    section.append(element('p', '延迟保持 / 新情境迁移：尚未采集。', 'learning-data-caption'));
    const limits = element('details', undefined, 'learning-data-evidence-scope');
    limits.append(
      element('summary', '统计口径'),
      element(
        'p',
        '起点是自报选择，不是能力评定。分组只看本期第一次明确选择之后的同知识点记录；目的空缺保持未知。各列为可独立参与的行为，非必须按顺序完成；未复测不等于失败。个人作答卡包含本期选择之前的真实作答。',
        'learning-data-caption',
      ),
      element(
        'p',
        `选择时正文版本未知 ${journey.unknownChoiceVersionUnits || 0} 个单元；有选择之前作答 ${journey.preChoiceAttemptUnits || 0} 个单元；同一时刻无法确定先后 ${journey.ambiguousTimeUnits || 0} 个单元。之前或时间归属不明的作答不计入选择后的参与。过程记录只保留180天，自测保留业务记录。`,
        'learning-data-caption',
      ),
      element(
        'p',
        '正式自测指当前记录中的正式作答，不表示当前题目全集已经通过。同题订正不等于长期掌握或迁移，不能证明平台因果效果；管理员看不到私人批注、原始聊天和答案正文。',
        'learning-data-caption',
      ),
    );
    section.append(limits);
    host.append(section);
  }
  function table(host, headings, rows) {
    const scroll = element('div', undefined, 'learning-data-table-scroll');
    scroll.tabIndex = 0;
    const grid = element('table');
    const head = element('thead');
    const row = element('tr');
    headings.forEach((label) => row.append(element('th', label)));
    head.append(row);
    const body = element('tbody');
    rows.forEach((values) => {
      const line = element('tr');
      values.forEach((value) => line.append(element('td', String(value ?? 0))));
      body.append(line);
    });
    grid.append(head, body);
    scroll.append(grid);
    host.append(scroll);
  }
  async function post(type, action, deltaSeconds = 0) {
    if (!state.enabled || state.busy || !current() || !state.context || posting) return;
    const generation = state.generation;
    posting = true;
    try {
      await app.callApi(`${endpoint}/events`, {
        method: 'POST',
        body: JSON.stringify({
          requestKey: crypto.randomUUID(),
          courseSlug: state.context.course.slug,
          nodeId: state.context.node.id,
          type,
          deltaSeconds,
          metadata: { sessionId, tool: state.tool, ...(action ? { action } : {}) },
        }),
      });
    } catch {
      // Never queue private events across an account change or block learning.
    } finally {
      if (generation === state.generation) posting = false;
    }
  }
  async function refreshPreferences({ recordVisit = false } = {}) {
    const generation = state.generation;
    const revision = state.preferenceRevision;
    if (!current()) return;
    if (
      !preferencesRequest ||
      preferencesRequest.generation !== generation ||
      preferencesRequest.revision !== revision
    ) {
      state.enabled = false;
      state.preferencesReady = false;
      const promise = (async () => {
        try {
          const data = await app.callApi(`${endpoint}/preferences`);
          if (
            generation !== state.generation ||
            revision !== state.preferenceRevision ||
            !current()
          )
            return;
          state.enabled = Boolean(data.preferences?.enabled);
          state.preferencesReady = true;
          lastTick = performance.now();
          lastInteraction = lastTick;
        } catch {
          if (generation === state.generation && revision === state.preferenceRevision && current())
            state.enabled = false;
        }
      })();
      preferencesRequest = { generation, revision, promise };
    }
    const request = preferencesRequest;
    await request.promise;
    if (preferencesRequest === request) preferencesRequest = null;
    if (
      generation === state.generation &&
      revision === state.preferenceRevision &&
      current() &&
      recordVisit
    )
      post('navigation', 'visit');
  }
  async function recordLearningChoice(value) {
    const choice = normalizeLearningChoice(value);
    if (!choice || state.busy || !current()) return false;
    const generation = state.generation;
    if (!state.preferencesReady) await refreshPreferences();
    if (generation !== state.generation || state.busy || !state.enabled || !current()) return false;
    if (
      !choice.metadata.documentVersion &&
      state.documentVersion &&
      state.context?.course?.slug === choice.courseSlug &&
      state.context?.node?.id === choice.nodeId
    )
      choice.metadata.documentVersion = state.documentVersion;
    try {
      const response = await app.callApi(`${endpoint}/events`, {
        method: 'POST',
        body: JSON.stringify({
          requestKey: crypto.randomUUID(),
          ...choice,
          type: 'action',
          deltaSeconds: 0,
        }),
      });
      return generation === state.generation && current() && Boolean(response.recorded);
    } catch {
      return false;
    }
  }
  function frame(host, title, adminView = false) {
    host.replaceChildren();
    const heading = element('div', undefined, 'learning-data-heading');
    heading.append(element('h3', title));
    const filter = element('select');
    filter.setAttribute('aria-label', '统计时间范围');
    [
      ['7', '近 7 天'],
      ['30', '近 30 天'],
      ['all', '全部记录'],
    ].forEach(([value, label]) => {
      const option = element('option', label);
      option.value = value;
      filter.append(option);
    });
    filter.value = '30';
    heading.append(filter);
    const status = element('p', '', 'learning-data-status');
    status.dataset.learningDataStatus = '';
    status.setAttribute('role', 'status');
    host.append(
      heading,
      element(
        'p',
        adminView
          ? '统计学习参与及自测记录，不作能力评价。仅已授权的过程数据计入参与统计。'
          : '只对你显示。浏览与参与记录不代表掌握程度。',
        'learning-data-caption',
      ),
      status,
    );
    const dataHost = element('div', undefined, 'learning-data-body');
    host.append(dataHost);
    return { filter, dataHost };
  }
  async function exportOwn(host) {
    message(host, '正在导出…');
    const generation = state.generation;
    const pages = [];
    let cursor = '';
    try {
      for (let index = 0; index < 2000; index += 1) {
        const data = await app.callApi(
          `${endpoint}/export${cursor ? `?before=${encodeURIComponent(cursor)}` : ''}`,
        );
        if (generation !== state.generation || !current()) return;
        pages.push(...(data.events || []));
        if (!data.nextCursor) {
          const blob = new Blob(
            [
              JSON.stringify(
                {
                  scope: 'learning_analytics_only',
                  exportedAt: new Date().toISOString(),
                  events: pages,
                },
                null,
                2,
              ),
            ],
            { type: 'application/json;charset=utf-8' },
          );
          const url = URL.createObjectURL(blob);
          const link = element('a');
          link.href = url;
          link.download = `FREEBBS-学习过程-${new Date().toISOString().slice(0, 10)}.json`;
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          message(host, `已导出 ${pages.length} 条过程记录。`);
          return;
        }
        if (String(data.nextCursor) === cursor) throw new Error('导出游标异常，请稍后重试。');
        cursor = String(data.nextCursor);
      }
      throw new Error('记录量较大，请联系管理员分批导出；本次未下载不完整文件。');
    } catch (error) {
      if (generation === state.generation) message(host, error.message || '导出失败。');
    }
  }
  function mountPersonal() {
    if (!personal) return;
    const uid = new URLSearchParams(window.location.search).get('uid');
    personal.replaceChildren();
    personal.hidden = !current() || !canViewOwnProfile(uid, app.userState);
    if (personal.hidden) return;
    const { filter, dataHost } = frame(personal, '我的学习记录');
    const controls = element('div', undefined, 'learning-data-controls');
    const label = element('label', undefined, 'learning-data-switch');
    const check = element('input');
    check.type = 'checkbox';
    label.append(check, element('span', '记录学习过程'));
    const exportButton = element('button', '导出过程记录');
    const deleteButton = element('button', '删除过程记录');
    exportButton.type = 'button';
    deleteButton.type = 'button';
    controls.append(label, exportButton, deleteButton);
    dataHost.before(
      controls,
      element(
        'p',
        '开启后记录访问、活跃时长估计、工具操作，以及你明确选择的起点、目的和路径；不记录笔记、聊天或答案正文。删除后暂停记录，不影响笔记和自测。',
        'learning-data-caption',
      ),
    );
    let revision = 0;
    async function load() {
      revision += 1;
      const request = revision;
      const generation = state.generation;
      message(personal, '正在加载…');
      try {
        const data = await app.callApi(`${endpoint}/summary?window=${filter.value}`);
        if (generation !== state.generation || request !== revision || !current()) return;
        check.checked = Boolean(data.preferences?.enabled);
        state.enabled = check.checked;
        state.preferencesReady = true;
        dataHost.replaceChildren();
        const stats = element('div', undefined, 'learning-data-metrics');
        const process = data.process || {};
        const selftest = data.selftest || {};
        metric(stats, '知识点访问次数', process.visits);
        metric(stats, '活跃时长估计', minutes(process.activeSeconds));
        metric(stats, '正式自测作答', selftest.officialAttempts);
        metric(stats, '练习作答', selftest.practiceAttempts);
        metric(stats, '通过 / 尚未通过', `${selftest.passed || 0} / ${selftest.failed || 0}`);
        metric(stats, '待课程组复核', selftest.pendingReview);
        dataHost.append(stats);
        dataHost.append(
          element(
            'p',
            '自测按作答次数统计，含历史版本；过程记录保留180天。',
            'learning-data-caption',
          ),
        );
        if (process.courses?.length)
          table(
            dataHost,
            ['课程', '访问', '活跃时长估计'],
            process.courses.map((item) => [
              item.name || item.courseName || item.courseSlug,
              item.visits,
              minutes(item.activeSeconds),
            ]),
          );
        else
          dataHost.append(
            element(
              'p',
              check.checked ? '暂时还没有过程记录。' : '过程记录未开启，仍可查看自己的自测结果。',
              'learning-data-caption',
            ),
          );
        renderJourney(dataHost, data.journey, true);
        message(personal, '');
      } catch (error) {
        if (generation === state.generation && request === revision)
          message(personal, error.message || '加载失败。');
      }
    }
    filter.addEventListener('change', load);
    check.addEventListener('change', async () => {
      const desired = check.checked;
      const generation = state.generation;
      check.disabled = true;
      state.enabled = false;
      state.busy = true;
      state.preferenceRevision += 1;
      state.preferencesReady = false;
      preferencesRequest = null;
      try {
        await app.callApi(`${endpoint}/preferences`, {
          method: 'PUT',
          body: JSON.stringify({ enabled: desired }),
        });
        if (generation !== state.generation || !current()) return;
        state.enabled = desired;
        lastTick = performance.now();
        await load();
        message(personal, desired ? '已开启。' : '已暂停记录。');
      } catch (error) {
        if (generation === state.generation) {
          check.checked = !desired;
          message(personal, error.message || '修改失败。');
        }
      } finally {
        if (generation === state.generation) state.busy = false;
        check.disabled = false;
      }
    });
    exportButton.addEventListener('click', () => exportOwn(personal));
    deleteButton.addEventListener('click', async () => {
      if (!window.confirm('删除你的全部学习过程记录并暂停记录？笔记、路径和自测结果会保留。'))
        return;
      const generation = state.generation;
      state.enabled = false;
      state.busy = true;
      state.preferenceRevision += 1;
      state.preferencesReady = false;
      preferencesRequest = null;
      deleteButton.disabled = true;
      try {
        await app.callApi(`${endpoint}/events`, { method: 'DELETE' });
        if (generation !== state.generation || !current()) return;
        await load();
        message(personal, '过程记录已删除，记录已暂停。');
      } catch (error) {
        if (generation === state.generation) message(personal, error.message || '删除失败。');
      } finally {
        if (generation === state.generation) state.busy = false;
        deleteButton.disabled = false;
      }
    });
    load();
  }
  function mountAdmin() {
    if (!admin) return;
    const mount = (state.adminMount || 0) + 1;
    state.adminMount = mount;
    admin.replaceChildren();
    admin.hidden = !current() || !app.userState?.isAdmin;
    if (admin.hidden) return;
    const { filter, dataHost } = frame(admin, '学习数据总览', true);
    let revision = 0;
    const load = async () => {
      revision += 1;
      const request = revision;
      const generation = state.generation;
      message(admin, '正在加载…');
      try {
        const data = await app.callApi(`${endpoint}/admin/overview?window=${filter.value}`);
        if (
          generation !== state.generation ||
          request !== revision ||
          mount !== state.adminMount ||
          !current() ||
          !app.userState?.isAdmin
        )
          return;
        dataHost.replaceChildren();
        const stats = element('div', undefined, 'learning-data-metrics');
        dataHost.append(element('h4', '使用与参与', 'learning-data-subheading'));
        metric(stats, '已授权记录人数', data.enabledUserCount);
        metric(stats, '有过程记录人数', data.processUserCount);
        metric(stats, '知识点访问次数', data.process?.visits);
        metric(stats, '正式自测作答', data.selftest?.officialAttempts);
        dataHost.append(stats);
        dataHost.append(
          element('p', '自测按作答次数统计，包含重复作答和历史版本。', 'learning-data-caption'),
        );
        if (data.limitedSample)
          dataHost.append(
            element('p', '当前样本较少，仅展示事实计数，不作群体结论。', 'learning-data-caption'),
          );
        if (data.courses?.length)
          table(
            dataHost,
            ['课程', '参与人数', '访问', '活跃时长估计'],
            data.courses.map((item) => [
              item.name || item.courseName || item.courseSlug,
              item.users ?? item.userCount,
              item.visits,
              minutes(item.activeSeconds),
            ]),
          );
        renderParticipation(dataHost, data.effectiveness);
        renderEvidence(dataHost, data);
        renderJourney(dataHost, data.journey);
        const users = element('details', undefined, 'learning-data-users');
        users.append(element('summary', '各用户记录'));
        table(
          users,
          ['用户', '参与课程', '访问', '自测作答', '通过 / 尚未通过', '待复核'],
          (data.users || []).map((item) => [
            item.nickname || item.username || String(item.id),
            item.courseCount,
            item.process?.visits,
            item.selftest?.attempts,
            `${item.selftest?.passed || 0} / ${item.selftest?.failed || 0}`,
            item.selftest?.pendingReview,
          ]),
        );
        dataHost.append(users);
        message(admin, '');
      } catch (error) {
        if (
          generation === state.generation &&
          request === revision &&
          mount === state.adminMount &&
          current() &&
          app.userState?.isAdmin
        )
          message(admin, error.message || '加载失败。');
      }
    };
    filter.addEventListener('change', load);
    load();
  }
  function reset({ recordVisit = false } = {}) {
    state.generation += 1;
    state.preferenceRevision += 1;
    state.enabled = false;
    state.busy = false;
    state.preferencesReady = false;
    preferencesRequest = null;
    posting = false;
    if (identityChanged()) {
      sessionUid = String(app.userState?.uid || '');
      sessionToken = app.userState?.token || '';
      sessionId = crypto.randomUUID();
      staleSession = false;
    }
    sessionIsAdmin = Boolean(app.userState?.isAdmin);
    sessionLoggedIn = Boolean(app.userState?.isLoggedIn);
    lastTick = performance.now();
    lastInteraction = lastTick;
    personal?.replaceChildren();
    admin?.replaceChildren();
    mountPersonal();
    mountAdmin();
    if (page && state.context) refreshPreferences({ recordVisit });
  }
  page?.addEventListener('knowledge:loaded', (event) => {
    state.context = event.detail;
    state.documentVersion = null;
    state.tool = page.dataset.learningTool || 'content';
    refreshPreferences({ recordVisit: true });
  });
  page?.addEventListener('knowledge:assessment-updated', (event) => {
    // Read only the current document hash, never the attempt answers carried by this event.
    const version = event.detail?.documentVersion;
    if (current() && typeof version === 'string' && /^[a-f0-9]{64}$/.test(version))
      state.documentVersion = version;
  });
  page?.addEventListener('knowledge:tool-change', (event) => {
    state.tool = event.detail.tool;
    post('navigation', 'tool_open');
  });
  [
    ['knowledge:path-saved', 'path_save'],
    ['knowledge:annotation-saved', 'annotation_save'],
    ['knowledge:contribution-saved', 'contribution_submit'],
  ].forEach(([name, action]) => {
    page?.addEventListener(name, (event) => {
      if (event.detail?.success === false) return;
      post('action', action);
    });
  });
  page?.addEventListener('knowledge:tags-change', (event) => {
    if (event.detail?.changedTag === 'learned' && event.detail?.tags?.learned)
      post('action', 'mark_learned');
  });
  ['pointerdown', 'keydown', 'scroll'].forEach((name) => {
    document.addEventListener(
      name,
      () => {
        lastInteraction = performance.now();
      },
      { passive: true },
    );
  });
  ['visibilitychange', 'focus', 'blur'].forEach((name) => {
    (name === 'visibilitychange' ? document : window).addEventListener(name, () => {
      lastTick = performance.now();
    });
  });
  setInterval(() => {
    const end = performance.now();
    const delta = activeDelta({
      start: lastTick,
      end,
      lastInteraction,
      visible: document.visibilityState === 'visible',
      focused: document.hasFocus(),
    });
    lastTick = end;
    if (delta >= 1) post('engagement', null, Math.floor(delta));
  }, 20000);
  window.addEventListener('freebbs:session-change', () => {
    if (identityChanged()) reset({ recordVisit: true });
    else if (staleSession) {
      // Only an app-confirmed session event can resume after a cross-tab invalidation.
      staleSession = false;
      reset();
    } else if (sessionLoggedIn !== Boolean(app.userState?.isLoggedIn)) reset();
    else if (sessionIsAdmin !== Boolean(app.userState?.isAdmin)) {
      sessionIsAdmin = Boolean(app.userState?.isAdmin);
      mountAdmin();
    }
  });
  window.addEventListener('storage', (event) => {
    if (event.key === 'free_bbs_auth_token' || event.key === null) {
      state.generation += 1;
      state.enabled = false;
      state.preferencesReady = false;
      preferencesRequest = null;
      staleSession = true;
      personal?.replaceChildren();
      admin?.replaceChildren();
      if (personal) personal.hidden = true;
      if (admin) admin.hidden = true;
    }
  });
  window.addEventListener('pageshow', (event) => {
    // BFCache restores this existing document; knowledge:loaded counts new page entries.
    if (event.persisted) reset();
  });
  window.FreeBbsLearningAnalytics = { refresh: reset, recordLearningChoice };
  reset();
})();
