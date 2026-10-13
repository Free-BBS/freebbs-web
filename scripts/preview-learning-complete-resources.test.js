const test = require('node:test');
const assert = require('node:assert/strict');
const { createCompleteLearningPreview } = require('./preview-learning-complete');
const { listenAllowedLoopback } = require('./fixtures/allowed-loopback');

test('complete preview has an honest empty public-upload fixture, not a failed API or fictitious resource', async (t) => {
  const preview = createCompleteLearningPreview();
  await listenAllowedLoopback(preview.server);
  t.after(async () => {
    preview.server.closeAllConnections();
    await new Promise((resolve) => {
      preview.server.close(resolve);
    });
  });
  const base = `http://127.0.0.1:${preview.server.address().port}`;
  for (const slug of ['math', 'circuits', 'signals']) {
    const response = await fetch(`${base}/api/course-upload/public/courses/${slug}/files`);
    assert.equal(response.status, 200, 'public resources do not require a token');
    assert.deepEqual(await response.json(), { files: [] });
    assert.match(response.headers.get('cache-control'), /no-store/);
  }
  const unknown = await fetch(`${base}/api/course-upload/public/courses/unknown/files`);
  assert.equal(unknown.status, 404, 'an unknown course is not an empty valid course');
  const external = await fetch(`${base}/api/course-upload/public/courses/signals/files`, {
    headers: { Origin: 'https://example.com' },
  });
  assert.equal(external.status, 403);
  const page = await fetch(`${base}/course?course=signals`);
  assert.match(await page.text(), /未预置上传附件.*服务重启会清空/);
  assert.deepEqual(preview.learning.store.rows, []);
  assert.deepEqual(preview.learning.assessmentStore.rows, []);
});
