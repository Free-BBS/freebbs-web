const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(require.resolve('../public/app'), 'utf8');
function extract(name, next) {
  return source.slice(source.indexOf(`function ${name}(`), source.indexOf(`function ${next}(`));
}

test('mention picker opens on bare @, Chinese-adjacent @, repeated mentions, but not emails', () => {
  const context = {};
  vm.runInNewContext(
    extract('getDiscussionMentionRange', 'positionDiscussionMentionPicker'),
    context,
  );
  const range = (value) =>
    context.getDiscussionMentionRange({ value, selectionStart: value.length });
  assert.equal(range('@').query, '');
  assert.equal(range('你好@').start, 2);
  assert.equal(range('@alice 再请@bob').query, 'bob');
  assert.equal(range('@alice @').query, '');
  assert.equal(range('mail@example'), null);
  assert.equal(range('@@'), null);
  assert.equal(range('@alice 已完成'), null);
});

test('calendar uses real month lengths, Monday columns, fortune colors and gray missed days', () => {
  const host = { innerHTML: '', querySelectorAll: () => [] };
  const context = {
    getFortuneResult: () => ({ colorClass: 'fortune-great', label: '祥瑞' }),
    formatCheckinReward: () => '10 磁元',
    escapeHtml: (value) => value,
  };
  vm.runInNewContext(extract('renderCheckinCalendar', 'ensureFortuneModal'), context);
  context.renderCheckinCalendar(host, {
    todayFortune: { date: '2024-02-29' },
    records: [{ date: '2024-02-29', fortuneScore: 99, streak: 2 }],
  });
  assert.equal((host.innerHTML.match(/data-day=/g) || []).length, 29);
  assert.match(host.innerHTML, /fortune-great is-today/);
  assert.match(host.innerHTML, /本月已签到 1 天/);
  assert.match(host.innerHTML, /2024-02-28 · 未签到/);
  assert.doesNotMatch(host.innerHTML, /fortune-record-row/);
});

test('mobile mentions account for keyboard viewport and dialog top layer', () => {
  assert.match(source, /input.closest\('dialog\[open\]'\)/);
  assert.match(source, /viewport\?\.offsetTop/);
  assert.match(source, /addEventListener\('compositionend', handleDiscussionMentionInput\)/);
  assert.match(source, /input.classList\?\.contains\('discussion-comment-input'\)/);
});

test('bare @ search returns bounded public identities and rejects invalid queries', async () => {
  const server = fs.readFileSync(require.resolve('../backend/server'), 'utf8');
  const start = server.indexOf("app.get('/api/discussion/users/search'");
  const end = server.indexOf("app.get('/api/discussion/posts'", start);
  let handler;
  const queries = [];
  const context = {
    app: {
      get: (path, fn) => {
        handler = fn;
      },
    },
    requireAuth: async () => ({ id: 7 }),
    normalizeLimit: () => 8,
    pool: {
      execute: async (sql, params) => {
        queries.push({ sql, params });
        return [[{ id: 9, uid: 'u_alice01', username: 'alice', student_id: 'private' }]];
      },
    },
  };
  vm.runInNewContext(server.slice(start, end), context);
  const response = {
    set() {},
    status(value) {
      this.code = value;
      return this;
    },
    json(value) {
      this.payload = value;
    },
  };
  await handler({ query: { q: '' } }, response);
  assert.equal(response.payload.users[0].username, 'alice');
  assert.equal(response.payload.users[0].student_id, undefined);
  assert.match(queries[0].sql, /LIMIT 8/);
  assert.match(queries[0].sql, /LOCATE\(LOWER\(\?\), LOWER\(u.username\)\)/);
  await handler({ query: { q: '%' } }, response);
  assert.equal(response.code, 400);
  assert.equal(queries.length, 1);
});
