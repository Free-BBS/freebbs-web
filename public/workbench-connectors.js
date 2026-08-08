(() => {
  const app = window.freeBbsApp;
  const elements = {
    state: document.getElementById('workbench-campus-state'),
    title: document.getElementById('workbench-campus-title'),
    description: document.getElementById('workbench-campus-description'),
    credentialExpiry: document.getElementById('workbench-campus-credential-expiry'),
    lastSync: document.getElementById('workbench-campus-last-sync'),
    message: document.getElementById('workbench-campus-message'),
    connect: document.getElementById('workbench-campus-connect'),
    sync: document.getElementById('workbench-campus-sync'),
    disconnect: document.getElementById('workbench-campus-disconnect'),
    loginDialog: document.getElementById('workbench-campus-login-dialog'),
    loginForm: document.getElementById('workbench-campus-login-form'),
    loginUsername: document.getElementById('workbench-campus-login-username'),
    loginPassword: document.getElementById('workbench-campus-login-password'),
    loginConsent: document.getElementById('workbench-campus-login-consent'),
    loginStatus: document.getElementById('workbench-campus-login-status'),
    loginClose: document.getElementById('workbench-campus-login-close'),
    loginCancel: document.getElementById('workbench-campus-login-cancel'),
    loginSubmit: document.getElementById('workbench-campus-login-submit'),
  };

  if (!app || !elements.state) return;

  let requestVersion = 0;
  let pollTimer = null;
  let credentialExpiryTimer = null;
  let observedOwnerKey = null;
  let currentConnector = null;
  let directLoginAbortController = null;
  let directLoginPending = false;
  let autoSyncRequested = false;

  function isLoggedIn() {
    const user = app.userState || {};
    return Boolean(user.isLoggedIn && (user.uid || user.username));
  }

  function getOwnerKey() {
    if (!isLoggedIn()) return '';
    const user = app.userState || {};
    return String(user.uid || user.username || '');
  }

  function formatTime(value) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(date);
  }

  function credentialExpiryTimestamp(value) {
    if (
      typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    ) {
      return null;
    }
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
      ? timestamp
      : null;
  }

  function clearCredentialExpiryTimer() {
    window.clearTimeout(credentialExpiryTimer);
    credentialExpiryTimer = null;
  }

  function hideCredentialExpiry() {
    clearCredentialExpiryTimer();
    if (!elements.credentialExpiry) return;
    elements.credentialExpiry.hidden = true;
    elements.credentialExpiry.textContent = '';
    elements.credentialExpiry.dataset.state = '';
  }

  function renderCredentialExpiry(connection, connected) {
    hideCredentialExpiry();
    const expiresAt = credentialExpiryTimestamp(connection?.credentialExpiresAt);
    if (!elements.credentialExpiry || !connected || expiresAt === null) return;

    const now = Date.now();
    const warningWindow = 60 * 60 * 1000;
    const remaining = expiresAt - now;
    if (remaining <= 0) return;

    elements.credentialExpiry.hidden = false;
    if (remaining <= warningWindow) {
      elements.credentialExpiry.dataset.state = 'warning';
      elements.credentialExpiry.textContent = `清华授权将在 1 小时内到期（有效至 ${formatTime(
        expiresAt,
      )}），建议现在重新连接。`;
    } else {
      elements.credentialExpiry.dataset.state = 'valid';
      elements.credentialExpiry.textContent = `清华授权有效至 ${formatTime(expiresAt)}`;
    }

    const warningAt = expiresAt - warningWindow;
    const nextRefreshAt = warningAt > now ? warningAt : expiresAt;
    credentialExpiryTimer = window.setTimeout(
      () => {
        credentialExpiryTimer = null;
        loadStatus();
      },
      Math.max(0, nextRefreshAt - now + 250),
    );
  }

  function describeResultCounts(counts = {}) {
    const labels = [
      ['courses', '识别课程'],
      ['notifications', '导入公告'],
      ['homework', '解析作业'],
      ['importantItems', '生成待办'],
    ];
    const parts = labels
      .map(([key, label]) => {
        const count = Number(counts?.[key]);
        return Number.isSafeInteger(count) && count > 0 ? `${label} ${count}` : '';
      })
      .filter(Boolean);
    return parts.length ? parts.join('、') : '本次未发现可导入内容';
  }

  function diagnosticCount(diagnostics = {}) {
    return ['warnings', 'errors'].reduce(
      (total, key) =>
        total +
        (Array.isArray(diagnostics?.[key]) ? diagnostics[key] : []).reduce((sum, entry) => {
          const count = Number(entry?.count);
          return sum + (Number.isSafeInteger(count) && count > 0 ? count : 0);
        }, 0),
      0,
    );
  }

  function partialSyncMessage(run) {
    const summary = describeResultCounts(run?.resultCounts);
    const issueCount = diagnosticCount(run?.diagnostics);
    return issueCount
      ? `最近同步部分完成：${summary}；已记录 ${issueCount} 条安全诊断摘要，可重试未完成部分。`
      : `最近同步部分完成：${summary}；部分记录仍需适配，再次同步后会记录安全诊断摘要。`;
  }

  function setMessage(message, state = '') {
    elements.message.textContent = message || '';
    elements.message.dataset.state = state;
  }

  function syncFailureMessage(errorCode) {
    const code = String(errorCode || '');
    if (
      [
        'authorization_required',
        'connector_authorization_required',
        'connector_adapter_changed',
        'connector_credential_decrypt_failed',
        'connector_grant_invalid',
      ].includes(code)
    ) {
      return '清华会话已失效，请重新连接后再同步。';
    }
    if (code === 'upstream_timeout') return '访问网络学堂超时，请稍后重试。';
    if (code === 'upstream_rate_limited') {
      return '网络学堂请求过于频繁，请稍后再试。';
    }
    if (['upstream_unavailable', 'upstream_rejected'].includes(code)) {
      return '网络学堂暂时不可用，请稍后重试。';
    }
    if (['connection_changed', 'connection_revoked'].includes(code)) {
      return '连接已更新，本次旧会话同步未继续执行。';
    }
    return '最近同步未完成，请稍后重试；如持续失败请联系管理员。';
  }

  function directLoginFailureMessage(error) {
    const code =
      typeof error?.code === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(error.code)
        ? error.code
        : 'request_failed';
    const messages = {
      cas_credentials_invalid: '请输入有效的清华账号和密码。',
      cas_credentials_rejected: '清华账号或密码不正确，请重新输入。',
      cas_interactive_verification_required:
        '本次登录需要验证码或二次验证，当前直接连接无法自动完成。',
      cas_login_unverified: '统一认证可能已经完成，但网络学堂会话验证失败，请稍后重试。',
      cas_network_error: '暂时无法访问清华统一认证，请检查网络后重试。',
      cas_timeout: '访问清华统一认证超时，请稍后重试。',
      cas_schema_changed: '清华统一认证页面已经更新，当前连接器需要重新适配。',
      cas_dependency_unavailable: '统一认证加密组件暂时不可用。',
      cas_configuration_invalid: '统一认证客户端配置异常。',
      cas_upstream_rejected: '清华统一认证未接受本次登录表单，请稍后重试。',
      cas_cookie_limit_exceeded: '清华认证会话数据超过安全上限。',
      cas_identity_response_unrecognized: '清华认证返回了未识别的登录结果。',
      cas_response_invalid: '清华认证返回了无效响应。',
      cas_redirect_location_missing: '清华认证跳转响应缺少目标。',
      cas_encryption_failed: '清华登录凭据加密未能完成。',
      cas_encryption_output_invalid: '清华登录凭据加密结果无效。',
      cas_grant_too_large: '网络学堂会话数据超过安全上限。',
      cas_internal_error: '清华认证客户端内部错误。',
      cas_redirect_blocked: '清华认证回跳被安全策略阻止。',
      cas_redirect_limit: '清华认证回跳次数异常。',
      cas_response_too_large: '清华认证返回内容超过安全上限。',
      cas_target_blocked: '清华认证返回了不受信任的跳转目标。',
      direct_authorization_failed: '直接认证未能完成。',
      direct_authorization_response_invalid: '直接认证返回结果无效。',
      direct_authorization_input_invalid: '直接认证请求格式无效。',
      direct_authorization_rate_limited: '尝试次数较多，请稍后再试。',
      connector_internal_error: '连接器内部错误，请稍后重试。',
      unauthenticated: 'FREE BBS 登录状态已失效，请重新登录后再连接。',
      request_failed: '直接连接请求未完成。',
    };
    const message =
      code === 'request_failed' && error?.status === 401
        ? 'FREE BBS 登录状态已失效，请重新登录后再连接。'
        : messages[code] || '直接连接未完成，请稍后重试。';
    const stage =
      typeof error?.stage === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(error.stage)
        ? error.stage
        : '';
    return `${message}（诊断码：${code}${stage ? `；阶段：${stage}` : ''}）`;
  }

  function isDirectCasConfiguration(configuration = {}) {
    return Boolean(
      configuration.state === 'direct_cas' ||
      configuration.mode === 'direct_cas' ||
      configuration.authorizationMode === 'direct_cas' ||
      configuration.directLoginAvailable === true,
    );
  }

  function hasRequiredDirectCasSafeguards(connector = {}) {
    const safeguards = connector.safeguards || {};
    return (
      safeguards.acceptsPasswordFromBrowser === true &&
      safeguards.acceptsCookieFromBrowser === false &&
      safeguards.storesPassword === false &&
      safeguards.sessionCookiesEncryptedAtRest === true
    );
  }

  function isSafeDirectLoginContext() {
    return (
      window.isSecureContext ||
      ['localhost', '127.0.0.1', '::1'].includes(String(window.location.hostname).toLowerCase())
    );
  }

  function setDirectLoginStatus(message = '', state = '') {
    if (!elements.loginStatus) return;
    elements.loginStatus.textContent = message;
    elements.loginStatus.dataset.state = state;
  }

  function setDirectLoginLoading(loading) {
    directLoginPending = Boolean(loading);
    [
      elements.loginUsername,
      elements.loginPassword,
      elements.loginConsent,
      elements.loginClose,
      elements.loginCancel,
      elements.loginSubmit,
    ].forEach((element) => {
      if (element) element.disabled = directLoginPending;
    });
    if (elements.loginSubmit) {
      elements.loginSubmit.textContent = directLoginPending ? '正在连接…' : '同意并连接';
    }
  }

  function resetDirectLoginForm() {
    elements.loginForm?.reset();
    if (elements.loginPassword) elements.loginPassword.value = '';
    setDirectLoginStatus('');
    setDirectLoginLoading(false);
  }

  function closeDirectLoginDialog({ abort = true } = {}) {
    if (abort && directLoginAbortController) {
      directLoginAbortController.abort();
      directLoginAbortController = null;
    }
    if (typeof elements.loginDialog?.close === 'function' && elements.loginDialog.open) {
      elements.loginDialog.close();
      return;
    }
    elements.loginDialog?.removeAttribute('open');
    resetDirectLoginForm();
  }

  function openDirectLoginDialog() {
    if (!elements.loginDialog || !elements.loginForm) {
      setMessage('直接连接界面未正确加载，请刷新页面后重试。', 'failed');
      return;
    }
    if (!hasRequiredDirectCasSafeguards(currentConnector)) {
      setMessage('直接连接安全配置未通过检查，页面不会提交清华凭据。', 'failed');
      return;
    }

    if (!isSafeDirectLoginContext()) {
      setMessage('为保护清华密码，直接连接只能在 HTTPS 或本机开发地址中使用。', 'failed');
      return;
    }
    resetDirectLoginForm();
    if (typeof elements.loginDialog.showModal === 'function') {
      elements.loginDialog.showModal();
    } else {
      elements.loginDialog.setAttribute('open', '');
    }
    window.setTimeout(() => elements.loginUsername?.focus(), 0);
  }

  function setLoading() {
    hideCredentialExpiry();
    elements.state.dataset.state = 'loading';
    elements.state.textContent = '正在检查';
    elements.title.textContent = '读取校内连接状态';
    elements.description.textContent = '正在确认部署环境是否已经配置校方批准的授权入口。';
    elements.lastSync.textContent = '尚无真实同步记录';
    elements.connect.disabled = true;
    elements.sync.disabled = true;
    elements.disconnect.disabled = true;
  }

  function renderLoggedOut() {
    closeDirectLoginDialog();
    hideCredentialExpiry();
    elements.state.dataset.state = 'idle';
    elements.state.textContent = '登录后可用';
    elements.title.textContent = '先登录 FREE BBS';
    elements.description.textContent =
      '连接状态按 FREE BBS 用户隔离。登录后才能发起授权、同步或解除连接。';
    elements.lastSync.textContent = '尚未读取个人连接状态';
    elements.connect.disabled = true;
    elements.sync.disabled = true;
    elements.disconnect.disabled = true;
    setMessage('');
  }

  function renderStatus(connector) {
    currentConnector = connector || null;
    const configuration = connector?.configuration || {};
    const connection = connector?.connection || {};
    const sync = connector?.sync || {};
    const directCas = isDirectCasConfiguration(configuration);
    const directCasSafeguardsReady = !directCas || hasRequiredDirectCasSafeguards(connector);
    const connected = ['active_unverified', 'active_verified'].includes(connection.status);
    const partialRun = sync.latestRun?.status === 'partial' ? sync.latestRun : null;
    const needsAuthorization = connection.status === 'reauthorization_required';
    const revoked = connection.status === 'revoked';
    const activeRun = ['queued', 'running'].includes(sync.latestRun?.status)
      ? sync.latestRun
      : null;

    if (configuration.state === 'not_configured') {
      elements.state.dataset.state = 'waiting';
      elements.state.textContent = '尚未配置';
      elements.title.textContent = '等待校方授权接入';
      elements.description.textContent =
        '校方授权接入尚未配置。目前只能验证公开页面和登录边界，不能读取你的课程、公告或作业。';
    } else if (configuration.state === 'misconfigured') {
      elements.state.dataset.state = 'error';
      elements.state.textContent = '配置异常';
      elements.title.textContent = '授权服务暂不可用';
      elements.description.textContent = '授权服务配置不完整，系统不会生成或猜测清华登录地址。';
    } else if (configuration.state === 'development_mock') {
      elements.state.dataset.state = 'warning';
      elements.state.textContent = '开发模拟';
      elements.title.textContent = '未连接真实清华账号';
      elements.description.textContent =
        '开发模拟模式只用于验证状态机，结果不能作为真实抓取验收证据。';
    } else if (directCas && !directCasSafeguardsReady) {
      elements.state.dataset.state = 'error';
      elements.state.textContent = '安全检查未通过';
      elements.title.textContent = '直接连接安全配置不完整';
      elements.description.textContent =
        '仅当密码不持久化、浏览器不提交 Cookie 且会话 Cookie 在服务端加密保存时，页面才允许直接连接。';
    } else if (connected) {
      if (partialRun) {
        elements.state.dataset.state = 'warning';
        elements.state.textContent = '部分完成';
        elements.title.textContent = '真实数据已部分同步';
        elements.description.textContent = `${describeResultCounts(
          partialRun.resultCounts,
        )}。已导入的数据可以正常使用；部分记录仍需适配，可重试同步。`;
      } else if (directCas) {
        elements.state.dataset.state = 'connected';
        elements.state.textContent = connection.status === 'active_verified' ? '已验证' : '已连接';
        elements.title.textContent =
          connection.status === 'active_verified' ? '网络学堂同步已验证' : '等待首次真实同步';
        elements.description.textContent =
          connection.status === 'active_verified'
            ? '直接 CAS 会话已连接。密码未持久化；网络学堂会话 Cookie 只以服务端加密凭据保存。'
            : '直接 CAS 会话已连接，密码未持久化；首次真实同步尚未完成。';
      } else {
        elements.state.dataset.state = 'connected';
        elements.state.textContent = connection.status === 'active_verified' ? '已验证' : '已连接';
        elements.title.textContent =
          connection.status === 'active_verified' ? '网络学堂同步已验证' : '等待首次真实同步';
        elements.description.textContent =
          connection.status === 'active_verified'
            ? '正式授权已连接。同步只通过服务端授权通道读取批准范围内的数据。'
            : '正式授权已连接；首次真实同步尚未完成。';
      }
    } else if (needsAuthorization) {
      elements.state.dataset.state = 'warning';
      elements.state.textContent = '需要重连';
      elements.title.textContent = '清华授权已失效';
      elements.description.textContent =
        '请重新连接。已有导入数据会保留，但在重新授权前不会继续同步。';
    } else if (directCas) {
      elements.state.dataset.state = 'idle';
      elements.state.textContent = '可直接连接';
      elements.title.textContent = '直接登录清华账号';
      elements.description.textContent =
        '明确同意后，账号和密码仅用于本次统一认证请求，密码不会持久化；登录成功后的网络学堂会话 Cookie 只在服务端加密保存。';
    } else {
      elements.state.dataset.state = 'idle';
      elements.state.textContent = revoked ? '已解除' : '未连接';
      elements.title.textContent = '尚未连接网络学堂';
      elements.description.textContent =
        '正式授权模式下，清华密码只在校方统一身份认证页面输入，FREE BBS 不接收密码或浏览器 Cookie。';
    }

    renderCredentialExpiry(connection, connected);

    const latestAttemptAt = sync.latestRun?.finishedAt || sync.latestRun?.createdAt;
    if (partialRun && latestAttemptAt) {
      elements.lastSync.textContent = `最近同步尝试：${formatTime(latestAttemptAt)}（部分完成）`;
    } else if (connection.lastSuccessfulSyncAt) {
      elements.lastSync.textContent = `最近真实同步：${formatTime(
        connection.lastSuccessfulSyncAt,
      )}`;
    } else if (latestAttemptAt) {
      elements.lastSync.textContent = `最近同步尝试：${formatTime(latestAttemptAt)}`;
    } else {
      elements.lastSync.textContent = '尚无真实同步记录';
    }
    elements.connect.textContent = directCas
      ? needsAuthorization || connected
        ? '重新直接连接'
        : '直接连接'
      : needsAuthorization || connected
        ? '重新连接'
        : '连接网络学堂';
    elements.connect.disabled = directCas
      ? !directCasSafeguardsReady ||
        ['not_configured', 'misconfigured', 'development_mock'].includes(configuration.state) ||
        configuration.directLoginAvailable === false
      : !configuration.authorizationAvailable;
    elements.sync.textContent = partialRun ? '重试未完成部分' : '立即同步';
    elements.sync.disabled = !sync.available || Boolean(activeRun);
    elements.disconnect.disabled = !(connected || needsAuthorization);

    if (connector?.authorization?.pending) {
      setMessage(
        directCas
          ? '正在完成本次清华统一身份认证。密码不会持久化；认证成功后的会话 Cookie 在服务端加密保存。'
          : '正在等待清华认证结果。正式授权模式不接收清华密码或浏览器 Cookie。',
      );
    } else if (sync.latestRun) {
      const run = sync.latestRun;
      const labels = {
        queued: '同步任务已排队',
        running: '正在同步',
        succeeded: '最近同步成功',
        partial: '最近同步部分完成',
        failed: '最近同步失败',
        cancelled: '最近同步已取消',
      };
      let message = labels[run.status] || '同步状态未知';
      if (run.status === 'failed') {
        message = syncFailureMessage(run.errorCode);
      } else if (run.status === 'partial') {
        message = partialSyncMessage(run);
      }
      setMessage(message, run.status);
    } else {
      setMessage('');
    }

    if (activeRun && sync.available && !pollTimer) {
      pollTimer = window.setTimeout(() => pollRun(activeRun.publicId), 2000);
    }
  }

  async function loadStatus() {
    window.clearTimeout(pollTimer);
    pollTimer = null;
    clearCredentialExpiryTimer();
    requestVersion += 1;
    const version = requestVersion;
    if (!isLoggedIn()) {
      renderLoggedOut();
      return;
    }
    setLoading();
    try {
      const payload = await app.callApi('/workbench/connectors/tsinghua/status', {
        method: 'GET',
      });
      if (version !== requestVersion) return;
      renderStatus(payload.connector);
      maybeAutoSync(payload.connector);
    } catch (error) {
      if (version !== requestVersion) return;
      currentConnector = null;
      hideCredentialExpiry();
      elements.state.dataset.state = 'error';
      elements.state.textContent = '读取失败';
      elements.title.textContent = '暂时无法读取连接状态';
      elements.description.textContent = error.message || '请稍后重试。';
      elements.connect.disabled = true;
      elements.sync.disabled = true;
      elements.disconnect.disabled = true;
    }
  }

  async function maybeAutoSync(connector) {
    if (autoSyncRequested || !isLoggedIn() || !connector?.sync?.available) return;
    const latestRun = connector.sync.latestRun;
    if (['queued', 'running'].includes(latestRun?.status)) return;

    const lastSuccessfulAt = Date.parse(connector.connection?.lastSuccessfulSyncAt || '');
    const intervalSeconds = Math.max(60, Number(connector.sync.minimumIntervalSeconds) || 300);
    const stale =
      !Number.isFinite(lastSuccessfulAt) || Date.now() - lastSuccessfulAt >= intervalSeconds * 1000;
    if (!stale) return;

    autoSyncRequested = true;
    await syncNow({ automatic: true });
  }

  async function connect() {
    if (!isLoggedIn()) return;
    if (isDirectCasConfiguration(currentConnector?.configuration)) {
      if (!hasRequiredDirectCasSafeguards(currentConnector)) {
        setMessage('直接连接安全配置未通过检查，页面不会提交清华凭据。', 'failed');
        return;
      }
      openDirectLoginDialog();
      return;
    }
    elements.connect.disabled = true;
    setMessage('正在创建一次性授权会话…');
    try {
      const attempt = await app.callApi('/workbench/connectors/tsinghua/authorization-attempts', {
        method: 'POST',
      });
      const destination = new URL(attempt.authorizationUrl);
      if (
        destination.protocol !== 'https:' ||
        destination.username ||
        destination.password ||
        destination.hash
      ) {
        throw new Error('授权服务返回了无效地址');
      }
      window.location.assign(destination.toString());
    } catch (error) {
      setMessage(error.message || '无法启动清华授权。', 'failed');
      await loadStatus();
    }
  }

  async function submitDirectLogin(event) {
    event.preventDefault();
    if (directLoginPending || !isLoggedIn() || !elements.loginForm) return;
    if (
      !isDirectCasConfiguration(currentConnector?.configuration) ||
      !hasRequiredDirectCasSafeguards(currentConnector)
    ) {
      setDirectLoginStatus('直接连接安全配置未通过检查，页面不会提交清华凭据。', 'failed');
      return;
    }

    if (!elements.loginForm.reportValidity()) return;

    const username = String(elements.loginUsername?.value || '').trim();
    let password = String(elements.loginPassword?.value || '');
    let fingerprint = '';
    if (!username || !password || !elements.loginConsent?.checked) {
      setDirectLoginStatus('请填写账号和密码，并勾选同意后再连接。', 'failed');
      return;
    }

    const requestController = new AbortController();
    directLoginAbortController = requestController;
    setDirectLoginLoading(true);
    setDirectLoginStatus('正在生成本次认证所需的一次性兼容设备指纹…', 'loading');

    try {
      try {
        const fingerprintGenerator = window.TsinghuaCasFingerprint;
        if (!fingerprintGenerator || typeof fingerprintGenerator.generate !== 'function') {
          throw new Error('CAS fingerprint generator is unavailable');
        }
        fingerprint = await fingerprintGenerator.generate();
        if (!/^[0-9a-f]{32}$/.test(fingerprint)) {
          throw new Error('CAS fingerprint is invalid');
        }
      } catch {
        setDirectLoginStatus('无法生成本次认证所需的设备指纹，账号和密码未提交。', 'failed');
        return;
      }

      setDirectLoginStatus('正在提交至清华统一身份认证，请稍候…', 'loading');
      const loginRequest = app.callApi('/workbench/connectors/tsinghua/direct-login', {
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ username, password, fingerprint, consent: true }),
        signal: requestController.signal,
      });
      if (elements.loginPassword) elements.loginPassword.value = '';
      password = '';

      await loginRequest;
      setMessage('清华账号已连接；密码已从页面清除，会话 Cookie 已在服务端加密保存。', 'succeeded');
      closeDirectLoginDialog({ abort: false });
      autoSyncRequested = false;
      await loadStatus();
      window.dispatchEvent(new CustomEvent('freebbs:workbench-refresh'));
    } catch (error) {
      password = '';
      if (elements.loginPassword) elements.loginPassword.value = '';
      if (error?.name === 'AbortError') return;
      setDirectLoginStatus(directLoginFailureMessage(error), 'failed');
      window.setTimeout(() => elements.loginPassword?.focus(), 0);
    } finally {
      password = '';
      fingerprint = '';
      if (directLoginAbortController === requestController) {
        directLoginAbortController = null;
      }
      setDirectLoginLoading(false);
      if (elements.loginPassword) elements.loginPassword.value = '';
    }
  }

  async function pollRun(publicId, attempts = 0) {
    if (!isLoggedIn() || attempts >= 60) {
      await loadStatus();
      return;
    }
    try {
      const payload = await app.callApi(
        `/workbench/connectors/tsinghua/sync-runs/${encodeURIComponent(publicId)}`,
        { method: 'GET' },
      );
      const { run } = payload;
      if (['succeeded', 'partial', 'failed', 'cancelled'].includes(run.status)) {
        await loadStatus();
        window.dispatchEvent(new CustomEvent('freebbs:workbench-refresh'));
        return;
      }
      setMessage(run.status === 'running' ? '正在同步网络学堂…' : '同步任务已排队…');
      pollTimer = window.setTimeout(() => pollRun(publicId, attempts + 1), 2000);
    } catch (error) {
      if (attempts < 59) {
        setMessage(`${error.message || '读取同步进度失败。'} 正在重试…`, 'failed');
        pollTimer = window.setTimeout(() => pollRun(publicId, attempts + 1), 3000);
        return;
      }
      pollTimer = null;
      setMessage('多次读取同步进度失败；任务可能仍在后台运行，请稍后刷新页面。', 'failed');
    }
  }

  async function syncNow({ automatic = false } = {}) {
    elements.sync.disabled = true;
    setMessage(automatic ? '通知数据已过期，正在自动同步…' : '正在创建同步任务…');
    try {
      const payload = await app.callApi('/workbench/connectors/tsinghua/sync-runs', {
        method: 'POST',
      });
      setMessage('同步任务已排队…');
      await pollRun(payload.run.publicId);
    } catch (error) {
      setMessage(error.message || '无法启动同步。', 'failed');
      await loadStatus();
    }
  }

  async function disconnect() {
    // eslint-disable-next-line no-alert
    if (!window.confirm('解除连接后将停止同步；已经导入的工作台数据会保留。确定继续吗？')) {
      return;
    }
    elements.disconnect.disabled = true;
    setMessage('正在解除连接…');
    try {
      await app.callApi('/workbench/connectors/tsinghua/connection', { method: 'DELETE' });
      setMessage('连接已解除，已有导入数据已保留。', 'succeeded');
      autoSyncRequested = false;
      await loadStatus();
    } catch (error) {
      setMessage(error.message || '解除连接失败。', 'failed');
      await loadStatus();
    }
  }

  function consumeCallbackResult() {
    const url = new URL(window.location.href);
    if (url.searchParams.get('connector') !== 'tsinghua') return;
    const result = url.searchParams.get('result');
    const messages = {
      connected: '清华授权已连接；现在可以进行首次真实同步。',
      authorization_denied: '你取消了清华授权，未保存任何连接凭据。',
      authorization_state_invalid: '授权会话无效、已过期或已经使用，请重新连接。',
      authorization_failed: '清华授权未能完成，请重新连接。',
    };
    setMessage(
      messages[result] || '授权流程已经结束。',
      result === 'connected' ? 'succeeded' : 'failed',
    );
    url.searchParams.delete('connector');
    url.searchParams.delete('result');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }

  elements.connect.addEventListener('click', connect);
  elements.sync.addEventListener('click', syncNow);
  elements.disconnect.addEventListener('click', disconnect);
  elements.loginForm?.addEventListener('submit', submitDirectLogin);
  elements.loginClose?.addEventListener('click', () => closeDirectLoginDialog());
  elements.loginCancel?.addEventListener('click', () => closeDirectLoginDialog());
  elements.loginDialog?.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeDirectLoginDialog();
  });
  elements.loginDialog?.addEventListener('click', (event) => {
    if (event.target === elements.loginDialog && !directLoginPending) {
      closeDirectLoginDialog();
    }
  });
  elements.loginDialog?.addEventListener('close', resetDirectLoginForm);

  function syncSession() {
    const ownerKey = getOwnerKey();
    if (ownerKey === observedOwnerKey) return;
    closeDirectLoginDialog();
    autoSyncRequested = false;
    observedOwnerKey = ownerKey;
    loadStatus();
  }

  const authObserver = new MutationObserver(syncSession);
  authObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  Promise.resolve(app.sessionReady)
    .catch(() => {})
    .finally(() => {
      consumeCallbackResult();
      syncSession();
    });
})();
