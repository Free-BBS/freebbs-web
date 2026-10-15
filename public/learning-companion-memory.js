/* An owner-only source manifest. Private saved text never appears in this response. */
(() => {
  const labels = { note: '笔记', annotation: '批注', reflection: '复盘', attempt: '作答' };
  function sourceSummary(manifest) {
    if (!manifest || manifest.scope !== 'authenticated_owner_current_node')
      return '参考资料暂不可用';
    const counts = Object.entries(labels).map(
      ([key, label]) => `${label} ${Number(manifest.counts?.[key]) || 0}`,
    );
    const unavailable =
      ['unavailable', 'partial'].includes(manifest.notesStatus) ||
      manifest.assessmentStatus === 'unavailable';
    return `${counts.join(' · ')}${unavailable ? ' · 部分资料暂不可用' : ''}${manifest.limited ? ' · 仅参考部分近期记录' : ''}`;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { sourceSummary };
    return;
  }
  const app = window.freeBbsApp;
  const page = document.querySelector('[data-knowledge-page]');
  const host = document.querySelector('[data-learning-companion-sources]');
  if (!app || !page || !host) return;
  const details = host.querySelector('details');
  const status = host.querySelector('[data-companion-source-status]');
  const list = host.querySelector('[data-companion-source-list]');
  let context = null;
  let revision = 0;
  let stale = false;
  function clear(message = '提问时会读取最新保存版本。') {
    revision += 1;
    list.replaceChildren();
    status.textContent = message;
  }
  async function refresh() {
    if (!context || stale || !app.userState?.isLoggedIn) {
      clear('登录后可参考你的已保存资料。');
      return;
    }
    revision += 1;
    const request = revision;
    const owner = `${app.userState.uid}:${app.userState.token}`;
    const key = `${context.course}:${context.point}`;
    const current = () =>
      !stale &&
      request === revision &&
      host.isConnected &&
      app.userState?.isLoggedIn &&
      owner === `${app.userState.uid}:${app.userState.token}` &&
      key === `${context?.course}:${context?.point}`;
    list.replaceChildren();
    status.textContent = '正在读取参考资料…';
    try {
      const query = new URLSearchParams(context);
      const payload = await app.callApi(`/learning-companion/sources?${query}`);
      if (!current()) return;
      const manifest = payload.sources;
      if (
        manifest?.courseSlug !== context.course ||
        manifest?.knowledgePointId !== context.point ||
        manifest.scope !== 'authenticated_owner_current_node'
      )
        throw new Error('参考资料范围不匹配');
      status.textContent = sourceSummary(manifest);
      for (const source of manifest.sources || []) {
        const item = document.createElement('li');
        const version =
          { current: '当前版本', historical: '历史版本', unknown: '版本待核对' }[
            source.versionStatus
          ] || '版本待核对';
        item.textContent = `${labels[source.source] || '记录'} ${source.id} · ${source.section === 'origin' ? '知识起源' : source.section === 'assessment' ? '自测' : '正文'} · ${version}${source.truncated ? ' · 已节选' : ''}`;
        list.append(item);
      }
    } catch (error) {
      if (current())
        status.textContent = error.message || '参考资料暂不可用；可继续就课程内容提问。';
    }
  }
  details.addEventListener('toggle', () => {
    if (details.open) refresh();
  });
  host.querySelector('[data-companion-source-refresh]').addEventListener('click', refresh);
  page.addEventListener('knowledge:loaded', (event) => {
    context = { course: event.detail.course.slug, point: event.detail.node.id };
    clear();
    if (details.open) refresh();
  });
  for (const type of [
    'knowledge:personal-saved',
    'knowledge:annotation-saved',
    'knowledge:annotation-removed',
    'knowledge:annotation-undo-completed',
    'knowledge:assessment-updated',
    'knowledge:document-saved',
  ])
    page.addEventListener(type, () => {
      clear('资料已更新，下次提问会读取最新保存版本。');
      if (details.open) refresh();
    });
  page.addEventListener('knowledge:chat-start', refresh);
  window.addEventListener('freebbs:session-change', () => {
    stale = false;
    clear();
    if (details.open) refresh();
  });
  window.addEventListener('storage', (event) => {
    if (event.key === 'free_bbs_auth_token' || event.key === null) {
      stale = true;
      clear('账号已变更，请刷新后查看。');
    }
  });
})();
