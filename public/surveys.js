(() => {
  const { api, el, message, date, status, download } = window.SurveyUI;
  const content = document.getElementById('content');
  const id = new URLSearchParams(window.location.search).get('id');
  function authToken() {
    try {
      return localStorage.getItem('free_bbs_auth_token') || '';
    } catch {
      return '';
    }
  }
  // Wrap access so blocked storage still leaves the current page usable.
  const local = {
    get length() {
      return window.localStorage.length;
    },
    key: (index) => window.localStorage.key(index),
    removeItem: (key) => window.localStorage.removeItem(key),
  };
  const session = {
    getItem: (key) => window.sessionStorage.getItem(key),
    setItem: (key, value) => window.sessionStorage.setItem(key, value),
    removeItem: (key) => window.sessionStorage.removeItem(key),
  };
  const receiptStore = window.createSurveyReceiptStore({
    local,
    session,
    crypto: window.crypto,
    getToken: authToken,
  });
  let activeToken = authToken();
  let viewVersion = 0;
  function current(version, token) {
    return version === viewVersion && token === authToken();
  }
  function clearPrivateView() {
    content.replaceChildren();
    lookup.reset();
    lookup.elements.receipt.value = '';
    const result = document.getElementById('result');
    result.replaceChildren();
    delete result.dataset.result;
    document.getElementById('lookup').hidden = true;
    message('');
  }
  const lookup = document.getElementById('lookup-form');
  function resultLink(href = '#lookup') {
    const link = el('a', '查看我的抽签结果 →', 'button activity-result-link');
    link.href = href;
    return link;
  }
  function renderResult(data) {
    const result = document.getElementById('result');
    result.dataset.result = data.result;
    result.textContent = {
      won: '恭喜，你已中签！请留意管理员后续联系。',
      lost: '本期未中签，感谢参与，欢迎报名下一期。',
      pending: '报名已收到，尚未抽签，请在截止后再来查询。',
      cancelled: '本期报名已取消。',
    }[data.result];
    if (data.drawnAt) result.append(el('small', `抽签时间：${date(data.drawnAt)}`));
  }
  function savedReceipt() {
    return receiptStore.get(id);
  }
  function newReceipt() {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)), (x) =>
      x.toString(16).padStart(2, '0'),
    ).join('');
  }
  function showReceipt(receipt) {
    content.replaceChildren(el('h2', '报名成功，感谢参与！'));
    const card = el('section', undefined, 'card');
    card.append(
      el(
        'p',
        '请下载并妥善保存回执，用它查询抽签结果。登录、退出或切换账号后，本页将清除回执；报名资料仅管理员可见。',
      ),
      el('p', receipt, 'receipt'),
    );
    const save = el('button', '下载报名回执');
    save.onclick = () =>
      download(
        'FREE-BBS-报名回执.txt',
        `活动：${window.location.href}\n回执：${receipt}\n请勿向他人分享回执。`,
      );
    const actions = el('div', undefined, 'actions');
    actions.append(save, resultLink());
    card.append(actions);
    content.append(card);
    lookup.elements.receipt.value = receipt;
  }
  async function load(version, token) {
    if (!current(version, token)) return;
    if (!id) {
      content.replaceChildren();
      const toolbar = el('div', undefined, 'activity-toolbar');
      const heading = el('h2', '全部活动');
      const filters = el('div', undefined, 'activity-filters');
      filters.setAttribute('aria-label', '按报名状态筛选');
      const grid = el('div', undefined, 'activity-grid');
      const more = el('button', '加载更多活动', 'secondary');
      let surveys = [];
      let nextPage = 0;
      let filter = '全部';
      const render = () => {
        grid.replaceChildren();
        filters
          .querySelectorAll('button')
          .forEach((button) =>
            button.setAttribute('aria-pressed', String(button.textContent === filter)),
          );
        const visible = surveys.filter(
          (survey) =>
            filter === '全部' ||
            (filter === '已结束'
              ? ['已抽签', '报名结束 · 待抽签'].includes(status(survey))
              : status(survey) === filter),
        );
        heading.textContent = `全部活动 · ${surveys.length}${nextPage !== null ? '+' : ''}`;
        visible.forEach((survey) => {
          const card = el('article', undefined, 'card');
          const badges = el('div', undefined, 'activity-card-heading');
          const badge = el('span', status(survey), 'activity-badge');
          badge.dataset.state = status(survey);
          badges.append(badge, el('small', survey.requiresLogin ? '登录后报名' : '免登录报名'));
          const title = el('h2', survey.title);
          const meta = el('div', undefined, 'activity-meta');
          meta.append(
            el('span', `开放  ${date(survey.opensAt)}`),
            el('span', `截止  ${date(survey.closesAt)}`),
            el(
              'span',
              `${survey.winnerCount} 个名额 · ${survey.drawMode === 'auto' ? '自动抽签' : '管理员抽签'}`,
            ),
          );
          const link = el(
            'a',
            status(survey) === '报名中' ? '查看活动并报名 ↗' : '查看活动详情 ↗',
            'button',
          );
          link.href = `/surveys?id=${encodeURIComponent(survey.id)}`;
          card.append(
            badges,
            title,
            el(
              'p',
              survey.description || '欢迎参与本次活动，点击查看报名详情。',
              'activity-card-description',
            ),
            meta,
            link,
          );
          card.append(resultLink(`/surveys?id=${encodeURIComponent(survey.id)}#lookup`));
          grid.append(card);
        });
        if (!visible.length)
          grid.append(
            el(
              'p',
              surveys.length
                ? '当前筛选下暂无活动，可切换分类或加载更多。'
                : '新的活动正在筹备中，欢迎稍后再来看看。',
              'activity-empty',
            ),
          );
        more.hidden = nextPage === null;
      };
      ['全部', '报名中', '即将开放', '已结束'].forEach((label) => {
        const button = el('button', label, 'secondary');
        button.onclick = () => {
          filter = label;
          render();
        };
        filters.append(button);
      });
      toolbar.append(heading, filters);
      content.append(toolbar, grid, more);
      const loadMore = async () => {
        more.disabled = true;
        try {
          const data = await api(`/surveys?page=${nextPage}`);
          if (!current(version, token)) return;
          surveys = [...surveys, ...data.surveys];
          nextPage = data.nextPage ?? null;
          render();
        } finally {
          more.disabled = false;
        }
      };
      more.onclick = () => loadMore().catch((error) => message(error.message));
      await loadMore();
      return;
    }
    const { survey } = await api(`/surveys/${encodeURIComponent(id)}`);
    if (!current(version, token)) return;
    document.title = `${survey.title} · FREE-BBS 报名`;
    document.getElementById('lookup').hidden = false;
    lookup.elements.receipt.value = savedReceipt();
    content.replaceChildren(
      el('h2', survey.title),
      el('p', survey.description),
      el(
        'p',
        `${status(survey)} · ${date(survey.opensAt)} — ${date(survey.closesAt)} · ${survey.winnerCount} 个名额`,
        'muted',
      ),
    );
    if (savedReceipt()) {
      try {
        const data = await api(`/surveys/${encodeURIComponent(id)}/result`, 'POST', {
          receipt: savedReceipt(),
        });
        if (!current(version, token)) return;
        showReceipt(savedReceipt());
        renderResult(data);
        return;
      } catch {
        /* An uncommitted retry may have a locally saved receipt. */
      }
    }
    if (!current(version, token)) return;
    content.append(resultLink());
    if (status(survey) !== '报名中') return;
    function showLogin() {
      if (document.getElementById('activity-login-prompt')) return;
      const prompt = el('section', undefined, 'card');
      prompt.id = 'activity-login-prompt';
      const link = el('a', '登录后继续报名 →', 'button');
      link.href = `/login?next=${encodeURIComponent(`/surveys?id=${id}`)}`;
      prompt.append(
        el('h2', '本活动需要登录后报名'),
        el('p', '登录后即可填写报名表，同一账号每期可报名一次。', 'muted'),
        link,
      );
      content.append(prompt);
    }
    if (survey.requiresLogin && !token) {
      showLogin();
      return;
    }
    const form = el('form');
    const contactLabel = el('label', '联系邮箱 *（同一期每个邮箱限报一次）');
    const contact = el('input');
    contact.type = 'email';
    contact.required = true;
    contact.maxLength = 254;
    contact.autocomplete = 'email';
    contactLabel.append(contact);
    form.append(
      contactLabel,
      el(
        'p',
        '联系邮箱和活动回答仅供管理员组织测试使用，不公开展示。邮箱不验证身份，请勿重复报名。带 * 的题目为必填。',
        'muted',
      ),
    );
    const readers = [];
    survey.questions.forEach((q) => {
      const field = el('fieldset');
      field.append(el('legend', `${q.label}${q.required ? ' *' : '（选填）'}`));
      if (['single', 'multiple'].includes(q.type)) {
        const inputs = q.options.map((option) => {
          const label = el('label');
          const input = el('input');
          input.type = q.type === 'single' ? 'radio' : 'checkbox';
          input.name = q.id;
          input.value = option;
          if (q.type === 'single') input.required = q.required;
          label.append(input, document.createTextNode(option));
          field.append(label);
          return input;
        });
        if (q.type === 'single' && !q.required) {
          const clear = el('button', '清除选择', 'secondary');
          clear.type = 'button';
          clear.onclick = () =>
            inputs.forEach((input) => {
              input.checked = false;
            });
          field.append(clear);
        }
        readers.push(() => {
          const values = inputs.filter((input) => input.checked).map((input) => input.value);
          if (q.required && !values.length) {
            inputs[0].focus();
            throw new Error(`请填写：${q.label}`);
          }
          return [q.id, q.type === 'multiple' ? values : values[0] || ''];
        });
      } else {
        const input = el(q.type === 'textarea' ? 'textarea' : 'input');
        input.required = q.required;
        input.maxLength = 5000;
        input.setAttribute('aria-label', q.label);
        field.append(input);
        readers.push(() => [q.id, input.value]);
      }
      form.append(field);
    });
    const submit = el('button', '提交报名');
    submit.type = 'submit';
    form.append(submit);
    // Keep one secret across retries, including a lost response after the server commits.
    const receipt = savedReceipt() || newReceipt();
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (!current(version, token)) return;
      submit.disabled = true;
      message('');
      try {
        const answers = Object.fromEntries(readers.map((read) => read()));
        if (!receiptStore.set(id, receipt)) return;
        await api(`/surveys/${encodeURIComponent(id)}/entries`, 'POST', {
          contact: contact.value,
          answers,
          receipt,
        });
        if (!current(version, token)) return;
        showReceipt(receipt);
        renderResult({ result: 'pending' });
      } catch (error) {
        if (!current(version, token)) return;
        message(error.message);
        if (error.status === 401) showLogin();
      } finally {
        submit.disabled = false;
      }
    };
    content.append(form);
  }
  lookup.onsubmit = async (event) => {
    event.preventDefault();
    const version = viewVersion;
    const token = activeToken;
    if (!current(version, token)) return;
    try {
      const data = await api(`/surveys/${encodeURIComponent(id)}/result`, 'POST', {
        receipt: lookup.elements.receipt.value.trim(),
      });
      if (!current(version, token)) return;
      renderResult(data);
      message('');
    } catch (error) {
      if (current(version, token)) message(error.message);
    }
  };
  async function reloadView() {
    viewVersion += 1;
    const version = viewVersion;
    const token = authToken();
    activeToken = token;
    clearPrivateView();
    try {
      if (!(await receiptStore.sync()) || !current(version, token)) return;
      await load(version, token);
      if (current(version, token) && id && window.location.hash === '#lookup') {
        document.getElementById('lookup').scrollIntoView();
        if (!lookup.elements.receipt.value) lookup.elements.receipt.focus({ preventScroll: true });
      }
    } catch (error) {
      if (current(version, token)) {
        clearPrivateView();
        message(error.message);
      }
    }
  }
  function identityChanged() {
    if (activeToken === authToken()) return;
    // Remove secrets before any asynchronous reload can yield to rendering.
    viewVersion += 1;
    receiptStore.clear();
    clearPrivateView();
    reloadView();
  }
  window.addEventListener('freebbs:session-change', identityChanged);
  window.addEventListener('storage', (event) => {
    if (event.key === 'free_bbs_auth_token' || event.key === null) {
      receiptStore.clear();
      reloadView();
    }
  });
  window.addEventListener('pagehide', () => {
    viewVersion += 1;
    clearPrivateView();
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      receiptStore.clear();
      reloadView();
    }
  });
  reloadView();
})();
