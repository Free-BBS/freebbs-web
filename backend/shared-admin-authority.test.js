const assert = require('node:assert/strict');
const test = require('node:test');
const { createDiscussionModeration } = require('./discussion-moderation');
const { createModerationAutomationStore } = require('./moderation-automation-store');
const { createUserCertificationService } = require('./user-certifications');
const { createModerationPublisher } = require('./moderation-publisher');

const rootUid = 'u_48370eb1aba453c7';
function moderationHarness(uid, resolver) {
  let paused = 0;
  let revision = 1;
  const db = {
    async execute(sql) {
      if (sql.includes('FROM users WHERE id = ?'))
        return [[{ id: 1, uid, role: 'student', is_admin: 0 }]];
      if (sql.includes('FROM moderation_reviewers r')) return [[]];
      if (sql.includes('SELECT paused, revision')) return [[{ paused, revision }]];
      if (sql.startsWith('UPDATE moderation_auto_control')) {
        paused = 1;
        revision++;
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const options = {
    pool: db,
    withDatabaseTransaction: async (work) => work(db),
    resolvePlatformAuthority: resolver,
  };
  return {
    moderation: createDiscussionModeration(options),
    automation: createModerationAutomationStore(options),
  };
}

test('configured root manages reviewer assignments and automation without physical is_admin', async () => {
  const { moderation, automation } = moderationHarness(rootUid);
  assert.deepEqual(await moderation.listReviewers({ actorId: 1 }), []);
  assert.deepEqual(await automation.setPaused({ actorId: 1, paused: true }), {
    paused: true,
    revision: 2,
  });
});

test('secondary administration checks current shared learning grants and revocation', async () => {
  let learningAdmin = true;
  const { moderation, automation } = moderationHarness('shared-admin', async () => ({
    learningAdmin,
  }));
  assert.deepEqual(await moderation.listReviewers({ actorId: 1 }), []);
  learningAdmin = false;
  await assert.rejects(moderation.listReviewers({ actorId: 1 }), { status: 403 });
  await assert.rejects(automation.setPaused({ actorId: 1, paused: true }), { status: 403 });
  const developmentOnly = moderationHarness('development-only', async () => ({
    developmentAdmin: true,
    learningAdmin: false,
  }));
  await assert.rejects(developmentOnly.moderation.listReviewers({ actorId: 1 }), { status: 403 });
});

function certificationHarness(adminUid, targetUid = 'student', resolver) {
  let reviewed = false;
  const request = {
    id: 3,
    user_id: 2,
    slot: 'doctor',
    year: 2024,
    institution: '清华大学电子系',
    status: 'pending',
  };
  const db = {
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release() {},
    async execute(sql) {
      if (sql.startsWith('SELECT user_id')) return [[{ user_id: 2 }]];
      if (sql.includes('FROM users WHERE id IN'))
        return [
          [
            { id: 1, uid: adminUid, username: 'admin', role: 'student', is_admin: 0 },
            { id: 2, uid: targetUid, username: 'target', role: 'student', is_admin: 0 },
          ],
        ];
      if (sql.startsWith('UPDATE user_certification_requests')) {
        reviewed = true;
        request.status = 'rejected';
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('SELECT * FROM user_certification_requests')) return [[request]];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const service = createUserCertificationService({
    pool: { ...db, getConnection: async () => db },
    notifications: { notifyCertification: async () => {} },
    resolvePlatformAuthority: resolver,
  });
  return { service, reviewed: () => reviewed };
}

test('root can review another account while ordinary admins cannot change root identity', async () => {
  const root = certificationHarness(rootUid);
  assert.equal((await root.service.review(1, 3, { action: 'reject' })).status, 'rejected');
  assert.equal(root.reviewed(), true);
  const ordinary = certificationHarness('ordinary', rootUid, async () => ({ learningAdmin: true }));
  await assert.rejects(ordinary.service.review(1, 3, { action: 'reject' }), {
    code: 'platform_root_immutable',
  });
  assert.equal(ordinary.reviewed(), false);
});

test('root identity cannot be spoofed by the certification request body', async () => {
  const ordinary = certificationHarness('ordinary');
  await assert.rejects(
    ordinary.service.review(1, 3, { action: 'reject', rootAdmin: true, uid: rootUid }),
    { code: 'admin_required' },
  );
  assert.equal(ordinary.reviewed(), false);
});

test('publication rechecks shared authority for changelog authors', async () => {
  let uid = rootUid;
  let inserted = false;
  const db = {
    async execute(sql) {
      if (sql.includes('FROM users'))
        return [[{ id: 1, uid, username: 'author', is_admin: 0, role: 'student' }]];
      if (sql.includes('FROM discussion_boards'))
        return [[{ id: 1, slug: 'changelog', is_active: 1 }]];
      if (sql.includes('INSERT INTO discussion_posts')) {
        inserted = true;
        return [{ insertId: 5 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const publish = createModerationPublisher({
    createPostPid: async () => 'p_root',
    awardMagnetic: async () => {},
    notifications: { notifyMentions: async () => {} },
  });
  const submission = {
    kind: 'post',
    authorId: 1,
    payload: { boardId: 1, title: '公告', content: '内容', anonymous: false, loginRequired: true },
  };
  assert.equal((await publish(db, submission)).publishedId, 5);
  uid = 'ordinary';
  inserted = false;
  await assert.rejects(publish(db, submission), { status: 409 });
  assert.equal(inserted, false);
});
