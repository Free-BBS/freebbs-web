const assert = require('node:assert/strict');
const test = require('node:test');
const { createCampusConnectorCorsPolicy, parsePublicWebOrigin } = require('./cors');

function createResponse() {
  const headers = new Map();
  return {
    headers,
    getHeader(name) {
      return headers.get(String(name).toLowerCase());
    },
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), String(value));
    },
  };
}

test('credentialed connector CORS allows only the parsed PUBLIC_WEB_URL origin', () => {
  const applyCors = createCampusConnectorCorsPolicy('http://127.0.0.1:3000/workbench');
  const response = createResponse();
  const handled = applyCors(
    {
      headers: { origin: 'http://127.0.0.1:3000' },
      path: '/api/workbench/connectors/tsinghua/authorization-attempts',
    },
    response,
  );

  assert.equal(handled, true);
  assert.equal(response.getHeader('Access-Control-Allow-Origin'), 'http://127.0.0.1:3000');
  assert.equal(response.getHeader('Access-Control-Allow-Credentials'), 'true');
  assert.equal(response.getHeader('Vary'), 'Origin');
});

test('connector CORS never reflects a different cross origin', () => {
  const applyCors = createCampusConnectorCorsPolicy('https://free-bbs.example');
  const response = createResponse();
  const handled = applyCors(
    {
      headers: { origin: 'https://evil.example' },
      path: '/api/workbench/connectors/tsinghua/status',
    },
    response,
  );

  assert.equal(handled, true);
  assert.equal(response.getHeader('Access-Control-Allow-Origin'), undefined);
  assert.equal(response.getHeader('Access-Control-Allow-Credentials'), undefined);
});

test('connector requests without Origin proceed without adding CORS trust headers', () => {
  const applyCors = createCampusConnectorCorsPolicy('https://free-bbs.example');
  const response = createResponse();
  const handled = applyCors(
    {
      headers: {},
      path: '/api/workbench/connectors/tsinghua/callback',
    },
    response,
  );

  assert.equal(handled, true);
  assert.equal(response.headers.size, 0);
});

test('non-connector routes retain the surrounding application CORS policy', () => {
  const applyCors = createCampusConnectorCorsPolicy('https://free-bbs.example');
  const response = createResponse();

  assert.equal(
    applyCors({ headers: { origin: 'https://another.example' }, path: '/api/courses' }, response),
    false,
  );
  assert.equal(response.headers.size, 0);
});

test('PUBLIC_WEB_URL must be an absolute HTTP(S) origin', () => {
  assert.equal(
    parsePublicWebOrigin('https://free-bbs.example/workbench'),
    'https://free-bbs.example',
  );
  assert.throws(() => parsePublicWebOrigin('file:///tmp/free-bbs'), TypeError);
  assert.throws(() => parsePublicWebOrigin('https://user:secret@free-bbs.example'), TypeError);
});
