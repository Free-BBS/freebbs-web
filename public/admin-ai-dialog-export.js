(() => {
  const app = window.freeBbsApp;
  if (!app || !document.getElementById('admin-export-ai-dialogs')) return;
  let dialog;
  let abort;
  let owner = '';
  let blocked = false;
  const session = () =>
    !blocked && app.userState.isLoggedIn && app.userState.isAdmin
      ? `${app.userState.uid}:${app.userState.token}`
      : '';
  const localInput = (date) =>
    new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const showTime = (value) =>
    value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
  function close() {
    abort?.abort();
    dialog?.close();
    dialog?.remove();
    dialog = null;
    owner = '';
  }
  async function open() {
    close();
    owner = session();
    if (!owner) return;
    abort = new AbortController();
    const node = document.createElement('dialog');
    node.className = 'admin-ai-export-dialog';
    node.setAttribute('aria-labelledby', 'ai-export-title');
    node.innerHTML = `
      <header><div><h2 id="ai-export-title">按范围导出 AI 聊天</h2><p>仅在处理明确违规或其他必要调查时使用。每次导出都会记录操作者、原因、范围和结果。</p></div><button type="button" class="bbs-action" data-action-tone="secondary" data-close>关闭</button></header>
      <form>
        <fieldset><legend>1. 选择用户</legend><label>查找姓名、用户名或学号<input type="search" data-user-search autocomplete="off" /></label><div class="ai-export-options" data-users role="group" aria-label="选择导出用户"></div><p class="ai-export-help">必须逐个选择，最多 10 位。</p></fieldset>
        <fieldset><legend>2. 选择会话时间范围</legend><div class="ai-export-dates"><label>开始时间<input name="from" type="datetime-local" required /></label><label>结束时间<input name="until" type="datetime-local" required /></label></div><p class="ai-export-help">使用本机显示的时间，含开始、不含结束，每次最多 31 天。按会话最后更新时间筛选；导出选中会话的完整已保存内容，可能含范围以前的消息。</p><button type="button" class="bbs-action" data-action-tone="secondary" data-load>查找会话</button></fieldset>
        <fieldset><legend>3. 选择具体会话</legend><div class="ai-export-options" data-dialogs role="group" aria-label="选择导出会话">选择用户和时间后，点击“查找会话”。</div><p class="ai-export-help" data-selection>尚未选择会话。每次最多 100 个。</p></fieldset>
        <label>4. 调查原因<textarea name="reason" required minlength="5" maxlength="1000" rows="3" placeholder="说明需要核查的事项及必要性，请勿填写与本次调查无关的信息。"></textarea></label>
        <p role="status" aria-live="polite" data-message></p>
        <footer><button type="submit" class="bbs-action" data-action-tone="primary" disabled>记录并导出选中会话</button></footer>
      </form>
      <details class="ai-export-audit"><summary>最近导出记录</summary><button type="button" class="bbs-action" data-action-tone="secondary" data-refresh-audit>刷新记录</button><p>“已生成”表示服务器已生成文件，不代表文件已在电脑保存。记录中不保存聊天正文。</p><div data-audit></div></details>`;
    dialog = node;
    document.body.append(node);
    node.showModal();
    const currentOwner = owner;
    const current = () => dialog === node && currentOwner === session() && currentOwner === owner;
    const form = node.querySelector('form');
    const users = node.querySelector('[data-users]');
    const conversations = node.querySelector('[data-dialogs]');
    const load = node.querySelector('[data-load]');
    const submit = form.querySelector('[type="submit"]');
    const message = node.querySelector('[data-message]');
    let revision = 0;
    let catalogScope = '';
    let exporting = false;
    const now = new Date();
    form.elements.until.value = localInput(new Date(now.getTime() + 60000));
    form.elements.from.value = localInput(new Date(now.getTime() - 7 * 86400000));
    const selectedIds = (container) =>
      [...container.querySelectorAll('input:checked')].map((input) => Number(input.value));
    const readScope = () => {
      const userIds = selectedIds(users);
      if (!userIds.length || userIds.length > 10) throw new Error('请选择 1 至 10 位用户');
      const from = new Date(form.elements.from.value);
      const until = new Date(form.elements.until.value);
      if (
        !Number.isFinite(from.getTime()) ||
        !Number.isFinite(until.getTime()) ||
        until <= from ||
        until - from > 31 * 86400000
      ) {
        throw new Error('请填写有效时间范围：结束晚于开始，且不超过 31 天');
      }
      return { userIds, from: from.toISOString(), until: until.toISOString() };
    };
    const selectionChanged = () => {
      const count = selectedIds(conversations).length;
      node.querySelector('[data-selection]').textContent =
        `已选择 ${count} 个会话，每次最多 100 个。`;
      submit.disabled = exporting || !catalogScope || count < 1 || count > 100;
    };
    const setExporting = (busy) => {
      exporting = busy;
      form
        .querySelectorAll('input,textarea,button')
        .forEach((element) => element.toggleAttribute('disabled', busy));
      selectionChanged();
    };
    const clearCatalog = () => {
      revision += 1;
      catalogScope = '';
      conversations.textContent = '筛选条件已变化，请重新查找会话。';
      message.textContent = '';
      selectionChanged();
    };
    const request = async (suffix, body) => {
      if (!current()) throw new Error('登录状态已变化，请重新登录');
      const response = await fetch(`${app.apiBaseUrl}/admin/ai-dialogs/${suffix}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          Authorization: `Bearer ${app.userState.token}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: abort.signal,
        cache: 'no-store',
      });
      if (!current()) throw new Error('登录状态已变化，请重新登录');
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || '操作失败，请稍后重试');
      }
      return response;
    };
    node.querySelector('[data-close]').addEventListener('click', close);
    node.addEventListener('cancel', close);
    users.addEventListener('change', clearCatalog);
    form.elements.from.addEventListener('input', clearCatalog);
    form.elements.until.addEventListener('input', clearCatalog);
    conversations.addEventListener('change', selectionChanged);
    node.querySelector('[data-user-search]').addEventListener('input', (event) => {
      const term = event.target.value.trim().toLowerCase();
      users.querySelectorAll('label').forEach((row) => {
        row.toggleAttribute('hidden', !row.textContent.toLowerCase().includes(term));
      });
    });
    load.addEventListener('click', async () => {
      clearCatalog();
      const requestRevision = revision;
      try {
        const scope = readScope();
        load.disabled = true;
        message.textContent = '正在查找会话…';
        const data = await (await request('export-catalog', scope)).json();
        if (!current() || requestRevision !== revision) return;
        conversations.replaceChildren();
        const userNames = new Map(
          [...users.querySelectorAll('label')].map((row) => [
            Number(row.querySelector('input').value),
            row.querySelector('span').textContent,
          ]),
        );
        data.dialogs.forEach((item) => {
          const label = document.createElement('label');
          const input = document.createElement('input');
          input.type = 'checkbox';
          input.value = String(item.id);
          const text = document.createElement('span');
          text.textContent = `${item.title || '未命名会话'} · ${userNames.get(Number(item.user_id)) || `用户 ${item.user_id}`} · 最后更新 ${showTime(item.updated_at)}`;
          label.append(input, text);
          conversations.append(label);
        });
        if (!data.dialogs.length) conversations.textContent = '此范围没有会话。';
        catalogScope = JSON.stringify(scope);
        message.textContent = data.truncated
          ? '匹配会话超过 500 个，当前仅显示最近 500 个，请缩小时间或用户范围。'
          : `找到 ${data.dialogs.length} 个会话，请逐个选择需要导出的内容。`;
        selectionChanged();
      } catch (error) {
        if (current()) message.textContent = error.message;
      } finally {
        if (current()) load.disabled = false;
      }
    });
    const refreshAudit = async () => {
      const region = node.querySelector('[data-audit]');
      region.textContent = '正在加载…';
      try {
        const data = await (await request('export-audit')).json();
        if (!current()) return;
        region.replaceChildren();
        data.records.forEach((record) => {
          const article = document.createElement('article');
          const title = document.createElement('strong');
          title.textContent = `#${record.id} · ${record.actor_username} · ${{ started: '处理中或中断', generated: '已生成', failed: '失败' }[record.status] || record.status} · ${showTime(record.created_at)}`;
          const reason = document.createElement('p');
          reason.textContent = record.reason;
          const scope = document.createElement('p');
          const ids = (value) => {
            try {
              return (Array.isArray(value) ? value : JSON.parse(value)).join('、');
            } catch {
              return '—';
            }
          };
          scope.textContent = `用户 ID：${ids(record.user_ids_json)}；会话 ID：${ids(record.dialog_ids_json)}；范围：${showTime(record.range_start)} 至 ${showTime(record.range_end)}；已生成 ${record.dialog_count} 个会话、${record.message_count} 条消息。`;
          article.append(title, reason, scope);
          region.append(article);
        });
        if (!data.records.length) region.textContent = '暂无导出记录。';
      } catch (error) {
        if (current()) region.textContent = error.message;
      }
    };
    node.querySelector('[data-refresh-audit]').addEventListener('click', refreshAudit);
    node.querySelector('details').addEventListener('toggle', (event) => {
      if (event.target.open) refreshAudit();
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (exporting) return;
      try {
        const scope = readScope();
        if (!catalogScope || JSON.stringify(scope) !== catalogScope)
          throw new Error('筛选条件已变化，请重新查找会话');
        const dialogIds = selectedIds(conversations);
        if (!dialogIds.length || dialogIds.length > 100) throw new Error('请选择 1 至 100 个会话');
        const reason = form.elements.reason.value.trim();
        if (reason.length < 5 || reason.length > 1000)
          throw new Error('请填写 5 至 1000 字的具体调查原因');
        setExporting(true);
        message.textContent = '正在记录并生成导出文件…';
        const response = await request('export', { ...scope, dialogIds, reason });
        const blob = await response.blob();
        if (!current()) return;
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const fileName = response.headers
          .get('Content-Disposition')
          ?.match(/filename="([^"]+)"/)?.[1];
        link.download = fileName || 'free-bbs-ai-chats.json';
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        message.textContent = `已生成文件，导出记录编号 ${response.headers.get('X-Export-Audit-Id') || '见记录列表'}。请在浏览器下载列表确认保存。`;
        if (node.querySelector('details').open) refreshAudit();
      } catch (error) {
        if (current()) message.textContent = error.message;
      } finally {
        if (current()) setExporting(false);
      }
    });
    users.textContent = '正在加载用户…';
    try {
      const response = await fetch(`${app.apiBaseUrl}/admin/users`, {
        headers: { Authorization: `Bearer ${app.userState.token}` },
        cache: 'no-store',
        signal: abort.signal,
      });
      if (!response.ok) throw new Error('用户列表加载失败，请关闭窗口后重试');
      const data = await response.json();
      if (!current()) return;
      users.replaceChildren();
      data.users.forEach((user) => {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = String(user.id);
        const text = document.createElement('span');
        text.textContent = `${user.fullName || user.username}（${user.username}）${user.studentId ? ` · ${user.studentId}` : ''}`;
        label.append(input, text);
        users.append(label);
      });
    } catch (error) {
      if (current()) users.textContent = error.message;
    }
  }
  window.FreeBbsAiExport = { open };
  window.addEventListener('freebbs:session-change', () => {
    blocked = false;
    if (owner && owner !== session()) close();
  });
  window.addEventListener('storage', (event) => {
    if (event.key === 'free_bbs_auth_token' || event.key === null) {
      blocked = true;
      close();
    }
  });
  window.addEventListener('pagehide', close);
})();
