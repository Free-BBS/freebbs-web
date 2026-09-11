/* global callApi, API_BASE_URL, API_ROOT */
(() => {
  const controls = document.querySelector('.course-map-reader-controls');
  if (controls) {
    const slug = new URLSearchParams(window.location.search).get('course') || 'signals';
    const opener = document.createElement('button');
    opener.type = 'button';
    opener.className = 'course-map-reader-control course-files-open';
    opener.textContent = '课程资料';
    controls.append(opener);
    const dialog = document.createElement('dialog');
    dialog.className = 'course-files-dialog';
    dialog.setAttribute('aria-labelledby', 'course-files-title');
    dialog.innerHTML =
      '<div class="course-files-heading"><h2 id="course-files-title">课程资料</h2><button type="button" aria-label="关闭课程资料">关闭</button></div><p class="course-files-status" role="status"></p><ul class="course-files-list"></ul>';
    document.body.append(dialog);
    const status = dialog.querySelector('.course-files-status');
    const files = dialog.querySelector('.course-files-list');
    dialog.querySelector('button').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
    opener.addEventListener('click', async () => {
      dialog.showModal();
      status.textContent = '正在载入课程资料…';
      files.replaceChildren();
      try {
        const data = await callApi(
          `/course-upload/public/courses/${encodeURIComponent(slug)}/files`,
        );
        status.textContent = data.files.length
          ? `共 ${data.files.length} 份资料，可直接下载。`
          : '课程组暂未上传资料。';
        data.files.forEach((file) => {
          const item = document.createElement('li');
          const link = document.createElement('a');
          link.href = `${API_ROOT}${file.url}`;
          link.textContent = file.fileName;
          link.setAttribute('download', file.fileName);
          const info = document.createElement('small');
          info.textContent =
            file.size >= 1024 * 1024
              ? `${(file.size / (1024 * 1024)).toFixed(1)} MB`
              : `${Math.max(1, Math.ceil(file.size / 1024))} KB`;
          item.append(link, info);
          if (file.nodeId) {
            const node = document.createElement('a');
            node.className = 'course-file-node';
            node.href = `/knowledge?course=${encodeURIComponent(slug)}&point=${encodeURIComponent(file.nodeId)}`;
            node.textContent = `知识点 ${file.nodeId}`;
            item.append(node);
          }
          files.append(item);
        });
      } catch (error) {
        status.textContent = error.message;
      }
    });
  }
  const host = document.querySelector('.settings-profile');
  if (!host) return;
  const section = document.createElement('section');
  section.className = 'settings-form course-token-settings';
  section.setAttribute('aria-labelledby', 'course-token-title');
  section.innerHTML = `
    <div class="settings-section-heading"><h2 id="course-token-title">课程组 Agent 接入</h2></div>
    <p>生成个人 Token，让 Agent 将 Markdown 上传为课程地图中的知识点，更新正文、位置和连接，也可上传课程资料与图片。权限随课程负责人分配实时生效。</p>
    <p class="course-token-links"><a id="course-skill-download" download>下载 Agent Skill</a><a id="course-api-docs" target="_blank" rel="noreferrer">API 使用说明</a></p>
    <form id="course-token-form">
      <div class="settings-grid">
        <label class="auth-field"><span>Token 名称</span><input name="name" maxlength="80" required placeholder="例如：课程备课 Agent" autocomplete="off" /></label>
        <label class="auth-field"><span>有效期</span><select name="expiresInDays"><option value="30">30 天</option><option value="90" selected>90 天</option><option value="365">365 天</option></select></label>
      </div>
      <button class="auth-submit" type="submit">生成 Token</button>
    </form>
    <div id="course-token-secret" class="course-token-secret" hidden>
      <label class="auth-field"><span>此 Token 仅展示一次，请立即保存</span><input id="course-token-value" readonly autocomplete="off" spellcheck="false" /></label>
      <div class="course-token-links"><button type="button" id="course-token-copy">复制 Token</button><button type="button" id="course-token-dismiss">我已保存，隐藏</button></div>
    </div>
    <p id="course-token-message" class="auth-message" role="status" aria-live="polite"></p>
    <ul id="course-token-list" class="course-token-list" aria-label="我的课程 Token"></ul>`;
  host.append(section);
  const endpoint = '/course-upload';
  section.querySelector('#course-skill-download').href = `${API_BASE_URL}${endpoint}/skill.zip`;
  section.querySelector('#course-api-docs').href = `${API_BASE_URL}${endpoint}/docs`;
  const message = section.querySelector('#course-token-message');
  const secret = section.querySelector('#course-token-secret');
  const value = section.querySelector('#course-token-value');
  const list = section.querySelector('#course-token-list');
  function clearSecret() {
    value.value = '';
    secret.hidden = true;
  }
  async function refresh() {
    const data = await callApi(`${endpoint}/tokens`);
    list.replaceChildren();
    if (!data.tokens.length) {
      const empty = document.createElement('li');
      empty.textContent = '尚未生成 Token。任何用户都可以生成，仅课程资料负责人及管理员可以上传。';
      list.append(empty);
    }
    data.tokens.forEach((token) => {
      const item = document.createElement('li');
      const copy = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = token.name;
      const info = document.createElement('small');
      const expired = new Date(token.expiresAt).getTime() <= Date.now();
      let status = expired ? '已过期' : '有效';
      if (token.revokedAt) status = '已撤销';
      info.textContent = `${token.prefix}… · ${status} · 到期 ${new Date(token.expiresAt).toLocaleDateString('zh-CN')}${token.lastUsedAt ? ` · 最近使用 ${new Date(token.lastUsedAt).toLocaleDateString('zh-CN')}` : ''}`;
      copy.append(name, info);
      item.append(copy);
      if (!token.revokedAt && !expired) {
        const revoke = document.createElement('button');
        revoke.type = 'button';
        revoke.textContent = '撤销';
        revoke.setAttribute('aria-label', `撤销 ${token.name}`);
        revoke.addEventListener('click', async () => {
          revoke.disabled = true;
          try {
            await callApi(`${endpoint}/tokens/${token.id}`, { method: 'DELETE' });
            clearSecret();
            message.textContent = 'Token 已撤销。';
            await refresh();
          } catch (error) {
            message.textContent = error.message;
            revoke.disabled = false;
          }
        });
        item.append(revoke);
      }
      list.append(item);
    });
  }
  section.querySelector('#course-token-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    message.textContent = '';
    clearSecret();
    try {
      const data = await callApi(`${endpoint}/tokens`, {
        method: 'POST',
        body: JSON.stringify({
          name: form.elements.name.value.trim(),
          expiresInDays: Number(form.elements.expiresInDays.value),
        }),
      });
      value.value = data.token;
      secret.hidden = false;
      message.textContent = 'Token 已生成。将其保存到 Agent 的 FREEBBS_UPLOAD_TOKEN 环境变量中。';
      form.reset();
      await refresh();
    } catch (error) {
      message.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  section.querySelector('#course-token-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(value.value);
      message.textContent = '已复制 Token。';
    } catch {
      value.focus();
      value.select();
      message.textContent = '请手动复制已选中的 Token。';
    }
  });
  section.querySelector('#course-token-dismiss').addEventListener('click', clearSecret);
  window.addEventListener('pagehide', clearSecret);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearSecret();
  });
  refresh().catch((error) => {
    message.textContent = error.message;
  });
})();
