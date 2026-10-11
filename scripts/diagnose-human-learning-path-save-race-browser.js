// Independent diagnostic: installed Chrome, native buttons and the real frontend/router.
// All users, documents and path writes are explicit isolated memory fixtures.
// Delay only the memory store's first path ACK; never call AI or a production DB.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createLearningPreview } = require('./preview-learning-workspace');
const { listenAllowedLoopback } = require('./fixtures/allowed-loopback');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');

const copy = (value) => JSON.parse(JSON.stringify(value));
const digest = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const currentEditsUnsaved = (status) =>
  status === '尚未保存' || /当前调整(?:尚|还)?未保存/.test(status);
const waitForMemory = (ready, label) =>
  new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      if (ready()) return resolve();
      if (Date.now() - started > 10000) return reject(new Error(label));
      setTimeout(check, 20);
    };
    check();
  });

async function pointer(page, selector, label) {
  const handles = await page.$$(selector);
  try {
    let target;
    for (const handle of handles)
      if (!label || (await handle.evaluate((item) => item.textContent.trim())) === label) {
        target = handle;
        break;
      }
    assert.ok(target, `Actual pointer target exists: ${selector} ${label || ''}`);
    await target.evaluate((item) => item.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.waitForFunction(
      (item) => {
        const rect = item.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return rect.width > 0 && !item.disabled && (hit === item || item.contains(hit));
      },
      { timeout: 10000 },
      target,
    );
    await target.click();
  } finally {
    await Promise.all(handles.map((handle) => handle.dispose()));
  }
}

async function main() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'human-learning-path-save-race-'));
  const report = {
    mode: process.argv.includes('--require-preserved')
      ? 'require-newer-input-preserved'
      : 'diagnostic',
    boundary:
      'Installed headless Chrome with native pointer clicks, unchanged production UI and router. All auth, course and path records are isolated labelled memory fixtures; delayed memory ACK, not production DB or real learner records. No AI request, grading or star mutation.',
    scenes: [],
    observations: [],
    findings: [],
    pageErrors: [],
    writes: [],
  };
  const production = ['public/knowledge-workspace.js', 'public/learning-next-steps.js'].map(
    (file) => path.resolve(__dirname, '..', file),
  );
  const beforeHashes = production.map(digest);
  const preview = createLearningPreview();
  const create = preview.store.create.bind(preview.store);
  const update = preview.store.update.bind(preview.store);
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let heldSave;
  let delayed = false;
  let holdNextUpdate = false;
  let heldUpdate;
  let releaseUpdate;
  const heldPut = new Promise((resolve) => {
    releaseUpdate = resolve;
  });
  preview.store.create = async (...args) => {
    const result = await create(...args);
    if (!delayed && args[2].kind === 'path') {
      delayed = true;
      heldSave = { request: copy(args[2]), stored: copy(result) };
      await held;
    }
    return result;
  };
  preview.store.update = async (...args) => {
    const result = await update(...args);
    if (holdNextUpdate && args[3].kind === 'path') {
      holdNextUpdate = false;
      heldUpdate = { id: args[2], request: copy(args[3]), revision: args[4], result };
      await heldPut;
    }
    return result;
  };
  let browser;
  let base = '';
  const snapshot = (page) =>
    page.evaluate(() => ({
      steps: [...document.querySelectorAll('#learning-plan-steps [data-step-id]')].map((item) => ({
        id: item.dataset.stepId,
        title: item.querySelector('.learning-plan-copy strong').textContent,
        completed: item.classList.contains('is-complete'),
        skipped: item.classList.contains('is-skipped'),
      })),
      chain: document.getElementById('learning-plan-chain').textContent,
      status: document.getElementById('learning-plan-status').textContent,
      saveDisabled: document.getElementById('learning-plan-save').disabled,
    }));
  const normalize = (steps) =>
    steps.map(({ id, title, completed, skipped }) => ({ id, title, completed, skipped }));
  try {
    report.portSelection = await listenAllowedLoopback(preview.server);
    base = `http://127.0.0.1:${report.portSelection.port}`;
    report.base = base;
    browser = await puppeteer.launch({
      headless: true,
      executablePath:
        process.env.CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000 });
    page.on('pageerror', (error) => report.pageErrors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin !== base && !['data:', 'blob:'].includes(url.protocol))
        return request.respond({
          status: 403,
          body: 'Isolated diagnostic: external network disabled',
        });
      if (url.origin === base && request.method() !== 'GET')
        report.writes.push({
          method: request.method(),
          pathname: url.pathname,
          body: request.postData(),
        });
      return request.continue();
    });
    await page.goto(`${base}/knowledge?course=signals&point=SS-01-01&view=reading&tool=continue`, {
      waitUntil: 'networkidle0',
    });
    await page.waitForFunction(
      () =>
        window.FreeBbsLearningAssessment?.getSnapshot()?.questions.length === 2 &&
        document.querySelectorAll('#learning-plan-steps [data-step-id]').length >= 2,
    );
    if (await page.$eval('#knowledge-chat-panel', (item) => !item.classList.contains('hidden')))
      await pointer(page, '#knowledge-chat-close');
    await pointer(page, '.learning-start-adjust');
    await page.waitForSelector('.learning-start-dialog[open]', { visible: true });
    await page.select('[data-learning-start-choice="level"]', 'new');
    await page.select('[data-learning-start-choice="goal"]', 'concepts');
    await pointer(page, '.learning-start-apply');
    await page.waitForFunction(() => !document.querySelector('.learning-start-dialog[open]'));
    await pointer(page, '[data-knowledge-tool="continue"]');
    await page.waitForFunction(
      () => document.querySelector('[data-knowledge-page]').dataset.learningTool === 'continue',
    );
    await pointer(page, '#learning-plan-editor > summary');
    const pathA = await snapshot(page);
    assert.ok(pathA.steps.length >= 2);
    assert.equal(
      pathA.steps.some((step) => step.completed || step.skipped),
      false,
    );
    await pointer(page, '#learning-plan-save');
    await page.waitForFunction(() => document.getElementById('learning-plan-save').disabled);
    await waitForMemory(() => heldSave, 'Actual memory create ACK was not held');
    assert.deepEqual(normalize(heldSave.request.path), pathA.steps);
    const firstId = pathA.steps[0].id;
    const firstSelector = `#learning-plan-steps [data-step-id="${firstId}"]`;
    const editability = await page.$eval(firstSelector, (item) =>
      [...item.querySelectorAll('button')].map((button) => ({
        label: button.textContent.trim(),
        disabled: button.disabled,
      })),
    );
    assert.equal(editability.find((button) => button.label === '完成').disabled, false);
    assert.equal(editability.find((button) => button.label === '↓').disabled, false);
    await pointer(page, `${firstSelector} button`, '完成');
    await pointer(page, `${firstSelector} button`, '↓');
    const pathB = await snapshot(page);
    assert.notDeepEqual(pathB.steps, pathA.steps);
    assert.equal(pathB.steps[1].id, firstId);
    assert.equal(pathB.steps[1].completed, true);
    assert.equal(pathB.status, '尚未保存');
    assert.equal(pathB.saveDisabled, true);
    await page.screenshot({ path: path.join(output, 'path-B-before-old-ACK.png') });
    release();
    await page.waitForFunction(() => !document.getElementById('learning-plan-save').disabled);
    const afterAck = await snapshot(page);
    const savedA = copy(preview.store.rows.find((row) => row.kind === 'path'));
    assert.deepEqual(normalize(savedA.path), pathA.steps);
    const preserved = JSON.stringify(afterAck.steps) === JSON.stringify(pathB.steps);
    report.observations.push({ kind: 'POST', pathA, pathB, afterAck, preserved });
    if (!preserved) {
      assert.deepEqual(
        afterAck.steps,
        pathA.steps,
        'The previous A, not an unrelated update, overwrote B',
      );
      report.findings.push({
        id: 'late-path-save-ack-overwrites-newer-human-adjustment',
        source:
          'public/knowledge-workspace.js:717 changePlan; :994 only save disabled; :1049-1052 ACK clears planDirty then loadEntries; :680 refreshPlan reads saved A',
        reproduction:
          'Native click 保存路径 for A; memory router stores A but holds ACK; click 完成 and ↓ to form B; release old ACK. B disappears, completed mark and reorder revert to A, status says 已保存.',
        impact:
          'A reader can legitimately continue arranging or marking their plan while saving. Their visible new input is silently lost and the saved label incorrectly looks like an acknowledgement of B.',
      });
    } else assert.equal(currentEditsUnsaved(afterAck.status), true);
    await page.screenshot({ path: path.join(output, 'after-old-ACK.png') });
    // Verify the desired B remains saveable through the same actual UI. On a
    // vulnerable build a person must recreate the vanished edits; do not fake state.
    if (!preserved) {
      await pointer(page, `${firstSelector} button`, '完成');
      await pointer(page, `${firstSelector} button`, '↓');
    }
    assert.deepEqual((await snapshot(page)).steps, pathB.steps);
    await pointer(page, '#learning-plan-save');
    await page.waitForFunction(
      () =>
        document.getElementById('learning-plan-status').textContent === '已保存' &&
        !document.getElementById('learning-plan-save').disabled,
    );
    const savedB = copy(preview.store.rows.find((row) => row.kind === 'path'));
    assert.deepEqual(normalize(savedB.path), pathB.steps);
    assert.equal(savedB.id, savedA.id);
    assert.equal(savedB.revision, savedA.revision + 1);
    assert.deepEqual((await snapshot(page)).steps, pathB.steps);
    report.scenes.push({
      name: 'save A; continue native completion and reordering as B before ACK; receive old ACK; save B',
      pathA,
      editability,
      pathB,
      afterAck,
      newEditsPreserved: preserved,
      hadToRecreateLostEdits: !preserved,
      savedA: { id: savedA.id, revision: savedA.revision, path: normalize(savedA.path) },
      savedB: { id: savedB.id, revision: savedB.revision, path: normalize(savedB.path) },
    });

    // An existing path uses PUT. Keep the same actual record and revision;
    // submit A2, then edit B2 while its successfully stored ACK is held.
    const thirdId = pathA.steps[2].id;
    const thirdSelector = `#learning-plan-steps [data-step-id="${thirdId}"]`;
    await pointer(page, `${thirdSelector} button`, '跳过');
    const putA = await snapshot(page);
    assert.equal(putA.steps.find((step) => step.id === thirdId).skipped, true);
    holdNextUpdate = true;
    await pointer(page, '#learning-plan-save');
    await waitForMemory(() => heldUpdate, 'Actual memory update ACK was not held');
    assert.equal(heldUpdate.id, savedB.id);
    assert.equal(heldUpdate.revision, savedB.revision);
    assert.equal(heldUpdate.result, true);
    assert.deepEqual(normalize(heldUpdate.request.path), putA.steps);
    await pointer(page, `${firstSelector} button`, '撤销完成');
    await pointer(page, `${firstSelector} button`, '↑');
    const putB = await snapshot(page);
    assert.notDeepEqual(putB.steps, putA.steps);
    assert.equal(putB.steps[0].id, firstId);
    assert.equal(putB.steps[0].completed, false);
    assert.equal(putB.saveDisabled, true);
    releaseUpdate();
    await page.waitForFunction(() => !document.getElementById('learning-plan-save').disabled);
    const putAfterAck = await snapshot(page);
    const storedPutA = copy(preview.store.rows.find((row) => row.kind === 'path'));
    report.observations.push({ kind: 'PUT', putA, putB, putAfterAck });
    assert.deepEqual(normalize(storedPutA.path), putA.steps);
    assert.equal(storedPutA.revision, savedB.revision + 1);
    assert.deepEqual(
      putAfterAck.steps,
      putB.steps,
      'Existing PUT ACK must preserve newer completion and ordering',
    );
    assert.equal(currentEditsUnsaved(putAfterAck.status), true);
    await pointer(page, '#learning-plan-save');
    await page.waitForFunction(
      () =>
        document.getElementById('learning-plan-status').textContent === '已保存' &&
        !document.getElementById('learning-plan-save').disabled,
    );
    const storedPutB = copy(preview.store.rows.find((row) => row.kind === 'path'));
    assert.equal(storedPutB.id, savedB.id);
    assert.equal(storedPutB.revision, storedPutA.revision + 1);
    assert.deepEqual(normalize(storedPutB.path), putB.steps);
    assert.deepEqual((await snapshot(page)).steps, putB.steps);
    report.scenes.push({
      name: 'existing path PUT A2; native undo-completion and reorder B2 before ACK; save B2 against confirmed base',
      putA,
      putB,
      putAfterAck,
      id: storedPutB.id,
      submittedRevision: heldUpdate.revision,
      confirmedARevision: storedPutA.revision,
      savedBRevision: storedPutB.revision,
    });

    // No edit during save: the old normal acknowledgement remains unambiguous.
    const normalA = await snapshot(page);
    await pointer(page, '#learning-plan-save');
    await page.waitForFunction(
      () =>
        document.getElementById('learning-plan-status').textContent === '已保存' &&
        !document.getElementById('learning-plan-save').disabled,
    );
    const normalAfter = await snapshot(page);
    const storedNormal = copy(preview.store.rows.find((row) => row.kind === 'path'));
    assert.equal(normalAfter.status, '已保存');
    assert.deepEqual(normalAfter.steps, normalA.steps);
    assert.equal(storedNormal.id, storedPutB.id);
    assert.equal(storedNormal.revision, storedPutB.revision + 1);
    assert.deepEqual(normalize(storedNormal.path), normalA.steps);
    assert.equal(preview.store.rows.filter((row) => row.kind === 'path').length, 1);
    report.scenes.push({
      name: 'normal unchanged path save remains saved with one record',
      normalA,
      normalAfter,
      revision: storedNormal.revision,
    });

    assert.equal(preview.requests.length, 0, 'No simulated or real AI request');
    assert.equal(preview.assessmentStore.rows.length, 0, 'No grading records');
    assert.equal(preview.starsStore.rows.length, 0, 'No stars');
    assert.equal(report.writes.length, 5, 'Only five isolated path saves');
    assert.deepEqual(
      report.writes.map((item) => item.method),
      ['POST', 'PUT', 'PUT', 'PUT', 'PUT'],
    );
    const submittedWrites = report.writes.map((item) => JSON.parse(item.body));
    assert.notEqual(
      submittedWrites[0].requestKey,
      submittedWrites[1].requestKey,
      'B gets a new submit identity',
    );
    assert.notEqual(
      submittedWrites[2].requestKey,
      submittedWrites[3].requestKey,
      'Newer PUT edits get a new submit identity',
    );
    assert.deepEqual(
      submittedWrites.slice(1).map((item) => item.revision),
      [1, 2, 3, 4],
    );
    assert.equal(report.pageErrors.length, 0);
  } catch (error) {
    report.error = error.stack || String(error);
    report.portSelection ||= error.portSelection;
    process.exitCode = 1;
  } finally {
    release();
    releaseUpdate();
    if (browser) await browser.close();
    if (preview.server.listening)
      await new Promise((resolve) => {
        preview.server.close(resolve);
      });
    report.productionUnchanged = production.every(
      (file, index) => digest(file) === beforeHashes[index],
    );
    if (!report.productionUnchanged) process.exitCode = 1;
    report.cleanup = {
      browserClosed: !browser || !browser.connected,
      serverClosed: !preview.server.listening,
    };
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(
      JSON.stringify(
        {
          output,
          scenes: report.scenes.length,
          findings: report.findings,
          error: report.error,
          portSelection: report.portSelection,
          cleanup: report.cleanup,
        },
        null,
        2,
      ),
    );
    if (report.findings.length && process.argv.includes('--require-preserved') && !process.exitCode)
      process.exitCode = 1;
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
