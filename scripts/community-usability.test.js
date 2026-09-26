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

test('calendar numbers are unboxed, activity cells stay square, and ranch avoids nested cards', () => {
  const styles = fs.readFileSync(require.resolve('../public/styles.css'), 'utf8');
  const profile = fs.readFileSync(require.resolve('../public/profile-extras.css'), 'utf8');
  assert.match(
    styles,
    /\.checkin-calendar \.checkin-day\s*\{[^}]*border: 0;[^}]*background: none;[^}]*box-shadow: none;/s,
  );
  assert.match(styles, /\.checkin-calendar \.fortune-great\s*\{\s*color:/);
  assert.match(styles, /\.checkin-calendar \.is-today\s*\{[^}]*text-decoration: underline;/s);
  assert.match(
    profile,
    /grid-template-columns: repeat\(var\(--heat-columns\), var\(--heat-cell\)\)/,
  );
  assert.match(profile, /grid-template-rows: repeat\(7, var\(--heat-cell\)\)/);
  assert.match(profile, /\.profile-heatmap button\s*\{[^}]*aspect-ratio: 1;/s);
  assert.match(profile, /\.profile-ranch\s*\{[^}]*border-radius: 0;[^}]*background: transparent;/s);
  assert.match(
    profile,
    /\.ranch-wool-stages > div\s*\{[^}]*border: 0;[^}]*background: transparent;/s,
  );
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

test('public profile activity uses verified viewer identity and cannot be shared-cache reused', async () => {
  const server = fs.readFileSync(require.resolve('../backend/server'), 'utf8');
  const start = server.indexOf("app.get('/api/users/:uid/public-profile'");
  const end = server.indexOf("app.patch('/api/profile'", start);
  let handler;
  let activityViewer;
  const request = { params: { uid: 'u_alice01' } };
  const viewer = { id: 8 };
  const context = {
    app: {
      get: (_path, fn) => {
        handler = fn;
      },
    },
    pool: { execute: async () => [[{ id: 7, uid: 'u_alice01' }]] },
    economyShop: {
      decoratePosts: async () => [{}],
      publicCollectibles: async () => [],
    },
    getShopItems: () => [],
    profileExtras: { publicProfile: async () => ({}) },
    getOptionalAuthUser: async (received) => {
      assert.equal(received, request);
      return viewer;
    },
    loadProfileActivity: async (_pool, id, _now, options) => {
      assert.equal(id, 7);
      activityViewer = options.viewer;
      return { visibility: 'members' };
    },
  };
  vm.runInNewContext(server.slice(start, end), context);
  const headers = {};
  const response = {
    set: (name, value) => {
      headers[name] = value;
    },
    vary: (value) => {
      headers.Vary = value;
    },
    json(value) {
      this.payload = value;
    },
  };
  await handler(request, response);
  assert.equal(activityViewer, viewer);
  assert.equal(headers['Cache-Control'], 'private, no-store');
  assert.equal(headers.Vary, 'Authorization');
  assert.equal(response.payload.profile.activity.visibility, 'members');
});

test('profile loading ignores stale member responses after logout or a newer request', async () => {
  const start = source.indexOf('let publicProfileRequestVersion = 0;');
  const end = source.indexOf('function normalizeAdminRole(', start);
  const pending = [];
  const rendered = [];
  const context = {
    isPublicProfilePage: () => true,
    getProfileUidFromQuery: () => 'u_alice01',
    isValidPublicUid: () => true,
    setPublicProfileMessage: () => {},
    userState: { token: 'member-session' },
    callApi: () =>
      new Promise((resolve) => {
        pending.push(resolve);
      }),
    window: { FreeBbsProfileActivity: { render: (value) => rendered.push(value) } },
  };
  for (const field of [
    'Avatar',
    'Name',
    'StudentId',
    'Major',
    'PostCount',
    'LikeCount',
    'Bio',
    'Website',
  ]) {
    context[`publicProfile${field}`] = null;
  }
  vm.runInNewContext(source.slice(start, end), context);
  const oldRequest = context.loadPublicProfile();
  context.userState.token = '';
  pending.shift()({ profile: { activity: 'private' } });
  await oldRequest;
  assert.equal(rendered.length, 0);
  const first = context.loadPublicProfile();
  const second = context.loadPublicProfile();
  pending.shift()({ profile: { activity: 'obsolete' } });
  pending.shift()({ profile: { activity: 'public' } });
  await Promise.all([first, second]);
  assert.deepEqual(rendered, ['public']);
  assert.match(
    source,
    /isPublicProfilePage\(\)\) \{\s*window.FreeBbsProfileActivity\?\.render\(null\);\s*loadPublicProfile\(\)/,
  );
});
