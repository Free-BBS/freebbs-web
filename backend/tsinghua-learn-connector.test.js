const assert = require('node:assert/strict');
const test = require('node:test');
const {
  PARSER_VERSION,
  TsinghuaConnectorError,
  TsinghuaLearnTransport,
  getTsinghuaConnectorCapabilities,
  getLearnConnectorCapabilities,
  normalizeHtmlText,
  normalizeShanghaiDate,
  parseHomework,
  parseNotices,
  syncTsinghuaLearn,
  validateLearnApiPath,
} = require('./tsinghua-learn-connector');

const SEMESTER_PATH = '/b/kc/zhjw_v_code_xnxq/getCurrentAndNextSemester';

function jsonResponse(payload, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=UTF-8',
      ...headers,
    },
  });
}

function createFixtureFetch({
  courseCount = 1,
  delayMs = 0,
  noticeStatus = 200,
  overlapHomeworkStatuses = false,
  coursePayload,
} = {}) {
  const stats = {
    active: 0,
    calls: [],
    maxActive: 0,
  };
  const courses = Array.from({ length: courseCount }, (_, index) => ({
    wlkcid: `course_${index + 1}`,
    kcm: `课程 ${index + 1}`,
    jsm: `教师 ${index + 1}`,
    xnxq: '2026-2027-1',
    skddxx: `第1-16周星期${index + 1}第2节，教学楼 ${index + 1}01`,
  }));

  const fetchImpl = async (input, options) => {
    const url = new URL(String(input));
    stats.active += 1;
    stats.maxActive = Math.max(stats.maxActive, stats.active);
    stats.calls.push({
      body: options.body || '',
      headers: { ...options.headers },
      method: options.method,
      path: url.pathname,
      redirect: options.redirect,
    });

    try {
      if (delayMs) {
        await new Promise((resolve) => {
          setTimeout(resolve, delayMs);
        });
      }
      assert.equal(url.protocol, 'https:');
      assert.equal(url.hostname, 'learn.tsinghua.edu.cn');
      assert.equal(options.redirect, 'manual');
      assert.equal(Object.hasOwn(options.headers, 'Cookie'), false);
      assert.equal(Object.hasOwn(options.headers, 'Authorization'), false);

      if (url.pathname.endsWith('/getCurrentAndNextSemester')) {
        return jsonResponse({ result: { xnxq: '2026-2027-1' } });
      }
      if (url.pathname.includes('/loadCourseBySemesterId/')) {
        return jsonResponse(coursePayload || { resultList: courses });
      }
      if (url.pathname.endsWith('/pageListXs')) {
        if (noticeStatus !== 200) {
          return jsonResponse({ error: 'temporary' }, { status: noticeStatus });
        }
        const parsedBody = new URLSearchParams(options.body);
        const aoData = JSON.parse(parsedBody.get('aoData'));
        const courseId = aoData.find((entry) => entry.name === 'wlkcid').value;
        return jsonResponse({
          object: {
            aaData: [
              {
                ggid: `notice_${courseId}`,
                bt: '课程公告',
                fbr: '课程组',
                fbsjStr: '2026-08-01 09:30:00',
                ggnrStr:
                  '<script>credentialLeak()</script><p>请阅读 &amp; 完成</p><img src=x onerror=alert(1)>',
              },
            ],
          },
        });
      }
      if (url.pathname.endsWith('/zyListWj')) {
        const parsedBody = new URLSearchParams(options.body);
        const aoData = JSON.parse(parsedBody.get('aoData'));
        const courseId = aoData.find((entry) => entry.name === 'wlkcid').value;
        return jsonResponse({
          object: {
            aaData: [
              {
                zyid: `homework_${courseId}`,
                xszyid: `student_homework_${courseId}`,
                bt: '第一次作业',
                zynr: '<p>完成第一章习题</p>',
                kssj: '2026-08-01 08:00:00',
                jzsj: '2026-08-03 23:59:00',
              },
            ],
          },
        });
      }
      if (url.pathname.endsWith('/zyListYpg') && overlapHomeworkStatuses) {
        const parsedBody = new URLSearchParams(options.body);
        const aoData = JSON.parse(parsedBody.get('aoData'));
        const courseId = aoData.find((entry) => entry.name === 'wlkcid').value;
        return jsonResponse({
          object: {
            aaData: [
              {
                zyid: `homework_${courseId}`,
                xszyid: `student_homework_${courseId}`,
                bt: '第一次作业',
                jzsj: '2026-08-03 23:59:00',
              },
            ],
          },
        });
      }
      if (url.pathname.endsWith('/zyListYjwg') || url.pathname.endsWith('/zyListYpg')) {
        return jsonResponse({ object: { aaData: [] } });
      }
      throw new Error(`Unexpected fixture request: ${url.pathname}`);
    } finally {
      stats.active -= 1;
    }
  };
  fetchImpl.stats = stats;
  return fetchImpl;
}

test('normalizes HTML to inert text and parses Shanghai timestamps explicitly', () => {
  assert.equal(
    normalizeHtmlText('<script>steal()</script><p>作业 &amp; 安排</p><img src=x onerror=alert(1)>'),
    '作业 & 安排',
  );
  assert.equal(normalizeHtmlText('&lt;img src=x onerror=steal()&gt;safe'), 'safe');
  assert.equal(normalizeShanghaiDate('2026-08-03 23:59:00'), '2026-08-03T15:59:00.000Z');
  assert.equal(normalizeShanghaiDate('2026-02-30 12:00:00'), null);
});

test('rejects arbitrary hosts and paths before invoking the authorized channel', async () => {
  let requestCount = 0;
  const transport = new TsinghuaLearnTransport({
    authorizedFetch: async () => {
      requestCount += 1;
      return jsonResponse({});
    },
  });

  await assert.rejects(
    transport.requestJson('malicious', 'GET', '//evil.example/b/private'),
    (error) => error instanceof TsinghuaConnectorError && error.code === 'target_not_allowed',
  );
  assert.equal(requestCount, 0);
  assert.equal(validateLearnApiPath(SEMESTER_PATH, 'GET').hostname, 'learn.tsinghua.edu.cn');
  assert.throws(() => validateLearnApiPath('/f/login'), /不在白名单/);
  assert.throws(() => validateLearnApiPath(SEMESTER_PATH, 'POST'), /不在白名单/);
  assert.throws(() => validateLearnApiPath(`${SEMESTER_PATH}?debug=1`, 'GET'), /不在白名单/);
});

test('turns an SSO redirect into authorization_required without exposing its query', async () => {
  const transport = new TsinghuaLearnTransport({
    authorizedFetch: async () =>
      new Response(null, {
        status: 302,
        headers: {
          location: 'https://id.tsinghua.edu.cn/do/off/ui/auth/login?ticket=ST-sensitive-value',
        },
      }),
  });

  await assert.rejects(transport.requestJson('semester', 'GET', SEMESTER_PATH), (error) => {
    assert.equal(error.code, 'authorization_required');
    assert.doesNotMatch(String(error), /ticket|ST-sensitive-value/);
    return true;
  });
});

test('detects a login page returned with HTTP 200', async () => {
  const transport = new TsinghuaLearnTransport({
    authorizedFetch: async () =>
      new Response('<!doctype html><title>清华大学统一身份认证</title>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=UTF-8' },
      }),
  });

  await assert.rejects(
    transport.requestJson('semester', 'GET', SEMESTER_PATH),
    (error) => error.code === 'authorization_required',
  );
});

test('enforces streamed response size and request-budget limits', async () => {
  const oversizedTransport = new TsinghuaLearnTransport({
    authorizedFetch: async () =>
      new Response('x'.repeat(65), {
        headers: { 'content-type': 'application/json' },
      }),
    maxResponseBytes: 64,
  });
  await assert.rejects(
    oversizedTransport.requestJson('large', 'GET', SEMESTER_PATH),
    (error) => error.code === 'response_too_large',
  );

  const budgetTransport = new TsinghuaLearnTransport({
    authorizedFetch: async () => jsonResponse({ ok: true }),
    maxRequests: 1,
  });
  assert.deepEqual(await budgetTransport.requestJson('one', 'GET', SEMESTER_PATH), {
    ok: true,
  });
  await assert.rejects(
    budgetTransport.requestJson('two', 'GET', SEMESTER_PATH),
    (error) => error.code === 'request_budget_exceeded',
  );
});

test('spaces authenticated request starts with a deterministic rate gate', async () => {
  let currentTime = 1_000;
  const delays = [];
  const transport = new TsinghuaLearnTransport({
    authorizedFetch: async () => jsonResponse({ ok: true }),
    clock: () => currentTime,
    minimumRequestIntervalMs: 75,
    sleep: async (delayMs) => {
      delays.push(delayMs);
      currentTime += delayMs;
    },
  });

  await transport.requestJson('first', 'GET', SEMESTER_PATH);
  await transport.requestJson('second', 'GET', SEMESTER_PATH);

  assert.deepEqual(delays, [75]);
});

test('enforces a request timeout even if an injected fetch ignores AbortSignal', async () => {
  const transport = new TsinghuaLearnTransport({
    authorizedFetch: async () => new Promise(() => {}),
    timeoutMs: 15,
  });
  await assert.rejects(
    transport.requestJson('timeout', 'GET', SEMESTER_PATH),
    (error) => error.code === 'upstream_timeout' && error.retryable,
  );
});
test('aborts the complete sync at its shared deadline', async () => {
  let abortObserved = false;
  const authorizedFetch = async (_url, { signal }) =>
    new Promise((_, reject) => {
      const handleAbort = () => {
        abortObserved = true;
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      };
      if (signal.aborted) {
        handleAbort();
      } else {
        signal.addEventListener('abort', handleAbort, { once: true });
      }
    });

  await assert.rejects(
    syncTsinghuaLearn({
      authorizedFetch,
      minimumRequestIntervalMs: 0,
      syncTimeoutMs: 15,
      timeoutMs: 1_000,
    }),
    (error) => error.code === 'sync_timeout' && error.retryable,
  );
  assert.equal(abortObserved, true);
});

test('crawls semester, courses, notices and homework into a normalized snapshot', async () => {
  const authorizedFetch = createFixtureFetch();
  const snapshot = await syncTsinghuaLearn({
    authorizedFetch,
    minimumRequestIntervalMs: 0,
    now: () => new Date('2026-08-01T10:00:00.000Z'),
  });

  assert.equal(snapshot.status, 'complete');
  assert.equal(snapshot.parserVersion, PARSER_VERSION);
  assert.equal(snapshot.semesterId, '2026-2027-1');
  assert.equal(snapshot.courses.length, 1);
  assert.equal(snapshot.notifications.length, 1);
  assert.equal(snapshot.homework.length, 1);
  assert.equal(snapshot.importantItems.length, 1);
  assert.equal(snapshot.importantItems[0].status, 'draft');
  assert.equal(snapshot.importantItems[0].dueAt, '2026-08-03T15:59:00.000Z');
  assert.equal(snapshot.evidence.requestCount, 6);
  assert.equal(snapshot.evidence.responses.length, 6);
  assert.match(snapshot.evidence.responses[0].contentSha256, /^[a-f0-9]{64}$/);
  assert.equal(snapshot.evidence.safeguards.credentialsExposedToCaller, false);
  assert.equal(snapshot.evidence.safeguards.rawResponsesStored, false);
  assert.equal(snapshot.evidence.safeguards.maximumSyncDurationMs, 60_000);
  assert.equal(snapshot.evidence.safeguards.authorizedAdapterProvided, true);
  assert.equal(snapshot.evidence.safeguards.manualRedirectRequested, true);
  assert.equal(Object.hasOwn(snapshot.courses[0], 'providerCourseId'), false);
  assert.doesNotMatch(JSON.stringify(snapshot), /credentialLeak|onerror|alert\(1\)/);
  assert.match(snapshot.notifications[0].actionUrl, /^https:\/\/learn\.tsinghua\.edu\.cn\//);
});

test('caps course crawling at three concurrent requests', async () => {
  const authorizedFetch = createFixtureFetch({ courseCount: 6, delayMs: 8 });
  const snapshot = await syncTsinghuaLearn({
    authorizedFetch,
    maxConcurrency: 99,
    minimumRequestIntervalMs: 0,
  });

  assert.equal(snapshot.courses.length, 6);
  assert.ok(authorizedFetch.stats.maxActive >= 2);
  assert.ok(authorizedFetch.stats.maxActive <= 3);
  assert.equal(snapshot.evidence.safeguards.maximumConcurrency, 3);
});

test('reports per-resource partial failures instead of disguising them as empty data', async () => {
  const snapshot = await syncTsinghuaLearn({
    authorizedFetch: createFixtureFetch({ noticeStatus: 503 }),
    minimumRequestIntervalMs: 0,
  });

  assert.equal(snapshot.status, 'partial');
  assert.equal(snapshot.notifications.length, 0);
  assert.equal(snapshot.importantItems.length, 1);
  assert.equal(snapshot.errors.length, 1);
  assert.equal(snapshot.errors[0].code, 'upstream_unavailable');
  assert.equal(snapshot.errors[0].resource, 'notices');
});

test('fails closed when a required upstream schema landmark disappears', async () => {
  await assert.rejects(
    syncTsinghuaLearn({
      authorizedFetch: createFixtureFetch({ coursePayload: { result: [] } }),
      minimumRequestIntervalMs: 0,
    }),
    (error) => error.code === 'parser_schema_mismatch' && error.resource === '课程列表',
  );
});

test('fails closed when every notice or homework row has an invalid deadline', () => {
  const course = {
    providerCourseId: 'course_1',
    sourceReference: 'learn:course:test',
    title: 'Fixture course',
  };
  assert.throws(
    () =>
      parseNotices(
        {
          object: { aaData: [{ ggid: 'notice_1', bt: 'Notice', fbsjStr: '2026-02-30 12:00:00' }] },
        },
        course,
      ),
    (error) => error.code === 'parser_schema_mismatch' && error.resource === 'notices',
  );
  assert.throws(
    () =>
      parseHomework(
        {
          object: { aaData: [{ zyid: 'homework_1', bt: 'Homework', jzsj: 'not-a-date' }] },
        },
        course,
        'unsubmitted',
      ),
    (error) => error.code === 'parser_schema_mismatch' && error.resource === 'homework',
  );
});

test('prefers the most advanced homework status and removes stale drafts', async () => {
  const snapshot = await syncTsinghuaLearn({
    authorizedFetch: createFixtureFetch({ overlapHomeworkStatuses: true }),
    minimumRequestIntervalMs: 0,
  });

  assert.equal(snapshot.homework.length, 1);
  assert.equal(snapshot.homework[0].status, 'graded');
  assert.equal(snapshot.importantItems.length, 0);
});

test('stops scheduling more courses when the upstream rate-limits a sync', async () => {
  const authorizedFetch = createFixtureFetch({ courseCount: 8, noticeStatus: 429 });
  await assert.rejects(
    syncTsinghuaLearn({
      authorizedFetch,
      minimumRequestIntervalMs: 0,
    }),
    (error) => error.code === 'upstream_rate_limited',
  );

  assert.ok(authorizedFetch.stats.calls.length <= 5);
});

test('records cookie presence without retaining its value and rejects unbounded limits', async () => {
  const transport = new TsinghuaLearnTransport({
    authorizedFetch: async () =>
      jsonResponse(
        { ok: true },
        { headers: { 'set-cookie': 'JSESSIONID=must-not-survive; HttpOnly' } },
      ),
  });
  await transport.requestJson('semester', 'GET', SEMESTER_PATH);

  assert.equal(transport.responseEvidence[0].setCookieObserved, true);
  assert.doesNotMatch(JSON.stringify(transport.responseEvidence), /must-not-survive|JSESSIONID/);
  assert.throws(
    () =>
      new TsinghuaLearnTransport({
        authorizedFetch: async () => jsonResponse({}),
        maxRequests: Number.POSITIVE_INFINITY,
      }),
    /bounded integers/,
  );
});

test('advertises implemented and blocked connector boundaries honestly', () => {
  const capabilities = getTsinghuaConnectorCapabilities();
  const learn = capabilities.connectors.find((connector) => connector.id === 'tsinghua-learn');
  const info = capabilities.connectors.find((connector) => connector.id === 'tsinghua-info');
  const learnCapability = getLearnConnectorCapabilities();

  assert.equal(learn.crawlCore, 'implemented_fixture_validated');
  assert.equal(learn.authorization, 'awaiting_approved_session_broker');
  assert.equal(info.crawlCore, 'boundary_probe_only');
  assert.equal(capabilities.safeguards.acceptsPasswords, false);
  assert.equal(capabilities.safeguards.acceptsClientCookies, false);
  assert.equal(learn.validationState, 'fixture_only');
  assert.equal(learn.liveSyncState, 'blocked_pending_authorization');
  assert.equal(learnCapability.transport.state, 'awaiting_authorized_transport');
  assert.equal(learnCapability.transport.acceptsPasswordFromBrowser, false);
  assert.equal(learnCapability.transport.acceptsCookieFromBrowser, false);
  assert.equal(learnCapability.safeguards.maximumSyncDurationMs, 60_000);

  const directCapability = getLearnConnectorCapabilities({
    learnAuthorizedTransportConfigured: true,
    acceptsPasswordFromBrowser: true,
    authorizationStrategy: 'direct_cas',
  });
  assert.equal(directCapability.transport.state, 'configured');
  assert.equal(directCapability.transport.requiresOfficialAuthorization, false);
  assert.equal(directCapability.transport.acceptsPasswordFromBrowser, true);
  assert.equal(directCapability.safeguards.acceptsPasswords, true);

  const verifiedCapability = getLearnConnectorCapabilities({
    learnAuthorizedTransportConfigured: true,
    learnLiveSyncVerified: true,
  });
  assert.equal(verifiedCapability.validationState, 'live_account_verified');
  assert.equal(verifiedCapability.liveSyncState, 'verified');
});
