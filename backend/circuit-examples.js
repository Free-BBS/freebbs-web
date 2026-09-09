const express = require('express');
const { validateCircuitInput } = require('./circuits');
const { getDefaultExamples } = require('../public/circuit-default-examples');

class CircuitExampleError extends Error {
  constructor(message, status = 400, code = 'invalid_circuit_example') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function ensureCircuitExampleTables(pool) {
  await pool.execute(`CREATE TABLE IF NOT EXISTS circuit_examples (
    id INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    seed_key VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL UNIQUE,
    title VARCHAR(120) NOT NULL,
    description TEXT NOT NULL,
    document_json MEDIUMTEXT NOT NULL,
    revision INT UNSIGNED NOT NULL DEFAULT 1,
    is_deleted TINYINT(1) NOT NULL DEFAULT 0,
    created_by BIGINT NULL,
    updated_by BIGINT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_circuit_examples_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT fk_circuit_examples_editor FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL,
    INDEX idx_circuit_examples_visible (is_deleted, id)
  )`);
  for (const { seedKey, ...input } of getDefaultExamples()) {
    const validated = validateCircuitInput(input);
    // A retained seed_key also protects soft-deleted examples from being restored at startup.
    await pool.execute(
      `INSERT IGNORE INTO circuit_examples (seed_key, title, description, document_json)
       VALUES (?, ?, ?, ?)`,
      [seedKey, validated.title, validated.description, JSON.stringify(validated.document)],
    );
  }
}

function validateExampleInput(body, { updating = false } = {}) {
  try {
    return validateCircuitInput(body, { updating });
  } catch (error) {
    throw new CircuitExampleError(
      error.message,
      error.status || 400,
      error.code || 'invalid_circuit_example',
    );
  }
}

function parseExampleId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1 || id > 4294967295 || String(id) !== value) {
    throw new CircuitExampleError('示例 ID 无效');
  }
  return id;
}

function validateDeleteInput(body) {
  if (
    !body ||
    Array.isArray(body) ||
    typeof body !== 'object' ||
    Object.keys(body).length !== 1 ||
    !Object.hasOwn(body, 'expectedRevision') ||
    !Number.isSafeInteger(body.expectedRevision) ||
    body.expectedRevision < 1 ||
    body.expectedRevision >= 4294967295
  ) {
    throw new CircuitExampleError('删除示例时必须提供有效的 expectedRevision');
  }
  return body.expectedRevision;
}

function toExample(row, { summary = false } = {}) {
  return {
    id: Number(row.id),
    title: row.title,
    description: row.description,
    revision: Number(row.revision),
    ...(!summary ? { document: JSON.parse(row.document_json) } : {}),
  };
}

function isAdmin(user) {
  return Boolean(user && (user.is_admin || user.role === 'admin'));
}

async function readExample(connection, id) {
  const [rows] = await connection.execute(
    `SELECT id, title, description, revision, document_json
     FROM circuit_examples WHERE id = ? AND is_deleted = 0 LIMIT 1`,
    [id],
  );
  if (!rows[0])
    throw new CircuitExampleError('示例不存在或已删除', 404, 'circuit_example_not_found');
  return toExample(rows[0]);
}

async function transaction(pool, callback) {
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

async function lockExample(connection, id, expectedRevision) {
  const [rows] = await connection.execute(
    'SELECT revision, is_deleted FROM circuit_examples WHERE id = ? FOR UPDATE',
    [id],
  );
  if (!rows[0] || rows[0].is_deleted) {
    throw new CircuitExampleError('示例不存在或已删除', 404, 'circuit_example_not_found');
  }
  if (Number(rows[0].revision) !== expectedRevision) {
    throw new CircuitExampleError('示例已有新版本，请重新载入后再操作', 409, 'revision_conflict');
  }
}

function createCircuitExamplesRouter({ pool, requireAuth }) {
  const router = express.Router();
  function handle(callback) {
    return async (request, response) => {
      response.setHeader('Cache-Control', 'no-store');
      try {
        await callback(request, response);
      } catch (error) {
        if (error instanceof CircuitExampleError) {
          response.status(error.status).json({ message: error.message, code: error.code });
        } else {
          console.error('Circuit example request failed', error.code || error.message);
          response.status(500).json({ message: '电路示例操作失败，请稍后重试' });
        }
      }
    };
  }
  async function requireExampleAdmin(request, response) {
    const user = await requireAuth(request, response);
    if (!user) return null;
    if (!isAdmin(user)) {
      response
        .status(403)
        .json({ message: '只有管理员可以管理电路示例', code: 'circuit_example_forbidden' });
      return null;
    }
    return user;
  }
  router.get(
    '/',
    handle(async (request, response) => {
      let user = null;
      if (request.headers.authorization) {
        user = await requireAuth(request, response);
        if (!user) return;
      }
      const [rows] = await pool.execute(
        'SELECT id, title, description, revision FROM circuit_examples WHERE is_deleted = 0 ORDER BY id ASC',
      );
      response.json({
        examples: rows.map((row) => toExample(row, { summary: true })),
        canManage: isAdmin(user),
      });
    }),
  );
  router.get(
    '/:id',
    handle(async (request, response) => {
      if (request.headers.authorization && !(await requireAuth(request, response))) return;
      const id = parseExampleId(request.params.id);
      response.json({ example: await readExample(pool, id) });
    }),
  );
  router.post(
    '/',
    handle(async (request, response) => {
      const user = await requireExampleAdmin(request, response);
      if (!user) return;
      const data = validateExampleInput(request.body);
      const example = await transaction(pool, async (connection) => {
        const [inserted] = await connection.execute(
          `INSERT INTO circuit_examples (title, description, document_json, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?)`,
          [data.title, data.description, JSON.stringify(data.document), user.id, user.id],
        );
        return readExample(connection, inserted.insertId);
      });
      response.status(201).json({ example });
    }),
  );
  router.put(
    '/:id',
    handle(async (request, response) => {
      const user = await requireExampleAdmin(request, response);
      if (!user) return;
      const id = parseExampleId(request.params.id);
      const data = validateExampleInput(request.body, { updating: true });
      const example = await transaction(pool, async (connection) => {
        await lockExample(connection, id, data.expectedRevision);
        await connection.execute(
          `UPDATE circuit_examples SET title = ?, description = ?, document_json = ?, revision = revision + 1,
          updated_by = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
          [data.title, data.description, JSON.stringify(data.document), user.id, id],
        );
        return readExample(connection, id);
      });
      response.json({ example });
    }),
  );
  router.delete(
    '/:id',
    handle(async (request, response) => {
      const user = await requireExampleAdmin(request, response);
      if (!user) return;
      const id = parseExampleId(request.params.id);
      const expectedRevision = validateDeleteInput(request.body);
      await transaction(pool, async (connection) => {
        await lockExample(connection, id, expectedRevision);
        await connection.execute(
          `UPDATE circuit_examples SET is_deleted = 1, revision = revision + 1,
          updated_by = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
          [user.id, id],
        );
      });
      response.json({ ok: true, id, revision: expectedRevision + 1 });
    }),
  );
  return router;
}

module.exports = {
  createCircuitExamplesRouter,
  ensureCircuitExampleTables,
  validateExampleInput,
  validateDeleteInput,
};
