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
  function open(file, pages = []) {
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
    if (pages.length) {
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
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
    document.body.append(dialog);
    dialog.showModal();
  }
  function mount(root, files, pages = []) {
    if (!root) return;
    root.querySelector('.max-file-preview-list')?.remove();
    if (!files.length) return;
    const list = document.createElement('div');
    list.className = 'max-file-preview-list';
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
      button.addEventListener('click', () => open(file, filePages));
      list.append(button);
    });
    root.append(list);
  }
  const api = { split, mount, open };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else window.FreeBbsFilePreview = api;
})();
