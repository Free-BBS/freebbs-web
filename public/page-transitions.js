(() => {
  // Warm only a navigation destination the user is pointing at, never private API data.
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const seen = new WeakMap();
  window.FreeBbsMotion = {
    feed(list, scope) {
      const cards = [...list.querySelectorAll('.discussion-post-card')];
      const key = `${scope}:${cards.map((card) => card.dataset.postId).join(',')}`;
      const previous = seen.get(list);
      seen.set(list, key);
      if (previous === key || reducedMotion.matches) return;
      cards.slice(0, 6).forEach((card, index) => {
        card.animate?.(
          [
            { opacity: 0.45, translate: '0 5px' },
            { opacity: 1, translate: '0 0' },
          ],
          {
            duration: 180,
            delay: index * 18,
            easing: 'cubic-bezier(.2,.65,.3,1)',
            fill: 'backwards',
          },
        );
      });
    },
  };
  const connection = navigator.connection;
  if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType || '')) return;
  const warmed = new Set();
  const paths = new Set([
    '/',
    '/world',
    '/aichat',
    '/discussion',
    '/workbench',
    '/settings',
    '/development',
    '/circuits',
  ]);
  let timer;
  function warm(target) {
    const link = target.closest?.('.topbar a[href], .mobile-nav a[href]');
    if (!link || link.download || (link.target && link.target !== '_self')) return;
    const url = new URL(link.href, location.href);
    if (
      url.origin !== location.origin ||
      !paths.has(url.pathname) ||
      url.href === location.href ||
      warmed.has(url.href) ||
      warmed.size >= 6
    )
      return;
    warmed.add(url.href);
    const hint = document.createElement('link');
    hint.rel = 'prefetch';
    hint.href = url.href;
    hint.as = 'document';
    document.head.append(hint);
  }
  document.addEventListener(
    'pointerover',
    (event) => {
      clearTimeout(timer);
      timer = setTimeout(() => warm(event.target), 90);
    },
    { passive: true },
  );
  document.addEventListener('pointerout', () => clearTimeout(timer), { passive: true });
  document.addEventListener('focusin', (event) => warm(event.target));
  document.addEventListener('touchstart', (event) => warm(event.target), { passive: true });
})();
