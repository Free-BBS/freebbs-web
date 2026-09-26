(() => {
  if (new URLSearchParams(window.location.search).get('embed') !== 'development') return;

  document.documentElement.classList.add('development-embedded');
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
      const path = new URL(link.href, window.location.href).pathname;
      if (path !== '/inventory' && path !== '/electromagnetic') return;
      event.preventDefault();
      window.parent.postMessage({ type: 'freebbs:development-commerce-navigation', path }, '*');
    },
    true,
  );
})();
