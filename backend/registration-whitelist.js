const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { inflateRawSync } = require('node:zlib');
const express = require('express');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 24 * 1024 * 1024;
const MAX_ROWS = 10000;
const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const TEMPLATE_PATH = path.join(__dirname, 'assets', 'registration-whitelist-template.xlsx');
const schemaPromises = new WeakMap();
const MATCH_SQL = `(student_id IS NULL OR BINARY student_id = BINARY ?)
  AND (full_name IS NULL OR BINARY full_name = BINARY ?)
  AND (email IS NULL OR BINARY email = BINARY ?)`;

class RegistrationWhitelistError extends Error {
  constructor(message, { status = 400, code = 'whitelist_invalid', errors = [] } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.errors = errors;
  }
}

function normalizeIdentity(identity = {}) {
  return {
    studentId: String(identity.studentId ?? '').trim(),
    fullName: String(identity.fullName ?? '').trim(),
    email: String(identity.email ?? '')
      .trim()
      .toLowerCase(),
  };
}

function identityParameters(identity) {
  const normalized = normalizeIdentity(identity);
  return [normalized.studentId, normalized.fullName, normalized.email];
}

function fingerprintIdentity(identity) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(identityParameters(identity)))
    .digest('hex');
}

async function ensureRegistrationWhitelistTables(pool) {
  if (!schemaPromises.has(pool)) {
    schemaPromises.set(
      pool,
      (async () => {
        const migration = await fs.readFile(
          path.join(__dirname, '..', 'database', 'migrations', '025_registration_whitelist.sql'),
          'utf8',
        );
        for (const statement of migration
          .split(';')
          .map((value) => value.trim())
          .filter(Boolean)) {
          await pool.execute(statement);
        }
      })().catch((error) => {
        schemaPromises.delete(pool);
        throw error;
      }),
    );
  }
  await schemaPromises.get(pool);
}

async function lockWhitelist(connection) {
  await connection.execute('SELECT id FROM registration_whitelist_state WHERE id = 1 FOR UPDATE');
}

// Lock the shared state row inside the caller's transaction before creating the user.
// Imports and deletions take the same lock, so eligibility cannot change mid-registration.
async function assertRegistrationWhitelisted(database, identity, { lock = false } = {}) {
  if (lock) await lockWhitelist(database);
  const [entries] = await database.execute(
    `SELECT id, claimed_user_id FROM registration_whitelist
     WHERE active = 1 AND ${MATCH_SQL} ORDER BY id${lock ? ' FOR UPDATE' : ''}`,
    identityParameters(identity),
  );
  if (!entries.length || !entries.some((entry) => entry.claimed_user_id == null)) {
    throw new RegistrationWhitelistError(
      '该身份不在可注册白名单中，请联系管理员核对学号、姓名和邮箱',
      {
        status: 403,
        code: 'registration_not_whitelisted',
      },
    );
  }
  return entries.filter((entry) => entry.claimed_user_id == null).map((entry) => entry.id);
}

async function claimRegistrationWhitelist(connection, identity, userId) {
  // Recheck under the same lock and consume every matching unused row, including overlaps.
  await assertRegistrationWhitelisted(connection, identity, { lock: true });
  const [result] = await connection.execute(
    `UPDATE registration_whitelist SET claimed_user_id = ?, claimed_at = CURRENT_TIMESTAMP
     WHERE active = 1 AND claimed_user_id IS NULL AND ${MATCH_SQL}`,
    [userId, ...identityParameters(identity)],
  );
  if (!result.affectedRows) {
    throw new RegistrationWhitelistError('该白名单身份已被注册', {
      status: 409,
      code: 'registration_identity_claimed',
    });
  }
}

// Bound expansion before ExcelJS parses XML. This also rejects ZIP64, encryption,
// unsupported compression, and conflicting archive metadata.
function validateXlsxArchive(buffer) {
  const invalid = () => new RegistrationWhitelistError('文件不是有效的 Excel .xlsx 工作簿');
  if (!Buffer.isBuffer(buffer) || buffer.length < 22 || buffer.length > MAX_FILE_BYTES) {
    throw new RegistrationWhitelistError('请上传不超过 5 MB 的 Excel .xlsx 文件');
  }
  let end = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      end = offset;
      break;
    }
  }
  if (end < 0 || end + 22 + buffer.readUInt16LE(end + 20) !== buffer.length) throw invalid();
  const entryCount = buffer.readUInt16LE(end + 10);
  const centralLength = buffer.readUInt32LE(end + 12);
  let position = buffer.readUInt32LE(end + 16);
  if (
    buffer.readUInt16LE(end + 4) !== 0 ||
    buffer.readUInt16LE(end + 6) !== 0 ||
    buffer.readUInt16LE(end + 8) !== entryCount ||
    entryCount === 0 ||
    entryCount > 200 ||
    position + centralLength !== end
  )
    throw invalid();
  let totalExpanded = 0;
  const names = new Set();
  for (let index = 0; index < entryCount; index += 1) {
    if (position + 46 > end || buffer.readUInt32LE(position) !== 0x02014b50) throw invalid();
    const flags = buffer.readUInt16LE(position + 8);
    const method = buffer.readUInt16LE(position + 10);
    const compressed = buffer.readUInt32LE(position + 20);
    const expanded = buffer.readUInt32LE(position + 24);
    const nameLength = buffer.readUInt16LE(position + 28);
    const extraLength = buffer.readUInt16LE(position + 30);
    const commentLength = buffer.readUInt16LE(position + 32);
    const localOffset = buffer.readUInt32LE(position + 42);
    const nextPosition = position + 46 + nameLength + extraLength + commentLength;
    if (nextPosition > end || flags % 2 !== 0 || ![0, 8].includes(method)) throw invalid();
    const name = buffer.subarray(position + 46, position + 46 + nameLength).toString('utf8');
    if (names.has(name) || name.startsWith('/') || name.includes('..') || name.includes('\\'))
      throw invalid();
    names.add(name);
    if (localOffset + 30 > position || buffer.readUInt32LE(localOffset) !== 0x04034b50)
      throw invalid();
    if (
      buffer.readUInt16LE(localOffset + 8) !== method ||
      buffer.readUInt16LE(localOffset + 6) !== flags
    )
      throw invalid();
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const start = localOffset + 30 + localNameLength + buffer.readUInt16LE(localOffset + 28);
    const localName = buffer
      .subarray(localOffset + 30, localOffset + 30 + localNameLength)
      .toString('utf8');
    if (localName !== name || start + compressed > position) throw invalid();
    totalExpanded += expanded;
    if (totalExpanded > MAX_EXPANDED_BYTES)
      throw new RegistrationWhitelistError('工作簿解压后过大，请减少工作表或数据行');
    try {
      const content = buffer.subarray(start, start + compressed);
      const actualSize =
        method === 0
          ? content.length
          : inflateRawSync(content, {
              maxOutputLength: Math.min(MAX_EXPANDED_BYTES, expanded + 1),
            }).length;
      if (actualSize !== expanded) throw invalid();
    } catch {
      throw invalid();
    }
    position = nextPosition;
  }
  if (position !== end || !names.has('[Content_Types].xml') || !names.has('xl/workbook.xml'))
    throw invalid();
}

function cellText(cell) {
  const { value } = cell;
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (value && Array.isArray(value.richText))
    return value.richText
      .map((part) => part.text)
      .join('')
      .trim();
  if (value && value.hyperlink && typeof value.text === 'string') return value.text.trim();
  throw new Error('请使用文本，不支持公式、日期或错误值');
}

// ExcelJS assumes unprefixed SpreadsheetML element names. Standards-compliant
// writers may use x:workbook / x:worksheet, so normalize those names before load.
async function normalizeSpreadsheetNamespaces(buffer) {
  const archive = await JSZip.loadAsync(buffer);
  let changed = false;
  for (const entry of Object.values(archive.files)) {
    if (
      entry.dir ||
      !/^xl\/(workbook|styles|sharedStrings|worksheets\/[^/]+)\.xml$/.test(entry.name)
    )
      continue;
    const xml = await entry.async('string');
    const declaration = xml.match(
      /xmlns:([A-Za-z_][\w.-]*)=["']http:\/\/schemas\.openxmlformats\.org\/spreadsheetml\/2006\/main["']/,
    );
    if (!declaration) continue;
    const prefix = declaration[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const normalized = xml
      .replace(declaration[0], 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"')
      .replace(new RegExp(`(<\\/?)${prefix}:`, 'g'), '$1');
    archive.file(entry.name, normalized);
    changed = true;
  }
  return changed ? archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) : buffer;
}

async function parseRegistrationWhitelist(buffer) {
  validateXlsxArchive(buffer);
  const workbook = new ExcelJS.Workbook();
  try {
    const normalized = await normalizeSpreadsheetNamespaces(buffer);
    await workbook.xlsx.load(normalized, { ignoreNodes: ['drawing', 'picture', 'extLst'] });
  } catch {
    throw new RegistrationWhitelistError('无法读取工作簿，请重新保存为 Excel .xlsx 格式');
  }
  const sheet = workbook.getWorksheet('注册白名单') || workbook.worksheets[0];
  if (!sheet || sheet.rowCount > MAX_ROWS + 1 || sheet.columnCount > 30) {
    throw new RegistrationWhitelistError(`白名单最多 ${MAX_ROWS} 行，工作表最多 30 列`);
  }
  const aliases = new Map([
    ['学号', 'studentId'],
    ['studentid', 'studentId'],
    ['student_id', 'studentId'],
    ['姓名', 'fullName'],
    ['fullname', 'fullName'],
    ['full_name', 'fullName'],
    ['邮箱', 'email'],
    ['email', 'email'],
  ]);
  const columns = {};
  try {
    sheet.getRow(1).eachCell((cell, column) => {
      const header = cellText(cell).toLowerCase();
      const key = aliases.get(header);
      if (header && !key && !['备注', 'notes'].includes(header)) {
        throw new RegistrationWhitelistError(
          `无法识别表头“${header}”，请使用学号、姓名、邮箱或备注`,
        );
      }
      if (key && columns[key])
        throw new RegistrationWhitelistError('表头不能包含重复的学号、姓名或邮箱列');
      if (key) columns[key] = column;
    });
  } catch (error) {
    if (error instanceof RegistrationWhitelistError) throw error;
    throw new RegistrationWhitelistError(`第一行表头无效：${error.message}`);
  }
  if (!Object.keys(columns).length)
    throw new RegistrationWhitelistError('第一行需包含“学号”“姓名”“邮箱”表头，可省略不限制的列');
  const identities = [];
  const errors = [];
  const seen = new Set();
  let duplicates = 0;
  for (let rowIndex = 2; rowIndex <= sheet.rowCount; rowIndex += 1) {
    const row = sheet.getRow(rowIndex);
    if (!row.hasValues) continue;
    try {
      const identity = normalizeIdentity(
        Object.fromEntries(
          Object.entries(columns).map(([key, column]) => [key, cellText(row.getCell(column))]),
        ),
      );
      if (!identityParameters(identity).some(Boolean))
        throw new Error('学号、姓名、邮箱至少填写一项');
      if (identity.studentId && !/^20\d{8}$/.test(identity.studentId))
        throw new Error('学号必须是 20 开头的 10 位数字');
      if (identity.fullName.length > 64) throw new Error('姓名不能超过 64 个字符');
      if (
        identity.email &&
        (identity.email.length > 128 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity.email))
      )
        throw new Error('邮箱格式不正确或超过 128 个字符');
      const fingerprint = fingerprintIdentity(identity);
      if (seen.has(fingerprint)) duplicates += 1;
      else {
        identities.push(identity);
        seen.add(fingerprint);
      }
    } catch (error) {
      if (errors.length < 30) errors.push({ row: rowIndex, message: error.message });
    }
  }
  if (errors.length)
    throw new RegistrationWhitelistError('工作簿存在错误，未导入任何记录', { errors });
  if (!identities.length)
    throw new RegistrationWhitelistError('工作簿中没有白名单记录，请从第二行填写');
  return { identities, duplicates };
}

async function importRegistrationWhitelist(pool, identities, { mode = 'append', actorId } = {}) {
  if (!['append', 'replace'].includes(mode))
    throw new RegistrationWhitelistError('导入模式必须为 append 或 replace');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await lockWhitelist(connection);
    if (mode === 'replace')
      await connection.execute('UPDATE registration_whitelist SET active = 0 WHERE active = 1');
    for (const identity of identities) {
      const parameters = identityParameters(identity).map((value) => value || null);
      await connection.execute(
        `INSERT INTO registration_whitelist (fingerprint, student_id, full_name, email, created_by)
         VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE active = 1`,
        [fingerprintIdentity(identity), ...parameters, actorId || null],
      );
    }
    // Existing accounts also consume matching rows. Keep claims when rows are removed
    // and later re-imported, or when an account is deleted.
    await connection.execute(
      `UPDATE registration_whitelist w JOIN users u
       ON (w.student_id IS NULL OR BINARY w.student_id = BINARY TRIM(u.student_id))
       AND (w.full_name IS NULL OR BINARY w.full_name = BINARY TRIM(u.full_name))
       AND (w.email IS NULL OR BINARY w.email = BINARY LOWER(TRIM(u.email)))
       SET w.claimed_user_id = u.id, w.claimed_at = CURRENT_TIMESTAMP
       WHERE w.active = 1 AND w.claimed_user_id IS NULL`,
    );
    await connection.execute(
      'UPDATE registration_whitelist_state SET updated_at = CURRENT_TIMESTAMP WHERE id = 1',
    );
    await connection.commit();
    return { imported: identities.length, mode };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function createRegistrationWhitelistRouter({ pool, requireAdmin }) {
  const router = express.Router();
  router.use(async (request, response, next) => {
    try {
      const user = await requireAdmin(request, response);
      if (!user) return;
      request.whitelistAdminId = user.id;
      await ensureRegistrationWhitelistTables(pool);
      next();
    } catch (error) {
      next(error);
    }
  });
  router.get('/template', (request, response, next) => {
    response.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.download(TEMPLATE_PATH, 'registration-whitelist-template.xlsx', (error) => {
      if (error) next(error);
    });
  });
  router.get('/', async (request, response, next) => {
    try {
      const page = Math.max(1, Math.min(100000, Number.parseInt(request.query.page, 10) || 1));
      const search = String(request.query.search || '')
        .trim()
        .slice(0, 255);
      const like = `%${search.replace(/[!%_]/g, '!$&')}%`;
      const where = `active = 1 AND (? = '' OR student_id LIKE ? ESCAPE '!' OR full_name LIKE ? ESCAPE '!' OR email LIKE ? ESCAPE '!')`;
      const parameters = [search, like, like, like];
      const [[rows], [totals], [counts]] = await Promise.all([
        pool.execute(
          `SELECT id, student_id, full_name, email, claimed_user_id, claimed_at, created_at
          FROM registration_whitelist WHERE ${where} ORDER BY id DESC LIMIT 50 OFFSET ${(page - 1) * 50}`,
          parameters,
        ),
        pool.execute(
          `SELECT COUNT(*) AS total FROM registration_whitelist WHERE ${where}`,
          parameters,
        ),
        pool.execute(`SELECT COUNT(*) AS total, COALESCE(SUM(claimed_user_id IS NOT NULL), 0) AS claimed
          FROM registration_whitelist WHERE active = 1`),
      ]);
      response.set('Cache-Control', 'no-store').json({
        entries: rows.map((row) => ({
          id: row.id,
          studentId: row.student_id,
          fullName: row.full_name,
          email: row.email,
          claimed: row.claimed_user_id != null,
          claimedAt: row.claimed_at,
        })),
        page,
        pageSize: 50,
        total: Number(totals[0].total),
        stats: { total: Number(counts[0].total), claimed: Number(counts[0].claimed) },
      });
    } catch (error) {
      next(error);
    }
  });
  router.post(
    '/import',
    express.raw({ type: [XLSX_CONTENT_TYPE, 'application/octet-stream'], limit: MAX_FILE_BYTES }),
    async (request, response, next) => {
      try {
        const parsed = await parseRegistrationWhitelist(request.body);
        const result = await importRegistrationWhitelist(pool, parsed.identities, {
          mode: request.query.mode || 'append',
          actorId: request.whitelistAdminId,
        });
        response.json({ ...result, duplicates: parsed.duplicates });
      } catch (error) {
        next(error);
      }
    },
  );
  router.delete('/:id', async (request, response, next) => {
    let connection;
    try {
      if (!/^[1-9]\d{0,15}$/.test(request.params.id))
        throw new RegistrationWhitelistError('无效的白名单记录');
      connection = await pool.getConnection();
      await connection.beginTransaction();
      await lockWhitelist(connection);
      await connection.execute('UPDATE registration_whitelist SET active = 0 WHERE id = ?', [
        request.params.id,
      ]);
      await connection.commit();
      response.json({ success: true });
    } catch (error) {
      if (connection) await connection.rollback();
      next(error);
    } finally {
      if (connection) connection.release();
    }
  });
  // Express recognizes error handlers by their four-argument signature.
  router.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    let status = 500;
    if (error.status === 413) status = 413;
    else if (error instanceof RegistrationWhitelistError) status = error.status;
    let { message } = error;
    if (status === 413) message = '文件不能超过 5 MB';
    else if (status === 500) message = '白名单操作失败，请稍后重试';
    response.status(status).json({
      message,
      code: error.code || 'whitelist_error',
      errors: error.errors || [],
    });
  });
  return router;
}

module.exports = {
  RegistrationWhitelistError,
  assertRegistrationWhitelisted,
  claimRegistrationWhitelist,
  createRegistrationWhitelistRouter,
  ensureRegistrationWhitelistTables,
  fingerprintIdentity,
  importRegistrationWhitelist,
  normalizeIdentity,
  parseRegistrationWhitelist,
  validateXlsxArchive,
};
