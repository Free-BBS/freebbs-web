const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const mysql = require('mysql2/promise');
const {
  assertRegistrationWhitelisted,
  claimRegistrationWhitelist,
  createRegistrationWhitelistRouter,
  ensureRegistrationWhitelistTables,
  importRegistrationWhitelist,
  parseRegistrationWhitelist,
  validateXlsxArchive,
} = require('./registration-whitelist');

// In-memory upload fixtures exercise the production Excel import interface.
async function uploadFixture(rows, headers = ['学号', '姓名', '邮箱']) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('注册白名单');
  sheet.addRow(headers);
  sheet.addRows(rows);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

test('Excel template has a blank input sheet with text identifiers and separate examples', async () => {
  const buffer = await fs.readFile(
    path.join(__dirname, 'assets', 'registration-whitelist-template.xlsx'),
  );
  validateXlsxArchive(buffer);
  const archive = await JSZip.loadAsync(buffer);
  const sheet = await archive.file('xl/worksheets/sheet1.xml').async('string');
  const styles = await archive.file('xl/styles.xml').async('string');
  assert.match(sheet, /学号/);
  assert.match(sheet, /姓名/);
  assert.match(sheet, /邮箱/);
  assert.match(styles, /formatCode="@"/);
  assert.match(sheet, /state="frozen"/);
  assert.match(await archive.file('xl/workbook.xml').async('string'), /填写说明/);
  await assert.rejects(parseRegistrationWhitelist(buffer), /没有白名单记录/);
  const populated = sheet.replace(
    /<x:c r="C2"[^>]*\/>/,
    '<x:c r="C2" t="inlineStr"><x:is><x:t>template@example.edu</x:t></x:is></x:c>',
  );
  assert.notEqual(populated, sheet);
  archive.file('xl/worksheets/sheet1.xml', populated);
  const parsed = await parseRegistrationWhitelist(
    await archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
  );
  assert.deepEqual(parsed.identities, [
    { studentId: '', fullName: '', email: 'template@example.edu' },
  ]);
});

test('imports normalized AND conditions, partial restrictions, deduplicates identities, skips blank rows', async () => {
  const { identities, duplicates } = await parseRegistrationWhitelist(
    await uploadFixture([
      [2026000001, ' 张同学 ', ' Student@Example.edu '],
      ['2026000001', '张同学', 'student@example.edu'],
      [],
      ['2026000002'],
      [null, '姓名限定'],
      [null, null, 'guest@example.edu'],
    ]),
  );
  assert.equal(duplicates, 1);
  assert.deepEqual(identities, [
    { studentId: '2026000001', fullName: '张同学', email: 'student@example.edu' },
    { studentId: '2026000002', fullName: '', email: '' },
    { studentId: '', fullName: '姓名限定', email: '' },
    { studentId: '', fullName: '', email: 'guest@example.edu' },
  ]);
  const partial = await parseRegistrationWhitelist(
    await uploadFixture([['Alice@Example.edu']], ['email']),
  );
  assert.deepEqual(partial.identities, [
    { studentId: '', fullName: '', email: 'alice@example.edu' },
  ]);
});

test('accepts 128-character email addresses and rejects 129 before they exceed account storage', async () => {
  const longestEmail = `${'a'.repeat(60)}@${'b'.repeat(63)}.edu`;
  assert.equal(longestEmail.length, 128);
  const { identities } = await parseRegistrationWhitelist(
    await uploadFixture([[longestEmail]], ['邮箱']),
  );
  assert.equal(identities[0].email, longestEmail);
  await assert.rejects(
    parseRegistrationWhitelist(await uploadFixture([[`a${longestEmail}`]], ['邮箱'])),
    (error) => {
      assert.equal(error.status, 400);
      assert.deepEqual(error.errors, [{ row: 2, message: '邮箱格式不正确或超过 128 个字符' }]);
      return true;
    },
  );
});

test('rejects every import when any row has invalid fields, formulas, dates, or empty restrictions', async () => {
  const buffer = await uploadFixture(
    [
      ['2026000001', '正确', 'valid@example.edu'],
      ['1900000000'],
      [null, { formula: '"张同学"', result: '张同学' }],
      [null, new Date('2026-01-01T00:00:00Z')],
      [null, ' ', null, '只有备注'],
      [null, null, 'invalid'],
    ],
    ['学号', '姓名', '邮箱', '备注'],
  );
  await assert.rejects(parseRegistrationWhitelist(buffer), (error) => {
    assert.equal(error.status, 400);
    assert.deepEqual(
      error.errors.map((item) => item.row),
      [3, 4, 5, 6, 7],
    );
    assert.match(error.message, /未导入任何记录/);
    return true;
  });
});

test('rejects unrecognized, duplicate, and formula headers with a useful client error', async () => {
  for (const headers of [['备注'], ['学号', 'student_id'], ['学号', '邮相']]) {
    await assert.rejects(
      parseRegistrationWhitelist(await uploadFixture([['2026000001']], headers)),
      (error) => error.status === 400,
    );
  }
  await assert.rejects(
    parseRegistrationWhitelist(
      await uploadFixture([['2026000001']], [{ formula: '"学号"', result: '学号' }]),
    ),
    (error) => error.status === 400,
  );
});

test('rejects excess rows and zip archives with invalid or oversized expansion metadata', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('注册白名单');
  sheet.addRow(['邮箱']);
  sheet.getCell('A10002').value = 'last@example.edu';
  await assert.rejects(
    parseRegistrationWhitelist(Buffer.from(await workbook.xlsx.writeBuffer())),
    /最多 10000 行/,
  );
  const valid = await uploadFixture([['2026000001']]);
  for (const invalid of [Buffer.from('not excel'), Buffer.alloc(5 * 1024 * 1024 + 1)]) {
    assert.throws(() => validateXlsxArchive(invalid));
  }
  const corrupt = Buffer.from(valid);
  const end = corrupt.length - 22;
  const central = corrupt.readUInt32LE(end + 16);
  corrupt.writeUInt32LE(25 * 1024 * 1024, central + 24);
  assert.throws(() => validateXlsxArchive(corrupt), /解压后过大/);
  const dishonest = Buffer.from(valid);
  dishonest.writeUInt32LE(1, central + 24);
  assert.throws(() => validateXlsxArchive(dishonest), /有效的 Excel/);
});

test('eligibility fails closed and uses normalized parameters with every field required', async () => {
  let captured;
  const database = {
    execute: async (sql, parameters) => {
      captured = { sql, parameters };
      return [[]];
    },
  };
  await assert.rejects(
    assertRegistrationWhitelisted(database, {
      studentId: ' 2026000001 ',
      fullName: ' 张同学 ',
      email: ' USER@EXAMPLE.EDU ',
    }),
    (error) => error.status === 403 && error.code === 'registration_not_whitelisted',
  );
  assert.deepEqual(captured.parameters, ['2026000001', '张同学', 'user@example.edu']);
  assert.match(captured.sql, /student_id IS NULL OR BINARY student_id = BINARY \?/);
  assert.match(captured.sql, /AND \(full_name IS NULL OR BINARY full_name = BINARY \?\)/);
  assert.match(captured.sql, /AND \(email IS NULL OR BINARY email = BINARY \?\)/);
  await assert.rejects(
    assertRegistrationWhitelisted({ execute: async () => [[{ id: 1, claimed_user_id: 7 }]] }, {}),
    /不在可注册白名单/,
  );
});

test('all admin whitelist endpoints authenticate before accessing files or database', async (context) => {
  const app = express();
  app.use(
    '/whitelist',
    createRegistrationWhitelistRouter({
      pool: { execute: async () => assert.fail('unauthorized request touched database') },
      requireAdmin: async (request, response) => {
        response.status(403).json({ message: '需要管理员权限' });
        return null;
      },
    }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => {
    server.once('listening', resolve);
  });
  context.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
      }),
  );
  const base = `http://127.0.0.1:${server.address().port}/whitelist`;
  for (const [method, suffix] of [
    ['GET', ''],
    ['GET', '/template'],
    ['POST', '/import'],
    ['DELETE', '/1'],
  ]) {
    assert.equal((await fetch(`${base}${suffix}`, { method })).status, 403);
  }
});

test(
  'MySQL transactions preserve claims, roll back imports, and serialize registrations',
  {
    skip: process.env.WHITELIST_TEST_MYSQL !== '1',
  },
  async (context) => {
    const database = `freebbs_whitelist_test_${crypto.randomBytes(6).toString('hex')}`;
    const config = {
      host: '127.0.0.1',
      port: 3306,
      user: 'root',
      password: '',
      connectionLimit: 4,
    };
    const control = await mysql.createConnection(config);
    await control.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`);
    const pool = mysql.createPool({ ...config, database });
    context.after(async () => {
      await pool.end();
      await control.query(`DROP DATABASE ${database}`);
      await control.end();
    });
    await pool.execute(`CREATE TABLE users (id BIGINT UNSIGNED PRIMARY KEY,
    student_id VARCHAR(10), full_name VARCHAR(64), email VARCHAR(255))`);
    await ensureRegistrationWhitelistTables(pool);
    const identity = { studentId: '2026000001', fullName: '张同学', email: 'student@example.edu' };
    await importRegistrationWhitelist(pool, [identity, { studentId: identity.studentId }], {
      actorId: 1,
    });
    for (const mismatch of [
      { ...identity, fullName: '别人' },
      { ...identity, studentId: '2026000009' },
    ]) {
      // The student-only row allows another name on the same student number.
      if (mismatch.studentId === identity.studentId)
        assert.equal((await assertRegistrationWhitelisted(pool, mismatch)).length, 1);
      else await assert.rejects(assertRegistrationWhitelisted(pool, mismatch), /不在可注册白名单/);
    }
    const first = await pool.getConnection();
    const second = await pool.getConnection();
    try {
      await first.beginTransaction();
      await assertRegistrationWhitelisted(first, identity, { lock: true });
      await second.beginTransaction();
      const contested = assertRegistrationWhitelisted(second, identity, { lock: true });
      await claimRegistrationWhitelist(first, identity, 88);
      await first.commit();
      await assert.rejects(contested, /不在可注册白名单/);
      await second.rollback();
    } finally {
      first.release();
      second.release();
    }
    const [claimed] = await pool.execute('SELECT claimed_user_id FROM registration_whitelist');
    assert.deepEqual(
      claimed.map((row) => Number(row.claimed_user_id)),
      [88, 88],
    );
    await importRegistrationWhitelist(pool, [{ email: 'new@example.edu' }], { mode: 'replace' });
    await importRegistrationWhitelist(pool, [identity], { mode: 'replace' });
    await assert.rejects(assertRegistrationWhitelisted(pool, identity), /不在可注册白名单/);
    const [before] = await pool.execute(
      'SELECT id, active, claimed_user_id FROM registration_whitelist ORDER BY id',
    );
    await assert.rejects(
      importRegistrationWhitelist(pool, [{ studentId: 'wrong-length' }], { mode: 'replace' }),
    );
    const [after] = await pool.execute(
      'SELECT id, active, claimed_user_id FROM registration_whitelist ORDER BY id',
    );
    assert.deepEqual(after, before);
    await pool.execute('INSERT INTO users VALUES (99, ?, ?, ?)', [
      '2026000099',
      '已有账户',
      'existing@example.edu',
    ]);
    await importRegistrationWhitelist(pool, [{ email: 'existing@example.edu' }]);
    await assert.rejects(
      assertRegistrationWhitelisted(pool, { email: 'existing@example.edu' }),
      /不在可注册白名单/,
    );

    const app = express();
    app.use(
      '/whitelist',
      createRegistrationWhitelistRouter({ pool, requireAdmin: async () => ({ id: 1 }) }),
    );
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => {
      server.once('listening', resolve);
    });
    context.after(
      () =>
        new Promise((resolve) => {
          server.close(resolve);
        }),
    );
    const base = `http://127.0.0.1:${server.address().port}/whitelist`;
    const template = await fetch(`${base}/template`);
    assert.equal(template.status, 200);
    assert.match(template.headers.get('content-disposition'), /attachment/);
    validateXlsxArchive(Buffer.from(await template.arrayBuffer()));
    const imported = await fetch(`${base}/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: await uploadFixture([[null, null, 'newperson@example.edu']]),
    });
    assert.equal(imported.status, 200);
    const listed = await (await fetch(`${base}?search=newperson`)).json();
    assert.equal(listed.total, 1);
    assert.equal(listed.entries[0].claimed, false);
    assert.equal(
      (await fetch(`${base}/${listed.entries[0].id}`, { method: 'DELETE' })).status,
      200,
    );
    await assert.rejects(
      assertRegistrationWhitelisted(pool, { email: 'newperson@example.edu' }),
      /不在可注册白名单/,
    );
    assert.equal((await fetch(`${base}?search=%25`)).status, 200);
  },
);
