const assert = require('node:assert/strict');
const test = require('node:test');
const { once } = require('node:events');
const express = require('express');
const { hashPassword } = require('./password');
const {
  normalizeAdminAccount,
  createAccountIdentityService,
  createTeacherAccountsRouter,
} = require('./teacher-accounts');

const bindingPassword = 'binding-proof-password';
const bindingPasswordHash = hashPassword(bindingPassword);
const bindingCode = '246810';
const bindingCodeHash = hashPassword(bindingCode);

function bindingFixture(options = {}) {
  const clock = Date.UTC(2026, 9, 22);
  const target = '2024010901';
  const schoolEmail = 'named.student@mails.tsinghua.edu.cn';
  const state = {
    user: {
      id: 8,
      full_name: '核实同学',
      email: schoolEmail,
      email_verified_at: new Date(clock),
      student_id: null,
      role: 'teacher',
      is_admin: 0,
      password_hash: bindingPasswordHash,
      ...options.user,
    },
    entries: options.entries || [
      {
        id: 11,
        active: 1,
        student_id: target,
        email: schoolEmail,
        full_name: '核实同学',
        claimed_user_id: null,
      },
    ],
    request: options.request || null,
    code: {
      id: 3,
      email: schoolEmail,
      purpose: 'bind_email',
      code_hash: bindingCodeHash,
      expires_at: new Date(clock + 600000),
      used_at: null,
      attempts: 0,
      ...options.code,
    },
    queries: [],
    commits: 0,
    rollbacks: 0,
  };
  let snapshot;
  const connection = {
    async beginTransaction() {
      snapshot = structuredClone({
        user: state.user,
        entries: state.entries,
        request: state.request,
        code: state.code,
      });
    },
    async commit() {
      state.commits += 1;
    },
    async rollback() {
      Object.assign(state, snapshot);
      state.rollbacks += 1;
    },
    release() {},
    async execute(sql, args = []) {
      state.queries.push({ sql, args });
      if (sql.startsWith('SELECT id FROM registration_whitelist_state')) {
        if (options.missingTable)
          throw Object.assign(new Error('missing fixture schema'), { code: 'ER_NO_SUCH_TABLE' });
        return [options.missingState ? [] : [{ id: 1 }]];
      }
      if (sql.startsWith('SELECT * FROM users')) return [[state.user]];
      if (sql.startsWith('SELECT id, email, email_verified_at, student_id, full_name FROM users'))
        return [[state.user]];
      if (sql.startsWith('SELECT id FROM users WHERE student_id'))
        return [options.taken ? [{ id: 99 }] : []];
      if (sql.startsWith('SELECT id FROM users WHERE email'))
        return [options.emailTaken ? [{ id: 99 }] : []];
      if (sql.startsWith('SELECT email, full_name, claimed_user_id FROM registration_whitelist')) {
        assert.doesNotMatch(sql, /FOR UPDATE/);
        return [
          state.entries.filter(
            (entry) =>
              entry.active === 1 &&
              entry.student_id != null &&
              entry.email != null &&
              entry.student_id === args[0],
          ),
        ];
      }
      if (
        sql.startsWith(
          'SELECT id, student_id, full_name, claimed_user_id FROM registration_whitelist',
        )
      )
        return [
          state.entries.filter(
            (entry) =>
              entry.active === 1 &&
              entry.student_id != null &&
              entry.email != null &&
              entry.email === args[0],
          ),
        ];
      if (sql.startsWith('SELECT id, claimed_user_id FROM registration_whitelist')) {
        assert.match(sql, /student_id IS NOT NULL AND email IS NOT NULL/);
        assert.match(sql, /BINARY student_id = BINARY \? AND BINARY email = BINARY \?/);
        assert.match(sql, /ORDER BY id FOR UPDATE/);
        return [
          state.entries.filter(
            (entry) =>
              entry.active === 1 &&
              entry.student_id === args[0] &&
              entry.email === args[1] &&
              (entry.full_name == null || entry.full_name === args[2]),
          ),
        ];
      }
      if (sql.startsWith('UPDATE users SET student_id')) {
        if (options.race)
          throw Object.assign(new Error('injected uniqueness race'), { code: 'ER_DUP_ENTRY' });
        [state.user.student_id] = args;
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('UPDATE registration_whitelist SET claimed_user_id')) {
        const ids = args.slice(1, -1);
        for (const entry of state.entries)
          if (ids.includes(entry.id)) [entry.claimed_user_id] = args;
        return [{ affectedRows: ids.length }];
      }
      if (sql.startsWith('INSERT INTO account_student_requests')) {
        state.request = {
          user_id: args[0],
          student_id: args[1],
          status: args[2],
          requested_at: args[3],
          reviewed_at: args[4],
          reviewed_by: null,
        };
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('SELECT * FROM account_identity_codes'))
        return [
          [...(state.code.email === args[1] && state.code.purpose === args[2] ? [state.code] : [])],
        ];
      if (sql.startsWith('UPDATE account_identity_codes SET attempts')) {
        state.code.attempts += 1;
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('UPDATE account_identity_codes SET used_at')) {
        [state.code.used_at] = args;
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('UPDATE users SET email')) {
        [state.user.email, state.user.email_verified_at] = args;
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('SELECT student_id, status FROM account_student_requests'))
        return [[...(state.request ? [state.request] : [])]];
      if (
        sql.startsWith(
          'SELECT student_id, status, requested_at, reviewed_at FROM account_student_requests',
        )
      )
        return [[...(state.request ? [state.request] : [])]];
      if (sql.startsWith("UPDATE account_student_requests SET status = 'approved'")) {
        state.request.status = 'approved';
        [state.request.reviewed_at] = args;
        state.request.reviewed_by = null;
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected identity fixture SQL: ${sql}`);
    },
  };
  const service = createAccountIdentityService({
    pool: {
      execute: (...args) => connection.execute(...args),
      getConnection: async () => connection,
    },
    now: () => clock,
    sendCode: async () => assert.fail('No email is sent by binding a supplied OTP'),
  });
  return { service, state, target, schoolEmail };
}

test('a bound student receives only an advisory unique mailbox suggestion with no writes or verification', async () => {
  for (const currentEmail of [null, 'named.student@mails.tsinghua.edu.cn']) {
    const f = bindingFixture({
      user: { student_id: '2024010901', email: currentEmail, email_verified_at: null },
    });
    f.state.entries.push({ ...f.state.entries[0], id: 12, full_name: null, claimed_user_id: 8 });
    const result = await f.service.read(8);
    assert.deepEqual(result.emailSuggestion, {
      email: f.schoolEmail,
      source: 'whitelist_pair',
      requiresVerification: true,
    });
    assert.equal(result.emailVerified, false);
    assert.equal(result.email, currentEmail || '');
    assert.equal(f.state.user.email, currentEmail);
    assert.equal(f.state.entries[0].claimed_user_id, null);
    assert.equal(f.state.code.used_at, null);
    assert.equal(f.state.commits, 0);
    assert.ok(f.state.queries.every(({ sql }) => sql.startsWith('SELECT')));
    assert.equal(
      f.state.queries.some(({ sql }) => sql.includes('FOR UPDATE')),
      false,
    );
  }
});

test('mailbox suggestions refuse wrong sources, conflicts, ambiguity and existing user choices', async () => {
  const cases = [
    { user: { student_id: null }, request: { student_id: '2024010901', status: 'pending' } },
    { user: { email: 'chosen@example.test', email_verified_at: null } },
    { user: { email: 'named.student@mails.tsinghua.edu.cn', email_verified_at: new Date() } },
    { entry: { student_id: null } },
    { entry: { student_id: '2024310999' } },
    { entry: { email: null } },
    { entry: { email: 'student@example.test' } },
    { entry: { email: 'student@mails.tsinghua.edu.cn.evil.test' } },
    { entry: { full_name: '不同的姓名' } },
    { entry: { active: 0 } },
    { entry: { claimed_user_id: 99 } },
    { emailTaken: true },
    { extra: { email: 'second@tsinghua.edu.cn' } },
  ];
  for (const value of cases) {
    const f = bindingFixture({
      ...value,
      user: { student_id: '2024010901', email: null, email_verified_at: null, ...value.user },
    });
    Object.assign(f.state.entries[0], value.entry || {});
    if (value.extra) f.state.entries.push({ ...f.state.entries[0], id: 12, ...value.extra });
    assert.equal((await f.service.read(8)).emailSuggestion, null, JSON.stringify(value));
    assert.equal(f.state.commits, 0);
  }
  const split = bindingFixture({
    user: { student_id: '2024010901', email: null, email_verified_at: null },
  });
  split.state.entries[0].email = null;
  split.state.entries.push({
    ...split.state.entries[0],
    id: 12,
    student_id: null,
    email: split.schoolEmail,
  });
  assert.equal(
    (await split.service.read(8)).emailSuggestion,
    null,
    'separate student and mailbox rows cannot be joined into evidence',
  );
});

test('OTP for an already bound student claims only the exact pair and preserves the number and other claims', async () => {
  const f = bindingFixture({
    user: { student_id: '2024010901', email: null, email_verified_at: null },
  });
  f.state.entries.push({
    ...f.state.entries[0],
    id: 12,
    student_id: '2024310999',
    claimed_user_id: 99,
  });
  assert.deepEqual(
    await f.service.bindEmail(8, {
      email: f.schoolEmail,
      currentPassword: bindingPassword,
      emailCode: bindingCode,
    }),
    {},
  );
  assert.equal(f.state.user.student_id, f.target);
  assert.equal(f.state.user.email, f.schoolEmail);
  assert.ok(f.state.user.email_verified_at);
  assert.equal(f.state.entries[0].claimed_user_id, 8);
  assert.equal(f.state.entries[1].claimed_user_id, 99);
  assert.equal(f.state.request, null);
  assert.equal(f.state.user.role, 'teacher');
  assert.equal((await f.service.read(8)).emailSuggestion, null);
});

test('a conflicting exact-pair claim rolls back the existing mailbox, OTP and every identity change', async () => {
  const originalVerified = new Date('2026-10-01T00:00:00Z');
  const f = bindingFixture({
    user: {
      student_id: '2024010901',
      email: 'previous@example.test',
      email_verified_at: originalVerified,
    },
  });
  f.state.entries[0].claimed_user_id = 99;
  await assert.rejects(
    f.service.bindEmail(8, {
      email: f.schoolEmail,
      currentPassword: bindingPassword,
      emailCode: bindingCode,
    }),
    { status: 409, code: 'whitelist_identity_conflict' },
  );
  assert.equal(f.state.user.email, 'previous@example.test');
  assert.deepEqual(f.state.user.email_verified_at, originalVerified);
  assert.equal(f.state.user.student_id, f.target);
  assert.equal(f.state.code.used_at, null);
  assert.equal(f.state.entries[0].claimed_user_id, 99);
  assert.equal(f.state.commits, 0);
  assert.equal(f.state.rollbacks, 1);
});

test('an expired suggestion or absent pair does not block an explicitly requested ordinary OTP mailbox binding', async () => {
  const f = bindingFixture({
    user: { student_id: '2024010901', email: null, email_verified_at: null },
  });
  assert.ok((await f.service.read(8)).emailSuggestion);
  f.state.entries[0].active = 0;
  assert.deepEqual(
    await f.service.bindEmail(8, {
      email: f.schoolEmail,
      currentPassword: bindingPassword,
      emailCode: bindingCode,
    }),
    {},
  );
  assert.equal(f.state.user.email, f.schoolEmail);
  assert.ok(f.state.user.email_verified_at);
  assert.equal(f.state.user.student_id, f.target);
  assert.equal(f.state.entries[0].claimed_user_id, null);
  assert.equal(f.state.request, null);
});

test('verified school mailboxes bind only their explicitly paired unclaimed or same-owner whitelist identity', async () => {
  for (const claimed of [null, 8]) {
    const f = bindingFixture();
    f.state.entries[0].claimed_user_id = claimed;
    f.state.entries.push({
      ...f.state.entries[0],
      id: 12,
      student_id: null,
      claimed_user_id: null,
    });
    const result = await f.service.requestStudentId(8, {
      studentId: f.target,
      currentPassword: bindingPassword,
    });
    assert.deepEqual(result, { status: 'bound' });
    assert.equal(f.state.user.student_id, f.target);
    assert.equal(f.state.entries[0].claimed_user_id, 8);
    assert.equal(
      f.state.entries[1].claimed_user_id,
      null,
      'an overlapping wildcard row is not identity evidence and is not claimed',
    );
    assert.equal(f.state.request.status, 'approved');
    assert.equal(
      f.state.request.reviewed_by,
      null,
      'automatic proof never invents an administrator reviewer',
    );
    assert.equal(f.state.user.role, 'teacher');
    assert.equal(f.state.user.is_admin, 0);
    assert.match(f.state.queries[0].sql, /registration_whitelist_state.*FOR UPDATE/);
    assert.match(f.state.queries[1].sql, /SELECT \* FROM users.*FOR UPDATE/);
    assert.equal(f.state.commits, 1);
    assert.equal(f.state.rollbacks, 0);
    assert.equal(
      f.state.queries.some(({ sql }) => /CREATE|ALTER/.test(sql)),
      false,
    );
  }
  const rootDomain = bindingFixture({ user: { email: 'teacher.name@tsinghua.edu.cn' } });
  rootDomain.state.entries[0].email = rootDomain.state.user.email;
  rootDomain.state.entries[0].full_name = null;
  assert.equal(
    (
      await rootDomain.service.requestStudentId(8, {
        studentId: rootDomain.target,
        currentPassword: bindingPassword,
      })
    ).status,
    'bound',
  );
});

test('domain membership, numeric mailbox names and wildcard whitelist rows never prove student-number ownership', async () => {
  const scenarios = [
    { user: { email_verified_at: null } },
    { user: { email: 'student@example.test' } },
    { user: { email: 'name@tsinghua.edu.cn.evil.test' } },
    { user: { email: 'name@other.tsinghua.edu.cn' } },
    { user: { email: '2024010901@mails.tsinghua.edu.cn' } },
    { entry: { student_id: null } },
    { entry: { email: null } },
    { entry: { full_name: '另一位同学' } },
    { entry: { active: 0 } },
    { entry: { claimed_user_id: 99 } },
    { entry: { email: 'someone.else@mails.tsinghua.edu.cn' } },
    { user: { student_id: '2023010999' } },
  ];
  for (const scenario of scenarios) {
    const f = bindingFixture({ user: scenario.user });
    Object.assign(f.state.entries[0], scenario.entry || {});
    const before = structuredClone(f.state.user);
    const result = await f.service.requestStudentId(8, {
      studentId: f.target,
      currentPassword: bindingPassword,
      email: f.schoolEmail,
      emailVerified: true,
      isAdmin: true,
    });
    assert.deepEqual(result, { status: 'pending' }, JSON.stringify(scenario));
    assert.equal(f.state.user.student_id, before.student_id);
    assert.equal(f.state.request.status, 'pending');
    assert.equal(f.state.request.reviewed_at, null);
    assert.equal(f.state.request.reviewed_by, null);
    assert.equal(f.state.user.role, before.role);
    assert.equal(f.state.entries[0].claimed_user_id, scenario.entry?.claimed_user_id ?? null);
  }
});

test('binding requires password proof and intact whitelist state, while identity conflicts roll back atomically', async () => {
  const wrong = bindingFixture();
  await assert.rejects(
    wrong.service.requestStudentId(8, {
      studentId: wrong.target,
      currentPassword: 'wrong-password',
    }),
    { code: 'current_password_wrong' },
  );
  assert.equal(wrong.state.request, null);
  const taken = bindingFixture({ taken: true });
  await assert.rejects(
    taken.service.requestStudentId(8, {
      studentId: taken.target,
      currentPassword: bindingPassword,
    }),
    { code: 'student_id_taken' },
  );
  assert.equal(taken.state.request, null);
  const race = bindingFixture({ race: true });
  await assert.rejects(
    race.service.requestStudentId(8, { studentId: race.target, currentPassword: bindingPassword }),
    { code: 'identity_taken' },
  );
  assert.equal(race.state.user.student_id, null);
  assert.equal(race.state.request, null);
  assert.equal(race.state.entries[0].claimed_user_id, null);
  assert.equal(race.state.rollbacks, 1);
  for (const option of [{ missingState: true }, { missingTable: true }]) {
    const f = bindingFixture(option);
    await assert.rejects(
      f.service.requestStudentId(8, { studentId: f.target, currentPassword: bindingPassword }),
      { code: option.missingState ? 'identity_whitelist_unavailable' : 'ER_NO_SUCH_TABLE' },
    );
    assert.equal(f.state.request, null);
    assert.equal(f.state.user.student_id, null);
  }
});

test('a pending student request can complete only after its explicitly paired school mailbox OTP succeeds', async () => {
  const requestedAt = new Date('2026-10-20T00:00:00Z');
  const f = bindingFixture({
    user: { email: null, email_verified_at: null },
    request: {
      user_id: 8,
      student_id: '2024010901',
      status: 'pending',
      requested_at: requestedAt,
      reviewed_by: null,
    },
  });
  const result = await f.service.bindEmail(8, {
    email: f.schoolEmail,
    currentPassword: bindingPassword,
    emailCode: bindingCode,
  });
  assert.deepEqual(result, { studentBinding: { status: 'bound' } });
  assert.equal(f.state.user.email, f.schoolEmail);
  assert.ok(f.state.user.email_verified_at);
  assert.equal(f.state.user.student_id, f.target);
  assert.equal(f.state.request.status, 'approved');
  assert.equal(f.state.request.reviewed_by, null);
  assert.deepEqual(f.state.request.requested_at, requestedAt);
  assert.ok(f.state.code.used_at);
  assert.equal(f.state.entries[0].claimed_user_id, 8);
});

test('incorrect OTP and unpaired pending identities never silently bind an identity', async () => {
  const request = { user_id: 8, student_id: '2024010901', status: 'pending' };
  const wrong = bindingFixture({ user: { email: null, email_verified_at: null }, request });
  await assert.rejects(
    wrong.service.bindEmail(8, {
      email: wrong.schoolEmail,
      currentPassword: bindingPassword,
      emailCode: '135790',
    }),
    { code: 'code_invalid' },
  );
  assert.equal(wrong.state.user.email, null);
  assert.equal(wrong.state.user.student_id, null);
  assert.equal(wrong.state.code.attempts, 1, 'wrong-code attempts must still commit');
  assert.equal(wrong.state.code.used_at, null);
  const unmatched = bindingFixture({ user: { email: null, email_verified_at: null }, request });
  unmatched.state.entries[0].email = null;
  assert.deepEqual(
    await unmatched.service.bindEmail(8, {
      email: unmatched.schoolEmail,
      currentPassword: bindingPassword,
      emailCode: bindingCode,
    }),
    { studentBinding: { status: 'pending' } },
  );
  assert.ok(unmatched.state.user.email_verified_at);
  assert.equal(unmatched.state.user.student_id, null);
  assert.equal(unmatched.state.request.status, 'pending');
});

test('a verified unique mailbox pair binds without requiring a student application or inventing a review', async () => {
  const absent = bindingFixture({ user: { email: null, email_verified_at: null } });
  assert.deepEqual(
    await absent.service.bindEmail(8, {
      email: absent.schoolEmail,
      currentPassword: bindingPassword,
      emailCode: bindingCode,
    }),
    { studentBinding: { status: 'bound' } },
  );
  assert.equal(absent.state.user.student_id, absent.target);
  assert.equal(absent.state.request, null);
  assert.equal(absent.state.entries[0].claimed_user_id, 8);
});

test('mailbox discovery refuses ambiguous, claimed and mismatched rows and keeps an unmatched pending target', async () => {
  for (const conflict of [
    { student_id: '2024210902' },
    { claimed_user_id: 99 },
    { full_name: '另一位同学' },
  ]) {
    const f = bindingFixture({ user: { email: null, email_verified_at: null } });
    f.state.entries.push({ ...f.state.entries[0], id: 12, ...conflict });
    assert.deepEqual(
      await f.service.bindEmail(8, {
        email: f.schoolEmail,
        currentPassword: bindingPassword,
        emailCode: bindingCode,
      }),
      {},
    );
    assert.equal(f.state.user.student_id, null);
    assert.equal(f.state.request, null);
    assert.equal(f.state.entries[0].claimed_user_id, null);
    assert.ok(
      f.state.user.email_verified_at,
      'the mailbox proof succeeds independently of an ambiguous number',
    );
  }
  const pending = bindingFixture({
    user: { email: null, email_verified_at: null },
    request: { user_id: 8, student_id: '2024310999', status: 'pending' },
  });
  assert.deepEqual(
    await pending.service.bindEmail(8, {
      email: pending.schoolEmail,
      currentPassword: bindingPassword,
      emailCode: bindingCode,
    }),
    { studentBinding: { status: 'pending' } },
  );
  assert.equal(pending.state.request.student_id, '2024310999');
  assert.equal(pending.state.request.status, 'pending');
  assert.equal(pending.state.user.student_id, null);
});

test('explicit student choices produce the same binding before or after OTP when a mailbox has two valid numbers', async () => {
  for (const numberFirst of [true, false]) {
    const f = bindingFixture({ user: { email: null, email_verified_at: null } });
    f.state.entries.push({ ...f.state.entries[0], id: 12, student_id: '2024210902' });
    if (numberFirst) {
      assert.deepEqual(
        await f.service.requestStudentId(8, {
          studentId: f.target,
          currentPassword: bindingPassword,
        }),
        { status: 'pending' },
      );
    }
    const email = await f.service.bindEmail(8, {
      email: f.schoolEmail,
      currentPassword: bindingPassword,
      emailCode: bindingCode,
    });
    if (numberFirst) {
      assert.deepEqual(email, { studentBinding: { status: 'bound' } });
      assert.equal(
        f.state.queries.some(({ sql }) =>
          sql.startsWith(
            'SELECT id, student_id, full_name, claimed_user_id FROM registration_whitelist',
          ),
        ),
        false,
        'a declared number is checked precisely, never replaced by whole-mailbox discovery',
      );
    } else {
      assert.deepEqual(
        email,
        {},
        'without an explicit choice an ambiguous mailbox must not pick a number',
      );
      assert.deepEqual(
        await f.service.requestStudentId(8, {
          studentId: f.target,
          currentPassword: bindingPassword,
        }),
        { status: 'bound' },
      );
    }
    assert.equal(f.state.user.student_id, f.target);
    assert.equal(f.state.request.student_id, f.target);
    assert.equal(f.state.request.status, 'approved');
    assert.equal(f.state.request.reviewed_by, null);
    assert.equal(f.state.entries[0].claimed_user_id, 8);
    assert.equal(f.state.entries[1].claimed_user_id, null);
    assert.equal(f.state.user.role, 'teacher');
    assert.equal(f.state.user.is_admin, 0);
  }
});

test('a uniqueness race while completing a pending request rolls back mailbox changes, OTP consumption and claims together', async () => {
  const f = bindingFixture({
    user: { email: 'old@example.test', email_verified_at: null },
    request: { user_id: 8, student_id: '2024010901', status: 'pending' },
    race: true,
  });
  await assert.rejects(
    f.service.bindEmail(8, {
      email: f.schoolEmail,
      currentPassword: bindingPassword,
      emailCode: bindingCode,
    }),
    { code: 'identity_taken' },
  );
  assert.equal(f.state.user.email, 'old@example.test');
  assert.equal(f.state.user.email_verified_at, null);
  assert.equal(f.state.user.student_id, null);
  assert.equal(f.state.code.used_at, null);
  assert.equal(f.state.request.status, 'pending');
  assert.equal(f.state.entries[0].claimed_user_id, null);
  assert.equal(f.state.commits, 0);
});

test('only admin-provisioned teacher and enterprise identities allow missing student ID and email', () => {
  const body = {
    username: 'professor_one',
    fullName: '测试教师',
    password: 'initial-password',
    role: 'teacher',
  };
  const teacher = normalizeAdminAccount(body);
  assert.equal(teacher.studentId, null);
  assert.equal(teacher.email, null);
  assert.equal(teacher.grade, null);
  assert.equal(teacher.major, null);
  const enterprise = normalizeAdminAccount({
    ...body,
    username: 'enterprise_one',
    role: 'enterprise',
  });
  assert.equal(enterprise.studentId, null);
  assert.equal(enterprise.email, null);
  assert.equal(enterprise.grade, null);
  for (const role of ['student', 'ta', 'admin']) {
    assert.throws(() => normalizeAdminAccount({ ...body, role }), { code: 'invalid_student_id' });
  }
  assert.throws(() => normalizeAdminAccount({ ...body, studentId: '123456' }), {
    code: 'invalid_student_id',
  });
  assert.throws(() => normalizeAdminAccount({ ...body, email: 'invalid' }), {
    code: 'invalid_email',
  });
  assert.throws(() => normalizeAdminAccount({ ...body, role: 'superuser' }), {
    code: 'invalid_role',
  });
  assert.throws(() => normalizeAdminAccount({ ...body, password: 'short' }), {
    code: 'invalid_password',
  });
  assert.throws(() => normalizeAdminAccount({ ...body, username: 'teacher@example.test' }), {
    code: 'invalid_username',
  });
  for (const username of ['中文教师', '中文企业', 'ab']) {
    assert.throws(() => normalizeAdminAccount({ ...body, username }), {
      code: 'invalid_username',
    });
  }
  assert.equal(
    normalizeAdminAccount({ ...body, email: ' Teacher@Example.test ' }).email,
    'teacher@example.test',
  );
});

test('password recovery looks up legacy Chinese and short usernames without allowing invalid identifiers', async () => {
  const queries = [];
  const service = createAccountIdentityService({
    pool: {
      async execute(sql, args) {
        queries.push({ sql, args });
        return [[]];
      },
    },
    sendCode: async () => assert.fail('A nonexistent account must not receive a code'),
  });
  for (const identifier of ['中文用户', '李老师_2026', '𠀀老师', 'ab', 'teacher_one']) {
    const body = { identifier, email: 'old@example.test', password: 'recovered-password' };
    await service.sendResetCode(body);
    await assert.rejects(service.resetPassword(body), { code: 'code_invalid' });
    assert.deepEqual(queries.at(-1).args, [identifier, 'old@example.test']);
    assert.match(
      queries.at(-1).sql,
      /username = \? AND email = \? AND email_verified_at IS NOT NULL/,
    );
  }
  const before = queries.length;
  for (const identifier of ['a', '中文🙂', 'bad name', 'abc\nxyz', 'x'.repeat(65), 'Ａbc']) {
    const body = { identifier, email: 'old@example.test', password: 'recovered-password' };
    await assert.rejects(service.sendResetCode(body), { code: 'invalid_username' });
    await assert.rejects(service.resetPassword(body), { code: 'invalid_username' });
  }
  assert.equal(queries.length, before);
});

test('binding HTTP results distinguish pending and bound and refresh only the authenticated identity', async (t) => {
  let status = 'pending';
  let reads = 0;
  const actors = [];
  const app = express();
  app.use(express.json());
  app.use(
    '/api',
    createTeacherAccountsRouter({
      service: {
        async requestStudentId(userId) {
          actors.push(userId);
          return { status };
        },
        async bindEmail(userId) {
          actors.push(userId);
          return { studentBinding: { status } };
        },
      },
      requireAuth: async () => ({ id: 8 }),
      getUserById: async (id) => {
        reads += 1;
        return { id, studentId: status === 'bound' ? '2024010901' : null, role: 'teacher' };
      },
      toUserProfile: (user) => user,
    }),
  );
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
      }),
  );
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (route, method) => {
    const response = await fetch(base + route, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 99, role: 'admin' }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return response.json();
  };
  const pending = await call('/profile/student-id', 'POST');
  assert.equal(pending.status, 'pending');
  assert.equal(pending.user, undefined);
  assert.equal(reads, 0);
  status = 'bound';
  const bound = await call('/profile/student-id', 'POST');
  assert.equal(bound.status, 'bound');
  assert.equal(bound.message, '学号已自动绑定');
  assert.deepEqual(bound.user, { id: 8, studentId: '2024010901', role: 'teacher' });
  const email = await call('/profile/email', 'PATCH');
  assert.deepEqual(email.studentBinding, { status: 'bound' });
  assert.equal(email.user.id, 8);
  assert.match(email.message, /学号已自动绑定/);
  assert.deepEqual(actors, [8, 8, 8]);
});

test('identity HTTP endpoints authenticate and administrator actions cannot be forged in the body', async (t) => {
  let calls = 0;
  const service = new Proxy(
    {},
    {
      get: () => async () => {
        calls += 1;
        return {};
      },
    },
  );
  const requireAuth = async (request, response) => {
    if (request.headers.authorization !== 'Bearer teacher') {
      response.status(401).json({ message: 'login required' });
      return null;
    }
    return { id: 2, role: 'teacher', is_admin: 0 };
  };
  const requireAdmin = async (request, response) => {
    const user = await requireAuth(request, response);
    if (user) response.status(403).json({ message: 'admin required' });
    return null;
  };
  const app = express();
  app.use(express.json());
  app.use('/api', createTeacherAccountsRouter({ service, requireAuth, requireAdmin }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
      }),
  );
  const base = `http://127.0.0.1:${server.address().port}/api`;
  assert.equal((await fetch(`${base}/profile/identity`)).status, 401);
  for (const route of ['/admin/users/2/reset-password', '/admin/student-id-requests/2']) {
    const response = await fetch(base + route, {
      method: 'POST',
      headers: { Authorization: 'Bearer teacher', 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin', isAdmin: true, action: 'approve' }),
    });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(calls, 0);
});
