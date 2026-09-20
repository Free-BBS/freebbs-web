(() => {
  function split(content) {
    const files = [];
    const text = String(content || '')
      .replace(/\n*--- 附件：([^\n]+?) ---\n([\s\S]*?)\n--- 附件结束 ---/g, (_, name, body) => {
        files.push({ name, text: body });
        return '';
      })
      .trim();
    return { text, files };
  }
  function open(file, pages = [], documentRef = file.document) {
    const dialog = document.createElement('dialog');
    dialog.className = 'max-file-preview-dialog';
    const heading = document.createElement('h2');
    heading.textContent = file.name;
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '关闭';
    close.addEventListener('click', () => dialog.close());
    const header = document.createElement('header');
    header.append(heading, close);
    const body = document.createElement('div');
    body.className = 'max-file-preview-body';
    let controller;
    if (documentRef) {
      const toolbar = document.createElement('div');
      toolbar.className = 'max-file-page-controls';
      const previous = document.createElement('button');
      const next = document.createElement('button');
      const position = document.createElement('input');
      const status = document.createElement('span');
      previous.textContent = '上一页';
      next.textContent = '下一页';
      previous.type = next.type = 'button';
      position.type = 'number';
      position.min = '1';
      position.max = String(documentRef.pageCount);
      position.setAttribute('aria-label', '跳转页码');
      const preview = document.createElement('div');
      let current = 1;
      const load = async (page) => {
        if (!Number.isInteger(page) || page < 1 || page > documentRef.pageCount) {
          position.value = String(current);
          return;
        }
        controller?.abort();
        controller = new AbortController();
        const active = controller;
        current = page;
        position.value = String(page);
        previous.disabled = page === 1;
        next.disabled = page === documentRef.pageCount;
        status.textContent = `/ ${documentRef.pageCount} 页 · 加载中…`;
        preview.replaceChildren();
        try {
          const response = await fetch(
            `${API_BASE_URL}/ai/files/${encodeURIComponent(documentRef.id)}/pages?start=${page}&count=1`,
            {
              headers: { Authorization: `Bearer ${window.freeBbsApp?.userState?.token || ''}` },
              signal: AbortSignal.any([active.signal, AbortSignal.timeout(80000)]),
            },
          );
          const data = await response.json();
          if (!response.ok) throw new Error(data.message || '页面读取失败');
          if (active.signal.aborted) return;
          const image = document.createElement('img');
          image.src = data.pages[0].dataUrl;
          image.alt = data.pages[0].label;
          preview.replaceChildren(image);
          status.textContent = `/ ${documentRef.pageCount} 页`;
        } catch (error) {
          if (!active.signal.aborted) status.textContent = error.message;
        }
      };
      previous.addEventListener('click', () => load(current - 1));
      next.addEventListener('click', () => load(current + 1));
      position.addEventListener('change', () => load(Number(position.value)));
      toolbar.append(previous, position, status, next);
      body.append(toolbar, preview);
      load(1);
    } else if (pages.length) {
      pages.forEach((page) => {
        const figure = document.createElement('figure');
        const image = document.createElement('img');
        image.src = page.dataUrl;
        image.alt = page.label;
        image.loading = 'lazy';
        const caption = document.createElement('figcaption');
        caption.textContent = page.label;
        figure.append(image, caption);
        body.append(figure);
      });
    } else {
      const pre = document.createElement('pre');
      pre.textContent = file.text;
      body.append(pre);
    }
    dialog.append(header, body);
    dialog.addEventListener(
      'close',
      () => {
        controller?.abort();
        dialog.remove();
      },
      { once: true },
    );
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
    document.body.append(dialog);
    dialog.showModal();
  }
  function mount(root, files, pages = [], documents = []) {
    if (!root) return;
    root.querySelector('.max-file-preview-list')?.remove();
    if (!files.length) return;
    const list = document.createElement('div');
    list.className = 'max-file-preview-list';
    const remainingDocuments = [...documents];
    files.forEach((file) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'max-file-preview-card';
      const title = document.createElement('strong');
      title.textContent = '预览文件';
      const name = document.createElement('span');
      name.textContent = file.name;
      button.append(title, name);
      const filePages = pages.filter((page) =>
        page.label?.startsWith(`${file.name.slice(0, 90)} · 第 `),
      );
      const documentIndex = remainingDocuments.findIndex((item) => item.name === file.name);
      const documentRef =
        documentIndex < 0 ? undefined : remainingDocuments.splice(documentIndex, 1)[0];
      button.addEventListener('click', () => open(file, filePages, documentRef));
      list.append(button);
    });
    root.append(list);
  }
  const api = { split, mount, open };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    window.FreeBbsFilePreview = api;
    window.addEventListener('freebbs:session-change', () =>
      document.querySelectorAll('.max-file-preview-dialog').forEach((dialog) => dialog.close()),
    );
  }
})();
