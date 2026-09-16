(() => {
  const app = window.freeBbsApp;
  const el = (id) => document.getElementById(id);
  if (!app || !el('reward-form')) return;
  const selected = new Map();
  let users = [];
  let pending = null;
  let busy = false;
  let owner = '';
  let token = '';
  let storageKey = '';
  let searchVersion = 0;
  let historyVersion = 0;
  let nextCursor = null;
  let historyBusy = false;
  const current = () =>
    owner &&
    app.userState.isAdmin &&
    app.userState.uid === owner &&
    localStorage.getItem('free_bbs_auth_token') === token;
  function message(text, error = false) {
    el('reward-status').textContent = text;
    el('reward-status').classList.toggle('is-error', error);
  }
  function label(user) {
    return `${user.fullName || user.username} · ${user.username} · ${user.studentId || '未填写学号'}`;
  }
  function amounts(electric, magnetic) {
    return (
      [electric ? `${electric} 电元` : '', magnetic ? `${magnetic} 磁元` : '']
        .filter(Boolean)
        .join(' + ') || '0'
    );
  }
  function update() {
    const count = selected.size;
    el('reward-selection-count').textContent = `已选择 ${count} 人`;
    el('reward-selected').replaceChildren();
    for (const user of selected.values()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `${label(user)} ×`;
      button.setAttribute('aria-label', `移除 ${label(user)}`);
      button.onclick = () => {
        selected.delete(String(user.id));
        renderUsers();
        update();
      };
      el('reward-selected').append(button);
    }
    const electric = Number(el('reward-electric').value) || 0;
    const magnetic = Number(el('reward-magnetic').value) || 0;
    el('reward-summary').textContent = pending
      ? `待核对请求：${pending.title} · ${pending.userIds.length} 人，每人 ${amounts(pending.electric, pending.magnetic)}。请使用原请求重试。`
      : `${count} 人 · 每人 ${amounts(electric, magnetic)} · 合计 ${amounts(electric * count, magnetic * count)}`;
    el('reward-fields').disabled = busy || Boolean(pending);
    el('reward-submit').disabled = busy || Boolean(pending) || !count;
    el('reward-retry').hidden = !pending;
    el('reward-retry').disabled = busy;
  }
  function renderUsers() {
    el('reward-users').replaceChildren();
    users.forEach((user) => {
      const row = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = String(user.id);
      input.checked = selected.has(String(user.id));
      input.onchange = () => {
        if (input.checked && selected.size >= 100) {
          input.checked = false;
          message('每批最多选择 100 人，请分批发放。', true);
          return;
        }
        if (input.checked) selected.set(String(user.id), user);
        else selected.delete(String(user.id));
        update();
      };
      const text = document.createElement('span');
      text.textContent = label(user);
      row.append(input, text);
      el('reward-users').append(row);
    });
  }
  async function search() {
    if (!current()) return;
    searchVersion += 1;
    const version = searchVersion;
    el('reward-search-status').textContent = '正在搜索…';
    try {
      const result = await app.callApi(
        `/admin/notifications/audience?q=${encodeURIComponent(el('reward-search').value.trim())}`,
      );
      if (!current() || version !== searchVersion) return;
      users = result.users || [];
      renderUsers();
      el('reward-search-status').textContent =
        `显示 ${users.length} 人（最多显示 100 人，可缩小关键词）。`;
    } catch (error) {
      if (!current() || version !== searchVersion) return;
      users = [];
      renderUsers();
      el('reward-search-status').textContent = error.message;
    }
  }
  function renderBatch(batch) {
    const row = document.createElement('article');
    row.className = 'reward-batch';
    const heading = document.createElement('h3');
    heading.textContent = `#${batch.id} · ${batch.title}`;
    const info = document.createElement('p');
    info.textContent = `${batch.recipient_count} 人 · 每人 ${amounts(Number(batch.electric), Number(batch.magnetic))}\n${batch.reason}\n${batch.actor} · ${new Date(batch.created_at).toLocaleString()}`;
    const details = document.createElement('button');
    details.type = 'button';
    details.textContent = '查看发放名单';
    const list = document.createElement('ul');
    details.onclick = async () => {
      if (!current()) return;
      details.disabled = true;
      try {
        const result = await app.callApi(`/admin/rewards/${encodeURIComponent(batch.id)}`);
        if (!current()) return;
        list.replaceChildren(
          ...result.entries.map((entry) => {
            const li = document.createElement('li');
            li.textContent = `${entry.full_name || entry.username} · ${entry.username} · ${entry.student_id || '未填写学号'}：电元 ${entry.electric_before} → ${entry.electric_after}；磁元 ${entry.magnetic_before} → ${entry.magnetic_after}`;
            return li;
          }),
        );
        details.hidden = true;
      } catch (error) {
        if (current()) {
          message(error.message, true);
          details.disabled = false;
        }
      }
    };
    row.append(heading, info, details, list);
    return row;
  }
  async function history(more = false) {
    if (!current() || (more && (historyBusy || !nextCursor))) return;
    historyVersion += 1;
    const version = historyVersion;
    historyBusy = true;
    el('reward-history-more').disabled = true;
    try {
      const result = await app.callApi(
        `/admin/rewards${more ? `?before=${encodeURIComponent(nextCursor)}` : ''}`,
      );
      if (!current() || version !== historyVersion) return;
      if (!more) el('reward-batches').replaceChildren();
      el('reward-batches').append(...result.batches.map(renderBatch));
      if (!result.batches.length && !more)
        el('reward-batches').textContent = '还没有奖励发放记录。';
      nextCursor = result.nextCursor;
      el('reward-history-more').hidden = !nextCursor;
    } catch (error) {
      if (current() && version === historyVersion) message(error.message, true);
    } finally {
      if (version === historyVersion) {
        historyBusy = false;
        el('reward-history-more').disabled = false;
      }
    }
  }
  async function send() {
    if (!current() || busy || !pending) return;
    busy = true;
    update();
    message('正在发放，请稍候…');
    try {
      const result = await app.callApi('/admin/rewards', {
        method: 'POST',
        body: JSON.stringify(pending),
      });
      if (!current()) return;
      localStorage.removeItem(storageKey);
      pending = null;
      selected.clear();
      renderUsers();
      message(
        `${result.replayed ? '已核对，原奖励已到账' : '奖励已发放'}：${result.recipientCount} 人，批次 #${result.batchId}。站内通知已发送。`,
      );
      await history();
    } catch (error) {
      if (!current()) return;
      // Validation failures are rolled back. Transport/server uncertainty keeps the exact request.
      if (error.status === 400) {
        localStorage.removeItem(storageKey);
        pending = null;
      }
      message(
        `${error.message}${pending ? '。原请求已保留，请点击“重试当前发放”，不会重复奖励。' : ''}`,
        true,
      );
    } finally {
      busy = false;
      if (current()) update();
    }
  }
  el('reward-form').onsubmit = (event) => {
    event.preventDefault();
    if (!current() || pending || busy || !selected.size || !el('reward-form').reportValidity())
      return;
    const electric = Number(el('reward-electric').value);
    const magnetic = Number(el('reward-magnetic').value);
    if (!electric && !magnetic) {
      message('至少填写一种货币的奖励数量。', true);
      return;
    }
    const draft = {
      requestId: crypto.randomUUID(),
      userIds: [...selected.keys()],
      title: el('reward-title').value.trim(),
      reason: el('reward-reason').value.trim(),
      electric,
      magnetic,
    };
    el('reward-confirm-summary').textContent =
      `${draft.title}\n${selected.size} 人，每人 ${amounts(electric, magnetic)}\n合计 ${amounts(electric * selected.size, magnetic * selected.size)}\n原因：${draft.reason}`;
    el('reward-confirm-list').textContent = [...selected.values()].map(label).join('\n');
    el('reward-confirm-send').onclick = () => {
      if (!current() || busy || pending) return;
      try {
        localStorage.setItem(storageKey, JSON.stringify(draft));
      } catch {
        message('浏览器无法保存重试凭据，尚未发放；请检查存储设置。', true);
        return;
      }
      pending = draft;
      el('reward-confirm').close();
      send();
    };
    el('reward-confirm').showModal();
  };
  el('reward-confirm-cancel').onclick = () => el('reward-confirm').close();
  el('reward-retry').onclick = send;
  el('reward-search-button').onclick = search;
  el('reward-search').onkeydown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      search();
    }
  };
  el('reward-select-page').onclick = () => {
    users.forEach((user) => {
      if (selected.size < 100) selected.set(String(user.id), user);
    });
    renderUsers();
    update();
  };
  el('reward-clear').onclick = () => {
    selected.clear();
    renderUsers();
    update();
  };
  el('reward-history-refresh').onclick = () => history();
  el('reward-history-more').onclick = () => history(true);
  el('reward-form').addEventListener('input', () => update());
  document.querySelectorAll('[data-reward-amount]').forEach((button) => {
    button.onclick = () => {
      el('reward-electric').value = button.dataset.rewardAmount;
      el('reward-magnetic').value = '0';
      update();
    };
  });
  function invalidate() {
    searchVersion += 1;
    historyVersion += 1;
    owner = '';
    selected.clear();
    users = [];
    el('reward-confirm').close();
    document.querySelector('[data-admin-content]').classList.add('hidden');
    el('reward-batches').replaceChildren();
    el('reward-users').replaceChildren();
    el('reward-selected').replaceChildren();
  }
  window.addEventListener('freebbs:session-change', () => {
    // Balance refreshes also emit this event; only an identity/permission change revokes the view.
    if (!current()) invalidate();
  });
  window.addEventListener('storage', (event) => {
    if (event.key === 'free_bbs_auth_token' && event.newValue !== token) invalidate();
    if (event.key === storageKey && event.newValue && !pending && current()) {
      try {
        pending = JSON.parse(event.newValue);
        update();
      } catch {
        invalidate();
      }
    }
  });
  app.sessionReady.then(() => {
    if (!app.userState.isLoggedIn || !app.userState.isAdmin) return;
    owner = app.userState.uid;
    token = localStorage.getItem('free_bbs_auth_token');
    storageKey = `free_bbs_reward_pending:${owner}`;
    try {
      pending = JSON.parse(localStorage.getItem(storageKey) || 'null');
    } catch {
      message('上次发放凭据无法读取，请先核对记录。', true);
      return;
    }
    update();
    search();
    history();
  });
})();
