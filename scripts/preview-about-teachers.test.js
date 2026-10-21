const assert = require('node:assert/strict');
const test = require('node:test');
const { createAboutTeachersPreview } = require('./preview-about-teachers');
const { TOKEN } = require('./preview-economy');
const { listenAllowedLoopback } = require('./fixtures/allowed-loopback');

test('teacher preview serves real local entry pages and never broadens fixture privileges or origin boundaries', async (t) => {
  const preview = createAboutTeachersPreview();
  await listenAllowedLoopback(preview.server);
  t.after(async () => {
    preview.server.closeAllConnections();
    await new Promise((resolve) => {
      preview.server.close(resolve);
    });
  });
  const origin = `http://127.0.0.1:${preview.server.address().port}`;
  const headers = (id) => ({
    Authorization: `Bearer ${TOKEN}`,
    Cookie: `freebbs_demo_account=${id}`,
  });
  for (const route of [
    '/about',
    '/teachers',
    '/guide',
    '/development',
    '/laboratory',
    '/discussion',
    '/privacy',
  ]) {
    const response = await fetch(`${origin}${route}`);
    assert.equal(response.status, 200, route);
    assert.match(await response.text(), /<html/);
  }
  assert.equal((await fetch(`${origin}/api/teacher/workspace`)).status, 401);
  const teacher = await (
    await fetch(`${origin}/api/teacher/workspace`, { headers: headers(2) })
  ).json();
  assert.equal(teacher.eligible, true);
  assert.equal(teacher.courses[0].canEditMaterials, false);
  const unverified = await (
    await fetch(`${origin}/api/teacher/workspace`, { headers: headers(3) })
  ).json();
  assert.equal(unverified.eligible, false);
  assert.deepEqual(unverified.courses, []);
  assert.deepEqual(unverified.feedback, []);
  assert.equal(
    (
      await fetch(`${origin}/api/learning/signals/SS-01-01/entries?review=pending`, {
        headers: headers(3),
      })
    ).status,
    403,
    'unverified fixture account 3 must not inherit older lab manager rights',
  );
  assert.equal(
    (
      await fetch(`${origin}/api/admin/users/2/teaching-courses`, {
        method: 'PUT',
        headers: { ...headers(2), 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseSlugs: [], identityConfirmed: true }),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(`${origin}/api/admin/users/2/teaching-courses`, {
        method: 'PUT',
        headers: {
          ...headers(1),
          Origin: 'https://wrong.example',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ courseSlugs: [], identityConfirmed: true }),
      })
    ).status,
    403,
  );
  assert.equal(preview.writes.length, 0);
});
