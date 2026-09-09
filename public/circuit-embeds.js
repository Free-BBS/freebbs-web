(() => {
  const CID_PATTERN = /^c_[a-f0-9]{24}$/;
  const views = { live: '电路动态图', waveform: '电路波形图', schematic: '电路原理图' };

  function parseReference(value, origin) {
    try {
      if (!value || value.length > 1024) return null;
      const url = new URL(value, origin);
      if (url.origin !== new URL(origin).origin || url.pathname !== '/circuit') return null;
      const cid = url.searchParams.get('cid');
      const revision = url.searchParams.get('revision');
      const view = url.searchParams.get('view');
      if (
        !CID_PATTERN.test(cid || '') ||
        !/^[1-9]\d{0,8}$/.test(revision || '') ||
        !Object.hasOwn(views, view)
      )
        return null;
      if (['cid', 'revision', 'view'].some((key) => url.searchParams.getAll(key).length !== 1))
        return null;
      return { cid, revision: Number(revision), view };
    } catch {
      return null;
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseReference };
    return;
  }

  const enhanced = new WeakSet();
  const frames = new Set();
  const theme = () => (document.body.classList.contains('theme-light') ? 'light' : 'dark');
  let stylesheetLoaded = false;

  function enhance(root) {
    if (!root?.querySelectorAll) return;
    root.querySelectorAll('a[href]').forEach((link) => {
      if (enhanced.has(link) || link.closest('pre, code, [data-circuit-reference]')) return;
      const reference = parseReference(link.getAttribute('href'), window.location.origin);
      if (!reference) return;
      enhanced.add(link);
      if (!stylesheetLoaded) {
        const style = document.createElement('link');
        style.rel = 'stylesheet';
        style.href = '/circuit-embeds.css';
        document.head.append(style);
        stylesheetLoaded = true;
      }
      const figure = document.createElement('figure');
      figure.className = 'circuit-reference';
      figure.dataset.circuitReference = reference.cid;
      const iframe = document.createElement('iframe');
      const query = new URLSearchParams({ ...reference, theme: theme() });
      iframe.src = `/circuit-embed?${query}`;
      iframe.title = `${views[reference.view]} · ${reference.cid} · 版本 ${reference.revision}`;
      iframe.loading = 'lazy';
      iframe.referrerPolicy = 'same-origin';
      iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
      iframe.setAttribute('height', reference.view === 'waveform' ? '480' : '520');
      const caption = document.createElement('figcaption');
      const openLink = document.createElement('a');
      openLink.href = `/circuit?${new URLSearchParams({ cid: reference.cid, revision: reference.revision })}`;
      openLink.target = '_blank';
      openLink.rel = 'noopener noreferrer';
      openLink.textContent = `打开${views[reference.view]} · ${reference.cid} · v${reference.revision}`;
      caption.append(openLink);
      figure.append(iframe, caption);
      const paragraph = link.parentElement;
      if (
        paragraph?.tagName === 'P' &&
        paragraph.children.length === 1 &&
        paragraph.textContent.trim() === link.textContent.trim()
      )
        paragraph.replaceWith(figure);
      else if (paragraph?.tagName === 'P') {
        const before = document.createElement('p');
        const after = document.createElement('p');
        let passed = false;
        [...paragraph.childNodes].forEach((node) => {
          if (node === link) passed = true;
          else (passed ? after : before).append(node);
        });
        paragraph.replaceWith(
          ...(before.hasChildNodes() ? [before] : []),
          figure,
          ...(after.hasChildNodes() ? [after] : []),
        );
      } else link.replaceWith(figure);
      frames.add(iframe);
    });
  }

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin || event.data?.type !== 'freebbs:circuit-height')
      return;
    const height = Number(event.data.height);
    if (!Number.isFinite(height)) return;
    frames.forEach((iframe) => {
      if (!iframe.isConnected) {
        frames.delete(iframe);
        return;
      }
      if (iframe.contentWindow === event.source)
        iframe.setAttribute('height', String(Math.max(260, Math.min(1400, Math.ceil(height)))));
    });
  });
  new MutationObserver(() => {
    frames.forEach((iframe) => {
      if (!iframe.isConnected) {
        frames.delete(iframe);
        return;
      }
      iframe.contentWindow?.postMessage(
        { type: 'freebbs:circuit-theme', theme: theme() },
        window.location.origin,
      );
    });
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  window.FreeBbsCircuitEmbeds = { enhance, parseReference };
})();
