const CONNECTOR_STATES = new Set([
  'not_configured',
  'misconfigured',
  'ready',
  'direct_cas',
  'development_mock',
]);
const READY_CONNECTOR_STATES = new Set(['ready', 'direct_cas']);
const SAFE_MISSING_FIELD_PATTERN = /^[a-z][a-z0-9_]{0,63}$/u;

function normalizeConnectorState(value) {
  const state = String(value || 'misconfigured');
  return CONNECTOR_STATES.has(state) ? state : 'misconfigured';
}

function normalizeMissingFields(value) {
  if (!Array.isArray(value)) return [];

  return [...new Set(value)]
    .filter((field) => typeof field === 'string' && SAFE_MISSING_FIELD_PATTERN.test(field))
    .slice(0, 32);
}

function buildBackendHealth({
  agentSettingsRequired = false,
  agentSettingsState = 'disabled',
  tsinghuaConnectorRequired = false,
  tsinghuaConnectorAvailability = {},
  tsinghuaConnectorMissing = [],
} = {}) {
  const agentSettingsHealthy = !agentSettingsRequired || String(agentSettingsState) === 'ready';
  const connectorState = normalizeConnectorState(tsinghuaConnectorAvailability.state);
  const authorizationAvailable = Boolean(tsinghuaConnectorAvailability.authorizationAvailable);
  const syncAvailable = Boolean(tsinghuaConnectorAvailability.syncAvailable);
  const connectorReady = Boolean(
    READY_CONNECTOR_STATES.has(connectorState) && authorizationAvailable && syncAvailable,
  );
  const tsinghuaConnectorHealthy = !tsinghuaConnectorRequired || connectorReady;
  const ok = agentSettingsHealthy && tsinghuaConnectorHealthy;
  const unavailableComponents = [];

  if (!agentSettingsHealthy) unavailableComponents.push('Agent settings internal API');
  if (!tsinghuaConnectorHealthy) unavailableComponents.push('Tsinghua connector');

  const message =
    unavailableComponents.length === 1
      ? `${unavailableComponents[0]} is not ready`
      : `Required backend components are not ready: ${unavailableComponents.join(', ')}`;

  return {
    statusCode: ok ? 200 : 503,
    body: {
      ok,
      agentSettingsApi: String(agentSettingsState || 'disabled'),
      tsinghuaConnector: {
        required: Boolean(tsinghuaConnectorRequired),
        state: connectorState,
        ready: connectorReady,
        authorizationAvailable,
        syncAvailable,
        missing: normalizeMissingFields(tsinghuaConnectorMissing),
      },
      ...(ok ? {} : { message }),
    },
  };
}

module.exports = {
  buildBackendHealth,
};
