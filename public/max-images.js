(() => {
  const MAX_IMAGES = 4;
  function validateFile(file) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
      throw new Error('请选择 PNG、JPEG 或 WebP 图片。');
    if (!file.size || file.size > 10 * 1024 * 1024)
      throw new Error('单张图片须大于 0 且不超过 10 MB。');
  }
  async function prepare(file) {
    validateFile(file);
    const bitmap = await createImageBitmap(file);
    try {
      if (bitmap.width < 32 || bitmap.height < 32) throw new Error('图片宽高至少为 32 像素。');
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(32, Math.round(bitmap.width * scale));
      canvas.height = Math.max(32, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      let dataUrl;
      for (const quality of [0.88, 0.75, 0.6, 0.45]) {
        dataUrl = canvas.toDataURL('image/jpeg', quality);
        if (dataUrl.length <= 1390000) return { label: file.name.slice(0, 120), dataUrl };
      }
      throw new Error('图片压缩后仍过大，请裁剪后重试。');
    } finally {
      bitmap.close();
    }
  }
  function createController({
    root,
    prepareImage = prepare,
    requireVision = (value) => globalThis.window?.FreeBbsMaxModels?.requireVision(value),
  }) {
    const add = root.querySelector('[data-image-add]');
    const input = root.querySelector('[data-image-input]');
    const status = root.querySelector('[data-image-status]');
    const previews = root.querySelector('[data-image-previews]');
    let images = [];
    let vision = false;
    let busy = false;
    let processing = false;
    let generation = 0;
    let error = '';
    function removeImage(index) {
      images.splice(index, 1);
      if (!images.length) Promise.resolve(requireVision(false)).catch(() => {});
      error = '';
      render();
    }
    function render() {
      add.disabled = busy || processing || images.length >= MAX_IMAGES;
      input.disabled = add.disabled;
      status.textContent =
        error ||
        (processing
          ? '正在处理图片…'
          : !vision
            ? images.length
              ? '请切换到视觉模型，或移除图片后发送。'
              : '粘贴、拖入或选择图片，将自动启用视觉模型'
            : '可拖入或粘贴图片，最多 4 张，每张 10 MB；发送后保存到对话记录。');
      previews.replaceChildren();
      for (const [index, item] of images.entries()) {
        const card = document.createElement('div');
        const img = document.createElement('img');
        img.src = item.dataUrl;
        img.alt = item.label;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'max-image-remove';
        remove.innerHTML =
          '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>';
        remove.title = '移除图片';
        remove.setAttribute('aria-label', `移除 ${item.label}`);
        remove.disabled = busy || processing;
        remove.addEventListener('click', removeImage.bind(null, index));
        card.append(img, remove);
        previews.append(card);
      }
    }
    async function select(files) {
      if (!files.length) return;
      if (busy || processing) {
        error = !vision ? '请先选择视觉模型，再添加图片。' : '正在处理或发送消息，请稍后添加图片。';
        render();
        return;
      }
      error = '';
      if (images.length + files.length > MAX_IMAGES) {
        error = '最多添加 4 张图片，请减少所选图片。';
        render();
        return;
      }
      const version = generation;
      processing = true;
      render();
      try {
        if (!vision) await requireVision(true);
        vision = true;
        const prepared = [];
        for (const file of files) prepared.push(await prepareImage(file));
        if (version === generation) images.push(...prepared);
      } catch (failure) {
        if (version === generation) error = failure.message || '图片读取失败，请重试。';
      } finally {
        processing = false;
        if (!images.length) Promise.resolve(requireVision(false)).catch(() => {});
        input.value = '';
        render();
      }
    }
    add.addEventListener('click', () => input.click());
    input.addEventListener('change', () => select([...input.files]));
    render();
    return {
      select,
      setVision(value) {
        vision = Boolean(value);
        error = '';
        render();
      },
      setBusy(value) {
        busy = value;
        render();
      },
      clear() {
        generation += 1;
        images = [];
        Promise.resolve(requireVision(false)).catch(() => {});
        input.value = '';
        error = '';
        render();
      },
      snapshot() {
        if (processing) throw new Error('图片正在处理，请稍候再发送。');
        if (images.length && !vision) throw new Error('请切换到视觉模型，或移除已添加的图片。');
        return images.map((item) => ({ ...item }));
      },
    };
  }
  function bindImageInput({ area, input, controller }) {
    if (!area || !input) return;
    const hasFiles = (event) => [...(event.dataTransfer?.types || [])].includes('Files');
    let dragDepth = 0;
    const reset = () => {
      dragDepth = 0;
      area.classList.remove('is-image-dragging');
    };
    area.addEventListener('dragenter', (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth += 1;
      area.classList.add('is-image-dragging');
    });
    area.addEventListener('dragover', (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    });
    area.addEventListener('dragleave', () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) reset();
    });
    area.addEventListener('drop', (event) => {
      reset();
      if (!hasFiles(event)) return;
      event.preventDefault();
      controller.select([...(event.dataTransfer.files || [])]);
    });
    area.addEventListener('dragend', reset);
    input.addEventListener('paste', (event) => {
      const files = [...(event.clipboardData?.items || [])]
        .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter(Boolean);
      if (!files.length) return;
      event.preventDefault();
      if (!input.disabled) {
        const text = event.clipboardData.getData('text/plain');
        if (text) {
          const room = Math.max(
            0,
            input.maxLength - input.value.length + input.selectionEnd - input.selectionStart,
          );
          input.setRangeText(text.slice(0, room), input.selectionStart, input.selectionEnd, 'end');
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
      controller.select(files);
    });
  }
  let viewer;
  function openImage(item) {
    if (!viewer) {
      const dialog = document.createElement('dialog');
      dialog.className = 'max-image-viewer';
      dialog.setAttribute('aria-label', '查看消息图片');
      dialog.innerHTML = `
        <header class="max-image-viewer-toolbar">
          <span data-viewer-title></span>
          <div>
            <button type="button" data-viewer-out aria-label="缩小图片">−</button>
            <output data-viewer-scale aria-live="polite"></output>
            <button type="button" data-viewer-in aria-label="放大图片">+</button>
            <button type="button" data-viewer-fit>适应窗口</button>
            <button type="button" data-viewer-original>100%</button>
            <button type="button" data-viewer-close aria-label="关闭图片查看器">关闭</button>
          </div>
        </header>
        <div class="max-image-viewer-stage"><img alt="" /></div>`;
      document.body.append(dialog);
      const img = dialog.querySelector('img');
      const stage = dialog.querySelector('.max-image-viewer-stage');
      let scale = 1;
      const zoom = (value) => {
        if (!img.naturalWidth) return;
        scale = Math.max(0.1, Math.min(4, value));
        img.style.width = `${Math.round(img.naturalWidth * scale)}px`;
        dialog.querySelector('[data-viewer-scale]').textContent = `${Math.round(scale * 100)}%`;
      };
      const fit = () => {
        zoom(
          Math.min(
            1,
            (stage.clientWidth - 32) / img.naturalWidth,
            (stage.clientHeight - 32) / img.naturalHeight,
          ),
        );
        stage.scrollTo(0, 0);
      };
      img.addEventListener('load', fit);
      dialog.querySelector('[data-viewer-in]').addEventListener('click', () => zoom(scale * 1.25));
      dialog.querySelector('[data-viewer-out]').addEventListener('click', () => zoom(scale / 1.25));
      dialog.querySelector('[data-viewer-fit]').addEventListener('click', fit);
      dialog.querySelector('[data-viewer-original]').addEventListener('click', () => zoom(1));
      dialog.querySelector('[data-viewer-close]').addEventListener('click', () => dialog.close());
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog || event.target === stage) dialog.close();
      });
      dialog.addEventListener('close', () => {
        img.removeAttribute('src');
        img.style.width = '';
      });
      viewer = dialog;
    }
    viewer.querySelector('[data-viewer-title]').textContent = item.label || '消息图片';
    viewer.querySelector('[data-viewer-scale]').textContent = '';
    const img = viewer.querySelector('img');
    img.alt = item.label || '消息图片';
    img.src = item.dataUrl;
    viewer.showModal();
  }
  function show(host, images) {
    if (!host || !images.length) return;
    const gallery = document.createElement('div');
    gallery.className = 'max-image-previews';
    for (const item of images) {
      const img = document.createElement('img');
      img.src = item.dataUrl;
      img.alt = item.label;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'max-image-open';
      button.setAttribute('aria-label', `放大查看 ${item.label || '消息图片'}`);
      button.title = '点击放大查看';
      button.append(img);
      button.addEventListener('click', openImage.bind(null, item));
      gallery.append(button);
    }
    host.append(gallery);
  }
  if (typeof module !== 'undefined' && module.exports)
    module.exports = { validateFile, createController, bindImageInput };
  if (typeof document === 'undefined') return;
  const root = document.getElementById('aichat-images');
  if (!root) return;
  const controller = createController({ root });
  window.FreeBbsMaxImages = { ...controller, show };
  bindImageInput({
    area: root.closest('.aichat-main'),
    input: document.getElementById('aichat-input'),
    controller,
  });
  window.addEventListener('freebbs:max-model-change', (event) =>
    controller.setVision(event.detail.vision),
  );
  window.addEventListener('freebbs:session-change', () => {
    viewer?.close();
    controller.clear();
    controller.setVision(false);
  });
})();
