/* Voluntary platform research is separate from default process records and formal grades. */
(() => {
  const MODULES = {
    learning: '学习世界',
    discussion: '讨论区',
    workbench: '工作台',
    lab: '实验室',
    creative: '创意工坊',
    max: 'Max',
    pbl: 'PBL 计划',
    development: '发展端',
  };
  const PURPOSES = {
    understand: '理解知识',
    practice: '练习解题',
    explore: '探索研究',
    plan: '规划学习',
    collaborate: '交流协作',
    develop: '学习发展',
  };
  const BARRIERS = {
    content: '内容不够合适',
    navigation: '不容易找到下一步',
    feedback: '反馈不够清楚',
    technical: '加载或显示问题',
    time: '时间或精力不足',
    support: '需要更多帮助',
    none: '暂时没有阻碍',
  };
  const PHASES = {
    baseline: '学习前',
    post: '学习后',
    delayed: '间隔复查',
    transfer: '新情境应用',
  };
  const HELP = ['没有帮助', '帮助较少', '有一些帮助', '帮助较大', '帮助很大'];
  const OUTCOMES = {
    clarity: '理解更清楚',
    independence: '能独立推进',
    direction: '明确下一步',
    exploration: '发现新问题',
    collaboration: '获得协作支持',
    none: '尚未感到变化',
  };
  function feedbackValues(value) {
    if (
      !value ||
      !Object.hasOwn(MODULES, value.module) ||
      !Object.hasOwn(PURPOSES, value.purpose) ||
      !Number.isInteger(value.helpfulness) ||
      value.helpfulness < 0 ||
      value.helpfulness > 4 ||
      !Array.isArray(value.barriers) ||
      value.barriers.length < 1 ||
      value.barriers.length > 3 ||
      new Set(value.barriers).size !== value.barriers.length ||
      value.barriers.some((item) => !Object.hasOwn(BARRIERS, item)) ||
      (value.barriers.includes('none') && value.barriers.length !== 1) ||
      (value.outcomes !== undefined &&
        (!Array.isArray(value.outcomes) ||
          value.outcomes.length > 3 ||
          new Set(value.outcomes).size !== value.outcomes.length ||
          value.outcomes.some((item) => !Object.hasOwn(OUTCOMES, item)) ||
          (value.outcomes.includes('none') && value.outcomes.length !== 1))) ||
      typeof value.comment !== 'string' ||
      value.comment.length > 1000 ||
      value.consent !== true
    )
      return null;
    return {
      module: value.module,
      purpose: value.purpose,
      helpfulness: value.helpfulness,
      barriers: [...value.barriers],
      ...(value.outcomes?.length ? { outcomes: [...value.outcomes] } : {}),
      comment: value.comment.trim(),
      consent: true,
    };
  }
  function percentage(value, suppressed = false) {
    if (suppressed) return '样本不足';
    return value === null || value === undefined || !Number.isFinite(Number(value))
      ? '尚未测量'
      : `${Number(value).toFixed(1)}%`;
  }
  function dateLabel(value) {
    const date = new Date(value);
    return !value || Number.isNaN(date.getTime())
      ? '时间未提供'
      : date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  }
  function visibleOwnProfile(search, user) {
    const uid = new URLSearchParams(search).get('uid');
    return Boolean(user?.isLoggedIn && user.uid && (!uid || uid === String(user.uid)));
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      feedbackValues,
      percentage,
      dateLabel,
      visibleOwnProfile,
      MODULES,
      PURPOSES,
    };
    return;
  }
  const app = window.freeBbsApp;
  if (!app) return;
  const personal = document.querySelector('[data-learning-research-personal]');
  const admin = document.querySelector('[data-learning-research-admin]');
  if (!personal && !admin) return;
  const page = document.querySelector('[data-knowledge-page]');
  const endpoint = '/learning/research';
  const loadedHosts = new WeakSet();
  const state = {
    generation: 0,
    uid: '',
    token: '',
    isAdmin: false,
    loggedIn: false,
    stale: false,
  };
  const el = (tag, text, className) => {
    const item = document.createElement(tag);
    if (text !== undefined) item.textContent = text;
    if (className) item.className = className;
    return item;
  };
  const identityChanged = () =>
    state.uid !== String(app.userState?.uid || '') || state.token !== (app.userState?.token || '');
  const current = () =>
    !state.stale &&
    !identityChanged() &&
    Boolean(app.userState?.isLoggedIn && state.uid && state.token);
  const scope = (host, adminView) =>
    current() &&
    host.isConnected !== false &&
    (adminView
      ? Boolean(app.userState?.isAdmin)
      : visibleOwnProfile(window.location.search, app.userState));
  function fence(host, adminView = false) {
    const generation = state.generation;
    const mount = host.dataset.researchMount;
    return () =>
      generation === state.generation &&
      mount === host.dataset.researchMount &&
      scope(host, adminView);
  }
  function button(text, action) {
    const item = el('button', text);
    item.type = 'button';
    if (action) item.dataset.researchAction = action;
    return item;
  }
  function selectField(label, entries, optional = false) {
    const field = el('label', undefined, 'learning-research-field');
    const input = el('select');
    const placeholder = el('option', optional ? '不指定' : '请选择');
    placeholder.value = '';
    input.append(placeholder);
    Object.entries(entries).forEach(([value, text]) => {
      const option = el('option', text);
      option.value = value;
      input.append(option);
    });
    input.required = !optional;
    field.append(el('span', label), input);
    return { field, input };
  }
  function textField(label, maxLength, multiline = false) {
    const field = el('label', undefined, 'learning-research-field');
    const input = el(multiline ? 'textarea' : 'input');
    if (!multiline) input.type = 'text';
    input.maxLength = maxLength;
    field.append(el('span', label), input);
    return { field, input };
  }
  function consent(label) {
    const field = el('label', undefined, 'learning-research-choice');
    const input = el('input');
    input.type = 'checkbox';
    input.required = true;
    field.append(input, el('span', label));
    return { field, input };
  }
  function formStatus() {
    const status = el('p', '', 'learning-research-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    return status;
  }
  function frame(host, title) {
    host.replaceChildren();
    host.dataset.researchMount = crypto.randomUUID();
    host.classList.add('learning-research-panel');
    const heading = el('div', undefined, 'learning-research-heading');
    const reload = button('刷新', 'refresh');
    heading.append(el('h3', title), reload);
    const status = formStatus();
    host.append(heading, status);
    return { reload, status };
  }
  function table(host, columns, rows) {
    const wrap = el('div', undefined, 'learning-research-table-wrap');
    wrap.tabIndex = 0;
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', columns.join('、'));
    const node = el('table', undefined, 'learning-research-table');
    const head = el('thead');
    const tr = el('tr');
    columns.forEach((name) => {
      const th = el('th', name);
      th.setAttribute('scope', 'col');
      tr.append(th);
    });
    head.append(tr);
    const body = el('tbody');
    rows.forEach((values) => {
      const row = el('tr');
      values.forEach((value) => row.append(el('td', String(value ?? '未提供'))));
      body.append(row);
    });
    node.append(head, body);
    wrap.append(node);
    host.append(wrap);
  }
  function metric(host, title, value, caption) {
    const item = el('article', undefined, 'learning-research-metric');
    item.append(el('span', title), el('strong', String(value ?? '未提供')));
    if (caption) item.append(el('small', caption));
    host.append(item);
  }
  function renderEligibility(host, stages, title, folded = true) {
    if (!stages?.some((stage) => stage.eligibility)) return;
    const section = el(folded ? 'details' : 'section');
    section.append(el(folded ? 'summary' : 'h5', title));
    section.append(
      el(
        'p',
        '开放状态由服务端判定；未到时间或前置任务尚未完成，不算已可提交但未交，也不能据此判定流失。',
        'learning-research-caption',
      ),
    );
    if (stages.some((stage) => stage.eligibility?.available === false))
      section.append(
        el(
          'p',
          '数据不完整，暂不分类；受影响阶段显示“未提供”，不能补为零。',
          'learning-research-warning',
        ),
      );
    table(
      section,
      ['阶段', '已可提交但未交', '未到开放时间', '前置任务未完成', '已满足开放条件（含已交）'],
      stages.map((stage) => {
        const counts = stage.eligibility?.available === false ? null : stage.eligibility;
        return [
          PHASES[stage.phase] || stage.phase,
          counts?.awaitingSubmissionCount,
          counts?.notYetDueCount,
          counts?.missingPrerequisiteCount,
          counts?.eligibleCount,
        ];
      }),
    );
    host.append(section);
  }
  function revealInitialAnchor(host) {
    if (loadedHosts.has(host)) return;
    loadedHosts.add(host);
    if (host.id && window.location.hash === `#${host.id}`)
      host.scrollIntoView?.({ block: 'start' });
  }
  function choicesField(title, entries, name) {
    const field = el('fieldset', undefined, 'learning-research-field-wide');
    field.append(el('legend', title));
    const options = el('div', undefined, 'learning-research-options');
    const checks = [];
    Object.entries(entries).forEach(([value, label]) => {
      const choice = consent(label);
      choice.input.required = false;
      choice.input.value = value;
      choice.input.name = name;
      choice.input.addEventListener('change', () => {
        if (choice.input.checked && value === 'none')
          checks.forEach((item) => {
            if (item !== choice.input) item.checked = false;
          });
        else if (choice.input.checked) {
          const none = checks.find((item) => item.value === 'none');
          if (none) none.checked = false;
        }
      });
      checks.push(choice.input);
      options.append(choice.field);
    });
    field.append(options);
    return { field, checks };
  }
  function feedbackForm(host, load) {
    const allowed = fence(host);
    const details = el('details', undefined, 'learning-research-form');
    details.append(el('summary', '告诉我们哪里有帮助、哪里不顺手'));
    const form = el('form');
    const fields = el('div', undefined, 'learning-research-fields');
    const module = selectField('使用的部分', MODULES);
    const purpose = selectField('当时想做什么', PURPOSES);
    const helpfulness = selectField(
      '对这件事的帮助',
      Object.fromEntries(HELP.map((name, i) => [i, name])),
    );
    module.input.name = 'module';
    purpose.input.name = 'purpose';
    helpfulness.input.name = 'helpfulness';
    if (page) module.input.value = 'learning';
    fields.append(module.field, purpose.field, helpfulness.field);
    const barriers = choicesField('遇到的阻碍（最多选 3 项）', BARRIERS, 'barrier');
    const outcomes = choicesField('自己感到的变化（可选，最多选 3 项）', OUTCOMES, 'outcome');
    const comment = textField('补充说明（可选，仅自己可查看原文）', 1000, true);
    comment.input.name = 'comment';
    comment.field.classList.add('learning-research-field-wide');
    fields.append(barriers.field, outcomes.field, comment.field);
    const agreement = consent(
      '自愿提供这次反馈，用于平台改进研究；管理员只看分类汇总，不查看这段原文。',
    );
    agreement.input.name = 'consent';
    const save = button('提交反馈', 'feedback-submit');
    save.type = 'submit';
    const status = formStatus();
    form.append(fields, agreement.field, save, status);
    details.append(form);
    host.append(details);
    let busy = false;
    let pendingKey;
    let pendingBody;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy || !allowed()) return;
      const body = feedbackValues({
        module: module.input.value,
        purpose: purpose.input.value,
        helpfulness: helpfulness.input.value === '' ? NaN : Number(helpfulness.input.value),
        barriers: barriers.checks.filter((item) => item.checked).map((item) => item.value),
        outcomes: outcomes.checks.filter((item) => item.checked).map((item) => item.value),
        comment: comment.input.value,
        consent: agreement.input.checked,
      });
      if (!body) {
        status.textContent =
          '请选择使用部分、目标和帮助程度，选择 1—3 项阻碍，并确认自愿提供。变化可不选，最多 3 项；“尚未感到变化”请单选。';
        return;
      }
      const serialized = JSON.stringify(body);
      if (serialized !== pendingBody) {
        pendingBody = serialized;
        pendingKey = crypto.randomUUID();
      }
      busy = true;
      save.disabled = true;
      status.textContent = '正在提交…';
      try {
        await app.callApi(`${endpoint}/feedback`, {
          method: 'POST',
          body: JSON.stringify({ ...body, requestKey: pendingKey }),
        });
        if (!allowed()) return;
        form.reset();
        if (page) module.input.value = 'learning';
        pendingBody = undefined;
        pendingKey = undefined;
        status.textContent = '已保存。可以在下面查看或删除这次反馈。';
        await load();
      } catch (error) {
        if (allowed()) status.textContent = error.message || '提交未完成，内容仍保留，请稍后重试。';
      } finally {
        if (allowed()) {
          busy = false;
          save.disabled = false;
        }
      }
    });
  }
  function renderFeedback(host, items, panel, load) {
    const details = el('details');
    details.append(el('summary', `我提供的反馈（${items.length} 条）`));
    if (!items.length)
      details.append(el('p', '还没有提供反馈，不影响正常使用。', 'learning-research-caption'));
    const records = el('div');
    details.append(records);
    host.append(details);
    let shown = 0;
    const more = button('显示更多反馈', 'feedback-more');
    const renderMore = () => {
      const batch = items.slice(shown, shown + 30);
      shown += batch.length;
      batch.forEach((item) => {
        const card = el('article', undefined, 'learning-research-card');
        card.append(
          el(
            'strong',
            `${MODULES[item.module] || '其他部分'} · ${PURPOSES[item.purpose] || '其他目标'}`,
          ),
          el(
            'p',
            `${HELP[item.helpfulness] || '未提供'} · ${dateLabel(item.createdAt)}`,
            'learning-research-caption',
          ),
          el('p', (item.barriers || []).map((value) => BARRIERS[value] || '其他阻碍').join('、')),
        );
        if (item.comment) card.append(el('p', item.comment, 'learning-research-quote'));
        if (item.outcomes?.length)
          card.append(
            el(
              'p',
              `自己感到的变化：${item.outcomes.map((value) => OUTCOMES[value] || '其他变化').join('、')}`,
              'learning-research-caption',
            ),
          );
        const remove = button('删除这次反馈', 'feedback-delete');
        const status = formStatus();
        const allowed = fence(panel);
        remove.addEventListener('click', async () => {
          if (
            remove.disabled ||
            !allowed() ||
            !window.confirm('删除后不再纳入后续平台研究汇总。确认删除这次反馈？')
          )
            return;
          remove.disabled = true;
          try {
            await app.callApi(`${endpoint}/feedback/${encodeURIComponent(item.id)}`, {
              method: 'DELETE',
            });
            if (!allowed()) return;
            card.remove();
            await load();
          } catch (error) {
            if (allowed()) {
              remove.disabled = false;
              status.textContent = error.message || '删除未完成，请稍后重试。';
            }
          }
        });
        card.append(remove, status);
        records.append(card);
      });
      more.hidden = shown >= items.length;
    };
    more.addEventListener('click', renderMore);
    details.append(more);
    renderMore();
  }
  function renderStudy(host, study, own, panel, load) {
    const allowed = fence(panel);
    const card = el('article', undefined, 'learning-research-card');
    card.dataset.researchStudy = study.id;
    card.append(
      el('h4', study.title),
      el('p', study.description || '', 'learning-research-caption'),
    );
    card.append(
      el(
        'p',
        '自愿参与，不计入课程成绩或星标。可以只用平台，不参加研究。',
        'learning-research-caption',
      ),
    );
    const status = formStatus();
    const enrollment = (own.enrollments || []).find((item) => item.studyId === study.id);
    if (!study.enrolled) {
      const form = el('form');
      const goal = selectField('这次希望研究什么学习目标', PURPOSES);
      const agreement = consent('自愿参加这项研究，提交的阶段作答用于本人复盘及去标识化汇总。');
      const join = button('参加这项研究', 'study-join');
      join.type = 'submit';
      form.append(goal.field, agreement.field, join, status);
      let busy = false;
      let previous;
      let requestKey;
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (busy || !allowed()) return;
        if (!Object.hasOwn(PURPOSES, goal.input.value) || !agreement.input.checked) {
          status.textContent = '请选择目标，并确认自愿参加。';
          return;
        }
        const payload = { consent: true, goal: goal.input.value };
        const serialized = JSON.stringify(payload);
        if (previous !== serialized) {
          previous = serialized;
          requestKey = crypto.randomUUID();
        }
        busy = true;
        join.disabled = true;
        try {
          await app.callApi(`${endpoint}/studies/${encodeURIComponent(study.id)}/join`, {
            method: 'POST',
            body: JSON.stringify({ ...payload, requestKey }),
          });
          if (allowed()) await load();
        } catch (error) {
          if (allowed()) status.textContent = error.message || '参加未完成，请稍后重试。';
        } finally {
          if (allowed()) {
            busy = false;
            join.disabled = false;
          }
        }
      });
      card.append(form);
    } else if (study.nextPhase && study.questions?.length) {
      const form = el('form');
      form.dataset.researchPhase = study.nextPhase;
      form.append(el('h4', PHASES[study.nextPhase] || '本次任务'));
      const questions = [];
      study.questions.forEach((question) => {
        const field = el('fieldset');
        field.append(el('legend', question.prompt));
        const inputs = [];
        question.options.forEach((option) => {
          const choice = consent(option.label);
          choice.input.type = 'radio';
          choice.input.name = `research-${study.id}-${question.id}`;
          choice.input.value = option.id;
          inputs.push(choice.input);
          field.append(choice.field);
        });
        questions.push({ id: question.id, inputs });
        form.append(field);
      });
      const assistance = selectField('这次作答是否借助帮助', {
        none: '独立完成',
        max: '借助 Max',
        other: '借助其他帮助',
      });
      const submit = button('提交本阶段作答', 'study-attempt');
      submit.type = 'submit';
      form.append(assistance.field, submit, status);
      let busy = false;
      let previous;
      let requestKey;
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (busy || !allowed()) return;
        const answers = Object.create(null);
        for (const question of questions) {
          const selected = question.inputs.find((input) => input.checked);
          if (!selected) {
            status.textContent = '请完成每道题；也可以稍后回来。';
            return;
          }
          answers[question.id] = selected.value;
        }
        if (!['none', 'max', 'other'].includes(assistance.input.value)) {
          status.textContent = '请选择这次作答是否借助帮助。';
          return;
        }
        const body = { phase: study.nextPhase, answers, assistance: assistance.input.value };
        const serialized = JSON.stringify(body);
        if (previous !== serialized) {
          previous = serialized;
          requestKey = crypto.randomUUID();
        }
        busy = true;
        submit.disabled = true;
        status.textContent = '正在提交…';
        try {
          await app.callApi(`${endpoint}/studies/${encodeURIComponent(study.id)}/attempts`, {
            method: 'POST',
            body: JSON.stringify({ ...body, requestKey }),
          });
          if (allowed()) await load();
        } catch (error) {
          if (allowed())
            status.textContent = error.message || '提交未完成，选择仍保留，请稍后重试。';
        } finally {
          if (allowed()) {
            busy = false;
            submit.disabled = false;
          }
        }
      });
      card.append(form);
    } else {
      card.append(
        el(
          'p',
          study.nextPhase
            ? `${PHASES[study.nextPhase] || '下一阶段'}将在 ${dateLabel(study.availableAt)} 后开放。`
            : '本项研究的阶段任务已完成。',
          'learning-research-caption',
        ),
      );
    }
    if (enrollment?.attempts?.length)
      table(
        card,
        ['阶段', '本次得分', '作答方式', '提交时间'],
        enrollment.attempts.map((attempt) => [
          PHASES[attempt.phase] || '其他阶段',
          `${attempt.score} / ${attempt.maxScore}`,
          { none: '独立完成', max: '借助 Max', other: '借助其他帮助' }[attempt.assistance] ||
            '未提供',
          dateLabel(attempt.createdAt),
        ]),
      );
    if (study.enrolled) {
      const withdraw = button('退出并删除这项研究记录', 'study-withdraw');
      const withdrawalStatus = formStatus();
      withdraw.addEventListener('click', async () => {
        if (
          withdraw.disabled ||
          !allowed() ||
          !window.confirm(
            '退出后会删除这项研究的参加信息和阶段作答，不影响笔记、正式自测和星标。确认退出？',
          )
        )
          return;
        withdraw.disabled = true;
        try {
          await app.callApi(`${endpoint}/studies/${encodeURIComponent(study.id)}/participation`, {
            method: 'DELETE',
          });
          if (allowed()) await load();
        } catch (error) {
          if (allowed()) {
            withdrawalStatus.textContent = error.message || '退出未完成，请稍后重试。';
            withdraw.disabled = false;
          }
        }
      });
      card.append(withdraw, withdrawalStatus);
    }
    host.append(card);
  }
  function mountPersonal() {
    if (!personal) return;
    personal.replaceChildren();
    personal.hidden = !scope(personal, false);
    if (personal.hidden) return;
    const { reload, status } = frame(personal, '平台如何帮助我的学习');
    const records = el('div');
    const studiesHost = el('div');
    let revision = 0;
    const allowed = fence(personal);
    async function load() {
      revision += 1;
      const request = revision;
      status.textContent = '正在加载…';
      try {
        const [own, tasks] = await Promise.all([
          app.callApi(`${endpoint}/me`),
          app.callApi(`${endpoint}/studies`),
        ]);
        if (!allowed() || request !== revision) return;
        records.replaceChildren();
        studiesHost.replaceChildren();
        renderFeedback(records, own.feedback || [], personal, load);
        if (own.dataCoverage?.complete === false)
          records.append(
            el('p', '研究记录较多，本次仅显示部分记录。', 'learning-research-warning'),
          );
        studiesHost.append(el('h4', '自愿参加的学习研究'));
        (tasks.studies || []).forEach((study) =>
          renderStudy(studiesHost, study, own, personal, load),
        );
        if (!tasks.studies?.length)
          studiesHost.append(el('p', '目前没有开放的研究任务。', 'learning-research-caption'));
        status.textContent = '';
        revealInitialAnchor(personal);
      } catch (error) {
        if (allowed() && request === revision)
          status.textContent = error.message || '暂时无法加载，可以稍后刷新。';
      }
    }
    personal.append(
      el(
        'p',
        '用具体反馈帮助改进平台；这不是能力评定，也不要求参加。研究记录保留 180 天。',
        'learning-research-caption',
      ),
    );
    feedbackForm(personal, load);
    personal.append(records, studiesHost);
    reload.addEventListener('click', load);
    load();
  }
  function researchCreate(host, load) {
    const allowed = fence(host, true);
    const details = el('details', undefined, 'learning-research-form');
    details.append(el('summary', '发布一项平台学习研究'));
    const form = el('form');
    const fields = el('div', undefined, 'learning-research-fields');
    const definitions = [
      ['title', '研究名称', 120, false],
      ['description', '参与者说明', 1200, true],
      ['knowledgeTarget', '要观察的知识或发展目标', 240, true],
      ['comparability', '前后测题目可比性的依据', 600, true],
      ['selectionNote', '招募方式与样本局限', 600, true],
      ['questionVersion', '题目版本（例如 v1）', 64, false],
    ];
    const inputs = {};
    definitions.forEach(([key, label, length, multiline]) => {
      const field = textField(label, length, multiline);
      field.input.name = key;
      field.input.required = true;
      inputs[key] = field.input;
      fields.append(field.field);
    });
    const delay = textField('间隔复查等待小时数（24—720）', 3);
    delay.input.type = 'number';
    delay.input.min = '24';
    delay.input.max = '720';
    delay.input.value = '24';
    delay.input.required = true;
    delay.input.name = 'minDelayedHours';
    fields.append(delay.field);
    const modules = el('fieldset', undefined, 'learning-research-field-wide');
    modules.append(el('legend', '涉及的平台部分'));
    const moduleChecks = [];
    Object.entries(MODULES).forEach(([value, title]) => {
      const item = consent(title);
      item.input.required = false;
      item.input.value = value;
      item.input.name = 'module';
      moduleChecks.push(item.input);
      modules.append(item.field);
    });
    fields.append(modules);
    const questionInputs = {};
    Object.entries(PHASES).forEach(([phase, label]) => {
      const field = textField(`${label}：单选题 JSON（1—8 道）`, 20000, true);
      field.field.classList.add('learning-research-field-wide');
      field.input.name = phase;
      field.input.required = true;
      field.input.placeholder =
        '[{"id":"Q1","prompt":"题干","options":[{"id":"a","label":"选项 A"},{"id":"b","label":"选项 B"}],"correctOption":"a"}]';
      questionInputs[phase] = field.input;
      fields.append(field.field);
    });
    const submit = button('发布研究任务', 'study-create');
    submit.type = 'submit';
    const status = formStatus();
    form.append(
      el(
        'p',
        '先与课程部确认任务和判分依据。各题等权，前测、后测、间隔复查题数相同；新情境题用于观察迁移，不自动改变正式成绩。',
        'learning-research-caption',
      ),
      fields,
      submit,
      status,
    );
    details.append(form);
    host.append(details);
    let busy = false;
    let prior;
    let requestKey;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy || !allowed()) return;
      const phases = {};
      try {
        for (const [phase, input] of Object.entries(questionInputs)) {
          phases[phase] = JSON.parse(input.value);
          if (!Array.isArray(phases[phase]) || !phases[phase].length || phases[phase].length > 8)
            throw new Error(`${PHASES[phase]}需要 1—8 道单选题。`);
        }
      } catch (error) {
        status.textContent = `请检查题目 JSON：${error.message}`;
        return;
      }
      const payload = Object.fromEntries(
        Object.entries(inputs).map(([name, input]) => [name, input.value.trim()]),
      );
      payload.phases = phases;
      payload.modules = moduleChecks.filter((input) => input.checked).map((input) => input.value);
      payload.minDelayedHours = Number(delay.input.value);
      if (!payload.modules.length) {
        status.textContent = '请至少选择一个平台部分。';
        return;
      }
      const serialized = JSON.stringify(payload);
      if (serialized !== prior) {
        prior = serialized;
        requestKey = crypto.randomUUID();
      }
      busy = true;
      submit.disabled = true;
      status.textContent = '正在发布…';
      try {
        await app.callApi(`${endpoint}/studies`, {
          method: 'POST',
          body: JSON.stringify({ ...payload, requestKey }),
        });
        if (!allowed()) return;
        form.reset();
        delay.input.value = '24';
        prior = undefined;
        requestKey = undefined;
        status.textContent = '已发布。参与者只能读取当前开放阶段的题目。';
        await load();
      } catch (error) {
        if (allowed()) status.textContent = error.message || '发布未完成，草稿仍保留。';
      } finally {
        if (allowed()) {
          busy = false;
          submit.disabled = false;
        }
      }
    });
  }
  function renderAdmin(host, data) {
    const feedback = data.feedback || {};
    const metrics = el('div', undefined, 'learning-research-metrics');
    metric(metrics, '反馈人数', feedback.respondentCount, '同一用户去重');
    metric(metrics, '反馈条数', feedback.responseCount, '同一人可反馈多次');
    metric(metrics, '注册人数', feedback.registeredUserCount, '不是各模块实际使用人数');
    metric(
      metrics,
      '反馈覆盖',
      percentage(
        feedback.responseCoverage === null || feedback.responseCoverage === undefined
          ? null
          : Number(feedback.responseCoverage) * 100,
      ),
      '反馈人数 / 注册人数；不是满意度',
    );
    metric(
      metrics,
      '主观帮助程度',
      feedback.respondentCount === 0
        ? '尚未收集'
        : feedback.helpfulness?.suppressed
          ? '样本不足'
          : feedback.helpfulness?.mean === null || feedback.helpfulness?.mean === undefined
            ? '尚未收集'
            : `${Number(feedback.helpfulness.mean).toFixed(2)} / 4`,
      '自愿反馈，不是知识掌握',
    );
    host.append(metrics);
    host.append(el('h4', '平台部分与学习目标：分别汇总'));
    host.append(
      el(
        'p',
        '下方按平台部分、学习目标分别统计，尚未交叉分析；不能据此比较同一模块对不同需求人群的帮助差异。',
        'learning-research-caption',
      ),
    );
    table(
      host,
      ['平台部分', '反馈人数', '反馈条数', '主观帮助程度'],
      (feedback.modules || []).map((item) => [
        MODULES[item.module] || item.module,
        item.respondentCount,
        item.responseCount,
        item.respondentCount === 0
          ? '尚未收集'
          : item.suppressed
            ? '样本不足'
            : item.meanHelpfulness === null || item.meanHelpfulness === undefined
              ? '尚未收集'
              : `${Number(item.meanHelpfulness).toFixed(2)} / 4`,
      ]),
    );
    table(
      host,
      ['当时的目标', '反馈人数', '反馈条数'],
      (feedback.purposes || []).map((item) => [
        PURPOSES[item.purpose] || item.purpose,
        item.respondentCount,
        item.responseCount,
      ]),
    );
    table(
      host,
      ['平台使用中的阻碍', '反馈人数', '反馈条数'],
      (feedback.barriers || []).map((item) => [
        BARRIERS[item.barrier] || item.barrier,
        item.respondentCount,
        item.responseCount,
      ]),
    );
    host.append(el('h4', '自报的学习发展变化'));
    host.append(
      el(
        'p',
        `提供变化反馈的 ${feedback.outcomeRespondentCount ?? '未提供'} 人、${feedback.outcomeResponseCount ?? '未提供'} 条；另有 ${feedback.outcomesUnknownResponseCount ?? '未提供'} 条未填写，不能视为“没有变化”。多选合计可能超过反馈人数。`,
        'learning-research-caption',
      ),
    );
    table(
      host,
      ['自己感到的变化', '反馈人数', '反馈条数'],
      (feedback.byOutcome || []).map((item) => [
        OUTCOMES[item.outcome] || item.outcome,
        item.respondentCount,
        item.responseCount,
      ]),
    );
    host.append(
      el(
        'p',
        '这里是本人感受，不等于客观能力提升；“能独立推进”也不是独立作答认证。',
        'learning-research-caption',
      ),
    );
    host.append(el('h4', '知识掌握与应用的测量'));
    (data.studies || []).forEach((study) => {
      const card = el('article', undefined, 'learning-research-card');
      card.append(
        el('h4', study.title),
        el(
          'p',
          `题目版本 ${study.questionVersion} · 参加人数 ${study.participantCount}`,
          'learning-research-caption',
        ),
      );
      card.append(
        el(
          'p',
          '人数按本期报名或作答筛选；“尚未提交”只指这批参与者，不是完整招募队列的流失率。',
          'learning-research-caption',
        ),
      );
      if (study.knowledgeTarget) card.append(el('p', `研究目标：${study.knowledgeTarget}`));
      const design = el('details');
      design.append(el('summary', '任务设计与样本来源'));
      if (study.comparability)
        design.append(
          el('p', `题目可比性依据：${study.comparability}`, 'learning-research-caption'),
        );
      if (study.selectionNote)
        design.append(el('p', `招募与局限：${study.selectionNote}`, 'learning-research-caption'));
      if (study.retainedCohort) {
        design.append(
          el(
            'p',
            `保留期内完整参加队列：${study.retainedCohort.participantCount} 人。未提交不等于退出或没有学习，也可能尚未到开放时间。`,
            'learning-research-caption',
          ),
        );
        table(
          design,
          ['完整队列的阶段', '提交人数', '未提交人数'],
          (study.retainedCohort.stages || []).map((item) => [
            PHASES[item.phase] || item.phase,
            item.submittedCount,
            item.missingCount,
          ]),
        );
        renderEligibility(design, study.retainedCohort.stages, '完整参加队列的未提交情况', false);
      }
      if (study.goals?.length)
        table(
          design,
          ['参与目的', '参加人数'],
          study.goals.map((item) => [PURPOSES[item.goal] || item.goal, item.participantCount]),
        );
      card.append(design);
      table(
        card,
        ['测量阶段', '提交人数', '尚未提交', '独立 / 辅助完成', '平均得分比例'],
        (study.stages || []).map((item) => [
          PHASES[item.phase] || item.phase,
          item.submittedCount,
          item.missingCount,
          `${item.independentCount} / ${item.assistedCount}`,
          percentage(item.meanPercent, item.suppressed && item.submittedCount > 0),
        ]),
      );
      renderEligibility(card, study.stages, '本期参与者的未提交情况');
      const paired = study.paired || {};
      card.append(
        el(
          'p',
          `有前后测配对的 ${paired.pairCount ?? 0} 人；其中独立配对 ${paired.independentPairCount ?? 0} 人，含帮助的 ${paired.assistedPairCount ?? 0} 人。`,
          'learning-research-caption',
        ),
      );
      card.append(
        el(
          'p',
          `配对平均变化：${paired.pairCount === 0 ? '尚未测量' : paired.suppressed ? '样本不足' : paired.meanChange === null || paired.meanChange === undefined ? '尚未测量' : `${Number(paired.meanChange).toFixed(1)} 个百分点`}。这不是平台造成提升的因果证明。`,
          'learning-research-warning',
        ),
      );
      const change = (value, count) =>
        !count
          ? '尚未测量'
          : value === null || value === undefined
            ? '样本不足'
            : `${Number(value).toFixed(1)} 个百分点`;
      if (paired.independentMeanChange !== undefined || paired.assistedMeanChange !== undefined)
        table(
          card,
          ['前后测配对', '人数', '平均变化'],
          [
            [
              '两阶段均自报独立完成',
              paired.independentPairCount,
              change(paired.independentMeanChange, paired.independentPairCount),
            ],
            [
              '至少一阶段借助帮助',
              paired.assistedPairCount,
              change(paired.assistedMeanChange, paired.assistedPairCount),
            ],
          ],
        );
      if (study.retention)
        card.append(
          el(
            'p',
            `学习后至间隔复查：配对 ${study.retention.pairCount} 人，平均变化 ${change(study.retention.meanChange, study.retention.pairCount)}。`,
            'learning-research-caption',
          ),
        );
      if (
        study.byGoal?.length ||
        study.stages?.some((stage) => stage.independentMeanPercent !== undefined)
      ) {
        const strata = el('details');
        strata.append(el('summary', '按学习目的和作答方式查看'));
        if (study.byGoal?.length)
          table(
            strata,
            [
              '参与目的',
              '参加人数',
              '前后测配对人数',
              '前后测平均变化',
              '保持配对人数',
              '保持平均变化',
            ],
            study.byGoal.map((item) => [
              PURPOSES[item.goal] || item.goal,
              item.participantCount,
              item.paired?.pairCount,
              change(item.paired?.meanChange, item.paired?.pairCount),
              item.retention?.pairCount,
              change(item.retention?.meanChange, item.retention?.pairCount),
            ]),
          );
        if (study.stages?.some((stage) => stage.independentMeanPercent !== undefined))
          table(
            strata,
            ['测量阶段', '独立完成人数', '独立平均得分比例', '辅助完成人数', '辅助平均得分比例'],
            study.stages.map((item) => [
              PHASES[item.phase] || item.phase,
              item.independentCount,
              percentage(
                item.independentMeanPercent,
                item.independentCount > 0 && item.independentCount < (data.minGroupSize || 5),
              ),
              item.assistedCount,
              percentage(
                item.assistedMeanPercent,
                item.assistedCount > 0 && item.assistedCount < (data.minGroupSize || 5),
              ),
            ]),
          );
        strata.append(
          el(
            'p',
            '各组并非随机分配，不能用这里的差异判断 Max 的因果效果或比较个人能力。',
            'learning-research-caption',
          ),
        );
        card.append(strata);
      }
      (study.limitations || []).forEach((text) =>
        card.append(el('p', text, 'learning-research-caption')),
      );
      host.append(card);
    });
    if (!data.studies?.length)
      host.append(
        el('p', '尚未发布研究任务；不能用浏览量代替知识掌握证据。', 'learning-research-caption'),
      );
    host.append(el('h4', '解释范围'));
    (data.limitations || []).forEach((text) =>
      host.append(el('p', text, 'learning-research-caption')),
    );
    if (data.dataCoverage?.complete === false)
      host.append(
        el(
          'p',
          `本次仅处理最多 ${data.dataCoverage.limit} 条记录，汇总不完整。`,
          'learning-research-warning',
        ),
      );
  }
  function mountAdmin() {
    if (!admin) return;
    admin.replaceChildren();
    admin.hidden = !scope(admin, true);
    if (admin.hidden) return;
    const { reload, status } = frame(admin, '平台学习发展研究');
    admin.append(
      el(
        'p',
        '战略部研究平台设计的帮助与阻碍、知识保持和应用；课程部负责课程内容与题目质量。这里只显示去标识化统计，不展示个人原文。',
        'learning-research-caption',
      ),
    );
    const filter = selectField('研究时间范围', {
      7: '近 7 天',
      30: '近 30 天',
      all: '全部研究记录',
    });
    filter.input.value = '30';
    filter.input.dataset.researchWindow = '';
    admin.append(filter.field);
    const dataHost = el('div');
    let revision = 0;
    let displayedWindow = null;
    const allowed = fence(admin, true);
    async function load() {
      revision += 1;
      const request = revision;
      const selectedWindow = filter.input.value;
      if (selectedWindow !== displayedWindow) dataHost.replaceChildren();
      status.textContent = '正在加载…';
      try {
        const data = await app.callApi(
          `${endpoint}/admin?window=${encodeURIComponent(selectedWindow)}`,
        );
        if (!allowed() || request !== revision) return;
        dataHost.replaceChildren();
        displayedWindow = selectedWindow;
        renderAdmin(dataHost, data);
        status.textContent = '';
        revealInitialAnchor(admin);
      } catch (error) {
        if (allowed() && request === revision)
          status.textContent = error.message || '暂时无法加载研究数据。';
      }
    }
    researchCreate(admin, load);
    admin.append(dataHost);
    reload.addEventListener('click', load);
    filter.input.addEventListener('change', load);
    load();
  }
  function reset(sessionConfirmed = false) {
    if (state.stale && !identityChanged() && !sessionConfirmed) return;
    state.generation += 1;
    state.stale = false;
    state.uid = String(app.userState?.uid || '');
    state.token = app.userState?.token || '';
    state.isAdmin = Boolean(app.userState?.isAdmin);
    state.loggedIn = Boolean(app.userState?.isLoggedIn);
    mountPersonal();
    mountAdmin();
  }
  window.addEventListener('freebbs:session-change', () => {
    if (state.stale || identityChanged() || state.loggedIn !== Boolean(app.userState?.isLoggedIn))
      reset(true);
    else if (state.isAdmin !== Boolean(app.userState?.isAdmin)) {
      state.isAdmin = Boolean(app.userState?.isAdmin);
      mountAdmin();
    }
  });
  window.addEventListener('storage', (event) => {
    if (event.key === 'free_bbs_auth_token' || event.key === null) {
      state.generation += 1;
      state.stale = true;
      [personal, admin].forEach((host) => {
        if (host) {
          host.replaceChildren();
          host.hidden = true;
        }
      });
    }
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) reset();
  });
  window.FreeBbsLearningResearch = { refresh: () => reset() };
  Promise.resolve(app.sessionReady).then(() => reset());
})();
