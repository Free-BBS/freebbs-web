/* global callApi, userState */
(() => {
  const panel = document.getElementById('training-roster-panel');
  if (!panel) return;
  const form = panel.querySelector('form');
  const status = panel.querySelector('[role="status"]');
  const list = panel.querySelector('ul');
  const links = new Map();
  let entries = [];
  let generation = 0;
  let busy = false;
  let owner = userState.token;
  const endpoint = '/training/roster';

  function button(label, accessibleLabel) {
    const control = document.createElement('button');
    control.type = 'button';
    control.className = 'admin-button bbs-action';
    control.dataset.actionTone = 'secondary';
    control.textContent = label;
    if (accessibleLabel) control.setAttribute('aria-label', accessibleLabel);
    return control;
  }

  async function request(path, method = 'GET', data) {
    const current = userState.token;
    if (!current || !userState.isAdmin) throw new Error('请使用管理员账号登录。');
    const result = await callApi(endpoint + path, { method, body: JSON.stringify(data) });
    if (current !== userState.token || !userState.isAdmin) {
      throw new Error('登录状态已变化。');
    }
    return result;
  }

  async function load() {
    const version = ++generation;
    const result = await request('');
    if (generation !== version) return;
    entries = result.entries;
    render();
  }

  async function mutate(control, action) {
    if (busy) return;
    busy = true;
    control.disabled = true;
    const current = userState.token;
    status.textContent = '';
    try {
      await action();
    } catch (error) {
      if (current === userState.token) status.textContent = error.message;
    } finally {
      busy = false;
      control.disabled = false;
    }
  }

  function render() {
    list.replaceChildren();
    if (!entries.length) {
      const row = document.createElement('li');
      row.textContent = '暂无待授权记录。';
      list.append(row);
      return;
    }
    for (const entry of entries) {
      const row = document.createElement('li');
      row.className = 'training-roster-row';
      const identity = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = entry.fullName;
      const label = document.createElement('small');
      const role = entry.staffRole === 'minister' ? '学培部部长' : '学培部部员';
      label.textContent = `${role} · ${entry.claimedAt ? '已领取' : '待领取'}`;
      identity.append(name, label);
      row.append(identity);
      if (!entry.claimedAt) {
        const actions = document.createElement('div');
        actions.className = 'training-roster-actions';
        const rotate = button('换发链接', `为${entry.fullName}换发注册链接`);
        rotate.addEventListener('click', () =>
          mutate(rotate, async () => {
            const { token } = await request(`/${entry.id}/link`, 'POST');
            links.set(entry.id, token);
            render();
            status.textContent = `已为${entry.fullName}换发链接，旧链接已失效。`;
          }),
        );
        const revoke = button('撤销', `撤销${entry.fullName}的待授权`);
        revoke.addEventListener('click', () =>
          mutate(revoke, async () => {
            await request(`/${entry.id}`, 'DELETE');
            links.delete(entry.id);
            await load();
            status.textContent = `已撤销${entry.fullName}的待授权。`;
          }),
        );
        actions.append(rotate, revoke);
        row.append(actions);
        if (links.has(entry.id)) {
          const link = document.createElement('input');
          link.readOnly = true;
          link.value = new URL(
            `/register#training-invite=${links.get(entry.id)}`,
            window.location.origin,
          ).href;
          link.setAttribute('aria-label', `${entry.fullName}的专属注册链接`);
          const copy = button('复制链接', `复制${entry.fullName}的注册链接`);
          copy.addEventListener('click', async () => {
            try {
              await navigator.clipboard.writeText(link.value);
              status.textContent = `已复制${entry.fullName}的注册链接。`;
            } catch {
              link.focus();
              link.select();
              status.textContent = '请复制选中的注册链接。';
            }
          });
          const result = document.createElement('div');
          result.className = 'training-roster-link';
          result.append(link, copy);
          row.append(result);
        }
      } else {
        links.delete(entry.id);
      }
      list.append(row);
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const fullNames = data
      .get('names')
      .split(/\r?\n/)
      .map((name) => name.trim())
      .filter(Boolean);
    mutate(event.submitter || form.querySelector('[type="submit"]'), async () => {
      const created = await request('', 'POST', { fullNames, staffRole: data.get('staffRole') });
      for (const { id, token } of created.links) links.set(id, token);
      form.reset();
      await load();
      status.textContent = `已添加 ${created.links.length} 位同学。请分别发送他们的专属链接。`;
    });
  });
  panel.addEventListener('toggle', () => {
    if (panel.open) {
      load().catch((error) => {
        status.textContent = error.message;
      });
    }
  });
  document.querySelector('a[href="#training-roster-panel"]').addEventListener('click', () => {
    panel.open = true;
  });
  window.addEventListener('freebbs:session-change', () => {
    if (owner !== userState.token || !userState.isAdmin) {
      owner = userState.token;
      generation += 1;
      links.clear();
      entries = [];
      status.textContent = '';
      form.reset();
      list.replaceChildren();
      panel.open = false;
    }
    if (userState.isAdmin && panel.open)
      load().catch((error) => (status.textContent = error.message));
  });
})();
