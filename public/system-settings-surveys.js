(() => {
  const { api, el, message, date, status, download } = window.SurveyUI;
  function token() {
    return localStorage.getItem('free_bbs_auth_token') || '';
  }
  let activeToken = token();
  let epoch = 0;
  let allowed = false;
  let currentPage = 0;
  let nextPage = null;
  let listRevision = 0;
  let entriesRevision = 0;
  const capture = () => ({ epoch, token: token() });
  const current = (context) => context.epoch === epoch && context.token === token();
  function staleRequest() {
    const error = new Error('当前请求已失效');
    error.stale = true;
    return error;
  }
  function clearEntries() {
    entriesRevision += 1;
    document.getElementById('entries-panel').hidden = true;
    document.getElementById('entries-table').replaceChildren();
    document.getElementById('draw-audit').textContent = '';
    const exporter = document.getElementById('export');
    exporter.onclick = null;
    exporter.disabled = true;
  }
  function clearAdmin() {
    epoch += 1;
    listRevision += 1;
    allowed = false;
    currentPage = 0;
    nextPage = null;
    const panel = document.getElementById('admin-content');
    panel.hidden = true;
    panel.classList.add('hidden');
    clearEntries();
    document.getElementById('survey-list').replaceChildren();
    document.getElementById('page-status').textContent = '';
    document.getElementById('previous-page').disabled = true;
    document.getElementById('next-page').disabled = true;
    form.reset();
    questions.replaceChildren();
    editor.hidden = true;
    editingId = null;
  }
  async function request(path = '', method = 'GET', body = undefined, isLatest = () => true) {
    const context = capture();
    try {
      const data = await api(`/admin/surveys${path}`, method, body);
      if (!current(context) || !isLatest()) throw staleRequest();
      return data;
    } catch (error) {
      if (!current(context)) throw staleRequest();
      if (error.status === 401 || error.status === 403) {
        // Permission loss still clears private data even for an older navigation.
        clearAdmin();
        throw error;
      }
      if (!isLatest()) throw staleRequest();
      throw error;
    }
  }
  function report(error) {
    if (!error.stale) message(error.message);
  }
  const form = document.getElementById('survey-form');
  const questions = document.getElementById('questions');
  const editor = document.getElementById('editor');
  let editingId = null;
  function openTimePicker(input) {
    try {
      if (typeof input.showPicker === 'function') input.showPicker();
      else {
        input.focus();
        message('当前浏览器不支持弹出选择器，可直接输入日期和时间。');
      }
    } catch {
      input.focus();
    }
  }
  form.querySelectorAll('[data-datetime-picker]').forEach((trigger) => {
    const input = form.elements[trigger.dataset.datetimePicker];
    trigger.addEventListener('click', () => openTimePicker(input));
    input.addEventListener('click', (event) => {
      if (typeof input.showPicker === 'function') {
        event.preventDefault();
        openTimePicker(input);
      }
    });
  });
  function localDate(value) {
    const d = new Date(value);
    return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }
  function question(q = { label: '', type: 'text', required: true, options: [] }) {
    const card = el('fieldset');
    card.append(el('legend', '活动题目'));
    const label = el('label', '题目标题');
    const title = el('input');
    title.value = q.label;
    title.required = true;
    title.maxLength = 300;
    label.append(title);
    const typeLabel = el('label', '题型');
    const type = el('select');
    Object.entries({
      single: '单选题',
      multiple: '多选题',
      text: '简短填空',
      textarea: '长文本',
    }).forEach(([value, name]) => {
      const option = el('option', name);
      option.value = value;
      type.append(option);
    });
    type.value = q.type;
    typeLabel.append(type);
    const optionsLabel = el('label', '选项（每行一个，至少两项）');
    const options = el('textarea');
    options.value = q.options.join('\n');
    optionsLabel.append(options);
    const requiredLabel = el('label');
    const required = el('input');
    required.type = 'checkbox';
    required.checked = q.required;
    requiredLabel.append(required, document.createTextNode('必填'));
    const update = () => {
      optionsLabel.hidden = !['single', 'multiple'].includes(type.value);
      options.required = !optionsLabel.hidden;
    };
    type.onchange = update;
    update();
    const remove = el('button', '删除题目', 'secondary');
    remove.type = 'button';
    remove.onclick = () => card.remove();
    const up = el('button', '上移', 'secondary');
    up.type = 'button';
    up.onclick = () => {
      if (card.previousElementSibling) questions.insertBefore(card, card.previousElementSibling);
    };
    const actions = el('div', undefined, 'actions');
    actions.append(up, remove);
    card.append(label, typeLabel, optionsLabel, requiredLabel, actions);
    card.read = () => ({
      label: title.value,
      type: type.value,
      required: required.checked,
      options: optionsLabel.hidden
        ? []
        : options.value
            .split('\n')
            .map((v) => v.trim())
            .filter(Boolean),
    });
    questions.append(card);
  }
  function edit(s, copy = false) {
    editingId = copy ? null : s?.id || null;
    form.reset();
    questions.replaceChildren();
    document.getElementById('editor-title').textContent = editingId ? '编辑草稿' : '新建活动';
    const start = Date.now() + 5 * 60000;
    const values = s
      ? {
          ...s,
          title: copy ? `${s.title}（新一期）` : s.title,
          opensAt: copy ? start : s.opensAt,
          closesAt: copy ? start + 7 * 86400000 : s.closesAt,
          repeatDays: copy ? 0 : s.repeatDays,
        }
      : { opensAt: start, closesAt: start + 7 * 86400000 };
    ['title', 'description', 'winnerCount', 'drawMode', 'repeatDays'].forEach((key) => {
      if (values[key] !== undefined) form.elements[key].value = values[key];
    });
    form.elements.requiresLogin.checked = Boolean(s?.requiresLogin);
    ['opensAt', 'closesAt'].forEach((key) => {
      form.elements[key].value = localDate(values[key]);
    });
    (
      s?.questions || [
        {
          label: '你的年级',
          type: 'single',
          required: true,
          options: ['大一', '大二', '大三', '大四', '其他'],
        },
        { label: '你希望重点体验或反馈哪些功能？', type: 'textarea', required: false, options: [] },
      ]
    ).forEach(question);
    editor.hidden = false;
    editor.scrollIntoView({ behavior: 'smooth' });
  }
  function button(text, action, secondary = true) {
    const node = el('button', text, secondary ? 'secondary' : '');
    const context = capture();
    node.onclick = async () => {
      if (!allowed || !current(context)) return;
      node.disabled = true;
      message('');
      try {
        await action();
      } catch (error) {
        report(error);
      } finally {
        node.disabled = false;
      }
    };
    return node;
  }
  function entryRows(s, items) {
    return [
      ['联系邮箱', '报名时间', '抽签结果', ...s.questions.map((q) => q.label)],
      ...items.map((entry) => [
        entry.contact,
        date(entry.created_at),
        s.status === 'drawn' ? (entry.winner ? '中签' : '未中签') : '待抽签',
        ...s.questions.map((q) => {
          const value = entry.answers[q.id];
          return Array.isArray(value) ? value.join('、') : value || '';
        }),
      ]),
    ];
  }
  async function entries(s) {
    const context = capture();
    clearEntries();
    const revision = entriesRevision;
    const isLatest = () => revision === entriesRevision;
    const data = await request(`/${s.id}/entries`, 'GET', undefined, isLatest);
    if (!allowed || !current(context) || !isLatest()) return;
    document.getElementById('entries-panel').hidden = false;
    document.getElementById('draw-audit').textContent = s.drawnAt
      ? `抽签时间：${date(s.drawnAt)} · 执行者：${s.drawnBy} · 中签 ${data.entries.filter((e) => e.winner).length} / 报名 ${data.entries.length}`
      : '尚未抽签';
    const rows = entryRows(s, data.entries);
    const table = el('table');
    rows.forEach((row, index) => {
      const tr = el('tr');
      row.forEach((value) => tr.append(el(index ? 'td' : 'th', value)));
      table.append(tr);
    });
    document.getElementById('entries-table').replaceChildren(table);
    const exporter = document.getElementById('export');
    exporter.disabled = false;
    exporter.onclick = async () => {
      if (!allowed || !current(context) || !isLatest()) return;
      exporter.disabled = true;
      try {
        // Recheck server permission instead of exporting a retained private snapshot.
        const fresh = await request(`/${s.id}/entries`, 'GET', undefined, isLatest);
        if (!allowed || !current(context) || !isLatest()) return;
        const cell = (value) => {
          let text = String(value);
          if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
          return `"${text.replaceAll('"', '""')}"`;
        };
        download(
          `活动-${s.id}.csv`,
          `\ufeff${entryRows(s, fresh.entries)
            .map((row) => row.map(cell).join(','))
            .join('\r\n')}`,
          'text/csv;charset=utf-8',
        );
      } catch (error) {
        report(error);
      } finally {
        if (allowed && current(context) && isLatest()) exporter.disabled = false;
      }
    };
    document.getElementById('entries-panel').scrollIntoView({ behavior: 'smooth' });
  }
  async function load(page = currentPage) {
    const context = capture();
    // Navigation order is independent of the login-session epoch.
    listRevision += 1;
    const revision = listRevision;
    const isLatest = () => revision === listRevision;
    clearEntries();
    const data = await request(`?page=${page}`, 'GET', undefined, isLatest);
    if (!current(context) || !isLatest()) throw staleRequest();
    // Also invalidate details opened from the old list while loading this page.
    clearEntries();
    const { surveys } = data;
    allowed = true;
    currentPage = data.page ?? page;
    nextPage = data.nextPage ?? null;
    document.getElementById('page-status').textContent = `第 ${currentPage + 1} 页`;
    document.getElementById('previous-page').disabled = currentPage === 0;
    document.getElementById('next-page').disabled = nextPage === null;
    document.getElementById('admin-content').hidden = false;
    document.getElementById('admin-content').classList.remove('hidden');
    const list = document.getElementById('survey-list');
    list.replaceChildren();
    if (!surveys.length) list.append(el('p', '还没有活动。点击“新建活动”开始招募。'));
    surveys.forEach((s) => {
      const card = el('article', undefined, 'card');
      card.append(
        el('small', status(s)),
        el('h3', s.title),
        el(
          'p',
          `${date(s.opensAt)} — ${date(s.closesAt)}\n${s.requiresLogin ? '登录后报名' : '免登录报名'} · ${s.entryCount} 人报名 · ${s.winnerCount} 个名额 · ${s.drawMode === 'auto' ? '自动' : '手动'}抽签${s.repeatDays ? ` · 每 ${s.repeatDays} 天重复` : ''}`,
          'muted',
        ),
      );
      const actions = el('div', undefined, 'actions');
      if (s.status === 'draft') {
        actions.append(
          button('编辑', () => edit(s)),
          button(
            '发布活动',
            async () => {
              await request(`/${s.id}/publish`, 'POST');
              await load();
              message('已发布，可复制邀请链接。');
            },
            false,
          ),
        );
      }
      if (['published', 'drawn'].includes(s.status))
        actions.append(
          button('复制邀请链接', async () => {
            const url = `${window.location.origin}/surveys?id=${s.id}`;
            try {
              await navigator.clipboard.writeText(
                `${s.title}\n${s.requiresLogin ? '登录后报名' : '无需登录即可报名'}：${url}\n截止时间：${date(s.closesAt)}`,
              );
              message('邀请内容已复制，可发送给同学。');
            } catch {
              message(`请复制报名链接：${url}`);
            }
          }),
        );
      actions.append(
        button('复制为新一期', () => edit(s, true)),
        button(s.status === 'drawn' ? '查看中签名单 / 导出' : '查看报名 / 导出', () => entries(s)),
      );
      if (s.status === 'published' && Date.now() >= new Date(s.closesAt))
        actions.append(
          button(
            '执行抽签',
            async () => {
              await request(`/${s.id}/draw`, 'POST');
              const updated = await load();
              const drawn = updated.find((item) => item.id === s.id);
              if (drawn) await entries(drawn);
              message('抽签已完成，结果已保存。');
            },
            false,
          ),
        );
      if (s.repeatDays)
        actions.append(
          button('停止后续重复', async () => {
            await request(`/${s.id}/stop-repeat`, 'POST');
            await load();
            message('已停止此活动及已生成后续期次的重复发布；已发布期次仍可报名。');
          }),
        );
      if (['draft', 'published'].includes(s.status))
        actions.append(
          button('取消本期', async () => {
            if (!window.confirm('取消后本期不再接受报名或抽签，已有报名将保留。确定取消？')) return;
            await request(`/${s.id}/cancel`, 'POST');
            await load();
          }),
        );
      card.append(actions);
      list.append(card);
    });
    return surveys;
  }
  form.onsubmit = async (event) => {
    event.preventDefault();
    const context = capture();
    if (!allowed) return;
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true;
    try {
      const body = Object.fromEntries(new FormData(form));
      body.requiresLogin = form.elements.requiresLogin.checked;
      body.questions = [...questions.children].map((card) => card.read());
      body.opensAt = new Date(body.opensAt).toISOString();
      body.closesAt = new Date(body.closesAt).toISOString();
      await request(editingId ? `/${editingId}` : '', editingId ? 'PUT' : 'POST', body);
      if (!current(context)) return;
      editor.hidden = true;
      await load(0);
      message('草稿已保存，检查后点击“发布活动”。');
    } catch (error) {
      report(error);
    } finally {
      submit.disabled = false;
    }
  };
  document.getElementById('new-survey').onclick = () => {
    if (allowed) edit();
  };
  document.getElementById('add-question').onclick = () => question();
  document.getElementById('close-editor').onclick = () => {
    editor.hidden = true;
  };
  document.getElementById('close-entries').onclick = clearEntries;
  document.getElementById('refresh').onclick = () => load().catch(report);
  document.getElementById('previous-page').onclick = () => {
    if (allowed && currentPage > 0) {
      load(currentPage - 1).catch(report);
    }
  };
  document.getElementById('next-page').onclick = () => {
    if (allowed && nextPage !== null) {
      load(nextPage).catch(report);
    }
  };
  window.addEventListener('freebbs:session-change', (event) => {
    const user = event.detail?.user;
    const isAdmin = Boolean(user && (user.isAdmin || user.role === 'admin'));
    if (activeToken !== token() || !isAdmin) {
      clearAdmin();
      activeToken = token();
      if (activeToken && isAdmin) load(0).catch(report);
    }
  });
  window.addEventListener('storage', (event) => {
    if (event.key === 'free_bbs_auth_token' || event.key === null) {
      clearAdmin();
      activeToken = token();
      if (activeToken) load(0).catch(report);
    }
  });
  window.addEventListener('pagehide', clearAdmin);
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) load(0).catch(report);
  });
  clearAdmin();
  load(0).catch(report);
})();
