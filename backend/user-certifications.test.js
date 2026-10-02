const assert = require('node:assert/strict');
const test = require('node:test');
const {
  normalizeCertification,
  certificationSuggestion,
  identityBadges,
  serializeCertification,
  createUserCertificationService,
} = require('./user-certifications');

test('certification input validates year, schools, class and company without trusting identity flags', () => {
  const now = Date.UTC(2026, 9, 2);
  assert.deepEqual(
    normalizeCertification(
      {
        type: 'education',
        education: 'master',
        year: '2024',
        institution: '复旦大学电子系',
        className: '',
      },
      now,
    ),
    { slot: 'master', year: 2024, institution: '复旦大学电子系', className: '', companyName: '' },
  );
  assert.equal(normalizeCertification({ type: 'teacher' }, now).year, null);
  assert.equal(normalizeCertification({ type: 'teacher' }, now).institution, '清华大学电子系');
  for (const body of [
    null,
    [],
    { type: 'education', education: 'postdoc', year: 2026 },
    { type: 'education', education: 'undergraduate', year: 1899 },
    { type: 'education', education: 'doctor', year: 2028 },
    { type: 'teacher', year: 'xx' },
    { type: 'teacher', institution: '' },
    { type: 'teacher', institution: '校'.repeat(129) },
    { type: 'company', companyName: 'a' },
    { type: 'company', companyName: 'bad\nname' },
  ]) {
    assert.throws(() => normalizeCertification(body, now), { status: 400 });
  }
  assert.equal(
    normalizeCertification({ type: 'company', companyName: ' 中文企业 ', isAdmin: true, userId: 9 })
      .companyName,
    '中文企业',
  );
});

test('suggestions use only recognized bound student number codes', () => {
  for (const [code, education] of [
    ['01', 'undergraduate'],
    ['21', 'master'],
    ['31', 'doctor'],
  ]) {
    assert.deepEqual(certificationSuggestion(`2024${code}0001`), {
      type: 'education',
      education,
      year: 2024,
      institution: '清华大学电子系',
      className: '',
    });
  }
  for (const code of ['99', '96', '66'])
    assert.equal(certificationSuggestion(`2020${code}0001`).type, 'teacher');
  for (const value of [null, '', '2024420001', '20240100', '1999010001'])
    assert.equal(certificationSuggestion(value), null);
});

test('approved teacher badges do not duplicate role badges and labels retain school details', () => {
  const teacher = serializeCertification({
    slot: 'teacher',
    institution: '其他大学学院',
    year: 2023,
  });
  assert.equal(teacher.label, '其他大学学院 教师');
  assert.equal(teacher.education, null);
  assert.deepEqual(
    identityBadges('teacher', [teacher]).map((item) => item.label),
    ['其他大学学院 教师'],
  );
  assert.equal(identityBadges('student', [teacher])[0].type, 'teacher');
  assert.equal(
    serializeCertification({
      slot: 'undergraduate',
      year: 2021,
      institution: '清华大学电子系',
      class_name: '无11',
    }).label,
    '2021 清华大学电子系 本科',
  );
});

test('anonymous and deleted authors never trigger an identity query or retain identity fields', async () => {
  const service = createUserCertificationService({
    pool: {
      execute: () => {
        throw new Error('private IDs must not be queried');
      },
    },
  });
  const rows = await service.decorate([
    { user_id: 8, is_anonymous: 1, certifications: [{ label: 'secret' }], author_role: 'teacher' },
    { user_id: 9, is_deleted: 1 },
  ]);
  for (const row of rows) {
    assert.deepEqual(row.certifications, []);
    assert.deepEqual(row.identityBadges, []);
    assert.equal(row.author_role, '');
  }
});
