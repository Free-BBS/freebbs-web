const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const identities = require('../public/identity-badges');
const { preparePageShell } = require('../page-shell');

const undergraduate = {
  type: 'education',
  education: 'undergraduate',
  label: '2021 清华大学电子系 本科',
  className: '无11',
};

test('teacher remarks and three approved degree identities coexist', () => {
  const person = {
    role: 'teacher',
    certifications: [
      undergraduate,
      { ...undergraduate, education: 'master', label: '2025 清华大学电子系 硕士' },
      { ...undergraduate, education: 'doctor', label: '2026 清华大学电子系 博士' },
    ],
  };
  assert.equal(identities.badges(person).length, 4);
  assert.match(identities.markup(person), /教师/);
  assert.match(identities.markup(person), /已认证 · 2021 清华大学电子系 本科 · 无11/);
});

test('pending, rejected, duplicate, anonymous and deleted identities are not displayed', () => {
  const certifications = [
    undergraduate,
    undergraduate,
    { ...undergraduate, education: 'master', status: 'pending' },
    { type: 'company', status: 'rejected', label: '未通过公司' },
  ];
  assert.equal(identities.badges({ certifications }).length, 1);
  assert.equal(identities.markup({ role: 'teacher', certifications, isAnonymous: true }), '');
  assert.equal(identities.markup({ role: 'teacher', certifications, isDeleted: true }), '');
});

test('enterprise and approved teacher certification labels are escaped and retain their schools', () => {
  const html = identities.markup({
    certifications: [
      { type: 'company', label: '<img onerror="bad">公司' },
      { type: 'teacher', label: '其他学校 教师' },
    ],
  });
  assert.doesNotMatch(html, /<img|onerror="bad"/);
  assert.match(html, /&lt;img/);
  assert.match(html, /其他学校 教师/);
});

test('real discussion author links carry badges, while avatar-only slots remain compact', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const start = source.indexOf('function renderAuthorProfileLink(');
  const end = source.indexOf('function normalizeWebsiteUrl(', start);
  const context = {
    window: { FreeBbsIdentityBadges: identities },
    escapeHtml: (value) => String(value),
    getProfileHref: () => '/profile?uid=u_123456',
    getAvatarUrl: () => '/avatar.webp',
    getActiveGoldenNameExpiry: () => 0,
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  const author = { role: 'teacher', username: '张老师', certifications: [undergraduate] };
  assert.match(context.renderAuthorProfileLink(author, 'author'), /教师/);
  assert.match(context.renderAuthorProfileLink(author, 'author'), /2021 清华大学电子系 本科/);
  assert.doesNotMatch(context.renderAuthorProfileLink(author, 'author', true), /identity-badge/);
});

test('shared HTML shell loads identity badges before the application once', () => {
  const html = preparePageShell(
    '<head></head><body><main></main><script src="/app.js"></script></body>',
  );
  assert.ok(html.indexOf('src="/identity-badges.js"') < html.indexOf('src="/app.js"'));
  assert.equal((preparePageShell(html).match(/src="\/identity-badges.js"/g) || []).length, 1);
});
