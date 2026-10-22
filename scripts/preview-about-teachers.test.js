const assert = require('node:assert/strict');
const test = require('node:test');
const cheerio = require('cheerio');
const { createAboutTeachersPreview } = require('./preview-about-teachers');
const { TOKEN } = require('./preview-economy');
const { listenAllowedLoopback } = require('./fixtures/allowed-loopback');
const { DEMO_CODE, DEMO_PASSWORD } = require('./preview-teacher-accounts');

test('the fictional student email suggestion stays unbound until one explicit OTP verification', async (t) => {
  const preview = createAboutTeachersPreview();
  await listenAllowedLoopback(preview.server);
  t.after(async () => {
    preview.server.closeAllConnections();
    await new Promise((resolve) => {
      preview.server.close(resolve);
    });
  });
  const origin = `http://127.0.0.1:${preview.server.address().port}`;
  const headers = {
    Authorization: `Bearer ${TOKEN}`,
    Cookie: 'freebbs_demo_account=4',
    'Content-Type': 'application/json',
  };
  const before = await (await fetch(`${origin}/api/profile/identity`, { headers })).json();
  assert.equal(before.email, null);
  assert.equal(before.emailVerified, false);
  assert.deepEqual(before.emailSuggestion, {
    email: 'preview-only-student@tsinghua.edu.cn',
    source: 'whitelist_pair',
    requiresVerification: true,
  });
  const send = await fetch(`${origin}/api/profile/email-code`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email: before.emailSuggestion.email, currentPassword: DEMO_PASSWORD }),
  });
  assert.equal(send.status, 200);
  assert.equal(preview.teacher.accounts.get(4).emailVerified, false);
  const bind = await fetch(`${origin}/api/profile/email`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      email: before.emailSuggestion.email,
      currentPassword: DEMO_PASSWORD,
      emailCode: DEMO_CODE,
    }),
  });
  assert.equal(bind.status, 200);
  const after = await (await fetch(`${origin}/api/profile/identity`, { headers })).json();
  assert.equal(after.email, before.emailSuggestion.email);
  assert.equal(after.emailVerified, true);
  assert.equal(after.emailSuggestion, null);
  assert.equal(after.studentId, before.studentId);
});

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
    '/settings?as=teacher',
  ]) {
    const response = await fetch(`${origin}${route}`);
    assert.equal(response.status, 200, route);
    const html = await response.text();
    assert.match(html, /<html/);
    assert.match(html, /邮箱建议、验证码与绑定均为本地模拟，不修改真实白名单，不发送邮件/);
    const $ = cheerio.load(html);
    const styles = [
      '/site-search.css',
      '/mobile-shell.css',
      '/desktop-elegant.css',
      '/page-transitions.css',
      '/desktop-shell.css',
      '/personal-polish.css',
    ];
    let previousStyle = -1;
    for (const href of styles) {
      assert.equal($(`link[rel="stylesheet"][href="${href}"]`).length, 1, route);
      const index = html.indexOf(`href="${href}"`);
      assert.ok(index > previousStyle, `${route} keeps the production shell stylesheet order`);
      previousStyle = index;
    }
    for (const src of [
      '/site-search.js',
      '/mobile-shell.js',
      '/page-transitions.js',
      '/desktop-shell.js',
    ])
      assert.equal($(`script[src="${src}"][defer]`).length, 1, route);
    if (route.startsWith('/settings')) {
      assert.equal($('#certifications').length, 1);
      assert.equal($('#certifications > .settings-section-heading > h2').text(), '身份认证');
      assert.equal($('#certifications h2').length, 1, 'one card has only one identity heading');
      assert.equal(
        $('#certifications > #settings-identity').length,
        1,
        'legacy binding anchor remains inside the merged card',
      );
      assert.equal(
        $('.settings-row > #settings-identity').length,
        0,
        'no separate binding card remains',
      );
      assert.equal($('.settings-jump-links a[href="#settings-identity"]').length, 0);
      assert.equal($('.settings-jump-links a[href="#certifications"]').length, 1);
      for (const id of ['settings-email-form', 'settings-student-form', 'certification-form']) {
        assert.equal($(`#${id}`).length, 1);
        assert.equal($(`#${id}`).parents('form').length, 0, 'identity forms must not nest');
        assert.equal($(`#${id}`).closest('#certifications').length, 1);
      }
      assert.equal(
        $('#settings-identity #certification-form').length,
        0,
        'binding controller cannot disable certification fields',
      );
      assert.equal($('#certification-form #settings-identity').length, 0);
      for (const kind of ['email', 'student']) {
        const panel = $(`#settings-${kind}-binding`);
        assert.equal(panel.is('details'), true);
        assert.equal(panel.attr('open'), undefined, 'binding editors start collapsed');
        assert.equal(panel.find(`#settings-${kind}-form`).length, 1);
        assert.equal(panel.find(`#settings-${kind}-summary`).length, 1);
      }
    }
  }
  assert.equal((await fetch(`${origin}/api/teacher/workspace`)).status, 401);
  const teacher = await (
    await fetch(`${origin}/api/teacher/workspace`, { headers: headers(2) })
  ).json();
  assert.equal(teacher.eligible, true);
  assert.equal(teacher.courses.length, 3);
  assert.equal(teacher.courses[0].canEditMaterials, false);
  const studentIdentity = await (
    await fetch(`${origin}/api/me/certifications`, { headers: headers(4) })
  ).json();
  assert.deepEqual(studentIdentity.managedSlots, ['undergraduate']);
  assert.equal(studentIdentity.automatic[0].education, 'undergraduate');
  const graduateIdentity = await (
    await fetch(`${origin}/api/me/certifications`, { headers: headers(5) })
  ).json();
  assert.deepEqual(graduateIdentity.managedSlots, ['master']);
  assert.equal(graduateIdentity.automatic[0].education, 'master');
  const doctorIdentity = await (
    await fetch(`${origin}/api/me/certifications`, { headers: headers(6) })
  ).json();
  assert.deepEqual(doctorIdentity.managedSlots, ['doctor']);
  assert.equal(doctorIdentity.automatic[0].label, '2025 · 电子工程系 · 博士研究生');
  assert.equal(
    (
      await fetch(`${origin}/api/me/certifications`, {
        method: 'POST',
        headers: { ...headers(4), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'education',
          education: 'undergraduate',
          institution: '不应重复申请',
        }),
      })
    ).status,
    409,
  );
  assert.equal(preview.certificationRequests.length, 0);
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
