/* Default minimal process records are descriptive, never grades or ability scores. */
(() => {
  const LEVEL_LABELS = {
    new: '第一次学',
    familiar: '不甚熟悉',
    basic: '能独立做题',
    advanced: '完整掌握',
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
    if (seconds === undefined || seconds === null || !Number.isFinite(Number(seconds)))
      return '未提供';
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
    card.append(element('span', label), element('strong', String(value ?? '未提供')));
    if (note) card.append(element('small', note));
    host.append(card);
  }
  function assessmentUnavailable(data) {
    return [
      data?.selftest,
      data?.effectiveness,
      data?.journey,
      data?.insights,
      data?.diagnostics?.quality,
    ].some((part) => part?.assessmentDataStatus === 'not_available');
  }
  function tabs(host, options) {
    const nav = element('div', undefined, 'learning-data-tabs');
    nav.setAttribute('aria-label', '学习记录视图');
    const panels = {};
    const buttons = [];
    const selected = options.some(([key]) => key === host.dataset.currentView)
      ? host.dataset.currentView
      : options[0][0];
    options.forEach(([key, title]) => {
      const button = element('button', title);
      button.type = 'button';
      button.dataset.learningDataView = key;
      button.setAttribute('aria-pressed', String(key === selected));
      const panel = element('section', undefined, 'learning-data-view');
      panel.dataset.learningDataPanel = key;
      panel.hidden = key !== selected;
      panel.setAttribute('aria-label', title);
      button.addEventListener('click', () => {
        host.dataset.currentView = key;
        buttons.forEach(([item, section]) => {
          section.hidden = item !== button;
          item.setAttribute('aria-pressed', String(item === button));
        });
      });
      buttons.push([button, panel]);
      panels[key] = panel;
      nav.append(button);
    });
    host.append(nav, ...Object.values(panels));
    return panels;
  }
  function knowledgeLink(item, label) {
    if (
      !/^[a-z0-9][a-z0-9-]{0,119}$/.test(item.courseSlug || '') ||
      !/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/.test(item.nodeId || '')
    )
      return element('span', label);
    const link = element('a', label, 'learning-data-link');
    const query = new URLSearchParams({ course: item.courseSlug, point: item.nodeId });
    // `view` selects overview/reading; workspace tools use their own canonical key.
    if (item.tool === 'content') query.set('view', 'reading');
    else if (['notes', 'feedback', 'continue', 'resources'].includes(item.tool))
      query.set('tool', item.tool);
    if (['practice', 'mistakes', 'quick'].includes(item.quizView)) query.set('quiz', item.quizView);
    link.href = `/knowledge?${query}`;
    return link;
  }
  function unitTitle(item) {
    const course = window.freeBbsCourseCatalog?.courses?.find(
      (entry) => entry.slug === item.courseSlug,
    );
    const point = course?.knowledgePoints?.find((entry) => entry.id === item.nodeId);
    return point?.name || point?.title || item.nodeName || item.nodeId;
  }
  function renderNextSteps(host, insights) {
    const section = element('section', undefined, 'learning-data-next');
    section.append(element('h4', '接下来可以做什么', 'learning-data-subheading'));
    const list = element('div', undefined, 'learning-data-next-list');
    (insights?.nextSteps || []).slice(0, 6).forEach((item) => {
      const card = element('article', undefined, 'learning-data-next-card');
      card.append(
        element('strong', unitTitle(item)),
        element(
          'p',
          item.reason || item.reasonLabel || '按自己的节奏继续。',
          'learning-data-caption',
        ),
        knowledgeLink(item, item.tool === 'feedback' ? '查看作答与反馈 →' : '回到知识点 →'),
      );
      list.append(card);
    });
    section.append(list);
    if (!list.children.length)
      section.append(
        element(
          'p',
          insights?.assessmentDataStatus === 'not_available'
            ? '作答数据暂不可用，可以继续自己的路径；暂无建议不表示没有回看需要。'
            : insights
              ? '目前没有需要特别回看的记录，可以继续自己的路径，也可以先休息。'
              : '下一步建议暂未提供，可以继续自己的路径。',
          'learning-data-caption',
        ),
      );
    section.append(element('small', '建议不是待办考核，不要求全部完成。', 'learning-data-caption'));
    host.append(section);
  }
  function renderActivity(host, activity, period) {
    if (!activity?.days?.length) return;
    const section = element('section', undefined, 'learning-data-activity');
    section.append(element('h4', '最近的学习节奏', 'learning-data-subheading'));
    let days = activity.days.slice(-14);
    if (
      /^\d{4}-\d{2}-\d{2}$/.test(activity.fromDate || '') &&
      /^\d{4}-\d{2}-\d{2}$/.test(activity.toDate || '')
    ) {
      const byDate = new Map(days.map((day) => [day.date, day]));
      const since = period?.from
        ? new Date(new Date(period.from).getTime() + 8 * 3600000).toISOString().slice(0, 10)
        : activity.fromDate;
      const first = since > activity.fromDate ? since : activity.fromDate;
      const end = new Date(`${activity.toDate}T00:00:00Z`);
      const cursor = new Date(`${first}T00:00:00Z`);
      days = [];
      for (let index = 0; index < 14 && cursor <= end; index += 1) {
        const date = cursor.toISOString().slice(0, 10);
        days.push(byDate.get(date) || { date, unrecorded: true });
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }
    const chart = element('div', undefined, 'learning-data-timeline');
    chart.setAttribute('aria-label', '最近十四天学习活动，按北京时间自然日');
    const max = Math.max(
      1,
      ...days.map((day) => Number(day.visits || 0) + Number(day.attempts || 0)),
    );
    days.forEach((day) => {
      const cell = element('div', undefined, 'learning-data-day');
      cell.tabIndex = 0;
      const bar = element('span', undefined, 'learning-data-day-bar');
      const count = Math.max(0, Number(day.visits || 0) + Number(day.attempts || 0));
      bar.style.height = `${Math.max(0, Math.min(72, (count / max) * 72))}%`;
      cell.title = day.unrecorded
        ? `${day.date}：没有活动记录，不表示没有学习。`
        : `${day.date}：访问 ${day.visits || 0} 次，${activity.assessmentDataStatus === 'not_available' ? '作答数据暂不可用' : `作答 ${day.attempts || 0} 次`}；活跃时长估计 ${minutes(day.activeSeconds)}`;
      cell.setAttribute('aria-label', cell.title);
      cell.append(bar, element('small', String(day.date).slice(5)));
      chart.append(cell);
    });
    section.append(
      chart,
      element(
        'p',
        activity.assessmentDataStatus === 'not_available'
          ? '显示所选时间范围内最近 14 天。空白表示没有记录，不表示没有学习；柱高为访问次数，作答数据暂不可用。'
          : '显示所选时间范围内最近 14 天。空白表示没有记录，不表示没有学习；柱高为访问与作答次数。',
        'learning-data-caption',
      ),
    );
    host.append(section);
  }
  function renderDiagnostics(host, data) {
    const diagnostics = data.diagnostics;
    if (!diagnostics) {
      host.append(element('p', '覆盖与数据质量分析暂未提供。', 'learning-data-caption'));
      return;
    }
    const coverage = diagnostics.coverage || {};
    const stats = element('div', undefined, 'learning-data-metrics');
    metric(
      stats,
      '本期有学习证据',
      `${coverage.observedLearners ?? '未提供'} 人`,
      '过程记录或业务作答，按用户去重。',
    );
    metric(stats, '有过程记录', `${coverage.processLearners ?? '未提供'} 人`);
    metric(stats, '有作答记录', `${coverage.businessLearners ?? '未提供'} 人`);
    metric(
      stats,
      '只有作答证据',
      `${coverage.businessOnlyLearners ?? '未提供'} 人`,
      '无过程记录不等于未使用或未学习。',
    );
    host.append(stats);
    const quality = diagnostics.quality || {};
    const details = element('details', undefined, 'learning-data-evidence-scope');
    details.append(element('summary', '数据覆盖与缺口'));
    table(
      details,
      ['检查项', '数量'],
      [
        [
          '系统用户总数（不是本期活跃学生）',
          coverage.eligibleUsers ??
            coverage.registeredUsers ??
            coverage.registeredLearners ??
            '未提供',
        ],
        ['已配置自动记录的账户（不是本期活跃人数）', data.enabledUserCount ?? '未提供'],
        ['有记录的用户 × 知识点', coverage.observedUnits ?? '未提供'],
        ['起点未记录的单元', quality.missingStartUnits ?? '未提供'],
        ['目的未选择的单元', quality.missingGoalUnits ?? '未提供'],
        ['选择时正文版本未知的单元', quality.unknownChoiceVersionUnits ?? '未提供'],
        ['选择之前已有作答的单元', quality.preChoiceAttemptUnits ?? '未提供'],
        ['同一时刻无法确定先后的单元', quality.ambiguousTimeUnits ?? '未提供'],
        [
          '题目或版本字段缺失的作答',
          assessmentUnavailable(data)
            ? '未提供'
            : (quality.missingAssessmentIdentityAttempts ?? '未提供'),
        ],
        [
          '练习 / 探索用途未确认的作答',
          assessmentUnavailable(data)
            ? '未提供'
            : (quality.explorationUnattributedAttempts ?? '未提供'),
        ],
      ],
    );
    host.append(details);
    const attention = element('details', undefined, 'learning-data-next');
    attention.append(element('summary', '课程支持待办（课程部）', 'learning-data-subheading'));
    if (assessmentUnavailable(data))
      attention.append(
        element('p', '作答数据暂不可用，不能判断复核或订正待办。', 'learning-data-caption'),
      );
    else if (diagnostics.attention?.length)
      table(
        attention,
        ['知识点', '待复核作答（次数）', '等待新证据（题目组）'],
        diagnostics.attention.map((item) => [
          `${item.courseName || item.courseSlug} · ${unitTitle(item)}`,
          item.pendingReviewAttempts,
          item.waitingForRetryQuestions,
        ]),
      );
    else
      attention.append(
        element('p', '当前记录中没有待处理的复核或订正证据。', 'learning-data-caption'),
      );
    attention.append(
      element(
        'p',
        '用于发现内容或支持需求，不给同学贴标签；暂无复测不视为失败。',
        'learning-data-caption',
      ),
    );
    host.append(attention);
  }
  function renderEvidence(host, data) {
    const section = element('section', undefined, 'learning-data-evidence');
    if (!data.effectiveness || data.effectiveness.assessmentDataStatus === 'not_available') {
      section.append(
        element('h4', '学习变化证据'),
        element(
          'p',
          '学习变化证据暂不可用，不能由使用统计推断学习效果。作答数据不可用不代表零作答。',
          'learning-data-caption',
        ),
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
    const comparable = evidence.comparableSequences;
    const failed = evidence.failedComparableSequences;
    metric(stats, '本期正式自测参与', `${evidence.officialLearners ?? '未提供'} 人`);
    metric(
      stats,
      '可比较的同题复测',
      `${comparable ?? '未提供'} 组`,
      `${evidence.comparableLearners ?? '未提供'} 人；每组至少两次正式已判定作答。`,
    );
    metric(
      stats,
      '未通过后再次通过',
      failed == null
        ? '未提供'
        : failed
          ? `${evidence.improvedSequences ?? '未提供'} / ${failed} 组`
          : '暂无样本',
      failed
        ? `本期首个结果未通过且有复测；${evidence.improvedLearners ?? '未提供'} / ${evidence.failedComparableLearners ?? '未提供'} 人至少一组再次通过。`
        : '仅比较本期首个已判定结果为未通过、且有复测的组。',
    );
    metric(
      stats,
      '未通过后暂无已判定复测',
      `${evidence.notRetriedFailedSequences ?? '未提供'} 组`,
      `${evidence.notRetriedFailedLearners ?? '未提供'} 人；缺少后续证据，不计为失败。`,
    );
    metric(
      stats,
      '通过后再次未通过',
      `${evidence.regressedSequences ?? '未提供'} 组`,
      `${evidence.regressedLearners ?? '未提供'} 人；可进一步了解困难。`,
    );
    section.append(stats);
    if (comparable === 0)
      section.append(
        element('p', '尚无可比较的复测样本，暂不能判断本期作答变化。', 'learning-data-caption'),
      );
    else if (comparable == null)
      section.append(
        element('p', '复测样本字段暂未提供，不能当作零样本。', 'learning-data-caption'),
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
          `${course.comparableSequences ?? '未提供'} 组 · ${course.comparableLearners ?? '未提供'} 人`,
          course.failedComparableSequences == null
            ? '未提供'
            : course.failedComparableSequences
              ? `${course.improvedSequences ?? '未提供'} / ${course.failedComparableSequences} 组`
              : '暂无样本',
          `${course.notRetriedFailedSequences ?? '未提供'} 组`,
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
        '仅统计已记录的工具打开与操作，不读取笔记或聊天内容；使用不代表已经受益。',
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
    const unavailable = journey.assessmentDataStatus === 'not_available';
    if (unavailable)
      section.append(
        element(
          'p',
          '作答数据暂不可用；下方仍保留已有起点、路径与过程记录。',
          'learning-data-caption',
        ),
      );
    if (personalView) {
      const search = element('input', undefined, 'learning-data-search');
      search.type = 'search';
      search.placeholder = '查找课程或知识点';
      search.setAttribute('aria-label', '查找自己的课程或知识点记录');
      section.append(search);
      const list = element('div', undefined, 'learning-data-unit-list');
      (journey.units || []).forEach((unit) => {
        const card = element('article', undefined, 'learning-data-unit');
        const course = window.freeBbsCourseCatalog?.courses?.find(
          (item) => item.slug === unit.courseSlug,
        );
        const point = course?.knowledgePoints?.find((item) => item.id === unit.nodeId);
        const heading = element('div', undefined, 'learning-data-unit-heading');
        heading.append(
          element('strong', point?.name || point?.title || unit.nodeName || unit.nodeId),
        );
        const link = element('a', '回到知识点 →');
        link.href = `/knowledge?${new URLSearchParams({ course: unit.courseSlug, point: unit.nodeId })}`;
        heading.append(link);
        const choice = unit.currentChoice;
        card.dataset.search =
          `${course?.name || ''} ${unit.courseName || ''} ${unit.courseSlug || ''} ${point?.name || point?.title || ''} ${unit.nodeName || ''} ${unit.nodeId || ''}`.toLowerCase();
        card.append(
          element(
            'small',
            course?.name || unit.courseName || unit.courseSlug,
            'learning-data-caption',
          ),
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
          ['订正后曾通过', unit.correctedQuestions],
          ['待复核', unit.pendingReview],
          ['已确认探索作答', unit.explorationAttempts],
        ].forEach(([label, count]) =>
          facts.append(element('span', `${label} ${unavailable ? '未提供' : (count ?? '未提供')}`)),
        );
        card.append(facts);
        if (
          !unavailable &&
          (unit.explorationEvidenceKnown === false || unit.explorationUnattributedAttempts)
        )
          card.append(
            element(
              'small',
              `另有 ${unit.explorationUnattributedAttempts ?? '未提供'} 次非正式作答的练习 / 探索用途未确认。`,
              'learning-data-caption',
            ),
          );
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
      const searchStatus = element('p', '', 'learning-data-caption');
      searchStatus.setAttribute('role', 'status');
      search.addEventListener('input', () => {
        const query = search.value.trim().toLowerCase();
        let matches = 0;
        Array.from(list.children).forEach((card) => {
          card.hidden = !card.dataset.search.includes(query);
          if (!card.hidden) matches += 1;
        });
        searchStatus.textContent = query ? `找到 ${matches} 个知识点记录。` : '';
      });
      section.append(searchStatus);
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
        `${journey.learners ?? '未提供'} 人；每名学生的每个知识点计一个单元。`,
      );
      metric(
        stats,
        '起点已明确',
        `${journey.classifiedUnits ?? '未提供'} / ${journey.observedUnits ?? '未提供'}`,
        `起点缺失 ${journey.missingStartUnits ?? '未提供'} 个，不推断为初学者。`,
      );
      metric(
        stats,
        '目的未选择',
        journey.classifiedUnits === 0
          ? '暂无起点记录'
          : `${journey.missingGoalUnits ?? '未提供'} / ${journey.classifiedUnits ?? '未提供'}`,
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
            '订正曾通过',
            '探索作答',
          ],
          journey.cohorts.map((cohort) => [
            `${LEVEL_LABELS[cohort.level] || '未知'} / ${GOAL_LABELS[cohort.goal] || '未选择'}`,
            `${cohort.units}（${cohort.learners}人${cohort.limitedSample ? '，少于5人' : ''}）`,
            `${cohort.selectedPathUnits} / ${cohort.units}`,
            unavailable ? '未提供' : `${cohort.attemptedUnits} / ${cohort.units}`,
            unavailable ? '未提供' : `${cohort.gradedOfficialUnits} / ${cohort.units}`,
            unavailable ? '未提供' : `${cohort.retryUnits} / ${cohort.units}`,
            unavailable ? '未提供' : `${cohort.correctedUnits} / ${cohort.units}`,
            unavailable ? '未提供' : `${cohort.explorationAttemptUnits} / ${cohort.units}`,
          ]),
        );
      else section.append(element('p', '尚无明确起点记录。', 'learning-data-caption'));
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
        '正式自测指当前记录中的正式作答，不表示当前题目全集已经通过。同题订正不等于长期掌握或迁移，不能证明平台因果效果；本分析不读取私人批注、原始聊天和答案正文，课程作答复核仍按原有权限。',
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
      values.forEach((value) => line.append(element('td', String(value ?? '未提供'))));
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
    const reload = element('button', '刷新');
    reload.type = 'button';
    reload.className = 'learning-data-refresh';
    heading.append(filter, reload);
    const status = element('p', '', 'learning-data-status');
    status.dataset.learningDataStatus = '';
    status.setAttribute('role', 'status');
    host.append(
      heading,
      element(
        'p',
        adminView
          ? '战略部观察平台设计对学习与发展的支持；课程内容和题目问题由课程部跟进。本分析不读取私人批注、聊天或答案正文。'
          : '回看自己的学习证据，选择下一步。浏览与参与记录不代表掌握程度。',
        'learning-data-caption',
      ),
      status,
    );
    const dataHost = element('div', undefined, 'learning-data-body');
    host.append(dataHost);
    return { filter, dataHost, reload };
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
    const mount = (state.personalMount || 0) + 1;
    state.personalMount = mount;
    const uid = new URLSearchParams(window.location.search).get('uid');
    personal.replaceChildren();
    personal.hidden = !current() || !canViewOwnProfile(uid, app.userState);
    if (personal.hidden) return;
    const { filter, dataHost, reload } = frame(personal, '我的学习记录');
    const controls = element('div', undefined, 'learning-data-controls');
    const exportButton = element('button', '导出过程记录');
    const deleteButton = element('button', '清空过程记录');
    exportButton.type = 'button';
    deleteButton.type = 'button';
    controls.append(
      element('span', '学习过程自动记录', 'learning-data-caption'),
      exportButton,
      deleteButton,
    );
    dataHost.before(
      controls,
      element(
        'p',
        '默认记录访问、活跃时长估计和学习操作，保留 180 天。私人批注、聊天和答案正文不进入过程统计；清空不影响笔记、自测，也不停止后续记录。',
        'learning-data-caption',
      ),
    );
    let revision = 0;
    async function load() {
      revision += 1;
      const request = revision;
      const generation = state.generation;
      // Do not label the previous window's data as the newly selected period.
      dataHost.replaceChildren();
      message(personal, '正在加载…');
      try {
        const data = await app.callApi(`${endpoint}/summary?window=${filter.value}`);
        if (
          generation !== state.generation ||
          request !== revision ||
          mount !== state.personalMount ||
          !current()
        )
          return;
        state.enabled = Boolean(data.preferences?.enabled);
        state.preferencesReady = true;
        dataHost.replaceChildren();
        const views = tabs(dataHost, [
          ['overview', '学习近况'],
          ['units', '知识点记录'],
          ['assessment', '作答复盘'],
        ]);
        const stats = element('div', undefined, 'learning-data-metrics');
        const process = data.process || {};
        const selftest = assessmentUnavailable(data) ? {} : data.selftest || {};
        metric(stats, '有证据的知识点', data.journey?.observedUnits ?? '未提供');
        metric(stats, '活跃时长估计', minutes(process.activeSeconds));
        metric(stats, '正式自测作答', selftest.officialAttempts);
        metric(stats, '待课程组复核', selftest.pendingReview);
        views.overview.append(stats);
        renderNextSteps(views.overview, data.insights);
        renderActivity(views.overview, data.activity, data.period);
        const outcomes = element('div', undefined, 'learning-data-metrics');
        metric(outcomes, '正式自测作答', selftest.officialAttempts);
        metric(outcomes, '练习作答', selftest.practiceAttempts);
        metric(
          outcomes,
          '通过 / 尚未通过',
          `${selftest.passed ?? '未提供'} / ${selftest.failed ?? '未提供'}`,
          '正式已判定作答次数，含重复作答。',
        );
        metric(outcomes, '待课程组复核', selftest.pendingReview);
        views.assessment.append(outcomes);
        if (assessmentUnavailable(data))
          views.assessment.append(
            element(
              'p',
              '作答数据暂不可用，不表示没有作答。已有过程记录仍可查看。',
              'learning-data-caption',
            ),
          );
        views.assessment.append(
          element(
            'p',
            '自测按作答次数统计，含历史版本；过程记录保留180天。练习不计入正式通过，重复作答不等于多掌握一个知识点。',
            'learning-data-caption',
          ),
        );
        if (process.courses?.length)
          table(
            views.overview,
            ['课程', '访问', '活跃时长估计'],
            process.courses.map((item) => [
              item.name || item.courseName || item.courseSlug,
              item.visits,
              minutes(item.activeSeconds),
            ]),
          );
        else
          views.overview.append(
            element('p', '暂时还没有过程记录。没有记录不表示没有学习。', 'learning-data-caption'),
          );
        renderJourney(views.units, data.journey, true);
        if (data.effectiveness) renderEvidence(views.assessment, data);
        message(personal, '');
        return true;
      } catch (error) {
        if (
          generation === state.generation &&
          request === revision &&
          mount === state.personalMount &&
          current()
        )
          message(personal, error.message || '加载失败。');
        return false;
      }
    }
    filter.addEventListener('change', load);
    reload.addEventListener('click', load);
    exportButton.addEventListener('click', () => exportOwn(personal));
    deleteButton.addEventListener('click', async () => {
      if (
        !window.confirm(
          '清空全部历史过程记录？笔记、路径和自测结果会保留，之后的学习仍会自动记录。',
        )
      )
        return;
      const generation = state.generation;
      const wasEnabled = state.enabled;
      state.enabled = false;
      state.busy = true;
      state.preferenceRevision += 1;
      state.preferencesReady = false;
      preferencesRequest = null;
      deleteButton.disabled = true;
      try {
        const deleted = await app.callApi(`${endpoint}/events`, { method: 'DELETE' });
        if (generation !== state.generation || !current()) return;
        // A confirmed deletion is independent of whether the follow-up summary loads.
        // Do not keep rendering erased history or stop recording on a refresh failure.
        state.enabled = deleted.preferences?.enabled !== false;
        state.preferencesReady = true;
        dataHost.replaceChildren();
        const loaded = await load();
        if (generation !== state.generation || !current()) return;
        lastTick = performance.now();
        message(
          personal,
          loaded
            ? '历史过程记录已清空，后续学习继续自动记录。'
            : '历史过程记录已清空，统计刷新失败；后续学习仍自动记录，请点击刷新查看。',
        );
      } catch (error) {
        if (generation === state.generation && current()) {
          state.enabled = wasEnabled;
          state.preferencesReady = true;
          message(personal, error.message || '清空失败，原有记录仍保留。');
        }
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
    const { filter, dataHost, reload } = frame(admin, '学习平台观察', true);
    let revision = 0;
    const load = async () => {
      revision += 1;
      const request = revision;
      const generation = state.generation;
      dataHost.replaceChildren();
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
        const views = tabs(dataHost, [
          ['overview', '平台使用'],
          ['evidence', '学习支持证据'],
          ['journey', '学习路径'],
          ['users', '记录明细'],
        ]);
        const stats = element('div', undefined, 'learning-data-metrics');
        const unavailable = assessmentUnavailable(data);
        views.overview.append(element('h4', '学习页面使用与参与', 'learning-data-subheading'));
        views.overview.append(
          element(
            'p',
            '当前仅覆盖学习页面；讨论区、工作台、实验室与 PBL 的跨模块发展支持尚未纳入。',
            'learning-data-caption',
          ),
        );
        metric(stats, '知识点访问次数', data.process?.visits);
        metric(stats, '活跃时长估计', minutes(data.process?.activeSeconds));
        metric(stats, '正式自测作答', unavailable ? '未提供' : data.selftest?.officialAttempts);
        metric(stats, '待课程组复核', unavailable ? '未提供' : data.selftest?.pendingReview);
        views.overview.append(stats);
        views.overview.append(
          element('p', '自测按作答次数统计，包含重复作答和历史版本。', 'learning-data-caption'),
        );
        if (data.limitedSample)
          views.overview.append(
            element('p', '当前样本较少，仅展示事实计数，不作群体结论。', 'learning-data-caption'),
          );
        if (data.courses?.length)
          table(
            views.overview,
            ['课程', '参与人数', '访问', '活跃时长估计'],
            data.courses.map((item) => [
              item.name || item.courseName || item.courseSlug,
              item.users ?? item.userCount,
              item.visits,
              minutes(item.activeSeconds),
            ]),
          );
        renderDiagnostics(views.overview, data);
        renderActivity(views.overview, data.activity, data.period);
        renderParticipation(views.overview, data.effectiveness);
        renderEvidence(views.evidence, data);
        views.evidence.append(
          element('p', '延迟保持、新题迁移与平台因果效果：尚未验证。', 'learning-data-caption'),
        );
        renderJourney(views.journey, data.journey);
        if (data.diagnostics?.transitions?.length)
          table(
            views.journey,
            ['参与转移', '有起始证据的单元', '后来参与的单元', '范围'],
            data.diagnostics.transitions.map((item) => [
              item.label ||
                {
                  reading_to_attempt: '阅读之后有作答',
                  practice_to_selftest: '练习之后有正式自测',
                  formal_fail_to_retry: '正式未通过后有复测',
                }[item.id] ||
                '其他参与转移',
              unavailable || item.assessmentDataStatus === 'not_available'
                ? '未提供'
                : item.fromUnits,
              unavailable || item.assessmentDataStatus === 'not_available'
                ? '未提供'
                : item.progressedUnits,
              '本期同一用户、课程与知识点，按时间顺序',
            ]),
          );
        const users = element('details', undefined, 'learning-data-users');
        users.append(element('summary', '各用户记录'));
        users.append(
          element(
            'p',
            '作答列按次数统计，含重复作答和历史版本，不代表当前题库通过或掌握程度。全部作答包含正式自测和练习；接口未提供分项时显示“未分列”。',
            'learning-data-caption',
          ),
        );
        table(
          users,
          [
            '用户',
            '参与课程',
            '访问',
            '全部作答（次数）',
            '正式自测（次数）',
            '练习（次数）',
            '正式通过 / 尚未通过（次数）',
            '待复核（次数）',
          ],
          (data.users || []).map((item) => [
            item.nickname || item.username || String(item.id),
            item.courseCount,
            item.process?.visits,
            unavailable ? '未提供' : (item.selftest?.attempts ?? '未提供'),
            unavailable ? '未提供' : (item.selftest?.officialAttempts ?? '未分列'),
            unavailable ? '未提供' : (item.selftest?.practiceAttempts ?? '未分列'),
            unavailable
              ? '未提供 / 未提供'
              : `${item.selftest?.passed ?? '未提供'} / ${item.selftest?.failed ?? '未提供'}`,
            unavailable ? '未提供' : (item.selftest?.pendingReview ?? '未提供'),
          ]),
        );
        views.users.append(users);
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
    reload.addEventListener('click', load);
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
