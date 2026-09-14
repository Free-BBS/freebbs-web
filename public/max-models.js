/* global API_BASE_URL */
(() => {
  let catalog;
  let pending;
  let owner;
  const controls = new Set();
  const labels = { low: '较低', off: '关闭思考', auto: '自动思考', high: '较高', max: '最高' };
  const user = () => window.freeBbsApp?.userState;
  const key = () => `free_bbs_max_model_v1:${user()?.uid || 'local'}`;
  let selected = {};
  function restore() {
    try {
      selected = JSON.parse(localStorage.getItem(key()) || '{}') || {};
    } catch {
      selected = {};
    }
  }
  function current() {
    const profile =
      catalog?.models.find((item) => item.id === selected.model) ||
      catalog?.models.find((item) => item.id === catalog.defaultModel) ||
      catalog?.models[0];
    if (!profile) return {};
    return {
      model: profile.id,
      reasoning_effort: profile.efforts.includes(selected.reasoning_effort)
        ? selected.reasoning_effort
        : profile.defaultEffort,
      vision: profile.vision,
    };
  }
  function render() {
    const chosen = current();
    for (const host of controls) {
      if (!host.isConnected) {
        controls.delete(host);
        continue;
      }
      const model = host.querySelector('[data-max-model]');
      const effort = host.querySelector('[data-max-effort]');
      model.replaceChildren();
      effort.replaceChildren();
      if (!catalog) model.add(new Option(user()?.token ? '加载模型…' : '登录后选择模型', ''));
      for (const item of catalog?.models || [])
        model.add(new Option(`${item.label}${item.vision ? ' · 视觉' : ''}`, item.id));
      model.value = chosen.model || '';
      const profile = catalog?.models.find((item) => item.id === chosen.model);
      for (const value of profile?.efforts || [])
        effort.add(
          new Option(
            profile.efforts.length === 1 && profile.note === '固定开启思考'
              ? '固定思考'
              : labels[value] || value,
            value,
          ),
        );
      effort.value = chosen.reasoning_effort || '';
      model.disabled = !catalog;
      effort.disabled = !catalog || profile?.efforts.length === 1;
      host.querySelector('[data-max-vision]').textContent = [
        chosen.vision ? '视觉已开启 · 读取电路与波形时同时附图' : '读取电路连接与仿真数据',
        profile?.note,
      ]
        .filter(Boolean)
        .join(' · ');
    }
    window.dispatchEvent(new CustomEvent('freebbs:max-model-change', { detail: chosen }));
  }
  async function ready() {
    const token = user()?.token;
    if (!token) {
      catalog = undefined;
      render();
      return;
    }
    if (owner !== token) {
      catalog = undefined;
      pending = undefined;
      owner = token;
      restore();
    }
    if (catalog) return;
    if (!pending)
      pending = (async () => {
        const response = await fetch(`${API_BASE_URL}/ai/models`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || '模型列表加载失败。');
        if (owner !== token) return;
        catalog = data;
        render();
      })().finally(() => {
        if (owner === token) pending = undefined;
      });
    return pending;
  }
  async function selection() {
    await ready();
    return current();
  }
  function mount(host) {
    if (!host || host.dataset.maxMounted) return;
    host.dataset.maxMounted = 'true';
    host.classList.add('max-model-picker');
    host.innerHTML =
      '<label>模型<select data-max-model aria-label="Max 模型"></select></label><label>思考强度<select data-max-effort aria-label="Max 思考强度"></select></label><small data-max-vision></small>';
    controls.add(host);
    host.addEventListener('change', (event) => {
      selected = {
        model: host.querySelector('[data-max-model]').value,
        reasoning_effort: event.target.matches('[data-max-model]')
          ? undefined
          : host.querySelector('[data-max-effort]').value,
      };
      try {
        localStorage.setItem(key(), JSON.stringify(selected));
      } catch {
        /* Selection still applies to this page. */
      }
      render();
    });
    render();
    ready().catch((error) => {
      host.querySelector('[data-max-vision]').textContent = error.message;
    });
    host.addEventListener('pointerdown', () => ready().catch(() => {}));
  }
  async function raster(svg, label) {
    const copy = svg.cloneNode(true);
    const box = svg.viewBox.baseVal;
    const width = box.width || 920;
    const height = box.height || 310;
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    copy.setAttribute('width', width);
    copy.setAttribute('height', height);
    // Inline computed presentation styles so detached SVGs preserve their visible colors.
    const originals = [svg, ...svg.querySelectorAll('*')];
    const copies = [copy, ...copy.querySelectorAll('*')];
    const properties = [
      'fill',
      'stroke',
      'stroke-width',
      'stroke-dasharray',
      'opacity',
      'font-family',
      'font-size',
      'font-weight',
      'color',
    ];
    originals.forEach((node, index) => {
      const style = getComputedStyle(node);
      for (const property of properties)
        copies[index].style.setProperty(property, style.getPropertyValue(property));
    });
    copy.querySelectorAll('script,foreignObject,image').forEach((node) => node.remove());
    const url = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }),
    );
    try {
      const image = new Image();
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('电路图像转换超时。')), 10000);
        image.onload = () => {
          clearTimeout(timer);
          resolve();
        };
        image.onerror = () => {
          clearTimeout(timer);
          reject(new Error('电路图像转换失败。'));
        };
        image.src = url;
      });
      const scale = Math.min(2, 1800 / Math.max(width, height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(32, Math.round(width * scale));
      canvas.height = Math.max(32, Math.round(height * scale));
      const context = canvas.getContext('2d');
      const background = getComputedStyle(document.body).backgroundColor;
      context.fillStyle = background && background !== 'rgba(0, 0, 0, 0)' ? background : '#102126';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
      if (dataUrl.length > 1400000) throw new Error('图像过大，请缩小画布后重试。');
      return { label, dataUrl };
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  async function circuitOptions(chosen) {
    chosen ||= await selection();
    const { vision, ...options } = chosen;
    if (!vision) return options;
    const svgs = [
      ...document.querySelectorAll(
        '#circuit-stage svg, #circuit-waveform svg, #circuit-extra-plots [data-chart] svg',
      ),
    ];
    if (svgs.length > 13) throw new Error('当前图像超过十三张，请减少图表后再读取。');
    options.vision_images = await Promise.all(
      svgs.map((svg, index) =>
        raster(
          svg,
          svg.closest('#circuit-stage')
            ? '当前电路图'
            : `当前波形图 ${index} · ${svg.getAttribute('aria-label') || ''}`,
        ),
      ),
    );
    return options;
  }
  async function chatOptions(payload) {
    const chosen = await selection();
    const options = await circuitOptions(chosen);
    const attachments = payload.vision_images || [];
    if (attachments.length && !chosen.vision)
      throw new Error('请切换到视觉模型，或移除已添加的图片。');
    if (attachments.length) {
      options.vision_images = [...attachments, ...(options.vision_images || [])];
      if (options.vision_images.length > 13) throw new Error('单次最多发送 13 张图片。');
      return options;
    }
    if (!chosen.vision || options.vision_images?.length) return options;
    const message =
      payload.message ||
      payload.messages?.filter((item) => item.role === 'user').at(-1)?.content ||
      '';
    if (typeof message !== 'string') return options;
    const references = new Map();
    for (const match of message.matchAll(
      /(?:https?:\/\/[^\s()[\]<>]+)?\/circuit\?[^\s()[\]<>]+/g,
    )) {
      const url = new URL(match[0], window.location.origin);
      if (url.origin !== window.location.origin || !url.searchParams.get('cid')) continue;
      const cid = url.searchParams.get('cid');
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(cid)) continue;
      const revision = url.searchParams.get('revision');
      if (revision && !/^[1-9]\d*$/.test(revision)) continue;
      const view = url.searchParams.get('view') === 'waveform' ? 'waveform' : 'schematic';
      references.set(`${cid}:${revision}:${view}`, { cid, revision, view });
    }
    for (const reference of [...references.values()].slice(0, 2)) {
      const response = await fetch(
        `${API_BASE_URL}/circuits/${reference.cid}${reference.revision ? `?revision=${reference.revision}` : ''}`,
        { signal: AbortSignal.timeout(12000) },
      );
      if (!response.ok) continue; // The backend supplies the authoritative missing-reference notice.
      const { circuit } = await response.json();
      const iframe = document.createElement('iframe');
      iframe.setAttribute('aria-hidden', 'true');
      iframe.tabIndex = -1;
      iframe.style.cssText =
        'position:fixed;left:-10000px;top:0;width:1000px;height:900px;border:0;pointer-events:none';
      try {
        await new Promise((resolve, reject) => {
          let observer;
          const finish = (error) => {
            clearTimeout(timer);
            observer?.disconnect();
            if (error) reject(error);
            else resolve();
          };
          const timer = setTimeout(
            () => finish(new Error('引用电路的图像读取超时，请在电路实验室中重试。')),
            25000,
          );
          iframe.onload = () => {
            const doc = iframe.contentDocument;
            const check = () => {
              if (
                doc.querySelector(
                  reference.view === 'waveform' ? '#embed-waveform svg' : '#embed-schematic svg',
                )
              )
                finish();
              else if (doc.querySelector('#embed-status.is-error'))
                finish(new Error(doc.querySelector('#embed-status').textContent));
            };
            observer = new MutationObserver(check);
            observer.observe(doc.body, { childList: true, subtree: true, attributes: true });
            check();
          };
          iframe.src = `/circuit-embed.html?${new URLSearchParams({ cid: circuit.cid, revision: circuit.revision, view: reference.view })}`;
          document.body.append(iframe);
        });
        const svgs = [
          ...iframe.contentDocument.querySelectorAll('#embed-schematic svg, #embed-waveform svg'),
        ];
        for (const svg of svgs) {
          if ((options.vision_images?.length || 0) >= 13) break;
          (options.vision_images ||= []).push(
            await raster(
              svg,
              `${circuit.cid} v${circuit.revision} · ${reference.view === 'waveform' ? '按保存设置在浏览器重新仿真的波形' : '已保存电路图'}`,
            ),
          );
        }
      } finally {
        iframe.remove();
      }
    }
    return options;
  }
  function initialize() {
    document.querySelectorAll('[data-max-model-picker]').forEach(mount);
  }
  window.FreeBbsMaxModels = { mount, selection, circuitOptions, chatOptions, raster };
  window.addEventListener('freebbs:session-change', () => {
    owner = null;
    ready().catch(() => {});
    render();
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
  else initialize();
})();
