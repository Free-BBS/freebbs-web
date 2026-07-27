(() => {
  const app = window.freeBbsApp;

  if (!app) {
    return;
  }

  const adminContent = document.querySelector('[data-admin-content]');
  const modelForm = document.getElementById('system-model-form');
  const modelApiKey = document.getElementById('system-model-api-key');
  const modelApiKeyToggle = document.getElementById('system-model-api-key-toggle');
  const modelConfigState = document.getElementById('system-model-config-state');
  const modelMessage = document.getElementById('system-model-message');
  const modelClearButton = document.getElementById('system-model-api-key-clear');
  const courseForm = document.getElementById('system-course-form');
  const courseRoot = document.getElementById('system-course-root');
  const courseConfigState = document.getElementById('system-course-config-state');
  const courseMessage = document.getElementById('system-course-message');

  let modelConfigured = false;
  let clearModelKeyArmed = false;

  function setMessage(target, message = '', isError = false) {
    if (!target) {
      return;
    }

    const messageTarget = target;
    messageTarget.textContent = message;
    messageTarget.classList.toggle('is-error', isError);
  }

  function setFormBusy(form, isBusy) {
    if (!form) {
      return;
    }

    form.setAttribute('aria-busy', String(isBusy));
    form.querySelectorAll('button, input').forEach((control) => {
      const formControl = control;
      formControl.disabled = isBusy;
    });
  }

  function getModelSettings(payload = {}) {
    const model = payload.model || {};
    const configured = Boolean(payload.configured ?? model.configured);
    const lastFour = String(payload.lastFour ?? model.lastFour ?? '')
      .trim()
      .slice(-4);

    return { configured, lastFour };
  }

  function renderModelSettings(payload = {}) {
    const settings = getModelSettings(payload);
    modelConfigured = settings.configured;
    clearModelKeyArmed = false;

    if (modelConfigState) {
      modelConfigState.textContent = settings.configured
        ? `已配置${settings.lastFour ? ` · 尾号 ${settings.lastFour}` : ''}`
        : '尚未配置';
    }

    if (modelClearButton) {
      modelClearButton.disabled = !settings.configured;
      modelClearButton.textContent = '清除密钥';
      modelClearButton.setAttribute('aria-label', '清除当前模型 API key');
    }
  }

  async function loadModelSettings() {
    if (!modelForm) {
      return;
    }

    setFormBusy(modelForm, true);
    setMessage(modelMessage, '正在读取模型配置…');

    try {
      const payload = await app.callApi('/admin/system-settings/model', { method: 'GET' });
      renderModelSettings(payload);
      setMessage(modelMessage, '');
    } catch (error) {
      if (modelConfigState) {
        modelConfigState.textContent = '读取失败';
      }
      setMessage(modelMessage, error.message, true);
    } finally {
      setFormBusy(modelForm, false);
      if (modelClearButton) {
        modelClearButton.disabled = !modelConfigured;
      }
    }
  }

  async function saveModelSettings(event) {
    event.preventDefault();

    const apiKey = modelApiKey?.value.trim() || '';

    if (!apiKey) {
      setMessage(modelMessage, '请输入新的 API key。', true);
      modelApiKey?.focus();
      return;
    }

    setFormBusy(modelForm, true);
    setMessage(modelMessage, '正在保存模型配置…');

    try {
      const payload = await app.callApi('/admin/system-settings/model', {
        method: 'PATCH',
        body: JSON.stringify({ apiKey }),
      });
      modelApiKey.value = '';
      renderModelSettings({
        ...payload,
        configured: payload.configured ?? true,
        lastFour: payload.lastFour ?? apiKey.slice(-4),
      });
      setMessage(modelMessage, payload.message || '模型 API key 已更新。');
    } catch (error) {
      setMessage(modelMessage, error.message, true);
    } finally {
      setFormBusy(modelForm, false);
      if (modelClearButton) {
        modelClearButton.disabled = !modelConfigured;
      }
    }
  }

  function toggleModelApiKeyVisibility() {
    if (!modelApiKey || !modelApiKeyToggle) {
      return;
    }

    const willShow = modelApiKey.type === 'password';
    modelApiKey.type = willShow ? 'text' : 'password';
    modelApiKeyToggle.textContent = willShow ? '隐藏' : '显示';
    modelApiKeyToggle.setAttribute('aria-pressed', String(willShow));
    modelApiKeyToggle.setAttribute('aria-label', willShow ? '隐藏 API key' : '显示 API key');
    modelApiKey.focus();
  }

  async function clearModelApiKey() {
    if (!modelClearButton || !modelConfigured) {
      return;
    }

    if (!clearModelKeyArmed) {
      clearModelKeyArmed = true;
      modelClearButton.textContent = '再次点击确认清除';
      modelClearButton.setAttribute('aria-label', '再次点击确认清除当前模型 API key');
      setMessage(modelMessage, '再次点击“确认清除”将删除当前密钥。');
      return;
    }

    setFormBusy(modelForm, true);
    setMessage(modelMessage, '正在清除模型配置…');

    try {
      const payload = await app.callApi('/admin/system-settings/model/api-key', {
        method: 'DELETE',
      });
      renderModelSettings({ ...payload, configured: false, lastFour: '' });
      setMessage(modelMessage, payload.message || '模型 API key 已清除。');
    } catch (error) {
      clearModelKeyArmed = false;
      modelClearButton.textContent = '清除密钥';
      modelClearButton.setAttribute('aria-label', '清除当前模型 API key');
      setMessage(modelMessage, error.message, true);
    } finally {
      setFormBusy(modelForm, false);
      if (modelClearButton) {
        modelClearButton.disabled = !modelConfigured;
      }
    }
  }

  function getCourseRoot(payload = {}) {
    return String(
      payload.rootDirectory ??
        payload.courseMaterialsRoot ??
        payload.courseMaterials?.rootDirectory ??
        '',
    ).trim();
  }

  function renderCourseSettings(payload = {}) {
    const rootDirectory = getCourseRoot(payload);

    if (courseRoot) {
      courseRoot.value = rootDirectory;
    }

    if (courseConfigState) {
      courseConfigState.textContent = rootDirectory ? '已配置' : '尚未配置';
    }
  }

  async function loadCourseSettings() {
    if (!courseForm) {
      return;
    }

    setFormBusy(courseForm, true);
    setMessage(courseMessage, '正在读取课程资料配置…');

    try {
      const payload = await app.callApi('/admin/system-settings/course-materials', {
        method: 'GET',
      });
      renderCourseSettings(payload);
      setMessage(courseMessage, '');
    } catch (error) {
      if (courseConfigState) {
        courseConfigState.textContent = '读取失败';
      }
      setMessage(courseMessage, error.message, true);
    } finally {
      setFormBusy(courseForm, false);
    }
  }

  async function saveCourseSettings(event) {
    event.preventDefault();

    const rootDirectory = courseRoot?.value.trim() || '';

    if (!rootDirectory) {
      setMessage(courseMessage, '请输入课程资料根目录。', true);
      courseRoot?.focus();
      return;
    }

    setFormBusy(courseForm, true);
    setMessage(courseMessage, '正在验证并保存目录…');

    try {
      const payload = await app.callApi('/admin/system-settings/course-materials', {
        method: 'PATCH',
        body: JSON.stringify({ rootDirectory }),
      });
      renderCourseSettings(payload);
      setMessage(courseMessage, payload.message || '课程资料根目录已更新。');
    } catch (error) {
      setMessage(courseMessage, error.message, true);
    } finally {
      setFormBusy(courseForm, false);
    }
  }

  async function initializeSystemSettings() {
    await app.sessionReady;

    if (!app.userState.isLoggedIn || !app.userState.isAdmin) {
      return;
    }

    adminContent?.classList.remove('hidden');

    if (modelForm) {
      await loadModelSettings();
    }

    if (courseForm) {
      await loadCourseSettings();
    }
  }

  modelForm?.addEventListener('submit', saveModelSettings);
  modelApiKeyToggle?.addEventListener('click', toggleModelApiKeyVisibility);
  modelClearButton?.addEventListener('click', clearModelApiKey);
  modelApiKey?.addEventListener('input', () => {
    if (!clearModelKeyArmed || !modelClearButton) {
      return;
    }

    clearModelKeyArmed = false;
    modelClearButton.textContent = '清除密钥';
    modelClearButton.setAttribute('aria-label', '清除当前模型 API key');
  });
  courseForm?.addEventListener('submit', saveCourseSettings);

  initializeSystemSettings();
})();
