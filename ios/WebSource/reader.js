/* global renderMarkdownContent, applyCodeHighlighting */
(() => {
  let installed = false;
  let referenceGeneration = 0;
  const root = document.getElementById('content');
  const originalFetch = window.fetch.bind(window);
  let currentOrigin = '';
  let currentToken = '';
  window.fetch = (input, options = {}) => {
    const request = new Request(
      new URL(typeof input === 'string' ? input : input.url, currentOrigin || document.baseURI),
      options,
    );
    const url = new URL(request.url);
    // Credentials are attached only to the site's API, never to images or external links.
    if (currentToken && url.origin === currentOrigin && url.pathname.startsWith('/api/'))
      request.headers.set('Authorization', `Bearer ${currentToken}`);
    return originalFetch(request);
  };
  function reportHeight() {
    const height = Math.ceil(root.getBoundingClientRect().height + 6);
    window.webkit?.messageHandlers.reader?.postMessage({ type: 'height', value: height });
  }
  window.renderNativeContent = (source, origin, token, dark, fontSize, allowReferences) => {
    currentOrigin = new URL(origin).origin;
    currentToken = token || '';
    window.FreeBBSOrigin = currentOrigin;
    document.body.classList.toggle('dark', dark);
    document.body.classList.toggle('theme-light', !dark);
    document.body.style.fontSize = `${fontSize}px`;
    root.innerHTML = renderMarkdownContent(source);
    // Apply the app's stricter HTTPS policy after the shared website sanitizer.
    root.querySelectorAll('[href],[src]').forEach((node) => {
      for (const name of ['href', 'src']) {
        const raw = node.getAttribute(name);
        if (!raw) continue;
        try {
          const url = new URL(raw, currentOrigin);
          if (
            url.username ||
            url.password ||
            !(url.protocol === 'https:' || (name === 'href' && raw.startsWith('#')))
          )
            node.removeAttribute(name);
          else if (!raw.startsWith('#')) node.setAttribute(name, url.href);
        } catch {
          node.removeAttribute(name);
        }
      }
    });
    applyCodeHighlighting(root);
    root.querySelectorAll('table').forEach((table) => {
      const scroll = document.createElement('div');
      scroll.className = 'table-scroll';
      table.replaceWith(scroll);
      scroll.append(table);
    });
    root.querySelectorAll('pre').forEach((pre) => {
      const code = pre.querySelector('code');
      const copy = document.createElement('button');
      copy.className = 'copy-code';
      copy.textContent = '复制代码';
      copy.addEventListener('click', () =>
        window.webkit?.messageHandlers.reader?.postMessage({
          type: 'copy',
          value: code?.textContent || '',
        }),
      );
      pre.append(copy);
    });
    referenceGeneration += 1;
    const generation = referenceGeneration;
    if (allowReferences) {
      window.FreeBbsCircuitEmbeds.enhance(root);
      window.FreeBbsToolEmbeds.enhance(root, { apiBase: `${currentOrigin}/api` });
      window.FreeBbsLabResults.enhance(root, { apiBase: `${currentOrigin}/api` });
    }
    if (!installed) {
      installed = true;
      new ResizeObserver(reportHeight).observe(root);
      root.addEventListener('load', reportHeight, true);
      root.addEventListener('click', (event) => {
        const link = event.target.closest('a[href]');
        if (link && !link.getAttribute('href').startsWith('#')) {
          event.preventDefault();
          window.webkit?.messageHandlers.reader?.postMessage({ type: 'link', value: link.href });
        }
      });
    }
    requestAnimationFrame(() => {
      if (generation === referenceGeneration) reportHeight();
    });
    document.fonts?.ready.then(reportHeight);
  };
})();
