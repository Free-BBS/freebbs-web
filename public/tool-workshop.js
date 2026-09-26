(() => {
  const app = window.freeBbsApp;
  if (!app) return;

  const studio = document.getElementById('tool-studio');
  const createToggle = document.getElementById('tool-create-toggle');
  const promptInput = document.getElementById('tool-prompt');
  const titleInput = document.getElementById('tool-title');
  const descriptionInput = document.getElementById('tool-description');
  const htmlInput = document.getElementById('tool-html');
  const previewFrame = document.getElementById('tool-preview-frame');
  const previewEmpty = document.getElementById('tool-preview-empty');
  const galleryView = document.getElementById('tool-gallery-view');
  const panelButtons = [...document.querySelectorAll('[data-tool-panel]')];
  const codeLive = document.getElementById('tool-code-live');
  const codeHighlight = document.getElementById('tool-code-highlight');
  const codeStatus = document.getElementById('tool-code-status');
  const editCodeButton = document.getElementById('tool-edit-code');
  let streamedHtml = '';
  let highlightTimer = null;
  let editingCode = false;
  const status = document.getElementById('tool-studio-status');
  const cancelButton = document.getElementById('tool-cancel');
  let generationController = null;
  let reasoningHost = document.getElementById('tool-reasoning');
  const gallery = document.getElementById('tool-gallery');
  const galleryStatus = document.getElementById('tool-gallery-status');
  const viewer = document.getElementById('tool-viewer');
  const viewerFrame = document.getElementById('tool-viewer-frame');
  const viewerTitle = document.getElementById('tool-viewer-title');
  const viewerMeta = document.getElementById('tool-viewer-meta');
  const shareButton = document.getElementById('tool-share-discussion');
  const scopeButtons = [...document.querySelectorAll('[data-tool-scope]')];
  const state = { scope: 'all', tools: [], active: null, busy: false };

  const { sandboxDocument } = window.FreeBbsToolEmbeds;

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function setBusy(busy, message = '') {
    state.busy = busy;
    studio?.querySelectorAll('button').forEach((button) => {
      button.disabled = button === cancelButton || button.dataset.toolPanel ? false : busy;
    });
    htmlInput.readOnly = busy;
    promptInput.readOnly = busy;
    editCodeButton.hidden = busy;
    if (status) status.textContent = message;
  }

  function renderCode(source = htmlInput.value) {
    const following = codeLive.scrollHeight - codeLive.scrollTop - codeLive.clientHeight < 48;
    if (window.hljs?.highlight) {
      codeHighlight.innerHTML = window.hljs.highlight(source, {
        language: 'xml',
        ignoreIllegals: true,
      }).value;
    } else codeHighlight.textContent = source;
    if (following) codeLive.scrollTop = codeLive.scrollHeight;
    codeStatus.textContent = `${generationController ? '正在接收' : 'HTML'} · ${source.length} 字符`;
  }

  function setCodeEditing(editing) {
    editingCode = editing;
    htmlInput.hidden = !editing;
    codeLive.hidden = editing;
    editCodeButton.textContent = editing ? '完成编辑' : '编辑源码';
    editCodeButton.setAttribute('aria-pressed', String(editing));
    if (editing) htmlInput.focus({ preventScroll: true });
    else renderCode();
  }

  function refreshPreview() {
    const hasHtml = Boolean(htmlInput.value.trim());
    previewFrame.srcdoc = sandboxDocument(htmlInput.value, true);
    previewFrame.hidden = !hasHtml;
    previewEmpty.hidden = hasHtml;
    if (status && !state.busy)
      status.textContent = htmlInput.value.trim() ? '预览已刷新' : '请先生成或输入 HTML';
  }

  function selectPanel(name) {
    panelButtons.forEach((button) => {
      const selected = button.dataset.toolPanel === name;
      button.setAttribute('aria-pressed', String(selected));
      document.getElementById(button.getAttribute('aria-controls')).hidden = !selected;
    });
    document.getElementById('tool-preview').hidden = name !== 'preview';
    if (name === 'preview' && htmlInput.value.trim()) refreshPreview();
    if (name === 'code' && !generationController && !editingCode) renderCode();
  }

  function openStudio() {
    if (!app.userState.isLoggedIn) {
      window.location.href = '/login?next=%2Ftool-workshop';
      return;
    }
    studio.hidden = false;
    galleryView.hidden = true;
    createToggle.textContent = '返回广场';
    createToggle.setAttribute('aria-expanded', 'true');
    promptInput.focus({ preventScroll: true });
  }

  function closeStudio() {
    studio.hidden = true;
    galleryView.hidden = false;
    createToggle.textContent = '制作小工具';
    createToggle.setAttribute('aria-expanded', 'false');
    createToggle.focus();
  }

  async function generate() {
    if (state.busy) return;
    const prompt = promptInput.value.trim();
    if (!prompt) {
      status.textContent = '先描述要制作或修改的小工具';
      promptInput.focus();
      return;
    }
    setBusy(true, htmlInput.value.trim() ? 'AI 正在修改小工具…' : 'AI 正在制作小工具…');
    generationController = new AbortController();
    streamedHtml = '';
    setCodeEditing(false);
    renderCode('');
    selectPanel('code');
    cancelButton.hidden = false;
    const freshHost = reasoningHost.cloneNode(false);
    reasoningHost.replaceWith(freshHost);
    reasoningHost = freshHost;
    const note = document.getElementById('tool-reasoning-note');
    note.hidden = false;
    note.textContent = '等待模型提供思考内容；未提供时仅显示生成进度。';
    let hasReasoning = false;
    let complete = false;
    try {
      const payload = await window.FreeBbsReasoning.request({
        url: `${app.apiBaseUrl}/tools/generate/html`,
        token: app.userState.token,
        payload: { prompt, currentHtml: htmlInput.value },
        signal: generationController.signal,
        timeoutMs: 315000,
        onHtml: (delta) => {
          streamedHtml += delta;
          if (streamedHtml.length > 184000) throw new Error('生成的 HTML 过长，请精简需求后重试。');
          if (highlightTimer === null) {
            highlightTimer = setTimeout(() => {
              highlightTimer = null;
              renderCode(streamedHtml);
            }, 100);
          }
        },
        onStatus: ({ message }) => {
          status.textContent = message;
        },
        onReasoning: (part) => {
          window.FreeBbsReasoning.update(reasoningHost, part);
          if (!hasReasoning) {
            hasReasoning = true;
            status.textContent = 'AI 正在思考…';
            reasoningHost.querySelector('details').open = true;
            note.textContent = '模型提供的思考内容，仅供查看，不作为 HTML 执行。';
          }
        },
      });
      htmlInput.value = payload.html;
      if (!titleInput.value.trim()) titleInput.value = prompt.replace(/\s+/g, ' ').slice(0, 28);
      refreshPreview();
      status.textContent = '已生成。可以继续描述修改，也可以直接编辑 HTML。';
      if (!hasReasoning) note.textContent = '本次模型未提供可展示的思考内容，HTML 已生成。';
      complete = true;
    } catch (error) {
      status.textContent = generationController.signal.aborted
        ? '已停止生成，原有代码和预览已保留。'
        : error.message;
      if (!hasReasoning) note.textContent = '本次未收到可展示的思考内容。';
    } finally {
      window.FreeBbsReasoning.finish(reasoningHost, { stopped: !complete });
      cancelButton.hidden = true;
      generationController = null;
      clearTimeout(highlightTimer);
      highlightTimer = null;
      renderCode();
      setBusy(false, status.textContent);
    }
  }

  async function publish() {
    if (state.busy) return;
    if (!titleInput.value.trim() || !htmlInput.value.trim()) {
      status.textContent = '发布前请填写标题并生成或输入完整 HTML';
      return;
    }
    setBusy(true, '正在发布到小工具广场…');
    try {
      const payload = await app.callApi('/tools', {
        method: 'POST',
        body: JSON.stringify({
          title: titleInput.value.trim(),
          description: descriptionInput.value.trim(),
          prompt: promptInput.value.trim(),
          html: htmlInput.value,
        }),
      });
      status.textContent = payload.message;
      state.scope = 'all';
      syncScopeButtons();
      await loadTools();
      openTool(payload.tool);
    } catch (error) {
      status.textContent = error.message;
    } finally {
      setBusy(false, status.textContent);
    }
  }

  function cardMarkup(tool) {
    const date = new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(
      new Date(tool.updatedAt || tool.createdAt),
    );
    return `<article class="tool-card" tabindex="0" role="button" data-tool-id="${escapeHtml(tool.id)}" aria-label="打开小工具 ${escapeHtml(tool.title)}">
      <div class="tool-card-preview" aria-hidden="true"><iframe title="${escapeHtml(tool.title)} 预览" sandbox="allow-scripts" tabindex="-1" referrerpolicy="no-referrer" loading="lazy"></iframe></div>
      <div class="tool-card-copy">
        <h2>${escapeHtml(tool.title)}</h2>
        <p>${escapeHtml(tool.description || '作者还没有写简介。')}</p>
        <div class="tool-card-meta"><span>@${escapeHtml(tool.author?.username || '匿名用户')}</span><time>${escapeHtml(date)}</time></div>
      </div>
    </article>`;
  }

  function renderTools() {
    gallery.innerHTML = state.tools.length
      ? state.tools.map(cardMarkup).join('')
      : `<div class="tool-gallery-empty">${state.scope === 'mine' ? '你还没有发布小工具。打开制作台，把第一个想法做出来。' : '广场里还没有小工具，来发布第一个作品。'}</div>`;
    gallery.querySelectorAll('.tool-card').forEach((card) => {
      const tool = state.tools.find((entry) => entry.id === card.dataset.toolId);
      card.querySelector('iframe').srcdoc = sandboxDocument(tool?.html, true);
    });
  }

  function syncScopeButtons() {
    scopeButtons.forEach((button) => {
      const active = button.dataset.toolScope === state.scope;
      button.setAttribute('aria-pressed', String(active));
    });
  }

  async function loadTools() {
    gallery.setAttribute('aria-busy', 'true');
    galleryStatus.textContent = '正在加载小工具广场…';
    try {
      const payload = await app.callApi(`/tools?scope=${encodeURIComponent(state.scope)}`, {
        method: 'GET',
      });
      state.tools = payload.tools || [];
      renderTools();
      galleryStatus.textContent = `${state.scope === 'mine' ? '我发布的' : '所有人的'} · ${state.tools.length} 个小工具`;
    } catch (error) {
      state.tools = [];
      gallery.innerHTML = `<div class="tool-gallery-empty">${escapeHtml(error.message)}</div>`;
      galleryStatus.textContent = '加载失败';
    } finally {
      gallery.setAttribute('aria-busy', 'false');
    }
  }

  function openTool(tool) {
    if (!tool) return;
    state.active = tool;
    viewerTitle.textContent = tool.title;
    viewerMeta.textContent = `@${tool.author?.username || '匿名用户'} · ${tool.description || '无简介'}`;
    viewerFrame.srcdoc = sandboxDocument(tool.html, true);
    if (!viewer.open) viewer.showModal();
    const url = new URL(window.location.href);
    url.searchParams.set('tool', tool.id);
    window.history.replaceState(null, '', url);
  }

  function closeViewer() {
    viewer.close();
    viewerFrame.srcdoc = '';
    state.active = null;
    const url = new URL(window.location.href);
    url.searchParams.delete('tool');
    window.history.replaceState(null, '', url);
  }

  function shareToDiscussion() {
    if (!state.active) return;
    if (!app.userState.isLoggedIn) {
      window.location.href = `/login?next=${encodeURIComponent(
        window.location.pathname + window.location.search,
      )}`;
      return;
    }
    const link = `${window.location.origin}/tool-workshop?tool=${encodeURIComponent(
      state.active.id,
    )}`;
    const draft = {
      title: `分享小工具：${state.active.title}`.slice(0, 120),
      content: [
        state.active.description || '我在实验室制作了一个新工具。',
        '',
        `[打开「${state.active.title}」](${link})`,
      ].join('\n'),
    };
    sessionStorage.setItem('free_bbs_tool_share_draft', JSON.stringify(draft));
    window.location.href = '/publish?board=daily&tool_share=1';
  }

  createToggle.addEventListener('click', () => (studio.hidden ? openStudio() : closeStudio()));
  document.getElementById('tool-generate').addEventListener('click', generate);
  cancelButton.addEventListener('click', () => generationController?.abort());
  window.addEventListener('pagehide', () => {
    generationController?.abort();
    clearTimeout(highlightTimer);
  });
  editCodeButton.addEventListener('click', () => setCodeEditing(!editingCode));
  document.getElementById('tool-preview').addEventListener('click', refreshPreview);
  panelButtons.forEach((button) => {
    button.addEventListener('click', () => selectPanel(button.dataset.toolPanel));
  });
  document.getElementById('tool-publish').addEventListener('click', publish);
  scopeButtons.forEach((button) => {
    button.addEventListener('click', async () => {
      if (button.dataset.toolScope === 'mine' && !app.userState.isLoggedIn) {
        openStudio();
        return;
      }
      state.scope = button.dataset.toolScope;
      syncScopeButtons();
      await loadTools();
    });
  });
  gallery.addEventListener('click', (event) => {
    const card = event.target.closest('.tool-card');
    if (card) openTool(state.tools.find((tool) => tool.id === card.dataset.toolId));
  });
  gallery.addEventListener('keydown', (event) => {
    const card = event.target.closest('.tool-card');
    if (card && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      openTool(state.tools.find((tool) => tool.id === card.dataset.toolId));
    }
  });
  viewer
    .querySelectorAll('[data-tool-close]')
    .forEach((button) => button.addEventListener('click', closeViewer));
  viewer.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeViewer();
  });
  shareButton.addEventListener('click', shareToDiscussion);

  app.sessionReady.then(async () => {
    await loadTools();
    try {
      const draft = window.FreeBbsMaxArtifacts?.read('tool', app.userState.uid);
      if (draft) {
        openStudio();
        titleInput.value = draft.title;
        htmlInput.value = draft.html;
        promptInput.value = draft.title;
        renderCode();
        selectPanel('preview');
        status.textContent = '已接收 Max 生成的草稿，尚未发布。';
        return;
      }
    } catch (error) {
      galleryStatus.textContent = error.message;
    }
    const requested = new URLSearchParams(window.location.search).get('tool');
    if (!requested) return;
    let tool = state.tools.find((entry) => entry.id === requested);
    if (!tool) {
      try {
        tool = (await app.callApi(`/tools/${encodeURIComponent(requested)}`, { method: 'GET' }))
          .tool;
      } catch (error) {
        galleryStatus.textContent = error.message;
      }
    }
    if (tool) openTool(tool);
  });
})();
