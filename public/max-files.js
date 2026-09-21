/* global API_BASE_URL */
(() => {
  const root = document.getElementById('aichat-attachments');
  if (!root) return;
  const area = document.createElement('div');
  area.className = 'max-file-tools';
  area.innerHTML =
    '<button type="button" data-file-add title="Word / Excel / PPT / PDF / Markdown；最多 4 个，每个 100 MB"><svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="m7 11 5-5a2 2 0 0 1 3 3l-6 6a3.5 3.5 0 0 1-5-5l6-6"/></svg>上传文件</button><input data-file-input type="file" hidden multiple accept=".doc,.docx,.xls,.xlsx,.ppt,.pptx,.pdf,.md,.txt"><small data-file-status role="status"></small><ul aria-label="已选文件"></ul>';
  root.prepend(area);
  const button = area.querySelector('[data-file-add]');
  const input = area.querySelector('[data-file-input]');
  const status = area.querySelector('[data-file-status]');
  const list = area.querySelector('ul');
  let files = [];
  let processing = false;
  let busy = false;
  let generation = 0;
  let upload;
  function render() {
    button.disabled = busy || processing || files.length >= 4;
    input.disabled = button.disabled;
    list.replaceChildren();
    list.hidden = !files.length;
    files.forEach((file) => {
      const li = document.createElement('li');
      li.className = 'max-file-chip';
      li.dataset.state = file.state;
      const label = document.createElement('span');
      label.className = 'max-file-name';
      label.textContent = file.name;
      label.title = file.name;
      const info = document.createElement('small');
      info.textContent =
        file.state === 'ready'
          ? file.document
            ? `${file.document.pageCount} 页 · 分批视觉读取`
            : `${file.text.length} 字 · 已就绪`
          : file.state === 'error'
            ? file.error
            : file.progress === 100
              ? '正在逐页解析…'
              : file.progress
                ? `上传中 ${file.progress}%`
                : '正在上传…';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.title = `移除 ${file.name}`;
      remove.setAttribute('aria-label', `移除 ${file.name}`);
      remove.disabled = busy;
      remove.addEventListener('click', () => {
        files = files.filter((item) => item !== file);
        status.textContent = '';
        render();
      });
      if (file.state === 'ready') {
        label.textContent = `预览文件 · ${file.name}`;
        label.tabIndex = 0;
        label.setAttribute('role', 'button');
        const preview = () => window.FreeBbsFilePreview?.open(file, file.pages || []);
        label.addEventListener('click', preview);
        label.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            preview();
          }
        });
      }
      li.append(label, info, remove);
      list.append(li);
    });
  }
  button.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    if (busy || processing) return;
    const chosen = [...input.files];
    input.value = '';
    if (!chosen.length) return;
    const token = window.freeBbsApp?.userState?.token;
    if (!token) {
      status.textContent = '请登录后添加文件。';
      return;
    }
    if (files.length + chosen.length > 4) {
      status.textContent = '最多附加 4 个文件。';
      return;
    }
    const version = generation;
    const controller = new AbortController();
    upload = controller;
    const pending = chosen.map((file) => ({ name: file.name, state: 'processing', text: '' }));
    files.push(...pending);
    processing = true;
    status.textContent = '';
    render();
    for (const [index, file] of chosen.entries()) {
      const item = pending[index];
      if (version !== generation) break;
      if (!files.includes(item)) continue;
      try {
        if (!file.size || file.size > 100 * 1024 * 1024)
          throw new Error('单文件必须大于 0 且不超过 100 MB。');
        const uploadId = crypto.randomUUID();
        let result;
        let response;
        for (let offset = 0; offset < file.size; offset += 8 * 1024 * 1024) {
          if (version !== generation || !files.includes(item)) break;
          response = await fetch(
            `${API_BASE_URL}/ai/files/parse?${new URLSearchParams({ name: file.name })}`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/octet-stream',
                Authorization: `Bearer ${token}`,
                'X-Upload-Id': uploadId,
                'X-Upload-Offset': String(offset),
                'X-Upload-Size': String(file.size),
              },
              body: file.slice(offset, offset + 8 * 1024 * 1024),
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(80000)]),
            },
          );
          result = await response.json();
          if (!response.ok) throw new Error(result.message || '上传失败');
          item.progress = Math.min(100, Math.round(((offset + 8 * 1024 * 1024) / file.size) * 100));
          render();
        }
        if (version !== generation) break;
        if (!files.includes(item)) continue;
        if (!response.ok) throw new Error(result.message || '解析失败');
        if (files.reduce((sum, entry) => sum + entry.text.length, 0) + result.text.length > 60000)
          throw new Error('附件合计超过 6 万字，请分次发送。');
        const pages = Array.isArray(result.pages) ? result.pages : [];
        if (result.document || pages.length) await window.FreeBbsMaxModels?.requireVision();
        item.document = result.document;
        item.pages = pages;
        item.text = result.text;
        item.state = 'ready';
      } catch (error) {
        if (version !== generation) break;
        item.state = 'error';
        item.error = error.message || '文件解析失败。';
      }
      render();
    }
    if (version === generation) {
      processing = false;
      upload = null;
      status.textContent = files.some((file) => file.state === 'error')
        ? '部分附件解析失败，请移除后重试。'
        : '';
      render();
    }
  });
  const clear = () => {
    generation += 1;
    upload?.abort();
    upload = null;
    processing = false;
    files = [];
    input.value = '';
    status.textContent = '';
    render();
  };
  window.FreeBbsMaxFiles = {
    snapshot() {
      if (files.some((file) => file.state === 'processing'))
        throw new Error('文件正在解析，请稍候发送。');
      if (files.some((file) => file.state === 'error')) throw new Error('请先移除解析失败的文件。');
      return files
        .map((file) => `\n\n--- 附件：${file.name} ---\n${file.text}\n--- 附件结束 ---`)
        .join('');
    },
    documents() {
      return files.flatMap((file) => (file.document ? [file.document] : []));
    },
    pages() {
      return files.flatMap((file) => file.pages || []);
    },
    clear,
    setBusy(value) {
      busy = value;
      render();
    },
  };
  window.addEventListener('freebbs:session-change', clear);
  render();
})();
