(() => {
  'use strict';
  const script = document.currentScript;
  const site = script?.dataset.site || '';
  document.documentElement.dataset.showcaseSite = site;
  const themeSheet = document.createElement('link');
  themeSheet.rel = 'stylesheet'; themeSheet.href = new URL('platform-theme.css', script.src).href;
  document.head.append(themeSheet);
  const home = new URL(script?.dataset.home || 'index.html', location.href).href;
  const siteRoot = new URL('./', home).href;
  let ephemeral = false;
  for (const key of ['localStorage', 'sessionStorage']) {
    try { const storage = window[key]; const probe = '__showcase_probe'; storage.setItem(probe, '1'); storage.removeItem(probe); }
    catch {
      const entries = new Map();
      const storage = { get length() { return entries.size; }, key(index) { return [...entries.keys()][index] ?? null; },
        getItem(key) { return entries.get(String(key)) ?? null; }, setItem(key, value) { entries.set(String(key), String(value)); },
        removeItem(key) { entries.delete(String(key)); }, clear() { entries.clear(); } };
      try { Object.defineProperty(window, key, { value: storage, configurable: true }); ephemeral = true; } catch { /* The submitted code also handles unavailable storage. */ }
    }
  }
  let pending = false, last = 0;
  const measure = () => {
    if (!document.body) return 0;
    // The audiovisual submission is an intentional, internally scrolling multi-screen workspace.
    if (site === 'audiovisual') return Math.round(Math.max(660, Math.min(900, innerWidth * .66)));
    const body = document.body;
    const box = body.getBoundingClientRect();
    const style = getComputedStyle(body);
    const height = box.top + scrollY + Math.max(box.height, body.scrollHeight)
      + (Number.parseFloat(style.marginBottom) || 0);
    return Math.max(320, Math.ceil(height));
  };
  const send = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; const height = measure();
      if (height && height !== last) { last = height; parent.postMessage({ type: 'showcase-size', height }, '*'); }
    });
  };
  const normalizeLinks = (root) => {
    if (!root) return;
    root.querySelectorAll?.('a[href]').forEach((link) => {
      const raw = link.getAttribute('href');
      if (!raw || /^(?:#|mailto:|tel:|data:|blob:)/i.test(raw)) return;
      let target; try { target = new URL(raw, location.href); } catch { return; }
      if (/^https?:$/.test(target.protocol) && !target.href.startsWith(siteRoot)) {
        link.target = '_blank'; link.rel = 'noopener noreferrer';
      }
    });
  };
  addEventListener('message', (event) => {
    if (event.source !== parent || event.data?.type !== 'showcase-theme'
      || !['light', 'dark'].includes(event.data.mode)) return;
    document.documentElement.dataset.platformTheme = event.data.mode;
    dispatchEvent(new CustomEvent('showcase-theme', { detail: { mode: event.data.mode } }));
  });
  addEventListener('DOMContentLoaded', () => {
    const css = document.createElement('style');
    css.textContent = '.showcase-platform-home{position:fixed;bottom:14px;left:14px;z-index:2147483000;display:inline-flex;align-items:center;gap:6px;padding:9px 13px;border:1px solid #acd1c6;border-radius:999px;background:#f3fff9ed;color:#174a42;font:600 12px/1.4 system-ui,sans-serif;text-decoration:none;box-shadow:0 3px 14px #163a4320;backdrop-filter:blur(8px)}.showcase-platform-home:focus-visible{outline:3px solid #edb64a;outline-offset:3px}.showcase-storage-note{padding:12px 15px;border:1px solid #9dbbaa;border-radius:12px;background:#f0faf2;color:#214a3c;font:13px/1.7 system-ui,sans-serif;margin:16px 0}.showcase-platform-home:hover{background:#fff}';
    if (site === 'creative') css.textContent += 'body::after,body.page-arrival::after{animation-duration:.18s!important}.page-home .cover{min-height:min(100svh,900px)}';
    document.head.append(css);
    const link = document.createElement('a'); link.className = 'showcase-platform-home';
    link.href = home; link.textContent = '← 本展区首页'; link.setAttribute('aria-label', '返回本部门展区首页');
    const hasHomeLink = [...document.querySelectorAll('a[href]')].some((anchor) => {
      try { return new URL(anchor.href, location.href).pathname === new URL(home).pathname; }
      catch { return false; }
    });
    if (new URL(location.href).pathname !== new URL(home).pathname && !hasHomeLink) document.body.append(link);
    if (site === 'humanities' && ephemeral) {
      const note = document.createElement('p'); note.className = 'showcase-storage-note';
      note.textContent = '草稿、自定义词句与留言在本次浏览中临时保存，离开前请导出作品；留言不会发送给部门，联系请使用邮箱。';
      (document.querySelector('#intro') || document.body).append(note);
    }
    normalizeLinks(document);
    const observer = new ResizeObserver(send); observer.observe(document.documentElement); observer.observe(document.body);
    new MutationObserver((changes) => { for (const change of changes) for (const node of change.addedNodes) if (node.nodeType === 1) { normalizeLinks(node); if (node.matches?.('a[href]')) normalizeLinks(node.parentElement); } send(); })
      .observe(document.body, { subtree: true, childList: true });
    document.fonts?.ready.then(send); send();
  });
  addEventListener('load', send, true); addEventListener('resize', send); addEventListener('toggle', send, true);
})();
