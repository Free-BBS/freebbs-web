const assert = require('node:assert/strict');
const test = require('node:test');
const { createHomeworkClient, parseHomeworkPage, readLimited } = require('./homework-client');
const { createHomeworkFetch, createAuthorizedFetch } = require('./cas-adapter');

const origin = 'https://learn.tsinghua.edu.cn';
const grant = JSON.stringify({
  version: 1,
  origin,
  cookies: [
    {
      name: 'SESSION',
      value: 'fixture',
      domain: 'learn.tsinghua.edu.cn',
      path: '/',
      hostOnly: true,
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
      expiresAt: null,
    },
  ],
});
const homework = {
  providerCourseId: 'course1',
  providerHomeworkId: 'base1',
  providerStudentHomeworkId: 'student1',
  submissionType: 2,
  completionType: 1,
  status: 'unsubmitted',
  dueAt: '2030-01-01T00:00:00Z',
};

test('homework transport blocks submission and only allows read operations', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return new Response('{}');
  };
  const read = createAuthorizedFetch(grant, { fetchImpl });
  const write = createHomeworkFetch(grant, { fetchImpl });
  const target = `${origin}/b/wlxt/kczy/zy/student/tjzy?_csrf=fixture-token`;
  await assert.rejects(read(target, { method: 'POST' }));
  for (const url of [
    target.replace(origin, 'https://evil.example'),
    `${target}&url=https://evil.example`,
    `${target}&_csrf=second-token`,
    `${origin}/b/wlxt/kczy/zy/student/delete`,
    `${target}#fragment`,
    `${origin}/f/wlxt/kczy/zy/student/viewCj?wlkcid=course1&xszyid=student1&xszyid=other`,
  ]) {
    await assert.rejects(write(url, { method: 'POST' }));
  }
  await assert.rejects(write(target, { method: 'POST' }));
  await write(`${origin}/b/wlxt/kczy/zy/student/detail?_csrf=fixture-token`, {
    method: 'POST',
    headers: { Authorization: 'untrusted', Cookie: 'fake' },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(calls[0].options.headers.get('Cookie'), 'SESSION=fixture');
  assert.equal(calls[0].options.headers.get('Authorization'), null);
});

test('detail parsing preserves literal math, strips active content and rejects foreign attachments', () => {
  const parsed = parseHomeworkPage(
    `<div class="boxbox"></div><div class="boxbox"><div class="right"></div><div class="right"></div><div class="right">x &lt; 5<br>第二行<script>alert(1)</script></div></div>
    <div class="list fujian clearfix"><a href="/b/wlxt/kczy/zy/student/downloadFile/course1/question1">题目.pdf</a>
    <a href="https://evil.example/b/wlxt/kczy/zy/student/downloadFile/course1/stolen">bad</a>
    <a href="/b/wlxt/kczy/zy/student/downloadFile/course2/other">other course</a></div>`,
    homework,
  );
  assert.equal(parsed.submittedContent, 'x < 5\n第二行');
  assert.equal(parsed.submittedContentKnown, true);
  assert.deepEqual(parsed.attachments, [{ id: 'question1', role: 'assignment', name: '题目.pdf' }]);
  assert.equal(parseHomeworkPage('<p>unexpected page</p>', homework).submittedContentKnown, false);
});

test('rejects redirects, login HTML and oversized bodies', async () => {
  const redirected = createHomeworkClient({
    authorizedFetch: async () =>
      new Response('', { status: 302, headers: { Location: 'https://evil.example' } }),
  });
  await assert.rejects(redirected.initialize(), { code: 'homework_redirect_blocked' });
  const expired = createHomeworkClient({
    authorizedFetch: async () => new Response('<input name="i_user">'),
  });
  await assert.rejects(expired.initialize(), { code: 'homework_authorization_required' });
  await assert.rejects(readLimited(new Response('12345'), 4), {
    code: 'homework_response_too_large',
  });
});

test('keeps homework readable when only its deadline is unrecognized', async () => {
  const client = createHomeworkClient({
    authorizedFetch: async (url) =>
      new Response(
        JSON.stringify({
          result: 'success',
          object: {
            aaData: url.pathname.endsWith('/zyListYjwg')
              ? [
                  {
                    zyid: 'base1',
                    xszyid: 'student1',
                    bt: 'Offline homework',
                    jzsj: '待定',
                  },
                ]
              : [],
          },
        }),
      ),
  });
  const items = await client.list({
    providerCourseId: 'course1',
    sourceReference: 'course1',
    title: 'Course',
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].status, 'submitted');
  assert.equal(items[0].deadlineUnverified, true);
  assert.equal(client.submit, undefined);
});
