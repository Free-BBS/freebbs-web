const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const test = require('node:test');
const {
  policy,
  assertPrivacyAcknowledgement,
  createPrivacyPolicyService,
  ensurePrivacyPolicySchema,
} = require('./privacy-policy');

const acceptedBody = () => ({
  privacyAccepted: true,
  privacyPolicyVersion: policy.version,
  privacyPolicyHash: policy.contentHash,
});
function setup() {
  const rows = new Map();
  const writes = [];
  const pool = {
    async execute(sql, params) {
      if (sql.startsWith('SELECT'))
        return [[...(rows.has(params[0]) ? [rows.get(params[0])] : [])]];
      writes.push({ sql, params });
      const previous = rows.get(params[0]);
      rows.set(params[0], {
        content_sha256: params[2],
        accepted_at: previous?.content_sha256 === params[2] ? previous.accepted_at : 'first-time',
        last_confirmed_at: 'current-time',
      });
      return [{ affectedRows: 1 }];
    },
  };
  return { rows, writes, pool, service: createPrivacyPolicyService({ pool }) };
}

test('published policy preserves every paragraph and collection row of the current draft body', () => {
  const draft = fs.readFileSync(path.join(__dirname, '../docs/privacy-policy-draft.md'), 'utf8');
  const body = draft.slice(draft.indexOf('## 一 适用范围和联系我们')).replace(/\r\n/g, '\n').trim();
  assert.equal(policy.markdown, body);
  assert.equal(policy.contentHash, crypto.createHash('sha256').update(body).digest('hex'));
  assert.equal((policy.html.match(/<h2 /g) || []).length, 10);
  assert.match(policy.html, /<table>/);
  assert.doesNotMatch(policy.html, /尚未生效|审阅说明|审阅稿 v0/);
  for (const heading of ['个人信息收集与使用清单', '四-外部模型及其他服务', '七-保存和删除'])
    assert.ok(policy.html.includes(`id="${heading}"`));
});

test('consent requires explicit true and the exact published version and content hash', () => {
  for (const privacyAccepted of [undefined, false, 'true', 1])
    assert.throws(() => assertPrivacyAcknowledgement({ ...acceptedBody(), privacyAccepted }), {
      code: 'privacy_policy_required',
      status: 428,
    });
  for (const change of [{ privacyPolicyVersion: 'old' }, { privacyPolicyHash: '0'.repeat(64) }])
    assert.throws(() => assertPrivacyAcknowledgement({ ...acceptedBody(), ...change }), {
      code: 'privacy_policy_changed',
      status: 428,
    });
  assert.doesNotThrow(() => assertPrivacyAcknowledgement(acceptedBody()));
});

test('a first or existing unrecorded account must read full policy; login checkbox does not create acceptance', async () => {
  const h = setup();
  const result = await h.service.confirmLogin(7, acceptedBody());
  assert.equal(result.accepted, false);
  assert.equal(result.requiresFullPolicy, true);
  assert.equal(h.writes.length, 0);
  await assert.rejects(h.service.requireAccepted(7), { code: 'privacy_policy_required' });
});

test('recorded full acceptance is per account, durable and idempotent', async () => {
  const h = setup();
  await h.service.accept(7, acceptedBody());
  const first = (await h.service.status(7)).acceptedAt;
  await h.service.accept(7, acceptedBody());
  assert.equal((await h.service.status(7)).acceptedAt, first);
  assert.equal((await h.service.requireAccepted(7)).accepted, true);
  assert.equal((await h.service.status(8)).accepted, false);
  assert.match(h.writes[0].sql, /ON DUPLICATE KEY UPDATE/);
  assert.match(
    h.writes[0].sql,
    /accepted_at = IF\(content_sha256 = VALUES\(content_sha256\), accepted_at/,
  );
});

test('returning login must still provide an unchecked-by-default acknowledgement on every request', async () => {
  const h = setup();
  await h.service.accept(7, acceptedBody());
  await assert.rejects(h.service.confirmLogin(7, {}), { code: 'privacy_policy_required' });
  assert.equal((await h.service.confirmLogin(7, acceptedBody())).requiresFullPolicy, false);
  assert.equal(h.writes.length, 2);
});

test('a different content hash never satisfies current consent, even when version matches', async () => {
  const h = setup();
  h.rows.set(7, { content_sha256: '0'.repeat(64), accepted_at: 'old' });
  assert.equal((await h.service.status(7)).accepted, false);
  await assert.rejects(h.service.requireAccepted(7), { code: 'privacy_policy_required' });
});

test('denial or outdated consent never writes and unavailable storage fails closed', async () => {
  const h = setup();
  await assert.rejects(h.service.accept(7, { ...acceptedBody(), privacyAccepted: false }));
  assert.equal(h.writes.length, 0);
  h.pool.execute = async () => {
    throw new Error('database unavailable');
  };
  await assert.rejects(h.service.requireAccepted(7), /database unavailable/);
});

test('schema creation coalesces concurrent startup and retries failures', async () => {
  let count = 0;
  const pool = {
    async query(sql) {
      count += 1;
      assert.match(sql, /CREATE TABLE IF NOT EXISTS privacy_policy_acceptances/);
      if (count === 1) throw new Error('try again');
    },
  };
  await assert.rejects(
    Promise.all([ensurePrivacyPolicySchema(pool), ensurePrivacyPolicySchema(pool)]),
    /try again/,
  );
  assert.equal(count, 1);
  await Promise.all([ensurePrivacyPolicySchema(pool), ensurePrivacyPolicySchema(pool)]);
  assert.equal(count, 2);
});
