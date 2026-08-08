const crypto = require('crypto');
const { CampusConnectorError } = require('./errors');
const {
  attachDirectCasStage,
  createDirectCasError,
  isDirectCasErrorCode,
  readDirectCasStage,
} = require('./direct-cas-diagnostics');

const CONNECTOR_ID = 'tsinghua';
const PROVIDER = 'tsinghua-learn';
const BROWSER_BINDING_CONTEXT = `${PROVIDER}:authorization-browser`;
const STATE_BYTES = 32;
const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const DIRECT_GRANT_MAX_AGE_MS = 8 * 60 * 60 * 1_000;
const ACTIVE_CONNECTION_STATES = new Set(['active_unverified', 'active_verified']);
const SAFE_RESULT_CODES = new Set([
  'connected',
  'authorization_denied',
  'authorization_failed',
  'authorization_state_invalid',
]);

function generatePublicId(prefix, randomBytes = crypto.randomBytes) {
  return `${prefix}_${randomBytes(12).toString('hex')}`;
}

function hashState(state) {
  return crypto.createHash('sha256').update(state, 'utf8').digest();
}

function normalizeState(value) {
  const state = String(value || '').trim();
  return STATE_PATTERN.test(state) ? state : '';
}

function deriveBrowserBinding(vault, state) {
  const fingerprint = vault.fingerprint(state, { connectorId: BROWSER_BINDING_CONTEXT });
  return Buffer.from(fingerprint).toString('base64url');
}

function browserBindingMatches(vault, state, value) {
  const binding = normalizeState(value);
  if (!vault || !binding) return false;

  try {
    const expected = Buffer.from(deriveBrowserBinding(vault, state), 'utf8');
    const supplied = Buffer.from(binding, 'utf8');
    return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
  } catch {
    return false;
  }
}

function normalizeReturnPath(value) {
  const path = String(value || '/workbench').trim();
  if (path === '/workbench' || path.startsWith('/workbench?')) {
    try {
      const parsed = new URL(path, 'https://free-bbs.local');
      if (parsed.origin === 'https://free-bbs.local' && parsed.pathname === '/workbench') {
        return `${parsed.pathname}${parsed.search}`;
      }
    } catch {
      return '/workbench';
    }
  }
  return '/workbench';
}

function validateAuthorizationUrl(value, allowedOrigins = []) {
  const rawValue = String(value || '').trim();
  if (!rawValue || rawValue.length > 2048) {
    throw new CampusConnectorError(
      'connector_authorization_response_invalid',
      '授权服务返回了无效地址',
      { status: 502 },
    );
  }

  let parsed;
  try {
    parsed = new URL(rawValue);
  } catch {
    throw new CampusConnectorError(
      'connector_authorization_response_invalid',
      '授权服务返回了无效地址',
      { status: 502 },
    );
  }

  const normalizedOrigins = (Array.isArray(allowedOrigins) ? allowedOrigins : [])
    .map((origin) => new URL(origin).origin)
    .filter(Boolean);
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    !normalizedOrigins.includes(parsed.origin)
  ) {
    throw new CampusConnectorError(
      'connector_authorization_response_invalid',
      '授权服务返回了未批准的地址',
      { status: 502 },
    );
  }

  return parsed.toString();
}

function safeDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIso(value) {
  return safeDate(value)?.toISOString() || null;
}

function publicSyncDiagnostics(value) {
  const normalizeEntries = (entries) =>
    (Array.isArray(entries) ? entries : [])
      .slice(0, 64)
      .map((entry) => {
        const resource = String(entry?.resource || '').trim();
        const code = String(entry?.code || '').trim();
        const count = Number(entry?.count);
        if (
          !/^[a-z][a-z0-9:_-]{0,63}$/u.test(resource) ||
          !/^[a-z][a-z0-9:_-]{0,63}$/u.test(code) ||
          !Number.isSafeInteger(count) ||
          count < 1
        ) {
          return null;
        }
        return { resource, code, count };
      })
      .filter(Boolean);

  return {
    warnings: normalizeEntries(value?.warnings),
    errors: normalizeEntries(value?.errors),
  };
}

function safeScopes(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || '').trim()))]
    .filter((item) => item && item.length <= 64)
    .slice(0, 32);
}

function directAuthorizationError(error) {
  const code = String(error?.code || '');
  if (isDirectCasErrorCode(code)) {
    return createDirectCasError(code, readDirectCasStage(error) || undefined);
  }
  const errors = {
    cas_credentials_invalid: {
      status: 400,
      message: '请输入有效的清华账号和密码。',
    },
    cas_credentials_rejected: {
      status: 401,
      message: '清华账号或密码不正确。',
    },
    cas_dependency_unavailable: {
      status: 503,
      message: '清华登录加密组件暂时不可用。',
    },
    cas_interactive_verification_required: {
      status: 409,
      message: '本次登录需要在清华认证页面完成验证码或二次验证。',
    },
    cas_login_unverified: {
      status: 401,
      message: '清华会话未通过网络学堂私有接口验证。',
    },
    cas_network_error: {
      status: 502,
      message: '清华登录服务暂时不可用。',
    },
    cas_configuration_invalid: {
      status: 500,
      message: '清华认证客户端配置无效。',
    },
    cas_redirect_blocked: {
      status: 502,
      message: '清华认证跳转被安全策略阻止。',
    },
    cas_redirect_limit: {
      status: 502,
      message: '清华认证跳转次数异常。',
    },
    cas_response_too_large: {
      status: 502,
      message: '清华认证响应超过安全上限。',
    },
    cas_schema_changed: {
      status: 502,
      message: '清华认证页面结构已变化，请稍后重试。',
    },
    cas_target_blocked: {
      status: 502,
      message: '清华认证目标被安全策略阻止。',
    },
    cas_upstream_rejected: {
      status: 502,
      message: '清华认证服务未接受本次请求。',
    },
    cas_timeout: {
      status: 504,
      message: '访问清华登录服务超时。',
    },
    invalid_credentials: {
      status: 401,
      message: '清华账号或密码不正确。',
    },
    interactive_verification_required: {
      status: 409,
      message: '本次登录需要在清华认证页面完成验证码或二次验证。',
    },
    upstream_rate_limited: {
      status: 429,
      message: '清华登录尝试过于频繁，请稍后再试。',
    },
    upstream_timeout: {
      status: 504,
      message: '访问清华登录服务超时。',
    },
    upstream_unavailable: {
      status: 502,
      message: '清华登录服务暂时不可用。',
    },
  };
  const safe = errors[code] || {
    status: 502,
    message: '本次清华登录未能完成。',
  };
  const safeCode = Object.hasOwn(errors, code) ? code : 'direct_authorization_failed';
  const defaultStage = [
    'invalid_credentials',
    'interactive_verification_required',
    'upstream_rate_limited',
  ].includes(safeCode)
    ? 'credential_submit'
    : 'internal';
  const mapped = new CampusConnectorError(safeCode, safe.message, { status: safe.status });
  return attachDirectCasStage(mapped, readDirectCasStage(error), defaultStage);
}

function resolveAvailability(runtimeConfig, adapter) {
  const configuredState = runtimeConfig?.state || 'not_configured';
  const configuredAdapterId = runtimeConfig?.adapterId || '';
  const adapterIdentityMatches = Boolean(
    adapter && configuredAdapterId && adapter.id === configuredAdapterId,
  );
  const redirectAdapterReady = Boolean(
    adapterIdentityMatches &&
    typeof adapter.beginAuthorization === 'function' &&
    typeof adapter.completeAuthorization === 'function',
  );
  const directAdapterReady = Boolean(
    adapterIdentityMatches && typeof adapter.authenticateDirect === 'function',
  );

  if (configuredState === 'not_configured') {
    return {
      state: 'not_configured',
      authorizationAvailable: false,
      authorizationKind: 'none',
    };
  }
  if (configuredState === 'direct_cas') {
    return {
      state: directAdapterReady ? 'direct_cas' : 'misconfigured',
      authorizationAvailable: directAdapterReady,
      authorizationKind: directAdapterReady ? 'direct_credentials' : 'none',
    };
  }
  if (configuredState === 'development_mock') {
    return {
      state: redirectAdapterReady ? 'development_mock' : 'misconfigured',
      authorizationAvailable: redirectAdapterReady,
      authorizationKind: redirectAdapterReady ? 'redirect' : 'none',
    };
  }
  if (configuredState !== 'ready' || !redirectAdapterReady) {
    return {
      state: 'misconfigured',
      authorizationAvailable: false,
      authorizationKind: 'none',
    };
  }
  return { state: 'ready', authorizationAvailable: true, authorizationKind: 'redirect' };
}

function configurationError(availability) {
  if (availability.state === 'not_configured') {
    return new CampusConnectorError(
      'tsinghua_authorization_not_configured',
      '校方授权接入尚未配置。目前只能验证公开页面和登录边界，不能读取你的课程、公告或作业。',
      { status: 503 },
    );
  }
  return new CampusConnectorError(
    'tsinghua_authorization_misconfigured',
    '校内授权服务配置不完整，请联系管理员。',
    { status: 503 },
  );
}

function createCampusConnectorBroker({
  store,
  vault,
  adapter = null,
  runtimeConfig,
  syncDispatcher = null,
  now = () => new Date(),
  randomBytes = crypto.randomBytes,
}) {
  if (!store) throw new TypeError('store is required');

  const availability = () => {
    let runtime = resolveAvailability(runtimeConfig, adapter);
    if (runtime.authorizationAvailable && !vault) {
      runtime = {
        state: 'misconfigured',
        authorizationAvailable: false,
        authorizationKind: 'none',
      };
    }

    return {
      ...runtime,
      syncAvailable: Boolean(
        runtime.authorizationAvailable && typeof syncDispatcher?.enqueue === 'function',
      ),
    };
  };
  function connectionCredentialExpired(connection, currentTime) {
    const expiresAt = safeDate(connection?.credential_expires_at);
    return Boolean(
      connection &&
      ACTIVE_CONNECTION_STATES.has(connection.status) &&
      expiresAt &&
      expiresAt <= currentTime,
    );
  }

  async function expireConnectionIfNeeded(userId, connection, currentTime) {
    if (!connectionCredentialExpired(connection, currentTime)) return false;
    if (typeof store.expireConnection !== 'function') {
      throw new CampusConnectorError(
        'connector_state_store_unavailable',
        '清华连接状态暂时无法安全更新，请稍后重试。',
        { status: 503 },
      );
    }
    await store.expireConnection({
      userId,
      provider: PROVIDER,
      expectedGeneration: Number(connection.generation),
      expiredAt: currentTime,
    });
    return true;
  }

  async function getStatus(userId, expirationChecked = false) {
    const currentTime = now();
    const [connection, pendingAuthorization, latestRun] = await Promise.all([
      store.getConnection(userId, PROVIDER),
      store.getPendingAuthorizationFlow(userId, PROVIDER, currentTime),
      store.getLatestSyncRun(userId, PROVIDER),
    ]);
    if (!expirationChecked && (await expireConnectionIfNeeded(userId, connection, currentTime))) {
      return getStatus(userId, true);
    }

    const runtime = availability();
    let connectionStatus = connection?.status || 'not_connected';
    const credentialExpiresAt = safeDate(connection?.credential_expires_at);
    if (
      ACTIVE_CONNECTION_STATES.has(connectionStatus) &&
      credentialExpiresAt &&
      credentialExpiresAt <= currentTime
    ) {
      connectionStatus = 'reauthorization_required';
    }

    return {
      id: CONNECTOR_ID,
      configuration: {
        state: runtime.state,
        authorizationAvailable: runtime.authorizationAvailable,
        authorizationKind: runtime.authorizationKind,
        developmentMock: runtime.state === 'development_mock',
      },
      connection: {
        status: connectionStatus,
        connectedAt: toIso(connection?.connected_at),
        credentialExpiresAt: toIso(connection?.credential_expires_at),
        lastSuccessfulSyncAt: toIso(connection?.last_successful_sync_at),
        lastErrorCode: connection?.last_error_code || null,
      },
      authorization: {
        pending: Boolean(pendingAuthorization),
        expiresAt: toIso(pendingAuthorization?.expires_at),
      },
      sync: {
        available: Boolean(runtime.syncAvailable && ACTIVE_CONNECTION_STATES.has(connectionStatus)),
        minimumIntervalSeconds: runtimeConfig.syncIntervalSeconds,
        latestRun: latestRun
          ? {
              publicId: latestRun.public_id,
              status: latestRun.status,
              createdAt: toIso(latestRun.created_at),
              finishedAt: toIso(latestRun.finished_at),
              resultCounts: latestRun.result_counts || null,
              errorCode: latestRun.error_code || null,
              diagnostics: publicSyncDiagnostics(latestRun.error_context),
            }
          : null,
      },
      capabilities: {
        learn: ['semesters', 'courses', 'course_notices', 'homework'],
        info: ['authentication_boundary_probe'],
      },
      safeguards: {
        acceptsPasswordFromBrowser: runtime.authorizationKind === 'direct_credentials',
        acceptsCookieFromBrowser: false,
        storesPassword: false,
        storesRawPages: false,
        oneTimeAuthorizationState: runtime.authorizationKind === 'redirect',
        sessionCookiesEncryptedAtRest: Boolean(vault),
      },
    };
  }

  async function beginAuthorization({ userId, returnPath = '/workbench' }) {
    const runtime = availability();
    if (!runtime.authorizationAvailable) {
      throw configurationError(runtime);
    }
    if (runtime.authorizationKind !== 'redirect') {
      throw new CampusConnectorError(
        'connector_authorization_method_not_available',
        '请使用 FREE BBS 工作台的账号连接对话框。',
        { status: 409 },
      );
    }
    if (!vault) {
      throw new CampusConnectorError(
        'tsinghua_authorization_misconfigured',
        '校内授权凭据保险箱尚未配置。',
        { status: 503 },
      );
    }

    const issuedAt = now();
    const ttlSeconds = runtimeConfig.authorizationTtlSeconds || 600;
    const expiresAt = new Date(issuedAt.getTime() + ttlSeconds * 1000);
    const state = randomBytes(STATE_BYTES).toString('base64url');
    const stateHash = hashState(state);
    const browserBinding = deriveBrowserBinding(vault, state);
    const adapterVersion = String(adapter.version || '1').slice(0, 32);
    let attempt;

    try {
      attempt = await adapter.beginAuthorization({
        state,
        callbackUrl: runtimeConfig.callbackUrl,
        expiresAt,
      });
    } catch (error) {
      throw new CampusConnectorError(
        'connector_authorization_start_failed',
        '暂时无法启动清华授权，请稍后重试。',
        { status: 502, cause: error },
      );
    }

    const authorizationUrl = validateAuthorizationUrl(
      attempt?.authorizationUrl,
      adapter.allowedAuthorizationOrigins,
    );
    const flowSecret = String(attempt?.flowSecret || '');
    const encryptedFlowSecret = flowSecret
      ? vault.encrypt(flowSecret, { userId, connectorId: PROVIDER, adapterVersion })
      : null;

    await store.replaceAuthorizationFlow({
      publicId: generatePublicId('caf', randomBytes),
      stateHash,
      userId,
      provider: PROVIDER,
      adapterId: adapter.id,
      adapterVersion,
      encryptedFlowSecret,
      status: 'redirect_issued',
      returnPath: normalizeReturnPath(returnPath),
      expiresAt,
      createdAt: issuedAt,
    });

    return { authorizationUrl, browserBinding, expiresAt: expiresAt.toISOString() };
  }

  async function completeAuthorization({ state: rawState, browserBinding, callbackParams = {} }) {
    const state = normalizeState(rawState);
    if (!state) {
      throw new CampusConnectorError(
        'authorization_state_invalid',
        '授权状态无效或已过期，请重新连接。',
        { status: 400 },
      );
    }

    const claimedAt = now();
    const stateHash = hashState(state);
    const flow = await store.claimAuthorizationFlow(stateHash, PROVIDER, claimedAt);
    if (!flow) {
      throw new CampusConnectorError(
        'authorization_state_invalid',
        '授权状态无效或已使用，请重新连接。',
        { status: 400 },
      );
    }

    if (!browserBindingMatches(vault, state, browserBinding)) {
      await store.failAuthorizationFlow(stateHash, 'authorization_browser_mismatch', claimedAt);
      throw new CampusConnectorError(
        'authorization_state_invalid',
        '授权状态无效或已使用，请重新连接。',
        { status: 400 },
      );
    }

    if (callbackParams.error) {
      await store.failAuthorizationFlow(stateHash, 'authorization_denied', claimedAt);
      return {
        returnPath: normalizeReturnPath(flow.return_path),
        result: 'authorization_denied',
      };
    }

    const runtime = availability();
    if (!runtime.authorizationAvailable || adapter.id !== flow.adapter_id) {
      await store.failAuthorizationFlow(stateHash, 'authorization_adapter_unavailable', claimedAt);
      throw configurationError(runtime);
    }

    const adapterVersion = String(flow.adapter_version || adapter.version || '1');
    let flowSecret = '';
    if (flow.flow_secret_ciphertext) {
      flowSecret = vault.decrypt(
        {
          ciphertext: flow.flow_secret_ciphertext,
          iv: flow.flow_secret_iv,
          authTag: flow.flow_secret_auth_tag,
        },
        { userId: flow.user_id, connectorId: PROVIDER, adapterVersion },
      );
    }

    let grant;
    try {
      grant = await adapter.completeAuthorization({
        callbackParams,
        callbackUrl: runtimeConfig.callbackUrl,
        flowSecret,
      });
    } catch (error) {
      await store.failAuthorizationFlow(stateHash, 'authorization_exchange_failed', claimedAt);
      throw new CampusConnectorError('authorization_failed', '清华授权未能完成，请重新连接。', {
        status: 502,
        cause: error,
      });
    }

    const subject = String(grant?.subject || '').trim();
    const opaqueGrant = String(grant?.opaqueGrant || '');
    if (!subject || subject.length > 512 || !opaqueGrant || opaqueGrant.length > 65_536) {
      await store.failAuthorizationFlow(stateHash, 'authorization_response_invalid', claimedAt);
      throw new CampusConnectorError('authorization_failed', '清华授权返回无效，请重新连接。', {
        status: 502,
      });
    }

    const encryptedGrant = vault.encrypt(opaqueGrant, {
      userId: flow.user_id,
      connectorId: PROVIDER,
      adapterVersion,
    });
    const identityFingerprint = vault.fingerprint(subject, { connectorId: PROVIDER });
    const expiresAt = safeDate(grant.expiresAt);
    if (grant.expiresAt && (!expiresAt || expiresAt <= claimedAt)) {
      await store.failAuthorizationFlow(stateHash, 'authorization_response_invalid', claimedAt);
      throw new CampusConnectorError('authorization_failed', '清华授权返回无效，请重新连接。', {
        status: 502,
      });
    }
    await store.completeAuthorization({
      flow,
      stateHash,
      provider: PROVIDER,
      adapterId: adapter.id,
      adapterVersion,
      identityFingerprint,
      encryptedGrant,
      scopes: safeScopes(grant.scopes),
      credentialType: 'broker_handle',
      credentialExpiresAt: expiresAt,
      completedAt: claimedAt,
    });

    return { returnPath: normalizeReturnPath(flow.return_path), result: 'connected' };
  }

  async function connectDirect({
    userId,
    username: rawUsername,
    password: rawPassword,
    fingerprint: rawFingerprint,
  }) {
    const runtime = availability();
    if (!runtime.authorizationAvailable) {
      throw configurationError(runtime);
    }
    if (runtime.authorizationKind !== 'direct_credentials') {
      throw new CampusConnectorError(
        'connector_authorization_method_not_available',
        '当前连接器配置为跳转授权，不能使用直接登录。',
        { status: 409 },
      );
    }
    if (!vault || typeof store.completeDirectConnection !== 'function') {
      throw new CampusConnectorError(
        'tsinghua_authorization_misconfigured',
        '清华加密会话存储暂不可用。',
        { status: 503 },
      );
    }

    const username = String(rawUsername || '').trim();
    const password = typeof rawPassword === 'string' ? rawPassword : '';
    const fingerprint = typeof rawFingerprint === 'string' ? rawFingerprint : '';
    if (
      !/^[A-Za-z0-9._-]{2,64}$/.test(username) ||
      !password ||
      password.length > 256 ||
      !/^[0-9A-Fa-f]{32}$/.test(fingerprint)
    ) {
      throw attachDirectCasStage(
        new CampusConnectorError(
          'direct_authorization_input_invalid',
          '请输入有效的清华账号和密码。',
          {
            status: 400,
          },
        ),
        'input_validation',
      );
    }

    let grant;
    try {
      grant = await adapter.authenticateDirect({ username, password, fingerprint });
    } catch (error) {
      throw directAuthorizationError(error);
    }

    const subject = String(grant?.subject || '').trim();
    const opaqueGrant = String(grant?.opaqueGrant || '');
    if (!subject || subject.length > 512 || !opaqueGrant || opaqueGrant.length > 65_536) {
      throw attachDirectCasStage(
        new CampusConnectorError(
          'direct_authorization_response_invalid',
          '清华登录返回的会话无效。',
          {
            status: 502,
          },
        ),
        'grant_issue',
      );
    }

    const completedAt = now();
    const adapterVersion = String(adapter.version || '1').slice(0, 32);
    const expiresAt = safeDate(grant.expiresAt);
    const maximumExpiresAt = new Date(completedAt.getTime() + DIRECT_GRANT_MAX_AGE_MS);
    if (!expiresAt || expiresAt <= completedAt || expiresAt > maximumExpiresAt) {
      throw attachDirectCasStage(
        new CampusConnectorError(
          'direct_authorization_response_invalid',
          '清华登录返回的会话已过期。',
          {
            status: 502,
          },
        ),
        'grant_issue',
      );
    }
    const encryptedGrant = vault.encrypt(opaqueGrant, {
      userId,
      connectorId: PROVIDER,
      adapterVersion,
    });
    const identityFingerprint = vault.fingerprint(subject, { connectorId: PROVIDER });

    await store.completeDirectConnection({
      userId,
      provider: PROVIDER,
      adapterId: adapter.id,
      adapterVersion,
      identityFingerprint,
      encryptedGrant,
      scopes: safeScopes(grant.scopes),
      credentialType: 'encrypted_cookie_jar',
      credentialExpiresAt: expiresAt,
      completedAt,
    });

    // The private semester check proves that the encrypted CAS session is valid,
    // but it is not a completed data sync. Only the sync store may promote the
    // connection after a real sync has succeeded.
    return {
      result: 'connected',
      connectionStatus: 'active_unverified',
    };
  }

  async function disconnect(userId) {
    const revokedAt = now();
    const revoked = await store.revokeConnection(userId, PROVIDER, revokedAt);
    if (!revoked || !adapter || typeof adapter.revoke !== 'function' || !vault) {
      return;
    }

    const currentAdapterVersion = String(adapter.version || '1').slice(0, 32);
    if (
      String(revoked.adapter_id || '') !== String(adapter.id || '') ||
      String(revoked.adapter_version || '') !== currentAdapterVersion
    ) {
      return;
    }

    try {
      const opaqueGrant = vault.decrypt(
        {
          ciphertext: revoked.credential_ciphertext,
          iv: revoked.credential_iv,
          authTag: revoked.credential_auth_tag,
        },
        { userId, connectorId: PROVIDER, adapterVersion: currentAdapterVersion },
      );
      await adapter.revoke({ opaqueGrant });
    } catch {
      // The local credential is already destroyed. Remote revocation is best-effort only.
    }
  }

  async function requestSync(userId, semesterId = null) {
    const targetSemesterId = semesterId ? String(semesterId).trim() : null;
    if (targetSemesterId && !/^[A-Za-z0-9._:-]{1,32}$/.test(targetSemesterId)) {
      throw new CampusConnectorError('semester_invalid', '学期标识无效。', { status: 400 });
    }
    const runtime = availability();
    if (!runtime.authorizationAvailable) throw configurationError(runtime);
    if (!syncDispatcher) {
      throw new CampusConnectorError('connector_sync_unavailable', '授权同步执行器尚未配置。', {
        status: 503,
      });
    }

    let connection = await store.getConnection(userId, PROVIDER);
    if (!connection || !ACTIVE_CONNECTION_STATES.has(connection.status)) {
      throw new CampusConnectorError('connector_authorization_required', '请先连接清华账号。', {
        status: 409,
      });
    }

    let checkedAt = now();
    if (await expireConnectionIfNeeded(userId, connection, checkedAt)) {
      connection = await store.getConnection(userId, PROVIDER);
      if (!connection || !ACTIVE_CONNECTION_STATES.has(connection.status)) {
        throw new CampusConnectorError(
          'connector_authorization_required',
          '清华授权已失效，请重新连接。',
          { status: 409 },
        );
      }
      checkedAt = now();
    }

    if (connectionCredentialExpired(connection, checkedAt)) {
      await expireConnectionIfNeeded(userId, connection, checkedAt);
      throw new CampusConnectorError(
        'connector_authorization_required',
        '清华授权已失效，请重新连接。',
        { status: 409 },
      );
    }

    let run;
    try {
      run = await store.createSyncRun({
        publicId: generatePublicId('csr', randomBytes),
        traceId: crypto.randomUUID(),
        connectorId: connection.id,
        connectorGeneration: connection.generation,
        requestedByUserId: userId,
        triggerType: 'manual',
        targetSemesterId,
        createdAt: now(),
      });
    } catch (error) {
      if (error?.code === 'sync_in_progress') {
        throw new CampusConnectorError('sync_in_progress', '已有同步任务正在运行。', {
          status: 409,
        });
      }
      throw error;
    }

    try {
      await syncDispatcher.enqueue(run);
    } catch (error) {
      await store.failSyncRun(run.public_id, 'sync_enqueue_failed', now());
      throw new CampusConnectorError('sync_enqueue_failed', '同步任务暂时无法启动。', {
        status: 503,
        cause: error,
      });
    }

    return {
      publicId: run.public_id,
      traceId: run.trace_id,
      status: run.status,
    };
  }

  async function getSyncRun(userId, publicId) {
    const run = await store.getSyncRun(userId, PROVIDER, publicId);
    if (!run) {
      throw new CampusConnectorError('sync_run_not_found', '同步任务不存在。', {
        status: 404,
      });
    }
    return {
      publicId: run.public_id,
      traceId: run.trace_id,
      status: run.status,
      createdAt: toIso(run.created_at),
      startedAt: toIso(run.started_at),
      finishedAt: toIso(run.finished_at),
      resultCounts: run.result_counts || null,
      errorCode: run.error_code || null,
    };
  }

  return {
    beginAuthorization,
    completeAuthorization,
    connectDirect,
    disconnect,
    getAvailability: availability,
    getStatus,
    getSyncRun,
    requestSync,
  };
}

function safeCallbackResult(value) {
  return SAFE_RESULT_CODES.has(value) ? value : 'authorization_failed';
}

module.exports = {
  CONNECTOR_ID,
  DIRECT_GRANT_MAX_AGE_MS,
  PROVIDER,
  createCampusConnectorBroker,
  generatePublicId,
  hashState,
  normalizeReturnPath,
  normalizeState,
  resolveAvailability,
  safeCallbackResult,
  validateAuthorizationUrl,
};
