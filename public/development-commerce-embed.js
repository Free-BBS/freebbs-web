(() => {
  if (new URLSearchParams(window.location.search).get('embed') !== 'development') return;

  document.documentElement.classList.add('development-embedded');
  const routes = new Set([
    '/inventory',
    '/electromagnetic',
    '/profile',
    '/settings',
    '/ranch',
    '/ranch-gallery',
    '/ranch-dye',
  ]);
  function navigate(href) {
    try {
      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin || !routes.has(url.pathname)) return false;
      window.parent.postMessage(
        {
          type: 'freebbs:development-commerce-navigation',
          path: `${url.pathname}${url.search}${url.hash}`,
        },
        '*',
      );
      return true;
    } catch {
      return false;
    }
  }
  window.freeBbsDevelopmentNavigate = navigate;
  document.addEventListener(
    'click',
    (event) => {
      const link = event.target.closest?.('a[href]');
      if (
        !link ||
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      if (navigate(link.href)) event.preventDefault();
    },
    true,
  );
  document.addEventListener('DOMContentLoaded', () => {
    let scheduled = false;
    let lastHeight = 0;
    const reportHeight = () => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(() => {
        scheduled = false;
        const height = Math.ceil(document.body.scrollHeight);
        if (height === lastHeight) return;
        lastHeight = height;
        window.parent.postMessage({ type: 'freebbs:development-commerce-size', height }, '*');
      });
    };
    if (typeof ResizeObserver === 'function')
      new ResizeObserver(reportHeight).observe(document.body);
    window.addEventListener('load', reportHeight);
    window.addEventListener('resize', reportHeight);
    reportHeight();
  });
})();
