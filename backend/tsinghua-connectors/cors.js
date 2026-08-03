const CONNECTOR_API_PATH = '/api/workbench/connectors/tsinghua';

function parsePublicWebOrigin(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ''));
  } catch {
    throw new TypeError('PUBLIC_WEB_URL must be an absolute HTTP(S) URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new TypeError('PUBLIC_WEB_URL must be an absolute HTTP(S) URL');
  }
  return parsed.origin;
}

function requestPath(request) {
  if (typeof request.path === 'string') return request.path;
  try {
    return new URL(String(request.url || '/'), 'http://free-bbs.local').pathname;
  } catch {
    return '';
  }
}

function isCampusConnectorRequest(request) {
  const path = requestPath(request);
  return path === CONNECTOR_API_PATH || path.startsWith(`${CONNECTOR_API_PATH}/`);
}

function appendVaryOrigin(response) {
  const current = String(response.getHeader('Vary') || '');
  const values = current
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (!values.some((value) => value.toLowerCase() === 'origin')) values.push('Origin');
  response.setHeader('Vary', values.join(', '));
}

function createCampusConnectorCorsPolicy(publicWebUrl) {
  const allowedOrigin = parsePublicWebOrigin(publicWebUrl);

  return function applyCampusConnectorCors(request, response) {
    if (!isCampusConnectorRequest(request)) return false;

    const requestOrigin = String(request.headers.origin || '');
    if (requestOrigin === allowedOrigin) {
      response.setHeader('Access-Control-Allow-Origin', allowedOrigin);
      response.setHeader('Access-Control-Allow-Credentials', 'true');
      appendVaryOrigin(response);
    }
    return true;
  };
}

module.exports = {
  CONNECTOR_API_PATH,
  createCampusConnectorCorsPolicy,
  isCampusConnectorRequest,
  parsePublicWebOrigin,
};
