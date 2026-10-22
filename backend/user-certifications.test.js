const assert = require('node:assert/strict');
const test = require('node:test');
const {
  normalizeCertification,
  certificationSuggestion,
  automaticCertifications,
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

test('automatic education uses only the account-bound number and never claims graduation or current enrolment', () => {
  for (const [code, education] of [
    ['01', 'undergraduate'],
    ['21', 'master'],
    ['31', 'doctor'],
  ]) {
    const identities = automaticCertifications({
      student_id: `2024${code}0001`,
      full_name: '私人姓名',
      role: 'student',
    });
    assert.equal(identities.length, 1);
    assert.equal(identities[0].education, education);
    assert.equal(identities[0].year, 2024);
    assert.equal(identities[0].source, 'bound_student_id');
    assert.equal(identities[0].automatic, true);
    assert.equal(identities[0].approvedAt, null);
    assert.doesNotMatch(JSON.stringify(identities), /毕业|学位|在读|私人姓名|2024\d{6}/);
  }
  for (const studentId of [
    null,
    '',
    '2024990001',
    '2024960001',
    '2024660001',
    '2024420001',
    2024010001,
  ])
    assert.deepEqual(automaticCertifications({ student_id: studentId, role: 'student' }), []);
  assert.deepEqual(
    automaticCertifications({ studentId: '2024010001', role: 'student' }),
    [],
    'request-shaped properties are not a bound account identity',
  );
});

test('administrator-provisioned teacher identity does not guess institution or require another application', () => {
  const identities = automaticCertifications({ role: 'teacher', full_name: ' 核实教师姓名 ' });
  assert.equal(identities.length, 1);
  assert.equal(identities[0].type, 'teacher');
  assert.equal(identities[0].verifiedName, '核实教师姓名');
  assert.equal(identities[0].source, 'account_role');
  assert.equal(identities[0].institution, '');
  assert.equal(identities[0].year, null);
  assert.deepEqual(automaticCertifications({ role: 'admin', full_name: '管理员' }), []);
});

function automaticFixture(
  user = {
    id: 2,
    role: 'student',
    student_id: '2024210001',
    username: 'account',
    full_name: '本人',
  },
) {
  const state = {
    user,
    requests: [],
    approved: [],
    writes: [],
    notifications: [],
    begins: 0,
    commits: 0,
    rollbacks: 0,
  };
  const executor = {
    async execute(rawSql, parameters = []) {
      const sql = rawSql.replace(/\s+/g, ' ').trim();
      if (sql.startsWith('SELECT student_id, full_name, role FROM users')) return [[state.user]];
      if (sql.includes('FROM user_certifications c')) return [state.approved];
      if (sql.startsWith('SELECT user_id FROM user_certification_requests'))
        return [state.requests.filter((request) => request.id === parameters[0])];
      if (sql.includes('FROM users WHERE id IN'))
        return [[{ id: 1, username: 'admin', is_admin: 1 }, state.user]];
      if (sql.startsWith('SELECT id, username, full_name, student_id, role FROM users'))
        return [[state.user]];
      if (sql.startsWith('SELECT id FROM user_certification_requests'))
        return [
          state.requests.filter(
            (request) => request.slot === parameters[1] && request.status === 'pending',
          ),
        ];
      if (sql.startsWith('SELECT * FROM user_certification_requests WHERE user_id'))
        return [state.requests];
      if (sql.startsWith('SELECT * FROM user_certification_requests WHERE id'))
        return [state.requests.filter((request) => request.id === parameters[0])];
      if (sql.startsWith('SELECT id FROM users WHERE is_admin')) return [[{ id: 1 }]];
      if (sql.startsWith('INSERT INTO user_certification_requests')) {
        const [userId, slot, year, institution, className, companyName, requestedAt] = parameters;
        state.writes.push({ sql, parameters });
        const id = state.requests.length + 1;
        state.requests.push({
          id,
          user_id: userId,
          slot,
          year,
          institution,
          class_name: className,
          company_name: companyName,
          requested_at: requestedAt,
          status: 'pending',
        });
        return [{ insertId: id }];
      }
      if (sql.startsWith('UPDATE user_certification_requests SET status')) {
        state.writes.push({ sql, parameters });
        Object.assign(
          state.requests.find((request) => request.id === parameters[4]),
          {
            status: parameters[0],
            reviewed_at: parameters[1],
            reviewed_by: parameters[2],
            review_note: parameters[3],
          },
        );
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected identity fixture query: ${sql}`);
    },
    async beginTransaction() {
      state.begins += 1;
    },
    async commit() {
      state.commits += 1;
    },
    async rollback() {
      state.rollbacks += 1;
    },
    release() {},
  };
  const service = createUserCertificationService({
    pool: { ...executor, getConnection: async () => executor },
    notifications: { notifyCertification: async (notice) => state.notifications.push(notice) },
    now: () => Date.UTC(2026, 9, 22),
  });
  return { service, state };
}

test('bound current identity is immediately recognized without writes, while historical education remains separately reviewable', async () => {
  const { service, state } = automaticFixture();
  state.approved.push({ user_id: 2, slot: 'undergraduate', year: 2019, institution: '其他学校' });
  const read = await service.read(2);
  assert.deepEqual(read.managedSlots, ['master']);
  assert.equal(read.automatic[0].education, 'master');
  assert.equal(read.approved[0].education, 'undergraduate');
  assert.equal(read.suggestion, null);
  assert.equal(state.writes.length, 0);
  await assert.rejects(
    service.submit(2, {
      type: 'education',
      education: 'master',
      year: 2020,
      institution: '伪造学校',
    }),
    { status: 409, code: 'automatic_identity_managed' },
  );
  assert.equal(state.writes.length, 0);
  assert.equal(state.notifications.length, 0);
  const request = await service.submit(2, {
    type: 'education',
    education: 'undergraduate',
    year: 2019,
    institution: '其他学校',
    userId: 99,
    automatic: true,
  });
  assert.equal(request.status, 'pending');
  assert.equal(state.requests[0].user_id, 2);
  assert.equal(state.notifications.length, 1);
  assert.equal((await service.read(2)).approved[0].year, 2019);
});

test('a known teacher may supplement past education but cannot request the teacher identity again', async () => {
  const { service, state } = automaticFixture({
    id: 2,
    role: 'teacher',
    student_id: null,
    username: 'teacher',
    full_name: '教师',
  });
  await assert.rejects(service.submit(2, { type: 'teacher', institution: '另一个机构' }), {
    status: 409,
    code: 'automatic_identity_managed',
  });
  assert.equal(state.writes.length, 0);
  assert.equal(
    (
      await service.submit(2, {
        type: 'education',
        education: 'master',
        year: 2014,
        institution: '原就读学校',
      })
    ).status,
    'pending',
  );
  assert.deepEqual((await service.read(2)).managedSlots, ['teacher']);
});

test('binding or changing the verified account identity supersedes old pending work without forging a review', async () => {
  const { service, state } = automaticFixture();
  state.requests.push({
    id: 1,
    user_id: 2,
    slot: 'undergraduate',
    year: 2019,
    institution: '待核实学校',
    status: 'pending',
  });
  assert.equal((await service.read(2)).requests[0].requiresReview, true);
  state.user.student_id = '2024010001';
  const updated = await service.read(2);
  assert.deepEqual(updated.managedSlots, ['undergraduate']);
  assert.equal(updated.requests[0].requiresReview, false);
  assert.equal(
    updated.requests[0].status,
    'pending',
    'derived display never forges an administrator decision',
  );
  await assert.rejects(service.review(1, 1, { action: 'approve', identityConfirmed: true }), {
    status: 409,
    code: 'automatic_identity_managed',
  });
  assert.equal(state.writes.length, 0);
  assert.equal(state.notifications.length, 0);
  assert.equal(
    (await service.review(1, 1, { action: 'reject', reviewNote: '已由绑定信息识别' })).status,
    'rejected',
  );
  assert.equal(state.requests[0].status, 'rejected');
});
