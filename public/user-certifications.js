(() => {
  const EDUCATIONS = { undergraduate: '本科身份', master: '硕士身份', doctor: '博士身份' };
  const KINDS = [...Object.keys(EDUCATIONS), 'teacher', 'company'];
  function slotFor(value) {
    if (value?.type === 'company' || value?.type === 'teacher') return value.type;
    return value?.type === 'education' && EDUCATIONS[value.education] ? value.education : '';
  }
  const labelFor = (value) =>
    EDUCATIONS[slotFor(value)] || (value?.type === 'teacher' ? '教师' : '企业名称');
  const summaryFor = (value) =>
    value.type === 'company'
      ? value.companyName || ''
      : [
          value.type === 'teacher' ? value.verifiedName : '',
          value.institution,
          value.year ? `${value.year} 年${value.type === 'teacher' ? '' : '入学'}` : '',
          value.className,
        ]
          .filter(Boolean)
          .join(' · ');

  function identityLineFor(value) {
    if (value.type === 'company') return value.companyName || '企业名称';
    const institution = value.institution || (value.automatic ? '电子工程系' : '');
    if (value.type === 'teacher') return [institution, '教师'].filter(Boolean).join(' · ');
    const stage = {
      undergraduate: '本科生',
      master: '硕士研究生',
      doctor: '博士研究生',
    }[value.education];
    return [value.year, institution, stage, value.className].filter(Boolean).join(' · ');
  }

  function installUserCertifications({ document: doc, window: host, app }) {
    const root = doc.getElementById('certifications');
    if (!root || !app || !root.classList.contains('user-certifications')) return;
    const ids = [
      'status',
      'refresh',
      'signin',
      'approved',
      'form',
      'kind',
      'education-fields',
      'institution',
      'year',
      'year-label',
      'class',
      'company-fields',
      'company',
      'slot-status',
      'message',
      'submit',
      'requests',
      'add',
      'cancel',
      'editor-title',
    ];
    const el = Object.fromEntries(
      ids.map((name) => [name, doc.getElementById(`certification-${name}`)]),
    );
    if (Object.values(el).some((node) => !node)) return;
    let owner = '';
    let generation = 0;
    let loadTicket = 0;
    let externalChange = false;
    let ready = false;
    let loading = false;
    let saving = false;
    let identityRefreshPending = false;
    let approved = [];
    let automatic = [];
    let requests = [];
    let managedSlots = new Set();
    let fullName = '';
    let formOpen = false;
    let activeKind = 'undergraduate';
    const drafts = new Map();
    let requestedTeacher = false;
    try {
      requestedTeacher =
        new URLSearchParams(host.location?.search || '').get('certification') === 'teacher';
    } catch {
      /* Invalid queries never submit or change identity. */
    }
    function revealCertification() {
      if (
        !['#certifications', '#settings-identity'].includes(host.location?.hash) &&
        !requestedTeacher
      )
        return;
      const fold = root.closest('.personal-fold');
      if (fold) fold.open = true;
    }
    function storedSessionMatches() {
      try {
        return (
          typeof host.localStorage?.getItem !== 'function' ||
          host.localStorage.getItem('free_bbs_auth_token') === app.userState.token
        );
      } catch {
        return false;
      }
    }
    const session = () =>
      !externalChange &&
      storedSessionMatches() &&
      app.userState.isLoggedIn &&
      app.userState.uid &&
      app.userState.token
        ? `${app.userState.uid}:${app.userState.token}`
        : '';
    const owns = (key, epoch) => key === session() && epoch === generation;
    const pendingFor = (kind) =>
      requests.find(
        (item) =>
          item.status === 'pending' &&
          item.requiresReview !== false &&
          !managedSlots.has(kind) &&
          slotFor(item) === kind,
      );
    const approvedFor = (kind) => approved.find((item) => slotFor(item) === kind);
    const availableKinds = () => KINDS.filter((kind) => !managedSlots.has(kind));
    const nextSupplement = () =>
      availableKinds().find(
        (kind) => EDUCATIONS[kind] && !approvedFor(kind) && !pendingFor(kind),
      ) ||
      availableKinds().find((kind) => !approvedFor(kind) && !pendingFor(kind)) ||
      availableKinds()[0];
    function controls() {
      const company = el.kind.value === 'company';
      const locked = !session() || !ready || loading || saving;
      const pending = pendingFor(el.kind.value);
      const managed = managedSlots.has(el.kind.value);
      el.form.hidden = !formOpen || !session();
      el['education-fields'].hidden = company;
      el['company-fields'].hidden = !company;
      el['year-label'].textContent = el.kind.value === 'teacher' ? '相关年份（选填）' : '入学年份';
      el.year.required = !company && el.kind.value !== 'teacher';
      for (const field of el.form.querySelectorAll('input,select,button'))
        field.disabled =
          locked ||
          !formOpen ||
          Boolean((pending || managed) && field !== el.kind && field !== el.cancel);
      for (const name of ['institution', 'year', 'class']) el[name].disabled ||= company;
      el.company.disabled ||= !company;
      el.company.required = company;
      for (const option of el.kind.querySelectorAll('option')) {
        option.disabled = managedSlots.has(option.value);
        option.hidden = option.disabled;
      }
      el.submit.disabled = locked || !formOpen || managed || Boolean(pending);
      el.submit.textContent = approvedFor(el.kind.value) ? '提交修改申请' : '提交认证申请';
      el['slot-status'].textContent = approvedFor(el.kind.value)
        ? '审核期间保留原认证。'
        : '提交后由管理员核实。';
      if (pending) {
        el.submit.textContent = '等待审核';
        el['slot-status'].textContent =
          `此身份已有待审核申请。${approvedFor(el.kind.value) ? '审核期间现有认证继续有效。' : ''}`;
      }
      if (el.kind.value === 'teacher' && ready)
        el['slot-status'].textContent +=
          ` 教师认证牌将公开账号姓名${fullName ? `“${fullName}”` : ''}；更正姓名请联系管理员。`;
      el.refresh.disabled = !session() || loading || saving;
      el.add.hidden = !session();
      el.add.disabled = locked || !availableKinds().length;
      el.add.setAttribute('aria-expanded', String(formOpen));
      el.add.setAttribute('aria-controls', 'certification-form');
      el.add.textContent = availableKinds().some(
        (kind) => EDUCATIONS[kind] && !approvedFor(kind) && !pendingFor(kind),
      )
        ? '补充教育经历'
        : '补充其他身份';
      el.signin.hidden = Boolean(session());
      for (const list of [el.approved, el.requests])
        for (const button of list.querySelectorAll('button')) button.disabled = locked;
    }
    function captureDraft(kind = activeKind) {
      drafts.set(kind, {
        institution: el.institution.value,
        year: el.year.value,
        className: el.class.value,
        companyName: el.company.value,
      });
    }
    function selectKind() {
      const candidate =
        drafts.get(el.kind.value) ||
        pendingFor(el.kind.value) ||
        approvedFor(el.kind.value) ||
        requests.find((item) => item.status === 'rejected' && slotFor(item) === el.kind.value);
      activeKind = el.kind.value;
      el.institution.value = candidate?.institution || '';
      el.year.value = candidate?.year || '';
      el.year.max = String(new Date().getUTCFullYear() + 1);
      el.class.value = candidate?.className || '';
      el.company.value = candidate?.companyName || '';
      el['editor-title'].textContent = '补充身份信息';
      if (pendingFor(activeKind)) el['editor-title'].textContent = '申请详情';
      if (approvedFor(activeKind)) el['editor-title'].textContent = '修改认证信息';
      controls();
    }
    function openEditor(kind) {
      if (!session() || !ready || loading || saving || managedSlots.has(kind)) return;
      if (formOpen) captureDraft();
      el.kind.value = kind;
      formOpen = true;
      el.message.textContent = '';
      selectKind();
      el.kind.focus?.({ preventScroll: true });
    }
    function closeEditor({ preserve = true } = {}) {
      if (preserve && formOpen) captureDraft();
      formOpen = false;
      controls();
    }
    function entry(item, status) {
      const article = doc.createElement('article');
      article.className = 'certification-entry';
      article.dataset.status = status;
      const copy = doc.createElement('div');
      const title = doc.createElement('h3');
      const detail = doc.createElement('p');
      const recognized = status === 'automatic';
      let state = { approved: '已认证', pending: '等待审核', rejected: '待补充' }[status];
      if (recognized) state = '已自动认证';
      const certified = recognized || status === 'approved';
      title.textContent = certified ? identityLineFor(item) : `${labelFor(item)} · ${state}`;
      article.setAttribute('aria-label', `${title.textContent}，${state}`);
      copy.append(title);
      if (!certified) {
        detail.textContent = summaryFor(item);
        copy.append(detail);
      }
      if (item.reviewNote && status === 'rejected') {
        const note = doc.createElement('p');
        note.textContent = `审核说明：${item.reviewNote}`;
        copy.append(note);
      }
      article.append(copy);
      if (!recognized && !managedSlots.has(slotFor(item))) {
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = 'certification-entry-action';
        button.textContent = { approved: '修改', pending: '查看', rejected: '重新申请' }[status];
        button.setAttribute('aria-label', `${button.textContent}${labelFor(item)}认证`);
        button.setAttribute('aria-controls', 'certification-form');
        button.disabled = loading || saving || !session();
        button.addEventListener('click', () => openEditor(slotFor(item)));
        article.append(button);
      }
      return article;
    }
    function render() {
      const identities = [
        ...automatic,
        ...approved.filter((item) => !managedSlots.has(slotFor(item))),
      ];
      el.approved.replaceChildren(
        ...identities.map((item) => entry(item, item.automatic ? 'automatic' : 'approved')),
      );
      const visibleRequests = requests.filter(
        (item) =>
          ['pending', 'rejected'].includes(item.status) &&
          item.requiresReview !== false &&
          !managedSlots.has(slotFor(item)),
      );
      el.requests.replaceChildren(...visibleRequests.map((item) => entry(item, item.status)));
      const pendingCount = visibleRequests.filter((item) => item.status === 'pending').length;
      el.status.textContent = '暂未添加身份。可按需补充，不影响使用平台。';
      if (pendingCount) el.status.textContent = `待审核 ${pendingCount} 项`;
      if (identities.length)
        el.status.textContent = `已认证 ${identities.length} 项${pendingCount ? ` · 待审核 ${pendingCount} 项` : ''}`;
      controls();
    }
    async function load({ preserveDraft = true } = {}) {
      const key = session();
      const epoch = generation;
      if (!key) return;
      identityRefreshPending = false;
      if (preserveDraft && formOpen) captureDraft();
      loadTicket += 1;
      const ticket = loadTicket;
      const first = !ready;
      loading = true;
      el.status.textContent = '正在读取身份信息…';
      controls();
      try {
        const payload = await app.callApi('/me/certifications');
        if (!owns(key, epoch) || ticket !== loadTicket) return;
        if (!Array.isArray(payload.approved) || !Array.isArray(payload.requests))
          throw new Error('身份信息读取失败，请刷新重试。');
        approved = payload.approved.filter(
          (item) => slotFor(item) && (!item.status || item.status === 'approved'),
        );
        requests = payload.requests.filter((item) => slotFor(item));
        fullName = typeof payload.fullName === 'string' ? payload.fullName.trim() : '';
        // Old servers expose bound education as a suggestion, never proof of teacher identity.
        const legacy =
          !Array.isArray(payload.automatic) &&
          payload.suggestion?.type === 'education' &&
          slotFor(payload.suggestion)
            ? [{ ...payload.suggestion, automatic: true, source: 'bound_student_id' }]
            : [];
        automatic = (Array.isArray(payload.automatic) ? payload.automatic : legacy)
          .filter((item) => slotFor(item) && item.automatic === true)
          .map((item) => {
            const prior = item.type === 'teacher' ? approvedFor('teacher') : null;
            return prior
              ? {
                  ...prior,
                  ...item,
                  institution:
                    prior.institution && prior.institution !== '清华大学电子系'
                      ? prior.institution
                      : item.institution || prior.institution,
                  year: item.year || prior.year,
                  className: item.className || prior.className,
                }
              : item;
          });
        managedSlots = new Set([
          ...(Array.isArray(payload.managedSlots)
            ? payload.managedSlots.filter((kind) => KINDS.includes(kind))
            : []),
          ...automatic.map(slotFor),
        ]);
        ready = true;
        if (managedSlots.has(el.kind.value)) closeEditor({ preserve: false });
        if (!availableKinds().includes(el.kind.value)) el.kind.value = availableKinds()[0] || '';
        if (
          first &&
          requestedTeacher &&
          !approvedFor('teacher') &&
          !managedSlots.has('teacher') &&
          !pendingFor('teacher')
        ) {
          el.kind.value = 'teacher';
          formOpen = true;
        }
        if (!preserveDraft || first || formOpen) selectKind();
        render();
        host.dispatchEvent(
          new host.CustomEvent('freebbs:certifications-updated', {
            detail: { approved, automatic },
          }),
        );
      } catch (error) {
        if (owns(key, epoch) && ticket === loadTicket)
          el.status.textContent = error.message || '身份信息读取失败，请刷新重试。';
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
      saving = false;
      identityRefreshPending = false;
      formOpen = false;
      approved = [];
      automatic = [];
      requests = [];
      managedSlots = new Set();
      fullName = '';
      drafts.clear();
      el.form.reset();
      el.approved.replaceChildren();
      el.requests.replaceChildren();
      el.message.textContent = '';
      el.status.textContent = '登录后查看或补充身份。';
      selectKind();
      if (key) load({ preserveDraft: false });
    }
    el.kind.addEventListener('change', () => {
      captureDraft();
      el.message.textContent = '';
      selectKind();
    });
    el.refresh.addEventListener('click', () => load({ preserveDraft: true }));
    el.add.addEventListener('click', () => openEditor(nextSupplement()));
    el.cancel.addEventListener('click', () => {
      closeEditor();
      el.add.focus?.();
    });
    el.form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (
        !formOpen ||
        !ready ||
        loading ||
        saving ||
        !session() ||
        managedSlots.has(el.kind.value) ||
        pendingFor(el.kind.value) ||
        !el.form.reportValidity()
      )
        return;
      const key = session();
      const epoch = generation;
      const kind = el.kind.value;
      captureDraft();
      const body =
        kind === 'company'
          ? { type: 'company', companyName: el.company.value.trim() }
          : {
              type: kind === 'teacher' ? 'teacher' : 'education',
              ...(EDUCATIONS[kind] ? { education: kind } : {}),
              institution: el.institution.value.trim(),
              ...(el.year.value ? { year: Number(el.year.value) } : {}),
              className: el.class.value.trim(),
            };
      saving = true;
      el.message.textContent = '正在提交…';
      controls();
      try {
        const payload = await app.callApi('/me/certifications', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        if (!owns(key, epoch)) return;
        drafts.delete(kind);
        formOpen = false;
        await load({ preserveDraft: false });
        if (owns(key, epoch))
          el.message.textContent = payload.message || '申请已提交，等待管理员核实。';
      } catch (error) {
        if (owns(key, epoch)) {
          if (error.status === 409) await load({ preserveDraft: true });
          if (owns(key, epoch))
            el.message.textContent = error.message || '提交失败，填写内容已保留，请重试。';
        }
      } finally {
        if (owns(key, epoch)) {
          saving = false;
          if (identityRefreshPending) load();
          else controls();
        }
      }
    });
    host.addEventListener('freebbs:session-change', () => {
      externalChange = false;
      sync();
    });
    host.addEventListener('freebbs:identity-updated', () => {
      if (!session()) return;
      if (saving) {
        // The submission will read again; a read already in flight predates this identity.
        identityRefreshPending = true;
        loadTicket += 1;
      } else load();
    });
    host.addEventListener('freebbs:notification-open', (event) => {
      if (
        event.detail?.kind === 'certification' &&
        event.detail.link === '/settings#certifications' &&
        session() &&
        !saving
      )
        load({ preserveDraft: true });
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
    doc.querySelector('.settings-jump-links')?.addEventListener('click', (event) => {
      const link = event.target.closest('a[href^="#"]');
      const fold =
        link && doc.getElementById(link.getAttribute('href').slice(1))?.closest('.personal-fold');
      if (fold) fold.open = true;
    });
    host.addEventListener('hashchange', revealCertification);
    revealCertification();
    Promise.resolve(app.sessionReady).then(sync);
    controls();
  }
  if (typeof module !== 'undefined' && module.exports)
    module.exports = { slotFor, labelFor, summaryFor, identityLineFor, installUserCertifications };
  else installUserCertifications({ document, window, app: window.freeBbsApp });
})();
