(() => {
  function normalizePreview(value) {
    if (!value || typeof value !== 'object') return null;
    if (value.type === 'tool' && /^t_[a-f0-9]{16}$/.test(value.tid || ''))
      return { type: 'tool', tid: value.tid };
    if (value.type === 'image' && typeof value.url === 'string') {
      const url = value.url.trim();
      // eslint-disable-next-line no-control-regex -- disallow control characters in image URLs
      if (!url || url.length > 4096 || /[\u0000-\u001f\u007f\\]/.test(url)) return null;
      if (!/^https?:\/\//i.test(url) && !/^\/(?!\/)/.test(url)) return null;
      return { type: 'image', url, alt: String(value.alt || '帖子图片').slice(0, 200) };
    }
    if (
      value.type === 'circuit' &&
      /^c_[a-f0-9]{24}$/.test(value.cid || '') &&
      Number.isSafeInteger(value.revision) &&
      value.revision > 0 &&
      value.revision <= 999999999
    ) {
      return { type: 'circuit', cid: value.cid, revision: value.revision };
    }
    return null;
  }

  function diagramBounds(documentValue) {
    if (!documentValue.components.length) return [0, 0, 1000, 640];
    const positions = [
      ...documentValue.components,
      ...documentValue.wires.flatMap((wire) => wire.points || []),
    ];
    const xs = positions.map(({ x }) => x);
    const ys = positions.map(({ y }) => y);
    const left = Math.min(...xs) - 100;
    const top = Math.min(...ys) - 100;
    return [
      left,
      top,
      Math.max(320, Math.max(...xs) - left + 100),
      Math.max(240, Math.max(...ys) - top + 100),
    ];
  }

  const escape = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (char) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[char],
    );

  function markup(value, postId, { resolveAssetUrl = (url) => url } = {}) {
    const preview = normalizePreview(value);
    if (!preview) return '';
    const media =
      preview.type === 'image'
        ? `<img src="${escape(resolveAssetUrl(preview.url))}" alt="${escape(preview.alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`
        : preview.type === 'tool'
          ? `<span class="discussion-post-preview-tool" data-tid="${preview.tid}" aria-hidden="true"></span>`
          : `<span class="discussion-post-preview-circuit" data-cid="${preview.cid}" data-revision="${preview.revision}" aria-hidden="true"></span>`;
    const label = { image: '图片', circuit: '中的电路图', tool: '中的小工具' }[preview.type];
    return `<button class="discussion-post-preview" type="button" data-action="open-post" data-post-id="${escape(postId)}" aria-label="查看帖子${label}">${media}</button>`;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { normalizePreview, diagramBounds, markup };
    return;
  }

  let rendererLoader;
  let toolLoader;
  const circuits = new Map();
  const observers = new WeakMap();
  const sizeObservers = new WeakMap();
  const versions = new WeakMap();

  function loadToolSandbox() {
    if (window.FreeBbsToolEmbeds) return Promise.resolve();
    if (!toolLoader) {
      toolLoader = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/tool-embeds.js';
        script.onload = resolve;
        script.onerror = () => {
          script.remove();
          toolLoader = null;
          reject(new Error('小工具预览组件加载失败'));
        };
        document.head.append(script);
      });
    }
    return toolLoader;
  }

  async function loadTool(tid, apiBase) {
    const response = await fetch(`${apiBase}/tools/${tid}`, {
      credentials: 'omit',
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('小工具预览不可用');
    const { tool } = await response.json();
    if (
      tool?.id !== tid ||
      !tool.isPublished ||
      typeof tool.html !== 'string' ||
      !tool.html.trim() ||
      tool.html.length > 180000
    )
      throw new Error('小工具未公开或内容无效');
    return tool;
  }

  function loadRenderer() {
    if (window.FreeBbsCircuitRenderer && window.FreeBbsCircuitEngine) return Promise.resolve();
    if (!rendererLoader) {
      const load = (src, globalName) =>
        new Promise((resolve, reject) => {
          if (window[globalName]) {
            resolve();
            return;
          }
          const script = document.createElement('script');
          script.src = src;
          script.onload = resolve;
          script.onerror = () => {
            script.remove();
            reject(new Error('预览组件加载失败'));
          };
          document.head.append(script);
        });
      rendererLoader = load('/circuit-engine.js', 'FreeBbsCircuitEngine')
        .then(() => load('/circuit-annotations.js', 'FreeBbsCircuitAnnotations'))
        .then(() => load('/circuit-renderer.js', 'FreeBbsCircuitRenderer'))
        .catch((error) => {
          rendererLoader = null;
          throw error;
        });
    }
    return rendererLoader;
  }

  function removePreview(element) {
    const button = element.closest('.discussion-post-preview');
    button?.closest('.discussion-post-card-main')?.classList.remove('has-preview');
    button?.remove();
  }

  function loadCircuit(preview, apiBase) {
    const key = `${apiBase}/${preview.cid}:${preview.revision}`;
    if (!circuits.has(key)) {
      if (circuits.size >= 40) circuits.delete(circuits.keys().next().value);
      const request = fetch(`${apiBase}/circuits/${preview.cid}?revision=${preview.revision}`, {
        credentials: 'omit',
        signal: AbortSignal.timeout(10000),
      })
        .then(async (response) => {
          if (!response.ok) throw new Error('电路预览不可用');
          const { circuit } = await response.json();
          if (circuit?.cid !== preview.cid || circuit?.revision !== preview.revision)
            throw new Error('电路版本不匹配');
          return circuit;
        })
        .catch((error) => {
          circuits.delete(key);
          throw error;
        });
      circuits.set(key, request);
    }
    return circuits.get(key);
  }

  function enhance(root, { apiBase = '/api' } = {}) {
    if (!root) return;
    observers.get(root)?.disconnect();
    sizeObservers.get(root)?.disconnect();
    const version = {};
    versions.set(root, version);
    const tools = new Map();
    const fitTool = (element) => {
      const iframe = element.querySelector('iframe');
      const scale = element.clientWidth / 640;
      if (!iframe || !scale) return;
      iframe.style.width = '640px';
      iframe.style.height = `${Math.ceil(element.clientHeight / scale)}px`;
      iframe.style.transform = `scale(${scale})`;
    };
    const sizeObserver =
      'ResizeObserver' in window
        ? new ResizeObserver((entries) => entries.forEach(({ target }) => fitTool(target)))
        : null;
    if (sizeObserver) sizeObservers.set(root, sizeObserver);
    root.querySelectorAll('.discussion-post-preview img').forEach((img) => {
      img.addEventListener('error', () => removePreview(img), { once: true });
      if (img.complete && !img.naturalWidth) removePreview(img);
    });
    const render = async (element) => {
      if (element.classList.contains('discussion-post-preview-tool')) {
        const preview = normalizePreview({ type: 'tool', tid: element.dataset.tid });
        if (!preview) return removePreview(element);
        try {
          if (!element.querySelector('iframe')) {
            if (!tools.has(preview.tid)) tools.set(preview.tid, loadTool(preview.tid, apiBase));
            const [, tool] = await Promise.all([loadToolSandbox(), tools.get(preview.tid)]);
            if (!root.contains(element) || versions.get(root) !== version) return;
            const iframe = document.createElement('iframe');
            iframe.title = '小工具静态预览';
            iframe.setAttribute('sandbox', '');
            iframe.setAttribute('tabindex', '-1');
            iframe.setAttribute('aria-hidden', 'true');
            iframe.setAttribute('inert', '');
            iframe.referrerPolicy = 'no-referrer';
            iframe.srcdoc = window.FreeBbsToolEmbeds.sandboxDocument(tool.html, false);
            element.append(iframe);
          }
          fitTool(element);
          sizeObserver?.observe(element);
        } catch {
          if (versions.get(root) === version) removePreview(element);
        }
        return;
      }
      const preview = normalizePreview({
        type: 'circuit',
        cid: element.dataset.cid,
        revision: Number(element.dataset.revision),
      });
      if (!preview) {
        removePreview(element);
        return;
      }
      try {
        const [, circuit] = await Promise.all([loadRenderer(), loadCircuit(preview, apiBase)]);
        if (!root.contains(element) || versions.get(root) !== version) return;
        const documentValue = window.FreeBbsCircuitEngine.validateDocument(circuit.document);
        window.FreeBbsCircuitRenderer.renderSchematic(element, documentValue, {
          viewBox: diagramBounds(documentValue),
          animate: false,
          interactive: false,
        });
        element.querySelector('svg')?.setAttribute('focusable', 'false');
      } catch {
        removePreview(element);
      }
    };
    const elements = root.querySelectorAll(
      '.discussion-post-preview-circuit, .discussion-post-preview-tool',
    );
    if (!('IntersectionObserver' in window)) {
      elements.forEach(render);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries
          .filter(({ isIntersecting }) => isIntersecting)
          .forEach(({ target }) => {
            observer.unobserve(target);
            render(target);
          });
      },
      { rootMargin: '160px' },
    );
    observers.set(root, observer);
    elements.forEach((element) => observer.observe(element));
  }

  window.FreeBbsDiscussionPreviews = { normalizePreview, markup, enhance };
})();
