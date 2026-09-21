(() => {
  const app = window.freeBbsApp;
  const section = document.getElementById('bone-recycling');
  const dialog = document.getElementById('bone-sale-dialog');
  if (!app || !section || !dialog) return;
  const kinds = {
    ordinary_fishbone: { name: '普通鱼骨', price: 1 },
    golden_fishbone: { name: '黄金鱼骨', price: 10 },
  };
  const form = document.getElementById('bone-sale-form');
  const input = document.getElementById('bone-sale-quantity');
  const status = document.getElementById('bone-sale-status');
  const summary = document.getElementById('bone-recycling-status');
  const submit = document.getElementById('bone-sale-submit');
  const refresh = document.getElementById('bone-recycling-refresh');
  let sessionEpoch = 0;
  const currentIdentity = () => `${app.userState.uid}:${app.userState.token}:${sessionEpoch}`;
  const intents = new Map();
  let identity = currentIdentity();
  let stock = {};
  let ready = false;
  let activeKey = '';
  let pending = false;
  let stockVersion = 0;
  let opener = null;

  function available(key) {
    const count = Number(stock[key] || 0);
    return Number.isSafeInteger(count) && count > 0 ? count : 0;
  }
  function render() {
    for (const key of Object.keys(kinds)) {
      section.querySelector(`[data-bone-quantity="${key}"]`).textContent = ready
        ? `持有 ${available(key).toLocaleString('zh-CN')} 根`
        : '等待刷新库存';
      section.querySelector(`[data-sell-bone="${key}"]`).disabled =
        !ready || pending || !available(key);
    }
  }
  function updateQuote() {
    const quantity = Number(input.value);
    const valid =
      ready &&
      Number.isSafeInteger(quantity) &&
      quantity >= 1 &&
      quantity <= available(activeKey) &&
      Number.isSafeInteger(quantity * kinds[activeKey].price);
    submit.disabled = pending || !valid;
    document.getElementById('bone-sale-total').textContent = valid
      ? `${(BigInt(quantity) * BigInt(kinds[activeKey].price)).toLocaleString('zh-CN')} 磁元`
      : '请输入有效数量';
    document.getElementById('bone-sale-minus').disabled = pending || quantity <= 1;
    document.getElementById('bone-sale-plus').disabled =
      pending || quantity >= available(activeKey);
  }
  function setPending(value) {
    pending = value;
    for (const control of form.querySelectorAll('button, input')) control.disabled = value;
    submit.textContent = value ? '正在出售…' : '确认出售';
    form.setAttribute('aria-busy', String(value));
    if (activeKey) updateQuote();
    render();
  }
  function show(key, trigger) {
    if (!ready || pending || !available(key) || !app.userState.isLoggedIn) return;
    activeKey = key;
    opener = trigger;
    document.getElementById('bone-sale-title').textContent = `出售${kinds[key].name}`;
    document.getElementById('bone-sale-description').textContent =
      `每根 ${kinds[key].price} 磁元，选一个你想出售的数量吧。`;
    document.getElementById('bone-sale-available').textContent =
      `持有 ${available(key).toLocaleString('zh-CN')} 根`;
    input.max = String(available(key));
    input.value = '1';
    status.textContent = '';
    setPending(false);
    dialog.showModal();
    document.body.classList.add('bone-sale-open');
    input.focus();
    input.select();
  }
  function close() {
    if (!pending) dialog.close();
  }
  async function withDeadline(work, message, onTimeout) {
    let timer;
    try {
      const deadline = new Promise((_resolve, reject) => {
        timer = window.setTimeout(() => {
          reject(new Error(message));
          onTimeout?.();
        }, 15000);
      });
      return await Promise.race([work(), deadline]);
    } finally {
      window.clearTimeout(timer);
    }
  }
  async function refreshStock(message = '') {
    const owner = currentIdentity();
    const version = stockVersion;
    refresh.disabled = true;
    try {
      await withDeadline(() => app.refreshEconomy(), '库存刷新超时');
      if (owner !== currentIdentity() || !app.userState.isLoggedIn) return;
      if (stockVersion === version) throw new Error('库存暂时无法刷新');
      summary.textContent = message;
    } catch (error) {
      if (owner !== currentIdentity()) return;
      ready = false;
      render();
      summary.textContent = `${message}${message ? ' ' : ''}${error.message || '库存暂时无法刷新'}，请点击“刷新库存”重试。`;
    } finally {
      refresh.disabled = false;
    }
  }

  section.addEventListener('click', (event) => {
    const button = event.target.closest('[data-sell-bone]');
    if (button && !button.disabled) show(button.dataset.sellBone, button);
  });
  input.addEventListener('input', updateQuote);
  for (const [id, transform] of [
    ['bone-sale-minus', (quantity) => Math.max(1, quantity - 1)],
    ['bone-sale-plus', (quantity) => Math.min(available(activeKey), quantity + 1)],
    ['bone-sale-all', () => available(activeKey)],
  ]) {
    document.getElementById(id).addEventListener('click', () => {
      input.value = String(transform(Number(input.value) || 1));
      updateQuote();
    });
  }
  document.getElementById('bone-sale-close').addEventListener('click', close);
  document.getElementById('bone-sale-cancel').addEventListener('click', close);
  dialog.addEventListener('cancel', (event) => {
    if (pending) event.preventDefault();
  });
  dialog.addEventListener('close', () => {
    document.body.classList.remove('bone-sale-open');
    if (opener?.isConnected && !opener.disabled) opener.focus();
    else refresh.focus();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      close();
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (pending || !ready || !app.userState.isLoggedIn) return;
    updateQuote();
    if (submit.disabled || !form.reportValidity()) return;
    const owner = currentIdentity();
    const itemKey = activeKey;
    const quantity = Number(input.value);
    const scope = `${itemKey}:${quantity}`;
    // A lost response is retried with the same key, even after closing the dialog.
    if (!intents.has(scope)) intents.set(scope, window.crypto.randomUUID());
    const requestKey = intents.get(scope);
    setPending(true);
    status.textContent = '正在把鱼骨换成磁元，请稍等…';
    try {
      const controller = new AbortController();
      const result = await withDeadline(
        () =>
          app.callApi('/shop/sell', {
            method: 'POST',
            body: JSON.stringify({ itemKey, quantity, requestKey }),
            signal: controller.signal,
          }),
        '出售请求超时，交易结果尚未确认',
        () => controller.abort(),
      );
      if (owner !== currentIdentity() || !app.userState.isLoggedIn) return;
      const { receipt } = result;
      intents.delete(scope);
      const success = `已出售 ${receipt.quantity} 根${kinds[itemKey].name}，收入 ${BigInt(receipt.amount).toLocaleString('zh-CN')} 磁元。${receipt.replayed ? '已确认此前交易，未重复出售。' : ''}`;
      // Refresh from the server: a replayed receipt may contain an older balance.
      ready = false;
      render();
      setPending(false);
      dialog.close();
      summary.textContent = `${success} 正在刷新库存…`;
      await refreshStock(success);
      if (owner !== currentIdentity() || !app.userState.isLoggedIn) return;
      window.dispatchEvent(new CustomEvent('freebbs:wallet-change'));
    } catch (error) {
      if (owner !== currentIdentity() || !app.userState.isLoggedIn) return;
      // Definitive client errors permit a new intent; uncertain failures retain its ID.
      if (error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status))
        intents.delete(scope);
      status.textContent = `${error.message || '出售暂未确认'}。请重试；同一笔重试不会重复出售。`;
    } finally {
      if (owner === currentIdentity()) setPending(false);
    }
  });
  refresh.addEventListener('click', () => refreshStock());
  window.addEventListener('freebbs:inventory-change', (event) => {
    if (!app.userState.isLoggedIn || !Array.isArray(event.detail?.assets)) return;
    stock = Object.fromEntries(event.detail.assets.map((asset) => [asset.key, asset.quantity]));
    ready = true;
    stockVersion += 1;
    render();
    if (dialog.open && !pending) {
      input.max = String(available(activeKey));
      document.getElementById('bone-sale-available').textContent =
        `持有 ${available(activeKey).toLocaleString('zh-CN')} 根`;
      updateQuote();
    }
    if (summary.textContent === '正在查看鱼骨库存…') summary.textContent = '';
  });
  function reset() {
    sessionEpoch += 1;
    identity = currentIdentity();
    intents.clear();
    stock = {};
    ready = false;
    setPending(false);
    if (dialog.open) dialog.close();
    summary.textContent = '';
  }
  window.addEventListener('freebbs:session-change', () => {
    if (identity !== currentIdentity()) reset();
  });
  window.addEventListener('storage', (event) => {
    if (event.key === 'free_bbs_auth_token' || event.key === null) reset();
  });
  app.sessionReady.then(() => {
    identity = currentIdentity();
    if (app.userState.isLoggedIn && !ready) refreshStock();
  });
})();
