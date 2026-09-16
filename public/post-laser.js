(function initializePostLaser(root) {
  let offset = 0;
  let timer;
  const authors = new Map();
  function sync(payload) {
    const laser =
      payload?.post?.laser ||
      payload?.posts?.find((post) => post.laser)?.laser ||
      payload?.comment?.laser ||
      payload?.comments?.find((comment) => comment.laser)?.laser ||
      payload?.shopItems?.find((item) => item.key === 'laser')?.laser;
    if (Number.isFinite(laser?.serverNowMs)) offset = laser.serverNowMs - Date.now();
    const entries = [
      payload?.post,
      ...(payload?.posts || []),
      payload?.comment,
      ...(payload?.comments || []),
    ];
    const ownLaser = payload?.shopItems?.find((item) => item.key === 'laser')?.laser;
    if (ownLaser && payload?.user) entries.push({ author: payload.user, laser: ownLaser });
    entries.forEach((entry) => {
      const id = Number(entry?.author?.id);
      const state = entry?.laser;
      if (!Number.isSafeInteger(id) || id <= 0 || !Number.isFinite(state?.serverNowMs)) return;
      const previous = authors.get(id);
      if (!previous || state.serverNowMs >= previous.serverNowMs) authors.set(id, state);
    });
    root.document.querySelectorAll('[data-laser-author]').forEach((node) => {
      const state = authors.get(Number(node.dataset.laserAuthor));
      if (state) node.dataset.laserExpires = String(state.active ? state.expiresAtMs : 0);
    });
    refresh();
  }
  function attributes(laser, authorId) {
    const id = Number(authorId);
    const identified = laser && Number.isSafeInteger(id) && id > 0;
    const current = identified ? authors.get(id) : null;
    if (current && current.serverNowMs >= laser.serverNowMs) laser = current;
    const until = Number(laser?.expiresAtMs);
    const active = laser?.active && Number.isSafeInteger(until) && until > Date.now() + offset;
    if (identified) return `data-laser-author="${id}" data-laser-expires="${active ? until : 0}"`;
    return active ? `data-laser-expires="${until}"` : '';
  }
  function refresh() {
    root.clearTimeout(timer);
    const now = Date.now() + offset;
    let remaining = Infinity;
    root.document.querySelectorAll('[data-laser-expires]').forEach((node) => {
      const until = Number(node.dataset.laserExpires);
      const active = Number.isSafeInteger(until) && until > now;
      node.classList.toggle('has-laser-glow', active);
      if (active) remaining = Math.min(remaining, until - now);
    });
    if (Number.isFinite(remaining))
      timer = root.setTimeout(refresh, Math.min(remaining + 1, 60000));
  }
  root.FreeBbsPostLaser = { sync, attributes, refresh };
  new root.MutationObserver(refresh).observe(root.document.body, {
    childList: true,
    subtree: true,
  });
  root.document.addEventListener('visibilitychange', refresh);
  root.addEventListener('pageshow', refresh);
})(window);
