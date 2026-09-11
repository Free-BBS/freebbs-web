(() => {
  const page = document.querySelector('[data-knowledge-page]');
  const editor = document.getElementById('knowledge-editor');
  const app = window.freeBbsApp;
  if (!page || !editor || !app) return;

  const params = new URLSearchParams(window.location.search);
  const courseSlug = params.get('course') || 'signals';
  const nodeId = params.get('point') || '';
  const route = `/courses/${encodeURIComponent(courseSlug)}/map/nodes/${encodeURIComponent(nodeId)}`;
  const reader = editor.closest('.course-material-reader');
  const toggle = document.getElementById('knowledge-edit-toggle');
  const source = document.getElementById('knowledge-editor-source');
  const preview = document.getElementById('knowledge-editor-preview');
  const status = document.getElementById('knowledge-editor-status');
  const notice = document.getElementById('knowledge-edit-notice');
  const discard = document.getElementById('knowledge-editor-discard');
  const imageInput = document.getElementById('knowledge-editor-image-input');
  const labels = {
    knowledgeMarkdown: '知识正文 Markdown',
    basicInfoMarkdown: '基本信息 Markdown',
    applicationsMarkdown: '应用与拓展 Markdown',
  };
  const state = {
    active: false,
    busy: false,
    canEdit: false,
    loaded: false,
    sessionUid: '',
    generation: 0,
    revision: '',
    section: 'knowledgeMarkdown',
    mode: 'edit',
    values: {},
    saved: {},
    previewTimer: 0,
  };

  function sectionsFrom(node) {
    return {
      knowledgeMarkdown: String(node.sections?.knowledgeMarkdown ?? node.markdown ?? ''),
      basicInfoMarkdown: String(node.sections?.basicInfoMarkdown || ''),
      applicationsMarkdown: String(node.sections?.applicationsMarkdown || ''),
    };
  }

  function hasChanges() {
    return Object.keys(labels).some((key) => state.values[key] !== state.saved[key]);
  }

  function setStatus(message, error = false) {
    status.textContent = message;
    status.classList.toggle('is-error', error);
  }

  function updateControls() {
    editor.querySelectorAll('button, textarea, input').forEach((control) => {
      control.toggleAttribute('disabled', state.busy || !state.revision);
    });
    editor
      .querySelectorAll('#knowledge-editor-toolbar button, #knowledge-editor-image-input')
      .forEach((control) => {
        control.toggleAttribute('disabled', state.busy || !state.canEdit || !state.revision);
      });
    ['cancel', 'discard-confirm', 'discard-keep'].forEach((action) => {
      document.getElementById(`knowledge-editor-${action}`).disabled = state.busy;
    });
    source.readOnly = !state.canEdit;
    document.getElementById('knowledge-editor-save').disabled =
      state.busy || !state.canEdit || !state.revision || !hasChanges();
    toggle.disabled = state.busy;
    toggle.hidden = !state.canEdit || state.active;
    editor.setAttribute('aria-busy', String(state.busy));
  }

  function setBusy(busy) {
    state.busy = busy;
    updateControls();
  }

  function renderPreview() {
    preview.innerHTML = app.renderMarkdownContent(state.values[state.section] || '');
    app.enhanceMarkdownContent(preview);
  }

  function selectMode(mode) {
    state.mode = mode === 'preview' ? 'preview' : 'edit';
    document.getElementById('knowledge-editor-edit-pane').hidden = state.mode !== 'edit';
    document.getElementById('knowledge-editor-preview-pane').hidden = state.mode !== 'preview';
    editor.querySelectorAll('[data-knowledge-editor-mode]').forEach((button) => {
      const selected = button.dataset.knowledgeEditorMode === state.mode;
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('is-active', selected);
    });
    if (state.mode === 'preview') renderPreview();
  }

  function selectSection(section, focus = true) {
    if (!Object.hasOwn(labels, section)) return;
    state.section = section;
    source.value = state.values[section] || '';
    document.getElementById('knowledge-editor-source-label').textContent = labels[section];
    editor.querySelectorAll('[data-knowledge-editor-section]').forEach((button) => {
      const selected = button.dataset.knowledgeEditorSection === section;
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('is-active', selected);
    });
    if (state.mode === 'preview') renderPreview();
    else if (focus) source.focus();
  }

  function showEditor(active) {
    state.active = active;
    editor.hidden = !active;
    reader.classList.toggle('is-editing', active);
    discard.hidden = true;
    toggle.setAttribute('aria-expanded', String(active));
    updateControls();
  }

  function closeEditor() {
    state.generation += 1;
    state.busy = false;
    state.values = {};
    state.saved = {};
    state.revision = '';
    source.value = '';
    preview.replaceChildren();
    window.clearTimeout(state.previewTimer);
    showEditor(false);
    if (state.canEdit) toggle.focus({ preventScroll: true });
  }

  async function beginEditing() {
    if (!state.canEdit || state.active || state.busy) return;
    state.generation += 1;
    const { generation } = state;
    notice.hidden = true;
    showEditor(true);
    setBusy(true);
    setStatus('正在载入最新内容…');
    try {
      const { course, node } = await app.callApi(route, { method: 'GET' });
      if (generation !== state.generation) return;
      state.canEdit = Boolean(course.canEditMap && app.userState.isLoggedIn);
      if (!state.canEdit) throw new Error('需要该课程的资料负责人权限。');
      if (!node.revision) throw new Error('暂时无法读取文档版本，请刷新页面后重试。');
      state.revision = node.revision;
      state.values = sectionsFrom(node);
      state.saved = { ...state.values };
      selectMode('edit');
      selectSection('knowledgeMarkdown', false);
      setStatus('已载入最新版本，修改后点击保存。');
    } catch (error) {
      if (generation !== state.generation) return;
      if ([401, 403].includes(error.status)) state.canEdit = false;
      setStatus(error.message || '读取知识点失败，请稍后重试。', true);
    } finally {
      if (generation === state.generation) {
        setBusy(false);
        if (state.revision) source.focus({ preventScroll: true });
      }
    }
  }

  async function saveDocument() {
    if (!state.active || state.busy || !state.canEdit || !state.revision || !hasChanges()) return;
    const { generation } = state;
    const sections = { ...state.values };
    setBusy(true);
    setStatus('正在保存…');
    try {
      const payload = await app.callApi(`${route}/document`, {
        method: 'PUT',
        body: JSON.stringify({ sections, expectedRevision: state.revision }),
      });
      if (generation !== state.generation) return;
      state.saved = { ...sections };
      state.revision = payload.node.revision;
      page.dispatchEvent(
        new CustomEvent('knowledge:document-saved', { detail: { node: payload.node } }),
      );
      closeEditor();
      notice.textContent = '知识点已保存';
      notice.hidden = false;
    } catch (error) {
      if (generation !== state.generation) return;
      setStatus(
        error.status === 409
          ? '此知识点已被他人修改。你的草稿仍保留，请先复制草稿，再取消编辑并重新打开最新版本合并。'
          : error.message || '保存失败，草稿已保留，请稍后重试。',
        true,
      );
      if ([401, 403].includes(error.status)) {
        state.canEdit = false;
        setStatus(
          '登录状态或课程权限已变更，无法保存。请先复制草稿，再重新登录或联系课程负责人。',
          true,
        );
      }
    } finally {
      if (generation === state.generation) setBusy(false);
    }
  }

  function updateDraft() {
    state.values[state.section] = source.value;
    discard.hidden = true;
    setStatus(hasChanges() ? '有未保存的修改' : '内容未修改');
    updateControls();
    window.clearTimeout(state.previewTimer);
    if (state.mode === 'preview') state.previewTimer = window.setTimeout(renderPreview, 120);
  }

  function insertText(before, after = before) {
    const start = source.selectionStart;
    const end = source.selectionEnd;
    source.setRangeText(`${before}${source.value.slice(start, end)}${after}`, start, end, 'end');
    source.focus();
    updateDraft();
  }

  async function uploadImage(file) {
    if (!file || !state.active || state.busy || !state.canEdit) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'].includes(file.type)) {
      setStatus('请选择 PNG、JPG、WebP、GIF 或 AVIF 图片。', true);
      return;
    }
    if (!file.size || file.size > 20 * 1024 * 1024) {
      setStatus('图片大小需在 20MB 以内。', true);
      return;
    }
    const { generation } = state;
    const start = source.selectionStart;
    const end = source.selectionEnd;
    setBusy(true);
    setStatus('正在上传图片…');
    try {
      const imageDataUrl = await new Promise((resolve, reject) => {
        const fileReader = new FileReader();
        fileReader.onload = () => resolve(String(fileReader.result || ''));
        fileReader.onerror = () => reject(new Error('读取图片失败'));
        fileReader.readAsDataURL(file);
      });
      if (generation !== state.generation) return;
      const payload = await app.callApi(
        `/courses/${encodeURIComponent(courseSlug)}/map/uploads/images`,
        {
          method: 'POST',
          body: JSON.stringify({ imageDataUrl }),
        },
      );
      if (generation !== state.generation) return;
      source.setRangeText(`\n${payload.markdown}\n`, start, end, 'end');
      updateDraft();
      setStatus('图片已插入，请保存知识点以发布修改。');
    } catch (error) {
      if (generation === state.generation) setStatus(error.message || '图片上传失败。', true);
    } finally {
      if (generation === state.generation) setBusy(false);
    }
  }

  page.addEventListener('knowledge:loaded', (event) => {
    state.loaded = true;
    state.sessionUid = app.userState.uid;
    state.canEdit = Boolean(event.detail?.course?.canEditMap && app.userState.isLoggedIn);
    updateControls();
  });
  window.addEventListener('freebbs:session-change', async () => {
    if (!state.loaded) return;
    const accountChanged = state.sessionUid !== app.userState.uid || !app.userState.isLoggedIn;
    state.sessionUid = app.userState.uid;
    if (accountChanged) {
      state.canEdit = false;
      closeEditor();
      notice.hidden = true;
    }
    if (!app.userState.isLoggedIn) return;
    const { generation } = state;
    try {
      const payload = await app.callApi(route, { method: 'GET' });
      if (generation !== state.generation) return;
      state.canEdit = Boolean(payload.course.canEditMap);
      if (state.active && !state.canEdit) {
        setStatus('课程权限已变更，无法保存。请先复制草稿，再联系课程负责人。', true);
      }
      updateControls();
    } catch {
      // Keep the editing entry hidden when permissions cannot be confirmed.
    }
  });
  toggle.addEventListener('click', beginEditing);
  source.addEventListener('input', updateDraft);
  editor.addEventListener('click', (event) => {
    if (state.busy) return;
    const button = event.target.closest('button');
    if (button?.dataset.knowledgeEditorSection)
      selectSection(button.dataset.knowledgeEditorSection);
    if (button?.dataset.knowledgeEditorMode) selectMode(button.dataset.knowledgeEditorMode);
  });
  document.getElementById('knowledge-editor-toolbar').addEventListener('click', (event) => {
    if (state.busy || !state.canEdit) return;
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.wrap) {
      const [before, after] = button.dataset.wrap.split('|');
      insertText(before, after);
    } else if (button.dataset.prefix) {
      const start = source.value.lastIndexOf('\n', Math.max(0, source.selectionStart - 1)) + 1;
      source.setRangeText(button.dataset.prefix, start, start, 'end');
      source.focus();
      updateDraft();
    } else if (button.dataset.block === 'formula') insertText('\n$$\n', '\n$$\n');
    else if (button.dataset.block === 'code') insertText('\n```text\n', '\n```\n');
  });
  document.getElementById('knowledge-editor-save').addEventListener('click', saveDocument);
  document.getElementById('knowledge-editor-cancel').addEventListener('click', () => {
    if (state.busy) return;
    if (hasChanges()) {
      discard.hidden = false;
      document.getElementById('knowledge-editor-discard-keep').focus();
    } else closeEditor();
  });
  document
    .getElementById('knowledge-editor-discard-confirm')
    .addEventListener('click', closeEditor);
  document.getElementById('knowledge-editor-discard-keep').addEventListener('click', () => {
    discard.hidden = true;
    source.focus();
  });
  document
    .getElementById('knowledge-editor-upload')
    .addEventListener('click', () => imageInput.click());
  imageInput.addEventListener('change', (event) => {
    const input = event.target;
    uploadImage(input.files?.[0]);
    input.value = '';
  });
  source.addEventListener('paste', (event) => {
    const image = [...(event.clipboardData?.files || [])].find((file) =>
      file.type.startsWith('image/'),
    );
    if (image) {
      event.preventDefault();
      uploadImage(image);
    }
  });
  document.addEventListener('keydown', (event) => {
    if (state.active && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      saveDocument();
    }
  });
  window.addEventListener('beforeunload', (event) => {
    if (state.active && (hasChanges() || state.busy)) event.preventDefault();
  });
})();
