// Scoped read-only load diagnostics. Faults are intercepted; successes/404 use local HTTP.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');

async function main() {
  const base = new URL(process.env.LEARNING_PREVIEW_URL || process.argv[2]);
  const expectedFixed = process.argv.includes('--expected-fixed');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname));
  const output =
    process.env.LEARNING_QA_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'human-load-states-'));
  fs.mkdirSync(output, { recursive: true });
  const report = {
    expectedFixed,
    boundary:
      'Actual Chrome/production modules, existing memory/relations preview. 503 and delay are explicitly simulated request interception; release/reload successes and unknown-ID 404 are local HTTP, not production network/DB evidence. No fabricated success payload or storage seed, no submitted answers or earned-star fixture. Non-GET/AI/external blocked. Expected default process-record POSTs are suppressed and reported separately, not treated as user answer or AI mutations.',
    cases: [],
    requests: [],
    responses: [],
    blocked: [],
    suppressedDefaultRecords: [],
    pageErrors: [],
  };
  const browser = await puppeteer.launch({
    headless: true,
    protocolTimeout: 10000,
    executablePath:
      process.env.CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  });
  try {
    for (const scenario of [
      {
        name: 'knowledge-node-503',
        target: '/api/courses/signals/map/nodes/SS-02-01',
        kind: '503',
        page: 'knowledge',
      },
      {
        name: 'knowledge-map-503',
        target: '/api/courses/signals/map',
        kind: '503',
        page: 'knowledge',
      },
      {
        name: 'knowledge-node-delay',
        target: '/api/courses/signals/map/nodes/SS-02-01',
        kind: 'delay',
        page: 'knowledge',
      },
      {
        name: 'knowledge-map-delay',
        target: '/api/courses/signals/map',
        kind: 'delay',
        page: 'knowledge',
      },
      {
        name: 'knowledge-unknown-id',
        target: '/api/courses/signals/map/nodes/SS-99-99',
        kind: '404',
        page: 'knowledge',
        point: 'SS-99-99',
      },
      { name: 'course-map-503', target: '/api/courses/signals/map', kind: '503', page: 'course' },
      {
        name: 'course-map-delay',
        target: '/api/courses/signals/map',
        kind: 'delay',
        page: 'course',
      },
      {
        name: 'course-unknown-id',
        target: '/api/courses/qa-missing-course/map',
        kind: '404',
        page: 'course',
        course: 'qa-missing-course',
      },
    ]) {
      const page = await browser.newPage();
      page.setDefaultTimeout(12000);
      await page.setViewport({ width: 1440, height: 960 });
      const result = { ...scenario, snapshots: [], checks: [] };
      report.cases.push(result);
      let stage = 'baseline-A';
      let armed = false;
      let held = null;
      let intercepted = 0;
      let targetCount = 0;
      await page.setRequestInterception(true);
      page.on('pageerror', (error) =>
        report.pageErrors.push({ case: scenario.name, message: error.message }),
      );
      page.on('response', (response) => {
        const url = new URL(response.url());
        if (url.pathname.startsWith('/api/'))
          report.responses.push({
            case: scenario.name,
            stage,
            path: url.pathname,
            status: response.status(),
            fromCache: response.fromCache(),
          });
      });
      page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.origin !== base.origin && !['data:', 'blob:'].includes(url.protocol))
          return request.respond({ status: 403, body: 'External services disabled' });
        if (url.pathname.startsWith('/api/')) {
          const record = {
            case: scenario.name,
            stage,
            method: request.method(),
            path: url.pathname,
          };
          report.requests.push(record);
          if (request.method() === 'POST' && url.pathname === '/api/learning-analytics/events') {
            report.suppressedDefaultRecords.push(record);
            return request.respond({
              status: 403,
              body: 'Read-only QA: default process record suppressed',
            });
          }
          if (request.method() !== 'GET' || /\/ai\//.test(url.pathname)) {
            report.blocked.push(record);
            return request.respond({ status: 403, body: 'Read-only load QA' });
          }
          if (stage !== 'baseline-A' && url.pathname === scenario.target) targetCount += 1;
          if (
            armed &&
            intercepted === 0 &&
            url.pathname === scenario.target &&
            scenario.kind !== '404'
          ) {
            intercepted += 1;
            if (scenario.kind === 'delay') {
              held = request;
              return undefined;
            }
            return request.respond({
              status: 503,
              contentType: 'application/json',
              body: JSON.stringify({ message: 'QA模拟首次503：服务暂时不可用，请刷新重试。' }),
            });
          }
        }
        return request.continue();
      });
      const state = () =>
        page.evaluate(() => {
          const assessment = window.FreeBbsLearningAssessment?.getSnapshot?.();
          const maxContext =
            window.freeBbsKnowledge?.buildRequest?.('QA read-only context').context;
          const readingEntry = document.querySelector('#knowledge-start-reading');
          const reading = document.querySelector('#knowledge-reading');
          return {
            url: window.location.href,
            node: window.freeBbsKnowledge?.getLearningContext?.().node?.id || null,
            assessmentLoaded: assessment?.loaded || false,
            questionIds: (assessment?.questions || []).map((item) => item.id),
            practiceIds: (assessment?.practiceQuestions || []).map((item) => item.id),
            attemptIds: (assessment?.attempts || []).map((item) => item.id),
            currentAttemptIds: (assessment?.currentAttempts || []).map((item) => item.id),
            earnedPointStars: document.querySelectorAll('#learning-selftest-stars .is-earned')
              .length,
            pointStars:
              document.querySelector('#learning-selftest-stars')?.textContent.trim() || '',
            currentRecord:
              window.FreeBbsLearningProgress?.read(
                localStorage,
                'free_bbs_current_learning_node_v1',
                window.freeBbsApp?.userState,
              ) || {},
            pageError: document.querySelector('.course-material-error')?.textContent.trim() || '',
            title:
              document.querySelector('#knowledge-title')?.textContent.trim() ||
              document.querySelector('#course-reader-title')?.textContent.trim() ||
              '',
            maxContext: maxContext
              ? {
                  id: maxContext.knowledgePointId,
                  title: maxContext.knowledgePointTitle,
                  summary: maxContext.knowledgePointSummary,
                  markdownLength: maxContext.knowledgePointMarkdown.length,
                }
              : null,
            readingEntry: readingEntry
              ? {
                  visible: readingEntry.checkVisibility({
                    checkVisibilityCSS: true,
                    checkOpacity: true,
                  }),
                  disabled: readingEntry.disabled,
                  text: readingEntry.textContent.trim(),
                }
              : null,
            courseStatus: document.querySelector('#course-map-status')?.textContent.trim() || '',
            readingBody: reading
              ? {
                  visible: reading.checkVisibility({
                    checkVisibilityCSS: true,
                    checkOpacity: true,
                  }),
                  text: document.querySelector('#knowledge-body')?.textContent.trim() || '',
                }
              : null,
            busy: document.querySelector('[data-knowledge-page]')?.getAttribute('aria-busy'),
            originPlaceholder:
              document.querySelector('#knowledge-history-empty')?.textContent.trim() || '',
            previousTitle:
              document.querySelector('#knowledge-previous-title')?.textContent.trim() || '',
            nextTitle: document.querySelector('#knowledge-next-title')?.textContent.trim() || '',
            sequenceDisabled: ['knowledge-previous-link', 'knowledge-next-link'].map((id) =>
              document.getElementById(id)?.getAttribute('aria-disabled'),
            ),
            structure:
              document.getElementById('course-map-canvas')?.courseStructureController?.getState() ||
              null,
          };
        });
      const capture = async (name) => {
        const snapshot = await state();
        const filename = path.join(output, `${scenario.name}-${name}.png`);
        await page.screenshot({ path: filename });
        result.snapshots.push({ name, ...snapshot, screenshot: filename });
        return snapshot;
      };
      const noFalsePointSuccess = (snapshot) => {
        assert.equal(snapshot.node, null);
        assert.equal(snapshot.assessmentLoaded, false);
        assert.deepEqual(snapshot.questionIds, []);
        assert.deepEqual(snapshot.practiceIds, []);
        assert.deepEqual(snapshot.attemptIds, []);
        assert.deepEqual(snapshot.currentAttemptIds, []);
        assert.equal(snapshot.earnedPointStars, 0);
        assert.equal(snapshot.pointStars, '');
        assert.notEqual(snapshot.title, result.baseline.title);
        assert.equal(snapshot.maxContext.id, scenario.point || 'SS-02-01');
        assert.equal(snapshot.maxContext.title, '');
        assert.equal(snapshot.maxContext.summary, '');
        assert.equal(snapshot.maxContext.markdownLength, 0);
        assert.equal(
          snapshot.currentRecord.signals,
          'SS-01-01',
          'Previous real current remains history, not new-point success',
        );
      };
      try {
        await page.goto(`${base.origin}/knowledge?course=signals&point=SS-01-01&view=reading`, {
          waitUntil: 'domcontentloaded',
        });
        await page.waitForFunction(
          () =>
            window.freeBbsKnowledge?.getLearningContext().node?.id === 'SS-01-01' &&
            window.FreeBbsLearningAssessment?.getSnapshot().loaded,
        );
        result.baseline = await state();
        assert.equal(result.baseline.currentRecord.signals, 'SS-01-01');
        stage = 'initial-target';
        armed = true;
        const slug = scenario.course || 'signals';
        const point = scenario.point || 'SS-02-01';
        const href =
          scenario.page === 'knowledge'
            ? `${base.origin}/knowledge?course=${slug}&point=${point}&view=reading`
            : `${base.origin}/course?course=${slug}`;
        await page.goto(href, { waitUntil: 'domcontentloaded' });
        if (scenario.kind === 'delay') {
          await page.waitForFunction(
            () =>
              window.freeBbsApp &&
              (window.freeBbsKnowledge || document.querySelector('[data-course-map-page]')),
          );
          for (let count = 0; count < 50 && !held; count += 1)
            await new Promise((resolve) => {
              setTimeout(resolve, 20);
            });
          assert.ok(held, 'The intended GET must actually be held');
          const pending = await capture('pending');
          if (scenario.page === 'knowledge') noFalsePointSuccess(pending);
          else {
            assert.equal(pending.structure, null);
            assert.match(pending.courseStatus, /正在载入/);
          }
          assert.equal(targetCount, 1);
          result.checks.push(
            'Held GET has no false successful point/map, old questions/point stars, or new current record',
          );
          if (scenario.page === 'knowledge' && pending.readingEntry?.visible) {
            if (expectedFixed) {
              assert.equal(pending.readingEntry.disabled, true);
              assert.equal(pending.busy, 'true');
              assert.match(pending.title, /正在载入/);
              assert.match(pending.originPlaceholder, /正在载入/);
              assert.match(pending.previousTitle, /正在载入/);
              assert.match(pending.nextTitle, /正在载入/);
              assert.deepEqual(pending.sequenceDisabled, ['true', 'true']);
              assert.equal(pending.readingBody.visible, false);
            }
            await page.click('#knowledge-start-reading');
            const afterReadingClick = await capture('pending-after-reading-entry');
            noFalsePointSuccess(afterReadingClick);
            assert.equal(afterReadingClick.readingBody.visible, !expectedFixed);
            assert.equal(afterReadingClick.readingBody.text, '');
            if (expectedFixed)
              result.checks.push(
                'Pending entry is disabled; native click cannot reveal empty reading, and origin/sequence honestly remain loading',
              );
            else
              result.observations = [
                'While GET is still held, the enabled reading entry opens an empty body; it does not falsely save the new current point. This is loading-control usability evidence, not old-content leakage.',
              ];
          }
          armed = false;
          await held.continue();
          held = null;
        } else {
          await page.waitForFunction(
            (kind) =>
              kind === 'knowledge'
                ? Boolean(document.querySelector('.course-material-error'))
                : document.querySelector('#course-map-status')?.classList.contains('is-error'),
            {},
            scenario.page,
          );
          const failed = await capture('failed');
          if (scenario.page === 'knowledge') {
            noFalsePointSuccess(failed);
            assert.ok(failed.pageError);
            assert.equal(failed.readingEntry, null);
            if (expectedFixed) {
              assert.equal(failed.busy, 'false');
              const recovery = await page.evaluate(() => {
                const reload = document.getElementById('knowledge-reload-page');
                const back = document.getElementById('knowledge-error-return');
                return {
                  reloadTag: reload?.tagName,
                  reloadType: reload?.getAttribute('type'),
                  reloadVisible: reload?.checkVisibility({ checkVisibilityCSS: true }),
                  backTag: back?.tagName,
                  backVisible: back?.checkVisibility({ checkVisibilityCSS: true }),
                  backHref: back?.href,
                };
              });
              assert.equal(recovery.reloadTag, 'BUTTON');
              assert.equal(recovery.reloadType, 'button');
              assert.equal(recovery.reloadVisible, true);
              assert.equal(recovery.backTag, 'A');
              assert.equal(recovery.backVisible, true);
              const returnUrl = new URL(recovery.backHref);
              assert.equal(returnUrl.origin, base.origin);
              assert.equal(
                returnUrl.pathname,
                '/world',
                'An unconfirmed failed course must return to the internal learning world',
              );
              // Use actual Tab navigation rather than programmatic focus or clicking a hidden target.
              for (let tab = 0; tab < 80; tab += 1) {
                await page.keyboard.press('Tab');
                if (
                  (await page.evaluate(() => document.activeElement?.id)) ===
                  'knowledge-reload-page'
                )
                  break;
              }
              assert.equal(
                await page.evaluate(() => document.activeElement?.id),
                'knowledge-reload-page',
                'The reload action must be reachable by native keyboard navigation',
              );
              await page.keyboard.press('Tab');
              assert.equal(
                await page.evaluate(() => document.activeElement?.id),
                'knowledge-error-return',
              );
              await page.keyboard.down('Shift');
              await page.keyboard.press('Tab');
              await page.keyboard.up('Shift');
              assert.equal(
                await page.evaluate(() => document.activeElement?.id),
                'knowledge-reload-page',
              );
              result.checks.push(
                'Error recovery has visible native controls, an internal safe return and actual Tab/Shift+Tab access',
              );
            }
          } else {
            assert.equal(failed.structure, null);
            assert.ok(failed.courseStatus);
          }
          assert.equal(targetCount, 1, 'No automatic repeated initial map/node GET');
          result.checks.push(
            'Explicit failure, no false old successful point/map, one initial GET and no model loop',
          );
          if (scenario.kind === '404') {
            const actual = report.responses.find(
              (entry) =>
                entry.case === scenario.name &&
                entry.stage === 'initial-target' &&
                entry.path === scenario.target,
            );
            assert.equal(actual?.status, 404, 'Unknown ID must actually return local HTTP 404');
            result.checks.push('Unknown ID is local HTTP 404, not an invented success fixture');
            continue;
          }
          armed = false;
          stage = 'manual-refresh';
          if (scenario.page === 'knowledge' && expectedFixed) {
            await Promise.all([
              page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
              scenario.name === 'knowledge-node-503'
                ? page.click('#knowledge-reload-page')
                : page.keyboard.press('Enter'),
            ]);
            result.checks.push(
              'Explicit native recovery action reloads without an automatic retry',
            );
          } else await page.reload({ waitUntil: 'domcontentloaded' });
        }
        if (scenario.page === 'knowledge') {
          await page.waitForFunction(
            (id) =>
              window.freeBbsKnowledge?.getLearningContext().node?.id === id &&
              window.FreeBbsLearningAssessment?.getSnapshot().loaded,
            {},
            point,
          );
          const success = await capture('success');
          assert.equal(success.node, point);
          assert.equal(success.currentRecord.signals, point);
          assert.equal(success.pageError, '');
          assert.notEqual(success.title, result.baseline.title);
          assert.equal(success.maxContext.id, point);
          assert.equal(success.maxContext.title, success.title);
          if (expectedFixed) {
            assert.equal(success.busy, 'false');
            assert.equal(success.readingEntry.disabled, false);
            assert.match(success.readingEntry.text, /开始阅读正文/);
            assert.equal(success.readingBody.visible, true);
            await page.click('#knowledge-return-overview');
            const overview = await capture('success-overview');
            assert.equal(overview.readingEntry.visible, true);
            assert.equal(overview.readingEntry.disabled, false);
            assert.equal(overview.readingBody.visible, false);
            await page.click('#knowledge-start-reading');
            const resumed = await capture('success-reading-resumed');
            assert.equal(resumed.readingBody.visible, true);
            assert.equal(resumed.node, point);
            assert.equal(resumed.currentRecord.signals, point);
            result.checks.push('Loaded reading/overview controls recover through native clicks');
          }
          assert.ok(success.questionIds.every((id) => id.startsWith(`${point}-`)));
          assert.ok(success.practiceIds.every((id) => id.startsWith(`${point}-`)));
          const companionPath =
            scenario.target === '/api/courses/signals/map'
              ? `/api/courses/signals/map/nodes/${point}`
              : '/api/courses/signals/map';
          assert.ok(
            report.responses.some(
              (entry) =>
                entry.case === scenario.name &&
                entry.stage === 'initial-target' &&
                entry.path === companionPath &&
                entry.status === 200 &&
                !entry.fromCache,
            ),
            'Parallel companion GET actually succeeded over local HTTP in the initial fault stage',
          );
        } else {
          await page.waitForSelector('#course-map-canvas .course-structure');
          const success = await capture('success');
          assert.ok(success.structure);
          assert.equal(success.courseStatus, '');
          assert.equal(success.currentRecord.signals, 'SS-01-01');
        }
        assert.equal(targetCount, scenario.kind === '503' ? 2 : 1);
        result.checks.push(
          scenario.kind === '503'
            ? 'Manual refresh uses local HTTP and restores the exact current target'
            : 'Released GET succeeds via local HTTP and only then loads the exact target',
        );
      } catch (error) {
        result.error = error.stack || error.message;
        await capture('diagnostic-error').catch(() => {});
      } finally {
        if (held) await held.abort().catch(() => {});
        await page.close();
      }
      console.log(
        JSON.stringify({
          case: scenario.name,
          checks: result.checks.length,
          error: result.error || null,
        }),
      );
    }
  } finally {
    await browser.close();
    report.passed =
      report.cases.every((item) => !item.error) &&
      !report.blocked.length &&
      !report.pageErrors.length;
    const filename = path.join(output, 'load-states-report.json');
    fs.writeFileSync(filename, `${JSON.stringify(report, null, 2)}\n`);
    console.log(
      JSON.stringify({
        report: filename,
        passed: report.passed,
        cases: report.cases.length,
        blocked: report.blocked,
        suppressedDefaultRecords: report.suppressedDefaultRecords,
        pageErrors: report.pageErrors,
      }),
    );
    if (!report.passed) process.exitCode = 1;
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
