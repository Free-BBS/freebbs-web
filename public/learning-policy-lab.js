/* Isolated local experiment. GET-only course reads; no original preference or assessment writes. */
(() => {
  const policy = window.FreeBbsLearningPolicy;
  if (!policy) return;
  const byId = (id) => document.getElementById(id);
  const courses = ['signals', 'math', 'circuits'];
  const initial = new URLSearchParams(window.location.search);
  const state = {
    course: courses.includes(initial.get('course')) ? initial.get('course') : 'signals',
    point: initial.get('point') || '',
    map: null,
    node: null,
    questions: [],
    questionsStatus: 'unknown',
    plan: null,
    record: null,
    identity: null,
    token: '',
    storage: null,
    records: new Map(),
    generation: 0,
    identityGeneration: 0,
    storageWritable: true,
  };
  const materialStatus = byId('material-status');
  const form = byId('policy-form');
  let identityPromise = null;
  const element = (tag, text, className) => {
    const item = document.createElement(tag);
    if (text !== undefined) item.textContent = text;
    if (className) item.className = className;
    return item;
  };
  function storedToken() {
    try {
      return localStorage.getItem('free_bbs_auth_token') || '';
    } catch {
      return '';
    }
  }
  async function getJson(path, token = '') {
    const response = await fetch(path, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`读取暂不可用（${response.status}）`);
    return response.json();
  }
  function recordKey(record) {
    return JSON.stringify([record.course, record.point, record.strategyId]);
  }
  function identityLabel() {
    byId('identity-status').textContent =
      state.identity?.verified && state.storageWritable
        ? '本实验的明确设置与勾选按当前账号隔离保存在本机；不改动原学习记录。'
        : '账号或本地存储尚未确认：本实验仅在当前页面保留，不写入任何账号偏好。';
  }
  async function identify(force = false) {
    const token = storedToken();
    if (!force && identityPromise && token === state.token) return identityPromise;
    state.identityGeneration += 1;
    const request = state.identityGeneration;
    const changed = token !== state.token;
    state.token = token;
    state.identity = null;
    state.storage = null;
    if (changed) {
      state.records.clear();
      state.record = null;
      state.plan = null;
      renderPlan();
      byId('max-question-dialog').close();
      byId('max-question-text').value = '';
    }
    identityLabel();
    identityPromise = (async () => {
      if (!token) return;
      try {
        const result = await getJson('/api/auth/me', token);
        if (request !== state.identityGeneration || storedToken() !== token) return;
        const identity = { verified: true, uid: String(result.user?.uid || result.user?.id || '') };
        const key = policy.ownerKey(identity);
        if (!key) return;
        state.identity = identity;
        state.storage = key;
        try {
          const data = JSON.parse(localStorage.getItem(key) || '{}');
          if (
            data.policyVersion === policy.POLICY_VERSION &&
            data.schemaVersion === policy.LAB_SCHEMA_VERSION &&
            Array.isArray(data.records)
          ) {
            const restored = new Map();
            data.records.slice(0, 30).forEach((value) => {
              const record = policy.normalizeRecord(value);
              if (record) restored.set(recordKey(record), record);
            });
            state.records = restored;
          }
        } catch {
          state.storageWritable = false;
        }
      } catch {
        /* No verified identity means memory only, never a guessed owner. */
      } finally {
        if (request === state.identityGeneration) identityLabel();
      }
    })();
    await identityPromise;
  }
  function persist() {
    if (!state.record) return;
    state.record.updatedAt = new Date().toISOString();
    state.records.set(recordKey(state.record), policy.normalizeRecord(state.record));
    if (!state.storage || !state.identity?.verified || storedToken() !== state.token) {
      identityLabel();
      return;
    }
    try {
      localStorage.setItem(
        state.storage,
        JSON.stringify({
          policyVersion: policy.POLICY_VERSION,
          schemaVersion: policy.LAB_SCHEMA_VERSION,
          records: [...state.records.values()].slice(-30),
        }),
      );
    } catch {
      state.storageWritable = false;
      identityLabel();
    }
  }
  function availablePoints() {
    return (state.map?.nodes || [])
      .filter(
        (node) => typeof node.id === 'string' && !/^[A-Z][A-Z0-9]*-[A-Z0-9]+-0+$/.test(node.id),
      )
      .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  }
  function renderPoints() {
    const search = byId('policy-search').value.normalize('NFKC').trim().toLocaleLowerCase();
    const matches = availablePoints().filter((node) =>
      `${node.id} ${node.title || ''}`.normalize('NFKC').toLocaleLowerCase().includes(search),
    );
    const select = byId('policy-point');
    select.replaceChildren();
    if (!matches.length) {
      const empty = element('option', '没有匹配；可换个词或打开完整目录');
      empty.value = '';
      select.append(empty);
      return;
    }
    matches.forEach((node) => {
      const option = element('option', `${node.id} · ${node.title || node.id}`);
      option.value = node.id;
      select.append(option);
    });
    if (search && !matches.some((node) => node.id === state.point)) {
      const prompt = element('option', '请选择匹配知识点');
      prompt.value = '';
      select.prepend(prompt);
      select.value = '';
      byId('policy-apply').disabled = true;
    } else
      select.value = matches.some((node) => node.id === state.point) ? state.point : matches[0].id;
  }
  function readingLink(moduleId, questionId = '') {
    const config = state.record || {
      purpose: form.elements.purpose.value,
      level: form.elements.level.value,
    };
    const query = new URLSearchParams({
      course: state.course,
      point: state.point,
      view: 'reading',
      policy: policy.POLICY_VERSION,
      purpose: config.purpose,
      level: config.level,
      module: moduleId,
    });
    const step = state.plan?.steps.find((entry) => entry.moduleId === moduleId);
    const view = step?.view || 'reading';
    if (view === 'overview') query.set('view', 'overview');
    if (['origin', 'relations'].includes(view)) query.set('focus', view);
    if (moduleId === 'practice' || moduleId === 'transfer') {
      query.set('tool', 'feedback');
      query.set('quiz', 'practice');
    }
    if (moduleId === 'reflect') query.set('tool', 'notes');
    if (questionId) query.set('question', questionId);
    return `/knowledge?${query}`;
  }
  function publicMaterials() {
    const sections = state.node?.sections || {};
    const body =
      typeof sections.knowledgeMarkdown === 'string'
        ? sections.knowledgeMarkdown
        : state.node?.markdown || '';
    const applications = String(sections.applicationsMarkdown || '');
    const originMatch = /(?:^|\n)#{1,6}\s+(?:知识起源|为什么学|产生背景)\s*(?:\n|$)/.test(
      applications,
    );
    const valid = new Set(availablePoints().map((node) => node.id));
    const relations = (state.map?.edges || []).some(
      (edge) =>
        valid.has(edge.source) &&
        valid.has(edge.target) &&
        edge.source !== edge.target &&
        [edge.source, edge.target].includes(state.point),
    );
    return { body: Boolean(body.trim()), origin: originMatch, relations, workedExample: false };
  }
  async function loadPoint() {
    const point = byId('policy-point').value;
    state.generation += 1;
    const generation = state.generation;
    const course = state.course;
    state.point = point;
    state.node = null;
    state.questions = [];
    state.questionsStatus = 'unknown';
    state.record = null;
    state.plan = null;
    renderPlan();
    byId('policy-apply').disabled = true;
    byId('material-retry').hidden = true;
    if (!point) {
      materialStatus.textContent = '当前没有可选知识点。';
      return;
    }
    materialStatus.textContent = '正在读取这个知识点的公开材料…';
    try {
      const result = await getJson(
        `/api/courses/${encodeURIComponent(course)}/map/nodes/${encodeURIComponent(point)}`,
      );
      if (generation !== state.generation || course !== state.course || point !== state.point)
        return;
      if (!result.node || result.node.id !== point) throw new Error('知识点详情与所选目录不一致');
      state.node = result.node;
      await identify();
      if (generation !== state.generation) return;
      const token = state.token;
      if (state.identity?.verified && token && token === storedToken()) {
        try {
          const questions = await getJson(
            `/api/learning-assessments/${encodeURIComponent(course)}/${encodeURIComponent(point)}/questions`,
            token,
          );
          if (generation !== state.generation || token !== storedToken()) return;
          state.questions = [
            ...(Array.isArray(questions.questions) ? questions.questions : []),
            ...(Array.isArray(questions.practiceQuestions) ? questions.practiceQuestions : []),
          ];
          state.questionsStatus = 'available';
        } catch {
          if (generation === state.generation) state.questionsStatus = 'unavailable';
        }
      }
      if (generation !== state.generation) return;
      materialStatus.textContent = `已读取公开材料。${state.questionsStatus === 'available' ? `可确认 ${policy.normalizeQuestions(state.questions).length} 道已有题。` : '题目未读取，仍可查阅与试用；不假设没有题。'}`;
      byId('policy-apply').disabled = false;
      const restored = [...state.records.values()]
        .filter((record) => record.course === course && record.point === point)
        .filter(
          (record) => !urlConfig || record.strategyId === `${urlConfig.purpose}:${urlConfig.level}`,
        )
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0];
      if (restored) {
        form.elements.purpose.value = restored.purpose;
        form.elements.level.value = restored.level;
        applyPolicy(false);
      }
    } catch (error) {
      if (generation !== state.generation) return;
      materialStatus.textContent = `${error.message}。原课程仍可直接打开。`;
      byId('material-retry').hidden = false;
    }
  }
  async function loadCourse() {
    state.generation += 1;
    const generation = state.generation;
    const course = state.course;
    state.map = null;
    state.node = null;
    state.record = null;
    state.plan = null;
    renderPlan();
    byId('policy-apply').disabled = true;
    byId('material-retry').hidden = true;
    byId('course-directory').href = `/course?course=${encodeURIComponent(course)}`;
    byId('policy-point').replaceChildren(element('option', '正在读取公开目录…'));
    materialStatus.textContent = '正在读取公开课程目录…';
    try {
      const map = await getJson(`/api/courses/${encodeURIComponent(course)}/map`);
      if (generation !== state.generation || course !== state.course) return;
      if (!Array.isArray(map.nodes) || map.course?.slug !== course)
        throw new Error('目录格式不匹配');
      state.map = map;
      renderPoints();
      await loadPoint();
    } catch (error) {
      if (generation !== state.generation) return;
      materialStatus.textContent = `${error.message}。可以直接查看原课程目录。`;
      byId('material-retry').hidden = false;
    }
  }
  function applyPolicy(save = true) {
    if (!state.node || state.node.id !== state.point || byId('policy-point').value !== state.point)
      return;
    const config = policy.normalizeConfig({
      purpose: form.elements.purpose.value,
      level: form.elements.level.value,
    });
    if (!config) return;
    state.plan = policy.buildPolicy(config, {
      materials: publicMaterials(),
      questions: state.questions,
      documentVersion: state.node.documentVersion,
    });
    const basic = {
      policyVersion: policy.POLICY_VERSION,
      schemaVersion: policy.LAB_SCHEMA_VERSION,
      course: state.course,
      point: state.point,
      ...config,
    };
    state.record =
      state.records.get(recordKey({ ...basic, strategyId: state.plan.strategyId })) ||
      policy.normalizeRecord(basic);
    if (save) persist();
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries({
      course: state.course,
      point: state.point,
      purpose: config.purpose,
      level: config.level,
    }))
      url.searchParams.set(key, value);
    window.history.replaceState(window.history.state, '', url);
    renderPlan();
  }
  function link(text, href) {
    const item = element('a', text);
    item.href = href;
    item.target = '_blank';
    item.rel = 'noopener';
    return item;
  }
  function button(text, action, className) {
    const item = element('button', text, className);
    item.type = 'button';
    item.addEventListener('click', action);
    return item;
  }
  function showQuestion(step) {
    const dialog = byId('max-question-dialog');
    byId('max-question-text').value =
      `我正在学习「${state.node.title || state.point}」（${state.course} / ${state.point}）。本次目的是${policy.PURPOSES[state.record.purpose]}，我自述当前${policy.LEVELS[state.record.level]}（不是测评结果）。\n当前想做：${step.title}。\n${step.prompt}\n${state.plan.support}\n请以课程材料为依据，区分临时示例与已发布题，不代答、不判正式成绩。`;
    const href = new URL(readingLink(step.moduleId, step.question?.id), window.location.origin);
    // Asking for help is different from opening the course's relationship view.
    // Keep the selected module as context, without routing the Max link away.
    if (href.searchParams.get('focus') === 'relations') {
      href.searchParams.delete('focus');
      href.searchParams.set('view', 'reading');
    }
    href.searchParams.set('interaction', 'max');
    byId('max-open-reader').href = `${href.pathname}${href.search}`;
    byId('max-copy-status').textContent = '';
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else {
      dialog.setAttribute('open', '');
      byId('max-question-text').focus();
    }
  }
  function stepNode(step) {
    const scope = recordKey(state.record);
    const item = element('li', undefined, 'policy-step');
    item.dataset.module = step.moduleId;
    item.dataset.status = state.record.statuses[step.moduleId] || 'pending';
    const number = element('span', String(step.order), 'step-number');
    number.setAttribute('aria-hidden', 'true');
    const body = element('div');
    body.append(element('h3', step.title), element('p', step.action));
    body.append(element('p', `带走什么：${step.output}`, 'step-output'));
    if (step.note) body.append(element('p', step.note, 'step-note'));
    if (state.record.level === 'new' && step.moduleId === 'retrieve')
      body.append(
        element('p', '完全没接触过？可以立即跳过回忆，直接查阅或先试题，不记为失败。', 'step-note'),
      );
    if (step.question)
      body.append(
        element(
          'p',
          `已有题 ${step.question.id} · ${{ basic: '基础', standard: '标准', challenge: '挑战' }[step.question.difficulty] || '难度未标注'} · 进入练习，不自动正式提交。`,
          'small',
        ),
      );
    const actions = element('div', undefined, 'step-actions');
    actions.append(
      link(
        step.question ? '去原页面尝试 ↗' : '打开对应材料 ↗',
        readingLink(step.moduleId, step.question?.id),
      ),
    );
    actions.append(button('准备问 Max', () => showQuestion(step)));
    const current = state.record.statuses[step.moduleId];
    actions.append(
      button(
        current === 'done' ? '撤销本人完成' : '我已完成这一步',
        () => {
          if (!safeIdentity() || recordKey(state.record) !== scope) return;
          if (state.record.statuses[step.moduleId] === 'done')
            delete state.record.statuses[step.moduleId];
          else state.record.statuses[step.moduleId] = 'done';
          persist();
          renderPlan();
          byId('plan-content').querySelector(`[data-module="${step.moduleId}"] button`)?.focus();
        },
        'quiet',
      ),
    );
    actions.append(
      button(
        current === 'skipped' ? '恢复这一步' : '先跳过',
        () => {
          if (!safeIdentity() || recordKey(state.record) !== scope) return;
          if (state.record.statuses[step.moduleId] === 'skipped')
            delete state.record.statuses[step.moduleId];
          else state.record.statuses[step.moduleId] = 'skipped';
          persist();
          renderPlan();
        },
        'quiet',
      ),
    );
    body.append(actions);
    if (current)
      body.append(
        element(
          'p',
          current === 'done' ? '本人标记完成 · 不代表掌握或授星' : '已跳过 · 可随时回来，不计失败',
          'step-status',
        ),
      );
    item.append(number, body);
    return item;
  }
  function safeIdentity() {
    if (state.identity?.verified && storedToken() !== state.token) {
      identify(true);
      return false;
    }
    return Boolean(state.record);
  }
  function renderPlan() {
    const content = byId('plan-content');
    const previousDisclosure = content.querySelector('[data-more-steps]')?.open === true;
    content.replaceChildren();
    byId('plan-empty').hidden = Boolean(state.plan);
    content.hidden = !state.plan;
    if (!state.plan) return;
    const plan = state.plan;
    content.append(
      element(
        'p',
        `${policy.PURPOSES[plan.purpose]} · ${policy.LEVELS[plan.level]} · 自述起点`,
        'plan-topline',
      ),
    );
    const title = element('h2', state.node.title || state.point, 'plan-title');
    title.id = 'active-plan-title';
    content.append(
      title,
      element('p', `${state.course} / ${state.point} · ${plan.policyVersion}`, 'small'),
    );
    content.append(
      element(
        'p',
        '推荐一种开始方式，不是必经顺序。可先看材料，也可先尝试一道题。',
        'plan-context',
      ),
    );
    const controls = element('div', undefined, 'plan-controls');
    controls.append(
      link('直接查阅正文 ↗', readingLink('read')),
      link('直接看题目 ↗', readingLink('practice')),
    );
    controls.append(
      button(state.record.paused ? '继续这条链' : '先暂停', () => {
        if (!safeIdentity()) return;
        state.record.paused = !state.record.paused;
        persist();
        renderPlan();
      }),
    );
    content.append(controls);
    if (plan.purpose === 'review') {
      const guidance = element('div', undefined, 'review-guidance');
      guidance.append(
        element(
          'p',
          '先回忆或短练习，只有遇到缺口才回看；顺利就可以结束，不必把初学流程重做一遍。',
          'small',
        ),
      );
      const choices = element('div', undefined, 'resource-links');
      choices.append(
        link('会算但说不清 → 回看原理', readingLink('read')),
        link('能解释但做不出 → 看示例与短练习', readingLink('worked-example')),
      );
      guidance.append(choices);
      content.append(guidance);
    }
    if (state.record.paused)
      content.append(
        element(
          'p',
          '已暂停。无需补做，也不会因暂停失去进度；所有原课程入口仍可使用。',
          'paused-notice',
        ),
      );
    const list = element('ol', undefined, 'policy-steps');
    plan.steps.slice(0, plan.coreStepCount).forEach((step) => list.append(stepNode(step)));
    content.append(list);
    if (plan.steps.length > plan.coreStepCount) {
      const details = element('details');
      details.dataset.moreSteps = '';
      details.open = previousDisclosure;
      details.append(
        element('summary', `后续 ${plan.steps.length - plan.coreStepCount} 步（可选）`),
      );
      const rest = element('ol', undefined, 'policy-steps');
      rest.start = plan.coreStepCount + 1;
      plan.steps.slice(plan.coreStepCount).forEach((step) => rest.append(stepNode(step)));
      details.append(rest);
      content.append(details);
    }
    const support = element('details', undefined, 'support-details');
    support.append(element('summary', 'Max 怎样辅助 · 材料与记录边界'));
    support.append(element('p', plan.support), element('p', plan.maxPrinciple));
    support.append(
      element(
        'p',
        '原型未读取你的作答记录，因此本次题目安排未按能力校准；不会根据四档自评直接定难度。完整示例、平行延迟题与真实模型教学效果仍需另外建设和检验。',
      ),
    );
    const boundaries = element('ul');
    plan.boundaries.forEach((boundary) => boundaries.append(element('li', boundary)));
    support.append(boundaries);
    support.append(
      element(
        'p',
        '此处只存实验自述，不自动写入全站分析或研究分组。本实验目的会随链接带到当前知识页的 Max；问题草稿可编辑，明确发送才调用。以上为本地开发，线上尚未部署。',
      ),
    );
    const exportButton = button('导出本次实验记录', () => {
      if (!safeIdentity()) return;
      const data = policy.exportRecord(state.record);
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const download = element('a');
      download.href = url;
      download.download = `learning-policy-${state.point}.json`;
      download.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      exportStatus.textContent =
        '仅导出当前本人的最小配置与勾选；不含账号标识、令牌、正文、笔记或答案。';
    });
    const exportStatus = element('p', '', 'small export-status');
    exportStatus.setAttribute('role', 'status');
    support.append(exportButton, exportStatus);
    content.append(support);
    byId('policy-plan').setAttribute('aria-labelledby', 'active-plan-title');
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (state.identity?.verified && storedToken() !== state.token) {
      identify(true);
      return;
    }
    applyPolicy();
    byId('policy-plan').focus();
  });
  byId('policy-course').value = state.course;
  const urlConfig = policy.normalizeConfig({
    purpose: initial.get('purpose'),
    level: initial.get('level'),
  });
  if (urlConfig) {
    form.elements.purpose.value = urlConfig.purpose;
    form.elements.level.value = urlConfig.level;
  }
  byId('policy-course').addEventListener('change', () => {
    state.course = byId('policy-course').value;
    state.point = '';
    byId('policy-search').value = '';
    loadCourse();
  });
  byId('policy-search').addEventListener('input', () => {
    renderPoints();
    if (byId('policy-point').value === state.point && state.node?.id === state.point)
      byId('policy-apply').disabled = false;
  });
  byId('policy-point').addEventListener('change', loadPoint);
  byId('material-retry').addEventListener('click', () => (state.map ? loadPoint() : loadCourse()));
  byId('max-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(byId('max-question-text').value);
      byId('max-copy-status').textContent = '已复制。由你决定是否发送给 Max。';
    } catch {
      byId('max-question-text').focus();
      byId('max-question-text').select();
      byId('max-copy-status').textContent = '浏览器未允许自动复制，请手动复制已选中的草稿。';
    }
  });
  window.addEventListener('storage', (event) => {
    if (event.key === 'free_bbs_auth_token' || event.key === null) {
      state.generation += 1;
      state.record = null;
      state.plan = null;
      state.records.clear();
      renderPlan();
      byId('max-question-dialog').close();
      byId('max-question-text').value = '';
      identify(true).then(() => {
        if (state.map) loadPoint();
      });
    }
  });
  window.addEventListener('focus', () => {
    if (storedToken() !== state.token)
      identify(true).then(() => {
        if (state.map) loadPoint();
      });
  });
  identify().then(loadCourse);
})();
