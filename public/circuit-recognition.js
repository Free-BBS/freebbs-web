(function circuitRecognition(root) {
  const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
  const REQUEST_TIMEOUT_MS = 210000;
  const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

  function validateImageFile(file) {
    if (!file || !IMAGE_TYPES.has(file.type)) throw new Error('请选择 PNG、JPEG 或 WebP 图片。');
    if (!file.size) throw new Error('图片为空，请重新选择。');
    if (file.size > MAX_IMAGE_BYTES) throw new Error('图片超过 8 MiB，请压缩或裁剪后重试。');
  }

  function sameContext(left, right) {
    return Boolean(
      left &&
      right &&
      left.uid === right.uid &&
      left.generation === right.generation &&
      left.editVersion === right.editVersion,
    );
  }

  function previewBounds(document) {
    const points = [...document.components, ...document.wires.flatMap((wire) => wire.points || [])];
    const left = Math.min(...points.map((point) => point.x)) - 110;
    const top = Math.min(...points.map((point) => point.y)) - 100;
    const width = Math.max(320, Math.max(...points.map((point) => point.x)) + 110 - left);
    const height = Math.max(260, Math.max(...points.map((point) => point.y)) + 100 - top);
    return [left, top, width, height];
  }

  function create({
    app,
    editor,
    engine,
    renderer,
    document: dom = root.document,
    window: browser = root,
    readImage,
  } = {}) {
    const get = (name) => dom.getElementById(`circuit-recognition-${name}`);
    const dialog = get('dialog');
    const trigger = dom.getElementById('circuit-recognize');
    if (!dialog || !trigger || !app || !editor || !engine || !renderer) return null;
    const state = {
      imageDataUrl: '',
      reading: false,
      fileVersion: 0,
      requestVersion: 0,
      controller: null,
      timeout: null,
      result: null,
      schematic: null,
      attempted: false,
      context: null,
      cameraContext: null,
      uid: app.userState.isLoggedIn ? app.userState.uid : '',
    };
    const readFile =
      readImage ||
      ((file) =>
        new Promise((resolve, reject) => {
          const reader = new browser.FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('无法读取图片，请重新选择。'));
          reader.onabort = () => reject(new Error('图片读取已取消。'));
          reader.readAsDataURL(file);
        }));

    function status(message, error = false) {
      get('status').textContent = message;
      get('status').className = `circuit-status${error ? ' is-error' : ''}`;
    }

    function render() {
      const busy = Boolean(state.controller);
      const loggedIn = Boolean(app.userState.isLoggedIn);
      const context = editor.getRecognitionContext();
      trigger.disabled = context.busy;
      get('auth').hidden = loggedIn;
      get('pick').disabled = busy || state.reading;
      get('camera').disabled = busy || state.reading || context.busy;
      get('pick').textContent = state.imageDataUrl ? '更换图片' : '选择电路图片';
      get('instructions').disabled = busy;
      get('start').disabled =
        busy || state.reading || !state.imageDataUrl || !loggedIn || context.busy;
      get('start').textContent = state.attempted ? '重新识别' : '开始识别';
      if (busy) get('start').textContent = '正在识别…';
      get('start').classList.toggle('is-primary', !state.result);
      get('cancel').hidden = !busy;
      get('apply').hidden = !state.result;
      get('apply').disabled = busy || context.busy || !loggedIn;
      get('result').hidden = !state.result;
      dialog.setAttribute('aria-busy', String(busy || state.reading));
    }

    function clearResult() {
      state.result = null;
      state.schematic?.destroy?.();
      state.schematic = null;
      get('preview').replaceChildren();
      get('warnings').replaceChildren();
    }

    function cancel(message = '已取消识别，可以调整图片后重试。') {
      state.requestVersion += 1;
      state.controller?.abort();
      state.controller = null;
      browser.clearTimeout(state.timeout);
      state.timeout = null;
      if (message) status(message);
      render();
    }

    function resetCamera() {
      state.cameraContext = null;
      get('camera-file').value = '';
    }

    function resetImage() {
      resetCamera();
      state.fileVersion += 1;
      state.reading = false;
      state.imageDataUrl = '';
      state.attempted = false;
      get('file').value = '';
      get('image').hidden = true;
      get('image').removeAttribute('src');
      get('filename').textContent = '';
      clearResult();
    }

    async function selectFile(file) {
      cancel('');
      resetImage();
      const version = state.fileVersion;
      const context = editor.getRecognitionContext();
      try {
        validateImageFile(file);
        state.reading = true;
        status('正在读取图片…');
        render();
        const imageDataUrl = await readFile(file);
        if (version !== state.fileVersion || !dialog.open) return;
        if (!sameContext(context, editor.getRecognitionContext()))
          throw new Error('读取图片期间电路已变化，请重新选择图片。');
        if (
          typeof imageDataUrl !== 'string' ||
          !/^data:image\/(?:png|jpeg|webp);base64,/.test(imageDataUrl)
        )
          throw new Error('图片格式无法读取，请重新选择。');
        state.imageDataUrl = imageDataUrl;
        get('image').src = imageDataUrl;
        get('image').hidden = false;
        get('filename').textContent =
          `${file.name || '粘贴的截图'} · ${(file.size / 1024 / 1024).toFixed(2)} MiB`;
        status('图片已就绪，点击“开始识别”。');
      } catch (error) {
        if (version === state.fileVersion) status(error.message || '无法读取图片。', true);
      } finally {
        if (version === state.fileVersion) {
          state.reading = false;
          render();
        }
      }
    }

    async function start() {
      if (state.controller || state.reading || !state.imageDataUrl) return;
      if (!app.userState.isLoggedIn) {
        status('请先登录，再使用图像识别。', true);
        render();
        return;
      }
      const context = editor.getRecognitionContext();
      if (context.busy) {
        status('请等待当前电路操作完成后再识别。', true);
        return;
      }
      clearResult();
      state.context = context;
      state.attempted = true;
      state.controller = new browser.AbortController();
      state.requestVersion += 1;
      const version = state.requestVersion;
      const { signal } = state.controller;
      const instructions = get('instructions').value.trim().slice(0, 2000);
      state.timeout = browser.setTimeout(() => {
        if (version === state.requestVersion)
          cancel('识别超时，请重试，或裁剪为更清晰、简单的电路图。');
      }, REQUEST_TIMEOUT_MS);
      status('正在识别元件与连线，通常需要几十秒，复杂图片最多约 3 分钟。');
      render();
      try {
        const payload = await app.callApi('/ai/circuit/recognize', {
          method: 'POST',
          signal,
          body: JSON.stringify({
            imageDataUrl: state.imageDataUrl,
            ...(instructions ? { instructions } : {}),
          }),
        });
        if (version !== state.requestVersion || !dialog.open) return;
        if (
          !sameContext(context, editor.getRecognitionContext()) ||
          context.uid !== app.userState.uid
        )
          throw new Error('当前账号或电路已变化，请重新识别。');
        if (payload?.ok === false) throw new Error(payload.message || '识别失败，请重试。');
        if (!payload?.circuit?.document) throw new Error('识别服务未返回有效电路，请重试。');
        const document = engine.validateDocument(payload.circuit.document);
        if (!document.components.length)
          throw new Error('图片中未识别到电路元件，请换一张清晰的原理图。');
        const circuit = {
          title: String(payload.circuit.title || '识别的电路').slice(0, 120),
          description: String(payload.circuit.description || '').slice(0, 2000),
          document,
        };
        state.result = { circuit, context };
        get('title').textContent = circuit.title;
        get('summary').textContent =
          `${document.components.length} 个元件 · ${document.wires.length} 条连线${circuit.description ? ` · ${circuit.description}` : ''}`;
        get('result').hidden = false;
        state.schematic = renderer.renderSchematic(get('preview'), document, {
          interactive: false,
          viewBox: previewBounds(document),
        });
        const warnings = Array.isArray(payload.warnings) ? payload.warnings : [];
        get('warnings').replaceChildren(
          ...warnings
            .filter((warning) => typeof warning === 'string')
            .slice(0, 128)
            .map((warning) => {
              const item = dom.createElement('li');
              item.textContent = warning;
              return item;
            }),
        );
        get('warnings').hidden = !get('warnings').childElementCount;
        get('draft-note').textContent = context.dirty
          ? '确认后会切换到新电路。当前未保存草稿会在本标签页备份，可点击“恢复上一份草稿”找回。新电路保存后才会获得 CID。'
          : '确认后生成新电路草稿，保存后获得新的 CID。可通过“恢复上一份草稿”返回当前电路。';
        status('识别完成，请核对预览和提示后生成电路。');
      } catch (error) {
        if (version !== state.requestVersion) return;
        clearResult();
        status(
          error.name === 'AbortError'
            ? '识别已取消，可以重试。'
            : error.message || '识别失败，请检查网络后重试。',
          true,
        );
      } finally {
        if (version === state.requestVersion) {
          browser.clearTimeout(state.timeout);
          state.timeout = null;
          state.controller = null;
          render();
        }
      }
    }

    function close() {
      resetCamera();
      cancel('');
      state.fileVersion += 1;
      state.reading = false;
      clearResult();
      if (dialog.open) dialog.close();
      render();
      trigger.focus();
    }

    function open() {
      if (dialog.open) return;
      state.context = editor.getRecognitionContext();
      status(
        state.imageDataUrl ? '图片已就绪，可以开始识别。' : '选择图片后开始识别，完成后可先预览。',
      );
      dialog.showModal();
      render();
      get('pick').focus();
    }

    function apply() {
      if (!state.result) return false;
      try {
        const { circuit, context } = state.result;
        editor.importRecognizedCircuit(circuit, context);
        close();
        return true;
      } catch (error) {
        status(error.message || '无法生成电路草稿。', true);
        return false;
      }
    }

    function onEditorChange() {
      const context = editor.getRecognitionContext();
      if (dialog.open && state.context && !sameContext(state.context, context)) {
        resetCamera();
        cancel('电路已变化，请重新识别后再生成草稿。');
        clearResult();
      }
      state.context = context;
      render();
    }

    function onSessionChange() {
      const uid = app.userState.isLoggedIn ? app.userState.uid : '';
      if (uid !== state.uid) {
        cancel('账号已变化，请重新选择图片并识别。');
        resetImage();
        get('instructions').value = '';
        state.uid = uid;
      }
      render();
    }

    trigger.addEventListener('click', open);
    get('close').addEventListener('click', close);
    get('camera').addEventListener('click', () => {
      const context = editor.getRecognitionContext();
      if (!dialog.open || state.controller || state.reading || context.busy) return;
      get('camera-file').value = '';
      state.cameraContext = context;
      get('camera-file').click();
    });
    get('camera-file').addEventListener('change', () => {
      const file = get('camera-file').files?.[0];
      const context = state.cameraContext;
      resetCamera();
      if (
        !file ||
        !dialog.open ||
        state.controller ||
        state.reading ||
        !sameContext(context, editor.getRecognitionContext()) ||
        context.uid !== (app.userState.isLoggedIn ? app.userState.uid : '')
      )
        return;
      selectFile(file);
    });
    get('camera-file').addEventListener('cancel', resetCamera);
    get('pick').addEventListener('click', () => get('file').click());
    get('file').addEventListener('change', () => {
      const file = get('file').files?.[0];
      if (file) selectFile(file);
    });
    get('image').addEventListener('error', () => {
      if (!state.imageDataUrl) return;
      cancel('');
      resetImage();
      status('图片无法显示，请选择有效的 PNG、JPEG 或 WebP 文件。', true);
      render();
    });
    get('instructions').addEventListener('input', () => {
      if (!state.result) return;
      clearResult();
      status('补充说明已修改，请重新识别。');
      render();
    });
    get('start').addEventListener('click', start);
    get('cancel').addEventListener('click', () => cancel());
    get('apply').addEventListener('click', apply);
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      close();
    });
    dialog.addEventListener('close', () => {
      resetCamera();
      if (state.controller) cancel('');
      state.fileVersion += 1;
      state.reading = false;
      clearResult();
    });
    dialog.addEventListener('paste', (event) => {
      const item = Array.from(event.clipboardData?.items || []).find(
        (entry) => entry.kind === 'file' && entry.type.startsWith('image/'),
      );
      if (!item || !dialog.open) return;
      event.preventDefault();
      const file = item.getAsFile();
      if (file) selectFile(file);
    });
    const drop = get('drop');
    dialog.addEventListener('dragover', (event) => {
      event.preventDefault();
      drop.classList.add('is-dragging');
    });
    dialog.addEventListener('dragleave', (event) => {
      if (!dialog.contains(event.relatedTarget)) drop.classList.remove('is-dragging');
    });
    dialog.addEventListener('drop', (event) => {
      event.preventDefault();
      drop.classList.remove('is-dragging');
      const files = Array.from(event.dataTransfer?.files || []);
      if (files.length !== 1) {
        status('请一次选择一张电路图片。', true);
        return;
      }
      selectFile(files[0]);
    });
    browser.addEventListener('freebbs:circuit-editor-change', onEditorChange);
    browser.addEventListener('freebbs:circuit-editor-ready', onEditorChange);
    browser.addEventListener('freebbs:session-change', onSessionChange);
    browser.addEventListener('pagehide', () => {
      resetCamera();
      cancel('');
    });
    render();
    return { open, close, selectFile, start, cancel, apply };
  }

  const api = { create, validateImageFile, MAX_IMAGE_BYTES, REQUEST_TIMEOUT_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    Object.assign(root, { FreeBbsCircuitRecognition: api });
    create({
      app: root.freeBbsApp,
      editor: root.FreeBbsCircuitEditor,
      engine: root.FreeBbsCircuitEngine,
      renderer: root.FreeBbsCircuitRenderer,
    });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
