const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createModerationRouter } = require('./moderation-router');

async function fixture(t) {
  const app = express();
  app.use(express.json());
  let paused = true;
  let enabled = true;
  const controls = [];
  const withdrawals = [];
  const status = () => ({
    enabled,
    paused: !enabled || paused,
    model: 'qwen3.6-27b',
    backupModel: 'glm-5.1',
  });
  const denied = (message) => Object.assign(new Error(message), { status: 403 });
  const automation = {
    get enabled() {
      return enabled;
    },
    status,
    store: {
      async setPaused({ actorId, paused: next }) {
        if (actorId !== 1) throw denied('需要管理员权限');
        controls.push(next);
        paused = next;
      },
      async get({ id, reviewerId }) {
        if (![1, 2].includes(reviewerId)) throw denied('需要审核负责人权限');
        return { id: 'job-1', submissionId: id, state: 'published', canWithdraw: true };
      },
      async withdraw(input) {
        if (![1, 2].includes(input.reviewerId)) throw denied('需要审核负责人权限');
        withdrawals.push(input);
      },
    },
  };
  app.use(
    '/api/moderation',
    createModerationRouter({
      enabled: true,
      aiTest: { enabled: true },
      service: {
        isReviewer: async (id) => [1, 2].includes(id),
        detail: async ({ id, userId }) => {
          assert.ok([1, 2].includes(userId));
          return {
            id,
            status: 'rejected',
            version: 3,
            payload: { content: '合成文字' },
            reason: '人工撤回',
          };
        },
      },
      automation,
      requireAuth: async (req, res) => {
        const id = Number(req.headers['x-test-user']);
        if (![1, 2, 3].includes(id)) {
          res.status(401).json({ message: '请登录' });
          return null;
        }
        return { id, is_admin: id === 1 };
      },
    }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => {
    server.once('listening', resolve);
  });
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
      }),
  );
  const base = `http://127.0.0.1:${server.address().port}/api/moderation`;
  return {
    controls,
    withdrawals,
    disable: () => {
      enabled = false;
    },
    request: (url, user = 1, body = undefined) =>
      fetch(base + url, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', 'x-test-user': String(user) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
  };
}

test('automatic moderation routes expose paused state and delegate pause authority without trusting client roles', async (t) => {
  const h = await fixture(t);
  const session = await (await h.request('/session')).json();
  assert.equal(session.mode, 'automatic_test');
  assert.deepEqual(session.automation, {
    enabled: true,
    paused: true,
    model: 'qwen3.6-27b',
    backupModel: 'glm-5.1',
  });
  assert.equal((await h.request('/automation/control', 0, { paused: false })).status, 401);
  assert.equal((await h.request('/automation/control', 2, { paused: false })).status, 403);
  assert.equal(
    (await h.request('/automation/control', 3, { paused: false, isAdmin: true })).status,
    400,
  );
  assert.equal((await h.request('/automation/control', 1, { paused: 'false' })).status, 400);
  assert.deepEqual(h.controls, []);
  const changed = await h.request('/automation/control', 1, { paused: false });
  assert.equal(changed.status, 200);
  assert.equal((await changed.json()).automation.paused, false);
  h.disable();
  assert.equal((await h.request('/session').then((r) => r.json())).mode, 'manual');
  assert.equal((await h.request('/automation/control', 1, { paused: false })).status, 503);
  assert.deepEqual(h.controls, [false]);
});

test('automatic history and withdrawal stay reviewer-only and available after automation is disabled', async (t) => {
  const h = await fixture(t);
  h.disable();
  assert.equal((await h.request('/submissions/s1/automation', 3)).status, 403);
  assert.equal((await h.request('/submissions/s1/automation', 2)).status, 200);
  const body = { expectedVersion: 2, reason: '人工复核后撤回', requestId: 'test-request-1' };
  assert.equal((await h.request('/submissions/s1/withdraw', 3, body)).status, 403);
  assert.equal(
    (await h.request('/submissions/s1/withdraw', 2, { ...body, reviewerId: 1 })).status,
    400,
  );
  assert.equal(
    (await h.request('/submissions/s1/withdraw', 2, { ...body, decision: 'approved' })).status,
    400,
  );
  assert.deepEqual(h.withdrawals, []);
  const response = await h.request('/submissions/s1/withdraw', 2, body);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.submission.status, 'rejected');
  assert.equal(result.submission.contentMarkdown, '合成文字');
  assert.deepEqual(h.withdrawals, [{ ...body, id: 's1', reviewerId: 2 }]);
});
