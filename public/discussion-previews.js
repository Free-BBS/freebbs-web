(() => {
  function normalizePreview(value) {
    if (!value || typeof value !== 'object') return null;
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
        : `<span class="discussion-post-preview-circuit" data-cid="${preview.cid}" data-revision="${preview.revision}" aria-hidden="true"></span>`;
    return `<button class="discussion-post-preview" type="button" data-action="open-post" data-post-id="${escape(postId)}" aria-label="查看帖子${preview.type === 'circuit' ? '中的电路图' : '图片'}">${media}</button>`;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { normalizePreview, diagramBounds, markup };
    return;
  }

  let rendererLoader;
  const circuits = new Map();
  const observers = new WeakMap();

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
    root.querySelectorAll('.discussion-post-preview img').forEach((img) => {
      img.addEventListener('error', () => removePreview(img), { once: true });
      if (img.complete && !img.naturalWidth) removePreview(img);
    });
    const render = async (element) => {
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
        if (!root.contains(element)) return;
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
    const elements = root.querySelectorAll('.discussion-post-preview-circuit');
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
