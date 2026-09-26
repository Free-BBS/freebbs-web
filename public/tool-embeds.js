(() => {
  function parseReference(value, origin) {
    try {
      if (typeof value !== 'string' || !value || value.length > 1024) return null;
      const url = new URL(value, origin);
      if (
        url.origin !== new URL(origin).origin ||
        url.username ||
        url.password ||
        !['/tool-workshop', '/tool-workshop.html'].includes(url.pathname) ||
        url.searchParams.getAll('tool').length !== 1
      )
        return null;
      const tid = url.searchParams.get('tool');
      return /^t_[a-f0-9]{16}$/.test(tid || '') ? { tid } : null;
    } catch {
      return null;
    }
  }

  function sandboxDocument(html, interactive = true) {
    // Put the trusted policy before ALL authored content, even scripts before <head>.
    // The iframe must also omit allow-same-origin, forms, popups and top-navigation.
    const policy = `default-src 'none'; style-src 'unsafe-inline'; script-src ${interactive ? "'unsafe-inline'" : "'none'"}; img-src data: blob:; font-src data:; connect-src 'none'; media-src data: blob:; form-action 'none'; base-uri 'none'; object-src 'none'`;
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${String(html || '')}</body></html>`;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseReference, sandboxDocument };
    return;
  }

  const enhanced = new WeakSet();
  let stylesheetLoaded = false;
  function enhance(root, { apiBase = '/api' } = {}) {
    if (!root?.querySelectorAll) return;
    // Bound work for large posts; remaining references stay ordinary links.
    const available = Math.max(0, 6 - root.querySelectorAll('[data-tool-reference]').length);
    let added = 0;
    for (const link of root.querySelectorAll('a[href]')) {
      if (added >= available) break;
      if (enhanced.has(link) || link.closest('pre, code, [data-tool-reference]')) continue;
      const reference = parseReference(link.getAttribute('href'), window.location.origin);
      if (!reference) continue;
      added += 1;
      enhanced.add(link);
      if (!stylesheetLoaded) {
        const style = document.createElement('link');
        style.rel = 'stylesheet';
        style.href = '/tool-embeds.css';
        document.head.append(style);
        stylesheetLoaded = true;
      }
      // Phrasing elements preserve surrounding inline Markdown without invalid nested blocks.
      const container = document.createElement('span');
      container.className = 'tool-reference';
      container.dataset.toolReference = reference.tid;
      container.setAttribute('role', 'group');
      container.setAttribute('aria-label', '可交互小工具');
      const toolbar = document.createElement('span');
      toolbar.className = 'tool-reference-toolbar';
      const title = document.createElement('strong');
      title.textContent = '小工具';
      const expand = document.createElement('button');
      expand.type = 'button';
      expand.textContent = '展开';
      expand.hidden = true;
      expand.setAttribute('aria-expanded', 'false');
      expand.addEventListener('click', () => {
        const expanded = container.classList.toggle('is-expanded');
        expand.setAttribute('aria-expanded', String(expanded));
        expand.textContent = expanded ? '收起' : '展开';
      });
      toolbar.append(title, expand);
      const status = document.createElement('span');
      status.className = 'tool-reference-status';
      status.setAttribute('role', 'status');
      const footer = document.createElement('span');
      footer.className = 'tool-reference-footer';
      const openLink = document.createElement('a');
      openLink.href = `/tool-workshop?tool=${reference.tid}`;
      openLink.target = '_blank';
      openLink.rel = 'noopener noreferrer';
      openLink.textContent = '在工坊打开';
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = '重试';
      retry.hidden = true;
      footer.append(openLink, retry);
      container.append(toolbar, status, footer);
      link.replaceWith(container);

      const load = async () => {
        retry.hidden = true;
        status.hidden = false;
        status.textContent = '正在加载小工具…';
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
          const response = await fetch(`${apiBase}/tools/${reference.tid}`, {
            credentials: 'omit',
            cache: 'no-store',
            signal: controller.signal,
          });
          if (!response.ok) throw new Error('unavailable');
          const { tool } = await response.json();
          if (
            tool?.id !== reference.tid ||
            !tool.isPublished ||
            typeof tool.html !== 'string' ||
            !tool.html.trim() ||
            tool.html.length > 180000
          )
            throw new Error('invalid tool');
          if (!container.isConnected) return;
          title.textContent = tool.title || '小工具';
          const iframe = document.createElement('iframe');
          iframe.title = `小工具：${tool.title || reference.tid}`;
          iframe.loading = 'lazy';
          iframe.referrerPolicy = 'no-referrer';
          iframe.setAttribute('sandbox', 'allow-scripts');
          iframe.srcdoc = sandboxDocument(tool.html);
          footer.before(iframe);
          status.hidden = true;
          expand.hidden = false;
        } catch {
          if (!container.isConnected) return;
          status.textContent = '小工具暂时无法加载，可能已取消公开或网络异常。';
          retry.hidden = false;
        } finally {
          clearTimeout(timeout);
        }
      };
      retry.addEventListener('click', load);
      load();
    }
  }
  window.FreeBbsToolEmbeds = { parseReference, sandboxDocument, enhance };
})();
