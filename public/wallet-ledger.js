(() => {
  const app = window.freeBbsApp;
  const dialog = document.getElementById('wallet-ledger');
  const list = document.getElementById('wallet-ledger-list');
  if (!app || !dialog || !list) return;
  const status = document.getElementById('wallet-ledger-status');
  const more = document.getElementById('wallet-ledger-more');
  const filter = document.getElementById('wallet-ledger-currency');
  const refresh = document.getElementById('wallet-ledger-refresh');
  const scroll = document.getElementById('wallet-ledger-scroll');
  const trigger = document.getElementById('wallet-ledger-open');
  let next = null;
  let busy = false;
  let version = 0;
  let identity = '';
  let opener = null;
  const currentIdentity = () => `${app.userState.uid}:${app.userState.token}`;
  const format = (value) => BigInt(String(value)).toLocaleString('zh-CN');
  const delta = (before, after) => BigInt(String(after)) - BigInt(String(before));
  const node = (tag, className, text) => {
    const element = document.createElement(tag);
    element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };

  function renderBalances() {
    for (const [key, field] of [
      ['electric', 'electrons'],
      ['magnetic', 'manetrons'],
    ]) {
      document.getElementById(`wallet-balance-${key}`).textContent = app.userState.isLoggedIn
        ? format(app.userState[field] ?? 0)
        : '—';
    }
  }

  function renderEntry(entry) {
    const changes = [
      ['electric', '电元'],
      ['magnetic', '磁元'],
    ].map(([key, label]) => ({
      key,
      label,
      change: delta(entry[`${key}_before`], entry[`${key}_after`]),
    }));
    const incoming = changes.some(({ change }) => change > 0n);
    const outgoing = changes.some(({ change }) => change < 0n);
    let direction = incoming ? 'in' : 'out';
    if (incoming && outgoing) direction = 'exchange';
    const row = node('article', 'wallet-ledger-entry');
    row.setAttribute('role', 'listitem');
    const symbol = node(
      'span',
      'wallet-entry-symbol',
      { in: '↙', out: '↗', exchange: '⇄' }[direction],
    );
    symbol.dataset.direction = direction;
    symbol.setAttribute('aria-hidden', 'true');
    const content = node('div', 'wallet-entry-content');
    const heading = node('div', 'wallet-entry-heading');
    heading.append(node('h3', '', entry.title || '钱包余额变动'));
    const amounts = node('div', 'wallet-ledger-deltas');
    for (const { label, change } of changes) {
      if (change === 0n) continue;
      const chip = node('strong', '', `${change > 0n ? '+' : ''}${format(change)} ${label}`);
      chip.dataset.direction = change > 0n ? 'in' : 'out';
      chip.setAttribute(
        'aria-label',
        `${change > 0n ? '收入' : '支出'} ${format(change < 0n ? -change : change)} ${label}`,
      );
      amounts.append(chip);
    }
    heading.append(amounts);
    const reason = node('p', 'wallet-entry-reason', entry.reason || '该笔变动未附加原因说明。');
    const balances = node('p', 'wallet-entry-balances');
    balances.append(
      node('span', '', '此笔后资产'),
      node('strong', '', `${format(entry.electric_after)} 电元`),
      node('strong', '', `${format(entry.magnetic_after)} 磁元`),
    );
    const date = new Date(entry.created_at);
    const time = node(
      'time',
      '',
      Number.isNaN(date.getTime())
        ? '时间暂不可用'
        : date.toLocaleString('zh-CN', { hour12: false }),
    );
    if (!Number.isNaN(date.getTime())) time.dateTime = date.toISOString();
    content.append(heading, reason, balances, time);
    row.append(symbol, content);
    return row;
  }

  function clear() {
    version += 1;
    next = null;
    busy = false;
    list.replaceChildren();
    status.textContent = '';
    status.dataset.state = '';
    more.hidden = true;
    more.disabled = false;
    refresh.disabled = false;
    list.setAttribute('aria-busy', 'false');
  }

  async function load(append = false) {
    if (!dialog.open || !app.userState.isLoggedIn || (append && (busy || !next))) return;
    version += 1;
    const request = version;
    identity = currentIdentity();
    const owner = identity;
    busy = true;
    more.disabled = true;
    refresh.disabled = true;
    list.setAttribute('aria-busy', 'true');
    status.dataset.state = 'loading';
    status.textContent = append ? '正在翻找更早的收支…' : '正在打开你的资产足迹…';
    try {
      const query = new URLSearchParams({ currency: filter.value });
      if (append) query.set('before', next);
      const result = await app.callApi(`/wallet/ledger?${query}`);
      if (request !== version || owner !== currentIdentity() || !app.userState.isLoggedIn) return;
      // Build the complete page before replacing an earlier successful result.
      const entries = result.entries.map(renderEntry);
      if (!append) {
        list.replaceChildren();
        scroll.scrollTop = 0;
      }
      list.append(...entries);
      next = result.nextCursor;
      more.hidden = !next;
      status.dataset.state = list.children.length ? '' : 'empty';
      status.textContent = list.children.length
        ? ''
        : '这里还是一张白纸。这个币种的下一笔收支，会在这里留下足迹。';
      renderBalances();
    } catch (error) {
      if (request !== version || owner !== currentIdentity()) return;
      status.dataset.state = 'error';
      status.textContent = `${error.message || '账本暂时无法读取'}。${append ? '可点击下方按钮重试，已加载记录仍保留。' : '可点击上方“刷新”重试。'}`;
    } finally {
      if (request === version) {
        busy = false;
        more.disabled = false;
        refresh.disabled = false;
        list.setAttribute('aria-busy', 'false');
      }
    }
  }

  function open() {
    if (!app.userState.isLoggedIn || dialog.open) return;
    opener = document.activeElement;
    clear();
    renderBalances();
    dialog.showModal();
    document.body.classList.add('wallet-dialog-open');
    load();
  }
  trigger.addEventListener('click', open);
  document.getElementById('wallet-ledger-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      dialog.close();
  });
  dialog.addEventListener('close', () => {
    clear();
    document.body.classList.remove('wallet-dialog-open');
    if (opener?.isConnected) opener.focus();
  });
  filter.addEventListener('change', () => {
    clear();
    load();
  });
  refresh.addEventListener('click', () => load());
  more.addEventListener('click', () => load(true));
  window.addEventListener('freebbs:wallet-change', () => {
    renderBalances();
    load();
  });
  window.addEventListener('freebbs:session-change', () => {
    renderBalances();
    if (identity === currentIdentity()) return;
    identity = currentIdentity();
    clear();
    if (dialog.open) dialog.close();
  });
  window.addEventListener('storage', (event) => {
    if (event.key !== 'free_bbs_auth_token' && event.key !== null) return;
    clear();
    if (dialog.open) dialog.close();
  });
  window.addEventListener('hashchange', () => {
    if (window.location.hash === '#wallet-ledger') open();
  });
  app.sessionReady.then(() => {
    renderBalances();
    identity = currentIdentity();
    if (window.location.hash === '#wallet-ledger') open();
  });
})();
