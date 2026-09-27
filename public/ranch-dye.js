(() => {
  const app = window.freeBbsApp;
  const data = window.FreeBbsRanchDesignData;
  const renderer = window.FreeBbsRanchDesign;
  const byId = (id) => document.getElementById(id);
  const canvas = byId('dye-canvas');
  const status = byId('dye-status');
  const fieldset = byId('dye-fieldset');
  const save = byId('dye-save');
  const center = byId('dye-center');
  let design = data.blank();
  let saved = JSON.stringify(design);
  let revision = 0;
  let part = 'wool';
  let history = [];
  let session = '';
  let generation = 0;
  let writable = false;
  let busy = false;
  let storageBlocked = false;
  let pointer = null;
  const identity = () =>
    app?.userState?.isLoggedIn ? JSON.stringify([app.userState.uid, app.userState.token]) : '';
  const dirty = () => JSON.stringify(design) !== saved;
  canvas.innerHTML = window.FreeBbsMaxRanch.previewMarkup();
  function render() {
    renderer.apply(canvas, design);
    canvas
      .querySelector('svg')
      .setAttribute('viewBox', part === 'face' ? '96 62 78 72' : '8 54 166 118');
    canvas.dataset.part = part;
    byId('dye-undo').disabled = !history.length;
    save.disabled = !writable || busy || !dirty();
    save.textContent = busy ? '正在保存…' : '保存到我的羊';
    center.disabled = !writable || busy;
  }
  function checkpoint() {
    history.push(JSON.stringify(design));
    if (history.length > 40) history.shift();
  }
  function editable() {
    if (writable && session !== identity()) invalidate();
    return writable && !busy;
  }
  function layer(x, y, overrides = {}) {
    return {
      x,
      y,
      mode: byId('dye-mode').value,
      blend: byId('dye-blend').value,
      color: byId('dye-color').value,
      radius: Number(byId('dye-radius').value) / 100,
      opacity: Number(byId('dye-opacity').value) / 100,
      angle: Number(byId('dye-angle').value),
      ...overrides,
    };
  }
  function add(x, y, record = true) {
    if (!editable()) return false;
    if (design[part].layers.length >= data.MAX_LAYERS) {
      status.textContent = '这个部位已达到 64 层，请撤销或清空后继续。';
      return false;
    }
    if (record) checkpoint();
    design[part].layers.push(layer(x, y));
    status.textContent = `尚未保存 · ${part === 'wool' ? '羊毛' : '脸部'} ${design[part].layers.length}/64 层`;
    render();
    return true;
  }
  function position(event) {
    const svg = canvas.querySelector('svg');
    const matrix = svg.getScreenCTM();
    if (!matrix) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const box = renderer.bounds[part];
    const x = (point.x - box.x) / box.w;
    const y = (point.y - box.y) / box.h;
    return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
  }
  canvas.addEventListener('pointerdown', (event) => {
    if (!editable() || (event.pointerType === 'mouse' && event.button !== 0) || pointer) return;
    const point = position(event);
    if (!point) {
      status.textContent = `请在${part === 'wool' ? '羊毛' : '脸部'}上落笔，也可切换部位。`;
      return;
    }
    if (!add(point.x, point.y)) return;
    pointer = { id: event.pointerId, point };
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  canvas.addEventListener('pointermove', (event) => {
    if (pointer?.id !== event.pointerId || byId('dye-mode').value !== 'splat') return;
    const point = position(event);
    if (!point || Math.hypot(point.x - pointer.point.x, point.y - pointer.point.y) < 0.06) return;
    if (add(point.x, point.y, false)) pointer.point = point;
  });
  const releasePointer = () => {
    pointer = null;
  };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
    canvas.addEventListener(type, releasePointer);
  document.querySelectorAll('[data-part]').forEach((button) =>
    button.addEventListener('click', () => {
      part = button.dataset.part;
      document
        .querySelectorAll('[data-part]')
        .forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
      status.textContent = `正在编辑${part === 'wool' ? '羊毛' : '脸部'}，点按预览染色。`;
      render();
    }),
  );
  function updateColors() {
    document
      .querySelectorAll('[data-color]')
      .forEach((button) =>
        button.setAttribute(
          'aria-pressed',
          String(button.dataset.color === byId('dye-color').value),
        ),
      );
  }
  document.querySelectorAll('[data-color]').forEach((button) =>
    button.addEventListener('click', () => {
      byId('dye-color').value = button.dataset.color;
      updateColors();
    }),
  );
  byId('dye-color').addEventListener('input', updateColors);
  for (const key of ['radius', 'opacity', 'angle'])
    byId(`dye-${key}`).addEventListener('input', (event) => {
      byId(`dye-${key}-value`).value = `${event.target.value}${key === 'angle' ? '°' : '%'}`;
    });
  byId('dye-controls').addEventListener('submit', (event) => event.preventDefault());
  center.addEventListener('click', () => add(0.5, 0.5));
  byId('dye-base').addEventListener('click', () => {
    if (!editable()) return;
    checkpoint();
    design[part].base = byId('dye-color').value;
    render();
    status.textContent = '底色已更换，尚未保存。';
  });
  byId('dye-clear').addEventListener('click', () => {
    if (!editable()) return;
    checkpoint();
    design[part] = data.blank()[part];
    render();
    status.textContent = '已清空当前部位，可以撤销。';
  });
  byId('dye-undo').addEventListener('click', () => {
    if (!editable() || !history.length) return;
    design = JSON.parse(history.pop());
    render();
    status.textContent = '已撤销上一步。';
  });
  const palettes = {
    dawn: ['#eeaf65', '#e78199', '#a28cbd'],
    lake: ['#7e9bc7', '#79ad96', '#6c82bc'],
    berry: ['#a28cbd', '#e78199', '#a75691'],
  };
  document.querySelectorAll('[data-preset]').forEach((button) =>
    button.addEventListener('click', () => {
      if (!editable()) return;
      if (design[part].layers.length > data.MAX_LAYERS - 3) {
        status.textContent = '剩余图层不足，请先撤销一些染色。';
        return;
      }
      checkpoint();
      palettes[button.dataset.preset].forEach((color, i) =>
        design[part].layers.push(
          layer(0.25 + i * 0.25, i === 1 ? 0.35 : 0.65, {
            color,
            mode: 'splat',
            radius: 0.65,
            opacity: 0.9,
          }),
        ),
      );
      render();
      status.textContent = '配色已叠加，可以继续染色。';
    }),
  );
  function invalidate() {
    generation += 1;
    writable = false;
    busy = false;
    pointer = null;
    session = '';
    fieldset.disabled = true;
    center.disabled = true;
    save.disabled = true;
    design = data.blank();
    saved = JSON.stringify(design);
    history = [];
    render();
    status.textContent = '登录状态已变化，请重新载入自己的羊。';
  }
  async function load() {
    if (busy) return;
    // The shared app intentionally leaves cross-tab credentials stale until reload.
    // Never re-enable this editor using its previous in-memory bearer token.
    if (storageBlocked) {
      window.location.reload();
      return;
    }
    if (dirty() && !window.confirm('重新载入会丢弃尚未保存的花纹，继续吗？')) return;
    generation += 1;
    const ticket = generation;
    writable = false;
    fieldset.disabled = true;
    render();
    await app?.sessionReady;
    if (ticket !== generation) return;
    session = identity();
    if (!session) {
      status.textContent = '请先通过顶部头像登录，再重新载入。';
      return;
    }
    status.textContent = '正在载入我的羊…';
    try {
      const result = await app.callApi('/ranch-designs/mine');
      if (ticket !== generation || session !== identity()) return;
      if (!result.adopted) {
        status.textContent = '先去牧场领养 Max，再回来为它染色吧。';
        return;
      }
      design = data.read(result.design);
      saved = JSON.stringify(design);
      revision = result.revision;
      history = [];
      writable = true;
      fieldset.disabled = false;
      render();
      byId('dye-ranch-link').href = `/ranch?uid=${encodeURIComponent(result.uid)}`;
      status.textContent = '选一个颜色，从羊毛上的第一笔开始。';
    } catch (error) {
      if (ticket === generation) status.textContent = error.message || '载入失败，请重试。';
    }
  }
  save.addEventListener('click', async () => {
    if (!editable() || !dirty()) return;
    busy = true;
    fieldset.disabled = true;
    const ticket = generation;
    const owner = session;
    render();
    status.textContent = '正在保存…';
    try {
      const result = await app.callApi('/ranch-designs/mine', {
        method: 'PUT',
        body: JSON.stringify({ design, revision }),
      });
      if (ticket !== generation || owner !== identity()) return;
      design = data.read(result.design);
      saved = JSON.stringify(design);
      revision = result.revision;
      try {
        localStorage.setItem('freebbs_ranch_design_updated', `${Date.now()}`);
      } catch {
        /* Optional broadcast. */
      }
      status.textContent = '已保存！牧场、个人主页和羊群广场都换上新颜色了。';
    } catch (error) {
      if (ticket === generation)
        status.textContent = error.message || '保存失败，花纹仍保留在这里，请重试。';
    } finally {
      if (ticket === generation) {
        busy = false;
        fieldset.disabled = !writable;
        render();
      }
    }
  });
  byId('dye-reload').addEventListener('click', load);
  window.addEventListener('beforeunload', (event) => {
    if (dirty()) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  window.addEventListener('storage', (event) => {
    if (event.key === 'free_bbs_auth_token' || event.key === null) {
      storageBlocked = true;
      invalidate();
    }
  });
  window.addEventListener('freebbs:session-change', () => {
    if (session && session !== identity()) invalidate();
  });
  load();
})();
