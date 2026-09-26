(() => {
  const form = document.getElementById('discussion-compose-form');
  const app = window.freeBbsApp;
  const status = document.getElementById('publish-draft-status');
  const fields = [
    'discussion-compose-title',
    'discussion-compose-content',
    'discussion-compose-board',
    'discussion-login-required',
    'discussion-anonymous',
  ];
  let key;
  let published = false;
  const save = () => {
    if (!key || published) return;
    try {
      const draft = Object.fromEntries(
        fields.map((id) => {
          const field = document.getElementById(id);
          return [id, field.type === 'checkbox' ? field.checked : field.value];
        }),
      );
      sessionStorage.setItem(key, JSON.stringify(draft));
      status.textContent = '草稿已保存';
    } catch {
      status.textContent = '草稿暂未保存';
    }
  };
  Promise.all([app.sessionReady, app.discussionReady]).then(() => {
    if (!app.userState.isLoggedIn) {
      location.replace('/login?next=' + encodeURIComponent(location.pathname + location.search));
      return;
    }
    if (new URLSearchParams(location.search).get('compose') === 'circuit') return;
    key = 'free_bbs_post_draft:' + app.userState.uid;
    try {
      const sharedTool = new URLSearchParams(location.search).get('tool_share') === '1';
      const toolDraft = sharedTool
        ? JSON.parse(sessionStorage.getItem('free_bbs_tool_share_draft') || 'null')
        : null;
      if (toolDraft) {
        document.getElementById('discussion-compose-title').value = String(
          toolDraft.title || '',
        ).slice(0, 120);
        document.getElementById('discussion-compose-content').value = String(
          toolDraft.content || '',
        ).slice(0, 20000);
        sessionStorage.removeItem('free_bbs_tool_share_draft');
        status.textContent = '已带入小工具分享内容';
      }
      const draft = toolDraft ? null : JSON.parse(sessionStorage.getItem(key) || 'null');
      if (draft) {
        fields.forEach((id) => {
          const field = document.getElementById(id);
          if (typeof draft[id] === 'boolean') field.checked = draft[id];
          else if (typeof draft[id] === 'string') field.value = draft[id];
        });
        document.getElementById('discussion-compose-board').dispatchEvent(new Event('change'));
        status.textContent = '已恢复草稿';
      }
    } catch {
      /* Storage may be unavailable. */
    }
    form.addEventListener('input', save);
    form.addEventListener('change', save);
  });
  form.addEventListener('discussion:published', () => {
    published = true;
    try {
      sessionStorage.removeItem(key);
    } catch {}
  });
  window.addEventListener('pagehide', save);
  window.addEventListener('freebbs:session-change', () => {
    if (key && key !== 'free_bbs_post_draft:' + app.userState.uid) {
      key = null;
      form.reset();
      location.replace('/login?next=%2Fpublish');
    }
  });
})();
