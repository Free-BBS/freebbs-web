/* global API_BASE_URL */
(() => {
  const root = document.getElementById('aichat-attachments');
  if (!root) return;
  const area = document.createElement('div');
  area.className = 'max-file-tools';
  area.innerHTML =
    '<button type="button" data-file-add title="Word / Excel / PPT / PDF / Markdown；最多 4 个，每个 10 MB">上传文件</button><input data-file-input type="file" hidden multiple accept=".doc,.docx,.xls,.xlsx,.ppt,.pptx,.pdf,.md,.txt"><small data-file-status role="status"></small><ul aria-label="已选文件"></ul>';
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
          ? `${file.text.length} 字 · 已就绪`
          : file.state === 'error'
            ? file.error
            : '正在解析…';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '移除';
      remove.setAttribute('aria-label', `移除 ${file.name}`);
      remove.disabled = busy;
      remove.addEventListener('click', () => {
        files = files.filter((item) => item !== file);
        status.textContent = '';
        render();
      });
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
    status.textContent = '正在解析附件，完成后可发送。';
    render();
    for (const [index, file] of chosen.entries()) {
      const item = pending[index];
      if (version !== generation) break;
      if (!files.includes(item)) continue;
      try {
        if (!file.size || file.size > 10 * 1024 * 1024)
          throw new Error('单文件必须大于 0 且不超过 10 MB。');
        const data = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(',')[1]);
          reader.onerror = () => reject(new Error('文件读取失败。'));
          reader.readAsDataURL(file);
        });
        if (version !== generation) break;
        if (!files.includes(item)) continue;
        const response = await fetch(`${API_BASE_URL}/ai/files/parse`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ name: file.name, data }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25000)]),
        });
        const result = await response.json();
        if (version !== generation) break;
        if (!files.includes(item)) continue;
        if (!response.ok) throw new Error(result.message || '解析失败');
        if (files.reduce((sum, entry) => sum + entry.text.length, 0) + result.text.length > 60000)
          throw new Error('附件合计超过 6 万字，请分次发送。');
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
        : files.length
          ? '附件将随消息发送；仅包含文字及表格值。'
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
    clear,
    setBusy(value) {
      busy = value;
      render();
    },
  };
  window.addEventListener('freebbs:session-change', clear);
  render();
})();
