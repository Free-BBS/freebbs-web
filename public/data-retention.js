(() => {
  const app = window.freeBbsApp;
  const panel = document.getElementById('data-retention-content');
  if (!app || !panel) return;
  const list = document.getElementById('retention-categories');
  const status = document.getElementById('retention-status');
  const refresh = document.getElementById('retention-refresh');
  const access = document.getElementById('retention-access');
  let controller;
  let revision = 0;
  let blocked = false;
  const session = () => {
    if (blocked || !app.userState.isLoggedIn || !app.userState.isAdmin) return '';
    const token = app.userState.token;
    try {
      if (!token || window.localStorage.getItem('free_bbs_auth_token') !== token) return '';
    } catch {
      return '';
    }
    return `${app.userState.uid}:${token}`;
  };
  const el = (tag, value, className) => {
    const node = document.createElement(tag);
    if (value !== undefined) node.textContent = String(value);
    if (className) node.className = className;
    return node;
  };
  const count = (value) =>
    Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString('zh-CN') : '暂无法统计';
  function clear() {
    controller?.abort();
    revision += 1;
    list.replaceChildren();
    status.textContent = '';
    panel.hidden = true;
    access.hidden = false;
    refresh.disabled = false;
    panel.setAttribute('aria-busy', 'false');
  }
  function pair(listNode, name, value) {
    listNode.append(el('dt', name), el('dd', value || '待核对'));
  }
  function render(payload) {
    if (
      payload.mode !== 'read_only' ||
      payload.newCleanupEnabled !== false ||
      !Array.isArray(payload.categories)
    ) {
      throw new Error('检查结果不完整，请稍后重试');
    }
    const fragment = document.createDocumentFragment();
    payload.categories.forEach((category) => {
      const card = el('article', undefined, 'retention-card');
      const head = el('header');
      head.append(
        el('h2', category.label),
        el('span', category.executionStatus, 'retention-state'),
      );
      const details = el('dl', undefined, 'retention-details');
      pair(details, '保存安排', category.retention);
      pair(details, '起算依据', category.startPoint);
      pair(details, '保存用途', category.purpose);
      pair(details, '检查范围', category.coverage);
      card.append(head, details);
      const stats = category.stats || {};
      if (['available', 'partial', 'not_applicable'].includes(stats.status)) {
        const numbers = el('dl', undefined, 'retention-counts');
        pair(
          numbers,
          stats.status === 'partial' ? '已覆盖部分' : '已纳入统计',
          count(stats.totalCount),
        );
        pair(
          numbers,
          category.proposed ? '超过拟定期限' : '到期待核对',
          stats.status === 'not_applicable' ? '不按年限判断' : count(stats.overdueCount),
        );
        pair(numbers, '日期缺失', count(stats.missingDateCount));
        card.append(numbers);
        if (stats.oldestCreatedAt)
          card.append(
            el('p', `最早记录时间（数据库时间）：${stats.oldestCreatedAt}`, 'retention-help'),
          );
      }
      if (stats.message) card.append(el('p', stats.message, 'retention-help'));
      if (category.notes) card.append(el('p', category.notes, 'retention-note'));
      fragment.append(card);
    });
    list.replaceChildren(fragment);
    const checked = new Date(payload.checkedAt);
    status.textContent = Number.isFinite(checked.getTime())
      ? `检查完成 · ${checked.toLocaleString('zh-CN', { hour12: false })}。统计只覆盖卡片列明的范围。`
      : '检查完成。统计只覆盖卡片列明的范围。';
  }
  async function load() {
    clear();
    const owner = session();
    if (!owner) return;
    const currentRevision = revision;
    controller = new AbortController();
    panel.hidden = false;
    access.hidden = true;
    refresh.disabled = true;
    panel.setAttribute('aria-busy', 'true');
    status.textContent = '正在检查分类期限与记录数量…';
    const current = () => revision === currentRevision && session() === owner;
    try {
      const response = await fetch(`${app.apiBaseUrl}/admin/data-retention`, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${app.userState.token}` },
      });
      if (!current()) return;
      if (response.status === 401 || response.status === 403) {
        clear();
        access.textContent = '此页面仅供网站管理员使用，请核对当前登录账号。';
        return;
      }
      if (!response.ok) throw new Error('暂时无法完成检查，请稍后重试');
      const payload = await response.json();
      if (current()) render(payload);
    } catch (error) {
      if (current() && error.name !== 'AbortError')
        status.textContent = '暂时无法完成检查，请点击“重新检查”重试。';
    } finally {
      if (current()) {
        refresh.disabled = false;
        panel.setAttribute('aria-busy', 'false');
      }
    }
  }
  refresh.addEventListener('click', load);
  window.addEventListener('freebbs:session-change', () => {
    blocked = false;
    load();
  });
  window.addEventListener('storage', (event) => {
    if (event.key === 'free_bbs_auth_token' || event.key === null) {
      blocked = true;
      clear();
    }
  });
  window.addEventListener('pagehide', clear);
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) load();
  });
  clear();
  Promise.resolve(app.sessionReady).then(load).catch(clear);
})();
