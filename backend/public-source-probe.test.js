const assert = require('node:assert/strict');
const test = require('node:test');
const {
  PARSER_VERSION,
  PublicSourceProbeError,
  parsePublicNotices,
  probePublicNoticeSource,
} = require('./public-source-probe');

const NOTICE_HTML = `<!doctype html>
<html lang="zh-CN">
  <body>
    <ul class="list">
      <li class="list-item" id="line_1">
        <a href="https://info.tsinghua.edu.cn/f/info/detail?id=one">
          <div class="date"><p class="md">08-01</p><p class="year">2026</p></div>
          <div class="content"><h3 title="第一条公开通知">第一条公开通知</h3></div>
        </a>
      </li>
      <li class="list-item" id="line_2">
        <a href="/xwgg/detail-two.htm">
          <div class="date"><p class="md">07-31</p><p class="year">2026</p></div>
          <div class="content"><h3>第二条 &amp; 更新</h3></div>
        </a>
      </li>
      <li class="list-item" id="line_3">
        <a href="https://example.com/not-allowed"><h3>站外链接</h3></a>
      </li>
    </ul>
  </body>
</html>`;

test('parses dated notices and keeps only HTTPS Tsinghua links', () => {
  const items = parsePublicNotices(NOTICE_HTML);

  assert.equal(items.length, 2);
  assert.deepEqual(
    items.map(({ title, date }) => ({ title, date })),
    [
      { title: '第一条公开通知', date: '2026-08-01' },
      { title: '第二条 & 更新', date: '2026-07-31' },
    ],
  );
  assert.match(items[0].url, /^https:\/\/info\.tsinghua\.edu\.cn\//);
  assert.match(items[1].url, /^https:\/\/learning\.tsinghua\.edu\.cn\//);
});

test('live probe returns independently verifiable network evidence', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), options });
    return new Response(NOTICE_HTML, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=UTF-8',
        'last-modified': 'Sat, 01 Aug 2026 00:00:00 GMT',
      },
    });
  };

  const result = await probePublicNoticeSource({
    fetchImpl,
    now: () => new Date('2026-08-01T09:00:00.000Z'),
    useCache: false,
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.redirect, 'manual');
  assert.equal(result.network, 'live');
  assert.equal(result.cached, false);
  assert.equal(result.status, 200);
  assert.equal(result.itemCount, 2);
  assert.equal(result.parserVersion, PARSER_VERSION);
  assert.match(result.contentSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.safeguards.authenticationUsed, false);
  assert.equal(result.safeguards.fixedSourceAllowlist, true);
});

test('probe rejects redirects outside the fixed source allowlist', async () => {
  const fetchImpl = async () =>
    new Response(null, {
      status: 302,
      headers: { location: 'http://127.0.0.1/private' },
    });

  await assert.rejects(
    probePublicNoticeSource({ fetchImpl, useCache: false }),
    (error) => error instanceof PublicSourceProbeError && error.code === 'redirect_not_allowed',
  );
});
