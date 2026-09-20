const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createNotificationService,
  getWeeklyDigestWindow,
  weeklyDigestBody,
  parseWeeklyDigestBody,
  renderNotificationEmail,
} = require('./notifications');

function createDigestDatabase() {
  const notifications = [];
  const outbox = new Set();
  const pool = {
    async getConnection() {
      return pool;
    },
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(rawSql, args = []) {
      const sql = rawSql.replace(/\s+/g, ' ').trim();
      if (sql.startsWith('SELECT p.id')) {
        return [
          [
            {
              id: 8,
              pid: 'weekly-8',
              title: '一周讨论',
              board_name: '数理',
              comment_count: 6,
              reaction_count: 4,
            },
          ],
        ];
      }
      if (sql.startsWith('SELECT id FROM users WHERE email')) return [[{ id: 2 }, { id: 3 }]];
      if (sql.startsWith('INSERT INTO community_notifications')) {
        const [recipient, actor, kind, title, body, link, eventKey] = args;
        let row = notifications.find(
          (item) => item.recipient === recipient && item.eventKey === eventKey,
        );
        if (!row) {
          row = {
            id: notifications.length + 1,
            recipient,
            actor,
            kind,
            title,
            body,
            link,
            eventKey,
          };
          notifications.push(row);
        }
        return [{ insertId: row.id }];
      }
      if (sql.startsWith('INSERT IGNORE INTO notification_email_outbox')) {
        outbox.add(args[0]);
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  return { pool, notifications, outbox };
}

test('weekly digest opens on Monday after 08:00 Asia/Shanghai and selects the previous week', () => {
  assert.equal(getWeeklyDigestWindow(new Date('2026-09-20T23:59:59Z')), null);
  assert.equal(getWeeklyDigestWindow(new Date('2026-09-21T00:00:00Z')).weekKey, '2026-09-14');
  const window = getWeeklyDigestWindow(new Date('2026-09-21T04:00:00Z'));
  assert.equal(window.start.toISOString(), '2026-09-13T16:00:00.000Z');
  assert.equal(window.end.toISOString(), '2026-09-20T16:00:00.000Z');
  assert.equal(getWeeklyDigestWindow(new Date('2026-09-22T00:00:00Z')), null);
});

test('weekly digest body stays readable in-app and renders safe linked cards in email', () => {
  const body = weeklyDigestBody([
    {
      id: 7,
      pid: 'post-7',
      title: '<script>电路讨论</script>',
      board_name: '电路',
      comment_count: 8,
      reaction_count: 5,
    },
  ]);
  assert.match(body, /1\. <script>电路讨论<\/script>/);
  assert.match(body, /8 条评论 · 5 次互动/);
  const parsed = parseWeeklyDigestBody(body);
  assert.equal(parsed.posts[0].link, '/discussion?post=post-7');
  const email = renderNotificationEmail(
    {
      kind: 'weekly_digest',
      title: '上周热帖',
      body,
      link: '/discussion?sort=hot',
    },
    new URL('https://www.free-bbs.cn'),
  );
  assert.match(email.html, /过去一周/);
  assert.match(email.html, /https:\/\/www\.free-bbs\.cn\/discussion\?post=post-7/);
  assert.doesNotMatch(email.html, /<script>/);
  assert.match(email.html, /&lt;script&gt;电路讨论&lt;\/script&gt;/);
});

test('ordinary notification email uses the shared card template', () => {
  const email = renderNotificationEmail(
    { kind: 'reply', title: '有新回复', body: '第一行\n第二行', link: '/discussion' },
    new URL('https://www.free-bbs.cn'),
  );
  assert.match(email.html, /FREE-BBS · 站内通知/);
  assert.match(email.html, /border-radius:20px/);
  assert.match(email.text, /查看通知：https:\/\/www\.free-bbs\.cn\/discussion/);
});

test('weekly digest queues one idempotent inbox and email item per verified user', async () => {
  const database = createDigestDatabase();
  const service = createNotificationService({ pool: database.pool, sendEmail: async () => {} });
  const monday = new Date('2026-09-21T01:00:00Z');
  const first = await service.queueWeeklyDigest(monday);
  const retry = await service.queueWeeklyDigest(monday);
  assert.equal(first.weekKey, '2026-09-14');
  assert.equal(first.queued, 2);
  assert.equal(retry.queued, 2);
  assert.equal(database.notifications.length, 2);
  assert.equal(database.outbox.size, 2);
  assert.ok(database.notifications.every((item) => item.kind === 'weekly_digest'));
  assert.ok(database.notifications.every((item) => item.eventKey === 'weekly-digest:2026-09-14'));
});
