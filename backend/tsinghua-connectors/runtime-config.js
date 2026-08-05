const path = require('node:path');
const { decodeVaultKey } = require('./credential-vault');

const CONNECTOR_MODES = new Set(['disabled', 'official', 'direct_cas', 'development_mock']);
const LOCAL_NODE_ENVIRONMENTS = new Set(['development', 'test']);
const DIRECT_CAS_ADAPTER_ID = 'tsinghua_direct_cas';
const ADAPTER_ID_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
const DEFAULT_STATE_TTL_SECONDS = 600;
const DEFAULT_SYNC_INTERVAL_SECONDS = 300;
const MIN_STATE_TTL_SECONDS = 300;
const MAX_STATE_TTL_SECONDS = 900;
const MIN_SYNC_INTERVAL_SECONDS = 60;
const MAX_SYNC_INTERVAL_SECONDS = 3_600;

function readEnvironmentValue(environment, name) {
  return String(environment?.[name] ?? '').trim();
}

function isLoopbackHostname(hostname) {
  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(String(hostname).toLowerCase());
}

function isValidAdapterId(value) {
  return ADAPTER_ID_PATTERN.test(value);
}

function isValidCallbackUrl(value, nodeEnvironment) {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) {
      return false;
    }
    if (url.protocol === 'https:') {
      return true;
    }
    return (
      LOCAL_NODE_ENVIRONMENTS.has(nodeEnvironment) &&
      url.protocol === 'http:' &&
      isLoopbackHostname(url.hostname)
    );
  } catch {
    return false;
  }
}

function isSecureDirectWebEnvironment(value, nodeEnvironment) {
  if (!value) {
    return false;
  }
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) {
      return false;
    }
    if (url.protocol === 'https:') {
      return true;
    }
    return Boolean(
      LOCAL_NODE_ENVIRONMENTS.has(nodeEnvironment) &&
      url.protocol === 'http:' &&
      isLoopbackHostname(url.hostname),
    );
  } catch {
    return false;
  }
}

function isValidEncryptionKey(value) {
  try {
    decodeVaultKey(value);
    return true;
  } catch {
    return false;
  }
}

function containsControlCharacter(value) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 31 || codePoint === 127;
  });
}

function isValidWorkerSocket(value) {
  if (!value || value.length > 4_096 || containsControlCharacter(value)) {
    return false;
  }
  if (!path.posix.isAbsolute(value) || value.endsWith('/')) {
    return false;
  }
  const basename = path.posix.basename(value);
  return basename !== '.' && basename !== '..';
}

function parseBoundedInteger(value, defaultValue, minimum, maximum) {
  const candidate = value || String(defaultValue);
  if (!/^\d+$/.test(candidate)) {
    return null;
  }
  const parsed = Number(candidate);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function safeResult(status, missing = []) {
  return Object.freeze({
    status,
    missing: Object.freeze([...missing]),
  });
}

function freezeRuntimeConfig(config) {
  return Object.freeze({
    ...config,
    missing: Object.freeze([...config.missing]),
  });
}

function loadTsinghuaConnectorRuntimeConfig(environment = process.env) {
  const mode = readEnvironmentValue(environment, 'TSINGHUA_CONNECTOR_MODE') || 'disabled';
  const nodeEnvironment = readEnvironmentValue(environment, 'NODE_ENV');
  const adapterId = readEnvironmentValue(environment, 'TSINGHUA_CONNECTOR_ADAPTER_ID');
  const callbackUrl = readEnvironmentValue(environment, 'TSINGHUA_CONNECTOR_CALLBACK_URL');
  const encryptionKey = readEnvironmentValue(environment, 'TSINGHUA_CONNECTOR_ENCRYPTION_KEY');
  const workerSocket = readEnvironmentValue(environment, 'TSINGHUA_CONNECTOR_WORKER_SOCKET');
  const publicWebUrl = readEnvironmentValue(environment, 'PUBLIC_WEB_URL');
  const ttl = readEnvironmentValue(environment, 'TSINGHUA_CONNECTOR_STATE_TTL_SECONDS');
  const syncInterval = readEnvironmentValue(
    environment,
    'TSINGHUA_CONNECTOR_SYNC_INTERVAL_SECONDS',
  );
  const authorizationTtlSeconds = parseBoundedInteger(
    ttl,
    DEFAULT_STATE_TTL_SECONDS,
    MIN_STATE_TTL_SECONDS,
    MAX_STATE_TTL_SECONDS,
  );
  const syncIntervalSeconds = parseBoundedInteger(
    syncInterval,
    DEFAULT_SYNC_INTERVAL_SECONDS,
    MIN_SYNC_INTERVAL_SECONDS,
    MAX_SYNC_INTERVAL_SECONDS,
  );
  const runtimeValues = {
    mode,
    adapterId,
    callbackUrl,
    encryptionKey,
    workerSocket,
    authorizationTtlSeconds,
    syncIntervalSeconds,
  };

  if (!CONNECTOR_MODES.has(mode)) {
    return freezeRuntimeConfig({ state: 'misconfigured', ...runtimeValues, missing: ['mode'] });
  }
  if (mode === 'disabled') {
    return freezeRuntimeConfig({ state: 'not_configured', ...runtimeValues, missing: [] });
  }

  const missing = [];
  if (authorizationTtlSeconds === null) {
    missing.push('state_ttl_seconds');
  }
  if (syncIntervalSeconds === null) {
    missing.push('sync_interval_seconds');
  }

  if (mode === 'development_mock') {
    if (!LOCAL_NODE_ENVIRONMENTS.has(nodeEnvironment)) {
      missing.unshift('development_mock_environment');
    }
    return freezeRuntimeConfig({
      state: missing.length ? 'misconfigured' : 'development_mock',
      ...runtimeValues,
      missing,
    });
  }

  if (mode === 'direct_cas') {
    if (adapterId !== DIRECT_CAS_ADAPTER_ID) {
      missing.unshift('adapter_id');
    }
    if (!isValidEncryptionKey(encryptionKey)) {
      missing.push('encryption_key');
    }
    if (!isSecureDirectWebEnvironment(publicWebUrl, nodeEnvironment)) {
      missing.push('public_web_url_https');
    }
    return freezeRuntimeConfig({
      state: missing.length ? 'misconfigured' : 'direct_cas',
      ...runtimeValues,
      missing,
    });
  }

  if (!isValidAdapterId(adapterId)) {
    missing.unshift('adapter_id');
  }
  if (!isValidCallbackUrl(callbackUrl, nodeEnvironment)) {
    missing.push('callback_url');
  }
  if (!isValidEncryptionKey(encryptionKey)) {
    missing.push('encryption_key');
  }
  if (!isValidWorkerSocket(workerSocket)) {
    missing.push('worker_socket');
  }

  return freezeRuntimeConfig({
    state: missing.length ? 'misconfigured' : 'ready',
    ...runtimeValues,
    missing,
  });
}

function parseTsinghuaConnectorRuntimeConfig(environment = process.env) {
  const runtime = loadTsinghuaConnectorRuntimeConfig(environment);
  return safeResult(runtime.state, runtime.missing);
}
module.exports = {
  MAX_STATE_TTL_SECONDS,
  MAX_SYNC_INTERVAL_SECONDS,
  MIN_STATE_TTL_SECONDS,
  MIN_SYNC_INTERVAL_SECONDS,
  DIRECT_CAS_ADAPTER_ID,
  loadTsinghuaConnectorRuntimeConfig,
  parseTsinghuaConnectorRuntimeConfig,
};
