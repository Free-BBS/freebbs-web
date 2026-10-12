(function () {
  let active = false;
  async function confirm({ callApi, isCurrent }) {
    if (active) throw new Error('请先处理已打开的审核说明。');
    active = true;
    let dialog;
    let timer;
    try {
      const notice = await callApi('/moderation/notice');
      if (!isCurrent()) throw new Error('登录状态或当前内容已变化，请重新提交。');
      if (notice?.required === false) return undefined;
      if (
        !notice?.required ||
        typeof notice.version !== 'string' ||
        !Array.isArray(notice.paragraphs)
      )
        throw new Error('暂时无法读取审核说明，请稍后重试。');
      dialog = document.createElement('dialog');
      dialog.className = 'moderation-data-notice';
      dialog.setAttribute('aria-labelledby', 'moderation-data-notice-title');
      const title = document.createElement('h2');
      title.id = 'moderation-data-notice-title';
      title.tabIndex = -1;
      title.textContent = notice.title;
      dialog.append(title);
      for (const text of notice.paragraphs) {
        const p = document.createElement('p');
        p.textContent = text;
        dialog.append(p);
      }
      const link = document.createElement('a');
      link.href = 'https://docs.infini-ai.com/legal/privacy.html';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = '查看无问芯穹隐私政策';
      dialog.append(link);
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = false;
      label.append(
        checkbox,
        document.createTextNode('我已阅读，并同意按上述说明处理本次提交的文字与图片。'),
      );
      dialog.append(label);
      const actions = document.createElement('div');
      actions.className = 'moderation-data-notice-actions';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = '返回修改';
      const accept = document.createElement('button');
      accept.type = 'button';
      accept.textContent = '确认并提交';
      accept.disabled = true;
      actions.append(cancel, accept);
      dialog.append(actions);
      document.body.append(dialog);
      const accepted = new Promise((resolve) => {
        checkbox.addEventListener('change', () => {
          accept.disabled = !checkbox.checked;
        });
        cancel.addEventListener('click', () => resolve(false));
        dialog.addEventListener('cancel', (event) => {
          event.preventDefault();
          resolve(false);
        });
        accept.addEventListener('click', () => {
          if (checkbox.checked) resolve(true);
        });
        timer = window.setInterval(() => {
          if (!isCurrent()) resolve(false);
        }, 250);
      });
      dialog.showModal();
      title.focus();
      dialog.scrollTop = 0;
      if (!(await accepted) || !isCurrent())
        throw new Error('尚未提交，内容已保留，可修改后再次提交。');
      return notice.version;
    } finally {
      if (timer) window.clearInterval(timer);
      if (dialog) dialog.remove();
      active = false;
    }
  }
  window.FreeBbsModerationNotice = { confirm };
})();
