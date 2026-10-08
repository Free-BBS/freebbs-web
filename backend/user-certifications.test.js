const assert = require('node:assert/strict');
const test = require('node:test');
const {
  normalizeCertification,
  certificationSuggestion,
  identityBadges,
  serializeCertification,
  readApprovedCertifications,
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
  assert.deepEqual(
    normalizeCertification(
      { type: 'teacher', fullName: '冒充姓名', verifiedName: '冒充姓名' },
      now,
    ),
    normalizeCertification({ type: 'teacher' }, now),
  );
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

test('approved teacher badges show verified names once and retain school details', () => {
  const teacher = serializeCertification({
    slot: 'teacher',
    institution: '其他大学学院',
    year: 2023,
    teacher_name: ' 张亦驰 ',
  });
  assert.equal(teacher.label, '张亦驰 · 教师');
  assert.equal(teacher.verifiedName, '张亦驰');
  assert.equal(teacher.institution, '其他大学学院');
  assert.equal(teacher.education, null);
  assert.deepEqual(
    identityBadges('teacher', [teacher], '其他姓名').map((item) => item.label),
    ['张亦驰 · 教师'],
  );
  assert.equal(identityBadges('teacher', [teacher])[0].institution, '其他大学学院');
  assert.equal(identityBadges('student', [teacher])[0].type, 'teacher');
  assert.equal(identityBadges('teacher', [], ' 张亦驰 ')[0].label, '张亦驰 · 教师');
  assert.equal(identityBadges('teacher')[0].label, '教师');
  assert.deepEqual(identityBadges('student', [], '普通学生姓名'), []);
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

test('approved certification reads expose account names only for teacher certificates', async () => {
  const approved = await readApprovedCertifications(
    {
      async execute(sql, ids) {
        assert.match(
          sql,
          /CASE WHEN c\.slot = 'teacher' THEN u\.full_name ELSE NULL END AS teacher_name/,
        );
        assert.match(sql, /JOIN users u ON u\.id = c\.user_id/);
        assert.deepEqual(ids, [7, 8]);
        return [
          [
            { user_id: 7, slot: 'teacher', institution: '另一大学', teacher_name: '数据库姓名' },
            {
              user_id: 8,
              slot: 'master',
              year: 2024,
              institution: '另一大学',
              teacher_name: '不应公开',
            },
          ],
        ];
      },
    },
    [7, 8, 7, 0],
  );
  assert.equal(approved.get(7)[0].label, '数据库姓名 · 教师');
  assert.equal(approved.get(7)[0].verifiedName, '数据库姓名');
  assert.equal(Object.hasOwn(approved.get(8)[0], 'verifiedName'), false);
  assert.doesNotMatch(JSON.stringify(approved.get(8)), /不应公开/);
});

test('teacher role names come from the database while hidden authors and students keep names private', async () => {
  const calls = [];
  const service = createUserCertificationService({
    pool: {
      async execute(sql, ids) {
        calls.push(ids);
        if (sql.includes('FROM user_certifications c')) return [[]];
        assert.match(sql, /SELECT id, role, full_name FROM users/);
        return [
          [
            { id: 7, role: 'teacher', full_name: '管理员核实姓名' },
            { id: 8, role: 'student', full_name: '普通学生姓名' },
          ],
        ];
      },
    },
  });
  const rows = await service.decorate([
    { user_id: 7, username: 'nickname', full_name: '伪造姓名' },
    { user_id: 8 },
    { user_id: 9, is_anonymous: 1 },
    { user_id: 10, is_deleted: 1 },
  ]);
  assert.deepEqual(calls, [
    [7, 8],
    [7, 8],
  ]);
  assert.equal(rows[0].identityBadges[0].label, '管理员核实姓名 · 教师');
  assert.doesNotMatch(JSON.stringify(rows[0].identityBadges), /伪造姓名|nickname/);
  for (const row of rows.slice(1)) assert.deepEqual(row.identityBadges, []);
  assert.doesNotMatch(JSON.stringify(rows[1]), /普通学生姓名/);
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
