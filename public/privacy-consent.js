(function initializePrivacyConsent() {
  const tokenKey = 'free_bbs_auth_token';
  const apiBase = window.FREEBBS_API_BASE || `${window.location.origin}/api`;
  let pending = null;
  let pendingToken = null;

  function assertCurrentSession(token) {
    let current;
    try {
      current = window.localStorage.getItem(tokenKey);
    } catch {
      /* A readable session is required to confirm its owner. */
    }
    if (current !== token) {
      const error = new Error('登录账号已变化，请刷新后为当前账号确认隐私政策');
      error.code = 'privacy_session_changed';
      throw error;
    }
  }

  async function request(path, token, options = {}) {
    const response = await fetch(`${apiBase}${path}`, {
      ...options,
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(result.message || '暂时无法读取隐私政策，请稍后重试');
      error.status = response.status;
      throw error;
    }
    return result;
  }

  async function loadPolicy() {
    const policy = await request('/privacy-policy');
    if (
      typeof policy.version !== 'string' ||
      !/^[a-f0-9]{64}$/.test(policy.contentHash) ||
      typeof policy.html !== 'string' ||
      !policy.html.trim()
    )
      throw new Error('隐私政策暂时不可用，请刷新后重试');
    return policy;
  }

  function acknowledgement(policy) {
    return {
      privacyAccepted: true,
      privacyPolicyVersion: policy.version,
      privacyPolicyHash: policy.contentHash,
    };
  }

  async function loginAcknowledgement() {
    const checkbox = document.getElementById('auth-privacy-agreement');
    if (!checkbox?.checked) {
      checkbox?.focus();
      throw new Error('请阅读并勾选同意隐私政策');
    }
    const policy = await loadPolicy();
    if (!checkbox.checked) throw new Error('请阅读并勾选同意隐私政策');
    return acknowledgement(policy);
  }

  function showPolicy(policy, token) {
    return new Promise((resolve, reject) => {
      const dialog = document.createElement('dialog');
      dialog.className = 'privacy-dialog';
      dialog.setAttribute('aria-labelledby', 'privacy-consent-title');
      dialog.innerHTML = `<div class="privacy-dialog-shell"><header class="privacy-dialog-header"><h2 id="privacy-consent-title">FreeBBS 隐私政策</h2><p>使用前，请阅读完整政策并作出选择。您可随时通过页脚的隐私政策入口再次查看。</p></header><article class="privacy-dialog-content privacy-policy-document" tabindex="0" aria-label="隐私政策全文"></article><footer class="privacy-dialog-footer"><label class="privacy-agreement"><input type="checkbox" id="privacy-full-agreement"><span>我已阅读并同意《FreeBBS 隐私政策》。<a href="/privacy" target="_blank" rel="noopener">打开完整页面</a></span></label><p class="privacy-dialog-error" role="alert"></p><div class="privacy-dialog-actions"><button type="button" data-decline>暂不同意，退出登录</button><button type="button" data-primary disabled>同意并继续</button></div></footer></div>`;
      const content = dialog.querySelector('.privacy-dialog-content');
      content.innerHTML = policy.html;
      const checkbox = dialog.querySelector('#privacy-full-agreement');
      const confirm = dialog.querySelector('[data-primary]');
      const decline = dialog.querySelector('[data-decline]');
      const message = dialog.querySelector('[role="alert"]');
      let busy = false;
      let settled = false;
      const close = () => {
        settled = true;
        dialog.close();
        dialog.remove();
      };
      const cancel = () => {
        if (busy || settled) return;
        close();
        const error = new Error('您尚未同意隐私政策，已退出登录。');
        error.code = 'privacy_declined';
        error.sessionToken = token;
        reject(error);
      };
      checkbox.addEventListener('change', () => {
        confirm.disabled = busy || !checkbox.checked;
      });
      decline.addEventListener('click', cancel);
      dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        cancel();
      });
      confirm.addEventListener('click', async () => {
        if (busy || !checkbox.checked) return;
        busy = true;
        confirm.disabled = true;
        decline.disabled = true;
        checkbox.disabled = true;
        message.textContent = '';
        try {
          assertCurrentSession(token);
          const result = await request('/privacy-policy/accept', token, {
            method: 'POST',
            body: JSON.stringify(acknowledgement(policy)),
          });
          assertCurrentSession(token);
          if (
            result.accepted !== true ||
            result.version !== policy.version ||
            result.contentHash !== policy.contentHash
          )
            throw new Error('确认未完成，请重试');
          close();
          resolve({ ...result, acceptedNow: true });
        } catch (error) {
          message.textContent = error.message;
        } finally {
          busy = false;
          confirm.disabled = !checkbox.checked;
          decline.disabled = false;
          checkbox.disabled = false;
        }
      });
      document.body.appendChild(dialog);
      dialog.showModal();
      content.focus();
    });
  }

  function ensureAccepted(token, knownStatus) {
    if (pending && pendingToken === token) return pending;
    if (pending) return Promise.reject(new Error('账号已变化，请刷新后重新确认隐私政策'));
    pendingToken = token;
    pending = (async () => {
      assertCurrentSession(token);
      const status = knownStatus || (await request('/privacy-policy/status', token));
      assertCurrentSession(token);
      if (status.accepted === true && status.requiresFullPolicy === false) return status;
      const policy = await loadPolicy();
      assertCurrentSession(token);
      return showPolicy(policy, token);
    })().finally(() => {
      pending = null;
      pendingToken = null;
    });
    return pending;
  }

  function clearDeclinedSession(token) {
    try {
      if (token && window.localStorage.getItem(tokenKey) === token)
        window.localStorage.removeItem(tokenKey);
    } catch {
      /* API acceptance remains absent. */
    }
  }

  async function restorePrivacy() {
    if (/^\/(?:login|register|remake|privacy)(?:\.html)?$/.test(window.location.pathname)) return;
    let token;
    try {
      token = window.localStorage.getItem(tokenKey);
    } catch {
      return;
    }
    if (!token) return;
    try {
      const result = await ensureAccepted(token);
      if (result.acceptedNow) window.location.reload();
    } catch (error) {
      if (error.code === 'privacy_declined') {
        clearDeclinedSession(error.sessionToken);
        window.location.href = '/login';
      }
      // The server still rejects protected processing while consent is missing.
      else if (error.status !== 401) {
        const notice = document.createElement('p');
        notice.className = 'privacy-restore-notice';
        notice.setAttribute('role', 'alert');
        notice.textContent = `${error.message}。请重新登录完成确认。`;
        const link = document.createElement('a');
        link.href = '/login';
        link.textContent = ' 前往登录';
        notice.appendChild(link);
        document.body.prepend(notice);
      }
    }
  }

  window.freeBbsPrivacy = { ensureAccepted, loginAcknowledgement, clearDeclinedSession };
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', restorePrivacy, { once: true });
  else restorePrivacy();
})();
