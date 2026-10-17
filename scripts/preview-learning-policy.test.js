const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const { withLearningPolicyPage } = require('./preview-learning-policy');
const { getAssessmentDocumentVersion } = require('../backend/learning-assessment');
const { listenAllowedLoopback } = require('./fixtures/allowed-loopback');

async function fixture(t, payload) {
  const original = structuredClone(payload);
  const server = http.createServer((req, res) => {
    res.setHeader('ETag', 'old-source');
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(JSON.stringify(payload)),
    });
    res.end(JSON.stringify(payload));
  });
  withLearningPolicyPage({ server });
  await listenAllowedLoopback(server);
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
      }),
  );
  return { server, original, origin: `http://127.0.0.1:${server.address().port}` };
}

test('local public snapshot JSON versions match reconstructed source without altering snapshots or grading', async (t) => {
  for (const node of [
    { markdown: '公开清洗正文', documentVersion: 'a'.repeat(64) },
    { markdown: '', sections: { knowledgeMarkdown: '分节正文' }, documentVersion: 'b'.repeat(64) },
  ]) {
    const payload = { node, assessment: 'UNCHANGED_PUBLIC_FIELD' };
    const { origin, original } = await fixture(t, payload);
    const response = await fetch(`${origin}/api/courses/signals/map/nodes/SS-02-01`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('etag'), null);
    assert.equal(response.headers.get('content-length'), null);
    const body = await response.json();
    assert.equal(
      body.node.documentVersion,
      getAssessmentDocumentVersion(node.markdown || node.sections.knowledgeMarkdown),
    );
    assert.equal(body.previewVersionSource, 'public_reconstructed_source_not_authoring_backup');
    assert.equal(body.assessment, 'UNCHANGED_PUBLIC_FIELD');
    assert.deepEqual(payload, original);
  }
});

test('the version adapter is node-GET-only and loopback host/origin rejection remains authoritative', async (t) => {
  const payload = { node: { markdown: '公开正文', documentVersion: 'a'.repeat(64) } };
  const { origin } = await fixture(t, payload);
  for (const [route, options] of [
    ['/api/courses/signals/map', {}],
    ['/api/courses/signals/map/nodes/SS-02-01', { method: 'POST' }],
  ]) {
    const response = await fetch(`${origin}${route}`, options);
    assert.equal((await response.json()).node.documentVersion, 'a'.repeat(64));
    assert.equal(response.headers.get('etag'), 'old-source');
  }
  const foreign = await fetch(`${origin}/api/courses/signals/map/nodes/SS-02-01`, {
    headers: { Origin: 'https://production.example' },
  });
  assert.equal(foreign.status, 403);
  const wrongHost = await new Promise((resolve, reject) => {
    const request = http.get(
      `${origin}/api/courses/signals/map/nodes/SS-02-01`,
      {
        headers: { Host: 'production.example' },
      },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    );
    request.on('error', reject);
  });
  assert.equal(wrongHost, 403);
});
