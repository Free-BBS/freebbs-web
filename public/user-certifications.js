(() => {
  const EDUCATIONS = { undergraduate: '本科生', master: '硕士研究生', doctor: '博士研究生' };
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
          value.year ? `${value.year} 年` : '',
          value.className,
        ]
          .filter(Boolean)
          .join(' · ');

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
      'suggestion',
      'suggestion-copy',
      'use-suggestion',
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
    let approved = [];
    let requests = [];
    let suggestion = null;
    let fullName = '';
    const session = () =>
      !externalChange && app.userState.isLoggedIn && app.userState.uid && app.userState.token
        ? `${app.userState.uid}:${app.userState.token}`
        : '';
    const owns = (key, epoch) => key === session() && epoch === generation;
    const pendingFor = (kind) =>
      requests.find((item) => item.status === 'pending' && slotFor(item) === kind);
    const approvedFor = (kind) => approved.find((item) => slotFor(item) === kind);

    function controls() {
      const company = el.kind.value === 'company';
      const locked = !session() || !ready || loading || saving;
      const pending = pendingFor(el.kind.value);
      el['education-fields'].hidden = company;
      el['company-fields'].hidden = !company;
      el['year-label'].textContent =
        el.kind.value === 'teacher' ? '入学或任职年份（选填）' : '入学年份';
      el.year.required = el.kind.value !== 'teacher';
      el.form.querySelectorAll('input,select,button').forEach((field) => {
        field.disabled = locked || Boolean(pending && field !== el.kind);
      });
      for (const name of ['institution', 'year', 'class']) el[name].disabled ||= company;
      el.company.disabled ||= !company;
      el.company.required = company;
      el.submit.disabled = locked || Boolean(pending);
      el.submit.textContent = pending
        ? '等待审核'
        : approvedFor(el.kind.value)
          ? '申请更新认证'
          : '提交认证申请';
      el['slot-status'].textContent = pending
        ? `此身份已有待审核申请。${approvedFor(el.kind.value) ? '审核期间现有认证继续有效。' : '通过前不会显示为已认证。'}`
        : approvedFor(el.kind.value)
          ? '提交修改申请后，原认证会保留到新申请通过。'
          : '提交后由管理员核实，审核通过后生效。';
      if (el.kind.value === 'teacher' && ready)
        el['slot-status'].textContent +=
          ` 教师认证牌将公开账号姓名${fullName ? `“${fullName}”` : ''}；如需更正姓名，请先联系管理员。`;
      el.refresh.disabled = !session() || loading || saving;
      el['use-suggestion'].disabled = locked;
      el.signin.hidden = Boolean(session());
    }

    function selectKind(useSuggestion = false) {
      const candidate = useSuggestion
        ? suggestion
        : pendingFor(el.kind.value) || approvedFor(el.kind.value);
      if (useSuggestion && candidate) el.kind.value = slotFor(candidate);
      el.institution.value = candidate?.institution || '清华大学电子系';
      el.year.value = candidate?.year || new Date().getUTCFullYear();
      el.year.max = String(new Date().getUTCFullYear() + 1);
      el.class.value = candidate?.className || '';
      el.company.value = candidate?.companyName || '';
      controls();
    }

    function entry(item, status) {
      const article = doc.createElement('article');
      article.className = 'certification-entry';
      article.dataset.status = status;
      const title = doc.createElement('h3');
      title.textContent = `${labelFor(item)} · ${status === 'approved' ? '已认证' : status === 'pending' ? '等待审核' : '未通过'}`;
      const detail = doc.createElement('p');
      detail.textContent = summaryFor(item);
      article.append(title, detail);
      if (item.reviewNote && status === 'rejected') {
        const note = doc.createElement('p');
        note.textContent = `审核说明：${item.reviewNote}`;
        article.append(note);
      }
      return article;
    }

    function render() {
      el.approved.replaceChildren(...approved.map((item) => entry(item, 'approved')));
      el.requests.replaceChildren(
        ...requests
          .filter((item) => ['pending', 'rejected'].includes(item.status))
          .map((item) => entry(item, item.status)),
      );
      el.suggestion.hidden = !suggestion;
      el['suggestion-copy'].textContent = suggestion
        ? `已绑定学号识别为${labelFor(suggestion)}，${summaryFor(suggestion)}。请核对后提交，仍需管理员审核。`
        : '';
      el.status.textContent = `已认证 ${approved.length} 项 · 待审核 ${requests.filter((item) => item.status === 'pending').length} 项`;
      controls();
    }

    async function load({ preserveDraft = false } = {}) {
      const key = session();
      const epoch = generation;
      if (!key) return;
      loadTicket += 1;
      const ticket = loadTicket;
      const first = !ready;
      loading = true;
      el.status.textContent = '正在读取认证状态…';
      controls();
      try {
        const payload = await app.callApi('/me/certifications');
        if (!owns(key, epoch) || ticket !== loadTicket) return;
        if (!Array.isArray(payload.approved) || !Array.isArray(payload.requests))
          throw new Error('认证状态读取失败，请刷新重试。');
        approved = payload.approved.filter(
          (item) => slotFor(item) && (!item.status || item.status === 'approved'),
        );
        requests = payload.requests.filter((item) => slotFor(item));
        fullName = typeof payload.fullName === 'string' ? payload.fullName.trim() : '';
        suggestion =
          slotFor(payload.suggestion) && payload.suggestion.type !== 'company'
            ? payload.suggestion
            : null;
        ready = true;
        if (!preserveDraft || first) selectKind(first && Boolean(suggestion));
        render();
        host.dispatchEvent(
          new host.CustomEvent('freebbs:certifications-updated', { detail: { approved } }),
        );
      } catch (error) {
        if (owns(key, epoch) && ticket === loadTicket)
          el.status.textContent = error.message || '认证状态读取失败，请刷新重试。';
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
      approved = [];
      requests = [];
      suggestion = null;
      fullName = '';
      el.form.reset();
      el.approved.replaceChildren();
      el.requests.replaceChildren();
      el.suggestion.hidden = true;
      el['suggestion-copy'].textContent = '';
      el.message.textContent = '';
      el.status.textContent = '请登录后申请认证。';
      selectKind();
      if (key) load();
    }

    el.kind.addEventListener('change', () => {
      el.message.textContent = '';
      selectKind();
    });
    el.refresh.addEventListener('click', load);
    el['use-suggestion'].addEventListener('click', () => selectKind(true));
    el.form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (
        !ready ||
        loading ||
        saving ||
        !session() ||
        pendingFor(el.kind.value) ||
        !el.form.reportValidity()
      )
        return;
      const key = session();
      const epoch = generation;
      const kind = el.kind.value;
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
        await load();
        if (owns(key, epoch))
          el.message.textContent = payload.message || '申请已提交，等待管理员审核。';
      } catch (error) {
        if (owns(key, epoch)) {
          if (error.status === 409) await load();
          if (owns(key, epoch)) el.message.textContent = error.message || '提交失败，请重试。';
        }
      } finally {
        if (owns(key, epoch)) {
          saving = false;
          controls();
        }
      }
    });
    host.addEventListener('freebbs:session-change', () => {
      externalChange = false;
      sync();
    });
    host.addEventListener('freebbs:identity-updated', () => {
      if (session() && !loading && !saving) load();
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
    Promise.resolve(app.sessionReady).then(sync);
    controls();
  }

  if (typeof module !== 'undefined' && module.exports)
    module.exports = { slotFor, labelFor, summaryFor, installUserCertifications };
  else installUserCertifications({ document, window, app: window.freeBbsApp });
})();
