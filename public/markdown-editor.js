(() => {
  const page = document.querySelector('[data-markdown-editor]');
  if (!page) {
    return;
  }

  const app = window.freeBbsApp;
  const params = new URLSearchParams(window.location.search);
  const courseSlug = params.get('course') || 'signals';
  const nodeId = params.get('point') || '';
  const source = document.getElementById('markdown-source');
  const preview = document.getElementById('markdown-preview');
  const saveStatus = document.getElementById('markdown-save-status');
  let course;
  let node;
  let activeSection = 'knowledgeMarkdown';
  let sectionValues = {
    knowledgeMarkdown: '',
    basicInfoMarkdown: '',
    applicationsMarkdown: '',
  };
  let savedSections = { ...sectionValues };
  let previewTimer = 0;

  const SECTION_LABELS = {
    knowledgeMarkdown: '知识正文 Markdown',
    basicInfoMarkdown: '基本信息 Markdown',
    applicationsMarkdown: '应用与拓展 Markdown',
  };

  function hasUnsavedChanges() {
    return Object.keys(sectionValues).some((key) => sectionValues[key] !== savedSections[key]);
  }

  function setStatus(message, isError = false) {
    saveStatus.textContent = message || '';
    saveStatus.classList.toggle('is-error', isError);
  }

  function renderPreview() {
    preview.innerHTML = app.renderMarkdownContent(source.value);
    app.enhanceMarkdownContent(preview);
  }

  function selectSection(sectionKey) {
    if (!Object.hasOwn(sectionValues, sectionKey)) {
      return;
    }
    sectionValues[activeSection] = source.value;
    activeSection = sectionKey;
    source.value = sectionValues[activeSection];
    document.getElementById('markdown-source-label').textContent = SECTION_LABELS[activeSection];
    document.querySelectorAll('[data-markdown-section]').forEach((button) => {
      const selected = button.dataset.markdownSection === activeSection;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-current', selected ? 'true' : 'false');
    });
    renderPreview();
    source.focus();
  }

  function insertAround(before, after = before) {
    const start = source.selectionStart;
    const end = source.selectionEnd;
    const selected = source.value.slice(start, end);
    source.setRangeText(`${before}${selected}${after}`, start, end, 'end');
    source.focus();
    source.dispatchEvent(new Event('input'));
  }

  function insertPrefix(prefix) {
    const lineStart = source.value.lastIndexOf('\n', source.selectionStart - 1) + 1;
    source.setRangeText(prefix, lineStart, lineStart, 'end');
    source.focus();
    source.dispatchEvent(new Event('input'));
  }

  function insertBlock(type) {
    if (type === 'formula') {
      insertAround('\n$$\n', '\n$$\n');
    } else {
      insertAround('\n```text\n', '\n```\n');
    }
  }

  async function saveDocument() {
    setStatus('正在保存…');
    sectionValues[activeSection] = source.value;
    try {
      await app.callApi(
        `/courses/${encodeURIComponent(courseSlug)}/map/nodes/${encodeURIComponent(nodeId)}/document`,
        {
          method: 'PUT',
          body: JSON.stringify({ sections: sectionValues }),
        },
      );
      savedSections = { ...sectionValues };
      setStatus(
        `已保存 · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`,
      );
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  async function uploadImage(file) {
    if (!file?.type.startsWith('image/')) {
      setStatus('请选择图片文件。', true);
      return;
    }
    setStatus('正在上传图片…');
    try {
      const imageDataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('读取图片失败'));
        reader.readAsDataURL(file);
      });
      const payload = await app.callApi(
        `/courses/${encodeURIComponent(courseSlug)}/map/uploads/images`,
        {
          method: 'POST',
          body: JSON.stringify({ imageDataUrl }),
        },
      );
      insertAround(`\n${payload.markdown}\n`, '');
      setStatus('图片已上传并插入文档。');
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  function bindControls() {
    source.addEventListener('input', () => {
      sectionValues[activeSection] = source.value;
      setStatus(hasUnsavedChanges() ? '有未保存的修改' : '已保存');
      window.clearTimeout(previewTimer);
      previewTimer = window.setTimeout(renderPreview, 90);
    });
    document.getElementById('markdown-section-tabs').addEventListener('click', (event) => {
      const button = event.target.closest('[data-markdown-section]');
      if (button) {
        selectSection(button.dataset.markdownSection);
      }
    });
    document.getElementById('markdown-toolbar').addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button) {
        return;
      }
      if (button.dataset.wrap) {
        const [before, after] = button.dataset.wrap.split('|');
        insertAround(before, after);
      } else if (button.dataset.prefix) {
        insertPrefix(button.dataset.prefix);
      } else if (button.dataset.block) {
        insertBlock(button.dataset.block);
      }
    });
    document.getElementById('markdown-save').addEventListener('click', saveDocument);
    document.getElementById('markdown-upload-button').addEventListener('click', () => {
      document.getElementById('markdown-image-input').click();
    });
    document.getElementById('markdown-image-input').addEventListener('change', (event) => {
      uploadImage(event.target.files?.[0]);
      event.target.value = '';
    });
    window.addEventListener('beforeunload', (event) => {
      sectionValues[activeSection] = source.value;
      if (hasUnsavedChanges()) {
        event.preventDefault();
      }
    });
    document.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveDocument();
      }
    });
  }

  async function initialize() {
    await app.sessionReady;
    if (!nodeId) {
      setStatus('未指定知识结点。', true);
      return;
    }
    try {
      const payload = await app.callApi(
        `/courses/${encodeURIComponent(courseSlug)}/map/nodes/${encodeURIComponent(nodeId)}`,
        { method: 'GET' },
      );
      course = payload.course;
      node = payload.node;
      if (!course.canEditMap) {
        setStatus('你不是该课程的资料负责人，无法编辑此文档。', true);
        source.disabled = true;
        document.getElementById('markdown-save').disabled = true;
        return;
      }
      document.title = `FREE-BBS - 编辑${node.title}`;
      document.getElementById('markdown-course-name').textContent = course.name;
      document.getElementById('markdown-node-title').textContent = node.title;
      document.getElementById('markdown-editor-subtitle').textContent =
        `${node.id} · 支持 KaTeX 公式、代码高亮与图片上传`;
      document.getElementById('markdown-back-link').href =
        `/course-map-editor?course=${encodeURIComponent(courseSlug)}`;
      sectionValues = {
        knowledgeMarkdown: String(node.sections?.knowledgeMarkdown ?? node.markdown ?? ''),
        basicInfoMarkdown: String(node.sections?.basicInfoMarkdown || ''),
        applicationsMarkdown: String(node.sections?.applicationsMarkdown || ''),
      };
      savedSections = { ...sectionValues };
      source.value = sectionValues.knowledgeMarkdown;
      renderPreview();
      bindControls();
      setStatus('已载入文档');
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  initialize();
})();
