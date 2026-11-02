(function moderationSettingsModule() {
  const SETTINGS_PATH = '/admin/system-settings/moderation';

  function createController({ form, callApi }) {
    const field = (suffix) => form.querySelector(`#moderation-settings-${suffix}`);
    const baseUrl = field('base-url');
    const textModel = field('text-model');
    const imageModel = field('image-model');
    const apiKey = field('api-key');
    const keyToggle = field('key-toggle');
    const keyClear = field('key-clear');
    const reload = field('reload');
    const state = field('state');
    const message = field('message');
    let settings = null;
    let busy = false;
    let clearArmed = false;

    function setMessage(text, isError = false) {
      message.textContent = text;
      message.classList.toggle('is-error', isError);
    }

    function setBusy(value) {
      busy = value;
      form.setAttribute('aria-busy', String(value));
      form.querySelectorAll('button, input').forEach((control) => {
        const item = control;
        item.disabled = value || !settings;
      });
      reload.disabled = value;
      keyClear.disabled = value || !settings?.configured;
    }

    function disarmClear() {
      clearArmed = false;
      keyClear.textContent = '清除监管密钥';
      keyClear.setAttribute('aria-label', '清除当前监管 API key');
    }

    function hideKey() {
      apiKey.type = 'password';
      keyToggle.textContent = '显示';
      keyToggle.setAttribute('aria-pressed', 'false');
      keyToggle.setAttribute('aria-label', '显示新输入的监管 API key');
    }

    function render(payload) {
      settings = {
        baseUrl: String(payload.baseUrl || ''),
        textModel: String(payload.textModel || ''),
        imageModel: String(payload.imageModel || ''),
        configured: payload.configured === true,
      };
      baseUrl.value = settings.baseUrl;
      textModel.value = settings.textModel;
      imageModel.value = settings.imageModel;
      apiKey.value = '';
      hideKey();
      disarmClear();
      const lastFour = String(payload.lastFour || '').slice(-4);
      state.textContent = settings.configured
        ? `已配置${lastFour ? ` · 尾号 ${lastFour}` : ''}`
        : '尚未配置监管密钥';
    }

    async function load() {
      if (busy) return;
      setBusy(true);
      setMessage('正在读取监管配置…');
      try {
        render(await callApi(SETTINGS_PATH, { method: 'GET' }));
        setMessage('');
      } catch (error) {
        state.textContent = '读取失败';
        setMessage(error.message || '无法读取监管配置，请重新读取。', true);
      } finally {
        setBusy(false);
      }
    }

    function normalizedUrl(value) {
      try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
          return '';
        return url.toString().replace(/\/+$/, '');
      } catch {
        return '';
      }
    }

    async function save(event) {
      event?.preventDefault();
      if (busy || !settings) return;
      const url = normalizedUrl(baseUrl.value.trim());
      const secret = apiKey.value.trim();
      const text = textModel.value.trim();
      const image = imageModel.value.trim();
      if (!url) {
        setMessage('请输入不含凭据、查询参数或片段的 HTTPS 基础地址。', true);
        baseUrl.focus();
        return;
      }
      if (!text || !image) {
        setMessage('请填写文字和图片审核模型。', true);
        (text ? imageModel : textModel).focus();
        return;
      }
      if (settings.configured && url !== normalizedUrl(settings.baseUrl) && !secret) {
        setMessage('更换 API 地址时，请同时填写新平台的监管密钥。', true);
        apiKey.focus();
        return;
      }
      disarmClear();
      setBusy(true);
      setMessage('正在保存监管配置…');
      try {
        const payload = await callApi(SETTINGS_PATH, {
          method: 'PATCH',
          body: JSON.stringify({
            baseUrl: url,
            textModel: text,
            imageModel: image,
            ...(secret ? { apiKey: secret } : {}),
          }),
        });
        render(payload);
        setMessage(
          settings.configured
            ? '监管配置已保存。自动审核的启停仍由工作台控制。'
            : '监管配置已保存，尚未配置监管密钥。',
        );
      } catch (error) {
        setMessage(error.message || '保存失败，请重试。', true);
      } finally {
        setBusy(false);
      }
    }

    async function clearKey() {
      if (busy || !settings?.configured) return;
      if (!clearArmed) {
        clearArmed = true;
        keyClear.textContent = '再次点击确认清除';
        keyClear.setAttribute('aria-label', '再次点击确认清除当前监管 API key');
        setMessage('再次点击将删除监管密钥，新的机器审核将不可用。MAX 的密钥不受影响。');
        return;
      }
      setBusy(true);
      setMessage('正在清除监管密钥…');
      try {
        render(await callApi(`${SETTINGS_PATH}/api-key`, { method: 'DELETE' }));
        setMessage('监管密钥已清除，待审内容请由负责人处理。');
      } catch (error) {
        disarmClear();
        setMessage(error.message || '清除失败，请重试。', true);
      } finally {
        setBusy(false);
      }
    }

    form.addEventListener('submit', save);
    keyClear.addEventListener('click', clearKey);
    reload.addEventListener('click', load);
    form.querySelectorAll('input').forEach((input) => {
      input.addEventListener('input', disarmClear);
    });
    keyToggle.addEventListener('click', () => {
      if (busy || !settings) return;
      const visible = apiKey.type === 'password';
      apiKey.type = visible ? 'text' : 'password';
      keyToggle.textContent = visible ? '隐藏' : '显示';
      keyToggle.setAttribute('aria-pressed', String(visible));
      keyToggle.setAttribute(
        'aria-label',
        visible ? '隐藏新输入的监管 API key' : '显示新输入的监管 API key',
      );
      apiKey.focus();
    });
    setBusy(false);
    return { load, save, clearKey };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createController };
  }
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const form = document.getElementById('moderation-settings-form');
  const app = window.freeBbsApp;
  if (!form || !app) return;
  Promise.resolve(app.sessionReady)
    .then(() => {
      if (!app.userState.isLoggedIn || !app.userState.isAdmin) return;
      return createController({ form, callApi: (...args) => app.callApi(...args) }).load();
    })
    .catch(() => {
      const message = form.querySelector('#moderation-settings-message');
      message.textContent = '无法读取管理员会话，请刷新页面重试。';
      message.classList.add('is-error');
    });
})();
