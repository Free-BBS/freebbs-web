const crypto = require('node:crypto');
const express = require('express');
const { validateDocument } = require('../public/circuit-engine');

const CID_PATTERN = /^c_[0-9a-f]{24}$/;
const MAX_DOCUMENT_BYTES = 256 * 1024;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

class CircuitError extends Error {
  constructor(message, status = 400, code = 'invalid_circuit') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function ensureCircuitTables(pool) {
  await pool.execute(`CREATE TABLE IF NOT EXISTS circuits (
    cid CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    owner_id BIGINT NULL,
    current_revision INT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_circuits_owner FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE SET NULL,
    INDEX idx_circuits_owner_updated (owner_id, updated_at, cid)
  )`);
  await pool.execute(`CREATE TABLE IF NOT EXISTS circuit_revisions (
    cid CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    revision INT UNSIGNED NOT NULL,
    title VARCHAR(120) NOT NULL,
    description TEXT NOT NULL,
    document_json MEDIUMTEXT NOT NULL,
    created_by BIGINT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (cid, revision),
    CONSTRAINT fk_circuit_revisions_circuit FOREIGN KEY (cid) REFERENCES circuits (cid) ON DELETE CASCADE,
    CONSTRAINT fk_circuit_revisions_author FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
  )`);
}

function assertSafeJson(value) {
  let count = 0;
  function visit(current, depth) {
    count += 1;
    if (depth > 12 || count > 25000) throw new CircuitError('电路数据层级或字段数量过多');
    if (current === null || typeof current === 'string' || typeof current === 'boolean') return;
    if (typeof current === 'number' && Number.isFinite(current)) return;
    if (typeof current !== 'object') throw new CircuitError('电路数据必须是有效的 JSON');
    if (!Array.isArray(current)) {
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new CircuitError('电路数据必须是普通 JSON 对象');
      }
    }
    for (const [key, child] of Object.entries(current)) {
      if (FORBIDDEN_KEYS.has(key)) throw new CircuitError('电路数据包含不允许的字段');
      visit(child, depth + 1);
    }
  }
  visit(value, 0);
}

function validateCircuitInput(body, { updating = false } = {}) {
  assertSafeJson(body);
  if (!body || Array.isArray(body) || typeof body !== 'object') {
    throw new CircuitError('请提供电路标题、说明和文档');
  }
  const fields = new Set(['title', 'description', 'document']);
  if (updating) fields.add('expectedRevision');
  if (Object.keys(body).some((key) => !fields.has(key))) {
    throw new CircuitError('电路请求包含不支持的字段');
  }
  if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 120) {
    throw new CircuitError('电路标题须为 1 至 120 个字符');
  }
  if (
    Array.from(body.title).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  ) {
    throw new CircuitError('电路标题不能包含控制字符');
  }
  const description = body.description === undefined ? '' : body.description;
  if (typeof description !== 'string' || description.length > 2000 || description.includes('\0')) {
    throw new CircuitError('电路说明不能超过 2000 个字符');
  }
  if (!body.document || typeof body.document !== 'object' || Array.isArray(body.document)) {
    throw new CircuitError('请提供电路文档');
  }
  if (Buffer.byteLength(JSON.stringify(body.document), 'utf8') > MAX_DOCUMENT_BYTES) {
    throw new CircuitError('电路文档不能超过 256 KiB', 413, 'circuit_too_large');
  }
  if (
    updating &&
    (!Number.isSafeInteger(body.expectedRevision) ||
      body.expectedRevision < 1 ||
      body.expectedRevision >= 4294967295)
  ) {
    throw new CircuitError('保存电路时必须提供有效的 expectedRevision');
  }
  let document;
  try {
    document = validateDocument(body.document);
  } catch (error) {
    throw new CircuitError(error.message || '电路文档无效');
  }
  return {
    title: body.title.trim(),
    description: description.trim(),
    document,
    ...(updating ? { expectedRevision: body.expectedRevision } : {}),
  };
}

function validateCid(cid) {
  if (typeof cid !== 'string' || cid.length !== 26 || !CID_PATTERN.test(cid)) {
    throw new CircuitError('电路 CID 无效');
  }
}

function readIntegerQuery(value, { name, min = 1, max = 4294967295, fallback } = {}) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new CircuitError(`${name} 参数无效`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || String(number) !== value || number < min || number > max) {
    throw new CircuitError(`${name} 参数无效`);
  }
  return number;
}

function canEditCircuit(user, ownerId) {
  return Boolean(
    user && (user.is_admin || user.role === 'admin' || String(user.id) === String(ownerId)),
  );
}

function toCircuit(row, user, { summary = false } = {}) {
  return {
    cid: row.cid,
    title: row.title,
    description: row.description,
    ...(!summary ? { document: JSON.parse(row.document_json) } : {}),
    revision: Number(row.revision),
    latestRevision: Number(row.current_revision),
    owner: { uid: row.uid || null, username: row.username || '已注销用户' },
    canEdit: canEditCircuit(user, row.owner_id),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.revision_created_at).toISOString(),
  };
}

async function readCircuit(connection, cid, revision, user) {
  const [rows] = await connection.execute(
    `SELECT c.cid, c.owner_id, c.current_revision, c.created_at,
      r.revision, r.title, r.description, r.document_json, r.created_at AS revision_created_at,
      u.uid, u.username
     FROM circuits c
     JOIN circuit_revisions r ON r.cid = c.cid AND r.revision = ${revision ? '?' : 'c.current_revision'}
     LEFT JOIN users u ON u.id = c.owner_id
     WHERE c.cid = ? LIMIT 1`,
    revision ? [revision, cid] : [cid],
  );
  if (!rows[0]) throw new CircuitError('电路或指定版本不存在', 404, 'circuit_not_found');
  return toCircuit(rows[0], user);
}

async function withTransaction(pool, callback) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function insertRevision(connection, cid, revision, data, userId) {
  await connection.execute(
    `INSERT INTO circuit_revisions (cid, revision, title, description, document_json, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [cid, revision, data.title, data.description, JSON.stringify(data.document), userId],
  );
}

function createCircuitsRouter({ pool, requireAuth }) {
  const router = express.Router();
  function handle(handler) {
    return async (request, response) => {
      try {
        response.setHeader('Cache-Control', 'no-store');
        await handler(request, response);
      } catch (error) {
        if (error instanceof CircuitError) {
          response.status(error.status).json({ message: error.message, code: error.code });
        } else {
          console.error('Circuit request failed', error.code || error.message);
          response.status(500).json({ message: '电路保存或读取失败，请稍后重试' });
        }
      }
    };
  }
  router.get(
    '/',
    handle(async (request, response) => {
      const user = await requireAuth(request, response);
      if (!user) return;
      if (request.query.mine !== '1') throw new CircuitError('请使用 mine=1 查看自己的电路');
      const limit = readIntegerQuery(request.query.limit, {
        name: 'limit',
        max: 100,
        fallback: 100,
      });
      const offset = readIntegerQuery(request.query.offset, {
        name: 'offset',
        min: 0,
        max: 1000000,
        fallback: 0,
      });
      const [rows] = await pool.query(
        `SELECT c.cid, c.owner_id, c.current_revision, c.created_at,
          r.revision, r.title, r.description, r.created_at AS revision_created_at, u.uid, u.username
         FROM circuits c
         JOIN circuit_revisions r ON r.cid = c.cid AND r.revision = c.current_revision
         LEFT JOIN users u ON u.id = c.owner_id
         WHERE c.owner_id = ? ORDER BY c.updated_at DESC, c.cid ASC LIMIT ? OFFSET ?`,
        [user.id, limit + 1, offset],
      );
      response.json({
        circuits: rows.slice(0, limit).map((row) => toCircuit(row, user, { summary: true })),
        hasMore: rows.length > limit,
        offset,
        limit,
      });
    }),
  );
  router.get(
    '/:cid',
    handle(async (request, response) => {
      let user = null;
      if (request.headers.authorization) {
        user = await requireAuth(request, response);
        if (!user) return;
      }
      validateCid(request.params.cid);
      const revision =
        request.query.revision === undefined
          ? null
          : readIntegerQuery(request.query.revision, { name: 'revision' });
      response.json({ circuit: await readCircuit(pool, request.params.cid, revision, user) });
    }),
  );
  router.post(
    '/',
    handle(async (request, response) => {
      const user = await requireAuth(request, response);
      if (!user) return;
      const data = validateCircuitInput(request.body);
      const cid = `c_${crypto.randomBytes(12).toString('hex')}`;
      const circuit = await withTransaction(pool, async (connection) => {
        await connection.execute('INSERT INTO circuits (cid, owner_id) VALUES (?, ?)', [
          cid,
          user.id,
        ]);
        await insertRevision(connection, cid, 1, data, user.id);
        return readCircuit(connection, cid, 1, user);
      });
      response.status(201).json({ circuit });
    }),
  );
  router.put(
    '/:cid',
    handle(async (request, response) => {
      const user = await requireAuth(request, response);
      if (!user) return;
      validateCid(request.params.cid);
      const data = validateCircuitInput(request.body, { updating: true });
      const { cid } = request.params;
      const circuit = await withTransaction(pool, async (connection) => {
        const [rows] = await connection.execute(
          'SELECT owner_id, current_revision FROM circuits WHERE cid = ? FOR UPDATE',
          [cid],
        );
        if (!rows[0]) throw new CircuitError('电路不存在', 404, 'circuit_not_found');
        if (!canEditCircuit(user, rows[0].owner_id)) {
          throw new CircuitError('只有电路作者或管理员可以修改', 403, 'circuit_forbidden');
        }
        if (Number(rows[0].current_revision) !== data.expectedRevision) {
          throw new CircuitError(
            '电路已有新版本，请保留当前修改并重新载入后合并',
            409,
            'revision_conflict',
          );
        }
        const revision = data.expectedRevision + 1;
        await insertRevision(connection, cid, revision, data, user.id);
        await connection.execute(
          'UPDATE circuits SET current_revision = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE cid = ?',
          [revision, cid],
        );
        return readCircuit(connection, cid, revision, user);
      });
      response.json({ circuit });
    }),
  );
  return router;
}

module.exports = { createCircuitsRouter, ensureCircuitTables, validateCircuitInput };
