(() => {
  const LABELS = {
    undergraduate: '本科生',
    master: '硕士研究生',
    doctor: '博士研究生',
    teacher: '教师',
    company: '企业名称',
  };
  const STATES = { pending: '等待审核', approved: '已批准', rejected: '未通过' };
  const kindFor = (value) => (value?.type === 'education' ? value.education : value?.type);
  const summaryFor = (value) =>
    value?.type === 'company'
      ? value.companyName || ''
      : [value?.institution, value?.year ? `${value.year} 年` : '', value?.className]
          .filter(Boolean)
          .join(' · ');

  function installAdminCertifications({ document: doc, window: host, app }) {
    const root = doc.getElementById('certifications');
    if (!root || !app || !root.classList.contains('admin-certifications')) return;
    const el = Object.fromEntries(
      ['pending', 'filter', 'refresh', 'status', 'list', 'prev', 'next', 'page'].map((name) => [
        name,
        doc.getElementById(`admin-certification-${name}`),
      ]),
    );
    if (Object.values(el).some((node) => !node)) return;
    let owner = '';
    let generation = 0;
    let loadTicket = 0;
    let externalChange = false;
    let loading = false;
    let reviewing = false;
    let ready = false;
    let page = 1;
    let total = 0;
    let pageSize = 30;
    const session = () =>
      !externalChange &&
      app.userState.isLoggedIn &&
      Boolean(app.userState.isAdmin || app.userState.role === 'admin') &&
      app.userState.uid &&
      app.userState.token
        ? `${app.userState.uid}:${app.userState.token}:${app.userState.role}:${Boolean(app.userState.isAdmin)}`
        : '';
    const owns = (key, epoch) => key === session() && epoch === generation;

    function controls() {
      const locked = !session() || loading || reviewing;
      el.filter.disabled = locked;
      el.refresh.disabled = locked;
      el.prev.disabled = locked || !ready || page <= 1;
      el.next.disabled = locked || !ready || page * pageSize >= total;
      el.list.querySelectorAll('input,textarea,button').forEach((field) => {
        const card = field.closest('.certification-review');
        field.disabled = locked || card.dataset.self === 'true';
        if (field.dataset.reviewAction === 'approve')
          field.disabled ||= !card.querySelector('[data-identity-confirmed]').checked;
      });
    }

    async function review(item, card, action) {
      if (loading || reviewing || !session()) return;
      const confirmed = card.querySelector('[data-identity-confirmed]');
      const notes = card.querySelector('textarea');
      const message = card.querySelector('[data-review-message]');
      if (action === 'approve' && !confirmed.checked) {
        message.textContent = '请先勾选已核实身份。';
        return;
      }
      if (!notes.reportValidity()) return;
      const key = session();
      const epoch = generation;
      reviewing = true;
      message.textContent = '正在保存审核结果…';
      controls();
      try {
        const payload = await app.callApi(
          `/admin/certifications/${encodeURIComponent(item.id)}/review`,
          {
            method: 'POST',
            body: JSON.stringify({
              action,
              reviewNote: notes.value.trim(),
              identityConfirmed: confirmed.checked,
            }),
          },
        );
        if (!owns(key, epoch)) return;
        await load();
        if (owns(key, epoch)) {
          el.status.textContent = payload.message || '审核结果已保存，申请人会收到站内通知。';
          host.dispatchEvent(
            new host.CustomEvent('freebbs:certifications-reviewed', {
              detail: { requestId: item.id },
            }),
          );
        }
      } catch (error) {
        if (owns(key, epoch)) {
          if (error.status === 409) await load();
          if (owns(key, epoch)) el.status.textContent = error.message || '审核失败，请重试。';
        }
      } finally {
        if (owns(key, epoch)) {
          reviewing = false;
          controls();
        }
      }
    }

    function cardFor(item) {
      const card = doc.createElement('article');
      card.className = 'certification-review';
      card.dataset.self = String(item.userUid === app.userState.uid);
      const title = doc.createElement('h3');
      title.textContent = `${LABELS[kindFor(item)]} · ${STATES[item.status]}`;
      const applicant = doc.createElement('p');
      applicant.textContent = [item.fullName, item.username, item.userUid]
        .filter(Boolean)
        .join(' · ');
      const detail = doc.createElement('p');
      detail.textContent = summaryFor(item);
      card.append(title, applicant, detail);
      if (item.userUid) {
        const link = doc.createElement('a');
        link.href = `/profile?uid=${encodeURIComponent(item.userUid)}`;
        link.textContent = '查看申请人资料';
        card.append(link);
      }
      if (item.currentApproved) {
        const current = doc.createElement('p');
        current.textContent = `当前有效认证：${summaryFor(item.currentApproved)}；新申请通过后更新。`;
        card.append(current);
      }
      if (item.status !== 'pending') {
        if (item.reviewNote) {
          const note = doc.createElement('p');
          note.textContent = `审核说明：${item.reviewNote}`;
          card.append(note);
        }
        return card;
      }
      const noteLabel = doc.createElement('label');
      noteLabel.className = 'auth-field';
      const noteTitle = doc.createElement('span');
      noteTitle.textContent = '审核说明（选填）';
      const notes = doc.createElement('textarea');
      notes.rows = 2;
      notes.maxLength = 500;
      notes.placeholder = '未通过时可说明需要补充或更正的信息';
      noteLabel.append(noteTitle, notes);
      const confirmation = doc.createElement('label');
      confirmation.className = 'certification-confirmation';
      const check = doc.createElement('input');
      check.type = 'checkbox';
      check.setAttribute('data-identity-confirmed', '');
      const checkCopy = doc.createElement('span');
      checkCopy.textContent = '我已核实申请人身份及申请信息';
      confirmation.append(check, checkCopy);
      const message = doc.createElement('p');
      message.setAttribute('data-review-message', '');
      message.setAttribute('role', 'status');
      message.setAttribute('aria-live', 'polite');
      const actions = doc.createElement('div');
      actions.className = 'certification-review-actions';
      for (const [action, text] of [
        ['approve', '批准认证'],
        ['reject', '不予通过'],
      ]) {
        const button = doc.createElement('button');
        button.type = 'button';
        button.dataset.reviewAction = action;
        button.textContent = text;
        button.addEventListener('click', () => review(item, card, action));
        actions.append(button);
      }
      check.addEventListener('change', controls);
      card.append(noteLabel, confirmation, message, actions);
      if (card.dataset.self === 'true') message.textContent = '自己的认证申请需由其他管理员审核。';
      return card;
    }

    async function load() {
      const key = session();
      const epoch = generation;
      if (!key) return;
      loadTicket += 1;
      const ticket = loadTicket;
      loading = true;
      el.status.textContent = '正在读取认证申请…';
      controls();
      try {
        const status = el.filter.value;
        const [payload, pending] = await Promise.all([
          app.callApi(`/admin/certifications?status=${encodeURIComponent(status)}&page=${page}`),
          status === 'pending' ? null : app.callApi('/admin/certifications?status=pending&page=1'),
        ]);
        if (!owns(key, epoch) || ticket !== loadTicket) return;
        if (!Array.isArray(payload.requests) || !Number.isSafeInteger(payload.total))
          throw new Error('认证申请读取失败，请刷新重试。');
        total = payload.total;
        page = payload.page;
        pageSize = payload.pageSize;
        if (!payload.requests.length && page > 1) {
          page -= 1;
          await load();
          return;
        }
        const items = payload.requests.filter(
          (item) => LABELS[kindFor(item)] && STATES[item.status],
        );
        el.list.replaceChildren(...items.map(cardFor));
        el.pending.textContent = `待审核 ${pending?.total ?? total} 条`;
        el.page.textContent = `第 ${page} / ${Math.max(1, Math.ceil(total / pageSize))} 页`;
        el.status.textContent = items.length
          ? `共 ${total} 条${STATES[status]}申请`
          : `暂无${STATES[status]}申请。`;
        ready = true;
      } catch (error) {
        if (owns(key, epoch) && ticket === loadTicket) {
          el.list.replaceChildren();
          ready = false;
          el.page.textContent = '';
          el.status.textContent = error.message || '认证申请读取失败，请刷新重试。';
        }
      } finally {
        if (owns(key, epoch) && ticket === loadTicket) {
          loading = false;
          controls();
        }
      }
    }

    function sync() {
      const key = session();
      if (key === owner) return;
      owner = key;
      generation += 1;
      ready = false;
      loading = false;
      reviewing = false;
      page = 1;
      total = 0;
      el.filter.value = 'pending';
      el.list.replaceChildren();
      el.status.textContent = '';
      el.page.textContent = '';
      el.pending.textContent = '待审核 0 条';
      root.hidden = !key;
      controls();
      if (key) load();
    }
    el.filter.addEventListener('change', () => {
      page = 1;
      load();
    });
    el.refresh.addEventListener('click', load);
    el.prev.addEventListener('click', () => {
      if (page > 1) {
        page -= 1;
        load();
      }
    });
    el.next.addEventListener('click', () => {
      if (page * pageSize < total) {
        page += 1;
        load();
      }
    });
    host.addEventListener('freebbs:session-change', () => {
      externalChange = false;
      sync();
    });
    host.addEventListener('freebbs:notification-open', (event) => {
      if (
        event.detail?.kind === 'certification' &&
        event.detail.link === '/adminusers#certifications' &&
        session() &&
        !reviewing
      ) {
        el.filter.value = 'pending';
        page = 1;
        load();
      }
    });
    host.addEventListener('storage', (event) => {
      if (event.key === 'free_bbs_auth_token' || event.key === null) {
        externalChange = true;
        sync();
      }
    });
    host.addEventListener('pagehide', () => {
      externalChange = true;
      sync();
    });
    host.addEventListener('pageshow', (event) => {
      if (event.persisted) {
        externalChange = false;
        sync();
      }
    });
    Promise.resolve(app.sessionReady).then(sync);
    controls();
  }
  if (typeof module !== 'undefined' && module.exports)
    module.exports = { installAdminCertifications };
  else installAdminCertifications({ document, window, app: window.freeBbsApp });
})();
