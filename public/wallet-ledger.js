(() => {
  const app = window.freeBbsApp;
  const list = document.getElementById('wallet-ledger-list');
  if (!app || !list) return;
  const status = document.getElementById('wallet-ledger-status');
  const more = document.getElementById('wallet-ledger-more');
  const filter = document.getElementById('wallet-ledger-currency');
  let next = null;
  let busy = false;
  let version = 0;
  let identity = '';
  const delta = (before, after) => {
    const value = BigInt(String(after)) - BigInt(String(before));
    return (value > 0n ? '+' : '') + value.toString();
  };
  async function load(append = false) {
    if (!app.userState.isLoggedIn || (append && (busy || !next))) return;
    version += 1;
    const request = version;
    identity = `${app.userState.uid  }:${  localStorage.getItem('free_bbs_auth_token')}`;
    const owner = identity;
    busy = true;
    more.disabled = true;
    status.textContent = '正在读取账本…';
    try {
      const query = new URLSearchParams({ currency: filter.value });
      if (append) query.set('before', next);
      const result = await app.callApi(`/wallet/ledger?${  query}`);
      if (
        request !== version ||
        owner !== `${app.userState.uid  }:${  localStorage.getItem('free_bbs_auth_token')}`
      )
        return;
      if (!append) list.replaceChildren();
      for (const entry of result.entries) {
        const row = document.createElement('article');
        row.className = 'reward-batch wallet-ledger-entry';
        const heading = document.createElement('h3');
        heading.textContent = entry.title || `余额变动 #${  entry.id}`;
        const amounts = document.createElement('p');
        amounts.className = 'wallet-ledger-deltas';
        for (const [key, label] of [
          ['electric', '电元'],
          ['magnetic', '磁元'],
        ]) {
          const change = delta(entry[`${key  }_before`], entry[`${key  }_after`]);
          if (change === '0') continue;
          const chip = document.createElement('strong');
          chip.textContent = `${change  } ${  label}`;
          chip.dataset.direction = change.startsWith('+') ? 'in' : 'out';
          amounts.append(chip);
        }
        const balances = document.createElement('p');
        balances.textContent =
          `电元 ${ 
          entry.electric_before 
          } → ${ 
          entry.electric_after 
          } · 磁元 ${ 
          entry.magnetic_before 
          } → ${ 
          entry.magnetic_after}`;
        const time = document.createElement('time');
        time.textContent = new Date(entry.created_at).toLocaleString();
        const reason = document.createElement('p');
        reason.textContent = entry.reason || '';
        row.append(heading, amounts, reason, balances, time);
        list.append(row);
      }
      next = result.nextCursor;
      more.hidden = !next;
      status.textContent = list.children.length ? '' : '此筛选下暂时没有收支记录。';
    } catch (error) {
      if (request === version) status.textContent = error.message;
    } finally {
      if (request === version) {
        busy = false;
        more.disabled = false;
      }
    }
  }
  const clear = () => {
    version += 1;
    next = null;
    busy = false;
    list.replaceChildren();
    status.textContent = '';
    more.hidden = true;
  };
  filter.addEventListener('change', () => {
    clear();
    load();
  });
  document.getElementById('wallet-ledger-refresh').onclick = () => load();
  more.onclick = () => load(true);
  window.addEventListener('freebbs:session-change', () => {
    if (identity === `${app.userState.uid  }:${  localStorage.getItem('free_bbs_auth_token')}`) return;
    clear();
    if (app.userState.isLoggedIn) load();
  });
  window.addEventListener('storage', (event) => {
    if (event.key === 'free_bbs_auth_token') clear();
  });
  app.sessionReady.then(() => load());
})();
