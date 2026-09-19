/* global API_BASE_URL */
(() => {
  const root = document.getElementById('aichat-images');
  if (!root) return;
  const area = document.createElement('div');
  area.className = 'max-file-tools';
  area.innerHTML =
    '<button type="button">添加文件</button><input type="file" hidden multiple accept=".doc,.docx,.xls,.xlsx,.ppt,.pptx,.pdf,.md,.txt"><small role="status">Word / Excel / PPT / PDF / Markdown · 最多 4 个，每个 10 MB</small><ul></ul>';
  root.after(area);
  const button = area.querySelector('button');
  const input = area.querySelector('input');
  const status = area.querySelector('small');
  const list = area.querySelector('ul');
  let files = [];
  let processing = false;
  let busy = false;
  let generation = 0;
  function render() {
    button.disabled = processing || busy;
    list.replaceChildren();
    files.forEach((file, index) => {
      const li = document.createElement('li');
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '移除';
      remove.disabled = busy || processing;
      remove.addEventListener('click', () => {
        files.splice(index, 1);
        render();
      });
      li.append(document.createTextNode(`${file.name} · ${file.text.length} 字 `), remove);
      list.append(li);
    });
  }
  button.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    if (busy || processing) return;
    const chosen = [...input.files];
    const token = window.freeBbsApp?.userState?.token;
    if (!token) {
      status.textContent = '请登录后添加文件。';
      return;
    }
    const version = generation;
    processing = true;
    render();
    try {
      if (files.length + chosen.length > 4) throw new Error('最多附加 4 个文件。');
      const prepared = [];
      for (const file of chosen) {
        if (!file.size || file.size > 10 * 1024 * 1024)
          throw new Error('单文件必须大于 0 且不超过 10 MB。');
        status.textContent = `正在解析 ${file.name}…`;
        const data = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const response = await fetch(`${API_BASE_URL}/ai/files/parse`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ name: file.name, data }),
          signal: AbortSignal.timeout(25000),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || '解析失败');
        prepared.push(result);
      }
      if (version !== generation) return;
      if ([...files, ...prepared].reduce((sum, file) => sum + file.text.length, 0) > 60000)
        throw new Error('附件合计超过 6 万字，请分次发送。');
      files.push(...prepared);
      status.textContent = '已提取文字，将随下一条消息发送；图片、图表和原始排版不包含在内。';
    } catch (error) {
      if (version === generation) status.textContent = error.message || '文件读取失败。';
    } finally {
      processing = false;
      input.value = '';
      render();
    }
  });
  const clear = () => {
    generation += 1;
    files = [];
    render();
  };
  window.FreeBbsMaxFiles = {
    snapshot() {
      if (processing) throw new Error('文件正在解析，请稍候发送。');
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
})();
