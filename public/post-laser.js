(function initializePostLaser(root) {
  let offset = 0;
  let timer;
  function sync(payload) {
    const laser = payload?.post?.laser || payload?.posts?.find((post) => post.laser)?.laser;
    if (Number.isFinite(laser?.serverNowMs)) offset = laser.serverNowMs - Date.now();
    refresh();
  }
  function attributes(laser) {
    const until = Number(laser?.expiresAtMs);
    if (!laser?.active || !Number.isSafeInteger(until) || until <= Date.now() + offset) return '';
    return `data-laser-expires="${until}"`;
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
